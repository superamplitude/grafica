import { z } from 'zod';
import { getDb } from '../lib/db.js';

const rowReviewSchema=z.object({review_status:z.enum(['pending','approved','rejected'])});
const importReviewSchema=z.object({status:z.enum(['staged','reviewed','rejected'])});

async function audit(db,request,action,entityType,entityId,before,after){
  await db.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',?,?,?,?,?,?,?)`,[Number(request.user.sub),action,entityType,entityId,before?JSON.stringify(before):null,after?JSON.stringify(after):null,request.ip||null]);
}

export async function registerAdminSupplierPriceRoutes(app){
  const staff=app.requireRole('super_admin','admin','operations','support');
  const admins=app.requireRole('super_admin','admin');

  app.get('/api/v1/admin/supplier-prices/imports',{preHandler:staff},async()=>{
    const db=getDb();
    const [rows]=await db.query(`SELECT i.*,s.name AS supplier_name FROM supplier_price_imports i LEFT JOIN suppliers s ON s.id=i.supplier_id ORDER BY i.created_at DESC,i.id DESC LIMIT 200`);
    return {items:rows.map(r=>({...r,row_count:Number(r.row_count||0),category_count:Number(r.category_count||0),matched_count:Number(r.matched_count||0),conflict_count:Number(r.conflict_count||0)}))};
  });

  app.get('/api/v1/admin/supplier-prices/imports/:id',{preHandler:staff},async(request,reply)=>{
    const db=getDb();const id=Number(request.params.id);if(!Number.isInteger(id)||id<=0)return reply.code(400).send({error:'INVALID_IMPORT_ID'});
    const [imports]=await db.execute(`SELECT i.*,s.name AS supplier_name FROM supplier_price_imports i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.id=? LIMIT 1`,[id]);
    if(!imports[0])return reply.code(404).send({error:'PRICE_IMPORT_NOT_FOUND'});
    const [[stats]]=await db.execute(`SELECT COUNT(*) AS total,COUNT(DISTINCT category_name) AS categories,SUM(match_status='exact') AS exact_matches,SUM(match_status='unmatched') AS unmatched,SUM(review_status='approved') AS approved,SUM(review_status='rejected') AS rejected FROM supplier_price_rows WHERE import_id=?`,[id]);
    return {import:imports[0],stats:Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,Number(v||0)]))};
  });

  app.get('/api/v1/admin/supplier-prices/imports/:id/rows',{preHandler:staff},async(request,reply)=>{
    const db=getDb();const id=Number(request.params.id);if(!Number.isInteger(id)||id<=0)return reply.code(400).send({error:'INVALID_IMPORT_ID'});
    const q=String(request.query?.q||'').trim().slice(0,160);const category=String(request.query?.category||'').trim().slice(0,255);const match=String(request.query?.match||'').trim();const review=String(request.query?.review||'').trim();
    const limit=Math.min(500,Math.max(1,Number(request.query?.limit||100)||100));const offset=Math.max(0,Number(request.query?.offset||0)||0);
    const where=['r.import_id=?'];const params=[id];
    if(q){const like=`%${q}%`;where.push('(r.source_code LIKE ? OR r.service_description LIKE ? OR r.size_label LIKE ?)');params.push(like,like,like);}
    if(category){where.push('r.category_name=?');params.push(category);}
    if(['unmatched','exact','conflict','manual'].includes(match)){where.push('r.match_status=?');params.push(match);}
    if(['pending','approved','rejected'].includes(review)){where.push('r.review_status=?');params.push(review);}
    const [[count]]=await db.execute(`SELECT COUNT(*) AS n FROM supplier_price_rows r WHERE ${where.join(' AND ')}`,params);
    const [rows]=await db.execute(`SELECT r.*,v.sku AS matched_sku,v.external_code AS matched_external_code,v.name AS matched_variant_name,p.name AS matched_product_name
      FROM supplier_price_rows r LEFT JOIN product_variants v ON v.id=r.matched_variant_id LEFT JOIN products p ON p.id=v.product_id
      WHERE ${where.join(' AND ')} ORDER BY r.row_number LIMIT ? OFFSET ?`,[...params,limit,offset]);
    return {items:rows,total:Number(count.n||0),limit,offset};
  });

  app.get('/api/v1/admin/supplier-prices/imports/:id/categories',{preHandler:staff},async(request,reply)=>{
    const db=getDb();const id=Number(request.params.id);if(!Number.isInteger(id)||id<=0)return reply.code(400).send({error:'INVALID_IMPORT_ID'});
    const [rows]=await db.execute('SELECT category_name,COUNT(*) AS n,MIN(supplier_price) AS min_price,MAX(supplier_price) AS max_price FROM supplier_price_rows WHERE import_id=? GROUP BY category_name ORDER BY category_name',[id]);
    return {items:rows.map(r=>({...r,n:Number(r.n||0),min_price:Number(r.min_price||0),max_price:Number(r.max_price||0)}))};
  });

  app.patch('/api/v1/admin/supplier-prices/rows/:id/review',{preHandler:admins},async(request,reply)=>{
    const parsed=rowReviewSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_PRICE_ROW_REVIEW'});
    const db=getDb();const id=Number(request.params.id);const [beforeRows]=await db.execute('SELECT * FROM supplier_price_rows WHERE id=? LIMIT 1',[id]);const before=beforeRows[0];if(!before)return reply.code(404).send({error:'PRICE_ROW_NOT_FOUND'});
    await db.execute('UPDATE supplier_price_rows SET review_status=? WHERE id=?',[parsed.data.review_status,id]);
    const [afterRows]=await db.execute('SELECT * FROM supplier_price_rows WHERE id=?',[id]);await audit(db,request,'supplier-price.row-review','supplier_price_row',id,before,afterRows[0]);return {ok:true,row:afterRows[0]};
  });

  app.patch('/api/v1/admin/supplier-prices/imports/:id/review',{preHandler:admins},async(request,reply)=>{
    const parsed=importReviewSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_PRICE_IMPORT_REVIEW'});
    const db=getDb();const id=Number(request.params.id);const [beforeRows]=await db.execute('SELECT * FROM supplier_price_imports WHERE id=? LIMIT 1',[id]);const before=beforeRows[0];if(!before)return reply.code(404).send({error:'PRICE_IMPORT_NOT_FOUND'});
    if(before.status==='applied')return reply.code(409).send({error:'APPLIED_IMPORT_IMMUTABLE'});
    const status=parsed.data.status;await db.execute('UPDATE supplier_price_imports SET status=?,reviewed_by_user_id=?,reviewed_at=? WHERE id=?',[status,Number(request.user.sub),status==='reviewed'?new Date():null,id]);
    const [afterRows]=await db.execute('SELECT * FROM supplier_price_imports WHERE id=?',[id]);await audit(db,request,'supplier-price.import-review','supplier_price_import',id,before,afterRows[0]);return {ok:true,import:afterRows[0]};
  });
}
