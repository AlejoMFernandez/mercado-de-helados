// Mercado de Helados · demo (celular primero)
import { initKit } from '../kit/kit.js?v=18';
import { popup } from '../kit/core/ui.js';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const html = document.documentElement;
const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esCelu = matchMedia('(max-width: 767px)').matches;
html.classList.add('app-ok');

// ---------------------------------------------------------------- toast
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- intro
async function intro() {
  const el = $('#intro');
  if (!html.classList.contains('con-intro') || !el) { html.classList.add('listo', 'intro-fin'); return; }
  const t0 = performance.now();
  el.classList.add('anda');
  const hero = $('.hero__foto img');
  const espera = Promise.all([
    document.fonts?.ready?.catch(() => {}),
    hero && hero.decode ? hero.decode().catch(() => {}) : null,
  ]);
  const minimo = esCelu ? 1150 : 1350;
  const maximo = esCelu ? 1800 : 2600;
  await Promise.race([espera, new Promise((r) => setTimeout(r, maximo - 450))]);
  const falta = minimo - (performance.now() - t0);
  if (falta > 0) await new Promise((r) => setTimeout(r, falta));
  el.classList.add('sale');
  html.classList.add('listo');
  setTimeout(() => { html.classList.add('intro-fin'); el.remove(); }, 450);
}
intro();

// ---------------------------------------------------------------- barra y menú
const barra = $('#barra');
// la píldora del panel aparece cuando la persona se detiene (no tapa lo que está leyendo mientras scrollea)
let pillT = 0;
function pillIdle() {
  html.classList.remove('pill-on'); clearTimeout(pillT);
  pillT = setTimeout(() => { const y = scrollY; const fin = y + innerHeight > document.documentElement.scrollHeight - 900; html.classList.toggle('pill-on', y > innerHeight * 0.7 && (fin || !esCelu)); }, 900);
}
addEventListener('scroll', pillIdle, { passive: true });
let rafB = 0;
addEventListener('scroll', () => {
  if (rafB) return;
  rafB = requestAnimationFrame(() => { rafB = 0; barra.classList.toggle('con-borde', scrollY > 10); html.classList.toggle('pasado-hero', scrollY > innerHeight * 0.7); });
}, { passive: true });

const menu = $('#menu'); const btnMenu = $('#abrir-menu');
let scrollGuardado = 0;
function bloquear(si) {
  if (si) {
    scrollGuardado = scrollY;
    document.body.style.cssText = `position:fixed;top:-${scrollGuardado}px;left:0;right:0;`;
  } else {
    document.body.style.cssText = '';
    html.style.scrollBehavior = 'auto'; scrollTo(0, scrollGuardado); html.style.scrollBehavior = '';
  }
}
function abrirMenu() { menu.hidden = false; bloquear(true); requestAnimationFrame(() => menu.classList.add('abierto')); btnMenu.setAttribute('aria-expanded', 'true'); $('#cerrar-menu').focus(); }
function cerrarMenu(destino) {
  menu.classList.remove('abierto'); menu.hidden = true; btnMenu.setAttribute('aria-expanded', 'false'); bloquear(false);
  if (destino) destino.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth' });
}
btnMenu.addEventListener('click', abrirMenu);
$('#cerrar-menu').addEventListener('click', () => cerrarMenu());
menu.addEventListener('click', (e) => { const a = e.target.closest('a[href^="#"]'); if (a) { e.preventDefault(); cerrarMenu($(a.getAttribute('href'))); } });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) cerrarMenu(); });

// ---------------------------------------------------------------- entradas al scrollear
const io = new IntersectionObserver((ents) => {
  ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('visto'); io.unobserve(en.target); } });
}, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
function observar(root = document) { $$('.sube:not(.visto), .revela:not(.visto), .estrella:not(.visto), .cuadros:not(.visto)', root).forEach((el) => io.observe(el)); }
$$('.cuadro').forEach((c, i) => c.style.setProperty('--i', i));
observar();

