import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { sa } from '../superadmin/styles';
import managerApi, {
  OrderRequestSource, PendingOrderRequest,
} from '../../services/managerApi';

/**
 * ORDER REQUESTS — the Manager's two tabs.
 *
 * EXACTLY TWO, because there are exactly two sources a booking can come from:
 * a customer (`orders.user_id`) or an establishment (`orders.business_user_id`).
 * The server derives the tab from whichever column is set, so nothing is
 * stored for the split and an order cannot appear in both.
 *
 * A "REQUEST" HERE IS THE ORDER ITSELF, read at status PENDING_APPROVAL. There
 * is no request record beside it, so the order number shown here is the one
 * the Sorter and the Rider will work with after it is accepted — one row, one
 * id, all the way through.
 *
 * ACCEPTING CHANGES THE ORDER'S STATUS AND NOTHING ELSE. No item, price,
 * schedule or address is touched, and the new status is what makes the order
 * visible downstream — the Sorter queue is already gated on it.
 */

const TABS: Array<{ key: OrderRequestSource; label: string }> = [
  { key: 'CUSTOMER', label: 'Customer Requests' },
  { key: 'BUSINESS', label: 'Business Requests' },
];

/** `2026-09-01` + `09:00:00`/`11:00:00` -> `1 Sep, 09:00–11:00`. */
function slot(date?: string | null, start?: string | null, end?: string | null): string {
  const day = date ? new Date(date) : null;
  const dayText = day && !Number.isNaN(day.getTime())
    ? day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : '';
  const window = start && end ? `${String(start).slice(0, 5)}–${String(end).slice(0, 5)}` : '';
  return [dayText, window].filter(Boolean).join(', ');
}

function when(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

export default function ManagerOrderRequestsScreen({ navigation, route }: any) {
  const [tab, setTab] = useState<OrderRequestSource>(
    route?.params?.source === 'BUSINESS' ? 'BUSINESS' : 'CUSTOMER'
  );
  const [rows, setRows] = useState<PendingOrderRequest[]>([]);
  const [counts, setCounts] = useState({ CUSTOMER: 0, BUSINESS: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      /*
       * Both the list and the counts, so the OTHER tab's badge is right too —
       * a Manager working through Customer Requests should see business ones
       * arriving without switching to look.
       */
      const [list, tally] = await Promise.all([
        managerApi.getOrderRequests(tab),
        managerApi.getOrderRequestCounts(),
      ]);
      setRows(list);
      setCounts(tally);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load the requests');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  // Re-read on focus, so a booking placed while this screen was in the
  // background appears on return without anything having to push it.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const accept = useCallback(async (row: PendingOrderRequest) => {
    if (accepting) return;
    setAccepting(row.id);
    setError('');
    try {
      await managerApi.acceptOrderRequest(row.id);
      /*
       * RE-READ, don't patch. The server sets the status and the row leaves
       * this queue as a consequence; removing it from local state instead
       * would be this screen asserting an outcome it did not witness.
       */
      await load();
    } catch (e: any) {
      // A 409 is the rule speaking — the order moved on between this list
      // loading and the tap. Its wording is the right message, and re-reading
      // shows the Manager the queue as it now is.
      setError(e?.response?.data?.message || e.message || 'That request could not be accepted.');
      await load();
    } finally {
      setAccepting(null);
    }
  }, [accepting, load]);

  const confirmAccept = (row: PendingOrderRequest) => {
    Alert.alert(
      'Accept this order?',
      `${row.order_number}\n${row.customer_name}\n\n`
        + 'It will be marked Order Placed and passed to the sorter and rider teams.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept', onPress: () => accept(row) },
      ]
    );
  };

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity
          style={sa.iconBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={sa.headerTitle}>Order Requests</Text>
      </View>

      {/* EXACTLY TWO TABS. Each carries its own waiting count. */}
      <View style={sa.tabs}>
        {TABS.map((option) => {
          const on = tab === option.key;
          const count = counts[option.key];
          return (
            <TouchableOpacity
              key={option.key}
              style={[sa.tab, on && sa.tabActive]}
              onPress={() => { setLoading(true); setTab(option.key); }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${option.label}, ${count} waiting`}
            >
              <Text style={[sa.tabText, on && sa.tabTextActive]}>
                {option.label}{count > 0 ? ` (${count})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={sa.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={sa.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
            />
          }
        >
          {!!error && (
            <View style={sa.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
              <Text style={sa.errorText}>{error}</Text>
            </View>
          )}

          {rows.length === 0 ? (
            <Text style={sa.empty}>
              No {tab === 'CUSTOMER' ? 'customer' : 'business'} orders are waiting.
            </Text>
          ) : (
            rows.map((row) => (
              <View key={row.id} style={sa.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                  <Text style={[sa.cardTitle, sa.flex]} numberOfLines={1}>
                    {row.customer_name}
                  </Text>
                  <Text style={sa.cardTitle}>₹{Number(row.total).toFixed(2)}</Text>
                </View>

                {/* The order number the Sorter and Rider will see. Same row. */}
                <Text style={sa.cardMeta} numberOfLines={1}>
                  {row.order_number}
                  {row.laundry_type ? ` · ${row.laundry_type}` : ''}
                  {row.item_count ? ` · ${row.item_count} item(s)` : ''}
                  {/* Only when the order actually has one. A "0 kg" would be
                      a claim about the laundry; nothing at all is the truth
                      when no item in it carries a weight. */}
                  {row.total_weight_kg ? ` · ${Number(row.total_weight_kg).toFixed(2)} kg` : ''}
                </Text>

                {!!slot(row.pickup_date, row.pickup_slot_start, row.pickup_slot_end) && (
                  <Text style={sa.cardLine}>
                    Pickup: {slot(row.pickup_date, row.pickup_slot_start, row.pickup_slot_end)}
                  </Text>
                )}
                {!!row.customer_contact && (
                  <Text style={sa.cardLine}>Contact: {row.customer_contact}</Text>
                )}
                {!!row.special_notes && (
                  <Text style={sa.cardLine} numberOfLines={3}>Notes: {row.special_notes}</Text>
                )}
                <Text style={sa.tdMuted}>Booked {when(row.created_at)}</Text>

                <TouchableOpacity
                  style={[
                    sa.button,
                    { marginTop: SPACING.sm },
                    accepting === row.id && sa.buttonDisabled,
                  ]}
                  onPress={() => confirmAccept(row)}
                  disabled={accepting !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Accept order ${row.order_number}`}
                  accessibilityState={{ disabled: accepting !== null }}
                >
                  {accepting === row.id ? (
                    <ActivityIndicator color={COLORS.Surface} />
                  ) : (
                    <Text style={sa.buttonText}>Accept</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))
          )}

          <Text
            style={{
              fontFamily: TYPOGRAPHY.fontFamily,
              fontSize: TYPOGRAPHY.sizes.xs,
              color: COLORS.TextSecondary,
              marginTop: SPACING.md,
              lineHeight: 18,
            }}
          >
            Accepting marks the order Order Placed. It is the same order
            throughout — the sorter and rider teams see the number shown above.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
