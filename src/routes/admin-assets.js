import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { publicObjectUrl } from '../lib/storage.js';

const reviewSchema = z.object({
  usage_type: z.enum(['product','hero','template','other']),
  photo_type: z.enum(['real','render','illustration','not_applicable','unknown']),
  supplier_branding: z.enum(['clear','found','unknown']),
  price_text: z.enum(['clear','found','unknown']),
  license_status: z.enum(['owned','licensed','reference_only','unknown']),
  review_status: z.enum(['pending','approved','rejected']),
  notes: z.string().max(10000).optional().nullable()
});

function approvalError(data) {
  if (data.review_status !== 'approved') return null;
  if (!['owned','licensed'].includes(data.license_status)) return 'ASSET_LICENSE_NOT_APPROVED';
  if (data.supplier_branding !== 'clear') return 'SUPPLIER_BRANDING_NOT_CLEAR';
  if (data.usage_type === 'product' && data.photo_type !== 'real') return 'PRODUCT_IMAGE_MUST_BE_REAL';
  if (data.usage_type === 'hero' && data.price_text !== 'clear') return 'HERO_IMAGE_PRICE_TEXT_NOT_CLEAR';
  if (data.usage_type === 'template' && data.price_text === 'found') return 'TEMPLATE_PRICE_TEXT_NOT_ALLOWED';
  return null;
}

async function audit(db, request, action, entityId, before, after) {
  await db.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',? ,?,'media_asset_review',?,?,?,?)`, [
    Number(request.user.sub), action, entityId,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    request.ip || null
  ]);
}

export async function registerAdminAssetRoutes(app) {
  const staff = app.requireRole('super_admin','admin','operations','prepress','support');
  const reviewers = app.requireRole('super_admin','admin','prepress');

  app.get('/api/v1/admin/assets/candidates', { preHandler: staff }, async (request) => {
    const db = getDb();
    const kind = String(request.query?.kind || '').trim();
    const reviewStatus = String(request.query?.status || '').trim();
    const where = ["m.visibility='public'", "m.kind IN ('product-photo','banner','template')"];
    const params = [];
    if (['product-photo','banner','template'].includes(kind)) { where.push('m.kind=?'); params.push(kind); }
    if (reviewStatus === 'unreviewed') where.push('r.id IS NULL');
    if (['pending','approved','rejected'].includes(reviewStatus)) { where.push('r.review_status=?'); params.push(reviewStatus); }
    const [rows] = await db.execute(`
      SELECT m.id,m.kind,m.object_key,m.original_name,m.mime_type,m.size_bytes,m.created_at,
             r.usage_type,r.photo_type,r.supplier_branding,r.price_text,r.license_status,r.review_status,r.notes,r.reviewed_at
        FROM media_objects m
        LEFT JOIN media_asset_reviews r ON r.media_id=m.id
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(r.reviewed_at,m.created_at) DESC,m.id DESC
       LIMIT 500
    `, params);
    return { items:rows.map((row)=>({ ...row, url:publicObjectUrl(row.object_key), review_status:row.review_status||'unreviewed' })) };
  });

  app.get('/api/v1/admin/assets/reviews', { preHandler: staff }, async (request) => {
    const db = getDb();
    const usage = String(request.query?.usage || '').trim();
    const status = String(request.query?.status || '').trim();
    const where = [];
    const params = [];
    if (['product','hero','template','other'].includes(usage)) { where.push('r.usage_type=?'); params.push(usage); }
    if (['pending','approved','rejected'].includes(status)) { where.push('r.review_status=?'); params.push(status); }
    const [rows] = await db.execute(`
      SELECT r.*,m.kind,m.visibility,m.object_key,m.original_name,m.mime_type,m.size_bytes,m.created_at AS media_created_at,
             u.name AS reviewed_by_name
        FROM media_asset_reviews r
        JOIN media_objects m ON m.id=r.media_id
        LEFT JOIN staff_users u ON u.id=r.reviewed_by_user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.updated_at DESC,r.id DESC
       LIMIT 500
    `, params);
    return { items: rows.map((row)=>({ ...row, url:publicObjectUrl(row.object_key) })) };
  });

  app.get('/api/v1/admin/media/:id/review', { preHandler: staff }, async (request, reply) => {
    const db = getDb();
    const mediaId = Number(request.params.id);
    if (!Number.isInteger(mediaId) || mediaId <= 0) return reply.code(400).send({ error:'INVALID_MEDIA_ID' });
    const [mediaRows] = await db.execute('SELECT id,kind,visibility,object_key,original_name,mime_type,size_bytes,metadata_json,created_at FROM media_objects WHERE id=? LIMIT 1', [mediaId]);
    if (!mediaRows[0]) return reply.code(404).send({ error:'MEDIA_NOT_FOUND' });
    const [reviewRows] = await db.execute('SELECT * FROM media_asset_reviews WHERE media_id=? LIMIT 1', [mediaId]);
    return { media:{...mediaRows[0],url:publicObjectUrl(mediaRows[0].object_key)}, review: reviewRows[0] || null };
  });

  app.put('/api/v1/admin/media/:id/review', { preHandler: reviewers }, async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'INVALID_ASSET_REVIEW', details:parsed.error.flatten() });
    const invalid = approvalError(parsed.data);
    if (invalid) return reply.code(409).send({ error: invalid });
    const db = getDb();
    const mediaId = Number(request.params.id);
    if (!Number.isInteger(mediaId) || mediaId <= 0) return reply.code(400).send({ error:'INVALID_MEDIA_ID' });
    const [mediaRows] = await db.execute('SELECT id,kind FROM media_objects WHERE id=? LIMIT 1', [mediaId]);
    if (!mediaRows[0]) return reply.code(404).send({ error:'MEDIA_NOT_FOUND' });
    const [beforeRows] = await db.execute('SELECT * FROM media_asset_reviews WHERE media_id=? LIMIT 1', [mediaId]);
    const before = beforeRows[0] || null;
    const d = parsed.data;
    const reviewedAt = d.review_status === 'pending' ? null : new Date();
    await db.execute(`
      INSERT INTO media_asset_reviews
        (media_id,usage_type,photo_type,supplier_branding,price_text,license_status,review_status,notes,reviewed_by_user_id,reviewed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE usage_type=VALUES(usage_type),photo_type=VALUES(photo_type),supplier_branding=VALUES(supplier_branding),
        price_text=VALUES(price_text),license_status=VALUES(license_status),review_status=VALUES(review_status),notes=VALUES(notes),
        reviewed_by_user_id=VALUES(reviewed_by_user_id),reviewed_at=VALUES(reviewed_at)
    `, [mediaId,d.usage_type,d.photo_type,d.supplier_branding,d.price_text,d.license_status,d.review_status,d.notes||null,Number(request.user.sub),reviewedAt]);
    const [afterRows] = await db.execute('SELECT * FROM media_asset_reviews WHERE media_id=? LIMIT 1', [mediaId]);
    await audit(db, request, 'media.review', mediaId, before, afterRows[0]);
    return { ok:true, review:afterRows[0] };
  });
}
