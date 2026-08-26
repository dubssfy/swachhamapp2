import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import CategoryGridCard from '../../components/business/CategoryGridCard';
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

const COLUMNS = 2;
const GRID_PADDING = 10;   // screen edge -> card
const GRID_GAP = 10;       // between the two columns

/**
 * Sub Categories for one main category.
 *
 * A FlatList rather than a ScrollView: there can be many sub-categories, and
 * FlatList both virtualises them and guarantees the list owns the remaining
 * screen height, so every row stays reachable by scrolling.
 */
export default function BusinessSubCategoriesScreen({ navigation, route }: any) {
  const { categoryId, categoryName } = route.params || {};

  const [subCategories, setSubCategories] = useState<BusinessCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const { width } = useWindowDimensions();
  // Cards claim almost the whole width: tight side padding and a small
  // gutter, so two square cards per row stay as large as the screen allows.
  const cardSize = useMemo(
    () => Math.floor((width - GRID_PADDING * 2 - GRID_GAP) / COLUMNS),
    [width]
  );

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

  const renderCard = ({ item, index }: { item: BusinessCategory; index: number }) => (
    <CategoryGridCard
      name={item.name}
      source={getSubCategoryImage(item.slug, item.name) ?? (item.image_url ? { uri: item.image_url } : null)}
      fallbackIcon={SUB_ICONS[index % SUB_ICONS.length]}
      size={cardSize}
      onPress={() =>
        navigation.navigate('BusinessItemsScreen', {
          categoryId: item.id,
          categoryName: item.name,
          parentName: categoryName,
        })
      }
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BusinessHeader
        title={categoryName || 'Sub Categories'}
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
          key={`subcategories-grid-${COLUMNS}`}
          data={subCategories}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          numColumns={COLUMNS}
          columnWrapperStyle={styles.row}
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
  row: { gap: GRID_GAP, marginBottom: GRID_GAP },

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
