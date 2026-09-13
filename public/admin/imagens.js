let token=sessionStorage.getItem('cp-admin-token')||'';
let user=null;
let products=[];
let selectedProduct=null;
let images=[];
const esc=(v='')=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...options.headers}});
  const data=await response.json().catch(()=>({}));
  if(response.status===401){sessionStorage.removeItem('cp-admin-token');location.href='/admin/';throw new Error('UNAUTHORIZED');}
  if(!response.ok)throw Object.assign(new Error(data.error||`HTTP_${response.status}`),{data,status:response.status});
  return data;
}

function reviewLabel(item){
  const r=item.review;
  if(!r)return '<span class="image-chip warn">aguardando auditoria</span>';
  if(r.status==='approved')return '<span class="image-chip good">aprovada</span>';
  if(r.status==='rejected')return '<span class="image-chip bad">rejeitada</span>';
  return '<span class="image-chip warn">pendente</span>';
}
function safetyLabel(item){
  const r=item.review;
  if(!r)return 'Ainda não revisada.';
  if(r.status==='approved'&&r.photo_type==='real'&&r.supplier_branding==='clear'&&['owned','licensed'].includes(r.license_status))return 'Foto real liberada para exibição pública.';
  return ['Tipo: '+(r.photo_type||'—'),'Marca fornecedor: '+(r.supplier_branding||'—'),'Direito de uso: '+(r.license_status||'—')].join(' · ');
}
function imageCard(item){
  const preview=item.url?`<img src="${esc(item.url)}" alt="${esc(item.original_name||'Foto do produto')}" loading="lazy">`:'<div class="image-no-preview">Prévia depende da URL pública do R2</div>';
  return `<article class="product-image-card" data-link-id="${item.link_id}"><div class="product-image-preview">${preview}</div><div class="product-image-info"><header><strong>${item.role==='cover'?'Capa':'Galeria'}</strong>${reviewLabel(item)}</header><p>${esc(item.original_name||'Imagem')}</p><small>${esc(safetyLabel(item))}</small><div class="image-actions">${item.role!=='cover'?`<button class="action" type="button" data-make-cover="${item.link_id}">Usar como capa</button>`:''}<button class="action danger-action" type="button" data-remove-image="${item.link_id}">Desvincular</button></div></div></article>`;
}
function renderImages(){document.querySelector('#productImageGrid').innerHTML=images.length?images.map(imageCard).join(''):'<div class="images-empty">Nenhuma foto vinculada.</div>';}
function renderProducts(){const host=document.querySelector('#imagesProductList');host.innerHTML=products.length?products.map(p=>`<button type="button" data-product-id="${p.id}" class="${Number(selectedProduct?.id)===Number(p.id)?'active':''}"><strong>${esc(p.name)}</strong><small>${esc(p.category_name||'Sem categoria')} · ${esc(p.status)}</small></button>`).join(''):'<div class="images-empty">Nenhum produto.</div>';host.querySelectorAll('[data-product-id]').forEach(b=>b.onclick=()=>openProduct(Number(b.dataset.productId)));}
async function loadProducts(q=''){const params=new URLSearchParams();if(q)params.set('q',q);const d=await api(`/api/v1/admin/products?${params}`);products=d.items||[];renderProducts();}
async function openProduct(id){const found=products.find(p=>Number(p.id)===Number(id));if(!found)return;selectedProduct=found;renderProducts();document.querySelector('#imagesWorkspace').hidden=false;document.querySelector('#imagesProductTitle').textContent=found.name;document.querySelector('#imagesProductMeta').textContent=[found.category_name,found.status,found.slug].filter(Boolean).join(' · ');document.querySelector('#imagesPublicLink').href=`/produto.html?slug=${encodeURIComponent(found.slug)}`;await loadImages();}
async function loadImages(){if(!selectedProduct)return;const d=await api(`/api/v1/admin/catalog/products/${selectedProduct.id}/media`);images=d.items||[];renderImages();}

async function uploadPhoto(file){
  const contentType=file.type||'application/octet-stream';
  const intent=await api('/api/v1/admin/media/upload-intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'product-photo',filename:file.name,contentType,sizeBytes:file.size,visibility:'public'})});
  const put=await fetch(intent.uploadUrl,{method:'PUT',headers:{'Content-Type':contentType,'x-amz-meta-cp-kind':'product-photo','x-amz-meta-cp-visibility':'public'},body:file});
  if(!put.ok)throw new Error(`UPLOAD_HTTP_${put.status}`);
  const confirmed=await api('/api/v1/admin/media/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'product-photo',key:intent.key,originalName:file.name,visibility:'public',metadata:{source:'admin-imagens',declared_usage:'real-product-photo'}})});
  return Number(confirmed.media?.id||confirmed.insertId);
}

async function uploadAndAttach(event){
  event.preventDefault();if(!selectedProduct)return;
  const msg=document.querySelector('#imageUploadMessage');const file=document.querySelector('#productImageFile').files?.[0];
  if(!file){msg.textContent='Selecione uma foto.';return;}
  msg.textContent='Enviando para o armazenamento…';
  try{
    const mediaId=await uploadPhoto(file);if(!mediaId)throw new Error('MEDIA_CONFIRM_FAILED');
    msg.textContent='Vinculando ao produto…';
    await api(`/api/v1/admin/catalog/products/${selectedProduct.id}/media`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({media_id:mediaId,role:document.querySelector('#productImageRole').value,sort_order:Number(document.querySelector('#productImageOrder').value||0)})});
    event.currentTarget.reset();document.querySelector('#productImageOrder').value='0';msg.textContent='Foto vinculada. Ela continua invisível no catálogo até ser aprovada na auditoria.';await loadImages();
  }catch(error){msg.textContent=`Falha: ${error.message}`;}
}

async function makeCover(linkId){
  const item=images.find(x=>Number(x.link_id)===Number(linkId));if(!item||!selectedProduct)return;
  try{await api(`/api/v1/admin/catalog/products/${selectedProduct.id}/media`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({media_id:item.media_id,role:'cover',sort_order:0})});await loadImages();}catch(error){alert(`Falha: ${error.message}`);}
}
async function removeImage(linkId){if(!selectedProduct||!confirm('Desvincular esta foto do produto? O arquivo continuará preservado no armazenamento e na auditoria.'))return;try{await api(`/api/v1/admin/catalog/products/${selectedProduct.id}/media/${linkId}`,{method:'DELETE'});await loadImages();}catch(error){alert(`Falha: ${error.message}`);}}

document.querySelector('#imageUploadForm').addEventListener('submit',uploadAndAttach);
document.querySelector('#imagesProductSearch').addEventListener('input',e=>{clearTimeout(window.__imageSearch);window.__imageSearch=setTimeout(()=>loadProducts(e.target.value.trim()),250);});
document.addEventListener('click',e=>{const cover=e.target.closest('[data-make-cover]');if(cover)makeCover(Number(cover.dataset.makeCover));const remove=e.target.closest('[data-remove-image]');if(remove)removeImage(Number(remove.dataset.removeImage));});

async function bootstrap(){if(!token){location.href='/admin/';return;}try{const d=await api('/api/v1/admin/auth/me');user=d.user;document.querySelector('#imagesUser').textContent=user.name||user.email;document.querySelector('#imagesRole').textContent=user.role;await loadProducts();}catch{location.href='/admin/';}}
await bootstrap();
