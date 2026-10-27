// Código QR sin dependencias ni servicios externos (modo byte, UTF-8, versiones 1–40).
// Algoritmo del estándar ISO/IEC 18004, siguiendo la implementación de referencia de Project Nayuki (MIT).
//
//   const q = crearQR('https://…/carta/', { nivel: 'H' });   // { tam, modulos: boolean[][], version, nivel }
//   qrSVG(q, { color: '#111', fondo: '#fff', margen: 4 })      // string <svg> vectorial (para imprenta)
//   dibujarQR(ctx2d, q, { x, y, lado, color, fondo, margen })  // en un <canvas>
//
// Con logo en el centro usar nivel 'H' (recupera ~30 %) y que el logo no tape más del ~22 % del ancho.

const NIVELES = { L: [0, 1], M: [1, 0], Q: [2, 3], H: [3, 2] }; // [índice de tabla, bits de formato]

const ECC_POR_BLOQUE = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const BLOQUES = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const bit = (x, i) => ((x >>> i) & 1) !== 0;

function modulosCrudos(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
  return r;
}
const codewordsDatos = (ver, e) => Math.floor(modulosCrudos(ver) / 8) - ECC_POR_BLOQUE[e][ver] * BLOQUES[e][ver];

// ---- Reed-Solomon sobre GF(256), polinomio 0x11D
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z & 0xFF;
}
function rsDivisor(grado) {
  const r = new Array(grado).fill(0); r[grado - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], raiz); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    raiz = gfMul(raiz, 0x02);
  }
  return r;
}
function rsResto(datos, div) {
  const r = div.map(() => 0);
  for (const b of datos) {
    const f = b ^ r.shift(); r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

function utf8(s) { return Array.from(new TextEncoder().encode(String(s))); }

export function crearQR(texto, { nivel = 'M', subirNivel = true, mascara = -1 } = {}) {
  const bytes = utf8(texto);
  let e = (NIVELES[nivel] || NIVELES.M)[0];
  // versión mínima que entra (modo byte: 4 bits de modo + 8/16 de largo)
  let ver = 1, bitsUsados;
  for (; ; ver++) {
    if (ver > 40) throw new Error('[qr] el texto es demasiado largo para un código QR');
    bitsUsados = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
    if (bitsUsados <= codewordsDatos(ver, e) * 8) break;
  }
  // si sobra lugar en la misma versión, más corrección de errores (se lee mejor gastado o sucio)
  if (subirNivel) for (const n of ['M', 'Q', 'H']) { const k = NIVELES[n][0]; if (k > e && bitsUsados <= codewordsDatos(ver, k) * 8) e = k; }

  // ---- bits de datos
  const bb = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); };
  push(0b0100, 4); push(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => push(b, 8));
  const cap = codewordsDatos(ver, e) * 8;
  push(0, Math.min(4, cap - bb.length));
  push(0, (8 - bb.length % 8) % 8);
  for (let pad = 0xEC; bb.length < cap; pad ^= 0xEC ^ 0x11) push(pad, 8);
  const datos = [];
  for (let i = 0; i < bb.length; i += 8) datos.push(bb.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // ---- bloques + corrección + intercalado
  const nB = BLOQUES[e][ver], eccLen = ECC_POR_BLOQUE[e][ver];
  const crudos = Math.floor(modulosCrudos(ver) / 8);
  const cortos = nB - crudos % nB, largoCorto = Math.floor(crudos / nB);
  const div = rsDivisor(eccLen);
  const bloques = [];
  for (let i = 0, k = 0; i < nB; i++) {
    const d = datos.slice(k, k + largoCorto - eccLen + (i < cortos ? 0 : 1)); k += d.length;
    const ecc = rsResto(d, div);
    if (i < cortos) d.push(0);
    bloques.push(d.concat(ecc));
  }
  const final = [];
  for (let i = 0; i < bloques[0].length; i++) bloques.forEach((b, j) => { if (i !== largoCorto - eccLen || j >= cortos) final.push(b[i]); });

  // ---- matriz
  const tam = ver * 4 + 17;
  const mod = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const fun = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const setF = (x, y, v) => { mod[y][x] = v; fun[y][x] = true; };

  for (let i = 0; i < tam; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  const buscador = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < tam && y >= 0 && y < tam) setF(x, y, d !== 2 && d !== 4);
    }
  };
  buscador(3, 3); buscador(tam - 4, 3); buscador(3, tam - 4);
  const al = posicionesAlineacion(ver, tam);
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const formato = (m) => {
    const d = (NIVELES[['L', 'M', 'Q', 'H'][e]][1] << 3) | m;
    let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i));
    setF(8, 7, bit(b, 6)); setF(8, 8, bit(b, 7)); setF(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setF(tam - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setF(8, tam - 15 + i, bit(b, i));
    setF(8, tam - 8, true);
  };
  formato(0);
  if (ver >= 7) {
    let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) { const a = tam - 11 + i % 3, c = Math.floor(i / 3); setF(a, c, bit(b, i)); setF(c, a, bit(b, i)); }
  }

  // codewords en zigzag
  let i = 0;
  for (let der = tam - 1; der >= 1; der -= 2) {
    if (der === 6) der = 5;
    for (let v = 0; v < tam; v++) for (let j = 0; j < 2; j++) {
      const x = der - j, sube = ((der + 1) & 2) === 0, y = sube ? tam - 1 - v : v;
      if (!fun[y][x] && i < final.length * 8) { mod[y][x] = bit(final[i >>> 3], 7 - (i & 7)); i++; }
    }
  }

  const aplicar = (m) => {
    for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
      if (fun[y][x]) continue;
      let inv;
      switch (m) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
        case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
        default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
      }
      if (inv) mod[y][x] = !mod[y][x];
    }
  };
  let elegida = mascara;
  if (elegida < 0) {
    let mejor = Infinity;
    for (let m = 0; m < 8; m++) {
      aplicar(m); formato(m);
      const p = penalidad(mod, tam);
      if (p < mejor) { mejor = p; elegida = m; }
      aplicar(m); // XOR otra vez = deshacer
    }
  }
  aplicar(elegida); formato(elegida);
  return { tam, modulos: mod, version: ver, nivel: ['L', 'M', 'Q', 'H'][e], mascara: elegida };
}

