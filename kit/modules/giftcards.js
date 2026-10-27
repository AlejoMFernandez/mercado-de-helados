// Módulo GIFT CARDS (público). Necesita "giftcards" en cliente.json y el carrito activo.
//
// <div data-kit="giftcard"></div>   formulario listo: monto, para, de, mensaje → suma al carrito
// La demo puede armar su propio diseño y llamar a kit.giftcards.agregar({ monto, para, de, mensaje }, { origen }).
// Al volver del pago aprobado se dispara "kit:giftcards" con los códigos (preventDefault() para dibujarlos a mano).
import { esc, h, $$ } from '../core/util.js';
import { t } from '../core/i18n.js';
import { configGiftcards, montoValido } from '../core/giftcards.js';

export function initGiftcards(ctx) {
  const GC = configGiftcards(ctx.config);
  if (!GC || !ctx.carrito) return null;
  const montos = (GC.montos || []).map(Number);
  const libre = GC.min != null || GC.max != null;

  function form() {
    const st = { monto: montos[0] || null, para: '', de: '', mensaje: '' };
    const el = h(`<form class="kit-root kit-gcform" novalidate>
      <div class="kit-resv__block"><span class="kit-label">${esc(t('gcMonto'))}</span>
        <div class="kit-chips kit-chips--grid" role="radiogroup">${montos.map(m => `<button type="button" role="radio" class="kit-chip${m === st.monto ? ' is-on' : ''}" aria-checked="${m === st.monto}" data-monto="${m}">${esc(ctx.money(m))}</button>`).join('')}</div>
        ${libre ? `<label class="kit-field"><span>${esc(t('gcOtroMonto'))}</span><input name="monto" type="number" inputmode="numeric" min="${GC.min ?? 1}" ${GC.max != null ? `max="${GC.max}"` : ''}></label>` : ''}
      </div>
      <div class="kit-resv__datos">
        <label class="kit-field"><span>${esc(t('gcParaLabel'))}</span><input name="para" maxlength="60" autocomplete="off"></label>
        <label class="kit-field"><span>${esc(t('gcDeLabel'))}</span><input name="de" maxlength="60" autocomplete="name"></label>
        <label class="kit-field kit-field--full"><span>${esc(t('gcMensaje'))}</span><textarea name="mensaje" rows="2" maxlength="200"></textarea></label>
      </div>
      <p class="kit-hint">${esc(t('gcValidez', { n: GC.validezDias }))}</p>
      <p class="kit-msg" role="alert" hidden></p>
      <button class="kit-btn kit-btn--block kit-btn--big">${esc(t('gcSumar'))}</button>
    </form>`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-monto]'); if (!b) return;
      st.monto = Number(b.dataset.monto);
      $$('[data-monto]', el).forEach(x => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', on); });
      if (el.monto) el.monto.value = '';
    });
    el.addEventListener('input', (e) => {
      const f = e.target; if (!f.name) return;
      if (f.name === 'monto') { st.monto = f.value ? Number(f.value) : (montos[0] || null); $$('[data-monto]', el).forEach(x => { x.classList.remove('is-on'); x.setAttribute('aria-checked', 'false'); }); return; }
      st[f.name] = f.value;
    });
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = el.querySelector('.kit-msg');
      if (!montoValido(GC, st.monto)) { msg.textContent = t('gcMontoInvalido'); msg.hidden = false; return; }
      msg.hidden = true;
      agregar(st, { origen: el.querySelector('[type=submit]') });
      ctx.carrito.abrir();
    });
    return el;
  }

  function agregar(gc, o = {}) { return ctx.carrito.agregarGiftcard(gc, o); }
  document.querySelectorAll('[data-kit="giftcard"]').forEach(box => { box.innerHTML = ''; box.appendChild(form()); });
  return { config: GC, agregar, form, montoValido: (m) => montoValido(GC, m) };
}
