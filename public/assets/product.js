const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const params=new URLSearchParams(location.search);
const slug=params.get('slug');
const variantSelect=document.querySelector('#variantSelect');
const priceEl=document.querySelector('#itemPrice');
const detail=document.querySelector('#variantDetail');
const addToCart=document.querySelector('#addToCart');
const feedback=document.querySelector('#formFeedback');
const cart=()=>{try{return JSON.parse(localStorage.getItem('cp-cart')||'[]')}catch{return[]}};
const saveCart=(items)=>{localStorage.setItem('cp-cart',JSON.stringify(items));updateCount();};
const updateCount=()=>{const el=document.querySelector('#cartCount');if(el)el.textContent=cart().reduce((sum,item)=>sum+Number(item.lots||1),0);};
const TEMPLATE_ORDER=['cdr','ai','psd','pdf','svg'];
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function safeText(v=''){return String(v||'').replace(/\s+/g,' ').trim();}
function safeName(value='arquivo'){return String(value||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'arquivo';}
async function api(url){const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP_${r.status}`);return r.json();}
let product;

function renderDescription(text){
 const clean=String(text||'').trim();
 if(!clean)return '<p>As informações detalhadas deste produto estão sendo preparadas.</p>';
 return clean.split(/\n{2,}/).map(block=>`<p>${esc(block).replace(/\n/g,'<br>')}</p>`).join('');
}

function renderGallery(p){
 const visuals=(product.visuals||[]).filter(v=>v.url);
 if(!visuals.length&&p.technical_preview_url)visuals.push({role:'technical_preview',url:p.technical_preview_url,visual_type:'technical_preview'});
 if(!visuals.length)return;
 const gallery=document.querySelector('#gallery');
 const first=visuals.find(v=>v.role==='cover')||visuals[0];
 const isTechnical=first.role==='technical_preview'||first.visual_type==='technical_preview';
 gallery.innerHTML=`<div class="main-visual-wrap"><img id="mainVisual" src="${esc(first.url)}" alt="${esc(p.name)}"><span id="visualKind" class="visual-kind ${isTechnical?'technical':'photo'}">${isTechnical?'Imagem ilustrativa do produto':'Foto do produto'}</span></div>`+(visuals.length>1?`<div class="gallery-list">${visuals.map(v=>`<button type="button" data-url="${esc(v.url)}" data-kind="${v.role==='technical_preview'||v.visual_type==='technical_preview'?'technical':'photo'}" aria-label="Ver outra imagem"><img src="${esc(v.url)}" alt=""></button>`).join('')}</div>`:'');
 gallery.addEventListener('click',e=>{const b=e.target.closest('[data-url]');const main=document.querySelector('#mainVisual');const kind=document.querySelector('#visualKind');if(b&&main){main.src=b.dataset.url;if(kind){const technical=b.dataset.kind==='technical';kind.textContent=technical?'Imagem ilustrativa do produto':'Foto do produto';kind.className=`visual-kind ${technical?'technical':'photo'}`;}}});
}

function collectTemplateFiles(p,verified=[],generated=[]){
 const files=[];
 for(const item of verified){
   const format=String(item.template_type||'').toLowerCase();
   if(!TEMPLATE_ORDER.includes(format)||!item.url)continue;
   const ref=item.reference||p.sku||p.slug;
   files.push({format,name:`${safeName(p.name)}-${safeName(ref)}.${format}`,url:item.url,native:true});
 }
 for(const item of generated){
   for(const f of item.formats||[]){
     const format=String(f.format||'').toLowerCase();
     if(!TEMPLATE_ORDER.includes(format)||!f.url)continue;
     files.push({format,name:f.file_name||`${safeName(p.name)}-${safeName(item.reference||item.code)}.${format}`,url:f.url,native:false});
   }
 }
 const seen=new Set();
 return files.filter(file=>{const key=`${file.format}|${file.name}|${file.url}`;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>TEMPLATE_ORDER.indexOf(a.format)-TEMPLATE_ORDER.indexOf(b.format)||a.name.localeCompare(b.name,'pt-BR'));
}

function renderTemplates(p,verified=[],generated=[]){
 const files=collectTemplateFiles(p,verified,generated);
 const box=document.querySelector('#templatesBox');
 if(!files.length){box.innerHTML='<h2>Gabaritos</h2><p>Nenhum arquivo disponível para este produto.</p>';return;}
 const rows=files.map(file=>`<a class="product-gabarito-row" href="${esc(file.url)}" ${file.native?'target="_blank" rel="noopener"':'download'}><span>${esc(file.format.toUpperCase())}</span><strong>${esc(file.name)}</strong><b>Baixar</b></a>`).join('');
 box.innerHTML=`<h2>Gabaritos</h2><button type="button" class="btn primary gabarito-toggle" id="gabaritoToggle" aria-expanded="false">BAIXAR GABARITOS</button><div class="product-gabarito-list" id="productGabaritoList" hidden>${rows}</div>`;
 const toggle=document.querySelector('#gabaritoToggle');
 const list=document.querySelector('#productGabaritoList');
 toggle?.addEventListener('click',()=>{const open=list.hidden;list.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'FECHAR GABARITOS':'BAIXAR GABARITOS';});
}

function renderFlags(p){
 const flags=[];
 if(p.requires_artwork)flags.push('Requer arte');
 if(p.supports_front&&p.supports_back)flags.push('Frente e verso');
 else if(p.supports_front)flags.push('Frente');
 flags.push('Preço validado no servidor');
 document.querySelector('#productFlags').innerHTML=flags.map(x=>`<span>${esc(x)}</span>`).join('');
 if(!p.requires_artwork)document.querySelector('#artworkNote').innerHTML='<strong>Arte do produto</strong><span>Este produto não exige envio de arte do cliente.</span>';
}

function renderVariantMatrix(variants,p){
 const box=document.querySelector('#variantMatrixBox');
 const rows=document.querySelector('#variantMatrixRows');
 if(!box||!rows||!variants.length)return;
 box.hidden=false;
 const priceLink=document.querySelector('#categoryPriceLink');
 if(priceLink&&p.category_slug)priceLink.href=`/precos.html?category=${encodeURIComponent(p.category_slug)}`;
 rows.innerHTML=variants.map(v=>`<tr><td><strong>${esc(v.name)}</strong>${v.external_code||v.sku?`<small>${esc(v.external_code||v.sku)}</small>`:''}</td><td>${v.quantity?esc(v.quantity):'—'}</td><td>${esc(v.size_label||'—')}</td><td>${esc(v.print_configuration||'—')}</td><td>${v.production_days?`${esc(v.production_days)} dia(s)`:'—'}${v.availability==='on_request'?'<small class="matrix-warning">sob consulta</small>':''}</td><td><strong class="matrix-price">${Number(v.public_price||0)>0?money.format(Number(v.public_price)):'Sob consulta'}</strong></td><td><div class="matrix-actions"><button type="button" class="matrix-select" data-variant-id="${v.id}" ${Number(v.public_price||0)<=0?'disabled':''}>Selecionar</button>${v.gabarito_url?'<a href="#templatesBox">Gabaritos</a>':''}</div></td></tr>`).join('');
 rows.addEventListener('click',e=>{const button=e.target.closest('[data-variant-id]');if(!button)return;variantSelect.value=button.dataset.variantId;variantSelect.dispatchEvent(new Event('change'));document.querySelector('.config-panel')?.scrollIntoView({behavior:'smooth',block:'start'});});
}

async function load(){
 if(!slug){document.querySelector('#productName').textContent='Produto não informado';variantSelect.innerHTML='<option>Sem produto</option>';return;}
 try{product=await api(`/api/v1/configurator/${encodeURIComponent(slug)}`);}catch{document.querySelector('#productName').textContent='Produto indisponível';document.querySelector('#productDescription').textContent='Este produto não está publicado ou foi removido do catálogo.';variantSelect.innerHTML='<option>Sem opções</option>';return;}
 const p=product.product;
 document.title=`${p.name} · Central Prints`;
 document.querySelector('#productName').textContent=p.name;
 document.querySelector('#breadcrumbName').textContent=p.name;
 document.querySelector('#categoryName').textContent=p.category_name||'Produto gráfico';
 document.querySelector('#productDescription').textContent=safeText(p.short_description)||'Configure as opções disponíveis para este produto.';
 document.querySelector('#productLongDescription').innerHTML=renderDescription(p.description||p.short_description);
 renderFlags(p);renderGallery(p);
 const [verifiedResult,generatedResult]=await Promise.allSettled([api(`/api/v1/products/${encodeURIComponent(slug)}/templates`),api(`/api/v1/products/${encodeURIComponent(slug)}/generated-gabaritos`)]);
 renderTemplates(p,verifiedResult.status==='fulfilled'?(verifiedResult.value.items||[]):[],generatedResult.status==='fulfilled'?(generatedResult.value.items||[]):[]);
 const variants=(product.variants||[]).filter(v=>v.availability!=='unavailable');
 renderVariantMatrix(variants,p);
 variantSelect.innerHTML='<option value="">Selecione uma opção</option>'+variants.map(v=>`<option value="${v.id}">${esc(v.name)}${Number(v.public_price||0)>0?` · ${money.format(Number(v.public_price))}`:''}</option>`).join('');
 if(!variants.length){variantSelect.innerHTML='<option value="">Nenhuma opção publicada</option>';variantSelect.disabled=true;detail.textContent='Este produto ainda não possui uma variante disponível para compra.';}
}

variantSelect.addEventListener('change',()=>{
 const v=product?.variants?.find(x=>String(x.id)===variantSelect.value);
 feedback.textContent='';
 if(!v){priceEl.textContent='—';detail.textContent='Selecione uma opção para ver medidas, impressão e prazo.';addToCart.disabled=true;return;}
 priceEl.textContent=Number(v.public_price||0)>0?money.format(Number(v.public_price)):'Sob consulta';
 detail.innerHTML=[
   v.quantity?`Quantidade do lote: <b>${esc(v.quantity)}</b>`:'',
   v.size_label?`Tamanho: <b>${esc(v.size_label)}</b>`:'',
   v.print_configuration?`Impressão: <b>${esc(v.print_configuration)}</b>`:'',
   v.production_days?`Produção estimada: <b>${esc(v.production_days)} dia(s)</b>`:'',
   v.availability==='on_request'?'Disponibilidade: <b>sob consulta</b>':'Disponibilidade: <b>disponível</b>',
   v.gabarito_url?'Gabaritos: <a href="#templatesBox">usar o botão BAIXAR GABARITOS abaixo</a>':''
 ].filter(Boolean).join('<br>');
 addToCart.disabled=Number(v.public_price||0)<=0;
 if(addToCart.disabled)feedback.textContent='Esta opção ainda não possui preço público liberado para pedido online.';
});

document.querySelector('#configForm').addEventListener('submit',e=>{
 e.preventDefault();
 const v=product?.variants?.find(x=>String(x.id)===variantSelect.value);
 if(!v||Number(v.public_price||0)<=0){feedback.textContent='Selecione uma opção com preço publicado.';return;}
 const items=cart();
 const configuration={notes:document.querySelector('#notes').value.trim(),artwork:{front:Boolean(product.product.supports_front),back:Boolean(product.product.supports_back)}};
 const existing=items.find(i=>i.variantId===Number(v.id)&&JSON.stringify(i.configuration)===JSON.stringify(configuration));
 if(existing)existing.lots=Math.min(20,Number(existing.lots||1)+1);
 else items.push({variantId:Number(v.id),lots:1,productName:product.product.name,variantName:v.name,displayPrice:Number(v.public_price||0),configuration});
 saveCart(items);location.href='/checkout.html';
});

updateCount();
await load();
