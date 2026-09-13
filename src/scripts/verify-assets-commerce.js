import 'dotenv/config';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { getDb } from '../lib/db.js';
import { buildApp } from '../app.js';

process.env.R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL || 'https://cdn.example.test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-only-central-prints-secret-0123456789abcdef';

const db = getDb();
const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const label = `CI-${id}`;

const [categoryRows] = await db.query(`SELECT id FROM categories WHERE status='active' ORDER BY id LIMIT 1`);
assert.ok(categoryRows[0]?.id, 'categoria seed ausente');
const [supplierRows] = await db.query(`SELECT id FROM suppliers ORDER BY id LIMIT 1`);
assert.ok(supplierRows[0]?.id, 'fornecedor seed ausente');

const [productResult] = await db.execute(`
  INSERT INTO products (category_id,supplier_id,sku,name,slug,short_description,description,base_price,status,featured,sort_order,requires_artwork,supports_front,supports_back)
  VALUES (?,?,?,?,?,?,?,?, 'active',0,0,1,1,0)
`, [categoryRows[0].id,supplierRows[0].id,`CI-${id}`,`Produto ${label}`,`produto-${id}`,`Produto de integração ${label}`,`Descrição comercial de integração suficientemente longa para validar o catálogo público sem depender de conteúdo externo ${label}.`,49.90]);
const productId = Number(productResult.insertId);

await db.execute(`INSERT INTO product_variants (product_id,sku,external_code,name,price,cost,supplier_cost,additional_cost,public_price,reseller_price,quantity,size_label,print_configuration,production_days,availability,status) VALUES (?,?,?,?,?,0,0,0,?,0,1000,'9x5 cm','4x4',3,'available','active')`, [productId,`CIV-${id}`,`EXT-${id}`,`1000 un. ${label}`,49.90,49.90]);

async function insertMedia(kind, objectKey, originalName, mimeType) {
  const [result] = await db.execute(`INSERT INTO media_objects (kind,visibility,storage_provider,bucket_name,object_key,original_name,mime_type,size_bytes,metadata_json) VALUES (?,'public','cloudflare-r2','grafica',?,?,?,100,JSON_OBJECT('ci',true))`,[kind,objectKey,originalName,mimeType]);
  return Number(result.insertId);
}

const photoKey = `products/photos/ci/${id}.jpg`;
const photoId = await insertMedia('product-photo',photoKey,`${id}.jpg`,'image/jpeg');
const app = await buildApp();
await app.ready();
const adminToken = app.jwt.sign({sub:'999999',jti:crypto.randomUUID(),role:'super_admin',email:'ci@centralprints.invalid',name:'CI'});
let response = await app.inject({method:'POST',url:`/api/v1/admin/catalog/products/${productId}/media`,headers:{authorization:`Bearer ${adminToken}`},payload:{media_id:photoId,role:'cover',sort_order:0}});
assert.equal(response.statusCode,201,'fluxo administrativo deve vincular foto ao produto');
assert.equal(response.json().reviewRequired,true,'foto nova deve exigir auditoria');

const listUrl = `/api/v1/products?q=${encodeURIComponent(label)}&limit=10`;
response = await app.inject({method:'GET',url:listUrl});
assert.equal(response.statusCode,200);
let payload = response.json();
assert.equal(payload.items.length,1);
assert.equal(payload.items[0].cover_url,null,'foto sem revisão não pode aparecer');
assert.equal(Object.hasOwn(payload.items[0],'supplier_id'),false,'fornecedor não deve vazar no catálogo');
assert.equal(Object.hasOwn(payload.items[0],'supplier_name'),false,'nome do fornecedor não deve vazar no catálogo');

await db.execute(`INSERT INTO media_asset_reviews (media_id,usage_type,photo_type,supplier_branding,price_text,license_status,review_status,reviewed_at) VALUES (?,'product','real','clear','clear','licensed','approved',NOW())`,[photoId]);
response = await app.inject({method:'GET',url:listUrl});
payload = response.json();
assert.equal(payload.items[0].cover_url,`${process.env.R2_PUBLIC_BASE_URL}/${photoKey}`,'foto real revisada deve aparecer');

