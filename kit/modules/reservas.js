// Módulo RESERVAS: personas → día → hora (según horarios y capacidad de cliente.json) → datos.
// Entra al panel como "pendiente"; el dueño la confirma o cancela.
//
// <div data-kit="reservas"></div>          formulario en la página
// <button data-kit-open="reservas">        abre el formulario en un popup
import { esc, h, $$, telValido } from '../core/util.js';
import { t } from '../core/i18n.js';
import { popup } from '../core/ui.js';
import { generarTurnos, diasReservables, configReservas, serviciosDe, serviciosDelDia, tandaDe } from '../core/turnos.js';
import { linkWhatsApp } from '../core/pedidos.js';

export function crearFormReserva(ctx, { onDone, inicial = {} } = {}) {
  const { config, store } = ctx;
  const R = configReservas(config.reservas);
  const env = { horarios: config.horarios, reservas: config.reservas, tz: ctx.tz };
  const dias = diasReservables(env);
  const conServicios = !!serviciosDe(R);
  const extras = Array.isArray(R.extras) ? R.extras : [];
  const fechaIni = inicial.fecha && dias.some(d => d.abierto && d.fecha === inicial.fecha) ? inicial.fecha : (dias.find(d => d.abierto) || {}).fecha;
  const servIni = conServicios && inicial.hora ? (tandaDe(R, inicial.hora)?.servicio.id || null) : null;
  const st = { personas: Math.max(1, Math.min(Number(inicial.personas) || 2, R.maxPersonas)), fecha: fechaIni, servicio: servIni, hora: inicial.hora || null, nombre: '', telefono: '', email: '', comentario: '', extras: [] };

  const el = h(`<form class="kit-root kit-resv" novalidate>
    <div class="kit-resv__row">
      <span class="kit-label" id="kr-p">${esc(t('personas'))}</span>
      <div class="kit-step kit-step--lg" role="group" aria-labelledby="kr-p">
        <button type="button" data-p="-1" aria-label="−">−</button><output data-personas></output><button type="button" data-p="1" aria-label="+">+</button>
      </div>
    </div>
    <p class="kit-hint" data-max hidden></p>
    <div class="kit-resv__block"><span class="kit-label">${esc(t('dia'))}</span><div class="kit-chips kit-chips--scroll" data-dias role="radiogroup"></div></div>
    ${conServicios ? `<div class="kit-resv__block"><span class="kit-label" id="kr-s">${esc(t('servicio'))}</span><div class="kit-seg kit-seg--serv" data-servicios role="radiogroup" aria-labelledby="kr-s"></div></div>` : ''}
    <div class="kit-resv__block"><span class="kit-label">${esc(t('hora'))}</span><div class="${conServicios ? 'kit-tandas' : 'kit-chips kit-chips--grid'}" data-horas role="radiogroup" aria-live="polite"></div></div>
    <div class="kit-resv__datos">
      <label class="kit-field"><span>${esc(t('nombre'))}</span><input name="nombre" autocomplete="name" required></label>
      <label class="kit-field"><span>${esc(t('telefono'))}</span><input name="telefono" type="tel" inputmode="tel" autocomplete="tel" required></label>
      <label class="kit-field"><span>${esc(t('email'))}</span><input name="email" type="email" autocomplete="email"></label>
      <label class="kit-field kit-field--full"><span>${esc(t('comentario'))}</span><textarea name="comentario" rows="2" maxlength="280"></textarea></label>
      ${extras.length ? `<div class="kit-extras kit-field--full">${extras.map(x => `<label class="kit-check"><input type="checkbox" name="extra" value="${esc(x.id)}"><span>${esc(x.label || x.id)}</span></label>`).join('')}</div>` : ''}
    </div>
    <p class="kit-msg" role="alert" hidden></p>
    <button type="submit" class="kit-btn kit-btn--block kit-btn--big">${esc(t('confirmarReserva'))}</button>
  </form>`);

  let autoDia = !inicial.fecha;
  let autoServ = !servIni;
  const fmtDia = (d) => {
    const [, m, dd] = d.fecha.split('-').map(Number);
    const nombre = d.offset === 0 ? t('hoy') : d.offset === 1 ? t('manana') : t('diasCortos')[d.dow];
    return { nombre, num: `${dd} ${t('meses')[m - 1]}` };
  };

  function pintarDias() {
    el.querySelector('[data-dias]').innerHTML = dias.map(d => {
      const f = fmtDia(d);
      return `<button type="button" role="radio" class="kit-chip kit-chip--day${d.fecha === st.fecha ? ' is-on' : ''}" aria-checked="${d.fecha === st.fecha}" data-fecha="${d.fecha}" ${d.abierto ? '' : 'disabled'}>
        <b>${esc(f.nombre)}</b><small>${d.abierto ? esc(f.num) : esc(t('cerrado'))}</small></button>`;
    }).join('');
    const box = el.querySelector('[data-dias]'), on = box.querySelector('.is-on');
    if (on) box.scrollLeft = Math.max(0, on.offsetLeft - box.offsetLeft - 8);
  }

  const chipHora = (x) => `<button type="button" role="radio" class="kit-chip${x.hora === st.hora ? ' is-on' : ''}${x.disponible ? '' : ' is-full'}" aria-checked="${x.hora === st.hora}" data-hora="${x.hora}" ${x.disponible ? '' : 'disabled'}>
        ${esc(x.label)}${x.disponible && x.libres <= Math.max(4, (x.capacidad || R.capacidad) * .2) ? `<small>${esc(t('quedan', { n: x.libres }))}</small>` : ''}${x.disponible ? '' : `<small>${esc(t(x.pasado ? 'pasado' : 'lleno'))}</small>`}</button>`;

  // Servicios del día (almuerzo / cena): siempre se dibujan todos, los que no van ese día quedan apagados (nada salta de lugar).
  function pintarServicios(turnosDia) {
    const box = el.querySelector('[data-servicios]'); if (!box) return;
    const delDia = st.fecha ? serviciosDelDia(env, st.fecha).map(s => s.id) : [];
    box.innerHTML = serviciosDe(R).map(s => {
      const hay = delDia.includes(s.id) && turnosDia.some(x => x.servicio === s.id && x.disponible);
      const on = s.id === st.servicio;
      return `<label><input type="radio" name="servicio" value="${esc(s.id)}" ${on ? 'checked' : ''} ${delDia.includes(s.id) ? '' : 'disabled'}><span>${esc(s.nombre || s.id)}${delDia.includes(s.id) ? (hay ? '' : `<small>${esc(t('lleno'))}</small>`) : `<small>${esc(t('cerrado'))}</small>`}</span></label>`;
    }).join('');
  }

  async function pintarHoras() {
    const box = el.querySelector('[data-horas]');
    box.innerHTML = `<span class="kit-hint">${esc(t('cargando'))}</span>`;
    if (!st.fecha) { box.innerHTML = `<span class="kit-hint">${esc(t('sinTurnos'))}</span>`; return; }
    let ocup = {};
    try { ocup = await store.getOcupacion(st.fecha); } catch (e) { console.error('[kit] ocupación', e); }
    const todos = generarTurnos(env, st.fecha, ocup, st.personas);
    const turnosDia = conServicios ? todos : todos.filter(x => !x.pasado);
    // Al abrir: si hoy ya no quedan turnos, saltar solo al próximo día abierto.
    if (autoDia && !turnosDia.some(x => x.disponible)) {
      const sig = dias.find(d => d.abierto && d.fecha > st.fecha);
      if (sig && sig.offset < 8) { st.fecha = sig.fecha; pintarDias(); return pintarHoras(); }
    }
    autoDia = false;
    if (conServicios) {
      const delDia = serviciosDelDia(env, st.fecha).map(s => s.id);
      if (!delDia.includes(st.servicio) || (autoServ && !turnosDia.some(x => x.servicio === st.servicio && x.disponible))) {
        st.servicio = delDia.find(id => turnosDia.some(x => x.servicio === id && x.disponible)) || delDia[0] || null;
      }
      pintarServicios(turnosDia);
      const ts = turnosDia.filter(x => x.servicio === st.servicio);
      if (!ts.some(x => x.hora === st.hora && x.disponible)) st.hora = null;
      const tandas = [];
      ts.forEach(x => { let g = tandas.find(k => k.i === x.tandaIndice); if (!g) tandas.push(g = { i: x.tandaIndice, nombre: x.tanda, items: [] }); g.items.push(x); });
      box.innerHTML = ts.some(x => !x.pasado) ? tandas.map(g => `<div class="kit-tanda${g.items.every(x => !x.disponible) ? ' is-full' : ''}">
          ${g.nombre ? `<span class="kit-tanda__t">${esc(g.nombre)}${g.items[0].disponible || g.items.some(x => x.disponible) ? '' : ` · ${esc(t(g.items.every(x => x.pasado) ? 'pasado' : 'lleno'))}`}</span>` : ''}
          <div class="kit-chips kit-chips--grid">${g.items.map(chipHora).join('')}</div></div>`).join('')
        : `<span class="kit-hint">${esc(t('sinTurnos'))}</span>`;
      return;
    }
    if (!turnosDia.some(x => x.hora === st.hora && x.disponible)) st.hora = null;
    box.innerHTML = turnosDia.length ? turnosDia.map(chipHora).join('') : `<span class="kit-hint">${esc(t('sinTurnos'))}</span>`;
  }

  function pintarPersonas() {
    el.querySelector('[data-personas]').textContent = st.personas;
    el.querySelector('[data-p="-1"]').disabled = st.personas <= 1;
    el.querySelector('[data-p="1"]').disabled = st.personas >= R.maxPersonas;
    const max = el.querySelector('[data-max]');
    max.hidden = st.personas < R.maxPersonas; max.textContent = t('masPersonas', { n: R.maxPersonas });
  }

  el.addEventListener('click', (e) => {
    const p = e.target.closest('[data-p]');
    if (p) { st.personas = Math.max(1, Math.min(R.maxPersonas, st.personas + Number(p.dataset.p))); pintarPersonas(); pintarHoras(); return; }
    const d = e.target.closest('[data-fecha]');
    if (d) { autoDia = false; st.fecha = d.dataset.fecha; $$('[data-fecha]', el).forEach(b => { const on = b === d; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on); }); pintarHoras(); return; }
    const sv = e.target.closest('[data-servicios] input');
    if (sv) { autoServ = false; st.servicio = sv.value; st.hora = null; pintarHoras(); return; }
    const hr = e.target.closest('[data-hora]');
    if (hr) { st.hora = hr.dataset.hora; $$('[data-hora]', el).forEach(b => { const on = b === hr; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on); }); }
  });
  el.addEventListener('input', (e) => {
    const f = e.target; if (!f.name || f.name === 'servicio') return;
    if (f.name === 'extra') { st.extras = $$('[name="extra"]', el).filter(x => x.checked).map(x => x.value); return; }
    st[f.name] = f.value;
  });

  function error(msg) { const m = el.querySelector('.kit-msg'); m.textContent = msg; m.hidden = false; m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); }

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const faltan = [];
    if (!st.hora) faltan.push(t('hora').toLowerCase());
    if (!st.nombre.trim()) faltan.push(t('nombre').toLowerCase());
    if (!telValido(st.telefono)) faltan.push(t('telefono').toLowerCase());
    if (faltan.length) return error(t('faltan', { campos: faltan.join(', ') }));
    const btn = el.querySelector('[type=submit]'); btn.disabled = true; btn.classList.add('is-loading');
    try {
      const r = await store.createReserva({ fecha: st.fecha, hora: st.hora, personas: st.personas, nombre: st.nombre.trim(), telefono: st.telefono.trim(), email: st.email.trim(), comentario: st.comentario.trim(),
        ...(conServicios ? { servicio: st.servicio } : {}), ...(st.extras.length ? { extras: st.extras } : {}) });
      document.dispatchEvent(new CustomEvent('kit:reserva', { detail: r }));
      const d = dias.find(x => x.fecha === st.fecha); const f = fmtDia(d);
      const turno = generarTurnos(env, st.fecha, {}, 1).find(x => x.hora === st.hora);
      const resumen = { personas: `${st.personas} ${st.personas === 1 ? t('persona') : t('personasN')}`, dia: `${f.nombre} ${f.num}`, hora: turno ? turno.label : st.hora, nombre: st.nombre.trim(),
        servicio: turno?.servicioNombre || '', tanda: turno?.tanda || '', codigo: r?.id ? String(r.id).replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() : '' };
      // la demo puede dibujar su propia confirmación: escucha kit:reserva-lista y hace preventDefault()
      const ev = new CustomEvent('kit:reserva-lista', { detail: { reserva: r, resumen, el }, cancelable: true });
      if (document.dispatchEvent(ev)) mostrarListo(resumen);
      onDone && onDone(r);
    } catch (err) {
      btn.disabled = false; btn.classList.remove('is-loading');
      if (err.code === 'sin_lugar' || /sin_lugar/.test(err.message)) { error(t('sinLugar')); pintarHoras(); }
      else { console.error('[kit] reserva', err); error(t('error')); }
    }
  });

  function mostrarListo(res) {
    const { url } = linkWhatsApp(config.whatsapp, t('waReserva', { negocio: config.nombre, ...res }));
    el.innerHTML = `<div class="kit-done">
      <div class="kit-done__ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h3>${esc(t('reservaLista'))}</h3><p>${esc(t('reservaListaSub', res))}</p>
      ${url ? `<div class="kit-row kit-row--center"><a class="kit-btn" href="${esc(url)}" target="_blank" rel="noopener">${esc(t('avisarWA'))}</a></div>` : ''}
    </div>`;
  }

  pintarPersonas(); pintarDias(); pintarHoras();
  store.onChange(() => { if (el.isConnected && el.querySelector('[data-horas]')) pintarHoras(); });
  return el;
}

