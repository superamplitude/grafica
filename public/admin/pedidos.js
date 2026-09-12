const token=sessionStorage.getItem('cp-admin-token')||'';
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const esc=(v='')=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const statusLabels={
  'awaiting-shipping-quote':'Aguardando frete',
  'awaiting-payment':'Aguardando pagamento',
  paid:'Pago',
  prepress:'Pré-impressão',
  production:'Produção',
  shipped:'Enviado',
  completed:'Concluído',
  cancelled:'Cancelado'
};
const paymentLabels={
  not_required:'Não exigido',
  pending:'Pendente',
  paid:'Pago',
  partially_paid:'Parcial',
  refunded:'Reembolsado',
  cancelled:'Cancelado'
};
const eventLabels={
  'order.created':'Pedido criado',
  'shipping.quoted':'Frete cotado',
  'payment.updated':'Pagamento atualizado',
  'payment.started':'Pagamento iniciado',
  'payment.confirmed':'Pagamento confirmado',
  'artwork.uploaded':'Arte recebida',
  'production.started':'Produção iniciada',
  'order.shipped':'Pedido enviado',
  'order.status.updated':'Status atualizado'
};
let user=null;
let selectedOrderId=null;
let statuses=[];
let paymentStatuses=[];
const rowsEl=document.querySelector('#ordersRows');
const messageEl=document.querySelector('#ordersMessage');
const summaryEl=document.querySelector('#ordersSummary');
const detailEl=document.querySelector('#orderDetail');
const formEl=document.querySelector('#orderEditForm');

async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...options.headers}});
  const data=await response.json().catch(()=>({}));
  if(response.status===401){sessionStorage.removeItem('cp-admin-token');location.href='/admin/';throw new Error('UNAUTHORIZED');}
  if(!response.ok)throw Object.assign(new Error(data.error||`HTTP_${response.status}`),{data,status:response.status});
  return data;
}

function chipClass(value){
  if(['paid','completed','shipped'].includes(value))return'good';
  if(['cancelled','refunded'].includes(value))return'danger';
  return'warn';
}

