import { getDb } from '../lib/db.js';
import { publicObjectUrl } from '../lib/storage.js';

function asJson(value) {
  if (value == null || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function withPublicUrl(row, keyField = 'object_key', targetField = 'url') {
  return { ...row, [targetField]: row?.[keyField] ? publicObjectUrl(row[keyField]) : null };
}

async function productPayloadBySlug(slug) {
  const db = getDb();
  const [products] = await db.execute(`
    SELECT p.id,p.name,p.slug,p.short_description,p.description,p.base_price,p.requires_artwork,
           p.supports_front,p.supports_back,p.config_json,p.seo_json,p.featured,
           c.id AS category_id,c.name AS category_name,c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON c.id=p.category_id
     WHERE p.slug=? AND p.status='active'
     LIMIT 1
  `, [slug]);
  const product = products[0];
  if (!product) return null;

  const [variants] = await db.execute(`
    SELECT id,sku,external_code,name,public_price,quantity,size_label,print_configuration,
           production_days,availability,attributes_json,production_json
      FROM product_variants
     WHERE product_id=? AND status='active'
     ORDER BY public_price ASC,id ASC
  `, [product.id]);

  const [mediaRows] = await db.execute(`
    SELECT pm.role,pm.sort_order,m.kind,m.object_key,m.original_name,m.mime_type,m.metadata_json
      FROM product_media pm
      JOIN media_objects m ON m.id=pm.media_id AND m.visibility='public'
      JOIN media_asset_reviews r ON r.media_id=m.id
       AND r.usage_type='product' AND r.photo_type='real' AND r.supplier_branding='clear'
       AND r.license_status IN ('owned','licensed') AND r.review_status='approved'
     WHERE pm.product_id=?
     ORDER BY FIELD(pm.role,'cover','gallery','mockup','technical'),pm.sort_order,pm.id
  `, [product.id]);

  const [templates] = await db.execute(`
    SELECT pt.id,pt.template_type,pt.version_label,pt.side,pt.width_mm,pt.height_mm,pt.bleed_mm,
           pt.external_url,m.object_key,m.original_name,m.mime_type
      FROM product_templates pt
      LEFT JOIN media_objects m ON m.id=pt.media_id AND m.visibility='public' AND m.kind='template'
     WHERE pt.product_id=? AND pt.status='active' AND pt.brand_neutral=1 AND pt.verified_at IS NOT NULL
       AND ((pt.media_id IS NOT NULL AND m.id IS NOT NULL) OR (pt.template_type='canva' AND pt.external_url LIKE 'https://%'))
     ORDER BY FIELD(pt.side,'front','back','duplex','general'),FIELD(pt.template_type,'pdf','ai','cdr','psd','indd','canva','svg','eps','other'),pt.id
  `, [product.id]);

  return {
    ...product,
    base_price: Number(product.base_price || 0),
    config_json: asJson(product.config_json),
    seo_json: asJson(product.seo_json),
    variants: variants.map((row) => ({
      ...row,
      public_price: Number(row.public_price || 0),
      quantity: Number(row.quantity || 0),
      attributes_json: asJson(row.attributes_json),
      production_json: asJson(row.production_json)
    })),
    media: mediaRows.map((row) => ({ ...withPublicUrl(row), metadata_json: asJson(row.metadata_json) })),
    templates: templates.map((row) => ({ ...row, url: row.object_key ? publicObjectUrl(row.object_key) : row.external_url }))
  };
}

export async function registerPublicRoutes(app) {
  app.get('/api/v1/categories', async () => {
    const db = getDb();
    const [rows] = await db.query(`
      SELECT c.id,c.parent_id,c.name,c.slug,c.description,c.sort_order,
             (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.status='active') AS product_count
        FROM categories c
       WHERE c.status='active'
       ORDER BY c.sort_order,c.name
    `);
    return { items: rows.map((row) => ({ ...row, product_count: Number(row.product_count || 0) })) };
  });

  app.get('/api/v1/catalog/summary', async () => {
    const db = getDb();
    const [rows] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE status='active') AS products,
        (SELECT COUNT(*) FROM categories WHERE status='active') AS categories,
        (SELECT COUNT(*) FROM product_variants WHERE status='active' AND availability<>'unavailable') AS variants,
        (SELECT MIN(public_price) FROM product_variants WHERE status='active' AND availability<>'unavailable' AND public_price>0) AS min_price,
        (SELECT MAX(public_price) FROM product_variants WHERE status='active' AND availability<>'unavailable' AND public_price>0) AS max_price
    `);
    const row = rows[0] || {};
    return {
      products: Number(row.products || 0),
      categories: Number(row.categories || 0),
      variants: Number(row.variants || 0),
      min_price: row.min_price == null ? null : Number(row.min_price),
      max_price: row.max_price == null ? null : Number(row.max_price)
    };
  });

  app.get('/api/v1/products', async (request) => {
    const db = getDb();
    const category = String(request.query?.category || '').trim();
    const q = String(request.query?.q || '').trim().slice(0, 160);
    const featured = String(request.query?.featured || '') === '1';
    const sort = String(request.query?.sort || 'featured').trim();
    const limit = Math.min(60, Math.max(1, Number(request.query?.limit || 24) || 24));
    const offset = Math.max(0, Number(request.query?.offset || 0) || 0);
    const where = ["p.status='active'"];
    const params = [];

    if (category) { where.push('c.slug=?'); params.push(category); }
    if (featured) where.push('p.featured=1');
    if (q) {
      where.push('(p.name LIKE ? OR p.short_description LIKE ? OR p.description LIKE ? OR p.sku LIKE ?)');
      const like = `%${q}%`; params.push(like, like, like, like);
    }

    const orderBy = {
      featured: 'p.featured DESC,p.sort_order ASC,p.name ASC',
      name: 'p.name ASC,p.id ASC',
      'price-asc': 'starting_price ASC,p.name ASC',
      'price-desc': 'starting_price DESC,p.name ASC',
      newest: 'p.created_at DESC,p.id DESC'
    }[sort] || 'p.featured DESC,p.sort_order ASC,p.name ASC';

    const [countRows] = await db.execute(`
      SELECT COUNT(*) AS total
        FROM products p
        LEFT JOIN categories c ON c.id=p.category_id
       WHERE ${where.join(' AND ')}
    `, params);

    const [rows] = await db.execute(`
      SELECT p.id,p.name,p.slug,p.short_description,p.base_price,p.featured,p.requires_artwork,
             c.name AS category_name,c.slug AS category_slug,
             COALESCE((SELECT MIN(NULLIF(v.public_price,0)) FROM product_variants v
                        WHERE v.product_id=p.id AND v.status='active' AND v.availability<>'unavailable'),p.base_price) AS starting_price,
             (SELECT COUNT(*) FROM product_variants v2
                WHERE v2.product_id=p.id AND v2.status='active' AND v2.availability<>'unavailable') AS variants_count,
             (SELECT m.object_key
                FROM product_media pm
                JOIN media_objects m ON m.id=pm.media_id AND m.visibility='public'
                JOIN media_asset_reviews r ON r.media_id=m.id
                 AND r.usage_type='product' AND r.photo_type='real' AND r.supplier_branding='clear'
                 AND r.license_status IN ('owned','licensed') AND r.review_status='approved'
               WHERE pm.product_id=p.id AND pm.role='cover'
               ORDER BY pm.sort_order,pm.id LIMIT 1) AS cover_key
        FROM products p
        LEFT JOIN categories c ON c.id=p.category_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const total = Number(countRows[0]?.total || 0);
    return {
      items: rows.map((row) => ({
        ...row,
        base_price: Number(row.base_price || 0),
        starting_price: Number(row.starting_price || 0),
        variants_count: Number(row.variants_count || 0),
        cover_url: row.cover_key ? publicObjectUrl(row.cover_key) : null
      })),
      total,
      limit,
      offset,
      has_more: offset + rows.length < total
    };
  });

  app.get('/api/v1/products/:slug', async (request, reply) => {
    const product = await productPayloadBySlug(String(request.params.slug));
    if (!product) return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND' });
    return product;
  });

  app.get('/api/v1/configurator/:slug', async (request, reply) => {
    const product = await productPayloadBySlug(String(request.params.slug));
    if (!product) return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND' });
    return {
      product: {
        id: product.id,
        name: product.name,
        slug: product.slug,
        category_name: product.category_name,
        category_slug: product.category_slug,
        short_description: product.short_description,
        description: product.description,
        requires_artwork: product.requires_artwork,
        supports_front: product.supports_front,
        supports_back: product.supports_back,
        config: product.config_json
      },
      variants: product.variants.filter((variant) => variant.availability !== 'unavailable'),
      visuals: product.media.filter((item) => item.role !== 'technical'),
      templates: product.templates
    };
  });

  app.get('/api/v1/price/:code', async (request, reply) => {
    const db = getDb();
    const code = String(request.params.code || '').trim();
    const [rows] = await db.execute(`
      SELECT sku,external_code,name,public_price,quantity,size_label,print_configuration,production_days,availability
        FROM product_variants
       WHERE (external_code=? OR sku=?) AND status='active'
       ORDER BY id LIMIT 1
    `, [code, code]);
    const variant = rows[0];
    if (!variant || variant.availability === 'unavailable') {
      return reply.code(404).send({ error: 'PRODUCT_UNAVAILABLE' });
    }
    return {
      code: variant.external_code || variant.sku,
      description: variant.name,
      print: variant.print_configuration,
      quantity: Number(variant.quantity || 0),
      size: variant.size_label,
      production_days: variant.production_days,
      price: Number(variant.public_price || 0),
      currency: 'BRL'
    };
  });

  app.get('/api/v1/site/home', async () => {
    const db = getDb();
    const [blocks] = await db.query(`SELECT block_key,block_type,title,content_json FROM content_blocks WHERE status='active' ORDER BY id`);
    const [banners] = await db.query(`
      SELECT b.id,b.name,b.placement,b.eyebrow,b.title,b.body,b.cta_label,b.cta_url,b.sort_order,
             dm.object_key AS desktop_key,mm.object_key AS mobile_key
        FROM banners b
        LEFT JOIN media_objects dm ON dm.id=b.desktop_media_id AND dm.visibility='public'
        LEFT JOIN media_objects mm ON mm.id=b.mobile_media_id AND mm.visibility='public'
       WHERE b.status='active' AND (b.starts_at IS NULL OR b.starts_at<=NOW()) AND (b.ends_at IS NULL OR b.ends_at>=NOW())
       ORDER BY b.placement,b.sort_order,b.id
    `);
    return {
      blocks: Object.fromEntries(blocks.map((row) => [row.block_key, { type: row.block_type, title: row.title, content: asJson(row.content_json) }])),
      banners: banners.map((row) => ({
        ...row,
        desktop_url: row.desktop_key ? publicObjectUrl(row.desktop_key) : null,
        mobile_url: row.mobile_key ? publicObjectUrl(row.mobile_key) : null
      }))
    };
  });
}
