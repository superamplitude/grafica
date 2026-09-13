let token=sessionStorage.getItem('cp-admin-token')||'';
let user=null;
let products=[];
let selectedProduct=null;
let templates=[];
const esc=(v='')=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(url,options={}){
 const response=await fetch(url,{...options,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...options.headers}});
 const data=await response.json().catch(()=>({}));
 if(response.status===401){sessionStorage.removeItem('cp-admin-token');location.href='/admin/';throw new Error('UNAUTHORIZED');}
 if(!response.ok)throw Object.assign(new Error(data.error||`HTTP_${response.status}`),{data,status:response.status});
 return data;
}
function numberOrNull(v){if(v===''||v==null)return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function formatLabel(t){return t.version_label||t.label||String(t.template_type||'').toUpperCase();}
function templateCard(t){const verified=Boolean(t.verified_at&&t.brand_neutral);return `<article class="template-card"><header><div><h4>${esc(formatLabel(t))}</h4><small>${esc(t.template_type)} · ${esc(t.side||'general')}</small></div><span class="template-chip ${verified?'good':'warn'}">${verified?'verificado':'aguardando revisão'}</span></header><div class="template-meta">${t.width_mm&&t.height_mm?`<span class="template-chip">${esc(t.width_mm)}×${esc(t.height_mm)} mm</span>`:''}${t.bleed_mm!=null?`<span class="template-chip">sangria ${esc(t.bleed_mm)} mm</span>`:''}<span class="template-chip">${t.brand_neutral?'neutro':'não verificado'}</span></div><p>${esc(t.original_name||t.external_url||'Arquivo técnico')}</p><div class="template-actions">${t.url?`<a class="action" href="${esc(t.url)}" target="_blank" rel="noopener">Abrir</a>`:''}${!verified?`<button class="action primary" type="button" data-verify-template="${t.id}">Verificar como neutro</button>`:''}</div></article>`;}
function renderProducts(){const host=document.querySelector('#templateProductList');host.innerHTML=products.length?products.map(p=>`<button type="button" data-product-id="${p.id}" class="${Number(selectedProduct?.id)===Number(p.id)?'active':''}"><strong>${esc(p.name)}</strong><small>${esc(p.category_name||'Sem categoria')} · ${esc(p.status)}</small></button>`).join(''):'<div class="empty-template">Nenhum produto.</div>';host.querySelectorAll('[data-product-id]').forEach(b=>b.onclick=()=>openProduct(Number(b.dataset.productId)));}
async function loadProducts(q=''){const params=new URLSearchParams();if(q)params.set('q',q);const d=await api(`/api/v1/admin/products?${params}`);products=d.items||[];renderProducts();}
async function openProduct(id){const found=products.find(p=>Number(p.id)===Number(id));if(!found)return;selectedProduct=found;renderProducts();document.querySelector('#templateWorkspace').hidden=false;document.querySelector('#templateProductTitle').textContent=found.name;document.querySelector('#templateProductMeta').textContent=[found.category_name,found.status,found.slug].filter(Boolean).join(' · ');const link=document.querySelector('#templatePublicLink');link.href=`/produto.html?slug=${encodeURIComponent(found.slug)}`;await loadTemplates();}
async function loadTemplates(){if(!selectedProduct)return;const d=await api(`/api/v1/admin/catalog/products/${selectedProduct.id}/templates`);templates=d.items||[];document.querySelector('#templateList').innerHTML=templates.length?templates.map(templateCard).join(''):'<div class="empty-template">Nenhum gabarito cadastrado. Adicione as versões técnicas disponíveis para este produto.</div>';}

function syncSourceFields(){const isCanva=document.querySelector('#templateType').value==='canva';document.querySelector('#templateFileWrap').hidden=isCanva;document.querySelector('#templateCanvaWrap').hidden=!isCanva;if(isCanva)document.querySelector('#templateFile').value='';else document.querySelector('#templateCanvaUrl').value='';}

async function uploadTemplateFile(file){
 const intent=await api('/api/v1/admin/media/upload-intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'template',filename:file.name,contentType:file.type||'application/octet-stream',sizeBytes:file.size,visibility:'public'})});
 const put=await fetch(intent.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream','x-amz-meta-cp-kind':'template','x-amz-meta-cp-visibility':'public'},body:file});
 if(!put.ok)throw new Error(`UPLOAD_HTTP_${put.status}`);
 const confirmed=await api('/api/v1/admin/media/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'template',key:intent.key,originalName:file.name,visibility:'public',metadata:{source:'admin-gabaritos'}})});
 return Number(confirmed.media?.id||confirmed.insertId);
}

async function createTemplate(event){
 event.preventDefault();if(!selectedProduct)return;
 const msg=document.querySelector('#templateCreateMessage');msg.textContent='Preparando…';const type=document.querySelector('#templateType').value;
 try{
  let mediaId=null,externalUrl=null;
  if(type==='canva'){externalUrl=document.querySelector('#templateCanvaUrl').value.trim();if(!externalUrl)throw new Error('Informe o link do Canva.');}
  else{const file=document.querySelector('#templateFile').files?.[0];if(!file)throw new Error('Selecione o arquivo técnico.');msg.textContent='Enviando arquivo…';mediaId=await uploadTemplateFile(file);if(!mediaId)throw new Error('Falha ao registrar o arquivo.');}
  const body={media_id:mediaId,external_url:externalUrl,template_type:type,version_label:document.querySelector('#templateVersion').value.trim()||null,side:document.querySelector('#templateSide').value,width_mm:numberOrNull(document.querySelector('#templateWidth').value),height_mm:numberOrNull(document.querySelector('#templateHeight').value),bleed_mm:numberOrNull(document.querySelector('#templateBleed').value),status:'active'};
  msg.textContent='Registrando gabarito…';await api(`/api/v1/admin/catalog/products/${selectedProduct.id}/templates`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});event.currentTarget.reset();document.querySelector('#templateType').value='pdf';syncSourceFields();msg.textContent='Gabarito adicionado. Revise antes de verificar.';await loadTemplates();
 }catch(error){msg.textContent=`Falha: ${error.message}`;}
}

async function verifyTemplate(id){
 const t=templates.find(x=>Number(x.id)===Number(id));if(!t)return;
 const ok=confirm(`Confirma que o gabarito "${formatLabel(t)}" foi aberto e revisado, está com medidas corretas e NÃO contém logomarca, nome, URL, código ou identificação do fornecedor?`);if(!ok)return;
 try{await api(`/api/v1/admin/catalog/templates/${id}/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brand_neutral:true,approved:true,note:'Revisado manualmente no painel de gabaritos.'})});await loadTemplates();}catch(error){alert(`Falha: ${error.message}`);}
}

document.querySelector('#templateType').addEventListener('change',syncSourceFields);
document.querySelector('#templateCreateForm').addEventListener('submit',createTemplate);
document.querySelector('#templateProductSearch').addEventListener('input',e=>{clearTimeout(window.__templateSearch);window.__templateSearch=setTimeout(()=>loadProducts(e.target.value.trim()),250);});
document.addEventListener('click',e=>{const b=e.target.closest('[data-verify-template]');if(b)verifyTemplate(Number(b.dataset.verifyTemplate));});

async function bootstrap(){if(!token){location.href='/admin/';return;}try{const d=await api('/api/v1/admin/auth/me');user=d.user;document.querySelector('#templateUser').textContent=user.name||user.email;document.querySelector('#templateRole').textContent=user.role;await loadProducts();}catch{location.href='/admin/';}}
syncSourceFields();
await bootstrap();
