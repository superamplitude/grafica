import 'dotenv/config';
import assert from 'node:assert/strict';
import { getDb } from '../lib/db.js';
import { parseSupplierPriceTable } from '../domain/supplier-price-import.js';
import { executeSupplierPriceImport, rollbackSupplierPriceImport } from '../domain/supplier-price-sync.js';

function html(date,rows){return `<table><tbody><tr><th>TABELA DE PREÇOS ${date}</th></tr><tr><th>Código</th><th>Categoria</th><th>Descrição do Serviço</th><th>Cores</th><th>Peso</th><th>Qtde</th><th>Tam</th><th>Prazo</th><th>Preço R$</th></tr>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
const first=parseSupplierPriceTable(html('12/09/2026',[
 ['CI-A1','CI CARTAO','COUCHE 300g','4X0','100','100','90 x 50','2','R$ 50,00'],
 ['CI-A2','CI CARTAO','COUCHE 300g','4X0','500','500','90 x 50','2','R$ 100,00'],
 ['CI-B1','CI BANNER','LONA 440g','4X0','800','1','100 x 80','3','R$ 80,00']
]));
const second=parseSupplierPriceTable(html('13/09/2026',[
 ['CI-A1','CI CARTAO','COUCHE 300g','4X0','100','100','90 x 50','2','R$ 55,00'],
 ['CI-A2','CI CARTAO','COUCHE 300g','4X0','500','500','90 x 50','2','R$ 100,00'],
 ['CI-C1','CI BANNER','LONA 440g','4X0','900','2','100 x 80','3','R$ 90,00']
]));

const db=getDb();let supplierId;
try{
 await db.execute("DELETE FROM suppliers WHERE slug='ci-supplier-import'");
 const [supplierResult]=await db.execute("INSERT INTO suppliers (name,slug,status,sync_mode) VALUES ('CI Supplier Import','ci-supplier-import','testing','assisted')");supplierId=Number(supplierResult.insertId);
 const run1=await executeSupplierPriceImport(db,{supplierId,parsed:first,sourceName:'ci-1.xls'});assert.equal(run1.status,'completed');assert.equal(run1.summary.variants_created,3);assert.equal(run1.summary.products_created,2);
 let [rows]=await db.execute('SELECT source_uid,supplier_cost,public_price,status,availability FROM product_variants WHERE source_uid LIKE ? ORDER BY source_uid',[`supplier:${supplierId}:%`]);assert.equal(rows.length,3);assert.ok(rows.every(r=>Number(r.public_price)===0));assert.ok(rows.every(r=>r.status==='inactive'));assert.ok(rows.every(r=>r.availability==='available'));
 const run2=await executeSupplierPriceImport(db,{supplierId,parsed:second,sourceName:'ci-2.xls'});assert.equal(run2.status,'completed');
 [rows]=await db.execute('SELECT source_uid,supplier_cost,availability FROM product_variants WHERE source_uid LIKE ? ORDER BY source_uid',[`supplier:${supplierId}:%`]);assert.equal(rows.length,4);const byUid=Object.fromEntries(rows.map(r=>[r.source_uid,r]));assert.equal(Number(byUid[`supplier:${supplierId}:CI-A1`].supplier_cost),55);assert.equal(byUid[`supplier:${supplierId}:CI-B1`].availability,'unavailable');assert.equal(Number(byUid[`supplier:${supplierId}:CI-C1`].supplier_cost),90);
 const back2=await rollbackSupplierPriceImport(db,{runId:run2.run_id});assert.equal(back2.status,'rolled_back');
 [rows]=await db.execute('SELECT source_uid,supplier_cost,availability FROM product_variants WHERE source_uid LIKE ? ORDER BY source_uid',[`supplier:${supplierId}:%`]);assert.equal(rows.length,3);const restored=Object.fromEntries(rows.map(r=>[r.source_uid,r]));assert.equal(Number(restored[`supplier:${supplierId}:CI-A1`].supplier_cost),50);assert.equal(restored[`supplier:${supplierId}:CI-B1`].availability,'available');assert.equal(restored[`supplier:${supplierId}:CI-C1`],undefined);
 const back1=await rollbackSupplierPriceImport(db,{runId:run1.run_id});assert.equal(back1.status,'rolled_back');
 const [remaining]=await db.execute('SELECT COUNT(*) AS n FROM product_variants WHERE source_uid LIKE ?',[`supplier:${supplierId}:%`]);assert.equal(Number(remaining[0].n),0);
 const [remainingProducts]=await db.execute('SELECT COUNT(*) AS n FROM products WHERE supplier_id=? AND supplier_catalog_key IS NOT NULL',[supplierId]);assert.equal(Number(remainingProducts[0].n),0);
 console.log(JSON.stringify({ok:true,run1:run1.summary,run2:run2.summary,rollback2:back2.changes,rollback1:back1.changes}));
}finally{if(supplierId){await db.execute('DELETE FROM supplier_price_imports WHERE supplier_id=?',[supplierId]).catch(()=>{});await db.execute('DELETE FROM suppliers WHERE id=?',[supplierId]).catch(()=>{});}await db.end();}
