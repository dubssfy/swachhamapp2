import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, {
  ExpenseCategory, PurchasePaymentMethod, PurchaseOptions,
} from '../../services/superAdminApi';
import { money, Field, Input, Loading, ErrorBox, today } from './financeShared';

/**
 * Add / Edit Expense.
 *
 * There is no arithmetic here at all: an expense is ONE amount, so nothing is
 * summed, derived or previewed. The form's whole job is to collect a valid
 * record — the category, the date, the amount, how it was paid — and the
 * server validates every one of them again before storing it.
 *
 * THE CATEGORY LIST IS THE SERVER'S. It carries this business's own
 * categories plus the global ones, and only the ACTIVE ones, so a disabled
 * category cannot be chosen here and a category belonging to another business
 * is never offered.
 */
export default function SuperAdminExpenseFormScreen({ navigation, route }: any) {
  const expenseId: string | undefined = route.params?.expenseId;

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [options, setOptions] = useState<PurchaseOptions | null>(null);

  const [categoryId, setCategoryId] = useState('');
  const [expenseDate, setExpenseDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<PurchasePaymentMethod>('CASH');
  const [status, setStatus] = useState<'PAID' | 'UNPAID'>('PAID');
  const [paidBy, setPaidBy] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(Boolean(expenseId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    superAdminApi.getExpenseCategories().then(setCategories).catch(() => {});
    superAdminApi.getPurchaseOptions().then(setOptions).catch(() => {});
  }, []);

  useEffect(() => {
    if (!expenseId) return;
    superAdminApi
      .getExpense(expenseId)
      .then((expense) => {
        setCategoryId(expense.category_id);
        setExpenseDate(expense.expense_date);
        setAmount(String(expense.amount));
        setDescription(expense.description || '');
        setMethod(expense.payment_method);
        setStatus(expense.payment_status);
        setPaidBy(expense.paid_by || '');
        setReference(expense.reference_number || '');
        setNotes(expense.notes || '');
      })
      .catch((e: any) =>
        setError(e?.response?.data?.message || e.message || 'Could not load this expense'))
      .finally(() => setLoading(false));
  }, [expenseId]);

  const value = Number(amount);
  const problems: string[] = [];
  if (!categoryId) problems.push('Choose a category.');
  if (!expenseDate.trim()) problems.push('Enter the expense date.');
  if (!Number.isFinite(value) || value <= 0) problems.push('Enter an amount greater than zero.');

  const save = async () => {
    if (problems.length > 0 || saving) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        category_id: categoryId,
        expense_date: expenseDate.trim(),
        amount,
        description: description.trim() || null,
        payment_method: method,
        payment_status: status,
        paid_by: paidBy.trim() || null,
        reference_number: reference.trim() || null,
        notes: notes.trim() || null,
      };
      const saved = expenseId
        ? await superAdminApi.updateExpense(expenseId, payload)
        : await superAdminApi.createExpense(payload);

      Alert.alert(
        expenseId ? 'Expense updated' : 'Expense recorded',
        `${saved.expense_number} — ${money(saved.amount)}`
      );
      navigation.replace('SuperAdminExpenseDetail', { expenseId: saved.id });
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not save this expense');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>
          {expenseId ? 'Edit Expense' : 'Add Expense'}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[sa.scroll, { paddingBottom: 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          <ErrorBox message={error} />

          <Field label="CATEGORY" required>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
              {categories.map((category) => {
                const on = categoryId === category.id;
                return (
                  <TouchableOpacity
                    key={category.id}
                    style={[sa.filterChip, on && sa.filterChipOn]}
                    onPress={() => setCategoryId(category.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>
                      {category.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Field>

          <Field label="AMOUNT" required>
            <Input
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </Field>

          <Field label="EXPENSE DATE" required>
            <Input value={expenseDate} onChangeText={setExpenseDate} placeholder="YYYY-MM-DD" />
          </Field>

          <Field label="DESCRIPTION">
            <Input
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. Monthly electricity bill"
            />
          </Field>

          <Field label="PAYMENT METHOD" required>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
              {(options?.payment_methods ?? []).map((option) => {
                const on = method === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[sa.filterChip, on && sa.filterChipOn]}
                    onPress={() => setMethod(option.value)}
                  >
                    <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Field>

          {/* PAID is the normal state; UNPAID records a bill that has arrived
              but has not been settled, which the dashboard counts separately. */}
          <Field label="STATUS">
            <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
              {(['PAID', 'UNPAID'] as const).map((value) => {
                const on = status === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[sa.filterChip, on && sa.filterChipOn]}
                    onPress={() => setStatus(value)}
                  >
                    <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>
                      {value === 'PAID' ? 'Paid' : 'Not paid yet'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Field>

          <Field label="PAID BY">
            <Input value={paidBy} onChangeText={setPaidBy} placeholder="Person or account" />
          </Field>
          <Field label="REFERENCE">
            <Input value={reference} onChangeText={setReference} placeholder="UPI ref / cheque no." />
          </Field>
          <Field label="NOTES">
            <Input value={notes} onChangeText={setNotes} multiline />
          </Field>

          {problems.length > 0 && (
            <View style={sa.warnBox}>
              <Ionicons name="alert-circle-outline" size={16} color="#8A5200" />
              <Text style={sa.warnText}>{problems[0]}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[sa.button, (problems.length > 0 || saving) && sa.buttonDisabled]}
            onPress={save}
            disabled={problems.length > 0 || saving}
          >
            {saving ? <ActivityIndicator color={COLORS.Surface} /> : (
              <Text style={sa.buttonText}>
                {expenseId ? 'Save changes' : 'Save expense'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
