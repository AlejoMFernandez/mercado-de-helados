// CARTA COMPLETA PARA IMPRIMIR / COMPARTIR: la carta entera en hojas A4 con la identidad del cliente.
// Mismo dibujante para la vista previa del panel y para exportar (PDF de varias páginas o un JPG por página).
//
//   const hojas = await paginasCarta({ config, grupos, estilo, url, textos, opciones, money, asset, pxPorMm })
//   grupos: [{ nombre, items: [producto] }] ya filtrados (temporada, especiales, sin stock)
//   opciones: { columnas: 'auto' | 1 | 2, descripciones: true, qr: true }
//   textos: { titulo, sub, pie, qr, consultar, pagina }  ('pagina' admite {n} y {total})
import { crearQR, dibujarQR } from './qr.js';
import { contraste, textoSobre } from './theme.js';
import { cargarImagen, cargarFuentes, partir, caja } from './tarjeta-qr.js';
import { tieneVariantes } from './variantes.js';

export const HOJA = [210, 297];

function paleta(marca = {}, estilo) {
  const co = { fondo: '#ffffff', superficie: '#ffffff', texto: '#151515', primario: '#111111', acento: '#ffcc00', ...(marca.colores || {}) };
  const fondo = estilo === 'minimal' ? '#ffffff' : co.fondo;
  const acento = contraste(co.primario, fondo) >= 3 ? co.primario : co.texto;
  return {
    fondo, texto: co.texto, acento, detalle: co.acento,
    banda: estilo === 'marca' ? co.primario : null,
    sobreBanda: co.sobrePrimario || textoSobre(co.primario),
    qrColor: contraste(co.texto, '#ffffff') >= 7 ? co.texto : '#111111',
    qrOjos: contraste(co.primario, '#ffffff') >= 4.5 ? co.primario : (contraste(co.texto, '#ffffff') >= 7 ? co.texto : '#111111'),
  };
}

export async function paginasCarta(args) {
  const o = args.opciones || {};
  // automático: una columna solo si la carta entra en una hoja; si no, dos (con columnas parejas)
  if (o.columnas !== 1 && o.columnas !== 2) {
    const nItems = (args.grupos || []).reduce((a, g) => a + g.items.length, 0);
    if (nItems > 10) return armarHojas({ ...args, opciones: { ...o, columnas: 2 } });
    const una = await armarHojas({ ...args, opciones: { ...o, columnas: 1 }, soloContar: true });
    return armarHojas({ ...args, opciones: { ...o, columnas: una > 1 ? 2 : 1 } });
  }
  return armarHojas(args);
}

