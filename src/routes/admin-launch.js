import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { launchSnapshot, parseJson, readAttestations, writeLaunchAudit } from '../domain/launch-data.js';
import { executePilot, executeRepair, rollbackLaunchRun, simulatePilot, simulateRepair } from '../domain/launch-operations.js';

const attestationKeys = ['payment','shipping','email','mobile'];
const attestationSchema = z.object({ status:z.enum(['pending','verified','blocked']), note:z.string().max(5000).nullable().optional() });
const repairDecisionSchema = z.object({ confirm:z.literal('EXECUTAR SANEAMENTO') });
const pilotSimSchema = z.object({ limit:z.union([z.literal(5),z.literal(10)]).default(5) });
const pilotDecisionSchema = z.object({ confirm:z.literal('PUBLICAR PILOTO') });
const rollbackSchema = z.object({ confirm:z.literal('CONFIRMAR ROLLBACK') });

function sendOperation(reply, result, successCode=200) {
  if (result?.notFound) return reply.code(404).send(result.notFound);
  if (result?.conflict) return reply.code(409).send(result.conflict);
  return reply.code(successCode).send(result);
}

export async function registerAdminLaunchRoutes(app) {
  const staff=app.requireRole('super_admin','admin','operations','prepress','support');
  const admins=app.requireRole('super_admin','admin');
  const superAdmin=app.requireRole('super_admin');

  app.get('/api/v1/admin/launch/readiness',{preHandler:staff},async()=>{
    const state=await launchSnapshot(getDb());
    return { storage:state.storage,metrics:state.metrics,attestations:state.attestations,checklist:state.checklist };
  });

  app.get('/api/v1/admin/launch/products',{preHandler:staff},async(request)=>{
    const state=await launchSnapshot(getDb());
    const only=String(request.query?.only||'all');
    let items=state.evaluated.map(({row,readiness,repairs})=>({id:row.id,name:row.name,slug:row.slug,status:row.status,complete:readiness.complete,missing:readiness.missing,repairs,starting_price:Number(row.starting_price||0),updated_at:row.updated_at}));
    if(only==='pending')items=items.filter((item)=>!item.complete);
    if(only==='pilot')items=items.filter((item)=>item.complete&&['draft','paused'].includes(item.status));
    if(only==='repairable')items=items.filter((item)=>item.repairs.length>0);
    return {items:items.slice(0,500),total:items.length};
  });

  app.get('/api/v1/admin/launch/runs',{preHandler:staff},async()=>{
    const [rows]=await getDb().query(`SELECT id,run_uuid,run_type,status,actor_user_id,summary_json,created_at,executed_at,rolled_back_at FROM launch_runs ORDER BY id DESC LIMIT 100`);
    return {items:rows.map((row)=>({...row,summary_json:parseJson(row.summary_json)}))};
  });

  app.get('/api/v1/admin/launch/attestations',{preHandler:staff},async()=>({items:Object.values(await readAttestations(getDb()))}));

  app.put('/api/v1/admin/launch/attestations/:key',{preHandler:admins},async(request,reply)=>{
    const key=String(request.params.key||'');
    if(!attestationKeys.includes(key))return reply.code(404).send({error:'UNKNOWN_ATTESTATION'});
    const parsed=attestationSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:'INVALID_ATTESTATION'});
    const db=getDb();
    const [beforeRows]=await db.execute('SELECT * FROM launch_attestations WHERE attestation_key=? LIMIT 1',[key]);
    await db.execute(`INSERT INTO launch_attestations (attestation_key,status,note,updated_by_user_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),note=VALUES(note),updated_by_user_id=VALUES(updated_by_user_id),updated_at=NOW()`,[key,parsed.data.status,parsed.data.note??null,Number(request.user.sub)]);
    const [afterRows]=await db.execute('SELECT * FROM launch_attestations WHERE attestation_key=? LIMIT 1',[key]);
    await writeLaunchAudit(db,request,'launch.attestation.update','launch_attestation',afterRows[0].id,beforeRows[0]||null,afterRows[0]);
    return {ok:true,item:afterRows[0]};
  });

  app.post('/api/v1/admin/launch/repair/simulate',{preHandler:admins},async(request,reply)=>sendOperation(reply,await simulateRepair(getDb(),request),201));
  app.post('/api/v1/admin/launch/repair/:id/execute',{preHandler:admins},async(request,reply)=>{
    if(!repairDecisionSchema.safeParse(request.body).success)return reply.code(400).send({error:'CONFIRMATION_REQUIRED'});
    return sendOperation(reply,await executeRepair(getDb(),request,request.params.id));
  });
  app.post('/api/v1/admin/launch/pilot/simulate',{preHandler:admins},async(request,reply)=>{
    const parsed=pilotSimSchema.safeParse(request.body||{});
    if(!parsed.success)return reply.code(400).send({error:'INVALID_PILOT_LIMIT'});
    return sendOperation(reply,await simulatePilot(getDb(),request,parsed.data.limit),201);
  });
  app.post('/api/v1/admin/launch/pilot/:id/execute',{preHandler:superAdmin},async(request,reply)=>{
    if(!pilotDecisionSchema.safeParse(request.body).success)return reply.code(400).send({error:'CONFIRMATION_REQUIRED'});
    return sendOperation(reply,await executePilot(getDb(),request,request.params.id));
  });
  app.post('/api/v1/admin/launch/runs/:id/rollback',{preHandler:superAdmin},async(request,reply)=>{
    if(!rollbackSchema.safeParse(request.body).success)return reply.code(400).send({error:'CONFIRMATION_REQUIRED'});
    return sendOperation(reply,await rollbackLaunchRun(getDb(),request,request.params.id));
  });

  app.get('/api/v1/admin/launch/report.txt',{preHandler:staff},async(_request,reply)=>{
    const state=await launchSnapshot(getDb());
    const lines=['CENTRAL PRINTS - RELATORIO DE FINALIZACAO',`Gerado em: ${new Date().toISOString()}`,`Score: ${state.checklist.score}%`,`Pronto para estavel: ${state.checklist.ready_for_stable?'SIM':'NAO'}`,'','METRICAS',...Object.entries(state.metrics).map(([key,value])=>`${key}: ${value}`),'','CHECKLIST',...state.checklist.items.map((item)=>`[${item.status.toUpperCase()}] ${item.label} - ${item.detail}`),'','PENDENCIAS DE PRODUTO',...state.evaluated.filter((item)=>!item.readiness.complete).slice(0,500).map((item)=>`#${item.row.id} ${item.row.name}: ${item.readiness.missing.map((x)=>x.label).join('; ')}`)];
    return reply.type('text/plain; charset=utf-8').send(lines.join('\n'));
  });

  app.get('/api/v1/admin/launch/pending.csv',{preHandler:staff},async(_request,reply)=>{
    const state=await launchSnapshot(getDb());
    const csv=['product_id;name;status;missing'];
    for(const item of state.evaluated.filter((entry)=>!entry.readiness.complete)){
      const values=[item.row.id,item.row.name,item.row.status,item.readiness.missing.map((x)=>x.label).join(', ')].map((value)=>`"${String(value??'').replaceAll('"','""')}"`);
      csv.push(values.join(';'));
    }
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="central-prints-pendencias.csv"').send(`\ufeff${csv.join('\n')}`);
  });
}
