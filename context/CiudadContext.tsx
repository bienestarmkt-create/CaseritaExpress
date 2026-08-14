// context/CiudadContext.tsx
// Ciudad activa del cliente — hoy se DETECTA sola por geolocalización al
// abrir la app (ver GEOLOCALIZACIÓN AUTOMÁTICA DE CIUDAD), reemplazando
// los chips de selección manual. El selector manual (components/
// SelectorCiudad.tsx) sigue existiendo, pero ahora solo aparece como
// fallback: permiso denegado, geolocalización falló/hizo timeout, o el
// navegador no la soporta. Nunca deja al usuario trabado en una pantalla
// de carga (ver TAREA 4 del pedido).
//
// Orden de resolución al abrir la app:
//   1. Ciudad guardada en este dispositivo (AsyncStorage) y sigue activa
//      → se usa directo, sin pedir permiso de nuevo.
//   2. Si no, y hay sesión iniciada: ciudad guardada en el perfil
//      (`usuarios.ciudad`) y sigue activa → se usa y se cachea local.
//   3. Si no hay ninguna de las dos, se pide geolocalización:
//      a. Cae dentro del radio_km de una ciudad ACTIVA → se selecciona
//         sola, se persiste local y (si hay sesión) en el perfil.
//      b. Cae dentro del radio_km de una ciudad INACTIVA, o fuera de
//         todo radio conocido → estadoUbicacion='fuera_cobertura' (ver
//         components/FueraCobertura.tsx, captura el WhatsApp).
//      c. Permiso denegado / error / timeout (máx. 8s) / navegador sin
//         soporte → estadoUbicacion='manual' (selector manual).
//
// Las ciudades INACTIVAS (hoy Cochabamba, La Paz) existen en la tabla
// solo para poder nombrarlas en la pantalla de "todavía no llegamos" —
// nunca entran a `ciudadesActivas` ni aparecen en ningún selector.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { getCurrentPositionOnceWeb } from '../lib/geolocationWeb';
import { haversineKm } from '../lib/haversine';
import { supabase } from '../lib/supabase';

export type Ciudad = string;

const STORAGE_KEY = 'ce_ciudad_activa';
const TIMEOUT_UBICACION_MS = 8000;

interface CiudadRow {
  nombre:   string;
  activa:   boolean;
  latitud:  number | null;
  longitud: number | null;
  radio_km: number | null;
}

export type EstadoUbicacion =
  | 'detectando'       // resolviendo (fetch de ciudades + geolocalización)
  | 'resuelta'          // ciudad activa determinada, lista para navegar
  | 'fuera_cobertura'  // geo cayó en ciudad inactiva o fuera de todo radio
  | 'manual';           // sin geo (denegada/error/sin soporte) — elige el usuario

export interface FueraCobertura {
  ciudadDetectada: string | null; // null = fuera de todo radio conocido ("tu zona")
  lat: number;
  lon: number;
}

interface CiudadContextType {
  ciudad:             Ciudad | null; // null = sin ciudad activa válida todavía
  ciudadesActivas:    Ciudad[];
  cargando:           boolean;
  error:              string | null;
  estadoUbicacion:    EstadoUbicacion;
  fueraCobertura:     FueraCobertura | null;
  setCiudad:          (c: Ciudad) => void;
  usarSelectorManual: () => void; // salida de emergencia desde "fuera de cobertura"
}

const CiudadContext = createContext<CiudadContextType | null>(null);

// Ciudad activa más cercana DENTRO de su propio radio_km. Si ninguna
// activa cae en rango pero sí una inactiva, se nombra esa (para poder
// decir "todavía no llegamos a Cochabamba" en vez de "tu zona"). Radios
// de ciudades bolivianas activas hoy no se solapan entre sí, pero por
// las dudas gana la más cercana entre las candidatas de un mismo grupo.
function ciudadMasCercana(lat: number, lon: number, ciudades: CiudadRow[]) {
  let mejorActiva:   { nombre: string; dist: number } | null = null;
  let mejorInactiva: { nombre: string; dist: number } | null = null;

  for (const c of ciudades) {
    if (c.latitud == null || c.longitud == null || c.radio_km == null) continue;
    const dist = haversineKm(lat, lon, c.latitud, c.longitud);
    if (dist > c.radio_km) continue;
    if (c.activa) {
      if (!mejorActiva || dist < mejorActiva.dist) mejorActiva = { nombre: c.nombre, dist };
    } else {
      if (!mejorInactiva || dist < mejorInactiva.dist) mejorInactiva = { nombre: c.nombre, dist };
    }
  }

  if (mejorActiva)   return { nombre: mejorActiva.nombre,   activa: true as const };
  if (mejorInactiva) return { nombre: mejorInactiva.nombre, activa: false as const };
  return null;
}

// Persiste la ciudad en el perfil del usuario logueado — best-effort: si
// no hay sesión, o el update falla, no bloquea nada (AsyncStorage ya
// guardó la preferencia en este dispositivo). Esto es solo para que un
// usuario que vuelve a loguearse en OTRO dispositivo no tenga que pasar
// por el selector/geolocalización de nuevo.
async function guardarCiudadEnPerfil(c: Ciudad) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { error } = await supabase.from('usuarios').update({ ciudad: c }).eq('id', session.user.id);
    if (error) console.error('[CiudadContext] Error guardando ciudad en perfil', error.message);
  } catch (e) {
    console.error('[CiudadContext] Error guardando ciudad en perfil', e);
  }
}

