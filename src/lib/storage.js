import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  HeadObjectCommand, HeadBucketCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

let client;
export function isR2Configured(){return Boolean(process.env.R2_ACCOUNT_ID&&process.env.R2_ACCESS_KEY_ID&&process.env.R2_SECRET_ACCESS_KEY&&process.env.R2_BUCKET)}
function getClient(){if(!isR2Configured())throw new Error('R2_NOT_CONFIGURED');if(!client)client=new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});return client}
export async function r2Status(){if(!isR2Configured())return'unconfigured';try{await getClient().send(new HeadBucketCommand({Bucket:process.env.R2_BUCKET}));return'ok'}catch{return'error'}}
export async function putObject({key,body,contentType,cacheControl,metadata}){const bucket=process.env.R2_BUCKET;await getClient().send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:contentType,CacheControl:cacheControl,Metadata:metadata}));return{bucket,key}}
export async function deleteObject(key){await getClient().send(new DeleteObjectCommand({Bucket:process.env.R2_BUCKET,Key:key}))}
export async function signedReadUrl(key,expiresIn=900){return getSignedUrl(getClient(),new GetObjectCommand({Bucket:process.env.R2_BUCKET,Key:key}),{expiresIn:Math.min(3600,Math.max(60,Number(expiresIn)||900))})}
export async function signedUploadUrl({key,contentType,expiresIn=900,metadata}){return getSignedUrl(getClient(),new PutObjectCommand({Bucket:process.env.R2_BUCKET,Key:key,ContentType:contentType,Metadata:metadata}),{expiresIn:Math.min(1800,Math.max(60,Number(expiresIn)||900))})}
export async function headObject(key){const r=await getClient().send(new HeadObjectCommand({Bucket:process.env.R2_BUCKET,Key:key}));return{size:Number(r.ContentLength||0),contentType:r.ContentType||null,etag:r.ETag?.replaceAll('"','')||null,metadata:r.Metadata||{},lastModified:r.LastModified||null}}
export async function downloadObjectToFile(key,destination){const r=await getClient().send(new GetObjectCommand({Bucket:process.env.R2_BUCKET,Key:key}));if(!r.Body)throw new Error('R2_EMPTY_BODY');await pipeline(r.Body,createWriteStream(destination,{mode:0o600}));return{contentType:r.ContentType||null,size:Number(r.ContentLength||0),etag:r.ETag?.replaceAll('"','')||null}}
export function publicObjectUrl(key){const base=String(process.env.R2_PUBLIC_BASE_URL||'').replace(/\/$/,'');if(!base)return null;return`${base}/${String(key).replace(/^\//,'')}`}
export const R2_PREFIXES=Object.freeze({PRODUCT_PHOTOS:'products/photos',THUMBNAILS:'products/thumbnails',MOCKUPS:'products/mockups',TEMPLATES:'templates',ARTWORK_ORIGINALS:'artworks/originals',ARTWORK_PREVIEWS:'artworks/previews',ARTWORK_APPROVED:'artworks/approved',PROOFS:'proofs/digital',PRODUCTION:'production/ready'});