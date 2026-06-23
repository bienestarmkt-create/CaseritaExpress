import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  coords: { lat: number; lng: number } | null;
  destinoCoords?: { lat: number; lng: number } | null;
};

export default function MapaRepartidor({ coords, destinoCoords }: Props) {
  const [ready, setReady]           = useState(false);
  const mapRef                      = useRef<any>(null);
  const repMarkerRef                = useRef<any>(null);
  const destinoMarkerRef            = useRef<any>(null);

  // Cargar CSS de Leaflet una sola vez
  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link    = document.createElement('link');
      link.id       = 'leaflet-css';
      link.rel      = 'stylesheet';
      link.href     = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    setReady(true);
  }, []);

  // Inicializar mapa (una sola vez, cuando hay coords del repartidor)
  useEffect(() => {
    if (!ready || !coords) return;

    const init = async () => {
      const L  = (await import('leaflet')).default;
      const el = document.getElementById('ce-mapa-web');
      if (!el || mapRef.current) return;

      // Calcular vista inicial: si hay destino, mostrar ambos puntos
      if (destinoCoords) {
        mapRef.current = L.map(el, { zoomControl: true, attributionControl: false });
        mapRef.current.fitBounds(
          [[coords.lat, coords.lng], [destinoCoords.lat, destinoCoords.lng]],
          { padding: [40, 40] }
        );
      } else {
        mapRef.current = L.map(el, { zoomControl: true, attributionControl: false })
          .setView([coords.lat, coords.lng], 15);
      }

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
        .addTo(mapRef.current);

      // Icono repartidor
      const repIcon = L.divIcon({
        html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4))">🏍️</div>',
        iconSize:   [30, 30],
        iconAnchor: [15, 15],
        className:  '',
      });
      repMarkerRef.current = L.marker([coords.lat, coords.lng], { icon: repIcon })
        .addTo(mapRef.current);

      // Icono destino
      if (destinoCoords) {
        const destIcon = L.divIcon({
          html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4))">📍</div>',
          iconSize:   [30, 30],
          iconAnchor: [15, 30],
          className:  '',
        });
        destinoMarkerRef.current = L.marker([destinoCoords.lat, destinoCoords.lng], { icon: destIcon })
          .bindTooltip('Dirección de entrega', { permanent: false, direction: 'top' })
          .addTo(mapRef.current);
      }
    };

    init();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current        = null;
        repMarkerRef.current  = null;
        destinoMarkerRef.current = null;
      }
    };
  }, [ready]);

  // Actualizar posición del repartidor en cada update
  useEffect(() => {
    if (!mapRef.current || !coords) return;
    mapRef.current.setView([coords.lat, coords.lng], 15, { animate: true });
    repMarkerRef.current?.setLatLng([coords.lat, coords.lng]);
  }, [coords?.lat, coords?.lng]);

  if (!coords) {
    return (
      <View style={s.simulado}>
        <Text style={s.simuladoEmoji}>🏍️</Text>
        <Text style={s.simuladoTxt}>⏳ Preparando tu pedido...</Text>
        <Text style={s.simuladoSub}>El mapa GPS aparecerá cuando el repartidor esté en camino</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* @ts-ignore - div is valid in web context */}
      <div id="ce-mapa-web" style={{ height: '100%', width: '100%' }} />
      <View style={s.badge}>
        <Text style={s.badgeTxt}>📍 GPS en tiempo real</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container:      { height: 230, width: '100%', position: 'relative' },
  simulado:       { height: 230, backgroundColor: '#A7F3D0', alignItems: 'center', justifyContent: 'center', gap: 8 },
  simuladoEmoji:  { fontSize: 48 },
  simuladoTxt:    { fontSize: 14, fontWeight: '700', color: '#1E0A3C' },
  simuladoSub:    { fontSize: 11, color: '#374151', textAlign: 'center', paddingHorizontal: 20 },
  badge:          { position: 'absolute', bottom: 10, left: 10, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeTxt:       { fontSize: 11, color: '#374151', fontWeight: '600' },
});
