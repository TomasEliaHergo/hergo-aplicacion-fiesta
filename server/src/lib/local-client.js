// Cliente "tipo supabase-js" para el MODO LOCAL, respaldado por PGlite.
// Implementa SOLO la superficie que usan los services:
//   from(t).select(cols, {count, head}) / insert / update / upsert({onConflict}) / delete
//   filtros eq, neq, gt, gte, lt, lte, like, ilike, is, in, not, or (gramática PostgREST)
//   order(col, {ascending, nullsFirst}), range, limit, single, maybeSingle, abortSignal
//   rpc(nombre, args) ; storage.from(bucket).upload / remove / list / getPublicUrl
// Devuelve { data, error, count } con errores con forma PostgREST { code, message, details, hint }.
import { mkdir, writeFile, unlink, access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getLocalDb, FOTOS_DIR } from './local-db.js';
import { getConfig } from '../config.js';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Schema de la app ya citado ("appfiesta"), igual que db.schema en supabase-js. */
const esquema = () => qi(getConfig().DB_SCHEMA);

function qi(nombre) {
  if (!IDENT.test(nombre)) throw errorPgrst('PGRST100', `Identificador inválido: "${nombre}"`);
  return `"${nombre}"`;
}

function errorPgrst(code, message, details = null) {
  return Object.assign(new Error(message), { pgrst: { code, message, details, hint: null } });
}

function aErrorPostgrest(err) {
  if (err?.pgrst) return err.pgrst;
  return {
    code: err?.code ?? 'PGRST000',
    message: err?.message ?? 'Error desconocido',
    details: err?.detail ?? null,
    hint: err?.hint ?? null,
  };
}

/** Normaliza valores al formato JSON de PostgREST (timestamptz -> ISO string). */
function normalizarFila(fila) {
  const out = {};
  for (const [k, v] of Object.entries(fila)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

function parsearColumnas(cols) {
  const lista = String(cols ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
  if (lista.length === 0 || (lista.length === 1 && lista[0] === '*')) return '*';
  return lista.map(qi).join(', ');
}

/** Valor para parámetros: objetos/arrays (no-array de texto) como JSON. */
function valorParam(v) {
  if (v === undefined) return null;
  if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && !(v instanceof Uint8Array)) {
    return JSON.stringify(v);
  }
  return v;
}

// ---------------------------------------------------------------------
// Gramática de or=(...) de PostgREST: "a.ilike.*x*,b.eq.1,and(c.gt.2,d.is.null)"
// ---------------------------------------------------------------------
function dividirNivelSuperior(s) {
  const partes = [];
  let actual = '';
  let prof = 0;
  let comillas = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== '\\') comillas = !comillas;
    if (!comillas) {
      if (c === '(') prof++;
      else if (c === ')') prof--;
      else if (c === ',' && prof === 0) { partes.push(actual); actual = ''; continue; }
    }
    actual += c;
  }
  if (actual !== '') partes.push(actual);
  return partes.map((p) => p.trim()).filter(Boolean);
}

function desComillar(v) {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(.)/g, '$1');
  return v;
}

const OPS_SIMPLES = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };

/** Compila un filtro (col, op, valor) a SQL parametrizado. */
function compilarFiltro(col, op, valor, params, negado = false) {
  const c = qi(col);
  let sql;
  if (OPS_SIMPLES[op]) {
    let v = valor;
    if (op === 'like' || op === 'ilike') v = String(v).replace(/\*/g, '%');
    params.push(valorParam(v));
    sql = `${c} ${OPS_SIMPLES[op]} $${params.length}`;
  } else if (op === 'is') {
    const v = valor === null ? 'null' : String(valor).toLowerCase();
    if (!['null', 'true', 'false', 'unknown'].includes(v)) throw errorPgrst('PGRST100', `Valor inválido para is: ${valor}`);
    sql = `${c} is ${v}`;
  } else if (op === 'in') {
    const lista = Array.isArray(valor) ? valor : dividirNivelSuperior(String(valor).replace(/^\(|\)$/g, '')).map(desComillar);
    if (lista.length === 0) return negado ? 'true' : 'false';
    const ph = lista.map((v) => { params.push(valorParam(v)); return `$${params.length}`; });
    sql = `${c} in (${ph.join(', ')})`;
  } else {
    throw errorPgrst('PGRST100', `Operador no soportado en modo local: ${op}`);
  }
  return negado ? `not (${sql})` : sql;
}

