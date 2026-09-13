import 'dotenv/config';
import { getDb } from '../lib/db.js';

const requiredTables=[
  'schema_migrations','app_settings','media_objects','media_asset_reviews','external_reference_assets','categories','suppliers','products','product_variants','product_media','product_templates','pricing_rules','price_history','customers','orders','order_items','order_access_tokens','checkout_idempotency','artworks','artwork_events','proofs','preflight_jobs','production_jobs','production_events','order_events','staff_users','revoked_tokens','ai_actions','content_blocks','banners','commerce_integrations','launch_runs','launch_changes','launch_attestations','legacy_import_map','audit_logs'
];
const requiredColumns={
  suppliers:['login_url','price_table_url','integration_url','direct_shipping_mode','white_label_status','sync_mode'],
  product_variants:['external_code','supplier_cost','additional_cost','public_price','reseller_price','quantity','availability'],
  product_templates:['media_id','external_url','template_type','version_label','side','width_mm','height_mm','bleed_mm','brand_neutral','verified_at','verified_by_user_id','status'],
  media_asset_reviews:['media_id','usage_type','photo_type','supplier_branding','price_text','license_status','review_status','reviewed_by_user_id','reviewed_at'],
  external_reference_assets:['provider','external_id','external_url','source_type','source_group','title','mime_type','supplier_hint','usage_hint','photo_type_hint','supplier_branding_risk','price_text_risk','license_status','ingestion_status','review_required','metadata_json','imported_media_id'],
  commerce_integrations:['integration_type','provider_code','display_name','integration_mode','adapter_status','status','capabilities_json','config_json','secret_env_json','verified_at','verified_by_user_id'],
  orders:['payment_status','payment_provider','paid_total'],
  artworks:['superseded_at'],
  proofs:['staff_note'],
  preflight_jobs:['artwork_id','status','attempts','available_at','locked_at','last_error'],
  banners:['secondary_cta_label','secondary_cta_url','autoplay_seconds','desktop_media_id','mobile_media_id'],
  launch_runs:['run_uuid','run_type','status','summary_json','executed_at','rolled_back_at'],
  launch_changes:['run_id','entity_type','entity_id','field_name','before_json','after_json','status','skip_reason'],
  launch_attestations:['attestation_key','status','note','updated_by_user_id']
};
const db=getDb();
const [tables]=await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()`);const present=new Set(tables.map(r=>r.TABLE_NAME));const missingTables=requiredTables.filter(t=>!present.has(t));if(missingTables.length)throw new Error(`SCHEMA_MISSING_TABLES:${missingTables.join(',')}`);
for(const [table,columns] of Object.entries(requiredColumns)){const [rows]=await db.execute(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,[table]);const set=new Set(rows.map(r=>r.COLUMN_NAME));const missing=columns.filter(c=>!set.has(c));if(missing.length)throw new Error(`SCHEMA_MISSING_COLUMNS:${table}:${missing.join(',')}`)}
const [migrationRows]=await db.query('SELECT filename,checksum_sha256 FROM schema_migrations ORDER BY filename');if(migrationRows.length<11)throw new Error(`SCHEMA_MIGRATION_COUNT:${migrationRows.length}`);
const [supplierRows]=await db.query('SELECT COUNT(*) AS n FROM suppliers');
const [categoryRows]=await db.query('SELECT COUNT(*) AS n FROM categories');
const [attestationRows]=await db.query('SELECT COUNT(*) AS n FROM launch_attestations');
const [commerceRows]=await db.query(`SELECT integration_type,COUNT(*) AS n FROM commerce_integrations GROUP BY integration_type`);
const commerce=Object.fromEntries(commerceRows.map(r=>[r.integration_type,Number(r.n||0)]));
if(Number(supplierRows[0].n)<5)throw new Error('SCHEMA_SUPPLIER_SEED_MISSING');
if(Number(categoryRows[0].n)<8)throw new Error('SCHEMA_CATEGORY_SEED_MISSING');
if(Number(attestationRows[0].n)<4)throw new Error('SCHEMA_LAUNCH_ATTESTATIONS_MISSING');
if((commerce.payment||0)<4)throw new Error('SCHEMA_PAYMENT_CONNECTOR_SEED_MISSING');
if((commerce.shipping||0)<6)throw new Error('SCHEMA_SHIPPING_CONNECTOR_SEED_MISSING');
console.log(JSON.stringify({ok:true,tables:requiredTables.length,migrations:migrationRows.length,suppliers:Number(supplierRows[0].n),categories:Number(categoryRows[0].n),launch_attestations:Number(attestationRows[0].n),commerce}));
await db.end();
