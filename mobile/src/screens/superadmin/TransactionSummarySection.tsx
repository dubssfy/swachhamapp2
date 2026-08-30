import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, useWindowDimensions,
  TouchableOpacity, Modal, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, {
  TransactionSummary, SummaryCell, SummaryMetric, SaleDetail, SalePeriod,
} from '../../services/superAdminApi';

/**
 * TRANSACTION SUMMARY — the home page's headline grid.
 *
 * Sixteen cards: four metrics (Sale, Collection, Product Count, Expense)
 * across four periods (Today, This Month, This Year, Total).
 *
 * READ IN ROWS, NOT COLUMNS. The reference lays each period out as a row of
 * four, and that is the useful reading: "today we billed X, collected Y,
 * processed Z pieces and spent W" is one sentence. Comparing today's sale to
 * this month's is the secondary question, and the period label down the left
 * still supports it.
 *
 * NOTHING IS CALCULATED HERE. Every amount and count is what the server
 * summed; the component formats and lays them out.
 *
 * RESPONSIVE BY MEASUREMENT, not by guesswork: four across on a wide screen,
 * two on a narrow one, from the real window width.
 */

interface Props {
  /** A refresh signal from the host screen — changing it refetches. */
  refreshKey?: number;
}

const PERIODS = [
  { key: 'today', label: 'TODAY' },
  { key: 'month', label: 'CURRENT MONTH' },
  { key: 'year', label: 'CURRENT YEAR' },
  { key: 'total', label: 'TOTAL' },
] as const;

type PeriodKey = (typeof PERIODS)[number]['key'];

/**
 * The four metrics, each with the colour and icon the reference uses.
 *
 * The colours are CATEGORICAL — they say which metric a card is, not how
 * large it is — so they are fixed per metric and never assigned by rank.
 */
const METRICS = [
  { key: 'sale', label: 'SALE', icon: 'bag-handle', tint: '#1FA463', wash: '#E6F5EC' },
  /*
   * THE SAME SALE, SPLIT BY WHO ORDERED IT. The two always add up to SALE
   * above, so they sit immediately after it rather than at the end of the row
   * where that relationship would not read.
   *
   * They share SALE's green: they are the same measure, and giving them
   * colours of their own would say they were three unrelated figures. The
   * icon is what tells them apart -- a person and a building.
   */
  { key: 'sale_customer', label: 'CUSTOMER SALE', icon: 'person', tint: '#1FA463', wash: '#E6F5EC' },
  { key: 'sale_business', label: 'BUSINESS SALE', icon: 'business', tint: '#1FA463', wash: '#E6F5EC' },
  { key: 'collection', label: 'COLLECTION', icon: 'card', tint: '#4F6BED', wash: '#EAEEFD' },
  { key: 'product_count', label: 'PRODUCT COUNT', icon: 'cube', tint: '#E8A33D', wash: '#FDF2E1' },
  { key: 'expense', label: 'EXPENSE', icon: 'cash', tint: '#E05252', wash: '#FCEAEA' },
] as const;

type MetricKey = (typeof METRICS)[number]['key'];

