# -*- coding: utf-8 -*-
"""
Swachham Hotel Laundry — Standard Weight Master (Excel) -> JSON

Stage 1 of the import: Excel -> normalised JSON. Stage 2
(import_business_items.js) upserts the JSON into MySQL.

The workbook carries only "Item Name" + "Standard Weight (Kg)"; it has no
category column. Categories must stay the existing 14, so each item is
routed to one of them by keyword rules below (first match wins, rules are
ordered most-specific first). Anything unmatched is reported and fails the
export, so no item can silently land in the wrong category.
"""
import json
import os
import re
import sys
import unicodedata

import openpyxl

XLSX = os.environ.get(
    "WEIGHT_MASTER_XLSX",
    r"C:\Users\91755\Downloads\Swachham_Hotel_Laundry_Standard_Weight_Master.xlsx",
)
SHEET = "Standard Weight Master"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "business_items.json")

# Weight column of the workbook is in kilograms ("Standard Weight (Kg)").
WEIGHT_UNIT = "kg"

# (category slug, [regex keywords]) — evaluated in order, first match wins.
RULES = [
    ("special-services", [
        r"\bstain\b", r"\bstarch\b", r"\bexpress\b", r"\bsanitis", r"\bsanitiz",
        r"\bdisinfect", r"\bre-?wash\b", r"\bpress(ing)? only\b", r"\bdry ?clean",
        r"\bpacking\b", r"\bmoth\b", r"\bde-?stain",
    ]),
    ("spa-linen", [
        r"\bspa\b", r"\bmassage\b", r"\bsauna\b", r"\bfacial\b", r"\bsalon\b",
        r"\bsteam room\b", r"\bwrap\b", r"\bheadband\b", r"\bmani", r"\bpedi",
    ]),
    ("industrial", [
        r"\bindustrial\b", r"\bcoverall\b", r"\bboiler ?suit\b", r"\bworkshop\b",
        r"\bwiper\b", r"\brag\b", r"\bsafety\b", r"\bgarage\b", r"\bengine\b",
        r"\bhigh[- ]?vis", r"\bmechanic", r"\bfactory\b", r"\bworkwear\b",
    ]),
    ("fb-banquets", [
        r"\bbanquet", r"\bbuffet\b", r"\bchair (cover|sash|band)", r"\bsash\b",
        r"\btable skirt", r"\bskirting\b", r"\boverlay\b", r"\bwaiter\b",
        r"\bservice (cloth|napkin)", r"\bglass ?cloth\b", r"\btable runner\b",
        r"\bfrill\b", r"\bcocktail\b", r"\bslip ?cloth\b", r"\bmoulton\b",
    ]),
    # Apparel — staff uniforms and guest garments both live here, because the
    # existing 14 categories have no separate garment category and must not be
    # added to.
    ("staff-uniform", [
        r"\buniform\b", r"\bstaff\b", r"\bchef\b", r"\bwaistcoat\b", r"\bblazer\b",
        r"\bjacket\b", r"\btrouser", r"\bshirt\b", r"\btunic\b", r"\bsaree\b",
        r"\bsari\b", r"\bkurta\b", r"\bdupatta\b", r"\bcoat\b", r"\bcap\b",
        r"\bnecktie\b", r"\btie\b", r"\bscarf\b", r"\bskirt\b", r"\btrousers\b",
        r"\bsecurity\b", r"\bdoorman\b", r"\bbell ?boy\b", r"\bgloves?\b",
        r"\bjeans\b", r"\bdress\b", r"\bsalwar\b", r"\bsuit\b", r"\bhandkerchief\b",
        r"\brain ?coat\b", r"\bt-?shirt\b", r"\bblouse\b", r"\bpant", r"\bshort",
    ]),
    ("housekeeping-utility", [
        r"\bduster\b", r"\bdusting\b", r"\bcleaning cloth\b", r"\bmop\b",
        r"\bswab\b", r"\blaundry bag\b", r"\blinen bag\b", r"\bmicro ?fib",
        r"\bhousekeep", r"\bwiping\b", r"\btrolley\b", r"\bshoe ?(shine|mitt)",
        r"\bpolish", r"\bglass wipe\b", r"\butility\b", r"\bapron\b",
    ]),
    ("carpet-and-rugs", [
        r"\bcarpet", r"\brug\b", r"\brugs\b", r"\bdurrie\b", r"\bdhurrie\b",
        r"\barea rug\b", r"\bprayer mat\b",
    ]),
    ("floor-and-upholstery", [
        r"\bfloor\b", r"\bdoor ?mat\b", r"\bfoot ?mat\b", r"\bupholster",
    ]),
    # Protectors/covers are bed linen even though they name the mattress, so
    # they are matched before the heavy-linens rule below claims them.
    ("bed-linen", [
        r"\bmat+ress ?(cover|protector|pad)\b",
    ]),
    ("blanket-and-heavy-linens", [
        r"\bblanket", r"\bcomforter\b", r"\bquilt\b", r"\bduvet\b", r"\bdohar\b",
        r"\brazai\b", r"\bmattress\b", r"\bheavy\b", r"\bwoollen\b", r"\bwoolen\b",
        r"\bfleece\b", r"\bthrow\b",
    ]),
    ("dining-and-kitchen", [
        r"\bnapkin\b", r"\btable ?cloth\b", r"\bplace ?mat\b", r"\btable ?mat\b",
        r"\bkitchen\b", r"\btea ?towel\b", r"\bdish ?cloth\b", r"\boven\b",
        r"\bpot ?holder\b", r"\btray ?cloth\b", r"\bcutlery\b", r"\bbar ?mop\b",
        r"\bbar ?cloth\b", r"\bdining\b",
    ]),
    ("living-room", [
        r"\bsofa\b", r"\bcouch\b", r"\brecliner\b", r"\barm ?rest\b",
        r"\bottoman\b", r"\bpouffe\b", r"\bbean ?bag\b", r"\bfoot ?stool\b",
        r"\bdiwan\b", r"\bsettee\b", r"\bliving\b",
    ]),
    ("room-furnishing", [
        r"\bcurtain", r"\bsheer\b", r"\bvalance\b", r"\bdrape", r"\bblind",
        r"\bcushion\b",
        r"\bcushion cover\b", r"\blamp ?shade\b", r"\bwindow\b", r"\bbed ?runner\b",
        r"\bbed ?scarf\b", r"\bbed ?spread\b", r"\bbedspread\b", r"\bcanopy\b",
        r"\bwall\b",
    ]),
    ("bed-linen", [
        r"\bbed ?sheet\b", r"\bflat sheet\b", r"\bfitted sheet\b", r"\bpillow",
        r"\bbolster\b", r"\bbed ?cover\b", r"\bbed ?skirt\b", r"\bbed ?pad\b",
        # "Matress" is the workbook's spelling; both are accepted.
        r"\bmat*ress ?(cover|protector|pad)\b", r"\bmatress\b",
        r"\bcot sheet\b", r"\bbaby sheet\b", r"\bcrib\b", r"\bbed\b", r"\bsheet\b",
    ]),
    ("bath-linen", [
        r"\btowel\b", r"\bbath\b", r"\bbathroom\b", r"\brobe\b", r"\bwash ?cloth\b", r"\bmitt\b",
        r"\bloofah\b", r"\bshower\b", r"\bhand ?cloth\b", r"\bface ?cloth\b",
        r"\bbidet\b", r"\bbath ?sheet\b", r"\bbath ?mat\b", r"\bpool\b",
        r"\bbeach\b",
    ]),
]


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKC", str(name)).strip()
    s = re.sub(r"\s+", " ", s)
    return s


