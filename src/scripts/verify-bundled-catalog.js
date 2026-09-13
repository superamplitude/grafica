import 'dotenv/config';
import { getDb } from '../lib/db.js';

const db=getDb();
try{
  const [[supplier]]=await db.query("SELECT id FROM suppliers WHERE slug='atual-card' LIMIT 1");
  if(!supplier) throw new Error('ATUAL_CARD_SUPPLIER_NOT_FOUND');
  const supplierId=Number(supplier.id);
  const [[counts]]=await db.execute(`SELECT
    COUNT(*) AS products,
    SUM(status='active') AS active_products,
    SUM(base_price>0) AS priced_products,
    SUM(name LIKE '%Atual Card%') AS branded_names
    FROM products WHERE supplier_id=? AND sku LIKE 'AC-P-%'`,[supplierId]);
  const [[variants]]=await db.execute(`SELECT
    COUNT(*) AS variants,
    COUNT(DISTINCT v.external_code) AS unique_codes,
    SUM(v.status='active') AS active_variants,
    SUM(v.public_price>v.supplier_cost) AS public_above_cost,
    SUM(v.reseller_price>=v.supplier_cost) AS reseller_not_below_cost,
    SUM(v.public_price<=0) AS zero_public,
    SUM(v.supplier_cost<=0) AS zero_cost
    FROM product_variants v JOIN products p ON p.id=v.product_id
    WHERE p.supplier_id=? AND p.sku LIKE 'AC-P-%'`,[supplierId]);
  const [[categories]]=await db.execute(`SELECT COUNT(DISTINCT category_id) AS n FROM products WHERE supplier_id=? AND sku LIKE 'AC-P-%'`,[supplierId]);
  const [[history]]=await db.execute(`SELECT COUNT(*) AS n FROM price_history h JOIN product_variants v ON v.id=h.variant_id JOIN products p ON p.id=v.product_id WHERE p.supplier_id=? AND p.sku LIKE 'AC-P-%'`,[supplierId]);
  const expected={products:1075,variants:21329,categories:140};
  const actual={
    products:Number(counts.products||0),active_products:Number(counts.active_products||0),priced_products:Number(counts.priced_products||0),branded_names:Number(counts.branded_names||0),
    variants:Number(variants.variants||0),unique_codes:Number(variants.unique_codes||0),active_variants:Number(variants.active_variants||0),public_above_cost:Number(variants.public_above_cost||0),reseller_not_below_cost:Number(variants.reseller_not_below_cost||0),zero_public:Number(variants.zero_public||0),zero_cost:Number(variants.zero_cost||0),
    categories:Number(categories.n||0),price_history:Number(history.n||0)
  };
  if(actual.products!==expected.products) throw new Error(`CATALOG_PRODUCT_COUNT:${actual.products}`);
  if(actual.active_products!==expected.products) throw new Error(`CATALOG_ACTIVE_PRODUCT_COUNT:${actual.active_products}`);
  if(actual.priced_products!==expected.products) throw new Error(`CATALOG_PRICED_PRODUCT_COUNT:${actual.priced_products}`);
  if(actual.branded_names!==0) throw new Error(`CATALOG_SUPPLIER_BRANDING_EXPOSED:${actual.branded_names}`);
  if(actual.variants!==expected.variants||actual.unique_codes!==expected.variants||actual.active_variants!==expected.variants) throw new Error(`CATALOG_VARIANT_COUNT:${actual.variants}/${actual.unique_codes}/${actual.active_variants}`);
  if(actual.public_above_cost!==expected.variants) throw new Error(`CATALOG_PUBLIC_MARGIN_INVALID:${actual.public_above_cost}`);
  if(actual.reseller_not_below_cost!==expected.variants) throw new Error(`CATALOG_RESELLER_MARGIN_INVALID:${actual.reseller_not_below_cost}`);
  if(actual.zero_public!==0||actual.zero_cost!==0) throw new Error(`CATALOG_ZERO_PRICE:${actual.zero_public}/${actual.zero_cost}`);
  if(actual.categories!==expected.categories) throw new Error(`CATALOG_CATEGORY_COUNT:${actual.categories}`);
  if(actual.price_history<expected.variants*2) throw new Error(`CATALOG_PRICE_HISTORY_TOO_SMALL:${actual.price_history}`);
  console.log(JSON.stringify({ok:true,expected,actual},null,2));
} finally { await db.end(); }