// ---------------------------------------------------------------- arrastrar filas con el mouse (en el celu es nativo)
function arrastrable(el) {
  let x0 = 0, s0 = 0, moviendo = false, movido = false, id = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    x0 = e.clientX; s0 = el.scrollLeft; moviendo = true; movido = false; id = e.pointerId;
  });
  el.addEventListener('pointermove', (e) => {
    if (!moviendo || e.pointerId !== id) return;
    const dx = e.clientX - x0;
    if (!movido && Math.abs(dx) > 6) { movido = true; el.classList.add('arrastrando'); el.setPointerCapture(id); }
    if (movido) el.scrollLeft = s0 - dx;
  });
  const fin = () => {
    if (!moviendo) return; moviendo = false;
    if (movido) {
      el.classList.remove('arrastrando');
      // acomodar al ítem más cercano
      const hijos = Array.from(el.children); const base = el.getBoundingClientRect().left;
      let mejor = null, dist = Infinity;
      hijos.forEach((h) => { const d = Math.abs(h.getBoundingClientRect().left - base - parseFloat(getComputedStyle(el).paddingLeft)); if (d < dist) { dist = d; mejor = h; } });
      if (mejor) el.scrollTo({ left: el.scrollLeft + (mejor.getBoundingClientRect().left - base - parseFloat(getComputedStyle(el).paddingLeft)), behavior: 'smooth' });
    }
  };
  el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin); el.addEventListener('lostpointercapture', fin);
  el.addEventListener('click', (e) => { if (movido) { e.preventDefault(); e.stopPropagation(); movido = false; } }, true);
}

// pestaña activa siempre a la vista (solo scroll horizontal de la fila, nunca mueve la página)
function centrarTab(cont) {
  const t = cont?.querySelector('[aria-selected="true"]'); if (!t || cont.scrollWidth <= cont.clientWidth) return;
  cont.scrollTo({ left: Math.max(0, t.offsetLeft - (cont.clientWidth - t.offsetWidth) / 2), behavior: 'auto' });
}

// ---------------------------------------------------------------- datos de sabores
// Color de cada sabor para las capas del pote (si el dueño crea uno nuevo, toma el de su familia).
const COLOR = {
  's-chocolate': '#5b3524', 's-choco-almendras': '#674030', 's-choco-italiano': '#3f2318', 's-choco-blanco': '#efe4cf', 's-choco-amargo': '#2e1a12', 's-mousse-choco': '#7a4d36', 's-ferrero': '#6b4430',
  's-ddl': '#c08a52', 's-ddl-granizado': '#b47d48', 's-ddl-nuez': '#a8784c', 's-super-ddl': '#a96a34', 's-chocotorta': '#8e6345',
  's-americana': '#f6efdc', 's-almendras': '#eadbc0', 's-vainilla': '#f3e6bf', 's-oreo': '#d9d2c6', 's-granizada': '#efe8da', 's-tramontana': '#e9d9b8', 's-cielo': '#6fc8d6', 's-mascarpone': '#f4ecd8', 's-sambayon': '#e8cf78', 's-mousse-limon': '#f1ecb8', 's-mousse-maracuya': '#f2c75c', 's-frutilla-crema': '#f0a7b4', 's-banana-split': '#efdca0', 's-menta': '#bfe3c9', 's-pistacho': '#b8ba7a',
  's-frutilla': '#e5788a', 's-frambuesa': '#c94a6b', 's-limon': '#f3efc4', 's-kiwi': '#a9c66a', 's-pomelo': '#f1a08f', 's-naranja': '#f2a54a',
  's-capuccino': '#b8946b', 's-tiramisu': '#c9a882', 's-coco': '#f7f3ea', 's-frutos-bosque': '#9c4a6e', 's-mandarina': '#f39a3d',
};
const COLOR_FAM = { 'sab-chocolates': '#5b3524', 'sab-ddl': '#c08a52', 'sab-cremas': '#efe4cf', 'sab-frutas': '#e5788a', 'sab-estacion': '#c9a882' };
const colorDe = (p) => COLOR[p.id] || COLOR_FAM[p.categoria] || '#d2c5b1';
const COMBOS = [
  ['s-pistacho', 's-mousse-limon'],
  ['s-choco-amargo', 's-americana'],
  ['s-ddl-granizado', 's-sambayon'],
];
const MAX = { 'pote-cuarto': 2, 'pote-medio': 3, 'pote-kilo': 4 };

let K = null;            // contexto del kit
let CATS = [], PRODS = [];
const S = { fam: null, cartaCat: null, tam: 'pote-kilo', elegidos: [] };

