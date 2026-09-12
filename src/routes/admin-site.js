import { z } from 'zod';
import { getDb } from '../lib/db.js';

const bannerSchema = z.object({
  name: z.string().min(2).max(190),
  placement: z.string().min(2).max(80).default('home-hero'),
  eyebrow: z.string().max(190).nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  body: z.string().max(10000).nullable().optional(),
  cta_label: z.string().max(120).nullable().optional(),
  cta_url: z.string().max(500).nullable().optional(),
  sort_order: z.number().int().min(-100000).max(100000).optional(),
  starts_at: z.string().max(40).nullable().optional(),
  ends_at: z.string().max(40).nullable().optional(),
  status: z.enum(['draft','active','paused','archived']).optional()
});

async function audit(db, request, action, id, before, after) {
  await db.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',? ,?,'banner',?,?,?,?)`, [
    Number(request.user.sub), action, id,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    request.ip || null
  ]);
}

function dbDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export async function registerAdminSiteRoutes(app) {
  const staff = app.requireRole('super_admin','admin','operations','prepress','support');
  const admins = app.requireRole('super_admin','admin');

  app.get('/api/v1/admin/site/banners', { preHandler: staff }, async () => {
    const db = getDb();
    const [rows] = await db.query(`
      SELECT b.id,b.name,b.placement,b.eyebrow,b.title,b.body,b.cta_label,b.cta_url,b.sort_order,
             b.starts_at,b.ends_at,b.status,b.desktop_media_id,b.mobile_media_id,b.created_at,b.updated_at
        FROM banners b
       ORDER BY b.placement,b.sort_order,b.id DESC
    `);
    return { items: rows };
  });

  app.post('/api/v1/admin/site/banners', { preHandler: admins }, async (request, reply) => {
    const parsed = bannerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BANNER' });
    const data = parsed.data;
    const startsAt = dbDate(data.starts_at);
    const endsAt = dbDate(data.ends_at);
    if (startsAt === undefined || endsAt === undefined) return reply.code(400).send({ error: 'INVALID_BANNER_DATE' });
    if (startsAt && endsAt && startsAt >= endsAt) return reply.code(400).send({ error: 'INVALID_BANNER_PERIOD' });
    const db = getDb();
    const [result] = await db.execute(`
      INSERT INTO banners (name,placement,eyebrow,title,body,cta_label,cta_url,sort_order,starts_at,ends_at,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `, [data.name,data.placement,data.eyebrow??null,data.title??null,data.body??null,data.cta_label??null,data.cta_url??null,data.sort_order??0,startsAt,endsAt,data.status||'draft']);
    const [rows] = await db.execute('SELECT * FROM banners WHERE id=?', [result.insertId]);
    await audit(db,request,'banner.create',result.insertId,null,rows[0]);
    return reply.code(201).send({ ok:true, banner:rows[0] });
  });

  app.patch('/api/v1/admin/site/banners/:id', { preHandler: admins }, async (request, reply) => {
    const parsed = bannerSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'INVALID_BANNER' });
    const db=getDb();
    const id=Number(request.params.id);
    const [beforeRows]=await db.execute('SELECT * FROM banners WHERE id=? LIMIT 1',[id]);
    const before=beforeRows[0];
    if(!before)return reply.code(404).send({error:'BANNER_NOT_FOUND'});
    const data=parsed.data;
    const startsAt=data.starts_at===undefined?undefined:dbDate(data.starts_at);
    const endsAt=data.ends_at===undefined?undefined:dbDate(data.ends_at);
    if(startsAt===undefined&&data.starts_at!==undefined)return reply.code(400).send({error:'INVALID_BANNER_DATE'});
    if(endsAt===undefined&&data.ends_at!==undefined)return reply.code(400).send({error:'INVALID_BANNER_DATE'});
    const effectiveStart=startsAt===undefined?before.starts_at:startsAt;
    const effectiveEnd=endsAt===undefined?before.ends_at:endsAt;
    if(effectiveStart&&effectiveEnd&&new Date(effectiveStart)>=new Date(effectiveEnd))return reply.code(400).send({error:'INVALID_BANNER_PERIOD'});
    const map={name:data.name,placement:data.placement,eyebrow:data.eyebrow,title:data.title,body:data.body,cta_label:data.cta_label,cta_url:data.cta_url,sort_order:data.sort_order,starts_at:startsAt,ends_at:endsAt,status:data.status};
    const entries=Object.entries(map).filter(([,value])=>value!==undefined);
    if(entries.length)await db.execute(`UPDATE banners SET ${entries.map(([key])=>`${key}=?`).join(',')},updated_at=NOW() WHERE id=?`,[...entries.map(([,value])=>value),id]);
    const [afterRows]=await db.execute('SELECT * FROM banners WHERE id=?',[id]);
    await audit(db,request,'banner.update',id,before,afterRows[0]);
    return {ok:true,banner:afterRows[0]};
  });
}
