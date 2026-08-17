import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import businessOrderApi, { BusinessCategory, BusinessItem } from '../../services/businessOrderApi';
import { extractErrorMessage } from '../../services/api';
import { useBusinessOrderStore, SERVICE_OPTIONS } from '../../store/businessOrderStore';
import { formatWeightKg } from '../../utils/businessOrderPdf';

/**
 * Service filter for the catalogue. `null` is "All" and applies no filter.
 * The options come from the Laundry service rows the API returns, so the
 * filter can never offer a service the catalogue does not have; SERVICE_OPTIONS
 * is only the fallback if that call fails. Filtering here is a view concern —
 * it does not touch the cart, whose service is still chosen in the Cart.
 */
type ServiceFilter = { value: string | null; label: string };

const ALL_SERVICES: ServiceFilter = { value: null, label: 'All' };

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'bath-linen': 'water-outline',
  'bed-linen': 'bed-outline',
  'room-furnishing': 'home-outline',
  'living-room': 'tv-outline',
  'dining-and-kitchen': 'restaurant-outline',
  'blanket-and-heavy-linens': 'snow-outline',
  'floor-and-upholstery': 'square-outline',
  'carpet-and-rugs': 'grid-outline',
  'housekeeping-utility': 'brush-outline',
  'staff-uniform': 'shirt-outline',
  'fb-banquets': 'wine-outline',
  'spa-linen': 'flower-outline',
  industrial: 'construct-outline',
  'special-services': 'star-outline',
};

const COLUMNS = 3;

