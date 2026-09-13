import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { getDb } from '../lib/db.js';
import { calculatePrice } from '../domain/pricing.js';
import { buildCatalogGroups, displayCase, slugifyCatalog, parseMoney, parseNumber, parseDays, variantName } from '../domain/catalog-import.js';

const ROOT=process.cwd();
const DATA_DIR=path.join(ROOT,'data','catalog');
const META_PATH=path.join(DATA_DIR,'atual-card-2026-09-12-manifest.json');
const DATA_PATH=path.join(DATA_DIR,'atual-card-2026-09-12.json.gz');
const dryRun=process.argv.includes('--dry-run');
const meta=JSON.parse(await fs.readFile(META_PATH,'utf8'));
const rows=JSON.parse(gunzipSync(await fs.readFile(DATA_PATH)).toString('utf8'));
if(!Array.isArray(rows))throw new Error('BUNDLED_CATALOG_INVALID');
const datasetSha=crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
if(rows.length!==Number(meta.row_count))throw new Error(`BUNDLED_CATALOG_ROW_COUNT_MISMATCH:${rows.length}`);
if(datasetSha!==meta.dataset_sha256)throw new Error(`BUNDLED_CATALOG_SHA_MISMATCH:${datasetSha}`);
const groups=buildCatalogGroups(rows);
if(groups.length!==Number(meta.product_group_count))throw new Error(`BUNDLED_CATALOG_GROUP_COUNT_MISMATCH:${groups.length}`);
const categories=[...new Set(rows.map(r=>String(r[1]||'').trim()).filter(Boolean))];
if(categories.length!==Number(meta.category_count))throw new Error(`BUNDLED_CATALOG_CATEGORY_COUNT_MISMATCH:${categories.length}`);
if(dryRun){console.log(JSON.stringify({ok:true,dry_run:true,rows:rows.length,categories:categories.length,products:groups.length,dataset_sha256:datasetSha},null,2));process.exit(0);}

const db=getDb();
const conn=await db.getConnection();
const featuredCategories=new Set(['CARTÕES DE VISITA','ADESIVOS','PANFLETOS, FLYERS E FOLHETOS','BLOCOS, COMANDAS, RECEITUÁRIOS E TALÕES','PASTAS','SACOLAS E SACOS','CANECA, COPOS E TAÇAS','BANNERS','PLACAS']);
const publicRule={calculation_method:'real_margin_percentage',calculation_value:35,minimum_margin:10,rounding_rule:'ending_90'};
const resellerRule={calculation_method:'real_margin_percentage',calculation_value:18,minimum_margin:10,rounding_rule:'ending_90'};
const batch=(items,size=300)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));

