import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import storeApi, { PublicStore } from '../../services/storeApi';
import { extractErrorMessage } from '../../services/api';
import { buildMapHtml, Coords } from '../../components/storeLocator/storeMapHtml';

/**
 * CUSTOMER STORE LOCATOR.
 *
 * The customer-facing twin of the business locator. It exists separately
 * because the business one calls `/api/businesses/stores/nearby`, which is
 * behind `authorize('BUSINESS')` and refuses a customer's token; this one
 * calls the public `/api/stores`.
 *
 * LOCATION IS OPTIONAL HERE, which is the main difference in behaviour. The
 * business locator is a "find my nearest branch" tool and asks for a fix
 * first. A customer opening this may well decline the permission, and a
 * locator that then shows nothing looks broken — so the list is fetched
 * regardless, and a fix, when there is one, only adds distances and the
 * nearest-first ordering.
 *
 * The stores come from the database on every fetch, so whatever the Super
 * Admin has activated is what appears here. Nothing is hardcoded.
 */

type Status = 'loading' | 'ready' | 'error';

/** "9:00 AM - 8:00 PM", or null when either end is missing. */
function formatHours(store: PublicStore): string | null {
  const toDisplay = (value: string | null): string | null => {
    if (!value) return null;
    const [hourText, minuteText] = value.split(':');
    const hour = Number(hourText);
    if (!Number.isFinite(hour)) return null;
    const suffix = hour < 12 ? 'AM' : 'PM';
    const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelveHour}:${minuteText ?? '00'} ${suffix}`;
  };
  const open = toDisplay(store.opening_time);
  const close = toDisplay(store.closing_time);
  return open && close ? `${open} - ${close}` : null;
}

export default function CustomerStoreLocatorScreen({ navigation }: any) {
  const [stores, setStores] = useState<PublicStore[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [userPoint, setUserPoint] = useState<Coords | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Asks for a fix but never blocks on one.
   *
   * Returns null on refusal, on a disabled location service, or on any error,
   * and the caller simply fetches without coordinates.
   */
  const tryGetPosition = useCallback(async (): Promise<Coords | null> => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') return null;
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const point = await tryGetPosition();
      setUserPoint(point);

      const result = point
        ? await storeApi.getStores({ latitude: point.latitude, longitude: point.longitude })
        : await storeApi.getStores();

      setStores(result);
      setStatus('ready');
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not load stores'));
      setStatus('error');
    }
  }, [tryGetPosition]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openDirections = (store: PublicStore) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${store.latitude},${store.longitude}`;
    Linking.openURL(url).catch(() => setError('Could not open directions.'));
  };

  // The map needs a centre. With no fix, the first store serves as one, so the
  // map is still useful rather than hidden.
  const mapHtml = useMemo(() => {
    if (stores.length === 0) return null;
    const centre: Coords =
      userPoint ?? { latitude: stores[0].latitude, longitude: stores[0].longitude };
    return buildMapHtml(centre, stores);
  }, [stores, userPoint]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack?.()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={26} color={COLORS.Surface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Store Locator</Text>
          <Text style={styles.headerSubtitle}>Find your nearest Swachham store</Text>
        </View>
      </View>

      {status === 'loading' ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
          <Text style={styles.centreText}>Finding Swachham stores near you…</Text>
        </View>
      ) : status === 'error' ? (
        <View style={styles.centre}>
          <Ionicons name="alert-circle-outline" size={32} color={COLORS.Error} />
          <Text style={styles.centreText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : stores.length === 0 ? (
        <View style={styles.centre}>
          <Ionicons name="storefront-outline" size={32} color={COLORS.TextSecondary} />
          <Text style={styles.centreTitle}>No stores listed yet</Text>
          <Text style={styles.centreText}>
            Swachham has not published any store locations at the moment. Please check back soon.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.Primary} />
          }
        >
          {mapHtml ? (
            <View style={styles.mapCard}>
              <WebView
                originWhitelist={['*']}
                source={{ html: mapHtml }}
                style={styles.map}
                scrollEnabled={false}
                javaScriptEnabled
                domStorageEnabled
              />
            </View>
          ) : null}

          {!userPoint ? (
            <View style={styles.noticeCard}>
              <Ionicons name="location-outline" size={18} color={COLORS.TextSecondary} />
              <Text style={styles.noticeText}>
                Turn on location to see which store is nearest to you.
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>
            {stores.length === 1 ? 'Our store' : `${stores.length} stores`}
          </Text>

          {stores.map((store, index) => (
            <View key={store.id} style={styles.storeCard}>
              <View style={styles.storeHeader}>
                <View style={styles.storeIcon}>
                  <Ionicons name="storefront" size={18} color={COLORS.Primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeName}>{store.name}</Text>
                  {userPoint && index === 0 ? (
                    <Text style={styles.nearestTag}>NEAREST TO YOU</Text>
                  ) : null}
                </View>
                {typeof store.distance_km === 'number' ? (
                  <Text style={styles.distance}>{store.distance_km} km</Text>
                ) : null}
              </View>

              {store.address ? <Text style={styles.storeLine}>{store.address}</Text> : null}
              <Text style={styles.storeLine}>
                {[store.city, store.district, store.state, store.pincode].filter(Boolean).join(', ')}
              </Text>

              {formatHours(store) ? (
                <View style={styles.metaRow}>
                  <Ionicons name="time-outline" size={14} color={COLORS.TextSecondary} />
                  <Text style={styles.metaText}>{formatHours(store)}</Text>
                </View>
              ) : null}

              {store.email ? (
                <View style={styles.metaRow}>
                  <Ionicons name="mail-outline" size={14} color={COLORS.TextSecondary} />
                  <Text style={styles.metaText}>{store.email}</Text>
                </View>
              ) : null}

              <View style={styles.actions}>
                <TouchableOpacity style={styles.directionsButton} onPress={() => openDirections(store)}>
                  <Ionicons name="navigate-outline" size={16} color={COLORS.Surface} />
                  <Text style={styles.directionsText}>Directions</Text>
                </TouchableOpacity>

                {store.contact_number ? (
                  <TouchableOpacity
                    style={styles.callButton}
                    onPress={() => Linking.openURL(`tel:${store.contact_number}`)}
                  >
                    <Ionicons name="call-outline" size={16} color={COLORS.Primary} />
                    <Text style={styles.callText}>Call</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.Primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
    borderBottomLeftRadius: BORDER_RADIUS.lg,
    borderBottomRightRadius: BORDER_RADIUS.lg,
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.Surface,
  },
  headerSubtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.Surface,
    opacity: 0.9,
    marginTop: 2,
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  centreTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
  },
  centreText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: COLORS.Primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  retryText: { color: COLORS.Surface, fontWeight: '600', fontFamily: TYPOGRAPHY.fontFamily },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  mapCard: {
    height: 240,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  map: { flex: 1, backgroundColor: COLORS.Background },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  noticeText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
    marginBottom: SPACING.sm,
  },
  storeCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  storeHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xs },
  storeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.Background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
  },
  nearestTag: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.Primary,
    marginTop: 2,
  },
  distance: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.Primary,
  },
  storeLine: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
    marginBottom: 2,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.xs },
  metaText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  directionsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.Primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  directionsText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.Surface,
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.Background,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  callText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.Primary,
  },
});
