import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Modal,
  Pressable,
  Image,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import SwachhamChatLauncher from '../../components/chat/SwachhamChatLauncher';
import CategoryGridCard from '../../components/business/CategoryGridCard';
import businessOrderApi, { BusinessCategory, BusinessItem } from '../../services/businessOrderApi';
import { getCategoryImage } from '../../constants/categoryImages';
import { filterHiddenCategories, isHiddenCategory } from '../../constants/hiddenCategories';
import { extractErrorMessage } from '../../services/api';
import { useBusinessOrderStore } from '../../store/businessOrderStore';

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
export default function BusinessCategoriesScreen({ navigation }: any) {
  const [categories, setCategories] = useState<BusinessCategory[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<BusinessItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Long-pressing a card previews its full artwork.
  const [zoomed, setZoomed] = useState<BusinessCategory | null>(null);
  const zoomScale = useRef(new Animated.Value(0.85)).current;

  const { width, height } = useWindowDimensions();

  // Height of the area the grid actually gets, measured rather than guessed,
  // so the header, the search bar and the tab bar are all accounted for on
  // every screen size.
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

  const { cart, loadCart } = useBusinessOrderStore();
  const cartCount = useMemo(
    () => (cart?.items || []).reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

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

  const runSearch = useCallback(async (text: string) => {
    if (!text.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    try {
      setError('');
      setIsSearching(true);
      const response = await businessOrderApi.searchItems({ search: text.trim() });
      setSearchResults(
        response.data.filter(
          (item) =>
            !isHiddenCategory(item.parent_category_name) && !isHiddenCategory(item.category_name)
        )
      );
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to search items'));
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSearchChange = (text: string) => {
    setSearch(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), 350);
  };

  const searching = Boolean(search.trim());

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

  const renderSearchResult = ({ item }: { item: BusinessItem }) => (
    <TouchableOpacity
      style={styles.resultCard}
      activeOpacity={0.85}
      onPress={() =>
        navigation.navigate('BusinessItemsScreen', {
          categoryId: item.category_id,
          categoryName: item.category_name,
          parentName: item.parent_category_name,
        })
      }
    >
      <View style={styles.resultIcon}>
        <Ionicons name="shirt-outline" size={20} color={COLORS.Primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.resultName}>{item.name}</Text>
        <Text style={styles.resultMeta}>
          {item.parent_category_name ? `${item.parent_category_name} › ` : ''}
          {item.category_name}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.TextSecondary} />
    </TouchableOpacity>
  );

  // Rendered above both lists rather than inside them, so the grid area below
  // can be measured on its own.
  const searchBar = (
    <View style={styles.searchWrap}>
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color={COLORS.TextSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search items..."
          placeholderTextColor={COLORS.TextSecondary}
          value={search}
          onChangeText={handleSearchChange}
          returnKeyType="search"
        />
        {search ? (
          <TouchableOpacity
            onPress={() => {
              setSearch('');
              setSearchResults([]);
            }}
          >
            <Ionicons name="close-circle" size={18} color={COLORS.TextSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BusinessHeader
        title="Select Items"
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

      {searchBar}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : searching ? (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          renderItem={renderSearchResult}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            isSearching ? (
              <ActivityIndicator color={COLORS.Primary} style={{ marginTop: SPACING.lg }} />
            ) : (
              <Text style={styles.emptyText}>No items match your search</Text>
            )
          }
        />
      ) : (
        // The grid owns all the remaining height; onLayout reports it so the
        // cards can be sized to fill it exactly.
        <View
          style={styles.gridArea}
          onLayout={(event) => setGridHeight(event.nativeEvent.layout.height)}
        >
          <FlatList
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

      {/* Swachham assistant, bottom-right and clear of the bottom bar. */}
      <SwachhamChatLauncher />
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
  searchWrap: { paddingHorizontal: GRID_PADDING, paddingTop: GRID_PADDING },

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

  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.Border,
  },
  resultIcon: {
    width: 42,
    height: 42,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.Background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  resultMeta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: 2,
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
