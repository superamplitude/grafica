import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyExternalReference, canPromoteExternalReference } from '../src/domain/external-reference-policy.js';

test('classifies supplier-branded PSD as quarantined template reference',()=>{
  const r=classifyExternalReference({title:'MOCKUP-ZAP NOVALOGO-MOCKUP CARTAO DE VISITA 1-DESIGNS.psd',source_type:'file',mime_type:'image/x-photoshop'});
  assert.equal(r.usage_hint,'template');
  assert.equal(r.photo_type_hint,'render');
  assert.equal(r.supplier_branding_risk,'found');
  assert.equal(r.license_status,'reference_only');
  assert.equal(r.ingestion_status,'quarantined');
  assert.equal(r.review_required,1);
});

test('plain product PNG is never assumed to be a real approved photo',()=>{
  const r=classifyExternalReference({title:'44 - Roll Up.PNG',source_type:'file',mime_type:'image/png'});
  assert.equal(r.usage_hint,'product');
  assert.equal(r.photo_type_hint,'unknown');
  assert.equal(r.ingestion_status,'quarantined');
});

test('promotion blocks reference-only or branded material',()=>{
  assert.deepEqual(canPromoteExternalReference({ingestion_status:'reviewed',review_required:0,license_status:'reference_only',supplier_branding_risk:'clear',usage_hint:'product',photo_type_hint:'real',price_text_risk:'clear'}),{ok:false,error:'REFERENCE_LICENSE_NOT_APPROVED'});
  assert.deepEqual(canPromoteExternalReference({ingestion_status:'reviewed',review_required:0,license_status:'licensed',supplier_branding_risk:'found',usage_hint:'template',photo_type_hint:'render',price_text_risk:'clear'}),{ok:false,error:'REFERENCE_SUPPLIER_BRANDING_NOT_CLEAR'});
});

test('product promotion requires real photo after review and licensing',()=>{
  assert.deepEqual(canPromoteExternalReference({ingestion_status:'reviewed',review_required:0,license_status:'licensed',supplier_branding_risk:'clear',usage_hint:'product',photo_type_hint:'render',price_text_risk:'clear'}),{ok:false,error:'REFERENCE_PRODUCT_IMAGE_MUST_BE_REAL'});
  assert.deepEqual(canPromoteExternalReference({ingestion_status:'reviewed',review_required:0,license_status:'licensed',supplier_branding_risk:'clear',usage_hint:'product',photo_type_hint:'real',price_text_risk:'clear'}),{ok:true});
});
