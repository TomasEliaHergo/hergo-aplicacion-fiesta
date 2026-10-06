import { useRef, useState } from 'react';
import {
  ChevronDown,
  Download,
  Filter,
  Percent,
  RefreshCw,
  SearchX,
  Undo2,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react';
import { api } from '../../api.js';
import {
  ActionMenu,
  Card,
  EmptyState,
  ListSkeleton,
  PageHeader,
  Pagination,
  PersonCell,
  Pill,
  SearchInput,
  Segmented,
  SelectFilter,
  Skeleton,
} from '../../components/admin/ui.jsx';
import { Alert, Spinner, useConfirm, useToast } from '../../components/Feedback.jsx';
import { useDebounced, useDocumentTitle, useMediaQuery } from '../../hooks/hooks.js';
import { invalidate, mutate, useApi } from '../../hooks/useApi.js';
import { formatFechaHora, formatHora, formatNumero, formatPorcentaje, porcentaje } from '../../utils.js';
import { empleadosKey, fetchEmpleados, fetchPanel, FILTROS_DEFAULT } from './data.js';

const REFRESH_MS = 15000;
const PAGE_SIZE = 50;

// ---------- Resumen ----------

function Barra({ valor, total, label, size = 'md' }) {
  const pct = porcentaje(valor, total);
  return (
    <div
      className={`bar bar-${size}`}
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

function Kpi({ icon: Icon, label, value, tone, children }) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
      </div>
      <span className="kpi-value tabular">{value}</span>
      {children}
    </div>
  );
}

function Kpis({ resumen }) {
  if (!resumen) {
    return (
      <div className="kpis" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kpi">
            <Skeleton w="45%" h={12} />
            <Skeleton w="60%" h={30} className="kpi-skel-value" />
          </div>
        ))}
      </div>
    );
  }
  const { total, presentes, ausentes } = resumen;
  const pct = resumen.porcentaje ?? porcentaje(presentes, total);
  return (
    <section className="kpis" aria-label="Resumen de asistencia">
      <Kpi icon={Users} label="Invitados" value={formatNumero(total)} tone="neutral" />
      <Kpi icon={UserCheck} label="Presentes" value={formatNumero(presentes)} tone="ok" />
      <Kpi icon={UserX} label="Ausentes" value={formatNumero(ausentes)} tone="muted">
        {resumen.rechazos > 0 && (
          <span className="kpi-note" title='Veces que en la puerta se marcó "No es la persona"'>
            {formatNumero(resumen.rechazos)} {resumen.rechazos === 1 ? 'rechazo' : 'rechazos'} en la puerta
          </span>
        )}
      </Kpi>
      <Kpi icon={Percent} label="Asistencia" value={formatPorcentaje(pct)} tone="accent">
        <Barra valor={presentes} total={total} label="Porcentaje de asistencia" />
      </Kpi>
    </section>
  );
}

