import { z } from 'zod';
import { getDb } from '../lib/db.js';

const ORDER_STATUSES = [
  'awaiting-shipping-quote',
  'awaiting-payment',
  'paid',
  'prepress',
  'production',
  'shipped',
  'completed',
  'cancelled'
];

const PAYMENT_STATUSES = [
  'not_required',
  'pending',
  'paid',
  'partially_paid',
  'refunded',
  'cancelled'
];

const orderTransitions = {
  'awaiting-shipping-quote': ['awaiting-payment', 'cancelled'],
  'awaiting-payment': ['paid', 'cancelled'],
  paid: ['prepress', 'production', 'cancelled'],
  prepress: ['production', 'cancelled'],
  production: ['shipped', 'completed', 'cancelled'],
  shipped: ['completed'],
  completed: [],
  cancelled: []
};

const patchSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  payment_status: z.enum(PAYMENT_STATUSES).optional(),
  payment_provider: z.string().max(80).nullable().optional(),
  paid_total: z.number().min(0).max(999999999).optional(),
  shipping_total: z.number().min(0).max(999999999).optional(),
  discount_total: z.number().min(0).max(999999999).optional(),
  note: z.string().max(5000).nullable().optional()
}).refine(value => Object.keys(value).some(key => key !== 'note'), {
  message: 'EMPTY_ORDER_UPDATE'
});

