import { useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, Power, UserCog } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import Avatar from '../../components/Avatar.jsx';
import Modal from '../../components/Modal.jsx';
import { ActionMenu, Card, EmptyState, ListSkeleton, PageHeader, Pill } from '../../components/admin/ui.jsx';
import { Alert, Spinner, useConfirm, useToast } from '../../components/Feedback.jsx';
import { useDocumentTitle, useMediaQuery } from '../../hooks/hooks.js';
import { mutate, useApi } from '../../hooks/useApi.js';
import { erroresPorCampo, formatFechaHora, ROL_LABEL } from '../../utils.js';
import { fetchUsuarios } from './data.js';

const MIN_PASS = 8;

function NuevoUsuario({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ username: '', nombre: '', rol: 'scanner', password: '' });
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ username: '', nombre: '', rol: 'scanner', password: '' });
      setErrores({});
      setErrorGeneral('');
    }
  }, [open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.username.trim()) errs.username = 'El usuario es obligatorio.';
    if (!form.nombre.trim()) errs.nombre = 'El nombre es obligatorio.';
    if (form.password.length < MIN_PASS) errs.password = `Mínimo ${MIN_PASS} caracteres.`;
    setErrores(errs);
    setErrorGeneral('');
    if (Object.keys(errs).length) return;

    setGuardando(true);
    try {
      const u = await api.post('/usuarios', {
        username: form.username.trim(),
        nombre: form.nombre.trim(),
        rol: form.rol,
        password: form.password,
      });
      onCreated(u);
    } catch (err) {
      if (err.status === 409) setErrores({ username: 'Ya existe un usuario con ese nombre de usuario.' });
      else if (err.status === 400 && err.detalles.length) {
        setErrores(erroresPorCampo(err));
        setErrorGeneral(err.message);
      } else setErrorGeneral(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const err = (k) =>
    errores[k] ? (
      <small id={`nu-${k}-err`} className="field-error">
        {errores[k]}
      </small>
    ) : null;
  const aria = (k) => ({
    'aria-invalid': errores[k] ? 'true' : undefined,
    'aria-describedby': errores[k] ? `nu-${k}-err` : undefined,
  });

  return (
    <Modal open={open} title="Nuevo usuario" onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="nu-username">Usuario (para iniciar sesión)</label>
          <input
            id="nu-username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={form.username}
            onChange={set('username')}
            autoFocus
            {...aria('username')}
          />
          {err('username')}
        </div>
        <div className="field">
          <label htmlFor="nu-nombre">Nombre visible</label>
          <input
            id="nu-nombre"
            placeholder="Ej: Puerta 1"
            value={form.nombre}
            onChange={set('nombre')}
            {...aria('nombre')}
          />
          {err('nombre')}
        </div>
        <div className="field">
          <label htmlFor="nu-rol">Rol</label>
          <select id="nu-rol" value={form.rol} onChange={set('rol')}>
            <option value="scanner">Escáner (solo escanea QR en la entrada)</option>
            <option value="rrhh">RRHH (acceso total al panel)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="nu-password">Contraseña</label>
          <input
            id="nu-password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            {...aria('password')}
          />
          {err('password') || <small className="muted">Mínimo {MIN_PASS} caracteres.</small>}
        </div>
        <Alert>{errorGeneral}</Alert>
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? <Spinner label="Creando…" /> : 'Crear usuario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditarUsuario({ usuario, esYo, onClose, onSaved }) {
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState('scanner');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (usuario) {
      setNombre(usuario.nombre);
      setRol(usuario.rol);
      setError('');
    }
  }, [usuario]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    const body = { nombre: nombre.trim() };
    if (!esYo && rol !== usuario.rol) body.rol = rol;
    setGuardando(true);
    try {
      onSaved(await api.put(`/usuarios/${usuario.id}`, body));
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open={!!usuario} title={`Editar ${usuario?.username || ''}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="eu-nombre">Nombre visible</label>
          <input id="eu-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="eu-rol">Rol</label>
          <select
            id="eu-rol"
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            disabled={esYo}
            aria-describedby={esYo ? 'eu-rol-ayuda' : undefined}
          >
            <option value="scanner">Escáner</option>
            <option value="rrhh">RRHH</option>
          </select>
          {esYo && (
            <small id="eu-rol-ayuda" className="muted">
              No podés cambiar tu propio rol.
            </small>
          )}
        </div>
        <Alert>{error}</Alert>
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? <Spinner label="Guardando…" /> : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPassword({ usuario, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setPassword('');
    setPassword2('');
    setError('');
  }, [usuario]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (password.length < MIN_PASS) return setError(`La contraseña debe tener al menos ${MIN_PASS} caracteres.`);
    if (password !== password2) return setError('Las contraseñas no coinciden.');
    setGuardando(true);
    try {
      await api.post(`/usuarios/${usuario.id}/password`, { password });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open={!!usuario} title={`Nueva contraseña para ${usuario?.username || ''}`} onClose={onClose} size="sm">
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="rp-1">Nueva contraseña</label>
          <input
            id="rp-1"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="rp-2">Repetir contraseña</label>
          <input
            id="rp-2"
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
          />
        </div>
        <Alert>{error}</Alert>
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? <Spinner label="Guardando…" /> : 'Cambiar contraseña'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Usuarios() {
  useDocumentTitle('Usuarios - Panel RRHH');
  const { usuario: yo } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const { data, error, isLoading, reload } = useApi('usuarios', fetchUsuarios);
  const usuarios = data || [];
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [editando, setEditando] = useState(null);
  const [resetDe, setResetDe] = useState(null);

  const reemplazar = (u) => mutate('usuarios', (list) => list.map((x) => (x.id === u.id ? u : x)));

  const toggleActivo = async (u) => {
    const activar = !u.activo;
    const ok = await confirm({
      titulo: activar ? 'Activar usuario' : 'Desactivar usuario',
      mensaje: activar
        ? `¿Activar a ${u.nombre} (${u.username})? Va a poder volver a iniciar sesión.`
        : `¿Desactivar a ${u.nombre} (${u.username})? Pierde el acceso en unos minutos. Su historial de escaneos se conserva.`,
      confirmar: activar ? 'Activar' : 'Desactivar',
      peligro: !activar,
    });
    if (!ok) return;
    // UI optimista: se refleja al instante y se revierte si el backend lo rechaza.
    reemplazar({ ...u, activo: activar });
    try {
      reemplazar(await api.put(`/usuarios/${u.id}`, { activo: activar }));
      toast(`${u.nombre} ${activar ? 'activado' : 'desactivado'}.`);
    } catch (err) {
      reemplazar(u);
      toast(err.message, 'error');
    }
  };

  const menuDe = (u, esYo) => (
    <ActionMenu
      label={`Acciones para ${u.username}`}
      items={[
        { label: 'Editar', icon: Pencil, onSelect: () => setEditando(u) },
        { label: 'Cambiar contraseña', icon: KeyRound, onSelect: () => setResetDe(u) },
        {
          label: u.activo ? 'Desactivar' : 'Activar',
          icon: Power,
          danger: u.activo,
          separator: true,
          disabled: esYo,
          title: esYo ? 'No podés desactivarte a vos mismo' : undefined,
          onSelect: () => toggleActivo(u),
        },
      ]}
    />
  );

  const rolPill = (u) => <Pill tone={u.rol === 'rrhh' ? 'accent' : 'info'}>{ROL_LABEL[u.rol] || u.rol}</Pill>;
  const estadoPill = (u) =>
    u.activo ? (
      <Pill tone="ok" dot>
        Activo
      </Pill>
    ) : (
      <Pill tone="neutral">Inactivo</Pill>
    );

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Personal con acceso al panel y al escáner. No se borran: se desactivan para conservar quién registró cada ingreso."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setNuevoOpen(true)}>
            <Plus size={16} aria-hidden="true" />
            Nuevo usuario
          </button>
        }
      />

      {error && !data && (
        <Alert>
          {error.message}{' '}
          <button type="button" className="btn btn-link btn-sm" onClick={reload}>
            Reintentar
          </button>
        </Alert>
      )}

      <Card flush className="list-card">
        <div className="list-body">
          {isLoading ? (
            <ListSkeleton rows={4} cards={!isDesktop} />
          ) : usuarios.length === 0 ? (
            <EmptyState icon={UserCog} title="No hay usuarios" />
          ) : isDesktop ? (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Usuario</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Creado</th>
                  <th scope="col" className="col-actions">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => {
                  const esYo = u.id === yo?.id;
                  return (
                    <tr key={u.id} className={u.activo ? '' : 'row-inactive'}>
                      <td>
                        <UserCell u={u} esYo={esYo} />
                      </td>
                      <td>{rolPill(u)}</td>
                      <td>{estadoPill(u)}</td>
                      <td className="muted tabular">{formatFechaHora(u.created_at)}</td>
                      <td className="col-actions">{menuDe(u, esYo)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <ul className="card-list">
              {usuarios.map((u) => {
                const esYo = u.id === yo?.id;
                return (
                  <li key={u.id} className={`row-card ${u.activo ? '' : 'row-inactive'}`}>
                    <UserCell u={u} esYo={esYo} />
                    <div className="row-card-side">
                      <div className="row-card-pills">
                        {rolPill(u)}
                        {estadoPill(u)}
                      </div>
                      {menuDe(u, esYo)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <NuevoUsuario
        open={nuevoOpen}
        onClose={() => setNuevoOpen(false)}
        onCreated={(u) => {
          setNuevoOpen(false);
          mutate('usuarios', (list) => [...list, u]);
          toast(`Usuario ${u.username} creado.`);
        }}
      />
      <EditarUsuario
        usuario={editando}
        esYo={editando?.id === yo?.id}
        onClose={() => setEditando(null)}
        onSaved={(u) => {
          setEditando(null);
          reemplazar(u);
          toast('Cambios guardados.');
        }}
      />
      <ResetPassword
        usuario={resetDe}
        onClose={() => setResetDe(null)}
        onDone={() => {
          toast(`Contraseña de ${resetDe.username} actualizada.`);
          setResetDe(null);
        }}
      />
    </>
  );
}

function UserCell({ u, esYo }) {
  return (
    <div className="person">
      <Avatar nombre={u.nombre} size={36} />
      <div className="person-text">
        <span className="person-name">
          {u.nombre} {esYo && <Pill tone="accent">Vos</Pill>}
        </span>
        <span className="person-sub mono">{u.username}</span>
      </div>
    </div>
  );
}
