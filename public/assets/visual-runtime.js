function isTechnicalPreview(src=''){return /\/api\/v1\/products\/[^/]+\/preview\.svg(?:\?|$)/i.test(String(src));}
async function inlineTechnicalImage(img){
  if(!(img instanceof HTMLImageElement)||img.dataset.inlineTechnical==='1')return;
  const src=img.currentSrc||img.getAttribute('src')||'';
  if(!isTechnicalPreview(src))return;
  img.dataset.inlineTechnical='1';
  try{
    const response=await fetch(src,{headers:{Accept:'image/svg+xml'}});
    if(!response.ok)throw new Error(`HTTP_${response.status}`);
    const svg=await response.text();
    if(!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(svg))throw new Error('INVALID_SVG');
    const holder=document.createElement('span');
    holder.className='product-visual-inline runtime-inline';
    holder.setAttribute('role','img');
    holder.setAttribute('aria-label',img.alt||'Imagem ilustrativa do produto');
    holder.innerHTML=svg;
    img.replaceWith(holder);
  }catch{
    img.classList.add('visual-load-error');
    img.alt=img.alt||'Imagem indisponível';
  }
}
function scan(root=document){
  if(root instanceof HTMLImageElement)inlineTechnicalImage(root);
  root.querySelectorAll?.('img[src*="/preview.svg"]').forEach(inlineTechnicalImage);
}
const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)scan(node);});
observer.observe(document.documentElement,{childList:true,subtree:true});
scan(document);
