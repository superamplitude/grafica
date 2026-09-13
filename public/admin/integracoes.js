const token=sessionStorage.getItem('cp-admin-token')||'';
const esc=(v='')=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let user=null;
let integrations=[];
let assets=[];
let selectedAsset=null;

async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{Accept:'application/json','Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...options.headers}});
  const data=await response.json().catch(()=>({}));
  if(response.status===401){sessionStorage.removeItem('cp-admin-token');location.href='/admin/';throw new Error('UNAUTHORIZED');}
  if(!response.ok)throw Object.assign(new Error(data.error||`HTTP_${response.status}`),{data,status:response.status});
  return data;
}

function chip(value){
  const cls=['active','verified','approved','clear','owned','licensed'].includes(value)?'good':['blocked','rejected','found'].includes(value)?'bad':'warn';
  return `<span class="chip ${cls}">${esc(value||'—')}</span>`;
}

function integrationCard(row){
  const caps=Array.isArray(row.capabilities)?row.capabilities:[];
  const canVerify=user?.role==='super_admin'&&row.adapter_status==='implemented';
  return `<article class="integration-card" data-integration-id="${row.id}">
    <header><div><h3>${esc(row.display_name)}</h3><small>${esc(row.provider_code)}</small></div>${chip(row.status)}</header>
    <div class="integration-meta">${chip(row.integration_mode)}${chip(row.adapter_status)}${caps.map(c=>`<span class="chip">${esc(c)}</span>`).join('')}</div>
    <label>Status<select data-field="status"><option value="inactive" ${row.status==='inactive'?'selected':''}>Inativo</option><option value="testing" ${row.status==='testing'?'selected':''}>Teste</option><option value="active" ${row.status==='active'?'selected':''}>Ativo</option><option value="blocked" ${row.status==='blocked'?'selected':''}>Bloqueado</option></select></label>
    <label>Observações<textarea data-field="notes" rows="3">${esc(row.notes||'')}</textarea></label>
    <div class="integration-actions"><button class="action primary" type="button" data-save-integration="${row.id}">Salvar</button>${canVerify?`<button class="action" type="button" data-verify-integration="${row.id}">Homologar</button>`:''}${row.verified_at?`<small>Verificado: ${new Date(row.verified_at).toLocaleString('pt-BR')}</small>`:''}</div>
    <div class="integration-note">Segredos esperados no ambiente: ${esc((row.secret_env||[]).join(', ')||'nenhum')}. As chaves nunca são exibidas neste painel.</div>
  </article>`;
}

function renderIntegrations(){
  const payment=integrations.filter(i=>i.integration_type==='payment');
  const shipping=integrations.filter(i=>i.integration_type==='shipping');
  document.querySelector('#paymentIntegrations').innerHTML=payment.length?payment.map(integrationCard).join(''):'<div class="empty-state">Nenhum gateway cadastrado.</div>';
  document.querySelector('#shippingIntegrations').innerHTML=shipping.length?shipping.map(integrationCard).join(''):'<div class="empty-state">Nenhuma transportadora cadastrada.</div>';
}

async function loadIntegrations(){
  const data=await api('/api/v1/admin/commerce/integrations');
  integrations=data.items||[];
  renderIntegrations();
}

async function saveIntegration(id){
  const card=document.querySelector(`[data-integration-id="${id}"]`);
  const status=card.querySelector('[data-field="status"]').value;
  const notes=card.querySelector('[data-field="notes"]').value.trim();
  try{await api(`/api/v1/admin/commerce/integrations/${id}`,{method:'PATCH',body:JSON.stringify({status,notes})});await loadIntegrations();}
  catch(error){alert(error.message==='INTEGRATION_NOT_VERIFIED'?'Só pode ativar depois de implementar e homologar a integração.':`Falha: ${error.message}`);}
}

async function verifyIntegration(id){
  const row=integrations.find(i=>Number(i.id)===Number(id));
  if(!row)return;
  const note=prompt(`Registrar homologação real de ${row.display_name}. Informe uma observação do teste:`,'Cotação/transação controlada validada.');
  if(note===null)return;
  try{await api(`/api/v1/admin/commerce/integrations/${id}/verification`,{method:'POST',body:JSON.stringify({result:'verified',note})});await loadIntegrations();}
  catch(error){alert(`Não foi possível homologar: ${error.message}`);}
}

function assetCard(row){
  const review=row.review_status||'unreviewed';
  return `<article class="asset-card"><button type="button" data-open-asset="${row.id}"><div class="asset-thumb">${row.url?`<img src="${esc(row.url)}" alt="">`:''}</div><div class="asset-body"><strong>${esc(row.original_name||`Ativo #${row.id}`)}</strong><small>${esc(row.kind)} · ${esc(review)}</small><div class="integration-meta">${chip(review)}${row.supplier_branding?chip(row.supplier_branding):''}${row.license_status?chip(row.license_status):''}</div></div></button></article>`;
}

