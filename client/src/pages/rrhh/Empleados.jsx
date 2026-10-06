import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ImageOff, ImagePlus, Pencil, Plus, QrCode, SearchX, Trash2, UserPlus } from 'lucide-react';
import { api } from '../../api.js';
import Modal from '../../components/Modal.jsx';
import QrCard from '../../components/QrCard.jsx';
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
  SelectFilter,
} from '../../components/admin/ui.jsx';
import { Alert, useConfirm, useToast } from '../../components/Feedback.jsx';
import { useDebounced, useDocumentTitle, useMediaQuery } from '../../hooks/hooks.js';
import { invalidate, mutate, useApi } from '../../hooks/useApi.js';
import { formatDocumento, formatHora, formatNumero, MAX_FOTO_BYTES } from '../../utils.js';
import { empleadosKey, fetchEmpleados, fetchFiltros, FILTROS_DEFAULT } from './data.js';
import EmpleadoForm from './EmpleadoForm.jsx';

const PAGE_SIZE = 50;
const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];

function QrModal({ empleado, onClose }) {
  const [token, setToken] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!empleado) return undefined;
    const ctrl = new AbortController();
    setToken(null);
    setError('');
    api
      .get(`/empleados/${empleado.id}/qr`, null, { signal: ctrl.signal })
      .then((d) => setToken(d.qr_token))
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err.message);
      });
    return () => ctrl.abort();
  }, [empleado]);

  return (
    <Modal open={!!empleado} title="Código QR" onClose={onClose} size="sm">
      <Alert>{error}</Alert>
      {!token && !error && (
        <div className="qr-skel">
          <span className="skeleton" />
        </div>
      )}
      {token && empleado && <QrCard value={token} nombre={empleado.nombre} empresa={empleado.empresa} />}
    </Modal>
  );
}

