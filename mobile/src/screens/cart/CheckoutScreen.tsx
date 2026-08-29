import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  CUSTOMER_COLORS as C, SPACING, TYPOGRAPHY, BORDER_RADIUS,
} from '../../constants/theme';
import customerCartApi, {
  CustomerCart,
  customerOrderApi,
  PickupSlotOption,
  DeliveryQuote,
  CUSTOMER_PAYMENT_METHODS,
  CustomerPaymentMethod,
} from '../../services/customerCartApi';
import { addressApi, AddressData } from '../../services/addressApi';

/**
 * CHECKOUT — the last step before an order exists.
 *
 * THIS SCREEN WAS A MOCKUP: a hardcoded item list, `totalEstimatedPay = 42.00`
 * from nowhere, a pickup date written into the JSX, and a Book Order button
 * whose handler was `console.log('Book Order')`.
 *
 * WHAT AN ORDER NEEDS, and why each is asked for here:
 *
 *   ADDRESS      where the laundry is collected -- and what the delivery
 *                charge is measured from.
 *   PICKUP       a day and a window; they become the `pickups` row.
 *   DELIVERY     a day and a window, optional; they become the `deliveries`
 *                row. Always LATER than the pickup, because the laundry has
 *                to be washed in between.
 *   PAYMENT      validated against the `orders.payment_method` ENUM.
 *   LOCATION     `POST /api/orders` sits behind `requireServiceArea` and
 *                answers 428 without coordinates. The one input nobody types.
 *
 * NO ARITHMETIC HERE. Every figure is the server's, and the order is priced
 * again when it is created, so this screen cannot make the total disagree
 * with the bill.
 */

/** How many days ahead a pickup can be booked. Today counts as day one. */
const BOOKABLE_DAYS = 5;

/** How far past the pickup a delivery can be scheduled. */
const DELIVERY_WINDOW_DAYS = 6;

