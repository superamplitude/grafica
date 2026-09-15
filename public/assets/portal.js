const sliderStyles=document.createElement('link');sliderStyles.rel='stylesheet';sliderStyles.href='/assets/portal-slider.css';document.head.appendChild(sliderStyles);
const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const categoryGrid=document.querySelector('#categoryGrid');
const categoryRail=document.querySelector('#categoryRail');
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
let touchStartX=null;

function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));}
function readCart(){try{return JSON.parse(localStorage.getItem('cp-cart')||'[]')}catch{return[]}}
function updateCartCount(){const el=document.querySelector('#cartCount');if(el)el.textContent=readCart().reduce((sum,item)=>sum+Number(item.lots||1),0);}

function categoryCard(item){
  return `<a class="category-card" href="/catalogo.html?category=${encodeURIComponent(item.slug)}"><strong>${escapeHtml(item.name)}</strong><span>${Number(item.product_count||0).toLocaleString('pt-BR')} produto(s)</span><i aria-hidden="true">→</i></a>`;
}
function categoryRailItem(item){
  return `<a href="/catalogo.html?category=${encodeURIComponent(item.slug)}"><span>${escapeHtml(item.name)}</span><b>${Number(item.product_count||0).toLocaleString('pt-BR')}</b></a>`;
}

function productCard(item){
  const image=item.image_url||item.cover_url;
  const imageHtml=image?`<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}" loading="lazy">`:'<span class="image-placeholder" aria-hidden="true"></span>';
  const price=Number(item.starting_price||0)>0?money.format(Number(item.starting_price)):'Sob consulta';
  const variants=Number(item.variants_count||0);
  return `<article class="product-card"><a class="product-image" href="/produto.html?slug=${encodeURIComponent(item.slug)}">${imageHtml}</a><div class="product-body"><span class="badge">${item.requires_artwork?'Personalizável':'Produto gráfico'}</span><h3><a href="/produto.html?slug=${encodeURIComponent(item.slug)}">${escapeHtml(item.name)}</a></h3><p>${escapeHtml(item.short_description||'Configure este produto conforme sua necessidade.')}</p>${variants?`<div class="product-meta"><span>${variants.toLocaleString('pt-BR')} opções</span><span>Escolha prazo e quantidade</span></div>`:''}<div class="price"><small>${price==='Sob consulta'?'Preço':'A partir de'}</small><strong>${price}</strong></div><a class="configure" href="/produto.html?slug=${encodeURIComponent(item.slug)}">Configurar produto</a></div></article>`;
}

