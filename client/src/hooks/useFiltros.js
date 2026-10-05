import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/** Listas de empresas y sectores para los combos de filtro. */
export function useFiltros() {
  const [filtros, setFiltros] = useState({ empresas: [], sectores: [] });

  const recargar = useCallback(() => {
    api
      .get('/empleados/filtros')
      .then((f) => setFiltros({ empresas: f?.empresas || [], sectores: f?.sectores || [] }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return [filtros, recargar];
}