const sabores = () => PRODS.filter((p) => p.categoria?.startsWith('sab-'));
const disponibles = () => sabores().filter((p) => p.disponible !== false);
const prod = (id) => PRODS.find((p) => p.id === id);
const asset = (f) => (K ? K.asset(f) : f);
const money = (n) => (K ? K.money(n) : `$${n}`);

function bocha(p, cls = 'sabor__bocha') {
  return `<span class="${cls}" style="--c:${colorDe(p)}">${p.foto ? `<img src="${esc(asset(p.foto))}" alt="" loading="lazy" decoding="async" width="160" height="160">` : ''}</span>`;
}

// ---------------------------------------------------------------- estrella del mes
function pintarEstrella() {
  const p = disponibles().find((x) => (x.etiquetas || []).includes('estrella'));
  const sec = $('#estrella'); const chip = $('#estrella-chip');
  if (!p) { sec.hidden = true; chip.hidden = true; return; }
  sec.hidden = false; chip.hidden = false;
  chip.querySelector('b').textContent = p.nombre;
  const mes = new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  $('#estrella-mes').textContent = mes;
  $('#estrella-t').textContent = p.nombre;
  $('#estrella-desc').textContent = p.descripcion || 'El sabor que elegimos este mes, en todas las sucursales.';
  const img = $('.estrella__foto img');
  const src = asset(p.foto || 'img/capuccino.webp');
  if (img.getAttribute('src') !== src) { img.src = src; img.alt = `Helado de ${p.nombre}`; }
  $('#estrella-sumar').onclick = () => { sumarSabor(p.id, true); };
  observar(sec);
}

// ---------------------------------------------------------------- vitrina: una familia por vez
function familias() {
  return CATS.filter((c) => c.id.startsWith('sab-') && PRODS.some((p) => p.categoria === c.id))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .map((c) => ({ ...c, corto: c.nombre.replace(/^Sabores\s*·\s*/i, '') }));
}
function pintarVitrina() {
  const fams = familias(); if (!fams.length) return;
  if (!fams.some((f) => f.id === S.fam)) S.fam = fams[0].id;
  const i = fams.findIndex((f) => f.id === S.fam); const f = fams[i];
  $('#vitrina-tabs').innerHTML = fams.map((x) => `<button type="button" role="tab" class="tab" data-fam="${esc(x.id)}" aria-selected="${x.id === S.fam}">${esc(x.corto)}</button>`).join('');
  const items = PRODS.filter((p) => p.categoria === f.id).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const hay = items.filter((p) => p.disponible !== false).length;
  $('#vitrina-panel').innerHTML = `
    <div class="vitrina__head"><h3>${esc(f.corto)}</h3><span>${hay} ${hay === 1 ? 'sabor' : 'sabores'} hoy</span></div>
    <ul class="sabores">${items.map((p, n) => {
      const off = p.disponible === false; const en = S.elegidos.includes(p.id);
      const tags = (p.etiquetas || []).includes('estrella') ? '<span class="sabor__tag">Estrella</span>' : (p.etiquetas || []).includes('casa') ? '<span class="sabor__tag">De la casa</span>' : '';
      return `<li class="sabor${off ? ' off' : ''}" style="--i:${n}">
        ${bocha(p)}
        <span class="sabor__txt"><b>${esc(p.nombre)}${tags}</b>${off ? '<small>Se terminó por hoy</small>' : p.descripcion ? `<small>${esc(p.descripcion)}</small>` : ''}</span>
        <button type="button" class="mas" data-sabor="${esc(p.id)}" aria-pressed="${en}" aria-label="${en ? 'Sacar' : 'Sumar'} ${esc(p.nombre)} ${en ? 'del' : 'al'} pote" ${off ? 'disabled' : ''}>
          ${en ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'}
        </button></li>`;
    }).join('')}</ul>`;
  const prev = fams[(i - 1 + fams.length) % fams.length]; const next = fams[(i + 1) % fams.length];
  $('#vit-prev').textContent = `‹ ${prev.corto}`; $('#vit-prev').dataset.fam = prev.id;
  $('#vit-next').textContent = `${next.corto} ›`; $('#vit-next').dataset.fam = next.id;
  centrarTab($('#vitrina-tabs'));
}
function irFamilia(id, scroll) {
  S.fam = id; pintarVitrina();
  if (scroll) {
    const top = $('#vitrina-tabs').getBoundingClientRect().top;
    const barraH = barra.offsetHeight;
    if (top < barraH || top > innerHeight * 0.5) $('#sabores .vitrina__panel').scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'start' });
  }
}
$('#vitrina-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-fam]'); if (b) irFamilia(b.dataset.fam); });
$('#vit-prev').addEventListener('click', (e) => irFamilia(e.currentTarget.dataset.fam, true));
$('#vit-next').addEventListener('click', (e) => irFamilia(e.currentTarget.dataset.fam, true));
$('#vitrina-panel').addEventListener('click', (e) => { const b = e.target.closest('[data-sabor]'); if (b) sumarSabor(b.dataset.sabor); });

