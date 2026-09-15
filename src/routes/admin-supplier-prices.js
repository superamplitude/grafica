import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { stageSupplierPriceBuffer } from '../domain/supplier-price-staging.js';
import { applySupplierPriceImport } from '../domain/catalog-apply.js';

const rowReviewSchema=z.object({review_status:z.enum(['pending','approved','rejected'])});
const importReviewSchema=z.object({status:z.enum(['staged','reviewed','rejected'])});
const applySchema=z.object({confirmApply:z.literal(true)});
const uploadSchema=z.object({filename:z.string().min(1).max(500),source_name:z.string().min(1).max(255).optional(),supplier_id:z.number().int().positive().optional().nullable(),expected_sha256:z.string().regex(/^[a-f0-9]{64}$/i).optional().nullable(),content_base64:z.string().min(4).max(30_000_000)});
async function audit(db,request,action,entityType,entityId,before,after){await db.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address) VALUES ('staff',?,?,?,?,?,?,?)`,[Number(request.user.sub),action,entityType,entityId,before?JSON.stringify(before):null,after?JSON.stringify(after):null,request.ip||null]);}

function commercialNumber(value){const n=Number(value);return Number.isFinite(n)?n:0;}

export async function registerAdminSupplierPriceRoutes(app){
  const staff=app.requireRole('super_admin','admin','operations','support');const admins=app.requireRole('super_admin','admin');const superAdmin=app.requireRole('super_admin');

  app.get('/api/v1/admin/supplier-prices/catalog',{preHandler:staff},async(request)=>{
    const db=getDb();
    const q=String(request.query?.q||'').trim().slice(0,160);
    const supplierId=Number(request.query?.supplier_id||0);
    const outlier=String(request.query?.outlier??'').trim();
    const sort=String(request.query?.sort||'sale-desc').trim();
    const limit=Math.min(500,Math.max(1,Number(request.query?.limit||100)||100));
    const offset=Math.max(0,Number(request.query?.offset||0)||0);
    const baseWhere=["p.status='active'","v.status='active'"];
    const baseParams=[];
    if(Number.isInteger(supplierId)&&supplierId>0){baseWhere.push('p.supplier_id=?');baseParams.push(supplierId);}
    if(q){const like=`%${q}%`;baseWhere.push('(p.name LIKE ? OR v.external_code LIKE ? OR v.sku LIKE ? OR c.name LIKE ? OR s.name LIKE ?)');baseParams.push(like,like,like,like,like);}
    const rowWhere=[...baseWhere];
    const rowParams=[...baseParams];
    if(outlier==='1')rowWhere.push('v.public_price>=100000');
    if(outlier==='0')rowWhere.push('v.public_price<100000');
    const orderBy={
      'sale-desc':'v.public_price DESC,v.id DESC',
      'sale-asc':'v.public_price ASC,v.id ASC',
      'cost-desc':'v.supplier_cost DESC,v.id DESC',
      'margin-desc':'real_margin_percent DESC,v.public_price DESC',
      'profit-desc':'gross_profit DESC,v.public_price DESC',
      product:'p.name ASC,v.public_price ASC,v.id ASC'
    }[sort]||'v.public_price DESC,v.id DESC';
    const costExpr='(COALESCE(v.supplier_cost,0)+COALESCE(v.additional_cost,0))';
    const profitExpr=`(COALESCE(v.public_price,0)-${costExpr})`;
    const [[summary]]=await db.execute(`
      SELECT COUNT(*) AS variants,
             SUM(CASE WHEN v.public_price>=100000 THEN 1 ELSE 0 END) AS outliers,
             MIN(NULLIF(v.public_price,0)) AS min_sale,
             MAX(v.public_price) AS max_sale,
             MAX(v.supplier_cost) AS max_supplier_cost,
             SUM(${profitExpr}) AS gross_profit_total,
             AVG(CASE WHEN v.public_price>0 THEN (${profitExpr}/v.public_price)*100 ELSE 0 END) AS avg_real_margin
        FROM product_variants v
        JOIN products p ON p.id=v.product_id
        LEFT JOIN categories c ON c.id=p.category_id
        LEFT JOIN suppliers s ON s.id=p.supplier_id
       WHERE ${baseWhere.join(' AND ')}
    `,baseParams);
    const [[count]]=await db.execute(`
      SELECT COUNT(*) AS n
        FROM product_variants v
        JOIN products p ON p.id=v.product_id
        LEFT JOIN categories c ON c.id=p.category_id
        LEFT JOIN suppliers s ON s.id=p.supplier_id
       WHERE ${rowWhere.join(' AND ')}
    `,rowParams);
    const [rows]=await db.execute(`
      SELECT v.id AS variant_id,v.sku,v.external_code,v.name AS variant_name,v.quantity,v.size_label,v.print_configuration,v.production_days,v.availability,
             v.supplier_cost,v.additional_cost,v.public_price,v.reseller_price,
             p.id AS product_id,p.name AS product_name,p.slug AS product_slug,
             c.name AS category_name,s.id AS supplier_id,s.name AS supplier_name,s.slug AS supplier_slug,
             ${costExpr} AS real_cost,
             ${profitExpr} AS gross_profit,
             CASE WHEN v.public_price>0 THEN (${profitExpr}/v.public_price)*100 ELSE 0 END AS real_margin_percent,
             CASE WHEN ${costExpr}>0 THEN (${profitExpr}/${costExpr})*100 ELSE 0 END AS markup_percent,
             CASE WHEN v.reseller_price>0 THEN ((v.reseller_price-${costExpr})/v.reseller_price)*100 ELSE 0 END AS reseller_margin_percent,
             CASE WHEN v.public_price>=100000 THEN 1 ELSE 0 END AS is_outlier
        FROM product_variants v
        JOIN products p ON p.id=v.product_id
        LEFT JOIN categories c ON c.id=p.category_id
        LEFT JOIN suppliers s ON s.id=p.supplier_id
       WHERE ${rowWhere.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?
    `,[...rowParams,limit,offset]);
    const numeric=['variant_id','product_id','supplier_id','quantity','production_days','supplier_cost','additional_cost','public_price','reseller_price','real_cost','gross_profit','real_margin_percent','markup_percent','reseller_margin_percent','is_outlier'];
    const items=rows.map(row=>{const item={...row};for(const key of numeric)if(item[key]!=null)item[key]=commercialNumber(item[key]);return item;});
    return {
      pricing_policy:{public_real_margin_percent:35,reseller_real_margin_percent:18,rounding_rule:'ending_90',outlier_sale_threshold:100000},
      summary:{variants:commercialNumber(summary?.variants),outliers:commercialNumber(summary?.outliers),min_sale:commercialNumber(summary?.min_sale),max_sale:commercialNumber(summary?.max_sale),max_supplier_cost:commercialNumber(summary?.max_supplier_cost),gross_profit_total:commercialNumber(summary?.gross_profit_total),avg_real_margin:commercialNumber(summary?.avg_real_margin)},
      items,total:commercialNumber(count?.n),limit,offset
    };
  });

  app.post('/api/v1/admin/supplier-prices/imports',{preHandler:admins,bodyLimit:32*1024*1024},async(request,reply)=>{const parsed=uploadSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_PRICE_IMPORT_UPLOAD'});const d=parsed.data;let bytes;try{bytes=Buffer.from(d.content_base64,'base64');}catch{return reply.code(400).send({error:'INVALID_PRICE_IMPORT_BASE64'});}if(!bytes.length||bytes.length>22*1024*1024)return reply.code(413).send({error:'PRICE_IMPORT_FILE_SIZE_INVALID'});const db=getDb();try{const result=await stageSupplierPriceBuffer(db,bytes,{source_name:d.source_name||d.filename,source_filename:d.filename,supplier_id:d.supplier_id??null,expected_checksum_sha256:d.expected_sha256||null,created_by_user_id:Number(request.user.sub)});await audit(db,request,'supplier-price.upload','supplier_price_import',result.import_id,null,{checksum_sha256:result.checksum_sha256,row_count:result.row_count,category_count:result.category_count,idempotent:result.idempotent,automatic_apply:false});return reply.code(result.idempotent?200:201).send(result);}catch(error){const message=String(error?.message||'');if(message==='SUPPLIER_NOT_FOUND')return reply.code(404).send({error:message});if(message.startsWith('PRICE_IMPORT_CHECKSUM_MISMATCH'))return reply.code(409).send({error:'PRICE_IMPORT_CHECKSUM_MISMATCH',actual_sha256:message.split(':')[1]||null});if(message.startsWith('PRICE_SOURCE_')||message==='INVALID_EXPECTED_SHA256'||message==='INVALID_SUPPLIER_ID')return reply.code(400).send({error:message});throw error;}});
  app.get('/api/v1/admin/supplier-prices/imports',{preHandler:staff},async()=>{const db=getDb();const [rows]=await db.query(`SELECT i.*,s.name AS supplier_name FROM supplier_price_imports i LEFT JOIN suppliers s ON s.id=i.supplier_id ORDER BY i.created_at DESC,i.id DESC LIMIT 200`);return {items:rows.map(r=>({...r,row_count:Number(r.row_count||0),category_count:Number(r.category_count||0),matched_count:Number(r.matched_count||0),conflict_count:Number(r.conflict_count||0)}))};});
  app.get('/api/v1/admin/supplier-prices/imports/:id',{preHandler:staff},async(request,reply)=>{const db=getDb();const id=Number(request.params.id);if(!Number.isInteger(id)||id<=0)return reply.code(400).send({error:'INVALID_IMPORT_ID'});const [imports]=await db.execute(`SELECT i.*,s.name AS supplier_name FROM supplier_price_imports i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.id=? LIMIT 1`,[id]);if(!imports[0])return reply.code(404).send({error:'PRICE_IMPORT_NOT_FOUND'});const [[stats]]=await db.execute(`SELECT COUNT(*) AS total,COUNT(DISTINCT category_name) AS categories,SUM(match_status='exact') AS exact_matches,SUM(match_status='unmatched') AS unmatched,SUM(review_status='approved') AS approved,SUM(review_status='rejected') AS rejected FROM supplier_price_rows WHERE import_id=?`,[id]);return {import:imports[0],stats:Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,Number(v||0)]))};});
  app.get('/api/v1/admin/supplier-prices/imports/:id/rows',{preHandler:staff},async(request,reply)=>{const db=getDb();const id=Number(request.params.id);if(!Number.isInteger(id)||id<=0)return reply.code(400).send({error:'INVALID_IMPORT_ID'});const q=String(request.query?.q||'').trim().slice(0,160);const category=String(request.query?.category||'').trim().slice(0,255);const match=String(request.query?.match||'').trim();const review=String(request.query?.review||'').trim();const limit=Math.min(500,Math.max(1,Number(request.query?.limit||100)||100));const offset=Math.max(0,Number(request.query?.offset||0)||0);const where=['r.import_id=?'];const params=[id];if(q){const like=`%${q}%`;where.push('(r.source_code LIKE ? OR r.service_description LIKE ? OR r.size_label LIKE ?)');params.push(like,like,like);}if(category){where.push('r.category_name=?');params.push(category);}if(['unmatched','exact','conflict','manual'].includes(match)){where.push('r.match_status=?');params.push(match);}if(['pending','approved','rejected'].includes(review)){where.push('r.review_status=?');params.push(review);}const [[count]]=await db.execute(`SELECT COUNT(*) AS n FROM supplier_price_rows r WHERE ${where.join(' AND ')}`,params);const [rows]=await db.execute(`SELECT r.*,v.sku AS matched_sku,v.external_code AS matched_external_code,v.name AS matched_variant_name,p.name AS matched_product_name FROM supplier_price_rows r LEFT JOIN product_variants v ON v.id=r.matched_variant_id LEFT JOIN products p ON p.id=v.product_id WHERE ${where.join(' AND ')} ORDER BY r.source_row_number LIMIT ? OFFSET ?`,[...params,limit,offset]);return {items:rows,total:Number(count.n||0),limit,offset};});
  app.get('/api/v1/admin/supplier-prices/imports/:id/categories',{preHandler:staff},async(request,reply)=>{const db=getDb();const id=Number(request.params.id);if(!Number.isInteger(id)||id<=0)return reply.code(400).send({error:'INVALID_IMPORT_ID'});const [rows]=await db.execute('SELECT category_name,COUNT(*) AS n,MIN(supplier_price) AS min_price,MAX(supplier_price) AS max_price FROM supplier_price_rows WHERE import_id=? GROUP BY category_name ORDER BY category_name',[id]);return {items:rows.map(r=>({...r,n:Number(r.n||0),min_price:Number(r.min_price||0),max_price:Number(r.max_price||0)}))};});
  app.patch('/api/v1/admin/supplier-prices/rows/:id/review',{preHandler:admins},async(request,reply)=>{const parsed=rowReviewSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_PRICE_ROW_REVIEW'});const db=getDb();const id=Number(request.params.id);const [beforeRows]=await db.execute('SELECT * FROM supplier_price_rows WHERE id=? LIMIT 1',[id]);const before=beforeRows[0];if(!before)return reply.code(404).send({error:'PRICE_ROW_NOT_FOUND'});await db.execute('UPDATE supplier_price_rows SET review_status=? WHERE id=?',[parsed.data.review_status,id]);const [afterRows]=await db.execute('SELECT * FROM supplier_price_rows WHERE id=?',[id]);await audit(db,request,'supplier-price.row-review','supplier_price_row',id,before,afterRows[0]);return {ok:true,row:afterRows[0]};});
  app.patch('/api/v1/admin/supplier-prices/imports/:id/review',{preHandler:admins},async(request,reply)=>{const parsed=importReviewSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_PRICE_IMPORT_REVIEW'});const db=getDb();const id=Number(request.params.id);const [beforeRows]=await db.execute('SELECT * FROM supplier_price_imports WHERE id=? LIMIT 1',[id]);const before=beforeRows[0];if(!before)return reply.code(404).send({error:'PRICE_IMPORT_NOT_FOUND'});if(before.status==='applied')return reply.code(409).send({error:'APPLIED_IMPORT_IMMUTABLE'});const status=parsed.data.status;await db.execute('UPDATE supplier_price_imports SET status=?,reviewed_by_user_id=?,reviewed_at=? WHERE id=?',[status,Number(request.user.sub),status==='reviewed'?new Date():null,id]);const [afterRows]=await db.execute('SELECT * FROM supplier_price_imports WHERE id=?',[id]);await audit(db,request,'supplier-price.import-review','supplier_price_import',id,before,afterRows[0]);return {ok:true,import:afterRows[0]};});
  app.post('/api/v1/admin/supplier-prices/imports/:id/apply',{preHandler:superAdmin},async(request,reply)=>{const parsed=applySchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'CATALOG_APPLY_CONFIRMATION_REQUIRED'});const id=Number(request.params.id);if(!Number.isInteger(id)||id<=0)return reply.code(400).send({error:'INVALID_IMPORT_ID'});const db=getDb();const conn=await db.getConnection();try{await conn.beginTransaction();const [beforeRows]=await conn.execute('SELECT id,status,row_count,category_count,matched_count FROM supplier_price_imports WHERE id=? LIMIT 1',[id]);if(!beforeRows[0]){await conn.rollback();return reply.code(404).send({error:'PRICE_IMPORT_NOT_FOUND'});}const result=await applySupplierPriceImport(conn,{importId:id,actorId:Number(request.user.sub),confirmApply:true});await conn.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address) VALUES ('staff',?,?,?,?,?,?,?)`,[Number(request.user.sub),'supplier-price.catalog-apply','supplier_price_import',id,JSON.stringify(beforeRows[0]),JSON.stringify(result),request.ip||null]);await conn.commit();return result;}catch(error){try{await conn.rollback();}catch{}const message=String(error?.message||'');if(['PRICE_IMPORT_NOT_FOUND','PRICE_IMPORT_REJECTED','PRICE_IMPORT_SUPPLIER_REQUIRED','PRICE_IMPORT_EMPTY','CATALOG_APPLY_CONFIRMATION_REQUIRED'].includes(message))return reply.code(message==='PRICE_IMPORT_NOT_FOUND'?404:409).send({error:message});throw error;}finally{conn.release();}});
}
