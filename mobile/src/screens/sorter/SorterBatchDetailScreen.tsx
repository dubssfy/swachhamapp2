import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { extractErrorMessage } from '../../services/api';
import sorterBatchApi, {
  BatchRecord,
  BatchScanStatus,
  BatchStatus,
} from '../../services/sorterBatchApi';
import { BATCH_GROUP_META, BATCH_STATUS_META, utilizationColor } from './batchMeta';
import { buildBatchTagsHtml } from '../../utils/batchTagsHtml';
import { generateBatchDetailsPdf } from '../../utils/batchDetailsPdf';

/**
 * One confirmed batch: what is in it, how much of it has been scanned, and
 * where it is in the wash.
 *
 * THE SCAN COUNTS COME FROM THE SERVER. This screen adds nothing up itself,
 * which is what makes the numbers survive a repeated label read, two sorters
 * scanning the same batch, or a lost response.
 */
const NEXT_STATUS: Partial<Record<BatchStatus, { next: BatchStatus; label: string }>> = {
  CONFIRMED: { next: 'IN_MACHINE', label: 'LOAD INTO MACHINE' },
  IN_MACHINE: { next: 'WASHING', label: 'START WASHING' },
  WASHING: { next: 'COMPLETED', label: 'MARK COMPLETED' },
};

