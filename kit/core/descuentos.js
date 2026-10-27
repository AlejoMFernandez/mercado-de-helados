// Descuento por pagar en efectivo al retirar, según el día (y feriados).
// Puro (sin DOM): lo usan el carrito, la web (para mostrar "Hoy 20% off") y el panel.
//
// cliente.json → "pagos": { "efectivo": {
//   "porDia":   { "mar": 20, "mie": 20, "jue": 20, "vie": 20, "sab": 15, "dom": 15 },
//   "feriado":  15,                         // % en feriados (pisa el del día)
//   "feriados": ["2026-11-23", "2026-12-08"]
// } }
// Con "efectivo" configurado, la salida "whatsapp" del checkout pasa a ser "En efectivo al retirar".
import { ahoraEn, DIAS, diaSemana } from './turnos.js';

export const tieneEfectivo = (config) => !!config?.pagos?.efectivo;

// % de descuento en efectivo para una fecha "YYYY-MM-DD" (por defecto, hoy en la zona del negocio).
export function descuentoEfectivo(config, fecha) {
  const e = config?.pagos?.efectivo; if (!e) return 0;
  const f = fecha || ahoraEn(config.zonaHoraria).fecha;
  if ((e.feriados || []).includes(f) && e.feriado != null) return Number(e.feriado) || 0;
  return Number((e.porDia || {})[DIAS[diaSemana(f)]]) || 0;
}

// Info para mostrar en la web: { pct, dia: 'mar', feriado: bool }
export function efectivoHoy(config) {
  const f = ahoraEn(config.zonaHoraria).fecha;
  return { pct: descuentoEfectivo(config, f), dia: DIAS[diaSemana(f)], feriado: (config?.pagos?.efectivo?.feriados || []).includes(f), fecha: f };
}
