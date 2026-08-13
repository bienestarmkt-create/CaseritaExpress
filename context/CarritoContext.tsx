import React, { createContext, useContext, useState } from 'react';

interface ItemCarrito {
  id: string;
  nombre: string;
  precio: number;      // precio por unidad ya combinado (pasta + salsa si aplica)
  cantidad: number;
  emoji: string;
  tipo: 'delivery' | 'stay' | 'evento';
  detalle: string;
  negocio_id?: string;
  // ── Pasta + salsa obligatoria (ver app/delivery.tsx) ──────────
  // Cuando el producto requiere elegir salsa, `id` es compuesto
  // (`${productoId}__${salsaId}`) para que dos elecciones de salsa
  // distintas del mismo plato NO se fusionen en una sola línea con
  // cantidad sumada. `productoId` guarda el id real en `productos`
  // (el que va a detalle_pedidos.producto_id); si no está seteado,
  // `id` YA es el id real (comportamiento previo, sin cambios).
  productoId?: string;
  precioBase?: number; // precio de la pasta sola, sin la salsa
  salsa?: { id: string; nombre: string; precio: number };
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
  // Suma la cantidad de TODAS las líneas cuyo producto real (productoId
  // o, si no aplica, id) coincida — usado para el badge de cantidad de
  // platos con salsa, que pueden estar repartidos en varias líneas.
  getCantidadBase: (productoId: string) => number;
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
  const getCantidadBase = (productoId: string) =>
    items
      .filter(i => (i.productoId ?? i.id) === productoId)
      .reduce((acc, i) => acc + i.cantidad, 0);
  const totalItems = items.reduce((acc, i) => acc + i.cantidad, 0);

  return (
    <CarritoContext.Provider value={{ items, agregarItem, quitarItem, aumentar, disminuir, eliminar, limpiarCarrito, getCantidad, getCantidadBase, totalItems }}>
      {children}
    </CarritoContext.Provider>
  );
}

export function useCarrito() {
  const context = useContext(CarritoContext);
  if (!context) throw new Error('useCarrito debe usarse dentro de CarritoProvider');
  return context;
}