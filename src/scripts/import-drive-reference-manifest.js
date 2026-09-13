import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../lib/db.js';
import { classifyExternalReference } from '../domain/external-reference-policy.js';

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const manifestPath=process.argv[2] || path.join(__dirname,'..','..','docs','reference-assets','zap-drive-2026-09.json');
const raw=JSON.parse(await fs.readFile(manifestPath,'utf8'));
if(!raw?.source?.provider || !Array.isArray(raw.items)) throw new Error('INVALID_REFERENCE_MANIFEST');

const db=getDb();
let inserted=0,updated=0;
for(const item of raw.items){
  if(!item?.external_id || !item?.external_url || !item?.title) throw new Error('INVALID_REFERENCE_ITEM');
  const classified=classifyExternalReference(item);
  const metadata={manifest:path.basename(manifestPath),root_id:raw.source.root_id||null,captured_at:raw.source.captured_at||null};
  const [before]=await db.execute('SELECT id FROM external_reference_assets WHERE provider=? AND external_id=? LIMIT 1',[raw.source.provider,item.external_id]);
  await db.execute(`
    INSERT INTO external_reference_assets
      (provider,external_id,external_url,source_type,source_group,title,mime_type,supplier_hint,usage_hint,photo_type_hint,supplier_branding_risk,price_text_risk,license_status,ingestion_status,review_required,metadata_json,discovered_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE external_url=VALUES(external_url),source_type=VALUES(source_type),source_group=VALUES(source_group),title=VALUES(title),mime_type=VALUES(mime_type),supplier_hint=VALUES(supplier_hint),usage_hint=VALUES(usage_hint),photo_type_hint=VALUES(photo_type_hint),supplier_branding_risk=VALUES(supplier_branding_risk),price_text_risk=VALUES(price_text_risk),license_status=VALUES(license_status),ingestion_status=IF(ingestion_status='imported','imported',VALUES(ingestion_status)),review_required=IF(ingestion_status='imported',review_required,VALUES(review_required)),metadata_json=VALUES(metadata_json),discovered_at=VALUES(discovered_at)
  `,[
    raw.source.provider,item.external_id,item.external_url,item.source_type||'file',item.source_group||null,item.title,item.mime_type||null,raw.source.supplier_hint||null,
    classified.usage_hint,classified.photo_type_hint,classified.supplier_branding_risk,classified.price_text_risk,classified.license_status,classified.ingestion_status,classified.review_required,JSON.stringify(metadata),raw.source.captured_at?new Date(raw.source.captured_at):new Date()
  ]);
  before.length?updated++:inserted++;
}
const [summaryRows]=await db.query(`SELECT ingestion_status,usage_hint,supplier_branding_risk,COUNT(*) AS n FROM external_reference_assets GROUP BY ingestion_status,usage_hint,supplier_branding_risk ORDER BY ingestion_status,usage_hint,supplier_branding_risk`);
console.log(JSON.stringify({ok:true,manifest:manifestPath,total:raw.items.length,inserted,updated,summary:summaryRows.map(r=>({...r,n:Number(r.n)}))},null,2));
await db.end();
