/**
 * components/MapaLeaflet.native.tsx
 * ─────────────────────────────────────────────────────────────
 * TANDA 1 (temporal): mismo contrato de props que MapaLeaflet.web.tsx,
 * pero por dentro sigue usando react-native-maps + tiles de OpenStreetMap
 * (cero costo, cero API key, ya estaba instalado) en vez de Leaflet real.
 *
 * Motivo: Leaflet es una librería DOM — en nativo solo puede correr dentro
 * de un WebView, y `react-native-webview` todavía no está instalado (eso
 * es Tanda 2, porque exige un build nuevo de EAS). Este shim evita romper
 * la resolución de módulos por plataforma (Metro busca `.native.tsx` para
 * Android/iOS) sin agregar dependencias nuevas ni requerir build nativo:
 * la Tanda 1 entra por OTA.
 *
 * Tanda 2 reemplaza el contenido de este archivo por un WebView con
 * Leaflet real (mismo nombre, mismo contrato de props, cero cambios en
 * los llamadores) y retira react-native-maps del proyecto.
 * ─────────────────────────────────────────────────────────────
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';

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

export default function MapaLeaflet(props: MapaLeafletProps) {
  const { mode, height = 230 } = props;
  const mapRef        = useRef<MapView>(null);
  const fittedOnce     = useRef(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    mode === 'editable' ? props.initialCoords ?? null : null,
  );

  const markers = mode === 'readonly' ? props.markers : [];

  // Seguir al marcador cuando hay uno solo (repartidor en vivo) o
  // encuadrar todos cuando hay más de uno (repartidor + destino).
  useEffect(() => {
    if (mode !== 'readonly' || !mapRef.current || markers.length === 0) return;

    if (markers.length > 1) {
      mapRef.current.fitToCoordinates(
        markers.map(m => ({ latitude: m.lat, longitude: m.lng })),
        { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
      );
      fittedOnce.current = true;
    } else if (fittedOnce.current) {
      mapRef.current.animateToRegion(
        { latitude: markers[0].lat, longitude: markers[0].lng, latitudeDelta: 0.008, longitudeDelta: 0.008 },
        800,
      );
    } else {
      fittedOnce.current = true;
    }
  }, [mode, JSON.stringify(markers.map(m => [m.id, m.lat, m.lng]))]);

  const onPressMapa = (e: any) => {
    if (mode !== 'editable') return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const coords = { lat: latitude, lng: longitude };
    setPin(coords);
    props.onChange(coords);
  };

  const onDragEndPin = (e: any) => {
    if (mode !== 'editable') return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const coords = { lat: latitude, lng: longitude };
    setPin(coords);
    props.onChange(coords);
  };

  const centroInicial =
    mode === 'readonly'
      ? (markers[0] ?? CENTRO_DEFAULT)
      : (props.initialCoords ?? CENTRO_DEFAULT);

  return (
    <View style={[s.container, { height }]}>
      <MapView
        ref={mapRef}
        style={s.mapa}
        mapType="none"
        onPress={mode === 'editable' ? onPressMapa : undefined}
        initialRegion={{
          latitude:       centroInicial.lat,
          longitude:      centroInicial.lng,
          latitudeDelta:  mode === 'editable' && !pin ? 0.03 : 0.012,
          longitudeDelta: mode === 'editable' && !pin ? 0.03 : 0.012,
        }}
      >
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          flipY={false}
          shouldReplaceMapContent
        />

        {mode === 'readonly' && markers.map(m => (
          <Marker key={m.id} coordinate={{ latitude: m.lat, longitude: m.lng }} anchor={{ x: 0.5, y: m.emoji === '📍' ? 1 : 0.5 }}>
            <Text style={{ fontSize: 26 }}>{m.emoji ?? '📍'}</Text>
          </Marker>
        ))}

        {mode === 'editable' && pin && (
          <Marker
            coordinate={{ latitude: pin.lat, longitude: pin.lng }}
            draggable
            onDragEnd={onDragEndPin}
            anchor={{ x: 0.5, y: 1 }}
          >
            <Text style={{ fontSize: 30 }}>📍</Text>
          </Marker>
        )}
      </MapView>

      {mode === 'editable' && (
        <View style={s.badge}>
          <Text style={s.badgeTxt}>
            {pin ? 'Arrastrá el pin para ajustar' : 'Tocá el mapa para marcar tu ubicación'}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { width: '100%', position: 'relative' },
  mapa:      { flex: 1 },
  badge: {
    position: 'absolute', bottom: 10, left: 10, right: 10,
    backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, alignItems: 'center',
  },
  badgeTxt: { fontSize: 12, color: '#374151', fontWeight: '600' },
});
