import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
// The legacy entry point, the same one the invoice, the rate card and the
// walking-order import already use: SDK 54's new API replaced cacheDirectory
// with a different file object model.
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, {
  LaundryTypeValue, PriceUploadResult, PriceUploadRow,
} from '../../services/superAdminApi';

/**
 * Bulk price update for the Business Price List.
 *
 * DOWNLOAD TEMPLATE gives back THIS business's own price list at THIS laundry
 * type — Main Category | Subcategory | Service Type | Item Name | Price, with
 * the current figures already in it. UPLOAD PRICE LIST reads that sheet back
 * and moves the prices.
 *
 * CATEGORIES, SUB-CATEGORIES AND SERVICE TYPES ARE NEVER CREATED OR RENAMED.
 * Those three columns say WHERE a row belongs, and a row naming one that does
 * not exist is an error rather than a request to create it.
 *
 * THE ITEM IS THE EXCEPTION: a row whose Item Name is not already on the list
 * adds it, under the category the row names. An item already on the list has
 * only its Price touched.
 *
 * A BLANK PRICE IS NOT AN ERROR. It means "Price Not Set" — the item is
 * listed and unpriced, which is a state the price list already has. It never
 * writes a zero over an existing rate.
 *
 * NOTHING IS WRITTEN UNTIL CONFIRM. Choosing the file only VALIDATES it: the
 * server returns the counts and every failing row with its reason, and the
 * Super Admin confirms that. The sheet is validated again on the way in, so a
 * report approved against a catalogue that has since changed cannot be applied
 * to the new one.
 *
 * THE BUSINESS AND THE LAUNDRY TYPE COME FROM THE SCREEN, never from the
 * sheet, so a file cannot re-price a different establishment or the other
 * rate card.
 */

interface Props {
  businessId: string | null;
  businessName: string;
  laundryType: LaundryTypeValue;
  laundryTypeLabel: string;
  /** How many lines have no rate yet, so the template can offer to include them. */
  unsetCount?: number;
  /** Fired after prices were written, so the caller can refresh its list. */
  onApplied?: () => void;
}

/** A blank Price reads as "Not set" — the price list's own word for unpriced. */
const money = (value: number | null | undefined) =>
  value === null || value === undefined ? 'Not set' : `₹${Number(value).toFixed(2)}`;

