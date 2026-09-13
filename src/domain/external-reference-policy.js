const BRAND_PATTERNS=[/\bzap\b/i,/zapgrafica/i,/atual\s*card/i,/giv\s*online/i,/\bgiv\b/i,/nova\s*logo/i];
const PRICE_PATTERNS=[/\br\$\s*\d/i,/\bpre[cç]o\b/i,/\bpor\s+r\$/i,/\ba\s+partir\s+de\b/i];
const RENDER_EXTENSIONS=new Set(['psd','ai','cdr','eps','svg']);
const TEMPLATE_EXTENSIONS=new Set(['pdf','psd','ai','cdr','eps','svg','indd']);

function extensionOf(title=''){
  const clean=String(title).trim().toLowerCase();
  const i=clean.lastIndexOf('.');
  return i>=0?clean.slice(i+1):'';
}

export function classifyExternalReference(input={}){
  const title=String(input.title||'').trim();
  const mime=String(input.mime_type||'').trim().toLowerCase();
  const sourceType=input.source_type==='folder'?'folder':'file';
  const ext=extensionOf(title);
  const supplierBranding=BRAND_PATTERNS.some((r)=>r.test(title))?'found':'unknown';
  const priceText=PRICE_PATTERNS.some((r)=>r.test(title))?'found':'unknown';
  let usage='reference';
  let photo='unknown';
  if(sourceType==='folder') photo='not_applicable';
  else if(TEMPLATE_EXTENSIONS.has(ext)) { usage='template'; photo=RENDER_EXTENSIONS.has(ext)?'render':'not_applicable'; }
  else if(mime.startsWith('image/')) { usage='product'; photo='unknown'; }
  return {
    usage_hint:usage,
    photo_type_hint:photo,
    supplier_branding_risk:supplierBranding,
    price_text_risk:priceText,
    license_status:'reference_only',
    ingestion_status:'quarantined',
    review_required:1
  };
}

export function canPromoteExternalReference(row={}){
  if(row.ingestion_status!=='reviewed') return {ok:false,error:'REFERENCE_NOT_REVIEWED'};
  if(Number(row.review_required||0)!==0) return {ok:false,error:'REFERENCE_REVIEW_REQUIRED'};
  if(!['owned','licensed'].includes(row.license_status)) return {ok:false,error:'REFERENCE_LICENSE_NOT_APPROVED'};
  if(row.supplier_branding_risk!=='clear') return {ok:false,error:'REFERENCE_SUPPLIER_BRANDING_NOT_CLEAR'};
  if(row.usage_hint==='product' && row.photo_type_hint!=='real') return {ok:false,error:'REFERENCE_PRODUCT_IMAGE_MUST_BE_REAL'};
  if(row.usage_hint==='hero' && row.price_text_risk!=='clear') return {ok:false,error:'REFERENCE_HERO_PRICE_TEXT_NOT_CLEAR'};
  return {ok:true};
}
