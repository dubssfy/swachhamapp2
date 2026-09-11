import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import businessDoorApi, {
  DoorTicket,
  DoorItemTicket,
  DoorTicketStatus,
  BusinessMessage,
} from '../../services/businessDoorApi';
import { extractErrorMessage } from '../../services/api';

/**
 * PICKUP APPROVALS — the business's answer to a rider at the door.
 *
 * ============================================================
 * WHY THIS SCREEN IS NOT AN INBOX
 * ============================================================
 *
 * A rider at the door is BLOCKED on everything in "Waiting on you":
 *
 *   - an uncounted pickup: the rider took the load without counting it and
 *     waits for Accept (continue) or Reject (go back and count);
 *   - a quantity mismatch: the rider counted an item and found a different
 *     number. Accept puts the checked quantity on the order; Reject leaves
 *     the order alone and the rider must recheck.
 *
 * Nothing moves until one of these buttons is tapped. So the tickets are
 * first, they are loud, and the record of what has already happened — the
 * answered tickets and the messages — sits underneath them.
 *
 * ============================================================
 * WHY IT POLLS
 * ============================================================
 *
 * The app has no socket client (`socket.io-client` is not a dependency), so a
 * server-side emit reaches nothing. A ticket raised while this screen is open
 * would otherwise never appear. Refreshing on focus covers the ordinary case;
 * the 10-second poll covers the one that matters, which is a rider raising a
 * ticket while somebody is already looking at this screen.
 */

const STATUS_TONE: Record<DoorTicketStatus, { bg: string; fg: string; label: string }> = {
  PENDING: { bg: '#FFF4E5', fg: '#8A5200', label: 'Pending' },
  ACCEPTED: { bg: '#E8F3EC', fg: '#1B4332', label: 'Accepted' },
  REJECTED: { bg: '#FDECEC', fg: '#B42318', label: 'Rejected' },
};

