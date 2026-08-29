import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal, RefreshControl, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, {
  ItemKgReport, ItemKgSort, ReportableBusiness,
} from '../../services/superAdminApi';
import { formatKg } from '../../components/charts/KgBarChart';
import { StatTile, Loading, ErrorBox } from './financeShared';

/**
 * ITEM WISE KG — pieces and weight for each item.
 *
 * ALL BUSINESS IS THE DEFAULT, and is an absence rather than a value: no
 * business is sent, so "every customer" cannot collide with a real customer
 * id. Choosing one narrows the same report rather than switching to a
 * different one.
 *
 * ONE ROW PER ITEM, ALWAYS. Ten customers ordering Shirts is one Shirt row
 * with the quantities added — the grouping happens in SQL and never includes
 * the business, so the screen has nothing to merge and cannot get it wrong.
 *
 * NOTHING IS CALCULATED HERE. Every piece count, weight and total is what the
 * server returned; sorting is a server round trip for the same reason, so the
 * order of a paged report can never disagree with its totals.
 */

/** '' is ALL BUSINESS — see the note above about absence, not a sentinel. */
const ALL = '';

const SORTS: Array<{ value: ItemKgSort; label: string }> = [
  { value: 'kg_desc', label: 'KG (high-low)' },
  { value: 'kg_asc', label: 'KG (low-high)' },
  { value: 'pieces_desc', label: 'Pieces (high-low)' },
  { value: 'pieces_asc', label: 'Pieces (low-high)' },
  { value: 'name_asc', label: 'Name (A-Z)' },
  { value: 'name_desc', label: 'Name (Z-A)' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function yearOptions(): number[] {
  const now = new Date().getFullYear();
  return [now, now - 1, now - 2];
}

export default function SuperAdminItemKgReportScreen({ navigation }: any) {
  const [businesses, setBusinesses] = useState<ReportableBusiness[]>([]);
  const [businessId, setBusinessId] = useState<string>(ALL);
  const [picking, setPicking] = useState(false);

  const [year, setYear] = useState<number>(new Date().getFullYear());
  /** '' is the complete year; a number narrows to that month. */
  const [month, setMonth] = useState<string>('');
  const [sort, setSort] = useState<ItemKgSort>('kg_desc');

  const [report, setReport] = useState<ItemKgReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    superAdminApi.getReportableBusinesses().then(setBusinesses).catch(() => setBusinesses([]));
  }, []);

  /**
   * Refetched whenever ANY filter changes — business, year, month or sort.
   * The dependency list is the filter set, so the report on screen always
   * matches the controls above it.
   */
  const load = useCallback(async () => {
    setError('');
    try {
      setReport(await superAdminApi.getItemWiseKgReport(businessId || undefined, {
        year, month: month || undefined, sort,
      }));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load this report');
      setReport(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [businessId, year, month, sort]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const business = businesses.find((b) => b.id === businessId) || null;
  const periodLabel = month ? `${MONTHS[Number(month) - 1]} ${year}` : `Complete year ${year}`;
  const businessLabel = businessId === ALL ? 'ALL BUSINESS' : business?.name ?? 'Selected business';

  /** The table as text, built from the rows on screen. */
  const share = async () => {
    if (!report) return;
    try {
      await Share.share({
        message: [
          'Item Wise KG Report',
          businessLabel,
          periodLabel,
          '',
          'Item Name\tNo. of Pieces\tTotal KG',
          ...report.items.map((i) => `${i.item_name}\t${i.pieces}\t${i.total_kg}`),
          `TOTAL\t${report.totals.pieces}\t${report.totals.total_kg}`,
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
        <Text style={[sa.headerTitle, sa.flex]}>Item Wise KG</Text>
        {report && report.items.length > 0 && (
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
        {/* ---- BUSINESS ---- */}
        <Text style={sa.label}>BUSINESS</Text>
        <TouchableOpacity
          style={[sa.input, { flexDirection: 'row', alignItems: 'center' }]}
          onPress={() => setPicking(true)}
          accessibilityLabel="Choose a business, or all businesses"
        >
          <Text style={[sa.flex, { color: COLORS.TextPrimary }]} numberOfLines={1}>
            {businessLabel}
          </Text>
          <Ionicons name="chevron-down" size={18} color={COLORS.TextSecondary} />
        </TouchableOpacity>

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
          <TouchableOpacity
            style={[sa.filterChip, month === '' && sa.filterChipOn]}
            onPress={() => setMonth('')}
          >
            <Text style={[sa.filterChipText, month === '' && sa.filterChipTextOn]}>
              Complete year
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

        {/* ---- WHAT IS BEING SHOWN ----
            Stated plainly above the report, so a table read out of context
            still says which customer and which period it describes. */}
        <View style={[sa.card, { marginTop: SPACING.sm }]}>
          <Text style={sa.cardTitle}>{businessLabel}</Text>
          <Text style={sa.cardMeta}>{periodLabel}</Text>
        </View>

        <ErrorBox message={error} />

        {loading ? (
          <View style={{ paddingVertical: SPACING.xl }}>
            <Loading />
          </View>
        ) : !report ? null : report.items.length === 0 ? (
          <View style={sa.card}>
            <Text style={sa.cardTitle}>No items recorded</Text>
            <Text style={sa.cardMeta}>
              {businessLabel === 'ALL BUSINESS'
                ? 'No business customer had orders'
                : `${businessLabel} had no orders`}
              {' in '}{periodLabel.toLowerCase()}.
            </Text>
          </View>
        ) : (
          <>
            {/* ---- SUMMARY CARDS ---- */}
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                marginTop: SPACING.sm,
              }}
            >
              {/* TOTAL ORDERS is its own card, and deliberately not a
                  column on the item rows: an order contains many items, so
                  putting a count beside each row would invite adding them
                  up and counting one order once per item it contains.
                  Counted DISTINCT server-side over the same business and
                  period filters as the rest of the report. */}
              <StatTile
                label="Total Orders"
                value={report.totals.orders.toLocaleString('en-IN')}
                sub={businessLabel === 'ALL BUSINESS' ? 'All businesses' : 'This business'}
              />
              <StatTile
                label="Total Unique Items"
                value={String(report.totals.item_count)}
                sub="Distinct items"
              />
              <StatTile
                label="Total Pieces"
                value={report.totals.pieces.toLocaleString('en-IN')}
                sub="All items combined"
              />
              <StatTile
                label="Total KG"
                value={formatKg(report.totals.total_kg)}
                tone="good"
              />
            </View>

            {/* ---- SORT ----
                A server round trip, not a local resort: the order and the
                totals then always come from the same query. */}
            <Text style={[sa.label, { marginTop: SPACING.xs }]}>SORT BY</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: SPACING.xs, paddingRight: SPACING.md }}
            >
              {SORTS.map((option) => {
                const on = sort === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[sa.filterChip, on && sa.filterChipOn]}
                    onPress={() => setSort(option.value)}
                  >
                    <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* ---- THE TABLE ----
                Horizontally scrollable so the columns keep their shape on a
                phone rather than wrapping into something unreadable. */}
            <Text style={[sa.cardTitle, { marginTop: SPACING.sm }]}>
              Item wise detail
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator style={sa.tableWrap}>
              <View>
                <View style={sa.tableHeadRow}>
                  <Text style={[sa.th, { width: 44 }]}>#</Text>
                  <Text style={[sa.th, { width: 180 }]}>Item Name</Text>
                  <Text style={[sa.th, { width: 100 }]}>No. of Pieces</Text>
                  <Text style={[sa.th, { width: 110 }]}>Total KG</Text>
                </View>

                {report.items.map((item, index) => (
                  <View key={item.item_id} style={sa.tableRow}>
                    <Text style={[sa.td, sa.tdMuted, { width: 44 }]}>{index + 1}</Text>
                    <Text style={[sa.td, { width: 180 }]} numberOfLines={2}>
                      {item.item_name}
                    </Text>
                    <Text style={[sa.td, { width: 100 }]}>
                      {item.pieces.toLocaleString('en-IN')}
                    </Text>
                    <Text style={[sa.td, sa.tdPrice, { width: 110 }]}>{item.total_kg}</Text>
                  </View>
                ))}

                {/* The totals, on the same grid as the rows above them. */}
                <View style={[sa.tableRow, { backgroundColor: COLORS.Accent }]}>
                  <Text style={[sa.td, { width: 44 }]} />
                  <Text style={[sa.td, { width: 180, fontWeight: '700' }]}>TOTAL</Text>
                  <Text style={[sa.td, { width: 100, fontWeight: '700' }]}>
                    {report.totals.pieces.toLocaleString('en-IN')}
                  </Text>
                  <Text style={[sa.td, sa.tdPrice, { width: 110 }]}>
                    {report.totals.total_kg}
                  </Text>
                </View>
              </View>
            </ScrollView>

            <Text style={[sa.cardMeta, { marginTop: SPACING.xs }]}>
              TOTAL ORDERS: {report.totals.orders.toLocaleString('en-IN')}
              {'   ·   '}
              TOTAL PIECES: {report.totals.pieces.toLocaleString('en-IN')}
              {'   ·   '}
              TOTAL KG: {formatKg(report.totals.total_kg)}
            </Text>
          </>
        )}
      </ScrollView>

      <BusinessFilterPicker
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
 * ALL BUSINESS plus every customer with orders.
 *
 * ALL BUSINESS is first and always present; the named customers are those
 * that actually have countable orders, so every choice leads to a report
 * with something in it.
 */
function BusinessFilterPicker({
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
            <Text style={[sa.headerTitle, sa.flex]}>Business</Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: SPACING.md }}>
            <TextInput
              style={sa.input}
              placeholder="Search businesses"
              placeholderTextColor={COLORS.TextSecondary}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <ScrollView contentContainerStyle={sa.scroll}>
            <TouchableOpacity
              style={[sa.card, selectedId === ALL && { borderColor: COLORS.Primary }]}
              onPress={() => onSelect(ALL)}
            >
              <Text style={sa.cardTitle}>ALL BUSINESS</Text>
              <Text style={sa.cardMeta}>
                Every business customer combined, one row per item
              </Text>
            </TouchableOpacity>

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
