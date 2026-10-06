import bcrypt from 'bcryptjs';

// Costo 10 (~4x más rápido que 12 en la CPU de una función serverless). Los hashes
// viejos (costo 12) siguen verificando: bcrypt guarda el costo dentro del hash, y
// login() los rehashea a COSTO la primera vez que el usuario entra bien.
export const COSTO = 10;

// Hash señuelo (costo 10) para igualar tiempos cuando el usuario no existe.
// Precalculado a propósito: generarlo con hashSync al importar el módulo costaba
// ~150 ms (costo 10) / ~850 ms (costo 12) en cada cold start de la función.
const HASH_SENUELO = '$2b$10$i/qxTiYUEde4FbPa79GCjuEG2whDQXZ5UpZijXJrLfSo8uzcA.4Wy';

export const hashPassword = (password) => bcrypt.hash(password, COSTO);

export async function verificarPassword(password, hash) {
  return bcrypt.compare(password, hash ?? HASH_SENUELO);
}

/** ¿El hash fue generado con un costo distinto del actual? (para rehashear en el login). */
export function necesitaRehash(hash) {
  if (typeof hash !== 'string') return false;
  try {
    return bcrypt.getRounds(hash) !== COSTO;
  } catch {
    return false;
  }
}
