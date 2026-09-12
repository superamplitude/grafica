import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { getDb } from '../lib/db.js';

export async function registerAuth(app) {
  await app.register(rateLimit, {
    global: false,
    max: 120,
    timeWindow: '1 minute'
  });

  const secret = String(process.env.JWT_SECRET || '');
  if (secret.length >= 32) {
    await app.register(fastifyJwt, {
      secret,
      sign: { expiresIn: '8h' }
    });
  }

  app.decorate('authConfigured', secret.length >= 32);

  app.decorate('authenticate', async function authenticate(request, reply) {
    if (!app.authConfigured) {
      return reply.code(503).send({ error: 'AUTH_NOT_CONFIGURED' });
    }
    try {
      await request.jwtVerify();
      const jti = request.user?.jti;
      if (!jti) return reply.code(401).send({ error: 'TOKEN_INVALID' });
      const db = getDb();
      const [rows] = await db.execute('SELECT 1 FROM revoked_tokens WHERE jti=? LIMIT 1', [jti]);
      if (rows.length) return reply.code(401).send({ error: 'TOKEN_REVOKED' });
    } catch (error) {
      request.log.warn({ err: error }, 'Falha de autenticacao');
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
  });

  app.decorate('requireRole', function requireRole(...roles) {
    return async function roleGuard(request, reply) {
      const result = await app.authenticate(request, reply);
      if (reply.sent) return result;
      if (!roles.includes(request.user?.role)) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }
    };
  });
}
