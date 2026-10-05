import { useEffect, useState } from 'react';
import { api, CAMPO_FOTOS_BULK } from '../../api.js';
import DropZone from '../../components/DropZone.jsx';
import { Alert, Spinner } from '../../components/Feedback.jsx';
import {
  formatBytes,
  formatNumero,
  LOTE_FOTOS_MAX_ARCHIVOS,
  LOTE_FOTOS_MAX_BYTES,
  MAX_FOTO_BYTES,
  MOTIVOS,
  traducirMotivo,
} from '../../utils.js';

/**
 * Parte la lista en lotes de hasta LOTE_FOTOS_MAX_BYTES acumulados y
 * LOTE_FOTOS_MAX_ARCHIVOS archivos (límite de 4.5 MB por request en Vercel).
 * Un archivo que solo ya supera el tope de bytes (hasta MAX_FOTO_BYTES) viaja solo.
 */
function armarLotes(archivos) {
  const lotes = [];
  let actual = [];
  let bytes = 0;
  for (const f of archivos) {
    const llena = actual.length >= LOTE_FOTOS_MAX_ARCHIVOS || (actual.length > 0 && bytes + f.size > LOTE_FOTOS_MAX_BYTES);
    if (llena) {
      lotes.push(actual);
      actual = [];
      bytes = 0;
    }
    actual.push(f);
    bytes += f.size;
  }
  if (actual.length) lotes.push(actual);
  return lotes;
}
const EXT = /\.(jpe?g|png|webp)$/i;

export default function Fotos() {
  const [archivos, setArchivos] = useState([]);
  const [descartados, setDescartados] = useState([]);
  const [progreso, setProgreso] = useState(null); // { hechos, total }
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Fotos masivas - Panel RRHH';
  }, []);

  const elegir = (files) => {
    setResultado(null);
    setError('');
    const ok = [];
    const malos = [];
    for (const f of files) {
      if (!EXT.test(f.name)) malos.push({ archivo: f.name, motivo: 'TIPO_NO_SOPORTADO' });
      else if (f.size > MAX_FOTO_BYTES) malos.push({ archivo: f.name, motivo: 'ARCHIVO_MUY_GRANDE' });
      else ok.push(f);
    }
    // Sumar a la selección actual evitando repetidos por nombre.
    setArchivos((prev) => {
      const nombres = new Set(prev.map((f) => f.name));
      return [...prev, ...ok.filter((f) => !nombres.has(f.name))];
    });
    setDescartados((prev) => [...prev, ...malos]);
  };

  const limpiar = () => {
    setArchivos([]);
    setDescartados([]);
  };

  const subir = async () => {
    if (!archivos.length) return;
    setError('');
    setResultado(null);
    let subidas = 0;
    const errores = [...descartados];
    setProgreso({ hechos: 0, total: archivos.length });

    let hechos = 0;
    for (const lote of armarLotes(archivos)) {
      const fd = new FormData();
      for (const f of lote) fd.append(CAMPO_FOTOS_BULK, f, f.name);
      try {
        const r = await api.upload('/empleados/fotos', fd);
        subidas += r?.subidas || 0;
        errores.push(...(r?.errores || []));
      } catch (err) {
        if (err.status === 401) return;
        for (const f of lote) errores.push({ archivo: f.name, motivo: err.message });
      }
      hechos += lote.length;
      setProgreso({ hechos, total: archivos.length });
    }

    setProgreso(null);
    setResultado({ subidas, errores });
    setArchivos([]);
    setDescartados([]);
  };

  const subiendo = !!progreso;
  const pesoTotal = archivos.reduce((a, f) => a + f.size, 0);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Carga masiva de fotos</h1>
      </div>

      <section className="card info">
        <h2>Cómo nombrar los archivos</h2>
        <ul>
          <li>
            Cada archivo debe llamarse con el <strong>número de documento</strong> del empleado. Por ejemplo:{' '}
            <code>30123456.jpg</code> o <code>30.123.456.png</code>.
          </li>
          <li>Formatos: JPG, PNG o WebP, hasta 4 MB cada una. Se recortan y optimizan automáticamente.</li>
          <li>Si el empleado ya tenía foto, se reemplaza. Para fotos individuales usá la pantalla Empleados.</li>
        </ul>
      </section>

      <section className="card">
        <DropZone accept="image/jpeg,image/png,image/webp" multiple onFiles={elegir} disabled={subiendo}>
          <p>
            <strong>Arrastrá las fotos acá</strong>
          </p>
          <p className="muted small">Podés seleccionar muchas a la vez</p>
        </DropZone>

        {(archivos.length > 0 || descartados.length > 0) && (
          <div className="file-selected">
            <span>
              <strong>{formatNumero(archivos.length)}</strong> fotos listas para subir{' '}
              <span className="muted">({formatBytes(pesoTotal)})</span>
              {descartados.length > 0 && (
                <span className="text-warn"> · {descartados.length} descartadas (ver detalle al subir)</span>
              )}
            </span>
            <div className="page-actions">
              <button type="button" className="btn btn-secondary" onClick={limpiar} disabled={subiendo}>
                Limpiar
              </button>
              <button type="button" className="btn btn-primary" onClick={subir} disabled={subiendo || !archivos.length}>
                {subiendo ? <Spinner label="Subiendo…" /> : 'Subir fotos'}
              </button>
            </div>
          </div>
        )}

        {progreso && (
          <div className="upload-progress" aria-live="polite">
            <progress value={progreso.hechos} max={progreso.total} aria-label="Progreso de la carga" />
            <span>
              {formatNumero(progreso.hechos)} de {formatNumero(progreso.total)}
            </span>
          </div>
        )}

        <Alert>{error}</Alert>
      </section>

      {resultado && (
        <section className="card" aria-labelledby="titulo-res-fotos" aria-live="polite">
          <h2 id="titulo-res-fotos">Resultado</h2>
          <div className="stats">
            <div className="stat stat-ok">
              <span className="stat-label">Subidas</span>
              <span className="stat-value">{formatNumero(resultado.subidas)}</span>
            </div>
            <div className={`stat ${resultado.errores.length ? 'stat-bad' : ''}`}>
              <span className="stat-label">Con errores</span>
              <span className="stat-value">{formatNumero(resultado.errores.length)}</span>
            </div>
          </div>
          {resultado.errores.length > 0 ? (
            <div className="table-wrap">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th scope="col">Archivo</th>
                    <th scope="col">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.errores.map((e, i) => (
                    <tr key={`${e.archivo}-${i}`}>
                      <td className="mono">{e.archivo}</td>
                      <td>{MOTIVOS[e.motivo] ? MOTIVOS[e.motivo] : traducirMotivo(e.motivo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Alert tipo="ok">Todas las fotos se subieron correctamente.</Alert>
          )}
        </section>
      )}
    </div>
  );
}