function jsonValue(value) {
  if (value == null || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function decimal(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function writeAudit(connection, request, action, entityId, before, after) {
  await connection.execute(`
    INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',? ,?,'order',?,?,?,?)
  `, [
    Number(request.user.sub),
    action,
    entityId,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    request.ip || null
  ]);
}

function normalizeOrder(row) {
  if (!row) return row;
  return {
    ...row,
    subtotal: decimal(row.subtotal),
    shipping_total: decimal(row.shipping_total),
    discount_total: decimal(row.discount_total),
    grand_total: decimal(row.grand_total),
    paid_total: decimal(row.paid_total),
    billing_json: jsonValue(row.billing_json),
    shipping_json: jsonValue(row.shipping_json),
    metadata_json: jsonValue(row.metadata_json)
  };
}

export async function registerAdminOrderRoutes(app) {
  const anyStaff = app.requireRole('super_admin', 'admin', 'operations', 'prepress', 'support');
  const orderManagers = app.requireRole('super_admin', 'admin', 'operations');

  app.get('/api/v1/admin/orders', { preHandler: anyStaff }, async request => {
    const db = getDb();
    const status = String(request.query?.status || '').trim();
    const paymentStatus = String(request.query?.payment_status || '').trim();
    const q = String(request.query?.q || '').trim().slice(0, 190);
    const where = ['1=1'];
    const params = [];

    if (ORDER_STATUSES.includes(status)) {
      where.push('o.status=?');
      params.push(status);
    }
    if (PAYMENT_STATUSES.includes(paymentStatus)) {
      where.push('o.payment_status=?');
      params.push(paymentStatus);
    }
    if (q) {
      const like = `%${q}%`;
      where.push('(o.order_number LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)');
      params.push(like, like, like, like);
    }

    const [rows] = await db.execute(`
      SELECT o.id,o.order_number,o.status,o.payment_status,o.payment_provider,o.currency,
             o.subtotal,o.shipping_total,o.discount_total,o.grand_total,o.paid_total,
             o.created_at,o.updated_at,
             c.name AS customer_name,c.email AS customer_email,c.phone AS customer_phone,
             (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS items_count,
             (SELECT COUNT(*) FROM artworks a JOIN order_items oi2 ON oi2.id=a.order_item_id WHERE oi2.order_id=o.id) AS artworks_count,
             (SELECT COUNT(*) FROM production_jobs pj JOIN order_items oi3 ON oi3.id=pj.order_item_id WHERE oi3.order_id=o.id AND pj.status NOT IN ('completed','cancelled')) AS production_open
        FROM orders o
        LEFT JOIN customers c ON c.id=o.customer_id
       WHERE ${where.join(' AND ')}
       ORDER BY o.created_at DESC,o.id DESC
       LIMIT 300
    `, params);

    return { items: rows.map(normalizeOrder), statuses: ORDER_STATUSES, paymentStatuses: PAYMENT_STATUSES };
  });

  app.get('/api/v1/admin/orders/:id', { preHandler: anyStaff }, async (request, reply) => {
    const db = getDb();
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'INVALID_ORDER_ID' });

    const [orders] = await db.execute(`
      SELECT o.*,c.name AS customer_name,c.email AS customer_email,c.phone AS customer_phone
        FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
       WHERE o.id=? LIMIT 1
    `, [id]);
    if (!orders[0]) return reply.code(404).send({ error: 'ORDER_NOT_FOUND' });

    const [items] = await db.execute(`
      SELECT oi.id,oi.quantity,oi.unit_price,oi.line_total,oi.production_status,oi.configuration_json,
             p.name AS product_name,p.sku AS product_sku,p.requires_artwork,
             v.name AS variant_name,v.sku AS variant_sku,
             (SELECT COUNT(*) FROM artworks a WHERE a.order_item_id=oi.id) AS artwork_count,
             (SELECT GROUP_CONCAT(DISTINCT a.status ORDER BY a.status SEPARATOR ',') FROM artworks a WHERE a.order_item_id=oi.id) AS artwork_statuses,
             (SELECT GROUP_CONCAT(DISTINCT pj.status ORDER BY pj.status SEPARATOR ',') FROM production_jobs pj WHERE pj.order_item_id=oi.id) AS production_statuses
        FROM order_items oi
        LEFT JOIN products p ON p.id=oi.product_id
        LEFT JOIN product_variants v ON v.id=oi.variant_id
       WHERE oi.order_id=? ORDER BY oi.id
    `, [id]);

    const [events] = await db.execute(`
      SELECT id,event_type,from_status,to_status,actor_type,actor_id,payload_json,created_at
        FROM order_events WHERE order_id=? ORDER BY id DESC LIMIT 200
    `, [id]);

    return {
      order: normalizeOrder(orders[0]),
      items: items.map(item => ({
        ...item,
        unit_price: decimal(item.unit_price),
        line_total: decimal(item.line_total),
        configuration_json: jsonValue(item.configuration_json)
      })),
      events: events.map(event => ({ ...event, payload_json: jsonValue(event.payload_json) })),
      statuses: ORDER_STATUSES,
      paymentStatuses: PAYMENT_STATUSES
    };
  });

  app.patch('/api/v1/admin/orders/:id', { preHandler: orderManagers }, async (request, reply) => {
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_ORDER_UPDATE' });

    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'INVALID_ORDER_ID' });

    const db = getDb();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT * FROM orders WHERE id=? FOR UPDATE', [id]);
      const before = rows[0];
      if (!before) {
        await connection.rollback();
        return reply.code(404).send({ error: 'ORDER_NOT_FOUND' });
      }

      const data = parsed.data;
      const shippingTotal = data.shipping_total === undefined ? decimal(before.shipping_total) : decimal(data.shipping_total);
      const discountTotal = data.discount_total === undefined ? decimal(before.discount_total) : decimal(data.discount_total);
      const subtotal = decimal(before.subtotal);
      const grandTotal = decimal(Math.max(0, subtotal + shippingTotal - discountTotal));

      let targetStatus = data.status || before.status;
      let paymentStatus = data.payment_status || before.payment_status;
      let paidTotal = data.paid_total === undefined ? decimal(before.paid_total) : decimal(data.paid_total);

      const shippingChanged = data.shipping_total !== undefined && shippingTotal !== decimal(before.shipping_total);
      if (!data.status && shippingChanged && before.status === 'awaiting-shipping-quote') {
        targetStatus = 'awaiting-payment';
      }

      if (paymentStatus === 'paid' && data.paid_total === undefined) paidTotal = grandTotal;
      if (!data.status && paymentStatus === 'paid' && before.status === 'awaiting-payment') targetStatus = 'paid';

      if (paymentStatus === 'paid' && paidTotal < grandTotal) {
        await connection.rollback();
        return reply.code(409).send({ error: 'PAID_TOTAL_BELOW_GRAND_TOTAL', grandTotal, paidTotal });
      }
      if (paymentStatus === 'partially_paid' && !(paidTotal > 0 && paidTotal < grandTotal)) {
        await connection.rollback();
        return reply.code(409).send({ error: 'INVALID_PARTIAL_PAYMENT', grandTotal, paidTotal });
      }
      if (paidTotal > grandTotal && !['refunded'].includes(paymentStatus)) {
        await connection.rollback();
        return reply.code(409).send({ error: 'PAID_TOTAL_ABOVE_GRAND_TOTAL', grandTotal, paidTotal });
      }

      if (targetStatus !== before.status) {
        const allowed = orderTransitions[before.status] || [];
        const legacyOverride = !Object.hasOwn(orderTransitions, before.status) && request.user.role === 'super_admin';
        if (!allowed.includes(targetStatus) && !legacyOverride) {
          await connection.rollback();
          return reply.code(409).send({ error: 'INVALID_ORDER_STATUS_TRANSITION', from: before.status, to: targetStatus });
        }
      }

      await connection.execute(`
        UPDATE orders
           SET status=?,payment_status=?,payment_provider=?,paid_total=?,shipping_total=?,discount_total=?,grand_total=?,updated_at=NOW()
         WHERE id=?
      `, [
        targetStatus,
        paymentStatus,
        data.payment_provider === undefined ? before.payment_provider : data.payment_provider,
        paidTotal,
        shippingTotal,
        discountTotal,
        grandTotal,
        id
      ]);

      if (shippingChanged) {
        await connection.execute(`
          INSERT INTO order_events (order_id,event_type,from_status,to_status,actor_type,actor_id,payload_json)
          VALUES (?,'shipping.quoted',?,?,'staff',?,?)
        `, [id, before.status, targetStatus, Number(request.user.sub), JSON.stringify({ shippingTotal, note: data.note || null })]);
      }

      const paymentChanged = paymentStatus !== before.payment_status || paidTotal !== decimal(before.paid_total) || data.payment_provider !== undefined;
      if (paymentChanged) {
        await connection.execute(`
          INSERT INTO order_events (order_id,event_type,from_status,to_status,actor_type,actor_id,payload_json)
          VALUES (?,'payment.updated',?,?,'staff',?,?)
        `, [id, before.payment_status, paymentStatus, Number(request.user.sub), JSON.stringify({ paidTotal, grandTotal, provider: data.payment_provider === undefined ? before.payment_provider : data.payment_provider, note: data.note || null })]);
      }

      if (targetStatus !== before.status && !shippingChanged) {
        await connection.execute(`
          INSERT INTO order_events (order_id,event_type,from_status,to_status,actor_type,actor_id,payload_json)
          VALUES (?,'order.status.updated',?,?,'staff',?,?)
        `, [id, before.status, targetStatus, Number(request.user.sub), JSON.stringify({ note: data.note || null })]);
      }

      const [afterRows] = await connection.execute('SELECT * FROM orders WHERE id=? LIMIT 1', [id]);
      const after = afterRows[0];
      await writeAudit(connection, request, 'order.update', id, before, after);
      await connection.commit();
      return { ok: true, order: normalizeOrder(after) };
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally {
      connection.release();
    }
  });
}
