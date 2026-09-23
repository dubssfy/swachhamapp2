
/**
 * The Store Locator map, shared by the business and customer locators.
 *
 * Extracted so both screens draw the same map from the same code: the markers,
 * the user pin and the nearest-store highlight should not be able to drift
 * apart between the two. It is a pure function of its arguments — it renders
 * no React and reaches for nothing outside — so it is safe to call from
 * either screen.
 */
/**
 * Just the fields the map draws. Declared structurally so both locators can
 * pass their own store type without a cast: the business one's `NearbyStore`
 * and the customer one's `PublicStore` both satisfy it.
 */
export interface MappableStore {
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  distance_km?: number;
}

export interface Coords {
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
export function buildMapHtml(user: Coords, stores: MappableStore[]) {
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
