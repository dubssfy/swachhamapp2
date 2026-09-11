import React, { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Linking,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
// The context package's SafeAreaView — react-native's own is iOS-only and
// applies no inset on Android. See the note in RiderDashboardScreen.
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';

import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import riderApi, {
  RiderJobDetail,
  DoorAcceptanceMode,
  DoorCheckRemark,
  DoorItemCheck,
  DoorTicketStatus,
  CheckedItemInput,
  DOOR_CHECK_REMARKS,
} from '../../services/riderApi';
import PickupScheduleCard from '../../components/PickupScheduleCard';
import { extractErrorMessage } from '../../services/api';
import useRiderStore from '../../store/riderStore';
import { canRouteTo, openGoogleMapsRoute } from '../../utils/navigation';

/**
 * One job, worked from accepted to handed over.
 *
 * The screen is a single column of decisions in the order they happen:
 * where am I going, who do I call, what am I collecting, and the one
 * button that is currently possible. Only ONE action is ever offered —
 * a rider on a bike should not have to choose between buttons.
 *
 * The handover code is the last step and it is not optional: the server
 * refuses to complete a job without it, so the field is shown as soon as
 * the rider marks themselves arrived.
 */
export default function RiderJobDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const jobId = String(route.params?.jobId || '');

  const refreshJobs = useRiderStore((s) => s.refreshJobs);
  const submitItemCheck = useRiderStore((s) => s.submitItemCheck);
  const acceptOfferWithoutCounting = useRiderStore((s) => s.acceptOfferWithoutCounting);

  const [job, setJob] = useState<RiderJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  /*
   * THE ACCEPT ORDER STEP.
   *
   * `chosenMode` is null until the rider picks one, which is what keeps
   * Confirm disabled — there is no default, because guessing on the rider's
   * behalf is the thing this step exists to prevent.
   */
  const [chosenMode, setChosenMode] = useState<DoorAcceptanceMode | null>(null);
  const [accepting, setAccepting] = useState(false);

  /*
   * THE CHECKING SHEET. What the rider typed per order line, and the remark
   * chosen for each line that does not match. `attempted` turns on the
   * inline errors once Submit has been tried, not before.
   */
  const [checked, setChecked] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, DoorCheckRemark | null>>({});
  // The rider's own words, per line, for a remark of Other.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);

  /* The same, for rechecking lines the business rejected. */
  const [recheckValues, setRecheckValues] = useState<Record<string, string>>({});
  const [recheckRemarks, setRecheckRemarks] = useState<Record<string, DoorCheckRemark | null>>({});
  const [recheckNotes, setRecheckNotes] = useState<Record<string, string>>({});
  const [recheckAttempted, setRecheckAttempted] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  /**
   * `silent` is for the poll: a dropped request on a moving phone must not
   * replace the whole screen with an error. The next tick tries again.
   */
  const load = useCallback(async (silent = false) => {
    try {
      const response = await riderApi.getJob(jobId);
      setJob(response.data);
      setError(null);
      // After the business rejects an uncounted pickup, counting is the only
      // way on, so it is chosen for the rider.
      if (response.data?.acceptance_required && response.data?.door_ticket?.status === 'REJECTED') {
        setChosenMode('WITH_COUNT');
      }
    } catch (err: any) {
      if (!silent) setError(extractErrorMessage(err, 'Could not load this job.'));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  /*
   * WAITING ON THE BUSINESS. While an uncounted ticket or a quantity mismatch
   * is pending, the job is re-read every 5 seconds so the answer shows up
   * without the rider doing anything — the app has no socket client, the
   * same reason the dashboard polls. Only while this screen is focused.
   */
  const waitingOnBusiness =
    job?.door_ticket?.status === 'PENDING' ||
    Boolean(job?.item_checks?.some((c) => c.ticket_status === 'PENDING'));

  useFocusEffect(
    useCallback(() => {
      if (!waitingOnBusiness) return;
      const timer = setInterval(() => void load(true), 5000);
      return () => clearInterval(timer);
    }, [waitingOnBusiness, load])
  );

  /**
   * Records how this order was accepted, then reloads the job.
   *
   * The reload is what closes the section: the server returns
   * `acceptance_required: false` once a mode is stored, so the screen moves
   * on because the SERVER says the step is done — never because this function
   * assumed it. A failure therefore leaves the section open with the reason
   * on screen, which is the correct outcome.
   *
   * WITHOUT_COUNT does not navigate away. It raises a ticket the business
   * must answer, and the rider stays here with the job in hand.
   */
  const confirmAcceptance = async () => {
    if (!chosenMode || accepting) return;
    setAccepting(true);
    try {
      /*
       * THROUGH THE STORE, not straight to the API.
       *
       * The uncounted path sets `awaitingTicket`, and the dashboard's
       * existing poll and "waiting on the business" card hang off it. Calling
       * the API directly here would record the ticket server-side and leave
       * that machinery blind to it, so the rider would be gated with nothing
       * telling them why.
       */
      if (chosenMode === 'WITH_COUNT') {
        const sheet = buildSheet(
          (job?.items || []).map((i) => ({
            order_item_id: i.order_item_id,
            item_name: i.item_name,
            ordered: i.quantity,
          })),
          checked,
          remarks,
          notes
        );
        if (!sheet.ok) {
          setAttempted(true);
          Alert.alert('Check not complete', sheet.message);
          return;
        }

        const result = await submitItemCheck(jobId, sheet.items);
        if (!result.ok) {
          Alert.alert('Could not submit', result.message);
          return;
        }
        Alert.alert(result.result?.pending_tickets ? 'Sent for approval' : 'Checked', result.message);
      } else {
        const result = await acceptOfferWithoutCounting(jobId);
        if (!result.ok) {
          Alert.alert('Could not accept', result.message);
          return;
        }
      }
      // Reloaded rather than assumed: the SERVER decides whether the step is
      // done, and `acceptance_required` coming back false is what closes the
      // section.
      await load();
    } catch (err: any) {
      Alert.alert(
        'Could not accept',
        extractErrorMessage(err, 'That did not go through. Try again.')
      );
    } finally {
      setAccepting(false);
    }
  };

  /**
   * Resubmits the lines the business rejected — only those. A match clears
   * the line; a mismatch goes back to the business as a new ticket.
   */
  const submitRecheck = async () => {
    if (!job || rechecking) return;
    const rejected = job.item_checks.filter((c) => c.ticket_status === 'REJECTED');
    const sheet = buildSheet(
      rejected.map((c) => ({
        order_item_id: c.order_item_id,
        item_name: c.item_name,
        ordered: c.ordered_quantity,
      })),
      recheckValues,
      recheckRemarks,
      recheckNotes
    );
    if (!sheet.ok) {
      setRecheckAttempted(true);
      Alert.alert('Recheck not complete', sheet.message);
      return;
    }

    setRechecking(true);
    try {
      const result = await submitItemCheck(jobId, sheet.items);
      if (!result.ok) {
        Alert.alert('Could not submit', result.message);
        return;
      }
      setRecheckValues({});
      setRecheckRemarks({});
      setRecheckNotes({});
      setRecheckAttempted(false);
      Alert.alert('Recheck sent', result.message);
      await load();
    } finally {
      setRechecking(false);
    }
  };

  const advance = async (status: 'EN_ROUTE' | 'ARRIVED') => {
    setWorking(true);
    try {
      const response = await riderApi.setJobStatus(jobId, status);
      setJob(response.data);
      await refreshJobs();

      /*
       * SETTING OFF OPENS THE ROUTE IN THE SAME TAP.
       *
       * A rider who has just said "I'm on my way" wants guidance, not a
       * second button to find. Only on EN_ROUTE: re-launching Maps when
       * they mark themselves ARRIVED would fight them at the doorstep.
       *
       * Not awaited into the failure path -- the status change already
       * succeeded, and Maps refusing to open must not report that as an
       * error. The Navigate button is still there if it does not appear.
       */
      if (status === 'EN_ROUTE') {
        // Setting off on a delivery means the rider has LOADED, so the route
        // is now to the customer, not back to the facility.
        void openGoogleMapsRoute({
          latitude: response.data.latitude,
          longitude: response.data.longitude,
          addressText: response.data.address_text,
        });
      }
    } catch (err: any) {
      Alert.alert('Could not update', extractErrorMessage(err, 'Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const complete = async () => {
    if (code.trim().length < 4) {
      Alert.alert('Code needed', 'Ask the customer for their 4-digit handover code.');
      return;
    }
    setWorking(true);
    try {
      await riderApi.completeJob(jobId, code.trim());
      await refreshJobs();
      Alert.alert(
        job?.job_type === 'PICKUP' ? 'Collected' : 'Delivered',
        job?.job_type === 'PICKUP'
          ? 'Collected. Drop it at the facility to finish this job.'
          : 'Handover confirmed. Nice work.',
        [{ text: 'Done', onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      Alert.alert('Handover failed', extractErrorMessage(err, 'That code did not match.'));
    } finally {
      setWorking(false);
    }
  };

  const release = () => {
    Alert.alert('Give this job back?', 'It will be offered to other riders nearby.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Give back',
        style: 'destructive',
        onPress: async () => {
          try {
            await riderApi.releaseJob(jobId, 'Released by rider');
            await refreshJobs();
            navigation.goBack();
          } catch (err: any) {
            Alert.alert('Could not release', extractErrorMessage(err, 'Please try again.'));
          }
        },
      },
    ]);
  };

  /** Starts Google Maps guidance to the stop the rider is heading for. */
  const navigate = async () => {
    if (!job) return;
    const toFacility =
      job.job_type === 'DELIVERY' && job.status === 'ASSIGNED' && Boolean(job.origin_address);
    const opened = await openGoogleMapsRoute(
      toFacility
        ? {
            latitude: job.origin_latitude,
            longitude: job.origin_longitude,
            addressText: job.origin_address,
          }
        : {
            latitude: job.latitude,
            longitude: job.longitude,
            addressText: job.address_text,
          }
    );
    if (!opened) {
      Alert.alert(
        'No route available',
        'This job has no map location or address to route to. Call ahead for directions.'
      );
    }
  };

  const call = () => {
    if (!job?.contact_mobile) return;
    Linking.openURL(`tel:${job.contact_mobile}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator color={COLORS.Primary} />
      </SafeAreaView>
    );
  }

  if (error || !job) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <Ionicons name="alert-circle-outline" size={32} color={COLORS.Error} />
        <Text style={styles.errorText}>{error || 'Job not found.'}</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const isPickup = job.job_type === 'PICKUP';

  /*
   * WHICH STOP THE RIDER IS HEADING FOR.
   *
   * A pickup has one stop. A DELIVERY has two: collect the finished laundry
   * from the facility, then take it to the customer. Which one is "next"
   * depends only on whether the rider has set off yet, so the screen shows
   * that stop and Navigate routes to it — rather than showing a customer
   * address to someone whose actual next turning is the facility.
   */
  const headingToFacility = !isPickup && job.status === 'ASSIGNED' && Boolean(job.origin_address);

  const currentStop = headingToFacility
    ? {
        label: 'COLLECT FROM',
        address: job.origin_address,
        latitude: job.origin_latitude,
        longitude: job.origin_longitude,
        contact: null as string | null,
      }
    : {
        label: isPickup ? 'COLLECT FROM' : 'DELIVER TO',
        address: job.address_text,
        latitude: job.latitude,
        longitude: job.longitude,
        contact: job.contact_name,
      };

  const routeAvailable = canRouteTo({
    latitude: currentStop.latitude,
    longitude: currentStop.longitude,
    addressText: currentStop.address,
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.Background} />

      {/* ---------- HEADER ---------- */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {/* "Dispatch" in the UI; the stored job_type stays 'DELIVERY'. */}
          <Text style={styles.headerTitle}>{isPickup ? 'Pickup' : 'Dispatch'}</Text>
          <Text style={styles.headerSub}>{job.order_number}</Text>
        </View>
        <StatusPill status={job.status} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ---------- WHERE ---------- */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>{currentStop.label}</Text>
          <Text style={styles.address}>{currentStop.address || 'No address recorded'}</Text>
          {currentStop.contact ? (
            <Text style={styles.contactName}>{currentStop.contact}</Text>
          ) : null}

          {/* On a delivery, say where the second stop is while the rider is
              still heading for the first. */}
          {headingToFacility ? (
            <Text style={styles.nextStopNote}>
              Then deliver to {job.address_text || 'the customer'}
            </Text>
          ) : null}

          <View style={styles.cardActions}>
            {/* Filled rather than outlined: on a job screen the one thing a
                rider needs most is the way there. */}
            <TouchableOpacity
              style={[styles.navChip, !routeAvailable && styles.navChipDisabled]}
              onPress={navigate}
              disabled={!routeAvailable}
              activeOpacity={0.85}
            >
              <Ionicons name="navigate" size={17} color="#fff" />
              <Text style={styles.navChipText}>Navigate</Text>
            </TouchableOpacity>

            {job.contact_mobile ? (
              <TouchableOpacity style={styles.actionChip} onPress={call}>
                <Ionicons name="call-outline" size={17} color={COLORS.Primary} />
                <Text style={styles.actionChipText}>Call</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {!routeAvailable ? (
            <Text style={styles.noRouteNote}>
              No map location on this job — call ahead for directions.
            </Text>
          ) : null}
        </View>

        {/* ---------- WHEN ----------
            The scheduled pickup, READ-ONLY. The same component the Manager,
            the customer and the business are shown, so all four read the
            same appointment. It has no press handler and there is no rider
            endpoint that changes either field — the rider sees the time and
            cannot move it.

            PICKUP JOBS ONLY: on a dispatch the collection has already
            happened, so its scheduled time is history rather than something
            to act on. The card renders nothing when no pickup is scheduled. */}
        {isPickup ? (
          <PickupScheduleCard
            date={job.assigned_pickup_date}
            time={job.assigned_pickup_time}
            title="Scheduled Pickup"
          />
        ) : null}

        {/* ---------- WHAT ----------
            Pieces only. A rider is never shown what an order is worth. */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>
            {job.total_quantity} PIECE{job.total_quantity === 1 ? '' : 'S'} · {job.item_count} LINE
            {job.item_count === 1 ? '' : 'S'}
          </Text>
          {job.items.map((item, index) => (
            <View key={`${item.item_name}-${index}`} style={styles.itemRow}>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.item_name}
              </Text>
              <Text style={styles.itemQty}>×{item.quantity}</Text>
            </View>
          ))}
        </View>

        {/*
          WHAT WAS AGREED AT THE DOOR, once it has been.
          Kept on screen rather than disappearing: it is the record the rider
          can point at if the count is questioned later.
        */}
        {/* Pickups only: a dispatch has no counting step, so nothing about
            counting is shown on one — including jobs accepted that way
            before the step was removed from dispatches. */}
        {isPickup && !job.acceptance_required && job.door_acceptance_mode ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>ACCEPTED</Text>
            <Text style={styles.acceptedSummary}>
              {job.door_acceptance_mode === 'WITH_COUNT'
                ? `With counting — ${job.accepted_piece_count} piece${
                    job.accepted_piece_count === 1 ? '' : 's'
                  }`
                : 'Without counting'}
            </Text>
          </View>
        ) : null}

        {/*
          THE DOOR CHECK, once submitted: every line with its status, and a
          recheck field on each line the business rejected. Kept on screen
          afterwards as the record of what was counted.
        */}
        {isPickup && job.item_checks?.length ? (
          <DoorCheckCard
            orderNumber={job.order_number}
            checks={job.item_checks}
            recheckValues={recheckValues}
            onChangeRecheck={(id, v) => setRecheckValues((c) => ({ ...c, [id]: v }))}
            recheckRemarks={recheckRemarks}
            onChangeRecheckRemark={(id, r) => setRecheckRemarks((c) => ({ ...c, [id]: r }))}
            recheckNotes={recheckNotes}
            onChangeRecheckNote={(id, t) => setRecheckNotes((c) => ({ ...c, [id]: t }))}
            recheckAttempted={recheckAttempted}
            rechecking={rechecking}
            onSubmitRecheck={submitRecheck}
          />
        ) : null}

        {/* ---------- THE ONE NEXT ACTION ---------- */}
        {job.status === 'ASSIGNED' ? (
          <PrimaryButton
            label={headingToFacility ? "Loaded — I'm on my way" : "Start — I'm on my way"}
            icon="bicycle-outline"
            busy={working}
            onPress={() => advance('EN_ROUTE')}
          />
        ) : null}

        {job.status === 'EN_ROUTE' ? (
          <PrimaryButton
            label="I've arrived"
            icon="location-outline"
            busy={working}
            onPress={() => advance('ARRIVED')}
          />
        ) : null}

        {/*
          ---------- AT THE DOOR ----------

          COUNTING FIRST, THEN THE CODE. The rider is standing with the other
          party: they count the load, say how they took it, and only then read
          out the code that closes the handover. Asking earlier — on the way
          there — asked about a load they had not yet seen.

          The code card is withheld until the acceptance is recorded, and
          `completeJob` refuses the handover without it, so the order of these
          two is the same whether the rider is looking at the screen or not.
        */}
        {/* Pickups only — the server never asks on a dispatch; this is the
            same rule held on screen as well. */}
        {isPickup && job.status === 'ARRIVED' && job.acceptance_required ? (
          <AcceptOrderSection
            jobType={job.job_type}
            contactName={job.contact_name}
            busy={accepting}
            orderNumber={job.order_number}
            lines={job.items}
            checked={checked}
            onChangeChecked={(id, v) => setChecked((c) => ({ ...c, [id]: v }))}
            remarks={remarks}
            onChangeRemark={(id, r) => setRemarks((c) => ({ ...c, [id]: r }))}
            notes={notes}
            onChangeNote={(id, t) => setNotes((c) => ({ ...c, [id]: t }))}
            attempted={attempted}
            uncountedRejected={job.door_ticket?.status === 'REJECTED'}
            mode={chosenMode}
            onChooseMode={setChosenMode}
            onConfirm={confirmAcceptance}
          />
        ) : null}

        {/*
          HELD AT THE DOOR. The acceptance is recorded but the business has
          not answered — or rejected a line that needs rechecking. The code
          card is withheld, and `completeJob` refuses for the same reason.
        */}
        {job.status === 'ARRIVED' && !job.acceptance_required && job.handover_block_reason ? (
          <View style={styles.blockedBanner}>
            {waitingOnBusiness ? (
              <ActivityIndicator size="small" color={COLORS.Warning} />
            ) : (
              <Ionicons name="alert-circle" size={20} color={COLORS.Error} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.blockedText}>{job.handover_block_reason}</Text>
              {waitingOnBusiness ? (
                <Text style={styles.blockedHint}>This updates on its own when they answer.</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {job.status === 'ARRIVED' && !job.acceptance_required && !job.handover_block_reason ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>HANDOVER CODE</Text>
            <Text style={styles.codeHelp}>
              Ask {job.contact_name || 'the customer'} to read out their 4-digit code.
            </Text>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="0000"
              placeholderTextColor={COLORS.TextSecondary}
              maxLength={6}
              textAlign="center"
            />
            <PrimaryButton
              label={isPickup ? 'Confirm collection' : 'Confirm delivery'}
              icon="checkmark-circle-outline"
              busy={working}
              onPress={complete}
            />
          </View>
        ) : null}

        {/* A COLLECTED pickup is on the bike, not finished. The job ends at
            the facility, which is a single action on the dashboard so a rider
            can empty the whole bike in one go rather than job by job. */}
        {job.status === 'COLLECTED' ? (
          <View style={styles.carryingBanner}>
            <Ionicons name="bicycle" size={20} color={COLORS.PrimaryDark} />
            <Text style={styles.carryingText}>
              Collected and with you now. Finish this by dropping it at the facility — use
              "Drop off at facility" on your home screen.
            </Text>
          </View>
        ) : null}

        {job.status === 'COMPLETED' ? (
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.Success} />
            <Text style={styles.doneText}>
              {isPickup ? 'Delivered to the facility' : 'Delivered'} — nothing left to do here.
            </Text>
          </View>
        ) : null}

        {/* Giving a job back is deliberately quiet: available, not inviting. */}
        {/* Not offered once COLLECTED: the bags are already on the bike, and
            handing the job back would leave them there with no owner. */}
        {/* Offered even while acceptance is outstanding: a rider who cannot do
            the job must not be trapped by a step they do not want to take. */}
        {['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(job.status) ? (
          <TouchableOpacity style={styles.releaseButton} onPress={release}>
            <Text style={styles.releaseText}>Can't do this job</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * ACCEPT ORDER — the compulsory step, inside the order.
 *
 * IT IS THE ONLY THING ON SCREEN THAT CAN BE ACTED ON while it is showing:
 * the caller suppresses every onward action behind it, so this cannot be
 * scrolled past or tapped around. That is the whole point — the previous
 * version sat beside a plain Accept button on the dashboard and was
 * therefore optional.
 *
 * NO DEFAULT MODE. Confirm stays disabled until the rider chooses, because a
 * pre-selected answer is one a tired rider confirms without reading, and
 * "counted" is a claim made to a hotel on their behalf.
 */
function AcceptOrderSection({
  jobType,
  contactName,
  busy,
  mode,
  onChooseMode,
  orderNumber,
  lines,
  checked,
  onChangeChecked,
  remarks,
  onChangeRemark,
  notes,
  onChangeNote,
  attempted,
  uncountedRejected,
  onConfirm,
}: {
  jobType: string;
  contactName: string | null;
  busy: boolean;
  mode: DoorAcceptanceMode | null;
  onChooseMode: (m: DoorAcceptanceMode) => void;
  orderNumber: string;
  lines: RiderJobDetail['items'];
  checked: Record<string, string>;
  onChangeChecked: (orderItemId: string, value: string) => void;
  remarks: Record<string, DoorCheckRemark | null>;
  onChangeRemark: (orderItemId: string, remark: DoorCheckRemark) => void;
  notes: Record<string, string>;
  onChangeNote: (orderItemId: string, note: string) => void;
  attempted: boolean;
  /** The business refused the uncounted answer; counting is the only way on. */
  uncountedRejected: boolean;
  onConfirm: () => void;
}) {
  /*
   * Submit is live as soon as a mode is chosen. The sheet is validated on
   * press — every line entered, every mismatch given a remark — and what is
   * missing is marked on the sheet itself, which says more than a greyed-out
   * button would.
   */
  const canConfirm =
    (mode === 'WITHOUT_COUNT' && !uncountedRejected) || (mode === 'WITH_COUNT' && lines.length > 0);

  const Option = ({ value, title, detail }: { value: DoorAcceptanceMode; title: string; detail: string }) => {
    const selected = mode === value;
    return (
      <TouchableOpacity
        style={[styles.acceptOption, selected && styles.acceptOptionSelected]}
        onPress={() => onChooseMode(value)}
        activeOpacity={0.85}
        disabled={busy}
      >
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={20}
          color={selected ? COLORS.Primary : COLORS.TextSecondary}
        />
        <View style={styles.acceptOptionBody}>
          <Text style={[styles.acceptOptionTitle, selected && styles.acceptOptionTitleSelected]}>
            {title}
          </Text>
          <Text style={styles.acceptOptionDetail}>{detail}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.card, styles.acceptCard]}>
      <Text style={styles.cardLabel}>
        {jobType === 'PICKUP' ? 'CONFIRM PICKUP' : 'CONFIRM COLLECTION'}
      </Text>
      <Text style={styles.codeHelp}>
        {jobType === 'PICKUP'
          ? `Before the code — how did you take this load from ${
              contactName || 'the establishment'
            }?`
          : 'Before the code — how did you take this load from the facility?'}
      </Text>

      {uncountedRejected ? (
        <View style={styles.rejectedBanner}>
          <Ionicons name="close-circle" size={18} color={COLORS.Error} />
          <Text style={styles.rejectedBannerText}>
            The business rejected collecting this without counting. Count every item below and
            submit to continue.
          </Text>
        </View>
      ) : null}

      <Option
        value="WITH_COUNT"
        title="With Counting & Checked"
        detail="Count each item with their staff and enter the checked quantity."
      />

      {mode === 'WITH_COUNT' ? (
        <CheckSheet
          orderNumber={orderNumber}
          lines={lines.map((l) => ({
            order_item_id: l.order_item_id,
            item_name: l.item_name,
            ordered: l.quantity,
          }))}
          values={checked}
          onChangeValue={onChangeChecked}
          remarks={remarks}
          onChangeRemark={onChangeRemark}
          notes={notes}
          onChangeNote={onChangeNote}
          attempted={attempted}
          busy={busy}
        />
      ) : null}

      {/* Not offered once the business has refused it: asking again would put
          the same question back to them, and the server refuses it too. */}
      {!uncountedRejected ? (
        <Option
          value="WITHOUT_COUNT"
          title="Without Counting"
          detail="Not counted. The establishment is asked to agree before you continue."
        />
      ) : null}

      <PrimaryButton
        label={mode === 'WITH_COUNT' ? 'Submit' : 'Confirm acceptance'}
        icon="checkmark-circle-outline"
        busy={busy}
        onPress={canConfirm ? onConfirm : () => {}}
        disabled={!canConfirm}
      />

      {mode === 'WITH_COUNT' ? (
        <Text style={styles.acceptHint}>
          Any item that does not match needs a remark. The business approves each mismatch before
          you continue.
        </Text>
      ) : null}
      {!mode ? <Text style={styles.acceptHint}>Choose one to continue.</Text> : null}
    </View>
  );
}

/**
 * Turns what was typed into the sheet the server takes, or says what is
 * missing. Every line needs a quantity; a line that differs from the order
 * needs a remark, and a remark of Other needs a note in the rider's own
 * words. A matched line never carries either.
 */
function buildSheet(
  lines: Array<{ order_item_id: string; item_name: string; ordered: number }>,
  values: Record<string, string>,
  remarks: Record<string, DoorCheckRemark | null>,
  notes: Record<string, string>
): { ok: true; items: CheckedItemInput[] } | { ok: false; message: string } {
  const items: CheckedItemInput[] = [];
  const missing: string[] = [];
  const needRemark: string[] = [];
  const needNote: string[] = [];

  for (const line of lines) {
    const raw = values[line.order_item_id] ?? '';
    if (raw === '') {
      missing.push(line.item_name);
      continue;
    }
    const qty = Number(raw);
    const mismatch = qty !== line.ordered;
    const remark = mismatch ? remarks[line.order_item_id] ?? null : null;
    const note = remark === 'OTHER' ? (notes[line.order_item_id] ?? '').trim() : '';
    if (mismatch && !remark) needRemark.push(line.item_name);
    if (remark === 'OTHER' && !note) needNote.push(line.item_name);
    items.push({
      order_item_id: line.order_item_id,
      checked_quantity: qty,
      remark,
      remark_note: note || null,
    });
  }

  if (missing.length) {
    return { ok: false, message: `Enter the checked quantity for: ${missing.join(', ')}.` };
  }
  if (needRemark.length) {
    return {
      ok: false,
      message: `Choose a remark for every item that does not match: ${needRemark.join(', ')}.`,
    };
  }
  if (needNote.length) {
    return {
      ok: false,
      message: `Write a note explaining "Other" for: ${needNote.join(', ')}.`,
    };
  }
  return { ok: true, items };
}

/**
 * THE CHECKING SCREEN — Order No. | Item Name | Order Qty | Checked Qty.
 *
 * A remark picker opens under a line the moment its checked quantity differs
 * from the order, so the rider sees what is needed while still at that line.
 */
function CheckSheet({
  orderNumber,
  lines,
  values,
  onChangeValue,
  remarks,
  onChangeRemark,
  notes,
  onChangeNote,
  attempted,
  busy,
}: {
  orderNumber: string;
  lines: Array<{ order_item_id: string; item_name: string; ordered: number }>;
  values: Record<string, string>;
  onChangeValue: (orderItemId: string, value: string) => void;
  remarks: Record<string, DoorCheckRemark | null>;
  onChangeRemark: (orderItemId: string, remark: DoorCheckRemark) => void;
  notes: Record<string, string>;
  onChangeNote: (orderItemId: string, note: string) => void;
  attempted: boolean;
  busy: boolean;
}) {
  return (
    <View style={styles.sheet}>
      <View style={[styles.sheetRow, styles.sheetHead]}>
        <Text style={[styles.sheetHeadText, styles.colOrder]}>Order No.</Text>
        <Text style={[styles.sheetHeadText, styles.colItem]}>Item Name</Text>
        <Text style={[styles.sheetHeadText, styles.colQty, styles.num]}>Order Qty</Text>
        <Text style={[styles.sheetHeadText, styles.colChecked, styles.num]}>Checked Qty</Text>
      </View>

      {lines.map((line) => {
        const raw = values[line.order_item_id] ?? '';
        const entered = raw !== '';
        const mismatch = entered && Number(raw) !== line.ordered;
        const remark = remarks[line.order_item_id] ?? null;
        return (
          <View key={line.order_item_id} style={styles.sheetLine}>
            <View style={styles.sheetRow}>
              <Text style={[styles.sheetCell, styles.colOrder, styles.sheetOrderNo]} numberOfLines={2}>
                {orderNumber}
              </Text>
              <Text style={[styles.sheetCell, styles.colItem]} numberOfLines={3}>
                {line.item_name}
              </Text>
              <Text style={[styles.sheetCell, styles.colQty, styles.num, styles.sheetQty]}>
                {line.ordered}
              </Text>
              <View style={styles.colChecked}>
                <TextInput
                  style={[
                    styles.sheetInput,
                    attempted && !entered && styles.sheetInputError,
                    mismatch && styles.sheetInputMismatch,
                  ]}
                  value={raw}
                  onChangeText={(t) =>
                    onChangeValue(line.order_item_id, t.replace(/[^0-9]/g, '').slice(0, 5))
                  }
                  keyboardType="number-pad"
                  placeholder="—"
                  placeholderTextColor={COLORS.TextSecondary}
                  textAlign="center"
                  editable={!busy}
                  accessibilityLabel={`Checked quantity for ${line.item_name}`}
                />
              </View>
            </View>

            {mismatch ? (
              <RemarkPicker
                value={remark}
                onChange={(r) => onChangeRemark(line.order_item_id, r)}
                note={notes[line.order_item_id] ?? ''}
                onChangeNote={(t) => onChangeNote(line.order_item_id, t)}
                difference={Number(raw) - line.ordered}
                attempted={attempted}
                disabled={busy}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Exactly three remarks: Damaged Item, Quantity Mismatched, Other. Choosing
 * Other opens a note for the rider's own words, and the note is required.
 */
function RemarkPicker({
  value,
  onChange,
  note,
  onChangeNote,
  difference,
  attempted,
  disabled,
}: {
  value: DoorCheckRemark | null;
  onChange: (remark: DoorCheckRemark) => void;
  note: string;
  onChangeNote: (note: string) => void;
  difference: number;
  /** Submit has been tried — show what is still missing. */
  attempted: boolean;
  disabled: boolean;
}) {
  const noteMissing = value === 'OTHER' && !note.trim();
  const error = attempted && (!value || noteMissing);
  return (
    <View style={styles.remarkBlock}>
      <Text style={[styles.remarkLabel, error && styles.remarkLabelError]}>
        REMARK · {difference > 0 ? `+${difference}` : difference} vs order
        {error ? ' · required' : ''}
      </Text>
      <View style={styles.remarkRow}>
        {DOOR_CHECK_REMARKS.map((option) => {
          const on = value === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.remarkChip, on && styles.remarkChipOn]}
              onPress={() => onChange(option.value)}
              disabled={disabled}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.remarkChipText, on && styles.remarkChipTextOn]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {value === 'OTHER' ? (
        <TextInput
          style={[styles.noteInput, attempted && noteMissing && styles.sheetInputError]}
          value={note}
          onChangeText={(t) => onChangeNote(t.slice(0, 500))}
          placeholder="Describe the reason"
          placeholderTextColor={COLORS.TextSecondary}
          multiline
          maxLength={500}
          editable={!disabled}
          accessibilityLabel="Remark note"
        />
      ) : null}
    </View>
  );
}

const CHECK_STATUS: Record<'MATCHED' | DoorTicketStatus, { label: string; bg: string; fg: string }> = {
  MATCHED: { label: 'Matched', bg: '#E8F3EC', fg: '#1B4332' },
  PENDING: { label: 'Pending', bg: '#FFF4E5', fg: '#8A5200' },
  ACCEPTED: { label: 'Accepted', bg: '#E8F3EC', fg: '#1B4332' },
  REJECTED: { label: 'Rejected', bg: '#FDECEC', fg: '#B42318' },
};

function CheckStatusPill({ status }: { status: DoorTicketStatus | null }) {
  const tone = CHECK_STATUS[status || 'MATCHED'];
  return (
    <View style={[styles.checkPill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.checkPillText, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

/**
 * The submitted sheet, line by line, with the business's answer on each.
 * A rejected line opens a recheck field; one Submit sends every recheck.
 */
function DoorCheckCard({
  orderNumber,
  checks,
  recheckValues,
  onChangeRecheck,
  recheckRemarks,
  onChangeRecheckRemark,
  recheckNotes,
  onChangeRecheckNote,
  recheckAttempted,
  rechecking,
  onSubmitRecheck,
}: {
  orderNumber: string;
  checks: DoorItemCheck[];
  recheckValues: Record<string, string>;
  onChangeRecheck: (orderItemId: string, value: string) => void;
  recheckRemarks: Record<string, DoorCheckRemark | null>;
  onChangeRecheckRemark: (orderItemId: string, remark: DoorCheckRemark) => void;
  recheckNotes: Record<string, string>;
  onChangeRecheckNote: (orderItemId: string, note: string) => void;
  recheckAttempted: boolean;
  rechecking: boolean;
  onSubmitRecheck: () => void;
}) {
  const rejected = checks.filter((c) => c.ticket_status === 'REJECTED').length;

  const Head = ({ children, style }: { children: ReactNode; style: any }) => (
    <Text style={[styles.sheetHeadText, style]}>{children}</Text>
  );

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>DOOR CHECK · {orderNumber}</Text>

      <View style={[styles.sheetRow, styles.sheetHead]}>
        <Head style={styles.colItemWide}>Item Name</Head>
        <Head style={[styles.colQty, styles.num]}>Order Qty</Head>
        <Head style={[styles.colQty, styles.num]}>Checked Qty</Head>
        <Head style={[styles.colStatus, styles.num]}>Status</Head>
      </View>

      {checks.map((c) => {
        const raw = recheckValues[c.order_item_id] ?? '';
        const entered = raw !== '';
        const mismatch = entered && Number(raw) !== c.ordered_quantity;
        const remark = recheckRemarks[c.order_item_id] ?? null;
        return (
          <View key={c.check_id} style={styles.sheetLine}>
            <View style={styles.sheetRow}>
              <Text style={[styles.sheetCell, styles.colItemWide]} numberOfLines={3}>
                {c.item_name}
              </Text>
              <Text style={[styles.sheetCell, styles.colQty, styles.num]}>{c.ordered_quantity}</Text>
              <Text style={[styles.sheetCell, styles.colQty, styles.num, styles.sheetQty]}>
                {c.checked_quantity}
              </Text>
              <View style={[styles.colStatus, { alignItems: 'flex-end' }]}>
                <CheckStatusPill status={c.ticket_status} />
              </View>
            </View>

            {c.remark_label ? (
              <Text style={styles.checkNote}>
                Remark: {c.remark_label}
                {c.remark_note ? ` — ${c.remark_note}` : ''}
              </Text>
            ) : null}
            {c.ticket_status === 'PENDING' ? (
              <Text style={styles.checkNote}>Waiting for the business to approve.</Text>
            ) : null}
            {c.ticket_status === 'ACCEPTED' ? (
              <Text style={styles.checkNote}>
                Approved — the order quantity is now {c.checked_quantity}.
              </Text>
            ) : null}

            {c.ticket_status === 'REJECTED' ? (
              <View style={styles.recheckBlock}>
                <Text style={styles.checkNoteError}>
                  Rejected — the order stays at {c.ordered_quantity}. Recheck this item.
                </Text>
                <View style={styles.recheckRow}>
                  <Text style={styles.recheckLabel}>Rechecked qty</Text>
                  <TextInput
                    style={[
                      styles.sheetInput,
                      styles.recheckInput,
                      recheckAttempted && !entered && styles.sheetInputError,
                      mismatch && styles.sheetInputMismatch,
                    ]}
                    value={raw}
                    onChangeText={(t) =>
                      onChangeRecheck(c.order_item_id, t.replace(/[^0-9]/g, '').slice(0, 5))
                    }
                    keyboardType="number-pad"
                    placeholder="—"
                    placeholderTextColor={COLORS.TextSecondary}
                    textAlign="center"
                    editable={!rechecking}
                    accessibilityLabel={`Rechecked quantity for ${c.item_name}`}
                  />
                </View>
                {mismatch ? (
                  <RemarkPicker
                    value={remark}
                    onChange={(r) => onChangeRecheckRemark(c.order_item_id, r)}
                    note={recheckNotes[c.order_item_id] ?? ''}
                    onChangeNote={(t) => onChangeRecheckNote(c.order_item_id, t)}
                    difference={Number(raw) - c.ordered_quantity}
                    attempted={recheckAttempted}
                    disabled={rechecking}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}

      {rejected > 0 ? (
        <View style={{ marginTop: SPACING.md }}>
          <PrimaryButton
            label={`Submit recheck (${rejected})`}
            icon="refresh-outline"
            busy={rechecking}
            onPress={onSubmitRecheck}
          />
        </View>
      ) : null}
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  busy,
  onPress,
  // Optional so every existing call site is unchanged. Used by the acceptance
  // section, where Confirm stays inert until a mode has been chosen.
  disabled = false,
}: {
  label: string;
  icon: any;
  busy: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const inert = busy || disabled;
  return (
    <TouchableOpacity
      style={[styles.primaryButton, inert && styles.buttonDisabled]}
      onPress={onPress}
      disabled={inert}
      activeOpacity={0.85}
    >
      {busy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          <Ionicons name={icon} size={20} color="#fff" />
          <Text style={styles.primaryText}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Accepted',
  EN_ROUTE: 'On the way',
  ARRIVED: 'At the door',
  COLLECTED: 'On your bike',
  HELD: 'On hold',
  COMPLETED: 'Done',
};

function StatusPill({ status }: { status: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{STATUS_LABEL[status] || status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  centered: { alignItems: 'center', justifyContent: 'center', gap: SPACING.md, padding: SPACING.lg },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.Border,
    backgroundColor: COLORS.Surface,
  },
  backButton: { padding: SPACING.xs },
  headerTitle: {
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: TYPOGRAPHY.weights.bold,
    color: COLORS.TextPrimary,
  },
  headerSub: { fontSize: TYPOGRAPHY.sizes.xs, color: COLORS.TextSecondary },

  pill: {
    backgroundColor: '#E8F5E9',
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  pillText: { fontSize: 11, fontWeight: '700', color: COLORS.PrimaryDark },

  card: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.Border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: COLORS.TextSecondary,
    marginBottom: SPACING.sm,
  },
  address: {
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.semibold,
    color: COLORS.TextPrimary,
    lineHeight: 22,
  },
  contactName: { fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextSecondary, marginTop: 4 },
  nextStopNote: {
    marginTop: SPACING.sm,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    fontStyle: 'italic',
  },

  cardActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.Accent,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  actionChipText: { color: COLORS.Primary, fontWeight: '600', fontSize: TYPOGRAPHY.sizes.sm },
  navChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  navChipDisabled: { backgroundColor: COLORS.Border },
  navChipText: { color: '#fff', fontWeight: '700', fontSize: TYPOGRAPHY.sizes.sm },
  noRouteNote: {
    marginTop: SPACING.sm,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },

  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: COLORS.Border,
    gap: SPACING.sm,
  },
  itemName: { flex: 1, fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextPrimary },
  itemQty: { fontSize: TYPOGRAPHY.sizes.sm, fontWeight: '700', color: COLORS.TextPrimary },

  primaryButton: {
    height: 54,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  primaryText: { color: '#fff', fontSize: TYPOGRAPHY.sizes.lg, fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },

  codeHelp: {
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginBottom: SPACING.md,
    lineHeight: 19,
  },
  codeInput: {
    height: 60,
    borderWidth: 2,
    borderColor: COLORS.Accent,
    borderRadius: BORDER_RADIUS.md,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 8,
    color: COLORS.TextPrimary,
    marginBottom: SPACING.md,
  },

  /* ---------- ACCEPT ORDER ---------- */
  /* Bordered in the accent colour so the step reads as the thing to deal
     with, not as one more card among the order's details. */
  acceptCard: {
    borderWidth: 2,
    borderColor: COLORS.Accent,
  },
  acceptOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.Border ?? '#E3E8E4',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  acceptOptionSelected: {
    borderColor: COLORS.Primary,
    backgroundColor: '#F3FAF5',
  },
  acceptOptionBody: { flex: 1 },
  acceptOptionTitle: {
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  acceptOptionTitleSelected: { color: COLORS.PrimaryDark },
  acceptOptionDetail: {
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  countBlock: { marginBottom: SPACING.sm },
  countLabel: {
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: COLORS.TextSecondary,
    marginBottom: SPACING.xs,
  },
  acceptHint: {
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  acceptedSummary: {
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },

  /* ---------- THE CHECKING SHEET ---------- */
  sheet: {
    borderWidth: 1,
    borderColor: COLORS.Border,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    overflow: 'hidden',
  },
  sheetHead: {
    backgroundColor: '#F3FAF5',
    paddingVertical: 6,
  },
  sheetHeadText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: COLORS.TextSecondary,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.sm,
  },
  sheetLine: {
    borderTopWidth: 1,
    borderTopColor: COLORS.Border,
    paddingVertical: 6,
  },
  sheetCell: { fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextPrimary },
  colOrder: { flex: 1.1 },
  colItem: { flex: 1.6 },
  colItemWide: { flex: 2 },
  colQty: { flex: 0.9 },
  colChecked: { flex: 1.1 },
  colStatus: { flex: 1.2 },
  num: { textAlign: 'center' },
  sheetOrderNo: { fontSize: 11, color: COLORS.TextSecondary },
  sheetQty: { fontWeight: '700' },
  sheetInput: {
    height: 40,
    borderWidth: 1.5,
    borderColor: COLORS.Accent,
    borderRadius: BORDER_RADIUS.sm ?? 6,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.TextPrimary,
    paddingVertical: 0,
  },
  sheetInputError: { borderColor: COLORS.Error, backgroundColor: '#FDECEC' },
  sheetInputMismatch: { borderColor: COLORS.Warning, backgroundColor: '#FFF8EC' },

  remarkBlock: { paddingHorizontal: SPACING.sm, paddingTop: 6 },
  remarkLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: COLORS.TextSecondary,
    marginBottom: 4,
  },
  remarkLabelError: { color: COLORS.Error },
  remarkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  remarkChip: {
    borderWidth: 1,
    borderColor: COLORS.Border,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
  },
  remarkChipOn: { borderColor: COLORS.Primary, backgroundColor: COLORS.Primary },
  remarkChipText: { fontSize: TYPOGRAPHY.sizes.xs, color: COLORS.TextPrimary, fontWeight: '600' },
  remarkChipTextOn: { color: '#fff' },
  noteInput: {
    minHeight: 56,
    marginTop: 6,
    borderWidth: 1.5,
    borderColor: COLORS.Accent,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
    textAlignVertical: 'top',
  },

  checkPill: { borderRadius: BORDER_RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 },
  checkPillText: { fontSize: 10, fontWeight: '700' },
  checkNote: {
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    paddingHorizontal: SPACING.sm,
    marginTop: 3,
  },
  checkNoteError: {
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.Error,
    fontWeight: '600',
    marginBottom: 6,
  },
  recheckBlock: { paddingHorizontal: SPACING.sm, paddingTop: 6 },
  recheckRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  recheckLabel: { flex: 1, fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextPrimary },
  recheckInput: { width: 90 },

  rejectedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    backgroundColor: '#FDECEC',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  rejectedBannerText: { flex: 1, color: '#B42318', fontSize: TYPOGRAPHY.sizes.sm, lineHeight: 19 },

  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    backgroundColor: '#FFF8EC',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Warning,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  blockedText: {
    color: COLORS.TextPrimary,
    fontWeight: '600',
    lineHeight: 19,
    fontSize: TYPOGRAPHY.sizes.sm,
  },
  blockedHint: { color: COLORS.TextSecondary, fontSize: TYPOGRAPHY.sizes.xs, marginTop: 4 },

  carryingBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    backgroundColor: '#E8F5E9',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Accent,
    padding: SPACING.md,
  },
  carryingText: {
    flex: 1,
    color: COLORS.PrimaryDark,
    fontWeight: '600',
    lineHeight: 19,
    fontSize: TYPOGRAPHY.sizes.sm,
  },

  doneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: '#E9F7EF',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Success,
    padding: SPACING.md,
  },
  doneText: { flex: 1, color: COLORS.PrimaryDark, fontWeight: '600' },

  releaseButton: { alignItems: 'center', paddingVertical: SPACING.md, marginTop: SPACING.sm },
  releaseText: { color: COLORS.TextSecondary, fontSize: TYPOGRAPHY.sizes.sm },

  errorText: { color: COLORS.Error, textAlign: 'center', fontSize: TYPOGRAPHY.sizes.base },
  secondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.Border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  secondaryText: { color: COLORS.TextPrimary, fontWeight: '600' },
});
