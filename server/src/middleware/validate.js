import { errores } from '../lib/errors.js';

export function zodADetalles(issues) {
  return issues.map((i) => ({ campo: i.path.length ? i.path.join('.') : 'general', motivo: i.message }));
}

/**
 * Valida req.body / req.query / req.params con zod. Resultado en req.valid.{body,query,params}.
 * (Express 5: req.query es de solo lectura, por eso se usa req.valid.)
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid ?? {};
    const detalles = [];
    for (const parte of ['params', 'query', 'body']) {
      if (!schemas[parte]) continue;
      const r = schemas[parte].safeParse(req[parte] ?? {});
      if (r.success) req.valid[parte] = r.data;
      else detalles.push(...zodADetalles(r.error.issues));
    }
    if (detalles.length) throw errores.validacion(detalles);
    next();
  };
}
