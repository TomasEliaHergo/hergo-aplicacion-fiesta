import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { limiteLogin } from '../middleware/rateLimits.js';
import { firmarToken } from '../lib/jwt.js';
import * as usuarios from '../services/usuarios.service.js';

const router = Router();

const loginBody = z.object({
  username: z.string().trim().min(1, 'Usuario requerido').max(100),
  password: z.string().min(1, 'Contraseña requerida').max(200),
});

router.post('/login', limiteLogin(), validate({ body: loginBody }), async (req, res) => {
  const { username, password } = req.valid.body;
  try {
    const usuario = await usuarios.login(username, password);
    const { token, expiraEn } = firmarToken(usuario);
    req.log.info({ usuarioId: usuario.id }, 'Login OK');
    res.json({ token, expiraEn, usuario });
  } catch (err) {
    if (err.error === 'CREDENCIALES_INVALIDAS') req.log.warn({ username }, 'Login fallido');
    throw err;
  }
});

router.get('/me', requireAuth(), async (req, res) => {
  res.json(await usuarios.obtener(req.usuario.id));
});

export default router;
