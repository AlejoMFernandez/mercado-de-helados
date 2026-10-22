// Módulo CARTA: pestañas por categoría + productos, leídos de la capa de datos.
// Se actualiza solo cuando el dueño edita desde /admin (aunque sea en otra pestaña).
//
// <div data-kit="carta"></div>
// Opciones (initKit({ carta: {...} })):
//   template(p, ctx) → HTML interno de cada ítem (para conservar el diseño propio de la demo)
//   etiquetas: { picante: { label: 'Picante', icono: '<svg…>' } }
//   numerar: true  → "01, 02…" por categoría
import { esc, $$ } from '../core/util.js';
import { t } from '../core/i18n.js';

const ICONOS = {
  picante: '<svg viewBox="0 0 24 24"><path d="M14 6c3 0 6 2 6 6 0 6-8 10-15 10 6-3 7-7 8-11 .4-2 1-5 1-5Z" fill="currentColor"/><path d="M14 6c0-2 1-3 3-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  veggie: '<svg viewBox="0 0 24 24"><path d="M20 4C10 4 4 9 4 16c0 2 1 4 1 4s2-7 9-10c-5 4-7 8-7 10 9 0 13-7 13-16Z" fill="currentColor"/></svg>',
  casa: '<svg viewBox="0 0 24 24"><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8Z" fill="currentColor"/></svg>',
  nuevo: '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.9H22l-6 4.4 2.3 7L12 16l-6.3 4.3 2.3-7-6-4.4h7.6Z" fill="currentColor"/></svg>',
};
const LABELS = { es: { picante: 'Picante', veggie: 'Sin carne', casa: 'De la casa', nuevo: 'Nuevo' }, 'pt-BR': { picante: 'Apimentado', veggie: 'Vegetariano', casa: 'Da casa', nuevo: 'Novo' } };

export function mountCarta(el, ctx, opts = {}) {
  let cats = [], prods = [], actual = el.dataset.kitCategoria || null;
  el.classList.add('kit-root', 'kit-carta');
  el.setAttribute('aria-busy', 'true');

  function etiquetaHTML(tag) {
    const o = opts.etiquetas?.[tag] || {};
    const lab = o.label || LABELS[ctx.lang]?.[tag] || tag;
    const ico = o.icono || ICONOS[tag];
    return ico ? `<span class="kit-tag kit-tag--${esc(tag)}" title="${esc(lab)}" aria-label="${esc(lab)}">${ico}</span>` : `<span class="kit-tag kit-tag--txt">${esc(lab)}</span>`;
  }
  ctx.etiquetaHTML = etiquetaHTML;

  function itemHTML(p, i) {
    if (opts.template) return opts.template(p, { ...ctx, index: i, etiquetaHTML });
    const precio = ctx.money(p.precio) ?? `<span class="kit-price--na">${esc(t('sinPrecio'))}</span>`;
    return `
      ${p.foto ? `<img class="kit-item__foto" src="${esc(ctx.asset(p.foto))}" alt="" loading="lazy">` : ''}
      <div class="kit-item__body">
        <h3 class="kit-item__name">${opts.numerar ? `<span class="kit-item__n">${String(i + 1).padStart(2, '0')}</span>` : ''}${esc(p.nombre)} ${(p.etiquetas || []).map(etiquetaHTML).join('')}</h3>
        ${p.descripcion ? `<p class="kit-item__desc">${esc(p.descripcion)}</p>` : ''}
      </div>
      <div class="kit-item__side">
        <span class="kit-price">${precio}</span>
        ${ctx.carrito && p.disponible !== false && p.precio != null ? `<div class="kit-qty" data-kit-qty="${esc(p.id)}"></div>` : ''}
        ${p.disponible === false ? `<span class="kit-badge kit-badge--off">${esc(t('noDisponible'))}</span>` : ''}
      </div>`;
  }

  function render() {
    const visibles = cats.filter(c => prods.some(p => p.categoria === c.id));
    const sueltos = prods.filter(p => !cats.some(c => c.id === p.categoria));
    const grupos = visibles.map(c => ({ id: c.id, nombre: c.nombre, items: prods.filter(p => p.categoria === c.id) }));
    if (sueltos.length) grupos.push({ id: '_otros', nombre: t('sinCategoria'), items: sueltos });
    if (!grupos.some(g => g.id === actual)) actual = grupos[0]?.id || null;
    const uidp = 'kc' + Math.random().toString(36).slice(2, 7);
    el.innerHTML = `
      ${grupos.length > 1 ? `<div class="kit-tabs" role="tablist" aria-label="${esc(t('carta'))}">
        ${grupos.map(g => `<button type="button" role="tab" class="kit-tab${g.id === actual ? ' is-on' : ''}" id="${uidp}-t-${esc(g.id)}" aria-controls="${uidp}-p-${esc(g.id)}" aria-selected="${g.id === actual}" data-cat="${esc(g.id)}">${esc(g.nombre)}</button>`).join('')}
      </div>` : ''}
      ${grupos.map(g => `<div class="kit-carta__panel" role="tabpanel" id="${uidp}-p-${esc(g.id)}" aria-labelledby="${uidp}-t-${esc(g.id)}" ${g.id === actual ? '' : 'hidden'}>
        ${g.items.map((p, i) => `<article class="kit-item${p.disponible === false ? ' is-off' : ''}${opts.itemClass ? ' ' + opts.itemClass : ''}" data-id="${esc(p.id)}" data-cat="${esc(g.id)}" ${p.foto ? `data-photo="${esc(ctx.asset(p.foto))}"` : ''} style="--i:${i}">${itemHTML(p, i)}</article>`).join('')}
      </div>`).join('')}`;
    el.removeAttribute('aria-busy');
    ctx.carrito?.sync(el);
    document.dispatchEvent(new CustomEvent('kit:carta', { detail: { el, productos: prods, categorias: cats } }));
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('.kit-tab'); if (!b) return;
    actual = b.dataset.cat;
    $$('.kit-tab', el).forEach(x => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', on); });
    $$('.kit-carta__panel', el).forEach(p => { const on = p.id === b.getAttribute('aria-controls'); p.hidden = !on; if (on) { const its = $$('.kit-item', p); its.forEach(i => { i.style.animation = 'none'; }); void p.offsetWidth; its.forEach(i => { i.style.animation = ''; }); } });
  });
  el.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('kit-tab') || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const tabs = $$('.kit-tab', el); const i = tabs.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : -1);
    const n = tabs[(i + tabs.length) % tabs.length]; n.focus(); n.click();
  });

  async function cargar() {
    try { [cats, prods] = await Promise.all([ctx.store.getCategorias(), ctx.store.getProductos()]); render(); }
    catch (err) { console.error('[kit] carta', err); el.innerHTML = `<p class="kit-error">${esc(t('error'))}</p>`; }
  }
  ctx.store.onChange(cargar);
  cargar();
  return { recargar: cargar, el };
}
