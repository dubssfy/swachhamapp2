import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { sa } from './styles';
import { ActionButton } from './SuperAdminCustomerPricesScreen';
import superAdminApi, { Expense } from '../../services/superAdminApi';
import { money, dmy, DetailRow, TonePill, Loading, ErrorBox } from './financeShared';

/**
 * One expense, in full.
 *
 * READ-ONLY. Every value is as it was stored; the two actions are Edit, which
 * opens the form, and Delete, which asks first because an expense is a
 * financial record.
 *
 * THE AUDIT LINE at the foot — who recorded it and when it last changed — is
 * shown deliberately: a financial record that can be edited should say that it
 * has been.
 */
export default function SuperAdminExpenseDetailScreen({ navigation, route }: any) {
  const expenseId: string = route.params?.expenseId;

  const [expense, setExpense] = useState<Expense | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setExpense(await superAdminApi.getExpense(expenseId));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load this expense');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [expenseId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirmDelete = () => {
    if (!expense) return;
    Alert.alert(
      'Delete this expense?',
      `${expense.expense_number} — ${money(expense.amount)} for ${expense.category_name}.\n\n` +
        'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await superAdminApi.deleteExpense(expenseId);
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Not deleted', e?.response?.data?.message || e.message);
            }
          },
        },
      ]
    );
  };

  if (loading) return <Loading />;
  if (!expense) {
    return (
      <SafeAreaView style={sa.container} edges={['top']}>
        <View style={sa.header}>
          <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
          </TouchableOpacity>
          <Text style={sa.headerTitle}>Expense</Text>
        </View>
        <ErrorBox message={error || 'This expense could not be found.'} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>{expense.expense_number}</Text>
        {expense.payment_status === 'UNPAID' ? <TonePill status="UNPAID" /> : null}
      </View>

      <ScrollView
        contentContainerStyle={sa.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <ErrorBox message={error} />

        <View style={[sa.card, { backgroundColor: COLORS.Accent, alignItems: 'center' }]}>
          <Text style={sa.cardMeta}>{expense.category_name}</Text>
          <Text
            style={{
              color: COLORS.TextPrimary,
              fontFamily: TYPOGRAPHY.fontFamily,
              fontWeight: '700',
              fontSize: 26,
              marginTop: 4,
            }}
          >
            {money(expense.amount)}
          </Text>
          <Text style={sa.cardMeta}>{dmy(expense.expense_date)}</Text>
        </View>

        <View style={sa.card}>
          <DetailRow label="Expense no." value={expense.expense_number} />
          <DetailRow label="Category" value={expense.category_name} />
          <DetailRow label="Description" value={expense.description || '—'} />
          <DetailRow label="Payment method" value={expense.payment_method_label} />
          <DetailRow
            label="Status"
            value={<TonePill status={expense.payment_status} />}
          />
          <DetailRow label="Paid by" value={expense.paid_by || '—'} />
          <DetailRow label="Reference" value={expense.reference_number || '—'} />
          {expense.notes ? <DetailRow label="Notes" value={expense.notes} /> : null}
        </View>

        {/* ---- AUDIT ----
            Who recorded it and when it last changed. A financial record that
            can be edited should say that it has been. */}
        <Text style={sa.cardTitle}>Record</Text>
        <View style={sa.card}>
          <DetailRow label="Created by" value={expense.created_by_name || '—'} />
          <DetailRow
            label="Created"
            value={new Date(expense.created_at).toLocaleString()}
          />
          <DetailRow
            label="Last updated"
            value={new Date(expense.updated_at).toLocaleString()}
          />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.md }}>
          <ActionButton
            icon="create-outline"
            label="Edit"
            tone="primary"
            onPress={() => navigation.navigate('SuperAdminExpenseForm', { expenseId })}
          />
          <ActionButton icon="trash-outline" label="Delete" tone="danger" onPress={confirmDelete} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
