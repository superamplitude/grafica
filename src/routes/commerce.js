import { z } from 'zod';
import { getDb } from '../lib/db.js';

const configSchema = z.object({
  display_name: z.string().min(2).max(190).optional(),
  status: z.enum(['inactive','testing','active','blocked']).optional(),
  config_json: z.record(z.string(), z.unknown()).optional().nullable(),
  notes: z.string().max(10000).optional().nullable()
});

function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function serialize(row, includePrivate = false) {
  const base = {
    id:Number(row.id),
    integration_type:row.integration_type,
    provider_code:row.provider_code,
    display_name:row.display_name,
    integration_mode:row.integration_mode,
    adapter_status:row.adapter_status,
    status:row.status,
    capabilities:parseJson(row.capabilities_json) || [],
    verified_at:row.verified_at || null
  };
  if (!includePrivate) return base;
  return {
    ...base,
    config:parseJson(row.config_json) || {},
    secret_env:parseJson(row.secret_env_json) || [],
    notes:row.notes || null,
    updated_at:row.updated_at
  };
}

async function audit(db, request, action, id, before, after) {
  await db.execute(`INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',? ,?,'commerce_integration',?,?,?,?)`, [
    Number(request.user.sub), action, id,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    request.ip || null
  ]);
}

export async function registerCommerceRoutes(app) {
  const staff = app.requireRole('super_admin','admin','operations','support');
  const admins = app.requireRole('super_admin','admin');
  const superAdmin = app.requireRole('super_admin');

  app.get('/api/v1/commerce/options', async () => {
    const db = getDb();
    const [rows] = await db.query(`
      SELECT id,integration_type,provider_code,display_name,integration_mode,adapter_status,status,capabilities_json,verified_at
        FROM commerce_integrations
       WHERE status='active' AND adapter_status='verified' AND verified_at IS NOT NULL
       ORDER BY integration_type,display_name
    `);
    return {
      payment:rows.filter((row)=>row.integration_type==='payment').map((row)=>serialize(row,false)),
      shipping:rows.filter((row)=>row.integration_type==='shipping').map((row)=>serialize(row,false))
    };
  });

  app.get('/api/v1/admin/commerce/integrations', { preHandler:staff }, async () => {
    const db = getDb();
    const [rows] = await db.query(`SELECT * FROM commerce_integrations ORDER BY integration_type,display_name`);
    return { items:rows.map((row)=>serialize(row,true)) };
  });

  app.patch('/api/v1/admin/commerce/integrations/:id', { preHandler:admins }, async (request, reply) => {
    const parsed = configSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'INVALID_COMMERCE_INTEGRATION' });
    const db = getDb();
    const id = Number(request.params.id);
    const [beforeRows] = await db.execute('SELECT * FROM commerce_integrations WHERE id=? LIMIT 1', [id]);
    const before = beforeRows[0];
    if (!before) return reply.code(404).send({ error:'INTEGRATION_NOT_FOUND' });
    const data = parsed.data;
    if (data.status === 'active' && (before.adapter_status !== 'verified' || !before.verified_at)) {
      return reply.code(409).send({ error:'INTEGRATION_NOT_VERIFIED' });
    }
    const map = {
      display_name:data.display_name,
      status:data.status,
      config_json:data.config_json === undefined ? undefined : JSON.stringify(data.config_json || {}),
      notes:data.notes
    };
    const entries=Object.entries(map).filter(([,value])=>value!==undefined);
    if(entries.length)await db.execute(`UPDATE commerce_integrations SET ${entries.map(([k])=>`${k}=?`).join(',')},updated_at=NOW() WHERE id=?`,[...entries.map(([,v])=>v),id]);
    const [afterRows] = await db.execute('SELECT * FROM commerce_integrations WHERE id=? LIMIT 1', [id]);
    await audit(db, request, 'commerce.integration.update', id, before, afterRows[0]);
    return { ok:true, integration:serialize(afterRows[0],true) };
  });

  app.post('/api/v1/admin/commerce/integrations/:id/verification', { preHandler:superAdmin }, async (request, reply) => {
    const parsed = z.object({ result:z.enum(['verified','blocked','reset']), note:z.string().max(5000).optional().nullable() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'INVALID_INTEGRATION_VERIFICATION' });
    const db = getDb();
    const id = Number(request.params.id);
    const [beforeRows] = await db.execute('SELECT * FROM commerce_integrations WHERE id=? LIMIT 1', [id]);
    const before = beforeRows[0];
    if (!before) return reply.code(404).send({ error:'INTEGRATION_NOT_FOUND' });
    if (parsed.data.result === 'verified' && before.adapter_status === 'planned') {
      return reply.code(409).send({ error:'ADAPTER_NOT_IMPLEMENTED' });
    }
    const adapterStatus = parsed.data.result === 'verified' ? 'verified' : (before.adapter_status === 'verified' ? 'implemented' : before.adapter_status);
    const status = parsed.data.result === 'blocked' ? 'blocked' : 'inactive';
    const verifiedAt = parsed.data.result === 'verified' ? new Date() : null;
    const verifiedBy = parsed.data.result === 'verified' ? Number(request.user.sub) : null;
    const notes = parsed.data.note === undefined ? before.notes : parsed.data.note;
    await db.execute(`UPDATE commerce_integrations SET adapter_status=?,status=?,verified_at=?,verified_by_user_id=?,notes=?,updated_at=NOW() WHERE id=?`, [adapterStatus,status,verifiedAt,verifiedBy,notes||null,id]);
    const [afterRows] = await db.execute('SELECT * FROM commerce_integrations WHERE id=? LIMIT 1', [id]);
    await audit(db, request, `commerce.integration.${parsed.data.result}`, id, before, afterRows[0]);
    return { ok:true, integration:serialize(afterRows[0],true) };
  });
}
