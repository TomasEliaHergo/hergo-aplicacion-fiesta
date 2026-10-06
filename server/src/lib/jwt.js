// JWT HS256 con node:crypto (sin jsonwebtoken: esa lib + lodash/semver sumaban
// ~100-300 ms al cold start de la función). Formato estándar RFC 7519, compatible
// con los tokens ya emitidos por jsonwebtoken (header {"alg":"HS256","typ":"JWT"}).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../config.js';

const B64URL = /^[A-Za-z0-9_-]+$/;
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

const firma = (datos, secreto) => createHmac('sha256', secreto).update(datos).digest();

/** Firma con un secreto explícito (exportada para tests). */
export function firmarConSecreto(claims, secreto) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const datos = `${HEADER}.${payload}`;
  return `${datos}.${firma(datos, secreto).toString('base64url')}`;
}

function decodificarJson(parte) {
  try {
    const v = JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Verifica firma (solo HS256), exp y nbf con un secreto explícito. Devuelve los claims o null. */
export function verificarConSecreto(token, secreto, ahoraMs = Date.now()) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const partes = token.split('.');
  if (partes.length !== 3 || !partes.every((p) => B64URL.test(p))) return null;
  const [h, p, s] = partes;
  const header = decodificarJson(h);
  if (!header || header.alg !== 'HS256') return null; // rechaza "none" y cualquier otro alg
  const esperada = firma(`${h}.${p}`, secreto);
  const recibida = Buffer.from(s, 'base64url');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;
  const claims = decodificarJson(p);
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) return null;
  const ahora = Math.floor(ahoraMs / 1000);
  if (typeof claims.exp !== 'number' || ahora >= claims.exp) return null;
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || ahora < claims.nbf)) return null;
  return claims;
}

/** Claims: { sub, rol, nombre, iat, exp }. iat lo usa requireAuth para decidir si re-valida en DB. */
export function firmarToken(usuario, ahoraMs = Date.now()) {
  const { JWT_SECRET, jwtExpiresSeg } = getConfig();
  const iat = Math.floor(ahoraMs / 1000);
  const exp = iat + jwtExpiresSeg;
  const token = firmarConSecreto({ rol: usuario.rol, nombre: usuario.nombre, iat, exp, sub: usuario.id }, JWT_SECRET);
  return { token, expiraEn: new Date(exp * 1000).toISOString() };
}

/** Verifica firma y expiración. Devuelve los claims o null. */
export function verificarToken(token) {
  return verificarConSecreto(token, getConfig().JWT_SECRET);
}
