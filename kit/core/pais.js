// País → moneda, formato y defaults de Mercado Pago.
export const PAISES = {
  AR: { moneda: 'ARS', simbolo: '$', locale: 'es-AR', decimales: 0, idioma: 'es', tz: 'America/Argentina/Buenos_Aires', prefijoTel: '54' },
  BR: { moneda: 'BRL', simbolo: 'R$', locale: 'pt-BR', decimales: 2, idioma: 'pt-BR', tz: 'America/Sao_Paulo', prefijoTel: '55' },
};

export function pais(code) { return PAISES[code] || PAISES.AR; }

export function crearFormatoMoneda(code) {
  const p = pais(code);
  const f = new Intl.NumberFormat(p.locale, {
    style: 'currency', currency: p.moneda,
    minimumFractionDigits: p.decimales, maximumFractionDigits: p.decimales,
  });
  return (n) => (n == null || n === '' || isNaN(n)) ? null : f.format(Number(n));
}
