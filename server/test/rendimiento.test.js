import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { firmarConSecreto, verificarConSecreto } from '../src/lib/jwt.js';
import { fuenteUsuario, REVALIDAR_MS } from '../src/middleware/requireAuth.js';
import { tokenQrValido } from '../src/services/empleados.service.js';
import { necesitaRehash, verificarPassword, hashPassword, COSTO } from '../src/lib/passwords.js';

const SECRETO = 'k'.repeat(40);
const ahora = Date.UTC(2026, 11, 19, 23, 0, 0);
const seg = Math.floor(ahora / 1000);

test('tokenQrValido: 43 caracteres url-safe', () => {
  assert.equal(tokenQrValido('A'.repeat(43)), true);
  assert.equal(tokenQrValido('aZ09-_'.repeat(7) + 'x'), true);
  assert.equal(tokenQrValido('A'.repeat(42)), false);
  assert.equal(tokenQrValido('A'.repeat(44)), false);
  assert.equal(tokenQrValido('A'.repeat(42) + '='), false);
  assert.equal(tokenQrValido('A'.repeat(42) + '+'), false);
  assert.equal(tokenQrValido('A'.repeat(42) + '/'), false);
  assert.equal(tokenQrValido("' or 1=1 --"), false);
  assert.equal(tokenQrValido(undefined), false);
});

test('JWT: firma y verifica; rechaza firma alterada, alg distinto y expirado', () => {
  const claims = { rol: 'rrhh', nombre: 'Ana', iat: seg, exp: seg + 3600, sub: 'u1' };
  const t = firmarConSecreto(claims, SECRETO);
  assert.deepEqual(verificarConSecreto(t, SECRETO, ahora), claims);
  assert.equal(verificarConSecreto(t, 'otro'.repeat(10), ahora), null);
  assert.equal(verificarConSecreto(t, SECRETO, (seg + 3600) * 1000), null); // expirado
  const [h, p, s] = t.split('.');
  const pAlterado = Buffer.from(JSON.stringify({ ...claims, rol: 'scanner' })).toString('base64url');
  assert.equal(verificarConSecreto(`${h}.${pAlterado}.${s}`, SECRETO, ahora), null);
  const hNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal(verificarConSecreto(`${hNone}.${p}.`, SECRETO, ahora), null);
  const hHs512 = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
  const s512 = createHmac('sha512', SECRETO).update(`${hHs512}.${p}`).digest('base64url');
  assert.equal(verificarConSecreto(`${hHs512}.${p}.${s512}`, SECRETO, ahora), null);
  assert.equal(verificarConSecreto('a.b', SECRETO, ahora), null);
  assert.equal(verificarConSecreto(null, SECRETO, ahora), null);
  // sin exp o sin sub => inválido
  assert.equal(verificarConSecreto(firmarConSecreto({ sub: 'u1' }, SECRETO), SECRETO, ahora), null);
  assert.equal(verificarConSecreto(firmarConSecreto({ exp: seg + 10 }, SECRETO), SECRETO, ahora), null);
});

test('requireAuth: fuente del usuario (cache / claims del token / DB)', () => {
  const fresco = seg - 60; // emitido hace 1 min
  const viejo = Math.floor((ahora - REVALIDAR_MS - 1000) / 1000);
  assert.equal(fuenteUsuario({ iat: fresco, hit: undefined, ahora }), 'claims');
  assert.equal(fuenteUsuario({ iat: viejo, hit: undefined, ahora }), 'db');
  assert.equal(fuenteUsuario({ iat: viejo, hit: { at: ahora - 1000 }, ahora }), 'cache');
  assert.equal(fuenteUsuario({ iat: viejo, hit: { at: ahora - REVALIDAR_MS }, ahora }), 'db');
  // un cache reciente (p.ej. tras desactivar al usuario en esta instancia) gana a los claims
  assert.equal(fuenteUsuario({ iat: fresco, hit: { at: ahora - 1000 }, ahora }), 'cache');
  assert.equal(fuenteUsuario({ iat: undefined, hit: undefined, ahora }), 'db');
  assert.equal(fuenteUsuario({ iat: seg + 3600, hit: undefined, ahora }), 'db'); // iat en el futuro
});

test('passwords: hashes de otro costo (p.ej. 12) siguen verificando y se marcan para rehash', async () => {
  const bcrypt = (await import('bcryptjs')).default;
  const viejo = bcrypt.hashSync('una-password', 4); // otro costo (bajo para que el test sea rápido)
  assert.equal(await verificarPassword('una-password', viejo), true);
  assert.equal(necesitaRehash(viejo), true);
  const nuevo = await hashPassword('una-password');
  assert.equal(bcrypt.getRounds(nuevo), COSTO);
  assert.equal(necesitaRehash(nuevo), false);
  assert.equal(await verificarPassword('otra', undefined), false); // señuelo
});
