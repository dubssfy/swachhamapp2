import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
// The legacy entry point, the same one the invoice and order-PDF code use:
// SDK 54's new API replaced cacheDirectory with a different file object model.
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { LaundryTypeValue } from '../../services/superAdminApi';
import SorterCalendar from '../../components/sorter/SorterCalendar';
import { formatLongDate, toDateKey } from '../../utils/sorterDates';

/**
 * Add Backdated Walking Order.
 *
 * Laundry taken over the counter on a past date and never entered. This
 * creates it as a genuine order ON THAT DATE, so the invoice, the Order
 * Summary and every report that covers the date pick it up with no knowledge
 * that anything unusual happened.
 *
 * THE ORDER OF THE STEPS IS THE POINT. Date and type are chosen BEFORE the
 * template is downloaded, because the template is built from this business's
 * own priced catalogue at that type — a sheet downloaded for Hotel Laundry
 * lists the items that will validate against Hotel Laundry.
 *
 * NOTHING IS WRITTEN UNTIL CONFIRM. Uploading only validates: the server
 * returns exactly what would be created, including which sheet rows were
 * merged into which line, and the operator confirms that. A sheet with any
 * error imports nothing at all.
 */

interface Props {
  visible: boolean;
  businessId: string | null;
  businessName: string;
  onClose: () => void;
  /** Fired after a successful import, so the caller can refresh its list. */
  onImported?: () => void;
}

const LAUNDRY_TYPES: Array<{ value: LaundryTypeValue; label: string; icon: any }> = [
  { value: 'hotel', label: 'Hotel Laundry', icon: 'business' },
  { value: 'guest', label: 'Guest Laundry', icon: 'person' },
];

