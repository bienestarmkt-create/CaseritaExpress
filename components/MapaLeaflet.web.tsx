/**
 * components/MapaLeaflet.web.tsx
 * ─────────────────────────────────────────────────────────────
 * Mapa Leaflet + OpenStreetMap para web/PWA (Safari iPhone incluido).
 * Leaflet corre directo en el DOM del navegador — sin WebView, sin
 * API key, sin costo.
 *
 * Dos modos:
 *  - readonly:  pinta `markers[]`, sin interacción. Sigue a un único
 *               marcador si es el único presente (uso: repartidor en vivo).
 *  - editable:  el usuario toca el mapa para colocar un pin arrastrable;
 *               cada colocación/arrastre dispara onChange(lat, lng).
 * ─────────────────────────────────────────────────────────────
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
// coordenada real todavía (modo editable sin initialCoords).
const CENTRO_DEFAULT = { lat: -21.5355, lng: -64.7296 };

function crearIcono(L: any, emoji: string, anchorBottom = false) {
  return L.divIcon({
    html: `<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4))">${emoji}</div>`,
    iconSize:   [30, 30],
    iconAnchor: anchorBottom ? [15, 30] : [15, 15],
    className:  '',
  });
}

export default function MapaLeaflet(props: MapaLeafletProps) {
  const { mode, height = 230 } = props;
  const [ready, setReady] = useState(false);

  const mapRef       = useRef<any>(null);
  const markersRef    = useRef<Map<string, any>>(new Map());
  const editMarkerRef = useRef<any>(null);
  const leafletRef    = useRef<any>(null);

  // Cargar CSS de Leaflet una sola vez
  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id    = 'leaflet-css';
      link.rel   = 'stylesheet';
      link.href  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    setReady(true);
  }, []);

  // Inicializar mapa (una sola vez)
  useEffect(() => {
    if (!ready) return;

    const init = async () => {
      const L  = (await import('leaflet')).default;
      leafletRef.current = L;
      const el = document.getElementById('ce-mapa-leaflet');
      if (!el || mapRef.current) return;

      mapRef.current = L.map(el, { zoomControl: true, attributionControl: false });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
        .addTo(mapRef.current);

      if (mode === 'readonly') {
        const ms = props.markers;
        if (ms.length > 1) {
          mapRef.current.fitBounds(ms.map(m => [m.lat, m.lng]), { padding: [40, 40] });
        } else if (ms.length === 1) {
          mapRef.current.setView([ms[0].lat, ms[0].lng], 15);
        } else {
          mapRef.current.setView([CENTRO_DEFAULT.lat, CENTRO_DEFAULT.lng], 13);
        }
      } else {
        const centro = props.initialCoords ?? CENTRO_DEFAULT;
        mapRef.current.setView([centro.lat, centro.lng], props.initialCoords ? 16 : 14);

        if (props.initialCoords) {
          editMarkerRef.current = crearMarcadorEditable(L, mapRef.current, props.initialCoords, props.onChange);
        }

        // Tocar el mapa coloca (o mueve) el pin
        mapRef.current.on('click', (e: any) => {
          const { lat, lng } = e.latlng;
          if (editMarkerRef.current) {
            editMarkerRef.current.setLatLng([lat, lng]);
          } else {
            editMarkerRef.current = crearMarcadorEditable(L, mapRef.current, { lat, lng }, props.onChange);
          }
          props.onChange({ lat, lng });
        });
      }
    };

    init();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current      = null;
        markersRef.current.clear();
        editMarkerRef.current = null;
      }
    };
  }, [ready]);

  function crearMarcadorEditable(
    L: any,
    map: any,
    coords: { lat: number; lng: number },
    onChange: (c: { lat: number; lng: number }) => void,
  ) {
    const marker = L.marker([coords.lat, coords.lng], {
      icon: crearIcono(L, '📍', true),
      draggable: true,
    }).addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      onChange({ lat: p.lat, lng: p.lng });
    });
    return marker;
  }

  // Actualizar marcadores en modo readonly cuando cambian las props
  const markersKey = mode === 'readonly'
    ? props.markers.map(m => `${m.id}:${m.lat.toFixed(6)}:${m.lng.toFixed(6)}`).join('|')
    : '';

  useEffect(() => {
    if (mode !== 'readonly' || !mapRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const seen = new Set<string>();

    props.markers.forEach(m => {
      seen.add(m.id);
      const existente = markersRef.current.get(m.id);
      if (existente) {
        existente.setLatLng([m.lat, m.lng]);
      } else {
        const marker = L.marker([m.lat, m.lng], { icon: crearIcono(L, m.emoji ?? '📍') }).addTo(mapRef.current);
        if (m.label) marker.bindTooltip(m.label, { permanent: false, direction: 'top' });
        markersRef.current.set(m.id, marker);
      }
    });

    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Si solo hay un marcador (típico: repartidor en vivo), el mapa lo sigue.
    if (props.markers.length === 1) {
      mapRef.current.setView([props.markers[0].lat, props.markers[0].lng], mapRef.current.getZoom() ?? 15, { animate: true });
    }
  }, [markersKey]);

  return (
    <View style={[s.container, { height }]}>
      {/* @ts-ignore - div es válido en contexto web */}
      <div id="ce-mapa-leaflet" style={{ height: '100%', width: '100%' }} />
      {mode === 'editable' && (
        <View style={s.badge}>
          <Text style={s.badgeTxt}>Tocá el mapa para marcar tu ubicación</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { width: '100%', position: 'relative' },
  badge: {
    position: 'absolute', bottom: 10, left: 10, right: 10,
    backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, alignItems: 'center',
  },
  badgeTxt: { fontSize: 12, color: '#374151', fontWeight: '600' },
});
