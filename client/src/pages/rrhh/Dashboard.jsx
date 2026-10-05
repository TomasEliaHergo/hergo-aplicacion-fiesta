import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import Avatar from '../../components/Avatar.jsx';
import Pagination from '../../components/Pagination.jsx';
import { Alert, Spinner, useConfirm, useToast } from '../../components/Feedback.jsx';
import { useDebounced, usePolling } from '../../hooks/hooks.js';
import { useFiltros } from '../../hooks/useFiltros.js';
import {
  formatDocumento,
  formatFechaHora,
  formatHora,
  formatNumero,
  formatPorcentaje,
  porcentaje,
} from '../../utils.js';

const REFRESH_MS = 15000;
const PAGE_SIZE = 50;

function Barra({ valor, total, label }) {
  const pct = porcentaje(valor, total);
  return (
    <div
      className="bar"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Resumen({ resumen }) {
  if (!resumen) return null;
  const { total, presentes, ausentes, porcentaje: pct } = resumen;
  return (
    <section aria-labelledby="titulo-resumen">
      <h2 id="titulo-resumen" className="sr-only">
        Resumen
      </h2>
      <div className="stats">
        <div className="stat">
          <span className="stat-label">Invitados</span>
          <span className="stat-value">{formatNumero(total)}</span>
        </div>
        <div className="stat stat-ok">
          <span className="stat-label">Presentes</span>
          <span className="stat-value">{formatNumero(presentes)}</span>
        </div>
        <div className="stat stat-muted">
          <span className="stat-label">Ausentes</span>
          <span className="stat-value">{formatNumero(ausentes)}</span>
        </div>
        <div className="stat stat-accent">
          <span className="stat-label">Asistencia</span>
          <span className="stat-value">{formatPorcentaje(pct)}</span>
          <Barra valor={presentes} total={total} label="Porcentaje de asistencia" />
        </div>
      </div>
    </section>
  );
}

function PorEmpresa({ porEmpresa }) {
  if (!porEmpresa?.length) return null;
  return (
    <section className="card" aria-labelledby="titulo-empresas">
      <h2 id="titulo-empresas">Por empresa y sector</h2>
      <div className="breakdown">
        {porEmpresa.map((e) => (
          <details key={e.empresa ?? '(sin empresa)'} className="breakdown-item">
            <summary>
              <span className="breakdown-name">{e.empresa || '(Sin empresa)'}</span>
              <span className="breakdown-nums">
                {formatNumero(e.presentes)} / {formatNumero(e.total)}
                <span className="muted"> · {formatPorcentaje(porcentaje(e.presentes, e.total))}</span>
              </span>
              <Barra valor={e.presentes} total={e.total} label={`Asistencia ${e.empresa || 'sin empresa'}`} />
            </summary>
            {e.sectores?.length > 0 && (
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th scope="col">Sector</th>
                    <th scope="col" className="num">
                      Presentes
                    </th>
                    <th scope="col" className="num">
                      Total
                    </th>
                    <th scope="col" className="num">
                      %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {e.sectores.map((s) => (
                    <tr key={s.sector ?? '(sin sector)'}>
                      <td>{s.sector || '(Sin sector)'}</td>
                      <td className="num">{formatNumero(s.presentes)}</td>
                      <td className="num">{formatNumero(s.total)}</td>
                      <td className="num">{formatPorcentaje(porcentaje(s.presentes, s.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        ))}
      </div>
    </section>
  );
}

export default function Dashboard() {
  const toast = useToast();
  const confirm = useConfirm();
  const [filtros] = useFiltros();

  const [resumen, setResumen] = useState(null);
  const [errorResumen, setErrorResumen] = useState('');

  const [estado, setEstado] = useState('todos'); // todos | presentes | ausentes
  const [q, setQ] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [sector, setSector] = useState('');
  const [page, setPage] = useState(1);
  const qDeb = useDebounced(q, 300);

  const [lista, setLista] = useState({ items: [], total: 0 });
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState('');
  const [exportando, setExportando] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    document.title = 'Asistencia - Panel RRHH';
  }, []);

  const cargarResumen = useCallback(async () => {
    try {
      setResumen(await api.get('/asistencias/resumen'));
      setErrorResumen('');
    } catch (err) {
      setErrorResumen(err.message);
    }
  }, []);

  const cargarLista = useCallback(
    async ({ silencioso = false } = {}) => {
      const id = ++reqId.current;
      if (!silencioso) setCargando(true);
      try {
        const data = await api.get('/empleados', {
          q: qDeb.trim(),
          empresa,
          sector,
          asistio: estado === 'presentes' ? 'true' : estado === 'ausentes' ? 'false' : '',
          orden: estado === 'presentes' ? 'escaneado_at' : 'nombre',
          page,
          pageSize: PAGE_SIZE,
        });
        if (id !== reqId.current) return;
        setLista({ items: data.items || [], total: data.total || 0 });
        setErrorLista('');
      } catch (err) {
        if (id === reqId.current) setErrorLista(err.message);
      } finally {
        if (id === reqId.current) setCargando(false);
      }
    },
    [qDeb, empresa, sector, estado, page],
  );

  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);

  useEffect(() => {
    cargarLista();
  }, [cargarLista]);

  // Volver a la página 1 al cambiar filtros.
  useEffect(() => {
    setPage(1);
  }, [qDeb, empresa, sector, estado]);

  usePolling(() => {
    cargarResumen();
    cargarLista({ silencioso: true });
  }, REFRESH_MS);

  const deshacer = async (emp) => {
    const ok = await confirm({
      titulo: 'Deshacer ingreso',
      mensaje: `¿Deshacer el ingreso de ${emp.nombre} (registrado a las ${formatHora(emp.escaneado_at)})? Va a figurar como ausente y su QR podrá volver a usarse.`,
      confirmar: 'Deshacer ingreso',
      peligro: true,
    });
    if (!ok) return;
    try {
      await api.del(`/asistencias/${emp.id}`);
      toast(`Se deshizo el ingreso de ${emp.nombre}.`);
    } catch (err) {
      toast(err.status === 404 ? `${emp.nombre} no tenía ingreso registrado.` : err.message, 'error');
    }
    cargarResumen();
    cargarLista({ silencioso: true });
  };

  const exportar = async () => {
    setExportando(true);
    try {
      await api.download('/asistencias/export', { empresa, sector }, 'asistencia.xlsx');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Asistencia</h1>
          <p className="muted small">
            Se actualiza automáticamente cada 15 segundos
            {resumen?.actualizadoAt && <> · Última actualización: {formatFechaHora(resumen.actualizadoAt)}</>}
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              cargarResumen();
              cargarLista();
            }}
          >
            Actualizar
          </button>
          <button type="button" className="btn btn-primary" onClick={exportar} disabled={exportando}>
            {exportando ? <Spinner label="Exportando…" /> : 'Exportar Excel'}
          </button>
        </div>
      </div>

      <Alert>{errorResumen}</Alert>
      <Resumen resumen={resumen} />
      <PorEmpresa porEmpresa={resumen?.porEmpresa} />

      <section className="card" aria-labelledby="titulo-lista">
        <h2 id="titulo-lista">Listado</h2>
        <div className="filters">
          <div className="segmented" role="group" aria-label="Filtrar por estado">
            {[
              ['todos', 'Todos'],
              ['presentes', 'Presentes'],
              ['ausentes', 'Ausentes'],
            ].map(([v, l]) => (
              <button
                key={v}
                type="button"
                className={estado === v ? 'is-active' : ''}
                aria-pressed={estado === v}
                onClick={() => setEstado(v)}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="field field-inline grow">
            <label htmlFor="dash-q">Buscar</label>
            <input
              id="dash-q"
              type="search"
              placeholder="Nombre o documento"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field field-inline">
            <label htmlFor="dash-empresa">Empresa</label>
            <select id="dash-empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
              <option value="">Todas</option>
              {filtros.empresas.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-inline">
            <label htmlFor="dash-sector">Sector</label>
            <select id="dash-sector" value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">Todos</option>
              {filtros.sectores.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Alert>{errorLista}</Alert>

        <div className="table-wrap" aria-busy={cargando}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Foto</span>
                </th>
                <th scope="col">Nombre</th>
                <th scope="col">Documento</th>
                <th scope="col">Empresa</th>
                <th scope="col">Sector</th>
                <th scope="col">Estado</th>
                <th scope="col">Escaneado por</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Avatar nombre={e.nombre} src={e.foto_url} size={36} />
                  </td>
                  <td className="strong">{e.nombre}</td>
                  <td className="mono">{formatDocumento(e.documento)}</td>
                  <td>{e.empresa || '—'}</td>
                  <td>{e.sector || '—'}</td>
                  <td>
                    {e.asistio ? (
                      <span className="badge badge-ok">Presente {formatHora(e.escaneado_at)}</span>
                    ) : (
                      <span className="badge badge-muted">Ausente</span>
                    )}
                  </td>
                  <td>{e.escaneado_por_nombre || '—'}</td>
                  <td className="actions">
                    {e.asistio && (
                      <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => deshacer(e)}>
                        Deshacer ingreso
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!cargando && lista.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    No hay empleados que coincidan con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {cargando && lista.items.length === 0 && (
            <div className="center pad">
              <Spinner />
            </div>
          )}
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={lista.total} onChange={setPage} />
      </section>
    </div>
  );
}
