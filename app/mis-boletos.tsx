/**
 * app/mis-boletos.tsx
 * Lista de todos los boletos del cliente (los 3 módulos juntos).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { TIPO_LABEL, ESTADO_LABEL, type Boleto } from '../lib/boletos';

const ESTADO_COLOR: Record<string, string> = {
  emitido: '#16A34A',
  usado:   '#9CA3AF',
  vencido: '#F59E0B',
  anulado: '#EF4444',
};

export default function MisBoletosScreen() {
  const router = useRouter();
  const [boletos, setBoletos]     = useState<Boleto[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setErrorMsg('Iniciá sesión para ver tus boletos.'); return; }

    const { data, error } = await supabase
      .from('boletos')
      .select('*')
      .eq('usuario_id', user.id)
      .order('fecha_emision', { ascending: false });

    if (error) {
      console.error('[mis-boletos] Error cargando boletos', error.message);
      setErrorMsg('No se pudieron cargar tus boletos. Revisá tu conexión.');
    } else {
      setErrorMsg(null);
      setBoletos((data ?? []) as Boleto[]);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color="#6B21A8" />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <LinearGradient colors={['#1E0A3C', '#6B21A8']} style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>🎟️ Mis boletos</Text>
      </LinearGradient>

      {errorMsg ? (
        <TouchableOpacity style={s.avisoBox} onPress={cargar} activeOpacity={0.7}>
          <Text style={s.avisoText}>⚠️ {errorMsg} Tocá para reintentar.</Text>
        </TouchableOpacity>
      ) : null}

      <FlatList
        data={boletos}
        keyExtractor={item => item.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); cargar(); }} tintColor="#6B21A8" />}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card} onPress={() => router.push({ pathname: '/mi-boleto' as any, params: { codigo: item.codigo } })} activeOpacity={0.8}>
            <View style={s.cardLeft}>
              <Text style={s.cardTipo}>{TIPO_LABEL[item.tipo]}</Text>
              <Text style={s.cardCodigo}>{item.codigo}</Text>
              <Text style={s.cardMonto}>Bs. {Number(item.monto).toFixed(2)}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: (ESTADO_COLOR[item.estado] ?? '#9CA3AF') + '20' }]}>
              <Text style={[s.badgeText, { color: ESTADO_COLOR[item.estado] ?? '#9CA3AF' }]}>{ESTADO_LABEL[item.estado]}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !errorMsg ? (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🎟️</Text>
              <Text style={s.emptyTitle}>Todavía no tenés boletos</Text>
              <Text style={s.emptySub}>Cuando confirmes un pago, tu boleto aparece acá.</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7FF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F7FF' },
  header: { paddingTop: 55, paddingBottom: 24, paddingHorizontal: 20 },
  backBtn: { marginBottom: 12 },
  backText: { color: '#DDD6FE', fontSize: 14 },
  headerTitle: { fontSize: 24, fontWeight: '900', color: '#FFF' },
  avisoBox: { backgroundColor: '#FEF3C7', margin: 16, borderRadius: 10, padding: 12 },
  avisoText: { fontSize: 13, color: '#92400E', fontWeight: '600' },
  list: { padding: 16, paddingBottom: 40, gap: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFF', borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardLeft: { gap: 2 },
  cardTipo: { fontSize: 12, color: '#9CA3AF', fontWeight: '700' },
  cardCodigo: { fontSize: 17, fontWeight: '900', color: '#1E0A3C', letterSpacing: 1 },
  cardMonto: { fontSize: 13, color: '#6B7280' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 80, gap: 10, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#1E0A3C' },
  emptySub: { fontSize: 13, color: '#6B7280', textAlign: 'center' },
});
