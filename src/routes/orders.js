import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../lib/db.js';

const checkoutSchema = z.object({
  customer: z.object({
    name: z.string().min(2).max(255),
    email: z.string().email().max(255),
    phone: z.string().min(8).max(60).optional().nullable()
  }),
  billing: z.record(z.string(), z.unknown()).optional(),
  shipping: z.record(z.string(), z.unknown()).optional(),
  items: z.array(z.object({
    variantId: z.number().int().positive(),
    lots: z.number().int().min(1).max(20).default(1),
    configuration: z.record(z.string(), z.unknown()).optional()
  })).min(1).max(50)
});

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function issueOrderToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hash(token) };
}

function orderNumber() {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}`;
  return `CP-${date}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function findAccessibleOrder(db, number, token) {
  if (!token) return null;
  const tokenHash = hash(token);
  const [rows] = await db.execute(`
    SELECT o.*
      FROM orders o
      JOIN order_access_tokens oat ON oat.order_id=o.id
     WHERE o.order_number=? AND oat.token_hash=? AND oat.revoked_at IS NULL AND oat.expires_at>NOW()
     LIMIT 1
  `, [number, tokenHash]);
  return rows[0] || null;
}

export async function registerOrderRoutes(app) {
  app.post('/api/v1/orders', {
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } }
  }, async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_CHECKOUT' });

    const idempotencyKey = String(request.headers['idempotency-key'] || '').trim();
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      return reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    }

    const requestHash = hash(JSON.stringify(parsed.data));
    const db = getDb();
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();
      const [existing] = await connection.execute(`
        SELECT ci.request_hash,o.order_number,o.id
          FROM checkout_idempotency ci JOIN orders o ON o.id=ci.order_id
         WHERE ci.idempotency_key=? FOR UPDATE
      `, [idempotencyKey]);
      if (existing.length) {
        if (existing[0].request_hash !== requestHash) {
          await connection.rollback();
          return reply.code(409).send({ error: 'IDEMPOTENCY_KEY_CONFLICT' });
        }
        await connection.rollback();
        return reply.code(409).send({ error: 'ORDER_ALREADY_CREATED', orderNumber: existing[0].order_number });
      }

      const requestedIds = [...new Set(parsed.data.items.map((item) => item.variantId))];
      const placeholders = requestedIds.map(() => '?').join(',');
      const [variants] = await connection.execute(`
        SELECT v.id,v.product_id,v.name,v.public_price,v.availability,v.status,p.name AS product_name,p.status AS product_status
          FROM product_variants v JOIN products p ON p.id=v.product_id
         WHERE v.id IN (${placeholders}) FOR SHARE
      `, requestedIds);
      const byId = new Map(variants.map((row) => [Number(row.id), row]));

      let subtotal = 0;
      const normalizedItems = [];
      for (const item of parsed.data.items) {
        const variant = byId.get(item.variantId);
        const price = Number(variant?.public_price || 0);
        if (!variant || variant.status !== 'active' || variant.product_status !== 'active' || variant.availability === 'unavailable' || price <= 0) {
          await connection.rollback();
          return reply.code(409).send({ error: 'ITEM_NOT_AVAILABLE', variantId: item.variantId });
        }
        const lineTotal = Math.round(price * item.lots * 100) / 100;
        subtotal += lineTotal;
        normalizedItems.push({ item, variant, price, lineTotal });
      }
      subtotal = Math.round(subtotal * 100) / 100;

      const email = parsed.data.customer.email.toLowerCase();
      await connection.execute(`
        INSERT IGNORE INTO customers (name,email,phone,metadata_json) VALUES (?,?,?,?)
      `, [parsed.data.customer.name,email,parsed.data.customer.phone || null,JSON.stringify({ source: 'guest-checkout' })]);
      const [customers] = await connection.execute('SELECT id FROM customers WHERE email=? LIMIT 1', [email]);
      const customerId = customers[0]?.id;
      if (!customerId) throw new Error('CUSTOMER_PERSIST_FAILED');

      let number;
      let orderResult;
      for (let attempt=0; attempt<5; attempt++) {
        number = orderNumber();
        try {
          [orderResult] = await connection.execute(`
            INSERT INTO orders (customer_id,order_number,status,payment_status,currency,subtotal,shipping_total,discount_total,grand_total,billing_json,shipping_json,metadata_json)
            VALUES (?,?,'awaiting-payment','pending','BRL',?,0,0,?,?,?,?)
          `, [
            customerId,number,subtotal,subtotal,
            JSON.stringify(parsed.data.billing || {}),
            JSON.stringify(parsed.data.shipping || {}),
            JSON.stringify({ source: 'node-portal', payment: 'not-integrated' })
          ]);
          break;
        } catch (error) {
          if (error?.code !== 'ER_DUP_ENTRY' || attempt === 4) throw error;
        }
      }
      const orderId = orderResult.insertId;

      const itemIds = [];
      for (const normalized of normalizedItems) {
        const [itemResult] = await connection.execute(`
          INSERT INTO order_items (order_id,product_id,variant_id,quantity,unit_price,line_total,configuration_json,production_status)
          VALUES (?,?,?,?,?,?,?,'awaiting-artwork')
        `, [
          orderId,normalized.variant.product_id,normalized.variant.id,normalized.item.lots,
          normalized.price,normalized.lineTotal,JSON.stringify(normalized.item.configuration || {})
        ]);
        itemIds.push(Number(itemResult.insertId));
      }

      const { token, tokenHash } = issueOrderToken();
      await connection.execute(`
        INSERT INTO order_access_tokens (order_id,token_hash,purpose,expires_at)
        VALUES (?,?,'customer_portal',DATE_ADD(NOW(),INTERVAL 90 DAY))
      `, [orderId,tokenHash]);
      await connection.execute('INSERT INTO checkout_idempotency (idempotency_key,request_hash,order_id) VALUES (?,?,?)', [idempotencyKey,requestHash,orderId]);
      await connection.execute(`
        INSERT INTO order_events (order_id,event_type,to_status,actor_type,payload_json)
        VALUES (?,'order.created','awaiting-payment','customer',?)
      `, [orderId,JSON.stringify({ customerEmail: email, itemCount: itemIds.length })]);
      await connection.commit();

      return reply.code(201).send({
        orderNumber: number,
        orderToken: token,
        status: 'awaiting-payment',
        payment: { status: 'pending', provider: null, checkoutAvailable: false },
        totals: { subtotal, shipping: 0, discount: 0, total: subtotal, currency: 'BRL' },
        itemIds
      });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally {
      connection.release();
    }
  });

  app.get('/api/v1/orders/:number', async (request, reply) => {
    const db = getDb();
    const token = String(request.headers['x-order-token'] || '').trim();
    const order = await findAccessibleOrder(db, String(request.params.number), token);
    if (!order) return reply.code(404).send({ error: 'ORDER_NOT_FOUND' });
    const [items] = await db.execute(`
      SELECT oi.id,oi.quantity,oi.unit_price,oi.line_total,oi.configuration_json,oi.production_status,
             p.name AS product_name,p.slug AS product_slug,p.requires_artwork,p.supports_front,p.supports_back,
             v.name AS variant_name,v.external_code,v.size_label,v.print_configuration,v.production_days
        FROM order_items oi
        LEFT JOIN products p ON p.id=oi.product_id
        LEFT JOIN product_variants v ON v.id=oi.variant_id
       WHERE oi.order_id=? ORDER BY oi.id
    `, [order.id]);
    const [events] = await db.execute(`SELECT event_type,from_status,to_status,created_at FROM order_events WHERE order_id=? ORDER BY id`, [order.id]);
    return {
      order: {
        number: order.order_number,
        status: order.status,
        payment_status: order.payment_status,
        currency: order.currency,
        subtotal: Number(order.subtotal),
        shipping_total: Number(order.shipping_total),
        discount_total: Number(order.discount_total),
        grand_total: Number(order.grand_total),
        paid_total: Number(order.paid_total || 0),
        created_at: order.created_at,
        updated_at: order.updated_at
      },
      items: items.map((row) => ({ ...row, configuration_json: typeof row.configuration_json === 'string' ? JSON.parse(row.configuration_json) : row.configuration_json })),
      events
    };
  });

  app.decorate('findAccessibleOrder', findAccessibleOrder);
}
