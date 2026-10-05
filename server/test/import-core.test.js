import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizarEncabezado, mapearEncabezados, procesarFilas, clasificar, enLotes } from '../src/lib/import-core.js';
import { leerPrimeraHoja } from '../src/lib/excel.js';

test('normalizarEncabezado: minúsculas, sin acentos, sin espacios/guiones bajos', () => {
  assert.equal(normalizarEncabezado('  Nro. Documento '), 'nrodocumento');
  assert.equal(normalizarEncabezado('Apellido y Nombre'), 'apellidoynombre');
  assert.equal(normalizarEncabezado('ÁREA'), 'area');
  assert.equal(normalizarEncabezado('nombre_y_apellido'), 'nombreyapellido');
  assert.equal(normalizarEncabezado('Compañía'), 'compania');
  assert.equal(normalizarEncabezado(null), '');
});

test('mapearEncabezados: sinónimos y columna foto ignorada', () => {
  const { indices, faltantes } = mapearEncabezados(['DNI', 'Foto URL', 'Apellido y Nombre', 'Empresa', 'Sector']);
  assert.deepEqual(indices, { documento: 0, nombre: 2, empresa: 3, sector: 4 });
  assert.deepEqual(faltantes, []);
});

test('mapearEncabezados: faltantes', () => {
  assert.deepEqual(mapearEncabezados(['Empresa', 'Sector']).faltantes, ['documento', 'nombre']);
  assert.deepEqual(mapearEncabezados(['dni']).faltantes, ['nombre']);
  assert.deepEqual(mapearEncabezados([]).faltantes, ['documento', 'nombre']);
});

test('procesarFilas: validaciones, números de fila y textos normalizados', () => {
  const indices = { documento: 0, nombre: 1, empresa: 2 };
  const filas = [
    ['30.123.456', '  Ana   Pérez ', ' Hergo '], // fila 2 ok
    ['', 'Sin Doc', 'X'], // fila 3 vacío
    ['abc', 'Doc malo', 'X'], // fila 4 inválido
    ['', '', ''], // fila 5 en blanco: se ignora
    [31234567, '   ', 'X'], // fila 6 nombre vacío
    [28987654, 'Juan', ''], // fila 7 ok
  ];
  const { validas, errores } = procesarFilas(filas, indices);
  assert.deepEqual(validas, [
    { fila: 2, documento: '30123456', nombre: 'Ana Pérez', empresa: 'Hergo' },
    { fila: 7, documento: '28987654', nombre: 'Juan', empresa: '' },
  ]);
  assert.deepEqual(errores, [
    { fila: 3, motivo: 'DOCUMENTO_VACIO' },
    { fila: 4, motivo: 'DOCUMENTO_INVALIDO' },
    { fila: 6, motivo: 'NOMBRE_VACIO' },
  ]);
});

test('procesarFilas: duplicados en archivo => ninguna fila se aplica', () => {
  const indices = { documento: 0, nombre: 1 };
  const filas = [
    ['30123456', 'Ana'],
    ['11111111', 'Otro'],
    ['30.123.456', 'Ana bis'],
    [30123456, 'Ana ter'],
  ];
  const { validas, errores } = procesarFilas(filas, indices);
  assert.deepEqual(validas.map((v) => v.documento), ['11111111']);
  assert.deepEqual(errores, [
    { fila: 2, motivo: 'DOCUMENTO_DUPLICADO_EN_ARCHIVO (también en fila 4, 5)' },
    { fila: 4, motivo: 'DOCUMENTO_DUPLICADO_EN_ARCHIVO (también en fila 2, 5)' },
    { fila: 5, motivo: 'DOCUMENTO_DUPLICADO_EN_ARCHIVO (también en fila 2, 4)' },
  ]);
});

test('clasificar: insertar / actualizar / sin cambios', () => {
  const existentes = new Map([
    ['10000001', { documento: '10000001', nombre: 'Igual', empresa: 'A', sector: 'S' }],
    ['10000002', { documento: '10000002', nombre: 'Viejo', empresa: 'A', sector: 'S' }],
    ['10000003', { documento: '10000003', nombre: 'Mismo', empresa: 'A', sector: 'S' }],
  ]);
  const validas = [
    { fila: 2, documento: '10000001', nombre: 'Igual', empresa: 'A', sector: 'S' },
    { fila: 3, documento: '10000002', nombre: 'Nuevo nombre', empresa: 'A', sector: 'S' },
    { fila: 4, documento: '10000003', nombre: 'Mismo', empresa: 'B', sector: 'S' },
    { fila: 5, documento: '10000004', nombre: 'Alta', empresa: 'A', sector: 'S' },
  ];
  const r = clasificar(validas, existentes);
  assert.equal(r.sinCambios, 1);
  assert.deepEqual(r.insertar, [{ fila: 5, documento: '10000004', nombre: 'Alta', empresa: 'A', sector: 'S' }]);
  assert.deepEqual(r.actualizar.map((a) => a.fila), [3, 4]);
  for (const a of [...r.insertar, ...r.actualizar]) {
    assert.ok(!('qr_token' in a) && !('foto_path' in a) && !('id' in a), 'nunca toca qr_token/foto_path');
  }
});

test('clasificar: columnas ausentes en el archivo no se comparan ni se pisan', () => {
  const existentes = new Map([['10000001', { documento: '10000001', nombre: 'Ana', empresa: 'Hergo', sector: 'Ventas' }]]);
  const sinCambio = clasificar([{ fila: 2, documento: '10000001', nombre: 'Ana' }], existentes);
  assert.equal(sinCambio.sinCambios, 1);
  const cambio = clasificar([{ fila: 2, documento: '10000001', nombre: 'Ana María' }], existentes);
  assert.deepEqual(cambio.actualizar, [{ fila: 2, documento: '10000001', nombre: 'Ana María' }]);
  // alta sin columnas opcionales => defaults ''
  const alta = clasificar([{ fila: 2, documento: '20000001', nombre: 'Nuevo' }], new Map());
  assert.deepEqual(alta.insertar, [{ fila: 2, documento: '20000001', nombre: 'Nuevo', empresa: '', sector: '' }]);
});

test('enLotes', () => {
  assert.deepEqual(enLotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(enLotes(Array.from({ length: 1001 }), 500).length, 3);
  assert.deepEqual(enLotes([], 500), []);
});

test('leerPrimeraHoja: CSV UTF-8 con BOM preserva texto', () => {
  const csv = Buffer.from('﻿DNI,Nombre y Apellido,Empresa\n01234567,José Ñandú,Hergo\n', 'utf8');
  const { filas, primeraFila } = leerPrimeraHoja(csv, '.csv');
  assert.equal(primeraFila, 1);
  assert.deepEqual(filas[0], ['DNI', 'Nombre y Apellido', 'Empresa']);
  assert.equal(filas[1][1], 'José Ñandú');
  assert.equal(String(filas[1][0]), '01234567');
});

test('Excel de ejemplo: se importa completo sin errores', () => {
  const buf = readFileSync(new URL('../scripts/ejemplo-empleados.xlsx', import.meta.url));
  const { filas, primeraFila } = leerPrimeraHoja(buf, '.xlsx');
  const [enc, ...datos] = filas;
  const { indices, faltantes } = mapearEncabezados(enc);
  assert.deepEqual(faltantes, []);
  const { validas, errores } = procesarFilas(datos, indices, primeraFila + 1);
  assert.equal(errores.length, 0);
  assert.equal(validas.length, 10);
  assert.equal(validas[1].documento, '31234567');
  assert.equal(validas[2].nombre, 'Fernández, María José');
});
