import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { formatMonthLabel, parseDateKey, toDateKey } from '../../utils/sorterDates';

/**
 * A month-grid date picker for the Sorter module.
 *
 * Written against React Native's own primitives rather than pulling in a
 * calendar package: the app has no date-picker dependency today, and the shop
 * floor only needs to pick one past day. Every cell is a large tap target, and
 * days after `maxDate` are visible but not selectable, so Previous Requests
 * cannot wander into the future.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  visible: boolean;
  /** Currently selected day, YYYY-MM-DD, or null when nothing is picked yet. */
  value: string | null;
  /** Newest selectable day, YYYY-MM-DD. Later days are shown but disabled. */
  maxDate?: string;
  title?: string;
  onSelect: (dateKey: string) => void;
  onClose: () => void;
}

/** The cells of one month: leading blanks, then day numbers. */
function monthCells(year: number, month: number): Array<number | null> {
  const firstWeekday = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = Array(firstWeekday).fill(null);
  for (let day = 1; day <= dayCount; day += 1) cells.push(day);
  return cells;
}

export default function SorterCalendar({
  visible,
  value,
  maxDate,
  title = 'Select Date',
  onSelect,
  onClose,
}: Props) {
  // The month on screen starts at the selected day, else at the newest day the
  // sorter is allowed to pick, else at this device's current month.
  const initial = useMemo(
    () => parseDateKey(value || maxDate || toDateKey(new Date())),
    [value, maxDate]
  );
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());

  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const currentDayKey = toDateKey(new Date());

  const goToMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  // The forward arrow stops at the month holding maxDate — there is nothing
  // selectable beyond it.
  const canGoForward = (() => {
    if (!maxDate) return true;
    const limit = parseDateKey(maxDate);
    return year < limit.getFullYear() || (year === limit.getFullYear() && month < limit.getMonth());
  })();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close calendar"
            >
              <Ionicons name="close" size={24} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.monthRow}>
            <TouchableOpacity
              style={styles.monthArrow}
              onPress={() => goToMonth(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
            >
              <Ionicons name="chevron-back" size={24} color={COLORS.Primary} />
            </TouchableOpacity>

            <Text style={styles.monthLabel}>{formatMonthLabel(year, month)}</Text>

            <TouchableOpacity
              style={[styles.monthArrow, !canGoForward && styles.disabled]}
              onPress={() => canGoForward && goToMonth(1)}
              disabled={!canGoForward}
              accessibilityRole="button"
              accessibilityLabel="Next month"
            >
              <Ionicons name="chevron-forward" size={24} color={COLORS.Primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((label, index) => (
              <Text key={`${label}-${index}`} style={styles.weekday}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((day, index) => {
              if (day === null) {
                return <View key={`blank-${index}`} style={styles.cell} />;
              }
              const key = toDateKey(new Date(year, month, day));
              const selected = key === value;
              const isToday = key === currentDayKey;
              const disabled = Boolean(maxDate) && key > (maxDate as string);

              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.cell,
                    styles.dayCell,
                    isToday && !selected && styles.dayToday,
                    selected && styles.daySelected,
                  ]}
                  onPress={() => onSelect(key)}
                  disabled={disabled}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled }}
                  accessibilityLabel={key}
                >
                  <Text
                    style={[
                      styles.dayText,
                      disabled && styles.dayTextDisabled,
                      selected && styles.dayTextSelected,
                    ]}
                  >
                    {day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.Surface,
    borderTopLeftRadius: BORDER_RADIUS.lg,
    borderTopRightRadius: BORDER_RADIUS.lg,
    paddingBottom: SPACING.lg,
    ...SHADOWS.medium,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.Border,
  },
  sheetTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  monthArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.Background,
  },
  monthLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },
  disabled: { opacity: 0.35 },

  weekRow: { flexDirection: 'row', paddingHorizontal: SPACING.sm },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
    color: COLORS.TextSecondary,
    paddingVertical: SPACING.xs,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SPACING.sm },
  cell: { width: `${100 / 7}%`, height: 48, alignItems: 'center', justifyContent: 'center' },
  dayCell: { borderRadius: BORDER_RADIUS.md },
  dayToday: { borderWidth: 1.5, borderColor: COLORS.PrimaryLight },
  daySelected: { backgroundColor: COLORS.Primary },
  dayText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
  },
  dayTextDisabled: { color: COLORS.Border },
  dayTextSelected: { color: COLORS.Surface, fontWeight: '800' },
});
