import crypto from 'node:crypto';
import { variantDisplayName } from './supplier-price-import.js';

const IMPORT_SOURCE='supplier-price-html-v1';

function normalizeName(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}

function slugify(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,150) || 'item';
}

function productSlug(supplierSlug,row) {
  return `${slugify(`${row.category}-${row.description}`)}-${slugify(supplierSlug).slice(0,30)}-${row.product_catalog_key.slice(0,8)}`.slice(0,255);
}

function sourceUid(supplierId,code) { return `supplier:${Number(supplierId)}:${code}`; }

function jsonObject(value) {
  if(value==null) return {};
  if(typeof value==='object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function dateOnly(value) {
  if(!value) return null;
  if(typeof value==='string') return value.slice(0,10);
  const d=new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,10);
}

function variantSnapshot(row) {
  if(!row) return null;
  return {
    id:Number(row.id),product_id:Number(row.product_id),source_uid:row.source_uid||null,external_code:row.external_code||null,name:row.name||'',
    cost:Number(row.cost||0),supplier_cost:Number(row.supplier_cost||0),additional_cost:Number(row.additional_cost||0),
    public_price:Number(row.public_price||0),reseller_price:Number(row.reseller_price||0),quantity:Number(row.quantity||0),
    size_label:row.size_label||null,print_configuration:row.print_configuration||null,
    production_days:row.production_days==null?null:Number(row.production_days),availability:row.availability,status:row.status,
    attributes_json:jsonObject(row.attributes_json)
  };
}

function productSnapshot(row) {
  if(!row) return null;
  return {id:Number(row.id),category_id:row.category_id==null?null:Number(row.category_id),supplier_id:row.supplier_id==null?null:Number(row.supplier_id),supplier_catalog_key:row.supplier_catalog_key||null,name:row.name,slug:row.slug,status:row.status};
}

function categorySnapshot(row) {
  if(!row) return null;
  return {id:Number(row.id),name:row.name,slug:row.slug,status:row.status};
}

function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
function stable(value) { return JSON.stringify(canonical(value)); }
function deepEqual(a,b) { return stable(a)===stable(b); }

async function chunks(items,size,fn) { for(let i=0;i<items.length;i+=size) await fn(items.slice(i,i+size)); }

async function insertChanges(connection,runId,changes) {
  let seq=0;
  await chunks(changes,200,async(chunk)=>{
    const values=[]; const params=[];
    for(const change of chunk){seq+=1;values.push('(?,?,?,?,?,?,?)');params.push(runId,seq,change.entity_type,change.entity_id,change.action,change.before?JSON.stringify(change.before):null,JSON.stringify(change.after));}
    if(values.length) await connection.execute(`INSERT INTO supplier_price_import_changes (run_id,sequence_no,entity_type,entity_id,action,before_json,after_json) VALUES ${values.join(',')}`,params);
  });
}

async function loadLatestCompleted(db,supplierId) {
  const [rows]=await db.execute(`SELECT id,run_uuid,source_sha256,source_report_date,executed_at FROM supplier_price_imports WHERE supplier_id=? AND status='completed' ORDER BY id DESC LIMIT 1`,[supplierId]);
  return rows[0]||null;
}

async function loadLegacyExternalCodeConflicts(db,supplierId,incomingCodes) {
  const [rows]=await db.execute(`SELECT pv.id,pv.external_code,pv.name,p.id AS product_id,p.name AS product_name FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE p.supplier_id=? AND pv.source_uid IS NULL AND pv.external_code IS NOT NULL`,[supplierId]);
  return rows.filter(row=>incomingCodes.has(String(row.external_code))).map(row=>({variant_id:Number(row.id),product_id:Number(row.product_id),external_code:String(row.external_code),variant_name:row.name,product_name:row.product_name}));
}

function sourceGuards(parsed,latest,legacyConflicts) {
  const latestDate=dateOnly(latest?.source_report_date);
  const stale=Boolean(parsed.report_date && latestDate && parsed.report_date < latestDate);
  const duplicate=Boolean(latest && String(latest.source_sha256).toLowerCase()===String(parsed.source_sha256).toLowerCase());
  return {
    duplicate_source_run_id:duplicate?Number(latest.id):null,
    latest_report_date:latestDate,
    stale_source:stale,
    external_code_conflicts_count:legacyConflicts.length,
    external_code_conflicts:legacyConflicts.slice(0,20),
    execute_allowed:!duplicate&&!stale&&!legacyConflicts.length
  };
}

