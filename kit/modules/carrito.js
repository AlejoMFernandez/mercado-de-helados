// Módulo CARRITO + CHECKOUT.
// Salidas configurables en cliente.json → "pedidos": { "salidas": ["whatsapp", "mercadopago"] }
//   whatsapp     → guarda el pedido (entra al panel) y abre WhatsApp con el mensaje armado.
//   mercadopago  → guarda el pedido, crea la preferencia en /api/mp-preference y redirige al checkout.
//   efectivo     → como whatsapp, pero "pagás en efectivo al retirar" con el descuento del día
//                  (pagos.efectivo en cliente.json, ver core/descuentos.js).
//
// Cualquier botón con data-kit-add="<idProducto>" suma al carrito.
// Cualquier elemento con data-kit-qty="<idProducto>" muestra "Agregar" o el selector − n +.
// data-kit-open="carrito" abre el carrito.
// data-kit-sucursal="<id>" deja elegida esa sede (cadenas con "sucursales" en cliente.json).
// kit.carrito.agregar(id, n, { nota }) suma con una aclaración propia (ej. "salchicha alemana").
// kit.carrito.agregarGiftcard({ monto, para, de, mensaje }) suma una gift card (cliente.json → giftcards).
// Tamaños y adicionales: kit.carrito.agregar(id, 1, { variante: '24', extras: ['macarons'] }).
// kit.carrito.setRetiro({ fecha, franja }) deja elegido el día y la franja (ej. desde un selector propio de la demo).
// Seña (categoría con "sena": 0.5): el checkout muestra Hoy pagás / Resto al retirar y Mercado Pago cobra solo la seña.
import { esc, h, $$, telValido, uid } from '../core/util.js';
import { t } from '../core/i18n.js';
import { popup, toast, copiar } from '../core/ui.js';
import { armarPedido, mensajePedido, linkWhatsApp, totalTexto, itemsCobro } from '../core/pedidos.js';
import { precioLinea, claveLinea } from '../core/variantes.js';
import { configEncargo, opcionesRetiro, textoRetiro } from '../core/encargos.js';
import { sucursales, sucursalPorId, pideSucursal, resumenSucursal } from '../core/sucursales.js';
import { descuentoEfectivo } from '../core/descuentos.js';
import { configGiftcards, montoValido } from '../core/giftcards.js';