export function CiudadProvider({ children }: { children: React.ReactNode }) {
  const [ciudad, setCiudadState]              = useState<Ciudad | null>(null);
  const [ciudadesActivas, setCiudadesActivas] = useState<Ciudad[]>([]);
  const [cargando, setCargando]               = useState(true);
  const [error, setError]                     = useState<string | null>(null);
  const [estadoUbicacion, setEstadoUbicacion] = useState<EstadoUbicacion>('detectando');
  const [fueraCobertura, setFueraCobertura]   = useState<FueraCobertura | null>(null);

  useEffect(() => {
    async function init() {
      const guardada = await AsyncStorage.getItem(STORAGE_KEY);

      const { data, error: fetchError } = await supabase
        .from('ciudades')
        .select('nombre, activa, latitud, longitud, radio_km')
        .order('nombre');

      if (fetchError) {
        console.error('[CiudadContext] Error cargando ciudades', fetchError.message);
        setError('No se pudo verificar la lista de ciudades. Revisá tu conexión.');
        // Sin conexión no podemos validar nada (ni la guardada ni pedir
        // geo con sentido) — si había una guardada, se navega con esa en
        // vez de trabar al usuario; si no, selector manual (vacío, pero
        // con el error visible — ver SelectorCiudad.tsx).
        if (guardada) {
          setCiudadesActivas([guardada]);
          setCiudadState(guardada);
          setEstadoUbicacion('resuelta');
        } else {
          setEstadoUbicacion('manual');
        }
        setCargando(false);
        return;
      }

      const filas: CiudadRow[] = data ?? [];
      const activas = filas.filter(c => c.activa).map(c => c.nombre);
      setCiudadesActivas(activas);
      setError(null);

      if (guardada && activas.includes(guardada)) {
        setCiudadState(guardada);
        setEstadoUbicacion('resuelta');
        setCargando(false);
        return;
      }

      // Sin ciudad guardada en el dispositivo — probar con la del perfil
      // (usuario logueado en otro dispositivo antes).
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: perfil } = await supabase.from('usuarios').select('ciudad').eq('id', session.user.id).maybeSingle();
          if (perfil?.ciudad && activas.includes(perfil.ciudad)) {
            setCiudadState(perfil.ciudad);
            AsyncStorage.setItem(STORAGE_KEY, perfil.ciudad).catch(() => {});
            setEstadoUbicacion('resuelta');
            setCargando(false);
            return;
          }
        }
      } catch (e) {
        console.error('[CiudadContext] Error leyendo ciudad del perfil', e);
        // No es fatal — se sigue al flujo de geolocalización normal.
      }

      // Sin ciudad guardada ni en perfil → detectar por geolocalización.
      // Solo hay soporte web (navigator.geolocation, ver
      // lib/geolocationWeb.ts) — la app corre hoy como sitio
      // (caseritaexpress.com). En un build nativo sin soporte se cae
      // directo al selector manual, nunca bloquea.
      if (Platform.OS !== 'web') {
        setEstadoUbicacion('manual');
        setCargando(false);
        return;
      }

      try {
        const { lat, lng } = await getCurrentPositionOnceWeb(TIMEOUT_UBICACION_MS);
        const match = ciudadMasCercana(lat, lng, filas);
        if (match?.activa) {
          setCiudadState(match.nombre);
          AsyncStorage.setItem(STORAGE_KEY, match.nombre).catch(() => {});
          guardarCiudadEnPerfil(match.nombre);
          setEstadoUbicacion('resuelta');
        } else {
          setFueraCobertura({ ciudadDetectada: match?.nombre ?? null, lat, lon: lng });
          setEstadoUbicacion('fuera_cobertura');
        }
      } catch {
        // Permiso denegado, timeout o sin soporte — nunca bloquea: cae
        // al selector manual (cero fallback silencioso: el usuario ve el
        // selector y elige él mismo, no se le asigna una ciudad al azar).
        setEstadoUbicacion('manual');
      }
      setCargando(false);
    }

    init().catch(e => {
      console.error('[CiudadContext] Error inicializando ciudad', e);
      setError('No se pudo cargar tu ciudad guardada.');
      setEstadoUbicacion('manual');
      setCargando(false);
    });
  }, []);

  const setCiudad = (c: Ciudad) => {
    setCiudadState(c);
    setFueraCobertura(null);
    setEstadoUbicacion('resuelta');
    AsyncStorage.setItem(STORAGE_KEY, c).catch(e =>
      console.error('[CiudadContext] Error guardando ciudad', e)
    );
    guardarCiudadEnPerfil(c);
  };

  const usarSelectorManual = () => {
    setFueraCobertura(null);
    setEstadoUbicacion('manual');
  };

  return (
    <CiudadContext.Provider value={{ ciudad, ciudadesActivas, cargando, error, estadoUbicacion, fueraCobertura, setCiudad, usarSelectorManual }}>
      {children}
    </CiudadContext.Provider>
  );
}

export function useCiudad() {
  const ctx = useContext(CiudadContext);
  if (!ctx) throw new Error('useCiudad debe usarse dentro de CiudadProvider');
  return ctx;
}
