import { calculatePrice } from './pricing.js';
import { buildCatalogGroups, displayCase, normalizeDescription, slugifyCatalog } from './catalog-import.js';

const PUBLIC_RULE={calculation_method:'real_margin_percentage',calculation_value:35,minimum_margin:10,rounding_rule:'ending_90'};
const RESELLER_RULE={calculation_method:'real_margin_percentage',calculation_value:18,minimum_margin:10,rounding_rule:'ending_90'};
const FEATURED=new Set(['CARTÕES DE VISITA','ADESIVOS','PANFLETOS, FLYERS E FOLHETOS','BLOCOS, COMANDAS, RECEITUÁRIOS E TALÕES','PASTAS','SACOLAS E SACOS','CANECA, COPOS E TAÇAS','BANNERS','PLACAS']);

function stagedToRaw(row){
  return [
    String(row.source_code||''),String(row.category_name||''),String(row.service_description||''),
    String(row.color_configuration||''),String(row.weight_value??''),String(row.quantity_value??''),
    String(row.size_label||''),String(row.production_days??''),`R$ ${Number(row.supplier_price||0).toFixed(2).replace('.',',')}`
  ];
}

function uniqueClean(values){return [...new Set(values.map(v=>String(v??'').trim()).filter(Boolean))];}
function numericRange(values){
  const nums=values.map(v=>Number(v)).filter(v=>Number.isFinite(v)&&v>0);
  if(!nums.length)return {min:null,max:null};
  return {min:Math.min(...nums),max:Math.max(...nums)};
}
function listText(values,max=8){
  const items=uniqueClean(values);
  if(!items.length)return null;
  const shown=items.slice(0,max);
  return shown.join(', ')+(items.length>max?` e mais ${items.length-max} opção(ões)`:``);
}
function buildProductCopy(group){
  const category=displayCase(group.category);
  const core=displayCase(normalizeDescription(group.category,group.description));
  const sizes=uniqueClean(group.rows.map(r=>r[6]).filter(v=>!/^0\s*[xX×]\s*0(?:\s*mm)?$/i.test(String(v||'').trim())));
  const prints=uniqueClean(group.rows.map(r=>String(r[3]||'').toUpperCase()));
  const qty=numericRange(group.rows.map(r=>r[5]));
  const days=numericRange(group.rows.map(r=>r[7]));
  const variants=group.rows.length;
  const facts=[];
  if(sizes.length) facts.push(`formatos cadastrados: ${listText(sizes,10)}`);
  if(prints.length) facts.push(`configurações de impressão: ${listText(prints,8)}`);
  if(qty.min!==null) facts.push(qty.min===qty.max?`quantidade cadastrada: ${qty.min} unidade(s)`:`quantidades de ${qty.min} a ${qty.max} unidade(s)`);
  if(days.min!==null) facts.push(days.min===days.max?`prazo informado: ${days.min} dia(s)`:`prazos informados de ${days.min} a ${days.max} dia(s)`);
  const short=`${core}. ${variants} opção(ões) cadastrada(s) para você escolher formato, impressão, quantidade e prazo disponíveis.`;
  const detail=facts.length?` A tabela importada informa ${facts.join('; ')}.`:'';
  const description=`${core} é um produto personalizável da categoria ${category}. Há ${variants} opção(ões) cadastrada(s).${detail} Selecione uma opção para consultar o preço público, a medida, a configuração de impressão e o prazo correspondentes. As especificações exibidas são derivadas diretamente da tabela de preços importada; características não presentes na fonte, como sangria, área segura, material ou acabamento específico, não são presumidas.`;
  return {
    short_description:short.slice(0,1400),
    description:description.slice(0,6000),
    metadata:{variant_count:variants,sizes,print_configurations:prints,quantity_min:qty.min,quantity_max:qty.max,production_days_min:days.min,production_days_max:days.max}
  };
}

