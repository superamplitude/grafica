import { z } from 'zod';
import { getDb } from '../lib/db.js';

const productPatchSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  short_description: z.string().max(5000).nullable().optional(),
  description: z.string().max(200000).nullable().optional(),
  status: z.enum(['draft','active','paused','archived']).optional(),
  featured: z.boolean().optional(),
  sort_order: z.number().int().min(-100000).max(100000).optional(),
  requires_artwork: z.boolean().optional(),
  supports_front: z.boolean().optional(),
  supports_back: z.boolean().optional(),
  config_json: z.unknown().optional(),
  confirmPublish: z.boolean().optional()
});

const supplierPatchSchema = z.object({
  status: z.enum(['inactive','testing','approved','suspended']).optional(),
  is_primary: z.boolean().optional(),
  sync_mode: z.enum(['manual','assisted','api']).optional(),
  notes: z.string().max(20000).nullable().optional()
});

const productionPatchSchema = z.object({
  status: z.enum(['queued','prepress','printing','finishing','quality','packing','ready','shipped','paused','completed','cancelled']),
  tracking_code: z.string().max(190).nullable().optional(),
  carrier: z.string().max(190).nullable().optional(),
  note: z.string().max(5000).nullable().optional()
});

const contentSchema = z.object({
  block_type: z.string().min(1).max(60).default('text'),
  title: z.string().max(255).nullable().optional(),
  content: z.unknown(),
  status: z.enum(['draft','active','archived']).default('active')
});

const productionTransitions = {
  queued: ['prepress','paused','cancelled'],
  prepress: ['printing','paused','cancelled'],
  printing: ['finishing','quality','paused','cancelled'],
  finishing: ['quality','packing','paused','cancelled'],
  quality: ['packing','paused','cancelled'],
  packing: ['ready','paused','cancelled'],
  ready: ['shipped','completed','paused'],
  shipped: ['completed'],
  paused: ['queued','prepress','printing','finishing','quality','packing','ready','cancelled'],
  completed: [],
  cancelled: []
};

async function writeAudit(db, request, action, entityType, entityId, before, after) {
  await db.execute(`
    INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',?,?,?,?,?,?,?)
  `, [Number(request.user.sub), action, entityType, entityId,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, request.ip || null]);
}

