import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbStatus } from './lib/db.js';
import { registerAuth } from './plugins/auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerMediaRoutes } from './routes/media.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERSION = '3.0.0-alpha.1';

export async function buildApp() {
  const app = Fastify({ logger: true, trustProxy: true });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
    wildcard: false
  });

  await registerAuth(app);

  app.get('/api/health', async () => ({
    ok: true,
    service: 'central-prints-node',
    version: VERSION,
    database: await dbStatus(),
    auth: app.authConfigured ? 'configured' : 'unconfigured',
    timestamp: new Date().toISOString()
  }));

  app.get('/api/ready', async (_request, reply) => {
    const database = await dbStatus();
    const dbRequired = String(process.env.DB_REQUIRED ?? 'true').toLowerCase() !== 'false';
    const ready = (!dbRequired || database === 'ok') && app.authConfigured;
    return reply.code(ready ? 200 : 503).send({
      ok: ready,
      service: 'central-prints-node',
      version: VERSION,
      database,
      auth: app.authConfigured ? 'configured' : 'unconfigured',
      dbRequired,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api', async () => ({
    name: 'Central Prints API',
    version: VERSION
  }));

  await registerPublicRoutes(app);
  await registerAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerMediaRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    if (error?.message === 'DATABASE_NOT_CONFIGURED') {
      return reply.code(503).send({ error: 'DATABASE_NOT_READY' });
    }
    if (error?.message === 'R2_NOT_CONFIGURED') {
      return reply.code(503).send({ error: 'R2_NOT_READY' });
    }
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ER_ACCESS_DENIED_ERROR' || error?.code === 'ER_BAD_DB_ERROR') {
      return reply.code(503).send({ error: 'DATABASE_NOT_READY' });
    }
    const statusCode = Number(error?.statusCode || 500);
    return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 500).send({
      error: statusCode >= 500 ? 'INTERNAL_ERROR' : (error?.code || 'REQUEST_ERROR')
    });
  });

  return app;
}
