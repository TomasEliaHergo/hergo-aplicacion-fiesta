import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import RequireRole from './auth/RequireRole.jsx';
import MiQR from './pages/public/MiQR.jsx';
import { loaders } from './routes.js';

// Solo la página pública va en el bundle inicial (es la que abren los invitados desde
// el celular). Login, escáner (html5-qrcode) y panel RRHH se cargan bajo demanda.
const Login = lazy(loaders.login);
const Scanner = lazy(loaders.scanner);
const AdminLayout = lazy(loaders.adminLayout);
const Dashboard = lazy(loaders.dashboard);
const Empleados = lazy(loaders.empleados);
const Importar = lazy(loaders.importar);
const Fotos = lazy(loaders.fotos);
const Usuarios = lazy(loaders.usuarios);

function NotFound() {
  return (
    <main className="center-page">
      <div className="notfound">
        <h1>Página no encontrada</h1>
        <p className="muted">La dirección no existe o cambió.</p>
        <Link to="/" className="btn btn-primary">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}

/** Fallback de Suspense: vacío (sin spinner) para no parpadear en cargas rápidas. */
function PageFallback() {
  return <div className="page-fallback" aria-busy="true" />;
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<MiQR />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/scanner"
          element={
            <RequireRole roles={['scanner', 'rrhh']}>
              <Scanner />
            </RequireRole>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireRole roles={['rrhh']}>
              <AdminLayout />
            </RequireRole>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="empleados" element={<Empleados />} />
          <Route path="importar" element={<Importar />} />
          <Route path="fotos" element={<Fotos />} />
          <Route path="usuarios" element={<Usuarios />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