export default function BusinessCategoriesScreen({ navigation }: any) {
  const [categories, setCategories] = useState<BusinessCategory[]>([]);
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<BusinessCategory | null>(null);
  const [search, setSearch] = useState('');
  const [serviceFilters, setServiceFilters] = useState<ServiceFilter[]>([
    ALL_SERVICES,
    ...SERVICE_OPTIONS.map((option) => ({ value: option.value as string, label: option.label })),
  ]);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [error, setError] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [addingItemId, setAddingItemId] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { cart, loadCart, addItem, laundryType, orderType } = useBusinessOrderStore();

  // Service is NOT part of this step — it is chosen in the Cart. The subtitle
  // shows the selections made on the Order Type page instead.
  const contextSubtitle = [
    orderType === 'quick' ? 'Quick Order' : orderType === 'standard' ? 'Standard Order' : null,
    laundryType === 'hotel' ? 'Hotel Laundry' : laundryType === 'guest' ? 'Guest Laundry' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const cartCount = useMemo(
    () => (cart?.items || []).reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const activeServiceLabel = useMemo(
    () => serviceFilters.find((option) => option.value === serviceFilter)?.label || ALL_SERVICES.label,
    [serviceFilters, serviceFilter]
  );

  useEffect(() => {
    (async () => {
      try {
        setError('');
        const response = await businessOrderApi.getCategories();
        setCategories(response.data);
      } catch (err: any) {
        setError(extractErrorMessage(err, 'Failed to load categories'));
      } finally {
        setIsLoadingCategories(false);
      }
    })();
    // Real service rows, so the filter names match the catalogue exactly.
    businessOrderApi
      .getLaundryServices()
      .then((response) => {
        const types = response.data.serviceTypes || [];
        if (types.length > 0) {
          setServiceFilters([ALL_SERVICES, ...types.map((type) => ({ value: type.code, label: type.name }))]);
        }
      })
      .catch(() => {});
    loadCart().catch(() => {});
  }, [loadCart]);

  /** Items are always resolved server-side from category + search + service. */
  const fetchItems = useCallback(
    async (searchText: string, categoryId?: string, serviceType?: string | null) => {
      if (!searchText.trim() && !categoryId && !serviceType) {
        setItems([]);
        return;
      }
      try {
        setError('');
        setIsLoadingItems(true);
        const response = await businessOrderApi.searchItems({
          search: searchText.trim() || undefined,
          categoryId,
          serviceType: serviceType || undefined,
        });
        setItems(response.data);
      } catch (err: any) {
        setError(extractErrorMessage(err, 'Failed to load items'));
      } finally {
        setIsLoadingItems(false);
      }
    },
    []
  );

  const handleSearchChange = (text: string) => {
    setSearch(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchItems(text, selectedCategory?.id, serviceFilter);
    }, 350);
  };

  const handleCategoryPress = (category: BusinessCategory) => {
    const next = selectedCategory?.id === category.id ? null : category;
    setSelectedCategory(next);
    fetchItems(search, next?.id, serviceFilter);
  };

  /** Tapping the active filter again returns to All. */
  const handleServicePress = (value: string | null) => {
    const next = serviceFilter === value ? null : value;
    setServiceFilter(next);
    fetchItems(search, selectedCategory?.id, next);
  };

  const getQuantity = (itemId: string) => {
    const raw = quantities[itemId];
    return raw === undefined ? 1 : parseInt(raw, 10) || 0;
  };

  const setQuantity = (itemId: string, value: number) => {
    setQuantities((prev) => ({ ...prev, [itemId]: String(Math.max(1, value)) }));
  };

  const handleQuantityInput = (itemId: string, text: string) => {
    setQuantities((prev) => ({ ...prev, [itemId]: text.replace(/[^0-9]/g, '') }));
  };

  const handleAddToCart = async (item: BusinessItem) => {
    if (addingItemId) return;
    const quantity = getQuantity(item.id);
    if (!quantity || quantity < 1) {
      setError('Quantity must be at least 1');
      return;
    }
    try {
      setAddingItemId(item.id);
      setError('');
      // With a service filter on, the line is added for that service. On
      // "All" the server picks from the services the item supports.
      await addItem(item.id, quantity, serviceFilter || undefined);
      setQuantities((prev) => ({ ...prev, [item.id]: '1' }));
    } catch (err: any) {
      setError(err?.message || 'Failed to add item to cart');
    } finally {
      setAddingItemId(null);
    }
  };

  const showingItems = Boolean(search.trim() || selectedCategory || serviceFilter);

  const renderItem = ({ item }: { item: BusinessItem }) => {
    const quantity = quantities[item.id] === undefined ? '1' : quantities[item.id];
    return (
      <View style={styles.itemCard}>
        <View style={styles.itemImage}>
          <Ionicons name="shirt-outline" size={26} color={COLORS.Primary} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.itemMeta}>
            Unit: {item.unit}
            {item.weight_kg != null ? ` · Std. weight: ${formatWeightKg(item.weight_kg)}` : ''}
          </Text>
          <View style={styles.itemActions}>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => setQuantity(item.id, getQuantity(item.id) - 1)}
              >
                <Ionicons name="remove" size={16} color={COLORS.Primary} />
              </TouchableOpacity>
              <TextInput
                style={styles.stepperInput}
                value={quantity}
                onChangeText={(text) => handleQuantityInput(item.id, text)}
                keyboardType="number-pad"
              />
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => setQuantity(item.id, getQuantity(item.id) + 1)}
              >
                <Ionicons name="add" size={16} color={COLORS.Primary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => handleAddToCart(item)}
              disabled={addingItemId === item.id}
            >
              {addingItemId === item.id ? (
                <ActivityIndicator size="small" color={COLORS.Surface} />
              ) : (
                <Text style={styles.addButtonText}>Add to Cart</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const header = (
    <View>
      {/* Search sits above the category grid. */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color={COLORS.TextSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search items..."
          placeholderTextColor={COLORS.TextSecondary}
          value={search}
          onChangeText={handleSearchChange}
        />
        {search ? (
          <TouchableOpacity
            onPress={() => {
              setSearch('');
              fetchItems('', selectedCategory?.id, serviceFilter);
            }}
          >
            <Ionicons name="close-circle" size={18} color={COLORS.TextSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Service filter — All / Wash & Iron / Dry Clean. */}
      <View style={styles.serviceFilterRow}>
        {serviceFilters.map((option) => {
          const active = serviceFilter === option.value;
          return (
            <TouchableOpacity
              key={option.value ?? 'all'}
              style={[styles.serviceChip, active && styles.serviceChipActive]}
              onPress={() => handleServicePress(option.value)}
              activeOpacity={0.8}
            >
              <Text style={[styles.serviceChipLabel, active && styles.serviceChipLabelActive]} numberOfLines={1}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoadingCategories ? (
        <ActivityIndicator color={COLORS.Primary} style={{ marginVertical: SPACING.lg }} />
      ) : (
        <View style={styles.grid}>
          {categories.map((category, index) => {
            const active = selectedCategory?.id === category.id;
            const isRowEnd = index % COLUMNS === COLUMNS - 1;
            return (
              <TouchableOpacity
                key={category.id}
                style={[
                  styles.categoryBox,
                  isRowEnd && styles.categoryBoxRowEnd,
                  active && styles.categoryBoxActive,
                ]}
                onPress={() => handleCategoryPress(category)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={CATEGORY_ICONS[category.slug] || 'cube-outline'}
                  size={20}
                  color={active ? COLORS.Surface : COLORS.Primary}
                />

                <Text
                  style={[styles.categoryLabel, active && styles.categoryLabelActive]}
                  numberOfLines={2}
                >
                  {category.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {showingItems ? (
        <View style={styles.resultsHeader}>
          <Text style={styles.resultsTitle}>
            {selectedCategory ? selectedCategory.name : search.trim() ? 'Search results' : activeServiceLabel}
          </Text>
          {selectedCategory ? (
            <TouchableOpacity
              onPress={() => {
                setSelectedCategory(null);
                fetchItems(search, undefined, serviceFilter);
              }}
            >
              <Text style={styles.clearLink}>Clear filter</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {isLoadingItems ? <ActivityIndicator color={COLORS.Primary} style={{ marginTop: SPACING.md }} /> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BusinessHeader
        title="Select Items"
        subtitle={contextSubtitle || undefined}
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

      <FlatList
        data={showingItems ? items : []}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          showingItems && !isLoadingItems ? (
            <Text style={styles.emptyText}>No items found</Text>
          ) : !showingItems ? (
            <Text style={styles.hintText}>Pick a category or search to see items</Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  subtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
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
  listContent: { padding: SPACING.md, paddingBottom: SPACING.xxl },
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
  },
  searchInput: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
  },
  // Service filter chips, same surface/border/primary language as the
  // category boxes below them.
  serviceFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  serviceChip: {
    flex: 1,
    height: 36,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.Border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceChipActive: { backgroundColor: COLORS.Primary, borderColor: COLORS.Primary },
  serviceChipLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
  },
  serviceChipLabelActive: { color: COLORS.Surface, fontWeight: '700' },
  // Exactly 3 compact boxes per row on mobile.
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  categoryBox: {
    width: '31.33%',
    marginRight: '3%',
    minHeight: 76,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.Border,
    paddingVertical: SPACING.sm,
    paddingHorizontal: 4,
    marginBottom: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  categoryBoxRowEnd: { marginRight: 0 },
  categoryBoxActive: { backgroundColor: COLORS.Primary, borderColor: COLORS.Primary },
  categoryLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 11,
    color: COLORS.TextPrimary,
    textAlign: 'center',
  },
  categoryLabelActive: { color: COLORS.Surface, fontWeight: '700' },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  resultsTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  clearLink: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.Primary },
  itemCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.light,
  },
  itemImage: {
    width: 52,
    height: 52,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  itemInfo: { flex: 1 },
  itemName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  itemMeta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginTop: 2,
    marginBottom: SPACING.sm,
  },
  itemActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.Border,
    borderRadius: BORDER_RADIUS.sm,
  },
  stepperButton: { padding: SPACING.xs, width: 30, alignItems: 'center' },
  stepperInput: {
    width: 34,
    textAlign: 'center',
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
    paddingVertical: 2,
  },
  addButton: {
    backgroundColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minWidth: 100,
    alignItems: 'center',
  },
  addButtonText: {
    color: COLORS.Surface,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
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
  hintText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: SPACING.md,
    fontSize: TYPOGRAPHY.sizes.sm,
  },
});
