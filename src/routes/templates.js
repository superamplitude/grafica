import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { publicObjectUrl } from '../lib/storage.js';

const types = ['pdf','svg','eps','cdr','ai','psd','indd','canva','other'];
const typeEnum = z.enum(types);
const sideEnum = z.enum(['front','back','duplex','general']);

const templateFields = z.object({
  media_id: z.number().int().positive().optional().nullable(),
  external_url: z.string().url().max(1000).optional().nullable(),
  template_type: typeEnum,
  version_label: z.string().max(120).optional().nullable(),
  side: sideEnum.optional(),
  width_mm: z.number().positive().max(100000).optional().nullable(),
  height_mm: z.number().positive().max(100000).optional().nullable(),
  bleed_mm: z.number().min(0).max(1000).optional().nullable(),
  status: z.enum(['active','inactive']).optional()
});

function validateTemplateSource(data, ctx) {
  if (!data.media_id && !data.external_url) ctx.addIssue({ code:'custom', path:['media_id'], message:'media_id ou external_url é obrigatório' });
  if (data.media_id && data.external_url) ctx.addIssue({ code:'custom', path:['external_url'], message:'use apenas uma origem' });
  if (data.template_type === 'canva') {
    if (!data.external_url) ctx.addIssue({ code:'custom', path:['external_url'], message:'Canva exige link externo' });
    else {
      try {
        const u = new URL(data.external_url);
        if (u.protocol !== 'https:' || !/(^|\.)canva\.com$/i.test(u.hostname)) ctx.addIssue({ code:'custom', path:['external_url'], message:'link Canva inválido' });
      } catch {}
    }
  } else if (data.external_url) {
    ctx.addIssue({ code:'custom', path:['external_url'], message:'arquivos técnicos devem ser hospedados no armazenamento próprio' });
  }
}

const templateCreateSchema = templateFields.superRefine(validateTemplateSource);
const templateUpdateSchema = templateFields.partial();

const LABELS = Object.freeze({
  pdf:'PDF', svg:'SVG', eps:'EPS', cdr:'CorelDRAW', ai:'Illustrator', psd:'Photoshop', indd:'InDesign', canva:'Canva', other:'Outro'
});

async function audit(db, request, action, entityId, before, after) {
  await db.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',? ,?,'product_template',?,?,?,?)`, [
    Number(request.user.sub), action, entityId,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    request.ip || null
  ]);
}

async function validateMedia(db, mediaId) {
  if (!mediaId) return null;
  const [rows] = await db.execute(`SELECT id,kind,visibility,object_key,original_name,mime_type FROM media_objects WHERE id=? LIMIT 1`, [mediaId]);
  const media = rows[0];
  if (!media || media.kind !== 'template' || media.visibility !== 'public') return null;
  return media;
}

function serialize(row) {
  return {
    id:Number(row.id),
    product_id:Number(row.product_id),
    template_type:row.template_type,
    label:row.version_label || LABELS[row.template_type] || row.template_type,
    version_label:row.version_label,
    side:row.side,
    width_mm:row.width_mm == null ? null : Number(row.width_mm),
    height_mm:row.height_mm == null ? null : Number(row.height_mm),
    bleed_mm:row.bleed_mm == null ? null : Number(row.bleed_mm),
    brand_neutral:Boolean(Number(row.brand_neutral)),
    verified_at:row.verified_at,
    status:row.status,
    url:row.object_key ? publicObjectUrl(row.object_key) : row.external_url,
    original_name:row.original_name || null
  };
}

