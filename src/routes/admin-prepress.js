import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { releaseReadyOrderItems } from '../domain/production-release.js';

const statusValues = ['uploaded','preflight','changes-required','approved','rejected'];
const decisionSchema = z.object({
  decision: z.enum(['approve','changes','reject']),
  note: z.string().max(5000).nullable().optional(),
  override: z.boolean().optional().default(false)
});
const proofSchema = z.object({
  mediaId: z.number().int().positive(),
  note: z.string().max(5000).nullable().optional()
});

function json(value) {
  if (value == null || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

async function audit(connection, request, action, entityType, entityId, before, after) {
  await connection.execute(`
    INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',?,?,?,?,?,?,?)
  `, [Number(request.user.sub), action, entityType, entityId,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, request.ip || null]);
}

export async function registerAdminPrepressRoutes(app) {
  const prepressStaff = app.requireRole('super_admin','admin','operations','prepress');

  app.get('/api/v1/admin/prepress/artworks', { preHandler: prepressStaff }, async request => {
    const db = getDb();
    const status = String(request.query?.status || '').trim();
    const q = String(request.query?.q || '').trim().slice(0,190);
    const where = ['a.superseded_at IS NULL'];
    const params = [];
    if (statusValues.includes(status)) { where.push('a.status=?'); params.push(status); }
    if (q) {
      const like = `%${q}%`;
      where.push('(o.order_number LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR p.name LIKE ? OR m.original_name LIKE ?)');
      params.push(like,like,like,like,like);
    }
    const [rows] = await db.execute(`
      SELECT a.id,a.order_item_id,a.original_media_id,a.preview_media_id,a.side,a.status,a.preflight_json,a.created_at,a.updated_at,
             m.original_name,m.mime_type,m.size_bytes,
             o.id AS order_id,o.order_number,o.status AS order_status,o.payment_status,
             c.name AS customer_name,c.email AS customer_email,
             p.name AS product_name,p.requires_artwork,p.supports_front,p.supports_back,
             pv.name AS variant_name,
             pf.id AS preflight_job_id,pf.status AS preflight_job_status,pf.attempts AS preflight_attempts,pf.last_error AS preflight_error,
             (SELECT pr.id FROM proofs pr WHERE pr.artwork_id=a.id ORDER BY pr.version_no DESC,pr.id DESC LIMIT 1) AS latest_proof_id,
             (SELECT pr.status FROM proofs pr WHERE pr.artwork_id=a.id ORDER BY pr.version_no DESC,pr.id DESC LIMIT 1) AS latest_proof_status,
             (SELECT pr.version_no FROM proofs pr WHERE pr.artwork_id=a.id ORDER BY pr.version_no DESC,pr.id DESC LIMIT 1) AS latest_proof_version
        FROM artworks a
        JOIN media_objects m ON m.id=a.original_media_id
        JOIN order_items oi ON oi.id=a.order_item_id
        JOIN orders o ON o.id=oi.order_id
        LEFT JOIN customers c ON c.id=o.customer_id
        LEFT JOIN products p ON p.id=oi.product_id
        LEFT JOIN product_variants pv ON pv.id=oi.variant_id
        LEFT JOIN preflight_jobs pf ON pf.artwork_id=a.id
       WHERE ${where.join(' AND ')}
       ORDER BY FIELD(a.status,'changes-required','uploaded','preflight','approved','rejected'),a.updated_at DESC,a.id DESC
       LIMIT 400
    `, params);
    return { items: rows.map(row => ({ ...row, preflight_json: json(row.preflight_json) })), statuses: statusValues };
  });

  app.get('/api/v1/admin/prepress/artworks/:id', { preHandler: prepressStaff }, async (request, reply) => {
    const db = getDb();
    const id = Number(request.params.id);
    const [rows] = await db.execute(`
      SELECT a.*,m.original_name,m.mime_type,m.size_bytes,m.object_key,
             o.id AS order_id,o.order_number,o.status AS order_status,o.payment_status,
             c.name AS customer_name,c.email AS customer_email,
             p.name AS product_name,p.requires_artwork,p.supports_front,p.supports_back,
             pv.name AS variant_name,
             pf.status AS preflight_job_status,pf.attempts AS preflight_attempts,pf.last_error AS preflight_error
        FROM artworks a
        JOIN media_objects m ON m.id=a.original_media_id
        JOIN order_items oi ON oi.id=a.order_item_id
        JOIN orders o ON o.id=oi.order_id
        LEFT JOIN customers c ON c.id=o.customer_id
        LEFT JOIN products p ON p.id=oi.product_id
        LEFT JOIN product_variants pv ON pv.id=oi.variant_id
        LEFT JOIN preflight_jobs pf ON pf.artwork_id=a.id
       WHERE a.id=? LIMIT 1
    `, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'ARTWORK_NOT_FOUND' });
    const [proofs] = await db.execute(`
      SELECT pr.id,pr.version_no,pr.status,pr.staff_note,pr.customer_note,pr.approved_at,pr.created_at,
             mo.id AS media_id,mo.original_name,mo.mime_type,mo.size_bytes
        FROM proofs pr JOIN media_objects mo ON mo.id=pr.media_id
       WHERE pr.artwork_id=? ORDER BY pr.version_no DESC,pr.id DESC
    `, [id]);
    const [events] = await db.execute(`SELECT * FROM artwork_events WHERE artwork_id=? ORDER BY id DESC LIMIT 200`, [id]);
    return {
      artwork: { ...rows[0], preflight_json: json(rows[0].preflight_json) },
      proofs,
      events: events.map(event => ({ ...event, payload_json: json(event.payload_json) }))
    };
  });

  app.post('/api/v1/admin/prepress/artworks/:id/requeue', { preHandler: prepressStaff }, async (request, reply) => {
    const id = Number(request.params.id);
    const db = getDb();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT * FROM artworks WHERE id=? FOR UPDATE', [id]);
      const before = rows[0];
      if (!before) { await connection.rollback(); return reply.code(404).send({ error: 'ARTWORK_NOT_FOUND' }); }
      if (before.superseded_at) { await connection.rollback(); return reply.code(409).send({ error:'ARTWORK_SUPERSEDED' }); }
      if (before.status === 'approved') { await connection.rollback(); return reply.code(409).send({ error: 'APPROVED_ARTWORK_CANNOT_REQUEUE' }); }
      await connection.execute(`
        INSERT INTO preflight_jobs (artwork_id,status,attempts,available_at,locked_at,last_error)
        VALUES (?,'queued',0,NOW(),NULL,NULL)
        ON DUPLICATE KEY UPDATE status='queued',attempts=0,available_at=NOW(),locked_at=NULL,last_error=NULL
      `, [id]);
      await connection.execute(`UPDATE artworks SET status='uploaded',preflight_json=?,updated_at=NOW() WHERE id=?`, [JSON.stringify({ status:'queued', requeuedAt:new Date().toISOString() }), id]);
      await connection.execute(`INSERT INTO artwork_events (artwork_id,event_type,actor_type,actor_id,payload_json) VALUES (?,'preflight.requeued','staff',?,?)`, [id,Number(request.user.sub),JSON.stringify({})]);
      const [afterRows] = await connection.execute('SELECT * FROM artworks WHERE id=?', [id]);
      await audit(connection,request,'artwork.preflight-requeue','artwork',id,before,afterRows[0]);
      await connection.commit();
      return { ok:true, artwork:afterRows[0] };
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally { connection.release(); }
  });

  app.post('/api/v1/admin/prepress/artworks/:id/proofs', { preHandler: prepressStaff }, async (request, reply) => {
    const parsed = proofSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'INVALID_PROOF' });
    const artworkId = Number(request.params.id);
    const db = getDb();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [artworks] = await connection.execute(`SELECT a.*,oi.order_id FROM artworks a JOIN order_items oi ON oi.id=a.order_item_id WHERE a.id=? FOR UPDATE`, [artworkId]);
      const artwork = artworks[0];
      if (!artwork) { await connection.rollback(); return reply.code(404).send({ error:'ARTWORK_NOT_FOUND' }); }
      if (artwork.superseded_at) { await connection.rollback(); return reply.code(409).send({ error:'ARTWORK_SUPERSEDED' }); }
      if (artwork.status === 'rejected') { await connection.rollback(); return reply.code(409).send({ error:'REJECTED_ARTWORK_CANNOT_RECEIVE_PROOF' }); }
      const [mediaRows] = await connection.execute(`SELECT * FROM media_objects WHERE id=? LIMIT 1`, [parsed.data.mediaId]);
      const media = mediaRows[0];
      if (!media || media.kind !== 'proof' || media.visibility !== 'private') { await connection.rollback(); return reply.code(409).send({ error:'INVALID_PROOF_MEDIA' }); }
      const [pending] = await connection.execute(`SELECT id FROM proofs WHERE artwork_id=? AND status='pending' LIMIT 1`, [artworkId]);
      if (pending.length) { await connection.rollback(); return reply.code(409).send({ error:'PENDING_PROOF_ALREADY_EXISTS', proofId:pending[0].id }); }
      const [versions] = await connection.execute('SELECT COALESCE(MAX(version_no),0)+1 AS next_version FROM proofs WHERE artwork_id=?', [artworkId]);
      const version = Number(versions[0]?.next_version || 1);
      const [result] = await connection.execute(`INSERT INTO proofs (artwork_id,media_id,version_no,status,staff_note,customer_note) VALUES (?,?,?,'pending',?,NULL)`, [artworkId,parsed.data.mediaId,version,parsed.data.note || null]);
      await connection.execute(`UPDATE artworks SET status='preflight',updated_at=NOW() WHERE id=?`, [artworkId]);
      await connection.execute(`INSERT INTO artwork_events (artwork_id,event_type,actor_type,actor_id,payload_json) VALUES (?,'proof.created','staff',?,?)`, [artworkId,Number(request.user.sub),JSON.stringify({ proofId:Number(result.insertId),version,mediaId:parsed.data.mediaId,note:parsed.data.note||null })]);
      await connection.execute(`INSERT INTO order_events (order_id,event_type,actor_type,actor_id,payload_json) VALUES (?,'proof.created','staff',?,?)`, [artwork.order_id,Number(request.user.sub),JSON.stringify({ artworkId,proofId:Number(result.insertId),version })]);
      await audit(connection,request,'proof.create','proof',result.insertId,null,{ artwork_id:artworkId,media_id:parsed.data.mediaId,version_no:version,status:'pending',staff_note:parsed.data.note||null });
      await connection.commit();
      return reply.code(201).send({ ok:true, proofId:Number(result.insertId), version, status:'pending' });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally { connection.release(); }
  });

  app.post('/api/v1/admin/prepress/artworks/:id/decision', { preHandler: prepressStaff }, async (request, reply) => {
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'INVALID_ARTWORK_DECISION' });
    const artworkId = Number(request.params.id);
    const db = getDb();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(`
        SELECT a.*,oi.order_id,o.payment_status
          FROM artworks a JOIN order_items oi ON oi.id=a.order_item_id JOIN orders o ON o.id=oi.order_id
         WHERE a.id=? FOR UPDATE
      `, [artworkId]);
      const before = rows[0];
      if (!before) { await connection.rollback(); return reply.code(404).send({ error:'ARTWORK_NOT_FOUND' }); }
      if (before.superseded_at) { await connection.rollback(); return reply.code(409).send({ error:'ARTWORK_SUPERSEDED' }); }
      if (before.status === 'approved' && parsed.data.decision !== 'approve') { await connection.rollback(); return reply.code(409).send({ error:'APPROVED_ARTWORK_LOCKED' }); }

      const preflight = json(before.preflight_json) || {};
      const [pendingProofs] = await connection.execute(`SELECT id FROM proofs WHERE artwork_id=? AND status='pending' LIMIT 1`, [artworkId]);
      if (parsed.data.decision === 'approve') {
        if (preflight.state === 'fail' && !(request.user.role === 'super_admin' && parsed.data.override)) {
          await connection.rollback();
          return reply.code(409).send({ error:'FAILED_PREFLIGHT_REQUIRES_SUPER_ADMIN_OVERRIDE' });
        }
        if (pendingProofs.length && !(request.user.role === 'super_admin' && parsed.data.override)) {
          await connection.rollback();
          return reply.code(409).send({ error:'PENDING_CUSTOMER_PROOF_REQUIRES_DECISION' });
        }
      }

      const target = parsed.data.decision === 'approve' ? 'approved' : (parsed.data.decision === 'changes' ? 'changes-required' : 'rejected');
      await connection.execute('UPDATE artworks SET status=?,updated_at=NOW() WHERE id=?', [target,artworkId]);
      if (target !== 'approved') await connection.execute(`UPDATE order_items SET production_status='awaiting-artwork' WHERE id=?`, [before.order_item_id]);

      await connection.execute(`INSERT INTO artwork_events (artwork_id,event_type,actor_type,actor_id,payload_json) VALUES (?,?,?,?,?)`, [
        artworkId,`artwork.${target}`,'staff',Number(request.user.sub),JSON.stringify({ note:parsed.data.note||null,override:Boolean(parsed.data.override) })
      ]);
      await connection.execute(`INSERT INTO order_events (order_id,event_type,actor_type,actor_id,payload_json) VALUES (?,?,?,?,?)`, [
        before.order_id,`artwork.${target}`,'staff',Number(request.user.sub),JSON.stringify({ artworkId,itemId:before.order_item_id,note:parsed.data.note||null })
      ]);

      let release = null;
      if (target === 'approved') {
        const [pendingRows] = await connection.execute(`SELECT COUNT(*) AS pending FROM artworks WHERE order_item_id=? AND superseded_at IS NULL AND status<>'approved'`, [before.order_item_id]);
        const pending = Number(pendingRows[0]?.pending || 0);
        if (pending === 0) {
          const waitingStatus = ['paid','not_required'].includes(before.payment_status) ? 'ready-for-production' : 'artwork-approved-awaiting-payment';
          await connection.execute('UPDATE order_items SET production_status=? WHERE id=?', [waitingStatus,before.order_item_id]);
        }
        release = await releaseReadyOrderItems(connection,{ orderId:before.order_id,actorType:'staff',actorId:Number(request.user.sub),reason:'artwork-approved' });
      }

      const [afterRows] = await connection.execute('SELECT * FROM artworks WHERE id=?', [artworkId]);
      await audit(connection,request,`artwork.${target}`,'artwork',artworkId,before,afterRows[0]);
      await connection.commit();
      return { ok:true,status:target,release };
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally { connection.release(); }
  });
}
