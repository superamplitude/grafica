import { preferredProductImage, wireImageFallbacks } from './catalog-photos.js';
import { setupProductMenu } from './nav-menu-v3.js';

const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const params=new URLSearchParams(location.search);
const slug=params.get('slug');
const variantSelect=document.querySelector('#variantSelect');
const priceEl=document.querySelector('#itemPrice');
const detail=document.querySelector('#variantDetail');
const addToCart=document.querySelector('#addToCart');
const feedback=document.querySelector('#formFeedback');
const finalOptionField=document.querySelector('#finalOptionField');
const finalOptionSelect=document.querySelector('#finalOptionSelect');
const cart=()=>{try{return JSON.parse(localStorage.getItem('cp-cart')||'[]')}catch{return[]}};
const saveCart=items=>{localStorage.setItem('cp-cart',JSON.stringify(items));updateCount();};
const updateCount=()=>{const el=document.querySelector('#cartCount');if(el)el.textContent=cart().reduce((sum,item)=>sum+Number(item.lots||1),0);};
const TEMPLATE_ORDER=['cdr','ai','psd','pdf','svg'];
const DIMENSIONS=[
  {key:'size_label',id:'sizeSelect',label:'Formato'},
  {key:'print_configuration',id:'printSelect',label:'Impressão'},
  {key:'quantity',id:'quantitySelect',label:'Quantidade'},
  {key:'production_days',id:'deadlineSelect',label:'Prazo de produção'}
];

