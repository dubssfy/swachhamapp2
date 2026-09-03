import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
// The legacy entry point, the same one every other PDF download in the app
// uses: SDK 54's new API replaced cacheDirectory with a different file model.
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi from '../../services/superAdminApi';
import {
  runPdfFileAction, PDF_ACTIONS, PdfFileAction,
} from './SuperAdminBusinessAccountScreen';

/**
 * GENERATE PDF, and the four things that can then be done with it.
 *
 * ONE COMPONENT FOR EVERY KG REPORT. Generate downloads the report the server
 * rendered — the same service the screen's own figures came from, so the
 * document cannot hold different numbers — and the sheet then hands that ONE
 * file to the device.
 *
 * NOT A SECOND IMPLEMENTATION OF ANYTHING. The four actions are
 * `runPdfFileAction`, exactly as the Order Detail, Invoice, Order Summary and
 * Combine Orders tabs use it: Open goes to the device's own viewer, Print to
 * the system print dialog, Share to the native sheet, and Save writes to the
 * folder the user picks. Nothing about the PDF is built or altered here.
 */
export default function ReportPdfActions({
  url, fileName, title, disabled,
}: {
  /** The report's `.pdf` endpoint, already carrying its window. */
  url: string;
  /** What the saved and shared file is called. */
  fileName: string;
  /** Named on the share sheet, so the recipient sees which report it is. */
  title: string;
  disabled?: boolean;
}) {
  const [built, setBuilt] = useState<{ uri: string; fileName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      /*
       * `downloadAsync` makes its own request, so the bearer token is
       * attached explicitly — these endpoints are SUPER_ADMIN only. It also
       * ignores the server's Content-Disposition, so the name here is what
       * the file ends up called.
       */
      const headers = await superAdminApi.authHeader();
      const target = `${FileSystem.cacheDirectory}${encodeURIComponent(fileName)}`;
      const result = await FileSystem.downloadAsync(url, target, { headers });
      if (result.status !== 200) throw new Error('That report could not be generated.');
      setBuilt({ uri: result.uri, fileName });
    } catch (e: any) {
      setError(e?.message || 'Could not generate the PDF.');
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: PdfFileAction) => {
    if (actionBusy || !built) return;
    setActionBusy(true);
    setError('');
    try {
      await runPdfFileAction(action, built, {
        printTempName: 'kg-report.pdf',
        saveName: built.fileName,
        shareTitle: title,
        savedMessage: 'The report PDF was saved to the folder you chose.',
      });
    } catch (e: any) {
      setError(e?.message || 'Could not complete that PDF action.');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[sa.button, (busy || disabled) && sa.buttonDisabled]}
        onPress={generate}
        disabled={busy || disabled}
        accessibilityRole="button"
        accessibilityLabel={`Generate the ${title} PDF`}
      >
        {busy ? (
          <ActivityIndicator color={COLORS.Surface} />
        ) : (
          <Text style={sa.buttonText}>Generate PDF</Text>
        )}
      </TouchableOpacity>

      {!!error && (
        <View style={[sa.errorBox, { marginTop: SPACING.sm }]}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
          <Text style={sa.errorText}>{error}</Text>
        </View>
      )}

      {/* The four options, on the file just generated. Same sheet, same rows
          and the same handler as every other PDF in the Super Admin. */}
      <Modal
        visible={built !== null}
        transparent
        animationType="slide"
        onRequestClose={() => !actionBusy && setBuilt(null)}
      >
        <View style={sa.modalBackdrop}>
          <View style={sa.modalSheet}>
            <View style={sa.header}>
              <Text style={[sa.headerTitle, { flex: 1 }]} numberOfLines={1}>
                {built?.fileName || 'Report PDF'}
              </Text>
              <TouchableOpacity
                style={sa.iconBtn}
                onPress={() => setBuilt(null)}
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
                PDF_ACTIONS.map(({ action, icon, label }) => (
                  <TouchableOpacity
                    key={action}
                    style={sa.choice}
                    onPress={() => run(action)}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                  >
                    <Ionicons name={icon as any} size={20} color={COLORS.Primary} />
                    <Text style={sa.choiceText}>{label}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
