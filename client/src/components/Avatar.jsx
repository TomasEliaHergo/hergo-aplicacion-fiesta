import { useEffect, useState } from 'react';
import { iniciales } from '../utils.js';

/** Tono estable por nombre para que las iniciales no sean todas iguales. */
function hue(nombre = '') {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) % 360;
  return h;
}

/**
 * Foto del empleado o, si no tiene / falla la carga, sus iniciales.
 * `eager`: carga prioritaria (escáner). `fetchpriority` va en minúscula: React 18 la pasa al DOM.
 * `onFallback(bool)`: avisa si se muestran iniciales en lugar de foto.
 */
export default function Avatar({ nombre, src, size = 40, className = '', eager = false, onFallback }) {
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [src]);
  const fallback = !src || error;
  useEffect(() => {
    onFallback?.(fallback);
  }, [fallback, onFallback]);

  const style = { width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.38)) };
  const initialsStyle = { ...style, '--av-h': hue(nombre) };

  if (src && !error) {
    return (
      <img
        className={`avatar ${className}`}
        src={src}
        alt={`Foto de ${nombre}`}
        style={style}
        loading={eager ? 'eager' : 'lazy'}
        fetchpriority={eager ? 'high' : undefined}
        decoding="async"
        onError={() => setError(true)}
      />
    );
  }
  return (
    <span className={`avatar avatar-initials ${className}`} style={initialsStyle} role="img" aria-label={`Sin foto: ${nombre}`}>
      {iniciales(nombre)}
    </span>
  );
}
