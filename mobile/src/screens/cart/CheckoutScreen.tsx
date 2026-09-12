import React, { useCallback, useEffect, useState } from 'react';
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
  DeliveryQuote,
  CUSTOMER_PAYMENT_METHODS,
  CustomerPaymentMethod,
} from '../../services/customerCartApi';
import { addressApi, AddressData } from '../../services/addressApi';
import { detectCurrentAddress } from '../../services/currentLocation';

/**
 * CHECKOUT — the last step before an order exists.
 *
 * WHAT AN ORDER NEEDS, and why each is asked for here:
 *
 *   ADDRESS      where the laundry is collected -- and what the delivery
 *                charge is measured from. EITHER a saved address OR one
 *                typed for this order alone; see "TWO WAYS TO SAY WHERE"
 *                below.
 *   PAYMENT      validated against the `orders.payment_method` ENUM.
 *   LOCATION     `POST /api/orders` sits behind `requireServiceArea` and
 *                answers 428 without coordinates. The one input nobody types.
 *
 * ============================================================
 * THE PICKUP IS NOT ASKED FOR ANY MORE
 * ============================================================
 *
 * This screen used to carry a pickup DAY and a pickup TIME, and would not let
 * the order be placed until both were chosen. Both are gone, along with the
 * validation behind them.
 *
 * A customer choosing a collection window was choosing something NOBODY HAD
 * AGREED TO: the order goes to a Manager, who approves it and names the
 * collection. So the flow is now
 *
 *     customer books  ->  Manager approves  ->  Manager assigns the pickup
 *                     ->  the customer is told, and sees it on the order
 *
 * and the time the customer sees is one somebody has actually committed to.
 * `PickupScheduleCard` on the tracker shows it the moment it is assigned, and
 * a push notification announces it.
 *
 * THE SERVER STILL WRITES A `pickups` ROW, with a placeholder of its own
 * (`pickupSlot.provisionalPickup`), because the rider's job and several
 * reports read that table. Nothing displays it, and
 * `orders.assigned_pickup_date` — the column every screen actually tests —
 * stays NULL until the Manager decides.
 *
 * ============================================================
 * TWO WAYS TO SAY WHERE
 * ============================================================
 *
 *   SAVED     pick one of the account's addresses. `address_id`, as before.
 *
 *   MANUAL    type one for this order. It is sent as `manual_address` and
 *             stored ON THE ORDER, not in the address book — so a one-off
 *             address does not become an entry the customer has to tidy up,
 *             and an order placed to one cannot lose its address later when
 *             the address book is edited.
 *
 * They are MUTUALLY EXCLUSIVE, and the server refuses an order carrying both.
 * The mode below is what makes that true here: switching to manual clears the
 * selected id, and choosing a saved address leaves manual mode.
 *
 * NO ARITHMETIC HERE. Every figure is the server's, and the order is priced
 * again when it is created, so this screen cannot make the total disagree
 * with the bill.
 */

/** Which of the two ways the customer is using to give an address. */
type AddressMode = 'SAVED' | 'MANUAL';

/*
 * `DayPicker` and `SlotPicker` used to live here, one for the pickup day and
 * one for the pickup window. Both are gone with the pickers they drew — the
 * customer chooses neither now. `DateStrip` and `TimeSlotRow`, the components
 * the rest of the app uses for the same job, are untouched.
 */

