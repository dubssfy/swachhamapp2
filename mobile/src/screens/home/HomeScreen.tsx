import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import businessApi from '../../services/businessApi';
import serviceApi from '../../services/serviceApi';
import { Business } from '../../types';

interface Category {
  id: string;
  name: string;
  icon_name: string | null;
  image_url: string | null;
  item_count: number;
}

interface CatalogueService {
  id: string;
  name: string;
  category_name: string | null;
  /** Null when the catalogue has no price set -- not the same as free. */
  price: number | null;
  unit: string;
}

/**
 * Customer landing page.
 *
 * Leads with the laundry catalogue and keeps the laundry partners below
 * it, so nothing that already worked was taken away.
 *
 * The catalogue is empty until customer-scope items exist, and an empty
 * catalogue is a normal state here, not a failure -- so it gets a
 * deliberate "coming soon" panel rather than the blank space or error
 * that an unfilled list would otherwise produce. A real network failure
 * is reported separately, because the two mean different things and
 * only one of them is worth retrying.
 */
export default function HomeScreen({ navigation }: any) {
  const { user } = useAuthStore();
  const [categories, setCategories] = useState<Category[]>([]);
  const [popular, setPopular] = useState<CatalogueService[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    // Settled, not all: the catalogue and the partner list are
    // independent, and one being unavailable should not blank the other.
    const [cats, pop, biz] = await Promise.allSettled([
      serviceApi.getCategories(),
      serviceApi.getPopularServices(),
      businessApi.getBusinesses(),
    ]);

    if (cats.status === 'fulfilled') setCategories((cats.value.data as any) || []);
    if (pop.status === 'fulfilled') setPopular((pop.value.data as any) || []);
    if (biz.status === 'fulfilled') setBusinesses(((biz.value.data as any)?.businesses) || []);

    if (cats.status === 'rejected' && biz.status === 'rejected') {
      setError('Could not reach Swachham. Pull down to try again.');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const priceLabel = (s: CatalogueService) =>
    s.price == null ? 'Price on request' : `₹${s.price} / ${s.unit}`;

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.Primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
          />
        }
      >
        <Text style={styles.greeting}>Welcome, {user?.name || 'there'}!</Text>
        <Text style={styles.subGreeting}>What needs cleaning today?</Text>

        {!!error && (
          <View style={styles.errorBox}>
            <Ionicons name="cloud-offline-outline" size={16} color={COLORS.Error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ---- The laundry catalogue ---- */}
        <Text style={styles.sectionTitle}>Our Services</Text>

        {categories.length === 0 ? (
          <View style={styles.comingSoon}>
            <Ionicons name="shirt-outline" size={26} color={COLORS.Primary} />
            <Text style={styles.comingSoonTitle}>Service menu coming soon</Text>
            <Text style={styles.comingSoonText}>
              We are putting our price list together. In the meantime, browse our laundry
              partners below.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {categories.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.categoryCard}
                onPress={() => navigation.navigate('ServiceCategory', { categoryId: c.id, name: c.name })}
              >
                <Ionicons
                  name={(c.icon_name as any) || 'shirt-outline'}
                  size={22}
                  color={COLORS.Primary}
                />
                <Text style={styles.categoryName} numberOfLines={2}>{c.name}</Text>
                <Text style={styles.categoryCount}>
                  {c.item_count} item{c.item_count === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {popular.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Popular</Text>
            {popular.map((s) => (
              <View key={s.id} style={styles.serviceRow}>
                <View style={styles.flex}>
                  <Text style={styles.serviceName}>{s.name}</Text>
                  {!!s.category_name && (
                    <Text style={styles.serviceMeta}>{s.category_name}</Text>
                  )}
                </View>
                <Text style={styles.servicePrice}>{priceLabel(s)}</Text>
              </View>
            ))}
          </>
        )}

        {/* ---- Laundry partners: what this screen showed before, kept ---- */}
        <Text style={styles.sectionTitle}>Laundry Partners</Text>
        {businesses.length === 0 ? (
          <Text style={styles.emptyText}>No partners listed yet.</Text>
        ) : (
          businesses.map((item: any) => (
            <TouchableOpacity
              key={item.id}
              style={styles.card}
              onPress={() => navigation.navigate('BusinessDetails', { businessId: item.id })}
            >
              <View style={styles.flex}>
                <Text style={styles.businessName}>{item.name || item.businessName}</Text>
                <Text style={styles.businessAddress}>
                  {[item.city, item.state].filter(Boolean).join(', ') || 'Location not listed'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.TextSecondary} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.Background,
  },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  flex: { flex: 1 },
  greeting: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: 'bold', color: COLORS.TextPrimary,
  },
  subGreeting: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary, marginTop: 2,
  },
  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '600', color: COLORS.TextPrimary,
    marginTop: SPACING.lg, marginBottom: SPACING.sm,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  categoryCard: {
    width: '31%', backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg, padding: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.Border, gap: 4,
  },
  categoryName: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600', color: COLORS.TextPrimary,
  },
  categoryCount: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, color: COLORS.TextSecondary,
  },
  comingSoon: {
    backgroundColor: COLORS.Surface, borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.Border,
    alignItems: 'center', gap: SPACING.xs,
  },
  comingSoonTitle: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600', color: COLORS.TextPrimary,
  },
  comingSoonText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary, textAlign: 'center',
  },
  serviceRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.Surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.xs,
    borderWidth: 1, borderColor: COLORS.Border,
  },
  serviceName: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600', color: COLORS.TextPrimary,
  },
  serviceMeta: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, color: COLORS.TextSecondary,
  },
  servicePrice: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600', color: COLORS.Primary,
  },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.Surface, borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md, marginBottom: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.Border,
  },
  businessName: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600', color: COLORS.TextPrimary,
  },
  businessAddress: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: '#FDECEC', borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm, marginTop: SPACING.md,
  },
  errorText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.Error, flex: 1,
  },
});
