import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { KgPivotReport, ReportableBusiness } from '../../services/superAdminApi';
import ReportPdfActions from './ReportPdfActions';
import KgReportFilters, { ALL } from './KgReportFilters';

/**
 * THE THREE KG GRIDS, drawn by one screen.
 *
 *   hotel-monthly   hotels down the side, months across   (order weight)
 *   item-monthly    items down the side, months across    (line weight)
 *   hotel-item      hotels down the side, items across    (line weight)
 *
 * All three arrive in the SAME shape — `columns`, `rows`, `cells`,
 * `column_totals`, `grand_total_kg` — so there is one table here rather than
 * three that would drift apart. Which one is fetched comes from the route.
 *
 * NOTHING IS CALCULATED HERE. Every figure on screen, including the totals
 * row and column, is the server's; the screen positions them. The server in
 * turn pivots the existing reports rather than recomputing them, so a cell
 * here equals the same cell in the report it came from.
 */

type PivotVariant = 'hotel-monthly' | 'item-monthly' | 'hotel-item';

const VARIANTS: Record<PivotVariant, {
  title: string;
  rowHeading: string;
  fetch: (params: any) => Promise<KgPivotReport>;
}> = {
  'hotel-monthly': {
    title: 'Hotel-wise Monthly KG',
    rowHeading: 'Hotel Name',
    fetch: (params) => superAdminApi.getHotelMonthlyKgReport(params),
  },
  'item-monthly': {
    title: 'Item-wise Monthly KG',
    rowHeading: 'Item Name',
    fetch: (params) => superAdminApi.getItemMonthlyKgReport(params),
  },
  'hotel-item': {
    title: 'Hotel-wise Item KG',
    rowHeading: 'Hotel Name',
    fetch: (params) => superAdminApi.getHotelItemKgReport(params),
  },
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Weights print to three decimals, the precision the reports already use. */
const kg = (value: number) => `${Number(value || 0).toFixed(3)}`;

/** The row-heading column, and every value column. */
const ROW_W = 150;
const CELL_W = 96;

export default function SuperAdminKgPivotReportScreen({ navigation, route }: any) {
  const variant: PivotVariant = route?.params?.variant ?? 'hotel-monthly';
  const config = VARIANTS[variant] ?? VARIANTS['hotel-monthly'];

  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(undefined);

  /** The two selections. 'all' on both is the report as it has always been. */
  const [businessId, setBusinessId] = useState<string>(ALL);
  const [laundryType, setLaundryType] = useState<string>(ALL);
  const [businesses, setBusinesses] = useState<ReportableBusiness[]>([]);

  const [report, setReport] = useState<KgPivotReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    let alive = true;
    superAdminApi.getReportableBusinesses()
      .then((rows) => { if (alive) setBusinesses(rows); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []));

  const load = useCallback(async () => {
    setError('');
    try {
      setReport(await config.fetch({
        year,
        month,
        business_id: businessId === ALL ? undefined : businessId,
        laundry_type: laundryType === ALL ? undefined : laundryType,
      }));
    } catch (e: any) {
      setReport(null);
      setError(e?.response?.data?.message || e.message || 'Could not load the report');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [config, year, month, businessId, laundryType]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];
  const selectedPeriodLabel = month ? `${MONTHS[month - 1]} ${year}` : `Whole Year ${year}`;

  const isAllEst = businessId === ALL;
  const isAllType = laundryType === ALL;

  const selectedEstName = businesses.find((b) => String(b.id) === businessId)?.name || 'ESTABLISHMENT';

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>{config.title}</Text>
      </View>

      {/* YEAR SELECTION BUTTONS */}
      <Text style={[sa.label, { paddingHorizontal: SPACING.md, marginTop: SPACING.xs }]}>YEAR</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.xs, paddingHorizontal: SPACING.md }}>
        {years.map((option) => {
          const on = year === option;
          return (
            <TouchableOpacity
              key={option}
              style={[sa.tab, on && sa.tabActive, { flex: 1 }]}
              onPress={() => setYear(option)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Show ${option}`}
            >
              <Text style={[sa.tabText, on && sa.tabTextActive]}>{option}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* MONTH SELECTION BUTTONS */}
      <Text style={[sa.label, { paddingHorizontal: SPACING.md, marginTop: SPACING.xs }]}>MONTH</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: SPACING.xs, paddingHorizontal: SPACING.md }}
      >
        <TouchableOpacity
          style={[sa.tab, month === undefined && sa.tabActive, { paddingHorizontal: 12 }]}
          onPress={() => setMonth(undefined)}
        >
          <Text style={[sa.tabText, month === undefined && sa.tabTextActive]}>Whole Year</Text>
        </TouchableOpacity>
        {MONTHS.map((name, index) => {
          const value = index + 1;
          const on = month === value;
          return (
            <TouchableOpacity
              key={name}
              style={[sa.tab, on && sa.tabActive, { paddingHorizontal: 12 }]}
              onPress={() => setMonth(on ? undefined : value)}
            >
              <Text style={[sa.tabText, on && sa.tabTextActive]}>{name.slice(0, 3)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Select Establishment and Type of Business */}
      <KgReportFilters
        businessId={businessId}
        laundryType={laundryType}
        onChange={(next) => { setBusinessId(next.businessId); setLaundryType(next.laundryType); }}
        disabled={loading}
      />

      {loading ? (
        <View style={sa.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={sa.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
        >
          {!!error && (
            <View style={sa.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
              <Text style={sa.errorText}>{error}</Text>
            </View>
          )}

          {/* TOP HIGHLIGHT BANNER FOR SELECTED FILTERS */}
          {(!isAllEst || !isAllType) && (
            <View style={{ marginBottom: SPACING.xs, gap: SPACING.xs }}>
              {!isAllEst && (
                <View
                  style={{
                    backgroundColor: '#E8F3EC',
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 6,
                    borderLeftWidth: 4,
                    borderLeftColor: COLORS.Primary,
                  }}
                >
                  <Text
                    style={{
                      color: COLORS.Primary,
                      fontFamily: TYPOGRAPHY.fontFamilyBold,
                      fontWeight: '700',
                      fontSize: 13,
                    }}
                  >
                    ESTABLISHMENT: {selectedEstName.toUpperCase()}
                  </Text>
                </View>
              )}
              {!isAllType && (
                <View
                  style={{
                    backgroundColor: '#E8F3EC',
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 6,
                    borderLeftWidth: 4,
                    borderLeftColor: COLORS.Primary,
                  }}
                >
                  <Text
                    style={{
                      color: COLORS.Primary,
                      fontFamily: TYPOGRAPHY.fontFamilyBold,
                      fontWeight: '700',
                      fontSize: 13,
                    }}
                  >
                    TYPE OF BUSINESS: {laundryType === 'guest' ? 'GUEST' : 'HOTEL'}
                  </Text>
                </View>
              )}
            </View>
          )}

          {report && report.rows.length === 0 ? (
            <Text style={sa.empty}>No KG was recorded in {selectedPeriodLabel}.</Text>
          ) : report ? (
            <>
              <Text style={sa.cardMeta}>
                {report.rows.length} row{report.rows.length === 1 ? '' : 's'} ·{' '}
                {report.columns.length} column{report.columns.length === 1 ? '' : 's'} ·{' '}
                {kg(report.grand_total_kg)} kg in total
              </Text>

              {/* The grid scrolls sideways */}
              <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginTop: SPACING.sm }}>
                <View>
                  {/* Heading row */}
                  <View style={{ flexDirection: 'row', backgroundColor: COLORS.Primary }}>
                    <Cell width={ROW_W} text={config.rowHeading} head />
                    {report.columns.map((column) => (
                      <Cell key={column.key} width={CELL_W} text={column.label} head right />
                    ))}
                    <Cell width={CELL_W} text="Total KG" head right />
                  </View>

                  {report.rows.map((row, index) => (
                    <View
                      key={row.key}
                      style={{
                        flexDirection: 'row',
                        backgroundColor: index % 2 === 1 ? '#F7FAF8' : COLORS.Surface,
                      }}
                    >
                      <Cell width={ROW_W} text={row.label} />
                      {report.columns.map((column) => (
                        <Cell key={column.key} width={CELL_W} text={kg(row.cells[column.key])} right />
                      ))}
                      <Cell width={CELL_W} text={kg(row.total_kg)} right strong />
                    </View>
                  ))}

                  {/* The foot: column totals */}
                  <View style={{ flexDirection: 'row', backgroundColor: '#E8F3EC' }}>
                    <Cell width={ROW_W} text="Total" strong />
                    {report.columns.map((column) => (
                      <Cell
                        key={column.key}
                        width={CELL_W}
                        text={kg(report.column_totals[column.key])}
                        right
                        strong
                      />
                    ))}
                    <Cell width={CELL_W} text={kg(report.grand_total_kg)} right strong />
                  </View>
                </View>
              </ScrollView>
              {/* PDF generation matching Day-wise Item KG report settings */}
              <ReportPdfActions
                url={superAdminApi.kgReportPdfUrl(variant, {
                  year,
                  month,
                  business_id: businessId === ALL ? undefined : businessId,
                  laundry_type: laundryType === ALL ? undefined : laundryType,
                })}
                fileName={`${config.title.replace(/[^A-Za-z0-9]+/g, '_')}_${year}${month ? `-${String(month).padStart(2, '0')}` : ''}.pdf`}
                title={`${config.title} — ${selectedPeriodLabel}`}
              />
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** One cell of the grid. Displays; never computes. */
function Cell({
  width, text, head, right, strong,
}: {
  width: number; text: string; head?: boolean; right?: boolean; strong?: boolean;
}) {
  return (
    <View
      style={{
        width,
        paddingVertical: SPACING.sm,
        paddingHorizontal: SPACING.xs + 2,
        borderRightWidth: 1,
        borderRightColor: head ? COLORS.Primary : COLORS.Border,
        borderBottomWidth: 1,
        borderBottomColor: head ? COLORS.Primary : COLORS.Border,
      }}
    >
      <Text
        numberOfLines={2}
        style={{
          fontFamily: TYPOGRAPHY.fontFamily,
          fontSize: TYPOGRAPHY.sizes.xs,
          fontWeight: head || strong ? '700' : '500',
          color: head ? COLORS.Surface : COLORS.TextPrimary,
          textAlign: right ? 'right' : 'left',
        }}
      >
        {text}
      </Text>
    </View>
  );
}