function when(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export default function BusinessDoorTicketsScreen() {
  const navigation = useNavigation<any>();

  const [tickets, setTickets] = useState<DoorTicket[]>([]);
  const [itemTickets, setItemTickets] = useState<DoorItemTicket[]>([]);
  const [recentTickets, setRecentTickets] = useState<DoorTicket[]>([]);
  const [recentItems, setRecentItems] = useState<DoorItemTicket[]>([]);
  const [messages, setMessages] = useState<BusinessMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The ticket currently being answered, as `door:<id>` or `item:<id>`, so
   * only its own buttons spin and a second tap cannot send a second answer.
   */
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (refreshing = false) => {
    if (refreshing) setIsRefreshing(true);
    try {
      const [ticketResponse, itemResponse, recentResponse, recentItemResponse, messageResponse] =
        await Promise.all([
          businessDoorApi.getPendingTickets(),
          businessDoorApi.getItemTickets('pending'),
          businessDoorApi.getRecentTickets(),
          businessDoorApi.getItemTickets('recent'),
          businessDoorApi.getMessages(),
        ]);
      setTickets(ticketResponse.data || []);
      setItemTickets(itemResponse.data || []);
      setRecentTickets(recentResponse.data || []);
      setRecentItems(recentItemResponse.data || []);
      setMessages(messageResponse.data || []);
      setError(null);
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Could not load pickup approvals.'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();

      // See the header note: a rider can raise a ticket while this screen is
      // already open, and nothing would push it here.
      const timer = setInterval(() => void load(), 10000);
      return () => clearInterval(timer);
    }, [load])
  );

  /**
   * Sends one answer, then reconciles with the server.
   *
   * A refusal from the server (typically "already answered" from another
   * device) is shown as it is, and the reload then shows the ticket's real
   * state — so the screen never keeps offering a decision already made.
   */
  const answer = async (key: string, send: () => Promise<unknown>, failTitle: string) => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      await send();
    } catch (err: any) {
      Alert.alert(failTitle, extractErrorMessage(err, 'That did not go through. Try again.'));
    } finally {
      setBusyKey(null);
      await load();
    }
  };

  /**
   * An uncounted pickup.
   *
   * Confirmed first because neither answer is an acknowledgement. Accepting
   * releases a rider to leave with a load nobody counted, and sends them a
   * notice saying so; rejecting sends them back to count it.
   */
  const handleDoorTicket = (ticket: DoorTicket, decision: 'accept' | 'reject') => {
    const order = ticket.order_number || ticket.order_id;
    const accept = decision === 'accept';
    Alert.alert(
      accept ? 'Accept this pickup?' : 'Reject this pickup?',
      accept
        ? `The rider did not count order ${order} at the door. ` +
            'Accepting releases them to continue, and they will be told that any mismatch is ' +
            'communicated and physical verification is done at Swachham.'
        : `Order ${order} will not be collected uncounted. The rider will be asked to count ` +
            'every item with your staff before continuing.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: accept ? 'Accept' : 'Reject',
          style: accept ? 'default' : 'destructive',
          onPress: () =>
            answer(
              `door:${ticket.ticket_id}`,
              () =>
                accept
                  ? businessDoorApi.acceptTicket(ticket.ticket_id)
                  : businessDoorApi.rejectTicket(ticket.ticket_id),
              accept ? 'Could not accept' : 'Could not reject'
            ),
        },
      ]
    );
  };

  /** A quantity mismatch. Only this order's line can change. */
  const handleItemTicket = (ticket: DoorItemTicket, decision: 'accept' | 'reject') => {
    const order = ticket.order_number || ticket.order_id;
    const accept = decision === 'accept';
    Alert.alert(
      accept
        ? `Accept ${ticket.checked_quantity} for ${ticket.item_name}?`
        : `Reject the count for ${ticket.item_name}?`,
      accept
        ? `Order ${order} was placed for ${ticket.ordered_quantity}. Accepting changes this ` +
            `item's quantity on the order to ${ticket.checked_quantity}.`
        : `The quantity on order ${order} stays at ${ticket.ordered_quantity}. The rider must ` +
            `recheck ${ticket.item_name} before the order can continue.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: accept ? 'Accept' : 'Reject',
          style: accept ? 'default' : 'destructive',
          onPress: () =>
            answer(
              `item:${ticket.check_id}`,
              () =>
                accept
                  ? businessDoorApi.acceptItemTicket(ticket.check_id)
                  : businessDoorApi.rejectItemTicket(ticket.check_id),
              accept ? 'Could not accept' : 'Could not reject'
            ),
        },
      ]
    );
  };

  const waitingCount = tickets.length + itemTickets.length;

  /** Answered tickets of both kinds, newest answer first. */
  const recent = [
    ...recentTickets.map((t) => ({
      key: `door:${t.ticket_id}`,
      status: t.status,
      at: t.accepted_at || t.rejected_at || t.created_at,
      title: `Order ${t.order_number || t.order_id}`,
      body: 'Collected without counting',
      meta: t.rider_name ? `Rider: ${t.rider_name}` : null,
    })),
    ...recentItems.map((t) => ({
      key: `item:${t.check_id}`,
      status: (t.ticket_status || 'PENDING') as DoorTicketStatus,
      at: t.resolved_at || t.created_at,
      title: `Order ${t.order_number || t.order_id} · ${t.item_name}`,
      body:
        `Ordered ${t.ordered_quantity}, checked ${t.checked_quantity} ` +
        `(${signed(t.difference)})${t.remark_label ? ` · ${t.remark_label}` : ''}` +
        (t.remark_note ? ` — ${t.remark_note}` : ''),
      meta: t.superseded ? 'Rechecked by the rider' : t.rider_name ? `Rider: ${t.rider_name}` : null,
    })),
  ].sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BusinessHeader title="Pickup Approvals" onBack={() => navigation.goBack()} />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => load(true)}
              tintColor={COLORS.Primary}
            />
          }
        >
          {error ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={18} color={COLORS.Error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* ---------- WAITING ON YOU ---------- */}
          <Text style={styles.sectionTitle}>Waiting on you</Text>

          {waitingCount === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-circle-outline" size={40} color={COLORS.TextSecondary} />
              <Text style={styles.emptyText}>Nothing is waiting for your approval.</Text>
            </View>
          ) : null}

          {tickets.map((ticket) => {
            const busy = busyKey === `door:${ticket.ticket_id}`;
            return (
              <View key={`door:${ticket.ticket_id}`} style={styles.ticketCard}>
                <View style={styles.ticketTop}>
                  <Ionicons name="alert-circle" size={18} color={COLORS.Warning} />
                  <Text style={styles.ticketTitle}>
                    Order {ticket.order_number || ticket.order_id}
                  </Text>
                  <StatusPill status={ticket.status} />
                </View>

                <Text style={styles.ticketBody}>
                  {ticket.rider_name ? `${ticket.rider_name} ` : 'A rider '}
                  collected this without counting it at the door.
                </Text>

                {ticket.address_text ? (
                  <Text style={styles.ticketMeta} numberOfLines={2}>
                    {ticket.address_text}
                  </Text>
                ) : null}

                <Text style={styles.ticketMeta}>
                  {ticket.item_count} {ticket.item_count === 1 ? 'item' : 'items'}
                  {ticket.weight_kg > 0 ? ` · ${ticket.weight_kg} kg` : ''}
                  {ticket.created_at ? ` · ${when(ticket.created_at)}` : ''}
                </Text>

                <DecisionButtons
                  busy={busy}
                  disabled={Boolean(busyKey)}
                  onAccept={() => handleDoorTicket(ticket, 'accept')}
                  onReject={() => handleDoorTicket(ticket, 'reject')}
                />
              </View>
            );
          })}

          {itemTickets.map((ticket) => {
            const busy = busyKey === `item:${ticket.check_id}`;
            return (
              <View key={`item:${ticket.check_id}`} style={styles.ticketCard}>
                <View style={styles.ticketTop}>
                  <Ionicons name="swap-vertical" size={18} color={COLORS.Warning} />
                  <Text style={styles.ticketTitle}>
                    Order {ticket.order_number || ticket.order_id}
                  </Text>
                  <StatusPill status={ticket.ticket_status || 'PENDING'} />
                </View>

                <Text style={styles.ticketBody}>Quantity mismatch · {ticket.item_name}</Text>

                <View style={styles.qtyGrid}>
                  <QtyCell label="Ordered" value={String(ticket.ordered_quantity)} />
                  <QtyCell label="Checked" value={String(ticket.checked_quantity)} strong />
                  <QtyCell
                    label="Difference"
                    value={signed(ticket.difference)}
                    tone={ticket.difference < 0 ? COLORS.Error : COLORS.PrimaryDark}
                  />
                </View>

                {ticket.remark_label ? (
                  <Text style={styles.ticketDetail}>
                    <Text style={styles.ticketDetailLabel}>Rider remark: </Text>
                    {ticket.remark_label}
                    {ticket.remark_note ? ` — ${ticket.remark_note}` : ''}
                  </Text>
                ) : null}
                <Text style={styles.ticketDetail}>
                  <Text style={styles.ticketDetailLabel}>Rider: </Text>
                  {ticket.rider_name || 'Rider'}
                  {ticket.rider_mobile ? ` · ${ticket.rider_mobile}` : ''}
                </Text>
                <Text style={styles.ticketMeta}>{when(ticket.created_at)}</Text>

                <DecisionButtons
                  busy={busy}
                  disabled={Boolean(busyKey)}
                  onAccept={() => handleItemTicket(ticket, 'accept')}
                  onReject={() => handleItemTicket(ticket, 'reject')}
                />
              </View>
            );
          })}

          {/* ---------- ANSWERED ---------- */}
          {recent.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Answered recently</Text>
              {recent.map((entry) => (
                <View key={entry.key} style={styles.messageCard}>
                  <View style={styles.ticketTop}>
                    <Text style={[styles.messageBody, styles.recentTitle]} numberOfLines={2}>
                      {entry.title}
                    </Text>
                    <StatusPill status={entry.status} />
                  </View>
                  <Text style={styles.messageBody}>{entry.body}</Text>
                  <Text style={styles.messageMeta}>
                    {[entry.meta, when(entry.at)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              ))}
            </>
          ) : null}

          {/* ---------- FROM YOUR RIDERS ---------- */}
          <Text style={styles.sectionTitle}>From your riders</Text>

          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubble-outline" size={40} color={COLORS.TextSecondary} />
              <Text style={styles.emptyText}>No messages yet.</Text>
            </View>
          ) : (
            messages.map((message) => (
              <View key={message.id} style={styles.messageCard}>
                <Text style={styles.messageBody}>{message.body}</Text>
                {message.order_number ? (
                  <Text style={styles.messageMeta}>Order {message.order_number}</Text>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatusPill({ status }: { status: DoorTicketStatus }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.PENDING;
  return (
    <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.statusText, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

function QtyCell({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: string;
}) {
  return (
    <View style={styles.qtyCell}>
      <Text style={styles.qtyLabel}>{label}</Text>
      <Text style={[styles.qtyValue, strong && styles.qtyValueStrong, tone ? { color: tone } : null]}>
        {value}
      </Text>
    </View>
  );
}

/** Reject and Accept, side by side. Only the ticket being answered spins. */
function DecisionButtons({
  busy,
  disabled,
  onAccept,
  onReject,
}: {
  busy: boolean;
  disabled: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <View style={styles.decisionRow}>
      <TouchableOpacity
        style={[styles.rejectButton, disabled && styles.buttonBusy]}
        onPress={onReject}
        disabled={disabled}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Reject"
      >
        <Text style={styles.rejectButtonText}>Reject</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.acceptButton, disabled && styles.buttonBusy]}
        onPress={onAccept}
        disabled={disabled}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Accept"
      >
        {busy ? (
          <ActivityIndicator size="small" color={COLORS.Surface} />
        ) : (
          <Text style={styles.acceptButtonText}>Accept</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderWidth: 1,
    borderColor: COLORS.Error,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  errorText: { flex: 1, color: COLORS.Error, fontSize: TYPOGRAPHY.sizes.sm },

  sectionTitle: {
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.semibold,
    color: COLORS.TextPrimary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    gap: SPACING.sm,
  },
  emptyText: {
    color: COLORS.TextSecondary,
    fontSize: TYPOGRAPHY.sizes.sm,
    textAlign: 'center',
  },

  ticketCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.Warning,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.light,
  },
  ticketTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  ticketTitle: {
    flex: 1,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.semibold,
    color: COLORS.TextPrimary,
  },
  ticketBody: {
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
    lineHeight: 20,
  },
  ticketMeta: {
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },
  ticketDetail: {
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
    marginTop: 4,
  },
  ticketDetailLabel: { color: COLORS.TextSecondary },

  statusPill: {
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  statusText: { fontSize: 11, fontWeight: '700' },

  qtyGrid: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginVertical: SPACING.sm,
  },
  qtyCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.Border,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.xs,
    alignItems: 'center',
  },
  qtyLabel: { fontSize: 11, color: COLORS.TextSecondary },
  qtyValue: {
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '600',
    color: COLORS.TextPrimary,
    marginTop: 2,
  },
  qtyValueStrong: { fontWeight: '800' },

  decisionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  rejectButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.Error,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
  },
  rejectButtonText: {
    color: COLORS.Error,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
  },
  buttonBusy: { opacity: 0.7 },
  acceptButtonText: {
    color: COLORS.Surface,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },

  messageCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Border,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  messageBody: {
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
    lineHeight: 20,
  },
  recentTitle: { flex: 1, fontWeight: TYPOGRAPHY.weights.semibold },
  messageMeta: {
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: SPACING.xs,
  },
});
