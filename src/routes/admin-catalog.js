import { z } from 'zod';
import { getDb } from '../lib/db.js';

const productSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z.string().max(255).optional().nullable(),
  sku: z.string().max(120).optional().nullable(),
  category_id: z.number().int().positive().optional().nullable(),
  supplier_id: z.number().int().positive().optional().nullable(),
  short_description: z.string().max(5000).optional().nullable(),
  description: z.string().max(200000).optional().nullable(),
  base_price: z.number().min(0).max(999999999).optional(),
  featured: z.boolean().optional(),
  sort_order: z.number().int().min(-100000).max(100000).optional(),
  requires_artwork: z.boolean().optional(),
  supports_front: z.boolean().optional(),
  supports_back: z.boolean().optional(),
  config_json: z.unknown().optional().nullable(),
  seo_json: z.unknown().optional().nullable()
});

const productUpdateSchema = productSchema.partial().extend({
  status: z.enum(['draft','active','paused','archived']).optional(),
  confirmPublish: z.boolean().optional()
});

const variantSchema = z.object({
  name: z.string().min(1).max(255),
  sku: z.string().max(120).optional().nullable(),
  external_code: z.string().max(120).optional().nullable(),
  supplier_cost: z.number().min(0).max(999999999).optional(),
  additional_cost: z.number().min(0).max(999999999).optional(),
  public_price: z.number().min(0).max(999999999).optional(),
  reseller_price: z.number().min(0).max(999999999).optional(),
  quantity: z.number().positive().max(999999999).optional(),
  size_label: z.string().max(120).optional().nullable(),
  print_configuration: z.string().max(40).optional().nullable(),
  production_days: z.number().int().min(0).max(3650).optional().nullable(),
  availability: z.enum(['available','unavailable','on_request']).optional(),
  status: z.enum(['active','inactive']).optional(),
  attributes_json: z.unknown().optional().nullable(),
  production_json: z.unknown().optional().nullable()
});

const categorySchema = z.object({
  name: z.string().min(2).max(190),
  slug: z.string().max(190).optional().nullable(),
  parent_id: z.number().int().positive().optional().nullable(),
  description: z.string().max(10000).optional().nullable(),
  status: z.enum(['draft','active','archived']).optional(),
  sort_order: z.number().int().min(-100000).max(100000).optional()
});

function slugify(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 190);
}

async function uniqueSlug(db, table, raw, excludeId = null) {
  const base = slugify(raw) || `item-${Date.now()}`;
  let candidate = base;
  for (let n = 1; n <= 100; n += 1) {
    const sql = excludeId
      ? `SELECT id FROM ${table} WHERE slug=? AND id<>? LIMIT 1`
      : `SELECT id FROM ${table} WHERE slug=? LIMIT 1`;
    const params = excludeId ? [candidate, excludeId] : [candidate];
    const [rows] = await db.execute(sql, params);
    if (!rows.length) return candidate;
    candidate = `${base}-${n + 1}`.slice(0, 190);
  }
  throw new Error('SLUG_COLLISION_LIMIT');
}

async function audit(db, request, action, entityType, entityId, before, after) {
  await db.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',?,?,?,?,?,?,?)`, [
    Number(request.user.sub), action, entityType, entityId,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    request.ip || null
  ]);
}

function jsonValue(value) {
  return value === undefined ? undefined : (value === null ? null : JSON.stringify(value));
}