def classify(name: str):
    hay = name.lower()
    for slug, patterns in RULES:
        for pat in patterns:
            if re.search(pat, hay):
                return slug
    return None


def main():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wb[SHEET]
    rows = list(ws.iter_rows(values_only=True))
    header = [norm(c) if c is not None else "" for c in rows[0]]

    def col(label):
        for i, h in enumerate(header):
            if h.lower().startswith(label.lower()):
                return i
        raise SystemExit(f"Column not found: {label}")

    i_name, i_weight, i_sr = col("Item Name"), col("Standard Weight"), col("Sr. No")

    items, unmatched, seen = [], [], {}
    for r in rows[1:]:
        if r[i_name] is None or not norm(r[i_name]):
            continue
        name = norm(r[i_name])
        weight = r[i_weight]
        if weight is None:
            unmatched.append((name, "missing weight"))
            continue
        slug = classify(name)
        if slug is None:
            unmatched.append((name, "no category rule"))
            continue
        key = name.lower()
        if key in seen:
            # Duplicate item name in the workbook: last non-null weight wins,
            # and only one row is imported so the catalogue stays unique.
            seen[key]["weight_kg"] = round(float(weight), 3)
            continue
        rec = {
            "sr_no": int(r[i_sr]) if r[i_sr] is not None else 0,
            "name": name,
            "category_slug": slug,
            "weight_kg": round(float(weight), 3),
            "weight_unit": WEIGHT_UNIT,
        }
        seen[key] = rec
        items.append(rec)

    by_cat = {}
    for it in items:
        by_cat[it["category_slug"]] = by_cat.get(it["category_slug"], 0) + 1

    print(f"excel rows read      : {len(rows) - 1}")
    print(f"items exported       : {len(items)}")
    print(f"duplicate names      : {len(rows) - 1 - len(items) - len(unmatched)}")
    print(f"weight unit          : {WEIGHT_UNIT}")
    print("per-category counts  :")
    for slug in dict.fromkeys(slug for slug, _ in RULES):
        print(f"  {slug:28s} {by_cat.get(slug, 0)}")
    if unmatched:
        print(f"\nUNMATCHED ({len(unmatched)}):")
        for name, why in unmatched:
            print(f"  {name}  <- {why}")
        sys.exit(2)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"weight_unit": WEIGHT_UNIT, "items": items}, fh, indent=1, ensure_ascii=False)
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
