import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import RequireRole from './auth/RequireRole.jsx';
import MiQR from './pages/public/MiQR.jsx';
import Login from './pages/Login.jsx';
import { Spinner } from './components/Feedback.jsx';

// El escáner (html5-qrcode) y el panel RRHH se cargan bajo demanda:
// la página pública queda liviana para los celulares.
const Scanner = lazy(() => import('./pages/scanner/Scanner.jsx'));
const AdminLayout = lazy(() => import('./pages/rrhh/AdminLayout.jsx'));
const Dashboard = lazy(() => import('./pages/rrhh/Dashboard.jsx'));
const Empleados = lazy(() => import('./pages/rrhh/Empleados.jsx'));
const Importar = lazy(() => import('./pages/rrhh/Importar.jsx'));
const Fotos = lazy(() => import('./pages/rrhh/Fotos.jsx'));
const Usuarios = lazy(() => import('./pages/rrhh/Usuarios.jsx'));

function NotFound() {
  return (
    <main className="center-page">
      <div className="card narrow">
        <h1>Página no encontrada</h1>
        <p>
          <Link to="/">Volver al inicio</Link>
        </p>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="center-page">
          <Spinner />
        </div>
      }
    >
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
