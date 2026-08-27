import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import businessOrderApi, { BusinessCategory } from '../../services/businessOrderApi';
import { getSubCategoryImage } from '../../constants/categoryImages';
import { filterHiddenCategories } from '../../constants/hiddenCategories';
import { extractErrorMessage } from '../../services/api';
import { useBusinessOrderStore } from '../../store/businessOrderStore';

const SUB_ICONS: Array<keyof typeof Ionicons.glyphMap> = [
  'layers-outline',
  'cube-outline',
  'grid-outline',
  'albums-outline',
  'file-tray-stacked-outline',
  'pricetags-outline',
];

const GRID_PADDING = 10;   // screen edge -> card
const GRID_GAP = 10;       // between stacked cards

/** Solid card backgrounds, applied alternately (1st, 3rd… / 2nd, 4th…). */
const CARD_BACKGROUNDS = ['#FFBD4A', '#3D6F73'];

/**
 * Sub Categories for one main category.
 *
 * One vertical column of cards, each split into a left image section and a
 * right name section. A FlatList rather than a ScrollView: there can be many
 * sub-categories, and FlatList both virtualises them and guarantees the list
 * owns the remaining screen height, so every card stays reachable by
 * scrolling.
 *
 * The PAGE furniture — the shared header and the centred line naming the main
 * category — follows the Order Type page; the cards themselves are this
 * screen's own design.
 */
export default function BusinessSubCategoriesScreen({ navigation, route }: any) {
  const { categoryId, categoryName } = route.params || {};

  const [subCategories, setSubCategories] = useState<BusinessCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const { cart, loadCart } = useBusinessOrderStore();
  const cartCount = useMemo(
    () => (cart?.items || []).reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const load = useCallback(async () => {
    try {
      setError('');
      setIsLoading(true);
      const response = await businessOrderApi.getSubCategories(String(categoryId));
      setSubCategories(filterHiddenCategories(response.data));
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to load sub-categories'));
    } finally {
      setIsLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    load();
    loadCart().catch(() => {});
  }, [load, loadCart]);

  /**
   * If a main category turns out to have no usable sub-categories, fall
   * through to its items instead of stranding the user on an empty screen.
   */
  useEffect(() => {
    if (!isLoading && !error && subCategories.length === 0) {
      navigation.replace('BusinessItemsScreen', { categoryId, categoryName });
    }
  }, [isLoading, error, subCategories.length, navigation, categoryId, categoryName]);

  const renderCard = ({ item, index }: { item: BusinessCategory; index: number }) => {
    const source =
      getSubCategoryImage(item.slug, item.name) ??
      (item.image_url ? { uri: item.image_url } : null);
    const fallbackIcon = SUB_ICONS[index % SUB_ICONS.length];
    const cardBackground = CARD_BACKGROUNDS[index % CARD_BACKGROUNDS.length];

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: cardBackground }]}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={item.name}
        onPress={() =>
          navigation.navigate('BusinessItemsScreen', {
            categoryId: item.id,
            categoryName: item.name,
            parentName: categoryName,
          })
        }
      >
        {/* Left: the existing sub-category image (or its existing icon fallback). */}
        <View style={styles.cardImageSection}>
          {source ? (
            <Image source={source} style={styles.cardImage} resizeMode="contain" />
          ) : (
            <Ionicons name={fallbackIcon} size={44} color={COLORS.Primary} />
          )}
        </View>

        {/* Right: the existing sub-category name. */}
        <View style={styles.cardNameSection}>
          <Text style={styles.cardName} numberOfLines={2}>
            {item.name}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* The shared Business header, which carries the brand banner, the BACK
          pill and HOME.

          NO `title`: the page's name is the SectionHeading pill below, and
          the main category it belongs to is stated on the row under the
          header rule, so a title here would say one of them twice. */}
      <BusinessHeader
        onBack={() => navigation.goBack()}
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

      {/* The main category this page belongs to, below the header's rule —
          stated the way Order Type states the laundry type chosen on the
          page before it, and the way Select Items states both. */}
      <View style={styles.selectedRow}>
        <Text style={styles.selectedLabel}>Category:</Text>
        <Ionicons name="albums-outline" size={16} color={COLORS.Primary} />
        <Text style={styles.selectedValue} numberOfLines={1}>
          {categoryName || 'Sub Categories'}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={44} color={COLORS.Error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          key="subcategories-column"
          data={subCategories}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, padding: SPACING.xl },
  listContent: { padding: GRID_PADDING, paddingBottom: SPACING.xxl },

  /* ---- The main category, under the header rule ---- */
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'nowrap',
    gap: 6,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  selectedLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    flexShrink: 0,
  },
  selectedValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
    flexShrink: 1,
  },

  // One card per row, split into a left image section and a right name
  // section. The background colour is set per card (alternating) at render.
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    marginBottom: GRID_GAP,
    ...SHADOWS.medium,
  },
  cardImageSection: {
    width: 108,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    borderRightWidth: 1,
    borderRightColor: COLORS.Border,
  },
  cardImage: { width: 72, height: 72 },
  cardNameSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  cardName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
    color: COLORS.Surface,
    textAlign: 'center',
    textTransform: 'uppercase',
    // Keeps the white name legible on the lighter card background.
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.Error,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: COLORS.Primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  retryButtonText: { color: COLORS.Surface, fontFamily: TYPOGRAPHY.fontFamily, fontWeight: '600' },
});
