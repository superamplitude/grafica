import 'dotenv/config';
import { getDb } from '../lib/db.js';

const requiredTables=[
  'schema_migrations','app_settings','media_objects','media_asset_reviews','categories','suppliers','products','product_variants','product_media','product_templates','pricing_rules','price_history','customers','orders','order_items','order_access_tokens','checkout_idempotency','artworks','artwork_events','proofs','preflight_jobs','production_jobs','production_events','order_events','staff_users','revoked_tokens','ai_actions','content_blocks','banners','commerce_integrations','launch_runs','launch_changes','launch_attestations','supplier_price_imports','supplier_price_import_changes','legacy_import_map','audit_logs'
];
const requiredColumns={
  suppliers:['login_url','price_table_url','integration_url','direct_shipping_mode','white_label_status','sync_mode'],
  products:['supplier_catalog_key'],
  product_variants:['source_uid','external_code','supplier_cost','additional_cost','public_price','reseller_price','quantity','availability'],
  product_templates:['media_id','external_url','template_type','version_label','side','width_mm','height_mm','bleed_mm','brand_neutral','verified_at','verified_by_user_id','status'],
  media_asset_reviews:['media_id','usage_type','photo_type','supplier_branding','price_text','license_status','review_status','reviewed_by_user_id','reviewed_at'],
  commerce_integrations:['integration_type','provider_code','display_name','integration_mode','adapter_status','status','capabilities_json','config_json','secret_env_json','verified_at','verified_by_user_id'],
  supplier_price_imports:['run_uuid','supplier_id','source_name','source_sha256','source_format','source_report_date','source_row_count','source_category_count','source_product_count','status','actor_user_id','summary_json','executed_at','rolled_back_at'],
  supplier_price_import_changes:['run_id','sequence_no','entity_type','entity_id','action','before_json','after_json','rollback_status'],
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
const [sourceUidIndexes]=await db.query(`SELECT INDEX_NAME,NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_variants' AND COLUMN_NAME='source_uid'`);if(!sourceUidIndexes.some(r=>Number(r.NON_UNIQUE)===0))throw new Error('SCHEMA_SOURCE_UID_UNIQUE_INDEX_MISSING');
const [externalCodeIndexes]=await db.query(`SELECT INDEX_NAME,NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_variants' AND COLUMN_NAME='external_code'`);if(externalCodeIndexes.some(r=>Number(r.NON_UNIQUE)===0))throw new Error('SCHEMA_EXTERNAL_CODE_MUST_NOT_BE_GLOBALLY_UNIQUE');
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
console.log(JSON.stringify({ok:true,tables:requiredTables.length,migrations:migrationRows.length,suppliers:Number(supplierRows[0].n),categories:Number(categoryRows[0].n),launch_attestations:Number(attestationRows[0].n),commerce,supplier_import_identity:{source_uid_unique:true,external_code_global_unique:false}}));
await db.end();
