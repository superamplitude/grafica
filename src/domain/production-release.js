function json(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function productionMode(item) {
  const variant = json(item.production_json);
  const product = json(item.config_json);
  const raw = String(
    variant.mode || variant.production_mode || variant.productionMode ||
    product?.production?.mode || product.production_mode || product.productionMode || ''
  ).toLowerCase();
  if (['outsourced', 'hybrid'].includes(raw) && item.supplier_id) return raw;
  return 'own';
}

async function itemArtworkState(connection, item) {
  if (!item.requires_artwork) return { ready: true, total: 0, pending: 0 };
  const [rows] = await connection.execute(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status='approved' THEN 0 ELSE 1 END) AS pending
      FROM artworks
     WHERE order_item_id=? AND superseded_at IS NULL
  `, [item.id]);
  const total = Number(rows[0]?.total || 0);
  const pending = Number(rows[0]?.pending || 0);
  return { ready: total > 0 && pending === 0, total, pending };
}

export async function releaseReadyOrderItems(connection, {
  orderId,
  actorType = 'system',
  actorId = null,
  reason = 'readiness-check'
}) {
  const [orderRows] = await connection.execute('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
  const order = orderRows[0];
  if (!order) return { released: 0, blocked: 'order-not-found', orderStatus: null };
  if (['cancelled','completed','shipped'].includes(order.status)) {
    return { released: 0, blocked: 'terminal-order', orderStatus: order.status, paymentStatus: order.payment_status };
  }
  if (order.status === 'awaiting-shipping-quote') {
    return { released: 0, blocked: 'shipping', orderStatus: order.status, paymentStatus: order.payment_status };
  }

  const paymentReady = ['paid', 'not_required'].includes(order.payment_status);
  if (!paymentReady) {
    return { released: 0, blocked: 'payment', orderStatus: order.status, paymentStatus: order.payment_status };
  }

  const [items] = await connection.execute(`
    SELECT oi.id,oi.production_status,p.requires_artwork,p.supplier_id,p.config_json,pv.production_json
      FROM order_items oi
      LEFT JOIN products p ON p.id=oi.product_id
      LEFT JOIN product_variants pv ON pv.id=oi.variant_id
     WHERE oi.order_id=? ORDER BY oi.id
  `, [orderId]);

  let released = 0;
  let readyItems = 0;
  let blockedArtwork = 0;

  for (const item of items) {
    const artwork = await itemArtworkState(connection, item);
    if (!artwork.ready) {
      blockedArtwork += 1;
      continue;
    }
    readyItems += 1;

    const [existing] = await connection.execute(`
      SELECT id,status FROM production_jobs
       WHERE order_item_id=? AND status<>'cancelled'
       ORDER BY id DESC LIMIT 1
    `, [item.id]);
    if (existing.length) {
      if (!['completed', 'shipped'].includes(existing[0].status) && item.production_status !== existing[0].status) {
        await connection.execute('UPDATE order_items SET production_status=? WHERE id=?', [existing[0].status, item.id]);
      }
      continue;
    }

    const mode = productionMode(item);
    const supplierId = mode === 'own' ? null : (item.supplier_id || null);
    const [result] = await connection.execute(`
      INSERT INTO production_jobs (order_item_id,supplier_id,production_mode,status,metadata_json)
      VALUES (?,?,?,'queued',?)
    `, [item.id, supplierId, mode, JSON.stringify({ releasedBy: actorType, reason })]);

    await connection.execute('UPDATE order_items SET production_status=? WHERE id=?', ['queued', item.id]);
    await connection.execute(`
      INSERT INTO production_events (production_job_id,event_type,from_status,to_status,actor_type,actor_id,payload_json)
      VALUES (?,'job.created',NULL,'queued',?,?,?)
    `, [result.insertId, actorType, actorId, JSON.stringify({ reason, productionMode: mode, supplierId })]);
    await connection.execute(`
      INSERT INTO order_events (order_id,event_type,from_status,to_status,actor_type,actor_id,payload_json)
      VALUES (?,'production.job.created',NULL,'queued',?,?,?)
    `, [orderId, actorType, actorId, JSON.stringify({ orderItemId: item.id, productionJobId: Number(result.insertId), productionMode: mode, reason })]);
    released += 1;
  }

  const [coverageRows] = await connection.execute(`
    SELECT COUNT(*) AS item_count,
           SUM(CASE WHEN EXISTS(
             SELECT 1 FROM production_jobs pj
              WHERE pj.order_item_id=oi.id AND pj.status<>'cancelled'
           ) THEN 1 ELSE 0 END) AS covered_count
      FROM order_items oi WHERE oi.order_id=?
  `, [orderId]);
  const itemCount = Number(coverageRows[0]?.item_count || 0);
  const coveredCount = Number(coverageRows[0]?.covered_count || 0);

  let targetStatus = order.status;
  if (itemCount > 0 && coveredCount === itemCount) {
    targetStatus = 'production';
  } else if (blockedArtwork > 0 && ['paid', 'prepress'].includes(order.status)) {
    targetStatus = 'prepress';
  }

  if (targetStatus !== order.status) {
    await connection.execute('UPDATE orders SET status=?,updated_at=NOW() WHERE id=?', [targetStatus, orderId]);
    await connection.execute(`
      INSERT INTO order_events (order_id,event_type,from_status,to_status,actor_type,actor_id,payload_json)
      VALUES (?,'order.production-readiness',?,?,?,?,?)
    `, [orderId, order.status, targetStatus, actorType, actorId, JSON.stringify({ reason, released, readyItems, blockedArtwork })]);
  }

  return {
    released,
    readyItems,
    blockedArtwork,
    itemCount,
    coveredCount,
    blocked: blockedArtwork ? 'artwork' : null,
    orderStatus: targetStatus,
    paymentStatus: order.payment_status
  };
}
