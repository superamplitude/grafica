const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const categoryGrid=document.querySelector('#categoryGrid');
const productGrid=document.querySelector('#productGrid');
const catalogStatus=document.querySelector('#catalogStatus');

function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));}
function readCart(){try{return JSON.parse(localStorage.getItem('cp-cart')||'[]')}catch{return[]}}
function updateCartCount(){const el=document.querySelector('#cartCount');if(el)el.textContent=readCart().reduce((sum,item)=>sum+Number(item.lots||1),0);}

function categoryCard(item){
  return `<a class="category-card" href="/catalogo.html?category=${encodeURIComponent(item.slug)}"><strong>${escapeHtml(item.name)}</strong><span>${Number(item.product_count||0)} produto(s)</span></a>`;
}

function productCard(item){
  const image=item.cover_url?`<img src="${escapeHtml(item.cover_url)}" alt="${escapeHtml(item.name)}" loading="lazy">`:'<span class="image-placeholder" aria-hidden="true"></span>';
  const price=Number(item.starting_price||0)>0?money.format(Number(item.starting_price)):'Sob consulta';
  return `<article class="product-card"><a class="product-image" href="/produto.html?slug=${encodeURIComponent(item.slug)}">${image}</a><div class="product-body"><span class="badge">${item.requires_artwork?'Personalizável':'Produto gráfico'}</span><h3><a href="/produto.html?slug=${encodeURIComponent(item.slug)}">${escapeHtml(item.name)}</a></h3><p>${escapeHtml(item.short_description||'Configure este produto conforme sua necessidade.')}</p><div class="price"><small>${price==='Sob consulta'?'Preço':'A partir de'}</small><strong>${price}</strong></div><a class="configure" href="/produto.html?slug=${encodeURIComponent(item.slug)}">Configurar produto</a></div></article>`;
}

async function getJson(url){
  const response=await fetch(url,{headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(`HTTP_${response.status}`);
  return response.json();
}

async function loadHomeContent(){
  try{
    const data=await getJson('/api/v1/site/home');
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
    const hero=(data.banners||[]).find((b)=>b.placement==='home-hero'&&b.desktop_url);
    if(hero){document.querySelector('#heroVisual').style.background=`url("${hero.desktop_url}") center/cover no-repeat`;document.querySelector('#heroVisual').innerHTML='';}
  }catch(error){console.info('Conteúdo editorial indisponível:',error.message);}
}

async function loadCategories(){
  try{
    const data=await getJson('/api/v1/categories');
    categoryGrid.innerHTML=data.items?.length?data.items.map(categoryCard).join(''):'<div class="empty">O catálogo está sendo organizado. Volte em breve para conferir as categorias publicadas.</div>';
  }catch{categoryGrid.innerHTML='<div class="empty">Não foi possível carregar as categorias neste momento.</div>';}
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

updateCartCount();
await Promise.allSettled([loadHomeContent(),loadCategories(),loadProducts()]);
