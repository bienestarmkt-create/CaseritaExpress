/**
 * components/MapaLeaflet.native.tsx
 * ─────────────────────────────────────────────────────────────
 * TANDA 2: Leaflet real (CDN unpkg) dentro de un WebView. Mismo
 * contrato de props que MapaLeaflet.web.tsx — sin Google Maps, sin
 * react-native-maps, sin API key.
 *
 * Comunicación RN <-> WebView (ver diagnóstico previo, A.2):
 *  - RN -> página: `injectJavaScript` llamando a funciones ya definidas
 *    en el HTML (`window.ceSetMarkers(...)`). Nunca se recarga el mapa
 *    ni se regenera el `source.html` para actualizar posiciones — el
 *    `html` se arma una sola vez (useMemo con deps vacías) y de ahí en
 *    más todo pasa por injectJavaScript sobre el mapa ya inicializado.
 *  - página -> RN: `window.ReactNativeWebView.postMessage(...)`, para
 *    el 'ready' inicial (evita la carrera de inyectar antes de que
 *    Leaflet termine de cargar desde el CDN) y para el modo editable
 *    (arrastrar/tocar el pin) vía onChange.
 * ─────────────────────────────────────────────────────────────
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

export type MapaLeafletMarker = {
  id:     string;
  lat:    number;
  lng:    number;
  emoji?: string;   // default '📍'
  label?: string;
};

export type MapaLeafletProps =
  | {
      mode:    'readonly';
      markers: MapaLeafletMarker[];
      height?: number;
    }
  | {
      mode:           'editable';
      initialCoords?: { lat: number; lng: number } | null;
      onChange:       (coords: { lat: number; lng: number }) => void;
      height?:        number;
    };

// Tarija — Plaza Principal. Centro por defecto cuando no hay ninguna
// coordenada real todavía (modo editable sin initialCoords, o readonly
// antes de recibir el primer marcador).
const CENTRO_DEFAULT = { lat: -21.5355, lng: -64.7296 };

function construirHtml(
  mode: 'readonly' | 'editable',
  centro: { lat: number; lng: number },
  zoom: number,
  pinInicial: { lat: number; lng: number } | null,
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #F3F4F6; }
    .ce-emoji-icon { font-size: 28px; line-height: 1; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4)); text-align: center; }
    .ce-badge {
      position: absolute; bottom: 10px; left: 10px; right: 10px; z-index: 1000;
      background: rgba(255,255,255,0.92); padding: 6px 10px; border-radius: 10px;
      text-align: center; font: 600 12px -apple-system, sans-serif; color: #374151;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  ${mode === 'editable' ? '<div id="badge" class="ce-badge">Tocá el mapa para marcar tu ubicación</div>' : ''}
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    (function () {
      var MODE = ${JSON.stringify(mode)};
      var map = L.map('map', { zoomControl: true, attributionControl: false })
        .setView([${centro.lat}, ${centro.lng}], ${zoom});

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      function makeIcon(emoji, anchorBottom) {
        return L.divIcon({
          html: '<div class="ce-emoji-icon">' + emoji + '</div>',
          iconSize: [30, 30],
          iconAnchor: anchorBottom ? [15, 30] : [15, 15],
          className: '',
        });
      }

      function post(msg) {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }

      // ── modo readonly: RN llama window.ceSetMarkers(json) vía injectJavaScript ──
      var markers = {};
      window.ceSetMarkers = function (markersJson) {
        var list = JSON.parse(markersJson);
        var seen = {};
        list.forEach(function (m) {
          seen[m.id] = true;
          if (markers[m.id]) {
            markers[m.id].setLatLng([m.lat, m.lng]);
          } else {
            var mk = L.marker([m.lat, m.lng], { icon: makeIcon(m.emoji || '📍', false) }).addTo(map);
            if (m.label) mk.bindTooltip(m.label, { permanent: false, direction: 'top' });
            markers[m.id] = mk;
          }
        });
        Object.keys(markers).forEach(function (id) {
          if (!seen[id]) { markers[id].remove(); delete markers[id]; }
        });
        var vals = list.map(function (m) { return [m.lat, m.lng]; });
        if (vals.length > 1) {
          map.fitBounds(vals, { padding: [40, 40] });
        } else if (vals.length === 1) {
          map.setView(vals[0], map.getZoom() < 14 ? 15 : map.getZoom(), { animate: true });
        }
      };

      // ── modo editable: tocar coloca, arrastrar ajusta, avisa a RN ──
      var editMarker = null;
      function colocarPin(lat, lng) {
        if (editMarker) {
          editMarker.setLatLng([lat, lng]);
        } else {
          editMarker = L.marker([lat, lng], { icon: makeIcon('📍', true), draggable: true }).addTo(map);
          editMarker.on('dragend', function () {
            var p = editMarker.getLatLng();
            post({ type: 'change', lat: p.lat, lng: p.lng });
          });
          var badge = document.getElementById('badge');
          if (badge) badge.textContent = 'Arrastrá el pin para ajustar';
        }
      }

      if (MODE === 'editable') {
        map.on('click', function (e) {
          colocarPin(e.latlng.lat, e.latlng.lng);
          post({ type: 'change', lat: e.latlng.lat, lng: e.latlng.lng });
        });
        ${pinInicial ? `colocarPin(${pinInicial.lat}, ${pinInicial.lng});` : ''}
      }

      post({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}

export default function MapaLeaflet(props: MapaLeafletProps) {
  const { mode, height = 230 } = props;
  const webRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const pendingMarkersRef = useRef<string | null>(null);

  // El HTML se arma UNA sola vez. Actualizarlo después recargaría el
  // WebView entero (parpadeo, se pierde el zoom/pan) — todo lo que
  // cambie después pasa por injectJavaScript sobre el mapa ya vivo.
  const html = useMemo(() => {
    const centro =
      mode === 'readonly'
        ? CENTRO_DEFAULT
        : (props.initialCoords ?? CENTRO_DEFAULT);
    const zoom = mode === 'editable' && !props.initialCoords ? 14 : 15;
    const pinInicial = mode === 'editable' ? (props.initialCoords ?? null) : null;
    return construirHtml(mode, centro, zoom, pinInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markersKey =
    mode === 'readonly'
      ? props.markers.map(m => `${m.id}:${m.lat.toFixed(6)}:${m.lng.toFixed(6)}:${m.emoji ?? ''}`).join('|')
      : '';

  useEffect(() => {
    if (mode !== 'readonly') return;
    const payload = JSON.stringify(props.markers);
    if (!ready) {
      pendingMarkersRef.current = payload;
      return;
    }
    webRef.current?.injectJavaScript(`window.ceSetMarkers(${JSON.stringify(payload)}); true;`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markersKey, ready]);

  const onMessage = (e: any) => {
    let msg: any;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }

    if (msg.type === 'ready') {
      setReady(true);
      // Si llegaron marcadores por Realtime antes de que Leaflet terminara
      // de cargar desde el CDN, se inyectan recién ahora — nada se pierde.
      if (pendingMarkersRef.current) {
        webRef.current?.injectJavaScript(`window.ceSetMarkers(${JSON.stringify(pendingMarkersRef.current)}); true;`);
        pendingMarkersRef.current = null;
      }
    } else if (msg.type === 'change' && mode === 'editable') {
      props.onChange({ lat: msg.lat, lng: msg.lng });
    }
  };

  return (
    <View style={[s.container, { height }]}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={onMessage}
        style={s.webview}
        javaScriptEnabled
        domStorageEnabled
      />
      {!ready && (
        <View style={s.loading} pointerEvents="none">
          <ActivityIndicator size="small" color="#9CA3AF" />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { width: '100%', position: 'relative', backgroundColor: '#F3F4F6' },
  webview:   { flex: 1, backgroundColor: 'transparent' },
  loading:   { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
