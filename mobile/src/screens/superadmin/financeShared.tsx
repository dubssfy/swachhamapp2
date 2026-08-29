import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { BusinessAccountSummary } from '../../services/superAdminApi';

/**
 * The pieces Purchase and Expense both need.
 *
 * ONE COPY, so the two modules cannot drift into looking like two different
 * products: the same business picker, the same stat tile, the same date-range
 * chips and the same money formatting appear in both.
 *
 * Everything here is presentation. No figure is calculated in this file —
 * `money` formats a number the server already computed, and the pickers
 * choose filters that the server then applies.
 */

/** Rupees, as every other Super Admin screen shows them. */
export const money = (value: unknown): string =>
  `INR ${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

/** YYYY-MM-DD as DD/MM/YYYY, matching the rest of the Super Admin. */
export const dmy = (iso: string | null | undefined): string => {
  const [y, m, d] = String(iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

/** Today, as YYYY-MM-DD, from the device's own calendar. */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function shift(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface DateRange {
  from?: string;
  to?: string;
  label: string;
}

/**
 * The ranges the reports offer.
 *
 * Computed from the device's calendar at the moment they are used, not
 * hardcoded, so "This Month" means this month whenever the screen is opened.
 */
export function dateRanges(): DateRange[] {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStart = `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}-01`;
  const lastMonthEnd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

  return [
    { label: 'All time' },
    { label: 'Today', from: today(), to: today() },
    { label: 'Yesterday', from: shift(-1), to: shift(-1) },
    { label: 'This week', from: shift(-6), to: today() },
    { label: 'This month', from: monthStart, to: today() },
    // The last day of the previous month is one day before this month starts.
    { label: 'Last month', from: lastMonthStart, to: shift(-now.getDate()) },
    { label: 'This year', from: `${now.getFullYear()}-01-01`, to: today() },
  ].filter((range) => range.label !== 'Last month' || lastMonthEnd);
}

/* ===================================================================
 * BUILDING BLOCKS
 * =================================================================== */

/** One figure on a dashboard. Displays a number; never computes one. */
export function StatTile({
  label, value, sub, tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warning' | 'good';
}) {
  const color =
    tone === 'warning' ? COLORS.Warning : tone === 'good' ? COLORS.Primary : COLORS.TextPrimary;
  return (
    <View
      style={{
        // Two per row on a phone, and they wrap to more on a wider screen —
        // a percentage rather than a fixed width, so nothing overflows.
        width: '48%',
        backgroundColor: COLORS.Surface,
        borderRadius: BORDER_RADIUS.md,
        borderWidth: 1,
        borderColor: COLORS.Border,
        padding: SPACING.md,
        marginBottom: SPACING.sm,
      }}
    >
      <Text style={[sa.cardMeta, { fontSize: 11 }]} numberOfLines={2}>{label}</Text>
      <Text
        style={{
          color,
          fontFamily: TYPOGRAPHY.fontFamily,
          fontWeight: '700',
          fontSize: 17,
          marginTop: 4,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {sub ? <Text style={[sa.cardMeta, { fontSize: 10, marginTop: 2 }]}>{sub}</Text> : null}
    </View>
  );
}

/** A row of filter chips. */
export function ChipRow<T extends string>({
  options, value, onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      /* Scrolls sideways rather than wrapping, so a long filter row never
         pushes the list itself off the screen on a phone. */
      contentContainerStyle={{ gap: SPACING.xs, paddingHorizontal: SPACING.md }}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[sa.filterChip, on && sa.filterChipOn]}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>{option.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/** A labelled field. */
export function Field({
  label, required, children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: SPACING.xs }}>
      <Text style={sa.label}>
        {label}
        {required ? <Text style={sa.required}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

/** A plain text input in the Super Admin's style. */
export function Input({
  value, onChangeText, placeholder, keyboardType, multiline, editable = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad' | 'email-address' | 'phone-pad';
  multiline?: boolean;
  editable?: boolean;
}) {
  return (
    <TextInput
      style={[
        sa.input,
        multiline ? { height: 84, textAlignVertical: 'top' } : null,
        !editable ? sa.selectDisabled : null,
      ]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={COLORS.TextSecondary}
      keyboardType={keyboardType || 'default'}
      multiline={multiline}
      editable={editable}
    />
  );
}

/** One line of a read-only detail view. */
export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: SPACING.md,
        paddingVertical: 6,
      }}
    >
      <Text style={[sa.cardMeta, { flex: 1 }]}>{label}</Text>
      <View style={{ flex: 1.4, alignItems: 'flex-end' }}>
        {typeof value === 'string' || typeof value === 'number' ? (
          <Text
            style={{
              color: COLORS.TextPrimary,
              fontFamily: TYPOGRAPHY.fontFamily,
              fontSize: 13,
              textAlign: 'right',
            }}
          >
            {value}
          </Text>
        ) : (
          value
        )}
      </View>
    </View>
  );
}

/** The payment-status pill, coloured the same way in both modules. */
export const PAYMENT_STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  UNPAID: { bg: '#FDECEC', fg: '#B42318', label: 'Unpaid' },
  PARTIAL: { bg: '#FFF4E5', fg: '#8A5200', label: 'Partial' },
  PAID: { bg: '#E8F3EC', fg: '#1B4332', label: 'Paid' },
  RECEIVED: { bg: '#E8F3EC', fg: '#1B4332', label: 'Received' },
  DRAFT: { bg: '#EEF2F7', fg: '#42526E', label: 'Draft' },
  RETURNED: { bg: '#FFF4E5', fg: '#8A5200', label: 'Returned' },
  CANCELLED: { bg: '#FDECEC', fg: '#B42318', label: 'Cancelled' },
};

export function TonePill({ status }: { status: string }) {
  const tone = PAYMENT_STATUS_TONE[status] ?? { bg: '#EEF2F7', fg: '#42526E', label: status };
  return (
    <View style={[sa.pill, { backgroundColor: tone.bg }]}>
      <Text style={[sa.pillText, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

/* ===================================================================
 * THE BUSINESS PICKER
 * =================================================================== */

/**
 * Choosing which business is in context.
 *
 * EVERY purchase and expense belongs to one business, and the API takes it in
 * the path — so nothing in either module can be shown until one is chosen.
 * This is the same picker pattern the Business Account screen uses, kept here
 * so both new modules pick a business the same way.
 */
export function useBusinesses() {
  const [businesses, setBusinesses] = useState<BusinessAccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setBusinesses(await superAdminApi.getBusinessAccounts());
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load businesses');
    } finally {
      setLoading(false);
    }
  }, []);

  return { businesses, loading, error, load };
}

export function BusinessPicker({
  businesses, selected, onSelect, visible, onClose,
}: {
  businesses: BusinessAccountSummary[];
  selected: BusinessAccountSummary | null;
  onSelect: (business: BusinessAccountSummary) => void;
  visible: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return businesses;
    return businesses.filter(
      (b) => b.name.toLowerCase().includes(needle) ||
        (b.legal_name || '').toLowerCase().includes(needle)
    );
  }, [businesses, search]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sa.modalBackdrop}>
        <View style={sa.modalSheet}>
          <View style={sa.header}>
            <Text style={[sa.headerTitle, { flex: 1 }]}>Select Business</Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: SPACING.md }}>
            <TextInput
              style={sa.input}
              placeholder="Search businesses"
              placeholderTextColor={COLORS.TextSecondary}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <ScrollView contentContainerStyle={sa.scroll}>
            {shown.length === 0 ? (
              <Text style={sa.empty}>No business matches that search.</Text>
            ) : (
              shown.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={[sa.card, selected?.id === b.id && { borderColor: COLORS.Primary }]}
                  onPress={() => { onSelect(b); onClose(); }}
                >
                  <Text style={sa.cardTitle}>{b.name}</Text>
                  {b.legal_name && b.legal_name !== b.name ? (
                    <Text style={sa.cardMeta}>{b.legal_name}</Text>
                  ) : null}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** The "SELECT BUSINESS" bar every finance screen starts with. */
export function BusinessBar({
  selected, onPress,
}: {
  selected: BusinessAccountSummary | null;
  onPress: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm }}>
      <Text style={sa.label}>BUSINESS</Text>
      <TouchableOpacity
        style={[sa.input, { flexDirection: 'row', alignItems: 'center' }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Choose a business"
      >
        <Text
          style={[sa.flex, { color: selected ? COLORS.TextPrimary : COLORS.TextSecondary }]}
          numberOfLines={1}
        >
          {selected ? selected.name : 'Choose a business'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.TextSecondary} />
      </TouchableOpacity>
    </View>
  );
}

/** The spinner every finance screen shows while its first load runs. */
export function Loading() {
  return (
    <View style={sa.centered}>
      <ActivityIndicator size="large" color={COLORS.Primary} />
    </View>
  );
}

/** The error box, in the Super Admin's own style. */
export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View style={[sa.errorBox, { marginHorizontal: SPACING.md }]}>
      <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
      <Text style={sa.errorText}>{message}</Text>
    </View>
  );
}
