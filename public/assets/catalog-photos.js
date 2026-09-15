const R2_PUBLIC_BASE='https://arquivos.belastock.com.br';
const COVER_EXTENSIONS=['webp','jpg','jpeg','png'];

function cleanSlug(value=''){
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');
}

export function productCoverCandidates(item={}){
  const slug=cleanSlug(item.slug);
  if(!slug)return [];
  return COVER_EXTENSIONS.map(ext=>`${R2_PUBLIC_BASE}/products/photos/${encodeURIComponent(slug)}/cover.${ext}`);
}

export function catalogPhoto(item={}){
  return productCoverCandidates(item)[0]||'';
}

function isTechnical(url=''){
  const value=String(url||'');
  return value.includes('/preview.svg')||value.endsWith('.svg');
}

export function preferredProductImage(item={}){
  const primary=item.cover_url||item.image_url||'';
  if(primary&&!isTechnical(primary)&&item.image_type!=='technical_preview')return primary;
  return catalogPhoto(item)||primary||item.technical_preview_url||'';
}

function r2CoverVariants(current=''){
  try{
    const url=new URL(current,location.origin);
    if(url.origin!==new URL(R2_PUBLIC_BASE).origin)return [];
    const match=url.pathname.match(/^(\/products\/photos\/[^/]+\/cover)\.(webp|jpe?g|png)$/i);
    if(!match)return [];
    return COVER_EXTENSIONS.map(ext=>`${R2_PUBLIC_BASE}${match[1]}.${ext}`);
  }catch{return [];}
}

function sameUrl(a,b){
  try{return new URL(a,location.origin).href===new URL(b,location.origin).href;}catch{return a===b;}
}

export function wireImageFallbacks(root=document){
  for(const image of root.querySelectorAll('img[data-catalog-photo]')){
    if(image.dataset.fallbackWired==='1')continue;
    image.dataset.fallbackWired='1';
    image.dataset.r2Attempt='0';
    image.addEventListener('error',()=>{
      const variants=r2CoverVariants(image.src);
      if(variants.length){
        const currentIndex=variants.findIndex(url=>sameUrl(url,image.src));
        const nextIndex=currentIndex>=0?currentIndex+1:Number(image.dataset.r2Attempt||0);
        if(nextIndex<variants.length){
          image.dataset.r2Attempt=String(nextIndex+1);
          image.src=variants[nextIndex];
          return;
        }
      }
      const fallback=image.dataset.fallback;
      if(fallback&&image.dataset.technicalFallbackUsed!=='1'&&!sameUrl(image.src,fallback)){
        image.dataset.technicalFallbackUsed='1';
        image.src=fallback;
        return;
      }
      image.closest('.product-image,.main-visual-wrap')?.classList.add('image-load-failed');
    });
  }
}
