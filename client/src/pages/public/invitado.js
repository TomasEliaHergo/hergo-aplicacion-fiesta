import { useEffect, useRef } from 'react';
import { api } from '../../api.js';

// Persistencia y seguimiento en vivo del invitado (página pública).

const KEY = 'fiesta.invitado';
const POLL_MS = 5000;
const POLL_429_MS = 30000;
const POLL_MAX_MS = 30000;

export function leerInvitado() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d.qr_token !== 'string' || !d.qr_token || typeof d.nombre !== 'string') return null;
    return {
      qr_token: d.qr_token,
      nombre: d.nombre,
      empresa: d.empresa || '',
      ingreso: !!d.ingreso,
      escaneado_at: d.escaneado_at || null,
    };
  } catch {
    return null;
  }
}

export function guardarInvitado(inv) {
  try {
    if (inv) localStorage.setItem(KEY, JSON.stringify(inv));
    else localStorage.removeItem(KEY);
  } catch {
    /* modo privado / storage lleno: se sigue sin recordar */
  }
}

/** El 404 genérico de Express ("Ruta no encontrada") significa que el backend todavía no tiene el endpoint. */
const esRutaInexistente = (err) => err?.status === 404 && /ruta no encontrada/i.test(err?.message || '');

export function consultarEstado(token, signal) {
  return api.get(`/public/estado/${encodeURIComponent(token)}`, null, { signal });
}

/**
 * Consulta GET /api/public/estado/:token cada 5 s mientras `activo`.
 * - Pausa con la pestaña oculta y consulta apenas vuelve.
 * - 429 => espera 30 s; errores de red => backoff exponencial hasta 30 s.
 * - Se detiene cuando `ingreso` es true.
 * - 404 NO_ENCONTRADO => `onNoEncontrado()` (el token ya no existe).
 * - Endpoint inexistente (backend anterior) => `onNoDisponible()` y deja de consultar.
 */
export function useEstadoIngreso(token, activo, { inmediato = false, onCambio, onNoEncontrado, onNoDisponible }) {
  const cbRef = useRef({ onCambio, onNoEncontrado, onNoDisponible });
  cbRef.current = { onCambio, onNoEncontrado, onNoDisponible };

  useEffect(() => {
    if (!token || !activo) return undefined;
    let cancelado = false;
    let timer = null;
    let ctrl = null;
    let delay = POLL_MS;

    const programar = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };

    async function tick() {
      if (cancelado || document.hidden) return; // al volver a la pestaña se reprograma
      ctrl = new AbortController();
      try {
        const d = await consultarEstado(token, ctrl.signal);
        if (cancelado) return;
        delay = POLL_MS;
        cbRef.current.onCambio?.(d);
        if (d?.ingreso) return; // listo: ya entró
      } catch (err) {
        if (cancelado || err?.name === 'AbortError') return;
        if (esRutaInexistente(err)) {
          cbRef.current.onNoDisponible?.(); // backend viejo: no hay seguimiento en vivo
          return;
        }
        if (err?.status === 404) {
          cbRef.current.onNoEncontrado?.();
          return;
        }
        delay = err?.status === 429 ? POLL_429_MS : Math.min(delay * 2, POLL_MAX_MS);
      }
      programar(delay);
    }

    const onVis = () => {
      if (document.hidden) clearTimeout(timer);
      else programar(0);
    };
    document.addEventListener('visibilitychange', onVis);
    programar(inmediato ? 0 : POLL_MS);

    return () => {
      cancelado = true;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [token, activo, inmediato]);
}

export { esRutaInexistente };

/** "PÉREZ, ANA MARÍA" -> "Ana"; "Juan Pérez" -> "Juan". */
export function primerNombre(nombre) {
  if (!nombre) return '';
  let s = String(nombre).trim();
  if (s.includes(',')) s = s.split(',')[1]?.trim() || s.split(',')[0].trim();
  const w = s.split(/\s+/)[0] || '';
  if (w && w === w.toLocaleUpperCase('es-AR')) {
    return w.charAt(0) + w.slice(1).toLocaleLowerCase('es-AR');
  }
  return w;
}