export async function applySupplierPriceImport(conn,{importId,actorId,confirmApply=false}){
  if(!confirmApply) throw new Error('CATALOG_APPLY_CONFIRMATION_REQUIRED');
  const [imports]=await conn.execute(`SELECT i.*,s.slug AS supplier_slug,s.status AS supplier_status FROM supplier_price_imports i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.id=? LIMIT 1 FOR UPDATE`,[importId]);
  const imp=imports[0];
  if(!imp) throw new Error('PRICE_IMPORT_NOT_FOUND');
  if(imp.status==='rejected') throw new Error('PRICE_IMPORT_REJECTED');
  if(imp.status==='applied') return {ok:true,idempotent:true,import_id:importId,products:0,variants:0};
  if(!imp.supplier_id) throw new Error('PRICE_IMPORT_SUPPLIER_REQUIRED');
  const [staged]=await conn.execute(`SELECT * FROM supplier_price_rows WHERE import_id=? ORDER BY source_row_number`,[importId]);
  if(!staged.length) throw new Error('PRICE_IMPORT_EMPTY');
  const rawRows=staged.map(stagedToRaw);
  const groups=buildCatalogGroups(rawRows);
  const categories=[...new Set(staged.map(r=>String(r.category_name||'').trim()).filter(Boolean))];
  const categoryIds=new Map(); let sort=0;
  for(const rawCategory of categories){
    const slug=slugifyCatalog(rawCategory,190); const name=displayCase(rawCategory);
    await conn.execute(`INSERT INTO categories (name,slug,description,status,sort_order) VALUES (?,?,?,'active',?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),status='active'`,[name,slug,`Produtos gráficos da categoria ${name}. Consulte as opções publicadas de formato, impressão, quantidade e prazo.`,sort++]);
    const [[cat]]=await conn.execute('SELECT id FROM categories WHERE slug=? LIMIT 1',[slug]); categoryIds.set(rawCategory,Number(cat.id));
  }
  let products=0,variants=0,publicChanges=0,resellerChanges=0;
  for(const group of groups){
    const categoryId=categoryIds.get(group.category);
    const featured=FEATURED.has(group.category)?1:0;
    const copy=buildProductCopy(group);
    const cfg=JSON.stringify({catalog_source_managed:true,source:{import_id:importId,supplier_id:Number(imp.supplier_id),supplier_slug:imp.supplier_slug||null,source_checksum_sha256:imp.source_checksum_sha256},catalog:copy.metadata});
    await conn.execute(`INSERT INTO products (category_id,supplier_id,sku,name,slug,short_description,description,base_price,status,featured,sort_order,requires_artwork,supports_front,supports_back,config_json)
      VALUES (?,?,?,?,?,?,?,0,'active',?,0,1,1,?,?)
      ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),supplier_id=VALUES(supplier_id),name=VALUES(name),slug=VALUES(slug),short_description=VALUES(short_description),description=VALUES(description),status='active',featured=VALUES(featured),supports_front=1,supports_back=VALUES(supports_back),config_json=VALUES(config_json),updated_at=NOW()`,
      [categoryId,Number(imp.supplier_id),group.sku,group.name,group.slug,copy.short_description,copy.description,featured,Number(group.supports_back),cfg]);
    const [[product]]=await conn.execute('SELECT id FROM products WHERE sku=? LIMIT 1',[group.sku]); const productId=Number(product.id); products++;
    let minPrice=null;
    for(const row of group.rows){
      const [code,,description,colors,weight,qty,size,days]=row;
      const source=staged.find(r=>String(r.source_code)===String(code));
      const supplierCost=Number(source?.supplier_price||0);
      const pub=calculatePrice({supplier_cost:supplierCost,additional_cost:0},PUBLIC_RULE);
      const res=calculatePrice({supplier_cost:supplierCost,additional_cost:0},RESELLER_RULE);
      minPrice=minPrice===null?pub.price:Math.min(minPrice,pub.price);
      const [[before]]=await conn.execute('SELECT id,public_price,reseller_price FROM product_variants WHERE external_code=? LIMIT 1',[code]);
      await conn.execute(`INSERT INTO product_variants (product_id,sku,external_code,name,price,cost,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,attributes_json,production_json,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'available',?,?,'active')
        ON DUPLICATE KEY UPDATE product_id=VALUES(product_id),sku=VALUES(sku),name=VALUES(name),price=VALUES(price),cost=VALUES(cost),supplier_cost=VALUES(supplier_cost),additional_cost=0,public_price=VALUES(public_price),reseller_price=VALUES(reseller_price),quantity=VALUES(quantity),size_label=VALUES(size_label),print_configuration=VALUES(print_configuration),production_days=VALUES(production_days),availability='available',attributes_json=VALUES(attributes_json),production_json=VALUES(production_json),status='active'`,
        [productId,`CP-${code}`.slice(0,120),code,`${Number(qty||1)} un. · ${size||'formato'} · ${String(colors||'').toUpperCase()} · ${Number(days||0)} dia(s)`.slice(0,255),pub.price,supplierCost,supplierCost,0,pub.price,res.price,Math.max(1,Number(qty||1)),size||null,colors||null,Number(days)||null,JSON.stringify({source_description:description,source_weight:weight,source_category:group.category}),JSON.stringify({supplier_id:Number(imp.supplier_id),source_code:code,import_id:importId})]);
      const [[after]]=await conn.execute('SELECT id,public_price,reseller_price FROM product_variants WHERE external_code=? LIMIT 1',[code]);
      await conn.execute('UPDATE supplier_price_rows SET matched_variant_id=?,match_status=\'exact\',review_status=\'approved\' WHERE import_id=? AND source_code=?',[after.id,importId,code]);
      if(!before||Number(before.public_price)!==Number(after.public_price)){await conn.execute(`INSERT INTO price_history (variant_id,commercial_table,previous_price,new_price,real_cost,margin_percent,actor_type,actor_id) VALUES (?,'public',?,?,?,?, 'catalog_import',?)`,[after.id,before?Number(before.public_price):null,pub.price,supplierCost,pub.margin,actorId]);publicChanges++;}
      if(!before||Number(before.reseller_price)!==Number(after.reseller_price)){await conn.execute(`INSERT INTO price_history (variant_id,commercial_table,previous_price,new_price,real_cost,margin_percent,actor_type,actor_id) VALUES (?,'reseller',?,?,?,?, 'catalog_import',?)`,[after.id,before?Number(before.reseller_price):null,res.price,supplierCost,res.margin,actorId]);resellerChanges++;}
      variants++;
    }
    await conn.execute('UPDATE products SET base_price=? WHERE id=?',[Number(minPrice||0),productId]);
  }
  await conn.execute(`UPDATE supplier_price_imports SET status='applied',matched_count=?,conflict_count=0,reviewed_by_user_id=?,reviewed_at=COALESCE(reviewed_at,NOW()),applied_at=NOW() WHERE id=?`,[variants,actorId,importId]);
  return {ok:true,idempotent:false,import_id:importId,products,variants,categories:categories.length,public_price_changes:publicChanges,reseller_price_changes:resellerChanges};
}
