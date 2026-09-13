import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { parseSupplierPriceTable, SUPPLIER_PRICE_BODY_LIMIT } from '../domain/supplier-price-import.js';
import { executeSupplierPriceImport, previewSupplierPriceImport, rollbackSupplierPriceImport } from '../domain/supplier-price-sync.js';

const querySchema=z.object({supplier_id:z.coerce.number().int().positive(),source_name:z.string().max(255).optional(),expected_sha256:z.string().regex(/^[a-f0-9]{64}$/i).optional()});

function parser(request,payload,done){
  let body='';let bytes=0;payload.setEncoding('utf8');
  payload.on('data',chunk=>{bytes+=Buffer.byteLength(chunk,'utf8');if(bytes>SUPPLIER_PRICE_BODY_LIMIT){const error=Object.assign(new Error('SUPPLIER_PRICE_FILE_TOO_LARGE'),{statusCode:413,code:'SUPPLIER_PRICE_FILE_TOO_LARGE'});done(error);payload.destroy();return;}body+=chunk;});
  payload.on('end',()=>done(null,body));payload.on('error',done);
}

function importError(error,reply){
  const code=error?.code||error?.message||'SUPPLIER_IMPORT_ERROR';
  const status=code==='SUPPLIER_NOT_FOUND'||code==='IMPORT_RUN_NOT_FOUND'?404:code==='ROLLBACK_CONFLICT'||code==='ROLLBACK_VARIANT_IN_USE'||code==='ROLLBACK_PRODUCT_IN_USE'||code==='ROLLBACK_CATEGORY_IN_USE'||code==='IMPORT_RUN_NOT_ROLLBACKABLE'?409:code==='SUPPLIER_PRICE_FILE_TOO_LARGE'?413:400;
  const payload={error:code};if(error?.invalid_count)payload.invalid_count=error.invalid_count;if(error?.invalid)payload.invalid=error.invalid;if(error?.status)payload.status=error.status;if(error?.entity_type)payload.entity_type=error.entity_type;if(error?.entity_id)payload.entity_id=error.entity_id;return reply.code(status).send(payload);
}

export async function registerAdminSupplierImportRoutes(app){
  for(const type of ['text/plain','text/html','application/vnd.ms-excel'])if(!app.hasContentTypeParser(type))app.addContentTypeParser(type,{bodyLimit:SUPPLIER_PRICE_BODY_LIMIT},parser);
  const admins=app.requireRole('super_admin','admin');const superAdmin=app.requireRole('super_admin');

  app.get('/api/v1/admin/supplier-imports',{preHandler:admins},async(request)=>{
    const limit=Math.min(100,Math.max(1,Number(request.query?.limit||30)||30));const db=getDb();
    const [rows]=await db.execute(`SELECT i.id,i.run_uuid,i.supplier_id,s.name AS supplier_name,i.source_name,i.source_sha256,i.source_report_date,i.source_row_count,i.source_category_count,i.source_product_count,i.status,i.summary_json,i.created_at,i.executed_at,i.rolled_back_at FROM supplier_price_imports i LEFT JOIN suppliers s ON s.id=i.supplier_id ORDER BY i.id DESC LIMIT ?`,[limit]);
    return {items:rows.map(row=>({...row,id:Number(row.id),supplier_id:row.supplier_id==null?null:Number(row.supplier_id),source_row_count:Number(row.source_row_count||0),source_category_count:Number(row.source_category_count||0),source_product_count:Number(row.source_product_count||0)}))};
  });

  app.post('/api/v1/admin/supplier-imports/preview',{preHandler:admins,bodyLimit:SUPPLIER_PRICE_BODY_LIMIT},async(request,reply)=>{
    const query=querySchema.safeParse(request.query||{});if(!query.success)return reply.code(400).send({error:'INVALID_IMPORT_QUERY'});
    try{const parsed=parseSupplierPriceTable(request.body);const db=getDb();const preview=await previewSupplierPriceImport(db,{supplierId:query.data.supplier_id,parsed});return {ok:true,...preview};}catch(error){return importError(error,reply);}
  });

  app.post('/api/v1/admin/supplier-imports/execute',{preHandler:superAdmin,bodyLimit:SUPPLIER_PRICE_BODY_LIMIT},async(request,reply)=>{
    const query=querySchema.safeParse(request.query||{});if(!query.success||!query.data.expected_sha256)return reply.code(400).send({error:'INVALID_IMPORT_QUERY'});
    try{const parsed=parseSupplierPriceTable(request.body);if(parsed.source_sha256.toLowerCase()!==query.data.expected_sha256.toLowerCase())return reply.code(409).send({error:'IMPORT_SOURCE_CHANGED'});const db=getDb();return await executeSupplierPriceImport(db,{supplierId:query.data.supplier_id,parsed,sourceName:query.data.source_name||'supplier-price.xls',actorUserId:Number(request.user.sub),ipAddress:request.ip||null});}catch(error){return importError(error,reply);}
  });

  app.post('/api/v1/admin/supplier-imports/:id/rollback',{preHandler:superAdmin},async(request,reply)=>{
    const id=Number(request.params.id);if(!Number.isInteger(id)||id<=0)return reply.code(400).send({error:'INVALID_IMPORT_RUN'});
    try{const db=getDb();return await rollbackSupplierPriceImport(db,{runId:id,actorUserId:Number(request.user.sub),ipAddress:request.ip||null});}catch(error){return importError(error,reply);}
  });
}