async function armarHojas({ config, grupos = [], estilo = 'clasico', url = '', textos = {}, opciones = {}, money = (v) => String(v), asset = (p) => p, pxPorMm = 4, soloContar = false }) {
  const marca = config.marca || {};
  const fu = { titulos: marca.fuentes?.titulos || 'Georgia, serif', texto: marca.fuentes?.texto || 'system-ui, sans-serif' };
  const mayus = marca.estilo?.mayusculas !== false;
  const casoT = (s) => (mayus ? String(s).toLocaleUpperCase() : String(s));
  const P = paleta(marca, estilo);
  const [logo] = await Promise.all([
    cargarImagen(asset(estilo === 'marca' ? (marca.logoClaro || marca.logo) : marca.logo)),
    cargarFuentes(fu),
  ]);
  const s = pxPorMm, M = (mm) => mm * s;
  const W = Math.round(HOJA[0] * s), H = Math.round(HOJA[1] * s);
  const desc = opciones.descripciones !== false;
  const conQR = opciones.qr !== false && !!url;
  const nItems = grupos.reduce((a, g) => a + g.items.length, 0);
  const cols = opciones.columnas === 1 || opciones.columnas === 2 ? opciones.columnas : (nItems > 10 ? 2 : 1);
  const mx = M(16), gap = M(12);
  const anchoUtil = cols === 1 ? Math.min(W - 2 * mx, M(132)) : W - 2 * mx;
  const colW = (anchoUtil - gap * (cols - 1)) / cols;
  const x0 = (W - anchoUtil) / 2;

  // ---------- medir (en un canvas de trabajo)
  const med = document.createElement('canvas').getContext('2d');
  const F = {
    cat: `400 ${M(7)}px ${fu.titulos}`,
    nombre: `400 ${M(4.5)}px ${fu.titulos}`,
    precio: `800 ${M(4.1)}px ${fu.texto}`,
    desc: `400 ${M(3.25)}px ${fu.texto}`,
    varN: `600 ${M(3.4)}px ${fu.texto}`,
    varP: `700 ${M(3.5)}px ${fu.texto}`,
  };
  const precioTxt = (p) => (p.precio == null ? (textos.consultar || '') : money(p.precio) || '');
  const bloques = [];
  for (const g of grupos) {
    med.font = F.cat;
    const lt = partir(med, casoT(g.nombre), colW);
    bloques.push({ tipo: 'cat', g, lineas: lt, alto: lt.length * M(7) * 1.05 + M(3.4) + M(5) });
    for (const p of g.items) {
      const vars = tieneVariantes(p) ? p.variantes.filter(v => v && v.precio != null) : [];
      const pr = vars.length ? '' : precioTxt(p);
      med.font = F.precio; const prW = pr ? med.measureText(pr).width : 0;
      med.font = F.nombre;
      const ln = partir(med, casoT(p.nombre), colW - (prW ? prW + M(5) : 0));
      med.font = F.desc;
      const ld = desc && p.descripcion ? partir(med, p.descripcion, colW - M(4)) : [];
      const alto = ln.length * M(4.5) * 1.12 + (ld.length ? M(1.4) + ld.length * M(3.25) * 1.38 : 0) + (vars.length ? M(1.6) + vars.length * M(5) : 0) + M(5.2);
      bloques.push({ tipo: 'item', p, pr, prW, ln, ld, vars, alto });
    }
  }

  // ---------- cabecera y pie
  const hdr1 = estilo === 'marca' ? M(64) : M(70);
  const hdrN = estilo === 'marca' ? M(24) : M(26);
  const pieH = conQR ? M(30) : M(16);
  const contenidoTop = (i) => (i === 0 ? hdr1 : hdrN) + M(6);
  const contenidoBot = H - pieH - M(4);

  // ---------- paginar: columnas de arriba a abajo; un título de sección nunca queda solo al pie
  function paginar(limite) {
    const paginas = [];
    let pg = null, col = 0, y = 0;
    const tope = () => contenidoTop(paginas.length - 1);
    const fondo = () => (paginas.length === 1 ? limite : contenidoBot);
    const nuevaPagina = () => { pg = { cols: Array.from({ length: cols }, () => []) }; paginas.push(pg); col = 0; y = tope(); };
    const siguienteCol = () => { if (col + 1 < cols) { col++; y = tope(); } else nuevaPagina(); };
    nuevaPagina();
    bloques.forEach((b, i) => {
      const arriba = y === tope();
      const sep = b.tipo === 'cat' && !arriba ? M(6) : 0;
      const necesita = sep + b.alto + (b.tipo === 'cat' && bloques[i + 1]?.tipo === 'item' ? bloques[i + 1].alto : 0);
      if (y + necesita > fondo() && !arriba) siguienteCol();
      const sep2 = b.tipo === 'cat' && y !== tope() ? M(6) : 0;
      pg.cols[col].push({ ...b, y: y + sep2 });
      y += sep2 + b.alto;
    });
    return paginas;
  }
  let paginas = paginar(contenidoBot);
  // dos columnas en una sola hoja: se busca el corte más parejo (las dos columnas con alturas parecidas)
  if (cols === 2 && paginas.length === 1) {
    let lo = contenidoTop(0), hi = contenidoBot;
    for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (paginar(mid).length === 1) hi = mid; else lo = mid; }
    paginas = paginar(hi);
  }

  if (soloContar) return paginas.length;

  // ---------- dibujar
  const q = conQR ? crearQR(url, { nivel: 'M' }) : null;
  const total = paginas.length;
  return paginas.map((pag, i) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'); c.imageSmoothingQuality = 'high'; c.textBaseline = 'alphabetic';
    c.fillStyle = P.fondo; c.fillRect(0, 0, W, H);
    cabecera(c, i === 0);
    pie(c, i);
    pag.cols.forEach((bs, k) => {
      const cx = x0 + k * (colW + gap);
      for (const b of bs) b.tipo === 'cat' ? dibCat(c, b, cx) : dibItem(c, b, cx);
    });
    return cv;
  });

  function logoEn(c, cx, y, maxW, maxH, sobreBanda) {
    if (!logo) {
      c.font = `400 ${maxH * .62}px ${fu.titulos}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = sobreBanda ? P.sobreBanda : P.texto; c.fillText(casoT(config.nombre || ''), cx, y + maxH / 2, maxW);
      c.textBaseline = 'alphabetic'; return maxH;
    }
    const k = Math.min(maxW / logo.width, maxH / logo.height), w = logo.width * k, h = logo.height * k;
    if (sobreBanda && !marca.logoClaro) {
      const px = M(4), py = M(2.6);
      c.fillStyle = marca.colores?.superficie || '#ffffff';
      caja(c, cx - w / 2 - px, y - py, w + 2 * px, h + 2 * py, Math.min(M(4), (h + 2 * py) / 2)); c.fill();
    }
    c.drawImage(logo, cx - w / 2, y, w, h);
    return h;
  }
  function cabecera(c, primera) {
    const cx = W / 2;
    if (estilo === 'marca') {
      const hb = primera ? hdr1 - M(2) : hdrN - M(2);
      c.fillStyle = P.banda; c.fillRect(0, 0, W, hb);
      c.save(); c.beginPath(); c.rect(0, 0, W, hb); c.clip(); c.globalAlpha = .16; c.fillStyle = P.detalle; c.beginPath(); c.arc(W * .96, -M(8), M(70), 0, Math.PI * 2); c.fill(); c.restore();
      if (!primera) { logoEn(c, cx, M(6.5), M(60), M(9), true); return; }
      const hl = logoEn(c, cx, M(10), M(84), M(20), true);
      c.fillStyle = P.sobreBanda; c.textAlign = 'center';
      c.font = `400 ${M(13)}px ${fu.titulos}`; c.fillText(casoT(textos.titulo || ''), cx, M(10) + hl + M(16), W - 2 * mx);
      if (textos.sub) { c.globalAlpha = .85; c.font = `600 ${M(3.8)}px ${fu.texto}`; c.fillText(textos.sub, cx, M(10) + hl + M(24), W - 2 * mx); c.globalAlpha = 1; }
      return;
    }
    if (!primera) {
      logoEn(c, cx, M(8), M(56), M(10), false);
      c.strokeStyle = P.texto; c.globalAlpha = .18; c.lineWidth = M(.3); c.beginPath(); c.moveTo(mx, hdrN - M(2)); c.lineTo(W - mx, hdrN - M(2)); c.stroke(); c.globalAlpha = 1;
      return;
    }
    const hl = logoEn(c, cx, M(14), M(86), M(22), false);
    c.fillStyle = P.texto; c.textAlign = 'center';
    c.font = `400 ${M(14)}px ${fu.titulos}`; c.fillText(casoT(textos.titulo || ''), cx, M(14) + hl + M(17.5), W - 2 * mx);
    let yy = M(14) + hl + M(23);
    if (textos.sub) { c.globalAlpha = .7; c.font = `600 ${M(3.8)}px ${fu.texto}`; c.fillText(textos.sub, cx, yy + M(2), W - 2 * mx); c.globalAlpha = 1; yy += M(6); }
    c.fillStyle = estilo === 'minimal' ? P.texto : P.detalle; c.fillRect(cx - M(12), Math.min(yy + M(1), hdr1 - M(4)), M(24), M(1));
  }
  function pie(c, i) {
    const yTop = H - pieH;
    c.strokeStyle = P.texto; c.globalAlpha = .2; c.lineWidth = M(.3);
    c.beginPath(); c.moveTo(mx, yTop); c.lineTo(W - mx, yTop); c.stroke(); c.globalAlpha = 1;
    let tx = mx;
    if (q) {
      const lado = M(20), qy = yTop + (pieH - lado) / 2;
      c.fillStyle = '#ffffff'; caja(c, mx, qy, lado, lado, M(1.6)); c.fill();
      dibujarQR(c, q, { x: mx, y: qy, lado, color: P.qrColor, colorOjos: P.qrOjos, fondo: null, margen: 2, ojos: 'redondeados' });
      tx = mx + lado + M(5);
    }
    const yc = yTop + pieH / 2;
    c.textAlign = 'left'; c.fillStyle = P.texto;
    const anchoTxt = W - mx - tx - M(24);
    if (q && textos.qr) {
      c.font = `700 ${M(3.5)}px ${fu.texto}`; c.fillText(textos.qr, tx, yc - (textos.pie ? M(1.2) : -M(1.2)), anchoTxt);
      if (textos.pie) { c.globalAlpha = .7; c.font = `500 ${M(3.1)}px ${fu.texto}`; c.fillText(textos.pie, tx, yc + M(4), anchoTxt); c.globalAlpha = 1; }
    } else if (textos.pie) { c.globalAlpha = .75; c.font = `600 ${M(3.2)}px ${fu.texto}`; c.fillText(textos.pie, tx, yc + M(1.1), anchoTxt); c.globalAlpha = 1; }
    if (total > 1) {
      c.textAlign = 'right'; c.globalAlpha = .6; c.font = `700 ${M(3.1)}px ${fu.texto}`;
      c.fillText(String(textos.pagina || '{n} / {total}').replace('{n}', i + 1).replace('{total}', total), W - mx, yc + M(1.1)); c.globalAlpha = 1;
    }
  }
  function dibCat(c, b, x) {
    c.fillStyle = P.acento; c.textAlign = 'left'; c.font = F.cat;
    b.lineas.forEach((l, k) => c.fillText(l, x, b.y + M(7) * .82 + k * M(7) * 1.05));
    const yl = b.y + b.lineas.length * M(7) * 1.05 + M(1.6);
    c.fillStyle = P.acento; c.fillRect(x, yl, M(14), M(.9));
    c.globalAlpha = .18; c.fillStyle = P.texto; c.fillRect(x + M(15.5), yl + M(.3), colW - M(15.5), M(.3)); c.globalAlpha = 1;
  }
  function puntos(c, xa, xb, yb) {
    if (xb - xa < M(4)) return;
    c.save(); c.globalAlpha = .35; c.fillStyle = P.texto;
    for (let xx = xa; xx < xb; xx += M(1.6)) { c.beginPath(); c.arc(xx, yb, M(.22), 0, Math.PI * 2); c.fill(); }
    c.restore();
  }
  function dibItem(c, b, x) {
    let y = b.y + M(4.5) * .82;
    c.fillStyle = P.texto; c.textAlign = 'left'; c.font = F.nombre;
    b.ln.forEach((l, k) => c.fillText(l, x, y + k * M(4.5) * 1.12));
    if (b.pr) {
      c.font = F.precio; c.textAlign = 'right'; c.fillText(b.pr, x + colW, y);
      c.font = F.nombre; const fin = x + c.measureText(b.ln[b.ln.length - 1] || '').width + M(2);
      if (b.ln.length === 1) puntos(c, fin, x + colW - b.prW - M(2), y - M(.4));
    }
    y += (b.ln.length - 1) * M(4.5) * 1.12;
    if (b.ld.length) {
      y += M(1.4) + M(3.25) * 1.05;
      c.textAlign = 'left'; c.font = F.desc; c.globalAlpha = .72; c.fillStyle = P.texto;
      b.ld.forEach((l, k) => c.fillText(l, x, y + k * M(3.25) * 1.38));
      c.globalAlpha = 1; y += (b.ld.length - 1) * M(3.25) * 1.38;
    }
    if (b.vars.length) {
      y += M(1.6);
      for (const v of b.vars) {
        y += M(5);
        c.textAlign = 'left'; c.font = F.varN; c.globalAlpha = .8; c.fillStyle = P.texto; c.fillText(v.nombre, x + M(2), y - M(.6)); c.globalAlpha = 1;
        const nw = c.measureText(v.nombre).width;
        const pr = money(v.precio) || ''; c.font = F.varP; c.textAlign = 'right'; c.fillText(pr, x + colW, y - M(.6));
        puntos(c, x + M(2) + nw + M(2), x + colW - c.measureText(pr).width - M(2), y - M(1));
      }
    }
  }
}
