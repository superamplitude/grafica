import 'dotenv/config';
import { getDb } from '../lib/db.js';
import { applySupplierPriceImport } from '../domain/catalog-apply.js';

function arg(name,fallback=null){const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]??fallback:fallback;}
let importId=Number(arg('import-id')||process.argv[2]||0);
const sourceName=String(arg('source-name')||'').trim();
const confirm=process.argv.includes('--confirm');
if(!confirm)throw new Error('CATALOG_APPLY_CONFIRMATION_REQUIRED');
const actorIdRaw=Number(arg('actor-id')||0);
const db=getDb();const conn=await db.getConnection();
try{
  if((!Number.isInteger(importId)||importId<=0)&&sourceName){const [rows]=await conn.execute('SELECT id FROM supplier_price_imports WHERE source_name=? ORDER BY id DESC LIMIT 1',[sourceName]);if(!rows[0])throw new Error('PRICE_IMPORT_NOT_FOUND');importId=Number(rows[0].id);}
  if(!Number.isInteger(importId)||importId<=0)throw new Error('PRICE_IMPORT_ID_REQUIRED');
  await conn.beginTransaction();
  const result=await applySupplierPriceImport(conn,{importId,actorId:actorIdRaw||null,confirmApply:true});
  await conn.commit();
  console.log(JSON.stringify(result,null,2));
}catch(error){try{await conn.rollback();}catch{}throw error;}finally{conn.release();await db.end();}
