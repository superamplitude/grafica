const token=sessionStorage.getItem('cp-admin-token')||'';
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct=v=>`${Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
const esc=(v='')=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
async function api(url){const r=await fetch(url,{headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}});const d=await r.json().catch(()=>({}));if(r.status===401){sessionStorage.removeItem('cp-admin-token');location.href='/admin/';throw new Error('UNAUTHORIZED');}if(!r.ok)throw new Error(d.error||`HTTP_${r.status}`);return d;}
function localIso(d){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);}
function defaults(){const now=new Date();document.querySelector('#to').value=localIso(now);document.querySelector('#from').value=localIso(new Date(now.getFullYear(),now.getMonth(),1));}
function card(label,value,sub=''){return `<article><span>${esc(label)}</span><strong>${value}</strong>${sub?`<small>${esc(sub)}</small>`:''}</article>`;}
async function load(){
  const from=document.querySelector('#from').value;const to=document.querySelector('#to').value;
  const q=new URLSearchParams({from,to});
  const data=await api(`/api/v1/admin/finance/summary?${q}`);const s=data.summary||{};const p=data.pricing||{};
  document.querySelector('#note').textContent=data.note||'';
  document.querySelector('#summaryCards').innerHTML=[
    card('Vendas brutas',money(s.gross_sales)),card('Pedidos',Number(s.orders||0).toLocaleString('pt-BR')),card('Ticket médio',money(s.average_ticket)),
    card('Custo fornecedor estimado',money(s.supplier_cost)),card('Lucro bruto estimado',money(s.gross_profit)),card('Margem bruta estimada',pct(s.gross_margin_percent)),
    card('Fretes cobrados',money(s.shipping_total)),card('Descontos',money(s.discounts))
  ].join('');
  document.querySelector('#statusRows').innerHTML=(data.statuses||[]).map(r=>`<tr><td>${esc(r.status)}</td><td>${Number(r.orders||0).toLocaleString('pt-BR')}</td><td>${money(r.total)}</td></tr>`).join('')||'<tr><td colspan="3">Sem pedidos no período.</td></tr>';
  document.querySelector('#pricingAudit').innerHTML=`<div><span>Variantes</span><strong>${Number(p.variants||0).toLocaleString('pt-BR')}</strong></div><div class="warn"><span>Em revisão</span><strong>${Number(p.review_count||0).toLocaleString('pt-BR')}</strong></div><div><span>Bloqueadas</span><strong>${Number(p.blocked_count||0).toLocaleString('pt-BR')}</strong></div><div><span>Maior custo</span><strong>${money(p.max_cost)}</strong></div><div><span>Maior preço</span><strong>${money(p.max_price)}</strong></div>`;
  document.querySelector('#topProducts').innerHTML=(data.top_products||[]).map(r=>`<tr><td>${esc(r.name)}</td><td>${Number(r.lines||0).toLocaleString('pt-BR')}</td><td><strong>${money(r.sales)}</strong></td></tr>`).join('')||'<tr><td colspan="3">Sem vendas no período.</td></tr>';
}
defaults();
document.querySelector('#reload').onclick=()=>load().catch(e=>alert(e.message));
document.querySelector('#applyPeriod').onclick=()=>load().catch(e=>alert(e.message));
load().catch(e=>{document.querySelector('#summaryCards').innerHTML=`<div class="empty">${esc(e.message)}</div>`;});
