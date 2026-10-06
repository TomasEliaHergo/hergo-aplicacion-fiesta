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
