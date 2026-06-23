import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';

type Props = {
  coords: { lat: number; lng: number } | null;
  destinoCoords?: { lat: number; lng: number } | null;
};

export default function MapaRepartidor({ coords, destinoCoords }: Props) {
  const mapRef        = useRef<any>(null);
  const pulseAnim     = useRef(new Animated.Value(1)).current;
  const fittedOnce    = useRef(false);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0,  duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    if (!coords || !mapRef.current) return;

    if (!fittedOnce.current && destinoCoords) {
      // Primera vez con ambos puntos: mostrar los dos en pantalla
      mapRef.current.fitToCoordinates(
        [
          { latitude: coords.lat,       longitude: coords.lng       },
          { latitude: destinoCoords.lat, longitude: destinoCoords.lng },
        ],
        { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }
      );
      fittedOnce.current = true;
    } else {
      // Actualizaciones siguientes: seguir al repartidor
      mapRef.current.animateToRegion(
        { latitude: coords.lat, longitude: coords.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 },
        800
      );
      if (!fittedOnce.current) fittedOnce.current = true;
    }
  }, [coords?.lat, coords?.lng]);

  if (!coords) return <SimuladoMapa pulseAnim={pulseAnim} />;

  return (
    <MapView
      ref={mapRef}
      style={s.mapa}
      mapType="none"
      initialRegion={{
        latitude:      coords.lat,
        longitude:     coords.lng,
        latitudeDelta: 0.012,
        longitudeDelta:0.012,
      }}
    >
      <UrlTile
        urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maximumZ={19}
        flipY={false}
        shouldReplaceMapContent
      />

      {/* Marcador repartidor (animado) */}
      <Marker coordinate={{ latitude: coords.lat, longitude: coords.lng }}>
        <Animated.View style={[s.markerRep, { transform: [{ scale: pulseAnim }] }]}>
          <Text style={{ fontSize: 22 }}>🏍️</Text>
        </Animated.View>
      </Marker>

      {/* Marcador destino (fijo) */}
      {destinoCoords && (
        <Marker
          coordinate={{ latitude: destinoCoords.lat, longitude: destinoCoords.lng }}
          anchor={{ x: 0.5, y: 1 }}
        >
          <View style={s.markerDestino}>
            <Text style={{ fontSize: 22 }}>📍</Text>
            <View style={s.markerDestinoPalo} />
          </View>
        </Marker>
      )}
    </MapView>
  );
}

function SimuladoMapa({ pulseAnim }: { pulseAnim: Animated.Value }) {
  return (
    <View style={s.simulado}>
      {[20, 42, 65, 85].map(p => (
        <View key={`h${p}`} style={[s.calleH, { top: `${p}%` as any }]} />
      ))}
      {[20, 42, 65, 85].map(p => (
        <View key={`v${p}`} style={[s.calleV, { left: `${p}%` as any }]} />
      ))}
      <View style={[s.pin, { top: '15%', left: '15%' }]}>
        <View style={[s.pinIcon, { backgroundColor: '#F97316' }]}><Text style={s.pinEmoji}>🍔</Text></View>
        <Text style={s.pinLabel}>Restaurante</Text>
      </View>
      <Animated.View style={[s.pin, { top: '42%', left: '45%' }, { transform: [{ scale: pulseAnim }] }]}>
        <View style={[s.pinIcon, s.pinRep]}><Text style={s.pinEmoji}>🏍️</Text></View>
        <Text style={s.pinLabel}>Repartidor</Text>
      </Animated.View>
      <View style={[s.pin, { top: '65%', left: '68%' }]}>
        <View style={[s.pinIcon, { backgroundColor: '#EF4444' }]}><Text style={s.pinEmoji}>📍</Text></View>
        <Text style={s.pinLabel}>Tu casa</Text>
      </View>
      <View style={s.tag}>
        <Text style={s.tagText}>⏳ Preparando tu pedido...</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  mapa:             { height: 230, width: '100%' },
  markerRep:        { backgroundColor: '#7C3AED', borderRadius: 28, padding: 8, borderWidth: 3, borderColor: '#FFF' },
  markerDestino:    { alignItems: 'center' },
  markerDestinoPalo:{ width: 2, height: 6, backgroundColor: '#EF4444', marginTop: -2 },
  simulado:         { height: 230, backgroundColor: '#A7F3D0', position: 'relative', overflow: 'hidden' },
  calleH:           { position: 'absolute', left: 0, right: 0, height: 10, backgroundColor: 'rgba(255,255,255,0.55)' },
  calleV:           { position: 'absolute', top: 0, bottom: 0, width: 10, backgroundColor: 'rgba(255,255,255,0.55)' },
  pin:              { position: 'absolute', alignItems: 'center' },
  pinIcon:          { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF' },
  pinRep:           { backgroundColor: '#7C3AED', width: 48, height: 48, borderRadius: 24, borderWidth: 3 },
  pinEmoji:         { fontSize: 20 },
  pinLabel:         { fontSize: 10, fontWeight: '700', color: '#1E0A3C', backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginTop: 3, overflow: 'hidden' },
  tag:              { position: 'absolute', bottom: 10, left: 10, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  tagText:          { fontSize: 11, color: '#374151', fontWeight: '600' },
});
