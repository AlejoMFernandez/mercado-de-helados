// Adaptador DEMO: todo en localStorage del visitante.
// Cada persona que abre la demo tiene su propia "caja de arena": sin backend ni costo.
// Se siembra con la carta de cliente.json y se puede reiniciar desde el panel.
import { uid, clone, codigoCorto } from '../core/util.js';
import { armarPedido } from '../core/pedidos.js';
import { tieneVariantes } from '../core/variantes.js';
import { configReservas, serviciosDe, tandaDe, usadosEn, capacidadEn } from '../core/turnos.js';
import { temporadaValida } from '../core/temporadas.js';
import { descuentoEfectivo } from '../core/descuentos.js';
import { configGiftcards, codigoGiftcard, normalizarCodigo, estadoGiftcard, canjeable, venceDesde } from '../core/giftcards.js';

const VERSION = 1;

export function createLocalStore(config) {
  const KEY = `kit:${config.id}:v${VERSION}`;
  const canal = ('BroadcastChannel' in self) ? new BroadcastChannel(KEY) : null;
  const subs = new Set();

  function semilla() {
    const c = clone(config.carta || { categorias: [], productos: [] });
    return {
      categorias: (c.categorias || []).map((x, i) => ({ orden: i + 1, ...x })),
      productos: (c.productos || []).map((x, i) => ({ disponible: true, etiquetas: [], descripcion: '', orden: i + 1, ...x })),
      temporada: temporadaValida(config, null), reservas: [], pedidos: [], giftcards: [], sembrado: new Date().toISOString(),
    };
  }
  function leer() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (_) { /* dato roto → resembrar */ }
    const s = semilla(); escribir(s, false); return s;
  }
  function escribir(db, avisar = true) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {
      const err = new Error('quota'); err.code = 'quota'; throw err;
    }
    if (avisar) emitir();
  }
  function emitir(origen = 'local') { subs.forEach(fn => fn({ origen })); if (origen === 'local' && canal) canal.postMessage('cambio'); }
  if (canal) canal.onmessage = () => emitir('otra-pestaña');
  self.addEventListener('storage', (e) => { if (e.key === KEY) emitir('otra-pestaña'); });

  const mut = (fn) => { const db = leer(); db.giftcards = db.giftcards || []; const r = fn(db); escribir(db); return r; };
  const GC = configGiftcards(config);
  const conEstado = (g) => g && ({ ...g, estado: estadoGiftcard(g) });
  function activar(db, pedidoId) {
    (db.giftcards || []).filter(g => g.pedidoId === pedidoId && g.estado === 'pendiente').forEach(g => {
      g.estado = 'vigente'; g.activada = new Date().toISOString(); g.vence = venceDesde(GC?.validezDias);
    });
  }
  const ordenar = (a) => a.slice().sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0));

  return {
    modo: 'demo',

    // ---- carta
    async getCategorias() { return ordenar(leer().categorias); },
    async saveCategoria(cat) {
      return mut(db => {
        const i = db.categorias.findIndex(c => c.id === cat.id);
        if (i >= 0) db.categorias[i] = { ...db.categorias[i], ...cat };
        else db.categorias.push({ orden: db.categorias.length + 1, ...cat, id: cat.id || uid('c-').slice(0, 12) });
        return cat;
      });
    },
    async deleteCategoria(id) { return mut(db => { db.categorias = db.categorias.filter(c => c.id !== id); db.productos.forEach(p => { if (p.categoria === id) p.categoria = null; }); }); },
    async getProductos() { return ordenar(leer().productos); },
    // temporada de la carta que se ve en la web (null si el negocio no usa temporadas)
    async getTemporada() { return temporadaValida(config, leer().temporada); },
    async setTemporada(id) { return mut(db => { db.temporada = temporadaValida(config, id); return db.temporada; }); },
    async saveProducto(p) {
      return mut(db => {
        const i = db.productos.findIndex(x => x.id === p.id);
        const limpio = { ...p, precio: p.precio === '' || p.precio == null ? null : Number(p.precio) };
        if (i >= 0) db.productos[i] = { ...db.productos[i], ...limpio };
        else db.productos.push({ disponible: true, etiquetas: [], orden: db.productos.length + 1, ...limpio, id: p.id || uid('p-').slice(0, 12) });
        return limpio;
      });
    },
    async deleteProducto(id) { return mut(db => { db.productos = db.productos.filter(p => p.id !== id); }); },
    // En demo la foto se achica en el navegador y se guarda como data URL.
    async uploadFoto(file) { return achicarImagen(file, 900, .82); },

    // ---- reservas
    async getOcupacion(fecha) {
      const o = {};
      leer().reservas.filter(r => r.fecha === fecha && !['cancelada', 'no_vino'].includes(r.estado)).forEach(r => { o[r.hora] = (o[r.hora] || 0) + r.personas; });
      return o;
    },
    async createReserva(data) {
      const cfg = configReservas(config.reservas);
      return mut(db => {
        const pers = Number(data.personas);
        if (!(pers >= 1 && pers <= cfg.maxPersonas)) throw Object.assign(new Error('personas'), { code: 'personas' });
        const td = serviciosDe(cfg) ? tandaDe(cfg, data.hora) : null;
        if (serviciosDe(cfg) && !td) throw Object.assign(new Error('hora'), { code: 'hora' });
        const ocup = {};
        db.reservas.filter(r => r.fecha === data.fecha && !['cancelada', 'no_vino'].includes(r.estado)).forEach(r => { ocup[r.hora] = (ocup[r.hora] || 0) + r.personas; });
        if (usadosEn(cfg, data.hora, ocup) + pers > capacidadEn(cfg, data.hora)) throw Object.assign(new Error('sin_lugar'), { code: 'sin_lugar' });
        const extras = Array.isArray(data.extras) ? data.extras.filter(x => (cfg.extras || []).some(e => e.id === x)) : [];
        const r = { id: uid('r-'), fecha: data.fecha, hora: data.hora, personas: pers, nombre: data.nombre, telefono: data.telefono, email: data.email || '', comentario: data.comentario || '',
          ...(td ? { servicio: td.servicio.id } : {}), ...(extras.length ? { extras } : {}), estado: 'pendiente', creado: new Date().toISOString() };
        db.reservas.push(r); return r;
      });
    },
    async getReservas() { return leer().reservas.slice().sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)); },
    async updateReserva(id, patch) { return mut(db => { const r = db.reservas.find(x => x.id === id); if (r) Object.assign(r, patch); return r; }); },

    // ---- pedidos
    async createPedido(data) {
      return mut(db => {
        const calc = armarPedido(db.productos.filter(p => p.precio != null || tieneVariantes(p) || config.pedidos?.sinPrecio === 'a_confirmar'), data.items, { tipo: data.tipo, pedidos: config.pedidos, descuentoPct: data.pago === 'efectivo' ? descuentoEfectivo(config) : 0, giftcards: GC, categorias: db.categorias });
        if (!calc.items.length) throw Object.assign(new Error('vacio'), { code: 'vacio' });
        const p = {
          id: uid('o-'), codigo: codigoCorto(config.prefijoPedido || 'PD'), ...calc,
          tipo: data.tipo, cliente: data.cliente, nota: data.nota || '', pago: data.pago, sucursal: data.sucursal || null, retiro: data.retiro || null,
          pagoEstado: data.pago === 'mercadopago' ? 'pendiente' : 'a_coordinar', estado: 'pendiente', creado: new Date().toISOString(),
        };
        db.pedidos.push(p);
        // cada gift card del pedido queda "pendiente" hasta que se cobra
        calc.items.filter(i => i.giftcard).forEach(i => {
          let codigo; do { codigo = codigoGiftcard(GC.prefijo); } while (db.giftcards.some(g => g.codigo === codigo));
          db.giftcards.push({ id: uid('g-'), codigo, pedidoId: p.id, pedidoCodigo: p.codigo, monto: i.precio, saldo: i.precio, ...i.giftcard, comprador: data.cliente?.nombre || '',
            estado: 'pendiente', creado: p.creado, activada: null, vence: null, canjes: [] });
        });
        return p;
      });
    },
    async getPedidos() { return leer().pedidos.slice().sort((a, b) => b.creado.localeCompare(a.creado)); },
    async updatePedido(id, patch) {
      return mut(db => {
        const p = db.pedidos.find(x => x.id === id); if (p) Object.assign(p, patch);
        if (p && ['aprobado', 'cobrado'].includes(patch.pagoEstado)) activar(db, id);
        return p;
      });
    },
    async getPedidoPublico(id) { const p = leer().pedidos.find(x => x.id === id); return p ? { id: p.id, codigo: p.codigo, estado: p.estado, pagoEstado: p.pagoEstado, total: p.total, aPagar: p.aPagar, saldo: p.saldo } : null; },
    // Solo demo: lo usa el retorno de Mercado Pago (en producción lo actualiza el webhook).
    async marcarPago(id, pagoEstado, pagoId = '') { return this.updatePedido(id, { pagoEstado, pagoId }); },

    // ---- gift cards
    async getGiftcards() { return (leer().giftcards || []).slice().sort((a, b) => b.creado.localeCompare(a.creado)).map(conEstado); },
    async getGiftcard(codigo) { const c = normalizarCodigo(codigo); return conEstado((leer().giftcards || []).find(g => g.codigo === c)) || null; },
    // Público: lo que ve el comprador al volver del pago (solo las ya activas).
    async getGiftcardsDePedido(pedidoId) {
      return (leer().giftcards || []).filter(g => g.pedidoId === pedidoId && g.estado !== 'pendiente')
        .map(g => ({ codigo: g.codigo, monto: g.monto, saldo: g.saldo, para: g.para, de: g.de, mensaje: g.mensaje, vence: g.vence, estado: estadoGiftcard(g) }));
    },
    async canjearGiftcard(codigo, monto, nota = '') {
      return mut(db => {
        const g = db.giftcards.find(x => x.codigo === normalizarCodigo(codigo));
        if (!g) throw Object.assign(new Error('gc_no_existe'), { code: 'gc_no_existe' });
        if (!canjeable(g)) throw Object.assign(new Error('gc_no_canjeable'), { code: 'gc_no_canjeable' });
        const n = Math.round(Number(monto) * 100) / 100;
        if (!(n > 0) || n > g.saldo) throw Object.assign(new Error('gc_monto'), { code: 'gc_monto' });
        g.saldo = Math.round((g.saldo - n) * 100) / 100;
        g.canjes = [...(g.canjes || []), { monto: n, nota: String(nota || '').slice(0, 120), fecha: new Date().toISOString() }];
        g.estado = g.saldo <= 0 ? 'usada' : 'parcial';
        return conEstado(g);
      });
    },
    // Cobrada en el local (pedido por WhatsApp): la activa a mano.
    async activarGiftcard(codigo) {
      return mut(db => {
        const g = db.giftcards.find(x => x.codigo === normalizarCodigo(codigo));
        if (!g || g.estado !== 'pendiente') return conEstado(g);
        const p = db.pedidos.find(x => x.id === g.pedidoId); if (p && !['aprobado', 'cobrado'].includes(p.pagoEstado)) p.pagoEstado = 'cobrado';
        activar(db, g.pedidoId); return conEstado(g);
      });
    },

    // ---- sesión del panel (en demo no hay contraseña)
    async getSession() { return sessionStorage.getItem(KEY + ':admin') ? { user: { email: 'demo' } } : null; },
    async login() { sessionStorage.setItem(KEY + ':admin', '1'); return { user: { email: 'demo' } }; },
    async logout() { sessionStorage.removeItem(KEY + ':admin'); },

    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    async reset() { localStorage.removeItem(KEY); localStorage.removeItem(`kit:${config.id}:carrito`); escribir(semilla()); },
  };
}


export function achicarImagen(file, max = 900, q = .82) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(Object.assign(new Error('tipo'), { code: 'tipo' }));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      let out = cv.toDataURL('image/webp', q);
      if (!out.startsWith('data:image/webp')) out = cv.toDataURL('image/jpeg', q);
      if (out.length > 600_000) out = cv.toDataURL('image/jpeg', .6);
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
    img.src = url;
  });
}
