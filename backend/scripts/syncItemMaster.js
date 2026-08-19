/**
 * Item-master synchronisation against the Excel workbook.
 *
 *   node scripts/syncItemMaster.js                 # dry run: report only, no writes
 *   node scripts/syncItemMaster.js --apply         # insert + update (no removals)
 *   node scripts/syncItemMaster.js --apply --remove-extras
 *
 * Source of truth: the "Item Master" sheet of the workbook.
 *
 * Scope: `service_categories` (kind='ITEM_CATEGORY') and `services`
 * (kind='ITEM') only. Orders, order_items, carts, users, businesses,
 * payments and the two SERVICE_TYPE rows are never touched, and the schema is
 * never altered.
 *
 * Matching key: `services.external_id` = the sheet's Item ID (ITM####). It is
 * stable across re-runs, so re-running cannot create duplicates.
 *
 * Removal policy: an item in the database but absent from the sheet is
 * DEACTIVATED (is_active = false), never deleted, so historical orders that
 * reference it keep resolving. Deletion is only considered for rows no order
 * has ever referenced, and even then only under --remove-extras.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');

const WORKBOOK =
  process.env.ITEM_MASTER_XLSX ||
  'C:/Users/91755/Desktop/SWACHHAM LAUNDERING FINAL DATA SHEET1.xlsx';
const SHEET = 'Item Master';

const APPLY = process.argv.includes('--apply');
const REMOVE_EXTRAS = process.argv.includes('--remove-extras');
/**
 * The sheet writes the unit as "Number"; the database stores the equivalent
 * "Nos", which is what the app renders. They mean the same thing, so the unit
 * is only rewritten when this flag asks for it.
 */
const UNIT_FROM_SHEET = process.argv.includes('--unit-from-sheet');
/** Applies the quarantined rows below as well. Off by default. */
const INCLUDE_SUSPECT = process.argv.includes('--include-suspect');

/**
 * Rows held back because the sheet block they sit in is corrupted, not
 * because the data merely differs.
 *
 * ITM0065-ITM0074 in "CLOTHING &ACESARIES" all read "Shirt" with weights
 * running 1.25, 2.25 ... 10.25 kg — an exact +1.00 fill-down. The database
 * holds the real garments (T-Shirt, Trouser, Jeans, Dress, Saree, Kurta,
 * Salwar Suit, Scarf, Handkerchief, Cap) with plausible weights. Applying the
 * sheet would collapse ten distinct items into ten identical "Shirt" rows and
 * put a 10.25 kg cap into every order weight, so these are reported and left
 * alone until the sheet is corrected. Pass --include-suspect to apply anyway.
 */
const SUSPECT_EXTERNAL_IDS = new Set([
  'ITM0065', 'ITM0066', 'ITM0067', 'ITM0068', 'ITM0069',
  'ITM0070', 'ITM0071', 'ITM0072', 'ITM0073', 'ITM0074',
]);

// ---------------------------------------------------------------- helpers

/** Trim, collapse inner runs of whitespace. Used before every comparison. */
const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Case-insensitive comparison key. */
const key = (value) => norm(value).toLowerCase();

/**
 * Main-category spellings in the sheet that are the same category. The sheet
 * carries typos ("F & B SERICE", "UNIFORM"); mapping them here keeps the
 * category list to the ones the dataset really describes instead of creating
 * a near-duplicate per typo.
 */
const MAIN_CATEGORY_ALIASES = {
  'f & b serice': 'F & B SERVICE',
  uniform: 'UNIFORMS',
};

/**
 * Sheet category name -> the category already in the database.
 *
 * The database tree was built from this same sheet and carries the corrected
 * spelling ("Towels & Bath Accessories", not "TOWELS & BATH ACCESARIES").
 * Mapping onto it keeps one category per real category: creating a second
 * one per typo is exactly the near-duplicate the brief rules out. No sheet
 * category is dropped — every pair below resolves to a real row.
 */
const CATEGORY_NAME_MAP = {
  // mains
  'room linen': 'Room Linen',
  'spa & pool': 'Spa & Pool',
  'f & b service': 'F&B Service',
  'f & b production': 'F&B Production',
  uniforms: 'Uniforms',
  // subs
  'towels & bath accesaries': 'Towels & Bath Accessories',
  'bed linen': 'Bed Linen',
  curtains: 'Curtains',
  'sofa & cushion': 'Sofa & Cushion',
  'blankets & heavy linen': 'Blankets & Heavy Linen',
  'carpet & rugs': 'Carpet & Rugs',
  'housekeeping & utility': 'Housekeeping & Utility',
  'bath linen': 'Bath Linen',
  'spa linen': 'Spa Linen',
  'f&b & banquets': 'F&B & Banquets',
  'dining & kitchen': 'Dining & Kitchen',
  'clothing &acesaries': 'Clothing & Accessories',
  'staff uniforms': 'Staff Uniforms',
};

