// Horarios del local y cálculo de turnos de reserva.
// Puro (sin DOM): lo usan el sitio, el panel y las pruebas.
//
// cliente.json → "horarios": { "lun": [["11:00","23:00"]], "sab": [["12:00","15:30"],["20:00","01:00"]], "dom": [] }
// Un cierre menor a la apertura cruza la medianoche (20:00 → 01:00).
// Las reservas guardan "hora" en minutos del día de servicio: "24:30" = 00:30 del día siguiente.

export const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

export const aMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
export const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const horaVisible = (min) => aHora(((min % 1440) + 1440) % 1440);

// "2026-10-18" → número de día (para comparar sin pelear con zonas horarias)
export function diaNum(fecha) { const [y, m, d] = fecha.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); }
export function fechaDeNum(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
export function diaSemana(fecha) { return new Date(diaNum(fecha) * 864e5).getUTCDay(); }

// Fecha y minuto actuales en la zona horaria del negocio.
export function ahoraEn(tz) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  const fecha = `${p.year}-${p.month}-${p.day}`;
  return { fecha, min: (Number(p.hour) % 24) * 60 + Number(p.minute), dia: diaNum(fecha) };
}

// Franjas [inicioMin, finMin] de un día (fin puede pasar de 1440).
export function franjas(horarios, fecha) {
  const lista = (horarios && horarios[DIAS[diaSemana(fecha)]]) || [];
  return lista.map(([a, c]) => { const ini = aMin(a); let fin = aMin(c); if (fin <= ini) fin += 1440; return [ini, fin]; });
}

// ¿Está abierto ahora? Considera franjas de ayer que cruzan la medianoche.
export function estadoAbierto(horarios, tz) {
  const now = ahoraEn(tz);
  const hoy = franjas(horarios, now.fecha);
  const ayer = franjas(horarios, fechaDeNum(now.dia - 1)).map(([a, b]) => [a - 1440, b - 1440]);
  const abierta = [...ayer, ...hoy].find(([a, b]) => now.min >= a && now.min < b);
  if (abierta) return { abierto: true, cierra: horaVisible(abierta[1]) };
  const prox = hoy.find(([a]) => a > now.min);
  return { abierto: false, abre: prox ? horaVisible(prox[0]) : null };
}

const DEF = { intervaloMin: 30, duracionMin: 90, capacidad: 30, maxPersonas: 10, anticipacionMin: 60, diasAdelante: 21, ultimoTurnoMin: 60, cerrados: [] };
export const configReservas = (cfg) => ({ ...DEF, ...(cfg || {}) });

// Turnos de un día con lugares libres.
// ocupacion: { "21:00": 8, "24:30": 4 }  (personas por hora, sin canceladas)
export function generarTurnos({ horarios, reservas, tz }, fecha, ocupacion = {}, personas = 1) {
  const r = configReservas(reservas);
  if ((r.cerrados || []).includes(fecha)) return [];
  const now = ahoraEn(tz);
  const minAhora = (now.dia - diaNum(fecha)) * 1440 + now.min; // minuto "ahora" medido desde el inicio de ese día
  const ocup = Object.entries(ocupacion).map(([h, p]) => [aMin(h), Number(p) || 0]);
  const out = [];
  for (const [ini, fin] of franjas(horarios, fecha)) {
    for (let m = ini; m <= fin - r.ultimoTurnoMin; m += r.intervaloMin) {
      const usados = ocup.reduce((s, [hm, p]) => s + (Math.abs(hm - m) < r.duracionMin ? p : 0), 0);
      const libres = Math.max(0, r.capacidad - usados);
      const enHora = m - minAhora >= r.anticipacionMin;
      out.push({ min: m, hora: aHora(m), label: horaVisible(m), libres, disponible: enHora && libres >= personas, pasado: !enHora });
    }
  }
  return out;
}

// Próximos días reservables (abiertos y no cerrados).
export function diasReservables({ horarios, reservas, tz }) {
  const r = configReservas(reservas);
  const now = ahoraEn(tz);
  const out = [];
  for (let i = 0; i < r.diasAdelante; i++) {
    const fecha = fechaDeNum(now.dia + i);
    const abierto = franjas(horarios, fecha).length > 0 && !(r.cerrados || []).includes(fecha);
    out.push({ fecha, offset: i, abierto, dow: diaSemana(fecha) });
  }
  return out;
}