/** Rupees, grouped Indian-style, no decimals lost. */
function rupees(value: number): string {
  return `₹ ${(Number(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A plain count, to two places, as the reference shows it. */
function plain(value: number): string {
  return (Number(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * "₹ 2,608.00/4" — the amount and the count behind it.
 *
 * Product Count is the one metric whose primary figure is not money, so it
 * is printed as a plain number. Everything else carries the rupee sign.
 */
function cellText(metric: MetricKey, cell: SummaryCell): string {
  const primary = metric === 'product_count' ? plain(cell.amount) : rupees(cell.amount);
  return `${primary}/${cell.count}`;
}

export default function TransactionSummarySection({ refreshKey }: Props) {
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();

  /*
   * Four across when there is room for a card to stay readable, two
   * otherwise. The threshold is where a quarter-width card stops fitting
   * "₹ 2,608.00/4" without shrinking the type past legibility.
   */
  /*
   * Six metrics now rather than four, so the wide breakpoint carries three
   * across in two rows instead of four and a stray pair. The narrow case is
   * unchanged at two.
   */
  const columns = width >= 900 ? 3 : width >= 620 ? 3 : 2;

  const load = useCallback(async () => {
    setError('');
    try {
      setSummary(await superAdminApi.getTransactionSummary());
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load the transaction summary');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  /* ------------------------------------------------- the Sale drill-down */

  /** Which Sale card is open, or null. Nothing else on the grid opens. */
  const [detailPeriod, setDetailPeriod] = useState<SalePeriod | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const openSaleDetail = useCallback(async (period: SalePeriod) => {
    setDetailPeriod(period);
    // Cleared rather than kept: showing the previous period's rows under the
    // new heading while the fetch runs would state something untrue.
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      setDetail(await superAdminApi.getSaleDetail(period));
    } catch (e: any) {
      setDetailError(
        e?.response?.data?.message || e.message || 'Could not load those transactions'
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Transaction Summary</Text>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={COLORS.Primary} />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : summary ? (
        PERIODS.map((period) => (
          <View key={period.key} style={styles.periodBlock}>
            <Text style={styles.periodLabel}>{period.label}</Text>
            <View style={styles.grid}>
              {METRICS.map((metric) => (
                <MetricCard
                  key={metric.key}
                  columns={columns}
                  icon={metric.icon}
                  tint={metric.tint}
                  wash={metric.wash}
                  label={`${period.label} ${metric.label}`}
                  value={cellText(
                    metric.key,
                    (summary[metric.key] as SummaryMetric)[period.key as PeriodKey]
                  )}
                  /*
                   * ONLY TODAY SALE AND CURRENT MONTH SALE OPEN.
                   *
                   * The other fourteen cards get no `onPress` and so render
                   * exactly as before — a plain View, not a button. Collection,
                   * Product Count and Expense are summed from other registers
                   * entirely, and Sale's Year and Total have no drill-down
                   * asked for, so offering a tap that did nothing would be
                   * worse than not offering one.
                   */
                  /*
                   * ONLY THE TOTAL SALE CARD OPENS. The drill-down lists every
                   * order behind the figure, customer and business together,
                   * and each row already says which it is -- so opening it
                   * from a half would show rows that half does not contain.
                   */
                  onPress={
                    metric.key === 'sale'
                      && (period.key === 'today' || period.key === 'month')
                      ? () => openSaleDetail(period.key as SalePeriod)
                      : undefined
                  }
                />
              ))}
            </View>
          </View>
        ))
      ) : null}

      <SaleDetailModal
        period={detailPeriod}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={() => setDetailPeriod(null)}
      />
    </View>
  );
}

/**
 * The orders behind a Sale card.
 *
 * REUSES THE SECTION'S EXISTING SHEET. `sa.modalBackdrop` / `sa.modalSheet` are
 * the bottom sheet every other Super Admin picker already uses, so this reads
 * as the same surface rather than a new pattern — as does the table markup,
 * which is `sa.tableHeadRow` / `sa.tableRow` / `sa.th` / `sa.td` from the
 * price and report screens.
 *
 * IT DISPLAYS, IT DOES NOT COMPUTE. The rows, the total and the count are all
 * the server's, so this cannot show a total the card disagrees with.
 */
function SaleDetailModal({
  period, detail, loading, error, onClose,
}: {
  period: SalePeriod | null;
  detail: SaleDetail | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const title = period === 'today' ? "Today's Sales" : 'Current Month Sales';
  const rows = detail?.rows ?? [];

  return (
    <Modal
      visible={period !== null}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={sa.modalBackdrop}>
        <View style={[sa.modalSheet, { maxHeight: '85%' }]}>
          <View style={sa.header}>
            <Text style={[sa.headerTitle, { flex: 1 }]}>{title}</Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={COLORS.Primary} />
            </View>
          ) : error ? (
            <View style={[styles.errorBox, { margin: SPACING.md }]}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : rows.length === 0 ? (
            <Text style={sa.empty}>No transactions found.</Text>
          ) : (
            <ScrollView contentContainerStyle={{ padding: SPACING.md }}>
              <View style={sa.tableHeadRow}>
                <Text style={[sa.th, styles.nameCol]}>CUSTOMER / ESTABLISHMENT</Text>
                <Text style={[sa.th, styles.priceCol]}>ORDER PRICE</Text>
              </View>

              {rows.map((row) => (
                <View key={row.order_id} style={sa.tableRow}>
                  <View style={styles.nameCol}>
                    <Text style={sa.td} numberOfLines={2}>{row.name}</Text>
                    {/* The order number identifies the row when one
                        establishment has several on the same day. */}
                    <Text style={sa.tdMuted} numberOfLines={1}>{row.order_number}</Text>
                  </View>
                  <Text style={[sa.td, styles.priceCol, styles.priceText]}>
                    {rupees(row.amount)}
                  </Text>
                </View>
              ))}

              {/* The same pair the card shows, so the two can be compared at
                  a glance without adding the column up. */}
              <View style={[sa.tableRow, styles.totalRow]}>
                <Text style={[sa.td, styles.nameCol, styles.totalText]}>
                  {detail?.count} order{detail?.count === 1 ? '' : 's'}
                </Text>
                <Text style={[sa.td, styles.priceCol, styles.priceText, styles.totalText]}>
                  {rupees(detail?.total_amount ?? 0)}
                </Text>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function MetricCard({
  columns, icon, tint, wash, label, value, onPress,
}: {
  columns: number;
  icon: any;
  tint: string;
  wash: string;
  label: string;
  value: string;
  /** Given only to the two Sale cards that open a list. */
  onPress?: () => void;
}) {
  // A percentage width with the gap subtracted, so the row fills edge to
  // edge at any column count without a fixed pixel size to go stale.
  const width = `${100 / columns}%` as const;

  /*
   * A CARD WITHOUT `onPress` IS THE ORIGINAL VIEW, untouched — same element,
   * same styles, not a disabled button. Only a card that actually opens
   * something becomes pressable, and it says so with a chevron rather than by
   * changing colour, so the grid still reads as one set of cards.
   */
  const body = (
    <View style={styles.card}>
      <View style={[styles.iconBox, { backgroundColor: wash }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardLabel} numberOfLines={2}>{label}</Text>
        <Text style={styles.cardValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {value}
        </Text>
      </View>
      {!!onPress && (
        <Ionicons name="chevron-forward" size={14} color={COLORS.TextSecondary} />
      )}
    </View>
  );

  if (!onPress) {
    return <View style={[styles.cardOuter, { width }]}>{body}</View>;
  }

  return (
    <TouchableOpacity
      style={[styles.cardOuter, { width }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}. Tap to see the transactions.`}
    >
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: SPACING.md,
  },
  sectionTitle: {
    color: COLORS.TextPrimary,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontWeight: '700',
    fontSize: TYPOGRAPHY.sizes.base,
    marginBottom: SPACING.sm,
  },
  periodBlock: {
    marginBottom: SPACING.sm,
  },
  periodLabel: {
    color: COLORS.TextSecondary,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 10,
    letterSpacing: 0.8,
    fontWeight: '700',
    marginBottom: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Negative outer margin against the card padding below, so the row's
    // outer edges line up with the rest of the page.
    marginHorizontal: -4,
  },
  cardOuter: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Border,
    paddingVertical: 10,
    paddingHorizontal: 10,
    // A shadow light enough to lift the card off the page without
    // announcing itself, matching the reference.
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
  },
  cardLabel: {
    color: COLORS.TextSecondary,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 9,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  cardValue: {
    color: COLORS.TextPrimary,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontWeight: '700',
    fontSize: 14,
    marginTop: 1,
  },
  loading: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: '#FDECEC',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
  },
  errorText: {
    color: COLORS.Error,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    flex: 1,
  },
  nameCol: { flex: 1 },
  priceCol: { width: 110, textAlign: 'right' },
  priceText: { fontWeight: '700' },
  totalRow: { borderTopWidth: 1, borderTopColor: COLORS.Border },
  totalText: { fontWeight: '800', color: COLORS.TextPrimary },
});
