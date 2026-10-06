import { useEffect, useState } from 'react';

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** `true` mientras la media query coincide (se actualiza al rotar / redimensionar). */
export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const THEME_COLOR = { night: '#0a0f1f', light: '#f6f7f9', scanner: '#000000' };

/** Fija el "mundo" visual (fondo del documento y color de la barra del navegador). */
export function useTheme(theme) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme === 'scanner' ? 'night' : theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[theme] || THEME_COLOR.light);
  }, [theme]);
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
