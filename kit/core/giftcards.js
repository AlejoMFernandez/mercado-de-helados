// Gift cards (puro, sin DOM): config, validación de montos, códigos y estado.
//
// cliente.json → "giftcards": {
//   "nombre": "Gift card", "prefijo": "LCD", "validezDias": 60,
//   "montos": [50000, 75000, 100000],     // montos fijos para elegir…
//   "min": null, "max": null              // …y/o monto libre entre min y max
// }
// Una gift card entra al carrito como una línea especial, se paga como cualquier pedido y
// queda "pendiente" hasta que el pago se aprueba (Mercado Pago) o el local la marca cobrada.
// Ahí pasa a "vigente" con vencimiento. El local la canjea desde /admin, entera o en partes.

export function configGiftcards(config = {}) {
  const g = config.giftcards;
  if (!g) return null;
  return {
    nombre: 'Gift card', validezDias: 60, montos: [], min: null, max: null, ...g,
    prefijo: String(g.prefijo || config.prefijoPedido || 'GC').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'GC',
  };
}

export function montoValido(cfg, monto) {
  if (!cfg) return false;
  const n = Number(monto);
  if (!Number.isFinite(n) || n <= 0) return false;
  if ((cfg.montos || []).map(Number).includes(n)) return true;
  const libre = cfg.min != null || cfg.max != null;
  if (!libre) return false;
  return n >= Number(cfg.min ?? 1) && n <= Number(cfg.max ?? Infinity);
}

// Sin letras que se confunden al dictarlas por teléfono (0/O, 1/I/L, 5/S).
const ALFA = 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
export function codigoGiftcard(prefijo = 'GC', rnd = Math.random) {
  let s = ''; for (let i = 0; i < 4; i++) s += ALFA[Math.floor(rnd() * ALFA.length)];
  return `${prefijo}-${s}`;
}
export const normalizarCodigo = (c) => String(c || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');

// Estado real a una fecha: una vigente o parcial que ya venció se muestra "vencida".
export function estadoGiftcard(gc, ahora = Date.now()) {
  if (!gc) return null;
  if (['vigente', 'parcial'].includes(gc.estado) && gc.vence && new Date(gc.vence).getTime() < ahora) return 'vencida';
  return gc.estado;
}
export const canjeable = (gc, ahora) => ['vigente', 'parcial'].includes(estadoGiftcard(gc, ahora)) && Number(gc.saldo) > 0;

export function venceDesde(validezDias, desde = Date.now()) {
  return new Date(desde + Number(validezDias || 60) * 864e5).toISOString();
}
