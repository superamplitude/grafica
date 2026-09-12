import { getDb } from '../lib/db.js';
import { publicObjectUrl } from '../lib/storage.js';

function hasPricing(data = {}) {
  const text=[data.eyebrow,data.title,data.body,data.cta_label,data.secondary_cta_label].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return /r\$\s*\d|\bpre[cç]o\b|\ba partir de\b|\bpor apenas\b|\bde\s+r\$|\d+[.,]\d{2}(?:\s|$)|\b\d+\s*%\s*(?:off|de desconto)\b/i.test(text);
}

export async function registerSiteHeroRoutes(app) {
  app.get('/api/v1/site/hero', async () => {
    const db = getDb();
    const [rows] = await db.query(`
      SELECT b.id,b.name,b.eyebrow,b.title,b.body,b.cta_label,b.cta_url,b.secondary_cta_label,b.secondary_cta_url,
             b.autoplay_seconds,b.sort_order,dm.object_key AS desktop_key,mm.object_key AS mobile_key
        FROM banners b
        JOIN media_objects dm ON dm.id=b.desktop_media_id AND dm.visibility='public' AND dm.kind='banner'
        JOIN media_asset_reviews rd ON rd.media_id=dm.id AND rd.usage_type='hero' AND rd.review_status='approved'
          AND rd.supplier_branding='clear' AND rd.price_text='clear' AND rd.license_status IN ('owned','licensed')
        LEFT JOIN media_objects mm ON mm.id=b.mobile_media_id AND mm.visibility='public' AND mm.kind='banner'
        LEFT JOIN media_asset_reviews rm ON rm.media_id=mm.id AND rm.usage_type='hero' AND rm.review_status='approved'
          AND rm.supplier_branding='clear' AND rm.price_text='clear' AND rm.license_status IN ('owned','licensed')
       WHERE b.placement='home-hero'
         AND b.status='active'
         AND (b.mobile_media_id IS NULL OR (mm.id IS NOT NULL AND rm.media_id IS NOT NULL))
         AND (b.starts_at IS NULL OR b.starts_at<=NOW())
         AND (b.ends_at IS NULL OR b.ends_at>=NOW())
       ORDER BY b.sort_order,b.id
       LIMIT 6
    `);
    return {
      items: rows.filter((row)=>!hasPricing(row)).map((row) => ({
        id: Number(row.id),
        name: row.name,
        eyebrow: row.eyebrow,
        title: row.title,
        body: row.body,
        cta_label: row.cta_label,
        cta_url: row.cta_url,
        secondary_cta_label: row.secondary_cta_label,
        secondary_cta_url: row.secondary_cta_url,
        autoplay_seconds: Math.min(30, Math.max(3, Number(row.autoplay_seconds || 7))),
        desktop_url: publicObjectUrl(row.desktop_key),
        mobile_url: row.mobile_key ? publicObjectUrl(row.mobile_key) : null
      }))
    };
  });
}