function assertGuards(parsed,latest,legacyConflicts) {
  const guards=sourceGuards(parsed,latest,legacyConflicts);
  if(guards.duplicate_source_run_id) throw Object.assign(new Error('IMPORT_SOURCE_ALREADY_APPLIED'),{code:'IMPORT_SOURCE_ALREADY_APPLIED',existing_run_id:guards.duplicate_source_run_id});
  if(guards.stale_source) throw Object.assign(new Error('IMPORT_SOURCE_OLDER_THAN_CURRENT'),{code:'IMPORT_SOURCE_OLDER_THAN_CURRENT',latest_report_date:guards.latest_report_date});
  if(legacyConflicts.length) throw Object.assign(new Error('IMPORT_EXTERNAL_CODE_CONFLICT'),{code:'IMPORT_EXTERNAL_CODE_CONFLICT',conflicts:legacyConflicts.slice(0,20)});
}

export async function previewSupplierPriceImport(db,{supplierId,parsed}) {
  const [supplierRows]=await db.execute('SELECT id,name,slug,status FROM suppliers WHERE id=? LIMIT 1',[supplierId]);
  const supplier=supplierRows[0];
  if(!supplier) throw Object.assign(new Error('SUPPLIER_NOT_FOUND'),{code:'SUPPLIER_NOT_FOUND'});
  const prefix=`supplier:${Number(supplierId)}:%`;
  const [existingVariants]=await db.execute('SELECT source_uid FROM product_variants WHERE source_uid LIKE ?',[prefix]);
  const existingSet=new Set(existingVariants.map(r=>r.source_uid));
  const incoming=new Set(parsed.rows.map(r=>sourceUid(supplierId,r.code)));
  const newRows=parsed.rows.filter(row=>!existingSet.has(sourceUid(supplierId,row.code)));
  let updating=0; for(const uid of incoming) if(existingSet.has(uid)) updating+=1;
  const unavailable=[...existingSet].filter(uid=>!incoming.has(uid)).length;

  const [productRows]=await db.execute('SELECT supplier_catalog_key FROM products WHERE supplier_id=? AND supplier_catalog_key IS NOT NULL',[supplierId]);
  const existingProducts=new Set(productRows.map(r=>r.supplier_catalog_key));
  const incomingNewProducts=new Set(newRows.map(r=>r.product_catalog_key));
  let existingProductCount=0; for(const key of incomingNewProducts) if(existingProducts.has(key)) existingProductCount+=1;

  const [categoryRows]=await db.query('SELECT name FROM categories');
  const existingCategories=new Set(categoryRows.map(r=>normalizeName(r.name)));
  const incomingNewCategories=new Set(newRows.map(r=>normalizeName(r.category)));
  let existingCategoryCount=0; for(const name of incomingNewCategories) if(existingCategories.has(name)) existingCategoryCount+=1;

  const incomingCodes=new Set(parsed.rows.map(r=>String(r.code)));
  const [latest,legacyConflicts]=await Promise.all([loadLatestCompleted(db,supplierId),loadLegacyExternalCodeConflicts(db,supplierId,incomingCodes)]);
  const guards=sourceGuards(parsed,latest,legacyConflicts);

  return {
    supplier:{id:Number(supplier.id),name:supplier.name,slug:supplier.slug,status:supplier.status},
    source:{sha256:parsed.source_sha256,title:parsed.title,report_date:parsed.report_date,rows:parsed.row_count,categories:parsed.category_count,products:parsed.product_count,stats:parsed.stats},
    guards,
    plan:{categories_create:incomingNewCategories.size-existingCategoryCount,products_create:incomingNewProducts.size-existingProductCount,variants_create:incoming.size-updating,variants_update:updating,variants_mark_unavailable:unavailable,publication_effect:'new_products_draft_new_variants_inactive_public_prices_unchanged'},
    sample:parsed.rows.slice(0,20)
  };
}