export default function SorterBatchDetailScreen({ navigation, route }: any) {
  const { batchId } = route.params as { batchId: string };

  const [batch, setBatch] = useState<BatchRecord | null>(null);
  const [scan, setScan] = useState<BatchScanStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const [batchResponse, scanResponse] = await Promise.all([
        sorterBatchApi.getBatchById(String(batchId)),
        sorterBatchApi.getBatchScanStatus(String(batchId)),
      ]);
      setBatch(batchResponse.data);
      setScan(scanResponse.data);
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to load the batch'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [batchId]);

  // Reloading on focus is what brings the scan counts up to date after the
  // sorter comes back from the scanner.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    load();
    return unsubscribe;
  }, [navigation, load]);

  const move = async (next: BatchStatus, label: string) => {
    Alert.alert(label, `Move ${batch?.batch_number} to ${BATCH_STATUS_META[next].label}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes',
        onPress: async () => {
          setIsMoving(true);
          try {
            const response = await sorterBatchApi.updateBatchStatus(String(batchId), next);
            setBatch(response.data);
          } catch (err: any) {
            setError(extractErrorMessage(err, 'Could not move the batch'));
          } finally {
            setIsMoving(false);
          }
        },
      },
    ]);
  };

  /**
   * PRINT TAG — one physical tag per piece, handed to the OS print dialog so
   * the Sorter picks the printer. No file is generated or shared; the batch
   * itself is not touched.
   */
  const printTags = async () => {
    if (!batch || isPrinting) return;
    setIsPrinting(true);
    try {
      await Print.printAsync({ html: buildBatchTagsHtml(batch) });
    } catch (err: any) {
      // Cancelling the print dialog also rejects the promise; that is not a
      // failure worth surfacing.
      const message = String(err?.message || '').toLowerCase();
      if (!message.includes('cancel')) {
        Alert.alert('Could not print tags', extractErrorMessage(err, 'Please try again.'));
      }
    } finally {
      setIsPrinting(false);
    }
  };

  /**
   * BATCH DETAILS — generates the batch's PDF and hands it to the native
   * share sheet, the same way Share PDF does on the Business Order Details
   * screen. Read-only: it renders the batch already loaded on this screen
   * and writes nothing back.
   */
  const showBatchDetailsPdf = async () => {
    if (!batch || isGeneratingPdf) return;
    setIsGeneratingPdf(true);
    try {
      const { uri, fileName } = await generateBatchDetailsPdf(batch);
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device');
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: fileName,
        UTI: 'com.adobe.pdf',
      });
    } catch (err: any) {
      Alert.alert('Could not generate batch details', extractErrorMessage(err, 'Please try again.'));
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const cancel = () => {
    Alert.alert(
      'Cancel batch',
      'The machine is freed and these items return to the batch queue. The batch stays on record.',
      [
        { text: 'Keep batch', style: 'cancel' },
        {
          text: 'Cancel batch',
          style: 'destructive',
          onPress: async () => {
            setIsMoving(true);
            try {
              const response = await sorterBatchApi.updateBatchStatus(String(batchId), 'CANCELLED');
              setBatch(response.data);
            } catch (err: any) {
              setError(extractErrorMessage(err, 'Could not cancel the batch'));
            } finally {
              setIsMoving(false);
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header title="Batch" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!batch) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header title="Batch" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error || 'Batch not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const group = BATCH_GROUP_META[batch.washing_group];
  const status = BATCH_STATUS_META[batch.status];
  const step = NEXT_STATUS[batch.status];
  const canScan = ['CONFIRMED', 'IN_MACHINE', 'WASHING'].includes(batch.status);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title={batch.batch_number} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              setIsRefreshing(true);
              load();
            }}
            colors={[COLORS.Primary]}
            tintColor={COLORS.Primary}
          />
        }
      >
        <View style={[styles.card, { borderTopColor: group.color }]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.machineName}>{batch.machine_name}</Text>
              <Text style={styles.capacity}>{batch.capacity_kg} KG</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: status.color }]}>
              <Text style={styles.pillText}>{status.label}</Text>
            </View>
          </View>

          <View style={styles.rowBetween}>
            <View style={[styles.groupPill, { backgroundColor: group.color }]}>
              <Text style={styles.pillText}>{group.label}</Text>
            </View>
            <Text
              style={[styles.utilization, { color: utilizationColor(batch.utilization_percentage) }]}
            >
              {batch.utilization_percentage}%
            </Text>
          </View>

          <Text style={styles.total}>
            {batch.total_weight_kg} / {batch.capacity_kg} kg · {batch.item_count} line
            {batch.item_count === 1 ? '' : 's'}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.min(100, batch.utilization_percentage)}%`,
                  backgroundColor: utilizationColor(batch.utilization_percentage),
                },
              ]}
            />
          </View>
        </View>

        {/* ---- Quantity matching, from the server's counts ---- */}
        {scan ? (
          <View style={styles.scanCard}>
            <View style={styles.countRow}>
              <Count label="Expected" value={scan.expected_count} color={COLORS.TextPrimary} />
              <Count
                label="Scanned"
                value={`${scan.scanned_count} / ${scan.expected_count}`}
                color={COLORS.Primary}
              />
              <Count
                label="Remaining"
                value={scan.remaining_count}
                color={scan.remaining_count ? COLORS.Warning : COLORS.Success}
              />
            </View>
            {scan.quantity_matched ? (
              <View style={styles.matchBanner}>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.Surface} />
                <Text style={styles.matchText}>QUANTITY MATCH ✓</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {canScan ? (
          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => navigation.navigate('SorterBatchScanScreen', { batchId: batch.id })}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Scan garments into this batch"
          >
            <Ionicons name="barcode-outline" size={22} color={COLORS.Surface} />
            <Text style={styles.scanButtonText}>SCAN GARMENTS</Text>
          </TouchableOpacity>
        ) : null}

        {/* ---- The lines in the batch, grouped by order ---- */}
        <Text style={styles.sectionTitle}>ITEMS IN THIS BATCH</Text>
        {(batch.items || []).map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.itemOrder}>{item.order_number}</Text>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.item_name}
              {/* A split line names both figures: this drum holds only part. */}
              {item.is_partial ? ` (of ${item.ordered_quantity})` : ''}
            </Text>
            <Text style={styles.itemQty}>
              {item.quantity} pc · {item.weight_kg} kg
            </Text>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.printButton, isPrinting && styles.disabled]}
          onPress={printTags}
          disabled={isPrinting}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Print one tag per piece in this batch"
        >
          {isPrinting ? (
            <ActivityIndicator color={COLORS.PrimaryDark} />
          ) : (
            <>
              <Ionicons name="print-outline" size={20} color={COLORS.PrimaryDark} />
              <Text style={styles.printButtonText}>PRINT TAG</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.printButton, isGeneratingPdf && styles.disabled]}
          onPress={showBatchDetailsPdf}
          disabled={isGeneratingPdf}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Generate a PDF with this batch's full details"
        >
          {isGeneratingPdf ? (
            <ActivityIndicator color={COLORS.PrimaryDark} />
          ) : (
            <>
              <Ionicons name="document-text-outline" size={20} color={COLORS.PrimaryDark} />
              <Text style={styles.printButtonText}>BATCH DETAILS</Text>
            </>
          )}
        </TouchableOpacity>

        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* ---- Lifecycle ---- */}
        {step ? (
          <TouchableOpacity
            style={[styles.primaryButton, isMoving && styles.disabled]}
            onPress={() => move(step.next, step.label)}
            disabled={isMoving}
            activeOpacity={0.85}
          >
            {isMoving ? (
              <ActivityIndicator color={COLORS.Surface} />
            ) : (
              <Text style={styles.primaryButtonText}>{step.label}</Text>
            )}
          </TouchableOpacity>
        ) : null}

        {['CONFIRMED', 'IN_MACHINE', 'WASHING'].includes(batch.status) ? (
          <TouchableOpacity
            style={[styles.dangerButton, isMoving && styles.disabled]}
            onPress={cancel}
            disabled={isMoving}
            activeOpacity={0.85}
          >
            <Text style={styles.dangerButtonText}>CANCEL BATCH</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.footnote}>
          Batching does not change an order's status. The orders in this batch keep moving through
          the usual Sorter workflow.
        </Text>
      </ScrollView>
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },

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

  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },

  card: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderTopWidth: 4,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  machineName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },
  capacity: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    letterSpacing: 1,
  },
  pill: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: BORDER_RADIUS.full },
  groupPill: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: BORDER_RADIUS.full },
  pillText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },
  utilization: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: '800',
  },
  total: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginTop: SPACING.sm,
  },
  barTrack: {
    height: 8,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.Border,
    marginTop: SPACING.xs,
    overflow: 'hidden',
  },
  barFill: { height: 8, borderRadius: BORDER_RADIUS.full },

  scanCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  countRow: { flexDirection: 'row' },
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
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Success,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.sm,
  },
  matchText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 1,
  },

  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 56,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.PrimaryDark,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  scanButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 1,
  },

  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  itemOrder: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
    color: COLORS.TextSecondary,
    maxWidth: 130,
  },
  itemName: {
    flex: 1,
    minWidth: 0,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
  },
  itemQty: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },

  printButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 48,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 2,
    borderColor: COLORS.PrimaryDark,
    marginTop: SPACING.sm,
  },
  printButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
    letterSpacing: 1,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.Primary,
    marginTop: SPACING.md,
  },
  primaryButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 1,
  },
  dangerButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 2,
    borderColor: COLORS.Error,
    marginTop: SPACING.sm,
  },
  dangerButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.Error,
    letterSpacing: 1,
  },
  disabled: { opacity: 0.5 },

  errorBlock: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: '#FDECEC',
    marginTop: SPACING.md,
  },
  errorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
    textAlign: 'center',
  },
  footnote: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: SPACING.lg,
  },
});
