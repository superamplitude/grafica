import 'dotenv/config';
import { buildApp } from './app.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3005);
const app = await buildApp();

try {
  await app.listen({ host, port });
  app.log.info(`Central Prints ouvindo em ${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
