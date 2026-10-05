import bcrypt from 'bcryptjs';

const COSTO = 12;
// Hash señuelo para igualar tiempos cuando el usuario no existe.
const HASH_SENUELO = bcrypt.hashSync('senuelo-no-es-una-password-real', COSTO);

export const hashPassword = (password) => bcrypt.hash(password, COSTO);

export async function verificarPassword(password, hash) {
  return bcrypt.compare(password, hash ?? HASH_SENUELO);
}
