import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, LogIn, Sparkles } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert, Spinner } from '../components/Feedback.jsx';
import { useDocumentTitle, useTheme } from '../hooks/hooks.js';
import { homeForRole } from '../utils.js';
import '../styles/login.css';

function destinoPermitido(from, rol) {
  if (!from) return null;
  if (from.startsWith('/admin')) return rol === 'rrhh' ? from : null;
  if (from.startsWith('/scanner')) return from;
  return null;
}

export default function Login() {
  useTheme('light');
  useDocumentTitle('Ingresar - Fiesta de fin de año');
  const { usuario, login } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [verPass, setVerPass] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

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
    <main className="login-page">
      <div className="login-wrap">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <Sparkles size={22} />
          </span>
          <h1>Fiesta Hergo</h1>
          <p>Acceso del personal · RRHH y puerta</p>
        </div>

        <form className="login-card" onSubmit={onSubmit} noValidate>
          {location.state?.expirada && (
            <Alert tipo="warning" className="login-alert">
              Tu sesión expiró o fue cerrada. Volvé a ingresar.
            </Alert>
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
            <div className="password-field">
              <input
                id="password"
                type={verPass ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon password-toggle"
                onClick={() => setVerPass((v) => !v)}
                aria-label={verPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={verPass}
              >
                {verPass ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
          <Alert>{error}</Alert>
          <button type="submit" className="btn btn-primary btn-block" disabled={cargando}>
            {cargando ? (
              <Spinner label="Ingresando…" />
            ) : (
              <>
                <LogIn size={18} aria-hidden="true" />
                Ingresar
              </>
            )}
          </button>
        </form>

        <p className="login-foot">
          ¿Sos invitado? <Link to="/">Obtené tu QR acá</Link>
        </p>
      </div>
    </main>
  );
}
