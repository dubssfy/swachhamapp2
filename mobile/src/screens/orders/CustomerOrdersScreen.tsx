import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Image, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { customerOrderApi } from '../../services/customerCartApi';
import { customerStatusLabel } from '../../constants/orderStatus';

/**
 * Customer Orders tab.
 *
 * IT NOW FETCHES. This screen was a hardcoded placeholder that rendered "You
 * have no orders yet." unconditionally and called no API at all — which is
 * why a freshly placed order never appeared and why "Track my order", which
 * lands here, looked broken. The orders were being saved correctly the whole
 * time; nothing was ever asking for them.
 *
 * `GET /api/orders` is scoped to the signed-in user by the server, so this is
 * the logged-in customer's own list and there is no id to pass.
 *
 * RE-FETCHED ON FOCUS, not once on mount. Checkout `replace()`s onto the
 * confirmation screen and the customer reaches this tab afterwards, so a
 * mount-only load would show a list assembled before the order existed.
 * `useFocusEffect` is also what makes the order survive a refresh: the list is
 * server state, re-read every time the tab is opened.
 */

/*
 * THE SAME VOCABULARY THE TRACKING SCREEN USES.
 *
 * Both screens read `customerStatusLabel`, so a status can never be spelled
 * one way in the list and another on the tracking page. The labels this file
 * used to carry were invented (ACCEPTED, IN_PROCESS, READY) and matched
 * nothing in the `orders.status` ENUM, so a real OUT_FOR_DELIVERY order fell
 * through to the raw code.
 */
const STATUS_TONE: Record<string, string> = {
  CANCELLED: COLORS.Error,
  COMPLETED: COLORS.Primary,
  DELIVERED: COLORS.Primary,
};

/** `2026-08-30T01:22:16.000Z` -> `30 Aug 2026`. */
function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export default function CustomerOrdersScreen({ navigation }: any) {
  const [orders, setOrders] = useState<any[]>([]);
  // Starts true so the first paint is a spinner rather than "no orders yet",
  // which would be a false statement while the list is still loading.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const result = await customerOrderApi.listOrders();
      setOrders(result.orders ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Your orders could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openOrder = (order: any) =>
    navigation.navigate('CustomerOrderTracking', {
      orderId: String(order.id),
      orderNumber: order.order_number,
    });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topLogoWrap}>
        <Image
          source={require('../../../assets/swachham-header-logo.png')}
          style={styles.topLogo}
          resizeMode="contain"
          accessibilityLabel="Swachham"
        />
      </View>
      <Text style={styles.title}>My Orders</Text>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(order) => String(order.id)}
          contentContainerStyle={orders.length === 0 ? styles.grow : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons
                name={error ? 'alert-circle-outline' : 'list-outline'}
                size={48}
                color={error ? COLORS.Error : COLORS.TextSecondary}
              />
              <Text style={[styles.emptyText, !!error && { color: COLORS.Error }]}>
                {error || 'You have no orders yet.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => openOrder(item)}
              accessibilityRole="button"
              accessibilityLabel={`Order ${item.order_number}, ${customerStatusLabel(item.status)}. Tap to track.`}
            >
              <View style={styles.cardHead}>
                <Text style={styles.orderNumber} numberOfLines={1}>{item.order_number}</Text>
                <Text
                  style={[styles.status, { color: STATUS_TONE[item.status] ?? COLORS.TextSecondary }]}
                >
                  {customerStatusLabel(item.status)}
                </Text>
              </View>
              <View style={styles.cardFoot}>
                <Text style={styles.meta}>
                  {shortDate(item.created_at)}
                  {item.item_count ? `  ·  ${item.item_count} item(s)` : ''}
                </Text>
                <Text style={styles.total}>₹{Number(item.total ?? 0).toFixed(2)}</Text>
              </View>
              <View style={styles.trackRow}>
                <Text style={styles.trackText}>Track this order</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.Primary} />
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  topLogoWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SPACING.xs,
    backgroundColor: 'transparent',
  },
  topLogo: {
    width: '100%',
    height: 70,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  grow: { flexGrow: 1 },
  list: { padding: SPACING.md, gap: SPACING.sm },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    paddingHorizontal: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Border,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  orderNumber: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  status: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
  },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  meta: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  total: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  trackRow: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    marginTop: SPACING.xs,
  },
  trackText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.Primary,
  },
});
