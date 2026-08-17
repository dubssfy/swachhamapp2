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

type Status =
  | 'idle'
  | 'locating'
  | 'loading'
  | 'ready'
  | 'permission_denied'
  | 'location_unavailable'
  | 'error';

interface Coords {
  latitude: number;
  longitude: number;
}

/**
 * Leaflet + OpenStreetMap rendered inside a WebView.
 *
 * react-native-webview is the only dependency this needs, it works on Android
 * without a provider API key, and it keeps the map self-contained: markers,
 * the user pin and the nearest-store highlight are all driven by the data the
 * backend returned.
 */
function buildMapHtml(user: Coords, stores: NearbyStore[]) {
  const payload = JSON.stringify({
    user,
    stores: stores.map((store, index) => ({
      name: store.name,
      address: store.address,
      latitude: store.latitude,
      longitude: store.longitude,
      distance_km: store.distance_km,
      nearest: index === 0,
    })),
  });

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #F8FFF9; }
  .pin-label { font: 600 12px -apple-system, Roboto, Helvetica, Arial, sans-serif; }
  #fallback { display: none; padding: 16px; font: 14px -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #6B7280; }
</style>
</head><body>
<div id="map"></div>
<div id="fallback">The map could not be loaded. The store list below is still available.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  (function () {
    var data = ${payload};

    function fail() {
      document.getElementById('map').style.display = 'none';
      document.getElementById('fallback').style.display = 'block';
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage('MAP_ERROR');
      }
    }

    if (typeof L === 'undefined') { fail(); return; }

    try {
      var map = L.map('map').setView([data.user.latitude, data.user.longitude], 11);

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      var bounds = [];

      // User location.
      L.circleMarker([data.user.latitude, data.user.longitude], {
        radius: 9, color: '#1D4ED8', fillColor: '#3B82F6', fillOpacity: 1, weight: 3
      }).addTo(map).bindPopup('<span class="pin-label">You are here</span>');
      bounds.push([data.user.latitude, data.user.longitude]);

      data.stores.forEach(function (store) {
        var colour = store.nearest ? '#E63946' : '#2D6A4F';
        L.circleMarker([store.latitude, store.longitude], {
          radius: store.nearest ? 11 : 8,
          color: colour,
          fillColor: colour,
          fillOpacity: 0.9,
          weight: store.nearest ? 4 : 2
        })
          .addTo(map)
          .bindPopup(
            '<span class="pin-label">' + store.name + (store.nearest ? ' (Nearest)' : '') + '</span><br/>' +
            (store.address ? store.address + '<br/>' : '') +
            store.distance_km + ' km away'
          );
        bounds.push([store.latitude, store.longitude]);
      });

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      }

      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage('MAP_READY');
      }
    } catch (e) {
      fail();
    }
  })();
</script>
</body></html>`;
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