async function loadAssets(){
  const q=new URLSearchParams();
  const kind=document.querySelector('#assetKind').value;
  const status=document.querySelector('#assetStatus').value;
  if(kind)q.set('kind',kind);if(status)q.set('status',status);
  const data=await api(`/api/v1/admin/assets/candidates${q.size?`?${q}`:''}`);
  assets=data.items||[];
  document.querySelector('#assetGrid').innerHTML=assets.length?assets.map(assetCard).join(''):'<div class="empty-state">Nenhum ativo para este filtro.</div>';
}

function defaultReview(row){
  if(row.kind==='product-photo')return{usage_type:'product',photo_type:'real',supplier_branding:'unknown',price_text:'clear',license_status:'unknown',review_status:'pending',notes:''};
  if(row.kind==='banner')return{usage_type:'hero',photo_type:'not_applicable',supplier_branding:'unknown',price_text:'unknown',license_status:'unknown',review_status:'pending',notes:''};
  if(row.kind==='template')return{usage_type:'template',photo_type:'not_applicable',supplier_branding:'unknown',price_text:'clear',license_status:'unknown',review_status:'pending',notes:''};
  return{usage_type:'other',photo_type:'unknown',supplier_branding:'unknown',price_text:'unknown',license_status:'unknown',review_status:'pending',notes:''};
}

async function openAsset(id){
  const row=assets.find(a=>Number(a.id)===Number(id));if(!row)return;
  const data=await api(`/api/v1/admin/media/${id}/review`);
  selectedAsset=data.media;
  const review={...defaultReview(row),...(data.review||{})};
  document.querySelector('#assetId').value=String(id);
  document.querySelector('#assetPreview').src=data.media.url||row.url||'';
  document.querySelector('#assetTitle').textContent=data.media.original_name||`Ativo #${id}`;
  document.querySelector('#assetUsage').value=review.usage_type;
  document.querySelector('#assetPhotoType').value=review.photo_type;
  document.querySelector('#assetBrand').value=review.supplier_branding;
  document.querySelector('#assetPriceText').value=review.price_text;
  document.querySelector('#assetLicense').value=review.license_status;
  document.querySelector('#assetReviewStatus').value=review.review_status;
  document.querySelector('#assetNotes').value=review.notes||'';
  document.querySelector('#assetMessage').textContent='';
  document.querySelector('#assetDialog').showModal();
}

async function saveAssetReview(){
  const id=Number(document.querySelector('#assetId').value);
  const body={usage_type:document.querySelector('#assetUsage').value,photo_type:document.querySelector('#assetPhotoType').value,supplier_branding:document.querySelector('#assetBrand').value,price_text:document.querySelector('#assetPriceText').value,license_status:document.querySelector('#assetLicense').value,review_status:document.querySelector('#assetReviewStatus').value,notes:document.querySelector('#assetNotes').value.trim()||null};
  const message=document.querySelector('#assetMessage');message.textContent='Salvando…';
  try{await api(`/api/v1/admin/media/${id}/review`,{method:'PUT',body:JSON.stringify(body)});message.textContent='Revisão salva.';setTimeout(()=>document.querySelector('#assetDialog').close(),350);await loadAssets();}
  catch(error){message.textContent=`Erro: ${error.message}`;}
}

document.addEventListener('click',event=>{
  const save=event.target.closest('[data-save-integration]');if(save)saveIntegration(save.dataset.saveIntegration);
  const verify=event.target.closest('[data-verify-integration]');if(verify)verifyIntegration(verify.dataset.verifyIntegration);
  const asset=event.target.closest('[data-open-asset]');if(asset)openAsset(asset.dataset.openAsset);
});
document.querySelector('#reloadCommerce').addEventListener('click',loadIntegrations);
document.querySelector('#reloadAssets').addEventListener('click',loadAssets);
document.querySelector('#assetKind').addEventListener('change',loadAssets);
document.querySelector('#assetStatus').addEventListener('change',loadAssets);
document.querySelector('#saveAssetReview').addEventListener('click',saveAssetReview);

try{
  if(!token)throw new Error('NO_TOKEN');
  const me=await api('/api/v1/admin/auth/me');user=me.user;
  document.querySelector('#integrationUser').textContent=user.name||user.email;
  document.querySelector('#integrationRole').textContent=user.role;
  await Promise.all([loadIntegrations(),loadAssets()]);
}catch{location.href='/admin/';}
