import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseArchivo,
  normalizarNombre,
  normalizarBaseArchivo,
  documentoDeArchivo,
  crearIndice,
  resolverArchivo,
  resolverLote,
} from '../src/lib/foto-match.js';

const EMPLEADOS = [
  { id: 'e1', documento: '44860787', nombre: 'ABIUS JOAQUIN' },
  { id: 'e2', documento: '30111222', nombre: 'ACHA CRISTIAN EZEQUIEL' },
  { id: 'e3', documento: '28999888', nombre: 'ABIUS SERGIO JAVIER' },
  { id: 'e4', documento: '33444555', nombre: 'MUÑOZ JOSÉ MARÍA' },
  { id: 'e5', documento: '20334445556', nombre: 'GOMEZ ANA' }, // CUIT
  { id: 'e6', documento: '11111111', nombre: 'PEREZ JUAN' },
  { id: 'e7', documento: '22222222', nombre: 'PEREZ JUAN' }, // homónimo exacto
  { id: 'e8', documento: '33333333', nombre: 'LOPEZ MARIA' },
  { id: 'e9', documento: '44444444', nombre: 'MARIA LOPEZ' }, // mismas palabras, otro orden
];
const indice = crearIndice(EMPLEADOS);
const doc = (archivo) => {
  const r = resolverArchivo(archivo, indice);
  return r.motivo ?? `${r.empleado.documento}:${r.via}`;
};

test('baseArchivo: quita carpeta y extensión', () => {
  assert.equal(baseArchivo('ABIUS JOAQUIN.jpg'), 'ABIUS JOAQUIN');
  assert.equal(baseArchivo('carpeta/sub\\30.123.456.png'), '30.123.456');
  assert.equal(baseArchivo('sinext'), 'sinext');
});

test('normalizarNombre: minúsculas, sin acentos, separadores y espacios', () => {
  assert.equal(normalizarNombre('  MUÑOZ   José_María '), 'munoz jose maria');
  assert.equal(normalizarNombre('Acha-Cristian.Ezequiel,'), 'acha cristian ezequiel');
});

test('normalizarBaseArchivo: quita marcas de copia', () => {
  assert.equal(normalizarBaseArchivo('ABIUS JOAQUIN (1)'), 'abius joaquin');
  assert.equal(normalizarBaseArchivo('ABIUS JOAQUIN - copia'), 'abius joaquin');
  assert.equal(normalizarBaseArchivo('ABIUS JOAQUIN - copia (2)'), 'abius joaquin');
  assert.equal(normalizarBaseArchivo('abius joaquin copy'), 'abius joaquin');
  assert.equal(normalizarBaseArchivo('Copia de ABIUS JOAQUIN'), 'abius joaquin');
});

test('documentoDeArchivo: 5 a 12 dígitos con o sin separadores', () => {
  assert.equal(documentoDeArchivo('30123456.jpg'), '30123456');
  assert.equal(documentoDeArchivo('30.123.456.JPG'), '30123456');
  assert.equal(documentoDeArchivo('20-33444555-6.png'), '20334445556'); // CUIT 11 dígitos
  assert.equal(documentoDeArchivo('30123456 (1).jpg'), '30123456');
  assert.equal(documentoDeArchivo('1234.jpg'), null);
  assert.equal(documentoDeArchivo('ABIUS JOAQUIN.jpg'), null);
});

test('match por documento (incluye CUIT de 11 dígitos)', () => {
  assert.equal(doc('44860787.jpg'), '44860787:documento');
  assert.equal(doc('44.860.787.jpeg'), '44860787:documento');
  assert.equal(doc('20-33444555-6.jpg'), '20334445556:documento');
  assert.equal(doc('20334445556.webp'), '20334445556:documento');
  assert.equal(doc('99999999.jpg'), 'DOCUMENTO_NO_EXISTE');
});

test('match exacto por nombre, sin importar mayúsculas ni extensión', () => {
  assert.equal(doc('ABIUS JOAQUIN.jpg'), '44860787:nombre');
  assert.equal(doc('acha cristian ezequiel.JPG'), '30111222:nombre');
});

test('acentos y ñ', () => {
  assert.equal(doc('munoz jose maria.png'), '33444555:nombre');
  assert.equal(doc('MUÑOZ JOSÉ MARÍA.png'), '33444555:nombre');
});