function posicionesAlineacion(ver, tam) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const paso = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const r = [6];
  for (let p = tam - 7; r.length < n; p -= paso) r.splice(1, 0, p);
  return r;
}

// Penalidad del estándar (N1 rachas, N2 bloques 2×2, N3 patrones tipo buscador, N4 proporción de oscuros)
function penalidad(m, tam) {
  let p = 0, oscuros = 0;
  const linea = (get) => {
    let pen = 0, run = 1;
    for (let i = 1; i <= tam; i++) {
      if (i < tam && get(i) === get(i - 1)) run++;
      else { if (run >= 5) pen += 3 + (run - 5); run = 1; }
    }
    // 1:1:3:1:1 con 4 claros a un lado
    const s = Array.from({ length: tam }, (_, i) => (get(i) ? 1 : 0)).join('');
    for (const pat of ['10111010000', '00001011101']) { let k = s.indexOf(pat); while (k >= 0) { pen += 40; k = s.indexOf(pat, k + 1); } }
    return pen;
  };
  for (let y = 0; y < tam; y++) p += linea(i => m[y][i]);
  for (let x = 0; x < tam; x++) p += linea(i => m[i][x]);
  for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
    if (m[y][x]) oscuros++;
    if (x < tam - 1 && y < tam - 1) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
  }
  const total = tam * tam;
  p += (Math.ceil(Math.abs(oscuros * 20 - total * 10) / total) - 1) * 10;
  return p;
}