async function getJson(url){
  const response=await fetch(url,{headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(`HTTP_${response.status}`);
  return response.json();
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

function responsiveCampaignImage(campaign){
  const mobile=window.matchMedia?.('(max-width: 640px)')?.matches;
  return mobile?(campaign.mobile_url||campaign.desktop_url):(campaign.desktop_url||campaign.mobile_url);
}

function clearHeroTimer(){if(heroTimer){clearTimeout(heroTimer);heroTimer=null;}}
function scheduleHeroTimer(){
  clearHeroTimer();
  if(reducedMotion||heroCampaigns.length<2)return;
  const campaign=heroCampaigns[heroIndex];
  const seconds=Math.min(30,Math.max(3,Number(campaign?.autoplay_seconds||7)));
  heroTimer=setTimeout(()=>showHero((heroIndex+1)%heroCampaigns.length,true),seconds*1000);
}

function updateHeroDots(){
  document.querySelectorAll('[data-hero-dot]').forEach((dot)=>{
    const active=Number(dot.dataset.heroDot)===heroIndex;
    dot.classList.toggle('active',active);
    dot.setAttribute('aria-current',active?'true':'false');
  });
}

function applyHeroCampaign(campaign){
  if(!heroBase)captureHeroBase();
  document.querySelector('#heroEyebrow').textContent=campaign?.eyebrow||heroBase.eyebrow;
  document.querySelector('#heroTitle').textContent=campaign?.title||heroBase.title;
  document.querySelector('#heroBody').textContent=campaign?.body||heroBase.body;
  const primary=document.querySelector('#heroPrimary');
  primary.textContent=campaign?.cta_label||heroBase.primaryLabel;
  primary.href=campaign?.cta_url||heroBase.primaryUrl;
  const secondary=document.querySelector('#heroSecondary');
  secondary.textContent=campaign?.secondary_cta_label||heroBase.secondaryLabel;
  secondary.href=campaign?.secondary_cta_url||heroBase.secondaryUrl;

  const image=campaign?responsiveCampaignImage(campaign):null;
  if(image&&heroVisual){
    heroVisual.style.background=`url("${String(image).replaceAll('"','%22')}") center/cover no-repeat`;
    heroVisual.innerHTML='';
    heroVisual.classList.add('has-image');
  }else if(heroVisual){
    heroVisual.style.background='';
    heroVisual.innerHTML=defaultHeroVisualHtml;
    heroVisual.classList.remove('has-image');
  }
}

function showHero(index,fromAuto=false){
  if(!heroCampaigns.length)return;
  heroIndex=(index+heroCampaigns.length)%heroCampaigns.length;
  applyHeroCampaign(heroCampaigns[heroIndex]);
  updateHeroDots();
  if(!fromAuto||document.visibilityState==='visible')scheduleHeroTimer();
}

function renderHeroControls(){
  document.querySelector('#heroSliderControls')?.remove();
  if(heroCampaigns.length<2){scheduleHeroTimer();return;}
  const controls=document.createElement('div');
  controls.id='heroSliderControls';
  controls.className='hero-slider-controls container';
  controls.innerHTML=`<button type="button" class="hero-arrow" data-hero-prev aria-label="Campanha anterior">‹</button><div class="hero-dots" role="tablist" aria-label="Campanhas">${heroCampaigns.map((_,i)=>`<button type="button" data-hero-dot="${i}" aria-label="Campanha ${i+1}"></button>`).join('')}</div><button type="button" class="hero-arrow" data-hero-next aria-label="Próxima campanha">›</button>`;
  heroSection?.appendChild(controls);
  controls.querySelector('[data-hero-prev]').onclick=()=>showHero(heroIndex-1);
  controls.querySelector('[data-hero-next]').onclick=()=>showHero(heroIndex+1);
  controls.querySelectorAll('[data-hero-dot]').forEach((dot)=>dot.onclick=()=>showHero(Number(dot.dataset.heroDot)));
  if(heroSection){
    heroSection.tabIndex=0;
    heroSection.onkeydown=(event)=>{if(event.key==='ArrowLeft'){event.preventDefault();showHero(heroIndex-1)}if(event.key==='ArrowRight'){event.preventDefault();showHero(heroIndex+1)}};
    heroSection.onmouseenter=clearHeroTimer;
    heroSection.onmouseleave=scheduleHeroTimer;
    heroSection.onfocusin=clearHeroTimer;
    heroSection.onfocusout=scheduleHeroTimer;
    heroSection.ontouchstart=(event)=>{touchStartX=event.changedTouches?.[0]?.clientX??null};
    heroSection.ontouchend=(event)=>{const end=event.changedTouches?.[0]?.clientX??null;if(touchStartX==null||end==null)return;const delta=end-touchStartX;touchStartX=null;if(Math.abs(delta)>45)showHero(heroIndex+(delta<0?1:-1))};
  }
  updateHeroDots();
  scheduleHeroTimer();
}

function setupHeroCampaigns(items){
  heroCampaigns=(Array.isArray(items)?items:[]).slice(0,6);
  heroIndex=0;
  if(heroCampaigns.length)applyHeroCampaign(heroCampaigns[0]);
  renderHeroControls();
}

async function loadHomeContent(){
  try{
    const [data,heroData]=await Promise.all([getJson('/api/v1/site/home'),getJson('/api/v1/site/hero')]);
    const blocks=data.blocks||{};
    if(blocks.topbar?.content?.text)document.querySelector('#topbarText').textContent=blocks.topbar.content.text;
    if(blocks.hero){
      document.querySelector('#heroTitle').textContent=blocks.hero.title||document.querySelector('#heroTitle').textContent;
      document.querySelector('#heroEyebrow').textContent=blocks.hero.content?.eyebrow||document.querySelector('#heroEyebrow').textContent;
      document.querySelector('#heroBody').textContent=blocks.hero.content?.body||document.querySelector('#heroBody').textContent;
      const p=document.querySelector('#heroPrimary'),s=document.querySelector('#heroSecondary');
      if(blocks.hero.content?.primaryLabel)p.textContent=blocks.hero.content.primaryLabel;
      if(blocks.hero.content?.primaryUrl)p.href=blocks.hero.content.primaryUrl;
      if(blocks.hero.content?.secondaryLabel)s.textContent=blocks.hero.content.secondaryLabel;
      if(blocks.hero.content?.secondaryUrl)s.href=blocks.hero.content.secondaryUrl;
    }
    if(blocks.trust?.content?.items?.length){
      document.querySelector('#trustGrid').innerHTML=blocks.trust.content.items.map((item,i)=>`<article><i>${['✓','★','↗','✎','☏'][i]||'✓'}</i><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></div></article>`).join('');
    }
    if(blocks.templates){
      document.querySelector('#templatesTitle').textContent=blocks.templates.title||document.querySelector('#templatesTitle').textContent;
      if(blocks.templates.content?.body)document.querySelector('#templatesBody').textContent=blocks.templates.content.body;
      const cta=document.querySelector('#templatesCta');
      if(blocks.templates.content?.ctaLabel)cta.textContent=blocks.templates.content.ctaLabel;
      if(blocks.templates.content?.ctaUrl)cta.href=blocks.templates.content.ctaUrl;
    }
    if(blocks.footer?.content?.body)document.querySelector('#footerBody').textContent=blocks.footer.content.body;
    captureHeroBase();
    setupHeroCampaigns(heroData.items||[]);
  }catch(error){console.info('Conteúdo editorial indisponível:',error.message);captureHeroBase();}
}

async function loadCategories(){
  try{
    const data=await getJson('/api/v1/categories');
    const items=(data.items||[]).filter(item=>Number(item.product_count||0)>0).sort((a,b)=>Number(b.product_count||0)-Number(a.product_count||0)||String(a.name).localeCompare(String(b.name),'pt-BR'));
    if(categoryRail)categoryRail.innerHTML=items.length?items.slice(0,16).map(categoryRailItem).join(''):'<div class="empty compact">Categorias em preparação.</div>';
    if(categoryGrid)categoryGrid.innerHTML=items.length?items.slice(0,8).map(categoryCard).join(''):'<div class="empty">O catálogo está sendo organizado. Volte em breve para conferir as categorias publicadas.</div>';
  }catch{
    if(categoryRail)categoryRail.innerHTML='<div class="empty compact">Não foi possível carregar as categorias.</div>';
    if(categoryGrid)categoryGrid.innerHTML='<div class="empty">Não foi possível carregar as categorias neste momento.</div>';
  }
}

async function loadProducts(){
  productGrid.innerHTML='<div class="loading">Carregando produtos…</div>';
  try{
    const data=await getJson('/api/v1/products?featured=1&limit=8');
    if(data.items?.length){
      productGrid.innerHTML=data.items.map(productCard).join('');
      if(catalogStatus)catalogStatus.textContent=`Ver todos (${Number(data.total||data.items.length)}) →`;
      return;
    }
    const all=await getJson('/api/v1/products?limit=8');
    productGrid.innerHTML=all.items?.length?all.items.map(productCard).join(''):'<div class="empty">Os primeiros produtos estão em preparação para publicação. Consulte o catálogo para acompanhar as novidades.</div>';
    if(catalogStatus)catalogStatus.textContent=all.total?`Ver todos (${all.total}) →`:'Ver catálogo →';
  }catch{
    productGrid.innerHTML='<div class="empty">Não foi possível carregar os produtos agora. Tente novamente em instantes.</div>';
    if(catalogStatus)catalogStatus.textContent='Ver catálogo →';
  }
}

const searchForm=document.querySelector('#searchForm');
if(searchForm)searchForm.addEventListener('submit',(event)=>{event.preventDefault();const q=document.querySelector('#searchInput').value.trim();location.href=`/catalogo.html${q?`?q=${encodeURIComponent(q)}`:''}`;});
window.addEventListener('resize',()=>{if(heroCampaigns.length)applyHeroCampaign(heroCampaigns[heroIndex])});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')clearHeroTimer();else scheduleHeroTimer()});

updateCartCount();
await Promise.allSettled([loadHomeContent(),loadCategories(),loadProducts()]);
