import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarResumen } from '../src/services/asistencias.service.js';
import { evaluarCambioUsuario } from '../src/services/usuarios.service.js';

test('armarResumen: estructura del rollup', () => {
  const filas = [
    { empresa: null, sector: null, total: 10, presentes: 6 },
    { empresa: 'Hergo', sector: null, total: 7, presentes: 5 },
    { empresa: 'Hergo', sector: 'Ventas', total: 4, presentes: 3 },
    { empresa: 'Hergo', sector: '', total: 3, presentes: 2 },
    { empresa: 'Otra', sector: null, total: 3, presentes: 1 },
    { empresa: 'Otra', sector: 'RRHH', total: 3, presentes: 1 },
  ];
  const r = armarResumen(filas, new Date('2026-12-19T23:50:00Z'));
  assert.equal(r.total, 10);
  assert.equal(r.presentes, 6);
  assert.equal(r.ausentes, 4);
  assert.equal(r.porcentaje, 60);
  assert.equal(r.actualizadoAt, '2026-12-19T23:50:00.000Z');
  assert.deepEqual(r.porEmpresa[0], {
    empresa: 'Hergo', total: 7, presentes: 5,
    sectores: [{ sector: 'Ventas', total: 4, presentes: 3 }, { sector: '', total: 3, presentes: 2 }],
  });
  assert.equal(r.porEmpresa.length, 2);
});

test('armarResumen: sin empleados', () => {
  const r = armarResumen([{ empresa: null, sector: null, total: 0, presentes: 0 }]);
  assert.equal(r.porcentaje, 0);
  assert.deepEqual(r.porEmpresa, []);
});

test('evaluarCambioUsuario: reglas sobre sí mismo y último RRHH', () => {
  const yo = { id: 'a', rol: 'rrhh', activo: true };
  const otroRrhh = { id: 'b', rol: 'rrhh', activo: true };
  const scanner = { id: 'c', rol: 'scanner', activo: true };
  assert.equal(evaluarCambioUsuario(yo, { activo: false }, 'a'), 'OPERACION_SOBRE_SI_MISMO');
  assert.equal(evaluarCambioUsuario(yo, { rol: 'scanner' }, 'a'), 'OPERACION_SOBRE_SI_MISMO');
  assert.equal(evaluarCambioUsuario(yo, { nombre: 'Nuevo' }, 'a'), null);
  assert.equal(evaluarCambioUsuario(yo, { rol: 'rrhh', activo: true }, 'a'), null);
  assert.equal(evaluarCambioUsuario(otroRrhh, { activo: false }, 'a'), 'VERIFICAR_ULTIMO_RRHH');
  assert.equal(evaluarCambioUsuario(otroRrhh, { rol: 'scanner' }, 'a'), 'VERIFICAR_ULTIMO_RRHH');
  assert.equal(evaluarCambioUsuario(scanner, { activo: false }, 'a'), null);
});