export function initCarrito(ctx, opts = {}) {
  const { config, store } = ctx;
  const KEY = `kit:${config.id}:carrito`;
  const P = config.pedidos || {};
  const salidas = (P.salidas || ['whatsapp']).filter(s => s !== 'mercadopago' || config.pagos?.mercadopago);
  const tipos = P.tipos || ['retiro'];
  const E = configEncargo(P.encargo);
  let productos = [];
  let categorias = [];
  let lineas = leer();
  let pop = null;
  const SEDE_KEY = `kit:${config.id}:sede`;
  const sedes = sucursales(config);
  const sedeGuardada = (() => { try { return localStorage.getItem(SEDE_KEY) || ''; } catch (_) { return ''; } })();
  let datos = { tipo: tipos[0], pago: salidas[0], nombre: '', telefono: '', direccion: '', nota: '', retiroFecha: '', retiroFranja: '',
    sucursal: sucursalPorId(config, sedeGuardada) ? sedeGuardada : (sedes.length === 1 ? sedes[0].id : '') };
  function setSucursal(id) {
    if (!sucursalPorId(config, id)) return;
    datos.sucursal = id;
    try { localStorage.setItem(SEDE_KEY, id); } catch (_) { /* sin storage */ }
    if (pop) pintarDrawer();
    document.dispatchEvent(new CustomEvent('kit:sucursal', { detail: sucursalPorId(config, id) }));
  }

  function leer() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } }
  function guardar() { try { localStorage.setItem(KEY, JSON.stringify(lineas)); } catch (_) { /* sin storage: queda en memoria */ } }
  const cantDe = (id) => lineas.filter(l => l.id === id).reduce((s, l) => s + l.cant, 0);
  const pctPago = (pago) => pago === 'efectivo' ? descuentoEfectivo(config) : 0;
  const GC = configGiftcards(config);
  const calc = () => armarPedido(productos, lineas, { tipo: datos.tipo, pedidos: P, descuentoPct: pctPago(datos.pago), giftcards: GC, categorias });
  const conSena = (c) => c.saldo > 0;

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
    fab.querySelector('.kit-fab__total').textContent = c.sinPrecio ? totalTexto(c, ctx.money) : (ctx.money(c.subtotal) || '');
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
  function lineaQtyHTML(i) {
    const k = esc(claveLinea(i));
    return `<div class="kit-step" role="group" aria-label="${esc(t('tuPedido'))}">
      <button type="button" data-kit-linea="${k}" data-delta="-1" aria-label="${esc(t('quitar'))}">−</button>
      <output aria-live="polite">${i.cant}</output>
      <button type="button" data-kit-linea="${k}" data-delta="1" aria-label="${esc(t('agregar'))}">+</button></div>`;
  }
  function sync(root = document) { $$('[data-kit-qty]', root).forEach(el => { el.innerHTML = qtyHTML(el.dataset.kitQty); }); }

  function cambiar(id, delta, origen, nota = '', opc = {}) {
    const p = productos.find(x => x.id === id);
    if (!p || !ctx.pedible(p)) return;
    const pl = precioLinea(p, opc);
    // la posición del botón se toma ANTES de redibujar (sync reemplaza el botón y su rect queda en 0,0)
    const desde = origen && origen.isConnected ? origen.getBoundingClientRect() : null;
    nota = String(nota || '').trim().slice(0, 140);
    const nueva = { id, cant: delta, nota, ...(pl.variante ? { variante: pl.variante } : {}), ...(pl.extras.length ? { extras: pl.extras } : {}) };
    const l = lineas.find(x => !x.gc && claveLinea(x) === claveLinea(nueva));
    if (l) l.cant = Math.max(0, Math.min(99, l.cant + delta));
    else if (delta > 0) lineas.push(nueva);
    lineas = lineas.filter(x => x.cant > 0);
    guardar(); sync(); pintarFab(delta > 0);
    if (pop) pintarDrawer();
    if (delta > 0 && desde && desde.width) volar(desde, p);
    document.dispatchEvent(new CustomEvent('kit:carrito', { detail: { lineas: lineas.slice(), producto: p, delta } }));
  }

  // ---------- gift cards
  function agregarGiftcard(gc = {}, origen = null) {
    if (!GC || !montoValido(GC, gc.monto)) return null;
    const desde = origen && origen.isConnected ? origen.getBoundingClientRect() : null;
    const key = uid('gc').replace(/[^a-z0-9]/gi, '').slice(0, 12);
    lineas.push({ id: 'giftcard', key, cant: 1, gc: { monto: Number(gc.monto), para: String(gc.para || '').trim().slice(0, 60), de: String(gc.de || '').trim().slice(0, 60), mensaje: String(gc.mensaje || '').trim().slice(0, 200) } });
    guardar(); pintarFab(true);
    if (pop) pintarDrawer();
    if (desde && desde.width) volar(desde, { foto: opts.giftcardFoto || '' });
    document.dispatchEvent(new CustomEvent('kit:carrito', { detail: { lineas: lineas.slice(), giftcard: gc, delta: 1 } }));
    return key;
  }
  function quitarGiftcard(key) {
    lineas = lineas.filter(l => !(l.gc && l.key === key));
    guardar(); pintarFab(); if (pop) pintarDrawer();
    document.dispatchEvent(new CustomEvent('kit:carrito', { detail: { lineas: lineas.slice(), delta: -1 } }));
  }

  // pequeño "vuelo" del botón al carrito
  // destino del vuelo: el botón flotante o, si la demo usa su propio botón de carrito, el primer [data-kit-target] visible
  function destino() {
    const propio = Array.from(document.querySelectorAll('[data-kit-target]')).find(el => el.getClientRects().length && el.getBoundingClientRect().width);
    if (propio) return propio;
    return fab.isConnected && !fab.hidden ? fab : null;
  }
  function volar(a, p) {
    const dst = destino();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !dst) return;
    const b = dst.getBoundingClientRect();
    const dot = h(`<span class="kit-root kit-fly">${p.foto ? `<img src="${esc(ctx.asset(p.foto))}" alt="">` : ''}</span>`);
    dot.style.left = a.left + a.width / 2 + 'px'; dot.style.top = a.top + a.height / 2 + 'px';
    document.body.appendChild(dot);
    requestAnimationFrame(() => {
      dot.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(.35)`;
      dot.style.opacity = '.2';
    });
    setTimeout(() => { dot.remove(); if (dst !== fab) { dst.classList.remove('kit-bump'); void dst.offsetWidth; dst.classList.add('kit-bump'); } }, 620);
  }

  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-kit-add]'); if (add) { e.preventDefault(); cambiar(add.dataset.kitAdd, 1, add); return; }
    const dec = e.target.closest('[data-kit-dec]'); if (dec) { e.preventDefault(); cambiar(dec.dataset.kitDec, -1); return; }
    const gq = e.target.closest('[data-kit-gc-quitar]'); if (gq) { e.preventDefault(); quitarGiftcard(gq.dataset.kitGcQuitar); return; }
    const li = e.target.closest('[data-kit-linea]');
    if (li) { e.preventDefault(); const l = lineas.find(x => !x.gc && claveLinea(x) === li.dataset.kitLinea); if (l) cambiar(l.id, Number(li.dataset.delta) || 0, li, l.nota || '', { variante: l.variante, extras: l.extras }); return; }
    const suc = e.target.closest('[data-kit-sucursal]'); if (suc) setSucursal(suc.dataset.kitSucursal);
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
    if (c.sinPrecio && datos.pago === 'mercadopago') datos.pago = salidas.find(s => s !== 'mercadopago') || 'whatsapp';
    const body = pop.body;
    if (!c.items.length) {
      body.innerHTML = `<div class="kit-empty">${opts.vacioIlustracion || ''}<p class="kit-empty__t">${esc(t('carritoVacio'))}</p><p>${esc(t('carritoVacioSub'))}</p>
        <button type="button" class="kit-btn" data-close>${esc(t('seguir'))}</button></div>`;
      return;
    }
    const scroll = body.querySelector('.kit-cart__scroll')?.scrollTop || 0;
    body.innerHTML = `
      <div class="kit-cart__scroll">
        <ul class="kit-lines">${c.items.map(i => {
          if (i.giftcard) return `<li class="kit-line kit-line--gc">
            ${opts.giftcardFoto ? `<img src="${esc(ctx.asset(opts.giftcardFoto))}" alt="" class="kit-line__img">` : '<span class="kit-line__img kit-line__img--gc" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 11h18M12 7v13M12 7c-1.5-3-6-3-5 0M12 7c1.5-3 6-3 5 0"/></svg></span>'}
            <div class="kit-line__body"><b>${esc(i.nombre)}</b>${i.nota ? `<em class="kit-line__nota">${esc(i.nota)}${i.giftcard.de ? ` · ${esc(t('gcDe', { de: i.giftcard.de }))}` : ''}</em>` : ''}<span>${ctx.money(i.precio)}</span></div>
            <div class="kit-qty"><button type="button" class="kit-gc-x" data-kit-gc-quitar="${esc(i.key)}" aria-label="${esc(t('quitar'))} ${esc(i.nombre)}">${esc(t('quitar'))}</button></div>
          </li>`;
          const p = productos.find(x => x.id === i.id) || {};
          return `<li class="kit-line">
            ${p.foto ? `<img src="${esc(ctx.asset(p.foto))}" alt="" class="kit-line__img">` : '<span class="kit-line__img kit-line__img--na"></span>'}
            <div class="kit-line__body"><b>${esc(i.nombre)}</b>${i.detalle ? `<em class="kit-line__det">${esc(i.detalle)}</em>` : ''}${i.nota ? `<em class="kit-line__nota">${esc(i.nota)}</em>` : ''}<span>${i.precio != null ? ctx.money(i.precio) : `<span class="kit-price--na">${esc(t('aConfirmar'))}</span>`}${i.sena ? ` <small class="kit-line__sena">${esc(t('senaDe', { pct: Math.round(i.sena * 100) }))}</small>` : ''}</span></div>
            <div class="kit-qty">${i.nota || i.variante || i.extras ? lineaQtyHTML(i) : qtyHTML(i.id)}</div>
          </li>`;
        }).join('')}</ul>

        <form class="kit-form" novalidate>
          ${tipos.length > 1 ? `<fieldset class="kit-seg"><legend class="kit-sr">${esc(t('waEntrega'))}</legend>
            ${tipos.map(tp => `<label><input type="radio" name="tipo" value="${tp}" ${datos.tipo === tp ? 'checked' : ''}><span>${esc(t(tp))}</span></label>`).join('')}</fieldset>` : ''}
          ${E ? encargoHTML(c) : ''}
          ${pideSucursal(config) ? `<fieldset class="kit-sedes"><legend>${esc(t(datos.tipo === 'delivery' ? 'sedeDelivery' : 'sedeRetiro'))}</legend>
            <div class="kit-sedes__list">${sedes.map(s => `<label class="kit-sede"><input type="radio" name="sucursal" value="${esc(s.id)}" ${datos.sucursal === s.id ? 'checked' : ''}>
              <span><b>${esc(s.nombre || s.id)}</b>${s.direccion ? `<small>${esc(s.direccion)}</small>` : ''}</span></label>`).join('')}</div></fieldset>` : ''}
          <label class="kit-field"><span>${esc(t('nombre'))}</span><input name="nombre" autocomplete="name" required value="${esc(datos.nombre)}"></label>
          <label class="kit-field"><span>${esc(t('telefono'))}</span><input name="telefono" type="tel" inputmode="tel" autocomplete="tel" required value="${esc(datos.telefono)}"></label>
          <label class="kit-field" ${datos.tipo === 'delivery' ? '' : 'hidden'} data-dir><span>${esc(t('direccion'))}</span><input name="direccion" autocomplete="street-address" value="${esc(datos.direccion)}"></label>
          <label class="kit-field"><span>${esc(t('notaPedido'))}</span><textarea name="nota" rows="2" maxlength="280">${esc(datos.nota)}</textarea></label>
          ${salidas.length > 1 ? `<fieldset class="kit-pay"><legend>${esc(t('comoPagas'))}</legend>
            ${salidas.map(s => { const off = s === 'mercadopago' && c.sinPrecio; return `<label class="kit-pay__opt${off ? ' is-off' : ''}"><input type="radio" name="pago" value="${s}" ${datos.pago === s ? 'checked' : ''} ${off ? 'disabled' : ''}>
              <span class="kit-pay__card"><b>${esc(t(s === 'whatsapp' ? 'porWhatsapp' : s === 'efectivo' ? 'porEfectivo' : 'porMP'))}</b><small>${esc(off ? t('mpSinPrecio') : s === 'efectivo' ? (pctPago(s) ? t('porEfectivoSub', { pct: pctPago(s) }) : t('porEfectivoSubSin')) : t(s === 'whatsapp' ? 'porWhatsappSub' : 'porMPSub'))}</small></span></label>`; }).join('')}
          </fieldset>` : ''}
        </form>
      </div>
      <div class="kit-cart__foot">
        <div class="kit-sum">
          ${c.envio || c.descuento ? `<div><span>${esc(t('subtotal'))}</span><span>${ctx.money(c.subtotal)}</span></div>` : ''}
          ${c.envio ? `<div><span>${esc(t('envio'))}</span><span>${ctx.money(c.envio)}</span></div>` : ''}
          ${c.descuento ? `<div class="kit-sum__desc"><span>${esc(t('descEfectivo', { pct: c.descuentoPct }))}</span><span>−${ctx.money(c.descuento)}</span></div>` : ''}
          ${conSena(c) ? `<div><span>${esc(t('total'))}</span><span>${esc(totalTexto(c, ctx.money))}</span></div>
          <div class="kit-sum__resto"><span>${esc(t('saldoRetiro'))}</span><span>${ctx.money(c.saldo)}</span></div>
          <div class="kit-sum__total"><span>${esc(t('hoyPagas'))}</span><b>${ctx.money(c.aPagar)}</b></div>`
          : `<div class="kit-sum__total"><span>${esc(t('total'))}</span><b>${esc(totalTexto(c, ctx.money))}</b></div>`}
        </div>
        ${c.sinPrecio ? `<p class="kit-aviso">${esc(t('avisoSinPrecio'))}</p>` : ''}
        <p class="kit-msg" role="alert" hidden></p>
        <button type="button" class="kit-btn kit-btn--block kit-btn--big" data-enviar>${esc(textoBoton(c))}</button>
      </div>`;
    body.querySelector('.kit-cart__scroll').scrollTop = scroll;
    const form = body.querySelector('form');
    form.addEventListener('input', (e) => {
      const f = e.target; if (!f.name) return;
      if (f.name === 'sucursal') { setSucursal(f.value); return; }
      datos[f.name] = f.value;
      if (f.name === 'retiroFecha') { datos.retiroFranja = ''; pintarDrawer(); return; }
      if (f.name === 'retiroFranja') { $$('.kit-franja', body).forEach(l => l.classList.toggle('is-on', l.querySelector('input').checked)); return; }
      if (f.name === 'tipo') { body.querySelector('[data-dir]').hidden = f.value !== 'delivery'; pintarTotales(); }
      if (f.name === 'pago') { if (pctPago(f.value) || c.descuento) { pintarTotales(); return; } body.querySelector('[data-enviar]').textContent = textoBoton(calc()); }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
    body.querySelector('[data-enviar]').addEventListener('click', enviar);
  }
  function pintarTotales() { if (pop) pintarDrawer(); }
  function textoBoton(c) {
    if (datos.pago !== 'mercadopago') return t('enviarPedido');
    return conSena(c) ? `${t('pagarSena')} · ${ctx.money(c.aPagar)}` : t('pagar');
  }
  function setRetiro({ fecha, franja } = {}) {
    if (fecha !== undefined) datos.retiroFecha = fecha || '';
    if (franja !== undefined) datos.retiroFranja = franja || '';
    if (pop) pintarDrawer();
  }

  // ---------- encargo: día y franja de retiro
  function retiroOpciones() {
    return opcionesRetiro({ horarios: config.horarios, encargo: P.encargo, tz: ctx.tz, productos, categorias, lineas, ignorarVentanas: !!ctx.forzarEspecial });
  }
  function elegirRetiro(op) {
    let dia = op.dias.find(d => d.fecha === datos.retiroFecha && d.abierto);
    if (!dia) { dia = op.dias.find(d => d.abierto); datos.retiroFecha = dia ? dia.fecha : ''; datos.retiroFranja = ''; }
    if (dia && !dia.franjas.some(f => f.id === datos.retiroFranja && f.disponible)) datos.retiroFranja = (dia.franjas.find(f => f.disponible) || {}).id || '';
    return dia;
  }
  function encargoHTML() {
    const op = retiroOpciones();
    const dia = elegirRetiro(op);
    const dc = t('diasCortos'), ms = t('meses');
    const fmt = (f) => { const [, m, d] = f.split('-').map(Number); return `${d} ${ms[m - 1]}`; };
    const espec = categorias.find(cat => cat.especial && lineas.some(l => productos.find(p => p.id === l.id)?.categoria === cat.id));
    return `<fieldset class="kit-retiro"><legend>${esc(t(datos.tipo === 'delivery' ? 'diaEnvio' : 'diaRetiro'))}${op.horas ? `<small>${esc(t('anticipacion', { h: op.horas }))}</small>` : ''}</legend>
      ${op.dias.some(d => d.abierto) ? `<div class="kit-dias">${op.dias.map(d => { const [, m, dd] = d.fecha.split('-').map(Number);
        return `<label class="kit-dia${d.abierto ? '' : ' is-off'}${d.fecha === datos.retiroFecha ? ' is-on' : ''}"><input type="radio" name="retiroFecha" value="${d.fecha}" ${d.fecha === datos.retiroFecha ? 'checked' : ''} ${d.abierto ? '' : 'disabled'}>
          <span><small>${esc(d.fecha === ctx.hoy() ? t('hoy') : dc[d.dow])}</small><b>${dd}</b><small>${esc(ms[m - 1])}</small></span></label>`; }).join('')}</div>`
        : `<p class="kit-hint">${esc(t('sinDiasRetiro'))}</p>`}
      ${espec && espec.desde && espec.hasta && !ctx.forzarEspecial ? `<p class="kit-hint">${esc(t('ventanaEspecial', { nombre: espec.nombre, desde: fmt(espec.desde), hasta: fmt(espec.hasta) }))}</p>` : ''}
    </fieldset>
    ${dia ? `<fieldset class="kit-franjas"><legend>${esc(t('franja'))}</legend><div class="kit-franjas__list">
      ${dia.franjas.map(f => `<label class="kit-franja${f.disponible ? '' : ' is-off'}${f.id === datos.retiroFranja ? ' is-on' : ''}"><input type="radio" name="retiroFranja" value="${esc(f.id)}" ${f.id === datos.retiroFranja ? 'checked' : ''} ${f.disponible ? '' : 'disabled'}>
        <span><b>${esc(f.nombre)}</b><small>${esc(f.desde.replace(/^0/, ''))} a ${esc(f.hasta.replace(/^0/, ''))}</small></span></label>`).join('')}
    </div></fieldset>` : ''}`;
  }
  function retiroElegido() {
    if (!E) return null;
    const op = retiroOpciones();
    const dia = op.dias.find(d => d.fecha === datos.retiroFecha && d.abierto);
    const fr = dia?.franjas.find(f => f.id === datos.retiroFranja && f.disponible);
    if (!dia || !fr) return null;
    return { fecha: dia.fecha, franja: { id: fr.id, nombre: fr.nombre, desde: fr.desde, hasta: fr.hasta } };
  }

  function error(msg) { const m = pop.body.querySelector('.kit-msg'); m.textContent = msg; m.hidden = false; m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); }

  async function enviar() {
    const c = calc();
    const faltan = [];
    if (!datos.nombre.trim()) faltan.push(t('nombre').toLowerCase());
    if (!telValido(datos.telefono)) faltan.push(t('telefono').toLowerCase());
    if (pideSucursal(config) && !sucursalPorId(config, datos.sucursal)) faltan.unshift(t('laSede'));
    if (datos.tipo === 'delivery' && datos.direccion.trim().length < 5) faltan.push(t('direccion').toLowerCase());
    const retiro = retiroElegido();
    if (E && !retiro) faltan.unshift(datos.retiroFecha ? t('laFranja') : t('elDia'));
    if (faltan.length) return error(t('faltan', { campos: faltan.join(', ') }));
    if (P.minimo && !c.sinPrecio && c.subtotal < P.minimo) return error(t('minimo', { monto: ctx.money(P.minimo) }));
    if (c.sinPrecio && datos.pago === 'mercadopago') datos.pago = 'whatsapp';
    const btn = pop.body.querySelector('[data-enviar]'); btn.disabled = true; btn.classList.add('is-loading');
    try {
      const pedido = await store.createPedido({
        items: lineas.map(l => l.gc ? { id: 'giftcard', cant: 1, gc: l.gc } : { id: l.id, cant: l.cant, nota: l.nota, variante: l.variante, extras: l.extras }), tipo: datos.tipo,
        cliente: { nombre: datos.nombre.trim(), telefono: datos.telefono.trim(), direccion: datos.tipo === 'delivery' ? datos.direccion.trim() : '' },
        nota: datos.nota.trim(), pago: datos.pago, ...(retiro ? { retiro } : {}),
        ...(sedes.length ? { sucursal: resumenSucursal(sucursalPorId(config, datos.sucursal)) } : {}),
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
    const texto = mensajePedido(pedido, { negocio: config.nombre, money: ctx.money, retiroTexto: textoRetiro(pedido.retiro, { dias: t('dias'), hoy: ctx.hoy() }) });
    const sede = pedido.sucursal ? sucursalPorId(config, pedido.sucursal.id) : null;
    const { url, soloLink } = linkWhatsApp(sede?.whatsapp || config.whatsapp, texto);
    vaciar();
    if (soloLink) { await copiar(texto); toast(t('copiado'), 'ok', 4200); }
    exito(t('pedidoListo'), t('pedidoListoSub', { codigo: pedido.codigo }), url);
    if (url) window.open(url, '_blank', 'noopener');
  }

  function vaciar() { lineas = []; guardar(); sync(); pintarFab(); document.dispatchEvent(new CustomEvent('kit:carrito', { detail: { lineas: [], delta: 0 } })); }

  function exito(titulo, sub, waUrl, tipo = 'ok') {
    if (pop) pop.close();
    const box = h(`<div class="kit-done kit-done--${tipo}">
      <div class="kit-done__ico" aria-hidden="true">${tipo === 'ok' ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/></svg>'}</div>
      <h3>${esc(titulo)}</h3><p>${esc(sub)}</p>
      <div class="kit-row kit-row--center">${waUrl ? `<a class="kit-btn" href="${esc(waUrl)}" target="_blank" rel="noopener">${esc(t('abrirWA'))}</a>` : ''}
      <button type="button" class="kit-btn kit-btn--ghost" data-close>${esc(t('seguir'))}</button></div></div>`);
    popup({ titulo, contenido: box, clase: 'kit-pop--sm' });
  }

  function exitoGiftcards(gcs, codigo) {
    if (pop) pop.close();
    const box = h(`<div class="kit-done">
      <div class="kit-done__ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h3>${esc(t('gcListas'))}</h3><p>${esc(t('gcListasSub', { codigo }))}</p>
      <ul class="kit-gcs">${gcs.map(g => `<li><b>${esc(g.codigo)}</b><span>${ctx.money(g.monto)}${g.para ? ` · ${esc(t('gcPara', { para: g.para }))}` : ''}</span>${g.vence ? `<small>${esc(t('gcVence', { fecha: new Date(g.vence).toLocaleDateString(ctx.pais.locale) }))}</small>` : ''}</li>`).join('')}</ul>
      <div class="kit-row kit-row--center"><button type="button" class="kit-btn" data-close>${esc(t('seguir'))}</button></div></div>`);
    popup({ titulo: t('gcListas'), contenido: box, clase: 'kit-pop--sm' });
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
          items: itemsCobro(pedido, { prefijoSena: t('senaCorta') }),
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
      <div class="kit-sim__total"><span>${esc(pedido.codigo)}${pedido.saldo > 0 ? ` · ${esc(t('senaCorta'))}` : ''}</span><b>${ctx.money(pedido.aPagar ?? pedido.total)}</b></div>
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
    if (estado === 'aprobado') {
      vaciar();
      const gcs = store.getGiftcardsDePedido ? await store.getGiftcardsDePedido(id).catch(() => []) : [];
      if (gcs.length) {
        // la demo puede mostrar sus propias tarjetas: escucha kit:giftcards y hace preventDefault()
        const ev = new CustomEvent('kit:giftcards', { detail: { pedido: ped, giftcards: gcs }, cancelable: true });
        if (document.dispatchEvent(ev)) exitoGiftcards(gcs, codigo);
        return;
      }
      exito(t('pedidoPagado'), t('pedidoPagadoSub', { codigo }));
    }
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
    [productos, categorias] = await Promise.all([store.getProductos(), store.getCategorias()]);
    lineas = lineas.filter(l => l.gc ? (GC && montoValido(GC, l.gc.monto)) : ctx.pedible(productos.find(p => p.id === l.id)));
    guardar(); sync(); pintarFab();
    if (pop) pintarDrawer();
  }
  store.onChange(cargar);
  const listo = cargar().then(revisarRetornoMP);

  return {
    abrir, sync, listo,
    agregar: (id, n = 1, o = {}) => cambiar(id, n, o.origen || null, o.nota || '', { variante: o.variante, extras: o.extras }),
    setRetiro, get retiro() { return { fecha: datos.retiroFecha, franja: datos.retiroFranja }; },
    agregarGiftcard: (gc, o = {}) => agregarGiftcard(gc, o.origen || null), quitarGiftcard,
    setSucursal, get sucursal() { return sucursalPorId(config, datos.sucursal); },
    vaciar, get lineas() { return lineas.slice(); }, calc, retiroOpciones,
  };
}