function PorEmpresa({ porEmpresa, onFiltrar }) {
  const [abiertas, setAbiertas] = useState(() => new Set());
  if (!porEmpresa) {
    return (
      <Card title="Por empresa">
        <div className="breakdown">
          {[0, 1, 2].map((i) => (
            <div key={i} className="breakdown-skel">
              <Skeleton w="35%" h={13} />
              <Skeleton h={8} r={999} />
            </div>
          ))}
        </div>
      </Card>
    );
  }
  if (porEmpresa.length === 0) return null;

  const toggle = (k) =>
    setAbiertas((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <Card title="Por empresa" className="breakdown-card">
      <ul className="breakdown">
        {porEmpresa.map((e) => {
          const key = e.empresa ?? '';
          const nombre = e.empresa || 'Sin empresa';
          const abierta = abiertas.has(key);
          const panelId = `sect-${key.replace(/\W+/g, '-')}-${e.total}`;
          const pct = porcentaje(e.presentes, e.total);
          return (
            <li key={key} className={`breakdown-item ${abierta ? 'is-open' : ''}`}>
              <button
                type="button"
                className="breakdown-row"
                aria-expanded={abierta}
                aria-controls={panelId}
                onClick={() => toggle(key)}
                disabled={!e.sectores?.length}
              >
                <span className="breakdown-name">
                  {e.sectores?.length > 0 && <ChevronDown size={16} className="breakdown-chevron" aria-hidden="true" />}
                  {nombre}
                </span>
                <span className="breakdown-nums tabular">
                  <strong>{formatNumero(e.presentes)}</strong>
                  <span className="muted"> / {formatNumero(e.total)}</span>
                  <span className="breakdown-pct">{formatPorcentaje(pct)}</span>
                </span>
                <Barra valor={e.presentes} total={e.total} label={`Asistencia ${nombre}`} />
              </button>
              {abierta && e.sectores?.length > 0 && (
                <div id={panelId} className="breakdown-sectores">
                  <ul>
                    {e.sectores.map((s) => (
                      <li key={s.sector ?? ''} className="sector-row">
                        <span className="sector-name">{s.sector || 'Sin sector'}</span>
                        <Barra
                          valor={s.presentes}
                          total={s.total}
                          size="sm"
                          label={`Asistencia ${nombre}, ${s.sector || 'sin sector'}`}
                        />
                        <span className="sector-nums tabular">
                          {formatNumero(s.presentes)}/{formatNumero(s.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {e.empresa && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFiltrar(e.empresa)}>
                      <Filter size={14} aria-hidden="true" />
                      Ver {nombre} en el listado
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------- Ajuste optimista del resumen al deshacer un ingreso ----------

function restarPresente(resumen, emp) {
  if (!resumen) return resumen;
  const presentes = Math.max(0, resumen.presentes - 1);
  return {
    ...resumen,
    presentes,
    ausentes: resumen.ausentes + 1,
    porcentaje: porcentaje(presentes, resumen.total),
    porEmpresa: resumen.porEmpresa?.map((e) =>
      (e.empresa || '') !== (emp.empresa || '')
        ? e
        : {
            ...e,
            presentes: Math.max(0, e.presentes - 1),
            sectores: e.sectores?.map((s) =>
              (s.sector || '') === (emp.sector || '') ? { ...s, presentes: Math.max(0, s.presentes - 1) } : s,
            ),
          },
    ),
  };
}

// ---------- Página ----------

export default function Dashboard() {
  useDocumentTitle('Asistencia - Panel RRHH');
  const toast = useToast();
  const confirm = useConfirm();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const listaRef = useRef(null);

  const panel = useApi('panel', fetchPanel, { refreshInterval: REFRESH_MS });
  const resumen = panel.data?.resumen;
  const filtros = panel.data?.filtros || FILTROS_DEFAULT;

  const [estado, setEstado] = useState('todos'); // todos | presentes | ausentes
  const [q, setQ] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [sector, setSector] = useState('');
  const qDeb = useDebounced(q.trim(), 300);

  // La página vuelve a 1 cuando cambia cualquier filtro (sin un request extra).
  const sig = `${qDeb}|${empresa}|${sector}|${estado}`;
  const [pageState, setPageState] = useState({ sig, page: 1 });
  const page = pageState.sig === sig ? pageState.page : 1;

  const params = {
    q: qDeb,
    empresa,
    sector,
    asistio: estado === 'presentes' ? 'true' : estado === 'ausentes' ? 'false' : '',
    orden: estado === 'presentes' ? 'escaneado_at' : 'nombre',
    page,
    pageSize: PAGE_SIZE,
  };
  const listKey = empleadosKey(params);
  const lista = useApi(listKey, fetchEmpleados(params), { refreshInterval: REFRESH_MS });
  const items = lista.data?.items || [];
  const total = lista.data?.total || 0;

  const [exportando, setExportando] = useState(false);
  const hayFiltros = !!(q || empresa || sector || estado !== 'todos');

  const limpiar = () => {
    setQ('');
    setEmpresa('');
    setSector('');
    setEstado('todos');
  };

  const deshacer = async (emp) => {
    const ok = await confirm({
      titulo: 'Deshacer ingreso',
      mensaje: `¿Deshacer el ingreso de ${emp.nombre} (registrado a las ${formatHora(emp.escaneado_at)})? Va a figurar como ausente y su QR podrá volver a usarse.`,
      confirmar: 'Deshacer ingreso',
      peligro: true,
    });
    if (!ok) return;

    // UI optimista: se actualiza al instante y se revierte si falla.
    const prevLista = mutate(listKey, (d) =>
      estado === 'presentes'
        ? { ...d, items: d.items.filter((x) => x.id !== emp.id), total: Math.max(0, d.total - 1) }
        : {
            ...d,
            items: d.items.map((x) =>
              x.id === emp.id ? { ...x, asistio: false, escaneado_at: null, escaneado_por_nombre: null } : x,
            ),
          },
    );
    const prevPanel = mutate('panel', (p) => ({ ...p, resumen: restarPresente(p.resumen, emp) }));

    try {
      await api.del(`/asistencias/${emp.id}`);
      toast(`Se deshizo el ingreso de ${emp.nombre}.`);
    } catch (err) {
      if (err.status === 404) {
        toast(`${emp.nombre} no tenía ingreso registrado.`, 'error');
      } else {
        if (prevLista) mutate(listKey, prevLista);
        if (prevPanel) mutate('panel', prevPanel);
        toast(err.message, 'error');
      }
    }
    invalidate('emp:');
    invalidate('panel');
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

  const filtrarEmpresa = (e) => {
    setEmpresa(e);
    setSector('');
    listaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const actualizando = panel.isValidating || lista.isValidating;

  const menuDe = (e) =>
    e.asistio ? (
      <ActionMenu
        label={`Acciones para ${e.nombre}`}
        items={[{ label: 'Deshacer ingreso', icon: Undo2, danger: true, onSelect: () => deshacer(e) }]}
      />
    ) : null;

  const estadoPill = (e, compact = false) =>
    e.asistio ? (
      <Pill tone="ok" dot>
        {compact ? <span className="sr-only">Presente, </span> : 'Presente '}
        <span className="tabular">{formatHora(e.escaneado_at)}</span>
      </Pill>
    ) : (
      <Pill tone="neutral">Ausente</Pill>
    );

  return (
    <>
      <PageHeader
        title="Asistencia"
        description={
          <span className="live">
            <span className={`live-indicator ${panel.error ? 'is-error' : ''}`} aria-hidden="true" />
            {panel.error
              ? 'Sin conexión: mostrando los últimos datos'
              : `En vivo${resumen?.actualizadoAt ? ` · actualizado ${formatFechaHora(resumen.actualizadoAt)}` : ''}`}
          </span>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                panel.reload();
                lista.reload();
              }}
              aria-label="Actualizar ahora"
            >
              <RefreshCw size={16} className={actualizando ? 'spin' : ''} aria-hidden="true" />
              <span className="hide-sm">Actualizar</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={exportar} disabled={exportando}>
              {exportando ? <Spinner label="Exportando…" /> : <Download size={16} aria-hidden="true" />}
              Exportar Excel
            </button>
          </>
        }
      />

      {panel.error && !resumen && <Alert>{panel.error.message}</Alert>}

      <div className="dash-grid">
        <Kpis resumen={resumen} />
        <PorEmpresa porEmpresa={resumen?.porEmpresa ?? (resumen ? [] : undefined)} onFiltrar={filtrarEmpresa} />

        <Card flush className="list-card" aria-labelledby="titulo-lista">
          <div className="list-head" ref={listaRef}>
            <h2 id="titulo-lista" className="card-title">
              Invitados
              {lista.data && <span className="count-badge tabular">{formatNumero(total)}</span>}
            </h2>
          </div>
          <div className="toolbar">
            <SearchInput id="dash-q" value={q} onChange={setQ} placeholder="Nombre o documento" />
            <Segmented
              label="Filtrar por estado"
              value={estado}
              onChange={setEstado}
              options={[
                ['todos', 'Todos', resumen?.total],
                ['presentes', 'Presentes', resumen?.presentes],
                ['ausentes', 'Ausentes', resumen?.ausentes],
              ]}
            />
            <SelectFilter
              id="dash-empresa"
              label="Empresa"
              allLabel="Todas las empresas"
              value={empresa}
              onChange={setEmpresa}
              options={filtros.empresas}
            />
            <SelectFilter
              id="dash-sector"
              label="Sector"
              allLabel="Todos los sectores"
              value={sector}
              onChange={setSector}
              options={filtros.sectores}
            />
          </div>

          {lista.error && (
            <div className="list-alert">
              <Alert>
                {lista.error.message}{' '}
                <button type="button" className="btn btn-link btn-sm" onClick={lista.reload}>
                  Reintentar
                </button>
              </Alert>
            </div>
          )}

          <div className={`list-body ${lista.isStale ? 'is-stale' : ''}`} aria-busy={lista.isValidating}>
            {lista.isLoading ? (
              <ListSkeleton cards={!isDesktop} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No hay invitados que coincidan"
                action={
                  hayFiltros && (
                    <button type="button" className="btn btn-secondary" onClick={limpiar}>
                      Limpiar filtros
                    </button>
                  )
                }
              >
                {hayFiltros ? 'Probá con otro nombre o cambiá los filtros.' : 'Todavía no hay empleados cargados.'}
              </EmptyState>
            ) : isDesktop ? (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Invitado</th>
                    <th scope="col">Empresa · Sector</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Escaneado por</th>
                    <th scope="col" className="col-actions">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <PersonCell nombre={e.nombre} foto_url={e.foto_url} documento={e.documento} />
                      </td>
                      <td className="cell-org">
                        <span>{e.empresa || '—'}</span>
                        {e.sector && <span className="muted"> · {e.sector}</span>}
                      </td>
                      <td>{estadoPill(e)}</td>
                      <td className="muted">{e.escaneado_por_nombre || '—'}</td>
                      <td className="col-actions">{menuDe(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ul className="card-list">
                {items.map((e) => (
                  <li key={e.id} className="row-card">
                    <PersonCell
                      nombre={e.nombre}
                      foto_url={e.foto_url}
                      documento={e.documento}
                      extra={
                        (e.empresa || e.sector) && (
                          <span className="row-card-org">{[e.empresa, e.sector].filter(Boolean).join(' · ')}</span>
                        )
                      }
                    />
                    <div className="row-card-side">
                      {estadoPill(e, true)}
                      {menuDe(e)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={(p) => {
              setPageState({ sig, page: p });
              listaRef.current?.scrollIntoView({ block: 'start' });
            }}
          />
        </Card>
      </div>
    </>
  );
}
