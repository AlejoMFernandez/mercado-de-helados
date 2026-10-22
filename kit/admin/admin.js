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
import { ahoraEn, horaVisible, aMin, diaSemana, diaNum, fechaDeNum, franjas, generarTurnos, configReservas } from '../core/turnos.js';
import { linkWhatsApp } from '../core/pedidos.js';

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
  ].filter(Boolean);
  let vista = (location.hash.slice(1) && vistas.some(v => v.id === location.hash.slice(1))) ? location.hash.slice(1) : vistas[0]?.id;
  const KEY = `kit:${config.id}:panel`;
  const pref = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } })();
  const guardarPref = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (_) { /* sin storage */ } };
  const st = {
    tipo: 'todos',                         // filtro de pedidos
    suc: pref.suc || 'todas',              // filtro por sucursal (si cliente.json trae "sucursales")
    colMovil: 'pendiente',                 // columna visible en el celu
    resVista: pref.resVista || 'lista',    // lista | calendario
    fecha: null,                           // día elegido en reservas
    mes: null,                             // 'YYYY-MM' del calendario
    cat: null,                             // sección abierta en la carta
    q: '',                                 // búsqueda en la carta
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
          ${vistas.map(v => `<a href="#${v.id}" class="kad-nav__a" data-vista="${v.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${v.icono}</svg><span>${esc(t(v.id))}</span><i class="kad-count" data-count="${v.id}" hidden></i></a>`).join('')}
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
    const sucB = e.target.closest('[data-suc]'); if (sucB) { st.suc = sucB.dataset.suc; pref.suc = st.suc; guardarPref(); render(); return; }
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
    if (vista !== 'carta') return;
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
    const deHoy = todos.filter(p => esDeHoy(p.creado));
    const validos = deHoy.filter(p => p.estado !== 'cancelado');
    const sinCobrar = todos.filter(p => p.estado !== 'cancelado' && !pagado(p) && (ACTIVOS.includes(p.estado) || esDeHoy(p.creado)));
    const conDelivery = (config.pedidos?.tipos || []).includes('delivery') || todos.some(p => p.tipo === 'delivery');
    const SUCS = config.sucursales || [];
    const sucNombre = (id) => SUCS.find(x => x.id === id)?.nombre || id;
    const filtrar = (arr) => (st.tipo === 'todos' ? arr : arr.filter(p => p.tipo === st.tipo)).filter(p => !SUCS.length || st.suc === 'todas' || p.sucursal === st.suc);
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
          <span>${esc(t('vendidos', { monto: ctx.money(validos.reduce((s, p) => s + (p.total || 0), 0)) || '0' }))}</span>
          ${sinCobrar.length ? `<span class="kad-stats__warn">${esc(t('sinCobrar', { n: sinCobrar.length, monto: ctx.money(sinCobrar.reduce((s, p) => s + (p.total || 0), 0)) }))}</span>` : ''}
        </div>
        ${SUCS.length ? `<div class="kad-seg kad-seg--suc" role="group" aria-label="${esc(t('sucursal'))}">${[['todas', t('todas')], ...SUCS.map(x => [x.id, x.nombre])].map(([k, l]) => `<button type="button" data-suc="${esc(k)}" aria-pressed="${st.suc === k}">${esc(l)}</button>`).join('')}</div>` : ''}
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
    if (p.pagoEstado === 'aprobado') return `<span class="kad-chip kad-chip--ok">${esc(t('pagadoMP'))}</span>`;
    if (p.pagoEstado === 'cobrado') return `<span class="kad-chip kad-chip--ok">${esc(t('cobrado'))}</span>`;
    if (p.pago === 'mercadopago' && p.pagoEstado === 'pendiente') return `<span class="kad-chip kad-chip--warn">${esc(t('pagoPendMP'))}</span>`;
    if (p.pagoEstado === 'rechazado') return `<span class="kad-chip kad-chip--danger">${esc(t('mpPagoRechazado'))}</span>`;
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
        <button type="button" class="kad-accion" data-estado="entregado" ${pagado(p) ? '' : 'data-cobrar="1"'}>${esc(pagado(p) ? t('marcarEntregado') : t('cobradoEntregado'))}</button></div>`;
    const llega = tableroVisto && !yaVistos.has(p.id); yaVistos.add(p.id);
    return `<article class="kad-card kad-card--${p.estado}${llega ? ' is-nueva' : ''}" data-id="${esc(p.id)}">
      <header class="kad-card__head">
        <b class="kad-code">${esc(p.codigo)}</b>
        <time class="kad-reloj${urg}" datetime="${esc(p.creado)}">${esc(relativo(p.creado))}</time>
      </header>
      <div class="kad-chips">${chipPago(p)}<span class="kad-chip">${esc(delivery ? t('chipDelivery') : t('chipRetiro'))}</span>${p.sucursal ? `<span class="kad-chip kad-chip--suc">${esc((config.sucursales || []).find(x => x.id === p.sucursal)?.nombre || p.sucursal)}</span>` : ''}</div>
      <ul class="kad-items">${(p.items || []).map(i => `<li><b>${i.cant} ×</b> <span>${esc(i.nombre)}${i.nota ? `<em>${esc(i.nota)}</em>` : ''}</span></li>`).join('')}</ul>
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
    return ts.map(x => ({ ...x, usados: R.capacidad - x.libres }));
  }

  function listaDia(todas, R) {
    const del = todas.filter(r => r.fecha === st.fecha);
    const activas = del.filter(r => !['cancelada', 'no_vino'].includes(r.estado));
    const grupos = {};
    del.forEach(r => { const k = turnoDe(r.hora); (grupos[k] = grupos[k] || []).push(r); });
    const orden = ['turnoManana', 'turnoMediodia', 'turnoTarde', 'turnoNoche'].filter(k => grupos[k]);
    const tsTodos = turnosDia(st.fecha, todas).filter(x => x.usados > 0);
    const pico = Math.max(0, ...tsTodos.map(x => x.usados));
    const ts = tsTodos.filter(x => x.usados >= pico * .3).slice(-12);
    const llenos = tsTodos.filter(x => x.libres <= 0);
    const notas = activas.filter(r => r.comentario);
    return `
      <p class="kad-sub kad-sub--grande">${esc(nRes({ n: activas.length, p: activas.reduce((s, r) => s + r.personas, 0) }))}</p>
      <div class="kad-res-layout">
        <div class="kad-tabla">
          ${del.length ? orden.map(k => {
            const rs = grupos[k]; const act = rs.filter(r => !['cancelada', 'no_vino'].includes(r.estado));
            return `<section class="kad-turno"><h2 class="kad-turno__t"><span>${esc(t(k))}</span><small>${esc(nRes({ n: act.length, p: act.reduce((s, r) => s + r.personas, 0) }))}</small></h2>
              ${rs.map(filaReserva).join('')}</section>`;
          }).join('') : `<div class="kit-empty"><p class="kit-empty__t">${esc(t('sinReservas'))}</p><button type="button" class="kit-btn" data-anotar>+ ${esc(t('anotarReserva'))}</button></div>`}
        </div>
        <aside class="kad-lado">
          <div class="kad-caja">
            <h2 class="kad-caja__t">${esc(t('comoViene'))}</h2>
            <p class="kad-muted">${esc(t('capacidadN', { n: R.capacidad }))}</p>
            ${ts.length ? `<div class="kad-barras">${ts.map(x => { const pct = Math.min(100, Math.round(x.usados / R.capacidad * 100)); const c = pct >= 100 ? 'rojo' : pct >= 75 ? 'ambar' : 'verde';
              return `<span>${esc(x.label)}</span><span class="kad-barra"><i class="kad-barra--${c}" style="width:${pct}%"></i></span><b>${x.usados}</b>`; }).join('')}</div>` : `<p class="kad-muted">—</p>`}
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
      <span class="kad-res__nota">${esc(r.comentario || '')}</span>
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
      const abierto = franjas(config.horarios, f).length > 0 && !(R.cerrados || []).includes(f);
      const pico = rs.length ? Math.max(0, ...turnosDia(f, todas).map(x => x.usados)) : 0;
      const pct = Math.min(100, Math.round(pico / R.capacidad * 100));
      const c = pct >= 100 ? 'rojo' : pct >= 75 ? 'ambar' : 'verde';
      const cls = [f === hoy() && 'is-hoy', f === st.fecha && 'is-sel', f < hoy() && 'is-pasado', !abierto && 'is-cerrado'].filter(Boolean).join(' ');
      celdas.push(`<button type="button" class="kad-dia ${cls}" data-dia="${f}" aria-pressed="${f === st.fecha}">
        <span class="kad-dia__n">${d}${f === hoy() ? `<small>${esc(t('hoyBtn'))}</small>` : ''}</span>
        ${!abierto ? `<span class="kad-muted">${esc(t('cerrado'))}</span>` : rs.length ? `<span class="kad-dia__r"><b>${rs.length}</b> ${esc(t('reservas').toLowerCase())} · ${rs.reduce((s, r) => s + r.personas, 0)} ${esc(t('personasN').slice(0, 4))}.</span><span class="kad-barra"><i class="kad-barra--${c}" style="width:${Math.max(6, pct)}%"></i></span>` : ''}
      </button>`);
    }
    const sel = todas.filter(r => r.fecha === st.fecha && !['cancelada', 'no_vino'].includes(r.estado));
    const grupos = {}; sel.forEach(r => { const k = turnoDe(r.hora); (grupos[k] = grupos[k] || []).push(r); });
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
            ${['turnoManana', 'turnoMediodia', 'turnoTarde', 'turnoNoche'].filter(k => grupos[k]).map(k => `<div class="kad-resumen"><b>${esc(t(k))}</b><span>${esc(nRes({ n: grupos[k].length, p: grupos[k].reduce((s, r) => s + r.personas, 0) }))}</span></div>`).join('')}
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
    const opcionesHora = (f) => turnosDia(f, []).map(x => `<option value="${x.hora}">${x.label}</option>`).join('');
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
    let [cats, prods] = await Promise.all([store.getCategorias(), store.getProductos()]);
    cartaCache = { cats, prods };
    if (!st.cat || (st.cat !== '_sin' && !cats.some(c => c.id === st.cat))) st.cat = cats[0]?.id || '_sin';
    const sueltos = prods.filter(p => !cats.some(c => c.id === p.categoria));
    const grupos = Array.isArray(config.carta?.grupos) && config.carta.grupos.length ? config.carta.grupos : null;
    const n = (id) => prods.filter(p => p.categoria === id).length;
    const li = (c) => `<li data-cat="${esc(c.id)}"><button type="button" data-sec="${esc(c.id)}" aria-current="${st.cat === c.id}"><span>${esc(c.nombre)}</span><small>${n(c.id)}</small></button></li>`;
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
        const items = prods.filter(p => p.categoria === cat.id && p.precio != null);
        if (!(await confirmar(t('confirmaPct', { pct: v, n: items.length, cat: cat.nombre }), { ok: `+${v}%` }))) return;
        const red = ctx.pais.decimales ? 1 : 100;
        for (const p of items) await store.saveProducto({ ...p, precio: Math.round(p.precio * (1 + v / 100) / red) * red });
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
      <ul class="kad-prods">${lista.map(p => `<li class="kad-prod${p.disponible === false ? ' is-off' : ''}" data-prod="${esc(p.id)}">
          <button type="button" class="kad-prod__img" data-editar aria-label="${esc(t('editar'))} ${esc(p.nombre)}">${p.foto ? `<img src="${esc(ctx.asset(p.foto))}" alt="" loading="lazy" decoding="async">` : `<span>${esc(t('fotoAgregar'))}</span>`}</button>
          <button type="button" class="kad-prod__main" data-editar><b>${esc(p.nombre)}</b>${q ? `<small class="kad-prod__cat">${esc(nombreCat(p.categoria))}</small>` : ''}${p.descripcion ? `<span>${esc(p.descripcion)}</span>` : ''}</button>
          <label class="kad-precio"><span aria-hidden="true">${esc(ctx.pais.simbolo || '$')}</span><input type="text" inputmode="decimal" data-precio value="${p.precio != null ? esc(formatoNumero(p.precio)) : ''}" placeholder="${esc(t('sinPrecio'))}" aria-label="${esc(t('precio'))} ${esc(p.nombre)}"></label>
          <label class="kad-switch"><input type="checkbox" data-disp ${p.disponible !== false ? 'checked' : ''}><span class="kad-switch__ui" aria-hidden="true"></span><span class="kad-switch__txt">${esc(p.disponible !== false ? t('hay') : t('noHay'))}</span></label>
          <span class="kad-prod__fin"><span class="kad-ok" aria-live="polite">${esc(t('guardadoOk'))}</span><button type="button" class="kad-mini kad-mini--ghost" data-editar>${esc(t('editar'))}</button></span>
        </li>`).join('')}</ul>` : `<div class="kit-empty"><p>${esc(q ? t('nadaAca') : t('seccionVacia'))}</p></div>`}
      ${!q && cat && lista.some(p => p.precio != null) ? `<div class="kad-pct"><b>${esc(t('subirPrecios'))}</b>
        <button type="button" class="kad-mini kad-mini--ghost" data-pct="5">+ 5%</button><button type="button" class="kad-mini kad-mini--ghost" data-pct="10">+ 10%</button><button type="button" class="kad-mini kad-mini--ghost" data-pct="otro">${esc(t('otroPct'))}</button>
        <span class="kad-muted">${esc(t('redondea', { n: ctx.money(Number(red)) }))}</span></div>` : ''}`;
  }

  function editorCategoria(cat, cats) {
    const f = h(`<form class="kit-form"><label class="kit-field"><span>${esc(t('nombreCategoria'))}</span><input name="nombre" required maxlength="40" value="${esc(cat?.nombre || '')}"></label>
      <div class="kit-row kit-row--end"><button type="button" class="kit-btn kit-btn--ghost" data-close>${esc(t('cancelar'))}</button><button class="kit-btn">${esc(t('guardar'))}</button></div></form>`);
    const p = popup({ titulo: cat ? t('cambiarNombre') : t('nuevaCategoria'), contenido: f, clase: 'kit-pop--sm' });
    setTimeout(() => f.nombre.focus(), 80);
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const nombre = f.nombre.value.trim(); if (!nombre) return;
      let id = cat?.id || slug(nombre); while (!cat && cats.some(c => c.id === id)) id += '-2';
      await store.saveCategoria({ ...(cat || { orden: cats.length + 1 }), id, nombre });
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
      <div class="kit-field-row">
        <label class="kit-field"><span>${esc(t('precio'))} (${esc(ctx.pais.moneda)})</span><input name="precio" type="number" inputmode="decimal" min="0" step="${ctx.pais.decimales ? '0.01' : '1'}" value="${p0.precio ?? ''}"></label>
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
    try {
      if (vista === 'pedidos') await vistaPedidos(main);
      else if (vista === 'reservas') await vistaReservas(main);
      else if (vista === 'carta') await vistaCarta(main);
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
      if (document.querySelector('.kit-pop') || document.activeElement?.matches?.('[data-precio], [data-buscar]')) { contadores(); return; }
      if (ev?.origen === 'local' && vista === 'carta') { contadores(); return; }   // la carta ya se actualizó en el lugar
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
