import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, {
  Supplier, PurchaseDetail, PurchasePaymentMethod, PurchaseOptions,
} from '../../services/superAdminApi';
import { money, Field, Input, Loading, ErrorBox, today } from './financeShared';

/**
 * Add / Edit Purchase.
 *
 * THE TOTALS ON THIS SCREEN ARE A PREVIEW, NOT THE SOURCE OF TRUTH.
 *
 * The same arithmetic runs on the server, and what gets stored is what the
 * server computes from the lines — this form sends lines and charges and no
 * total at all. The figures below exist so the operator sees the bill add up
 * as they type; if the two ever disagreed, the server's answer is the one
 * that is saved, and the saved purchase is re-read afterwards.
 *
 * The formula, matching `computeTotals` in the backend exactly:
 *
 *   line     = (quantity x rate) - discount + tax
 *   subtotal = sum of (quantity x rate)
 *   total    = subtotal - discounts + tax + charges + shipping + round off
 */

const num = (value: string): number => {
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Rupees, to two places — the same rounding the server applies per step. */
const r2 = (value: number) => Math.round(value * 100) / 100;

interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  discount: string;
  tax: string;
}

const emptyLine = (): LineDraft => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  description: '',
  quantity: '1',
  unit: '',
  rate: '',
  discount: '',
  tax: '',
});

