import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import sorterApi, { SorterOrderSummary, SorterQueue, SorterStage } from '../../services/sorterApi';
import { extractErrorMessage } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { formatWeightKg, formatDateTime } from '../../utils/businessOrderPdf';

/** How each stage is labelled and coloured across the Sorter module. */
export const STAGE_META: Record<SorterStage, { label: string; color: string }> = {
  confirmed: { label: 'CONFIRMED', color: COLORS.Info },
  accepted: { label: 'ACCEPTED', color: COLORS.Warning },
  ready: { label: 'READY', color: COLORS.Success },
  out_for_delivery: { label: 'OUT FOR DELIVERY', color: COLORS.Primary },
};

const FILTERS: Array<{ key: SorterStage | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'confirmed', label: 'New' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'ready', label: 'Ready' },
];

/**
 * Sorter dashboard — the shop-floor queue.
 *
 * Built for operational use: big order numbers, an obvious status pill, and a
 * single action per card. Data comes from the Sorter API, which is limited to
 * the three workflow states, so a cancelled or delivered order can never
 * appear here.
 */
export default function SorterDashboardScreen({ navigation }: any) {
  const { user, logout } = useAuthStore();
  const [queue, setQueue] = useState<SorterQueue | null>(null);
  const [filter, setFilter] = useState<SorterStage | 'all'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const response = await sorterApi.getOrders();
      setQueue(response.data);
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to load orders'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Reloading on focus is what brings a just-accepted order back with its new
  // status when the Sorter returns from the details screen.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    load();
    return unsubscribe;
  }, [navigation, load]);

  const orders = useMemo(() => {
    const all = queue?.orders || [];
    return filter === 'all' ? all : all.filter((order) => order.stage === filter);
  }, [queue, filter]);

  const counts = queue?.counts || { confirmed: 0, accepted: 0, ready: 0, active: 0 };

  const handleLogout = () => {
    Alert.alert('Log out', 'Log out of the Sorter dashboard?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  const summaryCards = (
    <View>
      <View style={styles.cardRow}>
        <SummaryCard label="New" value={counts.confirmed} color={STAGE_META.confirmed.color} />
        <SummaryCard label="Accepted" value={counts.accepted} color={STAGE_META.accepted.color} />
      </View>
      <View style={styles.cardRow}>
        <SummaryCard label="Ready" value={counts.ready} color={STAGE_META.ready.color} />
        <SummaryCard label="Total Active" value={counts.active} color={COLORS.Primary} />
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((option) => {
          const active = filter === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(option.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );

  const renderOrder = ({ item }: { item: SorterOrderSummary }) => {
    const meta = item.stage ? STAGE_META[item.stage] : null;
    const { date, time } = formatDateTime(item.created_at);

    return (
      <View style={styles.orderCard}>
        <View style={styles.orderTop}>
          <Text style={styles.orderNumber}>#{item.order_number}</Text>
          {meta ? (
            <View style={[styles.statusPill, { backgroundColor: meta.color }]}>
              <Text style={styles.statusText}>{meta.label}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.customer}>{item.customer_name}</Text>
        <Text style={styles.meta}>
          {date} {time}
        </Text>
        <Text style={styles.meta}>
          {item.item_count} item{item.item_count === 1 ? '' : 's'} · {item.total_quantity} pcs ·{' '}
          {formatWeightKg(item.total_weight_kg)}
        </Text>

        <TouchableOpacity
          style={styles.viewButton}
          onPress={() => navigation.navigate('SorterOrderDetailsScreen', { orderId: item.id })}
          activeOpacity={0.85}
        >
          <Ionicons name="open-outline" size={18} color={COLORS.Surface} />
          <Text style={styles.viewButtonText}>VIEW ORDER</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Image
          source={require('../../../assets/swachham-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerTitle}>Sorter Dashboard</Text>
          <Text style={styles.headerUser} numberOfLines={1}>
            {user?.name || user?.email || 'Sorter'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          accessibilityLabel="Log out"
        >
          <Ionicons name="log-out-outline" size={22} color={COLORS.Error} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          ListHeaderComponent={summaryCards}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => {
                setIsRefreshing(true);
                load();
              }}
              colors={[COLORS.Primary]}
              tintColor={COLORS.Primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyBlock}>
              <Ionicons name="checkmark-done-outline" size={44} color={COLORS.TextSecondary} />
              <Text style={styles.emptyText}>No orders in this queue</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.summaryCard, { borderLeftColor: color }]}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.Border,
  },
  logo: { width: 38, height: 38, borderRadius: BORDER_RADIUS.sm },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
  },
  headerUser: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  logoutButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.Background,
  },

  listContent: { padding: SPACING.md, paddingBottom: SPACING.xxl },

  cardRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm },
  summaryCard: {
    flex: 1,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderLeftWidth: 5,
    padding: SPACING.md,
    ...SHADOWS.light,
  },
  summaryValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  summaryLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },

  filterRow: { flexDirection: 'row', gap: SPACING.xs, marginTop: SPACING.sm, marginBottom: SPACING.md },
  filterChip: {
    flex: 1,
    height: 42,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.Border,
    backgroundColor: COLORS.Surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: { backgroundColor: COLORS.Primary, borderColor: COLORS.PrimaryDark },
  filterText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  filterTextActive: { color: COLORS.Surface, fontWeight: '800' },

  orderCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.Border,
    ...SHADOWS.light,
  },
  orderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  orderNumber: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },
  statusPill: {
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 5,
  },
  statusText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },
  customer: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  meta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },

  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    height: 50,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
    marginTop: SPACING.md,
  },
  viewButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },

  emptyBlock: { alignItems: 'center', paddingVertical: SPACING.xxl, gap: SPACING.sm },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
  },
  errorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
});