function fillSelect(select,values,labelMap,current){
  select.innerHTML=values.map(value=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(labelMap[value]||value)}</option>`).join('');
}

function renderFilters(){
  const statusSelect=document.querySelector('#ordersStatus');
  const paymentSelect=document.querySelector('#ordersPaymentStatus');
  const currentStatus=statusSelect.value;
  const currentPayment=paymentSelect.value;
  statusSelect.innerHTML='<option value="">Todos</option>'+statuses.map(value=>`<option value="${esc(value)}">${esc(statusLabels[value]||value)}</option>`).join('');
  paymentSelect.innerHTML='<option value="">Todos</option>'+paymentStatuses.map(value=>`<option value="${esc(value)}">${esc(paymentLabels[value]||value)}</option>`).join('');
  statusSelect.value=currentStatus;
  paymentSelect.value=currentPayment;
}

function rowHtml(order){
  return `<tr data-order-id="${order.id}">
    <td><strong>${esc(order.order_number)}</strong><br><small>${new Date(order.created_at).toLocaleString('pt-BR')}</small></td>
    <td><strong>${esc(order.customer_name||'Sem cadastro')}</strong><br><small>${esc(order.customer_email||order.customer_phone||'—')}</small></td>
    <td><span class="status-chip ${chipClass(order.status)}">${esc(statusLabels[order.status]||order.status)}</span></td>
    <td><span class="status-chip ${chipClass(order.payment_status)}">${esc(paymentLabels[order.payment_status]||order.payment_status)}</span><br><small>${esc(order.payment_provider||'—')} · ${money.format(Number(order.paid_total||0))}</small></td>
    <td class="amount">${money.format(Number(order.grand_total||0))}</td>
    <td>${Number(order.items_count||0)}<br><small>${Number(order.artworks_count||0)} arte(s)</small></td>
    <td>${Number(order.production_open||0)>0?`<span class="status-chip warn">${Number(order.production_open)} aberta(s)</span>`:'—'}</td>
    <td><button class="action" data-open-order="${order.id}" type="button">Abrir</button></td>
  </tr>`;
}

function renderSummary(items){
  const total=items.reduce((sum,item)=>sum+Number(item.grand_total||0),0);
  const awaiting=items.filter(item=>['awaiting-shipping-quote','awaiting-payment'].includes(item.status)).length;
  const paid=items.filter(item=>item.payment_status==='paid').length;
  summaryEl.innerHTML=`<span><strong>${items.length}</strong> pedido(s)</span><span><strong>${awaiting}</strong> aguardando ação comercial</span><span><strong>${paid}</strong> pago(s)</span><span>Valor listado: <strong>${money.format(total)}</strong></span>`;
}

async function loadOrders(){
  messageEl.textContent='Carregando…';
  const params=new URLSearchParams();
  const q=document.querySelector('#ordersSearch').value.trim();
  const status=document.querySelector('#ordersStatus').value;
  const paymentStatus=document.querySelector('#ordersPaymentStatus').value;
  if(q)params.set('q',q);
  if(status)params.set('status',status);
  if(paymentStatus)params.set('payment_status',paymentStatus);
  try{
    const data=await api(`/api/v1/admin/orders${params.size?`?${params}`:''}`);
    statuses=data.statuses||statuses;
    paymentStatuses=data.paymentStatuses||paymentStatuses;
    renderFilters();
    rowsEl.innerHTML=data.items.length?data.items.map(rowHtml).join(''):'<tr><td colspan="8" class="empty-orders">Nenhum pedido encontrado.</td></tr>';
    renderSummary(data.items);
    messageEl.textContent=`${data.items.length} registro(s)`;
  }catch(error){
    rowsEl.innerHTML='<tr><td colspan="8" class="empty-orders">Falha ao carregar pedidos.</td></tr>';
    messageEl.textContent=`Erro: ${error.message}`;
  }
}

function renderAddress(title,data){
  const text=data&&Object.keys(data).length?JSON.stringify(data,null,2):'Não informado';
  return `<article class="address-card"><strong>${esc(title)}</strong><pre>${esc(text)}</pre></article>`;
}

function itemHtml(item){
  const arts=Number(item.artwork_count||0);
  return `<article class="detail-item">
    <header><div><strong>${esc(item.product_name||'Produto')}</strong><br><small>${esc(item.variant_name||item.product_sku||'')}</small></div><strong>${money.format(Number(item.line_total||0))}</strong></header>
    <p>${Number(item.quantity||0)} lote(s) · item: ${esc(item.production_status||'—')} · artes: ${arts}${item.artwork_statuses?` (${esc(item.artwork_statuses)})`:''}${item.production_statuses?` · produção: ${esc(item.production_statuses)}`:''}</p>
  </article>`;
}

function eventHtml(event){
  const payload=event.payload_json&&typeof event.payload_json==='object'?JSON.stringify(event.payload_json):'';
  return `<article class="detail-event"><strong>${esc(eventLabels[event.event_type]||event.event_type)}</strong><small>${esc(event.from_status||'')} ${event.to_status?`→ ${esc(event.to_status)}`:''}${payload?` · ${esc(payload)}`:''}</small><time>${new Date(event.created_at).toLocaleString('pt-BR')}</time></article>`;
}

function updateProjectedTotal(){
  const subtotal=Number(document.querySelector('#detailSubtotal').dataset.value||0);
  const shipping=Number(document.querySelector('#detailShipping').value||0);
  const discount=Number(document.querySelector('#detailDiscount').value||0);
  document.querySelector('#detailGrandTotal').textContent=money.format(Math.max(0,subtotal+shipping-discount));
}

async function openOrder(id){
  selectedOrderId=Number(id);
  detailEl.hidden=false;
  detailEl.scrollIntoView({behavior:'smooth',block:'start'});
  document.querySelector('#detailNumber').textContent='Carregando…';
  try{
    const data=await api(`/api/v1/admin/orders/${selectedOrderId}`);
    statuses=data.statuses||statuses;
    paymentStatuses=data.paymentStatuses||paymentStatuses;
    const order=data.order;
    document.querySelector('#detailNumber').textContent=order.order_number;
    document.querySelector('#detailCustomer').textContent=[order.customer_name,order.customer_email,order.customer_phone].filter(Boolean).join(' · ')||'Cliente sem identificação';
    fillSelect(document.querySelector('#detailStatus'),statuses,statusLabels,order.status);
    fillSelect(document.querySelector('#detailPaymentStatus'),paymentStatuses,paymentLabels,order.payment_status);
    document.querySelector('#detailPaymentProvider').value=order.payment_provider||'';
    document.querySelector('#detailShipping').value=Number(order.shipping_total||0).toFixed(2);
    document.querySelector('#detailDiscount').value=Number(order.discount_total||0).toFixed(2);
    document.querySelector('#detailPaid').value=Number(order.paid_total||0).toFixed(2);
    document.querySelector('#detailNote').value='';
    const subtotalEl=document.querySelector('#detailSubtotal');
    subtotalEl.dataset.value=String(Number(order.subtotal||0));
    subtotalEl.textContent=money.format(Number(order.subtotal||0));
    document.querySelector('#detailGrandTotal').textContent=money.format(Number(order.grand_total||0));
    document.querySelector('#detailAddresses').innerHTML=renderAddress('Cobrança',order.billing_json)+renderAddress('Entrega',order.shipping_json);
    document.querySelector('#detailItems').innerHTML=data.items.length?data.items.map(itemHtml).join(''):'<div class="empty-orders">Sem itens.</div>';
    document.querySelector('#detailEvents').innerHTML=data.events.length?data.events.map(eventHtml).join(''):'<div class="empty-orders">Sem eventos.</div>';
    const canEdit=['super_admin','admin','operations'].includes(user?.role);
    [...formEl.elements].forEach(element=>{if(element.id!=='saveOrder')element.disabled=!canEdit;});
    document.querySelector('#saveOrder').disabled=!canEdit;
    document.querySelector('#editPermissionNote').textContent=canEdit?'Alterações geram evento operacional e registro de auditoria.':'Seu perfil possui acesso somente para consulta.';
  }catch(error){
    document.querySelector('#detailNumber').textContent='Falha ao abrir pedido';
    document.querySelector('#detailCustomer').textContent=error.message;
  }
}

async function bootstrap(){
  if(!token){location.href='/admin/';return;}
  try{
    const me=await api('/api/v1/admin/auth/me');
    user=me.user;
    document.querySelector('#ordersUserName').textContent=user.name;
    document.querySelector('#ordersUserRole').textContent=user.role;
    await loadOrders();
  }catch{location.href='/admin/';}
}

document.querySelector('#ordersFilterForm').addEventListener('submit',event=>{event.preventDefault();loadOrders();});
document.querySelector('#ordersReload').addEventListener('click',()=>loadOrders());
rowsEl.addEventListener('click',event=>{const button=event.target.closest('[data-open-order]');const row=event.target.closest('[data-order-id]');const id=button?.dataset.openOrder||row?.dataset.orderId;if(id)openOrder(id);});
document.querySelector('#closeDetail').addEventListener('click',()=>{detailEl.hidden=true;selectedOrderId=null;});
document.querySelector('#detailShipping').addEventListener('input',updateProjectedTotal);
document.querySelector('#detailDiscount').addEventListener('input',updateProjectedTotal);
formEl.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!selectedOrderId)return;
  const saveButton=document.querySelector('#saveOrder');
  saveButton.disabled=true;
  saveButton.textContent='Salvando…';
  try{
    const body={
      status:document.querySelector('#detailStatus').value,
      payment_status:document.querySelector('#detailPaymentStatus').value,
      payment_provider:document.querySelector('#detailPaymentProvider').value.trim()||null,
      shipping_total:Number(document.querySelector('#detailShipping').value||0),
      discount_total:Number(document.querySelector('#detailDiscount').value||0),
      paid_total:Number(document.querySelector('#detailPaid').value||0),
      note:document.querySelector('#detailNote').value.trim()||null
    };
    await api(`/api/v1/admin/orders/${selectedOrderId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    await Promise.all([loadOrders(),openOrder(selectedOrderId)]);
    saveButton.textContent='Salvo';
    setTimeout(()=>{saveButton.textContent='Salvar alterações';},1200);
  }catch(error){
    alert(`Não foi possível salvar: ${error.message}`);
    saveButton.textContent='Salvar alterações';
  }finally{
    saveButton.disabled=!['super_admin','admin','operations'].includes(user?.role);
  }
});

await bootstrap();
