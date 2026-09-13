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
const compressed=await fs.readFile(DATA_PATH);
const rows=JSON.parse(gunzipSync(compressed).toString('utf8'));
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
  let productCount=0,variantCount=0,priceChanges=0,resellerPriceChanges=0;
  for(const group of groups){
    const categoryId=categoryIds.get(group.category);
    const sourceDesc=String(group.description).replace(/\s+/g,' ').trim();
    const summary=`${displayCase(sourceDesc)}. Escolha quantidade, formato, impressão e prazo entre as opções disponíveis.`.slice(0,5000);
    const cfg=JSON.stringify({source:{supplier:'atual-card',source_date:meta.source_date,source_file_sha256:meta.source_file_sha256,group_hash:group.hash},catalog:{variant_count:group.rows.length}});
    const featured=featuredCategories.has(group.category)?1:0;
    await conn.execute(`INSERT INTO products (category_id,supplier_id,sku,name,slug,short_description,description,base_price,status,featured,sort_order,requires_artwork,supports_front,supports_back,config_json)
      VALUES (?,?,?,?,?,?,?,0,'active',?,0,1,1,?,?)
      ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),supplier_id=VALUES(supplier_id),name=VALUES(name),slug=VALUES(slug),short_description=VALUES(short_description),description=VALUES(description),status='active',featured=VALUES(featured),supports_front=1,supports_back=VALUES(supports_back),config_json=VALUES(config_json),updated_at=NOW()`,
      [categoryId,supplierId,group.sku,group.name,group.slug,summary,`Produto gráfico personalizável da categoria ${displayCase(group.category)}. Escolha a opção técnica adequada ao seu pedido.`,featured,Number(group.supports_back),cfg]);
    const [[product]]=await conn.execute('SELECT id FROM products WHERE sku=? LIMIT 1',[group.sku]);const productId=Number(product.id);productCount++;
    let minPrice=null;
    for(const row of group.rows){
      const [code,,description,colors,weight,qty,size,days,priceRaw]=row;
      const supplierCost=parseMoney(priceRaw);
      const calc=calculatePrice({supplier_cost:supplierCost,additional_cost:0},publicRule);
      const resellerCalc=calculatePrice({supplier_cost:supplierCost,additional_cost:0},resellerRule);
      const publicPrice=calc.price;
      const resellerPrice=resellerCalc.price;
      minPrice=minPrice===null?publicPrice:Math.min(minPrice,publicPrice);
      const sku=`CP-${code}`.slice(0,120);
      const attrs=JSON.stringify({source_description:description,source_weight:weight,source_category:group.category});
      const production=JSON.stringify({supplier_slug:'atual-card',source_code:code,source_date:meta.source_date,source_file_sha256:meta.source_file_sha256});
      const [[before]]=await conn.execute('SELECT id,public_price,reseller_price FROM product_variants WHERE external_code=? LIMIT 1',[code]);
      await conn.execute(`INSERT INTO product_variants (product_id,sku,external_code,name,price,cost,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,attributes_json,production_json,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'available',?,?,'active')
        ON DUPLICATE KEY UPDATE product_id=VALUES(product_id),sku=VALUES(sku),name=VALUES(name),price=VALUES(price),cost=VALUES(cost),supplier_cost=VALUES(supplier_cost),additional_cost=0,public_price=VALUES(public_price),reseller_price=VALUES(reseller_price),quantity=VALUES(quantity),size_label=VALUES(size_label),print_configuration=VALUES(print_configuration),production_days=VALUES(production_days),availability='available',attributes_json=VALUES(attributes_json),production_json=VALUES(production_json),status='active'`,
        [productId,sku,code,variantName(row),publicPrice,supplierCost,supplierCost,0,publicPrice,resellerPrice,Math.max(1,parseNumber(qty,1)),size||null,colors||null,parseDays(days),attrs,production]);
      const [[after]]=await conn.execute('SELECT id,public_price,reseller_price FROM product_variants WHERE external_code=? LIMIT 1',[code]);
      if(!before||Number(before.public_price)!==Number(after.public_price)){
        await conn.execute(`INSERT INTO price_history (variant_id,commercial_table,previous_price,new_price,real_cost,margin_percent,rule_id,actor_type) VALUES (?,'public',?,?,?,?,NULL,'catalog_import')`,[after.id,before?Number(before.public_price):null,publicPrice,supplierCost,calc.margin]);
        priceChanges++;
      }
      if(!before||Number(before.reseller_price)!==Number(after.reseller_price)){
        await conn.execute(`INSERT INTO price_history (variant_id,commercial_table,previous_price,new_price,real_cost,margin_percent,rule_id,actor_type) VALUES (?,'reseller',?,?,?,?,NULL,'catalog_import')`,[after.id,before?Number(before.reseller_price):null,resellerPrice,supplierCost,resellerCalc.margin]);
        resellerPriceChanges++;
      }
      variantCount++;
    }
    await conn.execute('UPDATE products SET base_price=? WHERE id=?',[Number(minPrice||0),productId]);
  }
  await conn.commit();
  console.log(JSON.stringify({ok:true,source:'Atual Card',source_date:meta.source_date,rows:rows.length,categories:categories.length,products:productCount,variants:variantCount,public_price_changes:priceChanges,reseller_price_changes:resellerPriceChanges,pricing:{public:'35% real margin; minimum 10%; ending .90',reseller:'18% real margin; minimum 10%; ending .90'},dataset_sha256:datasetSha,supplier_exposed_to_customer:false},null,2));
}catch(error){try{await conn.rollback();}catch{}throw error;}finally{conn.release();await db.end();}
