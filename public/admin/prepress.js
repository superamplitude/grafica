const token=sessionStorage.getItem('cp-admin-token')||'';
const esc=(v='')=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const artworkLabels={uploaded:'Recebida',preflight:'Em conferência','changes-required':'Correção necessária',approved:'Aprovada',rejected:'Rejeitada'};
const proofLabels={pending:'Aguardando cliente',approved:'Aprovada','changes-requested':'Alterações solicitadas',rejected:'Rejeitada'};
const stateLabels={pass:'Aprovado automaticamente',warning:'Atenção',manual:'Revisão humana',fail:'Falha técnica/arte'};
let user=null;
let selectedId=null;
let statuses=[];
let selectedData=null;
const rowsEl=document.querySelector('#prepressRows');
const messageEl=document.querySelector('#prepressMessage');
const detailEl=document.querySelector('#prepressDetail');

async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...options.headers}});
  const data=await response.json().catch(()=>({}));
  if(response.status===401){sessionStorage.removeItem('cp-admin-token');location.href='/admin/';throw new Error('UNAUTHORIZED');}
  if(!response.ok)throw Object.assign(new Error(data.error||`HTTP_${response.status}`),{data,status:response.status});
  return data;
}

function stateClass(value){
  if(['approved','pass'].includes(value))return'good';
  if(['rejected','changes-required','fail','failed'].includes(value))return'bad';
  if(['warning','manual','pending','uploaded'].includes(value))return'warn';
  return'info';
}

function preflightState(row){
  const pf=row.preflight_json||{};
  return pf.state||pf.status||row.preflight_job_status||'pending';
}

function rowHtml(row){
  const state=preflightState(row);
  return `<tr data-artwork-id="${row.id}">
    <td><strong>${esc(row.order_number)}</strong><br><small>${esc(row.customer_name||row.customer_email||'—')} · ${esc(row.payment_status||'')}</small></td>
    <td><strong>${esc(row.product_name||'Produto')}</strong><br><small>${esc(row.variant_name||'')} · ${esc(row.side)}</small></td>
    <td>${esc(row.original_name||'Arquivo')}<br><small>${esc(row.mime_type||'')} · ${row.size_bytes?`${Math.round(Number(row.size_bytes)/1024)} KB`:''}</small></td>
    <td><span class="prepress-chip ${stateClass(state)}">${esc(stateLabels[state]||state)}</span><br><small>${esc(row.preflight_job_status||'—')} · tentativa ${Number(row.preflight_attempts||0)}</small></td>
    <td><span class="prepress-chip ${stateClass(row.status)}">${esc(artworkLabels[row.status]||row.status)}</span></td>
    <td>${row.latest_proof_id?`<span class="prepress-chip ${stateClass(row.latest_proof_status)}">v${Number(row.latest_proof_version||1)} · ${esc(proofLabels[row.latest_proof_status]||row.latest_proof_status)}</span>`:'—'}</td>
    <td><button class="action" data-open-artwork="${row.id}" type="button">Abrir</button></td>
  </tr>`;
}

function renderSummary(items){
  const counts={};
  for(const item of items)counts[item.status]=(counts[item.status]||0)+1;
  document.querySelector('#prepressSummary').innerHTML=`<span><strong>${items.length}</strong> arte(s)</span><span><strong>${counts['changes-required']||0}</strong> correção</span><span><strong>${counts.preflight||0}</strong> conferência</span><span><strong>${counts.approved||0}</strong> aprovadas</span>`;
}

function renderStatusFilter(){
  const select=document.querySelector('#prepressStatus');
  const current=select.value;
  select.innerHTML='<option value="">Todos</option>'+statuses.map(s=>`<option value="${esc(s)}">${esc(artworkLabels[s]||s)}</option>`).join('');
  select.value=current;
}

async function loadStorageState(){
  try{
    const data=await api('/api/v1/admin/storage/status');
    document.querySelector('#storageState').textContent=`Armazenamento: ${data.status}`;
  }catch{
    document.querySelector('#storageState').textContent='Armazenamento: indisponível';
  }
}

