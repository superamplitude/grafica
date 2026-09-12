import 'dotenv/config';
import { getDb } from '../lib/db.js';

const requiredTables=[
  'schema_migrations','app_settings','media_objects','categories','suppliers','products','product_variants','product_media','product_templates','pricing_rules','price_history','customers','orders','order_items','order_access_tokens','checkout_idempotency','artworks','artwork_events','proofs','production_jobs','production_events','order_events','staff_users','revoked_tokens','ai_actions','content_blocks','banners','legacy_import_map','audit_logs'
];
const requiredColumns={
  suppliers:['login_url','price_table_url','integration_url','direct_shipping_mode','white_label_status','sync_mode'],
  product_variants:['external_code','supplier_cost','additional_cost','public_price','reseller_price','quantity','availability'],
  orders:['payment_status','payment_provider','paid_total']
};
const db=getDb();
const [tables]=await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()`);const present=new Set(tables.map(r=>r.TABLE_NAME));const missingTables=requiredTables.filter(t=>!present.has(t));if(missingTables.length)throw new Error(`SCHEMA_MISSING_TABLES:${missingTables.join(',')}`);
for(const [table,columns] of Object.entries(requiredColumns)){const [rows]=await db.execute(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,[table]);const set=new Set(rows.map(r=>r.COLUMN_NAME));const missing=columns.filter(c=>!set.has(c));if(missing.length)throw new Error(`SCHEMA_MISSING_COLUMNS:${table}:${missing.join(',')}`)}
const [migrationRows]=await db.query('SELECT filename,checksum_sha256 FROM schema_migrations ORDER BY filename');if(migrationRows.length<5)throw new Error(`SCHEMA_MIGRATION_COUNT:${migrationRows.length}`);
const [supplierRows]=await db.query('SELECT COUNT(*) AS n FROM suppliers');const [categoryRows]=await db.query('SELECT COUNT(*) AS n FROM categories');if(Number(supplierRows[0].n)<5)throw new Error('SCHEMA_SUPPLIER_SEED_MISSING');if(Number(categoryRows[0].n)<8)throw new Error('SCHEMA_CATEGORY_SEED_MISSING');
console.log(JSON.stringify({ok:true,tables:requiredTables.length,migrations:migrationRows.length,suppliers:Number(supplierRows[0].n),categories:Number(categoryRows[0].n)}));
await db.end();