const bannerKey = `site/banners/ci/${id}.jpg`;
const bannerMediaId = await insertMedia('banner',bannerKey,`hero-${id}.jpg`,'image/jpeg');
await db.execute(`INSERT INTO media_asset_reviews (media_id,usage_type,photo_type,supplier_branding,price_text,license_status,review_status,reviewed_at) VALUES (?,'hero','real','clear','clear','owned','approved',NOW())`,[bannerMediaId]);
const [bannerResult] = await db.execute(`INSERT INTO banners (name,placement,desktop_media_id,eyebrow,title,body,cta_label,cta_url,sort_order,status) VALUES (?,'home-hero',?,'Impressão profissional',?,'Imagem limpa e adequada à campanha institucional.','Ver catálogo','/catalogo.html',-999,'active')`,[`Hero ${label}`,bannerMediaId,`Sua gráfica ${label}`]);
const bannerId = Number(bannerResult.insertId);
response = await app.inject({method:'GET',url:'/api/v1/site/hero'});
payload = response.json();
assert.ok(payload.items.some(item=>item.id===bannerId),'hero aprovado deve aparecer');
await db.execute(`UPDATE banners SET title='A partir de R$ 9,90' WHERE id=?`,[bannerId]);
response = await app.inject({method:'GET',url:'/api/v1/site/hero'});
payload = response.json();
assert.equal(payload.items.some(item=>item.id===bannerId),false,'hero com preço deve ser bloqueado mesmo se dado for alterado fora do admin');

const templateKey = `templates/ci/${id}.pdf`;
const templateMediaId = await insertMedia('template',templateKey,`gabarito-${id}.pdf`,'application/pdf');
await db.execute(`INSERT INTO product_templates (product_id,media_id,template_type,version_label,side,width_mm,height_mm,bleed_mm,brand_neutral,verified_at,status) VALUES (?,?,'pdf','PDF produção','general',90,50,2,1,NOW(),'active')`,[productId,templateMediaId]);
await db.execute(`INSERT INTO product_templates (product_id,media_id,template_type,version_label,side,width_mm,height_mm,bleed_mm,brand_neutral,verified_at,status) VALUES (?,?,'pdf','PDF não verificado','general',90,50,2,0,NULL,'active')`,[productId,templateMediaId]);
response = await app.inject({method:'GET',url:`/api/v1/configurator/produto-${id}`});
assert.equal(response.statusCode,200);
payload = response.json();
assert.equal(payload.templates.length,1,'somente gabarito neutro e verificado pode aparecer');
assert.equal(payload.templates[0].url,`${process.env.R2_PUBLIC_BASE_URL}/${templateKey}`);

response = await app.inject({method:'GET',url:'/api/v1/commerce/options'});
payload = response.json();
assert.equal(payload.shipping.some(item=>item.provider_code==='local_pickup'),false,'integração inativa não pode aparecer');
assert.equal(payload.payment.some(item=>item.provider_code==='mercado_pago'),false,'gateway planejado não pode aparecer');
await db.execute(`UPDATE commerce_integrations SET adapter_status='verified',status='active',verified_at=NOW() WHERE integration_type='shipping' AND provider_code='local_pickup'`);
await db.execute(`UPDATE commerce_integrations SET status='active' WHERE integration_type='payment' AND provider_code='mercado_pago'`);
response = await app.inject({method:'GET',url:'/api/v1/commerce/options'});
payload = response.json();
assert.ok(payload.shipping.some(item=>item.provider_code==='local_pickup'),'integração verificada e ativa deve aparecer');
assert.equal(payload.payment.some(item=>item.provider_code==='mercado_pago'),false,'adapter planejado permanece bloqueado mesmo se status for alterado diretamente');
assert.equal(JSON.stringify(payload).includes('MERCADO_PAGO_ACCESS_TOKEN'),false,'nomes de secrets não podem vazar na API pública');
assert.equal(JSON.stringify(payload).includes('secret_env'),false,'metadados internos de secrets não podem vazar na API pública');

await app.close();
await db.end();
console.log(JSON.stringify({ok:true,productId,bannerId,verified:['admin-product-photo-attach','real-product-photo','price-free-hero','neutral-template','commerce-public-filter','supplier-hidden']}));
