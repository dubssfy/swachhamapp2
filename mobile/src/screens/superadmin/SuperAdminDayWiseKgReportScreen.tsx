import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { DayWiseKgReport } from '../../services/superAdminApi';
import ReportPdfActions from './ReportPdfActions';
import KgReportFilters, { ALL } from './KgReportFilters';

/**
 * DAY-WISE, HOTEL-WISE, ITEM-WISE KG — one line per day, hotel and item.
 *
 *   Date  |  Hotel Name  |  Item Name  |  KG
 *
 * ONE MONTH AT A TIME, chosen above. A day-by-day sheet over a year would be
 * thousands of lines and the report is read a month at a time, which is what
 * Select Month is for.
 *
 * NOTHING IS CALCULATED HERE. The rows arrive already ordered day, then
 * hotel, then item, and the weights are the ones the existing item reports
 * carry — the server slices them by day rather than recomputing them.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const kg = (value: number) => `${Number(value || 0).toFixed(3)}`;

const DATE_W = 100;
const NAME_W = 160;
const KG_W = 84;

export default function SuperAdminDayWiseKgReportScreen({ navigation }: any) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [picking, setPicking] = useState(false);
  /** The two selections. 'all' on both is the report as it has always been. */
  const [businessId, setBusinessId] = useState<string>(ALL);
  const [laundryType, setLaundryType] = useState<string>(ALL);
  const [businesses, setBusinesses] = useState<ReportableBusiness[]>([]);

  const [report, setReport] = useState<DayWiseKgReport | null>(null);
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
      setReport(await superAdminApi.getDayWiseKgReport({
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
  }, [year, month, businessId, laundryType]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const selected = `${MONTHS[month - 1]} ${year}`;
  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const isAllEst = businessId === ALL;
  const isAllType = laundryType === ALL;

  const selectedEstName = report?.rows[0]?.hotel_name || businesses.find((b) => String(b.id) === businessId)?.name || 'ESTABLISHMENT';

  const DATE_W = 90;
  const NAME_W = 150;
  const TYPE_W = 100;
  const QTY_W = 60;
  const KG_W = 75;

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>Day-wise Item KG</Text>
      </View>

      {/* SELECT MONTH. Tapping opens the year and month choices; the report
          reloads for whichever month is chosen. */}
      <View style={{ paddingHorizontal: SPACING.md }}>
        <Text style={sa.label}>SELECT MONTH</Text>
        <TouchableOpacity
          style={[sa.input, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
          onPress={() => setPicking((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={`Select month, currently ${selected}`}
        >
          <Ionicons name="calendar-outline" size={18} color={COLORS.Primary} />
          <Text style={[sa.flex, { color: COLORS.TextPrimary, fontFamily: TYPOGRAPHY.fontFamily }]}>
            {selected}
          </Text>
          <Ionicons name={picking ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.TextSecondary} />
        </TouchableOpacity>
      </View>

      {picking && (
        <View style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.xs }}>
          <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
            {years.map((option) => {
              const on = year === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[sa.tab, on && sa.tabActive, { flex: 1 }]}
                  onPress={() => setYear(option)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[sa.tabText, on && sa.tabTextActive]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs }}>
            {MONTHS.map((name, index) => {
              const value = index + 1;
              const on = month === value;
              return (
                <TouchableOpacity
                  key={name}
                  style={[sa.tab, on && sa.tabActive, { width: '31%' }]}
                  onPress={() => { setMonth(value); setPicking(false); }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${name} ${year}`}
                >
                  <Text style={[sa.tabText, on && sa.tabTextActive]}>{name.slice(0, 3)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Select Establishment and Type of Business. Select Month above is
          the existing control and is untouched. */}
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
            <Text style={sa.empty}>No KG was recorded in {selected}.</Text>
          ) : report ? (
            <>
              <Text style={sa.cardMeta}>
                {report.totals.days} day{report.totals.days === 1 ? '' : 's'} ·{' '}
                {report.totals.hotels} hotel{report.totals.hotels === 1 ? '' : 's'} ·{' '}
                {report.totals.items} item{report.totals.items === 1 ? '' : 's'} ·{' '}
                {report.totals.total_qty || 0} pcs ·{' '}
                {kg(report.totals.total_kg)} kg in total
              </Text>

              <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginTop: SPACING.sm }}>
                <View>
                  <View style={{ flexDirection: 'row', backgroundColor: COLORS.Primary }}>
                    <Cell width={DATE_W} text="Date" head />
                    {isAllEst && <Cell width={NAME_W} text="Hotel Name" head />}
                    {isAllType && <Cell width={TYPE_W} text="Type of Business" head />}
                    <Cell width={NAME_W} text="Item Name" head />
                    <Cell width={QTY_W} text="Qty" head right />
                    <Cell width={KG_W} text="KG" head right />
                  </View>

                  {report.rows.map((row, index) => (
                    <View
                      key={`${row.date}-${row.business_id}-${row.item_id}-${row.laundry_type}`}
                      style={{
                        flexDirection: 'row',
                        backgroundColor: index % 2 === 1 ? '#F7FAF8' : COLORS.Surface,
                      }}
                    >
                      <Cell width={DATE_W} text={row.date_label} />
                      {isAllEst && <Cell width={NAME_W} text={row.hotel_name} />}
                      {isAllType && <Cell width={TYPE_W} text={row.laundry_type_label} />}
                      <Cell width={NAME_W} text={row.item_name} />
                      <Cell width={QTY_W} text={String(row.total_qty || 0)} right />
                      <Cell width={KG_W} text={kg(row.total_kg)} right />
                    </View>
                  ))}

                  <View style={{ flexDirection: 'row', backgroundColor: '#E8F3EC' }}>
                    <Cell width={DATE_W} text="Total" strong />
                    {isAllEst && <Cell width={NAME_W} text="" />}
                    {isAllType && <Cell width={TYPE_W} text="" />}
                    <Cell width={NAME_W} text="" />
                    <Cell width={QTY_W} text={String(report.totals.total_qty || 0)} right strong />
                    <Cell width={KG_W} text={kg(report.totals.total_kg)} right strong />
                  </View>
                </View>
              </ScrollView>

              {/* The SAME month, rendered by the server. */}
              <ReportPdfActions
                url={superAdminApi.kgReportPdfUrl('day-wise', {
                  year,
                  month,
                  business_id: businessId === ALL ? undefined : businessId,
                  laundry_type: laundryType === ALL ? undefined : laundryType,
                })}
                fileName={`Day-wise_Item_KG_${year}-${String(month).padStart(2, '0')}.pdf`}
                title={`Day-wise Hotel-wise Item-wise KG — ${selected}`}
              />
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** One cell of the table. Displays; never computes. */
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
