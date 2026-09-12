import { getDb } from '../lib/db.js';
import { publicObjectUrl } from '../lib/storage.js';

export async function registerSiteHeroRoutes(app) {
  app.get('/api/v1/site/hero', async () => {
    const db = getDb();
    const [rows] = await db.query(`
      SELECT b.id,b.name,b.eyebrow,b.title,b.body,b.cta_label,b.cta_url,b.secondary_cta_label,b.secondary_cta_url,
             b.autoplay_seconds,b.sort_order,dm.object_key AS desktop_key,mm.object_key AS mobile_key
        FROM banners b
        LEFT JOIN media_objects dm ON dm.id=b.desktop_media_id AND dm.visibility='public'
        LEFT JOIN media_objects mm ON mm.id=b.mobile_media_id AND mm.visibility='public'
       WHERE b.placement='home-hero'
         AND b.status='active'
         AND (b.starts_at IS NULL OR b.starts_at<=NOW())
         AND (b.ends_at IS NULL OR b.ends_at>=NOW())
       ORDER BY b.sort_order,b.id
       LIMIT 6
    `);
    return {
      items: rows.map((row) => ({
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
        desktop_url: row.desktop_key ? publicObjectUrl(row.desktop_key) : null,
        mobile_url: row.mobile_key ? publicObjectUrl(row.mobile_key) : null
      }))
    };
  });
}
