import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, Download, Images, Upload, UserX } from 'lucide-react';
import { api, CAMPO_FOTOS_BULK, downloadBlob } from '../../api.js';
import DropZone from '../../components/DropZone.jsx';
import { Card, PageHeader, StatChip } from '../../components/admin/ui.jsx';
import { Alert, Spinner } from '../../components/Feedback.jsx';
import { useDocumentTitle } from '../../hooks/hooks.js';
import { invalidate, useApi } from '../../hooks/useApi.js';
import {
  formatBytes,
  formatDocumento,
  formatNumero,
  LOTE_FOTOS_MAX_ARCHIVOS,
  LOTE_FOTOS_MAX_BYTES,
  MAX_FOTO_BYTES,
  porcentaje,
  traducirMotivo,
} from '../../utils.js';
import { fetchSinFoto } from './data.js';

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
const EXT_HEIC = /\.(heic|heif)$/i;
const KEY_SIN_FOTO = 'emp:sinfoto'; // prefijo "emp:" => se invalida junto con los listados

const VIA_LABEL = { documento: 'por documento', nombre: 'por nombre' };

/** Celda CSV para Excel (separador ";"): comillas si hace falta y sin fórmulas. */
function celdaCsv(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function descargarSinFoto(items) {
  const filas = [['nombre', 'documento', 'empresa', 'sector'], ...items.map((e) => [e.nombre, e.documento, e.empresa, e.sector])];
  const csv = filas.map((f) => f.map(celdaCsv).join(';')).join('\r\n');
  // BOM UTF-8: Excel lo abre con acentos correctos.
  downloadBlob(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }), 'empleados-sin-foto.csv');
}

