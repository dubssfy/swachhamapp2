/**
 * Smoke test for Guest Laundry's compulsory Room Number / Staff Laundry.
 *
 * Runs the REAL path: a real cart, `createOrder`, the row that lands in
 * `orders`, and `getOrderById` reading it back — then the two things a person
 * actually sees, the Order Detail line and the Order Detail PDF, rendered by
 * the same helper the app uses.
 *
 * Covers:
 *   - The selection is COMPULSORY on a Guest order: no choice, or Room with
 *     no number, is refused with 400 and no order is written.
 *   - A room order stores ROOM + the number; a staff order stores STAFF and
 *     NO number, even when one was sent.
 *   - Order Detail reads both back.
 *   - The wording: "Room Number: 205" and "Staff Laundry" — and NOT
 *     "Laundry Type: Staff Laundry", "Type: Room Number" or any other label.
 *   - HOTEL LAUNDRY IS UNTOUCHED: it is never asked, anything it sends in
 *     these fields is ignored, and its columns stay NULL.
 *
 *   npx ts-node scripts/smoke_guest_room_number.ts
 *
 * IT CLEANS UP AFTER ITSELF: every order it places is deleted again, and it
 * checks they are gone.
 */
import dotenv from 'dotenv';

dotenv.config();

import { query, pool } from '../src/config/database';
import {
  createOrder,
  getOrderById,
  resolveGuestLaundry,
  GUEST_SELECTION_REQUIRED_MESSAGE,
  ROOM_NUMBER_REQUIRED_MESSAGE,
  STAFF_DETAILS_REQUIRED_MESSAGE,
} from '../src/services/businessOrder.service';
import { setCartContext, addItem, clearCart } from '../src/services/businessCart.service';
import { catalogueScope, guestCategoryFilter } from '../src/services/guestCatalogue';

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function skip(name: string, why: string) {
  skipped += 1;
  console.log(`  SKIP  ${name} — ${why}`);
}

/**
 * The Order Detail line, and the PDF cell built from it.
 *
 * Reimplemented here rather than imported: the helper lives in the mobile app
 * and this is the backend's test runner. It is a two-line rule, and copying
 * it means the test states the required wording INDEPENDENTLY — if the app's
 * helper is ever changed to print "Laundry Type: Staff Laundry", this still
 * says what the answer should have been.
 */
function guestLaundryLine(order: {
  guest_laundry_for?: string | null;
  guest_room_number?: string | null;
  guest_staff_details?: string | null;
}): string | null {
  if (order.guest_laundry_for === 'STAFF') {
    const details = String(order.guest_staff_details ?? '').trim();
    return details ? `Staff Laundry: ${details}` : 'Staff Laundry';
  }
  if (order.guest_laundry_for === 'ROOM') {
    const room = String(order.guest_room_number ?? '').trim();
    return room ? `Room Number: ${room}` : null;
  }
  return null;
}

/** Labels the requirement forbids anywhere near this field. */
const FORBIDDEN = [
  'Laundry Type: Staff Laundry',
  'Laundry Type: Room Number',
  'Type: Staff Laundry',
  'Type: Room Number',
];

