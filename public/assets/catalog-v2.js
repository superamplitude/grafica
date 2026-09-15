import { preferredProductImage, wireImageFallbacks } from './catalog-photos.js';
import { setupProductMenu } from './nav-menu-v3.js';

const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const grid=document.querySelector('#catalogGrid');
const countEl=document.querySelector('#resultCount');
const titleEl=document.querySelector('#resultTitle');
const categoriesEl=document.querySelector('#categoryFilters');
const summaryEl=document.querySelector('#catalogSummary');
const sortEl=document.querySelector('#sortSelect');
const searchInput=document.querySelector('#catalogSearchInput');
const sidebarSearch=document.querySelector('#sidebarSearch');
const featuredOnly=document.querySelector('#featuredOnly');
const prevBtn=document.querySelector('#prevPage');
const nextBtn=document.querySelector('#nextPage');
const pageLabel=document.querySelector('#pageLabel');
const activeFilters=document.querySelector('#activeFilters');
const sidebar=document.querySelector('#catalogSidebar');
const overlay=document.querySelector('#mobileOverlay');
const pageSize=18;
const state={q:'',category:'',featured:false,sort:'featured',offset:0,total:0,categories:[]};

function esc(value=''){return String(value).replace(/[&<>'\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[ch]));}
function cartCount(){try{return JSON.parse(localStorage.getItem('cp-cart')||'[]').reduce((sum,item)=>sum+Number(item.lots||1),0)}catch{return 0}}
function updateCartCount(){const el=document.querySelector('#cartCount');if(el)el.textContent=cartCount();}
async function getJson(url){const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP_${r.status}`);return r.json();}

function card(item){
 const visual=preferredProductImage(item);
 const fallback=item.technical_preview_url||'';
 const price=Number(item.starting_price||0)>0?money.format(Number(item.starting_price)):'Sob consulta';
 return `<article class="product-card simple-card"><a class="product-image" href="/produto.html?slug=${encodeURIComponent(item.slug)}"><img src="${esc(visual)}" alt="${esc(item.name)}" loading="lazy" decoding="async" data-catalog-photo data-fallback="${esc(fallback)}"></a><div class="product-body"><h3><a href="/produto.html?slug=${encodeURIComponent(item.slug)}">${esc(item.name)}</a></h3><div class="price"><small>${price==='Sob consulta'?'Preço':'A partir de'}</small><strong>${price}</strong></div><a class="see-more" href="/produto.html?slug=${encodeURIComponent(item.slug)}">Veja mais</a></div></article>`;
}

function syncFromUrl(){
 const p=new URLSearchParams(location.search);
 state.q=(p.get('q')||'').slice(0,160);state.category=p.get('category')||'';state.featured=p.get('featured')==='1';state.sort=p.get('sort')||'featured';state.offset=Math.max(0,Number(p.get('offset')||0)||0);
 searchInput.value=state.q;sidebarSearch.value=state.q;featuredOnly.checked=state.featured;sortEl.value=['featured','name','price-asc','price-desc','newest'].includes(state.sort)?state.sort:'featured';
}
function syncUrl(){const p=new URLSearchParams();if(state.q)p.set('q',state.q);if(state.category)p.set('category',state.category);if(state.featured)p.set('featured','1');if(state.sort!=='featured')p.set('sort',state.sort);if(state.offset)p.set('offset',String(state.offset));history.replaceState(null,'',`${location.pathname}${p.toString()?`?${p}`:''}`);}
function renderCategories(){categoriesEl.innerHTML=`<label class="category-filter"><input type="radio" name="catalogCategory" value="" ${!state.category?'checked':''}> Todos <span>${state.categories.reduce((s,x)=>s+Number(x.product_count||0),0)}</span></label>`+state.categories.map(c=>`<label class="category-filter"><input type="radio" name="catalogCategory" value="${esc(c.slug)}" ${state.category===c.slug?'checked':''}> ${esc(c.name)} <span>${Number(c.product_count||0)}</span></label>`).join('');}
function renderFilterChips(){const chips=[];if(state.q)chips.push(`<span class="filter-chip">Busca: ${esc(state.q)}</span>`);if(state.category){const c=state.categories.find(x=>x.slug===state.category);chips.push(`<span class="filter-chip">${esc(c?.name||state.category)}</span>`);}if(state.featured)chips.push('<span class="filter-chip">Destaques</span>');activeFilters.innerHTML=chips.join('');titleEl.textContent=state.category?(state.categories.find(x=>x.slug===state.category)?.name||'Produtos'):(state.q?'Resultado da busca':'Todos os produtos');}
async function loadSummary(){try{const s=await getJson('/api/v1/catalog/summary');summaryEl.innerHTML=`<article><strong>${s.products}</strong><span>Produtos</span></article><article><strong>${s.categories}</strong><span>Categorias</span></article><article><strong>${s.variants}</strong><span>Opções</span></article>`;}catch{}}
async function loadCategories(){try{const d=await getJson('/api/v1/categories');state.categories=d.items||[];renderCategories();renderFilterChips();}catch{categoriesEl.innerHTML='<span class="filter-loading">Categorias indisponíveis.</span>';}}
async function loadProducts(){
 grid.innerHTML='<div class="loading">Carregando catálogo…</div>';
 const p=new URLSearchParams({limit:String(pageSize),offset:String(state.offset),sort:state.sort});if(state.q)p.set('q',state.q);if(state.category)p.set('category',state.category);if(state.featured)p.set('featured','1');
 try{const d=await getJson(`/api/v1/products?${p}`);state.total=Number(d.total||0);grid.innerHTML=d.items?.length?d.items.map(card).join(''):'<div class="empty">Nenhum produto encontrado.</div>';wireImageFallbacks(grid);countEl.textContent=`${state.total} produto(s)`;const page=Math.floor(state.offset/pageSize)+1;const pages=Math.max(1,Math.ceil(state.total/pageSize));pageLabel.textContent=`Página ${page} de ${pages}`;prevBtn.disabled=state.offset===0;nextBtn.disabled=!d.has_more;renderFilterChips();}catch{grid.innerHTML='<div class="empty">O catálogo está temporariamente indisponível.</div>';countEl.textContent='';prevBtn.disabled=true;nextBtn.disabled=true;}
}
async function apply({resetPage=true}={}){state.q=sidebarSearch.value.trim().slice(0,160);searchInput.value=state.q;state.featured=featuredOnly.checked;state.category=document.querySelector('input[name="catalogCategory"]:checked')?.value||'';state.sort=sortEl.value;if(resetPage)state.offset=0;syncUrl();closeFilters();await loadProducts();}
function openFilters(){sidebar.classList.add('open');overlay.classList.add('open');document.body.style.overflow='hidden';}
function closeFilters(){sidebar.classList.remove('open');overlay.classList.remove('open');document.body.style.overflow='';}

document.querySelector('#catalogSearch').addEventListener('submit',e=>{e.preventDefault();sidebarSearch.value=searchInput.value.trim();apply();});
document.querySelector('#applyFilters').addEventListener('click',()=>apply());
document.querySelector('#clearFilters').addEventListener('click',()=>{sidebarSearch.value='';searchInput.value='';featuredOnly.checked=false;const all=document.querySelector('input[name="catalogCategory"][value=""]');if(all)all.checked=true;sortEl.value='featured';apply();});
sortEl.addEventListener('change',()=>{state.sort=sortEl.value;state.offset=0;syncUrl();loadProducts();});
prevBtn.addEventListener('click',()=>{state.offset=Math.max(0,state.offset-pageSize);syncUrl();loadProducts();scrollTo({top:240,behavior:'smooth'});});
nextBtn.addEventListener('click',()=>{state.offset+=pageSize;syncUrl();loadProducts();scrollTo({top:240,behavior:'smooth'});});
document.querySelector('#openFilters').addEventListener('click',openFilters);document.querySelector('#closeFilters').addEventListener('click',closeFilters);overlay.addEventListener('click',closeFilters);document.querySelector('#menuButton').addEventListener('click',openFilters);
window.addEventListener('popstate',async()=>{syncFromUrl();renderCategories();await loadProducts();});

setupProductMenu();syncFromUrl();updateCartCount();await Promise.allSettled([loadSummary(),loadCategories()]);renderCategories();await loadProducts();
