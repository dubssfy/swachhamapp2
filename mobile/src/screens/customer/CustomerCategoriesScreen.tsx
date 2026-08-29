import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
/* THE CUSTOMER PALETTE, imported under the name `COLORS`.
 *
 * #3d6173 and #ffbd4a. Aliased rather than renamed at every use so this
 * screen reads the same as the rest of the app, and so the green `COLORS`
 * -- which the business, sorter, rider and super-admin screens all import --
 * is left exactly as it is. See `CUSTOMER_COLORS` in constants/theme. */
import { CUSTOMER_COLORS as COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { customerCatalogueApi, CustomerCategory } from '../../services/customerCartApi';
import CartIconButton from './CartIconButton';

/**
 * SELECT ITEM — the customer's four categories.
 *
 * THE CATEGORIES COME FROM THE DATABASE, not from a list in this file. They
 * are the `scope='CUSTOMER'` categories, which is what separates them from
 * the hotel catalogue the business side uses. Renaming or reordering one in
 * Super Admin changes it here with no code change.
 *
 * A CATEGORY WITH NO ITEMS SAYS SO. The four exist but are filled in through
 * Super Admin, so until someone does that they are empty — and an empty
 * category that says "nothing here yet" is honest, where one that silently
 * opened an empty list would look broken.
 */
export default function CustomerCategoriesScreen({ navigation }: any) {
  const [categories, setCategories] = useState<CustomerCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setCategories(await customerCatalogueApi.getCategories());
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load categories');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Select Item</Text>
        <CartIconButton navigation={navigation} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
        >
          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Text style={styles.lead}>What would you like cleaned?</Text>

          {categories.length === 0 && !error ? (
            <View style={styles.empty}>
              <Ionicons name="file-tray-outline" size={40} color={COLORS.TextSecondary} />
              <Text style={styles.emptyTitle}>No categories yet</Text>
              <Text style={styles.emptyText}>
                Laundry categories have not been set up yet. Please check back shortly.
              </Text>
            </View>
          ) : (
            categories.map((category) => {
              const empty = Number(category.item_count) === 0;
              return (
                <TouchableOpacity
                  key={category.id}
                  style={[styles.card, empty && styles.cardEmpty]}
                  onPress={() =>
                    navigation.navigate('CustomerItems', {
                      categoryId: category.id,
                      categoryName: category.name,
                    })}
                  accessibilityRole="button"
                  accessibilityLabel={`${category.name}, ${category.item_count} items`}
                >
                  <View style={styles.iconBox}>
                    <Ionicons
                      name={(category.icon_name as any) || 'shirt-outline'}
                      size={24}
                      color={COLORS.PrimaryDark}
                    />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{category.name}</Text>
                    <Text style={styles.cardMeta}>
                      {empty
                        ? 'No items yet'
                        : `${category.item_count} item${Number(category.item_count) === 1 ? '' : 's'}`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.TextSecondary} />
                </TouchableOpacity>
              );
            })
          )}
          <View style={{ height: SPACING.xl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background ?? '#F4F7F5' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.Border,
  },
  back: { padding: 4 },
  title: {
    flex: 1, fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg, fontWeight: '700', color: COLORS.TextPrimary,
  },
  scroll: { padding: SPACING.md },
  lead: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary, marginBottom: SPACING.sm,
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: COLORS.Surface, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: COLORS.Border,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  cardEmpty: { opacity: 0.65 },
  iconBox: {
    width: 46, height: 46, borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Accent, alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTitle: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700', color: COLORS.TextPrimary,
  },
  cardMeta: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary, marginTop: 2,
  },
  empty: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.xs },
  emptyTitle: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700', color: COLORS.TextPrimary,
  },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary, textAlign: 'center', paddingHorizontal: SPACING.xl,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: '#FDECEC', borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm, marginBottom: SPACING.sm,
  },
  errorText: {
    flex: 1, fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs, color: COLORS.Error,
  },
});
