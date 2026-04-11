import React, { createContext, useContext, useState } from 'react';

interface ItemCarrito {
  id: string;
  nombre: string;
  precio: number;
  cantidad: number;
  emoji: string;
  tipo: 'delivery' | 'stay' | 'evento';
  detalle: string;
  negocio_id?: string;
}

interface CarritoContextType {
  items: ItemCarrito[];
  agregarItem: (item: Omit<ItemCarrito, 'cantidad'>) => void;
  quitarItem: (id: string) => void;
  aumentar: (id: string) => void;
  disminuir: (id: string) => void;
  eliminar: (id: string) => void;
  limpiarCarrito: () => void;
  getCantidad: (id: string) => number;
  totalItems: number;
}

const CarritoContext = createContext<CarritoContextType | null>(null);

export function CarritoProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ItemCarrito[]>([]);

  const agregarItem = (item: Omit<ItemCarrito, 'cantidad'>) => {
    setItems(prev => {
      const existe = prev.find(i => i.id === item.id);
      if (existe) return prev.map(i => i.id === item.id ? { ...i, cantidad: i.cantidad + 1 } : i);
      return [...prev, { ...item, cantidad: 1 }];
    });
  };

  const quitarItem = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, cantidad: Math.max(0, i.cantidad - 1) } : i).filter(i => i.cantidad > 0));
  };

  const aumentar = (id: string) => setItems(prev => prev.map(i => i.id === id ? { ...i, cantidad: i.cantidad + 1 } : i));
  const disminuir = (id: string) => setItems(prev => prev.map(i => i.id === id && i.cantidad > 1 ? { ...i, cantidad: i.cantidad - 1 } : i));
  const eliminar = (id: string) => setItems(prev => prev.filter(i => i.id !== id));
  const limpiarCarrito = () => setItems([]);
  const getCantidad = (id: string) => items.find(i => i.id === id)?.cantidad || 0;
  const totalItems = items.reduce((acc, i) => acc + i.cantidad, 0);

  return (
    <CarritoContext.Provider value={{ items, agregarItem, quitarItem, aumentar, disminuir, eliminar, limpiarCarrito, getCantidad, totalItems }}>
      {children}
    </CarritoContext.Provider>
  );
}

export function useCarrito() {
  const context = useContext(CarritoContext);
  if (!context) throw new Error('useCarrito debe usarse dentro de CarritoProvider');
  return context;
}