export default function WalkingOrderModal({
  visible, businessId, businessName, onClose, onImported,
}: Props) {
  const today = toDateKey(new Date());

  const [orderDate, setOrderDate] = useState(today);
  const [picking, setPicking] = useState(false);
  /**
   * Whether the operator has actually SET the backdate for this entry.
   *
   * The field starts on today, which is exactly the date a backdated order is
   * not for — so an untouched field is a default, not a choice, and the sheet
   * must not be uploadable against it. Held as its own flag rather than
   * compared against today, so re-picking today on purpose after picking
   * another date still counts as chosen and does not disable the upload again.
   */
  const [dateChosen, setDateChosen] = useState(false);
  const [laundryType, setLaundryType] = useState<LaundryTypeValue>('hotel');

  /** The chosen file, held as base64 so preview and import send the same bytes. */
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const typeLabel = LAUNDRY_TYPES.find((t) => t.value === laundryType)?.label ?? '';

  /*
   * EVERY OPENING STARTS AT STEP ONE. The modal stays mounted between opens,
   * so without this a second entry would inherit the last one's chosen date
   * and skip the step. Only the flag is cleared — the date itself is left
   * exactly as it was, as it always has been.
   */
  useEffect(() => {
    if (visible) setDateChosen(false);
  }, [visible]);

  /** Any change to the inputs invalidates a preview taken against the old ones. */
  const resetPreview = () => {
    setPreview(null);
    setError('');
  };

  const reset = () => {
    setFile(null);
    resetPreview();
  };

  const downloadTemplate = async () => {
    if (!businessId) return;
    setBusy(true);
    setError('');
    try {
      const headers = await superAdminApi.authHeader();
      const url = superAdminApi.walkingOrderTemplateUrl(businessId, laundryType);
      const name = `${businessName.replace(/[^A-Za-z0-9]+/g, '_')}_Walking_Order_${laundryType}.xlsx`;
      const result = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}${name}`, {
        headers,
      });
      if (result.status !== 200) throw new Error('The template could not be generated.');

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: `Walking order template — ${businessName}`,
        });
      } else {
        Alert.alert('Template saved', result.uri);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not download the template.');
    } finally {
      setBusy(false);
    }
  };

  /** Picks the filled sheet and validates it. Writes nothing. */
  const pickAndValidate = async () => {
    if (!businessId) return;
    setError('');
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        // Both the modern and the legacy spreadsheet types, plus a wildcard —
        // Android file providers are inconsistent about which they report.
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          '*/*',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;

      const asset = picked.assets[0];
      setBusy(true);
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      setFile({ name: asset.name || 'walking_orders.xlsx', base64 });

      const result = await superAdminApi.previewWalkingOrder(businessId, {
        order_date: orderDate,
        laundry_type: laundryType,
        file_base64: base64,
      });
      setPreview(result);
    } catch (e: any) {
      setPreview(null);
      setError(e?.response?.data?.message || e.message || 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  /** Writes the order. Only reachable once a preview came back clean. */
  const confirmImport = async (confirmDuplicate = false) => {
    if (!businessId || !file) return;
    setBusy(true);
    setError('');
    try {
      const result = await superAdminApi.importWalkingOrder(businessId, {
        order_date: orderDate,
        laundry_type: laundryType,
        file_base64: file.base64,
        confirm_duplicate: confirmDuplicate,
      });
      Alert.alert(
        `Walking orders successfully added for ${formatLongDate(result.order_date)}.`,
        `Business: ${result.business_name}\n` +
          `Date: ${formatLongDate(result.order_date)}\n` +
          `Type: ${result.laundry_type_label}\n` +
          `Items Imported: ${result.items_imported}\n` +
          `Total Quantity: ${result.total_quantity}\n` +
          `Order: ${result.order_number}`,
        [
          {
            text: 'Done',
            onPress: () => {
              reset();
              onImported?.();
              onClose();
            },
          },
        ]
      );
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.message || e.message || 'The import failed.';
      // 409 is the duplicate guard, and it is a question rather than a
      // failure: the same list can legitimately be handed over twice.
      if (status === 409 && !confirmDuplicate) {
        Alert.alert('Already imported', `${message}\n\nDo you want to continue?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Import again', style: 'destructive', onPress: () => confirmImport(true) },
        ]);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const hasErrors = Boolean(preview?.errors?.length);
  const canImport = Boolean(preview) && !hasErrors && !busy;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: COLORS.Background,
            borderTopLeftRadius: BORDER_RADIUS.lg,
            borderTopRightRadius: BORDER_RADIUS.lg,
            paddingBottom: SPACING.lg,
            maxHeight: '90%',
          }}
        >
          <View style={sa.header}>
            <Text style={[sa.headerTitle, { flex: 1 }]}>Add Backdated Walking Order</Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
            <Text style={sa.cardTitle}>{businessName}</Text>
            <Text style={sa.cardMeta}>
              Enter laundry taken at the counter on a past date. It is created as a
              normal order on that date, so invoices and reports pick it up.
            </Text>

            {/* ---- 1. THE DATE the laundry was actually taken in ----
                Highlighted until it is chosen, because it gates the upload
                below: the existing `choiceActive` tokens, the same primary
                border and tint the app already marks a live choice with. */}
            <Text style={sa.label}>ORDER DATE</Text>
            <TouchableOpacity
              style={[
                sa.input,
                { flexDirection: 'row', alignItems: 'center', gap: 8 },
                !dateChosen && sa.choiceActive,
              ]}
              onPress={() => setPicking(true)}
              accessibilityRole="button"
              accessibilityLabel={`Order date: ${formatLongDate(orderDate)}`}
              accessibilityHint={
                dateChosen ? undefined : 'Step 1. Select the date before uploading the sheet.'
              }
            >
              <Ionicons name="calendar-outline" size={18} color={COLORS.Primary} />
              <Text style={{ color: COLORS.TextPrimary, fontFamily: TYPOGRAPHY.fontFamily }}>
                {formatLongDate(orderDate)}
              </Text>
            </TouchableOpacity>
            {!dateChosen && (
              <Text style={[sa.cardMeta, { color: COLORS.Primary, marginTop: SPACING.xs }]}>
                Step 1 — select the date this laundry was taken. The Excel upload stays
                disabled until you do.
              </Text>
            )}

            {/* ---- 2. WHICH TYPE. Decides the template and the prices. ---- */}
            <Text style={sa.label}>ORDER TYPE</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
              {LAUNDRY_TYPES.map((option) => {
                const on = laundryType === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[sa.tab, on && sa.tabActive, { flex: 1, flexDirection: 'row', gap: 6 }]}
                    onPress={() => {
                      setLaundryType(option.value);
                      reset();
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
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

            {/* ---- 3. THE TEMPLATE, for this business at this type ---- */}
            <TouchableOpacity
              style={[sa.buttonGhost, { flexDirection: 'row', justifyContent: 'center', gap: SPACING.xs }]}
              onPress={downloadTemplate}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Download the Excel template"
            >
              <Ionicons name="download-outline" size={18} color={COLORS.TextPrimary} />
              <Text style={sa.buttonGhostText}>Download Excel Template</Text>
            </TouchableOpacity>

            {/* ---- 4. THE FILLED SHEET ----
                Gated on the date above. What happens once it is tapped —
                picking, validating, importing — is untouched. */}
            <TouchableOpacity
              style={[sa.button, (busy || !dateChosen) && sa.buttonDisabled]}
              onPress={pickAndValidate}
              disabled={busy || !dateChosen}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || !dateChosen }}
              accessibilityLabel="Choose the filled Excel file"
              accessibilityHint={
                dateChosen ? undefined : 'Disabled until the order date above is selected.'
              }
            >
              {busy ? (
                <ActivityIndicator color={COLORS.Surface} />
              ) : (
                <Text style={sa.buttonText}>
                  {file ? 'Choose a different file' : 'Upload Filled Excel'}
                </Text>
              )}
            </TouchableOpacity>

            {file ? (
              <Text style={[sa.cardMeta, { marginTop: SPACING.xs }]} numberOfLines={1}>
                {file.name}
              </Text>
            ) : null}

            {!!error && (
              <View style={sa.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
                <Text style={sa.errorText}>{error}</Text>
              </View>
            )}

            {/* ---- 5. VALIDATION ERRORS, all of them at once ---- */}
            {hasErrors ? (
              <View style={[sa.card, { borderColor: COLORS.Error, borderWidth: 1 }]}>
                <Text style={[sa.cardTitle, { color: COLORS.Error }]}>
                  {preview.errors.length} problem(s) — nothing will be imported
                </Text>
                {preview.errors.map((e: any, i: number) => (
                  <Text key={i} style={sa.cardLine}>
                    {e.row ? `Row ${e.row}: ` : ''}{e.message}
                  </Text>
                ))}
                <Text style={[sa.cardMeta, { marginTop: SPACING.xs }]}>
                  Correct the sheet and upload it again.
                </Text>
              </View>
            ) : null}

            {/* ---- 6. THE PREVIEW: exactly what will be created ---- */}
            {preview && !hasErrors ? (
              <View style={[sa.card, { marginTop: SPACING.sm }]}>
                <Text style={sa.cardTitle}>
                  {preview.rows.length} line(s) · {preview.total_quantity} piece(s)
                </Text>
                <Text style={sa.cardMeta}>
                  {preview.laundry_type_label} · {formatLongDate(preview.order_date)}
                </Text>
                {preview.existing_orders_on_date > 0 ? (
                  <Text style={[sa.cardLine, { color: COLORS.Warning }]}>
                    This date already has {preview.existing_orders_on_date} order(s) of this
                    type. These quantities will be added alongside them.
                  </Text>
                ) : null}

                <View style={{ marginTop: SPACING.sm }}>
                  {preview.rows.map((row: any, i: number) => (
                    <View key={i} style={{ marginBottom: SPACING.xs }}>
                      <Text style={sa.cardLine}>
                        {row.item_name} · {row.service_name} — {row.quantity} ×{' '}
                        {Number(row.rate).toFixed(2)} = {Number(row.amount).toFixed(2)}
                      </Text>
                      {row.merged_from_rows?.length > 1 ? (
                        <Text style={sa.tdMuted}>
                          rows {row.merged_from_rows.join(', ')} added together
                        </Text>
                      ) : null}
                      {row.sheet_rate_note ? (
                        <Text style={[sa.tdMuted, { color: COLORS.Warning }]}>
                          {row.sheet_rate_note}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>

                <Text style={[sa.cardLine, { fontWeight: '800' }]}>
                  Total: INR {Number(preview.total_amount).toFixed(2)}
                </Text>
              </View>
            ) : null}

            {/* ---- 7. CONFIRM ---- */}
            <TouchableOpacity
              style={[
                sa.button,
                { backgroundColor: COLORS.PrimaryDark },
                !canImport && sa.buttonDisabled,
              ]}
              onPress={() => confirmImport(false)}
              disabled={!canImport}
              accessibilityRole="button"
              accessibilityLabel="Confirm and import the walking order"
              accessibilityState={{ disabled: !canImport }}
            >
              <Text style={sa.buttonText}>Confirm Import</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>

      {/* The calendar the rest of the app already uses. Nothing can be entered
          for a day that has not happened. */}
      <SorterCalendar
        visible={picking}
        value={orderDate}
        maxDate={today}
        title="Order date"
        onSelect={(key) => {
          setOrderDate(key);
          // The date is now a choice rather than the default, so the upload
          // below opens up — and stays open for any later change.
          setDateChosen(true);
          setPicking(false);
          resetPreview();
        }}
        onClose={() => setPicking(false)}
      />
    </Modal>
  );
}