export default function Empleados() {
  useDocumentTitle('Empleados - Panel RRHH');
  const toast = useToast();
  const confirm = useConfirm();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const filtrosApi = useApi('filtros', fetchFiltros);
  const filtros = filtrosApi.data || FILTROS_DEFAULT;

  const [q, setQ] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [sector, setSector] = useState('');
  const qDeb = useDebounced(q.trim(), 300);
  const sig = `${qDeb}|${empresa}|${sector}`;
  const [pageState, setPageState] = useState({ sig, page: 1 });
  const page = pageState.sig === sig ? pageState.page : 1;

  const params = { q: qDeb, empresa, sector, orden: 'nombre', page, pageSize: PAGE_SIZE };
  const listKey = empleadosKey(params);
  const lista = useApi(listKey, fetchEmpleados(params));
  const items = lista.data?.items || [];
  const total = lista.data?.total || 0;
  const hayFiltros = !!(q || empresa || sector);

  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState(null);
  const [qrDe, setQrDe] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(null); // id del empleado
  const fileRef = useRef(null);
  const fotoTarget = useRef(null);
  const topRef = useRef(null);

  const reemplazarItem = (emp) =>
    mutate(listKey, (l) => ({ ...l, items: l.items.map((x) => (x.id === emp.id ? { ...x, ...emp } : x)) }));

  const abrirNuevo = () => {
    setEditando(null);
    setFormOpen(true);
  };

  const abrirEditar = (emp) => {
    setEditando(emp);
    setFormOpen(true);
  };

  const onSaved = (emp, esNuevo) => {
    setFormOpen(false);
    toast(esNuevo ? `Se creó a ${emp.nombre}.` : `Se guardaron los cambios de ${emp.nombre}.`);
    if (!esNuevo) reemplazarItem(emp);
    invalidate('emp:');
    invalidate('filtros');
    invalidate('panel');
  };

  const eliminar = async (emp) => {
    const ok = await confirm({
      titulo: 'Eliminar empleado',
      mensaje: `¿Eliminar a ${emp.nombre} (${formatDocumento(emp.documento)})? Se borran también su foto y su registro de asistencia. Su QR deja de funcionar. Esta acción no se puede deshacer.`,
      confirmar: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    try {
      await api.del(`/empleados/${emp.id}`);
      mutate(listKey, (l) => ({ ...l, items: l.items.filter((x) => x.id !== emp.id), total: Math.max(0, l.total - 1) }));
      toast(`Se eliminó a ${emp.nombre}.`);
    } catch (err) {
      toast(err.message, 'error');
    }
    invalidate('emp:');
    invalidate('panel');
  };

  const elegirFoto = (emp) => {
    fotoTarget.current = emp;
    fileRef.current?.click();
  };

  const subirFoto = async (file) => {
    const emp = fotoTarget.current;
    if (!file || !emp) return;
    if (!TIPOS_FOTO.includes(file.type)) {
      toast('La foto debe ser JPG, PNG o WebP.', 'error');
      return;
    }
    if (file.size > MAX_FOTO_BYTES) {
      toast('La foto supera los 4 MB.', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('foto', file);
    setSubiendoFoto(emp.id);
    try {
      const actualizado = await api.upload(`/empleados/${emp.id}/foto`, fd);
      reemplazarItem(actualizado);
      invalidate('emp:');
      toast(`Foto de ${emp.nombre} actualizada.`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSubiendoFoto(null);
    }
  };

  const quitarFoto = async (emp) => {
    const ok = await confirm({
      titulo: 'Quitar foto',
      mensaje: `¿Quitar la foto de ${emp.nombre}?`,
      confirmar: 'Quitar foto',
      peligro: true,
    });
    if (!ok) return;
    try {
      await api.del(`/empleados/${emp.id}/foto`);
      reemplazarItem({ id: emp.id, foto_url: null });
      invalidate('emp:');
      toast(`Se quitó la foto de ${emp.nombre}.`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const menuDe = (e) => (
    <ActionMenu
      label={`Acciones para ${e.nombre}`}
      items={[
        { label: 'Editar datos', icon: Pencil, onSelect: () => abrirEditar(e) },
        { label: 'Ver QR', icon: QrCode, onSelect: () => setQrDe(e) },
        {
          label: e.foto_url ? 'Cambiar foto' : 'Subir foto',
          icon: ImagePlus,
          onSelect: () => elegirFoto(e),
          disabled: subiendoFoto === e.id,
        },
        e.foto_url && { label: 'Quitar foto', icon: ImageOff, onSelect: () => quitarFoto(e) },
        { label: 'Eliminar', icon: Trash2, danger: true, separator: true, onSelect: () => eliminar(e) },
      ]}
    />
  );

  const ingresoPill = (e) =>
    e.asistio ? (
      <Pill tone="ok" dot>
        <span className="tabular">{formatHora(e.escaneado_at)}</span>
      </Pill>
    ) : (
      <Pill tone="neutral">Sin ingreso</Pill>
    );

  return (
    <>
      <PageHeader
        title="Empleados"
        description={
          <>
            Altas, ediciones y fotos individuales. Para cargas masivas usá{' '}
            <Link to="/admin/importar">Importar</Link> y <Link to="/admin/fotos">Fotos</Link>.
          </>
        }
        actions={
          <button type="button" className="btn btn-primary" onClick={abrirNuevo}>
            <Plus size={16} aria-hidden="true" />
            Nuevo empleado
          </button>
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          subirFoto(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <Card flush className="list-card">
        <div className="list-head" ref={topRef}>
          <h2 className="card-title">
            Listado
            {lista.data && <span className="count-badge tabular">{formatNumero(total)}</span>}
          </h2>
        </div>
        <div className="toolbar">
          <SearchInput id="emp-q" value={q} onChange={setQ} placeholder="Nombre o documento" />
          <SelectFilter
            id="emp-f-empresa"
            label="Empresa"
            allLabel="Todas las empresas"
            value={empresa}
            onChange={setEmpresa}
            options={filtros.empresas}
          />
          <SelectFilter
            id="emp-f-sector"
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
            hayFiltros ? (
              <EmptyState
                icon={SearchX}
                title="Sin resultados"
                action={
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setQ('');
                      setEmpresa('');
                      setSector('');
                    }}
                  >
                    Limpiar filtros
                  </button>
                }
              >
                Probá con otro nombre, documento o filtro.
              </EmptyState>
            ) : (
              <EmptyState
                icon={UserPlus}
                title="Todavía no hay empleados"
                action={
                  <Link to="/admin/importar" className="btn btn-primary">
                    Importar desde Excel
                  </Link>
                }
              >
                Cargalos de a uno con “Nuevo empleado” o todos juntos desde un Excel.
              </EmptyState>
            )
          ) : isDesktop ? (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Empleado</th>
                  <th scope="col">Empresa</th>
                  <th scope="col">Sector</th>
                  <th scope="col">Ingreso</th>
                  <th scope="col" className="col-actions">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <PersonCell
                        nombre={e.nombre}
                        foto_url={e.foto_url}
                        documento={e.documento}
                        busy={subiendoFoto === e.id}
                      />
                    </td>
                    <td>{e.empresa || <span className="muted">—</span>}</td>
                    <td>{e.sector || <span className="muted">—</span>}</td>
                    <td>{ingresoPill(e)}</td>
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
                    busy={subiendoFoto === e.id}
                    extra={
                      (e.empresa || e.sector) && (
                        <span className="row-card-org">{[e.empresa, e.sector].filter(Boolean).join(' · ')}</span>
                      )
                    }
                  />
                  <div className="row-card-side">
                    {ingresoPill(e)}
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
            topRef.current?.scrollIntoView({ block: 'start' });
          }}
        />
      </Card>

      <EmpleadoForm
        open={formOpen}
        empleado={editando}
        filtros={filtros}
        onClose={() => setFormOpen(false)}
        onSaved={onSaved}
      />
      <QrModal empleado={qrDe} onClose={() => setQrDe(null)} />
    </>
  );
}