// ---------------------------------------------------------------- armá tu kilo
function sumarSabor(id, irAlPote) {
  const p = prod(id); if (!p || p.disponible === false) return;
  const i = S.elegidos.indexOf(id);
  if (i >= 0) { S.elegidos.splice(i, 1); pintarKilo(); pintarVitrina(); return; }
  const max = MAX[S.tam] || 4;
  if (S.elegidos.length >= max) { toast(`El ${prod(S.tam)?.nombre || 'pote'} lleva hasta ${max} sabores. Sacá uno o elegí uno más grande.`); return; }
  S.elegidos.push(id);
  pintarKilo(true); pintarVitrina();
  if (irAlPote) $('#kilo').scrollIntoView({ behavior: reducido ? 'auto' : 'smooth' });
  else toast(`${p.nombre}: ¡al pote! (${S.elegidos.length}/${max})`);
}
function pintarKilo(golpe) {
  const potes = PRODS.filter((p) => p.categoria === 'potes' && p.disponible !== false && p.precio != null).sort((a, b) => (b.precio || 0) - (a.precio || 0));
  if (!potes.length) return;
  if (!potes.some((p) => p.id === S.tam)) S.tam = potes[0].id;
  const max = MAX[S.tam] || 4;
  if (S.elegidos.length > max) S.elegidos = S.elegidos.slice(0, max);
  S.elegidos = S.elegidos.filter((id) => prod(id)?.disponible !== false);
  $('#kilo-tam').innerHTML = potes.map((p) => `<button type="button" class="tam" role="radio" aria-checked="${p.id === S.tam}" data-tam="${esc(p.id)}"><b>${esc(p.nombre)}</b><small>${esc(money(p.precio))}</small></button>`).join('');
  const sel = S.elegidos.map(prod).filter(Boolean);
  const alto = sel.length ? (92 / sel.length) : 0;
  $('#pote-capas').innerHTML = sel.map((p, n) => `<div class="capa" style="--c:${colorDe(p)};--h:${alto}%;${p.foto ? `--img:url('${esc(asset(p.foto))}')` : ''};animation-delay:${golpe && n === sel.length - 1 ? 0 : 0}ms"></div>`).join('');
  // solo anima la capa nueva
  $$('#pote-capas .capa').forEach((c, n) => { if (!golpe || n !== sel.length - 1) c.style.animation = 'none'; });
  if (golpe) { const k = $('#kilo-pote'); k.classList.remove('golpe'); void k.offsetWidth; k.classList.add('golpe'); }
  const libres = max - sel.length;
  $('#kilo-cuenta').innerHTML = sel.length ? `<b>${sel.length} de ${max}</b> sabores · ${libres ? `${libres === 1 ? 'queda 1 lugar' : `quedan ${libres} lugares`}` : 'pote completo'}` : `Elegí hasta <b>${max} sabores</b> tocándolos abajo o en la vitrina.`;
  $('#kilo-elegidos').innerHTML = sel.map((p) => `<li><button type="button" class="chip-sab" data-quitar="${esc(p.id)}" aria-label="Sacar ${esc(p.nombre)}"><i style="--c:${colorDe(p)}"></i>${esc(p.nombre)}<span aria-hidden="true">×</span></button></li>`).join('');
  // sabores rápidos: los que tienen foto primero
  const rap = disponibles().slice().sort((a, b) => (b.foto ? 1 : 0) - (a.foto ? 1 : 0) || (a.orden ?? 0) - (b.orden ?? 0)).slice(0, 12);
  $('#kilo-rapidos').innerHTML = rap.map((p) => `<button type="button" class="rapido" data-sabor="${esc(p.id)}" aria-pressed="${S.elegidos.includes(p.id)}">${bocha(p, '')}<span>${esc(p.nombre)}</span></button>`).join('');
  $('#kilo-combos').innerHTML = COMBOS.filter((c) => c.every((id) => prod(id)?.disponible !== false && prod(id))).map((c, n) => `<button type="button" class="combo" data-combo="${n}">${c.map((id) => esc(prod(id).nombre)).join(' + ')}</button>`).join('');
  const b = $('#kilo-sumar'); const pote = prod(S.tam);
  b.disabled = !sel.length;
  b.textContent = sel.length ? `Sumar al pedido · ${money(pote.precio)}` : 'Elegí tus sabores';
}
$('#kilo-tam').addEventListener('click', (e) => { const b = e.target.closest('[data-tam]'); if (!b) return; S.tam = b.dataset.tam; pintarKilo(); });
$('#kilo-elegidos').addEventListener('click', (e) => { const b = e.target.closest('[data-quitar]'); if (b) { S.elegidos = S.elegidos.filter((x) => x !== b.dataset.quitar); pintarKilo(); pintarVitrina(); } });
$('#kilo-rapidos').addEventListener('click', (e) => { const b = e.target.closest('[data-sabor]'); if (!b) return; const ya = S.elegidos.includes(b.dataset.sabor); sumarSabor(b.dataset.sabor); if (!ya) $('#toast').hidden = true; });
$('#kilo-combos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-combo]'); if (!b) return;
  const c = COMBOS[+b.dataset.combo];
  if ((MAX[S.tam] || 4) < c.length) S.tam = 'pote-medio';
  S.elegidos = c.slice(); pintarKilo(true); pintarVitrina();
});
$('#dia-dificil').addEventListener('click', () => {
  const pool = disponibles(); if (pool.length < 2) return;
  const a = pool[Math.floor(Math.random() * pool.length)];
  let b = a; while (b === a) b = pool[Math.floor(Math.random() * pool.length)];
  S.elegidos = [a.id, b.id]; pintarKilo(true); pintarVitrina();
  toast('Tomá, te lo merecés: ' + a.nombre + ' + ' + b.nombre);
});
$('#kilo-sumar').addEventListener('click', () => {
  if (!K?.carrito || !S.elegidos.length) return;
  const nota = S.elegidos.map((id) => prod(id)?.nombre).filter(Boolean).join(', ');
  K.carrito.agregar(S.tam, 1, { nota, origen: $('#kilo-sumar') });
  S.elegidos = []; pintarKilo(); pintarVitrina();
  setTimeout(() => K.carrito.abrir(), reducido ? 0 : 420);
});

