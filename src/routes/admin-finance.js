import { getDb } from '../lib/db.js';

function isoDate(value,fallback){
  const raw=String(value||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  return fallback;
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}

export async function registerAdminFinanceRoutes(app){
  const staff=app.requireRole('super_admin','admin','operations');

  app.get('/api/v1/admin/finance/summary',{preHandler:staff},async(request)=>{
    const db=getDb();
    const today=new Date();
    const startDefault=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),1)).toISOString().slice(0,10);
    const endDefault=today.toISOString().slice(0,10);
    const from=isoDate(request.query?.from,startDefault);
    const to=isoDate(request.query?.to,endDefault);
    const start=`${from} 00:00:00`;const end=`${to} 23:59:59`;
    const validOrder="o.status NOT IN ('cancelled','canceled','refunded','rejected')";

    const [[sales]]=await db.execute(`
      SELECT COUNT(*) AS orders,
             COALESCE(SUM(o.grand_total),0) AS gross_sales,
             COALESCE(AVG(NULLIF(o.grand_total,0)),0) AS average_ticket,
             COALESCE(SUM(o.shipping_total),0) AS shipping_total,
             COALESCE(SUM(o.discount_total),0) AS discounts
        FROM orders o
       WHERE o.created_at BETWEEN ? AND ? AND ${validOrder}`,[start,end]);

    const [[costs]]=await db.execute(`
      SELECT COALESCE(SUM(oi.quantity*(COALESCE(v.supplier_cost,0)+COALESCE(v.additional_cost,0))),0) AS supplier_cost,
             COALESCE(SUM(oi.line_total),0) AS item_sales
        FROM order_items oi
        JOIN orders o ON o.id=oi.order_id
        LEFT JOIN product_variants v ON v.id=oi.variant_id
       WHERE o.created_at BETWEEN ? AND ? AND ${validOrder}`,[start,end]);

    const [statuses]=await db.execute(`SELECT o.status,COUNT(*) AS orders,COALESCE(SUM(o.grand_total),0) AS total FROM orders o WHERE o.created_at BETWEEN ? AND ? GROUP BY o.status ORDER BY orders DESC`,[start,end]);
    const [daily]=await db.execute(`SELECT DATE(o.created_at) AS day,COUNT(*) AS orders,COALESCE(SUM(o.grand_total),0) AS total FROM orders o WHERE o.created_at BETWEEN ? AND ? AND ${validOrder} GROUP BY DATE(o.created_at) ORDER BY day`,[start,end]);
    const [topProducts]=await db.execute(`
      SELECT p.name,COUNT(*) AS lines,COALESCE(SUM(oi.line_total),0) AS sales
        FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id
       WHERE o.created_at BETWEEN ? AND ? AND ${validOrder}
       GROUP BY p.id,p.name ORDER BY sales DESC LIMIT 12`,[start,end]);
    const [[pricing]]=await db.query(`SELECT COUNT(*) AS variants,SUM(pricing_review_status='review') AS review_count,SUM(pricing_review_status='blocked') AS blocked_count,MAX(supplier_cost+additional_cost) AS max_cost,MAX(public_price) AS max_price FROM product_variants WHERE status='active'`);

    const salesTotal=num(sales.gross_sales);const supplierCost=num(costs.supplier_cost);const grossProfit=salesTotal-supplierCost;
    return {
      period:{from,to},
      note:'Financeiro operacional estimado. Custos são calculados a partir do custo atual da variante e não substituem conciliação contábil ou do gateway.',
      summary:{orders:num(sales.orders),gross_sales:salesTotal,average_ticket:num(sales.average_ticket),shipping_total:num(sales.shipping_total),discounts:num(sales.discounts),supplier_cost:supplierCost,gross_profit:grossProfit,gross_margin_percent:salesTotal>0?(grossProfit/salesTotal)*100:0},
      pricing:{variants:num(pricing.variants),review_count:num(pricing.review_count),blocked_count:num(pricing.blocked_count),max_cost:num(pricing.max_cost),max_price:num(pricing.max_price)},
      statuses:statuses.map(r=>({status:r.status,orders:num(r.orders),total:num(r.total)})),
      daily:daily.map(r=>({day:String(r.day),orders:num(r.orders),total:num(r.total)})),
      top_products:topProducts.map(r=>({name:r.name||'Produto',lines:num(r.lines),sales:num(r.sales)}))
    };
  });
}
