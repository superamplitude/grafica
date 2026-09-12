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
           (SELECT COUNT(*) FROM product_media pm JOIN media_objects m ON m.id=pm.media_id WHERE pm.product_id=p.id AND pm.role='cover' AND m.visibility='public') AS cover_count,
           (SELECT COUNT(*) FROM product_templates pt JOIN media_objects m ON m.id=pt.media_id WHERE pt.product_id=p.id AND pt.status='active' AND m.visibility='public') AS template_count,
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
  const [heroRows] = await connection.query(`SELECT COUNT(*) AS n FROM banners WHERE placement='home-hero' AND status='active' AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())`);
  const [supplierRows] = await connection.query(`SELECT COUNT(*) total,SUM(status='approved') approved,SUM(status IN ('inactive','suspended')) blocked FROM suppliers`);
  const attestations = await readAttestations(connection);
  const metrics = {
    products_total: evaluated.length,
    products_complete: evaluated.filter((item) => item.readiness.complete).length,
    products_active: evaluated.filter((item) => item.row.status === 'active').length,
    pilot_candidates: evaluated.filter((item) => item.readiness.complete && ['draft','paused'].includes(item.row.status)).length,
    repairable_products: evaluated.filter((item) => item.repairs.length > 0).length,
    active_hero_banners: Number(heroRows[0]?.n || 0),
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
