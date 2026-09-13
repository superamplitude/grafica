import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { publicObjectUrl } from '../lib/storage.js';

const attachSchema = z.object({
  media_id: z.number().int().positive(),
  role: z.enum(['cover','gallery']).default('gallery'),
  sort_order: z.number().int().min(-100000).max(100000).optional().default(0)
});

async function audit(db, request, action, entityId, before, after) {
  await db.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',? ,?,'product_media',?,?,?,?)`, [
    Number(request.user.sub), action, entityId,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    request.ip || null
  ]);
}

function serialize(row) {
  return {
    link_id:Number(row.link_id),
    product_id:Number(row.product_id),
    media_id:Number(row.media_id),
    role:row.role,
    sort_order:Number(row.sort_order||0),
    original_name:row.original_name,
    mime_type:row.mime_type,
    size_bytes:Number(row.size_bytes||0),
    url:row.object_key ? publicObjectUrl(row.object_key) : null,
    review:row.review_status ? {
      status:row.review_status,
      usage_type:row.usage_type,
      photo_type:row.photo_type,
      supplier_branding:row.supplier_branding,
      price_text:row.price_text,
      license_status:row.license_status,
      notes:row.review_notes || null,
      reviewed_at:row.reviewed_at || null
    } : null
  };
}

async function readLink(db, linkId) {
  const [rows] = await db.execute(`
    SELECT pm.id AS link_id,pm.product_id,pm.media_id,pm.role,pm.sort_order,
           m.object_key,m.original_name,m.mime_type,m.size_bytes,
           r.review_status,r.usage_type,r.photo_type,r.supplier_branding,r.price_text,r.license_status,r.notes AS review_notes,r.reviewed_at
      FROM product_media pm
      JOIN media_objects m ON m.id=pm.media_id
      LEFT JOIN media_asset_reviews r ON r.media_id=m.id
     WHERE pm.id=? LIMIT 1
  `,[linkId]);
  return rows[0] || null;
}

export async function registerAdminProductMediaRoutes(app) {
  const staff = app.requireRole('super_admin','admin','operations','prepress','support');
  const admins = app.requireRole('super_admin','admin');

  app.get('/api/v1/admin/catalog/products/:id/media', { preHandler:staff }, async (request, reply) => {
    const db = getDb();
    const productId = Number(request.params.id);
    if (!Number.isInteger(productId) || productId <= 0) return reply.code(400).send({error:'INVALID_PRODUCT_ID'});
    const [products] = await db.execute('SELECT id,name,slug,status FROM products WHERE id=? LIMIT 1',[productId]);
    if (!products[0]) return reply.code(404).send({error:'PRODUCT_NOT_FOUND'});
    const [rows] = await db.execute(`
      SELECT pm.id AS link_id,pm.product_id,pm.media_id,pm.role,pm.sort_order,
             m.object_key,m.original_name,m.mime_type,m.size_bytes,
             r.review_status,r.usage_type,r.photo_type,r.supplier_branding,r.price_text,r.license_status,r.notes AS review_notes,r.reviewed_at
        FROM product_media pm
        JOIN media_objects m ON m.id=pm.media_id AND m.kind='product-photo' AND m.visibility='public'
        LEFT JOIN media_asset_reviews r ON r.media_id=m.id
       WHERE pm.product_id=? AND pm.role IN ('cover','gallery')
       ORDER BY FIELD(pm.role,'cover','gallery'),pm.sort_order,pm.id
    `,[productId]);
    return {product:products[0],items:rows.map(serialize)};
  });

  app.post('/api/v1/admin/catalog/products/:id/media', { preHandler:admins }, async (request, reply) => {
    const parsed = attachSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({error:'INVALID_PRODUCT_MEDIA',details:parsed.error.flatten()});
    const db = getDb();
    const productId = Number(request.params.id);
    if (!Number.isInteger(productId) || productId <= 0) return reply.code(400).send({error:'INVALID_PRODUCT_ID'});
    const [products] = await db.execute('SELECT id FROM products WHERE id=? LIMIT 1',[productId]);
    if (!products[0]) return reply.code(404).send({error:'PRODUCT_NOT_FOUND'});
    const [mediaRows] = await db.execute(`SELECT id,kind,visibility,object_key,original_name,mime_type,size_bytes FROM media_objects WHERE id=? LIMIT 1`,[parsed.data.media_id]);
    const media=mediaRows[0];
    if (!media || media.kind!=='product-photo' || media.visibility!=='public') return reply.code(409).send({error:'INVALID_PRODUCT_PHOTO'});

    const connection=await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('SELECT id FROM product_media WHERE product_id=? FOR UPDATE',[productId]);
      const [beforeRows]=await connection.execute(`SELECT id,media_id,role,sort_order FROM product_media WHERE product_id=? AND (media_id=? OR role='cover') ORDER BY id`,[productId,media.id]);
      await connection.execute('DELETE FROM product_media WHERE product_id=? AND media_id=?',[productId,media.id]);
      if (parsed.data.role==='cover') await connection.execute(`DELETE FROM product_media WHERE product_id=? AND role='cover'`,[productId]);
      const [result]=await connection.execute(`INSERT INTO product_media (product_id,media_id,role,sort_order) VALUES (?,?,?,?)`,[productId,media.id,parsed.data.role,parsed.data.sort_order]);
      const after=await readLink(connection,Number(result.insertId));
      await audit(connection,request,'product.media.attach',Number(result.insertId),beforeRows,{...after,review_required:true});
      await connection.commit();
      return reply.code(201).send({ok:true,item:serialize(after),reviewRequired:true});
    } catch (error) {
      try{await connection.rollback()}catch{}
      throw error;
    } finally { connection.release(); }
  });

  app.delete('/api/v1/admin/catalog/products/:productId/media/:linkId', { preHandler:admins }, async (request, reply) => {
    const db=getDb();
    const productId=Number(request.params.productId);const linkId=Number(request.params.linkId);
    if(!Number.isInteger(productId)||productId<=0||!Number.isInteger(linkId)||linkId<=0)return reply.code(400).send({error:'INVALID_PRODUCT_MEDIA_ID'});
    const before=await readLink(db,linkId);
    if(!before||Number(before.product_id)!==productId)return reply.code(404).send({error:'PRODUCT_MEDIA_NOT_FOUND'});
    await db.execute('DELETE FROM product_media WHERE id=? AND product_id=?',[linkId,productId]);
    await audit(db,request,'product.media.detach',linkId,before,null);
    return {ok:true};
  });
}
