// supabase/functions/liquidacion-nocturna/index.ts
// Agrega pedidos entregados del día por negocio e inserta en liquidaciones_diarias.
// Debe invocarse vía pg_cron o Supabase Scheduled Functions cada noche.
//
// Columnas necesarias en pedidos: costo_envio, estado_pago, negocio_id
// Tabla necesaria: liquidaciones_diarias (ver sql/migration_pago_altoke.sql)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Rango del día anterior (Bolivia UTC-4)
    const ahora = new Date()
    const hoy = new Date(ahora.getTime() - 4 * 60 * 60 * 1000)
    const fechaHoy = hoy.toISOString().slice(0, 10)
    const inicioHoy = `${fechaHoy}T00:00:00+00:00`
    const finHoy    = `${fechaHoy}T23:59:59+00:00`

    // Pedidos entregados del día con pago QR verificado
    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select('id, negocio_id, subtotal, costo_envio, total, negocios(usuario_id)')
      .eq('estado', 'entregado')
      .eq('estado_pago', 'pagado_qr')
      .gte('created_at', inicioHoy)
      .lte('created_at', finHoy)

    if (error) throw error

    if (!pedidos || pedidos.length === 0) {
      return json({ mensaje: 'Sin pedidos para liquidar', fecha: fechaHoy, liquidaciones: 0 })
    }

    // Agrupar por negocio
    const porNegocio = new Map<string, {
      negocioId: string;
      usuarioId: string;
      pedidoIds: string[];
      totalVentas: number;
      totalEnvio: number;
      totalLiquido: number;
    }>()

    for (const p of pedidos as any[]) {
      const negocioId = p.negocio_id as string
      const usuarioId = (p.negocios as { usuario_id: string } | null)?.usuario_id ?? ''
      if (!negocioId) continue

      const subtotal   = parseFloat(p.subtotal ?? p.total ?? 0)
      const costoEnvio = parseFloat(p.costo_envio ?? 0)

      if (!porNegocio.has(negocioId)) {
        porNegocio.set(negocioId, {
          negocioId,
          usuarioId,
          pedidoIds: [],
          totalVentas: 0,
          totalEnvio:  0,
          totalLiquido: 0,
        })
      }
      const entry = porNegocio.get(negocioId)!
      entry.pedidoIds.push(p.id)
      entry.totalVentas  += subtotal
      entry.totalEnvio   += costoEnvio
      entry.totalLiquido += subtotal  // envío es ingreso de CaseritaExpress, no del negocio
    }

    // Insertar liquidaciones y marcar pedidos como liquidados
    const inserts = []
    for (const entry of porNegocio.values()) {
      inserts.push(
        supabase.from('liquidaciones_diarias').insert({
          negocio_id:    entry.negocioId,
          usuario_id:    entry.usuarioId,
          fecha:         fechaHoy,
          pedido_ids:    entry.pedidoIds,
          total_ventas:  entry.totalVentas,
          total_envio:   entry.totalEnvio,
          total_liquido: entry.totalLiquido,
          estado:        'pendiente',
        })
      )
    }

    await Promise.all(inserts)

    // Marcar todos los pedidos como liquidados
    const todoIds = pedidos.map((p: any) => p.id)
    await supabase
      .from('pedidos')
      .update({ estado_pago: 'liquidado' })
      .in('id', todoIds)

    return json({
      mensaje: 'Liquidación completada',
      fecha: fechaHoy,
      liquidaciones: porNegocio.size,
      pedidos_procesados: todoIds.length,
    })

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error interno'
    console.error('[liquidacion-nocturna]', error)
    return err(500, msg)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
