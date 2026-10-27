// Adaptador PRODUCCIÓN: Supabase (base de datos + login del dueño + fotos).
// Se activa con "modo": "produccion" y "supabase": { "url", "anonKey" } en cliente.json.
// Esquema y permisos: supabase/schema.sql. Las altas públicas (pedidos y reservas) pasan
// por funciones RPC que validan precios y capacidad del lado del servidor.

import { estadoGiftcard, normalizarCodigo } from '../core/giftcards.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const aPedido = (r) => r && ({
  id: r.id, codigo: r.codigo, items: r.items, subtotal: Number(r.subtotal), envio: Number(r.envio), total: Number(r.total),
  tipo: r.tipo, cliente: r.cliente, nota: r.nota, pago: r.pago, pagoEstado: r.pago_estado, pagoId: r.pago_id, sucursal: r.sucursal || null,
  retiro: r.retiro || null, sinPrecio: !!r.sin_precio,
  estado: r.estado, creado: r.creado,
});
const aReserva = (r) => r && ({ ...r, extras: r.extras || undefined, servicio: r.servicio || undefined });
const aCategoria = (r) => r && ({ id: r.id, nombre: r.nombre, orden: r.orden, ...(r.temporada !== undefined ? { temporada: r.temporada } : {}), ...(r.especial ? { especial: true, desde: r.desde || '', hasta: r.hasta || '', avisoDias: r.aviso_dias ?? 30, bajada: r.bajada || '' } : {}), ...(r.anticipacion_horas != null ? { anticipacionHoras: r.anticipacion_horas } : {}) });
// columnas nuevas (kit 1.3) solo si la categoría las usa: así los clientes sin la migración siguen andando
const extrasCategoria = (c) => ({
  ...(c.especial ? { especial: true, desde: c.desde || null, hasta: c.hasta || null, aviso_dias: Number(c.avisoDias ?? 30), bajada: c.bajada || null } : {}),
  ...(c.anticipacionHoras != null ? { anticipacion_horas: Number(c.anticipacionHoras) } : {}) });
const aGiftcard = (r) => {
  if (!r) return null;
  const g = { id: r.id, codigo: r.codigo, pedidoId: r.pedido, pedidoCodigo: r.pedido_codigo, monto: Number(r.monto), saldo: Number(r.saldo), para: r.para || '', de: r.de || '',
    mensaje: r.mensaje || '', comprador: r.comprador || '', estado: r.estado, creado: r.creado, activada: r.activada, vence: r.vence,
    canjes: (r.canjes || []).map(c => ({ monto: Number(c.monto), nota: c.nota || '', fecha: c.creado })).sort((a, b) => a.fecha.localeCompare(b.fecha)) };
  return { ...g, estado: estadoGiftcard(g) };
};
const aProducto = (r) => r && ({
  id: r.id, categoria: r.categoria, nombre: r.nombre, descripcion: r.descripcion || '', precio: r.precio == null ? null : Number(r.precio),
  foto: r.foto, etiquetas: r.etiquetas || [], disponible: r.disponible, orden: r.orden,
});

import { temporadaValida, temporadasDe } from '../core/temporadas.js';

