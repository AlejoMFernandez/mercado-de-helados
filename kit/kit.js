// KIT DEMOS — punto de entrada para el sitio público.
//
//   <link rel="stylesheet" href="kit/kit.css">
//   <script type="module">
//     import { initKit } from './kit/kit.js';
//     const kit = await initKit({ config: 'cliente.json' });
//   </script>
//
// Monta según "modulos" de cliente.json:
//   carta    → cada [data-kit="carta"]
//   carrito  → botón flotante + checkout (WhatsApp / Mercado Pago) y [data-kit-add], [data-kit-qty]
//   reservas → cada [data-kit="reservas"] y [data-kit-open="reservas"]
//   admin    → el panel vive en /admin (ver kit/admin)
import { createStore } from './store/index.js';
import { applyTheme } from './core/theme.js';
import { setLang, t } from './core/i18n.js';
import { pais, crearFormatoMoneda } from './core/pais.js';
import { estadoAbierto } from './core/turnos.js';
import { h, esc } from './core/util.js';
import { mountCarta } from './modules/carta.js';
import { initCarrito } from './modules/carrito.js';
import { initReservas } from './modules/reservas.js';

export const VERSION = '1.0.0';

export async function cargarConfig(src = 'cliente.json') {
  const url = new URL(src, location.href);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`[kit] no se pudo leer ${url}`);
  const config = await res.json();
  const P = pais(config.pais);
  config.idioma = config.idioma || P.idioma;
  config.zonaHoraria = config.zonaHoraria || P.tz;
  config.modulos = { carta: true, carrito: false, reservas: false, admin: true, ...(config.modulos || {}) };
  config.prefijoPedido = config.prefijoPedido || String(config.nombre || 'PD').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'PD';
  return { config, base: url };
}

export async function crearContexto({ config, base }) {
  setLang(config.idioma, config.textos);
  applyTheme(config.marca);
  const store = await createStore(config);
  const P = pais(config.pais);
  return {
    config, store, t, pais: P, lang: config.idioma, tz: config.zonaHoraria,
    money: crearFormatoMoneda(config.pais),
    // rutas de cliente.json (img/…) relativas al propio cliente.json: funcionan igual desde / y desde /admin
    asset: (p) => !p ? '' : /^(data:|blob:|https?:|\/)/.test(p) ? p : new URL(p, base).href,
    abierto: () => estadoAbierto(config.horarios, config.zonaHoraria),
  };
}

export async function initKit(opts = {}) {
  const loaded = await cargarConfig(opts.config);
  const ctx = await crearContexto(loaded);
  const M = ctx.config.modulos;
  document.documentElement.classList.add('kit-on', `kit-${ctx.store.modo}`);

  if (M.carrito) ctx.carrito = initCarrito(ctx, opts.carrito);
  if (M.carta) ctx.cartas = Array.from(document.querySelectorAll('[data-kit="carta"]')).map(el => mountCarta(el, ctx, opts.carta));
  if (M.reservas) ctx.reservas = initReservas(ctx);

  // Píldora "Probá el panel": en la demo invita al dueño a entrar a /admin.
  if (ctx.store.modo === 'demo' && M.admin && opts.badge !== false) {
    const href = opts.adminUrl || 'admin/';
    const b = h(`<a class="kit-root kit-demo-pill" href="${esc(href)}" target="_blank" rel="noopener"><span class="kit-demo-pill__dot"></span>${esc(opts.badgeTexto || (ctx.lang === 'pt-BR' ? 'Testar o painel do dono' : 'Probá el panel del dueño'))}<span aria-hidden="true">→</span></a>`);
    document.body.appendChild(b);
    requestAnimationFrame(() => setTimeout(() => b.classList.add('is-in'), 1400));
  }
  document.dispatchEvent(new CustomEvent('kit:listo', { detail: ctx }));
  return ctx;
}