export async function registerTemplateRoutes(app) {
  const staff = app.requireRole('super_admin','admin','operations','prepress','support');
  const admins = app.requireRole('super_admin','admin');
  const verifiers = app.requireRole('super_admin','admin','prepress');

  app.get('/api/v1/products/:slug/templates', async (request, reply) => {
    const db = getDb();
    const slug = String(request.params.slug || '').trim();
    const [products] = await db.execute(`SELECT id FROM products WHERE slug=? AND status='active' LIMIT 1`, [slug]);
    if (!products[0]) return reply.code(404).send({ error:'PRODUCT_NOT_FOUND' });
    const [rows] = await db.execute(`
      SELECT pt.*,m.object_key,m.original_name
        FROM product_templates pt
        LEFT JOIN media_objects m ON m.id=pt.media_id AND m.kind='template' AND m.visibility='public'
       WHERE pt.product_id=? AND pt.status='active' AND pt.brand_neutral=1 AND pt.verified_at IS NOT NULL
         AND ((pt.media_id IS NOT NULL AND m.id IS NOT NULL) OR (pt.template_type='canva' AND pt.external_url LIKE 'https://%'))
       ORDER BY FIELD(pt.side,'front','back','duplex','general'),FIELD(pt.template_type,'pdf','ai','cdr','psd','indd','canva','svg','eps','other'),pt.id
    `, [products[0].id]);
    return { items:rows.map(serialize) };
  });

  app.get('/api/v1/admin/catalog/products/:id/templates', { preHandler:staff }, async (request, reply) => {
    const db = getDb();
    const productId = Number(request.params.id);
    if (!Number.isInteger(productId) || productId <= 0) return reply.code(400).send({ error:'INVALID_PRODUCT_ID' });
    const [products] = await db.execute('SELECT id,name,slug FROM products WHERE id=? LIMIT 1', [productId]);
    if (!products[0]) return reply.code(404).send({ error:'PRODUCT_NOT_FOUND' });
    const [rows] = await db.execute(`
      SELECT pt.*,m.object_key,m.original_name,m.mime_type
        FROM product_templates pt
        LEFT JOIN media_objects m ON m.id=pt.media_id
       WHERE pt.product_id=?
       ORDER BY pt.id DESC
    `, [productId]);
    return { product:products[0], items:rows.map(serialize) };
  });

  app.post('/api/v1/admin/catalog/products/:id/templates', { preHandler:admins }, async (request, reply) => {
    const parsed = templateCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'INVALID_TEMPLATE', details:parsed.error.flatten() });
    const db = getDb();
    const productId = Number(request.params.id);
    const [products] = await db.execute('SELECT id FROM products WHERE id=? LIMIT 1', [productId]);
    if (!products[0]) return reply.code(404).send({ error:'PRODUCT_NOT_FOUND' });
    const d = parsed.data;
    if (d.media_id && !await validateMedia(db, d.media_id)) return reply.code(409).send({ error:'INVALID_TEMPLATE_MEDIA' });
    const [result] = await db.execute(`
      INSERT INTO product_templates (product_id,media_id,external_url,template_type,version_label,side,width_mm,height_mm,bleed_mm,brand_neutral,verified_at,verified_by_user_id,status)
      VALUES (?,?,?,?,?,?,?,?,?,0,NULL,NULL,?)
    `, [productId,d.media_id||null,d.external_url||null,d.template_type,d.version_label||LABELS[d.template_type]||null,d.side||'general',d.width_mm??null,d.height_mm??null,d.bleed_mm??null,d.status||'active']);
    const [rows] = await db.execute(`SELECT pt.*,m.object_key,m.original_name FROM product_templates pt LEFT JOIN media_objects m ON m.id=pt.media_id WHERE pt.id=?`, [result.insertId]);
    await audit(db, request, 'template.create', result.insertId, null, rows[0]);
    return reply.code(201).send({ ok:true, template:serialize(rows[0]) });
  });

  app.patch('/api/v1/admin/catalog/templates/:id', { preHandler:admins }, async (request, reply) => {
    const parsed = templateUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'INVALID_TEMPLATE', details:parsed.error.flatten() });
    const db = getDb();
    const id = Number(request.params.id);
    const [beforeRows] = await db.execute('SELECT * FROM product_templates WHERE id=? LIMIT 1', [id]);
    const before = beforeRows[0];
    if (!before) return reply.code(404).send({ error:'TEMPLATE_NOT_FOUND' });
    const d = parsed.data;
    const effectiveMedia = d.media_id === undefined ? before.media_id : d.media_id;
    const effectiveExternal = d.external_url === undefined ? before.external_url : d.external_url;
    const effectiveType = d.template_type === undefined ? before.template_type : d.template_type;
    if (effectiveMedia && effectiveExternal) return reply.code(400).send({ error:'TEMPLATE_SOURCE_CONFLICT' });
    if (!effectiveMedia && !effectiveExternal) return reply.code(400).send({ error:'TEMPLATE_SOURCE_REQUIRED' });
    if (effectiveMedia && !await validateMedia(db, Number(effectiveMedia))) return reply.code(409).send({ error:'INVALID_TEMPLATE_MEDIA' });
    if (effectiveType === 'canva') {
      try {
        const u = new URL(String(effectiveExternal || ''));
        if (u.protocol !== 'https:' || !/(^|\.)canva\.com$/i.test(u.hostname)) return reply.code(400).send({ error:'INVALID_CANVA_URL' });
      } catch { return reply.code(400).send({ error:'INVALID_CANVA_URL' }); }
    } else if (effectiveExternal) return reply.code(400).send({ error:'EXTERNAL_TEMPLATE_ONLY_CANVA' });
    const map = {
      media_id:d.media_id,external_url:d.external_url,template_type:d.template_type,version_label:d.version_label,
      side:d.side,width_mm:d.width_mm,height_mm:d.height_mm,bleed_mm:d.bleed_mm,status:d.status,
      brand_neutral:0,verified_at:null,verified_by_user_id:null
    };
    const entries = Object.entries(map).filter(([,value]) => value !== undefined);
    if (entries.length) await db.execute(`UPDATE product_templates SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`, [...entries.map(([,v])=>v),id]);
    const [afterRows] = await db.execute(`SELECT pt.*,m.object_key,m.original_name FROM product_templates pt LEFT JOIN media_objects m ON m.id=pt.media_id WHERE pt.id=?`, [id]);
    await audit(db, request, 'template.update', id, before, afterRows[0]);
    return { ok:true, template:serialize(afterRows[0]) };
  });

  app.post('/api/v1/admin/catalog/templates/:id/verify', { preHandler:verifiers }, async (request, reply) => {
    const body = z.object({ brand_neutral:z.boolean(), approved:z.boolean(), note:z.string().max(2000).optional().nullable() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error:'INVALID_TEMPLATE_VERIFICATION' });
    const db = getDb();
    const id = Number(request.params.id);
    const [beforeRows] = await db.execute(`SELECT pt.*,m.kind AS media_kind,m.visibility AS media_visibility FROM product_templates pt LEFT JOIN media_objects m ON m.id=pt.media_id WHERE pt.id=? LIMIT 1`, [id]);
    const before = beforeRows[0];
    if (!before) return reply.code(404).send({ error:'TEMPLATE_NOT_FOUND' });
    if (body.data.approved && !body.data.brand_neutral) return reply.code(409).send({ error:'TEMPLATE_NOT_BRAND_NEUTRAL' });
    if (body.data.approved && before.media_id && (before.media_kind !== 'template' || before.media_visibility !== 'public')) return reply.code(409).send({ error:'INVALID_TEMPLATE_MEDIA' });
    if (body.data.approved && before.template_type === 'canva') {
      try { const u=new URL(String(before.external_url||'')); if(u.protocol!=='https:'||!/(^|\.)canva\.com$/i.test(u.hostname)) throw new Error('bad'); }
      catch { return reply.code(409).send({ error:'INVALID_CANVA_URL' }); }
    }
    await db.execute(`UPDATE product_templates SET brand_neutral=?,verified_at=?,verified_by_user_id=? WHERE id=?`, [Number(body.data.brand_neutral),body.data.approved?new Date():null,body.data.approved?Number(request.user.sub):null,id]);
    const [afterRows] = await db.execute(`SELECT pt.*,m.object_key,m.original_name FROM product_templates pt LEFT JOIN media_objects m ON m.id=pt.media_id WHERE pt.id=?`, [id]);
    await audit(db, request, body.data.approved?'template.verify':'template.reject-verification', id, before, {...afterRows[0],verification_note:body.data.note||null});
    return { ok:true, template:serialize(afterRows[0]) };
  });
}