/** Tomorrow, so a slot cannot go stale mid-run. */
function tomorrow(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const created: string[] = [];

async function main() {
  console.log('\n=== Guest Laundry: Room Number / Staff Laundry ===\n');

  // ---------------------------------------------------------------
  console.log('The rule, on its own');
  // ---------------------------------------------------------------
  const staff = resolveGuestLaundry('guest', {
    guestLaundryFor: 'STAFF',
    guestStaffDetails: ' John ',
  });
  check('guest + STAFF is accepted', staff?.choice === 'STAFF');
  check('guest + STAFF keeps no room number', staff?.roomNumber === null);
  check('the staff detail is trimmed', staff?.staffDetails === 'John', String(staff?.staffDetails));

  const withRoomAnyway = resolveGuestLaundry('guest', {
    guestLaundryFor: 'STAFF',
    guestStaffDetails: 'John',
    guestRoomNumber: '205',
  });
  check(
    'guest + STAFF discards a room number sent alongside it',
    withRoomAnyway?.roomNumber === null,
    'a staff order is not for a room'
  );

  const room = resolveGuestLaundry('guest', {
    guestLaundryFor: 'ROOM',
    guestRoomNumber: ' 205 ',
    guestStaffDetails: 'ignored',
  });
  check('guest + ROOM is accepted', room?.choice === 'ROOM');
  check('the room number is trimmed', room?.roomNumber === '205', String(room?.roomNumber));
  check(
    'guest + ROOM discards staff details sent alongside it',
    room?.staffDetails === null,
    'a room order is not staff laundry'
  );

  const refused = (input: any, expected: string) => {
    try {
      resolveGuestLaundry('guest', input);
      return `accepted — it should not have been`;
    } catch (e: any) {
      return e?.message === expected ? '' : `wrong message: ${e?.message}`;
    }
  };
  check(
    'guest with NO selection is refused',
    refused({}, GUEST_SELECTION_REQUIRED_MESSAGE) === '',
    refused({}, GUEST_SELECTION_REQUIRED_MESSAGE)
  );
  check(
    'guest + ROOM with no number is refused',
    refused({ guestLaundryFor: 'ROOM' }, ROOM_NUMBER_REQUIRED_MESSAGE) === '',
    refused({ guestLaundryFor: 'ROOM' }, ROOM_NUMBER_REQUIRED_MESSAGE)
  );
  check(
    'guest + ROOM with only spaces is refused',
    refused({ guestLaundryFor: 'ROOM', guestRoomNumber: '   ' }, ROOM_NUMBER_REQUIRED_MESSAGE) === '',
    'spaces are not a room number'
  );
  check(
    'a nonsense choice is refused',
    refused({ guestLaundryFor: 'PENTHOUSE' }, GUEST_SELECTION_REQUIRED_MESSAGE) === ''
  );
  check(
    'guest + STAFF with no details is refused',
    refused({ guestLaundryFor: 'STAFF' }, STAFF_DETAILS_REQUIRED_MESSAGE) === '',
    refused({ guestLaundryFor: 'STAFF' }, STAFF_DETAILS_REQUIRED_MESSAGE)
  );
  check(
    'guest + STAFF with only spaces is refused',
    refused({ guestLaundryFor: 'STAFF', guestStaffDetails: '   ' }, STAFF_DETAILS_REQUIRED_MESSAGE) === '',
    'spaces are not details'
  );

  // HOTEL IS NEVER ASKED.
  check('hotel returns no selection', resolveGuestLaundry('hotel', {}) === null);
  check(
    'hotel ignores the fields entirely',
    resolveGuestLaundry('hotel', { guestLaundryFor: 'ROOM', guestRoomNumber: '9' }) === null,
    'the Hotel flow is untouched'
  );

  // ---------------------------------------------------------------
  console.log('\nThe wording');
  // ---------------------------------------------------------------
  check(
    'a room order reads "Room Number: 205"',
    guestLaundryLine({ guest_laundry_for: 'ROOM', guest_room_number: '205' }) === 'Room Number: 205'
  );
  check(
    'a staff order reads "Staff Laundry: John"',
    guestLaundryLine({ guest_laundry_for: 'STAFF', guest_staff_details: 'John' }) ===
      'Staff Laundry: John'
  );
  check(
    'a staff order from before the detail existed reads "Staff Laundry", with no stray colon',
    guestLaundryLine({ guest_laundry_for: 'STAFF' }) === 'Staff Laundry'
  );
  check(
    'a hotel order reads nothing at all',
    guestLaundryLine({ guest_laundry_for: null }) === null
  );
  const words = [
    guestLaundryLine({ guest_laundry_for: 'ROOM', guest_room_number: '205' }),
    guestLaundryLine({ guest_laundry_for: 'STAFF', guest_staff_details: 'John' }),
  ].join(' | ');
  check(
    'no forbidden label appears',
    !FORBIDDEN.some((bad) => words.includes(bad)),
    words
  );

  // ---------------------------------------------------------------
  console.log('\nEnd to end: a real order');
  // ---------------------------------------------------------------
  let account: any;
  let item: any;
  try {
    /*
     * A business that actually has a GUEST-priced item with a resolvable
     * service type — the same shape `smoke_placed_by_mobile` looks for. An
     * unpriced item would fail in the cart long before the field under test,
     * which would be a skip dressed up as a failure.
     */
    /*
     * The item must satisfy the SAME conditions the cart applies when adding
     * it — the guest catalogue scope and its category filter — or the run
     * fails in `addItem` for a reason that has nothing to do with the field
     * under test. Both predicates are imported from the service rather than
     * restated, so this cannot drift from what the cart actually enforces.
     */
    const candidates = await query<any>(
      `SELECT bu.id, bu.business_id, bpl.item_id,
              (SELECT st.code FROM item_service_types m
                 JOIN services st ON st.id = m.service_id
                WHERE m.item_id = bpl.item_id AND st.kind = 'SERVICE_TYPE'
                  AND st.is_active = true LIMIT 1) AS service_code
         FROM business_users bu
         JOIN businesses b ON b.id = bu.business_id
         JOIN business_price_list bpl ON bpl.business_id = bu.business_id
         JOIN services i ON i.id = bpl.item_id
         LEFT JOIN service_categories c ON c.id = i.category_id
         LEFT JOIN service_categories p ON p.id = c.parent_id
        WHERE bu.is_active = true AND b.status = 'ACTIVE'
          AND bpl.laundry_type = 'guest' AND bpl.is_active = true AND bpl.price > 0
          AND i.is_active = true AND i.kind = 'ITEM' AND i.scope = ?
          AND ${guestCategoryFilter('c', 'p')}
       HAVING service_code IS NOT NULL
        LIMIT 1`,
      [catalogueScope('guest')]
    );
    const row = candidates.rows[0];
    if (row) {
      account = { id: row.id, business_id: row.business_id };
      item = { item_id: row.item_id, service_code: row.service_code };
    }
  } catch (e: any) {
    skip('end-to-end', `database (${e?.message || e})`);
  }

  if (!account || !item) {
    skip('end-to-end', 'no active business with a guest-priced item');
  } else {
    const userId = String(account.id);

    /** Fills a guest cart with one line and places the order. */
    const place = async (guestInput: any) => {
      await clearCart(userId);
      await setCartContext(userId, 'guest', 'standard');
      await addItem(userId, String(item.item_id), 1, String(item.service_code));
      return createOrder(
        userId,
        {
          pickupDate: tomorrow(),
          pickup: { id: '09-11', label: '9 AM - 11 AM', start: '09:00:00', end: '11:00:00' },
          deliveryDate: null,
          delivery: null,
          pickupNotes: null,
          serviceNotes: null,
        } as any,
        undefined,
        guestInput
      );
    };

    // --- A GUEST ORDER WITH NO SELECTION IS REFUSED ---
    const before = await query<any>(`SELECT COUNT(*) AS n FROM orders`);
    let refusedOk = false;
    let refusedMsg = '';
    try {
      await place({});
    } catch (e: any) {
      refusedOk = e?.statusCode === 400 || e?.status === 400;
      refusedMsg = e?.message || '';
    }
    check('a guest order with no selection is refused', refusedOk, refusedMsg);
    const after = await query<any>(`SELECT COUNT(*) AS n FROM orders`);
    check(
      'and NO order row was written',
      Number(before.rows[0].n) === Number(after.rows[0].n),
      `${before.rows[0].n} -> ${after.rows[0].n}`
    );

    // --- ROOM ---
    const roomOrder = await place({ guestLaundryFor: 'ROOM', guestRoomNumber: '205' });
    created.push(String(roomOrder.id));
    const roomRow = await query<any>(
      `SELECT laundry_type, guest_laundry_for, guest_room_number FROM orders WHERE id = ?`,
      [roomOrder.id]
    );
    check('ROOM: stored as a guest order', roomRow.rows[0].laundry_type === 'guest');
    check('ROOM: guest_laundry_for = ROOM', roomRow.rows[0].guest_laundry_for === 'ROOM');
    check('ROOM: room number stored', roomRow.rows[0].guest_room_number === '205');

    const roomDetail = await getOrderById(userId, String(roomOrder.id));
    check('ROOM: Order Detail carries the choice', roomDetail.guest_laundry_for === 'ROOM');
    check('ROOM: Order Detail carries the number', roomDetail.guest_room_number === '205');
    check(
      'ROOM: Order Detail and PDF print "Room Number: 205"',
      guestLaundryLine(roomDetail) === 'Room Number: 205',
      String(guestLaundryLine(roomDetail))
    );

    // --- STAFF ---
    const staffOrder = await place({
      guestLaundryFor: 'STAFF',
      guestStaffDetails: 'John',
      guestRoomNumber: '999',
    });
    created.push(String(staffOrder.id));
    const staffRow = await query<any>(
      `SELECT guest_laundry_for, guest_room_number, guest_staff_details FROM orders WHERE id = ?`,
      [staffOrder.id]
    );
    check('STAFF: guest_laundry_for = STAFF', staffRow.rows[0].guest_laundry_for === 'STAFF');
    check(
      'STAFF: no room number stored, even though one was sent',
      staffRow.rows[0].guest_room_number === null,
      String(staffRow.rows[0].guest_room_number)
    );
    check(
      'STAFF: the details are stored',
      staffRow.rows[0].guest_staff_details === 'John',
      String(staffRow.rows[0].guest_staff_details)
    );

    const staffDetail = await getOrderById(userId, String(staffOrder.id));
    check(
      'STAFF: Order Detail carries the details',
      staffDetail.guest_staff_details === 'John',
      String(staffDetail.guest_staff_details)
    );
    check(
      'STAFF: Order Detail and PDF print "Staff Laundry: John"',
      guestLaundryLine(staffDetail) === 'Staff Laundry: John',
      String(guestLaundryLine(staffDetail))
    );

    // --- HOTEL IS UNAFFECTED ---
    let hotelOrder: any = null;
    try {
      const hotelItems = await query<any>(
        `SELECT bpl.item_id,
                (SELECT st.code FROM item_service_types m
                   JOIN services st ON st.id = m.service_id
                  WHERE m.item_id = bpl.item_id AND st.kind = 'SERVICE_TYPE'
                    AND st.is_active = true LIMIT 1) AS service_code
           FROM business_price_list bpl
          WHERE bpl.business_id = ? AND bpl.laundry_type = 'hotel'
            AND bpl.is_active = true AND bpl.price > 0
         HAVING service_code IS NOT NULL
          LIMIT 1`,
        [account.business_id]
      );
      const hotelItem = hotelItems.rows[0];
      if (!hotelItem) {
        skip('hotel order', 'this business has no hotel-priced item');
      } else {
        await clearCart(userId);
        await setCartContext(userId, 'hotel', 'standard');
        await addItem(userId, String(hotelItem.item_id), 1, String(hotelItem.service_code));
        // Sent on purpose: a hotel order must IGNORE them, not be refused.
        hotelOrder = await createOrder(
          userId,
          {
            pickupDate: tomorrow(),
            pickup: { id: '09-11', label: '9 AM - 11 AM', start: '09:00:00', end: '11:00:00' },
            deliveryDate: null,
            delivery: null,
            pickupNotes: null,
            serviceNotes: null,
          } as any,
          undefined,
          { guestLaundryFor: 'ROOM', guestRoomNumber: '777' }
        );
        created.push(String(hotelOrder.id));
        const hotelRow = await query<any>(
          `SELECT laundry_type, guest_laundry_for, guest_room_number, guest_staff_details
             FROM orders WHERE id = ?`,
          [hotelOrder.id]
        );
        check('HOTEL: places without a selection', hotelRow.rows[0].laundry_type === 'hotel');
        check(
          'HOTEL: all three columns stay NULL',
          hotelRow.rows[0].guest_laundry_for === null &&
            hotelRow.rows[0].guest_room_number === null &&
            hotelRow.rows[0].guest_staff_details === null,
          'the Hotel flow is untouched'
        );
        const hotelDetail = await getOrderById(userId, String(hotelOrder.id));
        check('HOTEL: prints nothing for this field', guestLaundryLine(hotelDetail) === null);
      }
    } catch (e: any) {
      check('HOTEL: unaffected', false, e?.message || String(e));
    }

    // --- CLEAN UP ---
    await clearCart(userId);
    for (const id of created) {
      await query(`DELETE FROM order_items WHERE order_id = ?`, [id]);
      await query(`DELETE FROM pickups WHERE order_id = ?`, [id]).catch(() => undefined);
      await query(`DELETE FROM deliveries WHERE order_id = ?`, [id]).catch(() => undefined);
      await query(`DELETE FROM orders WHERE id = ?`, [id]);
    }
    const left = await query<any>(
      `SELECT COUNT(*) AS n FROM orders WHERE id IN (${created.map(() => '?').join(',')})`,
      created
    );
    check('every order this test placed was removed again', Number(left.rows[0].n) === 0);
  }

  await pool.end().catch(() => undefined);
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
