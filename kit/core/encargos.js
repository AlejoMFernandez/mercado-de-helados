// Encargos con fecha de retiro y fechas especiales (puro, sin DOM: lo usan el sitio, el panel y las pruebas).
//
// cliente.json → "pedidos": {
//   "sinPrecio": "a_confirmar",          // los productos con precio null se pueden encargar; el local confirma el precio
//   "encargo": {
//     "anticipacionHoras": 12,           // por defecto (cada categoría puede tener la suya: "anticipacionHoras": 48)
//     "diasAdelante": 14,
//     "franjas": [{ "id": "manana", "nombre": "Mañana", "desde": "07:00", "hasta": "12:00" }],
//     "cerrados": ["2026-12-25"]
//   }
// }
//
// Fechas especiales = categorías con "especial": true y su ventana:
//   { "id": "navidad", "nombre": "Navidad", "especial": true, "desde": "2026-12-01", "hasta": "2026-12-24", "avisoDias": 45, "bajada": "…" }
// - En la web se ven desde (desde − avisoDias) hasta "hasta" inclusive.
// - Sus productos solo se pueden retirar entre "desde" y "hasta".
import { ahoraEn, aMin, diaNum, fechaDeNum, diaSemana, franjas as franjasHorario } from './turnos.js';

const DEF = {
  anticipacionHoras: 0, diasAdelante: 14, cerrados: [],
  franjas: [{ id: 'manana', nombre: 'Mañana', desde: '08:00', hasta: '12:00' }, { id: 'tarde', nombre: 'Tarde', desde: '16:00', hasta: '20:00' }],
};
export const configEncargo = (cfg) => (cfg ? { ...DEF, ...cfg, franjas: (cfg.franjas && cfg.franjas.length) ? cfg.franjas : DEF.franjas } : null);

// ---------- fechas especiales
export function estadoEspecial(cat, hoy) {
  if (!cat?.especial) return null;
  if (!cat.desde || !cat.hasta) return 'borrador';
  const avisoDesde = fechaDeNum(diaNum(cat.desde) - Math.max(0, Number(cat.avisoDias) || 0));
  if (hoy > cat.hasta) return 'termino';
  if (hoy >= cat.desde) return 'en_curso';
  if (hoy >= avisoDesde) return 'aviso';
  return 'programada';
}
export const especialVisible = (cat, hoy) => ['aviso', 'en_curso'].includes(estadoEspecial(cat, hoy));
export function diasPara(fecha, hoy) { return diaNum(fecha) - diaNum(hoy); }

// Categorías que la web muestra hoy. forzar = id de una fecha especial para mostrarla igual (pitch: ?sala=pascuas).
export function categoriasVisibles(cats, hoy, forzar = null) {
  return cats.filter(c => !c.especial || (forzar ? c.id === forzar : especialVisible(c, hoy)));
}

// ---------- días y franjas de retiro
// lineas: [{ id, cant }], productos y categorías de la carta.
// Devuelve [{ fecha, dow, abierto, franjas: [{ id, nombre, desde, hasta, disponible }] }] y la anticipación usada.
export function opcionesRetiro({ horarios, encargo, tz, productos = [], categorias = [], lineas = [], ignorarVentanas = false }) {
  const E = configEncargo(encargo); if (!E) return { dias: [], horas: 0 };
  const porId = new Map(productos.map(p => [p.id, p]));
  const cats = new Map(categorias.map(c => [c.id, c]));
  let horas = Number(E.anticipacionHoras) || 0;
  let desde = null, hasta = null;
  for (const l of lineas) {
    const c = cats.get(porId.get(l.id)?.categoria);
    if (!c) continue;
    if (c.anticipacionHoras != null) horas = Math.max(horas, Number(c.anticipacionHoras) || 0);
    if (c.especial && !ignorarVentanas && c.desde && c.hasta) {
      desde = desde && desde > c.desde ? desde : c.desde;
      hasta = hasta && hasta < c.hasta ? hasta : c.hasta;
    }
  }
  const now = ahoraEn(tz);
  const minimo = now.dia * 1440 + now.min + horas * 60;
  const dias = [];
  // si hay una ventana especial que empieza más adelante, arrancar desde ahí
  const inicio = desde ? Math.max(now.dia, diaNum(desde)) : now.dia;
  for (let i = 0; i < E.diasAdelante; i++) {
    const n = inicio + i; const fecha = fechaDeNum(n);
    if (hasta && fecha > hasta) break;
    const abiertoHorario = franjasHorario(horarios, fecha);
    const cerrado = (E.cerrados || []).includes(fecha) || !abiertoHorario.length;
    const fr = E.franjas.map(f => {
      const a = aMin(f.desde), b = aMin(f.hasta);
      const solapa = abiertoHorario.some(([x, y]) => a < y && b > x);
      const limite = n * 1440 + (horas > 0 ? a : b - 30);
      return { id: f.id, nombre: f.nombre, desde: f.desde, hasta: f.hasta, disponible: !cerrado && solapa && limite >= minimo, abre: solapa };
    }).filter(f => f.abre);
    dias.push({ fecha, dow: diaSemana(fecha), abierto: !cerrado && fr.some(f => f.disponible), franjas: fr });
  }
  return { dias, horas, desde, hasta };
}

// "lunes 26/10 · Mañana (7 a 12 h)"
export function textoRetiro(r, { dias, hoy } = {}) {
  if (!r?.fecha) return '';
  const [, m, d] = r.fecha.split('-').map(Number);
  const pre = r.fecha === hoy ? 'hoy ' : dias ? dias[diaSemana(r.fecha)].toLowerCase() + ' ' : '';
  const hs = (s) => String(s || '').replace(/^0/, '').replace(/:00$/, '');
  const f = r.franja ? ` · ${r.franja.nombre} (${hs(r.franja.desde)} a ${hs(r.franja.hasta)} h)` : '';
  return `${pre}${d}/${m}${f}`;
}
