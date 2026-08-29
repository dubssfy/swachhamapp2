import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
  TextInput, Alert, Modal, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { sa, STATUS_TONE } from './styles';
import superAdminApi, {
  BusinessAccountSummary, BusinessAccountOrder, PaymentContext,
  PaymentReceipt, PaymentTypeValue, InvoiceHistoryEntry,
} from '../../services/superAdminApi';
import { ActionButton } from './SuperAdminCustomerPricesScreen';
import GstInvoiceModal from './GstInvoiceModal';
import WalkingOrderModal from './WalkingOrderModal';
/*
 * THE EXISTING Order Confirmation PDF generator, imported as-is.
 *
 * Not a Super Admin variant of it: the same function the Business app and the
 * Sorter already call, rendering the same template from the same order shape.
 * That is what makes the PDF opened here the very document the business gets,
 * mobile number and establishment name included.
 */
import { generateOrderPdf, buildPdfBaseName } from '../../utils/businessOrderPdf';
/*
 * "Open PDF" hands the document to the PHONE, not to this app — see
 * `openPdf.ts`. One helper, so every Open PDF in the Super Admin behaves the
 * same way on the same device.
 */
import { openPdfInDeviceViewer } from '../../utils/openPdf';

/**
 * Business Account.
 *
 *   Select Business  ->  ORDER DETAIL | PAYMENT RECEIPT
 *
 * ONE BUSINESS IS IN CONTEXT AT A TIME, and everything below the picker
 * belongs to it: its orders, its invoices, its payments and its balances. The
 * server scopes every call by the business in the path, so this screen cannot
 * show one business's figures under another's name even if it tried.
 *
 * GENERATE INVOICE IS THE EXISTING ONE, now in the Invoices tab.
 * `GstInvoiceModal` is the same
 * component and the same endpoints the business list used to open; only the
 * button moved here, into Order Detail, where an order is on screen.
 *
 * NOTHING IS CALCULATED HERE. The Payment Receipt form shows a running
 * remaining balance as the amount is typed, but the figures it starts from and
 * the figures that get stored are both the server's — see the note on the
 * amount field.
 */

const money = (value: unknown) => `INR ${Number(value || 0).toFixed(2)}`;

const PAYMENT_TYPES: Array<{ value: PaymentTypeValue; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'UPI', label: 'UPI' },
  { value: 'NETBANKING', label: 'Netbanking' },
];

