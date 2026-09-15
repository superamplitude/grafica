import { getDb } from '../lib/db.js';
import { renderProductPreviewSvg, renderVariantGabaritoSvg } from '../domain/generated-assets.js';

function svgReply(reply,svg,fileName,download=false){
  reply.header('Content-Type','image/svg+xml; charset=utf-8');
  reply.header('Cache-Control','public, max-age=3600, must-revalidate');
  reply.header('X-Content-Type-Options','nosniff');
  if(download) reply.header('Content-Disposition',`attachment; filename="${String(fileName||'gabarito.svg').replace(/[^a-zA-Z0-9._-]+/g,'-')}"`);
  return reply.send(svg);
}

export async function registerGeneratedAssetRoutes(app){
  app.get('/api/v1/products/:slug/preview.svg',async(request,reply)=>{
    const db=getDb();
    const slug=String(request.params.slug||'').trim();
    const [rows]=await db.execute(`SELECT p.name,p.short_description,c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug=? AND p.status='active' LIMIT 1`,[slug]);
    if(!rows[0]) return reply.code(404).send({error:'PRODUCT_NOT_FOUND'});
    return svgReply(reply,renderProductPreviewSvg({name:rows[0].name,category:rows[0].category_name,shortDescription:rows[0].short_description}),`${slug}-preview.svg`);
  });

  app.get('/api/v1/gabaritos/:code.svg',async(request,reply)=>{
    const db=getDb();
    const code=String(request.params.code||'').trim();
    const [rows]=await db.execute(`SELECT v.external_code,v.sku,v.size_label,v.print_configuration,p.name AS product_name FROM product_variants v JOIN products p ON p.id=v.product_id AND p.status='active' WHERE (v.external_code=? OR v.sku=?) AND v.status='active' LIMIT 1`,[code,code]);
    const row=rows[0];
    if(!row) return reply.code(404).send({error:'VARIANT_NOT_FOUND'});
    const resolved=String(row.external_code||row.sku||code);
    const svg=renderVariantGabaritoSvg({code:resolved,productName:row.product_name,sizeLabel:row.size_label,printConfiguration:row.print_configuration});
    return svgReply(reply,svg,`gabarito-${resolved}.svg`,String(request.query?.download||'')==='1');
  });

  app.get('/api/v1/products/:slug/generated-gabaritos',async(request,reply)=>{
    const db=getDb();
    const slug=String(request.params.slug||'').trim();
    const [products]=await db.execute(`SELECT id,name,slug FROM products WHERE slug=? AND status='active' LIMIT 1`,[slug]);
    if(!products[0]) return reply.code(404).send({error:'PRODUCT_NOT_FOUND'});
    const [rows]=await db.execute(`SELECT id,external_code,sku,size_label,print_configuration,quantity,production_days FROM product_variants WHERE product_id=? AND status='active' AND availability<>'unavailable' ORDER BY size_label,print_configuration,quantity,id`,[products[0].id]);
    const seen=new Set();
    const items=[];
    for(const row of rows){
      const key=`${String(row.size_label||'')}\u0000${String(row.print_configuration||'')}`;
      if(seen.has(key)) continue;
      seen.add(key);
      const code=String(row.external_code||row.sku||row.id);
      const path=`/api/v1/gabaritos/${encodeURIComponent(code)}.svg`;
      items.push({
        code,
        template_type:'svg',
        label:'SVG técnico gerado',
        side:'general',
        size_label:row.size_label||null,
        print_configuration:row.print_configuration||null,
        url:path,
        download_url:`${path}?download=1`,
        source:'supplier_price_table',
        note:'Dimensão final conforme tabela importada; sangria e área segura não são presumidas.'
      });
    }
    return {product:{id:Number(products[0].id),name:products[0].name,slug:products[0].slug},items,total:items.length};
  });
}