function compilarLogica(expr, params) {
  const m = /^(not\.)?(and|or)\((.*)\)$/s.exec(expr);
  if (m) {
    const [, not, conector, cuerpo] = m;
    const sql = `(${dividirNivelSuperior(cuerpo).map((p) => compilarLogica(p, params)).join(` ${conector} `)})`;
    return not ? `not ${sql}` : sql;
  }
  const partes = expr.split('.');
  if (partes.length < 3) throw errorPgrst('PGRST100', `Filtro inválido: ${expr}`);
  const col = partes[0];
  let i = 1;
  let negado = false;
  if (partes[i] === 'not') { negado = true; i++; }
  const op = partes[i];
  const valor = desComillar(partes.slice(i + 1).join('.'));
  return compilarFiltro(col, op, valor, params, negado);
}

// ---------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------
class ConsultaLocal {
  constructor(tabla) {
    this.tabla = tabla;
    this.op = 'select';
    this.cols = '*';
    this.retorno = null; // columnas a devolver en mutaciones (null = no devolver)
    this.filtros = []; // (params) => sql
    this.ordenes = [];
    this.lim = null;
    this.off = null;
    this.modoSingle = null; // 'single' | 'maybe'
    this.conteo = null;
    this.head = false;
    this.valores = null;
    this.onConflict = null;
    this.ignorarDuplicados = false;
  }

  // --- operaciones ---
  select(cols = '*', opciones = {}) {
    if (this.op === 'select') {
      this.cols = cols;
      if (opciones.count) this.conteo = opciones.count;
      if (opciones.head) this.head = true;
    } else {
      this.retorno = cols;
    }
    return this;
  }

  insert(valores) { this.op = 'insert'; this.valores = valores; return this; }

  upsert(valores, { onConflict, ignoreDuplicates = false } = {}) {
    this.op = 'upsert';
    this.valores = valores;
    this.onConflict = onConflict ?? null;
    this.ignorarDuplicados = ignoreDuplicates;
    return this;
  }

  update(valores) { this.op = 'update'; this.valores = valores; return this; }

  delete() { this.op = 'delete'; return this; }

  // --- filtros ---
  _f(col, op, valor) { this.filtros.push((params) => compilarFiltro(col, op, valor, params)); return this; }
  eq(c, v) { return this._f(c, 'eq', v); }
  neq(c, v) { return this._f(c, 'neq', v); }
  gt(c, v) { return this._f(c, 'gt', v); }
  gte(c, v) { return this._f(c, 'gte', v); }
  lt(c, v) { return this._f(c, 'lt', v); }
  lte(c, v) { return this._f(c, 'lte', v); }
  like(c, v) { return this._f(c, 'like', v); }
  ilike(c, v) { return this._f(c, 'ilike', v); }
  is(c, v) { return this._f(c, 'is', v); }
  in(c, v) { return this._f(c, 'in', v); }
  /** .not(col, op, valor) como supabase-js, p. ej. .not('foto_path', 'is', null). */
  not(c, op, v) { this.filtros.push((params) => compilarFiltro(c, op, v, params, true)); return this; }

  or(expr) {
    this.filtros.push((params) => `(${dividirNivelSuperior(expr).map((p) => compilarLogica(p, params)).join(' or ')})`);
    return this;
  }

  // --- modificadores ---
  order(col, { ascending = true, nullsFirst } = {}) {
    let s = `${qi(col)} ${ascending ? 'asc' : 'desc'}`;
    if (nullsFirst !== undefined) s += nullsFirst ? ' nulls first' : ' nulls last';
    this.ordenes.push(s);
    return this;
  }

  limit(n) { this.lim = Math.max(0, Number(n) | 0); return this; }

  range(desde, hasta) {
    this.off = Math.max(0, Number(desde) | 0);
    this.lim = Math.max(0, (Number(hasta) | 0) - this.off + 1);
    return this;
  }

  single() { this.modoSingle = 'single'; return this; }
  maybeSingle() { this.modoSingle = 'maybe'; return this; }
  abortSignal() { return this; } // PGlite es in-process: no hay red que cortar.

  then(onOk, onErr) { return this._ejecutar().then(onOk, onErr); }

  // --- ejecución ---
  _where(params) {
    if (this.filtros.length === 0) return '';
    return ` where ${this.filtros.map((f) => f(params)).join(' and ')}`;
  }