export default function CheckoutScreen({ navigation }: any) {
  const [cart, setCart] = useState<CustomerCart | null>(null);
  const [addresses, setAddresses] = useState<AddressData[]>([]);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);

  const [addressId, setAddressId] = useState('');
  const [payment, setPayment] = useState<CustomerPaymentMethod>('CASH_ON_DELIVERY');
  const [notes, setNotes] = useState('');

  /*
   * WHICH WAY THE ADDRESS IS BEING GIVEN.
   *
   * One piece of state rather than a flag per form, because the two ways are
   * exclusive and the server refuses an order that carries both. Everything
   * that reads the address — the blocker, the quote, the order body — asks
   * this first, so there is one place the exclusivity is decided.
   */
  const [addressMode, setAddressMode] = useState<AddressMode>('SAVED');

  /*
   * THE TYPED ADDRESS.
   *
   * These fields used to back an "add an address" form that SAVED to the
   * address book and then selected the new row. They now back Enter Address
   * Manually, which sends the address WITH THE ORDER and saves nothing — see
   * the note at the top of this file. The three required ones are checked
   * here and again on the server.
   */
  const [manualLine, setManualLine] = useState('');
  const [manualLandmark, setManualLandmark] = useState('');
  const [manualCity, setManualCity] = useState('');
  const [manualPincode, setManualPincode] = useState('');
  const [manualContactName, setManualContactName] = useState('');
  const [manualContactMobile, setManualContactMobile] = useState('');
  /** The fix from "Use my current location", when it was used. */
  const [detectedCoords, setDetectedCoords] =
    useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState('');

  /** Fills the form below from the phone's position. Same helper the Address
      screen uses, so the two behave identically. */
  const useCurrentLocation = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    setLocationNote('');
    setError('');
    const result = await detectCurrentAddress();
    if (!result.ok) {
      setLocationNote(result.message);
      setLocating(false);
      return;
    }
    const found = result.address;
    // Only empty fields: anything already typed is the customer's own.
    setManualLine((current) => current || found.full_address);
    setManualCity((current) => current || found.city);
    setManualPincode((current) => current || found.pincode);
    /*
     * THE POINT IS KEPT, AND IT TRAVELS WITH THE ORDER.
     *
     * The delivery charge is measured from where the laundry is collected,
     * and a typed address has no coordinates of its own unless this button
     * gave it some. Sending them means a manual address is charged from the
     * place the customer pointed at rather than from wherever the handset
     * happened to be when Book Order was tapped.
     */
    setDetectedCoords({ latitude: found.latitude, longitude: found.longitude });
    setLocationNote(
      found.full_address || found.city
        ? 'Location detected. Check the address and edit anything that is wrong.'
        : 'Location captured, but we could not name the street. Please type the address.'
    );
    setLocating(false);
  }, [locating]);

  /**
   * Back to the saved addresses, with one actually selected.
   *
   * Switching to MANUAL clears `addressId` — that is what makes the two modes
   * exclusive — so coming back has to choose one again, or the customer lands
   * on a list with nothing selected and a button that will not light up. The
   * default address, falling back to the first, which is the same preference
   * `loadAddresses` applies at load.
   */
  const useSavedAddresses = useCallback(() => {
    setAddressMode('SAVED');
    setAddressId((current) => {
      if (current) return current;
      const preferred = addresses.find((a) => a.is_default) ?? addresses[0];
      return preferred?.id ? String(preferred.id) : '';
    });
  }, [addresses]);

  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

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
        const list = await loadAddresses();
        if (!alive) return;
        /*
         * AN ACCOUNT WITH NO SAVED ADDRESS STARTS IN THE FORM.
         *
         * It has nothing to choose from, and landing on an empty picker with
         * a disabled button is the dead end this screen used to have. The
         * customer can still switch back once they save one elsewhere.
         */
        if (list.length === 0) setAddressMode('MANUAL');
      } catch (e: any) {
        if (alive) setError(e?.response?.data?.message || e.message || 'Could not load checkout');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [loadAddresses]);

  /*
   * The delivery charge follows the ADDRESS, so it is re-quoted whenever the
   * address changes rather than read once at load.
   *
   * A TYPED ADDRESS CANNOT BE QUOTED FROM HERE. `GET /api/orders/delivery-quote`
   * takes a saved address id, and an address that has not been saved has
   * none. The quote is cleared rather than left showing the previous
   * address's figure — the bill then says the charge is worked out once we
   * know where to collect from, which is the truth, and the SERVER computes
   * the real charge when the order is created either way.
   */
  useEffect(() => {
    if (addressMode === 'MANUAL' || !addressId) { setQuote(null); return; }
    let alive = true;
    customerOrderApi
      .getDeliveryQuote(addressId)
      .then((q) => { if (alive) setQuote(q); })
      .catch(() => { if (alive) setQuote(null); });
    return () => { alive = false; };
  }, [addressId, addressMode]);

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

  /*
   * WHAT A TYPED ADDRESS MUST HAVE, checked as the customer types.
   *
   * The same three fields the server requires, and they are required for the
   * same reasons: a rider cannot be sent to a city, the city is on every
   * label, and the PIN is the one field that is checkable. The PIN pattern is
   * the server's — six digits not starting with zero, because there is no
   * postal region 0.
   *
   * SHOWN AS A BLOCKER, NOT AS AN ERROR. The customer is told what is still
   * missing while they fill the form in, rather than after they tap a button
   * that then refuses them.
   */
  const manualBlocker = (): string => {
    if (manualLine.trim().length < 5) return 'Enter the flat, building or street.';
    if (!manualCity.trim()) return 'Enter the city.';
    if (!/^[1-9][0-9]{5}$/.test(manualPincode.trim())) return 'Enter a valid 6-digit PIN code.';
    const mobile = manualContactMobile.trim().replace(/[\s-]/g, '').replace(/^(\+?91)/, '');
    // Optional — but a WRONG number is worse than none: the rider rings it,
    // gets nobody, and never thinks to try the account's own number.
    if (mobile && !/^[6-9][0-9]{9}$/.test(mobile)) {
      return 'Enter a valid 10-digit contact number, or leave it blank.';
    }
    return '';
  };

  const blocker =
    !cart || cart.items.length === 0 ? 'Your cart is empty.'
      : unpriced.length > 0 ? 'An item in your cart no longer has a price. Remove it to continue.'
      : addressMode === 'MANUAL' ? manualBlocker()
      : !addressId ? 'Add a pickup address to continue.'
      : '';

  /*
   * THERE IS NO "SAVE ADDRESS" STEP ANY MORE.
   *
   * This screen used to POST the typed address to `/api/addresses`, wait for
   * the new row, and then select it — so booking to a one-off address left an
   * entry in the customer's address book, and a network failure halfway
   * through left them with an address and no order.
   *
   * The address now travels WITH the order in one request. Nothing is saved,
   * nothing to undo, and one thing to fail instead of two. Adding a permanent
   * address is still the Addresses screen's job, where it belongs.
   */

  /* -------------------------------------------------------------- place */
  const placeOrder = useCallback(async () => {
    if (placing || blocker) return;
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
        /*
         * ONE OF THE TWO, NEVER BOTH. The server refuses an order that
         * carries a saved address id and a typed address together — two
         * answers to "where do I send the rider?" — so the mode decides
         * which key is present rather than both being sent and one ignored.
         */
        ...(addressMode === 'MANUAL'
          ? {
              manual_address: {
                address_line: manualLine.trim(),
                city: manualCity.trim(),
                pincode: manualPincode.trim(),
                landmark: manualLandmark.trim() || undefined,
                contact_name: manualContactName.trim() || undefined,
                contact_mobile: manualContactMobile.trim() || undefined,
                /* Only when "Use my current location" gave us one. */
                ...(detectedCoords ?? {}),
              },
            }
          : { address_id: addressId }),
        /*
         * NO PICKUP AND NO DELIVERY ARE SENT.
         *
         * The customer chooses neither, and the server writes its own
         * placeholder into the `pickups` row for the readers that need one.
         * The real collection is the Manager's to assign on approval.
         */
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
        /*
         * NO pickupLabel. There is no pickup to name yet — a Manager assigns
         * it after approving the order, and the confirmation screen says so
         * rather than printing a placeholder the customer would read as an
         * appointment.
         */
      });
    } catch (e: any) {
      // The server owns validation; its wording is shown as-is so the two
      // can never state different reasons.
      setError(e?.response?.data?.message || e.message || 'Your order could not be placed.');
    } finally {
      setPlacing(false);
    }
  }, [
    placing, blocker, addressMode, addressId,
    manualLine, manualCity, manualPincode, manualLandmark,
    manualContactName, manualContactMobile, detectedCoords,
    payment, notes, navigation,
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
          {/*
            THE SAVED ADDRESSES. Choosing one leaves manual mode, which is
            what keeps the two exclusive without a second flag to forget.
          */}
          {addressMode === 'SAVED' && addresses.map((option, index) => {
            const on = String(option.id) === addressId;
            return (
              <TouchableOpacity
                key={String(option.id)}
                style={[styles.pickRow, index > 0 && styles.divided]}
                onPress={() => { setAddressMode('SAVED'); setAddressId(String(option.id)); }}
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
                    {option.is_default ? '  \u00b7  Default' : ''}
                  </Text>
                  <Text style={styles.pickMeta} numberOfLines={2}>{option.full_address}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {addressMode === 'MANUAL' ? (
            <View style={[addresses.length > 0 && styles.divided, { paddingVertical: SPACING.sm }]}>
              {/* The shortcut past the fields. Typing below is untouched. */}
              <TouchableOpacity
                style={styles.locateBtn}
                onPress={useCurrentLocation}
                disabled={locating}
                accessibilityRole="button"
                accessibilityLabel="Use my current location to fill in this address"
                accessibilityState={{ disabled: locating }}
              >
                {locating
                  ? <ActivityIndicator size="small" color={C.Primary} />
                  : <Ionicons name="locate-outline" size={18} color={C.Primary} />}
                <Text style={styles.locateBtnText}>
                  {locating ? 'Finding you\u2026' : 'Use My Current Location'}
                </Text>
              </TouchableOpacity>
              {!!locationNote && <Text style={styles.locateNote}>{locationNote}</Text>}

              {/* REQUIRED. The blocker under the Book Order button names
                  whichever of these is still missing, so the asterisks are a
                  reminder rather than the only signal. */}
              <TextInput
                style={styles.input}
                placeholder="Flat / building / street *"
                placeholderTextColor={C.TextSecondary}
                value={manualLine}
                onChangeText={setManualLine}
                accessibilityLabel="Flat, building or street. Required."
              />
              <TextInput
                style={styles.input}
                placeholder="Landmark (optional)"
                placeholderTextColor={C.TextSecondary}
                value={manualLandmark}
                onChangeText={setManualLandmark}
                accessibilityLabel="Landmark. Optional."
              />
              <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="City *"
                  placeholderTextColor={C.TextSecondary}
                  value={manualCity}
                  onChangeText={setManualCity}
                  accessibilityLabel="City. Required."
                />
                <TextInput
                  style={[styles.input, { width: 110 }]}
                  placeholder="PIN *"
                  placeholderTextColor={C.TextSecondary}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={manualPincode}
                  onChangeText={setManualPincode}
                  accessibilityLabel="PIN code. Required, six digits."
                />
              </View>

              {/*
                WHO THE RIDER ASKS FOR, when it is not the person who booked.
                Optional, because a manual address is often still the
                customer's own -- dispatch falls back to the account's name
                and number when these are blank.
              */}
              <Text style={styles.formHint}>
                Someone else meeting the rider? Leave blank to use your own details.
              </Text>
              <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="Contact name (optional)"
                  placeholderTextColor={C.TextSecondary}
                  value={manualContactName}
                  onChangeText={setManualContactName}
                  accessibilityLabel="Contact name at this address. Optional."
                />
                <TextInput
                  style={[styles.input, { width: 140 }]}
                  placeholder="Mobile"
                  placeholderTextColor={C.TextSecondary}
                  keyboardType="phone-pad"
                  maxLength={13}
                  value={manualContactMobile}
                  onChangeText={setManualContactMobile}
                  accessibilityLabel="Contact mobile number at this address. Optional."
                />
              </View>

              {/* Only offered when there is something to go back to. */}
              {addresses.length > 0 && (
                <TouchableOpacity
                  style={styles.smallBtn}
                  onPress={useSavedAddresses}
                  accessibilityRole="button"
                  accessibilityLabel="Use one of my saved addresses instead"
                >
                  <Text style={styles.smallBtnText}>Use a saved address</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.pickRow, addresses.length > 0 && styles.divided]}
              onPress={() => {
                /* The id is cleared as the mode changes, so the two can never
                   both be set -- the same rule the server enforces. */
                setAddressId('');
                setAddressMode('MANUAL');
              }}
              accessibilityRole="button"
              accessibilityLabel="Enter a pickup address manually"
            >
              <Ionicons name="create-outline" size={20} color={C.Primary} />
              <View style={styles.flex}>
                <Text style={styles.pickTitle}>Enter Address Manually</Text>
                <Text style={styles.pickMeta}>
                  Type where to collect from. Used for this order only.
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/*
          ---- PICKUP: NOT ASKED FOR ----

          The pickup DAY and the pickup TIME used to be chosen here, and the
          order could not be placed without both. Neither is now: a Manager
          assigns the collection when they approve the order, and the customer
          is told the time once somebody has actually committed to it.

          NOTHING IS SENT FOR THEM EITHER. The server writes its own
          placeholder into the pickups row -- see provisionalPickup -- so
          every reader of that table still finds one, while
          orders.assigned_pickup_date stays NULL until the decision is made.

          The DELIVERY leg was already not asked for, for the same reason.

          THE NOTICE BELOW IS NOT DECORATION. Removing a picker without
          replacing it with anything leaves a customer wondering when their
          laundry is being collected, which is the one question this step used
          to answer. It says who decides and that they will be told.
        */}
        <View style={styles.noticeBox}>
          <Ionicons name="information-circle-outline" size={18} color={C.Primary} />
          <Text style={styles.noticeText}>
            We will confirm your pickup date and time once your order is approved,
            and let you know as soon as it is scheduled.
          </Text>
        </View>

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
          {/* There is no pickup to name here any more, so the line says where
              the order is going instead — which is the fact the customer has
              just been asked for and the one worth confirming. */}
          {!blocker && (
            <Text style={styles.barMeta} numberOfLines={1}>
              {addressMode === 'MANUAL'
                ? `${manualLine.trim()}, ${manualCity.trim()}`
                : addresses.find((a) => String(a.id) === addressId)?.full_address ?? ''}
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
  locateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm, borderWidth: 1, borderColor: C.Primary,
    paddingVertical: SPACING.sm, marginBottom: SPACING.xs,
  },
  locateBtnText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700', color: C.Primary,
  },
  locateNote: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: C.TextSecondary, marginBottom: SPACING.xs,
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
  /*
   * `smallBtnPrimary` / `smallBtnPrimaryText` went with the Save address
   * button they styled. The typed address is submitted with the order now,
   * so there is no second primary action on this screen.
   *
   * The day and slot chip styles (`chipRow`, `chipWrap`, `dayChip*`,
   * `slotChip*`) went with the pickers they drew -- the customer chooses
   * neither a day nor a window here any more.
   */

  /** The quiet line above the optional contact fields. */
  formHint: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, color: C.TextSecondary,
    marginTop: SPACING.sm, marginBottom: SPACING.xs,
  },

  /*
   * WHAT REPLACED THE PICKUP PICKER. Deliberately an information panel and
   * not a disabled control: there is nothing here for the customer to do,
   * and a greyed-out picker would read as something they had failed to fill
   * in.
   */
  noticeBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm,
    backgroundColor: C.SurfaceAlt, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: C.Border,
    padding: SPACING.sm, marginTop: SPACING.xs,
  },
  noticeText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: C.TextSecondary, lineHeight: 17,
  },

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