function esc(v=''){return String(v).replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));}
function safeText(v=''){return String(v||'').replace(/\s+/g,' ').trim();}
function safeName(value='arquivo'){return String(value||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'arquivo';}
async function api(url){const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP_${r.status}`);return r.json();}

let product;
let variants=[];
let productTemplateFiles=[];
let selection={};
let selectedVariant=null;
let matrixLimit=24;

function renderDescription(text){
  const clean=String(text||'').trim();
  if(!clean)return '<p>As informações detalhadas deste produto estão sendo preparadas.</p>';
  return clean.split(/\n{2,}/).map(block=>`<p>${esc(block).replace(/\n/g,'<br>')}</p>`).join('');
}

function renderGallery(p){
  const realVisuals=(product.visuals||[]).filter(v=>v.url&&v.role!=='technical_preview'&&v.visual_type!=='technical_preview'&&!String(v.url).includes('/preview.svg'));
  const fallbackPhoto=preferredProductImage(p);
  const visuals=realVisuals.length?realVisuals:[{role:'cover',url:fallbackPhoto,visual_type:'reference_photo'}];
  const gallery=document.querySelector('#gallery');
  const first=visuals.find(v=>v.role==='cover')||visuals[0];
  const technical=p.technical_preview_url||'';
  gallery.innerHTML=`<div class="main-visual-wrap"><img id="mainVisual" src="${esc(first.url)}" alt="${esc(p.name)}" data-catalog-photo data-fallback="${esc(technical)}"></div>`+(visuals.length>1?`<div class="gallery-list">${visuals.map(v=>`<button type="button" data-url="${esc(v.url)}" aria-label="Ver outra imagem"><img src="${esc(v.url)}" alt="" data-catalog-photo data-fallback="${esc(technical)}"></button>`).join('')}</div>`:'');
  gallery.onclick=e=>{const b=e.target.closest('[data-url]');const main=document.querySelector('#mainVisual');if(b&&main)main.src=b.dataset.url;};
  wireImageFallbacks(gallery);
}

function collectTemplateFiles(p,verified=[],generated=[]){
  const files=[];
  for(const item of verified){
    const format=String(item.template_type||'').toLowerCase();
    if(!TEMPLATE_ORDER.includes(format)||!item.url)continue;
    const ref=item.reference||p.slug;
    files.push({format,name:`${safeName(p.name)}-${safeName(ref)}.${format}`,url:item.url,native:true,reference:String(ref||'')});
  }
  for(const item of generated){
    for(const f of item.formats||[]){
      const format=String(f.format||'').toLowerCase();
      if(!TEMPLATE_ORDER.includes(format)||!f.url)continue;
      const ref=item.reference||item.code;
      files.push({format,name:f.file_name||`${safeName(p.name)}-${safeName(ref)}.${format}`,url:f.url,native:false,reference:String(ref||'')});
    }
  }
  const seen=new Set();
  return files.filter(file=>{const key=`${file.format}|${file.name}|${file.url}`;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>TEMPLATE_ORDER.indexOf(a.format)-TEMPLATE_ORDER.indexOf(b.format)||a.name.localeCompare(b.name,'pt-BR'));
}

function filesForVariant(v){
  if(!productTemplateFiles.length)return [];
  const code=String(v?.external_code||v?.sku||'');
  const exact=code?productTemplateFiles.filter(file=>file.reference===code):[];
  const generic=productTemplateFiles.filter(file=>!file.reference||file.reference===product?.product?.slug);
  if(exact.length)return [...exact,...generic];
  return productTemplateFiles;
}

function formatLinks(files=[]){
  const byFormat=new Map();
  for(const file of files){if(TEMPLATE_ORDER.includes(file.format)&&file.url&&!byFormat.has(file.format))byFormat.set(file.format,file);}
  return TEMPLATE_ORDER.map((format,index)=>{
    const file=byFormat.get(format);
    const separator=index?'<span class="gabarito-format-separator">|</span>':'';
    const label=esc(format.toUpperCase());
    const entry=file?`<a class="gabarito-format-link" href="${esc(file.url)}" title="${esc(file.name)}" ${file.native?'target="_blank" rel="noopener"':`download="${esc(file.name)}"`}>${label}</a>`:`<span class="gabarito-format-unavailable" aria-disabled="true">${label}</span>`;
    return `${separator}${entry}`;
  }).join('');
}

function renderSelectedTemplates(v){
  const box=document.querySelector('#templatesBox');
  const files=filesForVariant(v);
  if(!box)return;
  if(!files.length){box.hidden=true;box.innerHTML='';return;}
  box.hidden=false;
  box.innerHTML=`<button type="button" class="btn secondary gabarito-toggle" id="gabaritoToggle" aria-expanded="false">GABARITO</button><div class="product-gabarito-list gabarito-format-bar" id="productGabaritoList" hidden>${formatLinks(files)}</div>`;
  const toggle=box.querySelector('#gabaritoToggle');
  const list=box.querySelector('#productGabaritoList');
  toggle?.addEventListener('click',()=>{const open=list.hidden;list.hidden=!open;toggle.setAttribute('aria-expanded',String(open));});
}

function renderFlags(p){
  const flags=[];
  if(p.requires_artwork)flags.push('Requer arte');
  if(p.supports_front&&p.supports_back)flags.push('Frente e verso');
  else if(p.supports_front)flags.push('Frente');
  document.querySelector('#productFlags').innerHTML=flags.map(x=>`<span>${esc(x)}</span>`).join('');
  if(!p.requires_artwork)document.querySelector('#artworkNote').innerHTML='<strong>Arte do produto</strong><span>Este produto não exige envio de arte do cliente.</span>';
}

function dimensionValue(v,key){
  if(key==='quantity'||key==='production_days')return String(Number(v?.[key]||0));
  return String(v?.[key]||'').trim()||'—';
}

function dimensionLabel(key,value){
  if(value==='—')return 'Não informado';
  if(key==='quantity')return `${Number(value).toLocaleString('pt-BR')} un.`;
  if(key==='production_days')return `${Number(value)} dia(s)`;
  return value;
}

function priceNumber(v){const n=Number(v?.public_price||0);return n>0?n:Number.MAX_SAFE_INTEGER;}
function cheapest(list){return [...list].sort((a,b)=>priceNumber(a)-priceNumber(b)||Number(a.id)-Number(b.id))[0]||null;}
function valuesFor(key,list){
  const values=[...new Set(list.map(v=>dimensionValue(v,key)))];
  if(key==='quantity'||key==='production_days')return values.sort((a,b)=>Number(a)-Number(b));
  return values.sort((a,b)=>String(a).localeCompare(String(b),'pt-BR',{numeric:true}));
}
function matchesSelections(v,until=DIMENSIONS.length-1){
  return DIMENSIONS.every((dim,index)=>index>until||!selection[dim.key]||dimensionValue(v,dim.key)===selection[dim.key]);
}

function seedSelection(v){
  if(!v)return;
  for(const dim of DIMENSIONS)selection[dim.key]=dimensionValue(v,dim.key);
}

function renderDimensionSelect(dim,index){
  const select=document.querySelector(`#${dim.id}`);
  const field=select?.closest('.config-choice');
  if(!select||!field)return;
  const priorPool=variants.filter(v=>DIMENSIONS.slice(0,index).every(prev=>!selection[prev.key]||dimensionValue(v,prev.key)===selection[prev.key]));
  const options=valuesFor(dim.key,priorPool.length?priorPool:variants);
  if(!options.length){field.hidden=true;return;}
  field.hidden=false;
  if(!options.includes(selection[dim.key]))selection[dim.key]=options[0];
  select.innerHTML=options.map(value=>`<option value="${esc(value)}" ${value===selection[dim.key]?'selected':''}>${esc(dimensionLabel(dim.key,value))}</option>`).join('');
}

function updateSelectedVariant(v){
  selectedVariant=v||null;
  variantSelect.value=v?String(v.id):'';
  feedback.textContent='';
  if(!v){
    priceEl.textContent='—';
    detail.textContent='Não encontramos uma combinação disponível.';
    addToCart.disabled=true;
    renderSelectedTemplates(null);
    return;
  }
  priceEl.textContent=Number(v.public_price||0)>0?money.format(Number(v.public_price)):'Sob consulta';
  const code=v.external_code||v.sku||'';
  detail.innerHTML=`<strong>${esc(v.name||'Opção selecionada')}</strong>${code?`<span class="selected-code">Referência: ${esc(code)}</span>`:''}`;
  addToCart.disabled=Number(v.public_price||0)<=0;
  if(addToCart.disabled)feedback.textContent='Esta combinação está sob consulta.';
  renderSelectedTemplates(v);
}

function renderFinalChoice(candidates){
  if(!finalOptionField||!finalOptionSelect)return cheapest(candidates);
  if(candidates.length<=1){finalOptionField.hidden=true;finalOptionSelect.innerHTML='';return candidates[0]||null;}
  finalOptionField.hidden=false;
  const current=candidates.find(v=>String(v.id)===String(finalOptionSelect.value))||cheapest(candidates);
  finalOptionSelect.innerHTML=candidates.sort((a,b)=>priceNumber(a)-priceNumber(b)).map(v=>`<option value="${v.id}" ${String(v.id)===String(current?.id)?'selected':''}>${esc(v.name)} · ${Number(v.public_price||0)>0?money.format(Number(v.public_price)):'Sob consulta'}</option>`).join('');
  return current;
}

function renderConfigurator(changedIndex=null){
  if(!variants.length)return updateSelectedVariant(null);
  if(changedIndex!==null){
    const compatible=variants.filter(v=>matchesSelections(v,changedIndex));
    const best=cheapest(compatible);
    if(best){for(let i=changedIndex+1;i<DIMENSIONS.length;i++)selection[DIMENSIONS[i].key]=dimensionValue(best,DIMENSIONS[i].key);}
  }
  DIMENSIONS.forEach(renderDimensionSelect);
  const candidates=variants.filter(v=>matchesSelections(v));
  const chosen=renderFinalChoice(candidates);
  updateSelectedVariant(chosen);
}

function bindConfigurator(){
  DIMENSIONS.forEach((dim,index)=>{
    const select=document.querySelector(`#${dim.id}`);
    select?.addEventListener('change',()=>{selection[dim.key]=select.value;renderConfigurator(index);});
  });
  finalOptionSelect?.addEventListener('change',()=>{
    const v=variants.find(item=>String(item.id)===String(finalOptionSelect.value));
    updateSelectedVariant(v||null);
  });
}

function matrixRowsMarkup(list){
  return list.map(v=>`<tr><td><strong>${esc(v.name)}</strong>${v.external_code||v.sku?`<small>${esc(v.external_code||v.sku)}</small>`:''}</td><td>${v.quantity?Number(v.quantity).toLocaleString('pt-BR'):'—'}</td><td>${esc(v.size_label||'—')}</td><td>${esc(v.print_configuration||'—')}</td><td>${v.production_days?`${esc(v.production_days)} dia(s)`:'—'}</td><td><strong class="matrix-price">${Number(v.public_price||0)>0?money.format(Number(v.public_price)):'Sob consulta'}</strong></td><td><button type="button" class="matrix-select" data-variant-id="${v.id}" ${Number(v.public_price||0)<=0?'disabled':''}>Selecionar</button></td></tr>`).join('');
}

function renderMatrix(){
  const box=document.querySelector('#variantMatrixBox');
  const rows=document.querySelector('#variantMatrixRows');
  if(!box||!rows||!variants.length)return;
  box.hidden=false;
  rows.innerHTML=matrixRowsMarkup(variants.slice(0,matrixLimit));
  box.querySelector('.matrix-more-wrap')?.remove();
  if(variants.length>matrixLimit){
    const wrap=document.createElement('div');wrap.className='matrix-more-wrap';wrap.innerHTML=`<button type="button" class="matrix-more">Mostrar mais (${variants.length-matrixLimit})</button>`;box.appendChild(wrap);wrap.querySelector('button').onclick=()=>{matrixLimit+=24;renderMatrix();};
  }
  rows.onclick=e=>{
    const button=e.target.closest('[data-variant-id]');
    if(!button)return;
    const v=variants.find(item=>String(item.id)===String(button.dataset.variantId));
    if(!v)return;
    seedSelection(v);finalOptionSelect.value=String(v.id);renderConfigurator();
    document.querySelector('.benchmark-config-card')?.scrollIntoView({behavior:'smooth',block:'start'});
  };
}

async function load(){
  if(!slug){document.querySelector('#productName').textContent='Produto não informado';return;}
  try{product=await api(`/api/v1/configurator/${encodeURIComponent(slug)}`);}catch{
    document.querySelector('#productName').textContent='Produto indisponível';
    document.querySelector('#productDescription').textContent='Este produto não está publicado ou foi removido do catálogo.';
    return;
  }

  const p=product.product;
  document.title=`${p.name} · Central Prints`;
  document.querySelector('#productName').textContent=p.name;
  document.querySelector('#breadcrumbName').textContent=p.name;
  document.querySelector('#categoryName').textContent=p.category_name||'Produto gráfico';
  document.querySelector('#productDescription').textContent=safeText(p.short_description)||'Escolha as opções e confira o preço.';
  document.querySelector('#productLongDescription').innerHTML=renderDescription(p.description||p.short_description);
  renderFlags(p);renderGallery(p);

  variants=(product.variants||[]).filter(v=>v.availability!=='unavailable');
  matrixLimit=24;
  const initial=cheapest(variants.filter(v=>Number(v.public_price||0)>0))||cheapest(variants);
  seedSelection(initial);
  renderMatrix();
  const priceLink=document.querySelector('#categoryPriceLink');
  if(priceLink&&p.category_slug)priceLink.href=`/precos.html?category=${encodeURIComponent(p.category_slug)}`;

  const [verifiedResult,generatedResult]=await Promise.allSettled([
    api(`/api/v1/products/${encodeURIComponent(slug)}/templates`),
    api(`/api/v1/products/${encodeURIComponent(slug)}/generated-gabaritos`)
  ]);
  productTemplateFiles=collectTemplateFiles(p,verifiedResult.status==='fulfilled'?(verifiedResult.value.items||[]):[],generatedResult.status==='fulfilled'?(generatedResult.value.items||[]):[]);
  renderConfigurator();
}

document.querySelector('#configForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  const v=selectedVariant;
  if(!v||Number(v.public_price||0)<=0){feedback.textContent='Selecione uma combinação com preço publicado.';return;}
  const items=cart();
  const configuration={notes:document.querySelector('#notes').value.trim(),artwork:{front:Boolean(product.product.supports_front),back:Boolean(product.product.supports_back)}};
  const existing=items.find(i=>i.variantId===Number(v.id)&&JSON.stringify(i.configuration)===JSON.stringify(configuration));
  if(existing)existing.lots=Math.min(20,Number(existing.lots||1)+1);
  else items.push({variantId:Number(v.id),lots:1,productName:product.product.name,variantName:v.name,displayPrice:Number(v.public_price||0),configuration});
  saveCart(items);location.href='/checkout.html';
});

document.querySelector('#productSearch')?.addEventListener('submit',e=>{
  e.preventDefault();
  const q=document.querySelector('#productSearchInput')?.value.trim()||'';
  location.href=`/catalogo.html${q?`?q=${encodeURIComponent(q)}`:''}`;
});

bindConfigurator();
setupProductMenu();
updateCount();
await load();
