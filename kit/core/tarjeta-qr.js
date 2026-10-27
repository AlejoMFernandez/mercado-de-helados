// Tarjetas con el QR de la carta, listas para imprimir, con la identidad del cliente (cliente.json → marca).
// Un solo dibujante en <canvas> para la vista previa del panel y para exportar (JPG a 300 dpi y PDF A4),
// así lo que el dueño ve es exactamente lo que imprime.
//
//   await dibujarTarjeta(canvas, { formato: 'mesa', estilo: 'clasico', url, config, textos, pxPorMm })
//   const jpg = await jpgDe(canvas)                  // Uint8Array con 300 dpi en la cabecera
//   const pdf = pdfHoja(jpg, canvas.width, canvas.height, 'mesa', { nota })   // Uint8Array A4 con marcas de corte
import { crearQR, dibujarQR } from './qr.js';
import { contraste, textoSobre } from './theme.js';

// Medidas en mm. "hoja" = cómo se reparten en un A4 vertical (210 × 297).
export const FORMATOS = {
  mesa:    { mm: [95, 135],  hoja: { cols: 2, filas: 2, gap: 6 } },   // tarjeta de mesa / porta-menú (4 por hoja)
  tent:    { mm: [190, 125], hoja: { tent: true } },                  // cartel de mesa que se dobla al medio
  sticker: { mm: [85, 85],   hoja: { cols: 2, filas: 3, gap: 6 } },   // vidriera, caja, mostrador (6 por hoja)
};
export const ESTILOS = ['clasico', 'marca', 'minimal'];
export const DPI = 300;
export const PX_MM_IMPRESION = DPI / 25.4;

const A4 = [210, 297];

// ---------- utilidades de dibujo
const imgCache = new Map();
export function cargarImagen(url) {
  if (!url) return Promise.resolve(null);
  if (imgCache.has(url)) return imgCache.get(url);
  const p = (async () => {
    let src = url;
    // SVG sin width/height: Firefox no lo dibuja en canvas. Le ponemos tamaño desde el viewBox.
    if (/\.svg(\?|#|$)/i.test(url) || url.startsWith('data:image/svg')) {
      try {
        const txt = url.startsWith('data:') ? decodeURIComponent(url.split(',')[1]) : await (await fetch(url)).text();
        const doc = new DOMParser().parseFromString(txt, 'image/svg+xml'); const s = doc.documentElement;
        const vb = (s.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
        if (vb.length === 4 && vb[2] > 0) { const k = 1200 / vb[2]; s.setAttribute('width', 1200); s.setAttribute('height', Math.round(vb[3] * k)); }
        src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(s)], { type: 'image/svg+xml' }));
      } catch (_) { /* se intenta tal cual */ }
    }
    const img = new Image(); img.decoding = 'async';
    if (/^https?:/.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
    img.src = src;
    try { await img.decode(); return img; } catch (_) { return null; }
  })();
  imgCache.set(url, p);
  return p;
}

export async function cargarFuentes(f) {
  if (!document.fonts?.load) return;
  const pedidos = [];
  for (const fam of [f.titulos, f.texto].filter(Boolean)) for (const w of [400, 600, 700, 800]) pedidos.push(document.fonts.load(`${w} 40px ${fam}`).catch(() => {}));
  await Promise.all(pedidos);
}

export function partir(c, texto, ancho) {
  const palabras = String(texto || '').split(/\s+/).filter(Boolean);
  const lineas = []; let l = '';
  for (const p of palabras) {
    const prueba = l ? `${l} ${p}` : p;
    if (c.measureText(prueba).width <= ancho || !l) l = prueba; else { lineas.push(l); l = p; }
  }
  if (l) lineas.push(l);
  return lineas;
}
// Achica la letra hasta que el texto entre en maxLineas renglones del ancho dado.
function ajustarTexto(c, texto, { ancho, tam, min, maxLineas = 2, fuente, peso = 700, espaciado = 0 }) {
  let t = tam, lineas;
  for (; t >= min; t -= Math.max(1, t * .04)) {
    c.font = `${peso} ${t}px ${fuente}`;
    if ('letterSpacing' in c) c.letterSpacing = `${espaciado * t}px`;
    lineas = partir(c, texto, ancho);
    if (lineas.length <= maxLineas && lineas.every(x => c.measureText(x).width <= ancho)) break;
  }
  // renglones parejos: achica el ancho mientras no aparezca un renglón más (evita una palabra sola abajo)
  if (lineas.length > 1 && lineas.length <= maxLineas) {
    let lo = ancho * .5, hi = ancho;
    for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (partir(c, texto, mid).length > lineas.length) lo = mid; else hi = mid; }
    lineas = partir(c, texto, hi);
  }
  return { tam: Math.max(t, min), lineas: lineas.slice(0, maxLineas), alto: Math.max(t, min) * 1.08 * Math.min(lineas.length, maxLineas) };
}
function escribir(c, b, x, y, { color, alinear = 'center', interlineado = 1.08 }) {
  c.fillStyle = color; c.textAlign = alinear; c.textBaseline = 'top';
  b.lineas.forEach((l, i) => c.fillText(l, x, y + i * b.tam * interlineado));
}
export function caja(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else c.rect(x, y, w, h); }

