import path from 'node:path';
import { parseHtmlXlsPriceTable } from './supplier-price-parser.js';

export async function stageSupplierPriceBuffer(db,buffer,options={}){
  const parsed=parseHtmlXlsPriceTable(buffer);
  const expectedChecksum=String(options.expected_checksum_sha256||'').trim().toLowerCase();
  if(expectedChecksum && !/^[a-f0-9]{64}$/.test(expectedChecksum))throw new Error('INVALID_EXPECTED_SHA256');
  if(expectedChecksum && parsed.checksum_sha256!==expectedChecksum)throw new Error(`PRICE_IMPORT_CHECKSUM_MISMATCH:${parsed.checksum_sha256}`);
  const supplierId=options.supplier_id==null?null:Number(options.supplier_id);
  if(supplierId!==null && (!Number.isInteger(supplierId)||supplierId<=0))throw new Error('INVALID_SUPPLIER_ID');
  if(supplierId){const [supplierRows]=await db.execute('SELECT id FROM suppliers WHERE id=? LIMIT 1',[supplierId]);if(!supplierRows.length)throw new Error('SUPPLIER_NOT_FOUND');}
  const [existing]=await db.execute('SELECT id,status,row_count,category_count,matched_count,conflict_count FROM supplier_price_imports WHERE source_checksum_sha256=? LIMIT 1',[parsed.checksum_sha256]);
  if(existing[0])return {ok:true,idempotent:true,import_id:Number(existing[0].id),checksum_sha256:parsed.checksum_sha256,row_count:Number(existing[0].row_count),category_count:Number(existing[0].category_count),matched_count:Number(existing[0].matched_count||0),conflict_count:Number(existing[0].conflict_count||0),status:existing[0].status,automatic_apply:false};
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const sourceFilename=String(options.source_filename||options.source_name||'TabelaPreco.xls').slice(0,500);
    const sourceName=String(options.source_name||sourceFilename).slice(0,255);
    const [result]=await conn.execute(`INSERT INTO supplier_price_imports
      (supplier_id,source_name,source_filename,source_checksum_sha256,source_date,source_format,status,row_count,category_count,metadata_json,created_by_user_id)
      VALUES (?,?,?,?,?,'html_xls','staged',?,?,?,?,?)`,[
        supplierId,sourceName,path.basename(sourceFilename),parsed.checksum_sha256,parsed.source_date,parsed.row_count,parsed.category_count,
        JSON.stringify({source_size_bytes:Buffer.byteLength(buffer),parser:'html_xls_v1',automatic_apply:false,checksum_locked:Boolean(expectedChecksum)}),options.created_by_user_id??null
      ]);
    const importId=Number(result.insertId);
    const batchSize=300;
    for(let offset=0;offset<parsed.rows.length;offset+=batchSize){
      const batch=parsed.rows.slice(offset,offset+batchSize);
      const placeholders=batch.map(()=>'(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const values=[];
      for(const row of batch)values.push(importId,row.row_number,row.source_code,row.category_name,row.service_description,row.color_configuration,row.weight_value,row.quantity_value,row.size_label,row.production_days,row.supplier_price,'unmatched',JSON.stringify(row.raw_json));
      await conn.query(`INSERT INTO supplier_price_rows
        (import_id,source_row_number,source_code,category_name,service_description,color_configuration,weight_value,quantity_value,size_label,production_days,supplier_price,match_status,raw_json)
        VALUES ${placeholders}`,values);
    }
    await conn.execute(`UPDATE supplier_price_rows r JOIN product_variants v ON v.external_code=r.source_code SET r.matched_variant_id=v.id,r.match_status='exact' WHERE r.import_id=?`,[importId]);
    const [[stats]]=await conn.execute(`SELECT COUNT(*) AS total,COUNT(DISTINCT category_name) AS categories,SUM(match_status='exact') AS matched,SUM(match_status='conflict') AS conflicts FROM supplier_price_rows WHERE import_id=?`,[importId]);
    await conn.execute('UPDATE supplier_price_imports SET row_count=?,category_count=?,matched_count=?,conflict_count=? WHERE id=?',[Number(stats.total||0),Number(stats.categories||0),Number(stats.matched||0),Number(stats.conflicts||0),importId]);
    await conn.commit();
    return {ok:true,idempotent:false,import_id:importId,checksum_sha256:parsed.checksum_sha256,source_date:parsed.source_date,row_count:parsed.row_count,category_count:parsed.category_count,matched_count:Number(stats.matched||0),conflict_count:Number(stats.conflicts||0),status:'staged',automatic_apply:false};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}
