import { useCallback, useEffect, useReducer, useRef } from 'react';

/**
 * Cache mínimo en memoria con stale-while-revalidate.
 *
 * - `useApi(key, fetcher, { refreshInterval })` devuelve al instante lo que haya en cache
 *   (cambiar de pestaña del panel no muestra "cargando") y revalida en segundo plano.
 * - Requests concurrentes con la misma key se deduplican (una sola promesa en vuelo).
 * - Si nadie más está mirando una key (cambió el filtro, se desmontó la página), el
 *   request en vuelo se cancela con AbortController.
 * - Mientras carga una key nueva se sigue mostrando el dato anterior (`isStale`), sin parpadeos.
 * - `mutate(key, fn)` permite UI optimista; `invalidate(prefix)` marca keys como viejas.
 */

const cache = new Map();
const DEDUPE_MS = 2000;

function entryFor(key) {
  let e = cache.get(key);
  if (!e) {
    e = { data: undefined, error: undefined, ts: 0, promise: null, ctrl: null, subs: new Set() };
    cache.set(key, e);
  }
  return e;
}

function notify(e) {
  for (const fn of e.subs) fn();
}

/** Dispara (o reutiliza) el request de `key`. Devuelve una promesa que nunca rechaza. */
export function revalidate(key, fetcher) {
  const e = entryFor(key);
  if (e.promise) return e.promise;
  if (!fetcher) fetcher = e.fetcher;
  if (!fetcher) return Promise.resolve();
  e.fetcher = fetcher;

  const ctrl = new AbortController();
  e.ctrl = ctrl;
  const p = Promise.resolve()
    .then(() => fetcher({ signal: ctrl.signal }))
    .then(
      (data) => {
        if (ctrl.signal.aborted) return;
        e.data = data;
        e.error = undefined;
        e.ts = Date.now();
      },
      (err) => {
        if (ctrl.signal.aborted || err?.name === 'AbortError') return;
        e.error = err;
        e.ts = Date.now();
      },
    )
    .finally(() => {
      if (e.ctrl === ctrl) {
        e.ctrl = null;
        e.promise = null;
      }
      notify(e);
    });
  e.promise = p;
  notify(e);
  return p;
}

/** Precarga una key si no está fresca (para hover en la navegación). */
export function preload(key, fetcher, maxAgeMs = 10000) {
  const e = entryFor(key);
  if (e.promise || Date.now() - e.ts < maxAgeMs) return;
  revalidate(key, fetcher);
}

/** Lee el dato cacheado sin suscribirse. */
export function peek(key) {
  return cache.get(key)?.data;
}

/** Escribe directamente en cache (p. ej. sembrar "filtros" desde el panel). */
export function setCache(key, data) {
  const e = entryFor(key);
  e.data = data;
  e.error = undefined;
  e.ts = Date.now();
  notify(e);
}

/** Actualización optimista: `updater(datoActual) => datoNuevo`. Devuelve el dato anterior (para revertir). */
export function mutate(key, updater) {
  const e = cache.get(key);
  if (!e || e.data === undefined) return undefined;
  const prev = e.data;
  e.data = typeof updater === 'function' ? updater(prev) : updater;
  notify(e);
  return prev;
}

/** Marca como viejas todas las keys que empiezan con `prefix` y revalida las que están en pantalla. */
export function invalidate(prefix) {
  for (const [key, e] of cache) {
    if (!key.startsWith(prefix)) continue;
    e.ts = 0;
    if (e.subs.size > 0) revalidate(key);
  }
}

/** Vacía todo (al cerrar sesión: otro usuario no debe ver datos del anterior). */
export function clearCache() {
  for (const e of cache.values()) e.ctrl?.abort();
  cache.clear();
}

export function useApi(key, fetcher, { refreshInterval = 0, keepPrevious = true } = {}) {
  const [, force] = useReducer((x) => x + 1, 0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const lastData = useRef(undefined);

  useEffect(() => {
    if (!key) return undefined;
    const e = entryFor(key);
    e.fetcher = (opts) => fetcherRef.current(opts);
    e.subs.add(force);
    if (!e.promise && Date.now() - e.ts > DEDUPE_MS) revalidate(key);
    else force();
    return () => {
      e.subs.delete(force);
      // Nadie más mira esta key: se cancela el request viejo (filtro/búsqueda cambió).
      if (e.subs.size === 0 && e.ctrl) {
        e.ctrl.abort();
        e.ctrl = null;
        e.promise = null;
      }
    };
  }, [key]);

  // Polling: solo con la pestaña visible; al volver a la pestaña revalida enseguida.
  useEffect(() => {
    if (!key || !refreshInterval) return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') revalidate(key);
    };
    const id = setInterval(tick, refreshInterval);
    const onVis = () => {
      const e = cache.get(key);
      if (document.visibilityState === 'visible' && e && Date.now() - e.ts > DEDUPE_MS) revalidate(key);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [key, refreshInterval]);

  const e = key ? cache.get(key) : undefined;
  const own = e?.data;
  if (own !== undefined) lastData.current = own;
  const data = own !== undefined ? own : keepPrevious ? lastData.current : undefined;

  const reload = useCallback(() => (key ? revalidate(key) : Promise.resolve()), [key]);

  return {
    data,
    error: e?.error,
    isLoading: data === undefined && !e?.error,
    isValidating: !!e?.promise,
    isStale: own === undefined && data !== undefined,
    reload,
  };
}