// ---------- paleta para la tarjeta
export function paletaTarjeta(marca = {}, estilo = 'clasico') {
  const co = { fondo: '#ffffff', superficie: '#ffffff', texto: '#151515', primario: '#111111', acento: '#ffcc00', ...(marca.colores || {}) };
  const oscuroLegible = (col) => contraste(col, '#ffffff') >= 4.5;
  // los módulos del QR siempre oscuros sobre blanco (contraste alto = lo lee cualquier cámara)
  const qrColor = contraste(co.texto, '#ffffff') >= 7 ? co.texto : '#111111';
  const qrOjos = oscuroLegible(co.primario) ? co.primario : qrColor;
  if (estilo === 'marca') {
    const sobre = co.sobrePrimario || textoSobre(co.primario);
    return { fondo: co.primario, texto: sobre, suave: sobre, acento: co.acento, sobreAcento: co.sobreAcento || textoSobre(co.acento), marco: sobre, banda: null, sobreBanda: sobre, qrColor, qrOjos, sombra: co.texto };
  }
  if (estilo === 'minimal') {
    return { fondo: '#ffffff', texto: co.texto, suave: co.texto, acento: co.primario, sobreAcento: co.sobrePrimario || textoSobre(co.primario), marco: co.texto, banda: null, sobreBanda: co.texto, qrColor, qrOjos, sombra: null };
  }
  return { fondo: co.fondo, texto: co.texto, suave: co.texto, acento: co.acento, sobreAcento: co.sobreAcento || textoSobre(co.acento), marco: co.primario, banda: co.primario, sobreBanda: co.sobrePrimario || textoSobre(co.primario), qrColor, qrOjos, sombra: co.texto };
}

