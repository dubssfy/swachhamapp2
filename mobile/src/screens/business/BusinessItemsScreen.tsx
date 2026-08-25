import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Image,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import businessOrderApi, { BusinessItem, LaundryServiceType } from '../../services/businessOrderApi';
import { extractErrorMessage } from '../../services/api';
import {
  useBusinessOrderStore,
  ITEM_SERVICE_REQUIRED_MESSAGE,
} from '../../store/businessOrderStore';

const SERVICE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  wash_iron: 'water-outline',
  dry_clean: 'sparkles-outline',
};

/**
 * Item selection for one category.
 *
 * The cards stay horizontal — artwork on the left, everything else in the
 * column beside it: details and this item's service buttons share the top
 * row, then a typed quantity, then Add to Order.
 *
 * The service is picked per item, never once for the whole order, so Shirt
 * can go to Wash & Iron while Trousers goes to Dry Clean. An item offering a
 * single service has it selected automatically; one offering several must be
 * chosen before it can be added. There is no service filter in the search
 * area: services belong to the item cards only.
 */
export default function BusinessItemsScreen({ navigation, route }: any) {
  const { categoryId, categoryName, parentName } = route.params || {};

  const [items, setItems] = useState<BusinessItem[]>([]);
  const [services, setServices] = useState<LaundryServiceType[]>([]);
  const [search, setSearch] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [addingItemId, setAddingItemId] = useState<string | null>(null);
  /** The item showing its "ADDED" tick, cleared by a timer shortly after. */
  const [addedItemId, setAddedItemId] = useState<string | null>(null);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The service chosen for each item, kept per item id so lines never share one. */
  const [itemServices, setItemServices] = useState<Record<string, string>>({});
  /** Item ids whose Add was blocked because no service was chosen. */
  const [serviceErrors, setServiceErrors] = useState<Record<string, boolean>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { cart, loadCart, addItem } = useBusinessOrderStore();

  /* =================================================================
   * FLY-TO-CART
   *
   * A copy of the item's artwork lifts off the card and arcs into the cart
   * button, shrinking and fading as it goes; the badge then bumps as the
   * count updates. The point is that the ITEM is seen to travel — a spinner
   * says "something is happening", this says "that item went into the order".
   *
   * It is decoration over a real result, never a substitute for one: the
   * flight is started from the card's measured position at the moment of the
   * tap and runs ALONGSIDE the request, and the count comes from the store
   * once the server answers. A failed add leaves no item in the cart no
   * matter what the animation did.
   *
   * `useNativeDriver` throughout — only transform and opacity are animated,
   * so the flight runs on the UI thread and stays smooth while the request
   * is in flight.
   * ================================================================= */

  /** Where the cart button is, measured on layout. */
  const cartButtonRef = useRef<View>(null);
  const cartTarget = useRef<{ x: number; y: number } | null>(null);
  /** One ref per rendered card's artwork, so the flight starts from IT. */
  const artworkRefs = useRef<Map<string, View | null>>(new Map());

  /** The in-flight copy: null when nothing is travelling. */
  const [flight, setFlight] = useState<{
    key: number;
    x: number;
    y: number;
    size: number;
    uri: string | null;
  } | null>(null);
  const flightProgress = useRef(new Animated.Value(0)).current;
  const flightKey = useRef(0);

  /** The badge's bump when the count lands. */
  const badgeScale = useRef(new Animated.Value(1)).current;

  const measureCartButton = useCallback(() => {
    cartButtonRef.current?.measureInWindow((x, y, width, height) => {
      cartTarget.current = { x: x + width / 2, y: y + height / 2 };
    });
  }, []);

  /**
   * Starts the flight for one item. Resolves as soon as it is launched — the
   * caller must not wait for the animation before sending the request, or the
   * feedback would be delayed by exactly the thing it exists to cover.
   */
  const launchFlight = useCallback(
    (item: BusinessItem) => {
      const source = artworkRefs.current.get(item.id);
      const target = cartTarget.current;
      // No measurement means no honest path to draw; the button's own
      // ADDING/ADDED states still give feedback, so this simply does nothing.
      if (!source || !target) return;

      source.measureInWindow((x, y, width, height) => {
        if (!width || !height) return;
        flightKey.current += 1;
        flightProgress.setValue(0);
        setFlight({
          key: flightKey.current,
          x,
          y,
          size: width,
          uri: item.image_url || null,
        });

        Animated.timing(flightProgress, {
          toValue: 1,
          duration: 650,
          // Eases out of the card and into the cart rather than running at a
          // constant speed, which is what makes it read as a throw.
          easing: Easing.bezier(0.4, 0, 0.3, 1),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished) return;
          setFlight(null);
          // The badge bumps as the arriving item is counted.
          Animated.sequence([
            Animated.spring(badgeScale, {
              toValue: 1.45,
              useNativeDriver: true,
              speed: 30,
              bounciness: 14,
            }),
            Animated.spring(badgeScale, { toValue: 1, useNativeDriver: true, speed: 20 }),
          ]).start();
        });

        // Remembered so the interpolations below know where to fly TO.
        flightDestination.current = target;
      });
    },
    [badgeScale, flightProgress]
  );

  const flightDestination = useRef<{ x: number; y: number } | null>(null);

  const cartCount = useMemo(
    () => (cart?.items || []).reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  // Service names come from the catalogue so the per-item buttons can never
  // drift from it. They label the item buttons — there is no service filter.
  useEffect(() => {
    businessOrderApi
      .getLaundryServices()
      .then((response) => setServices(response.data.serviceTypes || []))
      .catch(() => {});
    loadCart().catch(() => {});
  }, [loadCart]);

  const fetchItems = useCallback(
    async (searchText: string) => {
      try {
        setError('');
        setIsLoading(true);
        const response = searchText.trim()
          ? await businessOrderApi.searchItems({ search: searchText.trim(), categoryId })
          : await businessOrderApi.getItemsByCategory(categoryId);
        setItems(response.data);
      } catch (err: any) {
        setError(extractErrorMessage(err, 'Failed to load items'));
      } finally {
        setIsLoading(false);
      }
    },
    [categoryId]
  );

  useEffect(() => {
    fetchItems('');
  }, [fetchItems]);

  /**
   * An item the catalogue offers exactly one service for has nothing to
   * choose: that service is selected for it as soon as the list loads, so the
   * user only enters a quantity. Items with several services are deliberately
   * left unselected — the user must pick one. An existing choice is never
   * overwritten, so a selection survives a re-fetch.
   */
  useEffect(() => {
    setItemServices((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const item of items) {
        if (item.service_types.length === 1 && next[item.id] === undefined) {
          next[item.id] = item.service_types[0];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items]);

  const handleSearchChange = (text: string) => {
    setSearch(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchItems(text), 350);
  };

  /** The raw text in the field; '' while the user is clearing it. */
  const getQuantityText = (itemId: string) =>
    quantities[itemId] === undefined ? '1' : quantities[itemId];

  const handleQuantityInput = (itemId: string, text: string) => {
    // Digits only, so the field can never hold a decimal, a sign or letters.
    setQuantities((prev) => ({ ...prev, [itemId]: text.replace(/[^0-9]/g, '') }));
  };

  /** One item's service choice, stored against that item id alone. */
  const handleSelectItemService = (itemId: string, code: string) => {
    setItemServices((prev) => ({ ...prev, [itemId]: code }));
    setServiceErrors((prev) => ({ ...prev, [itemId]: false }));
  };

  const serviceLabel = (code: string) =>
    services.find((service) => service.code === code)?.name ||
    (code === 'dry_clean' ? 'Dry Clean' : 'Wash & Iron');

  const handleAddToOrder = async (item: BusinessItem) => {
    // First line of the double-tap defence. The button is disabled while an
    // add is in flight and the store refuses a concurrent call as well, so a
    // tap that beats the re-render still cannot create a second line.
    if (addingItemId) return;

    // Quantity first: it must be present and a whole number of at least 1.
    const raw = getQuantityText(item.id).trim();
    if (!raw) {
      setError('Please enter a valid quantity.');
      return;
    }
    const quantity = Number.parseInt(raw, 10);
    if (!Number.isFinite(quantity)) {
      setError('Please enter a valid quantity.');
      return;
    }
    if (quantity < 1) {
      setError('Quantity must be at least 1.');
      return;
    }

    // Then the service. A single-service item already has it selected, and
    // falls back to its only service defensively; anything with a choice to
    // make must have been chosen. Validated BEFORE the item is added.
    const lineService =
      itemServices[item.id] ||
      (item.service_types.length === 1 ? item.service_types[0] : undefined);
    if (!lineService) {
      setServiceErrors((prev) => ({ ...prev, [item.id]: true }));
      setError(ITEM_SERVICE_REQUIRED_MESSAGE);
      return;
    }

    try {
      setAddingItemId(item.id);
      setError('');
      // Launched BEFORE the request, not after it: the feedback is for the
      // tap, and delaying it until the server answers would leave the exact
      // gap it exists to fill. It runs alongside the call.
      launchFlight(item);
      // Quantity travels to the order as entered. The catalogue still carries
      // a standard weight per piece and the server still records it — that is
      // what the Sorter loads machines by; it is simply not shown here.
      await addItem(item.id, quantity, lineService);
      setQuantities((prev) => ({ ...prev, [item.id]: '1' }));

      // Confirm it landed. The tick replaces the spinner rather than following
      // it, so the button never returns to a state that looks untouched.
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
      setAddedItemId(item.id);
      addedTimerRef.current = setTimeout(() => setAddedItemId(null), 1400);
    } catch (err: any) {
      setError(err?.message || 'Failed to add item to your order');
    } finally {
      setAddingItemId(null);
    }
  };

  // A timer that outlives the screen would set state on an unmounted
  // component; both timers are cleared on the way out.
  useEffect(
    () => () => {
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const renderItem = ({ item }: { item: BusinessItem }) => {
    const quantityText = getQuantityText(item.id);
    const selectedService = itemServices[item.id];
    const showServiceError = Boolean(serviceErrors[item.id]);
    const hasNoService = item.service_types.length === 0;
    /** One service means nothing to choose — see the selector below. */
    const hasSingleService = item.service_types.length === 1;
    const artwork = item.image_url ? { uri: item.image_url } : null;
    const isAdding = addingItemId === item.id;
    const isAdded = addedItemId === item.id;
    /** Any add in flight locks every card, so two lines cannot be posted. */
    const isBusy = addingItemId !== null;

    return (
      // Horizontal card: artwork on the left, everything else in the column
      // beside it — details, then the service buttons, the quantity field and
      // Add to Order, each at full size rather than squeezed into a corner.
      <View style={styles.itemCard}>
        {/* The flight starts from this view's measured position, which is
            why it carries a ref keyed by item id. */}
        <View
          style={styles.itemImage}
          ref={(node) => {
            if (node) artworkRefs.current.set(item.id, node);
            else artworkRefs.current.delete(item.id);
          }}
          collapsable={false}
        >
          {artwork ? (
            <Image source={artwork} style={styles.itemImageInner} resizeMode="contain" />
          ) : (
            <Ionicons name="shirt-outline" size={32} color={COLORS.Primary} />
          )}
        </View>

        <View style={styles.itemInfo}>
          <View style={styles.itemNameRow}>
            <Text style={styles.itemName}>{item.name}</Text>
            {/* Why this item is near the top. Shown only where it is earned,
                so the badge stays meaningful rather than decorating the whole
                list. */}
            {item.order_count > 0 ? (
              <View style={styles.frequentBadge}>
                <Ionicons name="repeat" size={12} color={COLORS.PrimaryDark} />
                <Text style={styles.frequentBadgeText}>Frequent</Text>
              </View>
            ) : null}
          </View>
          {/* Neither size nor weight is shown: the business orders by the
              piece, so the unit is the only measure that means anything at
              the point of ordering. */}
          <Text style={styles.itemMeta}>Unit: {item.unit}</Text>

          {/* This item's own laundry services, from the catalogue.

              ONE SERVICE IS NOT A CHOICE. When the catalogue offers the item a
              single service it is already selected, so a picker with one
              option would only ask the user to confirm what cannot be varied.
              The service is stated as a plain line instead, and the selector
              appears only where there is genuinely something to choose.

              With several, the buttons get a full row rather than a narrow
              right-hand column, so they can be full size without cramping the
              details. Selection is per item. */}
          {hasNoService ? (
            <Text style={styles.serviceErrorText}>No service available for this item</Text>
          ) : hasSingleService ? (
            <Text style={styles.itemMeta}>Service: {serviceLabel(item.service_types[0])}</Text>
          ) : (
            <>
          <Text style={styles.sectionLabel}>Select Laundry Services</Text>
          <View style={styles.serviceRow}>
            {item.service_types.map((code) => {
              const isSelected = selectedService === code;
              return (
                <TouchableOpacity
                  key={code}
                  style={[styles.serviceTag, isSelected && styles.serviceTagSelected]}
                  onPress={() => handleSelectItemService(item.id, code)}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : SERVICE_ICONS[code] || 'ellipse-outline'}
                    size={20}
                    color={isSelected ? COLORS.Surface : COLORS.PrimaryDark}
                  />
                  <Text
                    style={[styles.serviceTagText, isSelected && styles.serviceTagTextSelected]}
                  >
                    {serviceLabel(code)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {showServiceError ? (
            <Text style={styles.serviceErrorText}>{ITEM_SERVICE_REQUIRED_MESSAGE}</Text>
          ) : null}
            </>
          )}

          {/* A typed numeric field, sized to be read and tapped easily. */}
          <View style={styles.quantityBlock}>
            <Text style={styles.quantityLabel}>Quantity</Text>
            <TextInput
              style={styles.quantityInput}
              value={quantityText}
              onChangeText={(text) => handleQuantityInput(item.id, text)}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={5}
              selectTextOnFocus
              accessibilityLabel={`Quantity for ${item.name}`}
            />
          </View>

          {/* THREE STATES, and every one of them says which it is.

              Idle -> ADDING (spinner, disabled) -> ADDED (tick, briefly), then
              back to idle. The tick is what confirms the item actually landed
              in the order: a button that simply stops spinning leaves the user
              guessing, and guessing is what produces a second tap.

              `disabled` covers the whole card while ANY item is being added,
              matching the store's own single-flight guard, so a double tap
              cannot post two lines. */}
          <View style={styles.itemActions}>
            <TouchableOpacity
              style={[
                styles.addButton,
                isAdded && styles.addButtonAdded,
                (hasNoService || isBusy) && styles.addButtonDisabled,
              ]}
              onPress={() => handleAddToOrder(item)}
              disabled={isBusy || hasNoService}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name} to order`}
              accessibilityState={{ disabled: isBusy || hasNoService, busy: isAdding }}
            >
              {isAdding ? (
                <>
                  <ActivityIndicator size="small" color={COLORS.Surface} />
                  <Text style={styles.addButtonText}>ADDING…</Text>
                </>
              ) : isAdded ? (
                <>
                  <Ionicons name="checkmark-circle" size={22} color={COLORS.Surface} />
                  <Text style={styles.addButtonText}>ADDED</Text>
                </>
              ) : (
                <Text style={styles.addButtonText}>ADD TO ORDER</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const header = (
    <View>
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color={COLORS.TextSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder={`Search in ${categoryName || 'items'}...`}
          placeholderTextColor={COLORS.TextSecondary}
          value={search}
          onChangeText={handleSearchChange}
        />
        {search ? (
          <TouchableOpacity
            onPress={() => {
              setSearch('');
              fetchItems('');
            }}
          >
            <Ionicons name="close-circle" size={18} color={COLORS.TextSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Text style={styles.countLine}>
        {isLoading ? 'Loading…' : `${items.length} item${items.length === 1 ? '' : 's'}`}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BusinessHeader
        title={categoryName || 'Items'}
        subtitle={parentName || undefined}
        onBack={() => navigation.goBack()}
        action={
          <TouchableOpacity
            style={styles.cartButton}
            onPress={() => navigation.navigate('BusinessCart')}
            // Measured here and on layout, so the flight lands on the button
            // wherever the header has settled.
            ref={cartButtonRef as any}
            onLayout={measureCartButton}
          >
            <Ionicons name="cart-outline" size={24} color={COLORS.TextPrimary} />
            {cartCount > 0 ? (
              <Animated.View style={[styles.badge, { transform: [{ scale: badgeScale }] }]}>
                <Text style={styles.badgeText}>{cartCount}</Text>
              </Animated.View>
            ) : null}
          </TouchableOpacity>
        }
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={COLORS.Primary} style={{ marginTop: SPACING.lg }} />
          ) : (
            <Text style={styles.emptyText}>No items found</Text>
          )
        }
      />

      {/*
        THE ITEM IN FLIGHT.

        Absolutely positioned over everything and `pointerEvents="none"`, so it
        travels across the screen without ever intercepting a tap — the list
        stays scrollable and the buttons stay pressable while it moves.

        One interpolated progress value drives all four properties, which keeps
        the arc, the shrink and the fade in step with each other by
        construction rather than by three timings that have to agree.
      */}
      {flight ? (
        <Animated.View
          key={flight.key}
          pointerEvents="none"
          style={[
            styles.flyingItem,
            {
              left: flight.x,
              top: flight.y,
              width: flight.size,
              height: flight.size,
              opacity: flightProgress.interpolate({
                // Holds full opacity for most of the journey and fades only as
                // it arrives, so it does not vanish halfway.
                inputRange: [0, 0.75, 1],
                outputRange: [1, 0.9, 0],
              }),
              transform: [
                {
                  translateX: flightProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [
                      0,
                      (flightDestination.current?.x ?? flight.x) - flight.x - flight.size / 2,
                    ],
                  }),
                },
                {
                  translateY: flightProgress.interpolate({
                    // Three points, not two: it rises before it crosses, which
                    // is the arc that makes it read as thrown rather than
                    // dragged in a straight line.
                    inputRange: [0, 0.45, 1],
                    outputRange: [
                      0,
                      ((flightDestination.current?.y ?? flight.y) - flight.y) * 0.25 - 60,
                      (flightDestination.current?.y ?? flight.y) - flight.y - flight.size / 2,
                    ],
                  }),
                },
                {
                  scale: flightProgress.interpolate({
                    inputRange: [0, 0.3, 1],
                    outputRange: [1, 0.85, 0.3],
                  }),
                },
              ],
            },
          ]}
        >
          {flight.uri ? (
            <Image
              source={{ uri: flight.uri }}
              style={styles.itemImageInner}
              resizeMode="contain"
            />
          ) : (
            <Ionicons name="shirt" size={30} color={COLORS.Primary} />
          )}
        </Animated.View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  listContent: { padding: SPACING.md, paddingBottom: SPACING.xxl },

  cartButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.Surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.light,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: COLORS.Error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: COLORS.Surface, fontSize: 11, fontWeight: 'bold' },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.Border,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  searchInput: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
  },

  countLine: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginBottom: SPACING.sm,
  },

  itemCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.Border,
    ...SHADOWS.light,
  },
  // The artwork keeps its size as the controls grow — the card gets taller,
  // nothing else gets squeezed.
  itemImage: {
    width: 68,
    height: 68,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Accent + '30',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    overflow: 'hidden',
  },
  itemImageInner: { width: '100%', height: '100%' },
  itemInfo: { flex: 1, minWidth: 0 },
  itemName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  itemMeta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginTop: 3,
  },

  // ---- "Frequent" badge ----
  // Sits beside the name rather than above it, so the ranked items are
  // obvious while scanning without adding a row to every card.
  itemNameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap' },
  frequentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.Accent + '40',
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  frequentBadgeText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },

  // ---- Laundry service buttons ----
  // Full-size buttons rather than pills. `flexBasis` with `flexGrow` is what
  // makes them share a row on a wide screen and take a full row each on a
  // narrow one, so the label always has room and the target stays large.
  sectionLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.TextPrimary,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
  },
  serviceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  serviceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    flexGrow: 1,
    flexBasis: 150,
    minHeight: 52,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.Surface,
    borderWidth: 2,
    borderColor: COLORS.Border,
    borderRadius: BORDER_RADIUS.md,
  },
  // Selected reads at a glance: filled in the theme green, dark border,
  // white bold label and a checkmark, against a plain outlined button.
  serviceTagSelected: {
    backgroundColor: COLORS.Primary,
    borderColor: COLORS.PrimaryDark,
    ...SHADOWS.medium,
  },
  serviceTagText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  serviceTagTextSelected: { color: COLORS.Surface, fontWeight: '800' },
  serviceErrorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
    marginTop: SPACING.xs,
  },

  // ---- Quantity ----
  // A labelled numeric field, sized to be read and tapped at arm's length.
  quantityBlock: { marginTop: SPACING.md },
  quantityLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.TextPrimary,
    marginBottom: SPACING.xs,
  },
  quantityInput: {
    width: 130,
    height: 58,
    borderWidth: 2,
    borderColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },

  // ---- Add to Order ----
  // The card's most prominent control: full width of the content column.
  itemActions: { marginTop: SPACING.md },
  addButton: {
    backgroundColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.md,
    height: 56,
    flexDirection: 'row',
    gap: SPACING.xs,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.medium,
  },
  addButtonDisabled: { opacity: 0.5 },
  /** The confirmed state — a darker green, so ADDED reads as a result. */
  addButtonAdded: { backgroundColor: COLORS.PrimaryDark },
  addButtonText: {
    color: COLORS.Surface,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  /** The travelling copy. Above everything, and never a touch target. */
  flyingItem: {
    ...SHADOWS.medium,
    position: 'absolute',
    zIndex: 999,
    // Above the list on Android too, where zIndex alone is not enough.
    elevation: 12,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.Primary,
  },

  errorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: SPACING.lg,
  },
});