async function loadList(){
  messageEl.textContent='Carregando…';
  const params=new URLSearchParams();
  const q=document.querySelector('#prepressSearch').value.trim();
  const status=document.querySelector('#prepressStatus').value;
  if(q)params.set('q',q);
  if(status)params.set('status',status);
  try{
    const data=await api(`/api/v1/admin/prepress/artworks${params.size?`?${params}`:''}`);
    statuses=data.statuses||statuses;
    renderStatusFilter();
    rowsEl.innerHTML=data.items.length?data.items.map(rowHtml).join(''):'<tr><td colspan="7" class="empty-prepress">Nenhuma arte encontrada.</td></tr>';
    renderSummary(data.items);
    messageEl.textContent=`${data.items.length} registro(s)`;
  }catch(error){
    rowsEl.innerHTML='<tr><td colspan="7" class="empty-prepress">Falha ao carregar a fila.</td></tr>';
    messageEl.textContent=`Erro: ${error.message}`;
  }
}

function renderPreflight(artwork){
  const pf=artwork.preflight_json||{};
  const state=pf.state||pf.status||artwork.preflight_job_status||'pending';
  document.querySelector('#preflightState').innerHTML=`<div class="preflight-state ${stateClass(state)}">${esc(stateLabels[state]||state)}</div>${artwork.preflight_error?`<p class="safety-note">${esc(artwork.preflight_error)}</p>`:''}`;
  const checks=Array.isArray(pf.checks)?pf.checks:[];
  document.querySelector('#preflightChecks').innerHTML=checks.length?checks.map(check=>`<article class="preflight-check"><strong>${esc(String(check.status||'').toUpperCase())}</strong><span>${esc(check.message||'')}</span></article>`).join(''):'<div class="empty-prepress">Ainda não há diagnóstico detalhado.</div>';
}

function proofHtml(proof){
  return `<article class="proof-entry">
    <header><strong>Versão ${Number(proof.version_no||1)}</strong><span class="prepress-chip ${stateClass(proof.status)}">${esc(proofLabels[proof.status]||proof.status)}</span></header>
    <p>${esc(proof.original_name||'Prova digital')} · ${new Date(proof.created_at).toLocaleString('pt-BR')}</p>
    ${proof.customer_note?`<p>Cliente: ${esc(proof.customer_note)}</p>`:''}
    <button class="action" type="button" data-view-media="${proof.media_id}">Abrir prova</button>
  </article>`;
}

function eventHtml(event){
  const payload=event.payload_json&&typeof event.payload_json==='object'?JSON.stringify(event.payload_json):'';
  return `<article class="artwork-event"><strong>${esc(event.event_type)}</strong><small>${esc(payload)}</small><time>${new Date(event.created_at).toLocaleString('pt-BR')}</time></article>`;
}

async function openArtwork(id){
  selectedId=Number(id);
  detailEl.hidden=false;
  detailEl.scrollIntoView({behavior:'smooth',block:'start'});
  document.querySelector('#detailTitle').textContent='Carregando…';
  try{
    selectedData=await api(`/api/v1/admin/prepress/artworks/${selectedId}`);
    const artwork=selectedData.artwork;
    document.querySelector('#detailTitle').textContent=`${artwork.order_number} · ${artwork.product_name||'Produto'}`;
    document.querySelector('#detailMeta').textContent=[artwork.variant_name,artwork.original_name,artwork.side,artwork.status].filter(Boolean).join(' · ');
    renderPreflight(artwork);
    document.querySelector('#proofHistory').innerHTML=selectedData.proofs.length?selectedData.proofs.map(proofHtml).join(''):'<div class="empty-prepress">Nenhuma prova criada.</div>';
    document.querySelector('#artworkEvents').innerHTML=selectedData.events.length?selectedData.events.map(eventHtml).join(''):'<div class="empty-prepress">Sem eventos técnicos.</div>';
    document.querySelector('#overrideWrap').hidden=user?.role!=='super_admin';
    document.querySelector('#decisionNote').value='';
    document.querySelector('#decisionOverride').checked=false;
  }catch(error){
    document.querySelector('#detailTitle').textContent='Falha ao abrir arte';
    document.querySelector('#detailMeta').textContent=error.message;
  }
}

async function openMedia(mediaId){
  try{
    const data=await api(`/api/v1/admin/media/${Number(mediaId)}/read-url`);
    window.open(data.url,'_blank','noopener,noreferrer');
  }catch(error){alert(`Não foi possível abrir o arquivo: ${error.message}`);}
}

