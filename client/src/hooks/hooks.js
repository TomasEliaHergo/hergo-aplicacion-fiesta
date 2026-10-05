import { useEffect, useRef, useState } from 'react';

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/**
 * Ejecuta `fn` cada `ms` milisegundos (y al volver a la pestaña).
 * No consulta mientras la pestaña está oculta.
 */
export function usePolling(fn, ms) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') fnRef.current();
    };
    const id = setInterval(tick, ms);
    const onVis = () => {
      if (document.visibilityState === 'visible') fnRef.current();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms]);
}
