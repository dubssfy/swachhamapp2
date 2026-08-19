/**
 * Runs ONE migration file, rather than the whole folder like migrate.ts does.
 *
 *   node scripts/runMigration.js ../database/migrations/017_sorter_module.sql
 *
 * The migrations are written to be idempotent, so re-running is safe.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function sslOption() {
  const value = String(process.env.DATABASE_SSL || '').toLowerCase();
  if (!value || value === 'false' || value === 'disabled') return undefined;
  return { rejectUnauthorized: false };
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/runMigration.js <path-to.sql>');
    process.exit(1);
  }

  const file = path.resolve(process.cwd(), target);
  const sql = fs.readFileSync(file, 'utf8');

  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '3306', 10),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: sslOption(),
    multipleStatements: true,
  });

  await conn.query(sql);
  console.log(`Applied: ${path.basename(file)}`);
  await conn.end();
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
