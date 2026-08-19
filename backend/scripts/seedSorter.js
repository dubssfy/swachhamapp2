/**
 * Creates (or repairs) the Sorter staff account.
 *
 *   node scripts/seedSorter.js
 *   SORTER_USERNAME=soham SORTER_PASSWORD='...' node scripts/seedSorter.js
 *
 * Idempotent: running it twice does not create a second account. If the
 * account already exists it is left in place, with only its role and active
 * flag corrected — the stored password is NOT overwritten unless
 * --reset-password is passed.
 *
 * The password is hashed with bcrypt at the same cost the application uses,
 * and is never printed, logged or returned.
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

const SALT_ROUNDS = 10;

// Defaults match the credentials the module was specified with. Override them
// through the environment for any real deployment.
const USERNAME = (process.env.SORTER_USERNAME || 'soham').trim().toLowerCase();
const PASSWORD = process.env.SORTER_PASSWORD || 'Soham@1234';
const FULL_NAME = process.env.SORTER_NAME || 'Soham';
/** users.mobile_number is NOT NULL and unique; staff accounts get a placeholder. */
const MOBILE = process.env.SORTER_MOBILE || '9000000001';

const RESET_PASSWORD = process.argv.includes('--reset-password');

function sslOption() {
  const value = String(process.env.DATABASE_SSL || '').toLowerCase();
  if (!value || value === 'false' || value === 'disabled') return undefined;
  return { rejectUnauthorized: false };
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '3306', 10),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: sslOption(),
  });

  const [roleColumn] = await conn.execute(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
  );
  if (!String(roleColumn[0]?.COLUMN_TYPE || '').includes("'SORTER'")) {
    throw new Error(
      "users.role has no SORTER value — run migration 017_sorter_module.sql first"
    );
  }

  const [existing] = await conn.execute(
    `SELECT id, role, is_active FROM users WHERE email = ?`,
    [USERNAME]
  );

  if (existing[0]) {
    const account = existing[0];
    const fields = [];
    const values = [];

    if (account.role !== 'SORTER') {
      fields.push('role = ?');
      values.push('SORTER');
    }
    if (!account.is_active) {
      fields.push('is_active = ?');
      values.push(1);
    }
    if (RESET_PASSWORD) {
      fields.push('password_hash = ?');
      values.push(await bcrypt.hash(PASSWORD, SALT_ROUNDS));
    }

    if (fields.length) {
      await conn.execute(
        `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
        [...values, account.id]
      );
      console.log(`Sorter account already existed (id ${account.id}) — updated.`);
    } else {
      console.log(`Sorter account already exists (id ${account.id}) — nothing to do.`);
    }

    await conn.end();
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);
  const [inserted] = await conn.execute(
    `INSERT INTO users (name, email, mobile_number, password_hash, role, is_active, is_verified)
     VALUES (?, ?, ?, ?, 'SORTER', TRUE, TRUE)`,
    [FULL_NAME, USERNAME, MOBILE, passwordHash]
  );

  console.log(`Sorter account created: id ${inserted.insertId}, username "${USERNAME}", role SORTER.`);
  await conn.end();
}

main().catch((error) => {
  // The password is never part of an error path either.
  console.error('Seed failed:', error.message);
  process.exit(1);
});
