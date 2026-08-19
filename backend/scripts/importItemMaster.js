/**
 * Imports the Swachham item master workbook into the catalogue tables.
 *
 *   Main Category -> service_categories (parent_id NULL)
 *   Sub Category  -> service_categories (parent_id = main)
 *   Item          -> services (kind = ITEM, linked to its leaf category)
 *
 * Idempotent: rows are matched on external_id (the sheet's Item ID) and on
 * category slug, so re-running updates in place rather than duplicating.
 *
 * Usage:  node scripts/importItemMaster.js "<path to .xlsx>" [--apply]
 * Without --apply it performs a dry run and prints what would change.
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');

const SHEET = 'Item Master';

// The sheet contains a few inconsistent spellings of the same main category.
const MAIN_CATEGORY_FIXES = {
  'F & B SERICE': 'F & B SERVICE',
  UNIFORM: 'UNIFORMS',
};

// Misspellings in the sheet's sub-category names, corrected for display.
// Keyed on the upper-cased sheet value so the sheet stays the source of truth
// for structure while the UI shows correct English.
const SUB_CATEGORY_FIXES = {
  'CLOTHING &ACESARIES': 'CLOTHING & ACCESSORIES',
  'CLOTHING & ACESARIES': 'CLOTHING & ACCESSORIES',
  'TOWELS & BATH ACCESARIES': 'TOWELS & BATH ACCESSORIES',
};

// The workbook has no Service Type column, so items are seeded into the two
// filters by material/handling. Stored in the DB and editable there — this
// list only seeds the initial value.
const DRY_CLEAN_PATTERNS = [
  /curtain/i, /blanket/i, /quilt/i, /duvet/i, /carpet/i, /\brug/i,
  /sofa/i, /cushion/i, /coat/i, /blazer/i, /suit/i, /saree/i, /silk/i,
  /wool/i, /jacket/i, /dress/i, /kurta/i, /sherwani/i, /uniform set/i,
  /throw/i, /upholster/i, /mattress/i, /pillow/i, /tie\b/i, /scarf/i,
];

// Items that make no sense to launder in a domestic wash cycle.
const DRY_CLEAN_ONLY_PATTERNS = [/carpet/i, /\brug/i, /upholster/i, /mattress/i];

function titleCase(value) {
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (m, ch) => ch.toUpperCase())
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bF&b\b/gi, 'F&B')
    .replace(/\bF & B\b/gi, 'F&B');
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value)
    // The sheet uses a non-ASCII multiplication sign in sizes.
    .replace(/×|�/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' || text.toLowerCase() === 'nan' ? null : text;
}

function deriveServiceTypes(itemName, subCategory) {
  const haystack = `${itemName} ${subCategory || ''}`;
  const dryCleanOnly = DRY_CLEAN_ONLY_PATTERNS.some((re) => re.test(haystack));
  if (dryCleanOnly) return 'dry_clean';
  const dryClean = DRY_CLEAN_PATTERNS.some((re) => re.test(haystack));
  return dryClean ? 'wash_iron,dry_clean' : 'wash_iron';
}

function readRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[SHEET];
  if (!sheet) throw new Error(`Sheet "${SHEET}" not found in ${filePath}`);
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: null });

  const rows = [];
  const skipped = [];

  for (const row of raw) {
    const itemName = cleanText(row['Item Name']);
    const rawMain = cleanText(row['Main Category']);
    const externalId = cleanText(row['Item ID']);
    const active = cleanText(row['Active/Inactive']);

    if (!itemName || !rawMain) {
      skipped.push({ externalId, itemName, reason: 'missing item name / main category' });
      continue;
    }

    const mainRaw = MAIN_CATEGORY_FIXES[rawMain.toUpperCase()] || rawMain;
    const subCell = cleanText(row['Sub Category']);
    const subRaw = subCell ? SUB_CATEGORY_FIXES[subCell.toUpperCase()] || subCell : null;
    const weight = row['Standard Weight'];

    // A few sheet rows carry a real item but no Item ID. Derive a stable key
    // from the category path + name so the row still imports and re-imports
    // update it rather than inserting a second copy.
    const stableId =
      externalId || `GEN-${slugify(`${mainRaw}-${subRaw || 'direct'}-${itemName}`)}`.slice(0, 40);

    rows.push({
      externalId: stableId,
      itemName: titleCase(itemName),
      main: titleCase(mainRaw),
      mainSlug: slugify(mainRaw),
      sub: subRaw ? titleCase(subRaw) : null,
      subSlug: subRaw ? slugify(`${mainRaw}-${subRaw}`) : null,
      standardSize: cleanText(row['Standard Size']),
      unit: cleanText(row['Unit']) || 'Nos',
      weightKg: weight === null || weight === '' || Number.isNaN(Number(weight)) ? null : Number(weight),
      isActive: !active || active.toLowerCase() === 'active',
      serviceTypes: deriveServiceTypes(itemName, subRaw),
    });
  }

  return { rows, skipped };
}

async function main() {
  const filePath = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!filePath) {
    console.error('Usage: node scripts/importItemMaster.js "<path to .xlsx>" [--apply]');
    process.exit(1);
  }

  const { rows, skipped } = readRows(path.resolve(filePath));

  const mains = new Map();
  const subs = new Map();
  for (const row of rows) {
    if (!mains.has(row.mainSlug)) mains.set(row.mainSlug, row.main);
    if (row.subSlug && !subs.has(row.subSlug)) {
      subs.set(row.subSlug, { name: row.sub, mainSlug: row.mainSlug });
    }
  }

  console.log(`Parsed ${rows.length} items (${skipped.length} skipped)`);
  console.log(`  main categories: ${mains.size}`);
  console.log(`  sub categories : ${subs.size}`);
  skipped.forEach((s) => console.log(`  SKIP ${s.externalId || '(no id)'} ${s.itemName || ''} — ${s.reason}`));

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.');
    for (const [slug, name] of mains) {
      const childCount = [...subs.values()].filter((s) => s.mainSlug === slug).length;
      const direct = rows.filter((r) => r.mainSlug === slug && !r.subSlug).length;
      console.log(`  ${name} (${slug}) — ${childCount} sub, ${direct} direct items`);
    }
    return;
  }

  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '3306', 10),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  await conn.beginTransaction();
  try {
    // ---- Main categories ----
    const mainIds = new Map();
    let order = 1;
    for (const [slug, name] of mains) {
      await conn.execute(
        `INSERT INTO service_categories (name, slug, scope, kind, parent_id, display_order, is_active)
         VALUES (?, ?, 'BUSINESS', 'ITEM_CATEGORY', NULL, ?, TRUE)
         ON DUPLICATE KEY UPDATE name = VALUES(name), parent_id = NULL,
           display_order = VALUES(display_order), is_active = TRUE, kind = 'ITEM_CATEGORY'`,
        [name, slug, order++]
      );
      const [r] = await conn.execute(`SELECT id FROM service_categories WHERE slug = ?`, [slug]);
      mainIds.set(slug, r[0].id);
    }

    // ---- Sub categories ----
    const subIds = new Map();
    order = 1;
    for (const [slug, info] of subs) {
      const parentId = mainIds.get(info.mainSlug);
      await conn.execute(
        `INSERT INTO service_categories (name, slug, scope, kind, parent_id, display_order, is_active)
         VALUES (?, ?, 'BUSINESS', 'ITEM_CATEGORY', ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE name = VALUES(name), parent_id = VALUES(parent_id),
           display_order = VALUES(display_order), is_active = TRUE, kind = 'ITEM_CATEGORY'`,
        [info.name, slug, parentId, order++]
      );
      const [r] = await conn.execute(`SELECT id FROM service_categories WHERE slug = ?`, [slug]);
      subIds.set(slug, r[0].id);
    }

    // ---- Items ----
    const seen = [];
    order = 1;
    for (const row of rows) {
      const categoryId = row.subSlug ? subIds.get(row.subSlug) : mainIds.get(row.mainSlug);
      await conn.execute(
        `INSERT INTO services
           (category_id, scope, kind, service_types, external_id, name, unit, standard_size,
            weight_kg, base_price, display_order, is_active)
         VALUES (?, 'BUSINESS', 'ITEM', ?, ?, ?, ?, ?, ?, 0.00, ?, ?)
         ON DUPLICATE KEY UPDATE
           category_id = VALUES(category_id), service_types = VALUES(service_types),
           name = VALUES(name), unit = VALUES(unit), standard_size = VALUES(standard_size),
           weight_kg = VALUES(weight_kg), display_order = VALUES(display_order),
           is_active = VALUES(is_active), kind = 'ITEM'`,
        [
          categoryId,
          row.serviceTypes,
          row.externalId,
          row.itemName,
          row.unit,
          row.standardSize,
          row.weightKg,
          order++,
          row.isActive,
        ]
      );
      seen.push(row.externalId);
    }

    // Service mapping lives in the existing item_service_types join table —
    // the cart and order services already read it, so it stays the single
    // source of truth rather than a second column.
    const [serviceRows] = await conn.execute(
      `SELECT id, code FROM services WHERE kind = 'SERVICE_TYPE' AND is_active = TRUE`
    );
    const serviceIdByCode = new Map(serviceRows.map((r) => [r.code, r.id]));

    for (const row of rows) {
      const [itemRow] = await conn.execute(`SELECT id FROM services WHERE external_id = ?`, [
        row.externalId,
      ]);
      if (!itemRow[0]) continue;
      const itemId = itemRow[0].id;
      const codes = row.serviceTypes.split(',');

      await conn.execute(`DELETE FROM item_service_types WHERE item_id = ?`, [itemId]);
      for (const code of codes) {
        const serviceId = serviceIdByCode.get(code);
        if (!serviceId) continue;
        await conn.execute(
          `INSERT INTO item_service_types (item_id, service_id) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE item_id = item_id`,
          [itemId, serviceId]
        );
      }
    }

    // ---- Retire anything no longer in the sheet ----
    // Rows referenced by a cart or a past order are kept (deactivated) so
    // historical orders stay readable; the rest are removed.
    const placeholders = seen.map(() => '?').join(',');
    const [stale] = await conn.execute(
      `SELECT s.id, s.name,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.service_id = s.id) AS order_refs,
              (SELECT COUNT(*) FROM cart_items ci WHERE ci.service_id = s.id) AS cart_refs
         FROM services s
        WHERE s.scope = 'BUSINESS' AND s.kind = 'ITEM'
          AND (s.external_id IS NULL OR s.external_id NOT IN (${placeholders}))`,
      seen
    );

    let deactivated = 0;
    let deleted = 0;
    for (const item of stale) {
      if (Number(item.order_refs) > 0 || Number(item.cart_refs) > 0) {
        await conn.execute(`UPDATE services SET is_active = FALSE WHERE id = ?`, [item.id]);
        deactivated++;
      } else {
        await conn.execute(`DELETE FROM services WHERE id = ?`, [item.id]);
        deleted++;
      }
    }

    // Retire legacy flat categories that no longer hold any item.
    const [emptyCats] = await conn.execute(
      `SELECT c.id, c.name FROM service_categories c
        WHERE c.scope = 'BUSINESS' AND c.kind = 'ITEM_CATEGORY'
          AND NOT EXISTS (SELECT 1 FROM services s WHERE s.category_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM service_categories k WHERE k.parent_id = c.id)`
    );
    for (const cat of emptyCats) {
      const [refs] = await conn.execute(
        `SELECT COUNT(*) AS n FROM order_items WHERE category_id = ?`,
        [cat.id]
      );
      if (Number(refs[0].n) > 0) {
        await conn.execute(`UPDATE service_categories SET is_active = FALSE WHERE id = ?`, [cat.id]);
      } else {
        await conn.execute(`DELETE FROM service_categories WHERE id = ?`, [cat.id]);
      }
    }

    await conn.commit();

    console.log(`\nApplied.`);
    console.log(`  main categories : ${mainIds.size}`);
    console.log(`  sub categories  : ${subIds.size}`);
    console.log(`  items upserted  : ${rows.length}`);
    console.log(`  stale deactivated (referenced): ${deactivated}`);
    console.log(`  stale deleted (unreferenced)  : ${deleted}`);
    console.log(`  empty legacy categories handled: ${emptyCats.length}`);
  } catch (error) {
    await conn.rollback();
    console.error('Import failed, rolled back:', error.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main();