// ---------------------------------------------------------------- carta para llevar (una sección por vez)
const ICONO_TAZA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/></svg>';
const NOTA_CAT = {
  potes: 'Elegís el tamaño y armás los sabores en el pote.',
  'al-paso': 'Los gustos de cucuruchos y vasitos los anotás al final del pedido.',
  cafe: 'Para tomar acá o llevar.',
  pasteleria: 'Porciones del día, mientras haya.',
};
function pintarCarta() {
  const cats = CATS.filter((c) => !c.id.startsWith('sab-') && PRODS.some((p) => p.categoria === c.id)).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  if (!cats.length) return;
  if (!cats.some((c) => c.id === S.cartaCat)) S.cartaCat = cats[0].id;
  const c = cats.find((x) => x.id === S.cartaCat);
  $('#carta-tabs').innerHTML = cats.map((x) => `<button type="button" role="tab" class="tab" data-ccat="${esc(x.id)}" aria-selected="${x.id === S.cartaCat}">${esc(x.nombre)}</button>`).join('');
  const items = PRODS.filter((p) => p.categoria === c.id).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  $('#carta-panel').innerHTML = `
    <div class="carta__head"><h3>${esc(c.nombre)}</h3><p>${items.length} ${items.length === 1 ? 'opción' : 'opciones'}${NOTA_CAT[c.id] ? ` · ${esc(NOTA_CAT[c.id])}` : ''}</p></div>
    <ul class="platos">${items.map((p, n) => {
      const precio = p.precio != null ? money(p.precio) : 'Consultar';
      const off = p.disponible === false;
      let acc = '';
      if (off) acc = '<span class="chip">Sin stock hoy</span>';
      else if (c.id === 'potes') acc = `<button type="button" class="btn" data-armar="${esc(p.id)}">Armar</button>`;
      else if (p.precio != null) acc = `<div data-kit-qty="${esc(p.id)}"></div>`;
      return `<li class="plato" style="--i:${n}">
        <span class="plato__foto">${p.foto ? `<img src="${esc(asset(p.foto))}" alt="" loading="lazy" decoding="async" width="168" height="168">` : ICONO_TAZA}</span>
        <span class="plato__body"><b>${esc(p.nombre)}</b>${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}</span>
        <span class="plato__pie"><span class="plato__precio">${esc(precio)}</span>${acc}</span>
      </li>`;
    }).join('')}</ul>`;
  K?.carrito?.sync($('#carta-panel'));
  centrarTab($('#carta-tabs'));
}
$('#carta-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-ccat]'); if (b) { S.cartaCat = b.dataset.ccat; pintarCarta(); } });
$('#carta-panel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-armar]'); if (!b) return;
  S.tam = b.dataset.armar; pintarKilo();
  $('#kilo').scrollIntoView({ behavior: reducido ? 'auto' : 'smooth' });
});