export async function createSupabaseStore(config) {
  const { createClient } = await import(SUPABASE_ESM);
  const sb = createClient(config.supabase.url, config.supabase.anonKey, { auth: { persistSession: true } });
  const N = config.id;
  const subs = new Set();
  const ok = ({ data, error }) => { if (error) { const e = new Error(error.message); e.code = error.code || error.message; throw e; } return data; };

  let canal = null;
  function escuchar() {
    if (canal) return;
    canal = sb.channel(`kit-${N}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `negocio=eq.${N}` }, () => subs.forEach(f => f({ origen: 'remoto' })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas', filter: `negocio=eq.${N}` }, () => subs.forEach(f => f({ origen: 'remoto' })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos', filter: `negocio=eq.${N}` }, () => subs.forEach(f => f({ origen: 'remoto' })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'negocios', filter: `id=eq.${N}` }, () => subs.forEach(f => f({ origen: 'remoto' })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'giftcards', filter: `negocio=eq.${N}` }, () => subs.forEach(f => f({ origen: 'remoto' })))
      .subscribe();
  }
  const emitir = () => subs.forEach(f => f({ origen: 'local' }));
  // la columna categorias.temporada solo existe en clientes con temporadas (supabase/migracion-temporadas.sql)
  const conTemporadas = temporadasDe(config).length > 0;
  const filaCat = (c, i) => ({ negocio: N, id: c.id, nombre: c.nombre, orden: c.orden ?? i ?? 0, ...(conTemporadas ? { temporada: c.temporada || null } : {}) });
  const filaCatFull = (c, i) => ({ ...filaCat(c, i), ...extrasCategoria(c) });

  return {
    modo: 'produccion',
    client: sb,

    async getCategorias() { return ok(await sb.from('categorias').select('*').eq('negocio', N).order('orden')).map(aCategoria); },
    async saveCategoria(c) { const r = aCategoria(ok(await sb.from('categorias').upsert(filaCatFull(c, 0)).select().single())); emitir(); return r; },
    async getTemporada() {
      if (!conTemporadas) return null;
      const r = ok(await sb.from('negocios').select('config').eq('id', N).maybeSingle());
      return temporadaValida(config, r?.config?.temporadaActiva);
    },
    async setTemporada(id) {
      const r = ok(await sb.from('negocios').select('config').eq('id', N).single());
      const activa = temporadaValida(config, id);
      ok(await sb.from('negocios').update({ config: { ...(r.config || {}), temporadaActiva: activa } }).eq('id', N));
      emitir(); return activa;
    },
    async deleteCategoria(id) {
      ok(await sb.from('productos').update({ categoria: null }).eq('negocio', N).eq('categoria', id));
      ok(await sb.from('categorias').delete().eq('negocio', N).eq('id', id)); emitir();
    },
    async getProductos() { return ok(await sb.from('productos').select('*').eq('negocio', N).order('orden')).map(aProducto); },
    async saveProducto(p) {
      const row = { negocio: N, id: p.id, categoria: p.categoria ?? null, nombre: p.nombre, descripcion: p.descripcion || '', precio: p.precio === '' || p.precio == null ? null : Number(p.precio), foto: p.foto || null, etiquetas: p.etiquetas || [], disponible: p.disponible !== false, orden: p.orden ?? 0, actualizado: new Date().toISOString() };
      const r = aProducto(ok(await sb.from('productos').upsert(row).select().single())); emitir(); return r;
    },
    async deleteProducto(id) { ok(await sb.from('productos').delete().eq('negocio', N).eq('id', id)); emitir(); },
    async uploadFoto(file) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${N}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      ok(await sb.storage.from('fotos').upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type }));
      return sb.storage.from('fotos').getPublicUrl(path).data.publicUrl;
    },

    async getOcupacion(fecha) {
      const rows = ok(await sb.rpc('ocupacion', { p_negocio: N, p_fecha: fecha }));
      return Object.fromEntries((rows || []).map(r => [r.hora, Number(r.personas)]));
    },
    async createReserva(d) {
      const args = { p_negocio: N, p_fecha: d.fecha, p_hora: d.hora, p_personas: Number(d.personas), p_nombre: d.nombre, p_telefono: d.telefono, p_email: d.email || null, p_comentario: d.comentario || null };
      // servicio y extras solo si se usan (así los clientes sin la migración 1.2 siguen andando)
      if (d.servicio || d.extras?.length) Object.assign(args, { p_servicio: d.servicio || null, p_extras: d.extras || null });
      return aReserva(ok(await sb.rpc('crear_reserva', args)));
    },
    async getReservas() { return ok(await sb.from('reservas').select('*').eq('negocio', N).order('fecha').order('hora')).map(aReserva); },
    async updateReserva(id, patch) { const r = ok(await sb.from('reservas').update({ estado: patch.estado }).eq('id', id).select().single()); emitir(); return r; },

    async createPedido(d) {
      const args = { p_negocio: N, p_items: d.items.map(i => i.gc ? { id: 'giftcard', cant: 1, gc: i.gc } : { id: i.id, cant: i.cant, nota: i.nota || '' }), p_tipo: d.tipo, p_cliente: d.cliente, p_nota: d.nota || '', p_pago: d.pago };
      // solo las cadenas mandan la sede (así los clientes de un solo local no necesitan la migración)
      if (d.sucursal) args.p_sucursal = d.sucursal;
      if (d.retiro) args.p_retiro = d.retiro;   // encargos con fecha (necesita supabase/migracion-encargos.sql, kit 1.3)
      const r = ok(await sb.rpc('crear_pedido', args));
      return aPedido(r);
    },
    async getPedidos() { return ok(await sb.from('pedidos').select('*').eq('negocio', N).order('creado', { ascending: false }).limit(300)).map(aPedido); },
    async updatePedido(id, patch) {
      const row = {}; if (patch.estado) row.estado = patch.estado; if (patch.pagoEstado) row.pago_estado = patch.pagoEstado;
      const r = aPedido(ok(await sb.from('pedidos').update(row).eq('id', id).select().single())); emitir(); return r;
    },
    async getPedidoPublico(id) { const r = ok(await sb.rpc('pedido_publico', { p_id: id })); return r ? { id: r.id, codigo: r.codigo, estado: r.estado, pagoEstado: r.pago_estado, total: Number(r.total) } : null; },
    // En producción el estado del pago lo escribe el webhook de Mercado Pago, no el navegador.
    async marcarPago() { /* no-op a propósito */ },

    // ---- gift cards (supabase/migracion-servicios-giftcards.sql)
    async getGiftcards() { return ok(await sb.from('giftcards').select('*, canjes:giftcard_canjes(monto, nota, creado)').eq('negocio', N).order('creado', { ascending: false }).limit(500)).map(aGiftcard); },
    async getGiftcard(codigo) { return aGiftcard(ok(await sb.from('giftcards').select('*, canjes:giftcard_canjes(monto, nota, creado)').eq('negocio', N).eq('codigo', normalizarCodigo(codigo)).maybeSingle())); },
    async getGiftcardsDePedido(id) { return (ok(await sb.rpc('giftcards_de_pedido', { p_id: id })) || []).map(g => ({ ...g, monto: Number(g.monto), saldo: Number(g.saldo), estado: estadoGiftcard(g) })); },
    async canjearGiftcard(codigo, monto, nota = '') {
      try { const r = ok(await sb.rpc('canjear_giftcard', { p_negocio: N, p_codigo: normalizarCodigo(codigo), p_monto: Number(monto), p_nota: nota || null })); emitir(); return aGiftcard(r); }
      catch (e) { const m = /gc_\w+/.exec(e.message); if (m) e.code = m[0]; throw e; }
    },
    async activarGiftcard(codigo) { const r = aGiftcard(ok(await sb.rpc('activar_giftcard', { p_negocio: N, p_codigo: normalizarCodigo(codigo) }))); emitir(); return r; },

    async getSession() { const { data } = await sb.auth.getSession(); if (data.session) escuchar(); return data.session; },
    async login(email, password) { const s = ok(await sb.auth.signInWithPassword({ email, password })); escuchar(); return s; },
    async logout() { await sb.auth.signOut(); },

    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    async reset() { throw new Error('reset solo existe en demo'); },
    async importarCarta() {
      const c = config.carta || {};
      if (c.categorias?.length) ok(await sb.from('categorias').upsert(c.categorias.map((x, i) => filaCatFull(x, i + 1))));
      if (c.productos?.length) ok(await sb.from('productos').upsert(c.productos.map((p, i) => ({ negocio: N, id: p.id, categoria: p.categoria, nombre: p.nombre, descripcion: p.descripcion || '', precio: p.precio ?? null, foto: p.foto || null, etiquetas: p.etiquetas || [], disponible: p.disponible !== false, orden: p.orden ?? i + 1 }))));
      emitir();
    },
  };
}