export default function SuperAdminPurchaseFormScreen({ navigation, route }: any) {
  /** Present when editing; absent when adding. */
  const purchaseId: string | undefined = route.params?.purchaseId;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [options, setOptions] = useState<PurchaseOptions | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [pickingSupplier, setPickingSupplier] = useState(false);
  const [addingSupplier, setAddingSupplier] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [paymentType, setPaymentType] = useState<PurchasePaymentMethod | ''>('');
  const [notes, setNotes] = useState('');

  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [billDiscount, setBillDiscount] = useState('');
  const [additional, setAdditional] = useState('');
  const [shipping, setShipping] = useState('');
  const [roundOff, setRoundOff] = useState('');

  const [loading, setLoading] = useState(Boolean(purchaseId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    superAdminApi.getSuppliers().then((d) => setSuppliers(d.suppliers)).catch(() => {});
    superAdminApi.getPurchaseOptions().then(setOptions).catch(() => {});
  }, []);

  // Editing: the existing purchase is loaded into the form as it stands.
  useEffect(() => {
    if (!purchaseId) return;
    superAdminApi
      .getPurchase(purchaseId)
      .then((purchase: PurchaseDetail) => {
        setSupplierId(purchase.supplier_id);
        setInvoiceNumber(purchase.invoice_number || '');
        setInvoiceDate(purchase.invoice_date || '');
        setPurchaseDate(purchase.purchase_date);
        setDueDate(purchase.due_date || '');
        setPaymentType(purchase.payment_type || '');
        setNotes(purchase.notes || '');
        setAdditional(purchase.additional_charges ? String(purchase.additional_charges) : '');
        setShipping(purchase.shipping_charges ? String(purchase.shipping_charges) : '');
        setRoundOff(purchase.round_off ? String(purchase.round_off) : '');
        /*
         * The BILL-LEVEL discount is the stored total discount minus what the
         * lines account for: the server stores them added together, and the
         * form edits them separately.
         */
        const lineDiscounts = purchase.items.reduce((sum, item) => sum + item.discount, 0);
        const billOnly = r2(purchase.discount - lineDiscounts);
        setBillDiscount(billOnly > 0 ? String(billOnly) : '');
        setLines(
          purchase.items.map((item) => ({
            key: `${item.description}-${Math.random().toString(36).slice(2, 8)}`,
            description: item.description,
            quantity: String(item.quantity),
            unit: item.unit || '',
            rate: String(item.rate),
            discount: item.discount ? String(item.discount) : '',
            tax: item.tax ? String(item.tax) : '',
          }))
        );
      })
      .catch((e: any) =>
        setError(e?.response?.data?.message || e.message || 'Could not load this purchase'))
      .finally(() => setLoading(false));
  }, [purchaseId]);

  const supplier = suppliers.find((s) => s.id === supplierId) || null;

  /**
   * The live preview of what the server will compute.
   *
   * Kept deliberately identical to `computeTotals` on the backend, including
   * the per-step rounding — a preview that rounds differently would show a
   * total the saved bill does not have.
   */
  const totals = useMemo(() => {
    const computed = lines.map((line) => {
      const gross = r2(num(line.quantity) * num(line.rate));
      return {
        gross,
        discount: num(line.discount),
        tax: num(line.tax),
        amount: r2(gross - num(line.discount) + num(line.tax)),
      };
    });
    const subtotal = r2(computed.reduce((sum, line) => sum + line.gross, 0));
    const lineDiscount = r2(computed.reduce((sum, line) => sum + line.discount, 0));
    const tax = r2(computed.reduce((sum, line) => sum + line.tax, 0));
    const discount = r2(lineDiscount + num(billDiscount));
    const total = r2(
      subtotal - discount + tax + num(additional) + num(shipping) + num(roundOff)
    );
    return { computed, subtotal, discount, tax, total };
  }, [lines, billDiscount, additional, shipping, roundOff]);

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const removeLine = (key: string) =>
    setLines((current) => (current.length === 1 ? current : current.filter((l) => l.key !== key)));

  /** What stops a save that the server would only reject. */
  const problems: string[] = [];
  if (!supplierId) problems.push('Choose a supplier.');
  if (!purchaseDate) problems.push('Enter the purchase date.');
  lines.forEach((line, index) => {
    if (!line.description.trim()) problems.push(`Line ${index + 1}: enter a description.`);
    if (num(line.quantity) <= 0) problems.push(`Line ${index + 1}: quantity must be more than 0.`);
    if (totals.computed[index] && totals.computed[index].discount > totals.computed[index].gross) {
      problems.push(`Line ${index + 1}: the discount is larger than the line.`);
    }
  });
  if (Math.abs(num(roundOff)) > 1) problems.push('Round off cannot be more than 1 rupee.');
  if (totals.total < 0) problems.push('The total cannot be negative. Check the discounts.');

  const save = async () => {
    if (problems.length > 0 || saving) return;
    setSaving(true);
    setError('');
    try {
      /*
       * NO TOTAL IS SENT. Only the lines and the charges — the server derives
       * every figure from them, so what is stored cannot be something this
       * screen decided.
       */
      const payload = {
        supplier_id: supplierId,
        invoice_number: invoiceNumber.trim() || null,
        invoice_date: invoiceDate.trim() || null,
        purchase_date: purchaseDate,
        due_date: dueDate.trim() || null,
        payment_type: paymentType || null,
        notes: notes.trim() || null,
        discount: billDiscount || 0,
        additional_charges: additional || 0,
        shipping_charges: shipping || 0,
        round_off: roundOff || 0,
        items: lines.map((line) => ({
          description: line.description.trim(),
          quantity: line.quantity,
          unit: line.unit.trim() || null,
          rate: line.rate || 0,
          discount: line.discount || 0,
          tax: line.tax || 0,
        })),
      };

      const saved = purchaseId
        ? await superAdminApi.updatePurchase(purchaseId, payload)
        : await superAdminApi.createPurchase(payload);

      // The server's own total, read back — so the operator is told what was
      // actually stored rather than what this screen predicted.
      Alert.alert(
        purchaseId ? 'Purchase updated' : 'Purchase saved',
        `${saved.purchase_number} — ${money(saved.total_amount)}`
      );
      navigation.replace('SuperAdminPurchaseDetail', {
        purchaseId: saved.id,
      });
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not save this purchase');
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
        <Text style={[sa.headerTitle, { flex: 1 }]}>
          {purchaseId ? 'Edit Purchase' : 'Add Purchase'}
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

          {/* ---- SUPPLIER ---- */}
          <Text style={sa.cardTitle}>Supplier</Text>
          <Field label="SUPPLIER" required>
            <TouchableOpacity
              style={[sa.input, { flexDirection: 'row', alignItems: 'center' }]}
              onPress={() => setPickingSupplier(true)}
            >
              <Text
                style={[sa.flex, { color: supplier ? COLORS.TextPrimary : COLORS.TextSecondary }]}
                numberOfLines={1}
              >
                {supplier ? supplier.name : 'Choose a supplier'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={COLORS.TextSecondary} />
            </TouchableOpacity>
          </Field>

          <TouchableOpacity style={sa.addEntryBtn} onPress={() => setAddingSupplier(true)}>
            <Ionicons name="add-circle-outline" size={16} color={COLORS.Primary} />
            <Text style={sa.addEntryText}>Add New Supplier</Text>
          </TouchableOpacity>

          {/* The supplier's own details, shown once chosen — read-only here,
              because they belong to the supplier record, not to this bill. */}
          {supplier ? (
            <View style={sa.readOnlyBox}>
              <Text style={sa.readOnlyText}>
                {supplier.phone ? `Phone: ${supplier.phone}\n` : ''}
                {supplier.gstin ? `GSTIN: ${supplier.gstin}\n` : ''}
                {supplier.address ? `${supplier.address}` : ''}
                {!supplier.phone && !supplier.gstin && !supplier.address
                  ? 'No contact details recorded for this supplier.' : ''}
              </Text>
            </View>
          ) : null}

          <Field label="SUPPLIER INVOICE NUMBER">
            <Input value={invoiceNumber} onChangeText={setInvoiceNumber} placeholder="e.g. INV-2291" />
          </Field>
          <Field label="SUPPLIER INVOICE DATE">
            <Input value={invoiceDate} onChangeText={setInvoiceDate} placeholder="YYYY-MM-DD" />
          </Field>

          {/* ---- PURCHASE ---- */}
          <Text style={[sa.cardTitle, { marginTop: SPACING.md }]}>Purchase</Text>
          <Field label="PURCHASE DATE" required>
            <Input value={purchaseDate} onChangeText={setPurchaseDate} placeholder="YYYY-MM-DD" />
          </Field>
          <Field label="DUE DATE">
            <Input value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" />
          </Field>
          <Field label="PAYMENT TYPE">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
              {(options?.payment_methods ?? []).map((method) => {
                const on = paymentType === method.value;
                return (
                  <TouchableOpacity
                    key={method.value}
                    style={[sa.filterChip, on && sa.filterChipOn]}
                    onPress={() => setPaymentType(on ? '' : method.value)}
                  >
                    <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>
                      {method.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Field>

          {/* ---- ITEMS ---- */}
          <Text style={[sa.cardTitle, { marginTop: SPACING.md }]}>Items</Text>
          {lines.map((line, index) => (
            <View key={line.key} style={sa.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[sa.cardTitle, sa.flex]}>Item {index + 1}</Text>
                {lines.length > 1 && (
                  <TouchableOpacity
                    onPress={() => removeLine(line.key)}
                    accessibilityLabel={`Remove item ${index + 1}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={COLORS.Error} />
                  </TouchableOpacity>
                )}
              </View>

              <Field label="DESCRIPTION" required>
                <Input
                  value={line.description}
                  onChangeText={(text) => updateLine(line.key, { description: text })}
                  placeholder="e.g. Laundry Detergent"
                />
              </Field>

              <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
                <View style={sa.flex}>
                  <Field label="QUANTITY" required>
                    <Input
                      value={line.quantity}
                      onChangeText={(text) => updateLine(line.key, { quantity: text })}
                      keyboardType="decimal-pad"
                    />
                  </Field>
                </View>
                <View style={sa.flex}>
                  <Field label="UNIT">
                    <Input
                      value={line.unit}
                      onChangeText={(text) => updateLine(line.key, { unit: text })}
                      placeholder="Nos / L / kg"
                    />
                  </Field>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
                <View style={sa.flex}>
                  <Field label="RATE" required>
                    <Input
                      value={line.rate}
                      onChangeText={(text) => updateLine(line.key, { rate: text })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                    />
                  </Field>
                </View>
                <View style={sa.flex}>
                  <Field label="DISCOUNT">
                    <Input
                      value={line.discount}
                      onChangeText={(text) => updateLine(line.key, { discount: text })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                    />
                  </Field>
                </View>
                <View style={sa.flex}>
                  <Field label="TAX">
                    <Input
                      value={line.tax}
                      onChangeText={(text) => updateLine(line.key, { tax: text })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                    />
                  </Field>
                </View>
              </View>

              {/* The line's own amount, updating as the row is typed. */}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  borderTopWidth: 1,
                  borderTopColor: COLORS.Border,
                  paddingTop: SPACING.xs,
                  marginTop: SPACING.xs,
                }}
              >
                <Text style={sa.cardMeta}>Amount</Text>
                <Text style={sa.tdPrice}>{money(totals.computed[index]?.amount ?? 0)}</Text>
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={sa.addEntryBtn}
            onPress={() => setLines((current) => [...current, emptyLine()])}
          >
            <Ionicons name="add-circle-outline" size={16} color={COLORS.Primary} />
            <Text style={sa.addEntryText}>Add Item</Text>
          </TouchableOpacity>

          {/* ---- CHARGES ---- */}
          <Text style={[sa.cardTitle, { marginTop: SPACING.md }]}>Charges</Text>
          <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
            <View style={sa.flex}>
              <Field label="EXTRA DISCOUNT">
                <Input value={billDiscount} onChangeText={setBillDiscount} keyboardType="decimal-pad" placeholder="0.00" />
              </Field>
            </View>
            <View style={sa.flex}>
              <Field label="SHIPPING">
                <Input value={shipping} onChangeText={setShipping} keyboardType="decimal-pad" placeholder="0.00" />
              </Field>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
            <View style={sa.flex}>
              <Field label="OTHER CHARGES">
                <Input value={additional} onChangeText={setAdditional} keyboardType="decimal-pad" placeholder="0.00" />
              </Field>
            </View>
            <View style={sa.flex}>
              <Field label="ROUND OFF">
                <Input value={roundOff} onChangeText={setRoundOff} keyboardType="decimal-pad" placeholder="-0.40" />
              </Field>
            </View>
          </View>

          {/* ---- THE PREVIEW ---- */}
          <View style={[sa.card, { backgroundColor: COLORS.Accent }]}>
            <Total label="Subtotal" value={totals.subtotal} />
            <Total label="Discount" value={-totals.discount} />
            <Total label="Tax" value={totals.tax} />
            <Total label="Shipping" value={num(shipping)} />
            <Total label="Other charges" value={num(additional)} />
            <Total label="Round off" value={num(roundOff)} />
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: COLORS.Border,
                marginTop: SPACING.xs,
                paddingTop: SPACING.xs,
              }}
            >
              <Total label="Grand Total" value={totals.total} strong />
            </View>
            <Text style={[sa.cardMeta, { fontSize: 10, marginTop: SPACING.xs }]}>
              The server recalculates every figure when this is saved. If anything differs,
              the saved purchase is what counts.
            </Text>
          </View>

          <Field label="NOTES">
            <Input value={notes} onChangeText={setNotes} multiline placeholder="Anything worth recording" />
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
            {saving ? (
              <ActivityIndicator color={COLORS.Surface} />
            ) : (
              <Text style={sa.buttonText}>
                {purchaseId ? 'Save changes' : 'Save purchase'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <SupplierPickerModal
        visible={pickingSupplier}
        suppliers={suppliers}
        onSelect={(id) => { setSupplierId(id); setPickingSupplier(false); }}
        onClose={() => setPickingSupplier(false)}
      />
      <NewSupplierModal
        visible={addingSupplier}
        onClose={() => setAddingSupplier(false)}
        onCreated={(created) => {
          setSuppliers((current) => [...current, created]);
          setSupplierId(created.id);
          setAddingSupplier(false);
        }}
      />
    </SafeAreaView>
  );
}

function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  if (!strong && Math.abs(value) < 0.005) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <Text style={[sa.cardMeta, strong && { color: COLORS.TextPrimary, fontWeight: '700' }]}>
        {label}
      </Text>
      <Text
        style={{
          color: COLORS.TextPrimary,
          fontFamily: TYPOGRAPHY.fontFamily,
          fontWeight: strong ? '700' : '600',
          fontSize: strong ? 16 : 13,
        }}
      >
        {money(value)}
      </Text>
    </View>
  );
}

function SupplierPickerModal({
  visible, suppliers, onSelect, onClose,
}: {
  visible: boolean;
  suppliers: Supplier[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const shown = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sa.modalBackdrop}>
        <View style={sa.modalSheet}>
          <View style={sa.header}>
            <Text style={[sa.headerTitle, sa.flex]}>Select Supplier</Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: SPACING.md }}>
            <TextInput
              style={sa.input}
              placeholder="Search suppliers"
              placeholderTextColor={COLORS.TextSecondary}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <ScrollView contentContainerStyle={sa.scroll}>
            {shown.length === 0 ? (
              <Text style={sa.empty}>No supplier matches. Add one from the form.</Text>
            ) : (
              shown.map((s) => (
                <TouchableOpacity key={s.id} style={sa.card} onPress={() => onSelect(s.id)}>
                  <Text style={sa.cardTitle}>{s.name}</Text>
                  <Text style={sa.cardMeta}>
                    {s.phone || 'No phone'}
                    {s.outstanding > 0 ? ` · ${money(s.outstanding)} outstanding` : ''}
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

/** Add New Supplier, without leaving the purchase being written. */
function NewSupplierModal({
  visible, onClose, onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (supplier: Supplier) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gstin, setGstin] = useState('');
  const [address, setAddress] = useState('');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await superAdminApi.createSupplier({
        name: name.trim(),
        phone: phone.trim() || null,
        gstin: gstin.trim() || null,
        address: address.trim() || null,
        opening_balance: opening || 0,
      });
      setName(''); setPhone(''); setGstin(''); setAddress(''); setOpening('');
      onCreated(created);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not add this supplier');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sa.modalBackdrop}>
        <View style={sa.modalSheet}>
          <View style={sa.header}>
            <Text style={[sa.headerTitle, sa.flex]}>Add Supplier</Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
            <ErrorBox message={error} />
            <Field label="SUPPLIER NAME" required>
              <Input value={name} onChangeText={setName} placeholder="e.g. Acme Chemicals" />
            </Field>
            <Field label="PHONE">
              <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
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
                placeholder="What is already owed to them"
              />
            </Field>
            <TouchableOpacity
              style={[sa.button, (!name.trim() || busy) && sa.buttonDisabled]}
              onPress={save}
              disabled={!name.trim() || busy}
            >
              {busy ? <ActivityIndicator color={COLORS.Surface} /> : (
                <Text style={sa.buttonText}>Add supplier</Text>
              )}
            </TouchableOpacity>
            <View style={{ height: BORDER_RADIUS.xxl }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