/** YYYY-MM-DD in the device's own calendar, which is what the API expects. */
function ymd(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(from: Date, count: number): Date {
  const next = new Date(from);
  next.setDate(from.getDate() + count);
  return next;
}

function shortDate(date: Date): string {
  return `${date.getDate()} ${date.toLocaleDateString(undefined, { month: 'short' })}`;
}

/** A row of day chips, used for both legs. */
function DayPicker({
  days, value, onChange,
}: {
  days: Array<{ value: string; label: string; date: Date }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.chipRow}>
        {days.map((day) => {
          const on = day.value === value;
          return (
            <TouchableOpacity
              key={day.value}
              style={[styles.dayChip, on && styles.dayChipOn]}
              onPress={() => onChange(day.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${day.label} ${shortDate(day.date)}`}
            >
              <Text style={[styles.dayChipLabel, on && styles.dayChipLabelOn]}>{day.label}</Text>
              <Text style={[styles.dayChipDate, on && styles.dayChipDateOn]}>
                {shortDate(day.date)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** A wrap of slot chips. Unavailable windows are shown, struck through. */
function SlotPicker({
  slots, value, onChange, emptyText,
}: {
  slots: PickupSlotOption[];
  value: string;
  onChange: (value: string) => void;
  emptyText: string;
}) {
  if (slots.length === 0 || slots.every((s) => !s.available)) {
    return <Text style={styles.muted}>{emptyText}</Text>;
  }
  return (
    <View style={styles.chipWrap}>
      {slots.map((option) => {
        const on = option.id === value;
        return (
          <TouchableOpacity
            key={option.id}
            style={[
              styles.slotChip,
              on && styles.slotChipOn,
              !option.available && styles.slotChipOff,
            ]}
            disabled={!option.available}
            onPress={() => onChange(option.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !option.available }}
          >
            <Text
              style={[
                styles.slotChipText,
                on && styles.slotChipTextOn,
                !option.available && styles.slotChipTextOff,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function CheckoutScreen({ navigation }: any) {
  const [cart, setCart] = useState<CustomerCart | null>(null);
  const [addresses, setAddresses] = useState<AddressData[]>([]);
  const [pickupSlots, setPickupSlots] = useState<PickupSlotOption[]>([]);
  const [deliverySlots, setDeliverySlots] = useState<PickupSlotOption[]>([]);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);

  const [addressId, setAddressId] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [pickupSlotId, setPickupSlotId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliverySlotId, setDeliverySlotId] = useState('');
  const [payment, setPayment] = useState<CustomerPaymentMethod>('CASH_ON_DELIVERY');
  const [notes, setNotes] = useState('');

  /* The inline address form. Checkout used to dead-end for an account with
     no saved address — the button simply stayed off with nowhere to go. */
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newPincode, setNewPincode] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  const today = useMemo(() => new Date(), []);

  const pickupDays = useMemo(
    () => Array.from({ length: BOOKABLE_DAYS }, (_, index) => {
      const date = addDays(today, index);
      return {
        value: ymd(date),
        label: index === 0 ? 'Today' : index === 1 ? 'Tomorrow'
          : date.toLocaleDateString(undefined, { weekday: 'short' }),
        date,
      };
    }),
    [today]
  );

  /*
   * DELIVERY DAYS START THE DAY AFTER THE PICKUP.
   *
   * Same-day is not offered because the laundry has to be washed between the
   * two, and a delivery booked before its own pickup is not a thing the
   * schedule can mean.
   */
  const deliveryDays = useMemo(() => {
    if (!pickupDate) return [];
    const [year, month, day] = pickupDate.split('-').map(Number);
    const pickup = new Date(year, month - 1, day);
    return Array.from({ length: DELIVERY_WINDOW_DAYS }, (_, index) => {
      const date = addDays(pickup, index + 1);
      return {
        value: ymd(date),
        label: index === 0 ? 'Next day'
          : date.toLocaleDateString(undefined, { weekday: 'short' }),
        date,
      };
    });
  }, [pickupDate]);

  /* ---------------------------------------------------------------- load */
  const loadAddresses = useCallback(async (selectId?: string) => {
    const response = await addressApi.getAddresses();
    const list = response.data ?? [];
    setAddresses(list);
    const preferred =
      (selectId && list.find((a) => String(a.id) === selectId)) ||
      list.find((a) => a.is_default) ||
      list[0];
    if (preferred?.id) setAddressId(String(preferred.id));
    return list;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const loadedCart = await customerCartApi.getCart();
        if (!alive) return;
        setCart(loadedCart);
        await loadAddresses();
        if (!alive) return;
        setPickupDate(pickupDays[0].value);
      } catch (e: any) {
        if (alive) setError(e?.response?.data?.message || e.message || 'Could not load checkout');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [pickupDays, loadAddresses]);

  /* Slots depend on the day: a window that has already begun today is not
     bookable, and the server decides which those are. */
  const loadSlots = useCallback(async (
    date: string,
    apply: (slots: PickupSlotOption[]) => void,
    keep: (id: string) => void,
    current: string
  ) => {
    try {
      const list = await customerOrderApi.getPickupSlots(date);
      apply(list);
      const stillOpen = list.find((s) => s.id === current && s.available);
      keep(stillOpen ? current : (list.find((s) => s.available)?.id ?? ''));
    } catch (e: any) {
      apply([]);
      keep('');
      /* Said out loud rather than left as an empty list: an empty picker with
         no explanation looks like "fully booked" when it is a failed call. */
      setError(
        e?.response?.data?.message ||
        'Pickup times could not be loaded. Check your connection and try again.'
      );
    }
  }, []);

  useEffect(() => {
    if (!pickupDate) return;
    loadSlots(pickupDate, setPickupSlots, setPickupSlotId, pickupSlotId);
    // Keep the delivery on the first available day after the new pickup.
    setDeliveryDate((current) => {
      const options = deliveryDays.map((d) => d.value);
      return options.includes(current) ? current : (options[0] ?? '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupDate]);

  useEffect(() => {
    if (!deliveryDate) { setDeliverySlots([]); setDeliverySlotId(''); return; }
    loadSlots(deliveryDate, setDeliverySlots, setDeliverySlotId, deliverySlotId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryDate]);

  /* The delivery charge follows the ADDRESS, so it is re-quoted whenever the
     address changes rather than read once at load. */
  useEffect(() => {
    if (!addressId) { setQuote(null); return; }
    let alive = true;
    customerOrderApi
      .getDeliveryQuote(addressId)
      .then((q) => { if (alive) setQuote(q); })
      .catch(() => { if (alive) setQuote(null); });
    return () => { alive = false; };
  }, [addressId]);

  const pickupSlot = pickupSlots.find((s) => s.id === pickupSlotId) ?? null;
  const deliverySlot = deliverySlots.find((s) => s.id === deliverySlotId) ?? null;

  /*
   * THE TOTAL SHOWN HERE USES THE QUOTE, not the cart's delivery line.
   *
   * The cart quotes against the DEFAULT address; this screen may have a
   * different one selected, and the order will be billed on the selected one.
   * Using the cart's figure would show a total the order then contradicts.
   */
  const subtotal = Number(cart?.subtotal ?? 0);
  const delivery = quote?.resolved ? quote.charge : Number(cart?.delivery_charge ?? 0);
  const total = subtotal + delivery;

  const unpriced = (cart?.items ?? []).filter((line) => line.price === null);

  const blocker =
    !cart || cart.items.length === 0 ? 'Your cart is empty.'
      : unpriced.length > 0 ? 'An item in your cart no longer has a price. Remove it to continue.'
      : !addressId ? 'Add a pickup address to continue.'
      : !pickupSlot ? 'Choose a pickup time.'
      : '';

  /* ------------------------------------------------------ add an address */
  const saveAddress = useCallback(async () => {
    if (savingAddress) return;
    if (!newAddress.trim() || !newCity.trim()) {
      setError('The address and the city are both needed.');
      return;
    }
    setSavingAddress(true);
    setError('');
    try {
      /*
       * The address is saved WITH COORDINATES where the phone can supply
       * them, because the delivery charge is measured from them. Without
       * them the order falls back to the device fix taken at booking.
       */
      let coords: { latitude?: number; longitude?: number } = {};
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.granted) {
        const position = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
        if (position) {
          coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
        }
      }

      const created = await addressApi.addAddress({
        address_label: 'Home',
        full_address: newAddress.trim(),
        city: newCity.trim(),
        state: 'Maharashtra',
        pincode: newPincode.trim(),
        ...coords,
      } as any);

      await loadAddresses(String(created.data?.id ?? ''));
      setAddingAddress(false);
      setNewAddress('');
      setNewCity('');
      setNewPincode('');
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'That address could not be saved.');
    } finally {
      setSavingAddress(false);
    }
  }, [savingAddress, newAddress, newCity, newPincode, loadAddresses]);

  /* -------------------------------------------------------------- place */
  const placeOrder = useCallback(async () => {
    if (placing || blocker || !pickupSlot) return;
    setPlacing(true);
    setError('');
    try {
      /*
       * THE DEVICE'S OWN FIX, taken here rather than remembered from
       * sign-in: the service-area check is about where the laundry is being
       * collected from now.
       */
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setError(
          'Location permission is needed to place an order, so we can check we deliver to you.'
        );
        return;
      }
      const position =
        (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      if (!position) {
        setError('Your location could not be found. Please move to an open area and try again.');
        return;
      }

      const order = await customerOrderApi.placeOrder({
        address_id: addressId,
        pickup_date: pickupDate,
        // The slot's own TIME values, sent back unparsed.
        pickup_slot_start: pickupSlot.start,
        pickup_slot_end: pickupSlot.end,
        /* All three delivery fields go together or none do — the server only
           writes the `deliveries` row when it has the day and both ends. */
        ...(deliverySlot && deliveryDate
          ? {
              delivery_date: deliveryDate,
              delivery_slot_start: deliverySlot.start,
              delivery_slot_end: deliverySlot.end,
            }
          : {}),
        payment_method: payment,
        notes: notes.trim() || undefined,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: typeof position.coords.accuracy === 'number'
          ? position.coords.accuracy
          : undefined,
      });

      /* The cart is emptied by the server in the same transaction. Replace
         rather than push: Back must not return to a checkout for an order
         that has already been placed. */
      navigation.replace('OrderPlaced', {
        orderId: String(order.id),
        orderNumber: order.order_number,
        total: Number(order.total_amount),
        paymentMethod: payment,
        pickupLabel: `${pickupDays.find((d) => d.value === pickupDate)?.label ?? pickupDate}, ${pickupSlot.label}`,
        deliveryLabel: deliverySlot
          ? `${deliveryDays.find((d) => d.value === deliveryDate)?.label ?? deliveryDate}, ${deliverySlot.label}`
          : '',
      });
    } catch (e: any) {
      // The server owns validation; its wording is shown as-is so the two
      // can never state different reasons.
      setError(e?.response?.data?.message || e.message || 'Your order could not be placed.');
    } finally {
      setPlacing(false);
    }
  }, [
    placing, blocker, pickupSlot, deliverySlot, addressId, pickupDate, deliveryDate,
    payment, notes, pickupDays, deliveryDays, navigation,
  ]);

  /* ---------------------------------------------------------------- view */
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={C.Primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to cart"
        >
          <MaterialIcons name="arrow-back" size={22} color={C.OnPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Summary</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!!error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={18} color={C.Error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ---- ITEMS ---- */}
        <Text style={styles.sectionTitle}>Your items</Text>
        <View style={styles.card}>
          {(cart?.items ?? []).map((line, index) => (
            <View key={line.id} style={[styles.itemRow, index > 0 && styles.divided]}>
              <View style={styles.itemIcon}>
                <Ionicons name="shirt-outline" size={18} color={C.Primary} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.itemName} numberOfLines={2}>{line.service_name}</Text>
                <Text style={styles.itemMeta}>
                  {line.price === null
                    ? 'No price set'
                    : `₹${Number(line.price).toFixed(2)} x ${line.quantity}`}
                </Text>
              </View>
              <Text style={styles.itemTotal}>
                {line.item_total === null ? '—' : `₹${Number(line.item_total).toFixed(2)}`}
              </Text>
            </View>
          ))}
        </View>

        {/* ---- ADDRESS ---- */}
        <Text style={styles.sectionTitle}>Pickup address</Text>
        <View style={styles.card}>
          {addresses.map((option, index) => {
            const on = String(option.id) === addressId;
            return (
              <TouchableOpacity
                key={String(option.id)}
                style={[styles.pickRow, index > 0 && styles.divided]}
                onPress={() => setAddressId(String(option.id))}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={on ? C.Primary : C.TextSecondary}
                />
                <View style={styles.flex}>
                  <Text style={styles.pickTitle}>
                    {option.address_label || 'Address'}
                    {option.is_default ? '  ·  Default' : ''}
                  </Text>
                  <Text style={styles.pickMeta} numberOfLines={2}>{option.full_address}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {addingAddress ? (
            <View style={[addresses.length > 0 && styles.divided, { paddingVertical: SPACING.sm }]}>
              <TextInput
                style={styles.input}
                placeholder="Flat / building / street"
                placeholderTextColor={C.TextSecondary}
                value={newAddress}
                onChangeText={setNewAddress}
                accessibilityLabel="Address"
              />
              <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="City"
                  placeholderTextColor={C.TextSecondary}
                  value={newCity}
                  onChangeText={setNewCity}
                  accessibilityLabel="City"
                />
                <TextInput
                  style={[styles.input, { width: 110 }]}
                  placeholder="PIN"
                  placeholderTextColor={C.TextSecondary}
                  keyboardType="number-pad"
                  value={newPincode}
                  onChangeText={setNewPincode}
                  accessibilityLabel="Pincode"
                />
              </View>
              <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
                <TouchableOpacity
                  style={[styles.smallBtn, styles.smallBtnPrimary]}
                  onPress={saveAddress}
                  disabled={savingAddress}
                  accessibilityRole="button"
                >
                  {savingAddress
                    ? <ActivityIndicator size="small" color={C.OnPrimary} />
                    : <Text style={styles.smallBtnPrimaryText}>Save address</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.smallBtn}
                  onPress={() => setAddingAddress(false)}
                  accessibilityRole="button"
                >
                  <Text style={styles.smallBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.pickRow, addresses.length > 0 && styles.divided]}
              onPress={() => setAddingAddress(true)}
              accessibilityRole="button"
              accessibilityLabel="Add a new pickup address"
            >
              <Ionicons name="add-circle-outline" size={20} color={C.Primary} />
              <Text style={styles.pickTitle}>
                {addresses.length === 0 ? 'Add your pickup address' : 'Use a different address'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ---- PICKUP ---- */}
        <Text style={styles.sectionTitle}>Pickup day</Text>
        <DayPicker days={pickupDays} value={pickupDate} onChange={setPickupDate} />

        <Text style={styles.sectionTitle}>Pickup time</Text>
        <SlotPicker
          slots={pickupSlots}
          value={pickupSlotId}
          onChange={setPickupSlotId}
          emptyText="No pickup window is left on that day. Choose another."
        />

        {/* ---- DELIVERY ---- */}
        <Text style={styles.sectionTitle}>Delivery day</Text>
        <DayPicker days={deliveryDays} value={deliveryDate} onChange={setDeliveryDate} />
        <Text style={styles.hint}>
          Delivery starts the day after collection, so there is time to wash and finish your
          laundry.
        </Text>

        <Text style={styles.sectionTitle}>Delivery time</Text>
        <SlotPicker
          slots={deliverySlots}
          value={deliverySlotId}
          onChange={setDeliverySlotId}
          emptyText="No delivery window on that day. Choose another."
        />

        {/* ---- PAYMENT ---- */}
        <Text style={styles.sectionTitle}>Payment</Text>
        <View style={styles.card}>
          {CUSTOMER_PAYMENT_METHODS.map((method, index) => {
            const on = method.value === payment;
            return (
              <TouchableOpacity
                key={method.value}
                style={[styles.pickRow, index > 0 && styles.divided]}
                onPress={() => setPayment(method.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={on ? C.Primary : C.TextSecondary}
                />
                <Ionicons name={method.icon as any} size={18} color={C.Primary} />
                <Text style={styles.pickTitle}>{method.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ---- NOTES ---- */}
        <Text style={styles.sectionTitle}>Anything we should know?</Text>
        <TextInput
          style={styles.notes}
          placeholder="Gate code, a stain to watch for, delivery preference…"
          placeholderTextColor={C.TextSecondary}
          value={notes}
          onChangeText={setNotes}
          multiline
          accessibilityLabel="Notes for this order"
        />

        {/* ---- THE BILL ---- */}
        <Text style={styles.sectionTitle}>Bill</Text>
        <View style={styles.card}>
          <View style={styles.billRow}>
            <Text style={styles.billLabel}>Items</Text>
            <Text style={styles.billValue}>₹{subtotal.toFixed(2)}</Text>
          </View>
          <View style={styles.billRow}>
            <View style={styles.flex}>
              <Text style={styles.billLabel}>Delivery</Text>
              {/* WHY the figure is what it is. A bare number invites the
                  question this line answers. */}
              <Text style={styles.billHint}>
                {!quote?.resolved
                  ? 'Calculated once we know where to collect from'
                  : quote.charge === 0
                    ? `${quote.distance_km} km away — free within ${quote.free_up_to_km} km`
                    : `${quote.distance_km} km away — ₹${quote.rate_per_km}/km beyond ${quote.free_up_to_km} km`}
              </Text>
            </View>
            <Text style={styles.billValue}>
              {!quote?.resolved ? '—' : delivery === 0 ? 'Free' : `₹${delivery.toFixed(2)}`}
            </Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.billRow}>
            <Text style={[styles.billLabel, styles.billStrong]}>Total</Text>
            <Text style={[styles.billValue, styles.billStrong]}>₹{total.toFixed(2)}</Text>
          </View>
        </View>

        <View style={{ height: 130 }} />
      </ScrollView>

      {/* ---- THE ACTION BAR ---- */}
      <View style={styles.bar}>
        <View style={styles.flex}>
          <Text style={styles.barLabel}>Total</Text>
          <Text style={styles.barValue}>₹{total.toFixed(2)}</Text>
          {!!blocker && !placing && <Text style={styles.blocker}>{blocker}</Text>}
          {!blocker && !!pickupSlot && (
            <Text style={styles.barMeta} numberOfLines={1}>
              {pickupDays.find((d) => d.value === pickupDate)?.label}, {pickupSlot.label}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.bookButton, (!!blocker || placing) && styles.bookButtonOff]}
          disabled={!!blocker || placing}
          onPress={placeOrder}
          accessibilityRole="button"
          accessibilityLabel={blocker || 'Book this order'}
        >
          {placing ? (
            <ActivityIndicator color={C.OnAccent} />
          ) : (
            <>
              <Text style={styles.bookButtonText}>Book Order</Text>
              <MaterialIcons name="arrow-forward" size={18} color={C.OnAccent} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.Background },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  divided: { borderTopWidth: 1, borderTopColor: C.Border },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: C.Primary,
  },
  backButton: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700', color: C.OnPrimary,
  },

  scroll: { padding: SPACING.md },

  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.xs,
    backgroundColor: '#FDECE9', borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm, marginBottom: SPACING.md,
  },
  errorText: {
    flex: 1, color: C.Error, fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
  },

  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700', color: C.PrimaryDark, letterSpacing: 0.3,
    marginTop: SPACING.md, marginBottom: SPACING.xs, textTransform: 'uppercase',
  },
  hint: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: C.TextSecondary, marginTop: SPACING.xs,
  },
  card: {
    backgroundColor: C.Surface, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: C.Border, paddingHorizontal: SPACING.md,
  },
  muted: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: C.TextSecondary,
  },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  itemIcon: {
    width: 34, height: 34, borderRadius: BORDER_RADIUS.sm,
    backgroundColor: C.AccentSoft, alignItems: 'center', justifyContent: 'center',
  },
  itemName: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600', color: C.TextPrimary,
  },
  itemMeta: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: C.TextSecondary, marginTop: 1,
  },
  itemTotal: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700', color: C.PrimaryDark,
  },

  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  pickTitle: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600', color: C.TextPrimary,
  },
  pickMeta: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: C.TextSecondary, marginTop: 1,
  },

  input: {
    backgroundColor: C.Background, borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1, borderColor: C.Border,
    paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm,
    marginBottom: SPACING.xs,
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: C.TextPrimary,
  },
  smallBtn: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm, borderWidth: 1, borderColor: C.Border,
    alignItems: 'center', justifyContent: 'center',
  },
  smallBtnText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600', color: C.TextSecondary,
  },
  smallBtnPrimary: { backgroundColor: C.Primary, borderColor: C.Primary, minWidth: 120 },
  smallBtnPrimaryText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700', color: C.OnPrimary,
  },

  chipRow: { flexDirection: 'row', gap: SPACING.xs, paddingRight: SPACING.md },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  dayChip: {
    minWidth: 78, alignItems: 'center', paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: C.Border,
    backgroundColor: C.Surface,
  },
  dayChipOn: { backgroundColor: C.Primary, borderColor: C.Primary },
  dayChipLabel: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700', color: C.TextPrimary,
  },
  dayChipLabelOn: { color: C.OnPrimary },
  dayChipDate: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, color: C.TextSecondary, marginTop: 1,
  },
  dayChipDateOn: { color: 'rgba(255,255,255,0.85)' },

  slotChip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full, borderWidth: 1, borderColor: C.Border,
    backgroundColor: C.Surface,
  },
  /* The accent marks the ONE selected window. Dark text on it, because
     #ffbd4a does not carry small white type. */
  slotChipOn: { backgroundColor: C.Accent, borderColor: C.AccentDark },
  slotChipOff: { backgroundColor: C.SurfaceAlt, borderColor: C.SurfaceAlt },
  slotChipText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600', color: C.TextPrimary,
  },
  slotChipTextOn: { color: C.OnAccent, fontWeight: '700' },
  slotChipTextOff: { color: C.TextSecondary, textDecorationLine: 'line-through' },

  notes: {
    backgroundColor: C.Surface, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: C.Border, padding: SPACING.sm,
    minHeight: 72, textAlignVertical: 'top',
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: C.TextPrimary,
  },

  billRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: SPACING.xs + 2, gap: SPACING.sm,
  },
  billLabel: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: C.TextSecondary,
  },
  billHint: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, color: C.TextSecondary, marginTop: 1,
  },
  billValue: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: C.TextPrimary,
  },
  billStrong: { fontWeight: '700', color: C.PrimaryDark },
  totalDivider: { height: 1, backgroundColor: C.Border, marginVertical: SPACING.xs },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: C.Surface, borderTopWidth: 1, borderTopColor: C.Border,
    paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.lg,
  },
  barLabel: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: C.TextSecondary,
  },
  barValue: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: '700', color: C.PrimaryDark,
  },
  barMeta: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, color: C.TextSecondary,
  },
  /* The reason the button is off, said plainly next to it rather than left
     to a greyed-out control the customer has to guess about. */
  blocker: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, color: C.Warning,
  },
  bookButton: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: C.Accent, borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.lg, paddingVertical: 14, minWidth: 150,
    justifyContent: 'center',
  },
  bookButtonOff: { backgroundColor: C.SurfaceAlt },
  bookButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700', color: C.OnAccent,
  },
});
