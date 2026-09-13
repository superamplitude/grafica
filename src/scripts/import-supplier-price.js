import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '../lib/db.js';
import { stageSupplierPriceBuffer } from '../domain/supplier-price-staging.js';

function arg(name,fallback=null){const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]??fallback:fallback;}
const sourcePath=arg('file')||process.argv[2];
if(!sourcePath)throw new Error('PRICE_IMPORT_FILE_REQUIRED');
const sourceName=arg('source-name')||path.basename(sourcePath);
const expectedChecksum=String(arg('expected-sha256')||'').trim().toLowerCase();
const supplierIdRaw=arg('supplier-id');
const supplierSlug=String(arg('supplier-slug')||'').trim();
const bytes=await fs.readFile(sourcePath);
const db=getDb();
try{
  let supplierId=supplierIdRaw?Number(supplierIdRaw):null;
  if(!supplierId&&supplierSlug){const [rows]=await db.execute('SELECT id FROM suppliers WHERE slug=? LIMIT 1',[supplierSlug]);if(!rows[0])throw new Error('SUPPLIER_NOT_FOUND');supplierId=Number(rows[0].id);}
  const result=await stageSupplierPriceBuffer(db,bytes,{source_name:sourceName,source_filename:path.basename(sourcePath),supplier_id:supplierId,expected_checksum_sha256:expectedChecksum||null});
  console.log(JSON.stringify(result,null,2));
}finally{try{await db.end();}catch{}}
