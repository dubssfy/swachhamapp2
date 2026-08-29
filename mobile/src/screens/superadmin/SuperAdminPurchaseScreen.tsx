import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { Purchase, PurchaseSummary, Supplier,
  PurchasePaymentStatus,
} from '../../services/superAdminApi';
import {
  money, dmy, StatTile, ChipRow, TonePill, Loading, ErrorBox, dateRanges, DateRange,
} from './financeShared';

/**
 * Super Admin -> Purchase.
 *
 * The dashboard and the register in one screen, because they answer the same
 * question at two levels of detail: the tiles say what the period looks like,
 * the list says which bills make it up, and the filters move both together.
 *
 * ONE REGISTER. These are Swachham's own purchases — detergent, packaging,
 * machinery — so there is no business to choose between and no business
 * column to show. See migration 045.
 *
 * EVERY FILTER IS APPLIED BY THE SERVER. The search box, the date range, the
 * supplier and the payment status all go out as query parameters and come
 * back as one page of results; nothing is filtered in JavaScript here, so a
 * business with ten thousand purchases costs the same as one with ten.
 *
 * NOTHING IS CALCULATED ON THIS SCREEN. Every rupee shown is a figure the
 * backend computed and sent.
 */

const PAGE_SIZE = 25;

const STATUS_FILTERS: Array<{ value: PurchasePaymentStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'PAID', label: 'Paid' },
];

