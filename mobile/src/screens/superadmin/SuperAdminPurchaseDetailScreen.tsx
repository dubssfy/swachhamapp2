import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { sa } from './styles';
import { ActionButton } from './SuperAdminCustomerPricesScreen';
import superAdminApi, {
  PurchaseDetail, PurchasePaymentMethod, PurchaseOptions,
} from '../../services/superAdminApi';
import {
  money, dmy, Field, Input, DetailRow, TonePill, Loading, ErrorBox, today,
} from './financeShared';

/**
 * One purchase, in full.
 *
 * READ-ONLY EXCEPT FOR THE ACTIONS. Every figure here was computed by the
 * server when the purchase was saved or a payment was recorded; nothing on
 * this screen recalculates a total, and the whole purchase is re-read after
 * any action so what is shown is always what is stored.
 *
 * RECORDING A PAYMENT is the one place money is entered. The amount is
 * checked against the outstanding balance BY THE SERVER — the form's own
 * check below only saves the operator a round trip, and the server's answer
 * is the one that decides.
 */
export default function SuperAdminPurchaseDetailScreen({ navigation, route }: any) {
  const purchaseId: string = route.params?.purchaseId;

  const [purchase, setPurchase] = useState<PurchaseDetail | null>(null);
  const [options, setOptions] = useState<PurchaseOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [detail, opts] = await Promise.all([
        superAdminApi.getPurchase(purchaseId),
        options ? Promise.resolve(options) : superAdminApi.getPurchaseOptions(),
      ]);
      setPurchase(detail);
      setOptions(opts);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load this purchase');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // `options` is fetched once and reused; it is not a reload trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirmDelete = () => {
    if (!purchase) return;
    Alert.alert(
      'Delete this purchase?',
      `${purchase.purchase_number} — ${money(purchase.total_amount)}.\n\n` +
        'This cannot be undone. A purchase with payments recorded against it cannot be ' +
        'deleted at all — remove those first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await superAdminApi.deletePurchase(purchaseId);
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Not deleted', e?.response?.data?.message || e.message);
            }
          },
        },
      ]
    );
  };

  const removePayment = (paymentId: string, amount: number) => {
    Alert.alert(
      'Remove this payment?',
      `${money(amount)} will be removed and the balance restated.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setPurchase(await superAdminApi.deletePurchasePayment(purchaseId, paymentId));
            } catch (e: any) {
              Alert.alert('Not removed', e?.response?.data?.message || e.message);
            }
          },
        },
      ]
    );
  };

  if (loading) return <Loading />;
  if (!purchase) {
    return (
      <SafeAreaView style={sa.container} edges={['top']}>
        <View style={sa.header}>
          <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
          </TouchableOpacity>
          <Text style={sa.headerTitle}>Purchase</Text>
        </View>
        <ErrorBox message={error || 'This purchase could not be found.'} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>{purchase.purchase_number}</Text>
        <TonePill status={purchase.payment_status} />
      </View>

      <ScrollView
        contentContainerStyle={[sa.scroll, { paddingBottom: 40 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <ErrorBox message={error} />

        {/* ---- THE HEADLINE FIGURES ---- */}
        <View style={[sa.card, { backgroundColor: COLORS.Accent }]}>
          <DetailRow label="Total" value={<Big value={purchase.total_amount} />} />
          <DetailRow label="Paid" value={money(purchase.paid_amount)} />
          <DetailRow
            label="Balance"
            value={
              <Text
                style={{
                  color: purchase.balance_amount > 0 ? COLORS.Warning : COLORS.Primary,
                  fontFamily: TYPOGRAPHY.fontFamily,
                  fontWeight: '700',
                }}
              >
                {money(purchase.balance_amount)}
              </Text>
            }
          />
        </View>

        {/* ---- SUPPLIER ---- */}
        <Text style={sa.cardTitle}>Supplier</Text>
        <View style={sa.card}>
          <DetailRow label="Supplier" value={purchase.supplier_name} />
          {purchase.supplier_phone ? <DetailRow label="Phone" value={purchase.supplier_phone} /> : null}
          {purchase.supplier_gstin ? <DetailRow label="GSTIN" value={purchase.supplier_gstin} /> : null}
          <DetailRow label="Invoice no." value={purchase.invoice_number || '—'} />
          <DetailRow label="Invoice date" value={dmy(purchase.invoice_date)} />
        </View>

        <Text style={sa.cardTitle}>Purchase</Text>
        <View style={sa.card}>
          <DetailRow label="Purchase date" value={dmy(purchase.purchase_date)} />
          <DetailRow label="Due date" value={dmy(purchase.due_date)} />
          <DetailRow label="Status" value={<TonePill status={purchase.purchase_status} />} />
          {purchase.payment_type ? (
            <DetailRow label="Payment type" value={purchase.payment_type.replace(/_/g, ' ')} />
          ) : null}
          {purchase.notes ? <DetailRow label="Notes" value={purchase.notes} /> : null}
        </View>

        {/* ---- ITEMS ----
            Horizontally scrollable, so the columns keep their shape on a
            phone instead of wrapping into something unreadable. */}
        <Text style={sa.cardTitle}>Items ({purchase.items.length})</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator style={sa.tableWrap}>
          <View>
            <View style={sa.tableHeadRow}>
              <Text style={[sa.th, { width: 150 }]}>Item</Text>
              <Text style={[sa.th, { width: 60 }]}>Qty</Text>
              <Text style={[sa.th, { width: 60 }]}>Unit</Text>
              <Text style={[sa.th, { width: 80 }]}>Rate</Text>
              <Text style={[sa.th, { width: 70 }]}>Disc.</Text>
              <Text style={[sa.th, { width: 70 }]}>Tax</Text>
              <Text style={[sa.th, { width: 90 }]}>Amount</Text>
            </View>
            {purchase.items.map((item, index) => (
              <View key={`${item.description}-${index}`} style={sa.tableRow}>
                <Text style={[sa.td, { width: 150 }]} numberOfLines={2}>{item.description}</Text>
                <Text style={[sa.td, { width: 60 }]}>{item.quantity}</Text>
                <Text style={[sa.td, { width: 60 }]}>{item.unit || '—'}</Text>
                <Text style={[sa.td, { width: 80 }]}>{item.rate}</Text>
                <Text style={[sa.td, { width: 70 }]}>{item.discount}</Text>
                <Text style={[sa.td, { width: 70 }]}>{item.tax}</Text>
                <Text style={[sa.td, sa.tdPrice, { width: 90 }]}>{item.amount}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* ---- THE BILL'S ARITHMETIC, as the server computed it ---- */}
        <View style={sa.card}>
          <DetailRow label="Subtotal" value={money(purchase.subtotal)} />
          {purchase.discount > 0 ? <DetailRow label="Discount" value={`- ${money(purchase.discount)}`} /> : null}
          {purchase.tax > 0 ? <DetailRow label="Tax" value={money(purchase.tax)} /> : null}
          {purchase.shipping_charges > 0 ? <DetailRow label="Shipping" value={money(purchase.shipping_charges)} /> : null}
          {purchase.additional_charges > 0 ? <DetailRow label="Other charges" value={money(purchase.additional_charges)} /> : null}
          {purchase.round_off !== 0 ? <DetailRow label="Round off" value={money(purchase.round_off)} /> : null}
          <View style={{ borderTopWidth: 1, borderTopColor: COLORS.Border, marginTop: 4, paddingTop: 4 }}>
            <DetailRow label="Grand total" value={<Big value={purchase.total_amount} />} />
          </View>
        </View>

        {/* ---- PAYMENTS ---- */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[sa.cardTitle, sa.flex]}>Payments ({purchase.payments.length})</Text>
          {purchase.balance_amount > 0 && (
            <ActionButton
              icon="cash-outline"
              label="Record Payment"
              tone="primary"
              onPress={() => setPaying(true)}
              accessibilityLabel="Record a payment against this purchase"
            />
          )}
        </View>

        {purchase.payments.length === 0 ? (
          <Text style={sa.empty}>Nothing has been paid against this purchase yet.</Text>
        ) : (
          purchase.payments.map((payment) => (
            <View key={payment.id} style={sa.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <View style={sa.flex}>
                  <Text style={sa.cardTitle}>{money(payment.amount)}</Text>
                  <Text style={sa.cardMeta}>
                    {dmy(payment.payment_date)} · {payment.payment_method_label}
                    {payment.reference_number ? ` · ${payment.reference_number}` : ''}
                  </Text>
                  {payment.notes ? <Text style={sa.cardMeta}>{payment.notes}</Text> : null}
                </View>
                <ActionButton
                  icon="trash-outline"
                  label="Remove"
                  tone="danger"
                  onPress={() => removePayment(payment.id, payment.amount)}
                  accessibilityLabel={`Remove the ${money(payment.amount)} payment`}
                />
              </View>
            </View>
          ))
        )}

        {/* ---- ACTIONS ---- */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.md }}>
          <ActionButton
            icon="create-outline"
            label="Edit"
            tone="primary"
            onPress={() =>
              navigation.navigate('SuperAdminPurchaseForm', { purchaseId })}
          />
          <ActionButton icon="trash-outline" label="Delete" tone="danger" onPress={confirmDelete} />
        </View>
      </ScrollView>

      <RecordPaymentModal
        visible={paying}
        purchase={purchase}
        methods={options?.payment_methods ?? []}
        onClose={() => setPaying(false)}
        onRecorded={(updated) => { setPurchase(updated); setPaying(false); }}
      />
    </SafeAreaView>
  );
}

function Big({ value }: { value: number }) {
  return (
    <Text
      style={{
        color: COLORS.TextPrimary,
        fontFamily: TYPOGRAPHY.fontFamily,
        fontWeight: '700',
        fontSize: 17,
      }}
    >
      {money(value)}
    </Text>
  );
}

/**
 * Record Payment.
 *
 * THE OUTSTANDING BALANCE IS THE SERVER'S. It is shown here from the purchase
 * just loaded, and the amount is checked against it before sending — but the
 * server checks it again against the database, so two operators paying the
 * same bill at once cannot between them overpay it.
 */
function RecordPaymentModal({
  visible, purchase, methods, onClose, onRecorded,
}: {
  visible: boolean;
  purchase: PurchaseDetail;
  methods: Array<{ value: PurchasePaymentMethod; label: string }>;
  onClose: () => void;
  onRecorded: (purchase: PurchaseDetail) => void;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PurchasePaymentMethod>('CASH');
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (!visible) return;
    // Defaults to settling the bill in full, which is the common case.
    setAmount(String(purchase.balance_amount));
    setDate(today());
    setReference('');
    setNotes('');
    setError('');
  }, [visible, purchase.balance_amount]);

  const value = Number(amount);
  const invalid =
    !Number.isFinite(value) || value <= 0 || value > purchase.balance_amount + 0.005;

  const save = async () => {
    if (invalid || busy) return;
    setBusy(true);
    setError('');
    try {
      onRecorded(await superAdminApi.recordPurchasePayment(purchase.id, {
        amount, payment_method: method, payment_date: date,
        reference_number: reference.trim() || null,
        notes: notes.trim() || null,
      }));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not record this payment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sa.modalBackdrop}>
        <View style={sa.modalSheet}>
          <View style={sa.header}>
            <Text style={[sa.headerTitle, sa.flex]}>Record Payment</Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
            <ErrorBox message={error} />
            <View style={sa.card}>
              <Text style={sa.cardTitle}>{purchase.purchase_number}</Text>
              <Text style={sa.cardMeta}>{purchase.supplier_name}</Text>
              <DetailRow label="Outstanding" value={<Big value={purchase.balance_amount} />} />
            </View>

            <Field label="AMOUNT" required>
              <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            </Field>
            {invalid && amount !== '' ? (
              <Text style={[sa.cardMeta, { color: COLORS.Error }]}>
                Enter an amount between 0 and {money(purchase.balance_amount)}.
              </Text>
            ) : null}

            <Field label="PAYMENT METHOD" required>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
                {methods.map((option) => {
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

            <Field label="PAYMENT DATE" required>
              <Input value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
            </Field>
            <Field label="REFERENCE">
              <Input value={reference} onChangeText={setReference} placeholder="UPI ref / cheque no." />
            </Field>
            <Field label="NOTES">
              <Input value={notes} onChangeText={setNotes} multiline />
            </Field>

            <TouchableOpacity
              style={[sa.button, (invalid || busy) && sa.buttonDisabled]}
              onPress={save}
              disabled={invalid || busy}
            >
              {busy ? <ActivityIndicator color={COLORS.Surface} /> : (
                <Text style={sa.buttonText}>Record payment</Text>
              )}
            </TouchableOpacity>
            <View style={{ height: BORDER_RADIUS.xxl }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