const dbCategoryName = (sheetName) => CATEGORY_NAME_MAP[key(sheetName)] || norm(sheetName);

/** Title Case for display, e.g. "ROOM LINEN" -> "Room Linen". */
function titleCase(value) {
  return norm(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
    .replace(/\bF&b\b/gi, 'F&B')
    .replace(/\bF & B\b/gi, 'F&B');
}

function slugify(value) {
  return norm(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sslOption() {
  const value = String(process.env.DATABASE_SSL || '').toLowerCase();
  if (!value || value === 'false' || value === 'disabled') return undefined;
  return { rejectUnauthorized: false };
}

// ---------------------------------------------------------------- the sheet

function readSheet() {
  const wb = XLSX.readFile(WORKBOOK);
  if (!wb.Sheets[SHEET]) throw new Error(`Sheet "${SHEET}" not found`);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { defval: null });

  const rows = [];
  const skipped = [];
  const noExternalId = [];

  raw.forEach((row, index) => {
    const excelRow = index + 2; // 1-based, plus the header
    const externalId = norm(row['Item ID']);
    const name = norm(row['Item Name']);
    const mainRaw = norm(row['Main Category']);
    const main = MAIN_CATEGORY_ALIASES[key(mainRaw)] || mainRaw;
    const sub = norm(row['Sub Category']);

    // A row still needs a name and a category to be placed at all.
    if (!name || !main || !sub) {
      skipped.push({ excelRow, name: name || '(blank)', reason: 'missing name or category' });
      return;
    }
    // No Item ID: it is matched by name + category instead, and reported. It
    // is never inserted blind, because a new row would have no stable key.
    if (!externalId) {
      noExternalId.push({ excelRow, name, main, sub });
    }

    const weight = row['Standard Weight'];
    rows.push({
      excelRow,
      externalId,
      name,
      mainCategory: dbCategoryName(main),
      mainCategoryRaw: mainRaw,
      subCategory: dbCategoryName(sub),
      subCategoryRaw: sub,
      standardSize: norm(row['Standard Size']) || null,
      unit: norm(row['Unit']) || 'Number',
      weightKg: weight === null || weight === '' ? null : Number(weight),
      isActive: key(row['Active/Inactive']) !== 'inactive',
    });
  });

  return { rows, skipped, noExternalId };
}

// ---------------------------------------------------------------- database

async function loadDatabase(conn) {
  const [categories] = await conn.execute(
    `SELECT id, name, slug, parent_id, is_active
       FROM service_categories
      WHERE scope = 'BUSINESS' AND kind = 'ITEM_CATEGORY'`
  );

  const [items] = await conn.execute(
    `SELECT s.id, s.external_id, s.name, s.category_id, s.unit, s.standard_size,
            s.weight_kg, s.weight_unit, s.is_active, s.base_price,
            c.name AS category_name, p.name AS parent_category_name,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.service_id = s.id) AS order_refs,
            (SELECT COUNT(*) FROM cart_items ci WHERE ci.service_id = s.id) AS cart_refs,
            (SELECT GROUP_CONCAT(st.code ORDER BY st.code)
               FROM item_service_types m JOIN services st ON st.id = m.service_id
              WHERE m.item_id = s.id) AS service_codes
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       LEFT JOIN service_categories p ON p.id = c.parent_id
      WHERE s.scope = 'BUSINESS' AND s.kind = 'ITEM'`
  );

  return { categories, items };
}

// ---------------------------------------------------------------- planning

function buildPlan(sheetRows, db) {
  const byExternalId = new Map();
  const byNameCategory = new Map();
  for (const item of db.items) {
    if (item.external_id) byExternalId.set(key(item.external_id), item);
    byNameCategory.set(`${key(item.name)}|${key(item.category_name)}`, item);
  }

  const inserts = [];
  const updates = [];
  const unchanged = [];
  const matchedIds = new Set();
  const duplicatesPrevented = [];
  const blockedInserts = [];
  const quarantined = [];
  const seenSheetKeys = new Set();

  for (const row of sheetRows) {
    const dedupeKey = row.externalId
      ? key(row.externalId)
      : `${key(row.name)}|${key(row.subCategory)}`;
    if (seenSheetKeys.has(dedupeKey)) {
      duplicatesPrevented.push(
        `${row.externalId || row.name} (repeated at sheet row ${row.excelRow})`
      );
      continue;
    }
    seenSheetKeys.add(dedupeKey);

    // Match on the stable Item ID first, then fall back to name + leaf
    // category — that fallback is what matches a sheet row that has no Item
    // ID to the row already in the database, instead of duplicating it.
    let existing = row.externalId ? byExternalId.get(key(row.externalId)) : undefined;
    if (!existing) {
      existing =
        byNameCategory.get(`${key(row.name)}|${key(row.subCategory)}`) ||
        byNameCategory.get(`${key(row.name)}|${key(row.mainCategory)}`);
      if (existing && existing.external_id && row.externalId &&
          key(existing.external_id) !== key(row.externalId)) {
        existing = undefined; // belongs to a different Item ID
      }
    }

    if (!existing) {
      if (!row.externalId) {
        blockedInserts.push(row); // no stable key, so never inserted blind
        continue;
      }
      inserts.push(row);
      continue;
    }

    matchedIds.add(existing.id);
    const changes = [];
    const blanks = [];

    // A blank cell in the sheet is not an instruction to erase a value that
    // is already there — the field is left as it is and reported instead.
    const compare = (field, current, incoming) => {
      if (incoming === null || incoming === '') {
        if (current !== null && current !== '') blanks.push(field);
        return;
      }
      if (norm(current) !== norm(incoming)) changes.push([field, current, incoming]);
    };

    compare('name', existing.name, row.name);
    compare('standard_size', existing.standard_size, row.standardSize);
    if (UNIT_FROM_SHEET) compare('unit', existing.unit, row.unit);

    const dbWeight = existing.weight_kg === null ? null : Number(existing.weight_kg);
    if (row.weightKg === null) {
      if (dbWeight !== null) blanks.push('weight_kg');
    } else if (dbWeight !== row.weightKg) {
      changes.push(['weight_kg', dbWeight, row.weightKg]);
    }

    if (Boolean(existing.is_active) !== row.isActive) {
      changes.push(['is_active', Boolean(existing.is_active), row.isActive]);
    }
    if (row.externalId && !existing.external_id) {
      changes.push(['external_id', null, row.externalId]);
    }
    if (key(existing.category_name) !== key(row.subCategory) &&
        key(existing.category_name) !== key(row.mainCategory)) {
      changes.push(['category', existing.category_name, row.subCategory]);
    }

    // A name that differs only in capitalisation is not a correction worth
    // writing ("Small Carpet" -> "Small carpet"), so it is reported, not applied.
    const applied = changes.filter(
      ([field, from, to]) => !(field === 'name' && key(from) === key(to))
    );
    const caseOnly = changes.filter(
      ([field, from, to]) => field === 'name' && key(from) === key(to)
    );

    if (row.externalId && SUSPECT_EXTERNAL_IDS.has(row.externalId) && !INCLUDE_SUSPECT) {
      if (applied.length) quarantined.push({ row, existing, changes: applied });
      continue;
    }

    if (applied.length) updates.push({ row, existing, changes: applied, blanks, caseOnly });
    else unchanged.push({ row, existing, blanks, caseOnly });
  }

  // In the database but not in the sheet.
  const extras = db.items
    .filter((item) => !matchedIds.has(item.id))
    .map((item) => ({
      item,
      referenced: Number(item.order_refs) > 0 || Number(item.cart_refs) > 0,
    }));

  return { inserts, updates, unchanged, extras, duplicatesPrevented, blockedInserts, quarantined };
}

// ---------------------------------------------------------------- reporting

function printPlan(plan, sheet, db) {
  const line = (t) => console.log(`\n${'='.repeat(66)}\n${t}\n${'='.repeat(66)}`);

  line('SOURCE SHEET');
  console.log(`Workbook       : ${WORKBOOK}`);
  console.log(`Sheet          : ${SHEET}`);
  console.log(`Usable rows    : ${sheet.rows.length}`);
  console.log(`Skipped rows   : ${sheet.skipped.length}`);
  sheet.skipped.forEach((s) => console.log(`   row ${s.excelRow}: ${s.name} — ${s.reason}`));

  line('DATABASE BEFORE');
  console.log(`Business items : ${db.items.length} (${db.items.filter((i) => i.is_active).length} active)`);
  console.log(`Item categories: ${db.categories.length}`);

  line(`INSERT — in sheet, not in database (${plan.inserts.length})`);
  plan.inserts.forEach((r) =>
    console.log(`   ${r.externalId}  ${r.name}  [${r.mainCategory} > ${r.subCategory}]  ${r.weightKg} kg`)
  );

  line(`UPDATE — different values (${plan.updates.length})`);
  plan.updates.forEach((u) => {
    console.log(`   ${u.row.externalId}  ${u.row.name}`);
    u.changes.forEach(([field, from, to]) =>
      console.log(`        ${field}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`)
    );
  });

  line(`UNCHANGED — already correct (${plan.unchanged.length})`);

  line(`EXTRA — in database, not in sheet (${plan.extras.length})`);
  plan.extras.forEach((e) =>
    console.log(
      `   id=${e.item.id} ${e.item.external_id || '(no Item ID)'}  ${e.item.name}` +
        `  [${e.item.parent_category_name || '-'} > ${e.item.category_name || '-'}]` +
        `  active=${Boolean(e.item.is_active)}  orderRefs=${e.item.order_refs}  cartRefs=${e.item.cart_refs}` +
        `  -> ${e.referenced ? 'PRESERVE (referenced), deactivate only' : 'deactivate' + (REMOVE_EXTRAS ? ' + delete' : '')}`
    )
  );

  if (plan.quarantined.length) {
    console.log(`
${'#'.repeat(66)}
QUARANTINED — sheet block looks corrupted, NOT applied (${plan.quarantined.length})
${'#'.repeat(66)}`);
    plan.quarantined.forEach((q) => {
      console.log(`   ${q.row.externalId}  database: "${q.existing.name}" (${q.existing.weight_kg} kg)`);
      q.changes.forEach(([field, from, to]) =>
        console.log(`        sheet would set ${field}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`)
      );
    });
  }

  const caseOnly = [...plan.updates, ...plan.unchanged].filter((u) => u.caseOnly && u.caseOnly.length);
  if (caseOnly.length) {
    console.log(`
${'='.repeat(66)}
CASE-ONLY NAME DIFFERENCES — kept as stored (${caseOnly.length})
${'='.repeat(66)}`);
    caseOnly.forEach((u) =>
      u.caseOnly.forEach(([, from, to]) => console.log(`   ${JSON.stringify(from)} (kept) vs sheet ${JSON.stringify(to)}`))
    );
  }

  if (plan.blockedInserts.length) {
    console.log(`
${'='.repeat(66)}
NOT INSERTED — no Item ID and no match (${plan.blockedInserts.length})
${'='.repeat(66)}`);
    plan.blockedInserts.forEach((r) =>
      console.log(`   sheet row ${r.excelRow}: ${r.name} [${r.mainCategory} > ${r.subCategory}]`)
    );
  }

  const blanksKept = [...plan.updates, ...plan.unchanged].filter((u) => u.blanks && u.blanks.length);
  if (blanksKept.length) {
    console.log(`
${'='.repeat(66)}
BLANK SHEET CELLS — existing value kept (${blanksKept.length})
${'='.repeat(66)}`);
    blanksKept.forEach((u) =>
      console.log(`   ${u.row.externalId || u.row.name}: kept ${u.blanks.join(', ')}`)
    );
  }

  if (plan.duplicatesPrevented.length) {
    line(`DUPLICATES PREVENTED (${plan.duplicatesPrevented.length})`);
    plan.duplicatesPrevented.forEach((d) => console.log(`   ${d}`));
  }
}

// ---------------------------------------------------------------- writing

async function categoryId(conn, cache, name, parentId, order) {
  const cacheKey = `${key(name)}|${parentId || 'root'}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const display = titleCase(name);
  const slug = parentId ? `${slugify(name)}-${parentId}` : slugify(name);

  const [existing] = await conn.execute(
    `SELECT id FROM service_categories
      WHERE scope = 'BUSINESS' AND kind = 'ITEM_CATEGORY'
        AND LOWER(TRIM(name)) = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'}
      LIMIT 1`,
    parentId ? [key(name), parentId] : [key(name)]
  );
  if (existing[0]) {
    await conn.execute(`UPDATE service_categories SET is_active = TRUE WHERE id = ?`, [existing[0].id]);
    cache.set(cacheKey, existing[0].id);
    return existing[0].id;
  }

  const [inserted] = await conn.execute(
    `INSERT INTO service_categories (name, slug, scope, kind, parent_id, display_order, is_active)
     VALUES (?, ?, 'BUSINESS', 'ITEM_CATEGORY', ?, ?, TRUE)`,
    [display, slug, parentId, order]
  );
  cache.set(cacheKey, inserted.insertId);
  return inserted.insertId;
}

/** Stable per-row key: the Item ID when there is one, else name + category. */
const rowKey = (row) =>
  row.externalId ? key(row.externalId) : `${key(row.name)}|${key(row.subCategory)}`;

async function applyPlan(conn, plan, sheetRows) {
  const cache = new Map();
  let order = 1;

  // Resolve every leaf category the sheet needs, main first.
  const leafFor = new Map();
  for (const row of sheetRows) {
    const mainId = await categoryId(conn, cache, row.mainCategory, null, order++);
    const subId =
      key(row.subCategory) === key(row.mainCategory)
        ? mainId
        : await categoryId(conn, cache, row.subCategory, mainId, order++);
    // A sheet row whose sub-category repeats the main name (F & B PRODUCTION >
    // F & B PRODUCTION) belongs on the main category itself, which is where
    // the database already keeps it.
    leafFor.set(rowKey(row), key(row.subCategory) === key(row.mainCategory) ? mainId : subId);
  }

  for (const row of plan.inserts) {
    await conn.execute(
      `INSERT INTO services
         (category_id, scope, kind, external_id, name, unit, standard_size,
          weight_kg, weight_unit, base_price, is_active, display_order)
       VALUES (?, 'BUSINESS', 'ITEM', ?, ?, ?, ?, ?, 'kg', 1, ?, 0)`,
      [
        leafFor.get(rowKey(row)),
        row.externalId,
        row.name,
        row.unit,
        row.standardSize,
        row.weightKg,
        row.isActive ? 1 : 0,
      ]
    );
  }

  for (const { row, existing } of plan.updates) {
    // COALESCE keeps whatever is already stored wherever the sheet cell is
    // blank, so an incomplete row can never erase good data.
    await conn.execute(
      `UPDATE services
          SET name = ?,
              standard_size = COALESCE(?, standard_size),
              unit = COALESCE(?, unit),
              weight_kg = COALESCE(?, weight_kg),
              weight_unit = 'kg',
              external_id = COALESCE(?, external_id),
              category_id = ?,
              is_active = ?,
              updated_at = NOW()
        WHERE id = ? AND kind = 'ITEM'`,
      [
        row.name,
        row.standardSize,
        UNIT_FROM_SHEET ? row.unit : null,
        row.weightKg,
        row.externalId || null,
        leafFor.get(rowKey(row)) || existing.category_id,
        row.isActive ? 1 : 0,
        existing.id,
      ]
    );
  }

  // Extras: deactivated, never deleted while anything references them.
  let deactivated = 0;
  let deleted = 0;
  for (const extra of plan.extras) {
    if (extra.referenced || !REMOVE_EXTRAS) {
      if (extra.item.is_active) {
        await conn.execute(
          `UPDATE services SET is_active = FALSE, updated_at = NOW() WHERE id = ? AND kind = 'ITEM'`,
          [extra.item.id]
        );
        deactivated += 1;
      }
      continue;
    }
    await conn.execute(`DELETE FROM item_service_types WHERE item_id = ?`, [extra.item.id]);
    await conn.execute(`DELETE FROM services WHERE id = ? AND kind = 'ITEM'`, [extra.item.id]);
    deleted += 1;
  }

  return { deactivated, deleted };
}

// ---------------------------------------------------------------- main

async function main() {
  const sheet = readSheet();

  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '3306', 10),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: sslOption(),
  });

  const db = await loadDatabase(conn);

  // Backup before anything is written, always — including on a dry run.
  const backupDir = path.join(__dirname, 'data');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `items-backup-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(db, null, 2), 'utf8');

  const plan = buildPlan(sheet.rows, db);
  printPlan(plan, sheet, db);
  console.log(`\nBackup written: ${backupFile}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to execute.');
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    const result = await applyPlan(conn, plan, sheet.rows);
    await conn.commit();

    const after = await loadDatabase(conn);
    console.log('\n================ SYNC REPORT ================');
    console.log(`Excel entries found                : ${sheet.rows.length}`);
    console.log(`Existing matching entries          : ${plan.unchanged.length + plan.updates.length}`);
    console.log(`New entries inserted               : ${plan.inserts.length}`);
    console.log(`Existing entries updated           : ${plan.updates.length}`);
    console.log(`Extras deactivated (soft-removed)  : ${result.deactivated}`);
    console.log(`Extras deleted                     : ${result.deleted}`);
    console.log(
      `Preserved for order/cart history   : ${plan.extras.filter((e) => e.referenced).length}`
    );
    console.log(`Duplicates prevented               : ${plan.duplicatesPrevented.length}`);
    console.log(`Quarantined (corrupted sheet rows) : ${plan.quarantined.length}`);
    console.log(`Final database items               : ${after.items.length} (${after.items.filter((i) => i.is_active).length} active)`);
  } catch (error) {
    await conn.rollback();
    console.error('\nFAILED — rolled back, database unchanged:', error.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('Failed:', error.stack || error.message);
  process.exit(1);
});
