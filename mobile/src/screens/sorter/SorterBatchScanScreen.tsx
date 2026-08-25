import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Vibration,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import sorterBatchApi, { BatchScanStatus } from '../../services/sorterBatchApi';
import { extractErrorMessage } from '../../services/api';

/** The camera reports the same code many times a second while it is in view. */
const SCAN_COOLDOWN_MS = 1500;

type Feedback = { kind: 'success' | 'error'; text: string } | null;

/**
 * Batch garment scanning.
 *
 * A SEPARATE SCREEN from `SorterScanScreen`, which is untouched and still owns
 * acceptance and delivery. This one asks a different question — "is this
 * garment part of THIS batch?" — and the server answers it in the three ways
 * the shop floor needs:
 *
 *   ACCEPTED         the garment's line is in this batch, first scan for it
 *   WRONG BATCH      real barcode, different batch. Named when it is known.
 *   ALREADY SCANNED  counted for this batch already
 *
 * THE SCREEN COUNTS NOTHING. Every barcode goes to the server and the counts
 * come back from it, so a repeated read of the same label is harmless: the
 * server refuses it and the number does not move.
 */
export default function SorterBatchScanScreen({ navigation, route }: any) {
  const { batchId } = route.params as { batchId: string };

  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<BatchScanStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);

  /** Blocks the burst of repeat reads while one scan is in flight. */
  const busyRef = useRef(false);
  const lastCodeRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });

  const load = useCallback(async () => {
    try {
      const response = await sorterBatchApi.getBatchScanStatus(String(batchId));
      setStatus(response.data);
    } catch (err: any) {
      setFeedback({ kind: 'error', text: extractErrorMessage(err, 'Failed to load the batch') });
    } finally {
      setIsLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshStatus = async () => {
    try {
      const response = await sorterBatchApi.getBatchScanStatus(String(batchId));
      setStatus(response.data);
    } catch {
      // The scan itself already succeeded; a failed refresh is not worth an
      // error message over the top of it.
    }
  };

  const handleBarcode = async (result: BarcodeScanningResult) => {
    const code = String(result?.data || '').trim();
    if (!code || busyRef.current) return;

    // Debounce: ignore the same code again inside the cooldown window.
    const now = Date.now();
    if (lastCodeRef.current.value === code && now - lastCodeRef.current.at < SCAN_COOLDOWN_MS) {
      return;
    }
    lastCodeRef.current = { value: code, at: now };

    busyRef.current = true;
    setIsScanning(true);
    try {
      const response = await sorterBatchApi.scanBatchGarment(String(batchId), code);
      const data = response.data;
      if (Platform.OS !== 'web') Vibration.vibrate(40);
      setFeedback({
        kind: 'success',
        text: data.quantityMatched
          ? `✓ QUANTITY MATCH — every garment in this batch is scanned.`
          : `✓ ACCEPTED · ${data.garment.item_name} · ${data.remainingCount} remaining`,
      });
      await refreshStatus();
    } catch (err: any) {
      // The server's message is already user-facing: "WRONG BATCH — this
      // garment belongs to batch B-…", "ALREADY SCANNED — …".
      setFeedback({
        kind: 'error',
        text: extractErrorMessage(err, 'Scan failed. Please try again.'),
      });
      if (Platform.OS !== 'web') Vibration.vibrate([0, 60, 60, 60]);
    } finally {
      setIsScanning(false);
      setTimeout(() => {
        busyRef.current = false;
      }, SCAN_COOLDOWN_MS);
    }
  };

  const expected = status?.expected_count ?? 0;
  const scanned = status?.scanned_count ?? 0;
  const remaining = status?.remaining_count ?? 0;
  const matched = status?.quantity_matched ?? false;
  const scannedGarments = (status?.garments || []).filter((g) => g.scanned_at);

  if (!permission) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header title="Batch Scan" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Ionicons name="camera-outline" size={48} color={COLORS.TextSecondary} />
          <Text style={styles.permissionText}>
            {permission.canAskAgain
              ? 'Camera access is needed to scan garment barcodes.'
              : 'Camera access was denied. Enable it in your device settings to scan barcodes.'}
          </Text>
          {permission.canAskAgain ? (
            <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
              <Text style={styles.primaryButtonText}>ALLOW CAMERA</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        title={status ? `Batch ${status.batch_number}` : 'Batch Scan'}
        onBack={() => navigation.goBack()}
      />

      <View style={styles.countRow}>
        <Count label="Expected" value={expected} color={COLORS.TextPrimary} />
        <Count label="Scanned" value={`${scanned} / ${expected}`} color={COLORS.Primary} />
        <Count
          label="Remaining"
          value={remaining}
          color={remaining ? COLORS.Warning : COLORS.Success}
        />
      </View>

      {matched ? (
        <View style={styles.matchBanner}>
          <Ionicons name="checkmark-circle" size={22} color={COLORS.Surface} />
          <View style={{ flex: 1 }}>
            <Text style={styles.matchTitle}>✓ QUANTITY MATCH</Text>
            <Text style={styles.matchSubtitle}>Every garment in this batch has been scanned.</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.cameraBox}>
        {cameraOn ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['code128', 'qr', 'code39', 'ean13'] }}
            onBarcodeScanned={handleBarcode}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.cameraOff]}>
            <Ionicons name="videocam-off-outline" size={40} color={COLORS.TextSecondary} />
            <Text style={styles.cameraOffText}>Camera paused</Text>
          </View>
        )}
        <View pointerEvents="none" style={styles.reticle} />
        {isScanning ? (
          <View style={styles.scanningBadge}>
            <ActivityIndicator size="small" color={COLORS.Surface} />
          </View>
        ) : null}
      </View>

      <Text style={styles.instruction}>
        Hold one garment label inside the frame. A garment from another batch is refused.
      </Text>

      {feedback ? (
        <View
          style={[
            styles.feedback,
            feedback.kind === 'success' ? styles.feedbackSuccess : styles.feedbackError,
          ]}
        >
          <Ionicons
            name={feedback.kind === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={20}
            color={COLORS.Surface}
          />
          <Text style={styles.feedbackText}>{feedback.text}</Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => setCameraOn((value) => !value)}
          activeOpacity={0.85}
        >
          <Ionicons
            name={cameraOn ? 'pause-outline' : 'play-outline'}
            size={18}
            color={COLORS.Primary}
          />
          <Text style={styles.secondaryButtonText}>{cameraOn ? 'PAUSE' : 'RESUME'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryButton, { flex: 1 }]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryButtonText}>DONE</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.listHeading}>Scanned garments ({scannedGarments.length})</Text>
      {isLoading ? (
        <ActivityIndicator color={COLORS.Primary} style={{ marginTop: SPACING.md }} />
      ) : (
        <FlatList
          data={scannedGarments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.garmentRow}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.Success} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.garmentName}>{item.item_name}</Text>
                <Text style={styles.garmentCode}>
                  {item.barcode} · {item.order_number}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>Nothing scanned yet.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

function Count({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View style={styles.countCell}>
      <Text style={[styles.countValue, { color }]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    padding: SPACING.xl,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.Border,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
  },

  countRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.Surface,
  },
  countCell: { flex: 1, alignItems: 'center' },
  countValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: 'bold',
  },
  countLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },

  matchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Success,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  matchTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 1,
  },
  matchSubtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.Surface,
  },

  cameraBox: {
    height: 220,
    margin: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  cameraOff: { alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  cameraOffText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  reticle: {
    position: 'absolute',
    left: '15%',
    right: '15%',
    top: '25%',
    bottom: '25%',
    borderWidth: 2,
    borderColor: COLORS.Accent,
    borderRadius: BORDER_RADIUS.sm,
  },
  scanningBadge: {
    position: 'absolute',
    right: SPACING.sm,
    top: SPACING.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },

  instruction: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    paddingHorizontal: SPACING.md,
  },

  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  feedbackSuccess: { backgroundColor: COLORS.Success },
  feedbackError: { backgroundColor: COLORS.Error },
  feedbackText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.Surface,
  },

  actionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
  },
  primaryButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 1,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    minHeight: 48,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.Primary,
  },
  secondaryButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.Primary,
  },

  listHeading: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.TextPrimary,
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.xs,
  },
  listContent: { padding: SPACING.md, gap: SPACING.xs },
  garmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm,
  },
  garmentName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  garmentCode: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  permissionText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
    textAlign: 'center',
  },
});