export function initReservas(ctx) {
  document.querySelectorAll('[data-kit="reservas"]').forEach(box => { box.innerHTML = ''; box.appendChild(crearFormReserva(ctx)); });
  // abrir({ fecha: '2026-10-27', hora: '19:00', personas: 4 }) → popup con el turno ya elegido
  const abrir = (inicial = {}) => {
    const form = crearFormReserva(ctx, { inicial });
    return popup({ titulo: t('reservarMesa'), contenido: form, clase: 'kit-pop--resv' });
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kit-open="reservas"]'); if (!b) return;
    e.preventDefault(); abrir({ fecha: b.dataset.kitFecha, hora: b.dataset.kitHora, personas: b.dataset.kitPersonas });
  });
  const env = { horarios: ctx.config.horarios, reservas: ctx.config.reservas, tz: ctx.tz };
  // Para dibujar la disponibilidad con el diseño de la demo (ej. un pizarrón de turnos).
  const dias = () => diasReservables(env);
  async function turnos(fecha, personas = 1) {
    let ocup = {};
    try { ocup = await ctx.store.getOcupacion(fecha); } catch (e) { console.error('[kit] ocupación', e); }
    return generarTurnos(env, fecha, ocup, personas).map(x => ({ ...x, capacidad: configReservas(ctx.config.reservas).capacidad }));
  }
  return { abrir, dias, turnos };
}

