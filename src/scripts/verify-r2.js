import 'dotenv/config';
import crypto from 'node:crypto';
import { deleteObject, headObject, isR2Configured, publicObjectUrl, putObject, r2Buckets, r2Status, signedReadUrl } from '../lib/storage.js';

if (!isR2Configured()) {
  console.error('[R2] Configuracao incompleta. Defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BUCKET e R2_PRIVATE_BUCKET.');
  process.exit(2);
}

const id = crypto.randomUUID();
const date = new Date().toISOString().slice(0,10);
const publicKey = `products/photos/ops-probe/${date}/${id}.txt`;
const privateKey = `ops/probes/${date}/${id}.txt`;
const publicBody = Buffer.from(`central-prints-r2-public:${id}\n`, 'utf8');
const privateBody = Buffer.from(`central-prints-r2-private:${id}\n`, 'utf8');
const uploaded = [];

async function verifySigned(key, body, visibility) {
  const remote = await headObject(key);
  if (remote.size !== body.length) throw new Error(`R2_${visibility.toUpperCase()}_SIZE_MISMATCH:${remote.size}:${body.length}`);
  if (remote.metadata?.['cp-visibility'] !== visibility) throw new Error(`R2_${visibility.toUpperCase()}_METADATA_MISMATCH`);
  const url = await signedReadUrl(key, 120);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`R2_${visibility.toUpperCase()}_SIGNED_GET_HTTP_${response.status}`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  if (!downloaded.equals(body)) throw new Error(`R2_${visibility.toUpperCase()}_CONTENT_MISMATCH`);
  return remote;
}

try {
  const status = await r2Status();
  if (status !== 'ok') throw new Error(`R2_BUCKET_STATUS_${status.toUpperCase()}`);
  const buckets = r2Buckets();
  if (buckets.publicBucket === buckets.privateBucket) throw new Error('R2_BUCKETS_MUST_BE_DISTINCT');

  await putObject({ key: publicKey, body: publicBody, contentType: 'text/plain', cacheControl: 'no-store', metadata: { 'cp-kind': 'ops-probe', 'cp-visibility': 'public' } });
  uploaded.push(publicKey);
  await putObject({ key: privateKey, body: privateBody, contentType: 'text/plain', cacheControl: 'no-store', metadata: { 'cp-kind': 'ops-probe', 'cp-visibility': 'private' } });
  uploaded.push(privateKey);

  const publicRemote = await verifySigned(publicKey, publicBody, 'public');
  const privateRemote = await verifySigned(privateKey, privateBody, 'private');

  let publicHttp = null;
  const publicUrl = publicObjectUrl(publicKey);
  if (publicUrl) {
    const response = await fetch(publicUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    publicHttp = response.status;
    if (!response.ok) throw new Error(`R2_PUBLIC_BASE_HTTP_${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.equals(publicBody)) throw new Error('R2_PUBLIC_BASE_CONTENT_MISMATCH');
  }

  console.log(JSON.stringify({
    ok: true,
    provider: 'cloudflare-r2',
    buckets,
    publicBaseUrlConfigured: Boolean(process.env.R2_PUBLIC_BASE_URL),
    publicHttp,
    probe: 'public+private:put-head-signed-get-delete',
    publicSize: publicRemote.size,
    privateSize: privateRemote.size
  }));
} finally {
  for (const key of uploaded.reverse()) {
    try { await deleteObject(key); } catch (error) { console.error('[R2] Falha ao remover probe:', key, error?.message || error); process.exitCode = 3; }
  }
}
