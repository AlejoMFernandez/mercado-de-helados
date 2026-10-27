// PANEL /admin v2 con la identidad del cliente: pedidos (la cocina), reservas (lista del día + calendario) y carta (ABM rápido).
// Pensado para usarlo en pleno servicio: letra grande, estados claros, una acción principal por tarjeta.
//
//   <div id="kit-admin"></div>
//   <script type="module">
//     import { initAdmin } from '../kit/admin/admin.js';
//     initAdmin({ config: '../cliente.json', sitio: '../' });
//   </script>
import { cargarConfig, crearContexto } from '../kit.js';
import { esc, h, $, $$, slug, soloDigitos } from '../core/util.js';
import { t } from '../core/i18n.js';
import { popup, confirmar, toast } from '../core/ui.js';
import { ahoraEn, horaVisible, aMin, diaSemana, diaNum, fechaDeNum, franjas, generarTurnos, configReservas, serviciosDe, tandaDe, serviciosDelDia } from '../core/turnos.js';
import { configGiftcards, estadoGiftcard, canjeable, normalizarCodigo } from '../core/giftcards.js';
import { tieneVariantes, precioDesde } from '../core/variantes.js';
import { linkWhatsApp } from '../core/pedidos.js';
import { sucursales } from '../core/sucursales.js';
import { temporadasDe, seVe } from '../core/temporadas.js';
import { estadoEspecial, textoRetiro, diasPara } from '../core/encargos.js';
import { totalTexto } from '../core/pedidos.js';
import { debounce } from '../core/util.js';
import { crearQR, qrSVG } from '../core/qr.js';
import { FORMATOS, ESTILOS, PX_MM_IMPRESION, dibujarTarjeta, paletaTarjeta, jpgDe, pdfHoja, pdfPaginas, descargar } from '../core/tarjeta-qr.js';
import { paginasCarta, HOJA } from '../core/carta-impresa.js';
import { filtrarCarta } from '../core/temporadas.js';

const ACTIVOS = ['pendiente', 'confirmado', 'listo'];
const PAGADO = ['aprobado', 'cobrado'];