try{
  const [[supplier]]=await conn.query("SELECT id FROM suppliers WHERE slug='atual-card' LIMIT 1");
  if(!supplier)throw new Error('ATUAL_CARD_SUPPLIER_NOT_FOUND');
  const supplierId=Number(supplier.id);
  await conn.beginTransaction();
  await conn.execute("UPDATE suppliers SET price_table_url=?,catalog_source_type='assisted',sync_mode='assisted',last_sync_at=NOW() WHERE id=?",[meta.source_page,supplierId]);

  const categoryIds=new Map();
  let sort=0;
  for(const rawCategory of categories){
    const slug=slugifyCatalog(rawCategory,190);const name=displayCase(rawCategory);
    await conn.execute(`INSERT INTO categories (name,slug,description,status,sort_order) VALUES (?,?,?,'active',?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=COALESCE(NULLIF(categories.description,''),VALUES(description)),status='active'`,[name,slug,`Produtos gráficos da categoria ${name}.`,sort++]);
    const [[cat]]=await conn.execute('SELECT id FROM categories WHERE slug=? LIMIT 1',[slug]);categoryIds.set(rawCategory,Number(cat.id));
  }

  await conn.execute(`UPDATE product_variants v JOIN products p ON p.id=v.product_id SET v.status='inactive',v.availability='unavailable' WHERE p.supplier_id=? AND p.sku LIKE 'AC-P-%'`,[supplierId]);
  await conn.execute(`UPDATE products SET status='paused' WHERE supplier_id=? AND sku LIKE 'AC-P-%'`,[supplierId]);

  for(const group of groups){
    const categoryId=categoryIds.get(group.category);
    const sourceDesc=String(group.description).replace(/\s+/g,' ').trim();
    const summary=`${displayCase(sourceDesc)}. Escolha quantidade, formato, impressão e prazo entre as opções disponíveis.`.slice(0,5000);
    const cfg=JSON.stringify({catalog_source_managed:true,source:{supplier:'atual-card',source_date:meta.source_date,source_file_sha256:meta.source_file_sha256,group_hash:group.hash},catalog:{variant_count:group.rows.length}});
    const featured=featuredCategories.has(group.category)?1:0;
    await conn.execute(`INSERT INTO products (category_id,supplier_id,sku,name,slug,short_description,description,base_price,status,featured,sort_order,requires_artwork,supports_front,supports_back,config_json)
      VALUES (?,?,?,?,?,?,?,0,'active',?,0,1,1,?,?)
      ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),supplier_id=VALUES(supplier_id),name=VALUES(name),slug=VALUES(slug),short_description=VALUES(short_description),description=VALUES(description),status='active',featured=VALUES(featured),supports_front=1,supports_back=VALUES(supports_back),config_json=VALUES(config_json),updated_at=NOW()`,
      [categoryId,supplierId,group.sku,group.name,group.slug,summary,`Produto gráfico personalizável da categoria ${displayCase(group.category)}. Escolha a opção técnica adequada ao seu pedido.`,featured,Number(group.supports_back),cfg]);
  }

  const [productRows]=await conn.execute(`SELECT id,sku FROM products WHERE supplier_id=? AND sku LIKE 'AC-P-%'`,[supplierId]);
  const productBySku=new Map(productRows.map(r=>[r.sku,Number(r.id)]));
  if(productBySku.size!==groups.length)throw new Error(`CATALOG_PRODUCT_MAPPING_MISMATCH:${productBySku.size}`);
  const [existingRows]=await conn.execute(`SELECT v.id,v.external_code,v.public_price,v.reseller_price FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.supplier_id=? AND p.sku LIKE 'AC-P-%'`,[supplierId]);
  const beforeByCode=new Map(existingRows.map(r=>[String(r.external_code),{id:Number(r.id),public_price:Number(r.public_price||0),reseller_price:Number(r.reseller_price||0)}]));

  const variantRecords=[];
  const productMinimums=new Map();
  for(const group of groups){
    const productId=productBySku.get(group.sku);
    for(const row of group.rows){
      const [code,,description,colors,weight,qty,size,days,priceRaw]=row;
      const supplierCost=parseMoney(priceRaw);
      const calc=calculatePrice({supplier_cost:supplierCost,additional_cost:0},publicRule);
      const resellerCalc=calculatePrice({supplier_cost:supplierCost,additional_cost:0},resellerRule);
      const publicPrice=calc.price; const resellerPrice=resellerCalc.price;
      productMinimums.set(productId,Math.min(productMinimums.get(productId)??Infinity,publicPrice));
      variantRecords.push({
        productId,sku:`CP-${code}`.slice(0,120),code,name:variantName(row),publicPrice,resellerPrice,supplierCost,
        quantity:Math.max(1,parseNumber(qty,1)),size:size||null,colors:colors||null,days:parseDays(days),
        attrs:JSON.stringify({source_description:description,source_weight:weight,source_category:group.category}),
        production:JSON.stringify({supplier_slug:'atual-card',source_code:code,source_date:meta.source_date,source_file_sha256:meta.source_file_sha256}),
        publicMargin:calc.margin,resellerMargin:resellerCalc.margin
      });
    }
  }

  for(const part of batch(variantRecords,250)){
    const values=[];const placeholders=[];
    for(const r of part){
      placeholders.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,\'available\',?,?,\'active\')');
      values.push(r.productId,r.sku,r.code,r.name,r.publicPrice,r.supplierCost,r.supplierCost,0,r.publicPrice,r.resellerPrice,r.quantity,r.size,r.colors,r.days,r.attrs,r.production);
    }
    await conn.query(`INSERT INTO product_variants (product_id,sku,external_code,name,price,cost,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,attributes_json,production_json,status) VALUES ${placeholders.join(',')}
      ON DUPLICATE KEY UPDATE product_id=VALUES(product_id),sku=VALUES(sku),name=VALUES(name),price=VALUES(price),cost=VALUES(cost),supplier_cost=VALUES(supplier_cost),additional_cost=0,public_price=VALUES(public_price),reseller_price=VALUES(reseller_price),quantity=VALUES(quantity),size_label=VALUES(size_label),print_configuration=VALUES(print_configuration),production_days=VALUES(production_days),availability='available',attributes_json=VALUES(attributes_json),production_json=VALUES(production_json),status='active'`,values);
  }

  const [afterRows]=await conn.execute(`SELECT v.id,v.external_code,v.public_price,v.reseller_price FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.supplier_id=? AND p.sku LIKE 'AC-P-%'`,[supplierId]);
  const afterByCode=new Map(afterRows.map(r=>[String(r.external_code),{id:Number(r.id),public_price:Number(r.public_price||0),reseller_price:Number(r.reseller_price||0)}]));
  const history=[]; let publicChanges=0,resellerChanges=0;
  for(const r of variantRecords){
    const before=beforeByCode.get(r.code); const after=afterByCode.get(r.code);
    if(!after)throw new Error(`CATALOG_VARIANT_MISSING_AFTER_UPSERT:${r.code}`);
    if(!before||before.public_price!==after.public_price){history.push([after.id,'public',before?.public_price??null,r.publicPrice,r.supplierCost,r.publicMargin,'catalog_import']);publicChanges++;}
    if(!before||before.reseller_price!==after.reseller_price){history.push([after.id,'reseller',before?.reseller_price??null,r.resellerPrice,r.supplierCost,r.resellerMargin,'catalog_import']);resellerChanges++;}
  }
  for(const part of batch(history,500)){
    const values=[];const placeholders=[];
    for(const h of part){placeholders.push('(?,?,?,?,?,?,NULL,?)');values.push(...h);}
    await conn.query(`INSERT INTO price_history (variant_id,commercial_table,previous_price,new_price,real_cost,margin_percent,rule_id,actor_type) VALUES ${placeholders.join(',')}`,values);
  }
  for(const [productId,minPrice] of productMinimums)await conn.execute('UPDATE products SET base_price=? WHERE id=?',[Number.isFinite(minPrice)?minPrice:0,productId]);

  const [[activeProducts]]=await conn.execute(`SELECT COUNT(*) AS n FROM products WHERE supplier_id=? AND sku LIKE 'AC-P-%' AND status='active'`,[supplierId]);
  const [[activeVariants]]=await conn.execute(`SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.supplier_id=? AND p.sku LIKE 'AC-P-%' AND v.status='active' AND v.availability<>'unavailable'`,[supplierId]);
  if(Number(activeProducts.n)!==groups.length)throw new Error(`CATALOG_ACTIVE_PRODUCTS_MISMATCH:${activeProducts.n}`);
  if(Number(activeVariants.n)!==rows.length)throw new Error(`CATALOG_ACTIVE_VARIANTS_MISMATCH:${activeVariants.n}`);
  await conn.commit();
  console.log(JSON.stringify({ok:true,source:'Atual Card',source_date:meta.source_date,rows:rows.length,categories:categories.length,products:Number(activeProducts.n),variants:Number(activeVariants.n),public_price_changes:publicChanges,reseller_price_changes:resellerChanges,pricing:{public:'35% real margin; minimum 10%; ending .90',reseller:'18% real margin; minimum 10%; ending .90'},dataset_sha256:datasetSha,supplier_exposed_to_customer:false},null,2));
}catch(error){try{await conn.rollback();}catch{}throw error;}finally{conn.release();await db.end();}