// ---------------------------------------------------------------- sucursales
const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
function ahoraAR() {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => f.find((x) => x.type === t)?.value;
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { dia, min: (parseInt(g('hour'), 10) % 24) * 60 + parseInt(g('minute'), 10) };
}
const aMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
function abierta(s) {
  if (!s.horas) return null;
  const { dia, min } = ahoraAR();
  const enFranja = (d, m, ayer) => {
    const fr = s.horas[DIAS[d]]; if (!fr) return false;
    let a = aMin(fr[0]), c = aMin(fr[1]); if (c <= a) c += 1440;
    const t = ayer ? m + 1440 : m;
    return t >= a && t < c;
  };
  return enFranja(dia, min, false) || enFranja((dia + 6) % 7, min, true);
}
function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
let SUCS = [], dist = null;
function pintarSucursales() {
  const elegida = K?.carrito?.sucursal?.id;
  const lista = SUCS.slice();
  if (dist) lista.sort((a, b) => dist[a.id] - dist[b.id]);
  $('#suc-lista').innerHTML = lista.map((s, n) => {
    const ab = abierta(s);
    const wa = s.whatsapp ? `https://wa.me/${s.whatsapp}?text=${encodeURIComponent('Hola! Quiero hacer una consulta.')}` : '';
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Mercado de Helados ' + s.direccion)}`;
    return `<article class="suc${s.id === elegida ? ' elegida' : ''}" style="--i:${n}">
      <div class="suc__foto"><img src="${esc(asset(s.foto))}" alt="Mercado de Helados ${esc(s.nombre)}" loading="lazy" decoding="async" width="640" height="480">
        <div class="suc__chips">${ab === null ? '<span></span>' : `<span class="chip ${ab ? 'chip--abierto' : 'chip--cerrado'}">${ab ? 'Abierto ahora' : 'Cerrado ahora'}</span>`}${dist ? `<span class="chip">${dist[s.id] < 10 ? dist[s.id].toFixed(1).replace('.', ',') : Math.round(dist[s.id])} km</span>` : ''}</div></div>
      <div class="suc__body">
        <h3>${esc(s.nombre)}</h3>
        <p>${esc(s.direccion)}</p>
        <p>${esc(s.horario || '')}</p>
        <div class="suc__acc">
          <button type="button" class="btn" data-pedir="${esc(s.id)}">${s.id === elegida ? 'Elegida' : 'Pedir acá'}</button>
          ${wa ? `<a class="btn btn--linea" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : '<span class="btn btn--linea" aria-disabled="true" style="opacity:.5">WhatsApp</span>'}
          <a class="btn btn--linea ico" href="${esc(maps)}" target="_blank" rel="noopener" aria-label="Cómo llegar a ${esc(s.nombre)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg></a>
        </div>
      </div></article>`;
  }).join('');
  $('#pie-sucs').innerHTML = SUCS.map((s) => `<li>${esc(s.nombre)} · ${esc(s.direccion)}</li>`).join('');
}
$('#suc-lista').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pedir]'); if (!b || !K?.carrito) return;
  K.carrito.setSucursal(b.dataset.pedir);
  pintarSucursales();
  toast(`Retirás en ${K.carrito.sucursal.nombre}. Ahora armá tu pedido.`);
  setTimeout(() => $('#kilo').scrollIntoView({ behavior: reducido ? 'auto' : 'smooth' }), 700);
});
$('#cerca').addEventListener('click', () => {
  const msg = $('#cerca-msg');
  if (!navigator.geolocation) { msg.textContent = 'Tu navegador no comparte la ubicación.'; return; }
  msg.textContent = 'Buscando…';
  navigator.geolocation.getCurrentPosition((pos) => {
    const yo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    dist = Object.fromEntries(SUCS.map((s) => [s.id, km(yo, s)]));
    const cerca = SUCS.slice().sort((a, b) => dist[a.id] - dist[b.id])[0];
    msg.textContent = `La más cerca es ${cerca.nombre}. No guardamos tu ubicación.`;
    pintarSucursales(); $('#suc-lista').scrollTo({ left: 0, behavior: 'smooth' });
  }, () => { msg.textContent = 'No pudimos ver tu ubicación. Elegí la sucursal de la lista.'; }, { timeout: 8000, maximumAge: 300000 });
});

['prev', 'next'].forEach((d) => $(`#suc-${d}`).addEventListener('click', () => {
  const l = $('#suc-lista'); const c = l.querySelector('.suc'); if (!c) return;
  l.scrollBy({ left: (d === 'next' ? 1 : -1) * (c.offsetWidth + 14), behavior: reducido ? 'auto' : 'smooth' });
}));

