import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { extractErrorMessage } from '../../services/api';
import sorterBatchApi, { BatchProposal, ProposedBatch } from '../../services/sorterBatchApi';
import { BATCH_GROUP_META, utilizationColor } from './batchMeta';

/**
 * PROPOSED BATCH DISTRIBUTION — the review step.
 *
 * NOTHING ON THIS SCREEN HAS HAPPENED YET. What it shows is a calculation the
 * server returned; no batch exists, no machine is reserved and no order has
 * moved. Three ways out:
 *
 *   REGENERATE     ask the server to calculate again, against whatever is
 *                  eligible and whichever machines are free NOW. It creates no
 *                  duplicate batches because it creates no batches at all.
 *   CONFIRM BATCH  the only action that writes anything.
 *   CANCEL         walk away. Nothing to undo.
 */
export default function SorterBatchDistributionScreen({ navigation, route }: any) {
  const [proposal, setProposal] = useState<BatchProposal>(route.params.proposal);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState('');

  /** REGENERATE — the same endpoint as START BATCH, and just as harmless. */
  const handleRegenerate = async () => {
    setIsRegenerating(true);
    setError('');
    try {
      const response = await sorterBatchApi.startBatch();
      setProposal(response.data);
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Could not recalculate the distribution'));
    } finally {
      setIsRegenerating(false);
    }
  };

  /**
   * CONFIRM BATCH.
   *
   * Sends machine ids and order line ids only. Everything else — the weights,
   * the washing groups, whether each order is still approved and unbatched,
   * whether each machine is still free — is re-checked on the server inside a
   * transaction. A 409 means the floor moved under this proposal, and the
   * answer offered is to regenerate.
   */
  const handleConfirm = () => {
    Alert.alert(
      'Confirm batch',
      `Create ${proposal.batches.length} batch${proposal.batches.length === 1 ? '' : 'es'} ` +
        `for ${proposal.total_weight_kg} kg of laundry?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: confirmNow },
      ]
    );
  };

  const confirmNow = async () => {
    setIsConfirming(true);
    setError('');
    try {
      const response = await sorterBatchApi.confirmBatch(
        // PIECES, not just line ids: a split line contributes part of itself
        // to this drum and the rest to another, and the server re-checks that
        // the two together never exceed what the order actually has.
        proposal.batches.map((batch) => ({
          machineId: batch.machine_id,
          lines: batch.items.map((item) => ({
            orderItemId: item.order_item_id,
            quantity: item.quantity,
          })),
        }))
      );
      const created = response.data.batches;
      Alert.alert(
        'Batches created',
        created.map((b) => `${b.batch_number} — ${b.machine_name} (${b.utilization_percentage}%)`).join('\n'),
        [
          {
            text: 'OK',
            onPress: () =>
              // Straight to the first batch, which is where the barcode
              // scanning for it starts.
              navigation.replace('SorterBatchDetailScreen', { batchId: created[0].id }),
          },
        ]
      );
    } catch (err: any) {
      setError(
        extractErrorMessage(err, 'Could not confirm the batch') +
          ' Press REGENERATE to recalculate.'
      );
    } finally {
      setIsConfirming(false);
    }
  };

  const busy = isRegenerating || isConfirming;

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
        <Text style={styles.headerTitle}>Proposed Distribution</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.noticeCard}>
          <Ionicons name="information-circle-outline" size={20} color={COLORS.Info} />
          <Text style={styles.noticeText}>
            Nothing has been assigned yet. Review the distribution, then confirm it.
          </Text>
        </View>

        {/* ---- The overall figure ---- */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{proposal.machines_used}</Text>
            <Text style={styles.summaryLabel}>Machines</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{proposal.total_weight_kg}</Text>
            <Text style={styles.summaryLabel}>Total kg</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text
              style={[
                styles.summaryValue,
                { color: utilizationColor(proposal.overall_utilization_percentage) },
              ]}
            >
              {proposal.overall_utilization_percentage}%
            </Text>
            <Text style={styles.summaryLabel}>Utilisation</Text>
          </View>
        </View>

        {/* ---- One card per machine ---- */}
        {proposal.batches.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="alert-circle-outline" size={28} color={COLORS.Warning} />
            <Text style={styles.emptyTitle}>No batch could be proposed</Text>
            <Text style={styles.emptyText}>
              There is no approved laundry that fits an available machine right now.
            </Text>
          </View>
        ) : (
          proposal.batches.map((batch) => <BatchCard key={batch.machine_id} batch={batch} />)
        )}

        {/* ---- What the plan left behind, and why ---- */}
        {proposal.unplaced.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>NOT IN THIS BATCH</Text>
            {proposal.unplaced.map((item) => (
              <View key={item.order_item_id} style={styles.unplacedRow}>
                <Text style={styles.unplacedName}>
                  {item.order_number} — {item.item_name} · {item.weight_kg} kg
                </Text>
                <Text style={styles.unplacedReason}>{item.reason}</Text>
              </View>
            ))}
          </>
        ) : null}

        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* ---- REGENERATE / CONFIRM / CANCEL ---- */}
        <TouchableOpacity
          style={[styles.confirmButton, (busy || proposal.batches.length === 0) && styles.disabled]}
          onPress={handleConfirm}
          disabled={busy || proposal.batches.length === 0}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Confirm batch"
        >
          {isConfirming ? (
            <ActivityIndicator color={COLORS.Surface} />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={22} color={COLORS.Surface} />
              <Text style={styles.confirmButtonText}>CONFIRM BATCH</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.regenerateButton, busy && styles.disabled]}
          onPress={handleRegenerate}
          disabled={busy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Regenerate distribution"
        >
          {isRegenerating ? (
            <ActivityIndicator color={COLORS.Primary} />
          ) : (
            <>
              <Ionicons name="refresh" size={20} color={COLORS.Primary} />
              <Text style={styles.regenerateButtonText}>REGENERATE</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => navigation.goBack()}
          disabled={busy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.cancelButtonText}>CANCEL</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Calculated from {proposal.eligible_items} approved item line
          {proposal.eligible_items === 1 ? '' : 's'} in {proposal.stats.executionMs} ms.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/** One machine's proposed load. */
function BatchCard({ batch }: { batch: ProposedBatch }) {
  const group = BATCH_GROUP_META[batch.washing_group];
  return (
    <View style={[styles.batchCard, { borderTopColor: group.color }]}>
      <View style={styles.batchHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.batchMachine}>{batch.machine_name}</Text>
          <Text style={styles.batchCapacity}>{batch.capacity_kg} KG</Text>
        </View>
        <View style={[styles.groupPill, { backgroundColor: group.color }]}>
          <Text style={styles.groupPillText}>{group.label}</Text>
        </View>
      </View>

      {batch.items.map((item) => (
        <View key={item.order_item_id} style={styles.itemRow}>
          <Text style={styles.itemOrder}>{item.order_number}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.item_name}
            </Text>
            {/*
              A SPLIT LINE SAYS SO, and says how many. The Sorter has to count
              this many pieces out of the pile by hand, so "13 of 50" is the
              instruction — a bare item name would be the wrong one.
            */}
            {item.is_partial ? (
              <Text style={styles.itemSplit}>
                {item.quantity} of {item.ordered_quantity} pieces · rest in another load
              </Text>
            ) : (
              <Text style={styles.itemPieces}>{item.quantity} pieces</Text>
            )}
          </View>
          <Text style={styles.itemWeight}>{item.weight_kg} kg</Text>
        </View>
      ))}

      <View style={styles.batchFooter}>
        <Text style={styles.batchTotal}>
          TOTAL {batch.total_weight_kg} / {batch.capacity_kg} KG
        </Text>
        <Text
          style={[styles.batchUtilization, { color: utilizationColor(batch.utilization_percentage) }]}
        >
          {batch.utilization_percentage}%
        </Text>
      </View>

      {/* The fill bar, so the number has a shape next to it. */}
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
      <Text style={styles.remaining}>{batch.remaining_capacity_kg} kg spare</Text>
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

  noticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: '#EAF2FE',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  noticeText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextPrimary,
  },

  summaryCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  summaryLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },

  batchCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderTopWidth: 4,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  batchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  batchMachine: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },
  batchCapacity: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    letterSpacing: 1,
  },
  groupPill: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  groupPillText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.Border,
  },
  itemOrder: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
    color: COLORS.TextSecondary,
    maxWidth: 130,
  },
  itemName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
  },
  itemPieces: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  /* Coloured, because a split line is an instruction to count pieces out. */
  itemSplit: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
    color: COLORS.Warning,
  },
  itemWeight: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },

  batchFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
  },
  batchTotal: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.TextPrimary,
    letterSpacing: 0.5,
  },
  batchUtilization: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
  },
  barTrack: {
    height: 8,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.Border,
    marginTop: SPACING.xs,
    overflow: 'hidden',
  },
  barFill: { height: 8, borderRadius: BORDER_RADIUS.full },
  remaining: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: 4,
  },

  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    letterSpacing: 1,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  unplacedRow: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  unplacedName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  unplacedReason: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },

  emptyCard: {
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  emptyTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.TextPrimary,
  },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    textAlign: 'center',
  },

  errorBlock: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: '#FDECEC',
    marginBottom: SPACING.md,
  },
  errorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
    textAlign: 'center',
  },

  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 56,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.Primary,
    marginTop: SPACING.md,
    ...SHADOWS.light,
  },
  confirmButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 1,
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 52,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.Surface,
    borderWidth: 2,
    borderColor: COLORS.Primary,
    marginTop: SPACING.sm,
  },
  regenerateButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Primary,
    letterSpacing: 1,
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: SPACING.sm,
  },
  cancelButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.TextSecondary,
    letterSpacing: 1,
  },
  disabled: { opacity: 0.5 },

  footnote: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
});
