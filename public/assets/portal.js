const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const categoryGrid=document.querySelector('#categoryGrid');
const productGrid=document.querySelector('#productGrid');
const catalogStatus=document.querySelector('#catalogStatus');

function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));}

function categoryCard(item){
  return `<a class="category-card" href="#produtos" data-category="${escapeHtml(item.slug)}"><strong>${escapeHtml(item.name)}</strong><span>${Number(item.product_count||0)} produto(s)</span></a>`;
}

function productCard(item){
  const image=item.cover_url?`<img src="${escapeHtml(item.cover_url)}" alt="${escapeHtml(item.name)}" loading="lazy">`:'<span class="image-placeholder" aria-hidden="true"></span>';
  const price=Number(item.starting_price||0)>0?money.format(Number(item.starting_price)):'Sob consulta';
  return `<article class="product-card"><div class="product-image">${image}</div><div class="product-body"><span class="badge">${item.requires_artwork?'Personalizável':'Pronto para configurar'}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.short_description||'Configure este produto conforme sua necessidade.')}</p><div class="price"><small>${price==='Sob consulta'?'Preço':'A partir de'}</small><strong>${price}</strong></div><a class="configure" href="/produto.html?slug=${encodeURIComponent(item.slug)}">Configurar produto</a></div></article>`;
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
  }catch(error){console.info('Conteúdo dinâmico ainda indisponível:',error.message);}
}

async function loadCategories(){
  try{
    const data=await getJson('/api/v1/categories');
    categoryGrid.innerHTML=data.items?.length?data.items.map(categoryCard).join(''):'<div class="empty">As categorias estão sendo preparadas.</div>';
  }catch{categoryGrid.innerHTML='<div class="empty">O catálogo está em preparação.</div>';}
}

async function loadProducts({q='',category='',featured=false}={}){
  productGrid.innerHTML='<div class="loading">Carregando produtos…</div>';
  try{
    const params=new URLSearchParams({limit:'24'});
    if(q)params.set('q',q);if(category)params.set('category',category);if(featured)params.set('featured','1');
    const data=await getJson(`/api/v1/products?${params}`);
    productGrid.innerHTML=data.items?.length?data.items.map(productCard).join(''):'<div class="empty">Nenhum produto publicado para este filtro. Produtos só aparecem após homologação.</div>';
    catalogStatus.textContent=data.items?.length?`${data.items.length} produto(s)`:'';
  }catch{productGrid.innerHTML='<div class="empty">Catálogo ainda não liberado. A infraestrutura está online, mas os produtos permanecem bloqueados até a homologação.</div>';catalogStatus.textContent='';}
}

document.querySelector('#searchForm').addEventListener('submit',(event)=>{event.preventDefault();loadProducts({q:document.querySelector('#searchInput').value.trim()});location.hash='produtos';});
categoryGrid.addEventListener('click',(event)=>{const card=event.target.closest('[data-category]');if(card){event.preventDefault();loadProducts({category:card.dataset.category});location.hash='produtos';}});
document.querySelector('#allProducts').addEventListener('click',()=>loadProducts());

await Promise.allSettled([loadHomeContent(),loadCategories(),loadProducts({featured:true})]);
