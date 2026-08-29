import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING } from '../../constants/theme';
import { sa } from './styles';
import { ActionButton } from './SuperAdminCustomerPricesScreen';
import superAdminApi, { ExpenseCategory } from '../../services/superAdminApi';
import { Field, Input, TonePill, Loading, ErrorBox } from './financeShared';

/**
 * Expense categories — the chart of accounts the Expense module files against.
 *
 * DISABLED, NOT DELETED, once a category has been used. The server refuses to
 * remove one that historical expenses reference, because deleting it would
 * either orphan those rows or silently recategorise them — either way
 * rewriting financial history. Disabling hides it from the expense form and
 * leaves every past expense reading exactly as it was filed, which is why the
 * Delete button only appears on a category nothing uses.
 *
 * GLOBAL BY DEFAULT. Electricity and Rent mean the same thing everywhere, and
 * a category per business would make "expenses by category" incomparable
 * across the company. A business may still add its own.
 */
export default function SuperAdminExpenseCategoriesScreen({ navigation, route }: any) {

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      // Disabled categories included: this is the screen where they are
      // managed, so hiding them would make one impossible to re-enable.
      setCategories(await superAdminApi.getExpenseCategories(true));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (category: ExpenseCategory) => {
    try {
      await superAdminApi.updateExpenseCategory(category.id, { is_active: !category.is_active });
      load();
    } catch (e: any) {
      Alert.alert('Could not update', e?.response?.data?.message || e.message);
    }
  };

  const confirmDelete = (category: ExpenseCategory) => {
    Alert.alert(
      'Delete this category?',
      `${category.name}.\n\nOnly a category nothing has been filed under can be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await superAdminApi.deleteExpenseCategory(category.id);
              load();
            } catch (e: any) {
              Alert.alert('Not deleted', e?.response?.data?.message || e.message);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>Expense Categories</Text>
        <TouchableOpacity
          style={sa.iconBtn}
          onPress={() => setAdding(true)}
          accessibilityLabel="Add a category"
        >
          <Ionicons name="add" size={24} color={COLORS.Primary} />
        </TouchableOpacity>
      </View>

      <ErrorBox message={error} />

      {loading ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={sa.scroll}>
          {categories.map((category) => (
            <View key={category.id} style={sa.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <View style={sa.flex}>
                  <Text style={sa.cardTitle}>{category.name}</Text>
                  <Text style={sa.cardMeta}>
                    {category.expense_count} expense{category.expense_count === 1 ? '' : 's'}
                  </Text>
                </View>
                {!category.is_active ? <TonePill status="CANCELLED" /> : null}
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm }}>
                <ActionButton
                  icon="create-outline"
                  label="Rename"
                  tone="primary"
                  onPress={() => setEditing(category)}
                  accessibilityLabel={`Rename ${category.name}`}
                />
                <ActionButton
                  icon={category.is_active ? 'close-circle-outline' : 'checkmark-circle-outline'}
                  label={category.is_active ? 'Disable' : 'Enable'}
                  onPress={() => toggle(category)}
                />
                {/* Only when nothing is filed under it — see the note above. */}
                {category.expense_count === 0 && (
                  <ActionButton
                    icon="trash-outline"
                    label="Delete"
                    tone="danger"
                    onPress={() => confirmDelete(category)}
                  />
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <CategoryModal
        visible={adding || editing !== null}
        category={editing}
        onClose={() => { setAdding(false); setEditing(null); }}
        onSaved={() => { setAdding(false); setEditing(null); load(); }}
      />
    </SafeAreaView>
  );
}

function CategoryModal({
  visible, category, onClose, onSaved,
}: {
  visible: boolean;
  category: ExpenseCategory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (!visible) return;
    setError('');
    setName(category?.name || '');
  }, [visible, category]);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      if (category) await superAdminApi.updateExpenseCategory(category.id, { name: name.trim() });
      else await superAdminApi.createExpenseCategory(name.trim());
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not save this category');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sa.modalBackdrop}>
        <View style={sa.modalSheet}>
          <View style={sa.header}>
            <Text style={[sa.headerTitle, sa.flex]}>
              {category ? 'Rename Category' : 'Add Category'}
            </Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
            <ErrorBox message={error} />
            <Field label="CATEGORY NAME" required>
              <Input value={name} onChangeText={setName} placeholder="e.g. Water" />
            </Field>


            <TouchableOpacity
              style={[sa.button, (!name.trim() || busy) && sa.buttonDisabled]}
              onPress={save}
              disabled={!name.trim() || busy}
            >
              {busy ? <ActivityIndicator color={COLORS.Surface} /> : (
                <Text style={sa.buttonText}>{category ? 'Save name' : 'Add category'}</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