export async function registerAdminRoutes(app) {
  const anyStaff = app.requireRole('super_admin','admin','operations','prepress','support');
  const admins = app.requireRole('super_admin','admin');
  const productionStaff = app.requireRole('super_admin','admin','operations','prepress');

  app.get('/api/v1/admin/dashboard', { preHandler: anyStaff }, async () => {
    const db = getDb();
    const [rows] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM products) AS products_total,
        (SELECT COUNT(*) FROM products WHERE status='active') AS products_active,
        (SELECT COUNT(*) FROM products WHERE status='draft') AS products_draft,
        (SELECT COUNT(*) FROM orders) AS orders_total,
        (SELECT COUNT(*) FROM artworks WHERE status IN ('uploaded','preflight','changes-required')) AS artworks_pending,
        (SELECT COUNT(*) FROM proofs WHERE status='pending') AS proofs_pending,
        (SELECT COUNT(*) FROM production_jobs WHERE status NOT IN ('completed','cancelled')) AS production_open,
        (SELECT COUNT(*) FROM suppliers WHERE status='approved') AS suppliers_approved,
        (SELECT COUNT(*) FROM ai_actions WHERE status='proposed') AS ai_proposed
    `);
    return rows[0] || {};
  });

  app.get('/api/v1/admin/products', { preHandler: anyStaff }, async (request) => {
    const db = getDb();
    const status = String(request.query?.status || '').trim();
    const q = String(request.query?.q || '').trim();
    const where = ['1=1'];
    const params = [];
    if (['draft','active','paused','archived'].includes(status)) { where.push('p.status=?'); params.push(status); }
    if (q) { where.push('(p.name LIKE ? OR p.sku LIKE ?)'); const like=`%${q}%`; params.push(like,like); }
    const [rows] = await db.execute(`
      SELECT p.id,p.sku,p.name,p.slug,p.status,p.featured,p.base_price,p.requires_artwork,p.updated_at,
             c.name AS category_name,
             (SELECT COUNT(*) FROM product_variants v WHERE v.product_id=p.id) AS variants_count
        FROM products p LEFT JOIN categories c ON c.id=p.category_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.updated_at DESC,p.id DESC LIMIT 300
    `, params);
    return { items: rows };
  });

  app.patch('/api/v1/admin/products/:id', { preHandler: admins }, async (request, reply) => {
    const parsed = productPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_PRODUCT' });
    const db = getDb();
    const id = Number(request.params.id);
    const [rows] = await db.execute('SELECT * FROM products WHERE id=? LIMIT 1', [id]);
    const before = rows[0];
    if (!before) return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND' });

    const data = parsed.data;
    if (data.status === 'active' && before.status !== 'active') {
      if (request.user.role !== 'super_admin' || data.confirmPublish !== true) {
        return reply.code(409).send({ error: 'PUBLISH_REQUIRES_SUPER_ADMIN_CONFIRMATION' });
      }
    }

    const map = {
      name: data.name,
      short_description: data.short_description,
      description: data.description,
      status: data.status,
      featured: data.featured == null ? undefined : Number(data.featured),
      sort_order: data.sort_order,
      requires_artwork: data.requires_artwork == null ? undefined : Number(data.requires_artwork),
      supports_front: data.supports_front == null ? undefined : Number(data.supports_front),
      supports_back: data.supports_back == null ? undefined : Number(data.supports_back),
      config_json: data.config_json === undefined ? undefined : JSON.stringify(data.config_json)
    };
    const entries = Object.entries(map).filter(([,value]) => value !== undefined);
    if (!entries.length) return { ok: true, unchanged: true };
    await db.execute(`UPDATE products SET ${entries.map(([key]) => `${key}=?`).join(',')},updated_at=NOW() WHERE id=?`, [
      ...entries.map(([,value]) => value), id
    ]);
    const [afterRows] = await db.execute('SELECT * FROM products WHERE id=? LIMIT 1', [id]);
    await writeAudit(db, request, 'product.update', 'product', id, before, afterRows[0]);
    return { ok: true, product: afterRows[0] };
  });

  app.get('/api/v1/admin/suppliers', { preHandler: anyStaff }, async () => {
    const db = getDb();
    const [rows] = await db.query(`SELECT id,name,slug,website_url,login_url,catalog_url,price_table_url,integration_url,catalog_source_type,
      fulfillment_direct,direct_shipping_mode,neutral_packaging,white_label_status,integration_type,is_primary,sync_mode,status,notes,last_sync_at,updated_at
      FROM suppliers ORDER BY is_primary DESC,name`);
    return { items: rows };
  });

  app.patch('/api/v1/admin/suppliers/:id', { preHandler: admins }, async (request, reply) => {
    const parsed = supplierPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_SUPPLIER' });
    const db = getDb();
    const id = Number(request.params.id);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT * FROM suppliers WHERE id=? FOR UPDATE', [id]);
      const before = rows[0];
      if (!before) { await connection.rollback(); return reply.code(404).send({ error: 'SUPPLIER_NOT_FOUND' }); }
      const data = parsed.data;
      if (data.is_primary === true) await connection.execute('UPDATE suppliers SET is_primary=0 WHERE is_primary=1 AND id<>?', [id]);
      const map = {
        status: data.status,
        is_primary: data.is_primary == null ? undefined : Number(data.is_primary),
        sync_mode: data.sync_mode,
        notes: data.notes
      };
      const entries = Object.entries(map).filter(([,value]) => value !== undefined);
      if (entries.length) await connection.execute(`UPDATE suppliers SET ${entries.map(([key]) => `${key}=?`).join(',')},updated_at=NOW() WHERE id=?`, [...entries.map(([,value]) => value),id]);
      const [afterRows] = await connection.execute('SELECT * FROM suppliers WHERE id=?', [id]);
      await connection.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
        VALUES ('staff',?,'supplier.update','supplier',?,?,?,?)`, [Number(request.user.sub),id,JSON.stringify(before),JSON.stringify(afterRows[0]),request.ip || null]);
      await connection.commit();
      return { ok: true, supplier: afterRows[0] };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  app.get('/api/v1/admin/production', { preHandler: productionStaff }, async (request) => {
    const db = getDb();
    const status = String(request.query?.status || '').trim();
    const params = [];
    const where = status ? 'WHERE pj.status=?' : '';
    if (status) params.push(status);
    const [rows] = await db.execute(`
      SELECT pj.*,o.order_number,p.name AS product_name,pv.name AS variant_name
        FROM production_jobs pj
        JOIN order_items oi ON oi.id=pj.order_item_id
        JOIN orders o ON o.id=oi.order_id
        LEFT JOIN products p ON p.id=oi.product_id
        LEFT JOIN product_variants pv ON pv.id=oi.variant_id
        ${where}
       ORDER BY FIELD(pj.status,'queued','prepress','printing','finishing','quality','packing','ready','shipped','paused','completed','cancelled'),pj.id DESC
       LIMIT 500
    `, params);
    return { items: rows };
  });

  app.patch('/api/v1/admin/production/:id', { preHandler: productionStaff }, async (request, reply) => {
    const parsed = productionPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_PRODUCTION_UPDATE' });
    const db = getDb();
    const id = Number(request.params.id);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT * FROM production_jobs WHERE id=? FOR UPDATE', [id]);
      const before = rows[0];
      if (!before) { await connection.rollback(); return reply.code(404).send({ error: 'PRODUCTION_JOB_NOT_FOUND' }); }
      const target = parsed.data.status;
      if (target !== before.status && !(productionTransitions[before.status] || []).includes(target)) {
        await connection.rollback();
        return reply.code(409).send({ error: 'INVALID_STATUS_TRANSITION', from: before.status, to: target });
      }
      await connection.execute('UPDATE production_jobs SET status=?,tracking_code=?,carrier=?,updated_at=NOW() WHERE id=?', [
        target, parsed.data.tracking_code ?? before.tracking_code, parsed.data.carrier ?? before.carrier, id
      ]);
      await connection.execute(`INSERT INTO production_events (production_job_id,event_type,from_status,to_status,actor_type,actor_id,payload_json)
        VALUES (?,'status.updated',?,?,'staff',?,?)`, [id,before.status,target,Number(request.user.sub),JSON.stringify({ note: parsed.data.note || null })]);
      const [afterRows] = await connection.execute('SELECT * FROM production_jobs WHERE id=?', [id]);
      await connection.commit();
      return { ok: true, job: afterRows[0] };
    } catch (error) {
      await connection.rollback(); throw error;
    } finally { connection.release(); }
  });

  app.get('/api/v1/admin/ai/actions', { preHandler: admins }, async (request) => {
    const db = getDb();
    const status = String(request.query?.status || 'proposed');
    const [rows] = await db.execute('SELECT * FROM ai_actions WHERE status=? ORDER BY FIELD(risk_level,\'critical\',\'high\',\'medium\',\'low\'),id DESC LIMIT 300', [status]);
    return { items: rows };
  });

  app.post('/api/v1/admin/ai/actions/:id/decision', { preHandler: admins }, async (request, reply) => {
    const decision = z.object({ decision: z.enum(['approve','reject']) }).safeParse(request.body);
    if (!decision.success) return reply.code(400).send({ error: 'INVALID_DECISION' });
    const db = getDb();
    const id = Number(request.params.id);
    const [rows] = await db.execute('SELECT * FROM ai_actions WHERE id=? LIMIT 1', [id]);
    const action = rows[0];
    if (!action) return reply.code(404).send({ error: 'AI_ACTION_NOT_FOUND' });
    if (action.status !== 'proposed') return reply.code(409).send({ error: 'AI_ACTION_ALREADY_DECIDED' });
    if (decision.data.decision === 'approve' && action.risk_level === 'critical' && request.user.role !== 'super_admin') {
      return reply.code(403).send({ error: 'CRITICAL_ACTION_REQUIRES_SUPER_ADMIN' });
    }
    const status = decision.data.decision === 'approve' ? 'approved' : 'rejected';
    await db.execute('UPDATE ai_actions SET status=?,approved_by_user_id=?,approved_at=NOW() WHERE id=?', [status,Number(request.user.sub),id]);
    await writeAudit(db, request, `ai.${status}`, 'ai_action', id, action, { ...action, status });
    return { ok: true, status, execution: 'not_automatic' };
  });

  app.get('/api/v1/admin/content', { preHandler: anyStaff }, async () => {
    const db = getDb();
    const [rows] = await db.query('SELECT * FROM content_blocks ORDER BY block_key');
    return { items: rows };
  });

  app.put('/api/v1/admin/content/:key', { preHandler: admins }, async (request, reply) => {
    const parsed = contentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_CONTENT' });
    const key = String(request.params.key).slice(0,190);
    const db = getDb();
    const [beforeRows] = await db.execute('SELECT * FROM content_blocks WHERE block_key=? LIMIT 1', [key]);
    await db.execute(`INSERT INTO content_blocks (block_key,block_type,title,content_json,status,updated_by_user_id)
      VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE block_type=VALUES(block_type),title=VALUES(title),content_json=VALUES(content_json),status=VALUES(status),updated_by_user_id=VALUES(updated_by_user_id)`, [
      key,parsed.data.block_type,parsed.data.title ?? null,JSON.stringify(parsed.data.content),parsed.data.status,Number(request.user.sub)
    ]);
    const [afterRows] = await db.execute('SELECT * FROM content_blocks WHERE block_key=? LIMIT 1', [key]);
    await writeAudit(db, request, 'content.update', 'content_block', afterRows[0].id, beforeRows[0] || null, afterRows[0]);
    return { ok: true, item: afterRows[0] };
  });
}
