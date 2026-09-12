import crypto from 'node:crypto';
import { r2Status } from '../lib/storage.js';
import { buildLaunchChecklist, evaluateProductReadiness, repairSuggestions } from './launch-readiness.js';

export function json(value) {
  return value == null ? null : JSON.stringify(value);
}

export function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function sameFieldValue(field, current, expected) {
  if (field === 'base_price') return Number(current || 0) === Number(expected || 0);
  if (field === 'description' || field === 'status') return String(current ?? '') === String(expected ?? '');
  return false;
}

export async function writeLaunchAudit(connection, request, action, entityType, entityId, before, after) {
  await connection.execute(`
    INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',?,?,?,?,?,?,?)
  `, [Number(request.user.sub), action, entityType, entityId, json(before), json(after), request.ip || null]);
}

export async function readAttestations(connection) {
  const [rows] = await connection.query('SELECT id,attestation_key,status,note,updated_by_user_id,updated_at FROM launch_attestations ORDER BY attestation_key');
  return Object.fromEntries(rows.map((row) => [row.attestation_key, row]));
}

export async function productRows(connection, ids = null) {
  const params = [];
  let where = "p.status<>'archived'";
  if (Array.isArray(ids) && ids.length) {
    const safeIds = ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    if (!safeIds.length) return [];
    where += ` AND p.id IN (${safeIds.map(() => '?').join(',')})`;
    params.push(...safeIds);
  }
  const [rows] = await connection.execute(`
    SELECT p.id,p.name,p.slug,p.status,p.category_id,p.supplier_id,p.base_price,p.short_description,p.description,p.requires_artwork,p.updated_at,
           c.slug AS category_slug,s.status AS supplier_status,
           (SELECT COUNT(*) FROM product_variants v WHERE v.product_id=p.id AND v.status='active') AS variant_count,
           (SELECT COUNT(*) FROM product_variants v WHERE v.product_id=p.id AND v.status='active' AND v.availability<>'unavailable' AND v.public_price>0) AS priced_variant_count,
           (SELECT MIN(NULLIF(v.public_price,0)) FROM product_variants v WHERE v.product_id=p.id AND v.status='active' AND v.availability<>'unavailable' AND v.public_price>0) AS starting_price,
           (SELECT COUNT(*)
              FROM product_media pm
              JOIN media_objects m ON m.id=pm.media_id AND m.visibility='public'
              JOIN media_asset_reviews r ON r.media_id=m.id
               AND r.usage_type='product' AND r.photo_type='real' AND r.supplier_branding='clear'
               AND r.license_status IN ('owned','licensed') AND r.review_status='approved'
             WHERE pm.product_id=p.id AND pm.role='cover') AS cover_count,
           (SELECT COUNT(*)
              FROM product_templates pt
              LEFT JOIN media_objects m ON m.id=pt.media_id AND m.visibility='public' AND m.kind='template'
             WHERE pt.product_id=p.id AND pt.status='active' AND pt.brand_neutral=1 AND pt.verified_at IS NOT NULL
               AND ((pt.media_id IS NOT NULL AND m.id IS NOT NULL) OR (pt.template_type='canva' AND pt.external_url LIKE 'https://%'))) AS template_count,
           (SELECT COUNT(*) FROM product_variants v WHERE v.product_id=p.id AND v.status='active' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.production_json,'$.production_mode')),JSON_UNQUOTE(JSON_EXTRACT(v.production_json,'$.mode'))) IN ('outsourced','hybrid')) AS outsourced_variant_count
      FROM products p
      LEFT JOIN categories c ON c.id=p.category_id
      LEFT JOIN suppliers s ON s.id=p.supplier_id
     WHERE ${where}
     ORDER BY p.id
  `, params);
  return rows;
}

export async function launchSnapshot(connection) {
  const rows = await productRows(connection);
  const evaluated = rows.map((row) => ({ row, readiness: evaluateProductReadiness(row), repairs: repairSuggestions(row) }));
  const [heroRows] = await connection.query(`
    SELECT COUNT(*) AS n
      FROM banners b
      JOIN media_objects dm ON dm.id=b.desktop_media_id AND dm.visibility='public' AND dm.kind='banner'
      JOIN media_asset_reviews rd ON rd.media_id=dm.id AND rd.usage_type='hero' AND rd.review_status='approved'
       AND rd.supplier_branding='clear' AND rd.price_text='clear' AND rd.license_status IN ('owned','licensed')
     WHERE b.placement='home-hero' AND b.status='active'
       AND (b.starts_at IS NULL OR b.starts_at<=NOW()) AND (b.ends_at IS NULL OR b.ends_at>=NOW())
  `);
  const [supplierRows] = await connection.query(`SELECT COUNT(*) total,SUM(status='approved') approved,SUM(status IN ('inactive','suspended')) blocked FROM suppliers`);
  const [commerceRows] = await connection.query(`
    SELECT integration_type,COUNT(*) AS n FROM commerce_integrations
     WHERE status='active' AND adapter_status='verified' AND verified_at IS NOT NULL
     GROUP BY integration_type
  `);
  const commerce = Object.fromEntries(commerceRows.map((row)=>[row.integration_type,Number(row.n||0)]));
  const attestations = await readAttestations(connection);
  const metrics = {
    products_total: evaluated.length,
    products_complete: evaluated.filter((item) => item.readiness.complete).length,
    products_active: evaluated.filter((item) => item.row.status === 'active').length,
    pilot_candidates: evaluated.filter((item) => item.readiness.complete && ['draft','paused'].includes(item.row.status)).length,
    repairable_products: evaluated.filter((item) => item.repairs.length > 0).length,
    active_hero_banners: Number(heroRows[0]?.n || 0),
    active_payment_integrations: commerce.payment || 0,
    active_shipping_integrations: commerce.shipping || 0,
    suppliers_total: Number(supplierRows[0]?.total || 0),
    suppliers_approved: Number(supplierRows[0]?.approved || 0),
    suppliers_blocked: Number(supplierRows[0]?.blocked || 0)
  };
  const storage = await r2Status();
  const checklist = buildLaunchChecklist({ storage, metrics, attestations });
  return { storage, metrics, attestations, checklist, evaluated };
}

export async function createLaunchRun(connection, request, runType, summary) {
  const runUuid = crypto.randomUUID();
  const [result] = await connection.execute(`INSERT INTO launch_runs (run_uuid,run_type,status,actor_user_id,summary_json) VALUES (?,?,'simulated',?,?)`, [runUuid, runType, Number(request.user.sub), json(summary)]);
  return { id: Number(result.insertId), run_uuid: runUuid };
}

export async function loadLaunchRunForUpdate(connection, id) {
  const [rows] = await connection.execute('SELECT * FROM launch_runs WHERE id=? FOR UPDATE', [Number(id)]);
  return rows[0] || null;
}
