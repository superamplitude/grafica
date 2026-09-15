import { preferredProductImage, wireImageFallbacks } from './catalog-photos.js';
import { setupProductMenu } from './nav-menu-v3.js';

const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const categoryGrid=document.querySelector('#categoryGrid');
const productGrid=document.querySelector('#productGrid');
const catalogStatus=document.querySelector('#catalogStatus');
const heroSection=document.querySelector('.hero');
const heroVisual=document.querySelector('#heroVisual');
const defaultHeroVisualHtml=heroVisual?.innerHTML||'';
const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false;
let heroCampaigns=[];
let heroIndex=0;
let heroTimer=null;
let heroBase=null;

function escapeHtml(value=''){return String(value).replace(/[&<>'\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[ch]));}
function readCart(){try{return JSON.parse(localStorage.getItem('cp-cart')||'[]')}catch{return[]}}
function updateCartCount(){const el=document.querySelector('#cartCount');if(el)el.textContent=readCart().reduce((sum,item)=>sum+Number(item.lots||1),0);}
async function getJson(url){const response=await fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`HTTP_${response.status}`);return response.json();}

function categoryCard(item){
  return `<a class="category-card" href="/catalogo.html?category=${encodeURIComponent(item.slug)}"><strong>${escapeHtml(item.name)}</strong><span>${Number(item.product_count||0).toLocaleString('pt-BR')} produto(s)</span><i aria-hidden="true">→</i></a>`;
}

function productCard(item){
  const image=preferredProductImage(item);
  const fallback=item.technical_preview_url||'';
  const price=Number(item.starting_price||0)>0?money.format(Number(item.starting_price)):'Sob consulta';
  return `<article class="product-card simple-card"><a class="product-image" href="/produto.html?slug=${encodeURIComponent(item.slug)}"><img src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" data-catalog-photo data-fallback="${escapeHtml(fallback)}"></a><div class="product-body"><h3><a href="/produto.html?slug=${encodeURIComponent(item.slug)}">${escapeHtml(item.name)}</a></h3><div class="price"><small>${price==='Sob consulta'?'Preço':'A partir de'}</small><strong>${price}</strong></div><a class="see-more" href="/produto.html?slug=${encodeURIComponent(item.slug)}">Veja mais</a></div></article>`;
}

function captureHeroBase(){
  heroBase={
    eyebrow:document.querySelector('#heroEyebrow')?.textContent||'',
    title:document.querySelector('#heroTitle')?.textContent||'',
    body:document.querySelector('#heroBody')?.textContent||'',
    primaryLabel:document.querySelector('#heroPrimary')?.textContent||'',
    primaryUrl:document.querySelector('#heroPrimary')?.getAttribute('href')||'/catalogo.html',
    secondaryLabel:document.querySelector('#heroSecondary')?.textContent||'',
    secondaryUrl:document.querySelector('#heroSecondary')?.getAttribute('href')||'#como-funciona'
  };
}

function responsiveCampaignImage(campaign){const mobile=window.matchMedia?.('(max-width:640px)')?.matches;return mobile?(campaign.mobile_url||campaign.desktop_url):(campaign.desktop_url||campaign.mobile_url);}
function clearHeroTimer(){if(heroTimer){clearTimeout(heroTimer);heroTimer=null;}}
function scheduleHero(){clearHeroTimer();if(reducedMotion||heroCampaigns.length<2)return;heroTimer=setTimeout(()=>showHero(heroIndex+1),Math.min(30,Math.max(4,Number(heroCampaigns[heroIndex]?.autoplay_seconds||7)))*1000);}
function updateDots(){document.querySelectorAll('[data-hero-dot]').forEach(dot=>dot.classList.toggle('active',Number(dot.dataset.heroDot)===heroIndex));}
function applyHero(campaign){
  if(!heroBase)captureHeroBase();
  document.querySelector('#heroEyebrow').textContent=campaign?.eyebrow||heroBase.eyebrow;
  document.querySelector('#heroTitle').textContent=campaign?.title||heroBase.title;
  document.querySelector('#heroBody').textContent=campaign?.body||heroBase.body;
  const primary=document.querySelector('#heroPrimary'),secondary=document.querySelector('#heroSecondary');
  primary.textContent=campaign?.cta_label||heroBase.primaryLabel;primary.href=campaign?.cta_url||heroBase.primaryUrl;
  secondary.textContent=campaign?.secondary_cta_label||heroBase.secondaryLabel;secondary.href=campaign?.secondary_cta_url||heroBase.secondaryUrl;
  const image=campaign?responsiveCampaignImage(campaign):null;
  if(image&&heroVisual){heroVisual.style.background=`url("${String(image).replaceAll('"','%22')}") center/cover no-repeat`;heroVisual.innerHTML='';heroVisual.classList.add('has-image');}
  else if(heroVisual){heroVisual.style.background='';heroVisual.innerHTML=defaultHeroVisualHtml;heroVisual.classList.remove('has-image');}
}
function showHero(index){if(!heroCampaigns.length)return;heroIndex=(index+heroCampaigns.length)%heroCampaigns.length;applyHero(heroCampaigns[heroIndex]);updateDots();scheduleHero();}
function setupHero(items=[]){
  heroCampaigns=items.slice(0,6);heroIndex=0;if(heroCampaigns.length)applyHero(heroCampaigns[0]);
  document.querySelector('#heroSliderControls')?.remove();
  if(heroCampaigns.length>1&&heroSection){const controls=document.createElement('div');controls.id='heroSliderControls';controls.className='hero-slider-controls container';controls.innerHTML=`<button type="button" class="hero-arrow" data-hero-prev aria-label="Anterior">‹</button><div class="hero-dots">${heroCampaigns.map((_,i)=>`<button type="button" data-hero-dot="${i}" aria-label="Campanha ${i+1}"></button>`).join('')}</div><button type="button" class="hero-arrow" data-hero-next aria-label="Próxima">›</button>`;heroSection.appendChild(controls);controls.querySelector('[data-hero-prev]').onclick=()=>showHero(heroIndex-1);controls.querySelector('[data-hero-next]').onclick=()=>showHero(heroIndex+1);controls.querySelectorAll('[data-hero-dot]').forEach(dot=>dot.onclick=()=>showHero(Number(dot.dataset.heroDot)));updateDots();}
  scheduleHero();
}

async function loadHomeContent(){
  try{
    const [data,heroData]=await Promise.all([getJson('/api/v1/site/home'),getJson('/api/v1/site/hero')]);
    const blocks=data.blocks||{};
    if(blocks.topbar?.content?.text)document.querySelector('#topbarText').textContent=blocks.topbar.content.text;
    if(blocks.hero){document.querySelector('#heroTitle').textContent=blocks.hero.title||document.querySelector('#heroTitle').textContent;document.querySelector('#heroEyebrow').textContent=blocks.hero.content?.eyebrow||document.querySelector('#heroEyebrow').textContent;document.querySelector('#heroBody').textContent=blocks.hero.content?.body||document.querySelector('#heroBody').textContent;}
    if(blocks.footer?.content?.body)document.querySelector('#footerBody').textContent=blocks.footer.content.body;
    captureHeroBase();setupHero(heroData.items||[]);
  }catch{captureHeroBase();}
}

async function loadCategories(){
  try{
    const data=await getJson('/api/v1/categories');
    const items=(data.items||[]).filter(item=>Number(item.product_count||0)>0).sort((a,b)=>Number(b.product_count||0)-Number(a.product_count||0)||String(a.name).localeCompare(String(b.name),'pt-BR'));
    if(categoryGrid)categoryGrid.innerHTML=items.length?items.slice(0,12).map(categoryCard).join(''):'<div class="empty">Categorias em preparação.</div>';
  }catch{if(categoryGrid)categoryGrid.innerHTML='<div class="empty">Não foi possível carregar as categorias.</div>';}
}

async function loadProducts(){
  productGrid.innerHTML='<div class="loading">Carregando produtos…</div>';
  try{
    let data=await getJson('/api/v1/products?featured=1&limit=12');
    if(!data.items?.length)data=await getJson('/api/v1/products?limit=12');
    productGrid.innerHTML=data.items?.length?data.items.map(productCard).join(''):'<div class="empty">Produtos em preparação.</div>';
    wireImageFallbacks(productGrid);
    if(catalogStatus)catalogStatus.textContent=data.total?`Ver todos (${Number(data.total)}) →`:'Ver catálogo →';
  }catch{productGrid.innerHTML='<div class="empty">Não foi possível carregar os produtos agora.</div>';}
}

const searchForm=document.querySelector('#searchForm');
if(searchForm)searchForm.addEventListener('submit',event=>{event.preventDefault();const q=document.querySelector('#searchInput').value.trim();location.href=`/catalogo.html${q?`?q=${encodeURIComponent(q)}`:''}`;});
window.addEventListener('resize',()=>{if(heroCampaigns.length)applyHero(heroCampaigns[heroIndex]);});
document.addEventListener('visibilitychange',()=>document.visibilityState==='hidden'?clearHeroTimer():scheduleHero());

updateCartCount();
setupProductMenu();
await Promise.allSettled([loadHomeContent(),loadCategories(),loadProducts()]);
