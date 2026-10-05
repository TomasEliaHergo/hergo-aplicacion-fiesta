import jwt from 'jsonwebtoken';
import { getConfig } from '../config.js';

export function firmarToken(usuario) {
  const { JWT_SECRET, jwtExpiresIn } = getConfig();
  const token = jwt.sign({ rol: usuario.rol, nombre: usuario.nombre }, JWT_SECRET, {
    algorithm: 'HS256',
    subject: usuario.id,
    expiresIn: jwtExpiresIn,
  });
  const { exp } = jwt.decode(token);
  return { token, expiraEn: new Date(exp * 1000).toISOString() };
}

/** Verifica firma y expiración. Devuelve los claims o null. */
export function verificarToken(token) {
  try {
    const claims = jwt.verify(token, getConfig().JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof claims !== 'object' || !claims.sub) return null;
    return claims;
  } catch {
    return null;
  }
}
