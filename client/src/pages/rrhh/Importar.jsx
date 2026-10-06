import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, FileSpreadsheet, Minus, RefreshCw, Upload, X } from 'lucide-react';
import { api } from '../../api.js';
import DropZone from '../../components/DropZone.jsx';
import { Card, PageHeader, StatChip } from '../../components/admin/ui.jsx';
import { Alert, Spinner } from '../../components/Feedback.jsx';
import { useDocumentTitle } from '../../hooks/hooks.js';
import { invalidate } from '../../hooks/useApi.js';
import { formatBytes, MAX_IMPORT_BYTES, traducirMotivo } from '../../utils.js';

const EXT = /\.(xlsx|xls|csv)$/i;

export default function Importar() {
  useDocumentTitle('Importar Excel - Panel RRHH');
  const [archivo, setArchivo] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null); // { mensaje, detalles }

  const elegir = ([f]) => {
    setResultado(null);
    setError(null);
    if (!EXT.test(f.name)) {
      setArchivo(null);
      setError({ mensaje: 'El archivo debe ser .xlsx, .xls o .csv.' });
      return;
    }
    if (f.size > MAX_IMPORT_BYTES) {
      setArchivo(null);
      setError({ mensaje: `El archivo pesa ${formatBytes(f.size)}; el máximo es 4 MB.` });
      return;
    }
    setArchivo(f);
  };

  const importar = async () => {
    if (!archivo) return;
    const fd = new FormData();
    fd.append('archivo', archivo);
    setSubiendo(true);
    setError(null);
    setResultado(null);
    try {
      setResultado(await api.upload('/empleados/import', fd));
      setArchivo(null);
      // Los listados, filtros y totales cambiaron.
      invalidate('emp:');
      invalidate('filtros');
      invalidate('panel');
    } catch (err) {
      setError({ mensaje: err.message, detalles: err.detalles, codigo: err.codigo });
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Importar empleados"
        description="Subí un Excel o CSV con la lista de invitados. Se agregan los nuevos y se actualizan los existentes."
      />

      <div className="split">
        <div className="split-main">
          <Card>
            <DropZone
              accept=".xlsx,.xls,.csv"
              onFiles={elegir}
              disabled={subiendo}
              title="Arrastrá el archivo acá"
              hint=".xlsx, .xls o .csv · hasta 4 MB"
            />

            {archivo && (
              <div className="file-row">
                <span className="file-icon" aria-hidden="true">
                  <FileSpreadsheet size={20} />
                </span>
                <div className="file-info">
                  <strong>{archivo.name}</strong>
                  <span className="muted small">{formatBytes(archivo.size)}</span>
                </div>
                <div className="file-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => setArchivo(null)}
                    disabled={subiendo}
                    aria-label="Quitar archivo"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn-primary" onClick={importar} disabled={subiendo}>
                    {subiendo ? <Spinner label="Importando…" /> : <Upload size={16} aria-hidden="true" />}
                    {subiendo ? 'Importando…' : 'Importar'}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <Alert>
                <p>{error.mensaje}</p>
                {error.detalles?.length > 0 && (
                  <ul>
                    {error.detalles.map((d, i) => (
                      <li key={i}>
                        {typeof d === 'string' ? d : d.mensaje || d.motivo || d.campo || 'Error en el archivo'}
                      </li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}
          </Card>

          {resultado && (
            <Card title="Resultado de la importación" aria-live="polite">
              <div className="stat-chips">
                <StatChip label="Insertados" value={resultado.insertados} tone="ok" icon={CircleCheck} />
                <StatChip label="Actualizados" value={resultado.actualizados} tone="accent" icon={RefreshCw} />
                <StatChip label="Sin cambios" value={resultado.sinCambios} tone="neutral" icon={Minus} />
                <StatChip
                  label="Con errores"
                  value={resultado.errores?.length || 0}
                  tone={resultado.errores?.length ? 'danger' : 'neutral'}
                  icon={CircleAlert}
                />
              </div>

              {resultado.errores?.length > 0 ? (
                <>
                  <p className="muted small report-hint">
                    Corregí estas filas en el Excel y volvé a importarlo: el resto no se duplica.
                  </p>
                  <div className="report-table">
                    <table className="table table-compact">
                      <thead>
                        <tr>
                          <th scope="col" className="num">
                            Fila
                          </th>
                          <th scope="col">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.errores.map((e, i) => (
                          <tr key={`${e.fila}-${i}`}>
                            <td className="num">{e.fila}</td>
                            <td>{traducirMotivo(e.motivo)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <Alert tipo="ok">Todas las filas se procesaron correctamente.</Alert>
              )}
            </Card>
          )}
        </div>

        <aside className="split-aside">
          <Card title="Cómo funciona" className="info-card">
            <ul className="info-list">
              <li>
                Se lee la <strong>primera hoja</strong>. La primera fila tiene que tener los encabezados.
              </li>
              <li>
                Obligatorias: <strong>documento</strong> (o DNI) y <strong>nombre</strong> (o “Nombre y apellido”).
                Opcionales: <strong>empresa</strong> y <strong>sector</strong>.
              </li>
              <li>
                Los empleados se identifican por documento: los nuevos se <strong>agregan</strong> y los existentes se{' '}
                <strong>actualizan</strong>.
              </li>
              <li>
                <strong>Nunca se borra a nadie.</strong> Quien no esté en el archivo queda igual, con su QR y su foto.
              </li>
              <li>Si un documento aparece repetido en el archivo, ninguna de esas filas se aplica.</li>
              <li>
                Una columna de foto se ignora: las fotos se suben en <Link to="/admin/fotos">Fotos</Link>.
              </li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
