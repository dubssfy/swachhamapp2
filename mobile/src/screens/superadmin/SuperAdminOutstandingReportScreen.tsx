import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, RefreshControl, Share, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, {
  OutstandingReport, OutstandingRow, OutstandingSort,
} from '../../services/superAdminApi';
import { money, StatTile, Loading, ErrorBox } from './financeShared';

/**
 * OUTSTANDING — what each establishment still owes.
 *
 * THE FIGURE IS THE LEDGER'S, NOT THIS SCREEN'S. Every amount here is what
 * the Record Payment form would show for that establishment, computed by the
 * same code — so an operator chasing a debt from this report and then opening
 * the payment screen sees the same number.
 *
 * ROWS ARE CARDS, NOT A TABLE. An establishment carries a name, a phone
 * number, an email and a full postal address; five columns of that on a phone
 * is either unreadable or scrolled sideways past the point of use. The card
 * keeps every field visible and makes the phone and email tappable, which a
 * table cell cannot be.
 *
 * SETTLED ESTABLISHMENTS ARE HIDDEN BY DEFAULT. The report answers "who owes
 * us money"; padding it with everyone who does not would bury the answer.
 * "Show settled" is there for when the full list is wanted.
 */

const PAGE = 25;

const SORTS: Array<{ value: OutstandingSort; label: string }> = [
  { value: 'outstanding_desc', label: 'Highest first' },
  { value: 'outstanding_asc', label: 'Lowest first' },
  { value: 'name_asc', label: 'Name (A-Z)' },
  { value: 'name_desc', label: 'Name (Z-A)' },
];

/** The amount filters offered, as rupee floors. */
const FLOORS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any amount' },
  { value: '1000', label: '₹1,000+' },
  { value: '10000', label: '₹10,000+' },
  { value: '50000', label: '₹50,000+' },
];

