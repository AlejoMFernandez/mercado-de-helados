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
//   reservas → cada [data-kit="reservas"] y [data-kit-open="reservas"] (con "servicios": almuerzo / cena por tandas)
//   giftcards → [data-kit="giftcard"] o kit.giftcards.agregar({ monto, para, de, mensaje }) (necesita carrito)
//   admin    → el panel vive en /admin (ver kit/admin)
import { createStore } from './store/index.js';
import { applyTheme } from './core/theme.js';
import { setLang, t } from './core/i18n.js';
import { pais, crearFormatoMoneda } from './core/pais.js';
import { estadoAbierto, ahoraEn } from './core/turnos.js';
import { efectivoHoy } from './core/descuentos.js';
import { categoriasVisibles, estadoEspecial } from './core/encargos.js';
import { h, esc } from './core/util.js';
import { cargadorImagenes } from './core/imagenes.js';
import { mountCarta } from './modules/carta.js';
import { tieneVariantes } from './core/variantes.js';
import { initCarrito } from './modules/carrito.js';
import { initReservas } from './modules/reservas.js';
import { initGiftcards } from './modules/giftcards.js';

export const VERSION = '1.8.0';

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
    abierto: (horarios = config.horarios) => estadoAbierto(horarios, config.zonaHoraria),
    // { pct, dia, feriado } del descuento en efectivo de hoy (pagos.efectivo)
    efectivoHoy: () => efectivoHoy(config),
    // ¿se puede sumar al carrito? Con "pedidos.sinPrecio": "a_confirmar" también los que no tienen precio.
    pedible: (p) => !!p && p.disponible !== false && (p.precio != null || tieneVariantes(p) || config.pedidos?.sinPrecio === 'a_confirmar'),
    hoy: () => ahoraEn(config.zonaHoraria).fecha,
    forzarEspecial: null,                                   // id de fecha especial a mostrar sí o sí (pitch: ?sala=pascuas)
    visibles(cats) { return categoriasVisibles(cats, this.hoy(), this.forzarEspecial); },
    especiales(cats) { return this.visibles(cats).filter(c => c.especial); },
    estadoEspecial(cat) { return estadoEspecial(cat, this.hoy()); },
  };
}

export async function initKit(opts = {}) {
  // loader de fotos (brillo + vista previa borrosa) en todas las demos, desde el primer momento; imagenes:false lo apaga
  const imagenes = opts.imagenes === false ? null : cargadorImagenes(opts.imagenes || {});
  const loaded = await cargarConfig(opts.config);
  const ctx = await crearContexto(loaded);
  if (opts.fechaEspecial) ctx.forzarEspecial = opts.fechaEspecial;
  const M = ctx.config.modulos;
  document.documentElement.classList.add('kit-on', `kit-${ctx.store.modo}`);
  ctx.imagenes = imagenes;

  if (M.carrito) ctx.carrito = initCarrito(ctx, opts.carrito);
  if (M.carta) ctx.cartas = Array.from(document.querySelectorAll('[data-kit="carta"]')).map(el => mountCarta(el, ctx, (opts.cartas && el.id && opts.cartas[el.id]) || opts.carta));
  if (M.reservas) ctx.reservas = initReservas(ctx);
  if (M.carrito && ctx.config.giftcards) ctx.giftcards = initGiftcards(ctx);

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
