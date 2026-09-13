import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { publicObjectUrl } from '../lib/storage.js';
import { heroTextHasPricing } from '../domain/hero-policy.js';

const bannerSchema = z.object({
  name: z.string().min(2).max(190),
  placement: z.string().min(2).max(80).default('home-hero'),
  eyebrow: z.string().max(190).nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  body: z.string().max(10000).nullable().optional(),
  cta_label: z.string().max(120).nullable().optional(),
  cta_url: z.string().max(500).nullable().optional(),
  secondary_cta_label: z.string().max(120).nullable().optional(),
  secondary_cta_url: z.string().max(500).nullable().optional(),
  autoplay_seconds: z.number().int().min(3).max(30).optional(),
  desktop_media_id: z.number().int().positive().nullable().optional(),
  mobile_media_id: z.number().int().positive().nullable().optional(),
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

async function validateBannerMedia(db, ids) {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return true;
  const [rows] = await db.execute(`SELECT id FROM media_objects WHERE id IN (${unique.map(() => '?').join(',')}) AND kind='banner' AND visibility='public'`, unique);
  return rows.length === unique.length;
}

async function validateHeroMediaReviews(db, ids) {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return false;
  const [rows] = await db.execute(`
    SELECT media_id FROM media_asset_reviews
     WHERE media_id IN (${unique.map(() => '?').join(',')})
       AND usage_type='hero' AND supplier_branding='clear' AND price_text='clear'
       AND license_status IN ('owned','licensed') AND review_status='approved'
  `, unique);
  return rows.length === unique.length;
}

function serializeBanner(row) {
  return {
    ...row,
    desktop_url: row.desktop_key ? publicObjectUrl(row.desktop_key) : null,
    mobile_url: row.mobile_key ? publicObjectUrl(row.mobile_key) : null
  };
}

export async function registerAdminSiteRoutes(app) {
  const staff = app.requireRole('super_admin','admin','operations','prepress','support');
  const admins = app.requireRole('super_admin','admin');

  app.get('/api/v1/admin/site/banners', { preHandler: staff }, async () => {
    const db = getDb();
    const [rows] = await db.query(`
      SELECT b.id,b.name,b.placement,b.eyebrow,b.title,b.body,b.cta_label,b.cta_url,b.secondary_cta_label,b.secondary_cta_url,
             b.autoplay_seconds,b.sort_order,b.starts_at,b.ends_at,b.status,b.desktop_media_id,b.mobile_media_id,b.created_at,b.updated_at,
             dm.object_key AS desktop_key,mm.object_key AS mobile_key
        FROM banners b
        LEFT JOIN media_objects dm ON dm.id=b.desktop_media_id AND dm.visibility='public'
        LEFT JOIN media_objects mm ON mm.id=b.mobile_media_id AND mm.visibility='public'
       ORDER BY b.placement,b.sort_order,b.id DESC
    `);
    return { items: rows.map(serializeBanner) };
  });

  app.post('/api/v1/admin/site/banners', { preHandler: admins }, async (request, reply) => {
    const parsed = bannerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BANNER' });
    const data = parsed.data;
    const startsAt = dbDate(data.starts_at);
    const endsAt = dbDate(data.ends_at);
    if (startsAt === undefined || endsAt === undefined) return reply.code(400).send({ error: 'INVALID_BANNER_DATE' });
    if (startsAt && endsAt && startsAt >= endsAt) return reply.code(400).send({ error: 'INVALID_BANNER_PERIOD' });
    if (data.placement === 'home-hero' && heroTextHasPricing(data)) return reply.code(409).send({ error:'HERO_PRICE_TEXT_NOT_ALLOWED' });
    const db = getDb();
    if (data.placement === 'home-hero') {
      const [countRows] = await db.query(`SELECT COUNT(*) AS n FROM banners WHERE placement='home-hero' AND status<>'archived'`);
      if (Number(countRows[0]?.n || 0) >= 6) return reply.code(409).send({ error: 'HERO_CAMPAIGN_LIMIT_REACHED', limit: 6 });
    }
    const mediaIds=[Number(data.desktop_media_id||0),Number(data.mobile_media_id||0)];
    const mediaOk = await validateBannerMedia(db, mediaIds);
    if (!mediaOk) return reply.code(409).send({ error: 'INVALID_BANNER_MEDIA' });
    if (data.placement==='home-hero' && (data.status||'draft')==='active' && !await validateHeroMediaReviews(db,mediaIds)) {
      return reply.code(409).send({ error:'HERO_MEDIA_REVIEW_REQUIRED' });
    }
    const [result] = await db.execute(`
      INSERT INTO banners (name,placement,desktop_media_id,mobile_media_id,eyebrow,title,body,cta_label,cta_url,secondary_cta_label,secondary_cta_url,autoplay_seconds,sort_order,starts_at,ends_at,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [data.name,data.placement,data.desktop_media_id??null,data.mobile_media_id??null,data.eyebrow??null,data.title??null,data.body??null,data.cta_label??null,data.cta_url??null,data.secondary_cta_label??null,data.secondary_cta_url??null,data.autoplay_seconds??7,data.sort_order??0,startsAt,endsAt,data.status||'draft']);
    const [rows] = await db.execute(`SELECT b.*,dm.object_key AS desktop_key,mm.object_key AS mobile_key FROM banners b LEFT JOIN media_objects dm ON dm.id=b.desktop_media_id LEFT JOIN media_objects mm ON mm.id=b.mobile_media_id WHERE b.id=?`, [result.insertId]);
    await audit(db,request,'banner.create',result.insertId,null,rows[0]);
    return reply.code(201).send({ ok:true, banner:serializeBanner(rows[0]) });
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
    const effective={
      placement:data.placement===undefined?before.placement:data.placement,
      status:data.status===undefined?before.status:data.status,
      eyebrow:data.eyebrow===undefined?before.eyebrow:data.eyebrow,
      title:data.title===undefined?before.title:data.title,
      body:data.body===undefined?before.body:data.body,
      cta_label:data.cta_label===undefined?before.cta_label:data.cta_label,
      secondary_cta_label:data.secondary_cta_label===undefined?before.secondary_cta_label:data.secondary_cta_label,
      desktop_media_id:data.desktop_media_id===undefined?before.desktop_media_id:data.desktop_media_id,
      mobile_media_id:data.mobile_media_id===undefined?before.mobile_media_id:data.mobile_media_id
    };
    if(effective.placement==='home-hero'&&heroTextHasPricing(effective))return reply.code(409).send({error:'HERO_PRICE_TEXT_NOT_ALLOWED'});
    const mediaIds=[Number(effective.desktop_media_id||0),Number(effective.mobile_media_id||0)];
    const mediaOk = await validateBannerMedia(db, mediaIds);
    if (!mediaOk) return reply.code(409).send({ error: 'INVALID_BANNER_MEDIA' });
    if(effective.placement==='home-hero'&&effective.status==='active'&&!await validateHeroMediaReviews(db,mediaIds))return reply.code(409).send({error:'HERO_MEDIA_REVIEW_REQUIRED'});
    const map={name:data.name,placement:data.placement,desktop_media_id:data.desktop_media_id,mobile_media_id:data.mobile_media_id,eyebrow:data.eyebrow,title:data.title,body:data.body,cta_label:data.cta_label,cta_url:data.cta_url,secondary_cta_label:data.secondary_cta_label,secondary_cta_url:data.secondary_cta_url,autoplay_seconds:data.autoplay_seconds,sort_order:data.sort_order,starts_at:startsAt,ends_at:endsAt,status:data.status};
    const entries=Object.entries(map).filter(([,value])=>value!==undefined);
    if(entries.length)await db.execute(`UPDATE banners SET ${entries.map(([key])=>`${key}=?`).join(',')},updated_at=NOW() WHERE id=?`,[...entries.map(([,value])=>value),id]);
    const [afterRows]=await db.execute(`SELECT b.*,dm.object_key AS desktop_key,mm.object_key AS mobile_key FROM banners b LEFT JOIN media_objects dm ON dm.id=b.desktop_media_id LEFT JOIN media_objects mm ON mm.id=b.mobile_media_id WHERE b.id=?`,[id]);
    await audit(db,request,'banner.update',id,before,afterRows[0]);
    return {ok:true,banner:serializeBanner(afterRows[0])};
  });
}
