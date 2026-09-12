import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../constants/theme';

/**
 * WHERE THE ORDER IS COLLECTED FROM, shown the same way everywhere.
 *
 * One component for the customer's tracker, the Manager's request queue and
 * the hotel's order screen — the same argument `PickupScheduleCard` makes for
 * the assigned collection, and the same reason: the requirement is that every
 * side sees the same address, and three renderings of the same fields is
 * exactly how they would come to disagree.
 *
 * IT READS ONE FIELD. The server resolves the two possible sources — a saved
 * `customer_addresses` row, or an address typed at checkout and stored on the
 * order — into a single `pickup_address` object (`manualAddress.pickupAddressOf`),
 * so nothing here has to know which kind it is looking at.
 *
 * IT RENDERS NOTHING WHEN THERE IS NO ADDRESS. A business order is collected
 * from the establishment and carries none; an old customer order may have
 * lost its saved address to a deletion (`orders.address_id` is
 * `ON DELETE SET NULL`). Null is returned straight through rather than drawn
 * as an empty card, because absence is the honest display of "not recorded".
 *
 * THE "ENTERED MANUALLY" MARK IS NOT DECORATION. A Manager deciding whether a
 * rider can reach a place by a given time, and a rider who cannot fall back on
 * "it is where they always are", both benefit from knowing this address was
 * typed for this one order and has never been visited.
 */

/** The `pickup_address` object every order payload now carries. */
export interface PickupAddress {
  is_manual?: boolean;
  label?: string | null;
  text?: string | null;
  city?: string | null;
  pincode?: string | null;
  landmark?: string | null;
  contact_name?: string | null;
  contact_mobile?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface Props {
  address: PickupAddress | null | undefined;
  /** Heading above the address. A screen already under its own heading can
      pass a quieter one rather than repeating itself. */
  title?: string;
  /**
   * `card` (default) stands on its own with a border, for a screen that
   * stacks cards. `plain` drops the border and padding for a screen that is
   * already inside one.
   */
  variant?: 'card' | 'plain';
}

export default function PickupAddressCard({
  address,
  title = 'Pickup Address',
  variant = 'card',
}: Props) {
  const text = address?.text ? String(address.text).trim() : '';
  if (!text) return null;

  const contact = [address?.contact_name, address?.contact_mobile]
    .filter((part) => Boolean(part && String(part).trim()))
    .join(' · ');

  return (
    <View
      style={[styles.container, variant === 'card' ? styles.card : styles.plain]}
      accessible
      /* Read as one thing, so a screen reader announces the whole address
         instead of a heading and a fragment. */
      accessibilityLabel={
        `${title}. ${text}.` +
        (contact ? ` Contact ${contact}.` : '') +
        (address?.is_manual ? ' Entered manually for this order.' : '')
      }
    >
      <View style={styles.titleRow}>
        <Ionicons name="location-outline" size={18} color={COLORS.Primary} />
        <Text style={styles.title}>{title}</Text>
        {address?.label ? <Text style={styles.tag}>{address.label}</Text> : null}
        {address?.is_manual ? (
          <Text style={[styles.tag, styles.manualTag]}>Entered manually</Text>
        ) : null}
      </View>

      <Text style={styles.value}>{text}</Text>

      {/* Only when the order names somebody other than the account holder.
          A blank row here would read as a missing contact rather than as
          "ask for whoever placed the order", which is what it means. */}
      {!!contact && (
        <View style={styles.row}>
          <Ionicons name="person-outline" size={14} color={COLORS.TextSecondary} />
          <Text style={styles.meta} numberOfLines={1}>{contact}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: SPACING.xs },
  card: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Border,
    padding: SPACING.md,
  },
  plain: { paddingVertical: SPACING.sm },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    flexWrap: 'wrap',
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.Primary,
  },
  tag: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.TextSecondary,
    /* `COLORS` (the Swachham green palette this card is drawn in) has no
       surface-alt token, so the tint is stated here rather than borrowing
       one from the customer palette, which only the customer screens use. */
    backgroundColor: '#EEF2F0',
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  /* Marked in the accent rather than the neutral tag colour: it is the one
     thing on this card a reader might need to act on. */
  manualTag: { color: COLORS.Primary },
  value: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
    lineHeight: 19,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  meta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    flexShrink: 1,
  },
});
