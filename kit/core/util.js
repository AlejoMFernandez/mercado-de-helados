// Utilidades compartidas del kit (sin dependencias).

export const $ = (s, c = document) => c.querySelector(s);
export const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

export function uid(prefix = '') {
  const r = (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return prefix + r;
}

export function slug(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || uid().slice(0, 8);
}

// Escapa texto para meterlo en HTML armado con template strings.
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const clone = (o) => JSON.parse(JSON.stringify(o));

export function debounce(fn, ms = 150) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Código corto de pedido: "MG-4821"
export function codigoCorto(prefijo = 'PD') {
  return `${prefijo}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function soloDigitos(s) { return String(s || '').replace(/\D/g, ''); }

export function telValido(s) { const d = soloDigitos(s); return d.length >= 8 && d.length <= 15; }

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
