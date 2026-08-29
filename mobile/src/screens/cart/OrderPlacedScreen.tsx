import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  CUSTOMER_COLORS as C, SPACING, TYPOGRAPHY, BORDER_RADIUS,
} from '../../constants/theme';
import { CUSTOMER_PAYMENT_METHODS } from '../../services/customerCartApi';

/**
 * THE END OF THE BOOKING FLOW.
 *
 * Checkout `replace()`s onto this screen, so Back cannot return to a checkout
 * for an order that has already been placed.
 *
 * IT STATES THE ORDER NUMBER, and that number is the thing the customer will
 * quote when they ring: SWC#DDMMYYYY###### -- the same shape as a business
 * order, with C where a business number carries H or G.
 *
 * NOTHING IS FETCHED HERE. Every figure comes from the order the server just
 * returned, so this page cannot show a total that differs from the one that
 * was actually created.
 */
export default function OrderPlacedScreen({ route, navigation }: any) {
  const {
    orderNumber = '',
    total = 0,
    paymentMethod = '',
    pickupLabel = '',
    deliveryLabel = '',
    orderId = '',
  } = route.params ?? {};

  const payment =
    CUSTOMER_PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label ?? paymentMethod;

  /** Home is a TAB, so it is reached through the navigator's parent. */
  const goHome = () => navigation.getParent()?.navigate('Home') ?? navigation.navigate('Home');
  const goOrders = () => navigation.getParent()?.navigate('Orders') ?? navigation.navigate('Orders');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.tick}>
          <Ionicons name="checkmark" size={40} color={C.OnAccent} />
        </View>

        <Text style={styles.title}>Order booked</Text>
        <Text style={styles.subtitle}>
          We have your laundry down. You will get a message when a rider is on the way.
        </Text>

        {/* The number, given the weight it deserves — it is what the customer
            will be asked for. */}
        <View style={styles.numberCard}>
          <Text style={styles.numberLabel}>YOUR ORDER NUMBER</Text>
          <Text style={styles.number} accessibilityLabel={`Order number ${orderNumber}`}>
            {orderNumber}
          </Text>
        </View>

        <View style={styles.card}>
          <Row icon="time-outline" label="Pickup" value={pickupLabel || '—'} />
          <View style={styles.divider} />
          {/* Only shown when one was booked: an order may be placed with the
              pickup alone and the delivery arranged afterwards, and an
              em-dash here would look like a missing value rather than a
              choice. */}
          {!!deliveryLabel && (
            <>
              <Row icon="cube-outline" label="Delivery" value={deliveryLabel} />
              <View style={styles.divider} />
            </>
          )}
          <Row icon="card-outline" label="Payment" value={payment || '—'} />
          <View style={styles.divider} />
          <Row icon="cash-outline" label="Total" value={`₹${Number(total).toFixed(2)}`} strong />
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={goOrders}
          accessibilityRole="button"
          accessibilityLabel="Track this order"
        >
          <Text style={styles.primaryText}>Track my order</Text>
          <Ionicons name="arrow-forward" size={18} color={C.OnAccent} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={goHome}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Back to home</Text>
        </TouchableOpacity>

        {!!orderId && <Text style={styles.reference}>Reference {orderId}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  icon, label, value, strong,
}: {
  icon: any;
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={C.Primary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.Background },
  scroll: { padding: SPACING.lg, alignItems: 'center' },

  tick: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: C.Accent,
    alignItems: 'center', justifyContent: 'center', marginTop: SPACING.xl,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: '700', color: C.PrimaryDark, marginTop: SPACING.md,
  },
  subtitle: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: C.TextSecondary, textAlign: 'center', marginTop: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },

  numberCard: {
    alignSelf: 'stretch', alignItems: 'center', backgroundColor: C.AccentSoft,
    borderRadius: BORDER_RADIUS.lg, borderWidth: 1, borderColor: C.Accent,
    paddingVertical: SPACING.md, marginTop: SPACING.lg,
  },
  numberLabel: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, fontWeight: '700',
    color: C.Warning, letterSpacing: 1,
  },
  number: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: '700', color: C.PrimaryDark, marginTop: 2, letterSpacing: 0.5,
  },

  card: {
    alignSelf: 'stretch', backgroundColor: C.Surface,
    borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: C.Border,
    paddingHorizontal: SPACING.md, marginTop: SPACING.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  rowLabel: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: C.TextSecondary, width: 74,
  },
  rowValue: {
    flex: 1, textAlign: 'right', fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm, color: C.TextPrimary,
  },
  rowValueStrong: { fontWeight: '700', color: C.PrimaryDark },
  divider: { height: 1, backgroundColor: C.Border },

  primaryBtn: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: SPACING.xs, backgroundColor: C.Accent,
    borderRadius: BORDER_RADIUS.full, paddingVertical: 14, marginTop: SPACING.lg,
  },
  primaryText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700', color: C.OnAccent,
  },
  secondaryBtn: { paddingVertical: SPACING.md },
  secondaryText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600', color: C.Primary,
  },
  reference: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, color: C.TextSecondary,
  },
});
