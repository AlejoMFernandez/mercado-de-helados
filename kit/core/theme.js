// Aplica la identidad del cliente (cliente.json → marca) como variables CSS --kit-*.
// Todos los módulos y el panel leen estas variables: nada queda genérico.

function lum(hex) {
  const m = String(hex).replace('#', '');
  const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}
export function contraste(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); }
export const textoSobre = (bg) => contraste(bg, '#ffffff') >= contraste(bg, '#111111') ? '#ffffff' : '#111111';

const SOMBRAS = {
  suave: '0 10px 30px -12px rgba(0,0,0,.35)',
  dura: '4px 4px 0 var(--kit-text)',
  ninguna: 'none',
};
const RADIOS = { recta: '0px', redondeada: '14px', pildora: '999px' };

export function applyTheme(marca = {}, root = document.documentElement) {
  const c = { fondo: '#ffffff', superficie: '#ffffff', texto: '#151515', primario: '#111111', acento: '#ffcc00', borde: '', ...(marca.colores || {}) };
  const f = marca.fuentes || {};
  const e = marca.estilo || {};
  const vars = {
    '--kit-bg': c.fondo,
    '--kit-surface': c.superficie,
    '--kit-text': c.texto,
    '--kit-muted': c.suave || `color-mix(in srgb, ${c.texto} 68%, ${c.superficie})`,
    '--kit-primary': c.primario,
    '--kit-on-primary': c.sobrePrimario || textoSobre(c.primario),
    '--kit-accent': c.acento,
    '--kit-on-accent': c.sobreAcento || textoSobre(c.acento),
    '--kit-border': c.borde || `color-mix(in srgb, ${c.texto} 16%, ${c.superficie})`,
    '--kit-ok': c.ok || '#1f9d55',
    '--kit-warn': c.alerta || '#d97706',
    '--kit-danger': c.error || '#d42a1d',
    '--kit-font-head': f.titulos || 'inherit',
    '--kit-font-body': f.texto || 'inherit',
    '--kit-head-case': e.mayusculas === false ? 'none' : 'uppercase',
    '--kit-radius': RADIOS[e.forma] || e.radio || '14px',
    '--kit-radius-btn': e.forma === 'pildora' ? '999px' : (RADIOS[e.forma] || e.radio || '12px'),
    '--kit-border-w': e.borde || '1.5px',
    '--kit-shadow': SOMBRAS[e.sombra] || e.sombra || SOMBRAS.suave,
  };
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  if (f.googleFonts && !document.querySelector('link[data-kit-fonts]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.dataset.kitFonts = '';
    l.href = `https://fonts.googleapis.com/css2?family=${f.googleFonts}&display=swap`;
    document.head.appendChild(l);
  }
  return vars;
}
