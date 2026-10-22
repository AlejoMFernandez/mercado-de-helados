// Capa de datos abstracta. El resto del kit solo habla con esta interfaz:
//
//   carta     getCategorias() saveCategoria(c) deleteCategoria(id)
//             getProductos()  saveProducto(p)  deleteProducto(id)  uploadFoto(file) → url
//   reservas  getOcupacion(fecha) createReserva(r) getReservas() updateReserva(id, patch)
//   pedidos   createPedido(o) getPedidos() updatePedido(id, patch) getPedidoPublico(id) marcarPago(id, estado)
//   panel     getSession() login(email, pass) logout()
//   otros     onChange(fn) → unsubscribe · reset() (demo) · importarCarta() (producción) · modo
//
// "demo" → localStorage (cada visitante tiene su sandbox). "produccion" → Supabase.
import { createLocalStore } from './local.js';

export async function createStore(config) {
  const quiereProd = config.modo === 'produccion' && config.supabase?.url && config.supabase?.anonKey;
  // ?demo en la URL fuerza el modo demo aunque el cliente.json esté en producción (útil para probar).
  const forzarDemo = new URLSearchParams(location.search).has('demo');
  if (quiereProd && !forzarDemo) {
    const { createSupabaseStore } = await import('./supabase.js');
    return createSupabaseStore(config);
  }
  return createLocalStore(config);
}