  _construir() {
    const t = `${esquema()}.${qi(this.tabla)}`;
    const params = [];
    const ret = this.retorno !== null ? ` returning ${parsearColumnas(this.retorno)}` : '';
    switch (this.op) {
      case 'select': {
        let sql = `select ${parsearColumnas(this.cols)} from ${t}${this._where(params)}`;
        if (this.ordenes.length) sql += ` order by ${this.ordenes.join(', ')}`;
        if (this.lim !== null) sql += ` limit ${this.lim}`;
        if (this.off !== null) sql += ` offset ${this.off}`;
        let conteo = null;
        if (this.conteo) {
          const pc = [];
          conteo = { sql: `select count(*)::bigint as n from ${t}${this._where(pc)}`, params: pc };
        }
        return { sql, params, conteo };
      }
      case 'insert':
      case 'upsert': {
        const filas = Array.isArray(this.valores) ? this.valores : [this.valores];
        if (filas.length === 0) return { vacio: true };
        const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))];
        const tuplas = filas.map((f) => `(${columnas.map((c) => {
          if (!(c in f)) return 'default';
          params.push(valorParam(f[c]));
          return `$${params.length}`;
        }).join(', ')})`);
        let sql = `insert into ${t} (${columnas.map(qi).join(', ')}) values ${tuplas.join(', ')}`;
        if (this.op === 'upsert') {
          const conflicto = (this.onConflict ?? 'id').split(',').map((s) => s.trim()).filter(Boolean);
          const setCols = columnas.filter((c) => !conflicto.includes(c));
          sql += ` on conflict (${conflicto.map(qi).join(', ')})`;
          sql += this.ignorarDuplicados || setCols.length === 0
            ? ' do nothing'
            : ` do update set ${setCols.map((c) => `${qi(c)} = excluded.${qi(c)}`).join(', ')}`;
        }
        return { sql: sql + ret, params };
      }
      case 'update': {
        const sets = Object.entries(this.valores ?? {}).map(([c, v]) => { params.push(valorParam(v)); return `${qi(c)} = $${params.length}`; });
        if (sets.length === 0) throw errorPgrst('PGRST100', 'update sin columnas');
        return { sql: `update ${t} set ${sets.join(', ')}${this._where(params)}${ret}`, params };
      }
      case 'delete':
        return { sql: `delete from ${t}${this._where(params)}${ret}`, params };
      default:
        throw errorPgrst('PGRST100', `Operación no soportada: ${this.op}`);
    }
  }

  async _ejecutar() {
    try {
      const db = await getLocalDb();
      const q = this._construir();
      if (q.vacio) return { data: this.retorno !== null ? [] : null, error: null, count: null, status: 201 };

      let count = null;
      if (q.conteo) count = Number((await db.query(q.conteo.sql, q.conteo.params)).rows[0].n);

      let filas = [];
      if (!(this.op === 'select' && this.head)) {
        filas = (await db.query(q.sql, q.params)).rows.map(normalizarFila);
      }

      let data;
      if (this.op === 'select') data = this.head ? null : filas;
      else data = this.retorno !== null ? filas : null;

      if (this.modoSingle && data !== null) {
        if (data.length === 1) data = data[0];
        else if (data.length === 0 && this.modoSingle === 'maybe') data = null;
        else {
          return {
            data: null, count: null, status: 406,
            error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${data.length} rows`, hint: null },
          };
        }
      }
      return { data, error: null, count, status: 200 };
    } catch (err) {
      return { data: null, error: aErrorPostgrest(err), count: null, status: 400 };
    }
  }
}

// ---------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------
const cacheFunciones = new Map();

async function infoFuncion(db, nombre) {
  if (cacheFunciones.has(nombre)) return cacheFunciones.get(nombre);
  const { rows } = await db.query(
    `select p.proretset as retset, t.typtype as typtype
       from pg_proc p join pg_type t on t.oid = p.prorettype
      where p.proname = $1 and p.pronamespace = $2::regnamespace
      limit 1`,
    [nombre, getConfig().DB_SCHEMA],
  );
  if (!rows[0]) throw errorPgrst('PGRST202', `Could not find the function ${getConfig().DB_SCHEMA}.${nombre}`);
  cacheFunciones.set(nombre, rows[0]);
  return rows[0];
}

class RpcLocal {
  constructor(nombre, args) { this.nombre = nombre; this.args = args ?? {}; }
  abortSignal() { return this; }
  then(onOk, onErr) { return this._ejecutar().then(onOk, onErr); }

  async _ejecutar() {
    try {
      const db = await getLocalDb();
      const info = await infoFuncion(db, this.nombre);
      const params = [];
      const args = Object.entries(this.args).map(([k, v]) => { params.push(valorParam(v)); return `${qi(k)} => $${params.length}`; });
      const { rows } = await db.query(`select * from ${esquema()}.${qi(this.nombre)}(${args.join(', ')})`, params);
      const filas = rows.map(normalizarFila);
      let data;
      if (info.retset) data = filas;                       // returns table / setof -> array
      else if (info.typtype === 'c') data = filas[0] ?? null; // compuesto -> objeto
      else data = filas[0] ? Object.values(filas[0])[0] : null; // escalar
      return { data, error: null, count: null, status: 200 };
    } catch (err) {
      return { data: null, error: aErrorPostgrest(err), count: null, status: 400 };
    }
  }
}

// ---------------------------------------------------------------------
// Storage local: server/.data/<bucket>/<path>, URL pública relativa /<bucket>/<path>
// ---------------------------------------------------------------------
function rutaSegura(bucket, archivo) {
  const base = bucket === 'fotos' ? FOTOS_DIR : path.join(path.dirname(FOTOS_DIR), bucket);
  const destino = path.resolve(base, archivo);
  if (!destino.startsWith(base + path.sep)) throw new Error(`Path inválido: ${archivo}`);
  return destino;
}

function storageBucket(bucket) {
  return {
    async upload(archivo, contenido, { upsert = false } = {}) {
      try {
        const destino = rutaSegura(bucket, archivo);
        if (!upsert) {
          const existe = await access(destino).then(() => true, () => false);
          if (existe) return { data: null, error: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } };
        }
        await mkdir(path.dirname(destino), { recursive: true });
        await writeFile(destino, contenido);
        return { data: { path: archivo, fullPath: `${bucket}/${archivo}` }, error: null };
      } catch (err) {
        return { data: null, error: { statusCode: '500', error: 'Error', message: err.message } };
      }
    },
    async remove(archivos) {
      const borrados = [];
      try {
        for (const a of archivos) {
          try {
            await unlink(rutaSegura(bucket, a));
            borrados.push({ name: a });
          } catch (err) {
            if (err.code !== 'ENOENT') throw err;
          }
        }
        return { data: borrados, error: null };
      } catch (err) {
        return { data: null, error: { statusCode: '500', error: 'Error', message: err.message } };
      }
    },
    /**
     * Como supabase-js: lista UN nivel de la "carpeta" prefijo, ordenado por nombre.
     * Carpetas => { name, id: null, metadata: null }; archivos => id y metadata.size.
     */
    async list(prefijo = '', { limit = 100, offset = 0 } = {}) {
      try {
        const base = bucket === 'fotos' ? FOTOS_DIR : path.join(path.dirname(FOTOS_DIR), bucket);
        const dir = prefijo ? rutaSegura(bucket, prefijo) : base;
        let entradas;
        try {
          entradas = await readdir(dir, { withFileTypes: true });
        } catch (err) {
          if (err.code === 'ENOENT') return { data: [], error: null };
          throw err;
        }
        entradas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const pagina = entradas.slice(offset, offset + limit);
        const data = await Promise.all(pagina.map(async (e) => {
          if (e.isDirectory()) return { name: e.name, id: null, metadata: null };
          const st = await stat(path.join(dir, e.name));
          return { name: e.name, id: `${prefijo ? `${prefijo}/` : ''}${e.name}`, metadata: { size: st.size } };
        }));
        return { data, error: null };
      } catch (err) {
        return { data: null, error: { statusCode: '500', error: 'Error', message: err.message } };
      }
    },
    getPublicUrl(archivo) {
      const p = String(archivo).split('/').map(encodeURIComponent).join('/');
      return { data: { publicUrl: `/${bucket}/${p}` } };
    },
  };
}

export function crearClienteLocal() {
  return {
    from: (tabla) => new ConsultaLocal(tabla),
    rpc: (nombre, args) => new RpcLocal(nombre, args),
    storage: { from: storageBucket },
  };
}
