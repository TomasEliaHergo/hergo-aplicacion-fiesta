import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { homeForRole } from '../utils.js';

/** Guard de rutas: exige sesión y que el rol esté en `roles`. */
export default function RequireRole({ roles, children }) {
  const { usuario } = useAuth();
  const location = useLocation();

  if (!usuario) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !roles.includes(usuario.rol)) {
    return <Navigate to={homeForRole(usuario.rol)} replace />;
  }
  return children;
}
