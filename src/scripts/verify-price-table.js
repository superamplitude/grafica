import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { getDb } from '../lib/db.js';

const db = getDb();
const token = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const categorySlug = `ci-precos-${token}`;
const productSlug = `ci-produto-${token}`;
const productName = `Produto CI ${token}`;
const secretCost = 9876.54;
let categoryId;
let productId;
let app;

try {
  const [categoryResult] = await db.execute(
    `INSERT INTO categories (name,slug,status,sort_order) VALUES (?,?, 'active',0)`,
    [`Categoria CI ${token}`, categorySlug]
  );
  categoryId = Number(categoryResult.insertId);

  const [productResult] = await db.execute(
    `INSERT INTO products (category_id,name,slug,base_price,status,requires_artwork,supports_front,supports_back)
     VALUES (?,?,?,0,'active',1,1,0)`,
    [categoryId, productName, productSlug]
  );
  productId = Number(productResult.insertId);

  await db.execute(
    `INSERT INTO product_variants
      (product_id,sku,external_code,name,price,cost,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active')`,
    [productId,`SKU-${token}`,`EXT-${token}`,'100 unidades',42.50,secretCost,secretCost,0,42.50,39.90,100,'90x50mm','4x4',2,'available']
  );

  app = await buildApp();
  await app.ready();

  const jsonResponse = await app.inject({ method: 'GET', url: `/api/v1/price-table?q=${encodeURIComponent(token)}` });
  assert.equal(jsonResponse.statusCode, 200);
  const json = jsonResponse.json();
  assert.equal(json.total, 1);
  assert.equal(json.items.length, 1);
  assert.equal(json.items[0].product_slug, productSlug);
  assert.equal(json.items[0].public_price, 42.5);
  assert.equal(Object.hasOwn(json.items[0], 'supplier_cost'), false);
  assert.equal(Object.hasOwn(json.items[0], 'cost'), false);
  assert.equal(Object.hasOwn(json.items[0], 'reseller_price'), false);

  const csvResponse = await app.inject({ method: 'GET', url: `/api/v1/price-table.csv?q=${encodeURIComponent(token)}` });
  assert.equal(csvResponse.statusCode, 200);
  assert.match(String(csvResponse.headers['content-type'] || ''), /text\/csv/i);
  assert.match(csvResponse.body, new RegExp(productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(csvResponse.body, /42,50/);
  assert.doesNotMatch(csvResponse.body, /9876[.,]54/);
  assert.doesNotMatch(csvResponse.body, /supplier_cost/i);
  console.log('PRICE_TABLE_INTEGRATION_OK');
} finally {
  if (app) await app.close();
  if (productId) await db.execute('DELETE FROM products WHERE id=?', [productId]).catch(() => {});
  if (categoryId) await db.execute('DELETE FROM categories WHERE id=?', [categoryId]).catch(() => {});
  await db.end().catch(() => {});
}
