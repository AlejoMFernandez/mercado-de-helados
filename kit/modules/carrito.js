// Módulo CARRITO + CHECKOUT.
// Salidas configurables en cliente.json → "pedidos": { "salidas": ["whatsapp", "mercadopago"] }
//   whatsapp     → guarda el pedido (entra al panel) y abre WhatsApp con el mensaje armado.
//   mercadopago  → guarda el pedido, crea la preferencia en /api/mp-preference y redirige al checkout.
//
// Cualquier botón con data-kit-add="<idProducto>" suma al carrito.
// Cualquier elemento con data-kit-qty="<idProducto>" muestra "Agregar" o el selector − n +.
// data-kit-open="carrito" abre el carrito.
import { esc, h, $$, telValido } from '../core/util.js';
import { t } from '../core/i18n.js';
import { popup, toast, copiar } from '../core/ui.js';
import { armarPedido, mensajePedido, linkWhatsApp } from '../core/pedidos.js';

export function initCarrito(ctx, opts = {}) {
  const { config, store } = ctx;
  const KEY = `kit:${config.id}:carrito`;
  const P = config.pedidos || {};
  const salidas = (P.salidas || ['whatsapp']).filter(s => s !== 'mercadopago' || config.pagos?.mercadopago);
  const tipos = P.tipos || ['retiro'];
  let productos = [];
  let lineas = leer();
  let pop = null;
  // Varias sucursales (cliente.json → "sucursales": [{ id, nombre, direccion, whatsapp }]): el cliente elige dónde retira
  // y el pedido sale al WhatsApp de esa sucursal. Sin "sucursales", todo igual que siempre.
  const SUCS = Array.isArray(config.sucursales) ? config.sucursales.filter(x => x && x.id) : [];
  const KEY_SUC = `kit:${config.id}:sucursal`;
  const sucGuardada = (() => { try { return localStorage.getItem(KEY_SUC) || ''; } catch (_) { return ''; } })();
  let datos = { tipo: tipos[0], pago: salidas[0], nombre: '', telefono: '', direccion: '', nota: '', sucursal: SUCS.some(x => x.id === sucGuardada) ? sucGuardada : '' };
  const sucActual = () => SUCS.find(x => x.id === datos.sucursal) || null;
  function elegirSucursal(id) {
    if (!SUCS.some(x => x.id === id)) return;
    datos.sucursal = id; try { localStorage.setItem(KEY_SUC, id); } catch (_) { /* sin storage */ }
    if (pop) pintarDrawer();
    document.dispatchEvent(new CustomEvent('kit:sucursal', { detail: sucActual() }));
  }

  function leer() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } }
  function guardar() { try { localStorage.setItem(KEY, JSON.stringify(lineas)); } catch (_) { /* sin storage: queda en memoria */ } }
  const cantDe = (id) => lineas.filter(l => l.id === id).reduce((s, l) => s + l.cant, 0);
  const calc = () => armarPedido(productos, lineas, { tipo: datos.tipo, pedidos: P });

  // ---------- botón flotante
  const fab = h(`<button type="button" class="kit-root kit-fab" aria-label="${esc(t('verPedido'))}" hidden>
      <span class="kit-fab__ico" aria-hidden="true">${opts.icono || '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.3 11.1a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>'}</span>
      <span class="kit-fab__txt"><b class="kit-fab__label">${esc(opts.label || t('verPedido'))}</b><span class="kit-fab__total"></span></span>
      <span class="kit-fab__n" aria-hidden="true">0</span></button>`);
  if (opts.fab !== false) document.body.appendChild(fab);
  fab.addEventListener('click', () => abrir());

  function pintarFab(bump) {
    const c = calc(); const n = c.items.reduce((s, i) => s + i.cant, 0);
    fab.hidden = n === 0;
    fab.querySelector('.kit-fab__n').textContent = n;
    fab.querySelector('.kit-fab__total').textContent = ctx.money(c.subtotal) || '';
    if (bump) { fab.classList.remove('bump'); void fab.offsetWidth; fab.classList.add('bump'); }
    document.documentElement.classList.toggle('kit-has-cart', n > 0);
  }

  // ---------- selectores de cantidad en la carta
  function qtyHTML(id) {
    const n = cantDe(id);
    if (!n) return `<button type="button" class="kit-add" data-kit-add="${esc(id)}"><span aria-hidden="true">+</span> ${esc(t('agregar'))}</button>`;
    return `<div class="kit-step" role="group" aria-label="${esc(t('tuPedido'))}">
      <button type="button" data-kit-dec="${esc(id)}" aria-label="${esc(t('quitar'))}">−</button>
      <output aria-live="polite">${n}</output>
      <button type="button" data-kit-add="${esc(id)}" aria-label="${esc(t('agregar'))}">+</button></div>`;
  }
  function sync(root = document) { $$('[data-kit-qty]', root).forEach(el => { el.innerHTML = qtyHTML(el.dataset.kitQty); }); }

  function cambiar(id, delta, origen, nota = '') {
    const p = productos.find(x => x.id === id);
    if (!p || p.disponible === false || p.precio == null) return;
    // la posición del botón se toma ANTES de redibujar (sync reemplaza el botón y su rect queda en 0,0)
    const desde = origen && origen.isConnected ? origen.getBoundingClientRect() : null;
    nota = String(nota || '').slice(0, 140);
    const l = lineas.find(x => x.id === id && (x.nota || '') === nota);
    if (l) l.cant = Math.max(0, Math.min(99, l.cant + delta));
    else if (delta > 0) lineas.push({ id, cant: delta, nota });
    lineas = lineas.filter(x => x.cant > 0);
    guardar(); sync(); pintarFab(delta > 0);
    if (pop) pintarDrawer();
    if (delta > 0 && desde && desde.width) volar(desde, p);
    document.dispatchEvent(new CustomEvent('kit:carrito', { detail: { lineas: lineas.slice(), producto: p, delta } }));
  }

  // pequeño "vuelo" del botón al carrito
  function volar(a, p) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || fab.hidden) return;
    const b = fab.getBoundingClientRect();
    const dot = h(`<span class="kit-root kit-fly">${p.foto ? `<img src="${esc(ctx.asset(p.foto))}" alt="">` : ''}</span>`);
    dot.style.left = a.left + a.width / 2 + 'px'; dot.style.top = a.top + a.height / 2 + 'px';
    document.body.appendChild(dot);
    requestAnimationFrame(() => {
      dot.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(.35)`;
      dot.style.opacity = '.2';
    });
    setTimeout(() => dot.remove(), 650);
  }

  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-kit-add]'); if (add) { e.preventDefault(); cambiar(add.dataset.kitAdd, 1, add); return; }
    const dec = e.target.closest('[data-kit-dec]'); if (dec) { e.preventDefault(); cambiar(dec.dataset.kitDec, -1); return; }
    const li = e.target.closest('[data-kit-linea]');
    if (li) { e.preventDefault(); const l = lineas[+li.dataset.kitLinea]; if (l) cambiar(l.id, +li.dataset.delta, li, l.nota); return; }
    const op = e.target.closest('[data-kit-open="carrito"]'); if (op) { e.preventDefault(); abrir(); }
  });

  // ---------- drawer / checkout
  function abrir() {
    if (pop) return;
    pop = popup({ titulo: t('tuPedido'), tipo: 'drawer', clase: 'kit-cart', onClose: () => { pop = null; } });
    pintarDrawer();
  }

  function pintarDrawer() {
    const c = calc();
    const body = pop.body;
    if (!c.items.length) {
      body.innerHTML = `<div class="kit-empty">${opts.vacioIlustracion || ''}<p class="kit-empty__t">${esc(t('carritoVacio'))}</p><p>${esc(t('carritoVacioSub'))}</p>
        <button type="button" class="kit-btn" data-close>${esc(t('seguir'))}</button></div>`;
      return;
    }
    const scroll = body.querySelector('.kit-cart__scroll')?.scrollTop || 0;
    body.innerHTML = `
      <div class="kit-cart__scroll">
        <ul class="kit-lines">${lineas.map((l, idx) => {
          const p = productos.find(x => x.id === l.id);
          if (!p || p.disponible === false || p.precio == null) return '';
          const ctrl = l.nota ? `<div class="kit-step" role="group" aria-label="${esc(t('tuPedido'))}">
              <button type="button" data-kit-linea="${idx}" data-delta="-1" aria-label="${esc(t('quitar'))}">−</button>
              <output aria-live="polite">${l.cant}</output>
              <button type="button" data-kit-linea="${idx}" data-delta="1" aria-label="${esc(t('agregar'))}">+</button></div>` : qtyHTML(l.id);
          return `<li class="kit-line">
            ${p.foto ? `<img src="${esc(ctx.asset(p.foto))}" alt="" class="kit-line__img">` : '<span class="kit-line__img kit-line__img--na"></span>'}
            <div class="kit-line__body"><b>${esc(p.nombre)}</b>${l.nota ? `<small class="kit-line__nota">${esc(l.nota)}</small>` : ''}<span>${ctx.money(p.precio)}</span></div>
            <div class="kit-qty">${ctrl}</div>
          </li>`;
        }).join('')}</ul>

        <form class="kit-form" novalidate>
          ${tipos.length > 1 ? `<fieldset class="kit-seg"><legend class="kit-sr">${esc(t('waEntrega'))}</legend>
            ${tipos.map(tp => `<label><input type="radio" name="tipo" value="${tp}" ${datos.tipo === tp ? 'checked' : ''}><span>${esc(t(tp))}</span></label>`).join('')}</fieldset>` : ''}
          ${SUCS.length && datos.tipo !== 'delivery' ? `<label class="kit-field"><span>${esc(t('sucursal'))}</span><select name="sucursal" required>
            <option value="" ${datos.sucursal ? '' : 'selected'} disabled>—</option>
            ${SUCS.map(x => `<option value="${esc(x.id)}" ${datos.sucursal === x.id ? 'selected' : ''}>${esc(x.nombre)}${x.direccion ? ` · ${esc(x.direccion)}` : ''}</option>`).join('')}</select></label>` : ''}
          <label class="kit-field"><span>${esc(t('nombre'))}</span><input name="nombre" autocomplete="name" required value="${esc(datos.nombre)}"></label>
          <label class="kit-field"><span>${esc(t('telefono'))}</span><input name="telefono" type="tel" inputmode="tel" autocomplete="tel" required value="${esc(datos.telefono)}"></label>
          <label class="kit-field" ${datos.tipo === 'delivery' ? '' : 'hidden'} data-dir><span>${esc(t('direccion'))}</span><input name="direccion" autocomplete="street-address" value="${esc(datos.direccion)}"></label>
          <label class="kit-field"><span>${esc(t('notaPedido'))}</span><textarea name="nota" rows="2" maxlength="280">${esc(datos.nota)}</textarea></label>
          ${salidas.length > 1 ? `<fieldset class="kit-pay"><legend>${esc(t('comoPagas'))}</legend>
            ${salidas.map(s => `<label class="kit-pay__opt"><input type="radio" name="pago" value="${s}" ${datos.pago === s ? 'checked' : ''}>
              <span class="kit-pay__card"><b>${esc(t(s === 'whatsapp' ? 'porWhatsapp' : 'porMP'))}</b><small>${esc(t(s === 'whatsapp' ? 'porWhatsappSub' : 'porMPSub'))}</small></span></label>`).join('')}
          </fieldset>` : ''}
        </form>
      </div>
      <div class="kit-cart__foot">
        <div class="kit-sum">
          ${c.envio ? `<div><span>${esc(t('subtotal'))}</span><span>${ctx.money(c.subtotal)}</span></div><div><span>${esc(t('envio'))}</span><span>${ctx.money(c.envio)}</span></div>` : ''}
          <div class="kit-sum__total"><span>${esc(t('total'))}</span><b>${ctx.money(c.total)}</b></div>
        </div>
        <p class="kit-msg" role="alert" hidden></p>
        <button type="button" class="kit-btn kit-btn--block kit-btn--big" data-enviar>${esc(datos.pago === 'mercadopago' ? t('pagar') : t('enviarPedido'))}</button>
      </div>`;
    body.querySelector('.kit-cart__scroll').scrollTop = scroll;
    const form = body.querySelector('form');
    form.addEventListener('input', (e) => {
      const f = e.target; if (!f.name) return;
      datos[f.name] = f.value;
      if (f.name === 'sucursal') { elegirSucursal(f.value); return; }
      if (f.name === 'tipo') { body.querySelector('[data-dir]').hidden = f.value !== 'delivery'; pintarTotales(); }
      if (f.name === 'pago') body.querySelector('[data-enviar]').textContent = f.value === 'mercadopago' ? t('pagar') : t('enviarPedido');
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
    body.querySelector('[data-enviar]').addEventListener('click', enviar);
  }
  function pintarTotales() { if (pop) pintarDrawer(); }

  function error(msg) { const m = pop.body.querySelector('.kit-msg'); m.textContent = msg; m.hidden = false; m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); }

  async function enviar() {
    const c = calc();
    const faltan = [];
    if (!datos.nombre.trim()) faltan.push(t('nombre').toLowerCase());
    if (!telValido(datos.telefono)) faltan.push(t('telefono').toLowerCase());
    if (datos.tipo === 'delivery' && datos.direccion.trim().length < 5) faltan.push(t('direccion').toLowerCase());
    if (SUCS.length && datos.tipo !== 'delivery' && !sucActual()) faltan.push(t('sucursalCorta'));
    if (faltan.length) return error(t('faltan', { campos: faltan.join(', ') }));
    if (P.minimo && c.subtotal < P.minimo) return error(t('minimo', { monto: ctx.money(P.minimo) }));
    const btn = pop.body.querySelector('[data-enviar]'); btn.disabled = true; btn.classList.add('is-loading');
    try {
      const pedido = await store.createPedido({
        items: lineas.map(l => ({ id: l.id, cant: l.cant, nota: l.nota })), tipo: datos.tipo,
        cliente: { nombre: datos.nombre.trim(), telefono: datos.telefono.trim(), direccion: datos.tipo === 'delivery' ? datos.direccion.trim() : '' },
        nota: datos.nota.trim(), pago: datos.pago, sucursal: datos.tipo !== 'delivery' ? (sucActual()?.id || '') : '',
      });
      document.dispatchEvent(new CustomEvent('kit:pedido', { detail: pedido }));
      if (datos.pago === 'mercadopago') return pagarMP(pedido);
      await salirPorWhatsApp(pedido);
    } catch (err) {
      console.error('[kit] pedido', err);
      btn.disabled = false; btn.classList.remove('is-loading');
      error(t('error'));
    }
  }

  async function salirPorWhatsApp(pedido) {
    const suc = pedido.sucursal ? SUCS.find(x => x.id === pedido.sucursal) : null;
    const texto = mensajePedido(pedido, { negocio: config.nombre, money: ctx.money, sucursal: suc ? suc.nombre : '' });
    const { url, soloLink } = linkWhatsApp((suc && suc.whatsapp) || config.whatsapp, texto);
    vaciar();
    if (soloLink) { await copiar(texto); toast(t('copiado'), 'ok', 4200); }
    exito(t('pedidoListo'), t('pedidoListoSub', { codigo: pedido.codigo }), url);
    if (url) window.open(url, '_blank', 'noopener');
  }

  function vaciar() { lineas = []; guardar(); sync(); pintarFab(); }

  function exito(titulo, sub, waUrl, tipo = 'ok') {
    if (pop) pop.close();
    const box = h(`<div class="kit-done kit-done--${tipo}">
      <div class="kit-done__ico" aria-hidden="true">${tipo === 'ok' ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/></svg>'}</div>
      <h3>${esc(titulo)}</h3><p>${esc(sub)}</p>
      <div class="kit-row kit-row--center">${waUrl ? `<a class="kit-btn" href="${esc(waUrl)}" target="_blank" rel="noopener">${esc(t('abrirWA'))}</a>` : ''}
      <button type="button" class="kit-btn kit-btn--ghost" data-close>${esc(t('seguir'))}</button></div></div>`);
    popup({ titulo, contenido: box, clase: 'kit-pop--sm' });
  }

  // ---------- Mercado Pago
  function urlRetorno(pedido) {
    const u = new URL(location.href); u.hash = '';
    ['kit_pedido', 'collection_status', 'status', 'payment_id', 'collection_id', 'external_reference', 'preference_id', 'merchant_order_id', 'payment_type', 'site_id', 'processing_mode', 'merchant_account_id'].forEach(k => u.searchParams.delete(k));
    u.searchParams.set('kit_pedido', pedido.id);
    return u.href;
  }

  async function pagarMP(pedido) {
    const mp = config.pagos.mercadopago;
    if (mp.modo === 'simulado' || !mp.endpoint) return simularMP(pedido);
    try {
      const res = await fetch(mp.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          negocio: config.id, pais: config.pais, modo: mp.modo || 'sandbox', pedidoId: pedido.id, codigo: pedido.codigo,
          items: pedido.items.map(i => ({ title: i.nombre, quantity: i.cant, unit_price: i.precio })),
          envio: pedido.envio, backUrl: urlRetorno(pedido), payer: { name: pedido.cliente.nombre },
        }),
      });
      const j = await res.json().catch(() => ({}));
      const destino = (mp.modo !== 'produccion' && j.sandbox_init_point) || j.init_point;
      if (!res.ok || !destino) throw new Error(j.error || 'sin init_point');
      vaciar();
      location.href = destino;
    } catch (err) {
      console.warn('[kit] Mercado Pago:', err.message);
      toast(t('mpSinConexion'), 'warn', 4200);
      simularMP(pedido);
    }
  }

  // Simulación honesta (rotulada como demo) para cuando no hay credenciales o conexión.
  function simularMP(pedido) {
    if (pop) pop.close();
    const box = h(`<div class="kit-sim">
      <p class="kit-sim__tag">DEMO</p>
      <p>${esc(t('mpSimuladoSub'))}</p>
      <div class="kit-sim__total"><span>${esc(pedido.codigo)}</span><b>${ctx.money(pedido.total)}</b></div>
      <div class="kit-row kit-row--stack">
        <button type="button" class="kit-btn kit-btn--block" data-ok>${esc(t('mpAprobar'))}</button>
        <button type="button" class="kit-btn kit-btn--ghost kit-btn--block" data-no>${esc(t('mpRechazar'))}</button>
      </div></div>`);
    const p = popup({ titulo: t('mpSimulado'), contenido: box, clase: 'kit-pop--sm' });
    box.querySelector('[data-ok]').onclick = () => { p.close(); vaciar(); retorno(pedido.id, 'approved', 'SIM-' + Date.now()); };
    box.querySelector('[data-no]').onclick = () => { p.close(); retorno(pedido.id, 'rejected'); };
  }

  async function retorno(id, status, paymentId = '') {
    const estado = status === 'approved' ? 'aprobado' : (status === 'rejected' || status === 'null' || status === 'failure') ? 'rechazado' : 'pendiente';
    await store.marcarPago(id, estado, paymentId);
    const ped = await store.getPedidoPublico(id);
    const codigo = ped?.codigo || '';
    if (estado === 'aprobado') { vaciar(); exito(t('pedidoPagado'), t('pedidoPagadoSub', { codigo })); }
    else if (estado === 'pendiente') exito(t('pagoPendiente'), t('pagoPendienteSub', { codigo }), null, 'warn');
    else exito(t('pagoRechazado'), t('pagoRechazadoSub'), null, 'warn');
  }

  function revisarRetornoMP() {
    const q = new URLSearchParams(location.search);
    const id = q.get('kit_pedido'); if (!id) return;
    const status = q.get('collection_status') || q.get('status') || 'pending';
    const u = new URL(location.href);
    [...u.searchParams.keys()].forEach(k => { if (k === 'kit_pedido' || /^(collection_|payment_|merchant_|preference_id|external_reference|status|site_id|processing_mode)/.test(k)) u.searchParams.delete(k); });
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    retorno(id, status, q.get('payment_id') || q.get('collection_id') || '');
  }

  async function cargar() {
    productos = await store.getProductos();
    lineas = lineas.filter(l => productos.some(p => p.id === l.id && p.disponible !== false && p.precio != null));
    guardar(); sync(); pintarFab();
    if (pop) pintarDrawer();
  }
  store.onChange(cargar);
  const listo = cargar().then(revisarRetornoMP);

  return {
    abrir, sync, listo,
    agregar: (id, n = 1, o = {}) => cambiar(id, n, o.origen || null, o.nota || ''),
    elegirSucursal, get sucursal() { return sucActual(); }, sucursales: SUCS,
    vaciar, get lineas() { return lineas.slice(); }, calc,
  };
}
