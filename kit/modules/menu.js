// CARTA PÚBLICA (/carta): la página a la que lleva el QR de las mesas.
// Liviana y pensada para el celu en la mesa: una sección por vez (nunca una lista eterna), buscador en toda la carta,
// estado abierto / cerrado, y se actualiza sola cuando el dueño edita desde /admin.
//
//   <div id="kit-menu"></div>
//   <script type="module">
//     import { initMenu } from '../kit/modules/menu.js';
//     initMenu({ config: '../cliente.json', sitio: '../' });
//   </script>
//
// URL: ?sede=<id> (cadenas: muestra esa sede y su horario) · #<id de sección> abre esa sección.
// cliente.json → "cartaQR": { "pedir": true } suma el botón Agregar y el carrito (si el módulo carrito está activo).
import { cargarConfig, crearContexto } from '../kit.js';
import { esc, $, $$, debounce } from '../core/util.js';
import { t } from '../core/i18n.js';
import { tieneVariantes, precioDesde } from '../core/variantes.js';
import { filtrarCarta } from '../core/temporadas.js';
import { sucursalPorId } from '../core/sucursales.js';
import { estadoAbierto } from '../core/turnos.js';
import { cargadorImagenes } from '../core/imagenes.js';
import { initCarrito } from './carrito.js';

const ICONOS = {
  picante: '<svg viewBox="0 0 24 24"><path d="M14 6c3 0 6 2 6 6 0 6-8 10-15 10 6-3 7-7 8-11 .4-2 1-5 1-5Z" fill="currentColor"/><path d="M14 6c0-2 1-3 3-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  veggie: '<svg viewBox="0 0 24 24"><path d="M20 4C10 4 4 9 4 16c0 2 1 4 1 4s2-7 9-10c-5 4-7 8-7 10 9 0 13-7 13-16Z" fill="currentColor"/></svg>',
  casa: '<svg viewBox="0 0 24 24"><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8Z" fill="currentColor"/></svg>',
  nuevo: '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.9H22l-6 4.4 2.3 7L12 16l-6.3 4.3 2.3-7-6-4.4h7.6Z" fill="currentColor"/></svg>',
};
const LABELS = { es: { picante: 'Picante', veggie: 'Sin carne', casa: 'De la casa', nuevo: 'Nuevo' }, 'pt-BR': { picante: 'Apimentado', veggie: 'Vegetariano', casa: 'Da casa', nuevo: 'Novo' } };
const LUPA = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';
const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2a9.8 9.8 0 0 0-8.4 14.9L2.3 21.8l4.8-1.3A9.8 9.8 0 1 0 12 2.2Zm0 17.8a8 8 0 0 1-4.1-1.1l-.3-.2-2.8.8.8-2.7-.2-.3A8 8 0 1 1 12 20Zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.1-.3Z" fill="currentColor"/></svg>';
const IG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/></svg>';

