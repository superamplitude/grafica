import 'dotenv/config';
import { getDb } from '../lib/db.js';

const EXPECTED_SHA='c2a7f6b55d41467851195867e3a6cdfe351f38e947afef2ca7e60045ad62c2c5';
const EXPECTED_ROWS=21329;
const EXPECTED_PRODUCTS=1075;
const EXPECTED_CATEGORIES=140;
const SOURCE_SLUG='source-table-2026-09-12';

function fail(code,details={}){const e=new Error(code);e.details=details;throw e;}
const db=getDb();
try{
  const [[supplier]]=await db.execute('SELECT id,status FROM suppliers WHERE slug=? LIMIT 1',[SOURCE_SLUG]);
  if(!supplier)fail('CATALOG_SOURCE_MISSING');
  const supplierId=Number(supplier.id);
  const [[imp]]=await db.execute(`SELECT id,status,source_checksum_sha256,row_count,matched_count,conflict_count FROM supplier_price_imports WHERE source_checksum_sha256=? ORDER BY id DESC LIMIT 1`,[EXPECTED_SHA]);
  if(!imp)fail('FULL_CATALOG_IMPORT_MISSING');
  if(String(imp.status)!=='applied')fail('FULL_CATALOG_IMPORT_NOT_APPLIED',{status:imp.status});
  const importId=Number(imp.id);
  const [[staged]]=await db.execute('SELECT COUNT(*) AS c FROM supplier_price_rows WHERE import_id=?',[importId]);
  const [[products]]=await db.execute(`SELECT COUNT(*) AS c,
    SUM(CASE WHEN short_description IS NULL OR TRIM(short_description)='' THEN 1 ELSE 0 END) AS missing_short,
    SUM(CASE WHEN description IS NULL OR TRIM(description)='' THEN 1 ELSE 0 END) AS missing_long
    FROM products WHERE supplier_id=? AND status='active'`,[supplierId]);
  const [[variants]]=await db.execute(`SELECT COUNT(*) AS c,
    SUM(CASE WHEN public_price<=0 THEN 1 ELSE 0 END) AS missing_public_price,
    COUNT(DISTINCT external_code) AS unique_codes
    FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.supplier_id=? AND v.status='active'`,[supplierId]);
  const [[categories]]=await db.execute(`SELECT COUNT(DISTINCT p.category_id) AS c FROM products p WHERE p.supplier_id=? AND p.status='active'`,[supplierId]);
  const [[matches]]=await db.execute(`SELECT COUNT(*) AS c FROM supplier_price_rows WHERE import_id=? AND match_status='exact' AND review_status='approved' AND matched_variant_id IS NOT NULL`,[importId]);
  const result={
    ok:true,source_sha256:EXPECTED_SHA,import_id:importId,import_status:imp.status,
    source_rows:Number(staged.c||0),products:Number(products.c||0),variants:Number(variants.c||0),categories:Number(categories.c||0),
    exact_matches:Number(matches.c||0),missing_short_descriptions:Number(products.missing_short||0),missing_long_descriptions:Number(products.missing_long||0),
    missing_public_prices:Number(variants.missing_public_price||0),unique_variant_codes:Number(variants.unique_codes||0),source_supplier_identity:'not_proven'
  };
  const expected={source_rows:EXPECTED_ROWS,products:EXPECTED_PRODUCTS,variants:EXPECTED_ROWS,categories:EXPECTED_CATEGORIES,exact_matches:EXPECTED_ROWS,missing_short_descriptions:0,missing_long_descriptions:0,missing_public_prices:0,unique_variant_codes:EXPECTED_ROWS};
  for(const [key,value] of Object.entries(expected))if(result[key]!==value)fail('FULL_CATALOG_VERIFICATION_FAILED',{key,expected:value,actual:result[key],result});
  console.log(JSON.stringify(result,null,2));
}catch(error){
  console.error(JSON.stringify({ok:false,error:error.message,details:error.details||null},null,2));
  process.exitCode=1;
}finally{try{await db.end();}catch{}}
