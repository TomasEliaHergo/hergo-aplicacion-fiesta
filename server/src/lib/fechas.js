const TZ = 'America/Argentina/Buenos_Aires';

function partes(fecha) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(f.formatToParts(fecha).map((p) => [p.type, p.value]));
}

/** "19/12/2026 20:41:00" en hora Argentina. */
export function formatoAR(iso) {
  if (!iso) return '';
  const p = partes(new Date(iso));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/** "2026-12-19-2041" en hora Argentina (para nombres de archivo). */
export function sufijoArchivoAR(fecha = new Date()) {
  const p = partes(fecha);
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
}
