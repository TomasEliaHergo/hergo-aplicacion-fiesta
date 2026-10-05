import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import DropZone from '../../components/DropZone.jsx';
import { Alert, Spinner } from '../../components/Feedback.jsx';
import { formatBytes, formatNumero, MAX_IMPORT_BYTES, traducirMotivo } from '../../utils.js';

const EXT = /\.(xlsx|xls|csv)$/i;

export default function Importar() {
  const [archivo, setArchivo] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null); // { mensaje, detalles }

  useEffect(() => {
    document.title = 'Importar Excel - Panel RRHH';
  }, []);

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
    } catch (err) {
      setError({ mensaje: err.message, detalles: err.detalles, codigo: err.codigo });
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Importar empleados desde Excel</h1>
      </div>

      <section className="card info">
        <h2>Cómo funciona</h2>
        <ul>
          <li>
            Se lee la <strong>primera hoja</strong> del archivo (.xlsx, .xls o .csv, hasta 4 MB). La primera fila debe
            tener los encabezados.
          </li>
          <li>
            Columnas obligatorias: <strong>documento</strong> (o DNI) y <strong>nombre</strong> (o &quot;Nombre y
            apellido&quot;). Opcionales: <strong>empresa</strong> y <strong>sector</strong>. Una columna de foto, si
            existe, se ignora: las fotos se suben en <Link to="/admin/fotos">Fotos masivas</Link>.
          </li>
          <li>
            Los empleados se identifican por documento: los nuevos se <strong>agregan</strong> y los existentes se{' '}
            <strong>actualizan</strong> (nombre, empresa, sector).
          </li>
          <li>
            <strong>La importación nunca borra empleados.</strong> Quien no esté en el archivo queda igual, con su QR y
            su foto. Los QR ya entregados siguen funcionando.
          </li>
          <li>Si un documento aparece repetido en el archivo, ninguna de esas filas se aplica.</li>
        </ul>
      </section>

      <section className="card">
        <DropZone accept=".xlsx,.xls,.csv" onFiles={elegir} disabled={subiendo}>
          <p>
            <strong>Arrastrá el archivo Excel acá</strong>
          </p>
          <p className="muted small">o elegilo desde tu computadora</p>
        </DropZone>

        {archivo && (
          <div className="file-selected">
            <span>
              <strong>{archivo.name}</strong> <span className="muted">({formatBytes(archivo.size)})</span>
            </span>
            <div className="page-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setArchivo(null)} disabled={subiendo}>
                Quitar
              </button>
              <button type="button" className="btn btn-primary" onClick={importar} disabled={subiendo}>
                {subiendo ? <Spinner label="Importando…" /> : 'Importar'}
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
                  <li key={i}>{typeof d === 'string' ? d : d.mensaje || d.motivo || d.campo || 'Error en el archivo'}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </section>

      {resultado && (
        <section className="card" aria-labelledby="titulo-resultado" aria-live="polite">
          <h2 id="titulo-resultado">Resultado de la importación</h2>
          <div className="stats">
            <div className="stat stat-ok">
              <span className="stat-label">Insertados</span>
              <span className="stat-value">{formatNumero(resultado.insertados)}</span>
            </div>
            <div className="stat stat-accent">
              <span className="stat-label">Actualizados</span>
              <span className="stat-value">{formatNumero(resultado.actualizados)}</span>
            </div>
            <div className="stat stat-muted">
              <span className="stat-label">Sin cambios</span>
              <span className="stat-value">{formatNumero(resultado.sinCambios)}</span>
            </div>
            <div className={`stat ${resultado.errores?.length ? 'stat-bad' : ''}`}>
              <span className="stat-label">Con errores</span>
              <span className="stat-value">{formatNumero(resultado.errores?.length || 0)}</span>
            </div>
          </div>

          {resultado.errores?.length > 0 ? (
            <>
              <h3>Filas no importadas</h3>
              <p className="muted small">Corregí estas filas en el Excel y volvé a importarlo; el resto no se duplica.</p>
              <div className="table-wrap">
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
        </section>
      )}
    </div>
  );
}
