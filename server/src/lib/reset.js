// Helpers puros de scripts/reset-datos.js (testeables sin base ni red).

/** Texto que hay que tipear para confirmar el borrado. */
export const FRASE_CONFIRMACION = 'BORRAR TODO';

/** Ref del proyecto de Supabase a partir de la URL (https://abcd.supabase.co -> abcd); si no es *.supabase.co, el host. */
export function refProyecto(url) {
  try {
    const host = new URL(url).hostname;
    const m = /^([a-z0-9-]+)\.supabase\.(co|in|net)$/i.exec(host);
    return m ? m[1] : host;
  } catch {
    return '(URL inválida)';
  }
}

/** Parte un array en trozos de n. */
export function trozos(lista, n) {
  const out = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

const unir = (prefijo, nombre) => (prefijo ? `${prefijo}/${nombre}` : nombre);

/**
 * Lista TODOS los archivos de un bucket recorriendo "carpetas" (Storage API: list()
 * devuelve un nivel; carpetas con id null). Pagina con limit/offset y recorre las
 * subcarpetas con concurrencia acotada.
 * @param {(prefijo:string, opts:{limit:number, offset:number}) => Promise<{data:any[]|null, error:any}>} listar
 * @returns {Promise<string[]>} paths completos de archivos
 */
export async function listarArchivosRecursivo(listar, { prefijo = '', limite = 100, concurrencia = 8 } = {}) {
  const archivos = [];
  const pendientes = [prefijo];
  let error = null;

  async function listarCarpeta(carpeta) {
    for (let offset = 0; ; offset += limite) {
      const { data, error: err } = await listar(carpeta, { limit: limite, offset });
      if (err) throw Object.assign(new Error(`No se pudo listar "${carpeta || '/'}": ${err.message ?? err}`), { cause: err });
      for (const item of data ?? []) {
        const ruta = unir(carpeta, item.name);
        if (item.id === null || item.id === undefined) pendientes.push(ruta); // carpeta
        else archivos.push(ruta);
      }
      if (!data || data.length < limite) break;
    }
  }

  // Pool simple: cada worker toma carpetas de la cola hasta vaciarla.
  let activos = 0;
  await new Promise((resolve) => {
    const lanzar = () => {
      if (error) { if (activos === 0) resolve(); return; }
      while (activos < concurrencia && pendientes.length) {
        const carpeta = pendientes.shift();
        activos++;
        listarCarpeta(carpeta)
          .catch((e) => { error = error ?? e; })
          .finally(() => { activos--; lanzar(); });
      }
      if (activos === 0 && (pendientes.length === 0 || error)) resolve();
    };
    lanzar();
  });
  if (error) throw error;
  return archivos.sort();
}
