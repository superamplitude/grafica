import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbStatus } from './lib/db.js';

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

  app.get('/api/health', async () => ({
    ok: true,
    service: 'central-prints-node',
    version: VERSION,
    database: await dbStatus(),
    timestamp: new Date().toISOString()
  }));

  app.get('/api/ready', async (_request, reply) => {
    const database = await dbStatus();
    const dbRequired = String(process.env.DB_REQUIRED ?? 'true').toLowerCase() !== 'false';
    const ready = !dbRequired || database === 'ok';
    return reply.code(ready ? 200 : 503).send({
      ok: ready,
      service: 'central-prints-node',
      version: VERSION,
      database,
      dbRequired,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api', async () => ({
    name: 'Central Prints API',
    version: VERSION
  }));

  return app;
}
