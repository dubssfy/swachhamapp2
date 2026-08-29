import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator,
  RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
/* THE CUSTOMER PALETTE, imported under the name `COLORS`.
 *
 * #3d6173 and #ffbd4a. Aliased rather than renamed at every use so this
 * screen reads the same as the rest of the app, and so the green `COLORS`
 * -- which the business, sorter, rider and super-admin screens all import --
 * is left exactly as it is. See `CUSTOMER_COLORS` in constants/theme. */
import { CUSTOMER_COLORS as COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import customerCartApi, { CustomerCart, CustomerCartItem } from '../../services/customerCartApi';

/**
 * The customer's cart.
 *
 * THE PRICES AND TOTALS ARE THE SERVER'S. Every figure on this screen —
 * each line's price, its total, the subtotal, delivery and grand total —
 * comes from `GET /api/cart`, which reads the live customer price list. The
 * screen never multiplies or adds anything, so what is shown here is what
 * the order will be created at.
 *
 * THIS SCREEN USED TO BE A STUB: `const cartItems = []` with a comment
 * saying "in a real app, use useCartStore()". It always rendered the empty
 * state, so a customer could never see what they had added.
 *
 * NO BUSINESS NAME. A customer books their own laundry; which establishment
 * their account is attached to is an internal detail and is deliberately not
 * shown anywhere here.
 */
export default function CartScreen({ navigation }: any) {
  const [cart, setCart] = useState<CustomerCart | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setCart(await customerCartApi.getCart());
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load your cart');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  /**
   * Quantity changes go to the SERVER and the whole cart comes back.
   *
   * The totals are recomputed there, so the screen never has to keep its own
   * arithmetic in step — and two devices on one account cannot disagree.
   */
  const changeQuantity = async (line: CustomerCartItem, next: number) => {
    if (busyLine) return;
    setBusyLine(line.id);
    setError('');
    try {
      setCart(next <= 0
        ? await customerCartApi.removeItem(line.id)
        : await customerCartApi.updateItem(line.id, next));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not update that item');
    } finally {
      setBusyLine(null);
    }
  };

  const confirmClear = () => {
    Alert.alert('Empty your cart?', 'Everything in it will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Empty cart',
        style: 'destructive',
        onPress: async () => {
          try { await customerCartApi.clearCart(); load(); }
          catch (e: any) { setError(e?.response?.data?.message || e.message); }
        },
      },
    ]);
  };

  const items = cart?.items ?? [];
  const hasItems = items.length > 0;
  /*
   * A line whose price has gone missing since it was added blocks checkout:
   * the server would refuse the order anyway, and saying so here is kinder
   * than failing at the last step.
   */
  const unpriced = items.filter((i) => i.price === null || i.price === undefined);

  const header = (
    <>
      <View style={styles.topLogoWrap}>
        <Image
          source={require('../../../assets/swachham-header-logo.png')}
          style={styles.topLogo}
          resizeMode="contain"
          accessibilityLabel="Swachham"
        />
      </View>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.Surface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Cart</Text>
        {hasItems ? (
          <TouchableOpacity onPress={confirmClear} accessibilityLabel="Empty cart">
            <MaterialIcons name="delete-outline" size={22} color={COLORS.Surface} />
          </TouchableOpacity>
        ) : null}
      </View>
    </>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={'#3D6F73'} />
        </View>
      </SafeAreaView>
    );
  }

  if (!hasItems) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <MaterialIcons name="add-shopping-cart" size={48} color={COLORS.Surface} />
          </View>
          <Text style={styles.emptyTitle}>Add items to your cart</Text>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity
            style={styles.browseButton}
            onPress={() => navigation.navigate('Home')}
          >
            <Text style={styles.browseButtonText}>Browse More</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {header}

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {!!error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {items.map((line) => (
          <View key={line.id} style={styles.itemCard}>
            <View style={styles.itemIcon}>
              <Ionicons name="shirt-outline" size={22} color={COLORS.Primary} />
            </View>

            <View style={styles.itemBody}>
              <Text style={styles.itemName} numberOfLines={2}>{line.service_name}</Text>
              {/* PRICE PER PIECE x QUANTITY = TOTAL, spelled out, so the
                  arithmetic is visible rather than implied. */}
              {line.price === null || line.price === undefined ? (
                <Text style={styles.noPrice}>Price not set — remove to continue</Text>
              ) : (
                <Text style={styles.itemMath}>
                  ₹{Number(line.price).toFixed(2)} × {line.quantity} ={' '}
                  <Text style={styles.itemTotal}>₹{Number(line.item_total).toFixed(2)}</Text>
                </Text>
              )}
              <Text style={styles.itemUnit}>per {line.unit || 'piece'}</Text>
            </View>

            <View style={styles.qtyBox}>
              <TouchableOpacity
                style={styles.qtyBtn}
                disabled={busyLine === line.id}
                onPress={() => changeQuantity(line, line.quantity - 1)}
                accessibilityLabel={`Reduce ${line.service_name}`}
              >
                <MaterialIcons
                  name={line.quantity <= 1 ? 'delete-outline' : 'remove'}
                  size={16}
                  color="#5A3A08"
                />
              </TouchableOpacity>

              {busyLine === line.id ? (
                <ActivityIndicator size="small" color={COLORS.Primary} style={styles.qtyText} />
              ) : (
                <Text style={styles.qtyText}>{line.quantity}</Text>
              )}

              <TouchableOpacity
                style={[styles.qtyBtn, styles.qtyBtnAdd]}
                disabled={busyLine === line.id}
                onPress={() => changeQuantity(line, line.quantity + 1)}
                accessibilityLabel={`Add another ${line.service_name}`}
              >
                <MaterialIcons name="add" size={16} color={COLORS.Surface} />
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* ---- TOTALS, as the server computed them ---- */}
        <View style={styles.summary}>
          <Row label="Subtotal" value={cart!.subtotal} />
          <Row
            label="Delivery"
            value={cart!.delivery_charge}
            /*
             * DELIVERY IS BY DISTANCE NOW: free within 10 km of the
             * collecting branch, then Rs 7 per km (or part) beyond.
             *
             * "Free" is only said when the server actually MEASURED and the
             * answer was zero. With no address to measure from the charge is
             * 0 but unknown, and calling that free would be a promise the
             * order then contradicts -- so it says where the figure comes
             * from instead.
             */
            hint={
              !cart!.delivery_charge_resolved
                ? 'At checkout'
                : cart!.delivery_charge === 0
                  ? 'Free'
                  : undefined
            }
          />
          <View style={styles.summaryDivider} />
          <Row label="Total" value={cart!.total} strong />
        </View>

        {unpriced.length > 0 && (
          <View style={styles.warnBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#8A5200" />
            <Text style={styles.warnText}>
              {unpriced.length} item{unpriced.length === 1 ? '' : 's'} no longer{' '}
              {unpriced.length === 1 ? 'has' : 'have'} a price. Remove{' '}
              {unpriced.length === 1 ? 'it' : 'them'} to place your order.
            </Text>
          </View>
        )}

        <View style={{ height: 90 }} />
      </ScrollView>

      {/* The action bar stays put while the list scrolls. */}
      <View style={styles.bar}>
        <View style={styles.flex}>
          <Text style={styles.barLabel}>Total</Text>
          <Text style={styles.barValue}>₹{Number(cart!.total).toFixed(2)}</Text>
        </View>
        <TouchableOpacity
          style={[styles.checkoutBtn, unpriced.length > 0 && styles.checkoutBtnDisabled]}
          disabled={unpriced.length > 0}
          /* 'CheckoutScreen', which is what the route is REGISTERED as.
             This read 'Checkout' -- a route that does not exist, so the
             button did nothing when tapped. */
          onPress={() => navigation.navigate('CheckoutScreen')}
          accessibilityLabel="Proceed to checkout"
        >
          <Text style={styles.checkoutText}>Checkout</Text>
          <MaterialIcons name="arrow-forward" size={18} color={COLORS.Surface} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Row({
  label, value, strong, hint,
}: {
  label: string;
  value: number;
  strong?: boolean;
  hint?: string;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, strong && styles.summaryLabelStrong]}>{label}</Text>
      <Text style={[styles.summaryValue, strong && styles.summaryValueStrong]}>
        {hint || `₹${Number(value).toFixed(2)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background ?? '#F4F7F5' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  topLogoWrap: {
    width: '100%', alignItems: 'center', justifyContent: 'center',
    paddingTop: SPACING.xs, backgroundColor: 'transparent',
  },
  topLogo: { width: '100%', height: 70 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.lg,
    backgroundColor: '#3D6F73',
  },
  backButton: { marginRight: 0 },
  headerTitle: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.Surface,
  },
  list: { padding: SPACING.md },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  iconContainer: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.PrimaryLight,
    justifyContent: 'center', alignItems: 'center', marginBottom: SPACING.xl,
  },
  emptyTitle: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold', color: COLORS.PrimaryDark, marginBottom: SPACING.xl,
  },
  browseButton: {
    backgroundColor: COLORS.PrimaryLight, paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl * 2, borderRadius: BORDER_RADIUS.md,
    width: '80%', alignItems: 'center',
  },
  browseButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600', color: COLORS.Surface,
  },
  itemCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: '#D5E5E6', borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5, borderColor: '#6F9EA0',
    padding: SPACING.sm, marginBottom: SPACING.sm,
    shadowColor: '#3D6F73',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 3,
  },
  itemIcon: {
    width: 42, height: 42, borderRadius: BORDER_RADIUS.md,
    backgroundColor: '#EAF4F4', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#8FB3B5',
  },
  itemBody: { flex: 1 },
  itemName: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800', color: '#294F52',
  },
  itemMath: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: '#52787A', marginTop: 2,
  },
  itemTotal: { color: '#3D6F73', fontWeight: '800' },
  itemUnit: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10,
    color: '#688B8D', marginTop: 1,
  },
  noPrice: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.Warning, marginTop: 2, fontWeight: '600',
  },
  qtyBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#E8B95A',
    backgroundColor: '#FFD98A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnAdd: {
    backgroundColor: '#FFD98A',
    borderColor: '#E8B95A',
  },
  qtyText: {
    minWidth: 22, textAlign: 'center',
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700', color: COLORS.TextPrimary,
  },
  summary: {
    backgroundColor: COLORS.Surface, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: COLORS.Border,
    padding: SPACING.md, marginTop: SPACING.xs,
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4,
  },
  summaryLabel: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  summaryLabelStrong: { color: COLORS.TextPrimary, fontWeight: '700' },
  summaryValue: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary, fontWeight: '600',
  },
  summaryValueStrong: { fontSize: TYPOGRAPHY.sizes.lg, fontWeight: '700' },
  summaryDivider: {
    height: 1, backgroundColor: COLORS.Border, marginVertical: SPACING.xs,
  },
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: COLORS.Surface, borderTopWidth: 1, borderTopColor: COLORS.Border,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, paddingBottom: SPACING.md,
  },
  barLabel: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, color: COLORS.TextSecondary,
  },
  barValue: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700', color: COLORS.TextPrimary,
  },
  checkoutBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#3D6F73', paddingHorizontal: SPACING.lg,
    paddingVertical: 12, borderRadius: BORDER_RADIUS.md,
  },
  checkoutBtnDisabled: { opacity: 0.45 },
  checkoutText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700', color: COLORS.Surface,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: '#FDECEC', borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm, marginBottom: SPACING.sm,
  },
  errorText: {
    flex: 1, fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs, color: COLORS.Error,
  },
  warnBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: '#FFF4E5', borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm, marginTop: SPACING.sm,
  },
  warnText: {
    flex: 1, fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs, color: '#8A5200',
  },
});
