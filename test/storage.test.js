import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketForKey, isPublicObjectKey, publicObjectUrl, r2Buckets } from '../src/lib/storage.js';

const previous = {
  R2_BUCKET: process.env.R2_BUCKET,
  R2_PUBLIC_BUCKET: process.env.R2_PUBLIC_BUCKET,
  R2_PRIVATE_BUCKET: process.env.R2_PRIVATE_BUCKET,
  R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL
};

process.env.R2_PUBLIC_BUCKET = 'central-prints-public';
process.env.R2_PRIVATE_BUCKET = 'central-prints-private';
process.env.R2_PUBLIC_BASE_URL = 'https://cdn.example.test';
delete process.env.R2_BUCKET;

test('R2 routes catalog and site media to public bucket', () => {
  assert.equal(isPublicObjectKey('products/photos/2026/09/a.webp'), true);
  assert.equal(bucketForKey('products/photos/2026/09/a.webp'), 'central-prints-public');
  assert.equal(bucketForKey('templates/gabarito.pdf'), 'central-prints-public');
  assert.equal(isPublicObjectKey('site/banners/2026/09/hero.webp'), true);
  assert.equal(bucketForKey('site/banners/2026/09/hero.webp'), 'central-prints-public');
  assert.equal(publicObjectUrl('site/banners/hero.webp'), 'https://cdn.example.test/site/banners/hero.webp');
});

test('R2 routes customer and production files to private bucket', () => {
  assert.equal(isPublicObjectKey('artworks/originals/order/file.pdf'), false);
  assert.equal(bucketForKey('artworks/originals/order/file.pdf'), 'central-prints-private');
  assert.equal(bucketForKey('proofs/digital/order/proof.pdf'), 'central-prints-private');
  assert.equal(bucketForKey('production/ready/order/final.pdf'), 'central-prints-private');
});

test('public URL helper refuses private object keys', () => {
  assert.equal(publicObjectUrl('artworks/originals/order/file.pdf'), null);
  assert.equal(publicObjectUrl('products/photos/a.webp'), 'https://cdn.example.test/products/photos/a.webp');
});

test('R2 bucket config is explicitly split', () => {
  assert.deepEqual(r2Buckets(), { publicBucket: 'central-prints-public', privateBucket: 'central-prints-private' });
});

test.after(() => {
  for (const [key,value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
