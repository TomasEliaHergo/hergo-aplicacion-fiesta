import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aResultadoRegistro, aResultadoVerificacion, armarResumen, verificar, registrar, rechazar,
} from '../src/services/asistencias.service.js';
import { motivoRechazoSchema } from '../src/lib/schemas.js';

const url = (p) => (p ? `https://cdn/fotos/${p}` : null);
const fila = {
  empleado_id: 'e1', nombre: 'Ana Pérez', documento: '42290081', empresa: 'Hergo', sector: 'Ventas', foto_path: 'empleados/e1/x.webp',
};

test('aResultadoVerificacion: sin filas => INVALIDO', () => {
  const vacio = { estado: 'INVALIDO', empleado: null, escaneado_at: null, escaneado_por_nombre: null };
  assert.deepEqual(aResultadoVerificacion([], url), vacio);
  assert.deepEqual(aResultadoVerificacion(null, url), vacio);
});

test('aResultadoVerificacion: PENDIENTE con datos y foto_url', () => {
  const r = aResultadoVerificacion([{ ...fila, estado: 'PENDIENTE', escaneado_at: null, escaneado_por_nombre: null }], url);
  assert.deepEqual(r, {
    estado: 'PENDIENTE',
    empleado: { id: 'e1', nombre: 'Ana Pérez', documento: '42290081', empresa: 'Hergo', sector: 'Ventas', foto_url: 'https://cdn/fotos/empleados/e1/x.webp' },
    escaneado_at: null,
    escaneado_por_nombre: null,
  });
  assert.equal('foto_path' in r.empleado, false);
});

test('aResultadoVerificacion: YA_INGRESO con hora y quién', () => {
  const r = aResultadoVerificacion([{
    ...fila, foto_path: null, estado: 'YA_INGRESO', escaneado_at: '2026-12-19T23:41:00.000Z', escaneado_por_nombre: 'Puerta 1',
  }], url);
  assert.equal(r.estado, 'YA_INGRESO');
  assert.equal(r.empleado.foto_url, null);
  assert.equal(r.escaneado_at, '2026-12-19T23:41:00.000Z');
  assert.equal(r.escaneado_por_nombre, 'Puerta 1');
});

test('aResultadoRegistro: OK / YA_INGRESO / INVALIDO (forma de POST /api/scan)', () => {
  const ok = aResultadoRegistro([{ ...fila, estado: 'OK', escaneado_at: '2026-12-19T23:41:00.000Z' }], url);
  assert.equal(ok.estado, 'OK');
  assert.equal(ok.escaneado_at, '2026-12-19T23:41:00.000Z');
  assert.equal(ok.empleado.documento, '42290081');
  assert.equal(ok.empleado.foto_url, 'https://cdn/fotos/empleados/e1/x.webp');
  assert.equal(aResultadoRegistro({ ...fila, estado: 'YA_INGRESO', escaneado_at: 'x' }, url).estado, 'YA_INGRESO');
  const inv = { estado: 'INVALIDO', empleado: null, escaneado_at: null };
  assert.deepEqual(aResultadoRegistro([{ estado: 'INVALIDO' }], url), inv);
  assert.deepEqual(aResultadoRegistro([], url), inv);
});

test('verificar / registrar / rechazar: token con formato inválido no toca la DB', async () => {
  // Sin env de Supabase: si llegaran a la DB, getConfig() lanzaría.
  for (const t of ['', 'abc', "' or 1=1 --", 'A'.repeat(42) + '=', 'A'.repeat(44)]) {
    assert.equal((await verificar(t)).estado, 'INVALIDO');
    assert.equal((await registrar(t, 'u1')).estado, 'INVALIDO');
    assert.equal(await rechazar(t, 'u1', null), null);
  }
});

test('motivoRechazoSchema: opcional, normaliza, máx. 200', () => {
  assert.equal(motivoRechazoSchema.parse(undefined), null);
  assert.equal(motivoRechazoSchema.parse(null), null);
  assert.equal(motivoRechazoSchema.parse(''), null);
  assert.equal(motivoRechazoSchema.parse('   '), null);
  assert.equal(motivoRechazoSchema.parse('  Sin   DNI '), 'Sin DNI');
  assert.equal(motivoRechazoSchema.parse('x'.repeat(200)).length, 200);
  assert.equal(motivoRechazoSchema.safeParse('x'.repeat(201)).success, false);
  assert.equal(motivoRechazoSchema.safeParse(5).success, false);
});

test('armarResumen: rechazos (null si no se pudo contar)', () => {
  const filas = [{ empresa: null, sector: null, total: 3, presentes: 1 }];
  assert.equal(armarResumen(filas).rechazos, null);
  assert.equal(armarResumen(filas, new Date(), 0).rechazos, 0);
  assert.equal(armarResumen(filas, new Date(), '4').rechazos, 4);
});

test('verificarPorDocumento: no encontrado => NO_ENCONTRADO sin llamar a verificar', async () => {
  const { verificarPorDocumento } = await import('../src/services/asistencias.service.js');
  let llamado = false;
  const r = await verificarPorDocumento('11111111', {
    buscarToken: async () => null,
    verificarFn: async () => { llamado = true; },
  });
  assert.deepEqual(r, { estado: 'NO_ENCONTRADO', empleado: null, escaneado_at: null, escaneado_por_nombre: null, token: null });
  assert.equal(llamado, false);
});

test('verificarPorDocumento: encontrado => resultado de verificar + token', async () => {
  const { verificarPorDocumento } = await import('../src/services/asistencias.service.js');
  const tok = 'A'.repeat(43);
  let buscado;
  const pendiente = aResultadoVerificacion([{ ...fila, estado: 'PENDIENTE', escaneado_at: null }], url);
  const r = await verificarPorDocumento('42290081', {
    buscarToken: async (d) => { buscado = d; return tok; },
    verificarFn: async (t) => (t === tok ? pendiente : null),
  });
  assert.equal(buscado, '42290081');
  assert.deepEqual(r, { ...pendiente, token: tok });

  const ya = { estado: 'YA_INGRESO', empleado: pendiente.empleado, escaneado_at: 'x', escaneado_por_nombre: 'Puerta 1' };
  const r2 = await verificarPorDocumento('42290081', { buscarToken: async () => tok, verificarFn: async () => ya });
  assert.equal(r2.estado, 'YA_INGRESO');
  assert.equal(r2.escaneado_por_nombre, 'Puerta 1');
  assert.equal(r2.token, tok);

  const inv = await verificarPorDocumento('42290081', {
    buscarToken: async () => 'raro', verificarFn: async () => ({ estado: 'INVALIDO', empleado: null }),
  });
  assert.equal(inv.estado, 'INVALIDO');
  assert.equal(inv.token, null);
});

test('documentoSchema: normaliza DNI con puntos y rechaza formatos inválidos', async () => {
  const { documentoSchema } = await import('../src/lib/schemas.js');
  assert.equal(documentoSchema.parse('30.123.456'), '30123456');
  assert.equal(documentoSchema.parse(' 30 123 456 '), '30123456');
  for (const malo of ['', 'abc', '1234', '1234567890123', null]) assert.equal(documentoSchema.safeParse(malo).success, false);
});
