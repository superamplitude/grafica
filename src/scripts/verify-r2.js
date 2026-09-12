import 'dotenv/config';
import crypto from 'node:crypto';
import { deleteObject, headObject, isR2Configured, putObject, r2Status, signedReadUrl } from '../lib/storage.js';

if (!isR2Configured()) {
  console.error('[R2] Configuracao incompleta. Defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET.');
  process.exit(2);
}

const key = `ops/probes/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.txt`;
const body = Buffer.from(`central-prints-r2-probe:${crypto.randomUUID()}\n`, 'utf8');
let uploaded = false;

try {
  const status = await r2Status();
  if (status !== 'ok') throw new Error(`R2_BUCKET_STATUS_${status.toUpperCase()}`);

  await putObject({
    key,
    body,
    contentType: 'text/plain',
    cacheControl: 'no-store',
    metadata: { 'cp-kind': 'ops-probe', 'cp-visibility': 'private' }
  });
  uploaded = true;

  const remote = await headObject(key);
  if (remote.size !== body.length) throw new Error(`R2_SIZE_MISMATCH:${remote.size}:${body.length}`);
  if (remote.metadata?.['cp-kind'] !== 'ops-probe') throw new Error('R2_METADATA_MISMATCH');

  const url = await signedReadUrl(key, 120);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`R2_SIGNED_GET_HTTP_${response.status}`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  if (!downloaded.equals(body)) throw new Error('R2_CONTENT_MISMATCH');

  console.log(JSON.stringify({
    ok: true,
    provider: 'cloudflare-r2',
    bucket: process.env.R2_BUCKET,
    probe: 'put-head-signed-get-delete',
    size: remote.size
  }));
} finally {
  if (uploaded) {
    try { await deleteObject(key); } catch (error) { console.error('[R2] Falha ao remover probe:', error?.message || error); process.exitCode = 3; }
  }
}
