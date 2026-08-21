import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import OrderConfirmationModal from '../../components/OrderConfirmationModal';
import businessOrderApi, { BusinessTimeSlot } from '../../services/businessOrderApi';
import { extractErrorMessage } from '../../services/api';
import {
  useBusinessOrderStore,
  DAY_REQUIRED_MESSAGE,
  PICKUP_TIME_REQUIRED_MESSAGE,
  DELIVERY_TIME_REQUIRED_MESSAGE,
} from '../../store/businessOrderStore';
import { formatLongDate, parseDateKey, toDateKey } from '../../utils/sorterDates';

/**
 * Select Time Slot — the step between the Cart and the order itself.
 *
 * Its own page in the Cart stack, so the Cart holds nothing but the cart. The
 * Cart screen stays mounted underneath while this is open, which is what
 * keeps every item and quantity intact on the way back.
 *
 * The day comes first and the two slot sections only appear once it has been
 * chosen — there is nothing to pick a time on until there is a day. Pickup
 * and delivery are chosen independently.
 */

/** How many days ahead can be booked, starting today. */
const DAY_COUNT = 7;

export default function BusinessTimeSlotScreen({ navigation }: any) {
  const { confirmOrder, isPlacingOrder, cart } = useBusinessOrderStore();

  /**
   * The bookable days, built from the device's own calendar at mount — today
   * first. Never a hardcoded date.
   */
  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: DAY_COUNT }, (_, offset) => {
      const day = new Date(today);
      day.setDate(today.getDate() + offset);
      return toDateKey(day);
    });
  }, []);

  // Nothing is preselected: choosing the day is the first thing to do here,
  // and it is what reveals the rest of the page.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [pickupTimeSlot, setPickupTimeSlot] = useState<string | null>(null);
  const [deliveryTimeSlot, setDeliveryTimeSlot] = useState<string | null>(null);

  /** Optional free text, kept alongside the slots and sent with the order. */
  const [pickupNotes, setPickupNotes] = useState('');
  const [serviceNotes, setServiceNotes] = useState('');

  const [slots, setSlots] = useState<BusinessTimeSlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(true);
  const [slotsError, setSlotsError] = useState('');
  const [error, setError] = useState('');

  /** Set once the order is placed; drives the existing confirmation panel. */
  const [placedOrder, setPlacedOrder] = useState<{
    number: string;
    date: string;
    pickup: string;
    delivery: string;
  } | null>(null);

  // The slots come from the server, which is also what validates the choice,
  // so this page can never offer a slot the backend would reject.
  const loadSlots = useCallback(async () => {
    try {
      setSlotsError('');
      setIsLoadingSlots(true);
      const response = await businessOrderApi.getTimeSlots();
      setSlots(response.data || []);
    } catch (err: any) {
      setSlots([]);
      setSlotsError(extractErrorMessage(err, 'Could not load time slots. Please try again.'));
    } finally {
      setIsLoadingSlots(false);
    }
  }, []);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const labelOf = (id: string | null) =>
    (id && slots.find((slot) => slot.id === id)?.label) || null;

  const pickupLabel = labelOf(pickupTimeSlot);
  const deliveryLabel = labelOf(deliveryTimeSlot);
  const isReady = Boolean(selectedDate && pickupTimeSlot && deliveryTimeSlot);

  /** "Today" / "Tomorrow" / the weekday, above the date. */
  const dayCaption = (key: string, index: number) => {
    if (index === 0) return 'Today';
    if (index === 1) return 'Tomorrow';
    return parseDateKey(key).toLocaleDateString(undefined, { weekday: 'short' });
  };

  /** "21 Aug" — the date under the caption. */
  const dayLabel = (key: string) => {
    const date = parseDateKey(key);
    return `${date.getDate()} ${date.toLocaleDateString(undefined, { month: 'short' })}`;
  };

  /**
   * Places the order with the day and both slots. The three checks below are
   * the ones the page promises; the server enforces the same three, so a
   * request that skipped this screen is refused too.
   */
  const handleContinue = async () => {
    if (isPlacingOrder) return;

    if (!selectedDate) {
      setError(DAY_REQUIRED_MESSAGE);
      return;
    }
    if (!pickupTimeSlot) {
      setError(PICKUP_TIME_REQUIRED_MESSAGE);
      return;
    }
    if (!deliveryTimeSlot) {
      setError(DELIVERY_TIME_REQUIRED_MESSAGE);
      return;
    }

    try {
      setError('');
      const order = await confirmOrder({
        pickupDate: selectedDate,
        pickupSlot: pickupTimeSlot,
        deliverySlot: deliveryTimeSlot,
        // Both optional: an empty note is simply not stored.
        pickupNotes: pickupNotes.trim(),
        serviceNotes: serviceNotes.trim(),
      });
      setPlacedOrder({
        number: order.order_number,
        date: formatLongDate(order.pickup?.date || selectedDate),
        pickup: order.pickup?.slot_label || pickupLabel || '',
        delivery: order.delivery?.slot_label || deliveryLabel || '',
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to place order');
    }
  };

  /**
   * One slot list, used for both pickup and delivery.
   *
   * The times sit side by side and wrap onto the next line, so a whole
   * afternoon is visible at a glance instead of costing five rows of
   * scrolling. Each pill is still a 48pt target.
   */
  const slotList = (
    heading: string,
    selected: string | null,
    onSelect: (id: string) => void
  ) => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {heading} <Text style={styles.required}>*</Text>
      </Text>

      <View style={styles.slotWrap}>
        {slots.map((slot) => {
          const isSelected = selected === slot.id;
          return (
            <TouchableOpacity
              key={`${heading}-${slot.id}`}
              style={[styles.slotPill, isSelected && styles.slotPillSelected]}
              onPress={() => {
                onSelect(slot.id);
                setError('');
              }}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${heading}: ${slot.label}`}
            >
              <Text style={[styles.slotText, isSelected && styles.slotTextSelected]}>
                {slot.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  /** The two optional note boxes, shown with the slots they belong to. */
  const notesSection = (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Pickup And Drop Notes</Text>
      <TextInput
        style={styles.noteInput}
        value={pickupNotes}
        onChangeText={setPickupNotes}
        placeholder="Type Instruction"
        placeholderTextColor={COLORS.TextSecondary}
        multiline
        maxLength={500}
        textAlignVertical="top"
        accessibilityLabel="Pickup and drop notes"
      />

      <Text style={[styles.cardTitle, styles.noteHeadingSpacing]}>Laundry service Notes</Text>
      <TextInput
        style={styles.noteInput}
        value={serviceNotes}
        onChangeText={setServiceNotes}
        placeholder="Type Instruction"
        placeholderTextColor={COLORS.TextSecondary}
        multiline
        maxLength={500}
        textAlignVertical="top"
        accessibilityLabel="Laundry service notes"
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back to cart"
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.PrimaryDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Time Slot</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Step one: the day. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Choose your preferred day <Text style={styles.required}>*</Text>
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayStrip}
          >
            {days.map((key, index) => {
              const isSelected = key === selectedDate;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.dayCell, isSelected && styles.dayCellSelected]}
                  onPress={() => {
                    setSelectedDate(key);
                    setError('');
                  }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={formatLongDate(key)}
                >
                  <Text style={[styles.dayCaption, isSelected && styles.dayTextSelected]}>
                    {dayCaption(key, index)}
                  </Text>
                  <Text style={[styles.dayDate, isSelected && styles.dayTextSelected]}>
                    {dayLabel(key)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Steps two and three appear only once a day has been chosen. */}
        {!selectedDate ? (
          <View style={styles.hintBlock}>
            <Ionicons name="calendar-outline" size={36} color={COLORS.TextSecondary} />
            <Text style={styles.hintText}>Select a day to see the available times.</Text>
          </View>
        ) : isLoadingSlots ? (
          <View style={styles.hintBlock}>
            <ActivityIndicator size="large" color={COLORS.Primary} />
            <Text style={styles.hintText}>Loading time slots...</Text>
          </View>
        ) : slotsError ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>{slotsError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={loadSlots} activeOpacity={0.85}>
              <Ionicons name="refresh" size={16} color={COLORS.Surface} />
              <Text style={styles.retryText}>RETRY</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {slotList('Pickup Time', pickupTimeSlot, setPickupTimeSlot)}
            {slotList('Delivery Time', deliveryTimeSlot, setDeliveryTimeSlot)}
            {notesSection}

            {/* What is about to be booked, in the order it was chosen. */}
            <View style={styles.summaryCard}>
              <SummaryLine label="Selected Date" value={formatLongDate(selectedDate)} />
              <SummaryLine label="Pickup" value={pickupLabel} />
              <SummaryLine label="Delivery" value={deliveryLabel} />
              <SummaryLine
                label="Items"
                value={cart?.items?.length ? String(cart.items.length) : '0'}
              />
            </View>
          </>
        )}

        {error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={18} color={COLORS.Error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueButton, (!isReady || isPlacingOrder) && styles.buttonDisabled]}
          onPress={handleContinue}
          /* Disabled for the whole round trip, so a second tap cannot send a
             second order. */
          disabled={isPlacingOrder}
          activeOpacity={0.85}
        >
          {isPlacingOrder ? (
            <>
              <ActivityIndicator size="small" color={COLORS.Surface} />
              <Text style={styles.continueText}>Placing Order...</Text>
            </>
          ) : (
            <>
              <Text style={styles.continueText}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color={COLORS.Surface} />
            </>
          )}
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>

      {/* The existing branded confirmation, now shown from here. */}
      <OrderConfirmationModal
        visible={Boolean(placedOrder)}
        orderNumber={placedOrder?.number || ''}
        pickupDate={placedOrder?.date}
        pickupSlot={placedOrder?.pickup}
        deliverySlot={placedOrder?.delivery}
        onViewOrders={() => {
          setPlacedOrder(null);
          navigation.navigate('BusinessOrders');
        }}
        onClose={() => {
          setPlacedOrder(null);
          // The cart is empty now, so there is nothing to come back to.
          navigation.goBack();
        }}
      />
    </SafeAreaView>
  );
}

function SummaryLine({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, !value && styles.summaryValueMissing]}>
        {value || 'Not selected'}
      </Text>
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
    backgroundColor: COLORS.Background,
  },
  headerTitle: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
  },

  content: { padding: SPACING.md, paddingBottom: SPACING.xl },

  card: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.Border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  cardTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.TextPrimary,
    marginBottom: SPACING.sm,
  },
  required: { color: COLORS.Error },

  // ---- Day strip ----
  dayStrip: { gap: SPACING.sm, paddingRight: SPACING.sm },
  dayCell: {
    minWidth: 84,
    minHeight: 68,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.Border,
    backgroundColor: COLORS.Surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayCellSelected: { backgroundColor: COLORS.Primary, borderColor: COLORS.PrimaryDark },
  dayCaption: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
    color: COLORS.TextSecondary,
  },
  dayDate: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.TextPrimary,
  },
  dayTextSelected: { color: COLORS.Surface },

  // ---- Slot pills, laid out horizontally and wrapping ----
  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  slotPill: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.Border,
    backgroundColor: COLORS.Surface,
  },
  slotPillSelected: { borderColor: COLORS.Primary, backgroundColor: '#F1F9F4' },
  slotText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
  },
  slotTextSelected: { fontWeight: '800', color: COLORS.PrimaryDark },

  // ---- Notes ----
  noteInput: {
    minHeight: 96,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Border,
    backgroundColor: COLORS.Background,
    padding: SPACING.md,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
  },
  noteHeadingSpacing: { marginTop: SPACING.md },

  // ---- Summary ----
  summaryCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.Primary,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  summaryLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  summaryValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  summaryValueMissing: { color: COLORS.Error },

  // ---- States ----
  hintBlock: { alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xl },
  hintText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    textAlign: 'center',
  },
  errorBlock: {
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: '#FDECEC',
    marginBottom: SPACING.md,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: '#FDECEC',
  },
  errorText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.Error,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    minHeight: 40,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
  },
  retryText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },

  // ---- Footer ----
  footer: {
    padding: SPACING.md,
    backgroundColor: COLORS.Surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.Border,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 56,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
  },
  buttonDisabled: { opacity: 0.5 },
  continueText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },
});
