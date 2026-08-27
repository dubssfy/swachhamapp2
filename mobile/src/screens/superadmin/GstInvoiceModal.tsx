import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ActivityIndicator, Platform, Alert, ScrollView,
} from 'react-native';
// The legacy entry point, the same one the order-PDF code uses: SDK 54's new
// API replaced cacheDirectory with a different file object model.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { LaundryTypeValue } from '../../services/superAdminApi';
import SorterCalendar from '../../components/sorter/SorterCalendar';
import { formatLongDate, toDateKey } from '../../utils/sorterDates';
import { businessDocumentFileName } from '../../utils/pdfFileName';

/**
 * Generate GST Invoice, for one business over one period.
 *
 * Both dates are picked from the calendar the app already has — nothing is
 * hardcoded and nothing is typed. The totals shown are fetched from the
 * backend, and the PDF is downloaded from it as well: no amount on this
 * screen is calculated here.
 *
 * HOTEL AND GUEST ARE TWO SEPARATE INVOICES, chosen at the top. The type is
 * sent to the server with the two dates, and the server does the filtering —
 * so a Hotel invoice cannot contain a Guest line no matter what this screen
 * does. Both documents below are generated for whichever type is selected.
 *
 * TWO DOCUMENTS, ONE PERIOD. The invoice and the order summary are downloaded
 * from the same `from`, `to` and type held in this component's state, so the
 * pair can never describe different windows.
 */

interface Props {
  visible: boolean;
  businessId: string | null;
  businessName: string;
  onClose: () => void;
}

type Picking = 'from' | 'to' | null;

/** The two invoice types, in the order the Business Account lists them. */
const LAUNDRY_TYPES: Array<{ value: LaundryTypeValue; label: string; icon: any }> = [
  { value: 'hotel', label: 'Hotel Laundry', icon: 'business' },
  { value: 'guest', label: 'Guest Laundry', icon: 'person' },
];

