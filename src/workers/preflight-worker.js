import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../lib/db.js';
import { analyzeArtwork } from '../domain/preflight.js';
import { downloadObjectToFile, r2Status } from '../lib/storage.js';

const execFileAsync=promisify(execFile);
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
let stopping=false;process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
function json(value){if(!value)return{};if(typeof value==='object')return value;try{return JSON.parse(value)}catch{return{}}}

let toolState={checkedAt:0,ready:false,missing:[]};
async function commandWorks(command,args){try{await execFileAsync(command,args,{timeout:5000,maxBuffer:1024*1024});return true}catch(error){return Boolean(error?.stdout||error?.stderr)&&error?.code===0}}
async function preflightToolsReady(){
 const now=Date.now();if(now-toolState.checkedAt<60000)return toolState.ready;
 const checks=[['pdfinfo',['-v']],['pdfimages',['-v']],['gs',['--version']],['identify',['-version']]];
 const missing=[];for(const [command,args] of checks){if(!await commandWorks(command,args))missing.push(command)}
 toolState={checkedAt:now,ready:missing.length===0,missing};
 if(missing.length)console.error(JSON.stringify({event:'preflight.dependencies-missing',missing,message:'Instale poppler-utils, ghostscript e imagemagick. Nenhum job sera consumido ate a dependencia estar pronta.'}));
 return toolState.ready;
}

async function claimJob(){const db=getDb();const conn=await db.getConnection();try{await conn.beginTransaction();const [rows]=await conn.query(`SELECT id,artwork_id,attempts FROM preflight_jobs WHERE status='queued' AND available_at<=NOW() ORDER BY id LIMIT 1 FOR UPDATE`);if(!rows.length){await conn.rollback();return null}const job=rows[0];await conn.execute(`UPDATE preflight_jobs SET status='running',attempts=attempts+1,locked_at=NOW(),last_error=NULL WHERE id=?`,[job.id]);await conn.commit();return{...job,attempts:Number(job.attempts)+1}}catch(error){await conn.rollback();throw error}finally{conn.release()}}

async function loadContext(artworkId){const db=getDb();const [rows]=await db.execute(`SELECT a.id,a.side,a.order_item_id,a.original_media_id,m.object_key,m.original_name,m.mime_type,oi.product_id,p.supports_back,p.config_json,o.id AS order_id,o.order_number,pt.width_mm,pt.height_mm,pt.bleed_mm FROM artworks a JOIN media_objects m ON m.id=a.original_media_id JOIN order_items oi ON oi.id=a.order_item_id JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN product_templates pt ON pt.product_id=oi.product_id AND pt.status='active' AND pt.side IN (a.side,'general') WHERE a.id=? ORDER BY (pt.side=a.side) DESC,pt.id LIMIT 1`,[artworkId]);return rows[0]||null}

async function processJob(job){const ctx=await loadContext(job.artwork_id);if(!ctx)throw new Error('PREFLIGHT_ARTWORK_CONTEXT_MISSING');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'central-prints-preflight-'));const ext=path.extname(ctx.original_name||'')||'.bin';const local=path.join(dir,`original${ext}`);try{await downloadObjectToFile(ctx.object_key,local);const cfg=json(ctx.config_json);const minDpi=Math.max(72,Number(cfg?.preflight?.minDpi||cfg?.preflight?.min_dpi||200));const expected=ctx.width_mm&&ctx.height_mm?{widthMm:Number(ctx.width_mm),heightMm:Number(ctx.height_mm),bleedMm:Number(ctx.bleed_mm||0)}:null;const result=await analyzeArtwork(local,{mimeType:ctx.mime_type,side:ctx.side,supportsBack:Boolean(ctx.supports_back),expected,minDpi});const artworkStatus=result.state==='fail'?'changes-required':'preflight';const db=getDb();const conn=await db.getConnection();try{await conn.beginTransaction();await conn.execute(`UPDATE artworks SET status=?,preflight_json=?,updated_at=NOW() WHERE id=?`,[artworkStatus,JSON.stringify({...result,completedAt:new Date().toISOString()}),ctx.id]);await conn.execute(`UPDATE preflight_jobs SET status='completed',locked_at=NULL,last_error=NULL WHERE id=?`,[job.id]);await conn.execute(`INSERT INTO artwork_events (artwork_id,event_type,actor_type,payload_json) VALUES (?,'preflight.completed','system',?)`,[ctx.id,JSON.stringify({state:result.state,engine:result.engine,checks:result.checks})]);await conn.execute(`INSERT INTO order_events (order_id,event_type,actor_type,payload_json) VALUES (?,'preflight.completed','system',?)`,[ctx.order_id,JSON.stringify({artworkId:ctx.id,itemId:ctx.order_item_id,state:result.state})]);await conn.commit()}catch(error){await conn.rollback();throw error}finally{conn.release()}console.log(JSON.stringify({event:'preflight.completed',jobId:job.id,artworkId:ctx.id,state:result.state,order:ctx.order_number}))}finally{await fs.rm(dir,{recursive:true,force:true})}}

async function failJob(job,error){const db=getDb();const terminal=job.attempts>=3;await db.execute(`UPDATE preflight_jobs SET status=?,available_at=DATE_ADD(NOW(),INTERVAL 5 MINUTE),locked_at=NULL,last_error=? WHERE id=?`,[terminal?'failed':'queued',String(error?.stack||error).slice(0,10000),job.id]);if(terminal){await db.execute(`UPDATE artworks SET preflight_json=? WHERE id=?`,[JSON.stringify({status:'error',message:'Falha técnica na pré-impressão automática; revisão humana necessária.'}),job.artwork_id]);await db.execute(`INSERT INTO artwork_events (artwork_id,event_type,actor_type,payload_json) VALUES (?,'preflight.failed','system',?)`,[job.artwork_id,JSON.stringify({attempts:job.attempts,error:String(error?.message||error)})])}console.error(JSON.stringify({event:'preflight.error',jobId:job.id,artworkId:job.artwork_id,attempts:job.attempts,error:String(error?.message||error)}))}

console.log('[PREFLIGHT] Worker iniciado.');
while(!stopping){
 try{
  const storage=await r2Status();
  if(storage!=='ok'){console.log(JSON.stringify({event:'preflight.waiting-storage',status:storage}));await sleep(10000);continue}
  if(!await preflightToolsReady()){await sleep(10000);continue}
  const job=await claimJob();if(!job){await sleep(3000);continue}
  try{await processJob(job)}catch(error){await failJob(job,error)}
 }catch(error){console.error('[PREFLIGHT] Loop error',error);await sleep(5000)}
}
console.log('[PREFLIGHT] Worker encerrado.');
