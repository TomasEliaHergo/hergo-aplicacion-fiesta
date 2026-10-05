import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { idParams, queryOpcional, booleanQuery, usernameSchema, passwordSchema, rolSchema, nombreSchema } from '../lib/schemas.js';
import * as usuarios from '../services/usuarios.service.js';

const router = Router();
router.use(requireAuth(['rrhh']));

const listaQuery = z.object({ rol: queryOpcional(rolSchema), activo: queryOpcional(booleanQuery) });
const crearBody = z.object({ username: usernameSchema, nombre: nombreSchema, rol: rolSchema, password: passwordSchema });
const actualizarBody = z.object({ nombre: nombreSchema.optional(), rol: rolSchema.optional(), activo: z.boolean().optional() });

router.get('/', validate({ query: listaQuery }), async (req, res) => {
  res.json(await usuarios.listar(req.valid.query));
});

router.post('/', validate({ body: crearBody }), async (req, res) => {
  const u = await usuarios.crear(req.valid.body);
  req.log.info({ usuarioCreado: u.id, rol: u.rol }, 'Usuario creado');
  res.status(201).json(u);
});

router.put('/:id', validate({ params: idParams, body: actualizarBody }), async (req, res) => {
  const u = await usuarios.actualizar(req.valid.params.id, req.valid.body, req.usuario);
  req.log.info({ usuarioModificado: u.id, cambios: req.valid.body }, 'Usuario actualizado');
  res.json(u);
});

router.post('/:id/password', validate({ params: idParams, body: z.object({ password: passwordSchema }) }), async (req, res) => {
  await usuarios.cambiarPassword(req.valid.params.id, req.valid.body.password);
  req.log.info({ usuarioModificado: req.valid.params.id }, 'Password cambiada');
  res.status(204).end();
});

export default router;
