import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  clearSession,
  getStoredUser,
  getToken,
  setSession,
  setUnauthorizedHandler,
  updateStoredUser,
} from '../api.js';
import { clearCache } from '../hooks/useApi.js';
import { prefetchForRole } from '../routes.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => (getToken() ? getStoredUser() : null));
  const navigate = useNavigate();

  // 401 en cualquier request autenticado -> sesión vencida/desactivada.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearCache();
      setUsuario(null);
      navigate('/login', { replace: true, state: { expirada: true } });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  // Al cargar con un token guardado, se revalida contra el backend (rol/activo actualizados).
  useEffect(() => {
    if (!getToken()) return;
    let cancel = false;
    api
      .get('/auth/me')
      .then((u) => {
        if (cancel || !u) return;
        updateStoredUser(u);
        setUsuario(u);
        prefetchForRole(u.rol);
      })
      .catch(() => {
        /* 401 lo maneja el handler; errores de red: se mantiene la sesión local */
      });
    return () => {
      cancel = true;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    clearSession();
    clearCache();
    const data = await api.post('/auth/login', { username, password });
    setSession(data.token, data.usuario);
    setUsuario(data.usuario);
    prefetchForRole(data.usuario?.rol);
    return data.usuario;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    clearCache();
    setUsuario(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const value = useMemo(() => ({ usuario, login, logout }), [usuario, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