// ---------------------------------------------------------------- franquicias / CV
$$('[data-form]').forEach((b) => b.addEventListener('click', () => {
  const fr = b.dataset.form === 'franquicia';
  const f = document.createElement('form'); f.className = 'form-mini'; f.noValidate = true;
  f.innerHTML = `
    <p>${fr ? 'Dejanos tus datos y te contamos cómo sumarte a la marca.' : 'Contanos quién sos y en qué sucursal te gustaría trabajar.'}</p>
    <label>Nombre<input name="n" autocomplete="name" required></label>
    <label>WhatsApp<input name="t" type="tel" inputmode="tel" autocomplete="tel" required></label>
    <label>${fr ? 'Zona donde te interesa abrir' : 'Contanos de vos'}<textarea name="m" rows="3"></textarea></label>
    <button type="submit" class="btn btn--grande">Enviar</button>`;
  const pop = popup({ titulo: fr ? 'Quiero mi franquicia' : 'Trabajá con nosotros', contenido: f, clase: 'kit-pop--sm' });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!f.n.value.trim() || f.t.value.replace(/\D/g, '').length < 8) { toast('Completá tu nombre y WhatsApp.'); return; }
    pop.close(); toast('¡Gracias! (demo: en la web real esto llega al mail de la marca)');
  });
}));

// ---------------------------------------------------------------- kit
$('#anio').textContent = new Date().getFullYear();
$$('.fila-drag, .cuadros, .fila').forEach(arrastrable);

const ICONO_CORAZON = '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M8.2 9.5h7.6M7.8 12.5h8.4M10.2 6.6 9.3 16M13.8 6.6l.9 9.4" stroke-width="1"/></svg>';

async function arrancar() {
  try {
    K = await initKit({ config: 'cliente.json', carrito: { label: 'Tu pote', icono: ICONO_CORAZON }, badge: true });
  } catch (err) {
    console.error('[mdh] kit', err);
    return;
  }
  SUCS = K.config.sucursales || [];
  const cargar = async () => {
    [CATS, PRODS] = await Promise.all([K.store.getCategorias(), K.store.getProductos()]);
    pintarEstrella(); pintarVitrina(); pintarKilo(); pintarCarta(); pintarSucursales();
  };
  K.store.onChange(cargar);
  document.addEventListener('kit:sucursal', pintarSucursales);
  await cargar();
}
arrancar();
