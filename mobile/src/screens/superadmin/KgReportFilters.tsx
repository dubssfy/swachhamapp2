import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { ReportableBusiness } from '../../services/superAdminApi';

/**
 * SELECT ESTABLISHMENT and TYPE OF BUSINESS, shared by every KG report.
 *
 * One component so the four reports offer the same choices in the same
 * order — and so a change to the wording cannot land on three of them.
 *
 * IT SELECTS; IT DOES NOT FILTER. The values are handed back to the screen,
 * which passes them to the server. The narrowing is a WHERE clause on the
 * existing query, so the rows, columns, weights and totals a report shows are
 * the ones it always showed for whatever is in scope.
 */

export const ALL = 'all';

/** The three types of business, in the order every screen lists them. */
const TYPES: Array<{ value: string; label: string }> = [
  { value: ALL, label: 'All' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'guest', label: 'Guest' },
];

export default function KgReportFilters({
  businessId, laundryType, onChange, disabled,
}: {
  businessId: string;
  laundryType: string;
  onChange: (next: { businessId: string; laundryType: string }) => void;
  disabled?: boolean;
}) {
  const [businesses, setBusinesses] = useState<ReportableBusiness[]>([]);
  const [open, setOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    superAdminApi.getReportableBusinesses()
      .then((rows) => { if (alive) setBusinesses(rows); })
      // The report still works on every establishment if the list cannot be
      // loaded; only the picker is poorer, so this is not surfaced as an error.
      .catch(() => undefined);
    return () => { alive = false; };
  }, []));

  const selected = businessId === ALL
    ? 'All Establishments'
    : businesses.find((b) => String(b.id) === businessId)?.name || 'Selected establishment';

  return (
    <View style={{ paddingHorizontal: SPACING.md }}>
      <Text style={sa.label}>SELECT ESTABLISHMENT</Text>
      <TouchableOpacity
        style={[sa.input, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
        onPress={() => setOpen((was) => !was)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Select establishment, currently ${selected}`}
      >
        <Ionicons name="business-outline" size={18} color={COLORS.Primary} />
        <Text
          numberOfLines={1}
          style={[sa.flex, { color: COLORS.TextPrimary, fontFamily: TYPOGRAPHY.fontFamily }]}
        >
          {selected}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.TextSecondary} />
      </TouchableOpacity>

      {open && (
        <View style={{ marginTop: SPACING.xs }}>
          {/* All Establishments first, then every establishment the reports
              already know about — the same list the other reports offer. */}
          <Choice
            label="All Establishments"
            on={businessId === ALL}
            onPress={() => { onChange({ businessId: ALL, laundryType }); setOpen(false); }}
          />
          {businesses.map((business) => (
            <Choice
              key={business.id}
              label={business.name}
              on={businessId === String(business.id)}
              onPress={() => {
                onChange({ businessId: String(business.id), laundryType });
                setOpen(false);
              }}
            />
          ))}
        </View>
      )}

      <Text style={sa.label}>TYPE OF BUSINESS</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
        {TYPES.map((type) => {
          const on = laundryType === type.value;
          return (
            <TouchableOpacity
              key={type.value}
              style={[sa.tab, on && sa.tabActive, { flex: 1 }]}
              onPress={() => onChange({ businessId, laundryType: type.value })}
              disabled={disabled}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Type of business: ${type.label}`}
            >
              <Text style={[sa.tabText, on && sa.tabTextActive]}>{type.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** One establishment in the open list. */
function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[sa.choice, on && sa.choiceActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Ionicons
        name={on ? 'radio-button-on' : 'radio-button-off'}
        size={18}
        color={on ? COLORS.Primary : COLORS.TextSecondary}
      />
      <Text style={sa.choiceText} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}