test('orden de palabras invertido', () => {
  assert.equal(doc('Joaquin Abius.jpg'), '44860787:nombre');
  assert.equal(doc('Sergio Javier Abius.png'), '28999888:nombre');
});

test('espacios de más y guiones bajos', () => {
  assert.equal(doc('  ABIUS__JOAQUIN   .jpg'), '44860787:nombre');
  assert.equal(doc('acha_cristian-ezequiel.jpg'), '30111222:nombre');
  assert.equal(doc('ACHA  CRISTIAN    EZEQUIEL.jpg'), '30111222:nombre');
});

test('sufijo de copia "(1)"', () => {
  assert.equal(doc('ABIUS JOAQUIN (1).jpg'), '44860787:nombre');
  assert.equal(doc('ABIUS JOAQUIN - copia.jpg'), '44860787:nombre');
});

test('sin coincidencia aproximada', () => {
  assert.equal(doc('NADIE INEXISTENTE.jpg'), 'SIN_COINCIDENCIA');
  assert.equal(doc('ABIUS JOAQIN.jpg'), 'SIN_COINCIDENCIA'); // typo: no se adivina
  assert.equal(doc('ABIUS.jpg'), 'SIN_COINCIDENCIA'); // palabras de menos
  assert.equal(doc('ABIUS JOAQUIN MARTIN.jpg'), 'SIN_COINCIDENCIA'); // palabras de más
  assert.equal(doc('foto.jpg'), 'SIN_COINCIDENCIA');
});

test('ambigüedad: homónimos exactos', () => {
  assert.equal(doc('PEREZ JUAN.jpg'), 'AMBIGUO (documentos 11111111, 22222222)');
  assert.equal(doc('juan perez.jpg'), 'AMBIGUO (documentos 11111111, 22222222)');
});

test('ambigüedad: mismas palabras en distinto orden en dos empleados', () => {
  // Coincidencia exacta gana sobre "mismas palabras".
  assert.equal(doc('LOPEZ MARIA.jpg'), '33333333:nombre');
  assert.equal(doc('MARIA LOPEZ.jpg'), '44444444:nombre');
  // El separador se normaliza antes de comparar: sigue siendo coincidencia exacta.
  assert.equal(doc('maria_lopez.jpg'), '44444444:nombre');
  const idx = crearIndice([
    { id: 'a', documento: '1000001', nombre: 'LOPEZ MARIA' },
    { id: 'b', documento: '1000002', nombre: 'MARIA LOPEZ' },
  ]);
  assert.equal(resolverArchivo('Lopez  maria (1).jpg', idx).empleado.documento, '1000001');
  // Ninguna exacta, y por "mismas palabras" hay dos candidatos -> AMBIGUO.
  const ind = crearIndice([
    { id: 'a', documento: '1000001', nombre: 'LOPEZ ANA MARIA' },
    { id: 'b', documento: '1000002', nombre: 'MARIA ANA LOPEZ' },
  ]);
  assert.equal(resolverArchivo('ana lopez maria.jpg', ind).motivo, 'AMBIGUO (documentos 1000001, 1000002)');
});

test('lote: duplicados del mismo empleado (nombre y documento) -> DUPLICADO_EN_LOTE', () => {
  const r = resolverLote([
    'ABIUS JOAQUIN.jpg',
    'acha cristian ezequiel.JPG',
    'Sergio Javier Abius.png',
    '44860787.jpg', // mismo empleado que el primero
    'joaquin abius (1).jpg', // otra vez el mismo
    'NADIE INEXISTENTE.jpg',
  ], indice);
  assert.deepEqual(r.asignados.map((a) => [a.archivo, a.empleado.documento, a.via]), [
    ['ABIUS JOAQUIN.jpg', '44860787', 'nombre'],
    ['acha cristian ezequiel.JPG', '30111222', 'nombre'],
    ['Sergio Javier Abius.png', '28999888', 'nombre'],
  ]);
  assert.deepEqual(r.errores.map((e) => [e.archivo, e.motivo]), [
    ['44860787.jpg', 'DUPLICADO_EN_LOTE'],
    ['joaquin abius (1).jpg', 'DUPLICADO_EN_LOTE'],
    ['NADIE INEXISTENTE.jpg', 'SIN_COINCIDENCIA'],
  ]);
});
