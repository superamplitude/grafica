import { getDb } from '../lib/db.js';

const SORTS = {
  product: 'p.name ASC,v.quantity ASC,v.public_price ASC,v.id ASC',
  'price-asc': 'v.public_price ASC,p.name ASC,v.quantity ASC,v.id ASC',
  'price-desc': 'v.public_price DESC,p.name ASC,v.quantity ASC,v.id ASC',
  production: 'COALESCE(v.production_days,999999) ASC,p.name ASC,v.public_price ASC,v.id ASC'
};

function parseQuery(query = {}) {
  const q = String(query.q || '').trim().slice(0, 160);
  const category = String(query.category || '').trim().slice(0, 190);
  const availability = String(query.availability || '').trim();
  const sort = SORTS[String(query.sort || 'product')] ? String(query.sort || 'product') : 'product';
  const limit = Math.min(250, Math.max(1, Number(query.limit || 80) || 80));
  const offset = Math.max(0, Number(query.offset || 0) || 0);
  return { q, category, availability, sort, limit, offset };
}

function buildWhere(filters) {
  const where = ["p.status='active'", "v.status='active'", "v.availability<>'unavailable'", 'v.public_price>0'];
  const params = [];
  if (filters.category) { where.push('c.slug=?'); params.push(filters.category); }
  if (['available','on_request'].includes(filters.availability)) { where.push('v.availability=?'); params.push(filters.availability); }
  if (filters.q) {
    const like = `%${filters.q}%`;
    where.push('(p.name LIKE ? OR v.name LIKE ? OR v.sku LIKE ? OR v.external_code LIKE ? OR v.size_label LIKE ? OR v.print_configuration LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  return { where, params };
}

async function loadRows(filters, includePaging = true) {
  const db = getDb();
  const { where, params } = buildWhere(filters);
  const pagingSql = includePaging ? 'LIMIT ? OFFSET ?' : 'LIMIT 5000';
  const pagingParams = includePaging ? [filters.limit, filters.offset] : [];
  const [rows] = await db.execute(`
    SELECT c.name AS category_name,c.slug AS category_slug,
           p.id AS product_id,p.name AS product_name,p.slug AS product_slug,
           v.id AS variant_id,v.sku,v.external_code,v.name AS variant_name,
           v.quantity,v.size_label,v.print_configuration,v.production_days,v.availability,v.public_price
      FROM product_variants v
      JOIN products p ON p.id=v.product_id
      LEFT JOIN categories c ON c.id=p.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${SORTS[filters.sort]}
     ${pagingSql}
  `, [...params, ...pagingParams]);
  return rows.map((row) => ({
    ...row,
    quantity: Number(row.quantity || 0),
    production_days: row.production_days == null ? null : Number(row.production_days),
    public_price: Number(row.public_price || 0),
    currency: 'BRL'
  }));
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function registerPriceTableRoutes(app) {
  app.get('/api/v1/price-table', async (request) => {
    const filters = parseQuery(request.query);
    const db = getDb();
    const { where, params } = buildWhere(filters);
    const [countRows] = await db.execute(`
      SELECT COUNT(*) AS total
        FROM product_variants v
        JOIN products p ON p.id=v.product_id
        LEFT JOIN categories c ON c.id=p.category_id
       WHERE ${where.join(' AND ')}
    `, params);
    const rows = await loadRows(filters, true);
    const total = Number(countRows[0]?.total || 0);
    return {
      items: rows,
      total,
      limit: filters.limit,
      offset: filters.offset,
      has_more: filters.offset + rows.length < total,
      generated_at: new Date().toISOString()
    };
  });

  app.get('/api/v1/price-table.csv', async (request, reply) => {
    const filters = parseQuery(request.query);
    const rows = await loadRows(filters, false);
    const header = ['Categoria','Produto','Opção','Código','Quantidade','Formato','Impressão','Produção (dias)','Disponibilidade','Preço'];
    const lines = [header.map(csvCell).join(';')];
    for (const row of rows) {
      lines.push([
        row.category_name,
        row.product_name,
        row.variant_name,
        row.external_code || row.sku || '',
        row.quantity,
        row.size_label,
        row.print_configuration,
        row.production_days,
        row.availability === 'on_request' ? 'Sob consulta' : 'Disponível',
        row.public_price.toFixed(2).replace('.', ',')
      ].map(csvCell).join(';'));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="central-prints-precos-${stamp}.csv"`)
      .send(`\ufeff${lines.join('\r\n')}\r\n`);
  });
}
