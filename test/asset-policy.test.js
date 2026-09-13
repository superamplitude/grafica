import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalError } from '../src/routes/admin-assets.js';

const base = {
  usage_type:'other',
  photo_type:'not_applicable',
  supplier_branding:'clear',
  price_text:'clear',
  license_status:'owned',
  review_status:'approved'
};

test('approved product asset must be a real photo', () => {
  assert.equal(approvalError({...base,usage_type:'product',photo_type:'render'}),'PRODUCT_IMAGE_MUST_BE_REAL');
  assert.equal(approvalError({...base,usage_type:'product',photo_type:'real'}),null);
});

test('approved public assets reject supplier branding', () => {
  assert.equal(approvalError({...base,usage_type:'product',photo_type:'real',supplier_branding:'found'}),'SUPPLIER_BRANDING_NOT_CLEAR');
  assert.equal(approvalError({...base,usage_type:'template',supplier_branding:'unknown'}),'SUPPLIER_BRANDING_NOT_CLEAR');
});

test('hero asset must be free of price text', () => {
  assert.equal(approvalError({...base,usage_type:'hero',price_text:'found'}),'HERO_IMAGE_PRICE_TEXT_NOT_CLEAR');
  assert.equal(approvalError({...base,usage_type:'hero',price_text:'clear'}),null);
});

test('asset cannot be approved without owned or licensed usage rights', () => {
  assert.equal(approvalError({...base,license_status:'reference_only'}),'ASSET_LICENSE_NOT_APPROVED');
  assert.equal(approvalError({...base,license_status:'unknown'}),'ASSET_LICENSE_NOT_APPROVED');
});

test('pending review may remain incomplete without being falsely approved', () => {
  assert.equal(approvalError({...base,review_status:'pending',license_status:'unknown',supplier_branding:'unknown'}),null);
});