export default function Fotos() {
  useDocumentTitle('Fotos masivas - Panel RRHH');
  const [archivos, setArchivos] = useState([]);
  const [descartados, setDescartados] = useState([]);
  const [progreso, setProgreso] = useState(null); // { hechos, total }
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');
  const sinFoto = useApi(KEY_SIN_FOTO, fetchSinFoto);
  const listaSinFoto = sinFoto.data || [];

  const elegir = (files) => {
    setResultado(null);
    setError('');
    const ok = [];
    const malos = [];
    for (const f of files) {
      if (EXT_HEIC.test(f.name)) malos.push({ archivo: f.name, motivo: 'FORMATO_HEIC' });
      else if (!EXT.test(f.name)) malos.push({ archivo: f.name, motivo: 'TIPO_NO_SOPORTADO' });
      else if (f.size > MAX_FOTO_BYTES) malos.push({ archivo: f.name, motivo: 'ARCHIVO_MUY_GRANDE' });
      else ok.push(f);
    }
    const heic = malos.filter((m) => m.motivo === 'FORMATO_HEIC').length;
    if (heic > 0) {
      setError(
        `${heic === 1 ? 'Un archivo es' : `${heic} archivos son`} HEIC (formato de iPhone) y no se aceptan. ` +
          'Convertilos a JPG (en el iPhone: Ajustes → Cámara → Formatos → "Más compatible") y volvé a elegirlos.',
      );
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
    setError('');
  };

  const subir = async () => {
    if (!archivos.length) return;
    setError('');
    setResultado(null);
    const asignadas = [];
    const errores = [...descartados];
    setProgreso({ hechos: 0, total: archivos.length });

    let hechos = 0;
    for (const lote of armarLotes(archivos)) {
      const fd = new FormData();
      for (const f of lote) fd.append(CAMPO_FOTOS_BULK, f, f.name);
      try {
        const r = await api.upload('/empleados/fotos', fd);
        asignadas.push(...(r?.asignadas || []));
        errores.push(...(r?.errores || []));
      } catch (err) {
        if (err.status === 401) return;
        for (const f of lote) errores.push({ archivo: f.name, motivo: err.message });
      }
      hechos += lote.length;
      setProgreso({ hechos, total: archivos.length });
    }

    // El servidor detecta repetidos dentro de cada request; entre lotes no puede: ahí la
    // foto del lote posterior reemplazó a la anterior. Se reporta la que quedó pisada.
    const porDoc = new Map();
    for (const a of asignadas) {
      const previa = porDoc.get(a.documento);
      if (previa) errores.push({ archivo: previa.archivo, motivo: `DUPLICADO_EN_LOTE (quedó ${a.archivo})` });
      porDoc.set(a.documento, a);
    }
    const vinculadas = [...porDoc.values()];

    setProgreso(null);
    setResultado({ subidas: vinculadas.length, asignadas: vinculadas, errores });
    setArchivos([]);
    setDescartados([]);
    invalidate('emp:'); // refresca listados y "Quedaron sin foto"
  };

  const subiendo = !!progreso;
  const pesoTotal = archivos.reduce((a, f) => a + f.size, 0);

  return (
    <>
      <PageHeader
        title="Fotos masivas"
        description="Subí muchas fotos a la vez. Cada archivo se asigna al empleado por su documento o por su apellido y nombre."
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
              hint="JPG, PNG o WebP · hasta 4 MB cada una · HEIC no · podés elegir muchas"
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

            <Alert className="fotos-alert">{error}</Alert>
          </Card>

          {resultado && (
            <Card title="Resultado" aria-live="polite">
              <div className="stat-chips">
                <StatChip label="Subidas" value={resultado.subidas} tone="ok" icon={CircleCheck} />
                <StatChip
                  label="No vinculadas"
                  value={resultado.errores.length}
                  tone={resultado.errores.length ? 'danger' : 'neutral'}
                  icon={CircleAlert}
                />
                <StatChip
                  label="Personas sin foto"
                  value={listaSinFoto.length}
                  tone={listaSinFoto.length ? 'warn' : 'neutral'}
                  icon={UserX}
                />
              </div>

              {resultado.errores.length > 0 ? (
                <>
                  <h3 className="result-subtitle">Fotos no vinculadas</h3>
                  <p className="muted small">
                    Renombrá estos archivos con el documento o con el apellido y nombre tal como figura en el Excel, y
                    volvé a subirlos.
                  </p>
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
                            <td>{traducirMotivo(e.motivo)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <Alert tipo="ok" className="fotos-alert">
                  Todas las fotos se vincularon correctamente.
                </Alert>
              )}

              {resultado.asignadas.length > 0 && (
                <details className="result-details">
                  <summary>Vinculadas ({formatNumero(resultado.asignadas.length)})</summary>
                  <div className="report-table">
                    <table className="table table-compact">
                      <thead>
                        <tr>
                          <th scope="col">Archivo</th>
                          <th scope="col">Empleado</th>
                          <th scope="col">Cómo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.asignadas.map((a, i) => (
                          <tr key={`${a.archivo}-${i}`}>
                            <td className="mono cell-break">{a.archivo}</td>
                            <td className="cell-break">
                              {a.nombre} <span className="muted">· {formatDocumento(a.documento)}</span>
                            </td>
                            <td className="muted">{VIA_LABEL[a.via] || a.via}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </Card>
          )}

          <Card
            title={`Quedaron sin foto${sinFoto.data ? ` (${formatNumero(listaSinFoto.length)})` : ''}`}
            actions={
              listaSinFoto.length > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => descargarSinFoto(listaSinFoto)}>
                  <Download size={16} aria-hidden="true" />
                  Descargar listado
                </button>
              )
            }
          >
            {sinFoto.error && !sinFoto.data ? (
              <Alert>No se pudo cargar el listado de empleados sin foto.</Alert>
            ) : !sinFoto.data ? (
              <Spinner label="Cargando…" />
            ) : listaSinFoto.length === 0 ? (
              <Alert tipo="ok">Todos los empleados tienen foto.</Alert>
            ) : (
              <div className="report-table">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th scope="col">Nombre</th>
                      <th scope="col">Documento</th>
                      <th scope="col" className="col-opt">
                        Empresa
                      </th>
                      <th scope="col" className="col-opt">
                        Sector
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaSinFoto.map((e) => (
                      <tr key={e.id}>
                        <td className="cell-break">{e.nombre}</td>
                        <td className="tabular">{formatDocumento(e.documento)}</td>
                        <td className="col-opt">{e.empresa || '—'}</td>
                        <td className="col-opt">{e.sector || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <aside className="split-aside">
          <Card title="Cómo nombrar los archivos" className="info-card">
            <ul className="info-list">
              <li>
                Con el <strong>número de documento</strong>: <code>30123456.jpg</code> o <code>30.123.456.png</code>.
              </li>
              <li>
                O con el <strong>apellido y nombre</strong> exactamente como en el Excel: <code>ABIUS JOAQUIN.jpg</code>.
                No importan mayúsculas, acentos ni el orden de las palabras, pero tienen que estar todas y bien escritas.
              </li>
              <li>
                Si dos empleados se llaman igual, usá el documento para esas fotos.
              </li>
              <li>
                JPG, PNG o WebP de hasta 4 MB. <strong>HEIC (iPhone) no se acepta</strong>: convertilas a JPG.
              </li>
              <li>Se recortan y optimizan automáticamente. Si el empleado ya tenía foto, se reemplaza.</li>
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