/** Today, as YYYY-MM-DD, for the payment date's default. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const dmy = (iso: string) => {
  const [y, m, d] = String(iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso || '');
};

export default function SuperAdminBusinessAccountScreen({ navigation }: any) {
  const [businesses, setBusinesses] = useState<BusinessAccountSummary[]>([]);
  const [selected, setSelected] = useState<BusinessAccountSummary | null>(null);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [tab, setTab] = useState<'orders' | 'invoices' | 'payments'>('orders');

  const loadBusinesses = useCallback(async () => {
    setError('');
    try {
      setBusinesses(await superAdminApi.getBusinessAccounts());
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load businesses');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadBusinesses(); }, [loadBusinesses]));

  // Searched locally: the whole list is one page.
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return businesses;
    return businesses.filter((b) =>
      b.name.toLowerCase().includes(needle) ||
      (b.legal_name || '').toLowerCase().includes(needle) ||
      (b.gst_number || '').toLowerCase().includes(needle));
  }, [businesses, search]);

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={sa.headerTitle}>Business Account</Text>
      </View>

      {loading ? (
        <View style={sa.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        <>
          {/* ---- Select Business ---- */}
          <View style={{ paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm }}>
            <Text style={sa.label}>SELECT BUSINESS</Text>
            <TouchableOpacity
              style={[sa.input, { flexDirection: 'row', alignItems: 'center' }]}
              onPress={() => setPicking(true)}
              accessibilityRole="button"
              accessibilityLabel="Choose a business"
            >
              <Text style={[sa.flex, { color: selected ? COLORS.TextPrimary : COLORS.TextSecondary }]}>
                {selected ? selected.name : 'Choose a business'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={COLORS.TextSecondary} />
            </TouchableOpacity>
          </View>

          {!!error && (
            <View style={[sa.errorBox, { marginHorizontal: SPACING.md }]}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
              <Text style={sa.errorText}>{error}</Text>
            </View>
          )}

          {!selected ? (
            <Text style={sa.empty}>
              Choose a business to see its orders, invoices and payments.
            </Text>
          ) : (
            <>
              {/* ---- The three sections ---- */}
              <View style={sa.tabs}>
                <TabButton
                  label="Order Detail"
                  on={tab === 'orders'}
                  onPress={() => setTab('orders')}
                />
                <TabButton
                  label="Invoices"
                  on={tab === 'invoices'}
                  onPress={() => setTab('invoices')}
                />
                <TabButton
                  label="Payments"
                  on={tab === 'payments'}
                  onPress={() => setTab('payments')}
                />
              </View>

              {/* `key` on the business id remounts each tab when the business
                  changes, so a tab can never briefly show the previous
                  business's rows while its own load is in flight. */}
              {tab === 'orders' ? (
                <OrderDetailTab key={selected.id} business={selected} />
              ) : tab === 'invoices' ? (
                <InvoiceHistoryTab key={selected.id} business={selected} />
              ) : (
                <PaymentReceiptTab key={selected.id} business={selected} />
              )}
            </>
          )}
        </>
      )}

      {/* ---- Business picker ---- */}
      <Modal visible={picking} animationType="slide" transparent onRequestClose={() => setPicking(false)}>
        <View style={sa.modalBackdrop}>
          <View style={sa.modalSheet}>
            <View style={sa.header}>
              <Text style={[sa.headerTitle, { flex: 1 }]}>Select Business</Text>
              <TouchableOpacity style={sa.iconBtn} onPress={() => setPicking(false)}>
                <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
              </TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: SPACING.md }}>
              <TextInput
                style={sa.input}
                placeholder="Search by establishment name, legal name or GSTIN"
                placeholderTextColor={COLORS.TextSecondary}
                value={search}
                onChangeText={setSearch}
              />
            </View>
            <ScrollView contentContainerStyle={sa.scroll}>
              {shown.length === 0 ? (
                <Text style={sa.empty}>No business matches that search.</Text>
              ) : (
                shown.map((b) => (
                  <TouchableOpacity
                    key={b.id}
                    style={sa.card}
                    onPress={() => { setSelected(b); setPicking(false); setTab('orders'); }}
                  >
                    {/* The ESTABLISHMENT name is the display name. */}
                    <Text style={sa.cardTitle}>{b.name}</Text>
                    {b.legal_name && b.legal_name !== b.name ? (
                      <Text style={sa.cardMeta}>Legal name: {b.legal_name}</Text>
                    ) : null}
                    <Text style={sa.cardMeta}>
                      {b.order_count} order{b.order_count === 1 ? '' : 's'} ·{' '}
                      {b.receipt_count} receipt{b.receipt_count === 1 ? '' : 's'}
                      {b.gst_number ? ` · ${b.gst_number}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function TabButton({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[sa.tab, on && sa.tabActive]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
    >
      <Text style={[sa.tabText, on && sa.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ===================================================================
 * ORDER DETAIL
 * =================================================================== */

/**
 * This business's orders.
 *
 * GENERATE INVOICE IS NOT HERE. It lives in the Invoices tab, beside the
 * invoices it produces — it used to sit here, one tab away from its own
 * output. Backdating a walking order stays, because it creates an ORDER and
 * this is the order section.
 */
function OrderDetailTab({ business }: { business: BusinessAccountSummary }) {
  const [orders, setOrders] = useState<BusinessAccountOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [walkingOpen, setWalkingOpen] = useState(false);
  /** The order whose PDF is being built, so only its own row shows a spinner. */
  const [pdfFor, setPdfFor] = useState<string | null>(null);
  /** The order whose "More Options" menu is open, or null when it is closed. */
  const [menuOrder, setMenuOrder] = useState<BusinessAccountOrder | null>(null);
  /** True while a More Options action is generating/handing off the PDF. */
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await superAdminApi.getBusinessAccountOrders(business.id);
      setOrders(data.orders);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load orders');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [business.id]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  /**
   * The Order Confirmation PDF for one order.
   *
   * THE EXISTING DOCUMENT, not a new one. The order is fetched in the shape
   * the business app uses and handed to the same `generateOrderPdf` the
   * business and the Sorter call, so what opens here is the same PDF with the
   * same layout — the establishment name at its head, and the number the
   * order was actually placed on as its Mobile Number.
   *
   * Read-only from end to end: it fetches an order and renders it. No order is
   * created, none is modified, and nothing is written back.
   */
  const handleViewPdf = async (order: BusinessAccountOrder) => {
    if (pdfFor) return;
    setError('');
    setPdfFor(order.id);
    try {
      const data = await superAdminApi.getBusinessAccountOrder(business.id, order.id);
      const { uri, fileName } = await generateOrderPdf(data.order);
      // Opens in the DEVICE's PDF viewer, exactly as More Options -> Open PDF
      // does: the two buttons open the same document, so they open it the
      // same way rather than one going to a viewer and the other to a sheet.
      const outcome = await openPdfInDeviceViewer(uri, fileName);
      if (outcome === 'unavailable') Alert.alert('PDF ready', fileName);
    } catch (e: any) {
      setError(
        e?.response?.data?.message || e.message || 'Could not open the order confirmation PDF'
      );
    } finally {
      setPdfFor(null);
    }
  };

  /* ---- More Options ----
   *
   * Every action uses the SAME existing generator: fetch the order in the shape
   * the app already uses, hand it to `generateOrderPdf`, then perform the
   * native action on the resulting file. No second PDF path.
   */
  const buildOrderPdf = async (o: BusinessAccountOrder) => {
    const data = await superAdminApi.getBusinessAccountOrder(business.id, o.id);
    return generateOrderPdf(data.order);
  };

  const shareOrderPdf = async (uri: string, fileName: string) => {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('PDF ready', fileName);
      return;
    }
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: fileName,
      UTI: 'com.adobe.pdf',
    });
  };

  const runPdfAction = async (
    o: BusinessAccountOrder,
    action: 'open' | 'print' | 'share' | 'save'
  ) => {
    if (actionBusy) return;
    setMenuOrder(null);
    setActionBusy(true);
    setError('');
    try {
      const { uri, fileName } = await buildOrderPdf(o);

      // Print reads the file path literally. The generated URI is
      // percent-encoded (the order number's "#" becomes "%23"), which Share and
      // Save decode fine but the print service does not — so give it a copy
      // under a plain ASCII name.
      let plainUri = uri;
      if (action === 'print') {
        try {
          const safe = `${FileSystem.cacheDirectory}order-pdf.pdf`;
          await FileSystem.deleteAsync(safe, { idempotent: true });
          await FileSystem.copyAsync({ from: uri, to: safe });
          plainUri = safe;
        } catch {
          // Keep the original URI if the copy fails.
        }
      }

      if (action === 'open') {
        /*
         * THE DEVICE'S OWN PDF VIEWER, not this app.
         *
         * `openPdfInDeviceViewer` fires a real ACTION_VIEW intent on Android
         * with a FileProvider content URI and a read grant, so the OS shows
         * whichever PDF apps are installed and the chosen one can actually
         * read the file. iOS has no "default PDF app" to open into, so it
         * gets the share sheet, which is that platform's document handoff.
         */
        const outcome = await openPdfInDeviceViewer(uri, fileName);
        if (outcome === 'unavailable') Alert.alert('PDF ready', fileName);
        return;
      }

      if (action === 'print') {
        try {
          await Print.printAsync({ uri: plainUri });
        } catch (e: any) {
          // Dismissing the print dialog is a normal outcome, not a failure.
          if (/cancel|dismiss/i.test(String(e?.message || ''))) return;
          // No printing on this device — offer the file instead of losing it.
          if (await Sharing.isAvailableAsync()) {
            await shareOrderPdf(uri, fileName);
            return;
          }
          throw e;
        }
        return;
      }

      if (action === 'share') {
        await shareOrderPdf(uri, fileName);
        return;
      }

      // save
      if (Platform.OS !== 'android') {
        // iOS has no public Downloads folder; the sheet's "Save to Files" is the
        // platform-appropriate save.
        await shareOrderPdf(uri, fileName);
        return;
      }
      const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Not saved', 'Storage permission was declined.');
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const dest = await FileSystem.StorageAccessFramework.createFileAsync(
        perm.directoryUri,
        buildPdfBaseName(o.order_number, business.name),
        'application/pdf'
      );
      await FileSystem.writeAsStringAsync(dest, base64, { encoding: 'base64' });
      Alert.alert('Saved', 'The order PDF was saved to the folder you chose.');
    } catch (e: any) {
      setError(
        e?.response?.data?.message || e?.message || 'Could not complete that PDF action.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={sa.centered}>
        <ActivityIndicator size="large" color={COLORS.Primary} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={sa.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
      }
    >
      {!!error && (
        <View style={sa.errorBox}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
          <Text style={sa.errorText}>{error}</Text>
        </View>
      )}

      {/* GENERATE INVOICE IS NOT HERE ANY MORE.
          It lives in the Invoices tab, beside the invoices it produces —
          one button, in the section it belongs to. */}

      {/* Counter laundry from a past date, entered as a real order on that
          date. Available for every business. */}
      <TouchableOpacity
        style={[sa.addEntryBtn, { backgroundColor: COLORS.PrimaryDark }]}
        onPress={() => setWalkingOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Add a backdated walking order for ${business.name}`}
      >
        <Ionicons name="cloud-upload-outline" size={18} color={COLORS.Surface} />
        <Text style={sa.addEntryText}>Add Backdated Walking Order</Text>
      </TouchableOpacity>

      <Text style={[sa.cardMeta, { marginTop: SPACING.xs, marginBottom: SPACING.sm }]}>
        {orders.length} order{orders.length === 1 ? '' : 's'} for {business.name}.
      </Text>

      {orders.length === 0 ? (
        <Text style={sa.empty}>This business has not placed any orders yet.</Text>
      ) : (
        orders.map((o) => (
          <View key={o.id} style={sa.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
              <View style={sa.flex}>
                <Text style={sa.cardTitle}>{o.order_number}</Text>
                <Text style={sa.cardMeta}>
                  {dmy(String(o.created_at).slice(0, 10))} · {o.item_count} item
                  {o.item_count === 1 ? '' : 's'} · Qty {o.total_quantity}
                </Text>
                {/* The invoice this order falls under, derived from the
                    business's billing cycle and the order's own date. A
                    cancelled order is billed on none, and says so. */}
                <Text style={sa.cardMeta}>
                  Invoice {o.invoice_number_display || '—'}
                </Text>
                {/*
                  THE NUMBER THE ORDER WAS ACTUALLY PLACED ON.

                  `orders.placed_by_mobile` — what passed OTP for the session
                  that placed it, so an order placed by an alternative contact
                  shows the alternative contact's number and never the
                  business's primary one. "N/A" for orders from before the
                  field existed: no number is known to be right for those, and
                  substituting the primary would be inventing one.
                */}
                <Text style={sa.cardMeta}>
                  Placed by {o.placed_by_name || '—'} · {o.placed_by_mobile || 'N/A'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: SPACING.xs }}>
                <StatusPill status={o.status} />
                {/* The EXISTING Order Confirmation PDF, opened for this order
                    — the same button pattern the billing receipt already
                    uses. */}
                <ActionButton
                  icon={pdfFor === o.id ? 'hourglass-outline' : 'document-text-outline'}
                  label={pdfFor === o.id ? '…' : 'View PDF'}
                  tone="primary"
                  onPress={() => handleViewPdf(o)}
                  accessibilityLabel={`Open the order confirmation PDF for ${o.order_number}`}
                />
                <ActionButton
                  icon="ellipsis-horizontal"
                  label="More Options"
                  onPress={() => setMenuOrder(o)}
                  accessibilityLabel={`More PDF options for ${o.order_number}`}
                />
              </View>
            </View>
          </View>
        ))
      )}

      {/* Reloads the order list on success, so the newly created backdated
          order appears without leaving the screen. */}
      <WalkingOrderModal
        visible={walkingOpen}
        businessId={business.id}
        businessName={business.name}
        onClose={() => setWalkingOpen(false)}
        onImported={load}
      />

      {/* More Options — the four native actions, all on the EXISTING Order PDF.
          Same bottom-sheet pattern as the other modals on this screen. */}
      <Modal
        visible={menuOrder !== null}
        transparent
        animationType="slide"
        onRequestClose={() => !actionBusy && setMenuOrder(null)}
      >
        <View style={sa.modalBackdrop}>
          <View style={sa.modalSheet}>
            <View style={sa.header}>
              <Text style={[sa.headerTitle, { flex: 1 }]} numberOfLines={1}>
                {menuOrder?.order_number || 'Order PDF'}
              </Text>
              <TouchableOpacity
                style={sa.iconBtn}
                onPress={() => setMenuOrder(null)}
                disabled={actionBusy}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
              </TouchableOpacity>
            </View>

            <View style={sa.scroll}>
              {actionBusy ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SPACING.sm,
                    paddingVertical: SPACING.sm,
                  }}
                >
                  <ActivityIndicator color={COLORS.Primary} />
                  <Text style={sa.choiceText}>Preparing PDF…</Text>
                </View>
              ) : (
                (['open', 'print', 'share', 'save'] as const).map((action) => {
                  const meta = {
                    open: { icon: 'open-outline', label: 'Open PDF' },
                    print: { icon: 'print-outline', label: 'Print PDF' },
                    share: { icon: 'share-social-outline', label: 'Share PDF' },
                    save: { icon: 'download-outline', label: 'Save PDF to Mobile' },
                  }[action];
                  return (
                    <TouchableOpacity
                      key={action}
                      style={sa.choice}
                      onPress={() => menuOrder && runPdfAction(menuOrder, action)}
                      accessibilityRole="button"
                      accessibilityLabel={meta.label}
                    >
                      <Ionicons
                        name={meta.icon as any}
                        size={20}
                        color={COLORS.Primary}
                      />
                      <Text style={sa.choiceText}>{meta.label}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>
        </View>
      </Modal>


    </ScrollView>
  );
}

/* ===================================================================
 * INVOICE HISTORY
 * =================================================================== */

/** The colour each invoice status is shown in. */
const INVOICE_STATUS_TONE: Record<
  InvoiceHistoryEntry['status'],
  { bg: string; fg: string; label: string }
> = {
  ISSUED: { bg: '#EEF2F7', fg: '#42526E', label: 'Issued' },
  PART_PAID: { bg: '#FFF4E5', fg: '#8A5200', label: 'Part paid' },
  PAID: { bg: '#E8F3EC', fg: '#1B4332', label: 'Paid' },
  CANCELLED: { bg: '#FDECEC', fg: '#B42318', label: 'Cancelled' },
};

/**
 * EVERY INVOICE EVER GENERATED FOR THIS BUSINESS, newest first.
 *
 * ONE BUSINESS'S INVOICES, AND ONLY ITS OWN. The business id is in the path of
 * every call and the server filters each statement by it, so this list cannot
 * show another business's invoice even if the component asked for one. The
 * parent remounts this tab when the business changes, so a stale list is never
 * shown under a new name either.
 *
 * THE AMOUNTS ARE NOT RECOMPUTED HERE, and not recomputed on the server when
 * the list is read: they are the figures each invoice was ISSUED for, stored
 * when it was generated. An order adjusted or a price corrected afterwards
 * cannot restate an invoice that has already been sent.
 *
 * NOTHING IS CALCULATED IN THIS COMPONENT. Every figure below — the total, the
 * amount paid, the outstanding balance and the status — is read from the
 * server's response as it arrives.
 */
function InvoiceHistoryTab({ business }: { business: BusinessAccountSummary }) {
  /*
   * GENERATE INVOICE LIVES HERE, in the section its output appears in — it
   * used to sit in Order Detail, one tab away from every invoice it created.
   * It is the SAME `GstInvoiceModal` and the same API; only the placement
   * changed, so nothing about how an invoice is generated is different.
   */
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  /** The invoice whose PDF is being fetched, so only its row shows a spinner. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await superAdminApi.getInvoiceHistory(business.id);
      setInvoices(data.invoices);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load the invoice history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [business.id]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  /**
   * Download one stored invoice and hand it to the device.
   *
   * The PDF is fetched from the server, which re-renders it from the stored
   * period through the SAME invoice template that issued it — there is no
   * second invoice document. `FileSystem.downloadAsync` makes its own request,
   * so the bearer token is attached explicitly, exactly as GstInvoiceModal
   * does for the invoice it generates.
   */
  const openInvoicePdf = async (invoice: InvoiceHistoryEntry, share: boolean) => {
    if (busyId) return;
    setBusyId(invoice.id);
    setError('');
    try {
      const headers = await superAdminApi.authHeader();
      const url = superAdminApi.historyInvoicePdfUrl(business.id, invoice.id);

      // Named for the business and the invoice, so a folder of downloaded
      // invoices reads by business. The full invoice number carries slashes,
      // which a file name cannot, so the shown 12-character form is used and
      // the period is what distinguishes one invoice from the next.
      const safeName = `${business.name} ${invoice.period_from} to ${invoice.period_to}`
        .replace(/[<>:"/\\|?* -]/g, '')
        .trim();
      const target = `${FileSystem.cacheDirectory}${encodeURIComponent(`${safeName}.pdf`)}`;

      const result = await FileSystem.downloadAsync(url, target, { headers });
      if (result.status !== 200) throw new Error('That invoice could not be downloaded.');

      if (share) {
        if (!(await Sharing.isAvailableAsync())) {
          Alert.alert('Invoice ready', `${safeName}.pdf`);
          return;
        }
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${invoice.invoice_number_display} — ${business.name}`,
          UTI: 'com.adobe.pdf',
        });
        return;
      }

      // Opens in the DEVICE's own PDF viewer, the same helper the order PDFs
      // use, so every "open a PDF" in the Super Admin behaves identically.
      const outcome = await openPdfInDeviceViewer(result.uri, `${safeName}.pdf`);
      if (outcome === 'unavailable') Alert.alert('Invoice ready', `${safeName}.pdf`);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not open that invoice.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <View style={sa.centered}>
        <ActivityIndicator size="large" color={COLORS.Primary} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={sa.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
      }
    >
      {!!error && (
        <View style={sa.errorBox}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
          <Text style={sa.errorText}>{error}</Text>
        </View>
      )}

      {/* The one Generate Invoice in the app, at the head of the section
          whose list it adds to. */}
      <TouchableOpacity
        style={sa.addEntryBtn}
        onPress={() => setInvoiceOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Generate an invoice for ${business.name}`}
      >
        <Ionicons name="document-text-outline" size={18} color={COLORS.Surface} />
        <Text style={sa.addEntryText}>Generate Invoice</Text>
      </TouchableOpacity>

      {invoices.length === 0 ? (
        <Text style={[sa.empty, { marginTop: SPACING.md }]}>
          No invoice has been generated for {business.name} yet. Use Generate Invoice above and it
          will appear here.
        </Text>
      ) : (
        invoices.map((inv) => {
          const tone = INVOICE_STATUS_TONE[inv.status];
          const busy = busyId === inv.id;
          return (
            <View key={inv.id} style={sa.card}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm }}>
                <View style={sa.flex}>
                  {/* The SHOWN invoice number is the 12-character form; the
                      full one is the identifier and is not a label. */}
                  <Text style={sa.cardTitle}>{inv.invoice_number_display}</Text>
                  <Text style={sa.cardMeta}>{inv.business_name}</Text>
                  <Text style={sa.cardMeta}>
                    {dmy(inv.period_from)} – {dmy(inv.period_to)} · {inv.billing_cycle_label}
                    {inv.laundry_type_label ? ` · ${inv.laundry_type_label}` : ''}
                  </Text>
                  <Text style={sa.cardMeta}>
                    Invoice date: {dmy(inv.invoice_date)} · {inv.order_count} order
                    {inv.order_count === 1 ? '' : 's'}
                  </Text>
                </View>
                <View
                  style={{
                    backgroundColor: tone.bg,
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                  }}
                >
                  <Text
                    style={{
                      color: tone.fg,
                      fontSize: 11,
                      fontWeight: '700',
                      fontFamily: TYPOGRAPHY.fontFamily,
                    }}
                  >
                    {tone.label}
                  </Text>
                </View>
              </View>

              {/* THE FIGURES, exactly as the server sent them. */}
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  marginTop: SPACING.sm,
                  borderTopWidth: 1,
                  borderTopColor: COLORS.Border,
                  paddingTop: SPACING.sm,
                }}
              >
                <Amount label="Total" value={inv.total_amount} strong />
                <Amount label="Paid" value={inv.amount_paid} />
                <Amount label="Outstanding" value={inv.amount_due} />
              </View>

              <View style={{ flexDirection: 'row', gap: SPACING.xs, marginTop: SPACING.sm }}>
                <ActionButton
                  icon={busy ? 'hourglass-outline' : 'open-outline'}
                  label={busy ? '…' : 'View PDF'}
                  tone="primary"
                  onPress={() => openInvoicePdf(inv, false)}
                  accessibilityLabel={`Open invoice ${inv.invoice_number_display} in the device PDF viewer`}
                />
                <ActionButton
                  icon="share-outline"
                  label="Share"
                  onPress={() => openInvoicePdf(inv, true)}
                  accessibilityLabel={`Share or save invoice ${inv.invoice_number_display}`}
                />
              </View>
            </View>
          );
        })
      )}

      {/* The SAME GstInvoiceModal the Order Detail tab used to open — same
          props, same API, same document. Closing it reloads the list, so an
          invoice just generated appears without a manual refresh. */}
      <GstInvoiceModal
        visible={invoiceOpen}
        businessId={business.id}
        businessName={business.name}
        onClose={() => { setInvoiceOpen(false); load(); }}
      />
    </ScrollView>
  );
}

/** One labelled figure in an invoice card. Displays; never computes. */
function Amount({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={{ width: '33.33%' }}>
      <Text style={[sa.cardMeta, { fontSize: 11 }]}>{label}</Text>
      <Text
        style={{
          color: COLORS.TextPrimary,
          fontWeight: strong ? '700' : '600',
          fontFamily: TYPOGRAPHY.fontFamily,
          fontSize: strong ? 15 : 13,
        }}
      >
        {money(value)}
      </Text>
    </View>
  );
}

/* ===================================================================
 * PAYMENT RECEIPT
 * =================================================================== */

/**
 * Records money received against this business's invoice.
 *
 * WHAT IS READ-ONLY AND WHY. The invoice id, the previous balance, the current
 * invoice amount and the total due all come from the server — the invoice is
 * computed from this business's orders and the balance is read from the stored
 * ledger, so neither is something to type. The remaining balance is arithmetic
 * on those, so it is shown and not entered. What the operator supplies is the
 * date, the type, the reference where one applies, and the amount received.
 */
function PaymentReceiptTab({ business }: { business: BusinessAccountSummary }) {
  const [context, setContext] = useState<PaymentContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentType, setPaymentType] = useState<PaymentTypeValue>('CASH');
  const [reference, setReference] = useState('');
  const [received, setReceived] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setContext(await superAdminApi.getPaymentContext(business.id));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load the payment details');
    } finally {
      setLoading(false);
    }
  }, [business.id]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  /**
   * The remaining balance as the amount is typed.
   *
   * A preview only. The server recomputes it from the invoice and the ledger
   * before storing, so what is saved never depends on this.
   */
  const remaining = useMemo(() => {
    if (!context) return 0;
    const amount = Number(received || 0);
    return Math.round((context.outstanding - (Number.isFinite(amount) ? amount : 0)) * 100) / 100;
  }, [context, received]);

  const save = async () => {
    if (!context?.invoice) return;
    const amount = Number(received);
    if (!received.trim() || !Number.isFinite(amount)) {
      setError('Enter the amount received.');
      return;
    }
    if (amount < 0) { setError('The amount received cannot be negative.'); return; }
    if (amount > context.outstanding) {
      setError(`The amount received cannot be more than the ${money(context.outstanding)} due.`);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const receipt = await superAdminApi.recordPayment(business.id, {
        invoice_period_from: context.invoice.period.from,
        invoice_period_to: context.invoice.period.to,
        payment_date: paymentDate,
        payment_type: paymentType,
        payment_reference: paymentType === 'NETBANKING' ? reference.trim() : undefined,
        payment_received: amount,
      });
      setReceived('');
      setReference('');
      await load();
      Alert.alert(
        'Payment recorded',
        `Receipt ${receipt.receipt_number}\nRemaining balance ${money(receipt.remaining_balance)}`,
        [
          { text: 'Close' },
          { text: 'Billing Receipt', onPress: () => downloadReceipt(receipt) },
        ]
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not record the payment');
    } finally {
      setSaving(false);
    }
  };

  /** The Billing Receipt PDF, built on the server from the stored receipt. */
  const downloadReceipt = async (receipt: PaymentReceipt) => {
    setDownloading(receipt.id);
    try {
      const headers = await superAdminApi.authHeader();
      const target = `${FileSystem.cacheDirectory}billing-receipt-${receipt.id}.pdf`;
      const result = await FileSystem.downloadAsync(
        superAdminApi.billingReceiptPdfUrl(business.id, receipt.id), target, { headers });
      if (result.status !== 200) throw new Error('The server could not generate that receipt.');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${business.name} — Billing Receipt`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Receipt saved', `Saved to ${result.uri}`);
      }
    } catch (e: any) {
      Alert.alert('Could not open the receipt', e?.response?.data?.message || e.message);
    } finally {
      setDownloading(null);
    }
  };

  if (loading) {
    return (
      <View style={sa.centered}>
        <ActivityIndicator size="large" color={COLORS.Primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
      {!!error && (
        <View style={sa.errorBox}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
          <Text style={sa.errorText}>{error}</Text>
        </View>
      )}

      {!context?.invoice ? (
        <Text style={sa.empty}>
          {context?.message || 'There is no invoice to record a payment against yet.'}
        </Text>
      ) : (
        <View style={sa.card}>
          <Text style={sa.cardTitle}>Payment Receipt</Text>
          <Text style={sa.cardMeta}>{business.name}</Text>

          {/* Loaded, not typed — see the note on this component. */}
          <ReadOnly label="INVOICE ID" value={context.invoice.invoice_number_display} />
          <Text style={sa.cardMeta}>
            Period {dmy(context.invoice.period.from)} to {dmy(context.invoice.period.to)}
          </Text>

          <ReadOnly label="PREVIOUS BALANCE" value={money(context.previous_balance)} />
          <ReadOnly
            label="CURRENT INVOICE AMOUNT"
            value={money(context.invoice.current_invoice_amount)}
          />
          <ReadOnly label="TOTAL AMOUNT DUE" value={money(context.total_amount_due)} strong />
          {context.already_received > 0 ? (
            <Text style={sa.cardMeta}>
              {money(context.already_received)} already received against this invoice ·{' '}
              {money(context.outstanding)} still due
            </Text>
          ) : null}

          <Text style={sa.label}>PAYMENT DATE</Text>
          <TextInput
            style={sa.input}
            value={paymentDate}
            onChangeText={setPaymentDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={COLORS.TextSecondary}
          />

          <Text style={sa.label}>PAYMENT TYPE</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
            {PAYMENT_TYPES.map((t) => {
              const on = paymentType === t.value;
              return (
                <TouchableOpacity
                  key={t.value}
                  style={[sa.filterChip, on && sa.filterChipOn]}
                  onPress={() => setPaymentType(t.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Shown for Netbanking alone — the other three have no such field. */}
          {paymentType === 'NETBANKING' ? (
            <>
              <Text style={sa.label}>TRANSACTION REFERENCE</Text>
              <TextInput
                style={sa.input}
                value={reference}
                onChangeText={setReference}
                placeholder="NEFT / IMPS / RTGS reference"
                placeholderTextColor={COLORS.TextSecondary}
                autoCapitalize="characters"
              />
            </>
          ) : null}

          <Text style={sa.label}>PAYMENT RECEIVED AMOUNT</Text>
          <TextInput
            style={sa.input}
            value={received}
            onChangeText={setReceived}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={COLORS.TextSecondary}
          />

          <ReadOnly label="REMAINING PAYMENT AMOUNT" value={money(remaining)} strong />

          <TouchableOpacity
            style={[sa.button, saving && sa.buttonDisabled]}
            onPress={save}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={COLORS.Surface} />
            ) : (
              <Text style={sa.buttonText}>Generate Billing Receipt</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Payment history ---- */}
      <Text style={[sa.label, { marginTop: SPACING.md }]}>PAYMENT HISTORY</Text>
      {(context?.receipts || []).length === 0 ? (
        <Text style={sa.empty}>No payment has been recorded for this business yet.</Text>
      ) : (
        (context?.receipts || []).map((r) => (
          <View key={r.id} style={sa.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
              <View style={sa.flex}>
                <Text style={sa.cardTitle}>{r.receipt_number}</Text>
                <Text style={sa.cardMeta}>
                  {r.invoice_number_display} · {dmy(r.payment_date)} ·{' '}
                  {PAYMENT_TYPES.find((t) => t.value === r.payment_type)?.label || r.payment_type}
                </Text>
                <Text style={sa.cardMeta}>
                  Received {money(r.payment_received)} · Remaining {money(r.remaining_balance)}
                </Text>
              </View>
              <ActionButton
                icon={downloading === r.id ? 'hourglass-outline' : 'document-text-outline'}
                label={downloading === r.id ? '…' : 'Receipt'}
                tone="primary"
                onPress={() => downloadReceipt(r)}
                accessibilityLabel={`Open the billing receipt ${r.receipt_number}`}
              />
            </View>
          </View>
        ))
      )}
      <View style={{ height: SPACING.xxl }} />
    </ScrollView>
  );
}

/** A figure the server computed. Shown, never typed. */
function ReadOnly({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <Text style={sa.label}>{label}</Text>
      <View style={[sa.input, { backgroundColor: COLORS.Background, justifyContent: 'center' }]}>
        <Text
          style={{
            fontFamily: TYPOGRAPHY.fontFamily,
            fontSize: strong ? TYPOGRAPHY.sizes.base : TYPOGRAPHY.sizes.sm,
            fontWeight: strong ? '800' : '600',
            color: strong ? COLORS.PrimaryDark : COLORS.TextPrimary,
          }}
        >
          {value}
        </Text>
      </View>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.INACTIVE;
  return (
    <View style={[sa.pill, { backgroundColor: tone.bg }]}>
      <Text style={[sa.pillText, { color: tone.fg }]}>{String(status).replace(/_/g, ' ')}</Text>
    </View>
  );
}
