import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  TextInput,
  Modal,
  Pressable,
  Image,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigationState } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import CategoryGridCard from '../../components/business/CategoryGridCard';
import SectionHeading from '../../components/SectionHeading';
import businessOrderApi, { BusinessCategory, BusinessItem } from '../../services/businessOrderApi';
import { getCategoryImage } from '../../constants/categoryImages';
import { filterHiddenCategories } from '../../constants/hiddenCategories';
import { extractErrorMessage } from '../../services/api';
import { useBusinessOrderStore, LaundryType, OrderType } from '../../store/businessOrderStore';

/** How each laundry type is named and iconed here, matching the Order Type page. */
const LAUNDRY_LABELS: Record<LaundryType, string> = {
  hotel: 'Hotel Laundry',
  guest: 'Guest Laundry',
};
const LAUNDRY_ICONS: Record<LaundryType, keyof typeof Ionicons.glyphMap> = {
  hotel: 'business',
  guest: 'person',
};

/** How each order type is named and iconed here, matching the Order Type page. */
const ORDER_LABELS: Record<OrderType, string> = {
  standard: 'Standard Order',
  quick: 'Quick Order',
};
const ORDER_ICONS: Record<OrderType, keyof typeof Ionicons.glyphMap> = {
  standard: 'calendar-outline',
  quick: 'flash',
};

/** Icon fallback per main-category slug, used when no artwork is mapped. */
const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'room-linen': 'bed-outline',
  'spa-and-pool': 'water-outline',
  'f-and-b-service': 'restaurant-outline',
  'f-and-b-production': 'flame-outline',
  uniforms: 'shirt-outline',
};

/**
 * The two cards whose grid positions are swapped, each listed by every key it
 * may arrive under (slug or display name, lower-cased).
 */
const SWAPPED_CARDS = [
  ['f-and-b-service', 'f&b service'],
  ['uniforms'],
];

/**
 * Swaps the F&B Service and Uniforms cards in the grid, leaving the API's own
 * ordering of everything else untouched. A no-op when either card is absent.
 */
function swapFnbAndUniforms(categories: BusinessCategory[]): BusinessCategory[] {
  const indexOf = (keys: string[]) =>
    categories.findIndex((category) =>
      [category.slug, category.name].some((value) =>
        keys.includes(String(value ?? '').trim().toLowerCase())
      )
    );

  const [first, second] = SWAPPED_CARDS.map(indexOf);
  if (first < 0 || second < 0) return categories;

  const ordered = [...categories];
  [ordered[first], ordered[second]] = [ordered[second], ordered[first]];
  return ordered;
}

const COLUMNS = 2;
const GRID_PADDING = 10;   // screen edge -> card
const GRID_GAP = 10;       // between the two columns
const GRID_ROWS = 2;       // the four main categories, as a 2 x 2 grid
const MIN_CARD_SIZE = 140;

/**
 * Select Items — Main Categories. This is also the Business home page.
 *
 * A 2 x 2 grid of large SQUARE image buttons. The side is the largest square
 * that fits both the screen width and the measured height of the grid area,
 * so the four categories dominate the page, stay square on any device, and
 * are never clipped or overflowed. The block is centred in whatever height is
 * left. Extra categories, if any are ever added, simply scroll at that size.
 *
 * The whole card navigates: to the Sub Category page when the category has
 * children, straight to Items when it does not, so an empty sub-category
 * screen can never appear. Service selection lives on the Items page only.
 */
