// context/CiudadContext.tsx
// Ciudad activa del cliente — persistida en AsyncStorage, cambiable desde
// perfil.tsx. Todos los listados (delivery/stay/eventos) se filtran por
// esta ciudad. Las ciudades disponibles ya no son una constante fija:
// vienen de la tabla `ciudades` (solo las activas se ofrecen como
// opción — ver supabase/migrations/20260805000000_tabla_ciudades.sql).
//
// Si la ciudad guardada en el dispositivo dejó de estar activa (o nunca
// se guardó ninguna), `ciudad` queda en null a propósito — eso hace que
// se muestre el selector de nuevo. Nunca se reasigna sola a otra ciudad.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type Ciudad = string;

const STORAGE_KEY = 'ce_ciudad_activa';

interface CiudadContextType {
  ciudad:          Ciudad | null; // null = sin ciudad activa válida (primer arranque, o la guardada quedó inactiva)
  ciudadesActivas: Ciudad[];
  cargando:        boolean;
  error:           string | null;
  setCiudad:       (c: Ciudad) => void;
}

const CiudadContext = createContext<CiudadContextType | null>(null);

export function CiudadProvider({ children }: { children: React.ReactNode }) {
  const [ciudad, setCiudadState]         = useState<Ciudad | null>(null);
  const [ciudadesActivas, setCiudadesActivas] = useState<Ciudad[]>([]);
  const [cargando, setCargando]          = useState(true);
  const [error, setError]                = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const guardada = await AsyncStorage.getItem(STORAGE_KEY);

      const { data, error: fetchError } = await supabase
        .from('ciudades')
        .select('nombre')
        .eq('activa', true)
        .order('nombre');

      if (fetchError) {
        console.error('[CiudadContext] Error cargando ciudades activas', fetchError.message);
        setError('No se pudo verificar la lista de ciudades. Revisá tu conexión.');
        // Sin conexión no podemos validar si la ciudad guardada sigue
        // activa — mejor dejarlo navegar con la última conocida que
        // trabarlo en un selector vacío.
        if (guardada) {
          setCiudadesActivas([guardada]);
          setCiudadState(guardada);
        }
        setCargando(false);
        return;
      }

      const activas = (data ?? []).map(c => c.nombre);
      setCiudadesActivas(activas);
      setError(null);

      // Si `guardada` no está en `activas` (nunca se guardó, o la
      // ciudad pasó a inactiva) queda ciudad=null a propósito.
      if (guardada && activas.includes(guardada)) {
        setCiudadState(guardada);
      }
      setCargando(false);
    }

    init().catch(e => {
      console.error('[CiudadContext] Error inicializando ciudad', e);
      setError('No se pudo cargar tu ciudad guardada.');
      setCargando(false);
    });
  }, []);

  const setCiudad = (c: Ciudad) => {
    setCiudadState(c);
    AsyncStorage.setItem(STORAGE_KEY, c).catch(e =>
      console.error('[CiudadContext] Error guardando ciudad', e)
    );
  };

  return (
    <CiudadContext.Provider value={{ ciudad, ciudadesActivas, cargando, error, setCiudad }}>
      {children}
    </CiudadContext.Provider>
  );
}

export function useCiudad() {
  const ctx = useContext(CiudadContext);
  if (!ctx) throw new Error('useCiudad debe usarse dentro de CiudadProvider');
  return ctx;
}
