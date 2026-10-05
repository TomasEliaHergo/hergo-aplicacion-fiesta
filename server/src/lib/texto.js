/** trim + colapsar espacios internos. null/undefined -> ''. */
export function normalizarTexto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/\s+/g, ' ').trim();
}

/** minúsculas + sin acentos. */
export function sinAcentos(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}
