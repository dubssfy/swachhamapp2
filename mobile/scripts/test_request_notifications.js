/**
 * Tests for new-request detection on the Super Admin dashboard.
 *
 * The rules this proves are the ones that are easy to get wrong and invisible
 * until they misfire in front of an admin:
 *
 *   - the first ever load announces NOTHING, however large the backlog
 *   - a request pops up ONCE and never again
 *   - the four... three sections are completely independent: a Business
 *     request raises no Rider or Sorter badge or popup
 *   - opening a section clears ITS badge and no other
 *   - dismissing a popup does NOT clear the badge (it was not read)
 *
 * `expo-secure-store` is stubbed with an in-memory map, so this runs in plain
 * Node and each case starts from a known store.
 *
 *   node scripts/test_request_notifications.js
 *
 * (Compiled first by the npm script; see the header of the run command.)
 */
const path = require('path');
const Module = require('module');

/* ---- stub expo-secure-store before the module under test loads ---- */
const store = new Map();
const stub = {
  getItemAsync: async (k) => (store.has(k) ? store.get(k) : null),
  setItemAsync: async (k, v) => { store.set(k, v); },
  deleteItemAsync: async (k) => { store.delete(k); },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'expo-secure-store') return 'expo-secure-store-stub';
  return originalResolve.call(this, request, ...rest);
};
require.cache['expo-secure-store-stub'] = {
  id: 'expo-secure-store-stub',
  filename: 'expo-secure-store-stub',
  loaded: true,
  exports: stub,
};

const OUT = process.argv[2] || path.join(__dirname, '..', '.tmp-rn', 'services', 'requestNotifications.js');
const rn = require(OUT);

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

/** A pending request row, shaped as the API returns one. */
let nextId = 100;
function req(type, name) {
  return {
    id: String(++nextId),
    request_type: type,
    status: 'PENDING',
    subject_name: name || `${type} applicant`,
  };
}

function badgeStr(b) {
  return `B${b.BUSINESS}/R${b.RIDER}/S${b.SORTER}`;
}

