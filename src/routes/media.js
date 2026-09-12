import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { headObject, R2_PREFIXES, r2Status, signedUploadUrl } from '../lib/storage.js';

const uploadSchema = z.object({
  kind: z.enum(['product-photo','thumbnail','mockup','template','artwork-original','artwork-preview','artwork-approved','proof','production']),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(3).max(120),
  visibility: z.enum(['public','private']).optional()
});

const confirmSchema = z.object({
  kind: z.string().min(1).max(50),
  key: z.string().min(3).max(500),
  originalName: z.string().max(255).nullable().optional(),
  visibility: z.enum(['public','private']),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const kindConfig = {
  'product-photo': { prefix: R2_PREFIXES.PRODUCT_PHOTOS, visibility: 'public' },
  thumbnail: { prefix: R2_PREFIXES.THUMBNAILS, visibility: 'public' },
  mockup: { prefix: R2_PREFIXES.MOCKUPS, visibility: 'public' },
  template: { prefix: R2_PREFIXES.TEMPLATES, visibility: 'public' },
  'artwork-original': { prefix: R2_PREFIXES.ARTWORK_ORIGINALS, visibility: 'private' },
  'artwork-preview': { prefix: R2_PREFIXES.ARTWORK_PREVIEWS, visibility: 'private' },
  'artwork-approved': { prefix: R2_PREFIXES.ARTWORK_APPROVED, visibility: 'private' },
  proof: { prefix: R2_PREFIXES.PROOFS, visibility: 'private' },
  production: { prefix: R2_PREFIXES.PRODUCTION, visibility: 'private' }
};

function safeExtension(filename) {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return ext.length <= 12 ? ext : '';
}

export async function registerMediaRoutes(app) {
  const mediaStaff = app.requireRole('super_admin','admin','prepress','operations');

  app.get('/api/v1/admin/storage/status', { preHandler: mediaStaff }, async () => ({
    provider: 'cloudflare-r2',
    status: await r2Status(),
    bucket: process.env.R2_BUCKET || null,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || null
  }));

  app.post('/api/v1/admin/media/upload-intent', { preHandler: mediaStaff }, async (request, reply) => {
    const parsed = uploadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_UPLOAD_INTENT' });
    if (await r2Status() !== 'ok') return reply.code(503).send({ error: 'R2_NOT_READY' });

    const config = kindConfig[parsed.data.kind];
    const visibility = parsed.data.visibility || config.visibility;
    if (config.visibility === 'private' && visibility !== 'private') {
      return reply.code(400).send({ error: 'PRIVATE_KIND_CANNOT_BE_PUBLIC' });
    }
    const now = new Date();
    const partition = `${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}`;
    const key = `${config.prefix}/${partition}/${crypto.randomUUID()}${safeExtension(parsed.data.filename)}`;
    const uploadUrl = await signedUploadUrl({
      key,
      contentType: parsed.data.contentType,
      expiresIn: 900,
      metadata: {
        'cp-kind': parsed.data.kind,
        'cp-visibility': visibility
      }
    });
    return { key, uploadUrl, expiresIn: 900, visibility };
  });

  app.post('/api/v1/admin/media/confirm', { preHandler: mediaStaff }, async (request, reply) => {
    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_MEDIA_CONFIRMATION' });
    let remote;
    try {
      remote = await headObject(parsed.data.key);
    } catch {
      return reply.code(409).send({ error: 'R2_OBJECT_NOT_FOUND' });
    }
    const db = getDb();
    const [result] = await db.execute(`
      INSERT INTO media_objects (kind,visibility,storage_provider,bucket_name,object_key,original_name,mime_type,size_bytes,checksum_sha256,metadata_json)
      VALUES (?,?, 'cloudflare-r2',?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE kind=VALUES(kind),visibility=VALUES(visibility),original_name=VALUES(original_name),mime_type=VALUES(mime_type),size_bytes=VALUES(size_bytes),checksum_sha256=COALESCE(VALUES(checksum_sha256),checksum_sha256),metadata_json=VALUES(metadata_json)
    `, [
      parsed.data.kind,
      parsed.data.visibility,
      process.env.R2_BUCKET,
      parsed.data.key,
      parsed.data.originalName || null,
      remote.contentType,
      remote.size,
      parsed.data.checksumSha256 || null,
      JSON.stringify({ ...parsed.data.metadata, r2: remote.metadata, etag: remote.etag })
    ]);
    const [rows] = await db.execute('SELECT * FROM media_objects WHERE object_key=? LIMIT 1', [parsed.data.key]);
    return { ok: true, media: rows[0], insertId: result.insertId || rows[0]?.id };
  });
}