function contentTypeFor(file){
  if(file.type)return file.type;
  const ext=file.name.toLowerCase().split('.').pop();
  return ({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'})[ext]||'application/octet-stream';
}

async function uploadProofFile(file){
  const contentType=contentTypeFor(file);
  const intent=await api('/api/v1/admin/media/upload-intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'proof',filename:file.name,contentType,sizeBytes:file.size,visibility:'private'})});
  if(file.size>intent.maxBytes)throw new Error('PROOF_TOO_LARGE');
  const put=await fetch(intent.uploadUrl,{method:'PUT',headers:{'Content-Type':contentType},body:file});
  if(!put.ok)throw new Error(`UPLOAD_${put.status}`);
  const confirmed=await api('/api/v1/admin/media/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'proof',key:intent.key,originalName:file.name,visibility:'private',metadata:{source:'admin-prepress',artworkId:selectedId}})});
  return Number(confirmed.media?.id||confirmed.insertId);
}

async function decide(decision){
  if(!selectedId)return;
  const note=document.querySelector('#decisionNote').value.trim()||null;
  const override=document.querySelector('#decisionOverride').checked;
  const label={approve:'aprovar',changes:'pedir correção',reject:'rejeitar'}[decision];
  if(!confirm(`Confirma ${label} esta arte?`))return;
  try{
    const data=await api(`/api/v1/admin/prepress/artworks/${selectedId}/decision`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,note,override})});
    const release=data.release?.released?` ${data.release.released} item(ns) liberado(s) para a fila interna de produção.`:'';
    alert(`Decisão registrada.${release}`);
    await Promise.all([loadList(),openArtwork(selectedId)]);
  }catch(error){alert(`Decisão bloqueada: ${error.message}`);}
}

async function bootstrap(){
  if(!token){location.href='/admin/';return;}
  try{
    const me=await api('/api/v1/admin/auth/me');
    user=me.user;
    document.querySelector('#prepressUser').textContent=user.name;
    document.querySelector('#prepressRole').textContent=user.role;
    await Promise.all([loadList(),loadStorageState()]);
  }catch{location.href='/admin/';}
}

document.querySelector('#prepressFilterForm').addEventListener('submit',event=>{event.preventDefault();loadList();});
document.querySelector('#prepressReload').addEventListener('click',()=>loadList());
rowsEl.addEventListener('click',event=>{const button=event.target.closest('[data-open-artwork]');const row=event.target.closest('[data-artwork-id]');const id=button?.dataset.openArtwork||row?.dataset.artworkId;if(id)openArtwork(id);});
document.querySelector('#closePrepressDetail').addEventListener('click',()=>{detailEl.hidden=true;selectedId=null;selectedData=null;});
document.querySelector('#viewOriginal').addEventListener('click',()=>{const mediaId=selectedData?.artwork?.original_media_id;if(mediaId)openMedia(mediaId);});
document.querySelector('#requeuePreflight').addEventListener('click',async()=>{
  if(!selectedId||!confirm('Refazer o preflight automático desta arte?'))return;
  try{await api(`/api/v1/admin/prepress/artworks/${selectedId}/requeue`,{method:'POST'});await Promise.all([loadList(),openArtwork(selectedId)]);}catch(error){alert(`Não foi possível reenfileirar: ${error.message}`);}
});
document.querySelectorAll('[data-decision]').forEach(button=>button.addEventListener('click',()=>decide(button.dataset.decision)));
document.querySelector('#proofHistory').addEventListener('click',event=>{const button=event.target.closest('[data-view-media]');if(button)openMedia(button.dataset.viewMedia);});
document.querySelector('#proofUploadForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!selectedId)return;
  const file=document.querySelector('#proofFile').files[0];
  if(!file)return;
  const message=document.querySelector('#proofUploadMessage');
  const submit=event.currentTarget.querySelector('button[type=submit]');
  submit.disabled=true;
  try{
    message.textContent='Enviando arquivo privado…';
    const mediaId=await uploadProofFile(file);
    message.textContent='Registrando prova…';
    await api(`/api/v1/admin/prepress/artworks/${selectedId}/proofs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mediaId,note:document.querySelector('#proofNote').value.trim()||null})});
    event.currentTarget.reset();
    message.textContent='Prova enviada ao cliente.';
    await Promise.all([loadList(),openArtwork(selectedId)]);
  }catch(error){message.textContent=`Falha: ${error.message}`;}
  finally{submit.disabled=false;}
});

await bootstrap();