async function main() {
  /* ============================================================
   * 1. THE FIRST LOAD IS SILENT
   * ============================================================ */
  console.log('\n1. FIRST LOAD DOES NOT ANNOUNCE THE BACKLOG');
  store.clear();

  const backlog = [req('BUSINESS'), req('BUSINESS'), req('RIDER'), req('SORTER')];
  let result = await rn.detectNewRequests(backlog);
  check('no popup for requests that already existed', result.alerts.length === 0,
    `${result.alerts.length} alert(s)`);
  check('and no badge either', badgeStr(result.badges) === 'B0/R0/S0',
    badgeStr(result.badges));

  // A second load with the same data must also stay silent.
  result = await rn.detectNewRequests(backlog);
  check('a refresh with nothing new stays silent',
    result.alerts.length === 0 && badgeStr(result.badges) === 'B0/R0/S0',
    `${result.alerts.length} alert(s), ${badgeStr(result.badges)}`);

  /* ============================================================
   * 2. A NEW BUSINESS REQUEST, AND ONLY BUSINESS
   * ============================================================ */
  console.log('\n2. A NEW BUSINESS REQUEST');

  const newBusiness = req('BUSINESS', 'ABC Hotel');
  const withBusiness = [...backlog, newBusiness];
  result = await rn.detectNewRequests(withBusiness);

  check('exactly one alert is raised', result.alerts.length === 1,
    result.alerts.map((a) => a.type).join(', '));
  check('and it is the BUSINESS one', result.alerts[0]?.type === 'BUSINESS',
    result.alerts[0]?.type);
  check('it is labelled for that section', result.alerts[0]?.label === 'Business Request',
    result.alerts[0]?.label);
  check('it names the request it came from',
    result.alerts[0]?.latest?.subject_name === 'ABC Hotel',
    result.alerts[0]?.latest?.subject_name);
  check('ONLY the Business badge moves', badgeStr(result.badges) === 'B1/R0/S0',
    badgeStr(result.badges));

  /* ============================================================
   * 3. THE SAME REQUEST DOES NOT POP UP TWICE
   * ============================================================ */
  console.log('\n3. NO REPEAT POPUP');

  result = await rn.detectNewRequests(withBusiness);
  check('a refresh raises no second popup', result.alerts.length === 0,
    `${result.alerts.length} alert(s)`);
  check('but the badge stays, because it has not been read',
    badgeStr(result.badges) === 'B1/R0/S0', badgeStr(result.badges));

  /* ============================================================
   * 4. THE OTHER SECTIONS ARE UNAFFECTED
   * ============================================================ */
  console.log('\n4. SECTIONS ARE INDEPENDENT');

  const newRider = req('RIDER', 'Rahul Patil');
  const withRider = [...withBusiness, newRider];
  result = await rn.detectNewRequests(withRider);

  check('the new Rider request raises exactly one alert', result.alerts.length === 1,
    result.alerts.map((a) => a.type).join(', '));
  check('and it is the RIDER one', result.alerts[0]?.type === 'RIDER',
    result.alerts[0]?.type);
  check('the Business badge is untouched by a Rider request',
    result.badges.BUSINESS === 1, String(result.badges.BUSINESS));
  check('the Rider badge is now 1', result.badges.RIDER === 1,
    String(result.badges.RIDER));
  check('Sorter is still silent', result.badges.SORTER === 0,
    String(result.badges.SORTER));

  /* ============================================================
   * 5. DISMISSING IS NOT READING
   * ============================================================ */
  console.log('\n5. DISMISS vs OPEN');

  // Dismissal is host-side state only — it calls nothing here — so the badge
  // must survive another detection pass untouched.
  result = await rn.detectNewRequests(withRider);
  check('after a dismissal the badges still stand',
    badgeStr(result.badges) === 'B1/R1/S0', badgeStr(result.badges));

  /* ============================================================
   * 6. OPENING A SECTION CLEARS ONLY THAT ONE
   * ============================================================ */
  console.log('\n6. OPENING A SECTION');

  await rn.markSectionSeen('BUSINESS', withRider);
  result = await rn.detectNewRequests(withRider);
  check('opening Business clears the Business badge',
    result.badges.BUSINESS === 0, String(result.badges.BUSINESS));
  check('and leaves the Rider badge alone',
    result.badges.RIDER === 1, String(result.badges.RIDER));
  check('no popup is raised by opening a section',
    result.alerts.length === 0, `${result.alerts.length} alert(s)`);

  await rn.markSectionSeen('RIDER', withRider);
  result = await rn.detectNewRequests(withRider);
  check('opening Rider clears the last badge',
    badgeStr(result.badges) === 'B0/R0/S0', badgeStr(result.badges));

  /* ============================================================
   * 7. A SORTER REQUEST REACHES ONLY SORTER
   * ============================================================ */
  console.log('\n7. SORTER IN ISOLATION');

  const withSorter = [...withRider, req('SORTER', 'Priya S')];
  result = await rn.detectNewRequests(withSorter);
  check('one alert, and it is SORTER',
    result.alerts.length === 1 && result.alerts[0]?.type === 'SORTER',
    result.alerts.map((a) => a.type).join(', '));
  check('Business and Rider stay at zero',
    result.badges.BUSINESS === 0 && result.badges.RIDER === 0,
    badgeStr(result.badges));

  /* ============================================================
   * 8. SEVERAL AT ONCE
   * ============================================================ */
  console.log('\n8. TWO NEW OF ONE TYPE');

  const two = [...withSorter, req('BUSINESS', 'XYZ Restaurant'), req('BUSINESS', 'Blue Cafe')];
  result = await rn.detectNewRequests(two);
  const businessAlert = result.alerts.find((a) => a.type === 'BUSINESS');
  check('they collapse into ONE card for that section',
    result.alerts.filter((a) => a.type === 'BUSINESS').length === 1);
  check('which carries the count', businessAlert?.count === 2,
    String(businessAlert?.count));
  check('and the badge agrees', result.badges.BUSINESS === 2,
    String(result.badges.BUSINESS));

  /* ============================================================
   * 9. ONLY THE THREE REAL TYPES ARE HANDLED
   * ============================================================ */
  console.log('\n9. THE TYPES THAT EXIST');

  check('there are exactly three request types',
    rn.REQUEST_TYPES.length === 3, rn.REQUEST_TYPES.join(', '));
  // A MANAGER row cannot come out of `creation_requests`, but if one ever did
  // it must not crash the dashboard or invent a fourth badge.
  const withBogus = [...two, { id: '9999', request_type: 'MANAGER', status: 'PENDING', subject_name: 'X' }];
  result = await rn.detectNewRequests(withBogus);
  check('an unknown type raises no alert and no badge',
    !result.alerts.some((a) => a.type === 'MANAGER')
      && Object.keys(result.badges).length === 3,
    Object.keys(result.badges).join(', '));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
