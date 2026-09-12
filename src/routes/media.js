import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { headObject, R2_PREFIXES, r2Buckets, r2Status, signedReadUrl, signedUploadUrl } from '../lib/storage.js';

const kinds = ['product-photo','thumbnail','mockup','template','artwork-original','artwork-preview','artwork-approved','proof','production'];
const kindEnum = z.enum(kinds);

const uploadSchema = z.object({
  kind: kindEnum,
  filename: z.string().min(1).max(255),
  contentType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive().optional(),
  visibility: z.enum(['public','private']).optional()
});

const confirmSchema = z.object({
  kind: kindEnum,
  key: z.string().min(3).max(500),
  originalName: z.string().max(255).nullable().optional(),
  visibility: z.enum(['public','private']).optional(),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const MB = 1024 * 1024;
const kindConfig = Object.freeze({
  'product-photo': { prefix: R2_PREFIXES.PRODUCT_PHOTOS, visibility: 'public', maxBytes: 25*MB, types: ['image/jpeg','image/png','image/webp','image/avif'] },
  thumbnail: { prefix: R2_PREFIXES.THUMBNAILS, visibility: 'public', maxBytes: 10*MB, types: ['image/jpeg','image/png','image/webp','image/avif'] },
  mockup: { prefix: R2_PREFIXES.MOCKUPS, visibility: 'public', maxBytes: 40*MB, types: ['image/jpeg','image/png','image/webp','image/avif'] },
  template: { prefix: R2_PREFIXES.TEMPLATES, visibility: 'public', maxBytes: 250*MB, types: ['application/pdf','image/svg+xml','application/postscript','application/zip','application/x-zip-compressed','application/octet-stream'] },
  'artwork-original': { prefix: R2_PREFIXES.ARTWORK_ORIGINALS, visibility: 'private', maxBytes: 750*MB, types: ['application/pdf','image/jpeg','image/png','image/tiff','image/svg+xml','application/postscript','application/zip','application/x-zip-compressed','application/octet-stream'] },
  'artwork-preview': { prefix: R2_PREFIXES.ARTWORK_PREVIEWS, visibility: 'private', maxBytes: 50*MB, types: ['image/jpeg','image/png','image/webp','application/pdf'] },
  'artwork-approved': { prefix: R2_PREFIXES.ARTWORK_APPROVED, visibility: 'private', maxBytes: 750*MB, types: ['application/pdf','image/jpeg','image/png','image/tiff','image/svg+xml','application/postscript','application/zip','application/x-zip-compressed','application/octet-stream'] },
  proof: { prefix: R2_PREFIXES.PROOFS, visibility: 'private', maxBytes: 150*MB, types: ['application/pdf','image/jpeg','image/png','image/webp'] },
  production: { prefix: R2_PREFIXES.PRODUCTION, visibility: 'private', maxBytes: 1024*MB, types: ['application/pdf','image/jpeg','image/png','image/tiff','image/svg+xml','application/postscript','application/zip','application/x-zip-compressed','application/octet-stream'] }
});

function safeExtension(filename) {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return ext.length <= 12 ? ext : '';
}

function normalizeContentType(value) {
  return String(value || '').split(';',1)[0].trim().toLowerCase();
}

function validateMediaContract({ kind, key, visibility, contentType, sizeBytes }) {
  const config = kindConfig[kind];
  if (!config) return 'INVALID_MEDIA_KIND';
  if (key && !String(key).startsWith(`${config.prefix}/`)) return 'MEDIA_KEY_PREFIX_MISMATCH';
  if (visibility && visibility !== config.visibility) return 'MEDIA_VISIBILITY_MISMATCH';
  const normalizedType = normalizeContentType(contentType);
  if (normalizedType && !config.types.includes(normalizedType)) return 'MEDIA_CONTENT_TYPE_NOT_ALLOWED';
  if (Number.isFinite(Number(sizeBytes)) && Number(sizeBytes) > config.maxBytes) return 'MEDIA_TOO_LARGE';
  return null;
}

export async function registerMediaRoutes(app) {
  const mediaStaff = app.requireRole('super_admin','admin','prepress','operations');

  app.get('/api/v1/admin/storage/status', { preHandler: mediaStaff }, async () => ({
    provider: 'cloudflare-r2',
    status: await r2Status(),
    buckets: r2Buckets(),
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || null
  }));

  app.get('/api/v1/admin/media/:id/read-url', { preHandler: mediaStaff }, async (request, reply) => {
    if (await r2Status() !== 'ok') return reply.code(503).send({ error: 'R2_NOT_READY' });
    const db = getDb();
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'INVALID_MEDIA_ID' });
    const [rows] = await db.execute('SELECT id,kind,visibility,object_key,original_name,mime_type,size_bytes FROM media_objects WHERE id=? LIMIT 1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'MEDIA_NOT_FOUND' });
    return { media: rows[0], url: await signedReadUrl(rows[0].object_key, 600), expiresIn: 600 };
  });

  app.post('/api/v1/admin/media/upload-intent', { preHandler: mediaStaff }, async (request, reply) => {
    const parsed = uploadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_UPLOAD_INTENT' });
    if (await r2Status() !== 'ok') return reply.code(503).send({ error: 'R2_NOT_READY' });

    const config = kindConfig[parsed.data.kind];
    const contractError = validateMediaContract({
      kind: parsed.data.kind,
      visibility: parsed.data.visibility,
      contentType: parsed.data.contentType,
      sizeBytes: parsed.data.sizeBytes
    });
    if (contractError) return reply.code(400).send({ error: contractError });

    const now = new Date();
    const partition = `${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}`;
    const key = `${config.prefix}/${partition}/${crypto.randomUUID()}${safeExtension(parsed.data.filename)}`;
    const uploadUrl = await signedUploadUrl({
      key,
      contentType: normalizeContentType(parsed.data.contentType),
      expiresIn: 900,
      metadata: {
        'cp-kind': parsed.data.kind,
        'cp-visibility': config.visibility
      }
    });
    return { key, uploadUrl, expiresIn: 900, visibility: config.visibility, maxBytes: config.maxBytes };
  });

  app.post('/api/v1/admin/media/confirm', { preHandler: mediaStaff }, async (request, reply) => {
    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_MEDIA_CONFIRMATION' });
    const config = kindConfig[parsed.data.kind];
    const requestedContractError = validateMediaContract({
      kind: parsed.data.kind,
      key: parsed.data.key,
      visibility: parsed.data.visibility
    });
    if (requestedContractError) return reply.code(400).send({ error: requestedContractError });

    let remote;
    try {
      remote = await headObject(parsed.data.key);
    } catch {
      return reply.code(409).send({ error: 'R2_OBJECT_NOT_FOUND' });
    }

    const remoteKind = remote.metadata?.['cp-kind'];
    const remoteVisibility = remote.metadata?.['cp-visibility'];
    if (remoteKind !== parsed.data.kind || remoteVisibility !== config.visibility) {
      return reply.code(409).send({ error: 'R2_OBJECT_METADATA_MISMATCH' });
    }
    const remoteContractError = validateMediaContract({
      kind: parsed.data.kind,
      key: parsed.data.key,
      visibility: config.visibility,
      contentType: remote.contentType,
      sizeBytes: remote.size
    });
    if (remoteContractError) return reply.code(409).send({ error: remoteContractError });

    const db = getDb();
    const [result] = await db.execute(`
      INSERT INTO media_objects (kind,visibility,storage_provider,bucket_name,object_key,original_name,mime_type,size_bytes,checksum_sha256,metadata_json)
      VALUES (?,?, 'cloudflare-r2',?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE kind=VALUES(kind),visibility=VALUES(visibility),bucket_name=VALUES(bucket_name),original_name=VALUES(original_name),mime_type=VALUES(mime_type),size_bytes=VALUES(size_bytes),checksum_sha256=COALESCE(VALUES(checksum_sha256),checksum_sha256),metadata_json=VALUES(metadata_json)
    `, [
      parsed.data.kind,
      config.visibility,
      remote.bucket,
      parsed.data.key,
      parsed.data.originalName || null,
      normalizeContentType(remote.contentType),
      remote.size,
      parsed.data.checksumSha256 || null,
      JSON.stringify({ ...parsed.data.metadata, r2: remote.metadata, etag: remote.etag })
    ]);
    const [rows] = await db.execute('SELECT * FROM media_objects WHERE object_key=? LIMIT 1', [parsed.data.key]);
    return { ok: true, media: rows[0], insertId: result.insertId || rows[0]?.id };
  });
}
