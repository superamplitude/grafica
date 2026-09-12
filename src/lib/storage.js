import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let client;

function getClient() {
  if (!client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    if (!accountId) throw new Error('R2_ACCOUNT_ID não configurado');
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
  return client;
}

export async function putObject({ key, body, contentType, cacheControl, metadata }) {
  const bucket = process.env.R2_BUCKET;
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
    Metadata: metadata
  }));
  return { bucket, key };
}

export async function deleteObject(key) {
  await getClient().send(new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key
  }));
}

export async function signedReadUrl(key, expiresIn = 900) {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
    { expiresIn }
  );
}

export function publicObjectUrl(key) {
  const base = String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/${String(key).replace(/^\//, '')}`;
}

export const R2_PREFIXES = Object.freeze({
  PRODUCT_PHOTOS: 'products/photos',
  THUMBNAILS: 'products/thumbnails',
  MOCKUPS: 'products/mockups',
  TEMPLATES: 'templates',
  ARTWORK_ORIGINALS: 'artworks/originals',
  ARTWORK_PREVIEWS: 'artworks/previews',
  ARTWORK_APPROVED: 'artworks/approved',
  PROOFS: 'proofs/digital',
  PRODUCTION: 'production/ready'
});
