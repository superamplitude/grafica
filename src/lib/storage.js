import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  HeadObjectCommand, HeadBucketCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export const R2_PREFIXES=Object.freeze({
  PRODUCT_PHOTOS:'products/photos',
  THUMBNAILS:'products/thumbnails',
  MOCKUPS:'products/mockups',
  TEMPLATES:'templates',
  ARTWORK_ORIGINALS:'artworks/originals',
  ARTWORK_PREVIEWS:'artworks/previews',
  ARTWORK_APPROVED:'artworks/approved',
  PROOFS:'proofs/digital',
  PRODUCTION:'production/ready'
});

const PUBLIC_PREFIXES = Object.freeze([
  `${R2_PREFIXES.PRODUCT_PHOTOS}/`,
  `${R2_PREFIXES.THUMBNAILS}/`,
  `${R2_PREFIXES.MOCKUPS}/`,
  `${R2_PREFIXES.TEMPLATES}/`
]);

let client;
function credentialsConfigured(){return Boolean(process.env.R2_ACCOUNT_ID&&process.env.R2_ACCESS_KEY_ID&&process.env.R2_SECRET_ACCESS_KEY)}
export function r2Buckets(){
  const legacy=String(process.env.R2_BUCKET||'').trim();
  return {
    publicBucket:String(process.env.R2_PUBLIC_BUCKET||legacy).trim(),
    privateBucket:String(process.env.R2_PRIVATE_BUCKET||legacy).trim()
  };
}
export function isR2Configured(){const b=r2Buckets();return Boolean(credentialsConfigured()&&b.publicBucket&&b.privateBucket)}
function getClient(){if(!isR2Configured())throw new Error('R2_NOT_CONFIGURED');if(!client)client=new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});return client}
export function isPublicObjectKey(key){const normalized=String(key||'').replace(/^\/+/, '');return PUBLIC_PREFIXES.some((prefix)=>normalized.startsWith(prefix))}
export function bucketForKey(key){const buckets=r2Buckets();return isPublicObjectKey(key)?buckets.publicBucket:buckets.privateBucket}
export async function r2Status(){
  if(!isR2Configured())return'unconfigured';
  const {publicBucket,privateBucket}=r2Buckets();
  if(publicBucket===privateBucket&&String(process.env.R2_PUBLIC_BASE_URL||'').trim())return'unsafe-layout';
  try{
    await Promise.all([
      getClient().send(new HeadBucketCommand({Bucket:publicBucket})),
      publicBucket===privateBucket?Promise.resolve():getClient().send(new HeadBucketCommand({Bucket:privateBucket}))
    ]);
    return'ok';
  }catch{return'error'}
}
export async function putObject({key,body,contentType,cacheControl,metadata}){const bucket=bucketForKey(key);await getClient().send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:contentType,CacheControl:cacheControl,Metadata:metadata}));return{bucket,key}}
export async function deleteObject(key){const bucket=bucketForKey(key);await getClient().send(new DeleteObjectCommand({Bucket:bucket,Key:key}));return{bucket,key}}
export async function signedReadUrl(key,expiresIn=900){const bucket=bucketForKey(key);return getSignedUrl(getClient(),new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:Math.min(3600,Math.max(60,Number(expiresIn)||900))})}
export async function signedUploadUrl({key,contentType,expiresIn=900,metadata}){const bucket=bucketForKey(key);return getSignedUrl(getClient(),new PutObjectCommand({Bucket:bucket,Key:key,ContentType:contentType,Metadata:metadata}),{expiresIn:Math.min(1800,Math.max(60,Number(expiresIn)||900))})}
export async function headObject(key){const bucket=bucketForKey(key);const r=await getClient().send(new HeadObjectCommand({Bucket:bucket,Key:key}));return{bucket,size:Number(r.ContentLength||0),contentType:r.ContentType||null,etag:r.ETag?.replaceAll('"','')||null,metadata:r.Metadata||{},lastModified:r.LastModified||null}}
export async function downloadObjectToFile(key,destination){const bucket=bucketForKey(key);const r=await getClient().send(new GetObjectCommand({Bucket:bucket,Key:key}));if(!r.Body)throw new Error('R2_EMPTY_BODY');await pipeline(r.Body,createWriteStream(destination,{mode:0o600}));return{bucket,contentType:r.ContentType||null,size:Number(r.ContentLength||0),etag:r.ETag?.replaceAll('"','')||null}}
export function publicObjectUrl(key){if(!isPublicObjectKey(key))return null;const base=String(process.env.R2_PUBLIC_BASE_URL||'').replace(/\/$/,'');if(!base)return null;return`${base}/${String(key).replace(/^\//,'')}`}