export async function initMenu(opts = {}) {
  const root = document.getElementById(opts.mount || 'kit-menu');
  cargadorImagenes(opts.imagenes || {});
  let ctx;
  try { ctx = await crearContexto(await cargarConfig(opts.config || '../cliente.json')); }
  catch (e) { root.innerHTML = '<p class="kit-error">No se pudo cargar la carta.</p>'; throw e; }
  const { config, store } = ctx;
  const sitio = opts.sitio || '../';
  const CQ = config.cartaQR || {};
  const params = new URLSearchParams(location.search);
  const sede = sucursalPorId(config, params.get('sede'));
  const horarios = sede ? sede.horarios : config.horarios;
  document.documentElement.lang = ctx.lang;
  document.documentElement.classList.add('kit-on', `kit-${store.modo}`);
  document.title = `${t('carta')} · ${config.nombre}${sede ? ` · ${sede.nombre}` : ''}`;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = config.marca?.colores?.fondo || '#fff';
  if (config.marca?.favicon) { const l = document.querySelector('link[rel=icon]') || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' })); l.href = ctx.asset(config.marca.favicon); }
  if (CQ.pedir && config.modulos.carrito) ctx.carrito = initCarrito(ctx, opts.carrito);

  let cats = [], prods = [], actual = decodeURIComponent(location.hash.slice(1)) || null, q = '';

  const waNum = String(sede?.whatsapp || config.whatsapp || '').replace(/\D/g, '');
  const ig = String(config.instagram || '').replace(/^@/, '').trim();
  root.className = 'kit-root kit-menu';
  root.innerHTML = `
    <header class="kmn-top">
      <a class="kmn-logo" href="${esc(sitio)}" aria-label="${esc(config.nombre)}">
        ${config.marca?.logo ? `<img src="${esc(ctx.asset(config.marca.logo))}" alt="${esc(config.nombre)}" data-kit-ph="no">` : `<span class="kmn-nombre">${esc(config.nombre)}</span>`}
      </a>
      ${sede ? `<p class="kmn-sede">${esc(sede.nombre)}${sede.direccion ? ` · ${esc(sede.direccion)}` : ''}</p>` : ''}
      <p class="kmn-estado" data-estado hidden></p>
    </header>
    <div class="kmn-bar">
      <div class="kmn-bar__in">
        <div class="kmn-chips" role="tablist" aria-label="${esc(t('menuSecciones'))}" data-chips></div>
        <button type="button" class="kmn-lupa" data-lupa aria-label="${esc(t('buscarCarta'))}">${LUPA}</button>
        <label class="kmn-buscar" data-buscar-box>
          ${LUPA}<input type="search" data-buscar placeholder="${esc(t('buscarCarta'))}" aria-label="${esc(t('buscarCarta'))}" enterkeyhint="search" autocomplete="off">
          <button type="button" class="kmn-x" data-cerrar-busqueda aria-label="${esc(t('borrarBusqueda'))}">${X}</button>
        </label>
      </div>
    </div>
    <main class="kmn-main" data-main aria-live="polite"><div class="kmn-cargando" aria-busy="true"><span></span><span></span><span></span></div></main>
    <footer class="kmn-pie">
      <div class="kmn-pie__acc">
        ${waNum ? `<a class="kit-btn kmn-pie__wa" href="https://wa.me/${esc(waNum)}" target="_blank" rel="noopener">${WA}<span>${esc(t('escribinos'))}</span></a>` : ''}
        ${ig ? `<a class="kit-btn kit-btn--ghost" href="https://instagram.com/${esc(ig)}" target="_blank" rel="noopener">${IG}<span>@${esc(ig)}</span></a>` : ''}
      </div>
      <a class="kmn-pie__web" href="${esc(sitio)}">${esc(t('verWeb'))} →</a>
      <p class="kmn-pie__cred">© ${new Date().getFullYear()} ${esc(config.nombre)} · Sitio desarrollado por <a href="https://alejomfernandez.com.ar" target="_blank" rel="noopener">Alejo Martín Fernández</a></p>
    </footer>`;

  const main = $('[data-main]', root), chips = $('[data-chips]', root), bar = $('.kmn-bar', root);
  const input = $('[data-buscar]', root);

  // ---------- estado abierto / cerrado (se refresca cada minuto)
  function pintarEstado() {
    const el = $('[data-estado]', root);
    if (!horarios || !Object.keys(horarios).length) { el.hidden = true; return; }
    const e = estadoAbierto(horarios, ctx.tz);
    el.hidden = false;
    el.classList.toggle('is-abierto', e.abierto);
    el.innerHTML = `<i></i>${esc(e.abierto ? t('abiertoCierra', { h: e.cierra }) : e.abre ? t('cerradoAbre', { h: e.abre }) : t('cerradoAhora'))}`;
  }
  pintarEstado(); setInterval(pintarEstado, 60_000);

  // ---------- ítems
  const etiqueta = (tag) => {
    const lab = LABELS[ctx.lang]?.[tag] || tag;
    return ICONOS[tag] ? `<span class="kit-tag kit-tag--${esc(tag)}" title="${esc(lab)}" aria-label="${esc(lab)}">${ICONOS[tag]}</span>` : `<span class="kit-tag kit-tag--txt">${esc(lab)}</span>`;
  };
  function precioHTML(p) {
    if (tieneVariantes(p)) return `<span class="kmn-precio">${esc(t('desdePrecio', { precio: ctx.money(precioDesde(p)) }))}</span>`;
    const m = ctx.money(p.precio);
    return m ? `<span class="kmn-precio">${esc(m)}</span>` : `<span class="kmn-precio kmn-precio--na">${esc(ctx.pedible(p) ? t('aConfirmar') : t('sinPrecio'))}</span>`;
  }
  function itemHTML(p, i) {
    const vars = tieneVariantes(p) ? p.variantes.filter(v => v && v.precio != null) : [];
    return `<article class="kmn-item${p.disponible === false ? ' is-off' : ''}${p.foto ? ' con-foto' : ''}" data-id="${esc(p.id)}" style="--i:${Math.min(i, 12)}">
      ${p.foto ? `<img class="kmn-item__foto" src="${esc(ctx.asset(p.foto))}" alt="" loading="lazy" decoding="async" width="160" height="160">` : ''}
      <div class="kmn-item__txt">
        <h3 class="kmn-item__n">${esc(p.nombre)}${(p.etiquetas || []).map(etiqueta).join('')}</h3>
        ${p.descripcion ? `<p class="kmn-item__d">${esc(p.descripcion)}</p>` : ''}
        ${vars.length > 1 ? `<ul class="kmn-vars">${vars.map(v => `<li><span>${esc(v.nombre)}</span><b>${esc(ctx.money(v.precio))}</b></li>`).join('')}</ul>` : ''}
        ${p.disponible === false ? `<span class="kit-badge kit-badge--off">${esc(t('noDisponible'))}</span>` : ''}
      </div>
      <div class="kmn-item__lado">
        ${vars.length > 1 ? '' : precioHTML(p)}
        ${ctx.carrito && ctx.pedible(p) ? `<div class="kit-qty" data-kit-qty="${esc(p.id)}"></div>` : ''}
      </div>
    </article>`;
  }

  // ---------- render
  const grupos = () => {
    const vis = ctx.visibles(cats).filter(c => prods.some(p => p.categoria === c.id));
    const g = vis.map(c => ({ id: c.id, nombre: c.nombre, especial: !!c.especial, items: prods.filter(p => p.categoria === c.id) }));
    const sueltos = prods.filter(p => !cats.some(c => c.id === p.categoria));
    if (sueltos.length) g.push({ id: '_otros', nombre: t('sinCategoria'), items: sueltos });
    return g;
  };
  let entrando = true;
  function render({ animar = false } = {}) {
    const G = grupos();
    if (!G.some(g => g.id === actual)) actual = G[0]?.id || null;
    chips.innerHTML = G.map((g, i) => `<button type="button" role="tab" class="kmn-chip${g.especial ? ' kmn-chip--esp' : ''}" data-cat="${esc(g.id)}" aria-selected="${!q && g.id === actual}" style="--i:${i}">${esc(g.nombre)}</button>`).join('');
    bar.classList.toggle('sin-chips', G.length < 2);
    if (q) return pintarBusqueda(G);
    const i = G.findIndex(g => g.id === actual), g = G[i], sig = G[i + 1];
    if (!g) { main.innerHTML = ''; return; }
    main.innerHTML = `<section class="kmn-sec${animar || entrando ? ' is-in' : ''}" aria-labelledby="kmn-t">
      <header class="kmn-sec__h"><h1 class="kmn-sec__t" id="kmn-t">${esc(g.nombre)}</h1><span class="kmn-sec__n">${g.items.length}</span></header>
      <div class="kmn-items">${g.items.map(itemHTML).join('')}</div>
      ${sig ? `<button type="button" class="kmn-sig" data-cat="${esc(sig.id)}" data-sig><span>${esc(t('siguienteSeccion', { cat: sig.nombre }))}</span><b aria-hidden="true">→</b></button>` : ''}
    </section>`;
    entrando = false;
    ctx.carrito?.sync(main);
    centrarChip();
  }
  function pintarBusqueda(G) {
    const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const nq = n(q.trim());
    const res = G.map(g => ({ ...g, items: g.items.filter(p => n(`${p.nombre} ${p.descripcion || ''} ${(p.variantes || []).map(v => v.nombre).join(' ')}`).includes(nq)) })).filter(g => g.items.length);
    const total = res.reduce((a, g) => a + g.items.length, 0);
    main.innerHTML = total
      ? `<p class="kmn-res">${esc(total === 1 ? t('nResultado1') : t('nResultados', { n: total }))}</p>${res.map(g => `<section class="kmn-sec kmn-sec--res"><h2 class="kmn-sec__t kmn-sec__t--chico">${esc(g.nombre)}</h2><div class="kmn-items">${g.items.map(itemHTML).join('')}</div></section>`).join('')}`
      : `<p class="kmn-vacio">${esc(t('sinResultados', { q: q.trim() }))}</p>`;
    ctx.carrito?.sync(main);
  }
  function centrarChip() {
    const b = $('.kmn-chip[aria-selected="true"]', chips); if (!b) return;
    const x = b.offsetLeft - (chips.clientWidth - b.offsetWidth) / 2;
    chips.scrollTo({ left: Math.max(0, x), behavior: entrando ? 'auto' : 'smooth' });
  }
  function irA(id) {
    actual = id; q = ''; input.value = ''; root.classList.remove('buscando');
    history.replaceState(null, '', `${location.pathname}${location.search}#${encodeURIComponent(id)}`);
    render({ animar: true });
    // si la barra ya está pegada arriba, volver al principio de la sección
    const top = bar.getBoundingClientRect().top + scrollY;
    if (scrollY > top) scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]'); if (c) { irA(c.dataset.cat); return; }
    if (e.target.closest('[data-lupa]')) { root.classList.add('buscando'); input.focus(); return; }
    if (e.target.closest('[data-cerrar-busqueda]')) { q = ''; input.value = ''; root.classList.remove('buscando'); render(); }
  });
  input.addEventListener('input', debounce(() => { q = input.value; render(); }, 120));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q = ''; input.value = ''; root.classList.remove('buscando'); render(); } if (e.key === 'Enter') input.blur(); });
  chips.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const bs = $$('.kmn-chip', chips); const i = bs.indexOf(document.activeElement); if (i < 0) return;
    const n = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length]; n.focus(); n.click();
  });
  // swipe horizontal sobre la sección = sección siguiente / anterior
  let x0 = null, y0 = null;
  main.addEventListener('touchstart', (e) => { if (q) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * .6) return;
    const G = grupos(); const i = G.findIndex(g => g.id === actual); const n = G[i + (dx < 0 ? 1 : -1)];
    if (n) irA(n.id);
  }, { passive: true });
  // sombra de la barra cuando queda pegada
  new IntersectionObserver(([en]) => bar.classList.toggle('is-pegada', !en.isIntersecting), { threshold: 0 }).observe($('.kmn-top', root));

  async function cargar() {
    try {
      const [c, p, tmp] = await Promise.all([store.getCategorias(), store.getProductos(), store.getTemporada ? store.getTemporada() : null]);
      ({ cats, prods } = filtrarCarta(c, p, tmp));
      root.removeAttribute('aria-busy');
      render();
    } catch (err) { console.error('[kit] carta', err); main.innerHTML = `<p class="kit-error">${esc(t('error'))}</p>`; }
  }
  store.onChange(cargar);
  await cargar();
  requestAnimationFrame(() => root.classList.add('is-listo'));
  document.dispatchEvent(new CustomEvent('kit:menu', { detail: ctx }));
  return ctx;
}
