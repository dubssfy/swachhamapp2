import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { BusinessPrice, LaundryTypeValue } from '../../services/superAdminApi';

/**
 * Business Price List — the Category page and the Sub-category page.
 *
 * ONE screen for both levels: with no `categoryId` in the route it lists the
 * categories; with one it lists that category's sub-categories. Tapping drills
 * down — a category with sub-categories pushes this screen again, a flat
 * category (or a sub-category) goes to the item list.
 *
 * The categories and sub-categories are derived from the same
 * `superAdminApi.getBusinessPrices` response the item list uses, so there is
 * one source of truth and nothing new to keep in step. Nothing here reads or
 * writes a price.
 */

type Filter = 'all' | 'set' | 'unset';

interface Params {
  businessId?: string;
  businessName?: string;
  laundryType?: LaundryTypeValue;
  laundryTypeLabel?: string;
  filter?: Filter;
  categoryId?: string;
  categoryName?: string;
}

interface Entry {
  id: string;
  name: string;
  itemCount: number;
  hasSubs: boolean;
}

export default function SuperAdminBusinessPriceBrowseScreen({ navigation, route }: any) {
  const params: Params = route?.params ?? {};
  const businessId = params.businessId ?? null;
  const businessName = params.businessName ?? '';
  const laundryType: LaundryTypeValue = params.laundryType === 'guest' ? 'guest' : 'hotel';
  const laundryTypeLabel = params.laundryTypeLabel ?? '';
  const filter: Filter = params.filter ?? 'all';
  const categoryId = params.categoryId ?? null;
  const categoryName = params.categoryName ?? '';

  /** null while unresolved: categories mode, or a category's sub-categories. */
  const level: 'category' | 'subcategory' = categoryId ? 'subcategory' : 'category';

  const [rows, setRows] = useState<BusinessPrice[]>([]);
  // Starts true so the first paint is a spinner, not an empty list.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadPrices = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError('');
    try {
      setRows(await superAdminApi.getBusinessPrices(businessId, laundryType));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load the price list');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [businessId, laundryType]);

  useFocusEffect(useCallback(() => { loadPrices(); }, [loadPrices]));

  const entries = useMemo<Entry[]>(() => {
    const topId = (row: BusinessPrice) => row.parent_category_id || row.category_id;
    const topName = (row: BusinessPrice) => row.parent_category_name || row.category_name;

    /*
     * COUNT DISTINCT ITEMS, NOT ROWS.
     *
     * The price list returns one row per item PER SERVICE, so an item
     * offered for Wash & Iron and Dry Clean contributes two rows and a
     * legacy base rate adds a third. Counting rows would report "Room Linen
     * · 72 items" for a category holding 30 — the label says items, so the
     * count has to be items.
     */
    const seen = new Map<string, Set<string>>();
    const count = (key: string, itemId: string) => {
      const set = seen.get(key) ?? new Set<string>();
      set.add(itemId);
      seen.set(key, set);
      return set.size;
    };

    if (level === 'category') {
      // Distinct top-level categories, de-duped by id, with an item count.
      const map = new Map<string, Entry>();
      for (const row of rows) {
        const id = topId(row);
        const name = topName(row);
        if (!id || !name) continue;
        const itemCount = count(id, row.item_id);
        const current = map.get(id);
        if (current) {
          current.itemCount = itemCount;
          if (row.parent_category_id === id) current.hasSubs = true;
        } else {
          map.set(id, {
            id,
            name,
            itemCount,
            hasSubs: row.parent_category_id === id,
          });
        }
      }
      return Array.from(map.values());
    }

    // Sub-categories of the chosen category, and only those.
    const map = new Map<string, Entry>();
    for (const row of rows) {
      if (row.parent_category_id !== categoryId) continue;
      if (!row.category_id || !row.category_name) continue;
      const itemCount = count(row.category_id, row.item_id);
      const current = map.get(row.category_id);
      if (current) current.itemCount = itemCount;
      else map.set(row.category_id, {
        id: row.category_id, name: row.category_name, itemCount, hasSubs: false,
      });
    }
    return Array.from(map.values());
  }, [rows, level, categoryId]);

  const openItems = (catId: string, catName: string, subId: string | null, subName: string | null) => {
    navigation.navigate('SuperAdminBusinessPricesList', {
      businessId,
      businessName,
      laundryType,
      laundryTypeLabel,
      filter,
      categoryId: catId,
      categoryName: catName,
      subcategoryId: subId,
      subcategoryName: subName,
    });
  };

  const onPressEntry = (entry: Entry) => {
    if (level === 'category') {
      if (entry.hasSubs) {
        navigation.push('SuperAdminBusinessPriceBrowse', {
          businessId,
          businessName,
          laundryType,
          laundryTypeLabel,
          filter,
          categoryId: entry.id,
          categoryName: entry.name,
        });
      } else {
        // A flat category — its items hang off it directly, so skip straight
        // to the item list.
        openItems(entry.id, entry.name, null, null);
      }
      return;
    }
    openItems(categoryId!, categoryName, entry.id, entry.name);
  };

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={sa.headerTitle} numberOfLines={1}>
          {level === 'category' ? 'Categories' : categoryName || 'Sub-categories'}
        </Text>
      </View>

      {businessName || laundryTypeLabel ? (
        <Text style={[sa.cardMeta, { paddingHorizontal: SPACING.md }]}>
          {businessName}
          {businessName && laundryTypeLabel ? ' · ' : ''}
          {laundryTypeLabel}
        </Text>
      ) : null}

      {!businessId ? (
        <Text style={sa.empty}>Select a business first.</Text>
      ) : loading && rows.length === 0 ? (
        <View style={sa.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={sa.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadPrices(); }}
            />
          }
        >
          {!!error && (
            <View style={sa.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
              <Text style={sa.errorText}>{error}</Text>
            </View>
          )}

          {entries.length === 0 ? (
            <Text style={sa.empty}>
              {level === 'category'
                ? 'No categories for this business.'
                : 'No sub-categories in this category.'}
            </Text>
          ) : (
            entries.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={[sa.card, { flexDirection: 'row', alignItems: 'center', gap: SPACING.md }]}
                onPress={() => onPressEntry(entry)}
                accessibilityRole="button"
                accessibilityLabel={`${entry.name}, ${entry.itemCount} items`}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: BORDER_RADIUS.md,
                    backgroundColor: COLORS.Accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={level === 'category' ? 'folder-outline' : 'pricetags-outline'}
                    size={22}
                    color={COLORS.PrimaryDark}
                  />
                </View>
                <View style={sa.flex}>
                  <Text style={sa.cardTitle} numberOfLines={2}>{entry.name}</Text>
                  <Text style={sa.cardMeta}>
                    {entry.itemCount} item{entry.itemCount === 1 ? '' : 's'}
                    {level === 'category' && entry.hasSubs ? ' · has sub-categories' : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.TextSecondary} />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
