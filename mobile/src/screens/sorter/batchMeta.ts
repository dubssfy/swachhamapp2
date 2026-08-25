import { COLORS } from '../../constants/theme';
import { BatchStatus, MachineStatus, WashingGroup } from '../../services/sorterBatchApi';

/**
 * How the batch vocabulary is labelled and coloured across the batch screens.
 *
 * Its own module, the same way `sorterStageMeta` is, so the processing screen,
 * the distribution screen, the batch detail and the batch scanner all read one
 * source and cannot drift apart.
 *
 * Nothing here is imported by the existing Sorter screens, and
 * `sorterStageMeta` is untouched.
 */

export const BATCH_STATUS_META: Record<BatchStatus, { label: string; color: string }> = {
  // What START BATCH returns. Never a stored row — it is the calculation the
  // Sorter is reviewing, which is why it is coloured as information.
  PROPOSED: { label: 'PROPOSED', color: COLORS.Info },
  CONFIRMED: { label: 'CONFIRMED', color: COLORS.Primary },
  IN_MACHINE: { label: 'IN MACHINE', color: COLORS.Warning },
  WASHING: { label: 'WASHING', color: COLORS.Warning },
  COMPLETED: { label: 'COMPLETED', color: COLORS.Success },
  CANCELLED: { label: 'CANCELLED', color: COLORS.Error },
};

export const MACHINE_STATUS_META: Record<MachineStatus, { label: string; color: string }> = {
  AVAILABLE: { label: 'AVAILABLE', color: COLORS.Success },
  IN_USE: { label: 'IN USE', color: COLORS.Warning },
  MAINTENANCE: { label: 'MAINTENANCE', color: COLORS.Error },
  OFFLINE: { label: 'OFFLINE', color: COLORS.TextSecondary },
  COMPLETED: { label: 'COMPLETED', color: COLORS.Primary },
};

/**
 * The two washing groups.
 *
 * Towels are given their own colour deliberately: on a distribution screen
 * the one rule that must never be got wrong is that a towel load contains
 * nothing else, and a glance should be enough to see it.
 */
export const BATCH_GROUP_META: Record<WashingGroup, { label: string; color: string }> = {
  TOWEL: { label: 'TOWEL', color: COLORS.Info },
  GENERAL: { label: 'GENERAL', color: COLORS.Primary },
};

/** A utilisation percentage, coloured by how well the drum is filled. */
export function utilizationColor(percentage: number): string {
  if (percentage >= 90) return COLORS.Success;
  if (percentage >= 60) return COLORS.Primary;
  return COLORS.Warning;
}
