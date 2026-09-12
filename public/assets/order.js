const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const params=new URLSearchParams(location.search);
let currentNumber=params.get('numero');
const orders=(()=>{try{return JSON.parse(localStorage.getItem('cp-orders')||'{}')}catch{return{}}})();
let currentToken=currentNumber?orders[currentNumber]?.token:null;
let storageReady=false;
const msg=document.querySelector('#orderMessage');
const content=document.querySelector('#orderContent');
const lookup=document.querySelector('#orderLookup');
const recent=document.querySelector('#recentOrders');
const numberInput=document.querySelector('#orderNumberInput');
const itemsEl=document.querySelector('#orderItems');
function esc(v=''){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
const labels={'awaiting-shipping-quote':'Aguardando cotação de frete','awaiting-payment':'Aguardando pagamento','paid':'Pago','prepress':'Pré-impressão','production':'Em produção','shipped':'Enviado','completed':'Concluído','cancelled':'Cancelado'};
const paymentLabels={not_required:'Não exigido',pending:'Pendente',paid:'Pago',partially_paid:'Parcial',refunded:'Reembolsado',cancelled:'Cancelado'};
const proofLabels={pending:'Aguardando sua aprovação',approved:'Aprovada','changes-requested':'Alterações solicitadas',rejected:'Rejeitada'};
const eventLabels={'order.created':'Pedido registrado','shipping.quoted':'Frete cotado','payment.started':'Pagamento iniciado','payment.confirmed':'Pagamento confirmado','payment.updated':'Pagamento atualizado','artwork.uploaded':'Arte recebida','preflight.completed':'Conferência da arte concluída','proof.created':'Nova prova digital disponível','proof.approved':'Prova digital aprovada','proof.changes-requested':'Alterações solicitadas na prova','production.job.created':'Item liberado para produção','order.production-readiness':'Situação de produção atualizada','production.started':'Produção iniciada','order.shipped':'Pedido enviado'};
function tokenFor(number){return orders[number]?.token||null;}
async function api(url,options={}){const token=currentToken;const r=await fetch(url,{...options,headers:{Accept:'application/json',...(token?{'X-Order-Token':token}:{}),...options.headers}});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`HTTP_${r.status}`);return data;}
async function checkStorage(){try{const r=await fetch('/api/health',{headers:{Accept:'application/json'}});const d=await r.json();storageReady=d.storage==='ok';}catch{storageReady=false;}}
async function uploadArtwork(itemId,side,file,resultEl){const intent=await api(`/api/v1/orders/${encodeURIComponent(currentNumber)}/items/${itemId}/artwork/upload-intent`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,contentType:file.type||'application/octet-stream',side})});if(file.size>intent.maxBytes)throw new Error('ARQUIVO_MUITO_GRANDE');resultEl.textContent='Enviando arquivo privado…';const put=await fetch(intent.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});if(!put.ok)throw new Error(`UPLOAD_${put.status}`);resultEl.textContent='Confirmando arquivo…';const confirmed=await api(`/api/v1/orders/${encodeURIComponent(currentNumber)}/items/${itemId}/artwork/confirm`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:intent.key,filename:file.name,side})});resultEl.textContent=`Arte #${confirmed.artworkId} recebida. Pré-impressão: ${confirmed.preflight}.`;}
function artworkBlock(item){
 if(!item.requires_artwork)return '<p class="artwork-state ok">Este item não exige envio de arte.</p>';
 if(!storageReady)return '<div class="artwork-state"><strong>Envio de arte ainda não liberado</strong><span>Você pode acompanhar normalmente o pedido. O botão de envio será disponibilizado quando o armazenamento privado estiver ativo.</span></div>';
 const back=Boolean(item.supports_back);
 return `<form class="artwork-upload" data-item="${item.id}"><label>Face<select name="side"><option value="front">Frente</option>${back?'<option value="back">Verso</option><option value="duplex">Frente + verso</option>':''}<option value="general">Arquivo geral</option></select></label><label>Arquivo<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.svg,.eps,.cdr,.zip" required></label><button type="submit">Enviar arte</button><div class="upload-result"></div></form>`;
}
function proofBlock(itemProofs){
 if(!itemProofs?.length)return'';
 return `<section class="proofs-box"><h4>Provas digitais</h4>${itemProofs.map(proof=>`<article class="proof-review" data-proof-id="${proof.id}"><div class="proof-review-head"><div><strong>Versão ${Number(proof.version_no||1)}</strong><span>${esc(proof.original_name||'Prova digital')}</span></div><b class="proof-status ${proof.status==='approved'?'ok':proof.status==='pending'?'pending':'changes'}">${esc(proofLabels[proof.status]||proof.status)}</b></div><div class="proof-actions"><button type="button" data-view-proof="${proof.id}">Abrir prova</button>${proof.status==='pending'?`<button type="button" class="proof-approve" data-proof-decision="approve">Aprovar</button><button type="button" data-proof-decision="changes">Solicitar alteração</button>`:''}</div>${proof.status==='pending'?'<textarea class="proof-note" rows="2" maxlength="5000" placeholder="Observação opcional para a gráfica"></textarea>':''}${proof.customer_note?`<p class="proof-customer-note">Sua observação: ${esc(proof.customer_note)}</p>`:''}</article>`).join('')}</section>`;
}
function itemCard(item,proofsByItem){const itemProofs=proofsByItem.get(Number(item.id))||[];return`<article class="order-item"><div class="order-item-head"><div><h3>${esc(item.product_name)}</h3><p>${esc(item.variant_name||'')} · ${item.quantity} lote(s) · ${esc(item.production_status)}</p></div><strong>${money.format(Number(item.line_total||0))}</strong></div>${proofBlock(itemProofs)}${artworkBlock(item)}</article>`;}
function renderRecent(){
 const entries=Object.entries(orders).sort((a,b)=>String(b[1]?.createdAt||'').localeCompare(String(a[1]?.createdAt||''))).slice(0,8);
 if(!entries.length){recent.innerHTML='<div class="recent-empty">Nenhum pedido foi registrado neste navegador.</div>';return;}
 recent.innerHTML='<h2>Pedidos recentes neste navegador</h2>'+entries.map(([number,data])=>`<button type="button" data-order="${esc(number)}"><strong>${esc(number)}</strong><span>${data.createdAt?new Date(data.createdAt).toLocaleString('pt-BR'):'Acesso privado salvo'}</span></button>`).join('');
 recent.querySelectorAll('[data-order]').forEach(btn=>btn.addEventListener('click',()=>openNumber(btn.dataset.order)));
}
function showMessage(text){msg.hidden=false;msg.textContent=text;}
function openNumber(number){const clean=String(number||'').trim().toUpperCase();if(!clean)return;const token=tokenFor(clean);if(!token){showMessage('Este navegador não possui a chave privada desse pedido. Por segurança, somente pedidos registrados neste navegador podem ser abertos sem uma nova validação de identidade.');return;}location.href=`/pedido.html?numero=${encodeURIComponent(clean)}`;}
async function viewProof(proofId){try{const data=await api(`/api/v1/orders/${encodeURIComponent(currentNumber)}/proofs/${Number(proofId)}/view`);window.open(data.url,'_blank','noopener,noreferrer');}catch(error){alert(`Não foi possível abrir a prova: ${error.message}`);}}
async function decideProof(card,decision){const proofId=Number(card.dataset.proofId);const note=card.querySelector('.proof-note')?.value.trim()||null;const verb=decision==='approve'?'aprovar':'solicitar alteração nesta';if(!confirm(`Confirma ${verb} prova?`))return;const buttons=[...card.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);try{await api(`/api/v1/orders/${encodeURIComponent(currentNumber)}/proofs/${proofId}/decision`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,note})});await load();}catch(error){alert(`Não foi possível registrar sua decisão: ${error.message}`);buttons.forEach(button=>button.disabled=false);}}
async function load(){
 renderRecent();
 if(!currentNumber){lookup.hidden=false;return;}
 currentNumber=String(currentNumber).trim().toUpperCase();currentToken=tokenFor(currentNumber);numberInput.value=currentNumber;
 if(!currentToken){lookup.hidden=false;showMessage('A chave privada deste pedido não está salva neste navegador. Use o navegador em que a solicitação foi registrada.');return;}
 lookup.hidden=true;showMessage('Carregando pedido…');
 try{
  await checkStorage();
  const [data,proofData]=await Promise.all([api(`/api/v1/orders/${encodeURIComponent(currentNumber)}`),api(`/api/v1/orders/${encodeURIComponent(currentNumber)}/proofs`)]);
  const proofsByItem=new Map();
  for(const proof of proofData.items||[]){const key=Number(proof.order_item_id);if(!proofsByItem.has(key))proofsByItem.set(key,[]);proofsByItem.get(key).push(proof);}
  document.title=`${currentNumber} · Central Prints`;document.querySelector('#orderHeader').textContent=currentNumber;
  document.querySelector('#orderStatus').textContent=labels[data.order.status]||data.order.status;
  document.querySelector('#orderSubtotal').textContent=money.format(Number(data.order.subtotal||0));
  document.querySelector('#shippingStatus').textContent=data.order.shipping_total==null?'A calcular':money.format(Number(data.order.shipping_total||0));
  document.querySelector('#paymentStatus').textContent=paymentLabels[data.order.payment_status]||data.order.payment_status;
  itemsEl.innerHTML=data.items.map(item=>itemCard(item,proofsByItem)).join('');
  document.querySelector('#orderEvents').innerHTML=data.events.length?data.events.map(e=>`<article><strong>${esc(eventLabels[e.event_type]||e.event_type)}</strong><span>${esc(labels[e.to_status]||e.to_status||'')}</span><time>${new Date(e.created_at).toLocaleString('pt-BR')}</time></article>`).join(''):'<p>Sem eventos adicionais.</p>';
  msg.hidden=true;content.hidden=false;
 }catch(error){lookup.hidden=false;showMessage(`Não foi possível abrir o pedido: ${error.message}`);}
}
document.querySelector('#orderLookupForm').addEventListener('submit',event=>{event.preventDefault();openNumber(numberInput.value);});
itemsEl.addEventListener('submit',async event=>{const form=event.target.closest('.artwork-upload');if(!form)return;event.preventDefault();const file=form.elements.file.files[0];if(!file)return;const resultEl=form.querySelector('.upload-result');form.querySelector('button').disabled=true;try{await uploadArtwork(Number(form.dataset.item),form.elements.side.value,file,resultEl);form.reset();}catch(error){resultEl.textContent=`Falha no envio: ${error.message}.`; }finally{form.querySelector('button').disabled=false;}});
itemsEl.addEventListener('click',event=>{const view=event.target.closest('[data-view-proof]');if(view){viewProof(view.dataset.viewProof);return;}const decision=event.target.closest('[data-proof-decision]');if(decision){const card=decision.closest('.proof-review');if(card)decideProof(card,decision.dataset.proofDecision);}});
await load();
