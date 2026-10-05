import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import Avatar from '../../components/Avatar.jsx';
import Modal from '../../components/Modal.jsx';
import Pagination from '../../components/Pagination.jsx';
import QrCard from '../../components/QrCard.jsx';
import { Alert, Spinner, useConfirm, useToast } from '../../components/Feedback.jsx';
import { useDebounced } from '../../hooks/hooks.js';
import { useFiltros } from '../../hooks/useFiltros.js';
import { formatDocumento, formatHora, MAX_FOTO_BYTES } from '../../utils.js';
import EmpleadoForm from './EmpleadoForm.jsx';

const PAGE_SIZE = 50;
const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];

function QrModal({ empleado, onClose }) {
  const [token, setToken] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!empleado) return;
    setToken(null);
    setError('');
    api
      .get(`/empleados/${empleado.id}/qr`)
      .then((d) => setToken(d.qr_token))
      .catch((err) => setError(err.message));
  }, [empleado]);

  return (
    <Modal open={!!empleado} title="Código QR" onClose={onClose} size="sm">
      <Alert>{error}</Alert>
      {!token && !error && (
        <div className="center pad">
          <Spinner />
        </div>
      )}
      {token && empleado && <QrCard value={token} nombre={empleado.nombre} empresa={empleado.empresa} />}
    </Modal>
  );
}

export default function Empleados() {
  const toast = useToast();
  const confirm = useConfirm();
  const [filtros, recargarFiltros] = useFiltros();

  const [q, setQ] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [sector, setSector] = useState('');
  const [page, setPage] = useState(1);
  const qDeb = useDebounced(q, 300);

  const [lista, setLista] = useState({ items: [], total: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const reqId = useRef(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState(null);
  const [qrDe, setQrDe] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(null); // id del empleado
  const fileRef = useRef(null);
  const fotoTarget = useRef(null);

  useEffect(() => {
    document.title = 'Empleados - Panel RRHH';
  }, []);

  const cargar = useCallback(async () => {
    const id = ++reqId.current;
    setCargando(true);
    try {
      const data = await api.get('/empleados', {
        q: qDeb.trim(),
        empresa,
        sector,
        orden: 'nombre',
        page,
        pageSize: PAGE_SIZE,
      });
      if (id !== reqId.current) return;
      setLista({ items: data.items || [], total: data.total || 0 });
      setError('');
    } catch (err) {
      if (id === reqId.current) setError(err.message);
    } finally {
      if (id === reqId.current) setCargando(false);
    }
  }, [qDeb, empresa, sector, page]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    setPage(1);
  }, [qDeb, empresa, sector]);

  const reemplazarItem = (emp) =>
    setLista((l) => ({ ...l, items: l.items.map((x) => (x.id === emp.id ? { ...x, ...emp } : x)) }));

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
    if (esNuevo) cargar();
    else reemplazarItem(emp);
    recargarFiltros();
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
      toast(`Se eliminó a ${emp.nombre}.`);
      cargar();
    } catch (err) {
      toast(err.message, 'error');
    }
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
      toast(`Se quitó la foto de ${emp.nombre}.`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Empleados</h1>
          <p className="muted small">
            Para cargas masivas usá <Link to="/admin/importar">Importar Excel</Link> y{' '}
            <Link to="/admin/fotos">Fotos masivas</Link>.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={abrirNuevo}>
            + Nuevo empleado
          </button>
        </div>
      </div>

      <section className="card">
        <div className="filters">
          <div className="field field-inline grow">
            <label htmlFor="emp-q">Buscar</label>
            <input
              id="emp-q"
              type="search"
              placeholder="Nombre o documento"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field field-inline">
            <label htmlFor="emp-f-empresa">Empresa</label>
            <select id="emp-f-empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
              <option value="">Todas</option>
              {filtros.empresas.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-inline">
            <label htmlFor="emp-f-sector">Sector</label>
            <select id="emp-f-sector" value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">Todos</option>
              {filtros.sectores.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Alert>{error}</Alert>

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

        <div className="table-wrap" aria-busy={cargando}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Foto</th>
                <th scope="col">Nombre</th>
                <th scope="col">Documento</th>
                <th scope="col">Empresa</th>
                <th scope="col">Sector</th>
                <th scope="col">Ingreso</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className="photo-cell">
                      {subiendoFoto === e.id ? (
                        <Spinner label="Subiendo foto…" />
                      ) : (
                        <Avatar nombre={e.nombre} src={e.foto_url} size={40} />
                      )}
                    </div>
                  </td>
                  <td className="strong">{e.nombre}</td>
                  <td className="mono">{formatDocumento(e.documento)}</td>
                  <td>{e.empresa || '—'}</td>
                  <td>{e.sector || '—'}</td>
                  <td>
                    {e.asistio ? (
                      <span className="badge badge-ok">{formatHora(e.escaneado_at)}</span>
                    ) : (
                      <span className="badge badge-muted">—</span>
                    )}
                  </td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => abrirEditar(e)}
                      aria-label={`Editar a ${e.nombre}`}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => elegirFoto(e)}
                      disabled={subiendoFoto === e.id}
                      aria-label={`${e.foto_url ? 'Cambiar' : 'Subir'} foto de ${e.nombre}`}
                    >
                      {e.foto_url ? 'Cambiar foto' : 'Subir foto'}
                    </button>
                    {e.foto_url && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => quitarFoto(e)}
                        aria-label={`Quitar foto de ${e.nombre}`}
                      >
                        Quitar foto
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setQrDe(e)}
                      aria-label={`Ver QR de ${e.nombre}`}
                    >
                      QR
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-outline btn-sm btn-destructive-sep"
                      onClick={() => eliminar(e)}
                      aria-label={`Eliminar a ${e.nombre}`}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {!cargando && lista.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    No hay empleados que coincidan. Podés importarlos desde un Excel.
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

      <EmpleadoForm
        open={formOpen}
        empleado={editando}
        filtros={filtros}
        onClose={() => setFormOpen(false)}
        onSaved={onSaved}
      />
      <QrModal empleado={qrDe} onClose={() => setQrDe(null)} />
    </div>
  );
}
