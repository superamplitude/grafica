import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { r2Status, signedReadUrl } from '../lib/storage.js';
import { releaseReadyOrderItems } from '../domain/production-release.js';

const decisionSchema = z.object({
  decision: z.enum(['approve','changes']),
  note: z.string().max(5000).nullable().optional()
});

export async function registerProofRoutes(app) {
  app.get('/api/v1/orders/:number/proofs', async (request, reply) => {
    const db = getDb();
    const token = String(request.headers['x-order-token'] || '').trim();
    const order = await app.findAccessibleOrder(db, String(request.params.number), token);
    if (!order) return reply.code(404).send({ error:'ORDER_NOT_FOUND' });

    const [rows] = await db.execute(`
      SELECT pr.id,pr.artwork_id,pr.version_no,pr.status,pr.customer_note,pr.approved_at,pr.created_at,
             a.order_item_id,a.side,a.status AS artwork_status,
             oi.product_id,oi.variant_id,p.name AS product_name,pv.name AS variant_name,
             mo.original_name,mo.mime_type,mo.size_bytes
        FROM proofs pr
        JOIN artworks a ON a.id=pr.artwork_id
        JOIN order_items oi ON oi.id=a.order_item_id
        LEFT JOIN products p ON p.id=oi.product_id
        LEFT JOIN product_variants pv ON pv.id=oi.variant_id
        JOIN media_objects mo ON mo.id=pr.media_id
       WHERE oi.order_id=? AND a.superseded_at IS NULL
       ORDER BY a.order_item_id,pr.version_no DESC,pr.id DESC
    `, [order.id]);

    return { items:rows };
  });

  app.get('/api/v1/orders/:number/proofs/:proofId/view', async (request, reply) => {
    const db = getDb();
    const token = String(request.headers['x-order-token'] || '').trim();
    const order = await app.findAccessibleOrder(db, String(request.params.number), token);
    if (!order) return reply.code(404).send({ error:'ORDER_NOT_FOUND' });
    if (await r2Status() !== 'ok') return reply.code(503).send({ error:'R2_NOT_READY' });

    const [rows] = await db.execute(`
      SELECT mo.object_key
        FROM proofs pr
        JOIN artworks a ON a.id=pr.artwork_id
        JOIN order_items oi ON oi.id=a.order_item_id
        JOIN media_objects mo ON mo.id=pr.media_id
       WHERE pr.id=? AND oi.order_id=? LIMIT 1
    `, [Number(request.params.proofId),order.id]);
    if (!rows[0]) return reply.code(404).send({ error:'PROOF_NOT_FOUND' });
    return { url:await signedReadUrl(rows[0].object_key,600),expiresIn:600 };
  });

  app.post('/api/v1/orders/:number/proofs/:proofId/decision', async (request, reply) => {
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'INVALID_PROOF_DECISION' });
    const db = getDb();
    const token = String(request.headers['x-order-token'] || '').trim();
    const accessibleOrder = await app.findAccessibleOrder(db, String(request.params.number), token);
    if (!accessibleOrder) return reply.code(404).send({ error:'ORDER_NOT_FOUND' });

    const proofId = Number(request.params.proofId);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(`
        SELECT pr.*,a.order_item_id,a.superseded_at,oi.order_id,o.payment_status,o.customer_id
          FROM proofs pr
          JOIN artworks a ON a.id=pr.artwork_id
          JOIN order_items oi ON oi.id=a.order_item_id
          JOIN orders o ON o.id=oi.order_id
         WHERE pr.id=? FOR UPDATE
      `, [proofId]);
      const proof = rows[0];
      if (!proof || Number(proof.order_id) !== Number(accessibleOrder.id)) {
        await connection.rollback();
        return reply.code(404).send({ error:'PROOF_NOT_FOUND' });
      }
      if (proof.superseded_at) {
        await connection.rollback();
        return reply.code(409).send({ error:'PROOF_SUPERSEDED' });
      }
      if (proof.status !== 'pending') {
        await connection.rollback();
        return reply.code(409).send({ error:'PROOF_ALREADY_DECIDED', status:proof.status });
      }

      const approved = parsed.data.decision === 'approve';
      const proofStatus = approved ? 'approved' : 'changes-requested';
      const artworkStatus = approved ? 'approved' : 'changes-required';
      await connection.execute(`
        UPDATE proofs SET status=?,customer_note=?,approved_at=? WHERE id=?
      `, [proofStatus,parsed.data.note||null,approved?new Date():null,proofId]);
      await connection.execute('UPDATE artworks SET status=?,updated_at=NOW() WHERE id=?', [artworkStatus,proof.artwork_id]);

      let release = null;
      if (approved) {
        const [pendingRows] = await connection.execute(`SELECT COUNT(*) AS pending FROM artworks WHERE order_item_id=? AND superseded_at IS NULL AND status<>'approved'`, [proof.order_item_id]);
        const pending = Number(pendingRows[0]?.pending || 0);
        if (pending === 0) {
          const itemStatus = ['paid','not_required'].includes(proof.payment_status) ? 'ready-for-production' : 'artwork-approved-awaiting-payment';
          await connection.execute('UPDATE order_items SET production_status=? WHERE id=?', [itemStatus,proof.order_item_id]);
        }
        release = await releaseReadyOrderItems(connection,{
          orderId:proof.order_id,
          actorType:'customer',
          actorId:proof.customer_id || null,
          reason:'customer-proof-approved'
        });
      } else {
        await connection.execute(`UPDATE order_items SET production_status='awaiting-artwork' WHERE id=?`, [proof.order_item_id]);
      }

      const payload = JSON.stringify({ proofId,artworkId:proof.artwork_id,itemId:proof.order_item_id,note:parsed.data.note||null });
      await connection.execute(`INSERT INTO artwork_events (artwork_id,event_type,actor_type,actor_id,payload_json) VALUES (?,?,?,?,?)`, [
        proof.artwork_id,approved?'proof.approved':'proof.changes-requested','customer',proof.customer_id||null,payload
      ]);
      await connection.execute(`INSERT INTO order_events (order_id,event_type,actor_type,actor_id,payload_json) VALUES (?,?,?,?,?)`, [
        proof.order_id,approved?'proof.approved':'proof.changes-requested','customer',proof.customer_id||null,payload
      ]);
      await connection.execute(`
        INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
        VALUES ('customer',? ,?,'proof',?,?,?,?)
      `, [proof.customer_id||null,approved?'proof.approve':'proof.request-changes',proofId,JSON.stringify(proof),JSON.stringify({ ...proof,status:proofStatus,customer_note:parsed.data.note||null }),request.ip||null]);

      await connection.commit();
      return { ok:true,status:proofStatus,artworkStatus,release };
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally { connection.release(); }
  });
}
