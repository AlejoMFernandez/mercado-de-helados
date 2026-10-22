// Popups del kit: siempre cerrables (X, click afuera, Escape), con animación de entrada y salida.
import { h, esc } from './util.js';
import { t } from './i18n.js';

const abiertos = [];
let lastFocus = null;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && abiertos.length) { e.preventDefault(); abiertos[abiertos.length - 1].close(); }
});

/**
 * Abre un popup.
 * @param {object} o
 * @param {string} o.titulo
 * @param {HTMLElement|string} o.contenido
 * @param {'modal'|'drawer'} [o.tipo] drawer = panel lateral en desktop / hoja inferior en mobile
 * @param {Function} [o.onClose]
 */
export function popup({ titulo = '', contenido, tipo = 'modal', clase = '', onClose } = {}) {
  lastFocus = document.activeElement;
  const el = h(`
    <div class="kit-root kit-pop kit-pop--${tipo} ${clase}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="kit-pop__back" data-close></div>
      <div class="kit-pop__box" tabindex="-1">
        <div class="kit-pop__head">
          <h2 class="kit-pop__title">${esc(titulo)}</h2>
          <button type="button" class="kit-x" data-close aria-label="${esc(t('cerrar'))}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="kit-pop__body"></div>
      </div>
    </div>`);
  const body = el.querySelector('.kit-pop__body');
  if (typeof contenido === 'string') body.innerHTML = contenido; else if (contenido) body.appendChild(contenido);
  let cerrado = false;
  const api = {
    el, body,
    setTitle(s) { el.querySelector('.kit-pop__title').textContent = s; el.setAttribute('aria-label', s); },
    close() {
      if (cerrado) return; cerrado = true;
      el.classList.remove('is-open'); el.classList.add('is-closing');
      const i = abiertos.indexOf(api); if (i >= 0) abiertos.splice(i, 1);
      if (!abiertos.length) document.documentElement.classList.remove('kit-lock');
      setTimeout(() => el.remove(), 260);
      onClose && onClose();
      if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (_) { /* nada */ }
    },
  };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api.close(); });
  document.body.appendChild(el);
  document.documentElement.classList.add('kit-lock');
  abiertos.push(api);
  requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('is-open'); el.querySelector('.kit-pop__box').focus({ preventScroll: true }); }));
  return api;
}

export function confirmar(mensaje, { ok = t('confirmar'), peligro = false } = {}) {
  return new Promise((resolve) => {
    let r = false;
    const box = h(`<div class="kit-confirm"><p>${esc(mensaje)}</p>
      <div class="kit-row kit-row--end"><button type="button" class="kit-btn kit-btn--ghost" data-no>${esc(t('cancelar'))}</button>
      <button type="button" class="kit-btn ${peligro ? 'kit-btn--danger' : ''}" data-si>${esc(ok)}</button></div></div>`);
    const p = popup({ titulo: '', contenido: box, clase: 'kit-pop--sm', onClose: () => resolve(r) });
    box.querySelector('[data-no]').onclick = () => p.close();
    box.querySelector('[data-si]').onclick = () => { r = true; p.close(); };
    setTimeout(() => box.querySelector('[data-si]').focus(), 60);
  });
}

let toastWrap;
export function toast(msg, tipo = 'ok', ms = 2600) {
  if (!toastWrap) { toastWrap = h('<div class="kit-root kit-toasts" aria-live="polite"></div>'); document.body.appendChild(toastWrap); }
  const el = h(`<div class="kit-toast kit-toast--${tipo}">${esc(msg)}</div>`);
  toastWrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 300); }, ms);
}

// Copia texto al portapapeles (con plan B para navegadores viejos).
export async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch (_) {
    const ta = document.createElement('textarea'); ta.value = texto; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove(); return ok;
  }
}
