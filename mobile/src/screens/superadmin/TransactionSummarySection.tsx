import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import superAdminApi, {
  TransactionSummary, SummaryCell, SummaryMetric,
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
  const columns = width >= 900 ? 4 : width >= 620 ? 3 : 2;

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
                />
              ))}
            </View>
          </View>
        ))
      ) : null}
    </View>
  );
}

function MetricCard({
  columns, icon, tint, wash, label, value,
}: {
  columns: number;
  icon: any;
  tint: string;
  wash: string;
  label: string;
  value: string;
}) {
  // A percentage width with the gap subtracted, so the row fills edge to
  // edge at any column count without a fixed pixel size to go stale.
  const width = `${100 / columns}%` as const;
  return (
    <View style={[styles.cardOuter, { width }]}>
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
      </View>
    </View>
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
});
