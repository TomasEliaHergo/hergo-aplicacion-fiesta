import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert, Spinner } from '../components/Feedback.jsx';
import { homeForRole } from '../utils.js';

function destinoPermitido(from, rol) {
  if (!from) return null;
  if (from.startsWith('/admin')) return rol === 'rrhh' ? from : null;
  if (from.startsWith('/scanner')) return from;
  return null;
}

export default function Login() {
  const { usuario, login } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    document.title = 'Ingresar - Fiesta de fin de año';
  }, []);

  // Tras el login (o si ya había sesión) se redirige según el rol.
  if (usuario) {
    return <Navigate to={destinoPermitido(location.state?.from, usuario.rol) || homeForRole(usuario.rol)} replace />;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Completá usuario y contraseña.');
      return;
    }
    setCargando(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(
        err.status === 401
          ? 'Usuario o contraseña incorrectos.'
          : err.status === 429
            ? 'Demasiados intentos. Esperá un minuto y volvé a probar.'
            : err.message,
      );
      setCargando(false);
    }
  };

  return (
    <main className="center-page login-page">
      <form className="card narrow" onSubmit={onSubmit} noValidate>
        <p className="eyebrow">Fiesta de fin de año</p>
        <h1>Ingreso del personal</h1>
        {location.state?.expirada && (
          <Alert tipo="warning">Tu sesión expiró o fue cerrada. Volvé a ingresar.</Alert>
        )}
        <div className="field">
          <label htmlFor="username">Usuario</label>
          <input
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Alert>{error}</Alert>
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={cargando}>
          {cargando ? <Spinner label="Ingresando…" /> : 'Ingresar'}
        </button>
        <p className="center small">
          <Link to="/">¿Sos invitado? Obtené tu QR acá</Link>
        </p>
      </form>
    </main>
  );
}
