import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { Expense, ExpenseSummary, ExpenseCategory,
  PurchasePaymentMethod, PurchaseOptions,
} from '../../services/superAdminApi';
import {
  money, dmy, StatTile, ChipRow, TonePill, Loading, ErrorBox, dateRanges, DateRange,
} from './financeShared';

/**
 * Super Admin -> Expense.
 *
 * The dashboard and the register together, for the same reason as Purchase:
 * the tiles say what the period cost and the list says what made it up, and
 * one set of filters moves both.
 *
 * INDEPENDENT OF PURCHASE. An electricity bill is not a purchase of stock;
 * the two modules share only the payment-method vocabulary and the design.
 *
 * ONE BUSINESS AT A TIME, with the business in the API path — so this screen
 * cannot show one business's spending under another's name.
 *
 * EVERY FILTER IS APPLIED BY THE SERVER, and the "N expenses · TOTAL" line
 * describes the whole filtered set rather than the page on screen, because
 * the backend returns both the page and the total for the same WHERE clause.
 */

const PAGE_SIZE = 25;

export default function SuperAdminExpenseScreen({ navigation }: any) {

  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [options, setOptions] = useState<PurchaseOptions | null>(null);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [method, setMethod] = useState<PurchasePaymentMethod | ''>('');
  const [range, setRange] = useState<DateRange>({ label: 'All time' });
  const [page, setPage] = useState(0);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    superAdminApi.getPurchaseOptions().then(setOptions).catch(() => {});
  }, []);

  useEffect(() => {
    superAdminApi
      .getExpenseCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const params = {
        search: search.trim() || undefined,
        category_id: categoryId || undefined,
        payment_method: method || undefined,
        from: range.from,
        to: range.to,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      const [summaryData, listData] = await Promise.all([
        superAdminApi.getExpenseSummary({ from: range.from, to: range.to }),
        superAdminApi.getExpenses(params),
      ]);
      setSummary(summaryData);
      setExpenses(listData.expenses);
      setTotal(listData.total);
      setTotalAmount(listData.total_amount);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load expenses');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, categoryId, method, range, page]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const changeFilter = (apply: () => void) => { apply(); setPage(0); };


  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>Expense</Text>
        <TouchableOpacity
          style={sa.iconBtn}
          onPress={() =>
            navigation.navigate('SuperAdminExpenseCategories')}
          accessibilityLabel="Expense categories"
        >
          <Ionicons name="pricetags-outline" size={20} color={COLORS.TextPrimary} />
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
              label="Total expenses"
              value={money(summary?.total_amount)}
              sub={`${summary?.total_count ?? 0} recorded`}
            />
            <StatTile label="Today" value={money(summary?.today_amount)} />
            <StatTile label="This month" value={money(summary?.this_month_amount)} />
            <StatTile label="This year" value={money(summary?.this_year_amount)} />
            <StatTile
              label="Unpaid"
              value={money(summary?.unpaid_amount)}
              sub={`${summary?.unpaid_count ?? 0} outstanding`}
              tone={Number(summary?.unpaid_count) > 0 ? 'warning' : 'default'}
            />
            <StatTile
              label="Categories used"
              value={String(summary?.category_count ?? 0)}
            />
          </View>

          {/* ---- TOP CATEGORIES ----
              Ranked by the server; the bar is drawn against the largest, so
              it is a comparison rather than a scale nobody defined. */}
          {summary && summary.top_categories.length > 0 && (
            <>
              <Text style={sa.cardTitle}>Top categories</Text>
              <View style={sa.card}>
                {summary.top_categories.map((category) => {
                  const largest = summary.top_categories[0].amount || 1;
                  return (
                    <View key={category.category_id} style={{ marginBottom: SPACING.xs }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={sa.cardMeta} numberOfLines={1}>
                          {category.category_name}
                        </Text>
                        <Text style={[sa.tdPrice, { fontSize: 12 }]}>{money(category.amount)}</Text>
                      </View>
                      <View
                        style={{
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: COLORS.Border,
                          marginTop: 3,
                          overflow: 'hidden',
                        }}
                      >
                        <View
                          style={{
                            width: `${Math.max(4, (category.amount / largest) * 100)}%`,
                            height: 6,
                            backgroundColor: COLORS.Primary,
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* ---- FILTERS ---- */}
          <TextInput
            style={sa.input}
            placeholder="Search expense no., description or category"
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
          {categories.length > 0 && (
            <View style={{ marginHorizontal: -SPACING.md, marginBottom: SPACING.xs }}>
              <ChipRow
                options={[
                  { value: '', label: 'All categories' },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
                value={categoryId}
                onChange={(value) => changeFilter(() => setCategoryId(value))}
              />
            </View>
          )}
          {options && (
            <View style={{ marginHorizontal: -SPACING.md, marginBottom: SPACING.sm }}>
              <ChipRow
                options={[
                  { value: '', label: 'All methods' },
                  ...options.payment_methods.map((m) => ({ value: m.value, label: m.label })),
                ]}
                value={method}
                onChange={(value) => changeFilter(() => setMethod(value as PurchasePaymentMethod | ''))}
              />
            </View>
          )}

          {/* ---- THE REGISTER ---- */}
          <Text style={[sa.cardMeta, { marginBottom: SPACING.xs }]}>
            {total} expense{total === 1 ? '' : 's'} · {money(totalAmount)}
            {range.from ? ` · ${range.label}` : ''}
          </Text>

          {loading ? (
            <Loading />
          ) : expenses.length === 0 ? (
            <Text style={sa.empty}>
              No expenses match these filters. Tap + Add Expense to record one.
            </Text>
          ) : (
            expenses.map((expense) => (
              <TouchableOpacity
                key={expense.id}
                style={sa.card}
                onPress={() =>
                  navigation.navigate('SuperAdminExpenseDetail', {
                    expenseId: expense.id,
                  })}
                accessibilityLabel={`Open ${expense.expense_number}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm }}>
                  <View style={sa.flex}>
                    <Text style={sa.cardTitle}>{expense.category_name}</Text>
                    <Text style={sa.cardMeta} numberOfLines={2}>
                      {expense.description || 'No description'}
                    </Text>
                    <Text style={sa.cardMeta}>
                      {expense.expense_number} · {dmy(expense.expense_date)} ·{' '}
                      {expense.payment_method_label}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text
                      style={{
                        color: COLORS.TextPrimary,
                        fontFamily: TYPOGRAPHY.fontFamily,
                        fontWeight: '700',
                        fontSize: 15,
                      }}
                    >
                      {money(expense.amount)}
                    </Text>
                    {expense.payment_status === 'UNPAID' ? <TonePill status="UNPAID" /> : null}
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}

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
          onPress={() => navigation.navigate('SuperAdminExpenseForm')}
          accessibilityLabel="Add an expense"
        >
          <Ionicons name="add" size={20} color={COLORS.Surface} />
          <Text
            style={{ color: COLORS.Surface, fontWeight: '700', fontFamily: TYPOGRAPHY.fontFamily }}
          >
            Add Expense
          </Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}
