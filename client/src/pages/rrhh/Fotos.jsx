import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, Images, Upload } from 'lucide-react';
import { api, CAMPO_FOTOS_BULK } from '../../api.js';
import DropZone from '../../components/DropZone.jsx';
import { Card, PageHeader, StatChip } from '../../components/admin/ui.jsx';
import { Alert, Spinner } from '../../components/Feedback.jsx';
import { useDocumentTitle } from '../../hooks/hooks.js';
import { invalidate } from '../../hooks/useApi.js';
import {
  formatBytes,
  formatNumero,
  LOTE_FOTOS_MAX_ARCHIVOS,
  LOTE_FOTOS_MAX_BYTES,
  MAX_FOTO_BYTES,
  MOTIVOS,
  porcentaje,
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
  useDocumentTitle('Fotos masivas - Panel RRHH');
  const [archivos, setArchivos] = useState([]);
  const [descartados, setDescartados] = useState([]);
  const [progreso, setProgreso] = useState(null); // { hechos, total }
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');

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
    if (subidas > 0) invalidate('emp:');
  };

  const subiendo = !!progreso;
  const pesoTotal = archivos.reduce((a, f) => a + f.size, 0);

  return (
    <>
      <PageHeader
        title="Fotos masivas"
        description="Subí muchas fotos a la vez. Cada archivo se asigna al empleado por su número de documento."
      />

      <div className="split">
        <div className="split-main">
          <Card>
            <DropZone
              accept="image/jpeg,image/png,image/webp"
              multiple
              onFiles={elegir}
              disabled={subiendo}
              title="Arrastrá las fotos acá"
              hint="JPG, PNG o WebP · hasta 4 MB cada una · podés elegir muchas"
            />

            {(archivos.length > 0 || descartados.length > 0) && (
              <div className="file-row">
                <span className="file-icon" aria-hidden="true">
                  <Images size={20} />
                </span>
                <div className="file-info">
                  <strong>
                    {formatNumero(archivos.length)} {archivos.length === 1 ? 'foto lista' : 'fotos listas'} para subir
                  </strong>
                  <span className="muted small">
                    {formatBytes(pesoTotal)}
                    {descartados.length > 0 && (
                      <span className="text-warn"> · {descartados.length} descartadas (ver detalle al subir)</span>
                    )}
                  </span>
                </div>
                <div className="file-actions">
                  <button type="button" className="btn btn-secondary" onClick={limpiar} disabled={subiendo}>
                    Limpiar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={subir}
                    disabled={subiendo || !archivos.length}
                  >
                    {subiendo ? <Spinner label="Subiendo…" /> : <Upload size={16} aria-hidden="true" />}
                    {subiendo ? 'Subiendo…' : 'Subir fotos'}
                  </button>
                </div>
              </div>
            )}

            {progreso && (
              <div className="upload-progress" aria-live="polite">
                <div
                  className="bar"
                  role="progressbar"
                  aria-label="Progreso de la carga"
                  aria-valuemin={0}
                  aria-valuemax={progreso.total}
                  aria-valuenow={progreso.hechos}
                >
                  <div className="bar-fill" style={{ width: `${porcentaje(progreso.hechos, progreso.total)}%` }} />
                </div>
                <span className="tabular small">
                  {formatNumero(progreso.hechos)} de {formatNumero(progreso.total)}
                </span>
              </div>
            )}

            <Alert>{error}</Alert>
          </Card>

          {resultado && (
            <Card title="Resultado" aria-live="polite">
              <div className="stat-chips">
                <StatChip label="Subidas" value={resultado.subidas} tone="ok" icon={CircleCheck} />
                <StatChip
                  label="Con errores"
                  value={resultado.errores.length}
                  tone={resultado.errores.length ? 'danger' : 'neutral'}
                  icon={CircleAlert}
                />
              </div>
              {resultado.errores.length > 0 ? (
                <div className="report-table">
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
                          <td className="mono cell-break">{e.archivo}</td>
                          <td>{MOTIVOS[e.motivo] ? MOTIVOS[e.motivo] : traducirMotivo(e.motivo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Alert tipo="ok">Todas las fotos se subieron correctamente.</Alert>
              )}
            </Card>
          )}
        </div>

        <aside className="split-aside">
          <Card title="Cómo nombrar los archivos" className="info-card">
            <ul className="info-list">
              <li>
                Cada archivo se llama con el <strong>número de documento</strong> del empleado: <code>30123456.jpg</code>{' '}
                o <code>30.123.456.png</code>.
              </li>
              <li>Se recortan y optimizan automáticamente.</li>
              <li>Si el empleado ya tenía foto, se reemplaza.</li>
              <li>
                Para una foto suelta usá <Link to="/admin/empleados">Empleados</Link> → menú de la fila.
              </li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
