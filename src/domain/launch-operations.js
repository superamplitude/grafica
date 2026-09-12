import { evaluateProductReadiness } from './launch-readiness.js';
import { createLaunchRun, json, launchSnapshot, loadLaunchRunForUpdate, parseJson, productRows, sameFieldValue, writeLaunchAudit } from './launch-data.js';

export async function simulateRepair(db, request) {
  const state = await launchSnapshot(db);
  const candidates = state.evaluated.filter((item) => item.repairs.length > 0);
  if (!candidates.length) return { conflict: { error: 'NOTHING_TO_REPAIR' } };
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const changes = candidates.flatMap(({ row, repairs }) => repairs.map((repair) => ({ product_id: Number(row.id), product_name: row.name, ...repair })));
    const run = await createLaunchRun(connection, request, 'repair', { products: candidates.length, changes: changes.length });
    for (const change of changes) {
      await connection.execute(`INSERT INTO launch_changes (run_id,entity_type,entity_id,field_name,before_json,after_json,reason,status) VALUES (?,'product',?,?,?,?,?,'planned')`, [run.id, change.product_id, change.field, json({ value: change.before }), json({ value: change.after }), change.reason]);
    }
    await writeLaunchAudit(connection, request, 'launch.repair.simulate', 'launch_run', run.id, null, { ...run, products: candidates.length, changes: changes.length });
    await connection.commit();
    return { ok: true, run, changes };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function executeRepair(db, request, runId) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const run = await loadLaunchRunForUpdate(connection, runId);
    if (!run || run.run_type !== 'repair') { await connection.rollback(); return { notFound: { error: 'REPAIR_RUN_NOT_FOUND' } }; }
    if (run.status !== 'simulated') { await connection.rollback(); return { conflict: { error: 'RUN_NOT_SIMULATED' } }; }
    const [changes] = await connection.execute(`SELECT * FROM launch_changes WHERE run_id=? AND status='planned' ORDER BY id FOR UPDATE`, [run.id]);
    let applied = 0;
    let skipped = 0;
    for (const change of changes) {
      if (!['base_price','description'].includes(change.field_name)) {
        await connection.execute(`UPDATE launch_changes SET status='skipped',skip_reason='FIELD_NOT_ALLOWED' WHERE id=?`, [change.id]);
        skipped += 1; continue;
      }
      const [rows] = await connection.execute('SELECT id,base_price,description FROM products WHERE id=? FOR UPDATE', [change.entity_id]);
      const current = rows[0];
      const before = parseJson(change.before_json) || {};
      const after = parseJson(change.after_json) || {};
      if (!current || !sameFieldValue(change.field_name, current[change.field_name], before.value)) {
        await connection.execute(`UPDATE launch_changes SET status='skipped',skip_reason='VALUE_CHANGED_AFTER_SIMULATION' WHERE id=?`, [change.id]);
        skipped += 1; continue;
      }
      await connection.execute(`UPDATE products SET ${change.field_name}=?,updated_at=NOW() WHERE id=?`, [after.value, change.entity_id]);
      await connection.execute(`UPDATE launch_changes SET status='applied',applied_at=NOW() WHERE id=?`, [change.id]);
      applied += 1;
    }
    const result = { applied, skipped };
    await connection.execute(`UPDATE launch_runs SET status='executed',summary_json=?,executed_at=NOW() WHERE id=?`, [json(result), run.id]);
    await writeLaunchAudit(connection, request, 'launch.repair.execute', 'launch_run', run.id, { status: run.status }, { status: 'executed', ...result });
    await connection.commit();
    return { ok: true, run_id: run.id, ...result };
  } catch (error) {
    await connection.rollback(); throw error;
  } finally { connection.release(); }
}

export async function simulatePilot(db, request, limit) {
  const state = await launchSnapshot(db);
  const candidates = state.evaluated.filter((item) => item.readiness.complete && ['draft','paused'].includes(item.row.status));
  if (candidates.length < limit) return { conflict: { error:'INSUFFICIENT_COMPLETE_PRODUCTS', required:limit, available:candidates.length } };
  const selected = candidates.slice(0, limit);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const run = await createLaunchRun(connection, request, 'pilot', { requested: limit, selected: selected.length });
    for (const item of selected) {
      await connection.execute(`INSERT INTO launch_changes (run_id,entity_type,entity_id,field_name,before_json,after_json,reason,status) VALUES (?,'product',?,'status',?,?,?,'planned')`, [run.id, Number(item.row.id), json({ value:item.row.status, updated_at:item.row.updated_at }), json({ value:'active' }), 'Produto completo selecionado para catálogo piloto.']);
    }
    await writeLaunchAudit(connection, request, 'launch.pilot.simulate', 'launch_run', run.id, null, { ...run, product_ids:selected.map((item) => Number(item.row.id)) });
    await connection.commit();
    return { ok:true, run, items:selected.map((item) => ({ id:item.row.id, name:item.row.name, status:item.row.status })) };
  } catch (error) {
    await connection.rollback(); throw error;
  } finally { connection.release(); }
}

