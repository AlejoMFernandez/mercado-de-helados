// Cargador de imágenes: ninguna foto queda como un hueco gris mientras carga.
// - Mientras baja: brillo animado sobre una vista previa borrosa (LQIP) o el color de la marca.
// - Al llegar: aparece con un desenfoque que se aclara (sin saltos de diseño: el <img> ya tiene su tamaño).
// - Funciona con las fotos del HTML y con las que se agregan después (carta, galerías): las detecta solo.
//
// Uso (initKit lo llama solo; opts.imagenes = false para apagarlo):
//   initKit({ imagenes: { lqip: 'img/lqip.json' } })   // mapa { "img/p/torta.webp": "data:image/webp;base64,…" }
// El mapa se genera desde el repo del kit con: python3 scripts/lqip.py <carpeta-web>  (deja <carpeta-web>/img/lqip.json)
const HECHO = 'kitPh';

// La miniatura de 12 px se envuelve en un SVG con desenfoque (bordes opacos) para que se vea suave y no pixelada.
const borroso = (uri) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'><filter id='b' x='0' y='0' width='1' height='1' color-interpolation-filters='sRGB'><feGaussianBlur stdDeviation='.05'/><feComponentTransfer><feFuncA type='discrete' tableValues='1 1'/></feComponentTransfer></filter><image width='1' height='1' preserveAspectRatio='none' filter='url(#b)' href='${uri}'/></svg>`)}")`;

// "img/p/torta.webp" sin importar si el src viene relativo, absoluto o con ?v=
const clave = (src) => {
  try {
    const u = new URL(src, document.baseURI); const base = new URL('.', document.baseURI);
    const ruta = u.origin === base.origin && u.pathname.startsWith(base.pathname) ? u.pathname.slice(base.pathname.length) : u.pathname.replace(/^\/+/, '');
    return decodeURIComponent(ruta);
  } catch { return String(src || '').split(/[?#]/)[0].replace(/^(\.\/|\/)+/, ''); }
};

export function cargadorImagenes({ lqip = null, raiz = document.body, selector = 'img' } = {}) {
  if (!raiz || typeof MutationObserver === 'undefined') return { refrescar() {} };
  let mapa = {};

  const marcar = (img) => {
    if (img.dataset[HECHO] || img.closest('[data-kit-ph="no"]')) return;
    img.dataset[HECHO] = '1';
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
    if (img.complete && img.naturalWidth) return; // ya estaba en caché: nada que mostrar
    const prev = mapa[clave(src)];
    if (prev) img.style.setProperty('--kit-lqip', borroso(prev));
    img.classList.add('kit-ph');
    const fin = (ok) => {
      img.classList.remove('kit-ph');
      if (ok) { img.classList.add('kit-ph--ok'); setTimeout(() => img.classList.remove('kit-ph--ok'), 700); }
      img.style.removeProperty('--kit-lqip');
    };
    const listo = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => fin(true));
    img.addEventListener('load', listo, { once: true });
    img.addEventListener('error', () => fin(false), { once: true });
  };
  const recorrer = (n) => {
    if (n.nodeType !== 1) return;
    if (n.matches?.(selector)) marcar(n);
    n.querySelectorAll?.(selector).forEach(marcar);
  };

  const iniciar = () => {
    recorrer(raiz);
    new MutationObserver((ms) => ms.forEach((m) => {
      m.addedNodes.forEach(recorrer);
      if (m.type === 'attributes' && m.target.matches?.(selector)) { delete m.target.dataset[HECHO]; marcar(m.target); }
    })).observe(raiz, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  };

  if (lqip && typeof lqip === 'object') { mapa = lqip; iniciar(); }
  else if (typeof lqip === 'string') {
    iniciar(); // el brillo arranca ya; la vista previa se suma cuando llega el mapa
    fetch(lqip).then((r) => (r.ok ? r.json() : {})).then((m) => {
      mapa = m || {};
      raiz.querySelectorAll('img.kit-ph').forEach((img) => {
        const p = mapa[clave(img.getAttribute('src'))];
        if (p) img.style.setProperty('--kit-lqip', borroso(p));
      });
    }).catch(() => {});
  } else iniciar();

  return { refrescar: () => recorrer(raiz) };
}