export async function executeSupplierPriceImport(db,{supplierId,parsed,sourceName='supplier-price.xls',actorUserId=null,ipAddress=null}) {
  const connection=await db.getConnection();
  const runUuid=crypto.randomUUID();
  let runId=null;
  let runCreated=false;
  try {
    await connection.beginTransaction();
    const [supplierRows]=await connection.execute('SELECT * FROM suppliers WHERE id=? FOR UPDATE',[supplierId]);
    const supplier=supplierRows[0];
    if(!supplier) throw Object.assign(new Error('SUPPLIER_NOT_FOUND'),{code:'SUPPLIER_NOT_FOUND'});

    const [latestRows]=await connection.execute(`SELECT id,run_uuid,source_sha256,source_report_date,executed_at FROM supplier_price_imports WHERE supplier_id=? AND status='completed' ORDER BY id DESC LIMIT 1`,[supplierId]);
    const incomingCodes=new Set(parsed.rows.map(r=>String(r.code)));
    const legacyConflicts=await loadLegacyExternalCodeConflicts(connection,supplierId,incomingCodes);
    assertGuards(parsed,latestRows[0]||null,legacyConflicts);

    const [runResult]=await connection.execute(`INSERT INTO supplier_price_imports
      (run_uuid,supplier_id,source_name,source_sha256,source_format,source_report_date,source_row_count,source_category_count,source_product_count,status,actor_user_id,summary_json)
      VALUES (?,?,?,?,?,?,?,?,?,'running',?,?)`,[runUuid,supplierId,String(sourceName).slice(0,255),parsed.source_sha256,parsed.format,parsed.report_date,parsed.row_count,parsed.category_count,parsed.product_count,actorUserId,JSON.stringify({phase:'started'})]);
    runId=Number(runResult.insertId);runCreated=true;
    const changes=[];

    const prefix=`supplier:${Number(supplierId)}:%`;
    const [beforeVariantRows]=await connection.execute(`SELECT id,product_id,source_uid,external_code,name,cost,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,status,attributes_json FROM product_variants WHERE source_uid LIKE ?`,[prefix]);
    const beforeVariants=new Map(beforeVariantRows.map(r=>[r.source_uid,variantSnapshot(r)]));
    const newRows=parsed.rows.filter(row=>!beforeVariants.has(sourceUid(supplierId,row.code)));

    const [categoryRows]=await connection.query('SELECT id,name,slug,status FROM categories');
    const categoryMap=new Map(categoryRows.map(r=>[normalizeName(r.name),r]));
    const sourceCategoryNames=new Map();
    for(const row of newRows) if(!sourceCategoryNames.has(normalizeName(row.category))) sourceCategoryNames.set(normalizeName(row.category),row.category);
    const missingCategories=[];
    for(const [key,name] of sourceCategoryNames) if(!categoryMap.has(key)) missingCategories.push({key,name,slug:`${slugify(name)}-${crypto.createHash('sha1').update(key).digest('hex').slice(0,8)}`.slice(0,190)});
    await chunks(missingCategories,200,async(chunk)=>{
      if(!chunk.length)return;const vals=[];const params=[];
      for(const item of chunk){vals.push('(?,?,\'draft\',0)');params.push(item.name,item.slug);}
      await connection.execute(`INSERT INTO categories (name,slug,status,sort_order) VALUES ${vals.join(',')} ON DUPLICATE KEY UPDATE name=VALUES(name)`,params);
    });
    const [allCategoryRows]=await connection.query('SELECT id,name,slug,status FROM categories');
    categoryMap.clear();for(const row of allCategoryRows)categoryMap.set(normalizeName(row.name),row);
    for(const item of missingCategories){const row=categoryMap.get(item.key);if(row)changes.push({entity_type:'category',entity_id:Number(row.id),action:'created',before:null,after:categorySnapshot(row)});}

    const uniqueProducts=new Map();for(const row of newRows)if(!uniqueProducts.has(row.product_catalog_key))uniqueProducts.set(row.product_catalog_key,row);
    const [beforeProducts]=await connection.execute('SELECT id,category_id,supplier_id,supplier_catalog_key,name,slug,status FROM products WHERE supplier_id=? AND supplier_catalog_key IS NOT NULL',[supplierId]);
    const existingProducts=new Map(beforeProducts.map(r=>[r.supplier_catalog_key,r]));
    const newProducts=[...uniqueProducts.entries()].filter(([key])=>!existingProducts.has(key));
    await chunks(newProducts,150,async(chunk)=>{
      if(!chunk.length)return;const vals=[];const params=[];
      for(const [key,row] of chunk){const category=categoryMap.get(normalizeName(row.category));vals.push('(?,?,?,?,?,NULL,?,0,\'draft\',0,0,1,1,0,?,NULL)');params.push(category?.id??null,supplierId,key,row.description.slice(0,255),productSlug(supplier.slug,row),`Importação de tabela do fornecedor. Categoria de origem: ${row.category}`.slice(0,5000),JSON.stringify({supplier_import:{source:IMPORT_SOURCE,catalog_key:key,source_category:row.category,source_description:row.description}}));}
      await connection.execute(`INSERT INTO products (category_id,supplier_id,supplier_catalog_key,name,slug,sku,short_description,base_price,status,featured,sort_order,requires_artwork,supports_front,supports_back,config_json,seo_json) VALUES ${vals.join(',')} ON DUPLICATE KEY UPDATE supplier_catalog_key=VALUES(supplier_catalog_key)`,params);
    });
    const [allProducts]=await connection.execute('SELECT id,category_id,supplier_id,supplier_catalog_key,name,slug,status FROM products WHERE supplier_id=? AND supplier_catalog_key IS NOT NULL',[supplierId]);
    const productMap=new Map(allProducts.map(r=>[r.supplier_catalog_key,r]));
    for(const [key] of newProducts){const row=productMap.get(key);if(row)changes.push({entity_type:'product',entity_id:Number(row.id),action:'created',before:null,after:productSnapshot(row)});}

    const incomingUids=new Set();
    await chunks(parsed.rows,200,async(chunk)=>{
      const vals=[];const params=[];
      for(const row of chunk){
        const uid=sourceUid(supplierId,row.code);incomingUids.add(uid);const before=beforeVariants.get(uid);const productId=before?.product_id ?? Number(productMap.get(row.product_catalog_key)?.id||0);
        if(!productId) throw Object.assign(new Error('IMPORT_PRODUCT_MAPPING_MISSING'),{code:'IMPORT_PRODUCT_MAPPING_MISSING',catalog_key:row.product_catalog_key});
        const attrs={...(before?.attributes_json||{}),supplier_source:{format:parsed.format,report_date:parsed.report_date,source_sha256:parsed.source_sha256,category:row.category,description:row.description,weight:row.weight,weight_raw:row.weight_raw}};
        vals.push("(?,?,?,?,0,?,?,0,0,0,?,?,?,?,'available',?,NULL,'inactive')");
        params.push(productId,uid,row.code,variantDisplayName(row),row.supplier_price,row.supplier_price,row.quantity,row.size,row.colors,row.production_days,JSON.stringify(attrs));
      }
      await connection.execute(`INSERT INTO product_variants (product_id,source_uid,external_code,name,price,cost,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,attributes_json,production_json,status) VALUES ${vals.join(',')} ON DUPLICATE KEY UPDATE external_code=VALUES(external_code),name=VALUES(name),supplier_cost=VALUES(supplier_cost),cost=VALUES(supplier_cost)+additional_cost,quantity=VALUES(quantity),size_label=VALUES(size_label),print_configuration=VALUES(print_configuration),production_days=VALUES(production_days),availability='available',attributes_json=VALUES(attributes_json)`,params);
    });

    const missingIds=[];for(const [uid,before] of beforeVariants)if(!incomingUids.has(uid)&&before.availability!=='unavailable')missingIds.push(before.id);
    await chunks(missingIds,500,async(chunk)=>{if(chunk.length)await connection.execute(`UPDATE product_variants SET availability='unavailable' WHERE id IN (${chunk.map(()=>'?').join(',')})`,chunk);});
    const [afterVariantRows]=await connection.execute(`SELECT id,product_id,source_uid,external_code,name,cost,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,status,attributes_json FROM product_variants WHERE source_uid LIKE ?`,[prefix]);
    const afterVariants=new Map(afterVariantRows.map(r=>[r.source_uid,variantSnapshot(r)]));
    for(const row of parsed.rows){const uid=sourceUid(supplierId,row.code);const before=beforeVariants.get(uid)||null;const after=afterVariants.get(uid);if(!after)throw Object.assign(new Error('IMPORT_VARIANT_MAPPING_MISSING'),{code:'IMPORT_VARIANT_MAPPING_MISSING',source_uid:uid});if(!before)changes.push({entity_type:'variant',entity_id:after.id,action:'created',before:null,after});else if(!deepEqual(before,after))changes.push({entity_type:'variant',entity_id:after.id,action:'updated',before,after});}
    for(const [uid,before] of beforeVariants){if(incomingUids.has(uid))continue;const after=afterVariants.get(uid);if(after&&!deepEqual(before,after))changes.push({entity_type:'variant',entity_id:after.id,action:'updated',before,after});}

    await insertChanges(connection,runId,changes);
    const summary={rows:parsed.row_count,categories:parsed.category_count,products:parsed.product_count,changes:changes.length,categories_created:changes.filter(c=>c.entity_type==='category'&&c.action==='created').length,products_created:changes.filter(c=>c.entity_type==='product'&&c.action==='created').length,variants_created:changes.filter(c=>c.entity_type==='variant'&&c.action==='created').length,variants_updated:changes.filter(c=>c.entity_type==='variant'&&c.action==='updated').length,variants_marked_unavailable:missingIds.length,publication:'not_automatic',supplier_previous_last_sync_at:supplier.last_sync_at||null};
    await connection.execute('UPDATE suppliers SET last_sync_at=NOW() WHERE id=?',[supplierId]);
    await connection.execute("UPDATE supplier_price_imports SET status='completed',summary_json=?,executed_at=NOW() WHERE id=?",[JSON.stringify(summary),runId]);
    await connection.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address) VALUES ('staff',?,'supplier.price-import','supplier',?,NULL,?,?)`,[actorUserId,supplierId,JSON.stringify({run_uuid:runUuid,source_sha256:parsed.source_sha256,...summary}),ipAddress]);
    await connection.commit();
    return {ok:true,run_id:runId,run_uuid:runUuid,status:'completed',summary};
  } catch(error) {
    await connection.rollback();
    if(runCreated){const failure={error:error?.code||error?.message||'IMPORT_FAILED'};await db.execute(`INSERT INTO supplier_price_imports (run_uuid,supplier_id,source_name,source_sha256,source_format,source_report_date,source_row_count,source_category_count,source_product_count,status,actor_user_id,summary_json,executed_at) VALUES (?,?,?,?,?,?,?,?,?,'failed',?,?,NOW())`,[runUuid,supplierId,String(sourceName).slice(0,255),parsed.source_sha256,parsed.format,parsed.report_date,parsed.row_count,parsed.category_count,parsed.product_count,actorUserId,JSON.stringify(failure)]).catch(()=>{});}
    throw error;
  } finally { connection.release(); }
}

function snapshotForType(type,row){if(type==='variant')return variantSnapshot(row);if(type==='product')return productSnapshot(row);if(type==='category')return categorySnapshot(row);return null;}

export async function rollbackSupplierPriceImport(db,{runId,actorUserId=null,ipAddress=null}) {
  const connection=await db.getConnection();
  try {
    await connection.beginTransaction();
    const [runs]=await connection.execute('SELECT * FROM supplier_price_imports WHERE id=? FOR UPDATE',[runId]);const run=runs[0];
    if(!run)throw Object.assign(new Error('IMPORT_RUN_NOT_FOUND'),{code:'IMPORT_RUN_NOT_FOUND'});
    if(run.status!=='completed')throw Object.assign(new Error('IMPORT_RUN_NOT_ROLLBACKABLE'),{code:'IMPORT_RUN_NOT_ROLLBACKABLE',status:run.status});
    await connection.execute('SELECT id FROM suppliers WHERE id=? FOR UPDATE',[run.supplier_id]);
    const [latestRows]=await connection.execute("SELECT id FROM supplier_price_imports WHERE supplier_id=? AND status='completed' ORDER BY id DESC LIMIT 1",[run.supplier_id]);
    if(Number(latestRows[0]?.id)!==Number(runId))throw Object.assign(new Error('ROLLBACK_NOT_LATEST_IMPORT'),{code:'ROLLBACK_NOT_LATEST_IMPORT',latest_run_id:Number(latestRows[0]?.id||0)});
    const [changes]=await connection.execute('SELECT * FROM supplier_price_import_changes WHERE run_id=? ORDER BY sequence_no DESC',[runId]);let rolledBack=0;
    for(const change of changes){
      const before=jsonObject(change.before_json);const after=jsonObject(change.after_json);const type=change.entity_type;const id=Number(change.entity_id);
      if(type==='variant'){
        const [rows]=await connection.execute(`SELECT id,product_id,source_uid,external_code,name,cost,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,status,attributes_json FROM product_variants WHERE id=? FOR UPDATE`,[id]);const current=snapshotForType(type,rows[0]);
        if(change.action==='created'){
          if(!current){await connection.execute("UPDATE supplier_price_import_changes SET rollback_status='rolled_back' WHERE id=?",[change.id]);continue;}
          if(!deepEqual(current,after))throw Object.assign(new Error('ROLLBACK_CONFLICT'),{code:'ROLLBACK_CONFLICT',entity_type:type,entity_id:id});
          const [refs]=await connection.execute('SELECT COUNT(*) AS n FROM order_items WHERE variant_id=?',[id]);if(Number(refs[0].n)>0)throw Object.assign(new Error('ROLLBACK_VARIANT_IN_USE'),{code:'ROLLBACK_VARIANT_IN_USE',entity_id:id});
          await connection.execute('DELETE FROM product_variants WHERE id=?',[id]);
        }else{
          if(!current||!deepEqual(current,after))throw Object.assign(new Error('ROLLBACK_CONFLICT'),{code:'ROLLBACK_CONFLICT',entity_type:type,entity_id:id});
          await connection.execute(`UPDATE product_variants SET product_id=?,source_uid=?,external_code=?,name=?,cost=?,supplier_cost=?,additional_cost=?,public_price=?,reseller_price=?,quantity=?,size_label=?,print_configuration=?,production_days=?,availability=?,status=?,attributes_json=? WHERE id=?`,[before.product_id,before.source_uid,before.external_code,before.name,before.cost,before.supplier_cost,before.additional_cost,before.public_price,before.reseller_price,before.quantity,before.size_label,before.print_configuration,before.production_days,before.availability,before.status,JSON.stringify(before.attributes_json||{}),id]);
        }
      }else if(type==='product'&&change.action==='created'){
        const [rows]=await connection.execute('SELECT id,category_id,supplier_id,supplier_catalog_key,name,slug,status FROM products WHERE id=? FOR UPDATE',[id]);const current=snapshotForType(type,rows[0]);
        if(!current){await connection.execute("UPDATE supplier_price_import_changes SET rollback_status='rolled_back' WHERE id=?",[change.id]);continue;}
        if(!deepEqual(current,after))throw Object.assign(new Error('ROLLBACK_CONFLICT'),{code:'ROLLBACK_CONFLICT',entity_type:type,entity_id:id});
        const [refs]=await connection.execute(`SELECT (SELECT COUNT(*) FROM product_variants WHERE product_id=?) + (SELECT COUNT(*) FROM product_media WHERE product_id=?) + (SELECT COUNT(*) FROM product_templates WHERE product_id=?) + (SELECT COUNT(*) FROM order_items WHERE product_id=?) AS n`,[id,id,id,id]);if(Number(refs[0].n)>0)throw Object.assign(new Error('ROLLBACK_PRODUCT_IN_USE'),{code:'ROLLBACK_PRODUCT_IN_USE',entity_id:id});
        await connection.execute('DELETE FROM products WHERE id=?',[id]);
      }else if(type==='category'&&change.action==='created'){
        const [rows]=await connection.execute('SELECT id,name,slug,status FROM categories WHERE id=? FOR UPDATE',[id]);const current=snapshotForType(type,rows[0]);
        if(!current){await connection.execute("UPDATE supplier_price_import_changes SET rollback_status='rolled_back' WHERE id=?",[change.id]);continue;}
        if(!deepEqual(current,after))throw Object.assign(new Error('ROLLBACK_CONFLICT'),{code:'ROLLBACK_CONFLICT',entity_type:type,entity_id:id});
        const [refs]=await connection.execute('SELECT COUNT(*) AS n FROM products WHERE category_id=?',[id]);if(Number(refs[0].n)>0)throw Object.assign(new Error('ROLLBACK_CATEGORY_IN_USE'),{code:'ROLLBACK_CATEGORY_IN_USE',entity_id:id});
        await connection.execute('DELETE FROM categories WHERE id=?',[id]);
      }
      await connection.execute("UPDATE supplier_price_import_changes SET rollback_status='rolled_back' WHERE id=?",[change.id]);rolledBack+=1;
    }
    const summary=jsonObject(run.summary_json);await connection.execute('UPDATE suppliers SET last_sync_at=? WHERE id=?',[summary.supplier_previous_last_sync_at||null,run.supplier_id]);
    await connection.execute("UPDATE supplier_price_imports SET status='rolled_back',rolled_back_at=NOW() WHERE id=?",[runId]);
    await connection.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address) VALUES ('staff',?,'supplier.price-import.rollback','supplier',?,NULL,?,?)`,[actorUserId,run.supplier_id,JSON.stringify({run_id:runId,run_uuid:run.run_uuid,changes:rolledBack}),ipAddress]);
    await connection.commit();return {ok:true,run_id:Number(runId),run_uuid:run.run_uuid,status:'rolled_back',changes:rolledBack};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
