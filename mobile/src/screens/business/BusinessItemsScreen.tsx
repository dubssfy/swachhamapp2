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

/**
 * Item selection for one category — a compact five-column table.
 *
 *   ITEM ICON | ITEM NAME | QUANTITY | SERVICES | SELECTION
 *
 * Every row lines up under those headings: the existing item artwork, the
 * catalogue name, a quantity input box, this item's own laundry
 * services, and a selection checkbox. The user ticks the items they want,
 * sets each one's quantity and service, then presses ADD ORDER TO BASKET at
 * the foot of the screen to send them all to the cart in one pass.
 *
 * The service is picked per item, never once for the whole order, so Shirt
 * can go to Wash & Iron while Trousers goes to Dry Clean. An item offering a
 * single service has it selected automatically; one offering several must be
 * chosen before that row can be added.
 *
 * Nothing about the cart, the order or the API changed: ADD ORDER TO BASKET
 * simply calls the same per-item `addItem` store action once for each ticked
 * row.
 */
export default function BusinessItemsScreen({ navigation, route }: any) {
  const { categoryId, categoryName, parentName, initialSearch } = route.params || {};

  const [items, setItems] = useState<BusinessItem[]>([]);
  const [services, setServices] = useState<LaundryServiceType[]>([]);
  /**
   * Pre-filled when this screen was opened from the home screen's item
   * search, so the item searched for is already on screen instead of the
   * whole category being listed again.
   */
  const [search, setSearch] = useState<string>(initialSearch || '');

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  /** Item ids the user has ticked in the SELECTION column. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** True from the moment ADD ORDER TO BASKET is pressed until it settles. */
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Drives the button's brief "ADDED" confirmation, cleared by a timer. */
  const [justAdded, setJustAdded] = useState(false);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The service chosen for each item, kept per item id so lines never share one. */
  const [itemServices, setItemServices] = useState<Record<string, string>>({});
  /** Item ids whose add was blocked because no service was chosen. */
  const [serviceErrors, setServiceErrors] = useState<Record<string, boolean>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { cart, loadCart, addItem } = useBusinessOrderStore();

  /* =================================================================
   * FLY-TO-CART
   *
   * A copy of the item's artwork lifts off the row and arcs into the cart
   * button, shrinking and fading as it goes; the badge then bumps as the
   * count updates. The point is that the ITEM is seen to travel — a spinner
   * says "something is happening", this says "that item went into the order".
   *
   * It is decoration over a real result, never a substitute for one: the
   * flight is started from the row's measured position at the moment of the
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
  /** One ref per rendered row's artwork, so the flight starts from IT. */
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
          // Eases out of the row and into the cart rather than running at a
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

  const selectedCount = selectedIds.size;

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

  // Seeded with the incoming search when there is one, so the first fetch is
  // already the narrowed list rather than the full category.
  useEffect(() => {
    fetchItems(initialSearch || '');
    // `initialSearch` is a navigation param and is fixed for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /** Toggle a row's SELECTION tick. */
  const toggleSelected = (itemId: string) => {
    setError('');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const serviceLabel = (code: string) =>
    services.find((service) => service.code === code)?.name ||
    (code === 'dry_clean' ? 'Dry Clean' : 'Wash & Iron');

  /**
   * ADD ORDER TO BASKET.
   *
   * Validates every ticked row first — a whole-number quantity of at least 1
   * and a chosen service — then adds them one at a time through the SAME
   * `addItem` action the screen has always used. Rows that made it in are
   * un-ticked as they land, so a failure part-way through leaves only the
   * un-added rows selected for a clean retry.
   */
  const handleAddOrderToBasket = async () => {
    if (isSubmitting) return;

    const chosen = items.filter((item) => selectedIds.has(item.id));
    if (chosen.length === 0) {
      setError('Tick at least one item to add to your basket.');
      return;
    }

    const prepared: Array<{ item: BusinessItem; quantity: number; service: string }> = [];
    for (const item of chosen) {
      const raw = getQuantityText(item.id).trim();
      const quantity = Number.parseInt(raw, 10);
      if (!raw || !Number.isFinite(quantity) || quantity < 1) {
        setError(`Enter a valid quantity for ${item.name}.`);
        return;
      }
      // A single-service item already has it selected, and falls back to its
      // only service defensively; anything with a choice must have been chosen.
      const lineService =
        itemServices[item.id] ||
        (item.service_types.length === 1 ? item.service_types[0] : undefined);
      if (!lineService) {
        setServiceErrors((prev) => ({ ...prev, [item.id]: true }));
        setError(ITEM_SERVICE_REQUIRED_MESSAGE);
        return;
      }
      prepared.push({ item, quantity, service: lineService });
    }

    const added: string[] = [];
    try {
      setIsSubmitting(true);
      setError('');
      for (const line of prepared) {
        // Launched BEFORE the request, not after it: the feedback is for the
        // tap, and it runs alongside the call.
        launchFlight(line.item);
        // Quantity travels to the order as entered. The catalogue still carries
        // a standard weight per piece and the server still records it.
        await addItem(line.item.id, line.quantity, line.service);
        added.push(line.item.id);
        setQuantities((prev) => ({ ...prev, [line.item.id]: '1' }));
      }

      setSelectedIds(new Set());
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
      setJustAdded(true);
      addedTimerRef.current = setTimeout(() => setJustAdded(false), 1600);
    } catch (err: any) {
      // Drop only the rows that actually made it into the cart.
      if (added.length) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          added.forEach((id) => next.delete(id));
          return next;
        });
      }
      setError(err?.message || 'Failed to add items to your basket');
      loadCart().catch(() => {});
    } finally {
      setIsSubmitting(false);
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
    /** One service means nothing to choose — shown as a plain line. */
    const hasSingleService = item.service_types.length === 1;
    const isChecked = selectedIds.has(item.id);

    return (
      <View>
        <View style={styles.row}>
          {/* ---- ITEM NAME ---- */}
          <View style={styles.nameCell}>
            <Text style={styles.itemName} numberOfLines={3}>
              {item.name}
            </Text>
            {item.order_count > 0 ? (
              <View style={styles.frequentBadge}>
                <Ionicons name="repeat" size={10} color={COLORS.PrimaryDark} />
                <Text style={styles.frequentBadgeText}>Frequent</Text>
              </View>
            ) : null}
            <Text style={styles.itemMeta}>Unit: {item.unit}</Text>
          </View>

          {/* ---- QUANTITY ----
              A single, roomy input the user types into directly. */}
          <View style={styles.qtyCell}>
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

          {/* ---- SERVICES ----
              This item's own laundry services, from the catalogue. One service
              is not a choice, so it is stated as a line; several get a stacked
              set of radio options, selected per item. The whole column's
              content sits on a subtle tint so it is easy to pick out. */}
          <View style={[styles.serviceCell, styles.serviceCellHighlight]}>
            {hasNoService ? (
              <Text style={styles.serviceNone}>Not available</Text>
            ) : hasSingleService ? (
              <View style={styles.serviceOption}>
                <Ionicons name="radio-button-on" size={16} color={COLORS.Primary} />
                <Text style={styles.serviceOptionText}>{serviceLabel(item.service_types[0])}</Text>
              </View>
            ) : (
              item.service_types.map((code) => {
                const isSelected = selectedService === code;
                return (
                  <TouchableOpacity
                    key={code}
                    style={styles.serviceOption}
                    onPress={() => handleSelectItemService(item.id, code)}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Ionicons
                      name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                      size={16}
                      color={isSelected ? COLORS.Primary : COLORS.TextSecondary}
                    />
                    <Text
                      style={[
                        styles.serviceOptionText,
                        isSelected && styles.serviceOptionTextSelected,
                      ]}
                    >
                      {serviceLabel(code)}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {/* ---- SELECTION ---- */}
          <View style={styles.selectCell}>
            <TouchableOpacity
              style={[
                styles.checkbox,
                isChecked && styles.checkboxChecked,
                hasNoService && styles.checkboxDisabled,
              ]}
              onPress={() => toggleSelected(item.id)}
              disabled={hasNoService}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked, disabled: hasNoService }}
              accessibilityLabel={`Select ${item.name} for the basket`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isChecked ? (
                <Ionicons name="checkmark" size={22} color={COLORS.Surface} />
              ) : null}
            </TouchableOpacity>
          </View>
        </View>

        {showServiceError ? (
          <Text style={styles.serviceErrorText}>{ITEM_SERVICE_REQUIRED_MESSAGE}</Text>
        ) : null}
      </View>
    );
  };

  const listHeader = (
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

      {/* Column headings — line up with every row's cells below. */}
      {items.length > 0 ? (
        <View style={styles.headerRow}>
          <Text style={[styles.headerCell, styles.nameCell]}>ITEM NAME</Text>
          <Text style={[styles.headerCell, styles.qtyCell]}>QTY</Text>
          <Text style={[styles.headerCell, styles.serviceCell]}>SERVICES</Text>
          <Text style={[styles.headerCell, styles.selectCell]}>SELECT</Text>
        </View>
      ) : null}
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
        ListHeaderComponent={listHeader}
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

      {/* ---- ADD ORDER TO BASKET ----
          Below the list, like the reference. Adds every ticked row to the cart
          in one pass through the existing `addItem` action. */}
      <View style={styles.basketBar}>
        <TouchableOpacity
          style={[
            styles.basketButton,
            justAdded && styles.basketButtonAdded,
            (selectedCount === 0 || isSubmitting) && styles.basketButtonDisabled,
          ]}
          onPress={handleAddOrderToBasket}
          disabled={selectedCount === 0 || isSubmitting}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Add order to basket"
          accessibilityState={{ disabled: selectedCount === 0 || isSubmitting, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <>
              <ActivityIndicator size="small" color={COLORS.Surface} />
              <Text style={styles.basketButtonText}>ADDING…</Text>
            </>
          ) : justAdded ? (
            <>
              <Ionicons name="checkmark-circle" size={22} color={COLORS.Surface} />
              <Text style={styles.basketButtonText}>ADDED TO BASKET</Text>
            </>
          ) : (
            <Text style={styles.basketButtonText}>
              ADD ORDER TO BASKET{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Text>
          )}
        </TouchableOpacity>
      </View>

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

/* Column widths shared by the heading row and every item row, so the five
   columns line up. NAME takes the space the fixed columns leave. */
const QTY_W = 60;
const SERVICE_W = 104;
const SELECT_W = 46;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  listContent: { padding: SPACING.md, paddingBottom: SPACING.lg },

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

  // ---- Column headings ----
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingBottom: SPACING.xs,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.Primary,
    marginBottom: SPACING.xs,
  },
  headerCell: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    color: COLORS.PrimaryDark,
    textTransform: 'uppercase',
  },

  // ---- Rows ----
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    marginBottom: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.Border,
    ...SHADOWS.light,
  },

  // Shared column widths (heading + row).
  nameCell: { flex: 1, minWidth: 0 },
  qtyCell: { width: QTY_W, alignItems: 'center' },
  serviceCell: { width: SERVICE_W },
  selectCell: { width: SELECT_W, alignItems: 'center' },

  // A clean, subtle tint behind the Services column's content so it reads as
  // its own block. Column width, position and text are unchanged.
  serviceCellHighlight: {
    backgroundColor: COLORS.Accent + '22',
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },

  itemImageInner: { width: '100%', height: '100%' },

  itemName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  itemMeta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 11,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },
  frequentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    backgroundColor: COLORS.Accent + '40',
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginTop: 3,
  },
  frequentBadgeText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },

  // ---- Quantity ----
  // A single, larger input box (the +/- buttons were removed) so the value is
  // easy to read and to type. Same column position as before.
  quantityInput: {
    width: QTY_W,
    height: 48,
    borderWidth: 1.5,
    borderColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.Surface,
    paddingHorizontal: 4,
    paddingVertical: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },

  // ---- Services ----
  serviceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
  },
  serviceOptionText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.TextSecondary,
  },
  serviceOptionTextSelected: { color: COLORS.PrimaryDark, fontWeight: '800' },
  serviceNone: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 11,
    color: COLORS.TextSecondary,
    fontStyle: 'italic',
  },
  serviceErrorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 11,
    color: COLORS.Error,
    marginTop: -2,
    marginBottom: SPACING.xs,
    marginLeft: SPACING.sm,
  },

  // ---- Selection ----
  checkbox: {
    width: 32,
    height: 32,
    borderRadius: BORDER_RADIUS.xs,
    borderWidth: 2,
    borderColor: COLORS.Primary,
    backgroundColor: COLORS.Surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  checkboxChecked: { backgroundColor: COLORS.Primary },
  checkboxDisabled: { borderColor: COLORS.Border, opacity: 0.5 },

  // ---- Add order to basket ----
  basketBar: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.Background,
    borderTopWidth: 1,
    borderTopColor: COLORS.Border,
  },
  basketButton: {
    backgroundColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.md,
    height: 56,
    flexDirection: 'row',
    gap: SPACING.xs,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.medium,
  },
  basketButtonDisabled: { opacity: 0.5 },
  basketButtonAdded: { backgroundColor: COLORS.PrimaryDark },
  basketButtonText: {
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
