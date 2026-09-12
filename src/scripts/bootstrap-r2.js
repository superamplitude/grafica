import 'dotenv/config';
import { ensureR2Infrastructure, isR2Configured, r2Buckets } from '../lib/storage.js';

if (!isR2Configured()) {
  console.error('[R2] Configuracao incompleta.');
  process.exit(2);
}

const buckets = r2Buckets();
if (buckets.publicBucket === buckets.privateBucket) {
  console.error('[R2] Buckets publico e privado devem ser diferentes.');
  process.exit(3);
}

const result = await ensureR2Infrastructure({ origin: process.env.APP_URL });
console.log(JSON.stringify({ ok: true, provider: 'cloudflare-r2', ...result }));