export async function executePilot(db, request, runId) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const run = await loadLaunchRunForUpdate(connection, runId);
    if (!run || run.run_type !== 'pilot') { await connection.rollback(); return { notFound:{ error:'PILOT_RUN_NOT_FOUND' } }; }
    if (run.status !== 'simulated') { await connection.rollback(); return { conflict:{ error:'RUN_NOT_SIMULATED' } }; }
    const [changes] = await connection.execute(`SELECT * FROM launch_changes WHERE run_id=? AND status='planned' ORDER BY id FOR UPDATE`, [run.id]);
    if (changes.length < 5 || changes.length > 10) { await connection.rollback(); return { conflict:{ error:'PILOT_SIZE_INVALID' } }; }
    const ids = changes.map((change) => Number(change.entity_id));
    const [locks] = await connection.execute(`SELECT id,status,updated_at FROM products WHERE id IN (${ids.map(() => '?').join(',')}) FOR UPDATE`, ids);
    const locked = new Map(locks.map((row) => [Number(row.id), row]));
    const freshRows = await productRows(connection, ids);
    const readiness = new Map(freshRows.map((row) => [Number(row.id), evaluateProductReadiness(row)]));
    for (const change of changes) {
      const id = Number(change.entity_id);
      const before = parseJson(change.before_json) || {};
      const current = locked.get(id);
      if (!current || !sameFieldValue('status', current.status, before.value) || !readiness.get(id)?.complete) {
        await connection.rollback();
        return { conflict:{ error:'PILOT_REVALIDATION_FAILED', product_id:id, missing:readiness.get(id)?.missing || [] } };
      }
    }
    for (const change of changes) {
      await connection.execute(`UPDATE products SET status='active',updated_at=NOW() WHERE id=?`, [change.entity_id]);
      const [afterRows] = await connection.execute('SELECT status,updated_at FROM products WHERE id=?', [change.entity_id]);
      await connection.execute(`UPDATE launch_changes SET status='applied',after_json=?,applied_at=NOW() WHERE id=?`, [json({ value:'active', updated_at:afterRows[0].updated_at }), change.id]);
    }
    const result = { published:changes.length, product_ids:ids };
    await connection.execute(`UPDATE launch_runs SET status='executed',summary_json=?,executed_at=NOW() WHERE id=?`, [json(result), run.id]);
    await writeLaunchAudit(connection, request, 'launch.pilot.execute', 'launch_run', run.id, { status:run.status }, { status:'executed', ...result });
    await connection.commit();
    return { ok:true, run_id:run.id, ...result };
  } catch (error) {
    await connection.rollback(); throw error;
  } finally { connection.release(); }
}

export async function rollbackLaunchRun(db, request, runId) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const run = await loadLaunchRunForUpdate(connection, runId);
    if (!run) { await connection.rollback(); return { notFound:{ error:'RUN_NOT_FOUND' } }; }
    if (run.status !== 'executed') { await connection.rollback(); return { conflict:{ error:'RUN_NOT_EXECUTED' } }; }
    const [changes] = await connection.execute(`SELECT * FROM launch_changes WHERE run_id=? AND status='applied' ORDER BY id DESC FOR UPDATE`, [run.id]);
    let rolledBack = 0;
    let skipped = 0;
    for (const change of changes) {
      const field = change.field_name;
      const before = parseJson(change.before_json) || {};
      const after = parseJson(change.after_json) || {};
      if (!['base_price','description','status'].includes(field)) {
        await connection.execute(`UPDATE launch_changes SET status='skipped',skip_reason='FIELD_NOT_ALLOWED' WHERE id=?`, [change.id]);
        skipped += 1; continue;
      }
      const [rows] = await connection.execute(`SELECT id,base_price,description,status,updated_at FROM products WHERE id=? FOR UPDATE`, [change.entity_id]);
      const current = rows[0];
      let unchanged = current && sameFieldValue(field, current[field], after.value);
      if (unchanged && run.run_type === 'pilot' && after.updated_at) unchanged = new Date(current.updated_at).getTime() === new Date(after.updated_at).getTime();
      if (!unchanged) {
        await connection.execute(`UPDATE launch_changes SET status='skipped',skip_reason='VALUE_CHANGED_AFTER_EXECUTION' WHERE id=?`, [change.id]);
        skipped += 1; continue;
      }
      await connection.execute(`UPDATE products SET ${field}=?,updated_at=NOW() WHERE id=?`, [before.value, change.entity_id]);
      await connection.execute(`UPDATE launch_changes SET status='rolled_back',rolled_back_at=NOW() WHERE id=?`, [change.id]);
      rolledBack += 1;
    }
    const result = { rolled_back:rolledBack, skipped };
    await connection.execute(`UPDATE launch_runs SET status='rolled_back',summary_json=?,rolled_back_at=NOW() WHERE id=?`, [json(result), run.id]);
    await writeLaunchAudit(connection, request, 'launch.rollback', 'launch_run', run.id, { status:run.status }, { status:'rolled_back', ...result });
    await connection.commit();
    return { ok:true, run_id:run.id, ...result };
  } catch (error) {
    await connection.rollback(); throw error;
  } finally { connection.release(); }
}