export default function SuperAdminPurchaseScreen({ navigation }: any) {

  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [total, setTotal] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PurchasePaymentStatus | 'ALL'>('ALL');
  const [supplierId, setSupplierId] = useState<string>('');
  const [range, setRange] = useState<DateRange>({ label: 'All time' });
  const [page, setPage] = useState(0);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');



  useEffect(() => {
    superAdminApi.getSuppliers().then((d) => setSuppliers(d.suppliers)).catch(() => setSuppliers([]));
  }, []);

  /**
   * The tiles and the page of rows, fetched together for the SAME filters.
   *
   * Both calls carry the same date range, so the summary can never describe a
   * different period from the list beneath it.
   */
  const load = useCallback(async () => {
    setError('');
    try {
      const params = {
        search: search.trim() || undefined,
        payment_status: status === 'ALL' ? undefined : status,
        supplier_id: supplierId || undefined,
        from: range.from,
        to: range.to,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      const [summaryData, listData] = await Promise.all([
        superAdminApi.getPurchaseSummary({ from: range.from, to: range.to }),
        superAdminApi.getPurchases(params),
      ]);
      setSummary(summaryData);
      setPurchases(listData.purchases);
      setTotal(listData.total);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load purchases');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, status, supplierId, range, page]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  // Changing a filter goes back to the first page: staying on page 4 of a
  // narrower result set would show an empty list for no visible reason.
  const changeFilter = (apply: () => void) => { apply(); setPage(0); };


  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, { flex: 1 }]}>Purchase</Text>
        <TouchableOpacity
          style={sa.iconBtn}
          onPress={() => navigation.navigate('SuperAdminSuppliers')}
          accessibilityLabel="Suppliers"
        >
          <Ionicons name="people-outline" size={20} color={COLORS.TextPrimary} />
        </TouchableOpacity>
      </View>

      <ErrorBox message={error} />

              <ScrollView
          contentContainerStyle={[sa.scroll, { paddingBottom: 96 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
        >
          {/* ---- DASHBOARD ---- */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <StatTile
              label="Total purchases"
              value={String(summary?.total_purchases ?? 0)}
              sub={money(summary?.total_amount)}
            />
            <StatTile
              label="Outstanding"
              value={money(summary?.outstanding_amount)}
              tone={Number(summary?.outstanding_amount) > 0 ? 'warning' : 'default'}
              sub="Still to pay"
            />
            <StatTile
              label="This month"
              value={money(summary?.this_month_amount)}
              sub={`${summary?.this_month_count ?? 0} purchase(s)`}
            />
            <StatTile
              label="Today"
              value={money(summary?.today_amount)}
              sub={`${summary?.today_count ?? 0} purchase(s)`}
            />
            <StatTile label="Unpaid" value={String(summary?.unpaid_count ?? 0)} tone="warning" />
            <StatTile label="Partially paid" value={String(summary?.partial_count ?? 0)} />
            <StatTile label="Fully paid" value={String(summary?.paid_count ?? 0)} tone="good" />
            <StatTile label="Returns" value={String(summary?.returned_count ?? 0)} />
          </View>

          {/* ---- FILTERS ---- */}
          <TextInput
            style={sa.input}
            placeholder="Search purchase no., invoice or supplier"
            placeholderTextColor={COLORS.TextSecondary}
            value={search}
            onChangeText={(text) => changeFilter(() => setSearch(text))}
            returnKeyType="search"
          />

          <View style={{ marginHorizontal: -SPACING.md, marginBottom: SPACING.xs }}>
            <ChipRow
              options={dateRanges().map((r) => ({ value: r.label, label: r.label }))}
              value={range.label}
              onChange={(label) =>
                changeFilter(() => setRange(dateRanges().find((r) => r.label === label)!))}
            />
          </View>
          <View style={{ marginHorizontal: -SPACING.md, marginBottom: SPACING.xs }}>
            <ChipRow
              options={STATUS_FILTERS}
              value={status}
              onChange={(value) => changeFilter(() => setStatus(value))}
            />
          </View>
          {suppliers.length > 0 && (
            <View style={{ marginHorizontal: -SPACING.md, marginBottom: SPACING.sm }}>
              <ChipRow
                options={[
                  { value: '', label: 'All suppliers' },
                  ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                ]}
                value={supplierId}
                onChange={(value) => changeFilter(() => setSupplierId(value))}
              />
            </View>
          )}

          {/* ---- THE REGISTER ---- */}
          <Text style={[sa.cardMeta, { marginBottom: SPACING.xs }]}>
            {total} purchase{total === 1 ? '' : 's'}
            {range.from ? ` · ${range.label}` : ''}
          </Text>

          {loading ? (
            <Loading />
          ) : purchases.length === 0 ? (
            <Text style={sa.empty}>
              No purchases match these filters. Tap + Add Purchase to record one.
            </Text>
          ) : (
            purchases.map((purchase) => (
              <TouchableOpacity
                key={purchase.id}
                style={sa.card}
                onPress={() =>
                  navigation.navigate('SuperAdminPurchaseDetail', {
                    purchaseId: purchase.id,
                  })}
                accessibilityLabel={`Open ${purchase.purchase_number}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm }}>
                  <View style={sa.flex}>
                    <Text style={sa.cardTitle}>{purchase.purchase_number}</Text>
                    <Text style={sa.cardMeta}>{purchase.supplier_name}</Text>
                    <Text style={sa.cardMeta}>
                      {dmy(purchase.purchase_date)} · {purchase.item_count} item
                      {purchase.item_count === 1 ? '' : 's'}
                      {purchase.invoice_number ? ` · ${purchase.invoice_number}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <TonePill status={purchase.payment_status} />
                    {purchase.purchase_status !== 'RECEIVED' ? (
                      <TonePill status={purchase.purchase_status} />
                    ) : null}
                  </View>
                </View>

                {/* The three figures a register is read for. */}
                <View
                  style={{
                    flexDirection: 'row',
                    marginTop: SPACING.sm,
                    borderTopWidth: 1,
                    borderTopColor: COLORS.Border,
                    paddingTop: SPACING.sm,
                  }}
                >
                  <Amount label="Total" value={purchase.total_amount} strong />
                  <Amount label="Paid" value={purchase.paid_amount} />
                  <Amount
                    label="Balance"
                    value={purchase.balance_amount}
                    tone={purchase.balance_amount > 0 ? COLORS.Warning : undefined}
                  />
                </View>
              </TouchableOpacity>
            ))
          )}

          {/* ---- PAGING ----
              Server-side: each button refetches one page rather than slicing
              a list the screen already holds. */}
          {pageCount > 1 && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: SPACING.md,
                marginTop: SPACING.md,
              }}
            >
              <TouchableOpacity
                style={[sa.actionBtn, page === 0 && { opacity: 0.4 }]}
                disabled={page === 0}
                onPress={() => setPage((p) => Math.max(0, p - 1))}
              >
                <Ionicons name="chevron-back" size={15} color={COLORS.TextSecondary} />
                <Text style={sa.actionBtnText}>Previous</Text>
              </TouchableOpacity>
              <Text style={sa.cardMeta}>Page {page + 1} of {pageCount}</Text>
              <TouchableOpacity
                style={[sa.actionBtn, page + 1 >= pageCount && { opacity: 0.4 }]}
                disabled={page + 1 >= pageCount}
                onPress={() => setPage((p) => p + 1)}
              >
                <Text style={sa.actionBtnText}>Next</Text>
                <Ionicons name="chevron-forward" size={15} color={COLORS.TextSecondary} />
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

      {/* ---- + ADD PURCHASE ----
          Floating, so it stays reachable however far the register is
          scrolled — which is the point of a prominent add button. */}
      <TouchableOpacity
          style={{
            position: 'absolute',
            right: SPACING.md,
            bottom: SPACING.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: COLORS.Primary,
            paddingHorizontal: SPACING.md,
            paddingVertical: 12,
            borderRadius: BORDER_RADIUS.xl,
            elevation: 4,
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 3 },
          }}
          onPress={() =>
            navigation.navigate('SuperAdminPurchaseForm')}
          accessibilityLabel="Add a purchase"
        >
          <Ionicons name="add" size={20} color={COLORS.Surface} />
          <Text
            style={{ color: COLORS.Surface, fontWeight: '700', fontFamily: TYPOGRAPHY.fontFamily }}
          >
            Add Purchase
          </Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}

/** One figure on a register row. Displays; never computes. */
function Amount({
  label, value, strong, tone,
}: {
  label: string;
  value: number;
  strong?: boolean;
  tone?: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[sa.cardMeta, { fontSize: 10 }]}>{label}</Text>
      <Text
        style={{
          color: tone || COLORS.TextPrimary,
          fontFamily: TYPOGRAPHY.fontFamily,
          fontWeight: strong ? '700' : '600',
          fontSize: strong ? 14 : 13,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {money(value)}
      </Text>
    </View>
  );
}