export default function BusinessPriceUploadModal({
  businessId, businessName, laundryType, laundryTypeLabel, unsetCount = 0, onApplied,
}: Props) {
  const [open, setOpen] = useState(false);
  /** The chosen file, held as base64 so preview and upload send the same bytes. */
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [report, setReport] = useState<PriceUploadResult | null>(null);
  /** Set once the prices are in, so the sheet reads as a result rather than a plan. */
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setFile(null);
    setReport(null);
    setDone(false);
    setError('');
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  /* ---- DOWNLOAD TEMPLATE ---- */

  const fetchTemplate = async (includeUnset: boolean) => {
    if (!businessId) return;
    setBusy(true);
    setError('');
    try {
      const headers = await superAdminApi.authHeader();
      const url = superAdminApi.businessPriceTemplateUrl(businessId, laundryType, includeUnset);
      const name = `${businessName.replace(/[^A-Za-z0-9]+/g, '_')}_Price_List_${laundryType}.xlsx`;
      const result = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}${name}`, {
        headers,
      });
      if (result.status !== 200) {
        // A failed download's body is the API's JSON error, not a workbook.
        let message = 'The template could not be generated.';
        try {
          message = JSON.parse(await FileSystem.readAsStringAsync(result.uri))?.message || message;
        } catch {
          /* a non-JSON body means there is nothing better to say */
        }
        throw new Error(message);
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: `${businessName} — ${laundryTypeLabel} price list`,
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

  /**
   * The unpriced lines are the one real choice here, so it is asked rather
   * than decided — exactly as printing the rate card asks it. A sheet for
   * adjusting existing rates should not carry forty blank rows; one for
   * filling the gaps has to.
   */
  const downloadTemplate = () => {
    if (!businessId || busy) return;
    if (unsetCount === 0) {
      fetchTemplate(false);
      return;
    }
    Alert.alert(
      `${laundryTypeLabel} price list`,
      `${businessName}\n\n` +
        `${unsetCount} line(s) have no rate yet. Leave them out to adjust the rates ` +
        'that exist, include them to fill the gaps — their Price cell comes blank, ' +
        'and any you leave blank simply stay unpriced.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Priced lines only', onPress: () => fetchTemplate(false) },
        { text: 'Include not set', onPress: () => fetchTemplate(true) },
      ]
    );
  };

  /* ---- UPLOAD: pick, then validate. Writes nothing. ---- */

  const pickAndValidate = async () => {
    if (!businessId) return;
    setError('');
    setReport(null);
    setDone(false);
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
      setFile({ name: asset.name || 'price_list.xlsx', base64 });

      setReport(
        await superAdminApi.previewBusinessPriceUpload(businessId, {
          laundry_type: laundryType,
          file_base64: base64,
        })
      );
    } catch (e: any) {
      setFile(null);
      setError(e?.response?.data?.message || e.message || 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  /* ---- CONFIRM: the only step that writes ---- */

  const apply = async () => {
    if (!businessId || !file) return;
    setBusy(true);
    setError('');
    try {
      const result = await superAdminApi.uploadBusinessPrices(businessId, {
        laundry_type: laundryType,
        file_base64: file.base64,
      });
      setReport(result);
      setDone(true);
      onApplied?.();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'The upload failed.');
    } finally {
      setBusy(false);
    }
  };

  /*
   * WHAT APPLY WILL ACT ON: the rows the server itself would act on.
   *
   * `changed_rows` is the exact list `applyBusinessPriceUpload` walks, and it
   * returns early when that list is empty. Gating the button on the SAME
   * signal means the button and the server can never disagree about whether
   * there is work to do — a derived count could drift from the list it is
   * meant to describe.
   *
   * `price_not_set` on an EXISTING item is deliberately not work: the row is
   * valid and writes nothing. A NEW item with a blank price IS work — the item
   * still has to be created — and the server puts it in `changed_rows`, so it
   * enables the button without this having to know the rule.
   */
  const willChange = report?.changed_rows?.length ?? 0;
  const canApply = Boolean(report) && willChange > 0 && !done && !busy;

  /**
   * WHY APPLY IS UNAVAILABLE, when it is.
   *
   * A greyed button with no explanation is the bug this exists to prevent:
   * the reason was previously shown only when NOTHING had failed, so a sheet
   * with some bad rows left the admin looking at a dead button and no
   * statement of why. Every disabled case now says what it is.
   */
  const blockedReason = (() => {
    if (!report || done || busy || willChange > 0) return '';
    if (report.total_rows === 0) {
      return report.blank_skipped > 0
        ? 'Every row in that sheet is blank, so there is nothing to apply.'
        : 'That sheet has no rows below the heading.';
    }
    if (report.errors === report.total_rows) {
      return 'No row in that sheet could be applied. Correct the problems listed '
        + 'above and upload it again.';
    }
    if (report.price_not_set > 0 && report.unchanged === 0) {
      return 'Every row that matched has a blank Price, so all of them stay as they '
        + 'are — there is nothing to write. Fill in a Price to change one.';
    }
    return 'Nothing in that sheet changes anything: every row already holds the '
      + 'price that is stored. Edit a Price and upload it again.';
  })();

  return (
    <>
      {/* The two actions, side by side: the template is where an upload starts,
          so it sits beside the upload rather than somewhere else. */}
      <View style={{ flexDirection: 'row', gap: SPACING.xs, marginHorizontal: SPACING.md }}>
        <TouchableOpacity
          style={[
            sa.buttonGhost,
            { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: SPACING.xs },
          ]}
          onPress={downloadTemplate}
          disabled={!businessId || busy}
          accessibilityRole="button"
          accessibilityLabel="Download the Excel price list template"
          accessibilityState={{ disabled: !businessId || busy }}
        >
          <Ionicons name="download-outline" size={18} color={COLORS.TextPrimary} />
          <Text style={sa.buttonGhostText}>Download Template</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            sa.buttonGhost,
            { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: SPACING.xs },
          ]}
          onPress={() => setOpen(true)}
          disabled={!businessId}
          accessibilityRole="button"
          accessibilityLabel="Upload a filled Excel price list"
          accessibilityState={{ disabled: !businessId }}
        >
          <Ionicons name="cloud-upload-outline" size={18} color={COLORS.TextPrimary} />
          <Text style={sa.buttonGhostText}>Upload Price List</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <View style={sa.modalBackdrop}>
          <View style={[sa.modalSheet, { maxHeight: '90%' }]}>
            <View style={sa.header}>
              <Text style={[sa.headerTitle, { flex: 1 }]}>Upload Price List</Text>
              <TouchableOpacity style={sa.iconBtn} onPress={close} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
              <Text style={sa.cardTitle}>{businessName}</Text>
              <Text style={sa.cardMeta}>
                {laundryTypeLabel} · an item not on the list is added; an item already
                on it has only its Price updated. Categories, sub-categories and service
                types are never created. A blank Price means "not set", never zero.
              </Text>

              {/* ---- 1. THE SHEET ---- */}
              <TouchableOpacity
                style={[sa.button, busy && sa.buttonDisabled, { marginTop: SPACING.md }]}
                onPress={pickAndValidate}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Choose the filled Excel file"
              >
                {busy && !report ? (
                  <ActivityIndicator color={COLORS.Surface} />
                ) : (
                  <Text style={sa.buttonText}>
                    {file ? 'Choose a different file' : 'Choose Excel File'}
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

              {/* ---- 2. THE SUMMARY ---- */}
              {report ? (
                <View style={[sa.card, { marginTop: SPACING.sm }]}>
                  <Text style={sa.cardTitle}>
                    {done ? 'Price List Upload Completed' : 'Ready to apply'}
                  </Text>
                  <Summary label="Total Excel Rows" value={report.total_rows} />
                  {/* Counted apart from an update, always: adding an item to
                      the catalogue is a different event from moving a rate,
                      and the two must never be conflated. */}
                  <Summary
                    label={done ? 'New Items Added' : 'Will be added'}
                    value={report.items_created}
                    tone={report.items_created > 0 ? COLORS.Primary : undefined}
                  />
                  <Summary
                    label={done ? 'Existing Items Updated' : 'Will be updated'}
                    value={report.updated}
                    tone={report.updated > 0 ? COLORS.Primary : undefined}
                  />
                  {report.unchanged > 0 && (
                    <Summary label="Already at this price" value={report.unchanged} />
                  )}
                  {/* NOT an error, and never shown as one: the row was valid
                      and its Price cell was simply blank. */}
                  <Summary label="Price Not Set" value={report.price_not_set} />
                  {report.blank_skipped > 0 && (
                    <Summary label="Blank Rows Skipped" value={report.blank_skipped} />
                  )}
                  <Summary
                    label="Errors"
                    value={report.errors}
                    tone={report.errors > 0 ? COLORS.Error : undefined}
                  />
                </View>
              ) : null}

              {/* ---- 3. EVERY FAILING ROW, with its reason ---- */}
              {report && report.failed_rows.length > 0 ? (
                <View style={[sa.card, { borderColor: COLORS.Error, borderWidth: 1 }]}>
                  <Text style={[sa.cardTitle, { color: COLORS.Error }]}>
                    {report.failed_rows.length} row(s) not applied
                  </Text>
                  {report.failed_rows.map((row) => (
                    <FailedRow key={row.row} row={row} />
                  ))}
                  <Text style={[sa.cardMeta, { marginTop: SPACING.xs }]}>
                    Correct these rows in the sheet and upload it again. The rows that
                    passed are unaffected either way.
                  </Text>
                </View>
              ) : null}

              {/* ---- 4. WHAT WILL MOVE, before it moves ---- */}
              {report && !done && report.changed_rows.length > 0 ? (
                <View style={sa.card}>
                  <Text style={sa.cardTitle}>
                    {report.changed_rows.length} change(s) to apply
                  </Text>
                  {report.changed_rows.slice(0, 40).map((row) => (
                    <Text key={row.row} style={sa.cardLine}>
                      {row.creates_item ? '+ ' : ''}{row.item_name} · {row.service_type}
                      {row.creates_item
                        ? ` — new item, ${money(row.new_price)}`
                        : ` — ${money(row.current_price)} → ${money(row.new_price)}`}
                    </Text>
                  ))}
                  {report.changed_rows.length > 40 ? (
                    <Text style={sa.tdMuted}>
                      …and {report.changed_rows.length - 40} more
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {/* Shown for EVERY disabled case, failures included. */}
              {!!blockedReason && <Text style={sa.empty}>{blockedReason}</Text>}

              {/* ---- 5. CONFIRM ---- */}
              {done ? (
                <TouchableOpacity
                  style={[sa.button, { backgroundColor: COLORS.PrimaryDark }]}
                  onPress={close}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                >
                  <Text style={sa.buttonText}>Done</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    sa.button,
                    { backgroundColor: COLORS.PrimaryDark },
                    !canApply && sa.buttonDisabled,
                  ]}
                  onPress={apply}
                  disabled={!canApply}
                  accessibilityRole="button"
                  accessibilityLabel="Apply these prices"
                  accessibilityState={{ disabled: !canApply }}
                >
                  {busy && report ? (
                    <ActivityIndicator color={COLORS.Surface} />
                  ) : (
                    <Text style={sa.buttonText}>
                      {/* The button says what it would do, or that it can do
                          nothing — never a bare "Apply" that does not respond. */}
                      {willChange > 0
                        ? `Apply ${willChange} Change${willChange === 1 ? '' : 's'}`
                        : report
                          ? 'Nothing to Apply'
                          : 'Apply'}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** One line of the count summary. */
function Summary({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
      <Text style={sa.cardLine}>{label}</Text>
      <Text
        style={[
          sa.cardLine,
          { fontWeight: '800', color: tone ?? COLORS.TextPrimary },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * One rejected row: its row number, the four columns it named, the price it
 * carried, and why it did not apply — which is exactly what has to be
 * corrected in the sheet.
 */
function FailedRow({ row }: { row: PriceUploadRow }) {
  return (
    <View
      style={{
        paddingVertical: SPACING.xs,
        borderTopWidth: 1,
        borderTopColor: COLORS.Border,
      }}
    >
      <Text style={[sa.cardLine, { fontWeight: '700' }]}>
        Row {row.row} · {row.reason}
      </Text>
      <Text style={sa.tdMuted}>
        {[row.main_category, row.subcategory, row.service_type, row.item_name]
          .filter(Boolean)
          .join(' › ')}
      </Text>
      <Text style={sa.tdMuted}>Price: {row.price === '' ? '(empty)' : row.price}</Text>
    </View>
  );
}
