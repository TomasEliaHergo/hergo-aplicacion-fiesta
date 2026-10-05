import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarDocumento, analizarDocumento, documentoDesdeNombreArchivo, documentoValido } from '../src/lib/documento.js';
import { documentoSchema } from '../src/lib/schemas.js';

test('normalizarDocumento: deja solo dígitos', () => {
  assert.equal(normalizarDocumento('12.345.678'), '12345678');
  assert.equal(normalizarDocumento(' 20-33444555-6 '), '20334445556');
  assert.equal(normalizarDocumento('DNI 30 123 456'), '30123456');
  assert.equal(normalizarDocumento(null), '');
  assert.equal(normalizarDocumento(undefined), '');
});

test('normalizarDocumento: números de Excel sin decimales ni exponente', () => {
  assert.equal(normalizarDocumento(30123456), '30123456');
  assert.equal(normalizarDocumento(30123456.0), '30123456');
  assert.equal(normalizarDocumento(20334445556), '20334445556');
  assert.equal(normalizarDocumento(1e11), '100000000000');
  assert.equal(normalizarDocumento(NaN), '');
});

test('documentoValido: 5 a 12 dígitos', () => {
  assert.ok(documentoValido('12345'));
  assert.ok(documentoValido('123456789012'));
  assert.ok(!documentoValido('1234'));
  assert.ok(!documentoValido('1234567890123'));
  assert.ok(!documentoValido('12a45'));
});

test('analizarDocumento: motivos de error', () => {
  assert.deepEqual(analizarDocumento(''), { motivo: 'DOCUMENTO_VACIO' });
  assert.deepEqual(analizarDocumento('   '), { motivo: 'DOCUMENTO_VACIO' });
  assert.deepEqual(analizarDocumento(null), { motivo: 'DOCUMENTO_VACIO' });
  assert.deepEqual(analizarDocumento('abc'), { motivo: 'DOCUMENTO_INVALIDO' });
  assert.deepEqual(analizarDocumento('123'), { motivo: 'DOCUMENTO_INVALIDO' });
  assert.deepEqual(analizarDocumento('30.123.456'), { documento: '30123456' });
});

test('documentoDesdeNombreArchivo', () => {
  assert.equal(documentoDesdeNombreArchivo('30.123.456.jpg'), '30123456');
  assert.equal(documentoDesdeNombreArchivo('30123456.JPEG'), '30123456');
  assert.equal(documentoDesdeNombreArchivo('carpeta/30123456.png'), '30123456');
  assert.equal(documentoDesdeNombreArchivo('foto.png'), '');
});

test('documentoSchema (zod) normaliza y valida', () => {
  assert.equal(documentoSchema.parse('30.123.456'), '30123456');
  assert.equal(documentoSchema.parse(30123456), '30123456');
  assert.equal(documentoSchema.safeParse('12').success, false);
  assert.equal(documentoSchema.safeParse('').success, false);
});
