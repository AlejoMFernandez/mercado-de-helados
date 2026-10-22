// Armado de pedidos y mensajes de WhatsApp (puro, sin DOM).
import { t } from './i18n.js';

// Recalcula el pedido con los precios de la carta (nunca confía en el precio que trae el carrito).
export function armarPedido(productos, lineas, { tipo = 'retiro', pedidos = {} } = {}) {
  const porId = new Map(productos.map(p => [p.id, p]));
  const items = [];
  for (const l of lineas) {
    const p = porId.get(l.id);
    if (!p || p.disponible === false) continue;
    const cant = Math.max(1, Math.min(99, parseInt(l.cant, 10) || 1));
    const precio = p.precio == null ? null : Number(p.precio);
    items.push({ id: p.id, nombre: p.nombre, precio, cant, nota: (l.nota || '').slice(0, 140), subtotal: precio == null ? 0 : precio * cant });
  }
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const envio = tipo === 'delivery' ? Number(pedidos.envio || 0) : 0;
  return { items, subtotal, envio, total: subtotal + envio, sinPrecio: items.some(i => i.precio == null) };
}

export function mensajePedido(pedido, { negocio, money, sucursal }) {
  const L = [t('waPedido', { negocio }), '', `*${t('waCodigo', { codigo: pedido.codigo })}*`];
  pedido.items.forEach(i => {
    L.push(`${i.cant}x ${i.nombre}${i.precio != null ? ` — ${money(i.subtotal)}` : ''}`);
    if (i.nota) L.push(`   _${i.nota}_`);
  });
  if (pedido.envio) L.push(`${t('envio')}: ${money(pedido.envio)}`);
  L.push(`*${t('total')}: ${money(pedido.total)}*`, '');
  L.push(`${t('waNombre')}: ${pedido.cliente.nombre}`);
  L.push(`${t('waEntrega')}: ${pedido.tipo === 'delivery' ? `${t('delivery')} — ${pedido.cliente.direccion}` : sucursal ? `${t('retiro')} — ${sucursal}` : t('retiro')}`);
  if (pedido.nota) L.push(`${t('waNota')}: ${pedido.nota}`);
  L.push(`${t('waPago')}: ${pedido.pago === 'mercadopago' ? t('waPagoMP') : t('waPagoWA')}`);
  return L.join('\n');
}

// Link de WhatsApp. Si el negocio tiene un link corto (wa.link, linktree…) que no acepta texto, devuelve { url, soloLink: true }.
export function linkWhatsApp(destino, texto) {
  const d = String(destino || '').trim();
  const num = d.replace(/\D/g, '');
  if (/^https?:/i.test(d) && !/wa\.me|api\.whatsapp\.com/i.test(d)) return { url: d, soloLink: true };
  if (!num) return { url: null, soloLink: true };
  return { url: `https://wa.me/${num}?text=${encodeURIComponent(texto)}`, soloLink: false };
}