export async function registerAdminCatalogRoutes(app) {
  const admins = app.requireRole('super_admin','admin');
  const staff = app.requireRole('super_admin','admin','operations','prepress','support');

  app.get('/api/v1/admin/catalog/categories', { preHandler: staff }, async () => {
    const db = getDb();
    const [rows] = await db.query(`SELECT c.*,(SELECT COUNT(*) FROM products p WHERE p.category_id=c.id) AS product_count FROM categories c ORDER BY c.sort_order,c.name`);
    return { items: rows.map(row => ({ ...row, product_count: Number(row.product_count || 0) })) };
  });

  app.post('/api/v1/admin/catalog/categories', { preHandler: admins }, async (request, reply) => {
    const parsed = categorySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_CATEGORY' });
    const db = getDb();
    const data = parsed.data;
    const slug = await uniqueSlug(db, 'categories', data.slug || data.name);
    const [result] = await db.execute(`INSERT INTO categories (parent_id,name,slug,description,status,sort_order) VALUES (?,?,?,?,?,?)`, [
      data.parent_id ?? null, data.name, slug, data.description ?? null, data.status || 'active', data.sort_order ?? 0
    ]);
    const [rows] = await db.execute('SELECT * FROM categories WHERE id=?', [result.insertId]);
    await audit(db, request, 'category.create', 'category', result.insertId, null, rows[0]);
    return reply.code(201).send({ ok: true, category: rows[0] });
  });

  app.patch('/api/v1/admin/catalog/categories/:id', { preHandler: admins }, async (request, reply) => {
    const parsed = categorySchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_CATEGORY' });
    const db = getDb();
    const id = Number(request.params.id);
    const [beforeRows] = await db.execute('SELECT * FROM categories WHERE id=? LIMIT 1', [id]);
    const before = beforeRows[0];
    if (!before) return reply.code(404).send({ error: 'CATEGORY_NOT_FOUND' });
    const data = parsed.data;
    let slug;
    if (data.slug !== undefined || data.name !== undefined) slug = await uniqueSlug(db, 'categories', data.slug || data.name || before.name, id);
    const map = {
      name: data.name,
      slug,
      parent_id: data.parent_id,
      description: data.description,
      status: data.status,
      sort_order: data.sort_order
    };
    const entries = Object.entries(map).filter(([,v]) => v !== undefined);
    if (entries.length) await db.execute(`UPDATE categories SET ${entries.map(([k])=>`${k}=?`).join(',')},updated_at=NOW() WHERE id=?`, [...entries.map(([,v])=>v),id]);
    const [afterRows] = await db.execute('SELECT * FROM categories WHERE id=?', [id]);
    await audit(db, request, 'category.update', 'category', id, before, afterRows[0]);
    return { ok: true, category: afterRows[0] };
  });

  app.post('/api/v1/admin/catalog/products', { preHandler: admins }, async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_PRODUCT', details: parsed.error.flatten() });
    const db = getDb();
    const data = parsed.data;
    const slug = await uniqueSlug(db, 'products', data.slug || data.name);
    try {
      const [result] = await db.execute(`
        INSERT INTO products (category_id,supplier_id,sku,name,slug,short_description,description,base_price,status,featured,sort_order,requires_artwork,supports_front,supports_back,config_json,seo_json)
        VALUES (?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?)
      `, [
        data.category_id ?? null, data.supplier_id ?? null, data.sku || null, data.name, slug,
        data.short_description ?? null, data.description ?? null, data.base_price ?? 0,
        Number(data.featured ?? false), data.sort_order ?? 0, Number(data.requires_artwork ?? true),
        Number(data.supports_front ?? true), Number(data.supports_back ?? false),
        jsonValue(data.config_json) ?? null, jsonValue(data.seo_json) ?? null
      ]);
      const [rows] = await db.execute('SELECT * FROM products WHERE id=?', [result.insertId]);
      await audit(db, request, 'product.create', 'product', result.insertId, null, rows[0]);
      return reply.code(201).send({ ok: true, product: rows[0] });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') return reply.code(409).send({ error: 'PRODUCT_SKU_OR_SLUG_EXISTS' });
      throw error;
    }
  });

  app.get('/api/v1/admin/catalog/products/:id', { preHandler: staff }, async (request, reply) => {
    const db = getDb();
    const id = Number(request.params.id);
    const [rows] = await db.execute(`SELECT p.*,c.name AS category_name,s.name AS supplier_name FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=? LIMIT 1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND' });
    const [variants] = await db.execute(`SELECT id,product_id,sku,external_code,name,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,status,attributes_json,production_json,created_at FROM product_variants WHERE product_id=? ORDER BY id`, [id]);
    return { product: rows[0], variants };
  });

  app.patch('/api/v1/admin/catalog/products/:id', { preHandler: admins }, async (request, reply) => {
    const parsed = productUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_PRODUCT' });
    const db = getDb();
    const id = Number(request.params.id);
    const [beforeRows] = await db.execute('SELECT * FROM products WHERE id=? LIMIT 1', [id]);
    const before = beforeRows[0];
    if (!before) return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND' });
    const data = parsed.data;
    if (data.status === 'active' && before.status !== 'active' && (request.user.role !== 'super_admin' || data.confirmPublish !== true)) {
      return reply.code(409).send({ error: 'PUBLISH_REQUIRES_SUPER_ADMIN_CONFIRMATION' });
    }
    let slug;
    if (data.slug !== undefined || data.name !== undefined) slug = await uniqueSlug(db, 'products', data.slug || data.name || before.name, id);
    const map = {
      name: data.name, slug, sku: data.sku, category_id: data.category_id, supplier_id: data.supplier_id,
      short_description: data.short_description, description: data.description, base_price: data.base_price,
      status: data.status, featured: data.featured === undefined ? undefined : Number(data.featured), sort_order: data.sort_order,
      requires_artwork: data.requires_artwork === undefined ? undefined : Number(data.requires_artwork),
      supports_front: data.supports_front === undefined ? undefined : Number(data.supports_front),
      supports_back: data.supports_back === undefined ? undefined : Number(data.supports_back),
      config_json: jsonValue(data.config_json), seo_json: jsonValue(data.seo_json)
    };
    const entries = Object.entries(map).filter(([,v]) => v !== undefined);
    try {
      if (entries.length) await db.execute(`UPDATE products SET ${entries.map(([k])=>`${k}=?`).join(',')},updated_at=NOW() WHERE id=?`, [...entries.map(([,v])=>v),id]);
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') return reply.code(409).send({ error: 'PRODUCT_SKU_OR_SLUG_EXISTS' });
      throw error;
    }
    const [afterRows] = await db.execute('SELECT * FROM products WHERE id=?', [id]);
    await audit(db, request, 'product.catalog-update', 'product', id, before, afterRows[0]);
    return { ok: true, product: afterRows[0] };
  });

  app.post('/api/v1/admin/catalog/products/:id/variants', { preHandler: admins }, async (request, reply) => {
    const parsed = variantSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_VARIANT' });
    const db = getDb();
    const productId = Number(request.params.id);
    const [productRows] = await db.execute('SELECT id FROM products WHERE id=?', [productId]);
    if (!productRows.length) return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND' });
    const d = parsed.data;
    try {
      const [result] = await db.execute(`
        INSERT INTO product_variants (product_id,sku,external_code,name,price,cost,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,attributes_json,production_json,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        productId,d.sku||null,d.external_code||null,d.name,d.public_price??0,(d.supplier_cost??0)+(d.additional_cost??0),d.supplier_cost??0,d.additional_cost??0,d.public_price??0,d.reseller_price??0,d.quantity??1,d.size_label??null,d.print_configuration??null,d.production_days??null,d.availability||'available',jsonValue(d.attributes_json)??null,jsonValue(d.production_json)??null,d.status||'active'
      ]);
      const [rows] = await db.execute('SELECT * FROM product_variants WHERE id=?', [result.insertId]);
      await audit(db, request, 'variant.create', 'product_variant', result.insertId, null, rows[0]);
      return reply.code(201).send({ ok: true, variant: rows[0] });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') return reply.code(409).send({ error: 'VARIANT_CODE_EXISTS' });
      throw error;
    }
  });

  app.patch('/api/v1/admin/catalog/variants/:id', { preHandler: admins }, async (request, reply) => {
    const parsed = variantSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_VARIANT' });
    const db = getDb();
    const id = Number(request.params.id);
    const [beforeRows] = await db.execute('SELECT * FROM product_variants WHERE id=? LIMIT 1', [id]);
    const before = beforeRows[0];
    if (!before) return reply.code(404).send({ error: 'VARIANT_NOT_FOUND' });
    const d = parsed.data;
    const supplierCost = d.supplier_cost === undefined ? Number(before.supplier_cost||0) : d.supplier_cost;
    const additionalCost = d.additional_cost === undefined ? Number(before.additional_cost||0) : d.additional_cost;
    const map = {
      name:d.name,sku:d.sku,external_code:d.external_code,supplier_cost:d.supplier_cost,additional_cost:d.additional_cost,
      public_price:d.public_price,reseller_price:d.reseller_price,quantity:d.quantity,size_label:d.size_label,
      print_configuration:d.print_configuration,production_days:d.production_days,availability:d.availability,status:d.status,
      attributes_json:jsonValue(d.attributes_json),production_json:jsonValue(d.production_json)
    };
    if (d.public_price !== undefined) map.price=d.public_price;
    if (d.supplier_cost !== undefined || d.additional_cost !== undefined) map.cost=supplierCost+additionalCost;
    const entries=Object.entries(map).filter(([,v])=>v!==undefined);
    try {
      if(entries.length)await db.execute(`UPDATE product_variants SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`,[...entries.map(([,v])=>v),id]);
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') return reply.code(409).send({ error: 'VARIANT_CODE_EXISTS' });
      throw error;
    }
    const [afterRows]=await db.execute('SELECT * FROM product_variants WHERE id=?',[id]);
    await audit(db,request,'variant.update','product_variant',id,before,afterRows[0]);
    return {ok:true,variant:afterRows[0]};
  });
}
