import { buildApp } from '../app.js';

const app = await buildApp();

try {
  await app.ready();
  console.log('[SMOKE] Fastify pronto; rotas e plugins validados.');
} finally {
  await app.close();
}
