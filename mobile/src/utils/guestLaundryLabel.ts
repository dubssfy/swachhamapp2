/**
 * How a Guest Laundry order says who it is for.
 *
 * ONE FUNCTION, so the Order Detail screen and the Order Detail PDF cannot
 * word the same order differently — and so the wording rule below is stated
 * once rather than re-derived at each site.
 *
 * THERE IS NO "LAUNDRY TYPE" LABEL HERE, DELIBERATELY. A room order reads
 * `Room Number: 205` and a staff order reads `Staff Laundry: John` — no
 * `Type:` prefix, no `Laundry Type: Staff Laundry`. The order's Hotel/Guest
 * laundry type is a separate field that the documents already print under its
 * own heading; this is not that, and labelling it as though it were is what
 * this function exists to prevent.
 *
 * GUEST LAUNDRY ONLY. Returns null for a Hotel order, for an order placed
 * before the field existed, and for a room order whose number never made it
 * to the row — the callers render nothing at all in that case rather than
 * printing an empty label.
 */
export interface GuestLaundryFields {
  guest_laundry_for?: 'ROOM' | 'STAFF' | null;
  guest_room_number?: string | null;
  guest_staff_details?: string | null;
}

export function guestLaundryLine(order: GuestLaundryFields | null | undefined): string | null {
  if (!order) return null;

  if (order.guest_laundry_for === 'STAFF') {
    const details = String(order.guest_staff_details ?? '').trim();
    /*
     * The detail is compulsory now, so a staff order placed today always has
     * one. An order placed BEFORE the field existed has none, and prints
     * "Staff Laundry" on its own rather than a stray trailing colon.
     */
    return details ? `Staff Laundry: ${details}` : 'Staff Laundry';
  }

  if (order.guest_laundry_for === 'ROOM') {
    const room = String(order.guest_room_number ?? '').trim();
    return room ? `Room Number: ${room}` : null;
  }

  return null;
}