export default function BusinessCategoriesScreen({ navigation, route }: any) {
  /**
   * Whether THIS screen's own stack has somewhere to pop to.
   *
   * `navigation.canGoBack()` is not the test: from a tab's first page it can
   * still report true because the tab navigator itself sits inside a parent
   * stack, which would put a Back button on a root page that then left the
   * Business section. The index of the nearest navigator's own state answers
   * the question actually being asked — 0 means this is the first page.
   */
  const canGoBack = useNavigationState((state) => state.index > 0);

  const [categories, setCategories] = useState<BusinessCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  /* =================================================================
   * ITEM SEARCH
   *
   * Searches ITEMS, not categories. Someone who knows they want "napkin"
   * should not have to work out which of five categories it is filed under
   * first — that is the whole point of a search box on the landing screen.
   *
   * It searches ACROSS every category: `searchItems` takes an optional
   * categoryId and is called without one here, so the whole priced catalogue
   * for this business is in scope.
   *
   * TAPPING A RESULT HANDS OFF TO THE ITEMS SCREEN rather than growing an
   * "add to order" control here. That screen already owns the item card, the
   * service selector, the quantity field and the fly-to-cart animation; a
   * second copy on this screen would be a second thing to keep in step.
   * ================================================================= */
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<BusinessItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  /**
   * Why the last search failed, or '' when it did not.
   *
   * Kept SEPARATE from the empty-results case. Swallowing the error and
   * showing an empty list would report a broken request as "no items match",
   * which sends the user looking for a spelling mistake instead of telling
   * them the search did not run.
   */
  const [searchError, setSearchError] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Guards against a slow early response overwriting a later one. */
  const searchSeq = useRef(0);

  const trimmedSearch = search.trim();
  /** Below this the query is too broad to be useful, so the grid stays. */
  const isSearchActive = trimmedSearch.length >= 2;

  const runSearch = useCallback(async (term: string) => {
    const seq = (searchSeq.current += 1);
    try {
      setIsSearching(true);
      setSearchError('');
      const response = await businessOrderApi.searchItems({ search: term });
      // Out-of-order responses are dropped: typing fast fires several
      // requests and the last one typed must win, not the last one to land.
      if (seq === searchSeq.current) setResults(response.data ?? []);
    } catch (err: any) {
      if (seq === searchSeq.current) {
        setResults([]);
        // The server's own wording where there is one, so a real cause —
        // an expired session, an unapproved account — reaches the user
        // instead of being flattened into "no results".
        setSearchError(extractErrorMessage(err, 'Could not search items'));
      }
    } finally {
      if (seq === searchSeq.current) setIsSearching(false);
    }
  }, []);

  // Debounced, so a request is not sent per keystroke.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!isSearchActive) {
      setResults([]);
      setSearchError('');
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimer.current = setTimeout(() => runSearch(trimmedSearch), 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [trimmedSearch, isSearchActive, runSearch]);

  /**
   * Opens the Items screen for the result's own category, with the search
   * carried over so the item is already on screen when it opens.
   */
  const openSearchResult = (item: BusinessItem) => {
    navigation.navigate('BusinessItemsScreen', {
      categoryId: item.category_id,
      categoryName: item.category_name,
      parentName: item.parent_category_name,
      initialSearch: item.name,
    });
  };

  // Long-pressing a card previews its full artwork.
  const [zoomed, setZoomed] = useState<BusinessCategory | null>(null);
  const zoomScale = useRef(new Animated.Value(0.85)).current;

  const { width, height } = useWindowDimensions();

  // Height of the area the grid actually gets, measured rather than guessed,
  // so the header and the tab bar are both accounted for on every screen
  // size — and so removing the search bar hands its space straight to the
  // cards instead of leaving a gap.
  const [gridHeight, setGridHeight] = useState(0);

  // The card is square: the largest side that fits two columns across the
  // width AND two rows down the measured height. Width normally wins, so the
  // buttons span the screen; on a short screen the height caps them instead,
  // which is what stops the second row being cut off.
  const cardSize = useMemo(() => {
    const byWidth = Math.floor((width - GRID_PADDING * 2 - GRID_GAP) / COLUMNS);
    if (!gridHeight) return byWidth;
    // Every row carries a bottom margin, the last one included, so all
    // GRID_ROWS gaps come off the usable height.
    const byHeight = Math.floor(
      (gridHeight - GRID_PADDING * 2 - GRID_GAP * GRID_ROWS) / GRID_ROWS
    );
    return Math.max(MIN_CARD_SIZE, Math.min(byWidth, byHeight));
  }, [width, gridHeight]);

  const {
    cart,
    loadCart,
    laundryType: storeLaundryType,
    orderType: storeOrderType,
  } = useBusinessOrderStore();
  const cartCount = useMemo(
    () => (cart?.items || []).reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  /*
   * What the last two screens decided, shown here so the choice does not
   * vanish the moment the catalogue opens.
   *
   * Route params win when present -- they are what OrderTypeScreen just
   * navigated here WITH, so they are more current than a store write that
   * may still be in flight. The store is the fallback for every other way
   * this screen is reached: the Home tab directly, or a cold start that
   * restored a session already mid-order.
   */
  const laundryType: LaundryType | null = route?.params?.laundryType ?? storeLaundryType ?? null;
  const orderType: OrderType | null = route?.params?.orderType ?? storeOrderType ?? null;

  const load = useCallback(async () => {
    try {
      setError('');
      setIsLoading(true);
      const response = await businessOrderApi.getCategories();
      // Hidden purely in the UI — the API and database are left untouched.
      setCategories(swapFnbAndUniforms(filterHiddenCategories(response.data)));
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to load categories'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadCart().catch(() => {});
  }, [load, loadCart]);

  const openCategory = (category: BusinessCategory) => {
    if (category.has_subcategories) {
      navigation.navigate('BusinessSubCategoriesScreen', {
        categoryId: category.id,
        categoryName: category.name,
      });
      return;
    }
    navigation.navigate('BusinessItemsScreen', {
      categoryId: category.id,
      categoryName: category.name,
    });
  };

  const openZoom = (category: BusinessCategory) => {
    if (!getCategoryImage(category.slug, category.name) && !category.image_url) return;
    setZoomed(category);
    zoomScale.setValue(0.85);
    Animated.timing(zoomScale, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const artworkSource = (category: BusinessCategory) => {
    const bundled = getCategoryImage(category.slug, category.name);
    return bundled ?? (category.image_url ? { uri: category.image_url } : null);
  };

  const renderCategory = ({ item }: { item: BusinessCategory }) => (
    <CategoryGridCard
      name={item.name}
      source={artworkSource(item)}
      fallbackIcon={CATEGORY_ICONS[item.slug] || 'cube-outline'}
      size={cardSize}
      onPress={() => openCategory(item)}
      onLongPress={() => openZoom(item)}
    />
  );

  /* The search bar was removed from the Business home screen. The grid
     measures its own height through onLayout below, so it simply reclaims
     the space rather than leaving a gap where the bar used to be. */
  const errorBanner = error ? (
    <View style={styles.errorWrap}>
      <Text style={styles.errorText}>{error}</Text>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* NO BACK BUTTON AT THE ROOT. Select Items is the first page of its
          tab, so there is nothing to go back TO; a button that only jumped to
          another tab was navigation that did not match its own label. It
          appears as soon as the stack has somewhere to pop to, and
          BusinessHeader renders no placeholder when it is absent.

          NO `title` EITHER: the page's name is now the SectionHeading pill
          below rather than plain text up here, so passing one would say
          "Select Items" twice. */}
      <BusinessHeader
        onBack={canGoBack ? () => navigation.goBack() : undefined}
        action={
          <TouchableOpacity
            style={styles.cartButton}
            onPress={() => navigation.navigate('BusinessCart')}
          >
            <Ionicons name="cart-outline" size={24} color={COLORS.TextPrimary} />
            {cartCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{cartCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        }
      />

      {/* What Order Type just decided, carried forward so it does not vanish
          the moment the catalogue opens. Shown only once both halves of the
          decision are actually known -- a business that lands here some
          other way (the Home tab directly, say) has neither yet, and a
          half-filled "Selected: | Quick Order" would raise a question this
          screen has no answer for. */}
      {laundryType && orderType ? (
        <View style={styles.selectedRow}>
          <Text style={styles.selectedLabel}>Selected:</Text>
          <Ionicons name={LAUNDRY_ICONS[laundryType]} size={16} color={COLORS.Primary} />
          <Text style={styles.selectedValue} numberOfLines={1}>
            {LAUNDRY_LABELS[laundryType]}
          </Text>
          <Text style={styles.selectedSeparator}>|</Text>
          <Ionicons name={ORDER_ICONS[orderType]} size={16} color={COLORS.Primary} />
          <Text style={styles.selectedValue} numberOfLines={1}>
            {ORDER_LABELS[orderType]}
          </Text>
        </View>
      ) : null}

      {/* Closes off the header block the same way Order Type's own header
          does — a hairline rule under the back button / selected-choice row,
          before the page's own content starts. */}
      <View style={styles.headerDivider} />

      {/* The page's name, styled the same way Order Type's own heading is —
          the two screens are consecutive steps of one flow and should read
          as such. */}
      <SectionHeading style={styles.pageHeading}>SELECT ITEMS</SectionHeading>

      {/* Item search. Sits directly under the heading, above the grid, where a
          search box is looked for. */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={20} color={COLORS.TextSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for an item…"
            placeholderTextColor={COLORS.TextSecondary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search for an item across all categories"
          />
          {search ? (
            <TouchableOpacity
              onPress={() => setSearch('')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={COLORS.TextSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {errorBanner}

      {isSearchActive ? (
        /* RESULTS REPLACE THE GRID while a search is active. Showing both
           would leave the user scrolling past five category cards to reach
           the thing they just typed the name of. */
        <View style={styles.gridArea}>
          {isSearching && results.length === 0 ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={COLORS.Primary} />
            </View>
          ) : (
            <FlatList
              key="business-search-results-list"
              data={results}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.resultsContent}
              ListHeaderComponent={
                results.length > 0 ? (
                  <Text style={styles.resultsCount}>
                    {results.length} item{results.length === 1 ? '' : 's'} found
                  </Text>
                ) : null
              }
              ListEmptyComponent={
                searchError ? (
                  // A FAILED SEARCH, said plainly and retryable — not dressed
                  // up as an empty result.
                  <View style={styles.centered}>
                    <Ionicons name="alert-circle-outline" size={44} color={COLORS.Error} />
                    <Text style={styles.searchErrorText}>{searchError}</Text>
                    <TouchableOpacity
                      style={styles.retryButton}
                      onPress={() => runSearch(trimmedSearch)}
                    >
                      <Text style={styles.retryButtonText}>Try again</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.centered}>
                    <Ionicons name="search-outline" size={44} color={COLORS.TextSecondary} />
                    <Text style={styles.emptyText}>No items match “{trimmedSearch}”</Text>
                  </View>
                )
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultRow}
                  onPress={() => openSearchResult(item)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${item.category_name || 'item'}`}
                >
                  <View style={styles.resultThumb}>
                    {item.image_url ? (
                      <Image
                        source={{ uri: item.image_url }}
                        style={styles.resultThumbImage}
                        resizeMode="contain"
                      />
                    ) : (
                      <Ionicons name="shirt-outline" size={22} color={COLORS.Primary} />
                    )}
                  </View>

                  <View style={styles.resultText}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {/* Where it lives, so the same name under two categories
                        is still distinguishable. */}
                    <Text style={styles.resultMeta} numberOfLines={1}>
                      {[item.parent_category_name, item.category_name]
                        .filter(Boolean)
                        .join(' › ') || 'Uncategorised'}
                    </Text>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color={COLORS.TextSecondary} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        // The grid owns all the remaining height; onLayout reports it so the
        // cards can be sized to fill it exactly.
        <View
          style={styles.gridArea}
          onLayout={(event) => setGridHeight(event.nativeEvent.layout.height)}
        >
          <FlatList
            key={`categories-grid-${COLUMNS}`}
            data={categories}
            keyExtractor={(item) => item.id}
            renderItem={renderCategory}
            numColumns={COLUMNS}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.gridContent}
            style={styles.gridList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              error ? (
                <TouchableOpacity style={styles.retryButton} onPress={load}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.emptyText}>No categories available</Text>
              )
            }
          />
        </View>
      )}

      {/* Full artwork preview, opened by long-pressing a card. */}
      <Modal
        visible={zoomed !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomed(null)}
        statusBarTranslucent
      >
        <Pressable style={styles.zoomBackdrop} onPress={() => setZoomed(null)}>
          <Animated.View style={{ transform: [{ scale: zoomScale }] }}>
            <Pressable onPress={() => {}}>
              {zoomed && artworkSource(zoomed) ? (
                <Image
                  source={artworkSource(zoomed)!}
                  style={[
                    styles.zoomImage,
                    {
                      width: Math.min(width * 0.9, height * 0.7),
                      height: Math.min(width * 0.9, height * 0.7),
                    },
                  ]}
                  resizeMode="contain"
                />
              ) : null}
            </Pressable>
          </Animated.View>
          <Text style={styles.zoomCaption}>{zoomed?.name}</Text>
          <TouchableOpacity
            style={styles.zoomClose}
            onPress={() => setZoomed(null)}
            accessibilityLabel="Close image"
          >
            <Ionicons name="close" size={26} color={COLORS.Surface} />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: GRID_PADDING, paddingBottom: SPACING.xxl },
  // The 2 x 2 grid: no extra bottom padding, so two rows of cards fill the
  // measured area exactly instead of forcing a scroll.
  gridArea: { flex: 1 },
  gridList: { flex: 1 },
  // flexGrow + centre: the square block sits in the middle of whatever height
  // is left over, instead of leaving one dead band at the bottom.
  gridContent: { padding: GRID_PADDING, flexGrow: 1, justifyContent: 'center' },
  row: { gap: GRID_GAP, marginBottom: GRID_GAP, justifyContent: 'center' },
  errorWrap: { paddingHorizontal: GRID_PADDING, paddingTop: SPACING.xs },

  /* ---- Selected laundry type + order type, and the page's own heading ---- */
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  selectedLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  selectedValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },
  selectedSeparator: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Border,
    marginHorizontal: 2,
  },
  // The same hairline Order Type's own header sits on, marking where the
  // header block ends and the page's own content begins.
  headerDivider: {
    height: 1,
    backgroundColor: COLORS.Border,
    marginTop: SPACING.sm,
  },
  pageHeading: {
    marginTop: SPACING.md,
    // Was 0: with nothing between the heading and the search bar below it,
    // the pill read as glued to the bar rather than sitting above its own
    // section. This is what puts air back between the two.
    marginBottom: SPACING.sm,
  },

  /* ---- Item search ----
   *
   * The grid measures its own height through onLayout, so the bar taking a
   * strip back simply resizes the cards; it cannot leave a gap or push the
   * second row off the screen.
   */
  searchWrap: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    height: 48,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Border,
    ...SHADOWS.light,
  },
  searchInput: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
    padding: 0,
  },

  resultsContent: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.xxl },
  searchErrorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
    textAlign: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  resultsCount: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginBottom: SPACING.sm,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Border,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
    ...SHADOWS.light,
  },
  resultThumb: {
    width: 48,
    height: 48,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.Accent + '30',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  resultThumbImage: { width: '100%', height: '100%' },
  resultText: { flex: 1, minWidth: 0 },
  resultName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  resultMeta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },

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
  retryButton: {
    alignSelf: 'center',
    backgroundColor: COLORS.Primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginTop: SPACING.md,
  },
  retryButtonText: { color: COLORS.Surface, fontFamily: TYPOGRAPHY.fontFamily, fontWeight: '600' },

  zoomBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomImage: { borderRadius: BORDER_RADIUS.lg },
  zoomCaption: {
    marginTop: SPACING.lg,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.Surface,
  },
  zoomClose: {
    position: 'absolute',
    top: 48,
    right: SPACING.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

