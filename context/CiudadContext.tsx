// context/CiudadContext.tsx
// Ciudad activa del cliente — persistida en AsyncStorage, cambiable desde
// perfil.tsx. Todos los listados (delivery/stay/eventos) se filtran por
// esta ciudad. Ver supabase/migrations/20260804000300_ciudad_check_index.sql.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

export const CIUDADES_DISPONIBLES = ['Tarija', 'Santa Cruz'] as const;
export type Ciudad = typeof CIUDADES_DISPONIBLES[number];

const STORAGE_KEY = 'ce_ciudad_activa';

interface CiudadContextType {
  ciudad: Ciudad | null; // null = todavía no se resolvió el storage (primer arranque)
  cargando: boolean;
  setCiudad: (c: Ciudad) => void;
}

const CiudadContext = createContext<CiudadContextType | null>(null);

export function CiudadProvider({ children }: { children: React.ReactNode }) {
  const [ciudad, setCiudadState] = useState<Ciudad | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(valor => {
        if (valor && (CIUDADES_DISPONIBLES as readonly string[]).includes(valor)) {
          setCiudadState(valor as Ciudad);
        }
      })
      .catch(e => console.error('[CiudadContext] Error leyendo ciudad guardada', e))
      .finally(() => setCargando(false));
  }, []);

  const setCiudad = (c: Ciudad) => {
    setCiudadState(c);
    AsyncStorage.setItem(STORAGE_KEY, c).catch(e =>
      console.error('[CiudadContext] Error guardando ciudad', e)
    );
  };

  return (
    <CiudadContext.Provider value={{ ciudad, cargando, setCiudad }}>
      {children}
    </CiudadContext.Provider>
  );
}

export function useCiudad() {
  const ctx = useContext(CiudadContext);
  if (!ctx) throw new Error('useCiudad debe usarse dentro de CiudadProvider');
  return ctx;
}
