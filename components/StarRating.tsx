/**
 * components/StarRating.tsx
 * ─────────────────────────────────────────────────────────────
 * Componente reutilizable de calificación por estrellas (1-5).
 *
 * Modos:
 *   • Interactivo: onChange definido → tap para seleccionar
 *   • Solo lectura: onChange omitido → muestra valor estático
 *
 * Uso:
 *   // Selector (modal de calificación)
 *   <StarRating value={estrellas} onChange={setEstrellas} size={40} />
 *
 *   // Display (tarjeta de negocio)
 *   <StarRating value={4.5} size={14} readonly />
 *   <StarRating value={4.5} size={14} count={123} readonly />
 * ─────────────────────────────────────────────────────────────
 */

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

interface Props {
  value:     number                    // valor actual (0 = ninguna)
  onChange?: (v: number) => void       // omitir para modo read-only
  size?:     number                    // tamaño de cada estrella (default 28)
  count?:    number                    // número de reseñas a mostrar entre paréntesis
  readonly?: boolean                   // fuerza modo lectura aunque haya onChange
}

export default function StarRating({
  value,
  onChange,
  size    = 28,
  count,
  readonly = false,
}: Props) {
  const interactivo = !!onChange && !readonly

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map(n => {
        // Para valores decimales (ej: 4.5), la estrella 5 aparece "medio llena"
        // Simplificación: mostramos llena si n <= Math.round(value)
        const activa = n <= Math.round(value)

        if (interactivo) {
          return (
            <TouchableOpacity
              key={n}
              onPress={() => onChange!(n)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            >
              <Text style={[styles.star, { fontSize: size }, activa && styles.starOn]}>
                ★
              </Text>
            </TouchableOpacity>
          )
        }

        return (
          <Text
            key={n}
            style={[styles.star, { fontSize: size }, activa && styles.starOn]}
          >
            ★
          </Text>
        )
      })}

      {count !== undefined && (
        <Text style={[styles.count, { fontSize: Math.max(size * 0.55, 11) }]}>
          ({count})
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', gap: 2 },
  star:   { color: '#E5E7EB' },
  starOn: { color: '#F59E0B' },
  count:  { color: '#9CA3AF', marginLeft: 4, fontWeight: '500' },
})
