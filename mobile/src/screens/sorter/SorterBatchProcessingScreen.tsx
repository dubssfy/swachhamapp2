import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { extractErrorMessage } from '../../services/api';
import sorterBatchApi, {
  BatchEligibility,
  BatchRecord,
  Machine,
  MachineStatus,
} from '../../services/sorterBatchApi';
import { BATCH_GROUP_META, MACHINE_STATUS_META, BATCH_STATUS_META } from './batchMeta';

/**
 * Batch Processing — the entry point of the new workflow.
 *
 * WHAT THE SORTER SEES BEFORE PRESSING ANYTHING: how many approved orders are
 * waiting, and what the three machines are doing. That is a read; opening this
 * screen does not optimise anything.
 *
 * THE OPTIMISATION RUNS ON A BUTTON PRESS AND NOWHERE ELSE. `startBatch` is
 * called from `handleStartBatch` only — not from an effect, not from the focus
 * listener, not from a poll, and not from a render. The focus listener below
 * calls `load`, which is the eligibility READ.
 */
export default function SorterBatchProcessingScreen({ navigation }: any) {
  const [eligibility, setEligibility] = useState<BatchEligibility | null>(null);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');

  /** The counts and the machine states. A read — never an optimisation. */
  const load = useCallback(async () => {
    try {
      setError('');
      const [eligibleResponse, batchResponse] = await Promise.all([
        sorterBatchApi.getEligibility(),
        sorterBatchApi.getBatches(),
      ]);
      setEligibility(eligibleResponse.data);
      setBatches(batchResponse.data || []);
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to load batch processing'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Brings the counts back up to date after the sorter has confirmed a batch
  // or approved more orders. Still only the read.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    load();
    return unsubscribe;
  }, [navigation, load]);

  /**
   * START BATCH.
   *
   * The ONLY place the optimiser is asked to run. The result is a proposal —
   * nothing is written — so the next screen is a review, not a confirmation.
   */
  const handleStartBatch = async () => {
    setIsStarting(true);
    setError('');
    try {
      const response = await sorterBatchApi.startBatch();
      navigation.navigate('SorterBatchDistributionScreen', { proposal: response.data });
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Could not calculate a batch distribution'));
    } finally {
      setIsStarting(false);
    }
  };

  const approvedReady = eligibility?.approved_orders_ready ?? 0;
  const eligibleItems = eligibility?.eligible_items ?? 0;
  const availableMachines = eligibility?.available_machines ?? 0;
  const canStart = approvedReady > 0 && availableMachines > 0 && !isStarting;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Batch Processing</Text>
      </View>

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
        {isLoading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="large" color={COLORS.Primary} />
            <Text style={styles.loadingText}>Loading batch processing...</Text>
          </View>
        ) : (
          <>
            {/* ---- Approved and waiting ---- */}
            <View style={styles.readyCard}>
              <Text style={styles.readyLabel}>APPROVED ORDERS READY</Text>
              <Text style={styles.readyValue}>{approvedReady}</Text>
              <Text style={styles.readyCaption}>
                {eligibleItems} item line{eligibleItems === 1 ? '' : 's'} ·{' '}
                {(eligibility?.total_weight_kg ?? 0).toFixed(2)} kg waiting
              </Text>
              <Text style={styles.readyNote}>
                Only orders you have approved can enter a batch.
              </Text>
            </View>

            {/* ---- The three machines ---- */}
            <Text style={styles.sectionTitle}>AVAILABLE MACHINES</Text>
            {(eligibility?.machines || []).map((machine) => (
              <MachineRow key={machine.id} machine={machine} />
            ))}

            {/* ---- START BATCH ---- */}
            <TouchableOpacity
              style={[styles.startButton, !canStart && styles.startButtonDisabled]}
              onPress={handleStartBatch}
              disabled={!canStart}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Start batch"
            >
              {isStarting ? (
                <ActivityIndicator color={COLORS.Surface} />
              ) : (
                <>
                  <Ionicons name="git-branch-outline" size={22} color={COLORS.Surface} />
                  <Text style={styles.startButtonText}>START BATCH</Text>
                </>
              )}
            </TouchableOpacity>

            {!canStart && !isStarting ? (
              <Text style={styles.startHint}>
                {approvedReady === 0
                  ? 'No approved orders are waiting. Approve an order first.'
                  : 'No machine is available. Free a machine to start a batch.'}
              </Text>
            ) : (
              <Text style={styles.startHint}>
                Nothing is assigned yet — you will review the distribution first.
              </Text>
            )}

            {error ? (
              <View style={styles.errorBlock}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* ---- Batches already on the floor ---- */}
            <Text style={styles.sectionTitle}>CURRENT BATCHES</Text>
            {batches.length === 0 ? (
              <Text style={styles.emptyText}>No batch is running.</Text>
            ) : (
              batches.map((batch) => (
                <TouchableOpacity
                  key={batch.id}
                  style={styles.batchCard}
                  onPress={() =>
                    navigation.navigate('SorterBatchDetailScreen', { batchId: batch.id })
                  }
                  activeOpacity={0.85}
                >
                  <View style={styles.batchTop}>
                    <Text style={styles.batchNumber}>{batch.batch_number}</Text>
                    <View
                      style={[
                        styles.pill,
                        { backgroundColor: BATCH_STATUS_META[batch.status].color },
                      ]}
                    >
                      <Text style={styles.pillText}>{BATCH_STATUS_META[batch.status].label}</Text>
                    </View>
                  </View>
                  <Text style={styles.batchLine}>
                    {batch.machine_name} · {batch.capacity_kg} KG ·{' '}
                    {BATCH_GROUP_META[batch.washing_group].label}
                  </Text>
                  <Text style={styles.batchLine}>
                    {batch.total_weight_kg} / {batch.capacity_kg} kg ·{' '}
                    {batch.utilization_percentage}% · {batch.item_count} line
                    {batch.item_count === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MachineRow({ machine }: { machine: Machine }) {
  const meta = MACHINE_STATUS_META[machine.status as MachineStatus];
  return (
    <View style={[styles.machineRow, { borderLeftColor: meta.color }]}>
      <View style={styles.machineCapacity}>
        <Text style={styles.machineCapacityValue}>{machine.capacity_kg}</Text>
        <Text style={styles.machineCapacityUnit}>KG</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.machineName}>{machine.name}</Text>
        <Text style={[styles.machineStatus, { color: meta.color }]}>{meta.label}</Text>
      </View>
      <Ionicons
        name={machine.status === 'AVAILABLE' ? 'checkmark-circle' : 'ellipse'}
        size={18}
        color={meta.color}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },

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

  readyCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    borderLeftWidth: 5,
    borderLeftColor: COLORS.Primary,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    ...SHADOWS.light,
  },
  readyLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '800',
    color: COLORS.TextSecondary,
    letterSpacing: 1,
  },
  readyValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xxxl,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
  },
  readyCaption: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
  },
  readyNote: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: SPACING.xs,
  },

  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    letterSpacing: 1,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },

  machineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderLeftWidth: 5,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.light,
  },
  machineCapacity: { alignItems: 'center', minWidth: 46 },
  machineCapacityValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  machineCapacityUnit: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    letterSpacing: 1,
  },
  machineName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  machineStatus: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 2,
  },

  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 60,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.Primary,
    marginTop: SPACING.lg,
    ...SHADOWS.light,
  },
  startButtonDisabled: { backgroundColor: COLORS.TextSecondary, opacity: 0.6 },
  startButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 1,
  },
  startHint: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },

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

  batchCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.light,
  },
  batchTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  batchNumber: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },
  batchLine: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  pill: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.full,
  },
  pillText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },

  loadingBlock: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm },
  loadingText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
  },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    paddingVertical: SPACING.sm,
  },
});
