import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal, RefreshControl, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { KgReport, ReportableBusiness } from '../../services/superAdminApi';
import KgBarChart, { formatKg } from '../../components/charts/KgBarChart';
import { Loading, ErrorBox } from './financeShared';

/**
 * KG REPORT — both variants, one screen.
 *
 *   mode: 'customer'   PER CUSTOMER KG, with a business picker
 *   mode: 'total'      TOTAL KG, every business customer combined
 *
 * They share a period selector, a bar graph and a detail table, and differ
 * only in whether a customer is chosen and whether the table carries a
 * customer column — so one screen with a mode is honest about how alike they
 * are, where two screens would be the same file twice.
 *
 * NOTHING IS CALCULATED HERE. Every weight, count and total is what the
 * server returned; the screen picks a window, asks for it, and draws the
 * answer. The months arrive gap-filled, so an empty month is a zero bar
 * rather than a missing one.
 */

type Mode = 'customer' | 'total';

/** The years offered. The current year first, since that is the usual ask. */
function yearOptions(): number[] {
  const now = new Date().getFullYear();
  return [now, now - 1, now - 2];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function SuperAdminKgReportScreen({ navigation, route }: any) {
  const mode: Mode = route.params?.mode === 'total' ? 'total' : 'customer';

  const [businesses, setBusinesses] = useState<ReportableBusiness[]>([]);
  const [businessId, setBusinessId] = useState<string>('');
  const [picking, setPicking] = useState(false);

  const [year, setYear] = useState<number>(new Date().getFullYear());
  /** '' means the whole year, which is what the month-by-month graph wants. */
  const [month, setMonth] = useState<string>('');

  const [report, setReport] = useState<KgReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // The customer list is only needed by the per-customer report.
  useEffect(() => {
    if (mode !== 'customer') return;
    superAdminApi
      .getReportableBusinesses()
      .then((rows) => {
        setBusinesses(rows);
        // Pre-selected so the screen opens on a real report rather than on a
        // prompt; the picker changes it.
        setBusinessId((current) => current || (rows[0]?.id ?? ''));
        if (rows.length === 0) setLoading(false);
      })
      .catch((e: any) => {
        setError(e?.response?.data?.message || e.message || 'Could not load business customers');
        setLoading(false);
      });
  }, [mode]);

  const load = useCallback(async () => {
    if (mode === 'customer' && !businessId) return;
    setError('');
    try {
      const params = { year, month: month || undefined };
      setReport(
        mode === 'total'
          ? await superAdminApi.getTotalKgReport(params)
          : await superAdminApi.getBusinessKgReport(businessId, params)
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load this report');
      setReport(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode, businessId, year, month]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const business = businesses.find((b) => b.id === businessId) || null;
  const title = mode === 'total' ? 'Total KG' : 'Per Customer KG';

  /** Months that actually have orders — what "no data" is judged on. */
  const withData = useMemo(
    () => (report?.months ?? []).filter((m) => m.orders > 0),
    [report]
  );

  /**
   * The detail table as text, for Share.
   *
   * Built from the SAME rows the table renders, so what is shared is what
   * was on screen rather than a second fetch that might differ.
   */
  const share = async () => {
    if (!report) return;
    const who = mode === 'total' ? 'All business customers' : report.business?.name ?? '';
    const header = mode === 'total'
      ? 'Month\tCustomers\tOrders\tItems\tKG'
      : 'Month\tOrders\tItems\tKG';
    const lines = report.months.map((m) => (mode === 'total'
      ? `${m.label}\t${m.customers ?? 0}\t${m.orders}\t${m.items}\t${m.total_kg}`
      : `${m.label}\t${m.orders}\t${m.items}\t${m.total_kg}`));
    const total = `TOTAL\t${mode === 'total' ? `${report.totals.customers}\t` : ''}` +
      `${report.totals.orders}\t${report.totals.items}\t${report.totals.total_kg}`;
    try {
      await Share.share({
        message: [
          `KG Report — ${title}`,
          who,
          `${report.from} to ${report.to}`,
          '',
          header,
          ...lines,
          total,
        ].join('\n'),
      });
    } catch { /* the sheet was dismissed */ }
  };

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>{title}</Text>
        {report && withData.length > 0 && (
          <TouchableOpacity style={sa.iconBtn} onPress={share} accessibilityLabel="Share report">
            <Ionicons name="share-outline" size={20} color={COLORS.TextPrimary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={sa.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {/* ---- CUSTOMER ---- */}
        {mode === 'customer' && (
          <>
            <Text style={sa.label}>BUSINESS CUSTOMER</Text>
            <TouchableOpacity
              style={[sa.input, { flexDirection: 'row', alignItems: 'center' }]}
              onPress={() => setPicking(true)}
              accessibilityLabel="Choose a business customer"
            >
              <Text
                style={[sa.flex, { color: business ? COLORS.TextPrimary : COLORS.TextSecondary }]}
                numberOfLines={1}
              >
                {business ? business.name : 'Choose a business customer'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={COLORS.TextSecondary} />
            </TouchableOpacity>
          </>
        )}

        {/* ---- PERIOD ---- */}
        <Text style={[sa.label, { marginTop: SPACING.sm }]}>YEAR</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
          {yearOptions().map((y) => {
            const on = y === year;
            return (
              <TouchableOpacity
                key={y}
                style={[sa.filterChip, on && sa.filterChipOn]}
                onPress={() => setYear(y)}
              >
                <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>{y}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[sa.label, { marginTop: SPACING.sm }]}>MONTH</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: SPACING.xs, paddingRight: SPACING.md }}
        >
          {/* "Whole year" first: the graph is a month-by-month comparison,
              so the full year is the report's natural shape and narrowing to
              one month is the exception. */}
          <TouchableOpacity
            style={[sa.filterChip, month === '' && sa.filterChipOn]}
            onPress={() => setMonth('')}
          >
            <Text style={[sa.filterChipText, month === '' && sa.filterChipTextOn]}>
              Whole year
            </Text>
          </TouchableOpacity>
          {MONTHS.map((name, index) => {
            const value = String(index + 1);
            const on = month === value;
            return (
              <TouchableOpacity
                key={name}
                style={[sa.filterChip, on && sa.filterChipOn]}
                onPress={() => setMonth(on ? '' : value)}
              >
                <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>
                  {name.slice(0, 3)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <ErrorBox message={error} />

        {loading ? (
          <View style={{ paddingVertical: SPACING.xl }}>
            <Loading />
          </View>
        ) : mode === 'customer' && businesses.length === 0 ? (
          <Text style={sa.empty}>
            No business customer has any orders yet, so there is nothing to report on.
          </Text>
        ) : !report ? null : withData.length === 0 ? (
          /* EMPTY, not broken. The window was asked about and the answer was
             none — said plainly, with the window repeated so it is obvious
             what was searched. */
          <View style={sa.card}>
            <Text style={sa.cardTitle}>No KG recorded</Text>
            <Text style={sa.cardMeta}>
              {mode === 'total'
                ? 'No business customer had orders'
                : `${report.business?.name ?? 'This customer'} had no orders`}
              {' between '}{report.from} and {report.to}.
            </Text>
          </View>
        ) : (
          <>
            {/* ---- TOTALS ---- */}
            <View style={[sa.card, { backgroundColor: COLORS.Accent }]}>
              <Text style={sa.cardMeta}>
                {mode === 'total' ? 'Grand total' : report.business?.name}
                {' · '}{report.from} to {report.to}
              </Text>
              <Text
                style={{
                  color: COLORS.TextPrimary,
                  fontFamily: TYPOGRAPHY.fontFamily,
                  fontWeight: '700',
                  fontSize: 24,
                  marginTop: 2,
                }}
              >
                {formatKg(report.totals.total_kg)}
              </Text>
              <Text style={sa.cardMeta}>
                {report.totals.orders} order{report.totals.orders === 1 ? '' : 's'}
                {' · '}{report.totals.items} item{report.totals.items === 1 ? '' : 's'}
                {mode === 'total'
                  ? ` · ${report.totals.customers} customer${report.totals.customers === 1 ? '' : 's'}`
                  : ''}
              </Text>
            </View>

            {/* ---- GRAPH ---- */}
            <View style={sa.card}>
              <Text style={sa.cardTitle}>Clothes weight by month</Text>
              <KgBarChart
                bars={report.months}
                showCustomers={mode === 'total'}
              />
            </View>

            {/* ---- DETAIL TABLE ----
                Horizontally scrollable so the columns keep their shape on a
                phone rather than wrapping into something unreadable. */}
            <Text style={sa.cardTitle}>Detailed report</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator style={sa.tableWrap}>
              <View>
                <View style={sa.tableHeadRow}>
                  <Text style={[sa.th, { width: 110 }]}>Month</Text>
                  {mode === 'customer' ? (
                    <Text style={[sa.th, { width: 140 }]}>Customer</Text>
                  ) : (
                    <Text style={[sa.th, { width: 90 }]}>Customers</Text>
                  )}
                  <Text style={[sa.th, { width: 70 }]}>Orders</Text>
                  <Text style={[sa.th, { width: 70 }]}>Items</Text>
                  <Text style={[sa.th, { width: 100 }]}>Total KG</Text>
                </View>

                {report.months.map((row) => (
                  <View key={row.month} style={sa.tableRow}>
                    <Text style={[sa.td, { width: 110 }]}>{row.label}</Text>
                    {mode === 'customer' ? (
                      <Text style={[sa.td, { width: 140 }]} numberOfLines={1}>
                        {report.business?.name ?? ''}
                      </Text>
                    ) : (
                      <Text style={[sa.td, { width: 90 }]}>{row.customers ?? 0}</Text>
                    )}
                    <Text style={[sa.td, { width: 70 }]}>{row.orders}</Text>
                    <Text style={[sa.td, { width: 70 }]}>{row.items}</Text>
                    <Text
                      style={[
                        sa.td, sa.tdPrice, { width: 100 },
                        row.total_kg === 0 && { color: COLORS.TextSecondary },
                      ]}
                    >
                      {row.total_kg}
                    </Text>
                  </View>
                ))}

                {/* The period total, on the same grid as the rows above it. */}
                <View style={[sa.tableRow, { backgroundColor: COLORS.Accent }]}>
                  <Text style={[sa.td, { width: 110, fontWeight: '700' }]}>Total</Text>
                  {mode === 'customer' ? (
                    <Text style={[sa.td, { width: 140 }]} />
                  ) : (
                    <Text style={[sa.td, { width: 90, fontWeight: '700' }]}>
                      {report.totals.customers}
                    </Text>
                  )}
                  <Text style={[sa.td, { width: 70, fontWeight: '700' }]}>
                    {report.totals.orders}
                  </Text>
                  <Text style={[sa.td, { width: 70, fontWeight: '700' }]}>
                    {report.totals.items}
                  </Text>
                  <Text style={[sa.td, sa.tdPrice, { width: 100 }]}>
                    {report.totals.total_kg}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </>
        )}
      </ScrollView>

      <BusinessCustomerPicker
        visible={picking}
        businesses={businesses}
        selectedId={businessId}
        onSelect={(id) => { setBusinessId(id); setPicking(false); }}
        onClose={() => setPicking(false)}
      />
    </SafeAreaView>
  );
}

/**
 * The business customer picker.
 *
 * Lists ONLY customers with countable orders, and shows each one's lifetime
 * weight — so the choice is informed and every option leads to a report with
 * something in it.
 */
function BusinessCustomerPicker({
  visible, businesses, selectedId, onSelect, onClose,
}: {
  visible: boolean;
  businesses: ReportableBusiness[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const shown = businesses.filter((b) =>
    b.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sa.modalBackdrop}>
        <View style={sa.modalSheet}>
          <View style={sa.header}>
            <Text style={[sa.headerTitle, sa.flex]}>Business Customer</Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: SPACING.md }}>
            <TextInput
              style={sa.input}
              placeholder="Search customers"
              placeholderTextColor={COLORS.TextSecondary}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <ScrollView contentContainerStyle={sa.scroll}>
            {shown.length === 0 ? (
              <Text style={sa.empty}>No customer matches that search.</Text>
            ) : (
              shown.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={[sa.card, b.id === selectedId && { borderColor: COLORS.Primary }]}
                  onPress={() => onSelect(b.id)}
                >
                  <Text style={sa.cardTitle}>{b.name}</Text>
                  <Text style={sa.cardMeta}>
                    {b.orders} order{b.orders === 1 ? '' : 's'} · {formatKg(b.total_kg)} all time
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
