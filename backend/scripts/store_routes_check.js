/**
 * Checks the store endpoints WITHOUT a database.
 *
 * The two things most likely to be wrong in this feature are the
 * authorisation boundary and the input validation, and neither needs real
 * rows to exercise — so `config/database` is replaced with a stub before the
 * routers are loaded, and the assertions are about status codes and messages.
 *
 * This is NOT a test of the SQL. Nothing here proves a query runs against
 * MySQL; that needs a real database and is listed as untested in the report.
 *
 *   node scripts/store_routes_check.js
 */

const path = require('path');
const express = require('express');
const request = require('supertest');

const DIST = path.join(__dirname, '..', 'dist');

/* ---- Stub the database before anything imports it ---------------- */

const dbPath = require.resolve(path.join(DIST, 'config', 'database.js'));
const calls = [];
let nextRows = [];

const stub = {
  query: async (sql, params) => {
    calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
    const rows = typeof nextRows === 'function' ? nextRows(sql, params) : nextRows;
    return { rows: rows || [], rowCount: (rows || []).length, insertId: '999' };
  },
  pool: {},
  getClient: async () => ({}),
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stub };

/* ---- Build an app with the real routers ------------------------- */

const superAdminRoutes = require(path.join(DIST, 'routes', 'superAdmin.routes.js')).default;
const storesRoutes = require(path.join(DIST, 'routes', 'stores.routes.js')).default;
const { generateAccessToken } = require(path.join(DIST, 'utils', 'jwt.js'));

const app = express();
app.use(express.json());
app.use('/api/stores', storesRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use((err, _req, res, _next) => {
  res.status(err.statusCode || 500).json({ success: false, message: err.message });
});

const tokenFor = (role) =>
  generateAccessToken({ id: '1', email: `${role.toLowerCase()}@test.local`, role });

/* ---- Assertions -------------------------------------------------- */

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${actual}, expected ${expected})`}`);
  ok ? passed++ : failed++;
}

async function main() {
  console.log('\nAUTHORISATION — store management must be Super Admin only\n');

  const adminPaths = [
    ['get', '/api/super-admin/stores'],
    ['post', '/api/super-admin/stores'],
    ['put', '/api/super-admin/stores/1'],
    ['patch', '/api/super-admin/stores/1/status'],
    ['delete', '/api/super-admin/stores/1'],
  ];

  for (const [method, url] of adminPaths) {
    nextRows = [];
    const anon = await request(app)[method](url).send({});
    check(`${method.toUpperCase()} ${url} without a token -> 401`, anon.status, 401);
  }

  for (const role of ['CUSTOMER', 'BUSINESS', 'SORTER', 'RIDER', 'MANAGER']) {
    nextRows = [];
    const res = await request(app)
      .post('/api/super-admin/stores')
      .set('Authorization', `Bearer ${tokenFor(role)}`)
      .send({ name: 'Hacker Store' });
    check(`POST as ${role} -> 403`, res.status, 403);
  }

  console.log('\nPUBLIC LOCATOR — readable without a token\n');

  nextRows = [{ id: '1', name: 'Swachham Dapoli', latitude: '17.759', longitude: '73.189' }];
  const publicList = await request(app).get('/api/stores');
  check('GET /api/stores without a token -> 200', publicList.status, 200);
  check('returns the row', publicList.body?.data?.[0]?.name, 'Swachham Dapoli');

  const sql = calls[calls.length - 1].sql;
  check('public query filters is_active', /is_active = true/.test(sql), true);
  check('public query filters deleted_at', /deleted_at IS NULL/.test(sql), true);

  console.log('\nVALIDATION — rejected before anything is written\n');

  const admin = `Bearer ${tokenFor('SUPER_ADMIN')}`;
  const base = {
    name: 'New Store', address: 'Somewhere', city: 'Dapoli',
    latitude: 17.75, longitude: 73.18, contact_number: '9876543210',
  };

  const cases = [
    ['missing name', { ...base, name: '' }, 400],
    ['missing address', { ...base, address: '' }, 400],
    ['missing city', { ...base, city: '' }, 400],
    ['missing contact number', { ...base, contact_number: '' }, 400],
    ['latitude out of range', { ...base, latitude: 999 }, 400],
    ['longitude not a number', { ...base, longitude: 'abc' }, 400],
    ['bad email', { ...base, email: 'not-an-email' }, 400],
    ['bad pincode', { ...base, pincode: '12' }, 400],
    ['bad opening time', { ...base, opening_time: '25:00' }, 400],
    ['bad phone number', { ...base, contact_number: 'abc' }, 400],
  ];

  for (const [label, body, expected] of cases) {
    nextRows = [];
    const res = await request(app).post('/api/super-admin/stores').set('Authorization', admin).send(body);
    check(`${label} -> ${expected}`, res.status, expected);
  }

  console.log('\nDUPLICATES\n');

  nextRows = [{ id: '7', deleted_at: null }];
  const dup = await request(app).post('/api/super-admin/stores').set('Authorization', admin).send(base);
  check('duplicate name -> 409', dup.status, 409);

  nextRows = [{ id: '7', deleted_at: '2026-01-01 00:00:00' }];
  const dupDeleted = await request(app).post('/api/super-admin/stores').set('Authorization', admin).send(base);
  check('name taken by a soft-deleted store -> 409', dupDeleted.status, 409);

  console.log('\nSTATUS TOGGLE\n');

  nextRows = [];
  const noFlag = await request(app)
    .patch('/api/super-admin/stores/1/status').set('Authorization', admin).send({});
  check('status without is_active -> 400', noFlag.status, 400);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