export default function GstInvoiceModal({ visible, businessId, businessName, onClose }: Props) {
  // Defaults to the current month so far, from the device's own calendar.
  const today = toDateKey(new Date());
  const monthStart = `${today.slice(0, 8)}01`;

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [picking, setPicking] = useState<Picking>(null);
  /**
   * Which invoice is being generated. Hotel first, because it is the larger
   * of the two for most businesses. There is deliberately no "both" option:
   * the two are separate invoices, and an operator who wants both generates
   * them one after the other.
   */
  const [laundryType, setLaundryType] = useState<LaundryTypeValue>('hotel');

  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const typeLabel =
    LAUNDRY_TYPES.find((option) => option.value === laundryType)?.label ?? '';

  const reset = () => {
    setPreview(null);
    setError('');
  };

  /** The totals, so the operator sees what is about to be billed. */
  const loadPreview = async () => {
    if (!businessId) return;
    setBusy(true);
    setError('');
    try {
      setPreview(await superAdminApi.getInvoice(businessId, from, to, laundryType));
    } catch (e: any) {
      setPreview(null);
      setError(e?.response?.data?.message || e.message || 'Could not build the invoice.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Downloads one of the two documents and hands it to the share sheet.
   *
   * BOTH DOCUMENTS GO THROUGH HERE, given the URL to fetch — which is what
   * guarantees they are downloaded the same way, named consistently, and
   * built from the same `from`, `to` and `laundryType` held above.
   *
   * FileSystem does its own request, so the bearer token is attached
   * explicitly — these endpoints are SUPER_ADMIN only.
   */
  const download = async (kind: 'invoice' | 'items') => {
    if (!businessId) return;
    setBusy(true);
    setError('');
    try {
      const headers = await superAdminApi.authHeader();
      const url =
        kind === 'invoice'
          ? superAdminApi.invoicePdfUrl(businessId, from, to, laundryType)
          : superAdminApi.itemReportPdfUrl(businessId, from, to, laundryType);
      /*
       * THE NAME THE USER ACTUALLY GETS.
       *
       * `downloadAsync` writes the body to the path it is handed and ignores
       * the server's `Content-Disposition` entirely, so this — not the
       * response header — is what decides the file name in the share sheet
       * and in the saved file. It is built to the same shape the server
       * names its own downloads, so the two agree.
       */
      const fileName = businessDocumentFileName({
        establishmentName: businessName,
        from,
        to,
        laundryTypeLabel: typeLabel,
        kind: kind === 'invoice' ? 'invoice' : 'summary',
      });
      const target = `${FileSystem.cacheDirectory}${fileName}`;

      const result = await FileSystem.downloadAsync(url, target, { headers });
      if (result.status !== 200) {
        throw new Error(
          `No ${typeLabel} data could be found for this period.`
        );
      }

      const title =
        kind === 'invoice'
          ? `${typeLabel} invoice — ${businessName}`
          : `${typeLabel} order summary — ${businessName}`;

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          dialogTitle: title,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Saved', result.uri);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not download the document.');
    } finally {
      setBusy(false);
    }
  };

  const dateButton = (label: string, value: string, which: Exclude<Picking, null>) => (
    <View style={{ flex: 1 }}>
      <Text style={sa.label}>{label}</Text>
      <TouchableOpacity
        style={[sa.input, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
        onPress={() => setPicking(which)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatLongDate(value)}`}
      >
        <Ionicons name="calendar-outline" size={18} color={COLORS.Primary} />
        <Text style={{ color: COLORS.TextPrimary, fontFamily: TYPOGRAPHY.fontFamily }}>
          {formatLongDate(value)}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: COLORS.Background,
            borderTopLeftRadius: BORDER_RADIUS.lg,
            borderTopRightRadius: BORDER_RADIUS.lg,
            paddingBottom: SPACING.lg,
            maxHeight: '88%',
          }}
        >
          <View style={sa.header}>
            <Text style={[sa.headerTitle, { flex: 1 }]}>Generate Invoice</Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
            <Text style={sa.cardTitle}>{businessName}</Text>

            {/* WHICH INVOICE. Chosen first, because it decides what the dates
                below are then read against — the two types are separate
                invoices and their data never mixes. */}
            <Text style={sa.label}>INVOICE TYPE</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
              {LAUNDRY_TYPES.map((option) => {
                const on = laundryType === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[sa.tab, on && sa.tabActive, { flex: 1, flexDirection: 'row', gap: 6 }]}
                    onPress={() => {
                      setLaundryType(option.value);
                      // The preview belongs to the type it was fetched for.
                      reset();
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Generate a ${option.label} invoice`}
                  >
                    <Ionicons
                      name={option.icon}
                      size={16}
                      color={on ? COLORS.Surface : COLORS.TextSecondary}
                    />
                    <Text style={[sa.tabText, on && sa.tabTextActive]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
              {dateButton('From', from, 'from')}
              {dateButton('To', to, 'to')}
            </View>

            {!!error && (
              <View style={sa.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
                <Text style={sa.errorText}>{error}</Text>
              </View>
            )}

            {/* The figures, straight from the backend. */}
            {preview && (
              <View style={[sa.card, { marginTop: SPACING.sm }]}>
                {/* The SHOWN number: the server's first-10-character form,
                    the same string the PDF prints. The full number stays on
                    `invoice_number` and is what the download is named by. */}
                <Text style={sa.cardTitle}>
                  {preview.invoice_number_display || preview.invoice_number}
                </Text>
                {/* THE TYPE, from the server rather than from this screen's
                    own state: it reports what the invoice was actually built
                    with, so a stale preview cannot claim the wrong one. */}
                <Text style={[sa.cardLine, { fontWeight: '700' }]}>
                  Type: {preview.laundry_type_label || 'Hotel & Guest Laundry'}
                </Text>
                <Text style={sa.cardLine}>Orders: {preview.orders?.length ?? 0}</Text>
                <Text style={sa.cardLine}>Items billed: {preview.lines?.length ?? 0}</Text>
                <Text style={sa.cardLine}>
                  Taxable value: INR {Number(preview.totals?.taxable_value ?? 0).toFixed(2)}
                </Text>
                {preview.totals?.intra_state ? (
                  <>
                    <Text style={sa.cardLine}>
                      CGST @ {preview.totals.gst_rate / 2}%: INR {Number(preview.totals.cgst).toFixed(2)}
                    </Text>
                    <Text style={sa.cardLine}>
                      SGST @ {preview.totals.gst_rate / 2}%: INR {Number(preview.totals.sgst).toFixed(2)}
                    </Text>
                  </>
                ) : (
                  <Text style={sa.cardLine}>
                    IGST @ {preview.totals?.gst_rate}%: INR {Number(preview.totals?.igst ?? 0).toFixed(2)}
                  </Text>
                )}
                <Text style={[sa.cardLine, { fontWeight: '800' }]}>
                  Grand total: INR {Number(preview.totals?.grand_total ?? 0).toFixed(2)}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[sa.button, busy && sa.buttonDisabled]}
              onPress={loadPreview}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color={COLORS.Surface} />
                    : <Text style={sa.buttonText}>Preview totals</Text>}
            </TouchableOpacity>

            {/* THE TWO DOCUMENTS, both for the type and period chosen above.
                Neither takes its own dates: they read the same state, so the
                pair always covers the same window. */}
            <TouchableOpacity
              style={[
                sa.button,
                { backgroundColor: COLORS.PrimaryDark },
                busy && sa.buttonDisabled,
              ]}
              onPress={() => download('invoice')}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Generate the ${typeLabel} invoice PDF`}
            >
              <Text style={sa.buttonText}>{typeLabel} Invoice (PDF)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[sa.buttonGhost, busy && sa.buttonDisabled]}
              onPress={() => download('items')}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Generate the ${typeLabel} order summary PDF for the same period`}
            >
              <Text style={sa.buttonGhostText}>Order Summary (PDF)</Text>
            </TouchableOpacity>

            <Text style={[sa.cardMeta, { marginTop: SPACING.xs }]}>
              The order summary lists each item's quantity per day, with its rate
              and amount, for the same period and laundry type as the invoice above.
            </Text>
          </ScrollView>
        </View>
      </View>

      {/* The calendar the Sorter module already uses, reused as-is. */}
      <SorterCalendar
        visible={picking !== null}
        value={picking === 'to' ? to : from}
        // Nothing can be billed for a day that has not happened.
        maxDate={today}
        title={picking === 'to' ? 'To date' : 'From date'}
        onSelect={(key) => {
          if (picking === 'to') setTo(key);
          else setFrom(key);
          setPicking(null);
          reset();
        }}
        onClose={() => setPicking(null)}
      />
    </Modal>
  );
}
