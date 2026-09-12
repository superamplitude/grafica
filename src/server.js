import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPing } from './lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = Fastify({ logger: true, trustProxy: true });

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: true, credentials: true });
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
  wildcard: false
});

app.get('/api/health', async () => {
  let database = 'not-configured';
  try {
    database = await dbPing() ? 'ok' : 'error';
  } catch {
    database = 'error';
  }
  return {
    ok: database !== 'error',
    service: 'central-prints-node',
    version: '3.0.0-alpha.1',
    database,
    timestamp: new Date().toISOString()
  };
});

app.get('/api', async () => ({
  name: 'Central Prints API',
  version: '3.0.0-alpha.1'
}));

app.get('/', async (_request, reply) => reply.sendFile('index.html'));

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3210);

try {
  await app.listen({ host, port });
  app.log.info(`Central Prints ouvindo em ${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