// ---------- la tarjeta
// textos: { kicker, titulo, sub, pie }  ·  config: el cliente.json ya cargado  ·  asset(p): ruta → URL
export async function dibujarTarjeta(canvas, { formato = 'mesa', estilo = 'clasico', url, config, textos = {}, asset = (p) => p, pxPorMm = 4 }) {
  const F = FORMATOS[formato] || FORMATOS.mesa;
  const [mmW, mmH] = F.mm;
  const W = Math.round(mmW * pxPorMm), H = Math.round(mmH * pxPorMm);
  canvas.width = W; canvas.height = H;
  const marca = config.marca || {};
  const fu = { titulos: marca.fuentes?.titulos || 'Georgia, serif', texto: marca.fuentes?.texto || 'system-ui, sans-serif' };
  const mayus = marca.estilo?.mayusculas !== false;
  const forma = marca.estilo?.forma || 'redondeada';
  const dura = (marca.estilo?.sombra || 'suave') === 'dura';
  const P = paletaTarjeta(marca, estilo);
  const [logo, iso] = await Promise.all([
    cargarImagen(asset(estilo === 'marca' ? (marca.logoClaro || marca.logo) : marca.logo)),
    cargarImagen(asset(marca.isotipo)),
    cargarFuentes(fu),
  ]);
  const c = canvas.getContext('2d');
  c.imageSmoothingQuality = 'high';
  const u = Math.min(W, H) / 100;                 // unidad relativa al lado corto
  const rad = forma === 'recta' ? 0 : forma === 'pildora' ? 5 * u : 3.2 * u;

  // fondo
  c.fillStyle = P.fondo; c.fillRect(0, 0, W, H);
  if (estilo === 'marca') {
    // dos círculos de acento, suaves, en esquinas opuestas: le da textura sin competir con el QR
    c.save(); c.globalAlpha = .16; c.fillStyle = P.acento;
    c.beginPath(); c.arc(W * .98, H * .02, Math.max(W, H) * .32, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(W * .02, H * 1.02, Math.max(W, H) * .24, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  if (estilo === 'minimal') { c.strokeStyle = P.marco; c.lineWidth = .5 * u; const m = 3 * u; caja(c, m, m, W - 2 * m, H - 2 * m, rad * .8); c.stroke(); }

  const kicker = (textos.kicker ?? '').trim();
  const titulo = (textos.titulo ?? '').trim();
  const sub = (textos.sub ?? '').trim();
  const pie = (textos.pie ?? '').trim();
  const casoT = (s) => (mayus ? s.toLocaleUpperCase() : s);

  // QR (nivel H si va isotipo en el centro)
  const q = crearQR(url, { nivel: iso ? 'H' : 'Q' });

  const pintarQR = (x, y, lado) => {
    const pad = lado * .06;
    // sombra
    if (P.sombra && dura && estilo !== 'minimal') { c.fillStyle = P.sombra; caja(c, x + 1.3 * u, y + 1.3 * u, lado, lado, rad); c.fill(); }
    if (P.sombra && !dura && estilo !== 'minimal') { c.save(); c.shadowColor = 'rgba(0,0,0,.22)'; c.shadowBlur = 4 * u; c.shadowOffsetY = 1.2 * u; c.fillStyle = '#fff'; caja(c, x, y, lado, lado, rad); c.fill(); c.restore(); }
    c.fillStyle = '#ffffff'; caja(c, x, y, lado, lado, rad); c.fill();
    if (estilo === 'clasico') { c.lineWidth = .7 * u; c.strokeStyle = P.marco; caja(c, x + .35 * u, y + .35 * u, lado - .7 * u, lado - .7 * u, Math.max(0, rad - .35 * u)); c.stroke(); }
    const lq = lado - 2 * pad;
    const r = dibujarQR(c, q, { x: x + pad, y: y + pad, lado: lq, color: P.qrColor, colorOjos: P.qrOjos, fondo: null, margen: 2, ojos: forma === 'recta' ? 'cuadrados' : 'redondeados', hueco: iso ? .22 : 0 });
    if (iso && r.hueco) {
      const hs = r.hueco * .9, hx = x + lado / 2 - hs / 2, hy = y + lado / 2 - hs / 2;
      c.fillStyle = '#ffffff'; caja(c, hx, hy, hs, hs, hs * .2); c.fill();
      const k = Math.min(hs * .82 / iso.width, hs * .82 / iso.height);
      c.drawImage(iso, x + lado / 2 - iso.width * k / 2, y + lado / 2 - iso.height * k / 2, iso.width * k, iso.height * k);
    }
  };
  const pintarLogo = (cx, y, maxW, maxH) => {
    if (!logo) {
      const b = ajustarTexto(c, casoT(config.nombre || ''), { ancho: maxW, tam: maxH * .7, min: maxH * .35, maxLineas: 1, fuente: fu.titulos });
      escribir(c, b, cx, y + (maxH - b.alto) / 2, { color: P.texto });
      return maxH;
    }
    const k = Math.min(maxW / logo.width, maxH / logo.height);
    const w = logo.width * k, h = logo.height * k;
    if (estilo === 'marca' && !marca.logoClaro) {
      // logo oscuro sobre color de marca: va sobre una placa clara
      const px = 3.2 * u, py = 2.2 * u;
      c.fillStyle = (marca.colores?.superficie) || '#ffffff'; caja(c, cx - w / 2 - px, y - py, w + 2 * px, h + 2 * py, forma === 'recta' ? 0 : Math.min(rad * 1.4, (h + 2 * py) / 2)); c.fill();
    }
    c.drawImage(logo, cx - w / 2, y, w, h);
    return h;
  };
  const pintarKicker = (cx, y, alinear = 'center') => {
    if (!kicker) return 0;
    c.font = `800 ${3.1 * u}px ${fu.texto}`; if ('letterSpacing' in c) c.letterSpacing = `${.5 * u}px`;
    const txt = kicker.toLocaleUpperCase(); const w = c.measureText(txt).width + 5 * u, h = 6 * u;
    const x0 = alinear === 'center' ? cx - w / 2 : cx;
    c.fillStyle = P.acento; caja(c, x0, y, w, h, h / 2); c.fill();
    c.fillStyle = P.sobreAcento; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, x0 + w / 2 + .25 * u, y + h / 2 + .15 * u);
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    return h;
  };

  if (formato === 'tent') {
    // apaisado: QR a la izquierda, textos a la derecha
    const m = 8 * u, banda = estilo === 'clasico' ? 11 * u : 0, reserva = banda || (pie ? 6 * u : 0);
    const lado = H - 2 * m - reserva;
    pintarQR(m, m, lado);
    const x0 = m + lado + 8 * u, ancho = W - x0 - m, cx = x0 + ancho / 2;
    const tit = ajustarTexto(c, casoT(titulo), { ancho, tam: 13 * u, min: 6 * u, maxLineas: 2, fuente: fu.titulos });
    c.font = `500 ${4.4 * u}px ${fu.texto}`;
    const sb = sub ? ajustarTexto(c, sub, { ancho: ancho * .92, tam: 4.6 * u, min: 3.4 * u, maxLineas: 3, fuente: fu.texto, peso: 500 }) : null;
    const hLogo = 17 * u;
    const total = hLogo + 5 * u + (kicker ? 6 * u + 4 * u : 0) + tit.alto + (sb ? 4 * u + sb.alto : 0);
    let y = m + (lado - total) / 2;
    pintarLogo(cx, y, ancho * .7, hLogo); y += hLogo + 5 * u;
    if (kicker) { pintarKicker(cx, y); y += 6 * u + 4 * u; }
    ajustarTexto(c, casoT(titulo), { ancho, tam: tit.tam, min: tit.tam, maxLineas: 2, fuente: fu.titulos });
    escribir(c, tit, cx, y, { color: P.texto }); y += tit.alto;
    if (sb) { y += 4 * u; ajustarTexto(c, sub, { ancho: ancho * .92, tam: sb.tam, min: sb.tam, maxLineas: 3, fuente: fu.texto, peso: 500 }); c.globalAlpha = .82; escribir(c, sb, cx, y, { color: P.suave, interlineado: 1.25 }); c.globalAlpha = 1; }
    pintarPie(c, { W, H, u, banda, pie, P, fu, estilo });
    return { W, H, qr: q };
  }

  // vertical o cuadrado: todo apilado y centrado; el QR se lleva el espacio que sobra
  const cuadrado = formato === 'sticker';
  const m = (cuadrado ? 7 : 8) * u, banda = estilo === 'clasico' ? (cuadrado ? 10 : 11) * u : 0, reserva = banda || (pie ? 7 * u : 0);
  const ancho = W - 2 * m, cx = W / 2;
  const hLogo = (cuadrado ? 11 : 15) * u;
  // el título prefiere un solo renglón (deja más lugar al QR); si no entra ni achicado, pasa a dos
  let tit = ajustarTexto(c, casoT(titulo), { ancho, tam: (cuadrado ? 8 : 10.5) * u, min: (cuadrado ? 5 : 7.2) * u, maxLineas: 1, fuente: fu.titulos });
  if (!cuadrado && c.measureText(casoT(titulo)).width > ancho) tit = ajustarTexto(c, casoT(titulo), { ancho, tam: 10.5 * u, min: 5 * u, maxLineas: 2, fuente: fu.titulos });
  const sb = sub && !cuadrado ? ajustarTexto(c, sub, { ancho: ancho * .9, tam: 4 * u, min: 3.2 * u, maxLineas: 2, fuente: fu.texto, peso: 500 }) : null;
  const usaKicker = kicker && !cuadrado;
  const gap = (cuadrado ? 3.6 : 4.4) * u;
  const fijo = hLogo + gap + (usaKicker ? 6 * u + gap * .8 : 0) + tit.alto + gap + (sb ? gap + sb.alto : 0);
  const disponible = H - 2 * m - reserva - fijo;
  const lado = Math.max(40 * u, Math.min(disponible, ancho * (cuadrado ? .62 : .78)));
  const total = fijo + lado;
  let y = m + Math.max(0, (H - 2 * m - reserva - total) / 2);
  pintarLogo(cx, y, ancho * .72, hLogo); y += hLogo + gap;
  if (usaKicker) { pintarKicker(cx, y); y += 6 * u + gap * .8; }
  c.font = `700 ${tit.tam}px ${fu.titulos}`; if ('letterSpacing' in c) c.letterSpacing = '0px';
  escribir(c, tit, cx, y, { color: P.texto }); y += tit.alto + gap;
  pintarQR(cx - lado / 2, y, lado); y += lado;
  if (sb) { y += gap; ajustarTexto(c, sub, { ancho: ancho * .9, tam: sb.tam, min: sb.tam, maxLineas: 2, fuente: fu.texto, peso: 500 }); c.globalAlpha = .82; escribir(c, sb, cx, y, { color: P.suave, interlineado: 1.25 }); c.globalAlpha = 1; }
  pintarPie(c, { W, H, u, banda, pie, P, fu, estilo });
  return { W, H, qr: q };
}

function pintarPie(c, { W, H, u, banda, pie, P, fu, estilo }) {
  if (!pie) return;
  if (banda) { c.fillStyle = P.banda; c.fillRect(0, H - banda, W, banda); }
  const alto = banda || 9 * u;
  const b = ajustarTexto(c, pie, { ancho: W - 12 * u, tam: 3.6 * u, min: 2.6 * u, maxLineas: 1, fuente: fu.texto, peso: 700, espaciado: .04 });
  c.globalAlpha = estilo === 'clasico' ? 1 : .85;
  escribir(c, b, W / 2, H - alto + (alto - b.tam) / 2 + (banda ? 0 : -2 * u), { color: banda ? P.sobreBanda : P.texto });
  c.globalAlpha = 1;
  if ('letterSpacing' in c) c.letterSpacing = '0px';
}

// ---------- exportar
const blobDe = (canvas, tipo, calidad) => new Promise((ok, mal) => canvas.toBlob(b => (b ? ok(b) : mal(new Error('canvas vacío'))), tipo, calidad));

// JPG con 300 dpi escritos en la cabecera JFIF: se imprime en su tamaño real.
export async function jpgDe(canvas, calidad = .95) {
  const bytes = new Uint8Array(await (await blobDe(canvas, 'image/jpeg', calidad)).arrayBuffer());
  if (bytes[2] === 0xFF && bytes[3] === 0xE0 && String.fromCharCode(...bytes.slice(6, 10)) === 'JFIF') {
    bytes[13] = 1; bytes[14] = DPI >> 8; bytes[15] = DPI & 255; bytes[16] = DPI >> 8; bytes[17] = DPI & 255;
  }
  return bytes;
}

// PDF A4 mínimo (sin librerías): la tarjeta como imagen JPEG repetida en la hoja + marcas de corte vectoriales.
const PT = 72 / 25.4;
export function ubicaciones(formato) {
  const F = FORMATOS[formato] || FORMATOS.mesa; const [w, h] = F.mm;
  if (F.hoja.tent) {
    const x = (A4[0] - w) / 2, y = (A4[1] - 2 * h) / 2;
    return { w, h, piezas: [{ x, y, rot: 0 }, { x, y: y + h, rot: 180 }], doblez: y + h, bloque: { x, y, w, h: 2 * h } };
  }
  const { cols, filas, gap } = F.hoja;
  const tw = cols * w + (cols - 1) * gap, th = filas * h + (filas - 1) * gap;
  const x0 = (A4[0] - tw) / 2, y0 = (A4[1] - th) / 2;
  const piezas = [];
  for (let f = 0; f < filas; f++) for (let k = 0; k < cols; k++) piezas.push({ x: x0 + k * (w + gap), y: y0 + f * (h + gap), rot: 0 });
  return { w, h, piezas };
}

const latin1 = (s) => /^[\x20-\xFF]*$/.test(s) ? s : s.replace(/[^\x20-\xFF]/g, '');
export function pdfHoja(jpg, pxW, pxH, formato, { nota = '', titulo = 'Carta QR' } = {}) {
  const L = ubicaciones(formato);
  const n = (v) => (Math.round(v * 100) / 100).toString();
  // coordenadas PDF: origen abajo a la izquierda, en puntos
  const X = (mm) => mm * PT, Y = (mm) => (A4[1] - mm) * PT;
  let cs = '';
  for (const p of L.piezas) {
    const w = L.w * PT, h = L.h * PT, x = X(p.x), y = Y(p.y + L.h);
    cs += p.rot === 180 ? `q -${n(w)} 0 0 -${n(h)} ${n(x + w)} ${n(y + h)} cm /Im0 Do Q\n` : `q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm /Im0 Do Q\n`;
  }
  // marcas de corte: fuera de cada pieza, 1.5 mm de separación, 3.5 mm de largo
  cs += '0 0 0 RG 0.35 w\n';
  const marcas = (x, y, w, h) => {
    const s = 1.5, l = 3.5;
    for (const [cx, cy, dx, dy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]]) {
      cs += `${n(X(cx + dx * s))} ${n(Y(cy))} m ${n(X(cx + dx * (s + l)))} ${n(Y(cy))} l S\n`;
      cs += `${n(X(cx))} ${n(Y(cy + dy * s))} m ${n(X(cx))} ${n(Y(cy + dy * (s + l)))} l S\n`;
    }
  };
  if (L.bloque) {
    marcas(L.bloque.x, L.bloque.y, L.bloque.w, L.bloque.h);
    // línea de doblez punteada, en el margen (afuera del diseño) para no ensuciar la tarjeta
    cs += `[2 2] 0 d ${n(X(L.bloque.x - 8))} ${n(Y(L.doblez))} m ${n(X(L.bloque.x - 1.5))} ${n(Y(L.doblez))} l S\n`;
    cs += `${n(X(L.bloque.x + L.bloque.w + 1.5))} ${n(Y(L.doblez))} m ${n(X(L.bloque.x + L.bloque.w + 8))} ${n(Y(L.doblez))} l S [] 0 d\n`;
  } else L.piezas.forEach(p => marcas(p.x, p.y, L.w, L.h));
  const txt = latin1(nota).replace(/[()\\]/g, '\\$&');
  if (txt) cs += `BT /F1 7 Tf 0.35 0.35 0.35 rg ${n(X(L.piezas[0].x + 6))} ${n(3.6 * PT)} Td (${txt}) Tj ET\n`;

  return armarPDF([{ mm: A4, contenido: cs, imagen: { bytes: jpg, w: pxW, h: pxH } }], { titulo });
}

// PDF mínimo de varias páginas. paginas: [{ mm: [w, h], contenido: 'operadores PDF', imagen: { bytes, w, h } }]
// Cada página tiene su imagen JPEG como /Im0 y la fuente Helvetica como /F1.
export function armarPDF(paginas, { titulo = 'Carta' } = {}) {
  const n = (v) => (Math.round(v * 100) / 100).toString();
  const partes = []; const offs = []; let largo = 0;
  const agregar = (x) => { const b = typeof x === 'string' ? latin1Bytes(x) : x; partes.push(b); largo += b.length; };
  const obj = (i, cuerpo, stream) => {
    offs[i] = largo;
    agregar(`${i} 0 obj\n${cuerpo}\n`);
    if (stream) { agregar('stream\n'); agregar(stream); agregar('\nendstream\n'); }
    agregar('endobj\n');
  };
  agregar('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  // 1 catálogo · 2 páginas · 3 fuente · 4 info · después, por página: página, contenido, imagen
  const kids = paginas.map((_, i) => `${5 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, `<< /Title (${latin1(titulo).replace(/[()\\]/g, '\\$&')}) /Producer (kit-demos) >>`);
  paginas.forEach((pg, i) => {
    const id = 5 + i * 3; const cont = latin1Bytes(pg.contenido);
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pg.mm[0] * PT)} ${n(pg.mm[1] * PT)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    obj(id + 1, `<< /Length ${cont.length} >>`, cont);
    const im = pg.imagen;
    obj(id + 2, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`, im.bytes);
  });
  const total = 5 + paginas.length * 3;
  const xref = largo;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  agregar(x + `trailer\n<< /Size ${total} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(largo); let k = 0; partes.forEach(p => { out.set(p, k); k += p.length; });
  return out;
}

// Una imagen por página, a sangre (la carta completa).
export function pdfPaginas(imagenes, mm = A4, { titulo } = {}) {
  const n = (v) => (Math.round(v * 100) / 100).toString();
  return armarPDF(imagenes.map(im => ({ mm, imagen: im, contenido: `q ${n(mm[0] * PT)} 0 0 ${n(mm[1] * PT)} 0 0 cm /Im0 Do Q\n` })), { titulo });
}
function latin1Bytes(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }

export function descargar(bytesOBlob, nombre, tipo) {
  const blob = bytesOBlob instanceof Blob ? bytesOBlob : new Blob([bytesOBlob], { type: tipo });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
