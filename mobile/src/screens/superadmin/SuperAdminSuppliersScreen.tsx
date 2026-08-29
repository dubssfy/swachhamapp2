import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert,
  Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { sa } from './styles';
import { ActionButton } from './SuperAdminCustomerPricesScreen';
import superAdminApi, { Supplier, SupplierPurchaseRef } from '../../services/superAdminApi';
import { money, dmy, Field, Input, DetailRow, TonePill, Loading, ErrorBox } from './financeShared';

/**
 * Suppliers — the parties Swachham buys from.
 *
 * COMPANY-WIDE, NOT PER BUSINESS, and the screen says so. Swachham buys from
 * one vendor and allocates each purchase to whichever business it was for, so
 * a supplier is not owned by a business — which is why this screen has no
 * business picker while every purchase and expense screen does.
 *
 * The three figures on each card come from the SERVER, summed over that
 * supplier's purchases:
 *
 *   Purchased    what has been bought from them
 *   Paid         what has been paid
 *   Outstanding  opening balance + purchased - paid
 *
 * None of it is computed here.
 */
export default function SuperAdminSuppliersScreen({ navigation }: any) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  /** The supplier being added or edited; null when the sheet is closed. */
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [adding, setAdding] = useState(false);
  /** The supplier whose purchase history is open. */
  const [viewing, setViewing] = useState<Supplier | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      // Searched and filtered by the SERVER, like every other register here.
      const data = await superAdminApi.getSuppliers({
        search: search.trim() || undefined,
        include_inactive: includeInactive,
      });
      setSuppliers(data.suppliers);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load suppliers');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, includeInactive]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirmDelete = (supplier: Supplier) => {
    Alert.alert(
      'Delete this supplier?',
      `${supplier.name}.\n\n` +
        'A supplier with purchases against them cannot be deleted — disable them instead, ' +
        'which stops them appearing on the purchase form while every past bill keeps naming them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await superAdminApi.deleteSupplier(supplier.id);
              load();
            } catch (e: any) {
              Alert.alert('Not deleted', e?.response?.data?.message || e.message);
            }
          },
        },
      ]
    );
  };

  const toggleActive = async (supplier: Supplier) => {
    try {
      await superAdminApi.updateSupplier(supplier.id, { is_active: !supplier.is_active });
      load();
    } catch (e: any) {
      Alert.alert('Could not update', e?.response?.data?.message || e.message);
    }
  };

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>Suppliers</Text>
        <TouchableOpacity
          style={sa.iconBtn}
          onPress={() => setAdding(true)}
          accessibilityLabel="Add a supplier"
        >
          <Ionicons name="add" size={24} color={COLORS.Primary} />
        </TouchableOpacity>
      </View>

      <View style={{ paddingHorizontal: SPACING.md }}>
        <TextInput
          style={sa.input}
          placeholder="Search by name, phone or GSTIN"
          placeholderTextColor={COLORS.TextSecondary}
          value={search}
          onChangeText={setSearch}
        />
        <TouchableOpacity
          style={[sa.filterChip, includeInactive && sa.filterChipOn, { alignSelf: 'flex-start' }]}
          onPress={() => setIncludeInactive((v) => !v)}
        >
          <Text style={[sa.filterChipText, includeInactive && sa.filterChipTextOn]}>
            Show disabled
          </Text>
        </TouchableOpacity>
      </View>

      <ErrorBox message={error} />

      {loading ? (
        <Loading />
      ) : (
        <ScrollView
          contentContainerStyle={sa.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
        >
          {suppliers.length === 0 ? (
            <Text style={sa.empty}>
              No suppliers yet. Tap + to add the first one.
            </Text>
          ) : (
            suppliers.map((supplier) => (
              <View key={supplier.id} style={sa.card}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm }}>
                  <View style={sa.flex}>
                    <Text style={sa.cardTitle}>{supplier.name}</Text>
                    {supplier.business_name ? (
                      <Text style={sa.cardMeta}>{''}</Text>
                    ) : null}
                    <Text style={sa.cardMeta}>
                      {supplier.phone || 'No phone'}
                      {supplier.gstin ? ` · ${supplier.gstin}` : ''}
                    </Text>
                    <Text style={sa.cardMeta}>
                      {supplier.purchase_count} purchase{supplier.purchase_count === 1 ? '' : 's'}
                    </Text>
                  </View>
                  {!supplier.is_active ? <TonePill status="CANCELLED" /> : null}
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    marginTop: SPACING.sm,
                    borderTopWidth: 1,
                    borderTopColor: COLORS.Border,
                    paddingTop: SPACING.sm,
                  }}
                >
                  <Figure label="Purchased" value={supplier.total_purchased} />
                  <Figure label="Paid" value={supplier.total_paid} />
                  <Figure
                    label="Outstanding"
                    value={supplier.outstanding}
                    tone={supplier.outstanding > 0 ? COLORS.Warning : undefined}
                    strong
                  />
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm }}>
                  <ActionButton
                    icon="receipt-outline"
                    label="History"
                    tone="primary"
                    onPress={() => setViewing(supplier)}
                    accessibilityLabel={`Purchase history for ${supplier.name}`}
                  />
                  <ActionButton
                    icon="create-outline"
                    label="Edit"
                    onPress={() => setEditing(supplier)}
                    accessibilityLabel={`Edit ${supplier.name}`}
                  />
                  <ActionButton
                    icon={supplier.is_active ? 'close-circle-outline' : 'checkmark-circle-outline'}
                    label={supplier.is_active ? 'Disable' : 'Enable'}
                    onPress={() => toggleActive(supplier)}
                  />
                  {supplier.purchase_count === 0 && (
                    <ActionButton
                      icon="trash-outline"
                      label="Delete"
                      tone="danger"
                      onPress={() => confirmDelete(supplier)}
                    />
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <SupplierFormModal
        visible={adding || editing !== null}
        supplier={editing}
        onClose={() => { setAdding(false); setEditing(null); }}
        onSaved={() => { setAdding(false); setEditing(null); load(); }}
      />
      <SupplierHistoryModal
        supplier={viewing}
        onClose={() => setViewing(null)}
      />
    </SafeAreaView>
  );
}

function Figure({
  label, value, tone, strong,
}: {
  label: string;
  value: number;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[sa.cardMeta, { fontSize: 10 }]}>{label}</Text>
      <Text
        style={{
          color: tone || COLORS.TextPrimary,
          fontFamily: TYPOGRAPHY.fontFamily,
          fontWeight: strong ? '700' : '600',
          fontSize: 13,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {money(value)}
      </Text>
    </View>
  );
}

/** Add or edit one supplier. The same sheet for both, so the fields agree. */
function SupplierFormModal({
  visible, supplier, onClose, onSaved,
}: {
  visible: boolean;
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [opening, setOpening] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (!visible) return;
    setError('');
    setName(supplier?.name || '');
    setBusinessName(supplier?.business_name || '');
    setPhone(supplier?.phone || '');
    setEmail(supplier?.email || '');
    setAddress(supplier?.address || '');
    setGstin(supplier?.gstin || '');
    setOpening(supplier ? String(supplier.opening_balance) : '');
    setNotes(supplier?.notes || '');
  }, [visible, supplier]);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        business_name: businessName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        gstin: gstin.trim() || null,
        opening_balance: opening || 0,
        notes: notes.trim() || null,
      };
      if (supplier) await superAdminApi.updateSupplier(supplier.id, payload);
      else await superAdminApi.createSupplier(payload);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not save this supplier');
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
              {supplier ? 'Edit Supplier' : 'Add Supplier'}
            </Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
            <ErrorBox message={error} />
            <Field label="SUPPLIER NAME" required>
              <Input value={name} onChangeText={setName} placeholder="e.g. Acme Chemicals" />
            </Field>
            <Field label="BUSINESS NAME">
              <Input value={businessName} onChangeText={setBusinessName} />
            </Field>
            <Field label="PHONE">
              <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            </Field>
            <Field label="EMAIL">
              <Input value={email} onChangeText={setEmail} keyboardType="email-address" />
            </Field>
            <Field label="GSTIN">
              <Input value={gstin} onChangeText={setGstin} placeholder="15 characters" />
            </Field>
            <Field label="ADDRESS">
              <Input value={address} onChangeText={setAddress} multiline />
            </Field>
            <Field label="OPENING BALANCE">
              <Input
                value={opening}
                onChangeText={setOpening}
                keyboardType="decimal-pad"
                placeholder="What was already owed when they were added"
              />
            </Field>
            <Field label="NOTES">
              <Input value={notes} onChangeText={setNotes} multiline />
            </Field>

            <TouchableOpacity
              style={[sa.button, (!name.trim() || busy) && sa.buttonDisabled]}
              onPress={save}
              disabled={!name.trim() || busy}
            >
              {busy ? <ActivityIndicator color={COLORS.Surface} /> : (
                <Text style={sa.buttonText}>{supplier ? 'Save changes' : 'Add supplier'}</Text>
              )}
            </TouchableOpacity>
            <View style={{ height: BORDER_RADIUS.xxl }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * One supplier's purchase history — across every business.
 *
 * Deliberately company-wide, because the question it answers ("what have we
 * bought from them, and what do we owe them") is company-wide. Each row names
 * the business the bill was raised for, so the reader can still see where
 * each purchase belongs.
 */
function SupplierHistoryModal({
  supplier, onClose,
}: {
  supplier: Supplier | null;
  onClose: () => void;
}) {
  const [purchases, setPurchases] = useState<SupplierPurchaseRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (!supplier) return;
    setLoading(true);
    setError('');
    superAdminApi
      .getSupplierPurchases(supplier.id)
      .then((data) => setPurchases(data.purchases))
      .catch((e: any) =>
        setError(e?.response?.data?.message || e.message || 'Could not load the history'))
      .finally(() => setLoading(false));
  }, [supplier]);

  return (
    <Modal
      visible={supplier !== null}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={sa.modalBackdrop}>
        <View style={sa.modalSheet}>
          <View style={sa.header}>
            <Text style={[sa.headerTitle, sa.flex]} numberOfLines={1}>
              {supplier?.name}
            </Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={sa.scroll}>
            <ErrorBox message={error} />
            {supplier ? (
              <View style={[sa.card, { backgroundColor: COLORS.Accent }]}>
                <DetailRow label="Opening balance" value={money(supplier.opening_balance)} />
                <DetailRow label="Total purchased" value={money(supplier.total_purchased)} />
                <DetailRow label="Total paid" value={money(supplier.total_paid)} />
                <DetailRow
                  label="Outstanding"
                  value={
                    <Text
                      style={{
                        color: supplier.outstanding > 0 ? COLORS.Warning : COLORS.Primary,
                        fontFamily: TYPOGRAPHY.fontFamily,
                        fontWeight: '700',
                        fontSize: 16,
                      }}
                    >
                      {money(supplier.outstanding)}
                    </Text>
                  }
                />
              </View>
            ) : null}

            <Text style={sa.cardTitle}>Purchase history</Text>
            {loading ? (
              <Loading />
            ) : purchases.length === 0 ? (
              <Text style={sa.empty}>Nothing has been bought from this supplier yet.</Text>
            ) : (
              purchases.map((purchase) => (
                <View key={purchase.id} style={sa.card}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                    <View style={sa.flex}>
                      <Text style={sa.cardTitle}>{purchase.purchase_number}</Text>
                      <Text style={sa.cardMeta}>
                        {dmy(purchase.purchase_date)} · {''}
                      </Text>
                    </View>
                    <TonePill status={purchase.payment_status} />
                  </View>
                  <View style={{ flexDirection: 'row', marginTop: SPACING.xs }}>
                    <Figure label="Total" value={purchase.total_amount} />
                    <Figure label="Paid" value={purchase.paid_amount} />
                    <Figure
                      label="Balance"
                      value={purchase.balance_amount}
                      tone={purchase.balance_amount > 0 ? COLORS.Warning : undefined}
                    />
                  </View>
                </View>
              ))
            )}
            <View style={{ height: BORDER_RADIUS.xxl }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
