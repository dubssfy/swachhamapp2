import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import businessOrderApi, { NearbyStore } from '../../services/businessOrderApi';
import { extractErrorMessage } from '../../services/api';
import { DEMO_MODE } from '../../demo/demoMode';
import { buildMapHtml, Coords } from '../../components/storeLocator/storeMapHtml';

type Status =
  | 'idle'
  | 'locating'
  | 'loading'
  | 'ready'
  | 'permission_denied'
  | 'location_unavailable'
  | 'error';



/**
 * "9:00 AM - 8:00 PM" from the stored TIME values, or null when either is
 * missing — half a range is not worth showing.
 */
function formatHours(store: { opening_time: string | null; closing_time: string | null }): string | null {
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

export default function StoreLocatorScreen({ navigation }: any) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [mapFailed, setMapFailed] = useState(false);

  const nearest = stores[0] || null;

  const handleUseMyLocation = useCallback(async () => {
    setError('');
    setMapFailed(false);
    setStores([]);
    setCoords(null);

    try {
      setStatus('locating');

      /*
       * A DEMO BUILD DOES NOT ASK THE PHONE WHERE IT IS.
       *
       * Two reasons, both about the room the demo is shown in: a GPS fix
       * indoors can take a long time or never arrive, and the map below draws
       * from remote tiles that an offline phone cannot load. Neither has
       * anything to teach a hotel about the product.
       *
       * So the demo goes straight to the store list — the substance of the
       * screen — and leaves `coords` null, which is what keeps the map panel
       * out rather than showing a grey square that failed to load.
       */
      if (DEMO_MODE) {
        setStatus('loading');
        const demoStores = await businessOrderApi.getNearbyStores({
          latitude: 0,
          longitude: 0,
          radiusKm: 100,
        });
        setStores(demoStores.data);
        setStatus('ready');
        return;
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setError('Location services are turned off on this device.');
        setStatus('location_unavailable');
        return;
      }

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setStatus('permission_denied');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const current = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setCoords(current);

      setStatus('loading');
      const response = await businessOrderApi.getNearbyStores({
        latitude: current.latitude,
        longitude: current.longitude,
        radiusKm: 100,
      });
      setStores(response.data);
      setStatus('ready');
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Could not find nearby stores'));
      setStatus('error');
    }
  }, []);

  const mapHtml = useMemo(
    () => (coords ? buildMapHtml(coords, stores) : null),
    [coords, stores]
  );

  const openDirections = (store: NearbyStore) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${store.latitude},${store.longitude}`;
    Linking.openURL(url).catch(() => setError('Could not open directions.'));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BusinessHeader title="Store Locator" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={[
            styles.locateButton,
            (status === 'locating' || status === 'loading') && styles.buttonDisabled,
          ]}
          onPress={handleUseMyLocation}
          disabled={status === 'locating' || status === 'loading'}
          activeOpacity={0.85}
        >
          {status === 'locating' || status === 'loading' ? (
            <ActivityIndicator size="small" color={COLORS.Surface} />
          ) : (
            <Ionicons name="locate-outline" size={20} color={COLORS.Surface} />
          )}
          <Text style={styles.locateButtonText}>
            {status === 'locating'
              ? 'Getting your location…'
              : status === 'loading'
                ? 'Finding nearby stores…'
                : 'Use My Location'}
          </Text>
        </TouchableOpacity>

        {status === 'idle' ? (
          <Text style={styles.hint}>
            Use your current location to find the nearest Swachham store.
          </Text>
        ) : null}

        {status === 'permission_denied' ? (
          <View style={styles.noticeCard}>
            <Ionicons name="location-outline" size={22} color={COLORS.Error} />
            <Text style={styles.noticeTitle}>Location permission needed</Text>
            <Text style={styles.noticeText}>
              Allow location access so we can find the Swachham stores closest to you.
            </Text>
            <View style={styles.noticeActions}>
              <TouchableOpacity style={styles.noticeButton} onPress={handleUseMyLocation}>
                <Text style={styles.noticeButtonText}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.noticeButton} onPress={() => Linking.openSettings()}>
                <Text style={styles.noticeButtonText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {status === 'location_unavailable' || status === 'error' ? (
          <View style={styles.noticeCard}>
            <Ionicons name="alert-circle-outline" size={22} color={COLORS.Error} />
            <Text style={styles.noticeTitle}>
              {status === 'location_unavailable' ? 'Location unavailable' : 'Something went wrong'}
            </Text>
            <Text style={styles.noticeText}>{error}</Text>
            <View style={styles.noticeActions}>
              <TouchableOpacity style={styles.noticeButton} onPress={handleUseMyLocation}>
                <Text style={styles.noticeButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {status === 'ready' && mapHtml ? (
          <>
            <View style={styles.mapCard}>
              <WebView
                originWhitelist={['*']}
                source={{ html: mapHtml }}
                style={styles.map}
                javaScriptEnabled
                domStorageEnabled
                onMessage={(event) => {
                  if (event.nativeEvent.data === 'MAP_ERROR') setMapFailed(true);
                }}
                onError={() => setMapFailed(true)}
                onHttpError={() => setMapFailed(true)}
                startInLoadingState
                renderLoading={() => (
                  <View style={styles.mapLoading}>
                    <ActivityIndicator color={COLORS.Primary} />
                  </View>
                )}
              />
            </View>

            {mapFailed ? (
              <Text style={styles.mapErrorText}>
                The map could not be displayed. The store details below are still accurate.
              </Text>
            ) : null}

            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#3B82F6' }]} />
                <Text style={styles.legendText}>You</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.Error }]} />
                <Text style={styles.legendText}>Nearest store</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.Primary }]} />
                <Text style={styles.legendText}>Other stores</Text>
              </View>
            </View>

            {stores.length === 0 ? (
              <View style={styles.noticeCard}>
                <Ionicons name="storefront-outline" size={22} color={COLORS.TextSecondary} />
                <Text style={styles.noticeTitle}>No nearby stores</Text>
                <Text style={styles.noticeText}>
                  There are no Swachham stores within 100 km of your current location.
                </Text>
              </View>
            ) : (
              <>
                {nearest ? (
                  <View style={styles.nearestCard}>
                    <View style={styles.nearestBadge}>
                      <Ionicons name="star" size={12} color={COLORS.Surface} />
                      <Text style={styles.nearestBadgeText}>NEAREST STORE</Text>
                    </View>
                    <Text style={styles.nearestName}>{nearest.name}</Text>
                    {nearest.address ? (
                      <Text style={styles.nearestMeta}>{nearest.address}</Text>
                    ) : null}
                    <Text style={styles.nearestMeta}>
                      {[nearest.city, nearest.district, nearest.state, nearest.pincode]
                        .filter(Boolean)
                        .join(', ')}
                    </Text>
                    <Text style={styles.nearestDistance}>{nearest.distance_km} km away</Text>

                    {/* Hours are optional: a store that has not published them
                        shows nothing here rather than a made-up default. */}
                    {formatHours(nearest) ? (
                      <View style={styles.hoursRow}>
                        <Ionicons name="time-outline" size={14} color={COLORS.TextSecondary} />
                        <Text style={styles.hoursText}>{formatHours(nearest)}</Text>
                      </View>
                    ) : null}

                    <View style={styles.nearestActions}>
                      <TouchableOpacity
                        style={styles.directionsButton}
                        onPress={() => openDirections(nearest)}
                      >
                        <Ionicons name="navigate-outline" size={16} color={COLORS.Surface} />
                        <Text style={styles.directionsText}>Directions</Text>
                      </TouchableOpacity>
                      {nearest.contact_number ? (
                        <TouchableOpacity
                          style={styles.callButton}
                          onPress={() => Linking.openURL(`tel:${nearest.contact_number}`)}
                        >
                          <Ionicons name="call-outline" size={16} color={COLORS.Primary} />
                          <Text style={styles.callText}>Call</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {stores.length > 1 ? (
                  <>
                    <Text style={styles.sectionTitle}>Other nearby stores</Text>
                    {stores.slice(1).map((store) => (
                      <TouchableOpacity
                        key={store.id}
                        style={styles.storeRow}
                        onPress={() => openDirections(store)}
                        activeOpacity={0.8}
                      >
                        <View style={styles.storeIcon}>
                          <Ionicons name="storefront-outline" size={20} color={COLORS.Primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.storeName}>{store.name}</Text>
                          <Text style={styles.storeMeta}>
                            {[store.city, store.district].filter(Boolean).join(', ')}
                          </Text>
                        </View>
                        <Text style={styles.storeDistance}>{store.distance_km} km</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                ) : null}
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  hoursText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  locateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: 52,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
    ...SHADOWS.medium,
  },
  buttonDisabled: { opacity: 0.7 },
  locateButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.Surface,
  },
  hint: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  noticeCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.md,
    alignItems: 'center',
    ...SHADOWS.light,
  },
  noticeTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    marginTop: SPACING.xs,
  },
  noticeText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  noticeActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  noticeButton: {
    borderWidth: 2,
    borderColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  noticeButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.Primary,
  },
  mapCard: {
    height: 300,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    marginTop: SPACING.md,
    backgroundColor: COLORS.Surface,
    ...SHADOWS.light,
  },
  map: { flex: 1, backgroundColor: COLORS.Background },
  mapLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.Surface,
  },
  mapErrorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.Error,
    marginTop: SPACING.xs,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  nearestCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 2,
    borderColor: COLORS.Primary,
    padding: SPACING.md,
    ...SHADOWS.light,
  },
  nearestBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    marginBottom: SPACING.sm,
  },
  nearestBadgeText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },
  nearestName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  nearestMeta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },
  nearestDistance: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.PrimaryDark,
    marginTop: SPACING.xs,
  },
  nearestActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  directionsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  directionsText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.Surface,
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderColor: COLORS.Primary,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  callText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.Primary,
  },
  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.light,
  },
  storeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.Background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  storeMeta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },
  storeDistance: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.Primary,
  },
});
