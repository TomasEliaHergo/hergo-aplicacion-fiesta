// Genera scripts/ejemplo-empleados.xlsx con 10 empleados ficticios para probar el import.
// Usa encabezados "reales" (DNI, Apellido y Nombre, ...) para ejercitar la normalización/sinónimos.
import * as XLSX from 'xlsx';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const destino = path.join(__dirname, 'ejemplo-empleados.xlsx');

const filas = [
  ['DNI', 'Apellido y Nombre', 'Empresa', 'Sector'],
  [30123456, 'Pérez, Ana', 'Hergo', 'Ventas'],
  ['31.234.567', 'Gómez, Juan Carlos', 'Hergo', 'Logística'],
  [28987654, 'Fernández,  María  José', 'Hergo', 'Administración'],
  ['20-33444555-6', 'López, Martín', 'Hergo Servicios', 'Sistemas'],
  [35111222, 'Rodríguez, Lucía', 'Hergo Servicios', 'Sistemas'],
  [27333444, 'Martínez, Diego', 'Hergo', 'Ventas'],
  [40555666, 'Sánchez, Valentina', 'Hergo Servicios', 'RRHH'],
  [33777888, 'Romero, Nicolás', 'Hergo', 'Depósito'],
  [29888999, 'Díaz, Camila', 'Hergo', 'Logística'],
  [36000111, 'Álvarez, Tomás', 'Hergo Servicios', 'Mantenimiento'],
];

const ws = XLSX.utils.aoa_to_sheet(filas);
ws['!cols'] = [{ wch: 16 }, { wch: 30 }, { wch: 20 }, { wch: 18 }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Empleados');
writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`Generado ${destino} (${filas.length - 1} empleados)`);