export default function SuperAdminOutstandingReportScreen({ navigation }: any) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<OutstandingSort>('outstanding_desc');
  const [floor, setFloor] = useState<string>('');
  const [includeSettled, setIncludeSettled] = useState(false);
  const [page, setPage] = useState(0);

  const [report, setReport] = useState<OutstandingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setReport(await superAdminApi.getOutstandingReport({
        search: search.trim() || undefined,
        min_outstanding: floor || undefined,
        include_settled: includeSettled || undefined,
        sort,
        limit: PAGE,
        offset: page * PAGE,
      }));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load the outstanding report');
      setReport(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, sort, floor, includeSettled, page]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  /** Changing a filter returns to the first page. */
  const changeFilter = (apply: () => void) => { apply(); setPage(0); };

  const share = async () => {
    if (!report) return;
    try {
      await Share.share({
        message: [
          'Outstanding Report',
          `Total Establishments: ${report.totals.establishments}`,
          `Total Outstanding: ${money(report.totals.total_outstanding)}`,
          '',
          'Establishment\tContact\tEmail\tAddress\tOutstanding',
          ...report.rows.map((r) => [
            r.establishment_name,
            r.primary_contact_number ?? '',
            r.email ?? '',
            r.establishment_address ?? '',
            r.outstanding,
          ].join('\t')),
        ].join('\n'),
      });
    } catch { /* the sheet was dismissed */ }
  };

  const pageCount = report
    ? Math.max(1, Math.ceil(report.totals.establishments / PAGE))
    : 1;

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>Outstanding</Text>
        {report && report.rows.length > 0 && (
          <TouchableOpacity style={sa.iconBtn} onPress={share} accessibilityLabel="Share report">
            <Ionicons name="share-outline" size={20} color={COLORS.TextPrimary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={sa.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {/* ---- SUMMARY ---- */}
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}
        >
          <StatTile
            label="Total Establishments"
            value={String(report?.totals.establishments ?? 0)}
            sub={report ? `of ${report.totals.considered} on file` : undefined}
          />
          <StatTile
            label="Total Outstanding"
            value={money(report?.totals.total_outstanding)}
            tone={Number(report?.totals.total_outstanding) > 0 ? 'warning' : 'default'}
          />
        </View>

        {/* ---- FILTERS ---- */}
        <TextInput
          style={sa.input}
          placeholder="Search establishment or contact number"
          placeholderTextColor={COLORS.TextSecondary}
          value={search}
          onChangeText={(text) => changeFilter(() => setSearch(text))}
          returnKeyType="search"
        />

        <Text style={sa.label}>OUTSTANDING AT LEAST</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: SPACING.xs, paddingRight: SPACING.md }}
        >
          {FLOORS.map((option) => {
            const on = floor === option.value;
            return (
              <TouchableOpacity
                key={option.label}
                style={[sa.filterChip, on && sa.filterChipOn]}
                onPress={() => changeFilter(() => setFloor(option.value))}
              >
                <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={[sa.label, { marginTop: SPACING.sm }]}>SORT BY</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: SPACING.xs, paddingRight: SPACING.md }}
        >
          {SORTS.map((option) => {
            const on = sort === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[sa.filterChip, on && sa.filterChipOn]}
                onPress={() => changeFilter(() => setSort(option.value))}
              >
                <Text style={[sa.filterChipText, on && sa.filterChipTextOn]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[sa.filterChip, includeSettled && sa.filterChipOn]}
            onPress={() => changeFilter(() => setIncludeSettled((v) => !v))}
          >
            <Text style={[sa.filterChipText, includeSettled && sa.filterChipTextOn]}>
              Show settled
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <ErrorBox message={error} />

        {loading ? (
          <View style={{ paddingVertical: SPACING.xl }}>
            <Loading />
          </View>
        ) : !report ? null : report.rows.length === 0 ? (
          <View style={[sa.card, { marginTop: SPACING.sm }]}>
            <Text style={sa.cardTitle}>No outstanding payments found.</Text>
            <Text style={sa.cardMeta}>
              {search.trim() || floor
                ? 'No establishment matches these filters.'
                : 'Every establishment is settled up.'}
            </Text>
          </View>
        ) : (
          <>
            <Text style={[sa.cardMeta, { marginTop: SPACING.sm, marginBottom: SPACING.xs }]}>
              {report.totals.establishments} establishment
              {report.totals.establishments === 1 ? '' : 's'}
              {' · '}{money(report.totals.total_outstanding)} outstanding
            </Text>

            {report.rows.map((row) => (
              <EstablishmentRow key={row.business_id} row={row} />
            ))}

            {pageCount > 1 && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: SPACING.md,
                  marginTop: SPACING.md,
                }}
              >
                <TouchableOpacity
                  style={[sa.actionBtn, page === 0 && { opacity: 0.4 }]}
                  disabled={page === 0}
                  onPress={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <Ionicons name="chevron-back" size={15} color={COLORS.TextSecondary} />
                  <Text style={sa.actionBtnText}>Previous</Text>
                </TouchableOpacity>
                <Text style={sa.cardMeta}>Page {page + 1} of {pageCount}</Text>
                <TouchableOpacity
                  style={[sa.actionBtn, page + 1 >= pageCount && { opacity: 0.4 }]}
                  disabled={page + 1 >= pageCount}
                  onPress={() => setPage((p) => p + 1)}
                >
                  <Text style={sa.actionBtnText}>Next</Text>
                  <Ionicons name="chevron-forward" size={15} color={COLORS.TextSecondary} />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One establishment.
 *
 * The phone and email are TAPPABLE — this report exists to chase money, and
 * the next action after reading a row is almost always to call or write. A
 * table cell could only have displayed them.
 */
function EstablishmentRow({ row }: { row: OutstandingRow }) {
  const call = () => {
    if (row.primary_contact_number) {
      Linking.openURL(`tel:${row.primary_contact_number.replace(/\s/g, '')}`).catch(() => {});
    }
  };
  const mail = () => {
    if (row.email) Linking.openURL(`mailto:${row.email}`).catch(() => {});
  };

  return (
    <View style={sa.card}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm }}>
        <View style={sa.flex}>
          <Text style={sa.cardTitle}>{row.establishment_name}</Text>
          {row.legal_name && row.legal_name !== row.establishment_name ? (
            <Text style={sa.cardMeta}>{row.legal_name}</Text>
          ) : null}
        </View>
        <Text
          style={{
            color: COLORS.Warning,
            fontFamily: TYPOGRAPHY.fontFamily,
            fontWeight: '700',
            fontSize: 16,
          }}
        >
          {money(row.outstanding)}
        </Text>
      </View>

      <View
        style={{
          marginTop: SPACING.xs,
          paddingTop: SPACING.xs,
          borderTopWidth: 1,
          borderTopColor: COLORS.Border,
          gap: 4,
        }}
      >
        <ContactLine
          icon="call-outline"
          value={row.primary_contact_number}
          hint={row.primary_contact_name}
          onPress={row.primary_contact_number ? call : undefined}
        />
        <ContactLine icon="mail-outline" value={row.email} onPress={row.email ? mail : undefined} />
        <ContactLine icon="location-outline" value={row.establishment_address} />
      </View>
    </View>
  );
}

function ContactLine({
  icon, value, hint, onPress,
}: {
  icon: any;
  value: string | null;
  hint?: string | null;
  onPress?: () => void;
}) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.xs }}>
      <Ionicons
        name={icon}
        size={14}
        color={value ? COLORS.TextSecondary : COLORS.Border}
        style={{ marginTop: 2 }}
      />
      <Text
        style={[
          sa.cardMeta,
          sa.flex,
          // A tappable value is coloured; a missing one is a plain dash, so
          // "not on file" never looks like something that can be acted on.
          onPress ? { color: COLORS.Primary } : null,
        ]}
      >
        {value || '—'}
        {hint ? <Text style={sa.tdMuted}>{`  (${hint})`}</Text> : null}
      </Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="link" accessibilityLabel={value ?? ''}>
      {body}
    </TouchableOpacity>
  );
}
