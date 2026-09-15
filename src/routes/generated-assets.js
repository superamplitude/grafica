import { getDb } from '../lib/db.js';
import { renderProductPreviewSvg, renderVariantGabaritoSvg } from '../domain/generated-assets.js';
import { renderVariantGabaritoEps, renderVariantGabaritoPdf, renderVariantGabaritoPsd } from '../domain/gabarito-formats.js';

function safeFileName(value='arquivo'){
  return String(value||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'arquivo';
}
function assetReply(reply,body,{contentType,fileName,download=true,cache=true}={}){
  reply.header('Content-Type',contentType||'application/octet-stream');
  reply.header('Cache-Control',cache?'public, max-age=3600, must-revalidate':'no-store');
  reply.header('X-Content-Type-Options','nosniff');
  if(download) reply.header('Content-Disposition',`attachment; filename="${safeFileName(fileName)}"`);
  return reply.send(body);
}
function svgReply(reply,svg,fileName,download=false){
  return assetReply(reply,svg,{contentType:'image/svg+xml; charset=utf-8',fileName,download});
}
async function variantByCode(code){
  const db=getDb();
  const [rows]=await db.execute(`SELECT v.external_code,v.sku,v.size_label,v.print_configuration,p.name AS product_name FROM product_variants v JOIN products p ON p.id=v.product_id AND p.status='active' WHERE (v.external_code=? OR v.sku=?) AND v.status='active' LIMIT 1`,[code,code]);
  const row=rows[0];
  if(!row)return null;
  return {
    code:String(row.external_code||row.sku||code),
    productName:row.product_name,
    sizeLabel:row.size_label,
    printConfiguration:row.print_configuration
  };
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
    const code=String(request.params.code||'').trim();
    const meta=await variantByCode(code);
    if(!meta) return reply.code(404).send({error:'VARIANT_NOT_FOUND'});
    return svgReply(reply,renderVariantGabaritoSvg(meta),`gabarito-${meta.code}.svg`,String(request.query?.download||'')==='1');
  });

  app.get('/api/v1/gabaritos/:code.pdf',async(request,reply)=>{
    const code=String(request.params.code||'').trim();
    const meta=await variantByCode(code);
    if(!meta) return reply.code(404).send({error:'VARIANT_NOT_FOUND'});
    return assetReply(reply,renderVariantGabaritoPdf(meta),{contentType:'application/pdf',fileName:`gabarito-${meta.code}.pdf`});
  });

  app.get('/api/v1/gabaritos/:code.eps',async(request,reply)=>{
    const code=String(request.params.code||'').trim();
    const meta=await variantByCode(code);
    if(!meta) return reply.code(404).send({error:'VARIANT_NOT_FOUND'});
    return assetReply(reply,renderVariantGabaritoEps(meta),{contentType:'application/postscript; charset=us-ascii',fileName:`gabarito-${meta.code}.eps`});
  });

  app.get('/api/v1/gabaritos/:code.psd',async(request,reply)=>{
    const code=String(request.params.code||'').trim();
    const meta=await variantByCode(code);
    if(!meta) return reply.code(404).send({error:'VARIANT_NOT_FOUND'});
    return assetReply(reply,renderVariantGabaritoPsd(meta),{contentType:'image/vnd.adobe.photoshop',fileName:`gabarito-${meta.code}.psd`,cache:false});
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
      const base=`/api/v1/gabaritos/${encodeURIComponent(code)}`;
      const svgPath=`${base}.svg`;
      items.push({
        code,
        template_type:'multi',
        label:'Gabarito editável',
        side:'general',
        size_label:row.size_label||null,
        print_configuration:row.print_configuration||null,
        url:svgPath,
        download_url:`${svgPath}?download=1`,
        formats:[
          {format:'svg',label:'SVG',url:`${svgPath}?download=1`,vector:true,editable:true},
          {format:'pdf',label:'PDF',url:`${base}.pdf`,vector:true,editable:false},
          {format:'eps',label:'EPS',url:`${base}.eps`,vector:true,editable:true},
          {format:'psd',label:'PSD',url:`${base}.psd`,vector:false,editable:true}
        ],
        source:'supplier_price_table',
        note:'Dimensão final conforme tabela importada; sangria e área segura não são presumidas. CDR/AI nativos aparecem apenas quando houver arquivo original homologado.'
      });
    }
    return {product:{id:Number(products[0].id),name:products[0].name,slug:products[0].slug},items,total:items.length};
  });
}