export async function initAdmin(opts = {}) {
  const root = document.getElementById(opts.mount || 'kit-admin');
  let ctx;
  try { ctx = await crearContexto(await cargarConfig(opts.config || '../cliente.json')); }
  catch (e) { root.innerHTML = `<p class="kit-error">No se pudo cargar cliente.json</p>`; throw e; }
  const { config, store } = ctx;
  const sitio = opts.sitio || '../';
  document.documentElement.classList.add('kit-on', `kit-${store.modo}`);
  document.title = `${t('panel')} · ${config.nombre}`;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = config.marca?.colores?.primario || '#111';
  if (config.marca?.favicon) { const l = document.querySelector('link[rel=icon]') || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' })); l.href = ctx.asset(config.marca.favicon); }

  const vistas = [
    config.modulos.carrito && { id: 'pedidos', icono: '<path d="M5 8h14l-1.3 11.1a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>' },
    config.modulos.reservas && { id: 'reservas', icono: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>' },
    config.modulos.carta && { id: 'carta', icono: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>' },
    config.modulos.carta && (config.modulos.fechas || (config.carta?.categorias || []).some(c => c.especial)) && { id: 'fechas', icono: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m12 12.6.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3Z"/>' },
    config.modulos.carta && config.modulos.cartaQR !== false && { id: 'qr', nav: 'qrNav', icono: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5"/>' },
    config.modulos.carrito && config.giftcards && { id: 'giftcards', icono: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h18M12 8v12M12 8c-1.5-3.5-6.5-3.5-5 0M12 8c1.5-3.5 6.5-3.5 5 0"/>' },
  ].filter(Boolean);
  const GC = configGiftcards(config);
  let vista = (location.hash.slice(1) && vistas.some(v => v.id === location.hash.slice(1))) ? location.hash.slice(1) : vistas[0]?.id;
  const KEY = `kit:${config.id}:panel`;
  const pref = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } })();
  const guardarPref = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (_) { /* sin storage */ } };
  const st = {
    tipo: 'todos',                         // filtro de pedidos
    sede: pref.sede || 'todas',            // filtro por sede (cadenas); cada tablet recuerda la suya
    colMovil: 'pendiente',                 // columna visible en el celu
    resVista: pref.resVista || 'lista',    // lista | calendario
    fecha: null,                           // día elegido en reservas
    mes: null,                             // 'YYYY-MM' del calendario
    cat: null,                             // sección abierta en la carta
    fe: null,                              // fecha especial abierta
    q: '',                                 // búsqueda en la carta
    gc: '',                                // gift card abierta en el canje
    gcMsg: null,                           // { tipo, texto } del último canje
  };
  let pendientesAntes = null;
  const yaVistos = new Set(); let tableroVisto = false;

  // ---------- login
  async function pantallaLogin() {
    const demo = store.modo === 'demo';
    root.className = 'kit-root kit-admin kit-admin--login';
    root.innerHTML = `<div class="kit-login">
      <div class="kit-login__marca">
        ${config.marca?.logo ? `<img class="kit-login__logo" src="${esc(ctx.asset(config.marca.logo))}" alt="${esc(config.nombre)}">` : `<h1>${esc(config.nombre)}</h1>`}
        <p class="kit-login__kicker">${esc(t('panel'))}</p>
      </div>
      <form class="kit-form">
        ${demo ? `<p>${esc(t('entrarDemoSub'))}</p>` : `
          <label class="kit-field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
          <label class="kit-field"><span>${esc(t('password'))}</span><input name="password" type="password" autocomplete="current-password" required></label>`}
        <p class="kit-msg" role="alert" hidden></p>
        <button class="kit-btn kit-btn--block kit-btn--big">${esc(demo ? t('entrarDemo') : t('entrar'))}</button>
      </form>
      <a class="kit-login__back" href="${esc(sitio)}">← ${esc(t('verSitio'))}</a></div>`;
    $('form', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await store.login(f.get('email'), f.get('password')); arrancar(); }
      catch (_) { const m = $('.kit-msg', root); m.textContent = t('loginError'); m.hidden = false; }
    });
  }

  // ---------- layout
  function layout() {
    root.className = 'kit-root kit-admin';
    root.innerHTML = `
      <header class="kad-top">
        <a class="kad-brand" href="${esc(sitio)}" title="${esc(t('verSitio'))}">
          ${config.marca?.logo ? `<img src="${esc(ctx.asset(config.marca.logoPanel || config.marca.logo))}" alt="${esc(config.nombre)}">` : `<b>${esc(config.nombre)}</b>`}
        </a>
        <nav class="kad-nav" aria-label="${esc(t('panel'))}">
          ${vistas.map(v => `<a href="#${v.id}" class="kad-nav__a" data-vista="${v.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${v.icono}</svg><span>${esc(t(v.nav || v.id))}</span><i class="kad-count" data-count="${v.id}" hidden></i></a>`).join('')}
        </nav>
        <div class="kad-top__actions">
          ${config.modulos.carrito ? `<button type="button" class="kad-sonido" data-sonido aria-pressed="${!!pref.sonido}" title="${esc(t('sonido'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path class="kad-sonido__on" d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/><path class="kad-sonido__off" d="m16 9 6 6M22 9l-6 6"/></svg><span>${esc(t('sonido'))}</span></button>` : ''}
          <a class="kad-top__link" href="${esc(sitio)}" target="_blank" rel="noopener">${esc(t('verSitio'))} ↗</a>
          <button type="button" class="kad-top__link" data-salir>${esc(t('salir'))}</button>
        </div>
      </header>
      ${store.modo === 'demo' ? `<div class="kad-demo"><span><b>${esc(t('modoDemo'))}.</b> ${esc(t('modoDemoSub'))}</span><button type="button" class="kad-demo__btn" data-reset>↺ ${esc(t('reiniciar'))}</button></div>` : ''}
      <main class="kad-main" id="kad-main" tabindex="-1"></main>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-precio]')) { e.preventDefault(); e.target.blur(); } });
    root.addEventListener('input', (e) => { if (e.target.matches('[data-buscar]')) { st.q = e.target.value; pintarCartaLista(); } });
  }

  // ---------- helpers
  const hoy = () => ahoraEn(ctx.tz).fecha;
  const esDeHoy = (iso) => { const d = new Date(iso); return new Intl.DateTimeFormat('en-CA', { timeZone: ctx.tz }).format(d) === hoy(); };
  const minutosDesde = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  function relativo(iso) {
    const m = minutosDesde(iso);
    if (m < 1) return t('ahora');
    if (m < 60) return t('hace', { t: `${m} min` });
    const hh = Math.floor(m / 60); if (hh < 24) return t('hace', { t: `${hh} h ${m % 60 ? `${m % 60} min` : ''}`.trim() });
    return new Date(iso).toLocaleDateString(ctx.pais.locale, { day: 'numeric', month: 'short' }) + ' ' + new Date(iso).toLocaleTimeString(ctx.pais.locale, { hour: '2-digit', minute: '2-digit' });
  }
  function fechaLarga(f) {
    const [, m, d] = f.split('-').map(Number);
    return `${f === hoy() ? `${t('hoy')} · ` : ''}${t('dias')[diaSemana(f)]} ${d} ${t('meses')[m - 1]}`;
  }
  const waCliente = (tel, texto) => {
    let d = soloDigitos(tel);
    if (!d) return null;
    if (d.length <= 11 && !d.startsWith(ctx.pais.prefijoTel)) d = ctx.pais.prefijoTel + (ctx.pais.prefijoTel === '54' && !d.startsWith('9') ? '9' : '') + d.replace(/^0/, '');
    return linkWhatsApp(d, texto).url;
  };
  const mapsUrl = (dir) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dir)}`;
  const pagado = (p) => PAGADO.includes(p.pagoEstado);
  const nRes = (o) => o.n === 1 ? t('nReserva1', o) : t('nReservas', o);
  const turnoDe = (hora) => { const m = aMin(hora) % 1440; return m < 720 ? 'turnoManana' : m < 960 ? 'turnoMediodia' : m < 1200 ? 'turnoTarde' : 'turnoNoche'; };
  const RCFG = configReservas(config.reservas);
  const conServicios = !!serviciosDe(RCFG);
  // Grupos de la lista del día: por servicio y tanda ("Cena · Primer tiempo") o por momento del día.
  function agrupar(rs) {
    const g = new Map();
    rs.forEach(r => {
      const td = conServicios ? tandaDe(RCFG, r.hora) : null;
      const k = td ? `${td.servicio.id}|${td.indice}` : turnoDe(r.hora);
      if (!g.has(k)) g.set(k, { k, label: td ? [td.servicio.nombre, td.tanda.nombre].filter(Boolean).join(' · ') : t(k), orden: td ? aMin(td.tanda.turnos[0]) : ['turnoManana', 'turnoMediodia', 'turnoTarde', 'turnoNoche'].indexOf(k), items: [] });
      g.get(k).items.push(r);
    });
    return [...g.values()].sort((a, b) => a.orden - b.orden);
  }
  const extraLabel = (id) => (RCFG.extras || []).find(e => e.id === id)?.label || id;

  // ---------- clicks
  async function onClick(e) {
    const a = e.target.closest('[data-vista]');
    if (a) { e.preventDefault(); ir(a.dataset.vista); return; }
    if (e.target.closest('[data-salir]')) { await store.logout(); pantallaLogin(); return; }
    if (e.target.closest('[data-reset]')) {
      if (await confirmar(t('reiniciarSeguro'), { ok: t('reiniciar'), peligro: true })) { await store.reset(); toast(t('guardado')); render(); }
      return;
    }
    const son = e.target.closest('[data-sonido]');
    if (son) { pref.sonido = !pref.sonido; guardarPref(); son.setAttribute('aria-pressed', pref.sonido); if (pref.sonido) beep(); return; }

    // pedidos
    const tipo = e.target.closest('[data-tipo]'); if (tipo) { st.tipo = tipo.dataset.tipo; render(); return; }
    const col = e.target.closest('[data-col]'); if (col) { st.colMovil = col.dataset.col; render(); return; }
    const est = e.target.closest('[data-estado]');
    if (est) {
      const id = est.closest('[data-id]').dataset.id; const nuevo = est.dataset.estado;
      if (nuevo.startsWith('cancel') && !(await confirmar(nuevo === 'cancelado' ? `${t('cancelarPedido')}?` : `${t('cancelar')}?`, { ok: t('cancelar'), peligro: true }))) return;
      est.disabled = true;
      const card = est.closest('.kad-card, .kad-res');
      card?.classList.add('is-saliendo');
      if (vista === 'pedidos') await store.updatePedido(id, { estado: nuevo, ...(est.dataset.cobrar ? { pagoEstado: 'cobrado' } : {}) });
      else await store.updateReserva(id, { estado: nuevo });
      toast(t(nuevo)); setTimeout(render, card ? 180 : 0);
      return;
    }

    // reservas
    const rv = e.target.closest('[data-res-vista]'); if (rv) { st.resVista = rv.dataset.resVista; pref.resVista = st.resVista; guardarPref(); entrar(); render(); return; }
    const dia = e.target.closest('[data-dia]'); if (dia) { st.fecha = dia.dataset.dia; render(); return; }
    const mov = e.target.closest('[data-mover-dia]'); if (mov) { st.fecha = fechaDeNum(diaNum(st.fecha || hoy()) + Number(mov.dataset.moverDia)); render(); return; }
    const mm = e.target.closest('[data-mover-mes]');
    if (mm) { const [y, m] = (st.mes || hoy().slice(0, 7)).split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(mm.dataset.moverMes), 1)); st.mes = d.toISOString().slice(0, 7); render(); return; }
    if (e.target.closest('[data-hoy]')) { st.fecha = hoy(); st.mes = hoy().slice(0, 7); render(); return; }
    if (e.target.closest('[data-ver-lista]')) { st.resVista = 'lista'; pref.resVista = 'lista'; guardarPref(); render(); return; }
    if (e.target.closest('[data-anotar]')) { anotarReserva(); return; }

    // carta
    const sec = e.target.closest('[data-sec]'); if (sec) { st.cat = sec.dataset.sec; st.q = ''; render(); return; }
  }

  async function onChange(e) {
    const sf = e.target.closest('[data-sede-filtro]');
    if (sf) { st.sede = sf.value; pref.sede = st.sede; guardarPref(); render(); return; }
    if (vista !== 'carta' && vista !== 'fechas') return;
    const fila = e.target.closest('[data-prod]'); if (!fila) return;
    const prods = await store.getProductos();
    const p = prods.find(x => x.id === fila.dataset.prod); if (!p) return;
    if (e.target.matches('[data-disp]')) {
      await store.saveProducto({ ...p, disponible: e.target.checked });
      fila.classList.toggle('is-off', !e.target.checked);
      $('.kad-switch__txt', fila).textContent = e.target.checked ? t('hay') : t('noHay');
      marcarGuardado(fila);
    }
    if (e.target.matches('[data-precio]')) {
      const v = parsePrecio(e.target.value);
      await store.saveProducto({ ...p, precio: v });
      e.target.value = v == null ? '' : formatoNumero(v);
      marcarGuardado(fila);
    }
  }
  const formatoNumero = (n) => new Intl.NumberFormat(ctx.pais.locale, { maximumFractionDigits: ctx.pais.decimales || 0, minimumFractionDigits: 0 }).format(n);
  function parsePrecio(txt) {
    const s = String(txt).trim(); if (!s) return null;
    // "31.500" / "31500" / "31,5" según el país
    const limpio = ctx.pais.decimales ? s.replace(/\./g, '').replace(',', '.') : s.replace(/[.,\s]/g, '');
    const n = Number(limpio.replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : null;
  }
  function marcarGuardado(fila) {
    const ok = $('.kad-ok', fila); if (!ok) return;
    ok.classList.remove('is-on'); void ok.offsetWidth; ok.classList.add('is-on');
  }

  function ir(v) {
    vista = v; history.replaceState(null, '', '#' + v);
    entrar(); render(); $('#kad-main')?.focus({ preventScroll: true }); scrollTo({ top: 0 });
  }
  // la animación de entrada va solo al cambiar de sección (no en cada actualización de datos)
  let entT;
  function entrar() { const m = $('#kad-main', root); if (!m) return; m.classList.add('entrando'); clearTimeout(entT); entT = setTimeout(() => m.classList.remove('entrando'), 700); }

  // ---------- sonido (Web Audio, sin archivos)
  let audio;
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, .18].forEach((d, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = i ? 1320 : 880;
        g.gain.setValueAtTime(.0001, audio.currentTime + d); g.gain.exponentialRampToValueAtTime(.25, audio.currentTime + d + .02); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + d + .25);
        o.connect(g).connect(audio.destination); o.start(audio.currentTime + d); o.stop(audio.currentTime + d + .3);
      });
    } catch (_) { /* sin audio */ }
  }

  // =====================================================================
  // PEDIDOS: tablero de cocina
  // =====================================================================
  async function vistaPedidos(main) {
    const todos = await store.getPedidos();
    const deHoy = todos.filter(p => esDeHoy(p.creado) && (st.sede === 'todas' || p.sucursal?.id === st.sede));
    const validos = deHoy.filter(p => p.estado !== 'cancelado');
    const sinCobrar = todos.filter(p => p.estado !== 'cancelado' && !pagado(p) && (ACTIVOS.includes(p.estado) || esDeHoy(p.creado)));
    const conDelivery = (config.pedidos?.tipos || []).includes('delivery') || todos.some(p => p.tipo === 'delivery');
    const sedes = sucursales(config);
    if (st.sede !== 'todas' && !sedes.some(s => s.id === st.sede)) st.sede = 'todas';
    const claveRetiro = (p) => p.retiro?.fecha ? `${p.retiro.fecha} ${p.retiro.franja?.desde || ''}` : `9999 ${p.creado}`;
    const porRetiro = todos.some(p => p.retiro?.fecha);
    const filtrar = (arr) => {
      const r = arr.filter(p => (st.tipo === 'todos' || p.tipo === st.tipo) && (st.sede === 'todas' || p.sucursal?.id === st.sede));
      return porRetiro ? r.sort((a, b) => claveRetiro(a).localeCompare(claveRetiro(b))).reverse() : r;   // .reverse() de abajo lo deja en orden de retiro
    };
    const retiranHoy = todos.filter(p => p.retiro?.fecha === hoy() && ACTIVOS.includes(p.estado)).length;
    const cols = [
      { id: 'pendiente', corto: t('tabNuevos'), titulo: t('colNuevos'), items: filtrar(todos.filter(p => p.estado === 'pendiente')).reverse(), clase: 'nuevos' },
      { id: 'confirmado', corto: t('tabPreparando'), titulo: t('colPreparando'), items: filtrar(todos.filter(p => p.estado === 'confirmado')).reverse() },
      { id: 'listo', corto: t('tabListos'), titulo: t('colListos'), items: filtrar(todos.filter(p => p.estado === 'listo')).reverse() },
      { id: 'entregado', corto: t('tabEntregados'), titulo: t('colEntregados'), items: filtrar(deHoy.filter(p => p.estado === 'entregado')), compacta: true },
    ];
    if (!cols.some(c => c.id === st.colMovil && c.items.length) && cols[0].items.length === 0) {
      const conAlgo = cols.find(c => c.items.length); if (conAlgo) st.colMovil = conAlgo.id;
    }
    main.innerHTML = `
      <div class="kad-head kad-head--row">
        <h1>${esc(t('pedidosHoy'))}</h1>
        <div class="kad-stats">
          <span>${esc(t('nPedidos', { n: validos.length }))}</span>
          ${porRetiro ? `<span class="kad-stats__info">${esc(t('retiranHoy', { n: retiranHoy }))}</span>` : ''}
          ${validos.some(p => p.total > 0) || !validos.length ? `<span>${esc(t('vendidos', { monto: ctx.money(validos.reduce((s, p) => s + (p.total || 0), 0)) || '0' }))}</span>` : ''}
          ${sinCobrar.some(p => p.total > 0) ? `<span class="kad-stats__warn">${esc(t('sinCobrar', { n: sinCobrar.length, monto: ctx.money(sinCobrar.reduce((s, p) => s + (p.total || 0), 0)) }))}</span>` : ''}
        </div>
        ${sedes.length > 1 ? `<label class="kad-sede"><span class="kit-sr">${esc(t('sede'))}</span><select data-sede-filtro>
          <option value="todas" ${st.sede === 'todas' ? 'selected' : ''}>${esc(t('todasSedes'))}</option>
          ${sedes.map(s => `<option value="${esc(s.id)}" ${st.sede === s.id ? 'selected' : ''}>${esc(s.nombre || s.id)}</option>`).join('')}</select></label>` : ''}
        ${conDelivery ? `<div class="kad-seg" role="group">${[['todos', t('todos')], ['retiro', t('chipRetiro')], ['delivery', t('chipDelivery')]].map(([k, l]) => `<button type="button" data-tipo="${k}" aria-pressed="${st.tipo === k}">${esc(l)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="kad-cols-tabs" role="tablist">${cols.map(c => `<button type="button" role="tab" data-col="${c.id}" aria-selected="${st.colMovil === c.id}" class="kad-cols-tabs__b kad-cols-tabs__b--${c.clase || ''}">${esc(c.corto)} <b>${c.items.length}</b></button>`).join('')}</div>
      ${todos.length ? `<div class="kad-board">${cols.map(c => `
        <section class="kad-col kad-col--${c.id}${st.colMovil === c.id ? ' is-movil' : ''}">
          <h2 class="kad-col__t">${c.clase === 'nuevos' && c.items.length ? '<i class="kad-pulso" aria-hidden="true"></i>' : ''}<span>${esc(c.titulo)}</span><b>${c.items.length}</b></h2>
          ${c.items.length ? (c.compacta ? `<div class="kad-hechos">${c.items.slice(0, 8).map(filaEntregado).join('')}${c.items.length > 8 ? `<p class="kad-muted">${esc(t('verTodos', { n: c.items.length }))}</p>` : ''}</div>`
            : c.items.map(tarjetaPedido).join('')) : `<p class="kad-col__vacio">${esc(t('nadaAca'))}</p>`}
        </section>`).join('')}</div>`
        : `<div class="kit-empty"><p class="kit-empty__t">${esc(t('sinPedidos'))}</p><p>${esc(t('sinPedidosSub'))}</p><a class="kit-btn" href="${esc(sitio)}" target="_blank" rel="noopener">${esc(t('verSitio'))} ↗</a></div>`}`;
    todos.forEach(p => yaVistos.add(p.id)); tableroVisto = true;
  }

  function chipPago(p) {
    const sinPrecio = p.sinPrecio ?? (p.items || []).some(i => i.precio == null);
    if (sinPrecio && !PAGADO.includes(p.pagoEstado)) return `<span class="kad-chip kad-chip--warn">${esc(t('confirmarPrecio'))}${p.total ? ` · ${esc(totalTexto(p, ctx.money))}` : ''}</span>`;
    if (p.saldo > 0 && p.pagoEstado === 'aprobado') return `<span class="kad-chip kad-chip--ok">${esc(t('senaPagada', { monto: ctx.money(p.aPagar) }))}</span><span class="kad-chip kad-chip--warn">${esc(t('restoRetirar', { monto: ctx.money(p.saldo) }))}</span>`;
    if (p.pagoEstado === 'aprobado') return `<span class="kad-chip kad-chip--ok">${esc(t('pagadoMP'))}</span>`;
    if (p.pagoEstado === 'cobrado') return `<span class="kad-chip kad-chip--ok">${esc(t('cobrado'))}</span>`;
    if (p.pago === 'mercadopago' && p.pagoEstado === 'pendiente') return `<span class="kad-chip kad-chip--warn">${esc(t('pagoPendMP'))}</span>`;
    if (p.pagoEstado === 'rechazado') return `<span class="kad-chip kad-chip--danger">${esc(t('mpPagoRechazado'))}</span>`;
    if (p.pago === 'efectivo') return `<span class="kad-chip kad-chip--warn">${esc(t(p.descuentoPct ? 'aCobrarEfectivo' : 'aCobrar', { monto: ctx.money(p.total), pct: p.descuentoPct }))}</span>`;
    return `<span class="kad-chip kad-chip--warn">${esc(t('aCobrar', { monto: ctx.money(p.total) }))}</span>`;
  }
  function tarjetaPedido(p) {
    const min = minutosDesde(p.creado);
    const urg = p.estado === 'listo' ? '' : min >= 30 ? ' kad-reloj--rojo' : min >= 15 ? ' kad-reloj--ambar' : '';
    const nombre = p.cliente?.nombre || '';
    const waAviso = waCliente(p.cliente?.telefono, t('waListo', { nombre, codigo: p.codigo, negocio: config.nombre }));
    const waGen = waCliente(p.cliente?.telefono, t('waAvisoPedido', { nombre, codigo: p.codigo, negocio: config.nombre }));
    const delivery = p.tipo === 'delivery';
    let accion = '';
    if (p.estado === 'pendiente') accion = `<button type="button" class="kad-accion" data-estado="confirmado">${esc(t('aceptar'))}</button>`;
    else if (p.estado === 'confirmado') accion = `<button type="button" class="kad-accion kad-accion--ok" data-estado="listo">${esc(delivery ? t('listoEnviar') : t('listoRetirar'))}</button>`;
    else if (p.estado === 'listo') accion = `<div class="kad-acciones2">
        ${waAviso ? `<a class="kad-accion kad-accion--ghost" href="${esc(waAviso)}" target="_blank" rel="noopener">${esc(t('avisarListo'))}</a>` : ''}
        <button type="button" class="kad-accion" data-estado="entregado" ${pagado(p) && !(p.saldo > 0 && p.pagoEstado === 'aprobado') ? '' : 'data-cobrar="1"'}>${esc(p.saldo > 0 && p.pagoEstado === 'aprobado' ? t('cobreResto') : pagado(p) ? t('marcarEntregado') : t('cobradoEntregado'))}</button></div>`;
    const llega = tableroVisto && !yaVistos.has(p.id); yaVistos.add(p.id);
    return `<article class="kad-card kad-card--${p.estado}${llega ? ' is-nueva' : ''}" data-id="${esc(p.id)}">
      <header class="kad-card__head">
        <b class="kad-code">${esc(p.codigo)}</b>
        <time class="kad-reloj${urg}" datetime="${esc(p.creado)}">${esc(relativo(p.creado))}</time>
      </header>
      ${p.retiro?.fecha ? `<p class="kad-retiro${p.retiro.fecha === hoy() ? ' is-hoy' : p.retiro.fecha < hoy() ? ' is-vencido' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg><span>${esc(t('retira', { cuando: textoRetiro(p.retiro, { dias: t('dias'), hoy: hoy() }) }))}</span></p>` : ''}
      <div class="kad-chips">${chipPago(p)}<span class="kad-chip">${esc(delivery ? t('chipDelivery') : t('chipRetiro'))}</span>${p.sucursal ? `<span class="kad-chip kad-chip--sede">${esc(p.sucursal.nombre)}</span>` : ''}</div>
      <ul class="kad-items">${(p.items || []).map(i => `<li><b>${i.cant} ×</b> <span>${esc(i.nombre)}${i.detalle ? ` <em>${esc(i.detalle)}</em>` : ''}${i.precio == null && (p.items || []).some(x => x.precio != null) ? ` <small class="kad-sinprecio">${esc(t('aConfirmar'))}</small>` : ''}${i.nota ? `<em>${esc(i.nota)}</em>` : ''}</span></li>`).join('')}</ul>
      ${p.nota ? `<p class="kad-note"><b>${esc(t('waNota'))}:</b> ${esc(p.nota)}</p>` : ''}
      ${delivery && p.cliente?.direccion ? `<a class="kad-dir" href="${esc(mapsUrl(p.cliente.direccion))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/></svg><span><b>${esc(p.cliente.direccion)}</b> · ${esc(t('abrirMaps'))}</span></a>` : ''}
      <div class="kad-quien"><span>${esc(nombre)}${p.cliente?.telefono ? ` · ${esc(p.cliente.telefono)}` : ''}</span>${waGen ? `<a href="${esc(waGen)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>
      ${accion}
      ${p.estado !== 'listo' ? `<details class="kad-mas"><summary>${esc(t('masOpciones'))}</summary><button type="button" class="kad-mas__b" data-estado="cancelado">${esc(t('cancelarPedido'))}</button></details>` : ''}
    </article>`;
  }
  const filaEntregado = (p) => `<div class="kad-hecho" data-id="${esc(p.id)}"><span>${esc(p.codigo)} · ${esc(p.cliente?.nombre || '')}</span><span>${ctx.money(p.total) || ''}</span></div>`;

  // =====================================================================
  // RESERVAS: lista del día + calendario
  // =====================================================================
  async function vistaReservas(main) {
    const R = configReservas(config.reservas);
    const todas = await store.getReservas();
    st.fecha = st.fecha || hoy();
    st.mes = st.mes || st.fecha.slice(0, 7);
    const sinConf = todas.filter(r => r.estado === 'pendiente' && r.fecha >= hoy()).length;
    main.innerHTML = `
      <div class="kad-head kad-head--row">
        <div class="kad-seg kad-seg--grande" role="group">
          <button type="button" data-res-vista="lista" aria-pressed="${st.resVista === 'lista'}">${esc(t('listaDia'))}</button>
          <button type="button" data-res-vista="calendario" aria-pressed="${st.resVista === 'calendario'}">${esc(t('calendario'))}</button>
        </div>
        ${st.resVista === 'lista'
          ? `<div class="kad-fecha"><button type="button" class="kad-flecha" data-mover-dia="-1" aria-label="${esc(t('diaAnterior'))}">‹</button><h1>${esc(fechaLarga(st.fecha))}</h1><button type="button" class="kad-flecha" data-mover-dia="1" aria-label="${esc(t('diaSiguiente'))}">›</button>${st.fecha !== hoy() ? `<button type="button" class="kad-link" data-hoy>${esc(t('hoyBtn'))}</button>` : ''}</div>`
          : `<div class="kad-fecha"><button type="button" class="kad-flecha" data-mover-mes="-1" aria-label="${esc(t('mesAnterior'))}">‹</button><h1>${esc(nombreMes(st.mes))}</h1><button type="button" class="kad-flecha" data-mover-mes="1" aria-label="${esc(t('mesSiguiente'))}">›</button>${st.mes !== hoy().slice(0, 7) ? `<button type="button" class="kad-link" data-hoy>${esc(t('hoyBtn'))}</button>` : ''}</div>`}
        ${sinConf ? `<span class="kad-stats__warn kad-pill">${esc(t('paraConfirmar', { n: sinConf }))}</span>` : ''}
        <button type="button" class="kit-btn kad-anotar" data-anotar>+ ${esc(t('anotarReserva'))}</button>
      </div>
      ${st.resVista === 'lista' ? listaDia(todas, R) : calendarioMes(todas, R)}`;
  }

  function ocupacionDe(reservas, fecha) {
    const o = {}; reservas.filter(r => r.fecha === fecha && !['cancelada', 'no_vino'].includes(r.estado)).forEach(r => { o[r.hora] = (o[r.hora] || 0) + r.personas; }); return o;
  }
  function turnosDia(fecha, reservas) {
    // todos los horarios del día con su ocupación (sin importar si ya pasaron)
    const R = configReservas(config.reservas);
    const ts = generarTurnos({ horarios: config.horarios, reservas: { ...config.reservas, anticipacionMin: -1e6 }, tz: ctx.tz }, fecha, ocupacionDe(reservas, fecha), 1);
    return ts.map(x => ({ ...x, usados: (x.capacidad ?? R.capacidad) - x.libres }));
  }

  function listaDia(todas, R) {
    const del = todas.filter(r => r.fecha === st.fecha);
    const activas = del.filter(r => !['cancelada', 'no_vino'].includes(r.estado));
    const grupos = agrupar(del);
    const tsTodos = turnosDia(st.fecha, todas).filter(x => x.usados > 0);
    const pico = Math.max(0, ...tsTodos.map(x => x.usados));
    // con servicios: una barra por tanda (comparten cupo); si no, por horario
    const ts = conServicios
      ? turnosDia(st.fecha, todas).filter((x, i, a) => a.findIndex(y => y.servicio === x.servicio && y.tandaIndice === x.tandaIndice) === i).map(x => ({ ...x, label: [x.servicioNombre, x.tanda].filter(Boolean).join(' · ') }))
      : tsTodos.filter(x => x.usados >= pico * .3).slice(-12);
    const llenos = conServicios ? ts.filter(x => x.libres <= 0) : tsTodos.filter(x => x.libres <= 0);
    const notas = activas.filter(r => r.comentario || (r.extras || []).length).map(r => ({ ...r, comentario: [...(r.extras || []).map(extraLabel), r.comentario].filter(Boolean).join(' · ') }));
    return `
      <p class="kad-sub kad-sub--grande">${esc(nRes({ n: activas.length, p: activas.reduce((s, r) => s + r.personas, 0) }))}</p>
      <div class="kad-res-layout">
        <div class="kad-tabla">
          ${del.length ? grupos.map(g => {
            const rs = g.items; const act = rs.filter(r => !['cancelada', 'no_vino'].includes(r.estado));
            return `<section class="kad-turno"><h2 class="kad-turno__t"><span>${esc(g.label)}</span><small>${esc(nRes({ n: act.length, p: act.reduce((s, r) => s + r.personas, 0) }))}</small></h2>
              ${rs.map(filaReserva).join('')}</section>`;
          }).join('') : `<div class="kit-empty"><p class="kit-empty__t">${esc(t('sinReservas'))}</p><button type="button" class="kit-btn" data-anotar>+ ${esc(t('anotarReserva'))}</button></div>`}
        </div>
        <aside class="kad-lado">
          <div class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('comoViene'))}</h2>
            <p class="kad-muted">${esc(conServicios ? t('capacidadTanda') : t('capacidadN', { n: R.capacidad }))}</p>
            ${ts.length ? `<div class="kad-barras${conServicios ? ' kad-barras--tandas' : ''}">${ts.map(x => { const cap = x.capacidad ?? R.capacidad; const pct = Math.min(100, Math.round(x.usados / cap * 100)); const c = pct >= 100 ? 'rojo' : pct >= 75 ? 'ambar' : 'verde';
              return `<span>${esc(x.label)}</span><span class="kad-barra"><i class="kad-barra--${c}" style="width:${pct}%"></i></span><b>${x.usados}${conServicios ? `<small>/${cap}</small>` : ''}</b>`; }).join('')}</div>` : `<p class="kad-muted">—</p>`}
            ${llenos.length ? `<p class="kad-aviso">${esc(t('llenoAviso', { hora: llenos.map(x => x.label).join(', ') }))}</p>` : ''}
          </div>
          <div class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('paraTener'))}</h2>
            ${notas.length ? `<ul class="kad-notas">${notas.map(r => `<li><b>${esc(horaVisible(aMin(r.hora)))}</b> ${esc(r.nombre)} — ${esc(r.comentario)}</li>`).join('')}</ul>` : `<p class="kad-muted">${esc(t('sinNotas'))}</p>`}
          </div>
        </aside>
      </div>`;
  }

  function filaReserva(r) {
    const hora = horaVisible(aMin(r.hora));
    const [, m, d] = r.fecha.split('-').map(Number);
    const wa = waCliente(r.telefono, t('waConfirmaReserva', { nombre: r.nombre, negocio: config.nombre, personas: `${r.personas} ${r.personas === 1 ? t('persona') : t('personasN')}`, dia: `${d}/${m}`, hora }));
    const apagada = ['cancelada', 'no_vino'].includes(r.estado);
    const pasada = r.fecha < hoy();
    let acciones = '';
    if (r.estado === 'pendiente') acciones = `${wa ? `<a class="kad-mini kad-mini--ghost" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<button type="button" class="kad-mini" data-estado="confirmada">${esc(t('confirmar'))}</button>`;
    else if (r.estado === 'confirmada') acciones = `<button type="button" class="kad-mini kad-mini--ghost" data-estado="llego">${esc(t('marcarLlego'))}</button>`;
    const menu = ['pendiente', 'confirmada'].includes(r.estado) ? `<details class="kad-mas kad-mas--fila"><summary aria-label="${esc(t('masOpciones'))}">…</summary>
      ${r.estado === 'confirmada' || pasada ? `<button type="button" class="kad-mas__b" data-estado="no_vino">${esc(t('marcarNoVino'))}</button>` : ''}
      <button type="button" class="kad-mas__b" data-estado="cancelada">${esc(t('cancelar'))}</button></details>` : '';
    return `<div class="kad-card kad-card--res kad-res kad-card--${r.estado}${apagada ? ' is-apagada' : ''}" data-id="${esc(r.id)}">
      <b class="kad-res__hora">${esc(hora)}</b>
      <span class="kad-res__nombre"><b>${esc(r.nombre)}</b><small>${esc(r.telefono || '')}</small></span>
      <b class="kad-res__pers" title="${esc(t('personas'))}">${r.personas}<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/></svg></b>
      <span class="kad-res__nota">${(r.extras || []).map(x => `<i class="kad-extra">${esc(extraLabel(x))}</i>`).join('')}${esc(r.comentario || '')}</span>
      <span class="kad-est kad-est--${r.estado}">${esc(t(r.estado))}</span>
      <span class="kad-res__acc">${acciones}${menu}</span>
    </div>`;
  }

  function nombreMes(ym) { const [y, m] = ym.split('-').map(Number); return `${t('mesesLargos')[m - 1]} ${y}`; }

  function calendarioMes(todas, R) {
    const [y, m] = st.mes.split('-').map(Number);
    const primero = `${st.mes}-01`;
    const dias = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const offset = (diaSemana(primero) + 6) % 7;      // semana arranca lunes
    const celdas = [];
    for (let i = 0; i < offset; i++) celdas.push('<span class="kad-dia kad-dia--fuera" aria-hidden="true"></span>');
    for (let d = 1; d <= dias; d++) {
      const f = `${st.mes}-${String(d).padStart(2, '0')}`;
      const rs = todas.filter(r => r.fecha === f && !['cancelada', 'no_vino'].includes(r.estado));
      const abierto = conServicios ? serviciosDelDia({ horarios: config.horarios, reservas: config.reservas }, f).length > 0 : franjas(config.horarios, f).length > 0 && !(R.cerrados || []).includes(f);
      const pct = rs.length ? Math.min(100, Math.max(0, ...turnosDia(f, todas).map(x => Math.round(x.usados / (x.capacidad ?? R.capacidad) * 100)))) : 0;
      const c = pct >= 100 ? 'rojo' : pct >= 75 ? 'ambar' : 'verde';
      const cls = [f === hoy() && 'is-hoy', f === st.fecha && 'is-sel', f < hoy() && 'is-pasado', !abierto && 'is-cerrado'].filter(Boolean).join(' ');
      celdas.push(`<button type="button" class="kad-dia ${cls}" data-dia="${f}" aria-pressed="${f === st.fecha}">
        <span class="kad-dia__n">${d}${f === hoy() ? `<small>${esc(t('hoyBtn'))}</small>` : ''}</span>
        ${!abierto ? `<span class="kad-muted">${esc(t('cerrado'))}</span>` : rs.length ? `<span class="kad-dia__r"><b>${rs.length}</b> ${esc(t('reservas').toLowerCase())} · ${rs.reduce((s, r) => s + r.personas, 0)} ${esc(t('personasN').slice(0, 4))}.</span><span class="kad-barra"><i class="kad-barra--${c}" style="width:${Math.max(6, pct)}%"></i></span>` : ''}
      </button>`);
    }
    const sel = todas.filter(r => r.fecha === st.fecha && !['cancelada', 'no_vino'].includes(r.estado));
    const grupos = agrupar(sel);
    const llenos = turnosDia(st.fecha, todas).filter(x => x.usados > 0 && x.libres <= 0);
    return `
      <div class="kad-leyenda"><span><i class="kad-barra--verde"></i>${esc(t('tranquilo'))}</span><span><i class="kad-barra--ambar"></i>${esc(t('seLlena'))}</span><span><i class="kad-barra--rojo"></i>${esc(t('completo'))}</span></div>
      <div class="kad-res-layout">
        <div class="kad-cal">
          <div class="kad-cal__sem">${t('diasCortos').slice(1).concat(t('diasCortos')[0]).map(d => `<span>${esc(d)}</span>`).join('')}</div>
          <div class="kad-cal__grid">${celdas.join('')}</div>
        </div>
        <aside class="kad-lado">
          <div class="kad-caja">
            <h2 class="kad-caja__t kad-caja__t--grande">${esc(fechaLarga(st.fecha))}</h2>
            <p class="kad-muted">${esc(nRes({ n: sel.length, p: sel.reduce((s, r) => s + r.personas, 0) }))}</p>
            ${grupos.map(g => `<div class="kad-resumen"><b>${esc(g.label)}</b><span>${esc(nRes({ n: g.items.length, p: g.items.reduce((s, r) => s + r.personas, 0) }))}</span></div>`).join('')}
            ${llenos.length ? `<p class="kad-aviso">${esc(t('llenoAviso', { hora: llenos.map(x => x.label).join(', ') }))}</p>` : ''}
            <button type="button" class="kit-btn kit-btn--block" data-ver-lista>${esc(t('verListaDia'))}</button>
            <p class="kad-muted">${esc(t('tocaDia'))}</p>
          </div>
        </aside>
      </div>`;
  }

  function anotarReserva() {
    const R = configReservas(config.reservas);
    const f0 = st.fecha && st.fecha >= hoy() ? st.fecha : hoy();
    const opcionesHora = (f) => turnosDia(f, []).map(x => `<option value="${x.hora}">${x.label}${x.servicioNombre ? ` · ${esc(x.servicioNombre)}${x.tanda ? ` (${esc(x.tanda)})` : ''}` : ''}</option>`).join('');
    const f = h(`<form class="kit-form kad-anotar-form">
      <p class="kad-muted">${esc(t('anotarSub'))}</p>
      <div class="kit-field-row">
        <label class="kit-field"><span>${esc(t('dia'))}</span><input type="date" name="fecha" required value="${f0}" min="${hoy()}"></label>
        <label class="kit-field"><span>${esc(t('hora'))}</span><select name="hora" required>${opcionesHora(f0)}</select></label>
      </div>
      <div class="kit-field-row">
        <label class="kit-field"><span>${esc(t('personas'))}</span><input type="number" name="personas" min="1" max="${R.maxPersonas}" value="2" required></label>
        <label class="kit-field"><span>${esc(t('telefono'))}</span><input name="telefono" type="tel" inputmode="tel"></label>
      </div>
      <label class="kit-field"><span>${esc(t('nombre'))}</span><input name="nombre" required maxlength="80"></label>
      <label class="kit-field"><span>${esc(t('comentario'))}</span><input name="comentario" maxlength="300"></label>
      <p class="kit-msg" role="alert" hidden></p>
      <div class="kit-row kit-row--end"><button type="button" class="kit-btn kit-btn--ghost" data-close>${esc(t('cancelar'))}</button><button class="kit-btn">${esc(t('guardar'))}</button></div></form>`);
    const pop = popup({ titulo: t('anotarReserva'), contenido: f, clase: 'kit-pop--sm' });
    f.fecha.addEventListener('change', () => { f.hora.innerHTML = opcionesHora(f.fecha.value); });
    setTimeout(() => f.nombre.focus(), 80);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('.kit-msg', f);
      if (!f.nombre.value.trim() || !f.hora.value) { msg.textContent = t('faltan', { campos: t('nombre').toLowerCase() }); msg.hidden = false; return; }
      try {
        const r = await store.createReserva({ fecha: f.fecha.value, hora: f.hora.value, personas: Number(f.personas.value), nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim() || '(sin tel.)', comentario: f.comentario.value.trim() });
        if (r?.id) await store.updateReserva(r.id, { estado: 'confirmada' });
        st.fecha = f.fecha.value; st.mes = st.fecha.slice(0, 7);
        pop.close(); toast(t('guardado')); render();
      } catch (err) { msg.textContent = err.code === 'sin_lugar' ? t('sinLugar') : err.code === 'personas' ? t('masPersonas', { n: R.maxPersonas }) : t('error'); msg.hidden = false; }
    });
  }

  // =====================================================================
  // CARTA: secciones a la izquierda, platos con precio y stock en el renglón
  // =====================================================================
  let cartaCache = { cats: [], prods: [] };
  async function vistaCarta(main) {
    let [todasCats, prods, tempActiva] = await Promise.all([store.getCategorias(), store.getProductos(), store.getTemporada ? store.getTemporada() : null]);
    const cats = todasCats.filter(c => !c.especial);
    prods = prods.filter(p => !todasCats.some(c => c.especial && c.id === p.categoria));
    cartaCache = { cats, prods };
    const temps = temporadasDe(config);
    const nombreTemp = (id) => temps.find(x => x.id === id)?.nombre || id;
    if (!st.cat || (st.cat !== '_sin' && !cats.some(c => c.id === st.cat))) st.cat = cats[0]?.id || '_sin';
    const sueltos = prods.filter(p => !cats.some(c => c.id === p.categoria));
    const grupos = Array.isArray(config.carta?.grupos) && config.carta.grupos.length ? config.carta.grupos : null;
    const n = (id) => prods.filter(p => p.categoria === id).length;
    const li = (c) => `<li data-cat="${esc(c.id)}"${seVe(c, tempActiva) ? '' : ' class="is-guardada"'}><button type="button" data-sec="${esc(c.id)}" aria-current="${st.cat === c.id}"><span>${esc(c.nombre)}${temps.length && c.temporada && !seVe(c, tempActiva) ? ` <em class="kad-temp">${esc(t('guardadaTemp'))}</em>` : ''}</span><small>${n(c.id)}</small></button></li>`;
    let listaSecs;
    if (grupos) {
      const usados = new Set();
      listaSecs = grupos.map(g => { const cs = cats.filter(c => (g.categorias || []).includes(c.id)); cs.forEach(c => usados.add(c.id));
        return cs.length ? `<li class="kad-catlist__g">${esc(g.nombre)}</li>${cs.map(li).join('')}` : ''; }).join('');
      const resto = cats.filter(c => !usados.has(c.id));
      if (resto.length) listaSecs += resto.map(li).join('');
    } else listaSecs = cats.map(li).join('');
    if (sueltos.length) listaSecs += `<li data-cat="_sin"><button type="button" data-sec="_sin" aria-current="${st.cat === '_sin'}"><span>${esc(t('sinCategoria'))}</span><small>${sueltos.length}</small></button></li>`;

    main.innerHTML = `
      ${store.modo === 'produccion' && !prods.length && config.carta?.productos?.length ? `<div class="kad-demo"><span>${esc(t('importarCartaSub'))}</span><button class="kad-demo__btn" data-importar>${esc(t('importarCarta'))}</button></div>` : ''}
      <div class="kad-carta">
        <aside class="kad-cats">
          <label class="kad-buscar"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" data-buscar placeholder="${esc(t('buscarPlato'))}" value="${esc(st.q)}" aria-label="${esc(t('buscarPlato'))}"></label>
          ${temps.length ? `<div class="kad-tempbox"><h2 class="kad-cats__t">${esc(t('temporadaWeb'))}</h2>
            <div class="kad-seg kad-seg--temp" role="group" aria-label="${esc(t('temporadaWeb'))}">${temps.map(x => `<button type="button" data-temp="${esc(x.id)}" aria-pressed="${x.id === tempActiva}">${esc(x.nombre)}</button>`).join('')}</div>
            <p class="kad-muted">${esc(t('temporadaHint'))}</p></div>` : ''}
          <h2 class="kad-cats__t">${esc(t('secciones'))}</h2>
          <ul class="kad-catlist">${listaSecs}<li class="kad-catlist__add"><button type="button" class="kad-nueva" data-cat-nueva>+ ${esc(t('nuevaCategoria'))}</button></li></ul>
        </aside>
        <section class="kad-platos" data-platos></section>
      </div>`;
    pintarCartaLista();

    main.onclick = async (e) => {
      // siempre con los datos frescos (los precios pueden haber cambiado en el renglón)
      if (e.target.closest('[data-nuevo-prod], [data-editar], [data-pct], [data-cat-mover]')) prods = await store.getProductos();
      const np = e.target.closest('[data-nuevo-prod]');
      if (np) return editorProducto(null, cats, prods, np.dataset.nuevoProd || (st.cat !== '_sin' ? st.cat : cats[0]?.id));
      const ed = e.target.closest('[data-editar]');
      if (ed) return editorProducto(prods.find(p => p.id === ed.closest('[data-prod]').dataset.prod), cats, prods);
      if (e.target.closest('[data-importar]')) { await store.importarCarta(); toast(t('guardado')); return render(); }
      const tb = e.target.closest('[data-temp]');
      if (tb && store.setTemporada) {
        if (tb.getAttribute('aria-pressed') === 'true') return;
        await store.setTemporada(tb.dataset.temp); toast(t('temporadaOk', { nombre: nombreTemp(tb.dataset.temp) })); return render();
      }
      if (e.target.closest('[data-cat-nueva]')) return editorCategoria(null, cats);
      const cat = cats.find(c => c.id === st.cat);
      if (e.target.closest('[data-cat-editar]') && cat) return editorCategoria(cat, cats);
      if (e.target.closest('[data-cat-borrar]') && cat) {
        if (await confirmar(t('borrarCategoria', { nombre: cat.nombre }), { ok: t('borrar'), peligro: true })) { await store.deleteCategoria(cat.id); st.cat = null; toast(t('borrado')); render(); }
        return;
      }
      const mv = e.target.closest('[data-cat-mover]');
      if (mv && cat) {
        const i = cats.indexOf(cat), j = i + Number(mv.dataset.catMover); if (j < 0 || j >= cats.length) return;
        const orden = cats.slice(); [orden[i], orden[j]] = [orden[j], orden[i]];
        for (let k = 0; k < orden.length; k++) await store.saveCategoria({ ...orden[k], orden: k + 1 });
        render(); return;
      }
      const pct = e.target.closest('[data-pct]');
      if (pct && cat) {
        let v = pct.dataset.pct;
        if (v === 'otro') { v = prompt(t('pctPregunta')); if (!v) return; }
        v = Number(String(v).replace(',', '.')); if (!(v > 0 && v < 500)) return;
        const items = prods.filter(p => p.categoria === cat.id && (p.precio != null || tieneVariantes(p)));
        if (!(await confirmar(t('confirmaPct', { pct: v, n: items.length, cat: cat.nombre }), { ok: `+${v}%` }))) return;
        const red = ctx.pais.decimales ? 1 : 100;
        const sube = (n) => n == null ? n : Math.round(n * (1 + v / 100) / red) * red;
        for (const p of items) await store.saveProducto({ ...p, precio: sube(p.precio), ...(tieneVariantes(p) ? { variantes: p.variantes.map(x => ({ ...x, precio: sube(x.precio) })) } : {}) });
        toast(t('guardado')); render();
      }
    };
  }

  function pintarCartaLista() {
    const cont = $('[data-platos]', root); if (!cont) return;
    const { cats, prods } = cartaCache;
    const q = st.q.trim().toLowerCase();
    $$('.kad-catlist [data-sec]', root).forEach(b => b.setAttribute('aria-current', !q && b.dataset.sec === st.cat));
    const cat = cats.find(c => c.id === st.cat);
    const lista = q ? prods.filter(p => (p.nombre + ' ' + (p.descripcion || '')).toLowerCase().includes(q))
      : st.cat === '_sin' ? prods.filter(p => !cats.some(c => c.id === p.categoria)) : prods.filter(p => p.categoria === st.cat);
    const nombreCat = (id) => cats.find(c => c.id === id)?.nombre || t('sinCategoria');
    const red = ctx.pais.decimales ? '1' : '100';
    const i = cats.indexOf(cat);
    cont.innerHTML = `
      <div class="kad-platos__head">
        ${q ? `<h1>${esc(t('resultados', { n: lista.length, q: st.q }))}</h1>` : `<h1>${esc(cat?.nombre || t('sinCategoria'))}</h1>
          ${cat ? `<div class="kad-platos__tools">
            <button type="button" class="kad-link" data-cat-editar>${esc(t('cambiarNombre'))}</button>
            <button type="button" class="kad-flecha kad-flecha--chica" data-cat-mover="-1" ${i <= 0 ? 'disabled' : ''} aria-label="${esc(t('subir'))}">↑</button>
            <button type="button" class="kad-flecha kad-flecha--chica" data-cat-mover="1" ${i >= cats.length - 1 ? 'disabled' : ''} aria-label="${esc(t('bajar'))}">↓</button>
            <details class="kad-mas"><summary aria-label="${esc(t('masOpciones'))}">…</summary><button type="button" class="kad-mas__b" data-cat-borrar>${esc(t('borrarSeccion'))}</button></details>
          </div>` : ''}`}
        <span class="kad-vivo">${esc(t('alInstante'))}</span>
        <button type="button" class="kit-btn" data-nuevo-prod="${esc(cat?.id || '')}">+ ${esc(t('agregarPlato'))}</button>
      </div>
      ${lista.length ? `<div class="kad-prods-head" aria-hidden="true"><span></span><span>${esc(t('plato'))}</span><span>${esc(t('precio'))}</span><span>${esc(t('hayHoy'))}</span><span></span></div>
      <ul class="kad-prods">${lista.map(p => filaProducto(p, q ? nombreCat(p.categoria) : '')).join('')}</ul>` : `<div class="kit-empty"><p>${esc(q ? t('nadaAca') : t('seccionVacia'))}</p></div>`}
      ${!q && cat && lista.some(p => p.precio != null || tieneVariantes(p)) ? `<div class="kad-pct"><b>${esc(t('subirPrecios'))}</b>
        <button type="button" class="kad-mini kad-mini--ghost" data-pct="5">+ 5%</button><button type="button" class="kad-mini kad-mini--ghost" data-pct="10">+ 10%</button><button type="button" class="kad-mini kad-mini--ghost" data-pct="otro">${esc(t('otroPct'))}</button>
        <span class="kad-muted">${esc(t('redondea', { n: ctx.money(Number(red)) }))}</span></div>` : ''}`;
  }

  function filaProducto(p, catTxt = '') {
    const ph = ctx.pedible(p) && p.precio == null ? t('aConfirmar') : t('sinPrecio');
    return `<li class="kad-prod${p.disponible === false ? ' is-off' : ''}" data-prod="${esc(p.id)}">
          <button type="button" class="kad-prod__img" data-editar aria-label="${esc(t('editar'))} ${esc(p.nombre)}">${p.foto ? `<img src="${esc(ctx.asset(p.foto))}" alt="" loading="lazy" decoding="async">` : `<span>${esc(t('fotoAgregar'))}</span>`}</button>
          <button type="button" class="kad-prod__main" data-editar><b>${esc(p.nombre)}</b>${catTxt ? `<small class="kad-prod__cat">${esc(catTxt)}</small>` : ''}${p.descripcion ? `<span>${esc(p.descripcion)}</span>` : ''}</button>
          ${tieneVariantes(p) ? `<button type="button" class="kad-precio kad-precio--var" data-editar>${esc(p.variantes.map(v => `${v.nombre} ${ctx.money(v.precio) || '—'}`).join(' · '))}</button>`
            : `<label class="kad-precio"><span aria-hidden="true">${esc(ctx.pais.simbolo || '$')}</span><input type="text" inputmode="decimal" data-precio value="${p.precio != null ? esc(formatoNumero(p.precio)) : ''}" placeholder="${esc(ph)}" aria-label="${esc(t('precio'))} ${esc(p.nombre)}"></label>`}
          <label class="kad-switch"><input type="checkbox" data-disp ${p.disponible !== false ? 'checked' : ''}><span class="kad-switch__ui" aria-hidden="true"></span><span class="kad-switch__txt">${esc(p.disponible !== false ? t('hay') : t('noHay'))}</span></label>
          <span class="kad-prod__fin"><span class="kad-ok" aria-live="polite">${esc(t('guardadoOk'))}</span><button type="button" class="kad-mini kad-mini--ghost" data-editar>${esc(t('editar'))}</button></span>
        </li>`;
  }

  // =====================================================================
  // FECHAS ESPECIALES: Navidad, Pascuas, Día de la Madre… con su ventana y sus productos
  // =====================================================================
  const EST = { borrador: 'estBorrador', programada: 'estProgramada', aviso: 'estAviso', en_curso: 'estEnCurso', termino: 'estTermino' };
  async function vistaFechas(main) {
    const [cats, prods] = await Promise.all([store.getCategorias(), store.getProductos()]);
    const fechas = cats.filter(c => c.especial).sort((a, b) => {
      const o = { en_curso: 0, aviso: 1, programada: 2, borrador: 3, termino: 4 };
      return (o[estadoEspecial(a, hoy())] - o[estadoEspecial(b, hoy())]) || String(a.desde || '9').localeCompare(String(b.desde || '9'));
    });
    if (!fechas.some(f => f.id === st.fe)) st.fe = fechas[0]?.id || null;
    const fe = fechas.find(f => f.id === st.fe);
    const lista = fe ? prods.filter(p => p.categoria === fe.id) : [];
    const fmt = (f) => { if (!f) return '—'; const [, m, d] = f.split('-').map(Number); return `${d} ${t('meses')[m - 1]}`; };
    const chip = (c) => { const e = estadoEspecial(c, hoy()); return `<span class="kad-est kad-fest kad-fest--${e}">${esc(t(EST[e]))}</span>`; };
    const cuenta = (c) => { const e = estadoEspecial(c, hoy()); if (e === 'aviso' || e === 'programada') { const n = diasPara(c.desde, hoy()); return n > 0 ? ` · faltan ${n} días` : ''; } return ''; };
    main.innerHTML = `
      <div class="kad-head kad-head--row"><h1>${esc(t('fechas'))}</h1><button type="button" class="kit-btn" data-fe-nueva>+ ${esc(t('nuevaFecha'))}</button></div>
      ${fechas.length ? `<div class="kad-carta kad-fechas">
        <aside class="kad-cats"><ul class="kad-catlist kad-felist">${fechas.map(c => `<li><button type="button" data-fe="${esc(c.id)}" aria-current="${c.id === st.fe}">
          <span><b>${esc(c.nombre)}</b><small>${c.desde ? `${esc(fmt(c.desde))} – ${esc(fmt(c.hasta))}` : esc(t('estBorrador'))}${esc(cuenta(c))}</small></span>${chip(c)}</button></li>`).join('')}</ul></aside>
        <section class="kad-platos">
          <form class="kit-form kad-fe-form" data-fe-form>
            <div class="kad-fe-grid">
              <label class="kit-field"><span>${esc(t('nombre'))}</span><input name="nombre" required maxlength="40" value="${esc(fe.nombre)}"></label>
              <label class="kit-field"><span>${esc(t('fechaDesde'))}</span><input name="desde" type="date" value="${esc(fe.desde || '')}"></label>
              <label class="kit-field"><span>${esc(t('fechaHasta'))}</span><input name="hasta" type="date" value="${esc(fe.hasta || '')}"></label>
              <label class="kit-field"><span>${esc(t('avisoDias'))}</span><input name="avisoDias" type="number" min="0" max="120" inputmode="numeric" value="${esc(fe.avisoDias ?? 30)}"></label>
            </div>
            <label class="kit-field"><span>${esc(t('bajada'))}</span><input name="bajada" maxlength="140" value="${esc(fe.bajada || '')}"></label>
            <div class="kit-row kit-row--between"><button type="button" class="kit-btn kit-btn--ghost kit-btn--danger-t" data-fe-borrar>${esc(t('borrar'))}</button>
              <div class="kit-row"><a class="kit-btn kit-btn--ghost" href="${esc(sitio)}?sala=${encodeURIComponent(fe.id)}" target="_blank" rel="noopener">${esc(t('verEnWeb'))} ↗</a><button class="kit-btn">${esc(t('guardar'))}</button></div></div>
          </form>
          <div class="kad-platos__head"><h2 class="kad-fe-t">${esc(t('productosFecha'))}</h2><span class="kad-vivo">${esc(t('alInstante'))}</span><button type="button" class="kit-btn" data-nuevo-prod="${esc(fe.id)}">+ ${esc(t('agregarPlato'))}</button></div>
          ${lista.length ? `<div class="kad-prods-head" aria-hidden="true"><span></span><span>${esc(t('plato'))}</span><span>${esc(t('precio'))}</span><span>${esc(t('hayHoy'))}</span><span></span></div>
          <ul class="kad-prods">${lista.map(p => filaProducto(p)).join('')}</ul>` : `<div class="kit-empty"><p>${esc(t('seccionVacia'))}</p></div>`}
        </section></div>`
      : `<div class="kit-empty"><p class="kit-empty__t">${esc(t('sinFechas'))}</p><p>${esc(t('sinFechasSub'))}</p><button type="button" class="kit-btn" data-fe-nueva>+ ${esc(t('nuevaFecha'))}</button></div>`}`;

    main.onclick = async (e) => {
      const sel = e.target.closest('[data-fe]'); if (sel) { st.fe = sel.dataset.fe; render(); return; }
      if (e.target.closest('[data-fe-nueva]')) {
        const nombre = (prompt(t('nombre')) || '').trim(); if (!nombre) return;
        let id = slug(nombre); while (cats.some(c => c.id === id)) id += '-2';
        await store.saveCategoria({ id, nombre, especial: true, desde: '', hasta: '', avisoDias: 30, bajada: '', orden: cats.length + 1 });
        st.fe = id; toast(t('fechaGuardada')); render(); return;
      }
      if (e.target.closest('[data-fe-borrar]') && fe) {
        if (!(await confirmar(t('borrarFecha', { nombre: fe.nombre }), { ok: t('borrar'), peligro: true }))) return;
        for (const p of lista) await store.deleteProducto(p.id);
        await store.deleteCategoria(fe.id); st.fe = null; toast(t('borrado')); render(); return;
      }
      const fresh = await store.getProductos();
      const np = e.target.closest('[data-nuevo-prod]'); if (np) return editorProducto(null, cats, fresh, np.dataset.nuevoProd);
      const ed = e.target.closest('[data-editar]'); if (ed) return editorProducto(fresh.find(p => p.id === ed.closest('[data-prod]').dataset.prod), cats, fresh);
    };
    $('[data-fe-form]', main)?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      const desde = f.desde.value, hasta = f.hasta.value;
      await store.saveCategoria({ ...fe, nombre: f.nombre.value.trim() || fe.nombre, desde, hasta: hasta && desde && hasta < desde ? desde : hasta, avisoDias: Math.max(0, Number(f.avisoDias.value) || 0), bajada: f.bajada.value.trim() });
      toast(t('fechaGuardada')); render();
    });
  }

  function editorCategoria(cat, cats) {
    const temps = temporadasDe(config);
    const f = h(`<form class="kit-form"><label class="kit-field"><span>${esc(t('nombreCategoria'))}</span><input name="nombre" required maxlength="40" value="${esc(cat?.nombre || '')}"></label>
      ${temps.length ? `<label class="kit-field"><span>${esc(t('seMuestra'))}</span><select name="temporada"><option value="">${esc(t('siempre'))}</option>${temps.map(x => `<option value="${esc(x.id)}" ${cat?.temporada === x.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></label>` : ''}
      <div class="kit-row kit-row--end"><button type="button" class="kit-btn kit-btn--ghost" data-close>${esc(t('cancelar'))}</button><button class="kit-btn">${esc(t('guardar'))}</button></div></form>`);
    const p = popup({ titulo: cat ? t('cambiarNombre') : t('nuevaCategoria'), contenido: f, clase: 'kit-pop--sm' });
    setTimeout(() => f.nombre.focus(), 80);
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const nombre = f.nombre.value.trim(); if (!nombre) return;
      let id = cat?.id || slug(nombre); while (!cat && cats.some(c => c.id === id)) id += '-2';
      const extra = f.temporada ? { temporada: f.temporada.value || null } : {};
      await store.saveCategoria({ ...(cat || { orden: cats.length + 1 }), id, nombre, ...extra });
      st.cat = id; p.close(); toast(t('guardado')); render();
    });
  }

  function editorProducto(prod, cats, prods, catDefault) {
    const p0 = prod || { nombre: '', descripcion: '', precio: '', categoria: catDefault || cats[0]?.id || null, etiquetas: [], disponible: true, foto: '' };
    let foto = p0.foto || '';
    const f = h(`<form class="kit-form kad-editor" novalidate>
      <div class="kad-editor__foto">
        <div class="kad-editor__prev">${foto ? `<img src="${esc(ctx.asset(foto))}" alt="">` : '<span aria-hidden="true">+</span>'}</div>
        <div class="kit-row">
          <label class="kit-btn kit-btn--ghost kit-btn--sm kad-file"><input type="file" accept="image/*" data-file hidden><span>${esc(foto ? t('cambiarFoto') : t('subirFoto'))}</span></label>
          <button type="button" class="kit-btn kit-btn--ghost kit-btn--sm" data-sin-foto ${foto ? '' : 'hidden'}>${esc(t('quitarFoto'))}</button>
        </div>
      </div>
      <label class="kit-field"><span>${esc(t('nombre'))}</span><input name="nombre" required maxlength="80" value="${esc(p0.nombre)}"></label>
      ${tieneVariantes(p0) ? `<fieldset class="kad-vars"><legend>${esc(t('tamanos'))} (${esc(ctx.pais.moneda)})</legend><div class="kit-field-row">
        ${p0.variantes.map(v => `<label class="kit-field"><span>${esc(v.nombre)}</span><input data-var="${esc(v.id)}" type="number" inputmode="decimal" min="0" step="${ctx.pais.decimales ? '0.01' : '1'}" value="${v.precio ?? ''}"></label>`).join('')}</div></fieldset>` : ''}
      <div class="kit-field-row">
        ${tieneVariantes(p0) ? '<input name="precio" type="hidden" value="">' : `<label class="kit-field"><span>${esc(t('precio'))} (${esc(ctx.pais.moneda)})</span><input name="precio" type="number" inputmode="decimal" min="0" step="${ctx.pais.decimales ? '0.01' : '1'}" value="${p0.precio ?? ''}"></label>`}
        <label class="kit-field"><span>${esc(t('categoria'))}</span><select name="categoria">${cats.map(c => `<option value="${esc(c.id)}" ${c.id === p0.categoria ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}<option value="" ${!p0.categoria ? 'selected' : ''}>${esc(t('sinCategoria'))}</option></select></label>
      </div>
      <label class="kit-field"><span>${esc(t('descripcion'))}</span><textarea name="descripcion" rows="3" maxlength="400">${esc(p0.descripcion)}</textarea></label>
      <label class="kit-field"><span>${esc(t('etiquetas'))}</span><input name="etiquetas" value="${esc((p0.etiquetas || []).join(', '))}" placeholder="picante, veggie, casa, nuevo"></label>
      <label class="kit-check"><input type="checkbox" name="disponible" ${p0.disponible !== false ? 'checked' : ''}><span>${esc(t('disponible'))}</span></label>
      <p class="kit-msg" role="alert" hidden></p>
      <div class="kit-row kit-row--between kad-editor__foot">
        ${prod ? `<button type="button" class="kit-btn kit-btn--ghost kit-btn--danger-t" data-borrar>${esc(t('borrar'))}</button>` : '<span></span>'}
        <div class="kit-row"><button type="button" class="kit-btn kit-btn--ghost" data-close>${esc(t('cancelar'))}</button><button class="kit-btn">${esc(t('guardar'))}</button></div>
      </div></form>`);
    const pop = popup({ titulo: prod ? prod.nombre : t('nuevoProducto'), contenido: f, clase: 'kit-pop--editor' });
    const prev = $('.kad-editor__prev', f);
    $('[data-file]', f).addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      prev.classList.add('is-loading');
      try {
        foto = await store.uploadFoto(file);
        prev.innerHTML = `<img src="${esc(ctx.asset(foto))}" alt="">`; $('[data-sin-foto]', f).hidden = false;
        $('.kad-file span', f).textContent = t('cambiarFoto');
      } catch (_) { toast(t('fotoGrande'), 'warn'); }
      prev.classList.remove('is-loading');
    });
    $('[data-sin-foto]', f).addEventListener('click', (e) => { foto = ''; prev.innerHTML = '<span aria-hidden="true">+</span>'; e.target.hidden = true; });
    $('[data-borrar]', f)?.addEventListener('click', async () => {
      if (!(await confirmar(t('borrarProducto', { nombre: prod.nombre }), { ok: t('borrar'), peligro: true }))) return;
      await store.deleteProducto(prod.id); pop.close(); toast(t('borrado')); render();
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = f.nombre.value.trim();
      if (!nombre) { const m = $('.kit-msg', f); m.textContent = t('faltan', { campos: t('nombre').toLowerCase() }); m.hidden = false; return; }
      let id = prod?.id || slug(nombre); while (!prod && prods.some(x => x.id === id)) id += '-2';
      const enCat = prods.filter(x => x.categoria === f.categoria.value);
      try {
        await store.saveProducto({
          ...(prod || {}), id, nombre, descripcion: f.descripcion.value.trim(),
          precio: f.precio.value === '' ? null : Number(f.precio.value), categoria: f.categoria.value || null,
          ...(tieneVariantes(p0) ? { variantes: p0.variantes.map(v => { const inp = f.querySelector(`[data-var="${CSS.escape(String(v.id))}"]`); return { ...v, precio: inp && inp.value !== '' ? Number(inp.value) : null }; }) } : {}),
          etiquetas: f.etiquetas.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
          disponible: f.disponible.checked, foto, orden: prod?.orden ?? (Math.max(0, ...enCat.map(x => x.orden || 0)) + 1),
        });
        if (!prod) st.cat = f.categoria.value || '_sin';
        pop.close(); toast(t('guardado')); render();
      } catch (err) {
        const m = $('.kit-msg', f); m.textContent = err.code === 'quota' ? t('fotoGrande') : t('error'); m.hidden = false;
      }
    });
    setTimeout(() => { if (!prod) f.nombre.focus(); }, 80);
  }

  // =====================================================================
  // GIFT CARDS: canje por código (entera o en partes) + lista de emitidas
  // =====================================================================
  async function vistaGiftcards(main) {
    const todas = await store.getGiftcards();
    const ahora = Date.now();
    const sel = st.gc ? todas.find(g => g.codigo === st.gc) || null : null;
    const vigentes = todas.filter(g => canjeable(g, ahora));
    const mes = hoy().slice(0, 7);
    const delMes = todas.filter(g => g.estado !== 'pendiente' && (g.activada || g.creado).slice(0, 7) === mes);
    const fecha = (iso) => iso ? new Date(iso).toLocaleDateString(ctx.pais.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    const chip = (e) => `<span class="kad-est kad-est--gc-${esc(e)}">${esc(t(e))}</span>`;
    const ej = `${GC.prefijo}-7K2Q`;
    let caja;
    if (st.gc && !sel) caja = `<p class="kad-aviso">${esc(t('gcNoExiste'))}</p>`;
    else if (sel) {
      const e = sel.estado;
      caja = `<div class="kad-gc" data-gc-sel="${esc(sel.codigo)}">
        <div class="kad-gc__top"><b class="kad-gc__cod">${esc(sel.codigo)}</b>${chip(e)}</div>
        <div class="kad-gc__nums">
          <div><span>${esc(t('gcSaldo'))}</span><b>${ctx.money(sel.saldo)}</b><small>${esc(t('gcMonto'))}: ${ctx.money(sel.monto)}</small></div>
          <div><span>${esc(t('gcVenceEl'))}</span><b>${esc(fecha(sel.vence))}</b>${sel.vence && ['vigente', 'parcial'].includes(e) ? `<small>${esc(t('enDias', { n: Math.max(0, Math.ceil((new Date(sel.vence) - ahora) / 864e5)) }))}</small>` : ''}</div>
        </div>
        <p class="kad-gc__quien">${sel.para ? `${esc(t('gcPara', { para: sel.para }))}` : ''}${sel.de ? ` · ${esc(t('gcDe', { de: sel.de }))}` : ''}${sel.pedidoCodigo ? ` · ${esc(sel.pedidoCodigo)}` : ''}</p>
        ${sel.mensaje ? `<p class="kad-gc__msg">“${esc(sel.mensaje)}”</p>` : ''}
        ${e === 'pendiente' ? `<p class="kad-muted">${esc(t('gcPendienteSub'))}</p><button type="button" class="kit-btn kit-btn--block" data-gc-activar>${esc(t('gcActivar'))}</button>`
          : canjeable(sel, ahora) ? `<form class="kad-gc__canje" data-gc-canje>
              <label class="kit-field"><span>${esc(t('gcMontoCuenta'))}</span><span class="kad-precio kad-precio--grande"><span aria-hidden="true">${esc(ctx.pais.simbolo || '$')}</span><input type="text" inputmode="decimal" data-gc-monto value="${esc(formatoNumero(sel.saldo))}" aria-label="${esc(t('gcMontoCuenta'))}"></span></label>
              <button class="kit-btn kit-btn--big">${esc(t('gcCanjear'))}</button></form>`
          : `<p class="kad-aviso">${esc(t('gcEstadoNo', { estado: t(e).toLowerCase() }))}</p>`}
        ${st.gcMsg ? `<p class="kad-gc__ok kad-gc__ok--${esc(st.gcMsg.tipo)}" role="status">${esc(st.gcMsg.texto)}</p>` : ''}
        ${(sel.canjes || []).length ? `<div class="kad-gc__hist"><b>${esc(t('gcHistorial'))}</b>${sel.canjes.map(c => `<span>${esc(fecha(c.fecha))} · ${ctx.money(c.monto)}${c.nota ? ` · ${esc(c.nota)}` : ''}</span>`).join('')}</div>` : ''}
      </div>`;
    } else caja = `<p class="kad-muted">${esc(t('gcElegi'))}</p>`;

    main.innerHTML = `
      <div class="kad-head kad-head--row">
        <h1>${esc(t('giftcards'))}</h1>
        <div class="kad-stats">
          <span>${esc(t('gcVigentes', { n: vigentes.length, monto: ctx.money(vigentes.reduce((s, g) => s + Number(g.saldo || 0), 0)) || '0' }))}</span>
          <span>${esc(t('gcVendidasMes', { n: delMes.length, monto: ctx.money(delMes.reduce((s, g) => s + Number(g.monto || 0), 0)) || '0' }))}</span>
        </div>
      </div>
      <div class="kad-gc-layout">
        <section class="kad-caja kad-gc-canje">
          <h2 class="kad-caja__t kad-caja__t--grande">${esc(t('gcCanjear'))}</h2>
          <form class="kad-gc__buscar" data-gc-buscar>
            <label class="kit-sr" for="kad-gc-in">${esc(t('gcCodigo'))}</label>
            <input id="kad-gc-in" data-gc-input autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(t('gcCodigoPh', { ej }))}" value="${esc(st.gc)}">
            <button class="kit-btn">${esc(t('gcBuscar'))}</button>
          </form>
          ${caja}
        </section>
        <section class="kad-gc-lista">
          <h2 class="kad-caja__t">${esc(t('gcEmitidas'))}</h2>
          ${todas.length ? `<div class="kad-gc-tabla" role="table">
            <div class="kad-gc-fila kad-gc-fila--head" role="row"><span role="columnheader">${esc(t('gcCodigo'))}</span><span role="columnheader">${esc(t('gcParaLabel').split(' (')[0])}</span><span role="columnheader">${esc(t('gcMonto'))}</span><span role="columnheader">${esc(t('gcSaldo'))}</span><span role="columnheader">${esc(t('gcVenceEl'))}</span><span role="columnheader"></span></div>
            ${todas.map(g => `<button type="button" class="kad-gc-fila${g.codigo === st.gc ? ' is-sel' : ''}" role="row" data-gc-ver="${esc(g.codigo)}">
              <b role="cell">${esc(g.codigo)}</b><span role="cell">${esc(g.para || '—')}</span><span role="cell">${ctx.money(g.monto)}</span><span role="cell">${ctx.money(g.saldo)}</span><span role="cell">${esc(fecha(g.vence))}</span><span role="cell">${chip(g.estado)}</span></button>`).join('')}
          </div>` : `<div class="kit-empty"><p class="kit-empty__t">${esc(t('gcSinNada'))}</p><p>${esc(t('gcSinNadaSub'))}</p><a class="kit-btn" href="${esc(sitio)}" target="_blank" rel="noopener">${esc(t('verSitio'))} ↗</a></div>`}
        </section>
      </div>`;

    main.onsubmit = async (e) => {
      e.preventDefault();
      if (e.target.matches('[data-gc-buscar]')) { st.gc = normalizarCodigo(e.target.querySelector('input').value); st.gcMsg = null; return render(); }
      if (e.target.matches('[data-gc-canje]')) {
        const v = parsePrecio(e.target.querySelector('[data-gc-monto]').value);
        try {
          const g = await store.canjearGiftcard(st.gc, v);
          st.gcMsg = { tipo: 'ok', texto: g.saldo > 0 ? t('gcCanjeada', { saldo: ctx.money(g.saldo) }) : t('gcUsadaToda') };
          toast(t('guardado'));
        } catch (err) {
          st.gcMsg = { tipo: 'error', texto: err.code === 'gc_monto' ? t('gcMontoMal') : err.code === 'gc_no_canjeable' ? t('gcEstadoNo', { estado: t(estadoGiftcard(sel) || 'usada').toLowerCase() }) : t('error') };
        }
        render();
      }
    };
    main.onclick = async (e) => {
      const ver = e.target.closest('[data-gc-ver]');
      if (ver) { st.gc = ver.dataset.gcVer; st.gcMsg = null; render(); if (matchMedia('(max-width: 900px)').matches) $('.kad-gc-canje', root)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (e.target.closest('[data-gc-activar]')) { await store.activarGiftcard(st.gc); st.gcMsg = null; toast(t('vigente')); render(); }
    };
  }

  // =====================================================================
  // QR DE LA CARTA: link fijo a /carta + tarjetas para imprimir con la marca
  // =====================================================================
  function urlCarta(sedeId) {
    const base = opts.cartaUrl || config.cartaQR?.url || new URL('../carta/', location.href).href;
    const u = new URL(base, location.href);
    if (sedeId) u.searchParams.set('sede', sedeId); else u.searchParams.delete('sede');
    return u.href;
  }
  const textosQRBase = () => {
    const ig = String(config.instagram || '').replace(/^@/, '').trim();
    const host = (() => { try { const u = new URL(urlCarta()); return (u.host + u.pathname).replace(/^www\./, '').replace(/\/$/, ''); } catch (_) { return ''; } })();
    return { kicker: t('cartaDigital'), titulo: t('qrTitulo'), sub: t('qrSub'), pie: ig ? `@${ig}` : host, ...(config.cartaQR?.textos || {}) };
  };
  function prefQR() {
    pref.qr = pref.qr || {};
    const q = pref.qr;
    if (!FORMATOS[q.formato]) q.formato = config.cartaQR?.formato || 'mesa';
    if (!ESTILOS.includes(q.estilo)) q.estilo = config.cartaQR?.estilo || 'clasico';
    q.textos = { ...textosQRBase(), ...(q.textos || {}) };
    if (q.sede && !sucursales(config).some(x => x.id === q.sede)) q.sede = '';
    return q;
  }

  // pestañas de la sección: tarjeta con QR | carta completa
  const tabsImprimir = (Q) => `<div class="kad-seg kad-seg--grande kad-qr__tabs" role="group" aria-label="${esc(t('qrNav'))}">
    <button type="button" data-qr-modo="tarjeta" aria-pressed="${Q.modo !== 'carta'}">${esc(t('tabTarjeta'))}</button>
    <button type="button" data-qr-modo="carta" aria-pressed="${Q.modo === 'carta'}">${esc(t('tabCarta'))}</button></div>`;
  const ocupadoBtn = async (btn, fn) => {
    if (btn.classList.contains('is-loading')) return;
    btn.classList.add('is-loading'); btn.disabled = true;
    try { await fn(); } catch (err) { console.error('[kit] imprimir', err); toast(t('error')); }
    finally { btn.classList.remove('is-loading'); btn.disabled = false; }
  };
  const muestraEstilo = (e) => { const P = paletaTarjeta(config.marca, e); return `<span class="kad-qr__muestra" style="--m-f:${esc(P.fondo)};--m-t:${esc(P.texto)};--m-a:${esc(P.acento)};--m-b:${esc(P.banda || P.fondo)}"><i></i><b></b><u></u></span>`; };

  async function vistaQR(main) {
    const Q = prefQR();
    if (Q.modo === 'carta') return vistaCartaImpresa(main, Q);
    const sedes = sucursales(config);
    const host = location.hostname;
    const local = /^(localhost|127\.|192\.168\.|10\.|0\.0\.0\.0|\[::1\])/.test(host) || location.protocol === 'file:';
    const ico = {
      mesa: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="11" y="5" width="18" height="27" rx="2"/><rect x="15" y="15" width="10" height="10" rx="1"/><path d="M8 35h24"/></svg>',
      tent: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M6 33 14 8h12l8 25"/><rect x="15" y="15" width="10" height="10" rx="1"/><path d="M4 33h32"/></svg>',
      sticker: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="7" y="7" width="26" height="26" rx="4"/><rect x="14" y="14" width="12" height="12" rx="1"/></svg>',
    };
    const fmtTxt = { mesa: ['fmtMesa', 'fmtMesaSub'], tent: ['fmtTent', 'fmtTentSub'], sticker: ['fmtSticker', 'fmtStickerSub'] };
    const estTxt = { clasico: 'estClasico', marca: 'estMarca', minimal: 'estMinimal' };
    const muestra = (e) => { const P = paletaTarjeta(config.marca, e); return `<span class="kad-qr__muestra" style="--m-f:${esc(P.fondo)};--m-t:${esc(P.texto)};--m-a:${esc(P.acento)};--m-b:${esc(P.banda || P.fondo)}"><i></i><b></b><u></u></span>`; };
    const campo = (k, lbl) => `<label class="kit-field"><span>${esc(t(lbl))}</span><input data-qr-campo="${k}" value="${esc(Q.textos[k] || '')}" maxlength="${k === 'titulo' ? 40 : 70}" autocomplete="off"></label>`;

    main.innerHTML = `
      <div class="kad-head kad-head--row"><h1>${esc(t('qr'))}</h1>${tabsImprimir(Q)}</div>
      <p class="kad-sub kad-qr__intro">${esc(t('qrIntro'))}</p>
      ${store.modo === 'demo' ? `<p class="kad-qr__nota">${esc(t('qrDemoNota'))}</p>` : ''}
      ${local ? `<p class="kad-aviso">${esc(t('qrLocalNota', { host }))}</p>` : ''}
      <div class="kad-qr">
        <div class="kad-qr__prev">
          <div class="kad-qr__mesa" data-qr-mesa><canvas data-qr-canvas aria-label="${esc(t('qrVistaPrevia'))}" role="img"></canvas></div>
          <div class="kad-qr__acc">
            <button type="button" class="kit-btn kit-btn--big kit-btn--block kad-qr__pdf" data-qr-pdf><span>${esc(t('descPDF'))}</span><small>${esc(t('descPDFSub'))}</small></button>
            <div class="kad-qr__acc2">
              <button type="button" class="kit-btn kit-btn--ghost" data-qr-jpg>${esc(t('descJPG'))}</button>
              <button type="button" class="kit-btn kit-btn--ghost" data-qr-imprimir>${esc(t('imprimir'))}</button>
            </div>
            <button type="button" class="kad-link kad-qr__svg" data-qr-svg>${esc(t('soloQR'))}</button>
            <p class="kad-muted kad-qr__consejo">${esc(t('qrConsejo'))}</p>
          </div>
        </div>
        <div class="kad-qr__ctrl">
          <section class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('qrLink'))}</h2>
            <div class="kad-qr__link"><code data-qr-url>${esc(urlCarta(Q.sede))}</code></div>
            <div class="kad-qr__linkacc">
              <button type="button" class="kit-btn kit-btn--sm" data-qr-copiar>${esc(t('copiar'))}</button>
              <a class="kit-btn kit-btn--sm kit-btn--ghost" data-qr-abrir href="${esc(urlCarta(Q.sede))}" target="_blank" rel="noopener">${esc(t('abrirCarta'))} ↗</a>
            </div>
            ${sedes.length > 1 ? `<label class="kit-field kad-sede"><span>${esc(t('qrSede'))}</span><select data-qr-sede><option value="">${esc(t('qrGeneral'))}</option>${sedes.map(x => `<option value="${esc(x.id)}"${x.id === Q.sede ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></label>` : ''}
          </section>
          <section class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('qrFormato'))}</h2>
            <div class="kad-qr__fmts">${Object.keys(FORMATOS).map(f => `<button type="button" class="kad-qr__fmt" data-qr-formato="${f}" aria-pressed="${f === Q.formato}">${ico[f]}<b>${esc(t(fmtTxt[f][0]))}</b><small>${esc(t(fmtTxt[f][1]))}</small></button>`).join('')}</div>
          </section>
          <section class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('qrEstilo'))}</h2>
            <div class="kad-qr__ests">${ESTILOS.map(e => `<button type="button" class="kad-qr__est" data-qr-estilo="${e}" aria-pressed="${e === Q.estilo}">${muestra(e)}<b>${esc(t(estTxt[e]))}</b></button>`).join('')}</div>
          </section>
          <section class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('qrTextos'))}</h2>
            <div class="kad-qr__campos">${campo('kicker', 'qrKickerLbl')}${campo('titulo', 'qrTituloLbl')}${campo('sub', 'qrSubLbl')}${campo('pie', 'qrPieLbl')}</div>
            <button type="button" class="kad-link" data-qr-restaurar>${esc(t('qrRestaurar'))}</button>
          </section>
        </div>
      </div>`;

    const canvas = $('[data-qr-canvas]', main), mesa = $('[data-qr-mesa]', main);
    let turno = 0;
    async function dibujar() {
      const yo = ++turno;
      const [mw] = FORMATOS[Q.formato].mm;
      const ancho = Math.min(mesa.clientWidth - 48, Q.formato === 'tent' ? 620 : Q.formato === 'sticker' ? 380 : 400);
      const px = Math.max(2, ancho * Math.min(devicePixelRatio || 1, 2.5) / mw);
      const tmp = document.createElement('canvas');
      await dibujarTarjeta(tmp, { formato: Q.formato, estilo: Q.estilo, url: urlCarta(Q.sede), config, textos: Q.textos, asset: ctx.asset, pxPorMm: px });
      if (yo !== turno || !canvas.isConnected) return;
      canvas.width = tmp.width; canvas.height = tmp.height;
      canvas.getContext('2d').drawImage(tmp, 0, 0);
      canvas.style.width = `${Math.round(ancho)}px`;
      mesa.dataset.formato = Q.formato;
      canvas.classList.remove('is-cambiando'); void canvas.offsetWidth; canvas.classList.add('is-cambiando');
    }
    const redibujar = debounce(dibujar, 140);
    const guardar = () => { pref.qr = Q; guardarPref(); };
    dibujar();
    if (window.ResizeObserver) { let w0 = mesa.clientWidth; new ResizeObserver(() => { if (Math.abs(mesa.clientWidth - w0) > 8) { w0 = mesa.clientWidth; redibujar(); } }).observe(mesa); }

    // archivo en alta para imprimir
    async function enAlta() {
      const c = document.createElement('canvas');
      await dibujarTarjeta(c, { formato: Q.formato, estilo: Q.estilo, url: urlCarta(Q.sede), config, textos: Q.textos, asset: ctx.asset, pxPorMm: PX_MM_IMPRESION });
      return c;
    }
    const nombreArchivo = (ext) => `${config.id}-qr-${Q.formato}${Q.sede ? `-${Q.sede}` : ''}.${ext}`;
    async function hacerPDF() {
      const c = await enAlta(); const jpg = await jpgDe(c);
      return pdfHoja(jpg, c.width, c.height, Q.formato, { nota: `${config.nombre} · ${t(Q.formato === 'tent' ? 'pdfNotaTent' : 'pdfNota')}`, titulo: `${t('qr')} · ${config.nombre}` });
    }
    const ocupado = async (btn, fn) => {
      if (btn.classList.contains('is-loading')) return;
      btn.classList.add('is-loading'); btn.disabled = true;
      try { await fn(); } catch (err) { console.error('[kit] qr', err); toast(t('error')); }
      finally { btn.classList.remove('is-loading'); btn.disabled = false; }
    };

    main.oninput = (e) => {
      const f = e.target.closest('[data-qr-campo]'); if (!f) return;
      Q.textos[f.dataset.qrCampo] = f.value; guardar(); redibujar();
    };
    main.onchange = (e) => {
      const s = e.target.closest('[data-qr-sede]'); if (!s) return;
      Q.sede = s.value; guardar();
      $('[data-qr-url]', main).textContent = urlCarta(Q.sede); $('[data-qr-abrir]', main).href = urlCarta(Q.sede);
      dibujar();
    };
    main.onclick = async (e) => {
      const md = e.target.closest('[data-qr-modo]');
      if (md) { if (Q.modo !== md.dataset.qrModo) { Q.modo = md.dataset.qrModo; guardar(); entrar(); render(); } return; }
      const fm = e.target.closest('[data-qr-formato]');
      if (fm) { Q.formato = fm.dataset.qrFormato; guardar(); $$('[data-qr-formato]', main).forEach(b => b.setAttribute('aria-pressed', b === fm)); return dibujar(); }
      const es = e.target.closest('[data-qr-estilo]');
      if (es) { Q.estilo = es.dataset.qrEstilo; guardar(); $$('[data-qr-estilo]', main).forEach(b => b.setAttribute('aria-pressed', b === es)); return dibujar(); }
      if (e.target.closest('[data-qr-restaurar]')) {
        Q.textos = textosQRBase(); guardar();
        $$('[data-qr-campo]', main).forEach(i => { i.value = Q.textos[i.dataset.qrCampo] || ''; });
        return dibujar();
      }
      if (e.target.closest('[data-qr-copiar]')) {
        const u = urlCarta(Q.sede);
        try { await navigator.clipboard.writeText(u); } catch (_) { const r = document.createRange(); r.selectNodeContents($('[data-qr-url]', main)); getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand?.('copy'); }
        toast(t('linkCopiado')); return;
      }
      const pdf = e.target.closest('[data-qr-pdf]');
      if (pdf) return ocupado(pdf, async () => descargar(await hacerPDF(), nombreArchivo('pdf'), 'application/pdf'));
      const jpg = e.target.closest('[data-qr-jpg]');
      if (jpg) return ocupado(jpg, async () => descargar(await jpgDe(await enAlta()), nombreArchivo('jpg'), 'image/jpeg'));
      const imp = e.target.closest('[data-qr-imprimir]');
      if (imp) {
        // la ventana se abre en el click (si no, el navegador la bloquea) y después recibe el PDF
        const w = window.open('', '_blank');
        return ocupado(imp, async () => {
          const url = URL.createObjectURL(new Blob([await hacerPDF()], { type: 'application/pdf' }));
          if (w) w.location.href = url; else descargar(await hacerPDF(), nombreArchivo('pdf'), 'application/pdf');
          setTimeout(() => URL.revokeObjectURL(url), 120_000);
        });
      }
      if (e.target.closest('[data-qr-svg]')) {
        const P = paletaTarjeta(config.marca, Q.estilo);
        const svg = qrSVG(crearQR(urlCarta(Q.sede), { nivel: 'Q' }), { color: P.qrColor, fondo: '#ffffff', margen: 4, lado: 1024 });
        descargar(new Blob([svg], { type: 'image/svg+xml' }), nombreArchivo('svg'));
      }
    };
  }

  // ---------- CARTA COMPLETA para imprimir / mandar (PDF de varias páginas o JPG por página)
  async function vistaCartaImpresa(main, Q) {
    const C = Q.carta = { estilo: 'clasico', columnas: 'auto', descripciones: true, qr: true, sinStock: false, fuera: [], textos: {}, ...(Q.carta || {}) };
    if (!ESTILOS.includes(C.estilo)) C.estilo = 'clasico';
    const guardar = () => { pref.qr = Q; guardarPref(); };
    const [todasCats, todosProds, tmp] = await Promise.all([store.getCategorias(), store.getProductos(), store.getTemporada ? store.getTemporada() : null]);
    const { cats, prods } = filtrarCarta(todasCats, todosProds, tmp);
    const visibles = ctx.visibles(cats).filter(c => prods.some(p => p.categoria === c.id));
    const ig = String(config.instagram || '').replace(/^@/, '').trim();
    const host = (() => { try { const u = new URL(urlCarta()); return (u.host + u.pathname).replace(/^www\./, '').replace(/\/$/, ''); } catch (_) { return ''; } })();
    const fecha = new Date().toLocaleDateString(ctx.pais.locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ctx.tz });
    const base = () => ({ titulo: t('carta'), sub: t('preciosAl', { fecha }), pie: [ig && `@${ig}`, host].filter(Boolean).join('  ·  '), qr: t('qrPieCarta') });
    const T = () => ({ ...base(), ...C.textos });
    const grupos = () => visibles.filter(c => !C.fuera.includes(c.id)).map(c => ({ nombre: c.nombre, items: prods.filter(p => p.categoria === c.id && (C.sinStock || p.disponible !== false)) })).filter(g => g.items.length);
    const opcs = () => ({ columnas: C.columnas === 'auto' ? 'auto' : Number(C.columnas), descripciones: C.descripciones, qr: C.qr });
    const armar = (pxPorMm) => paginasCarta({ config, grupos: grupos(), estilo: C.estilo, url: urlCarta(Q.sede), textos: { ...T(), consultar: t('sinPrecio'), pagina: '{n} / {total}' }, opciones: opcs(), money: ctx.money, asset: ctx.asset, pxPorMm });
    const estTxt = { clasico: 'estClasico', marca: 'estMarca', minimal: 'estMinimal' };
    const campo = (k, lbl) => `<label class="kit-field"><span>${esc(t(lbl))}</span><input data-ci-campo="${k}" value="${esc(T()[k] || '')}" maxlength="${k === 'titulo' ? 40 : 90}" autocomplete="off"></label>`;
    const chk = (k, lbl) => `<label class="kit-check"><input type="checkbox" data-ci-opt="${k}"${C[k] ? ' checked' : ''}><span>${esc(t(lbl))}</span></label>`;

    main.innerHTML = `
      <div class="kad-head kad-head--row"><h1>${esc(t('cartaImpTitulo'))}</h1>${tabsImprimir(Q)}</div>
      <p class="kad-sub kad-qr__intro">${esc(t('cartaImpIntro'))}</p>
      <div class="kad-qr kad-ci">
        <div class="kad-qr__prev">
          <div class="kad-qr__mesa kad-ci__hojas" data-ci-hojas><p class="kad-muted">${esc(t('generando'))}</p></div>
          <div class="kad-qr__acc">
            <button type="button" class="kit-btn kit-btn--big kit-btn--block kad-qr__pdf" data-ci-pdf><span>${esc(t('descPDF'))}</span><small data-ci-n> </small></button>
            <div class="kad-qr__acc2">
              <button type="button" class="kit-btn kit-btn--ghost" data-ci-jpg>${esc(t('descJPG'))}</button>
              <button type="button" class="kit-btn kit-btn--ghost" data-ci-imprimir>${esc(t('imprimir'))}</button>
            </div>
            <p class="kad-muted kad-qr__consejo">${esc(t('cartaImpConsejo'))}</p>
          </div>
        </div>
        <div class="kad-qr__ctrl">
          <section class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('qrEstilo'))}</h2>
            <div class="kad-qr__ests">${ESTILOS.map(e => `<button type="button" class="kad-qr__est" data-ci-estilo="${e}" aria-pressed="${e === C.estilo}">${muestraEstilo(e)}<b>${esc(t(estTxt[e]))}</b></button>`).join('')}</div>
          </section>
          <section class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('ciArmado'))}</h2>
            <div class="kad-ci__fila"><span class="kad-ci__lbl">${esc(t('ciColumnas'))}</span>
              <div class="kad-seg" role="group">${['auto', '1', '2'].map(v => `<button type="button" data-ci-cols="${v}" aria-pressed="${String(C.columnas) === v}">${esc(v === 'auto' ? t('ciAuto') : v)}</button>`).join('')}</div></div>
            <div class="kad-ci__checks">${chk('descripciones', 'ciDescripciones')}${chk('qr', 'ciQR')}${chk('sinStock', 'ciSinStock')}</div>
          </section>
          <section class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('secciones'))}</h2>
            <div class="kad-ci__secs">${visibles.map(c => `<label class="kad-ci__sec"><input type="checkbox" data-ci-sec="${esc(c.id)}"${C.fuera.includes(c.id) ? '' : ' checked'}><span>${esc(c.nombre)}</span></label>`).join('') || `<p class="kad-muted">${esc(t('ciVacia'))}</p>`}</div>
          </section>
          <section class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('qrTextos'))}</h2>
            <div class="kad-qr__campos">${campo('titulo', 'qrTituloLbl')}${campo('sub', 'ciSubLbl')}${campo('pie', 'qrPieLbl')}${campo('qr', 'ciQRLbl')}</div>
            <button type="button" class="kad-link" data-ci-restaurar>${esc(t('qrRestaurar'))}</button>
          </section>
        </div>
      </div>`;

    const hojasEl = $('[data-ci-hojas]', main);
    let turno = 0;
    async function dibujar() {
      const yo = ++turno;
      if (!grupos().length) { hojasEl.innerHTML = `<p class="kad-muted">${esc(t('ciVacia'))}</p>`; $('[data-ci-n]', main).textContent = ''; return; }
      const ancho = Math.min(hojasEl.clientWidth - 48, 460);
      const hojas = await armar(Math.max(1.6, ancho * Math.min(devicePixelRatio || 1, 2) / HOJA[0]));
      if (yo !== turno || !hojasEl.isConnected) return;
      hojasEl.replaceChildren(...hojas.map((cv, i) => { cv.style.width = `${Math.round(ancho)}px`; cv.className = 'is-cambiando'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `${t('qrVistaPrevia')} ${i + 1}`); return cv; }));
      $('[data-ci-n]', main).textContent = hojas.length === 1 ? t('ciUnaHoja') : t('ciNHojas', { n: hojas.length });
    }
    const redibujar = debounce(dibujar, 180);
    dibujar();
    if (window.ResizeObserver) { let w0 = hojasEl.clientWidth; new ResizeObserver(() => { if (Math.abs(hojasEl.clientWidth - w0) > 8) { w0 = hojasEl.clientWidth; redibujar(); } }).observe(hojasEl); }

    const nombre = (ext, i) => `${config.id}-${slug(t('carta'))}${i ? `-${i}` : ''}.${ext}`;
    async function enAlta() {
      const hojas = await armar(PX_MM_IMPRESION);
      const jpgs = [];
      for (const cv of hojas) jpgs.push({ bytes: await jpgDe(cv, .92), w: cv.width, h: cv.height });
      return jpgs;
    }
    const hacerPDF = async () => pdfPaginas(await enAlta(), HOJA, { titulo: `${t('carta')} · ${config.nombre}` });

    main.oninput = (e) => {
      const f = e.target.closest('[data-ci-campo]'); if (!f) return;
      C.textos[f.dataset.ciCampo] = f.value; guardar(); redibujar();
    };
    main.onchange = (e) => {
      const o = e.target.closest('[data-ci-opt]');
      if (o) { C[o.dataset.ciOpt] = o.checked; guardar(); return dibujar(); }
      const sc = e.target.closest('[data-ci-sec]');
      if (sc) { const id = sc.dataset.ciSec; C.fuera = sc.checked ? C.fuera.filter(x => x !== id) : [...C.fuera, id]; guardar(); return dibujar(); }
    };
    main.onclick = async (e) => {
      const md = e.target.closest('[data-qr-modo]');
      if (md) { if (Q.modo !== md.dataset.qrModo) { Q.modo = md.dataset.qrModo; guardar(); entrar(); render(); } return; }
      const es = e.target.closest('[data-ci-estilo]');
      if (es) { C.estilo = es.dataset.ciEstilo; guardar(); $$('[data-ci-estilo]', main).forEach(b => b.setAttribute('aria-pressed', b === es)); return dibujar(); }
      const co = e.target.closest('[data-ci-cols]');
      if (co) { C.columnas = co.dataset.ciCols; guardar(); $$('[data-ci-cols]', main).forEach(b => b.setAttribute('aria-pressed', b === co)); return dibujar(); }
      if (e.target.closest('[data-ci-restaurar]')) {
        C.textos = {}; guardar();
        $$('[data-ci-campo]', main).forEach(i => { i.value = T()[i.dataset.ciCampo] || ''; });
        return dibujar();
      }
      const sinNada = () => { if (grupos().length) return false; toast(t('ciVacia')); return true; };
      const pdf = e.target.closest('[data-ci-pdf]');
      if (pdf) { if (sinNada()) return; return ocupadoBtn(pdf, async () => descargar(await hacerPDF(), nombre('pdf'), 'application/pdf')); }
      const jpg = e.target.closest('[data-ci-jpg]');
      if (jpg) {
        if (sinNada()) return;
        return ocupadoBtn(jpg, async () => {
          const jpgs = await enAlta();
          for (let i = 0; i < jpgs.length; i++) { descargar(jpgs[i].bytes, nombre('jpg', jpgs.length > 1 ? i + 1 : 0), 'image/jpeg'); if (i < jpgs.length - 1) await new Promise(r => setTimeout(r, 450)); }
        });
      }
      const imp = e.target.closest('[data-ci-imprimir]');
      if (imp) {
        if (sinNada()) return;
        const w = window.open('', '_blank');
        return ocupadoBtn(imp, async () => {
          const bytes = await hacerPDF();
          const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          if (w) w.location.href = url; else descargar(bytes, nombre('pdf'), 'application/pdf');
          setTimeout(() => URL.revokeObjectURL(url), 120_000);
        });
      }
    };
  }

  // ---------- contadores + aviso de pedido nuevo
  async function contadores() {
    const [peds, ress] = await Promise.all([
      config.modulos.carrito ? store.getPedidos() : [], config.modulos.reservas ? store.getReservas() : [],
    ]);
    const np = peds.filter(p => p.estado === 'pendiente').length;
    const nr = ress.filter(r => r.estado === 'pendiente' && r.fecha >= hoy()).length;
    const set = (k, n) => { const el = $(`[data-count="${k}"]`, root); if (el) { el.textContent = n; el.hidden = !n; } };
    set('pedidos', np); set('reservas', nr);
    if (pendientesAntes != null && np > pendientesAntes && pref.sonido) beep();
    pendientesAntes = np;
    document.title = `${np + nr ? `(${np + nr}) ` : ''}${t('panel')} · ${config.nombre}`;
  }

  async function render() {
    const main = $('#kad-main', root); if (!main) return;
    $$('[data-vista]', root).forEach(a => { const on = a.dataset.vista === vista; a.classList.toggle('is-on', on); a.setAttribute('aria-current', on ? 'page' : 'false'); });
    main.dataset.pantalla = vista;
    const y = scrollY;
    main.onclick = null; main.onsubmit = null; main.oninput = null; main.onchange = null;
    try {
      if (vista === 'pedidos') await vistaPedidos(main);
      else if (vista === 'reservas') await vistaReservas(main);
      else if (vista === 'carta') await vistaCarta(main);
      else if (vista === 'fechas') await vistaFechas(main);
      else if (vista === 'giftcards') await vistaGiftcards(main);
      else if (vista === 'qr') await vistaQR(main);
    } catch (err) { console.error('[kit] panel', err); main.innerHTML = `<p class="kit-error">${esc(t('error'))}</p>`; }
    if (Math.abs(scrollY - y) > 2) scrollTo({ top: y });
    contadores();
  }

  let rt;
  store.onChange((ev) => {
    if (!$('#kad-main', root)) return;
    clearTimeout(rt);
    rt = setTimeout(() => {
      // no repintar con un popup abierto ni mientras se escribe un precio
      if (document.querySelector('.kit-pop') || document.activeElement?.matches?.('[data-precio], [data-buscar], [data-gc-input], [data-gc-monto]')) { contadores(); return; }
      if ((ev?.origen === 'local' && vista === 'carta') || vista === 'qr') { contadores(); return; }   // la carta ya se actualizó en el lugar · el QR no depende de los datos   // la carta ya se actualizó en el lugar
      render();
      if (ev?.origen !== 'local' && vista !== 'carta') toast(`${t('nuevo')} ✓`);
    }, 120);
  });
  // los "hace X min" y los colores de demora se actualizan solos
  setInterval(() => {
    if (document.querySelector('.kit-pop') || vista !== 'pedidos' || document.activeElement?.closest?.('details[open]')) return;
    $$('.kad-reloj', root).forEach(el => { el.textContent = relativo(el.getAttribute('datetime')); });
  }, 30_000);

  async function arrancar() { layout(); entrar(); render(); }
  if (await store.getSession()) arrancar(); else pantallaLogin();
}
