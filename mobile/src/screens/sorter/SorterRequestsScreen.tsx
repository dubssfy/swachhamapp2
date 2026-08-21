import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import sorterApi, { SorterOrderSummary, SorterStage } from '../../services/sorterApi';
import { extractErrorMessage } from '../../services/api';
import { formatWeightKg, formatDateTime } from '../../utils/businessOrderPdf';
import { formatLongDate, previousDayKey, todayKey } from '../../utils/sorterDates';
import SorterCalendar from '../../components/sorter/SorterCalendar';
import { STAGE_META } from './sorterStageMeta';

/**
 * The Sorter requests page.
 *
 * One screen serves both entry points on the Sorter home, told apart by the
 * `mode` route param:
 *
 *   today    — the current business day, resolved and filtered on the server
 *   previous — a past day the sorter picks from the calendar
 *
 * Both read the existing /api/sorter/orders endpoint and its existing date
 * filter, so there is no second source of request data.
 */

export type SorterRequestsMode = 'today' | 'previous';

const FILTERS: Array<{ key: SorterStage | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'confirmed', label: 'New' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'ready', label: 'Ready' },
];

export default function SorterRequestsScreen({ route, navigation }: any) {
  const mode: SorterRequestsMode = route?.params?.mode === 'previous' ? 'previous' : 'today';
  const isToday = mode === 'today';

  const [orders, setOrders] = useState<SorterOrderSummary[]>([]);
  const [filter, setFilter] = useState<SorterStage | 'all'>('all');
  const [isLoading, setIsLoading] = useState(isToday);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  /**
   * The day currently on screen, YYYY-MM-DD.
   *
   * In today mode it starts from this device's clock — never a hardcoded date —
   * and is replaced by the `business_date` the server reports, which is derived
   * from the configured business timezone. That is what keeps an order placed
   * just after midnight IST from being filed under the previous UTC day.
   */
  const [shownDate, setShownDate] = useState<string | null>(isToday ? todayKey() : null);
  /** The past day the sorter picked. Only used in previous mode. */
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Previous Requests opens straight onto the calendar: picking a day is the
  // first thing the sorter has to do here.
  const [isCalendarOpen, setIsCalendarOpen] = useState(!isToday);

  /** Previous Requests stops at yesterday; today has its own page. */
  const maxSelectableDate = useMemo(() => previousDayKey(todayKey()), []);

  /**
   * One fetch for both modes.
   *
   * `scope=today` lets the server decide which day today is; a past day goes
   * as `date=YYYY-MM-DD`. Either way the filtering happens in SQL, so the
   * screen never pulls the whole history down to sift it here.
   */
  const load = useCallback(
    async (dateKey?: string | null, silent = false) => {
      if (!isToday && !dateKey) return;
      try {
        setError('');
        // A silent load keeps the current list on screen — used by
        // pull-to-refresh and by the reload that runs on returning here.
        if (!silent) setIsLoading(true);
        const response = await sorterApi.getOrders(
          undefined,
          isToday ? { today: true } : { date: dateKey as string }
        );
        // An empty array is a normal answer, not a failure.
        setOrders(response.data?.orders || []);
        setShownDate(response.data?.business_date || dateKey || todayKey());
      } catch (err: any) {
        setOrders([]);
        if (!isToday && dateKey) setShownDate(dateKey);
        setError(extractErrorMessage(err, 'Failed to load requests'));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [isToday]
  );

  /** The day a reload should ask for: null in today mode, the picked day otherwise. */
  const activeDate = isToday ? null : selectedDate;

  useEffect(() => {
    // Coming back from the order details screen refreshes in place, so a
    // just-accepted order returns with its new status and the list never
    // flashes an empty state. Keyed off an actual blur, so the fetch below
    // is not immediately repeated when the screen first opens.
    const leftScreen = { current: false };
    const offBlur = navigation.addListener('blur', () => {
      leftScreen.current = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!leftScreen.current) return;
      leftScreen.current = false;
      if (isToday || selectedDate) load(selectedDate, true);
    });

    // Today loads straight away; a past day only loads once one is picked.
    if (isToday || selectedDate) load(selectedDate);

    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation, load, isToday, selectedDate]);

  /** Choosing a day is all it takes — the effect above fetches it. */
  const onPickDate = (dateKey: string) => {
    setIsCalendarOpen(false);
    setSelectedDate(dateKey);
  };

  const retry = () => load(activeDate);

  /** The stage chips narrow whatever day is on screen. */
  const visibleOrders = useMemo(
    () => (filter === 'all' ? orders : orders.filter((order) => order.stage === filter)),
    [orders, filter]
  );

  /** True once there is a day to show results for. */
  const hasDate = isToday || Boolean(selectedDate);

  const listHeader = (
    <View>
      {isToday ? (
        <View style={styles.dateBlock}>
          <Text style={styles.dateEyebrow}>Today</Text>
          <Text style={styles.dateValue}>{shownDate ? formatLongDate(shownDate) : ''}</Text>
        </View>
      ) : (
        <View style={styles.dateBlock}>
          <Text style={styles.dateEyebrow}>Select Date</Text>
          <TouchableOpacity
            style={styles.datePickerButton}
            onPress={() => setIsCalendarOpen(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Choose a date"
          >
            <Ionicons name="calendar-outline" size={22} color={COLORS.Primary} />
            <Text style={styles.datePickerText} numberOfLines={1}>
              {selectedDate ? formatLongDate(selectedDate) : 'Select Date'}
            </Text>
            <Ionicons name="chevron-down" size={20} color={COLORS.TextSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {hasDate && !isLoading ? (
        <>
          <View style={styles.filterRow}>
            {FILTERS.map((option) => {
              const active = filter === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setFilter(option.key)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>
            {shownDate
              ? `REQUESTS FOR ${formatLongDate(shownDate).toUpperCase()}`
              : 'REQUESTS'}
            {visibleOrders.length ? `  (${visibleOrders.length})` : ''}
          </Text>
        </>
      ) : null}

      {error ? (
        <View style={styles.errorBlock}>
          <Ionicons name="cloud-offline-outline" size={22} color={COLORS.Error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={retry} activeOpacity={0.85}>
            <Ionicons name="refresh" size={18} color={COLORS.Surface} />
            <Text style={styles.retryText}>RETRY</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  /** The queue card, unchanged from the design the dashboard used before. */
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

        {item.defect_count > 0 ? (
          <View style={styles.defectBadge}>
            <Ionicons name="warning" size={16} color={COLORS.Error} />
            <Text style={styles.defectBadgeText}>
              Defect Reported
              {item.defect_count > 1 ? ` (${item.defect_count})` : ''}
              {item.latest_defect_whatsapp_status === 'SENT'
                ? ' · WhatsApp sent'
                : item.latest_defect_whatsapp_status === 'FAILED'
                ? ' · WhatsApp failed'
                : ''}
            </Text>
          </View>
        ) : null}

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

  const emptyState = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyBlock}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
          <Text style={styles.emptyText}>Loading requests...</Text>
        </View>
      );
    }
    if (error) return null;
    if (!hasDate) {
      return (
        <View style={styles.emptyBlock}>
          <Ionicons name="calendar-outline" size={44} color={COLORS.TextSecondary} />
          <Text style={styles.emptyText}>Select a date to see its requests</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyBlock}>
        <Ionicons name="document-outline" size={44} color={COLORS.TextSecondary} />
        <Text style={styles.emptyText}>No requests found for this date.</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.PrimaryDark} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerTitle}>Requests</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {isToday ? "Today's Requests" : 'Previous Requests'}
          </Text>
        </View>
        {!isToday ? (
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => setIsCalendarOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open calendar"
          >
            <Ionicons name="calendar" size={22} color={COLORS.Primary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        data={isLoading ? [] : visibleOrders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyState}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              if (!hasDate) return;
              setIsRefreshing(true);
              load(activeDate, true);
            }}
            colors={[COLORS.Primary]}
            tintColor={COLORS.Primary}
          />
        }
      />

      {/* Past days only: today has its own page, so the calendar stops at yesterday. */}
      {!isToday ? (
        <SorterCalendar
          visible={isCalendarOpen}
          value={selectedDate}
          maxDate={maxSelectableDate}
          title="Select Date"
          onSelect={onPickDate}
          onClose={() => setIsCalendarOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },

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
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.Background,
  },
  headerAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.Background,
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
  },
  headerSubtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },

  listContent: { padding: SPACING.md, paddingBottom: SPACING.xxl },

  // ---- The day on screen ----
  dateBlock: { marginBottom: SPACING.md },
  dateEyebrow: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.TextSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: SPACING.xs,
  },
  dateValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },
  // Tall and full width: the main control on Previous Requests.
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: 56,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Surface,
    borderWidth: 1,
    borderColor: COLORS.Border,
    ...SHADOWS.light,
  },
  datePickerText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },

  filterRow: { flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.md },
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

  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },

  // ---- Request card ----
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
  defectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    alignSelf: 'flex-start',
    marginTop: SPACING.xs,
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: '#FDECEC',
  },
  defectBadgeText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.Error,
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

  // ---- States ----
  emptyBlock: { alignItems: 'center', paddingVertical: SPACING.xxl, gap: SPACING.sm },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
    textAlign: 'center',
  },
  errorBlock: {
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: '#FDECEC',
  },
  errorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    minHeight: 44,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
  },
  retryText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },
});