// ¿El módulo (x, y) es parte de un "ojo" (buscador 7×7)? Para dibujarlos con estilo propio.
export const esOjo = (q, x, y) => (x < 7 && y < 7) || (x >= q.tam - 7 && y < 7) || (x < 7 && y >= q.tam - 7);

// SVG vectorial (un solo <path>): ideal para mandar a una imprenta o un diseñador.
export function qrSVG(q, { color = '#111111', fondo = '#ffffff', margen = 4, lado = null } = {}) {
  const n = q.tam + margen * 2;
  let d = '';
  for (let y = 0; y < q.tam; y++) for (let x = 0; x < q.tam; x++) if (q.modulos[y][x]) d += `M${x + margen} ${y + margen}h1v1h-1z`;
  const tamAttr = lado ? ` width="${lado}" height="${lado}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${tamAttr} shape-rendering="crispEdges">${fondo ? `<rect width="${n}" height="${n}" fill="${fondo}"/>` : ''}<path d="${d}" fill="${color}"/></svg>`;
}

// Dibuja el QR en un canvas. ojos: 'cuadrados' | 'redondeados' (los ojos con esquinas suaves siguen siendo legibles).
// hueco: fracción del lado (0–0.3) que se deja libre en el centro para el logo (solo con nivel H).
export function dibujarQR(c, q, { x = 0, y = 0, lado, color = '#111111', fondo = '#ffffff', margen = 4, ojos = 'cuadrados', colorOjos = null, hueco = 0 } = {}) {
  const n = q.tam + margen * 2;
  const m = lado / n;
  if (fondo) { c.fillStyle = fondo; c.fillRect(x, y, lado, lado); }
  const h0 = hueco ? Math.floor((q.tam - Math.ceil(q.tam * hueco)) / 2) : -1, h1 = hueco ? q.tam - 1 - h0 : -2;
  c.fillStyle = color;
  // módulos de datos: se pintan por renglones para que no queden líneas finas entre cuadraditos
  for (let yy = 0; yy < q.tam; yy++) {
    let xx = 0;
    while (xx < q.tam) {
      const pinta = (k) => q.modulos[yy][k] && !esOjo(q, k, yy) && !(yy >= h0 && yy <= h1 && k >= h0 && k <= h1);
      if (!pinta(xx)) { xx++; continue; }
      let fin = xx; while (fin + 1 < q.tam && pinta(fin + 1)) fin++;
      const px = Math.round(x + (xx + margen) * m), py = Math.round(y + (yy + margen) * m);
      c.fillRect(px, py, Math.round(x + (fin + 1 + margen) * m) - px, Math.round(y + (yy + 1 + margen) * m) - py);
      xx = fin + 1;
    }
  }
  // ojos
  const r = ojos === 'redondeados';
  const rect = (rx, ry, w, h, rad) => {
    c.beginPath();
    if (rad && c.roundRect) c.roundRect(rx, ry, w, h, rad); else c.rect(rx, ry, w, h);
    c.fill();
  };
  [[0, 0], [q.tam - 7, 0], [0, q.tam - 7]].forEach(([ox, oy]) => {
    const bx = x + (ox + margen) * m, by = y + (oy + margen) * m;
    // redondeo sutil: más de ~0,7 módulo y algunos lectores dejan de reconocer los ojos (probado con OpenCV)
    c.fillStyle = colorOjos || color; rect(bx, by, 7 * m, 7 * m, r ? .7 * m : 0);
    c.fillStyle = fondo || '#ffffff'; rect(bx + m, by + m, 5 * m, 5 * m, r ? .5 * m : 0);
    c.fillStyle = colorOjos || color; rect(bx + 2 * m, by + 2 * m, 3 * m, 3 * m, r ? .35 * m : 0);
  });
  return { modulo: m, hueco: hueco ? (h1 - h0 + 1) * m : 0 };
}
