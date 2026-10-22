// Adaptador PRODUCCIÓN: Supabase (base de datos + login del dueño + fotos).
// Se activa con "modo": "produccion" y "supabase": { "url", "anonKey" } en cliente.json.
// Esquema y permisos: supabase/schema.sql. Las altas públicas (pedidos y reservas) pasan
// por funciones RPC que validan precios y capacidad del lado del servidor.

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const aPedido = (r) => r && ({
  id: r.id, codigo: r.codigo, items: r.items, subtotal: Number(r.subtotal), envio: Number(r.envio), total: Number(r.total),
  tipo: r.tipo, cliente: r.cliente, nota: r.nota, pago: r.pago, pagoEstado: r.pago_estado, pagoId: r.pago_id,
  estado: r.estado, creado: r.creado,
});
const aReserva = (r) => r && ({ ...r });
const aProducto = (r) => r && ({
  id: r.id, categoria: r.categoria, nombre: r.nombre, descripcion: r.descripcion || '', precio: r.precio == null ? null : Number(r.precio),
  foto: r.foto, etiquetas: r.etiquetas || [], disponible: r.disponible, orden: r.orden,
});

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
      .subscribe();
  }
  const emitir = () => subs.forEach(f => f({ origen: 'local' }));

  return {
    modo: 'produccion',
    client: sb,

    async getCategorias() { return ok(await sb.from('categorias').select('*').eq('negocio', N).order('orden')); },
    async saveCategoria(c) { const r = ok(await sb.from('categorias').upsert({ negocio: N, id: c.id, nombre: c.nombre, orden: c.orden ?? 0 }).select().single()); emitir(); return r; },
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
      return ok(await sb.rpc('crear_reserva', { p_negocio: N, p_fecha: d.fecha, p_hora: d.hora, p_personas: Number(d.personas), p_nombre: d.nombre, p_telefono: d.telefono, p_email: d.email || null, p_comentario: d.comentario || null }));
    },
    async getReservas() { return ok(await sb.from('reservas').select('*').eq('negocio', N).order('fecha').order('hora')).map(aReserva); },
    async updateReserva(id, patch) { const r = ok(await sb.from('reservas').update({ estado: patch.estado }).eq('id', id).select().single()); emitir(); return r; },

    async createPedido(d) {
      const r = ok(await sb.rpc('crear_pedido', { p_negocio: N, p_items: d.items.map(i => ({ id: i.id, cant: i.cant, nota: i.nota || '' })), p_tipo: d.tipo, p_cliente: d.cliente, p_nota: [d.sucursal ? `Sucursal: ${d.sucursal}` : '', d.nota || ''].filter(Boolean).join(' · '), p_pago: d.pago }));
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

    async getSession() { const { data } = await sb.auth.getSession(); if (data.session) escuchar(); return data.session; },
    async login(email, password) { const s = ok(await sb.auth.signInWithPassword({ email, password })); escuchar(); return s; },
    async logout() { await sb.auth.signOut(); },

    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    async reset() { throw new Error('reset solo existe en demo'); },
    async importarCarta() {
      const c = config.carta || {};
      if (c.categorias?.length) ok(await sb.from('categorias').upsert(c.categorias.map((x, i) => ({ negocio: N, id: x.id, nombre: x.nombre, orden: x.orden ?? i + 1 }))));
      if (c.productos?.length) ok(await sb.from('productos').upsert(c.productos.map((p, i) => ({ negocio: N, id: p.id, categoria: p.categoria, nombre: p.nombre, descripcion: p.descripcion || '', precio: p.precio ?? null, foto: p.foto || null, etiquetas: p.etiquetas || [], disponible: p.disponible !== false, orden: p.orden ?? i + 1 }))));
      emitir();
    },
  };
}
