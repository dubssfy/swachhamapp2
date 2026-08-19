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
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import sorterApi, { Garment, ScanStageName, ScanStatus } from '../../services/sorterApi';
import { extractErrorMessage } from '../../services/api';

/** The camera reports the same code many times a second while it is in view. */
const SCAN_COOLDOWN_MS = 1500;

const STAGE_COPY: Record<ScanStageName, { title: string; done: string }> = {
  acceptance: { title: 'Acceptance Scan', done: 'All garments have been scanned.' },
  delivery: { title: 'Delivery Verification', done: 'All garments verified for delivery.' },
};

type Feedback = { kind: 'success' | 'error'; text: string } | null;

/**
 * Garment scanning, for both stages.
 *
 * The screen never counts anything itself: every barcode goes to the server,
 * and the counts shown come back from it. That is what makes a repeated read
 * of the same label harmless — the server rejects it as a duplicate and the
 * number does not move.
 */
export default function SorterScanScreen({ navigation, route }: any) {
  const { orderId, stage } = route.params as { orderId: string; stage: ScanStageName };
  const copy = STAGE_COPY[stage];

  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);

  /** Blocks the burst of repeat reads while one scan is in flight. */
  const busyRef = useRef(false);
  const lastCodeRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });

  const load = useCallback(async () => {
    try {
      // Idempotent: issues barcodes the first time an order is opened, and
      // returns the existing ones every time after.
      const response = await sorterApi.generateGarments(String(orderId));
      setStatus(response.data);
    } catch (err: any) {
      setFeedback({ kind: 'error', text: extractErrorMessage(err, 'Failed to load garments') });
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

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
      const response = await sorterApi.scan(String(orderId), stage, code);
      const data = response.data;
      if (Platform.OS !== 'web') Vibration.vibrate(40);
      setFeedback({
        kind: 'success',
        text: data.quantityMatched
          ? `✓ ${data.garment.item_name} — ${copy.done}`
          : `✓ ${data.garment.item_name} · ${data.remainingCount} remaining`,
      });
      await refreshStatus();
    } catch (err: any) {
      // The server's message is already user-facing: "Garment already
      // scanned.", "This garment belongs to another order.", and so on.
      setFeedback({ kind: 'error', text: extractErrorMessage(err, 'Scan failed. Please try again.') });
    } finally {
      setIsScanning(false);
      // Held for the cooldown so the same label cannot re-fire immediately.
      setTimeout(() => {
        busyRef.current = false;
      }, SCAN_COOLDOWN_MS);
    }
  };

  const refreshStatus = async () => {
    try {
      const response = await sorterApi.getScanStatus(String(orderId));
      setStatus(response.data);
    } catch {
      // The scan itself already succeeded; a failed refresh is not worth an
      // error message over the top of it.
    }
  };

  const scanned = stage === 'acceptance' ? status?.acceptance_scanned ?? 0 : status?.delivery_scanned ?? 0;
  const expected = status?.expected_count ?? 0;
  const remaining = Math.max(expected - scanned, 0);
  const matched = stage === 'acceptance' ? status?.acceptance_matched : status?.delivery_matched;

  const scannedGarments = (status?.garments || []).filter((g) =>
    stage === 'acceptance' ? g.accepted_scan_at : g.delivery_scan_at
  );

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
        <Header title={copy.title} onBack={() => navigation.goBack()} />
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
      <Header title={copy.title} onBack={() => navigation.goBack()} />

      <View style={styles.countRow}>
        <Count label="Expected" value={expected} color={COLORS.TextPrimary} />
        <Count label="Scanned" value={`${scanned} / ${expected}`} color={COLORS.Primary} />
        <Count label="Remaining" value={remaining} color={remaining ? COLORS.Warning : COLORS.Success} />
      </View>

      {matched ? (
        <View style={styles.matchBanner}>
          <Ionicons name="checkmark-circle" size={22} color={COLORS.Surface} />
          <View style={{ flex: 1 }}>
            <Text style={styles.matchTitle}>✓ QUANTITY MATCH</Text>
            <Text style={styles.matchSubtitle}>{copy.done}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.cameraBox}>
        {cameraOn ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            // The formats the garment labels use, plus QR for flexibility.
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
        Hold one garment label inside the frame. Each barcode counts once.
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
          keyExtractor={(item: Garment) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.garmentRow}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.Success} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.garmentName}>{item.item_name}</Text>
                <Text style={styles.garmentCode}>{item.barcode}</Text>
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md, padding: SPACING.xl },

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
    backgroundColor: COLORS.Background,
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },

  countRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.Surface,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    ...SHADOWS.light,
  },
  countCell: { flex: 1, alignItems: 'center' },
  countValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: '800',
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
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  matchTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Surface,
  },
  matchSubtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Surface,
  },

  cameraBox: {
    height: 260,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  cameraOff: { alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, backgroundColor: COLORS.Surface },
  cameraOffText: { fontFamily: TYPOGRAPHY.fontFamily, color: COLORS.TextSecondary },
  reticle: {
    position: 'absolute',
    top: '18%',
    left: '10%',
    right: '10%',
    bottom: '18%',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: BORDER_RADIUS.md,
  },
  scanningBadge: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: BORDER_RADIUS.full,
    padding: SPACING.sm,
  },

  instruction: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },

  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  feedbackSuccess: { backgroundColor: COLORS.Success },
  feedbackError: { backgroundColor: COLORS.Error },
  feedbackText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.Surface,
  },

  actionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
  },
  primaryButton: {
    height: 54,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    ...SHADOWS.medium,
  },
  primaryButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    height: 54,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.Primary,
    backgroundColor: COLORS.Surface,
  },
  secondaryButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.Primary,
  },

  listHeading: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    marginTop: SPACING.md,
    marginHorizontal: SPACING.md,
  },
  listContent: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.xxl },
  garmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.Border,
  },
  garmentName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  garmentCode: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
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
