import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refProyecto, trozos, listarArchivosRecursivo, FRASE_CONFIRMACION } from '../src/lib/reset.js';

test('refProyecto: ref de *.supabase.co, si no el host', () => {
  assert.equal(refProyecto('https://abcdefghijklmnop.supabase.co'), 'abcdefghijklmnop');
  assert.equal(refProyecto('https://abcdefghijklmnop.supabase.co/'), 'abcdefghijklmnop');
  assert.equal(refProyecto('https://db.midominio.com'), 'db.midominio.com');
  assert.equal(refProyecto('no-es-url'), '(URL inválida)');
  assert.equal(FRASE_CONFIRMACION, 'BORRAR TODO');
});

test('trozos: de a n', () => {
  assert.deepEqual(trozos([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(trozos([], 100), []);
  assert.equal(trozos(Array.from({ length: 250 }, (_, i) => i), 100).length, 3);
});

/** Storage falso: { 'carpeta': [nombres] }; nombre terminado en '/' = carpeta. */
function storageFalso(arbol) {
  const llamadas = [];
  const listar = async (prefijo, { limit, offset }) => {
    llamadas.push({ prefijo, limit, offset });
    const items = (arbol[prefijo] ?? []).map((n) => (n.endsWith('/') ? { name: n.slice(0, -1), id: null } : { name: n, id: `id-${n}` }));
    return { data: items.slice(offset, offset + limit), error: null };
  };
  return { listar, llamadas };
}

test('listarArchivosRecursivo: recorre carpetas empleados/{id}/{archivo} paginando', async () => {
  const ids = Array.from({ length: 5 }, (_, i) => `e${i}`);
  const arbol = { '': ['empleados/', '.emptyFolderPlaceholder'], empleados: ids.map((id) => `${id}/`) };
  for (const id of ids) arbol[`empleados/${id}`] = ['a.webp', 'b.webp', 'c.webp'];
  const { listar, llamadas } = storageFalso(arbol);
  const archivos = await listarArchivosRecursivo(listar, { limite: 2, concurrencia: 3 });
  assert.equal(archivos.length, 16);
  assert.ok(archivos.includes('.emptyFolderPlaceholder'));
  assert.ok(archivos.includes('empleados/e4/c.webp'));
  // paginó: con limite 2, la carpeta de 3 archivos pide offset 0 y 2
  assert.ok(llamadas.some((l) => l.prefijo === 'empleados/e0' && l.offset === 2));
});

test('listarArchivosRecursivo: bucket vacío y error de listado', async () => {
  assert.deepEqual(await listarArchivosRecursivo(storageFalso({}).listar), []);
  const conError = async () => ({ data: null, error: { message: 'boom' } });
  await assert.rejects(listarArchivosRecursivo(conError), /boom/);
});
