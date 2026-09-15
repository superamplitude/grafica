const params=new URLSearchParams(location.search);
const slug=(params.get('slug')||'').trim();
const state=document.querySelector('#templateState');
const title=document.querySelector('#templatePageTitle');
const intro=document.querySelector('#templatePageIntro');
const productLink=document.querySelector('#templateProductLink');
const verifiedSection=document.querySelector('#verifiedTemplates');
const verifiedGrid=document.querySelector('#verifiedTemplateGrid');
const generatedSection=document.querySelector('#generatedTemplates');
const generatedGrid=document.querySelector('#generatedTemplateGrid');

const FORMAT_LABELS={pdf:'PDF',svg:'SVG',eps:'EPS',cdr:'CDR',ai:'AI',psd:'PSD',indd:'INDD',canva:'Canva',other:'Arquivo'};
function esc(value=''){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));}
async function api(url){const response=await fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`HTTP_${response.status}`);return response.json();}
function formatLabel(type){return FORMAT_LABELS[String(type||'').toLowerCase()]||String(type||'ARQUIVO').toUpperCase();}
function fileLabel(item){return item.version_label||item.label||formatLabel(item.template_type);}
function verifiedCard(item){
  const dims=item.width_mm&&item.height_mm?`${item.width_mm} × ${item.height_mm} mm`:'Medidas no próprio arquivo';
  const side={front:'Frente',back:'Verso',duplex:'Frente e verso',general:'Geral'}[item.side]||item.side||'Geral';
  const fmt=formatLabel(item.template_type);
  const isCanva=String(item.template_type||'').toLowerCase()==='canva';
  const action=isCanva?'Abrir modelo':`Baixar ${fmt}`;
  return `<article class="template-public-card verified"><div class="template-file-icon format">${esc(fmt)}</div><div><span class="template-kind">Arquivo homologado</span><h3>${esc(fileLabel(item))}</h3><p>${esc(side)} · ${esc(dims)}</p>${item.bleed_mm!=null?`<small>Sangria informada: ${esc(item.bleed_mm)} mm</small>`:'<small>Confira sangria e área segura no arquivo.</small>'}</div><div class="template-card-actions"><a class="btn primary" href="${esc(item.url)}" ${isCanva?'target="_blank" rel="noopener"':'download'}>${action}</a></div></article>`;
}
function generatedCard(item){
  const formats=(item.formats||[]).filter(f=>f?.url);
  const buttons=formats.length?formats.map(f=>`<a class="btn ${f.format==='svg'?'primary':'secondary'} format-download" href="${esc(f.url)}" download><strong>${esc(f.label||formatLabel(f.format))}</strong><small>${f.vector?'vetorial':'editável'}</small></a>`).join(''):`<a class="btn primary" href="${esc(item.download_url||`${item.url}?download=1`)}" download>Baixar SVG</a>`;
  return `<article class="template-public-card"><div class="template-file-icon svg">ARQ</div><div><span class="template-kind">Gabarito para download</span><h3>${esc(item.size_label||'Medida da tabela')}</h3><p>${esc(item.print_configuration||'Configuração de impressão')}</p><small>Código ${esc(item.code||'—')} · dimensão final da tabela</small><small class="format-note">SVG e EPS são vetoriais e abrem no CorelDRAW. CDR/AI nativos aparecem quando houver arquivo original homologado.</small></div><div class="template-card-actions format-actions">${buttons}</div></article>`;
}

async function load(){
  if(!slug){
    state.className='template-state error';
    state.innerHTML='<strong>Produto não informado.</strong><span>Abra os gabaritos a partir do catálogo para carregar os arquivos corretos.</span><a class="btn primary" href="/catalogo.html">Ir ao catálogo</a>';
    intro.textContent='Selecione um produto no catálogo para visualizar seus arquivos técnicos.';
    return;
  }
  productLink.href=`/produto.html?slug=${encodeURIComponent(slug)}`;
  try{
    const [product,generated]=await Promise.all([api(`/api/v1/products/${encodeURIComponent(slug)}`),api(`/api/v1/products/${encodeURIComponent(slug)}/generated-gabaritos`)]);
    document.title=`Gabaritos · ${product.name} · Central Prints`;
    title.textContent=`Gabaritos · ${product.name}`;
    intro.textContent=[product.category_name,product.short_description].filter(Boolean).join(' · ')||'Arquivos técnicos disponíveis para este produto.';
    const verified=(product.templates||[]).filter(item=>item.url);
    const generatedItems=(generated.items||[]).filter(item=>item.url);
    if(verified.length){verifiedGrid.innerHTML=verified.map(verifiedCard).join('');verifiedSection.hidden=false;}
    if(generatedItems.length){generatedGrid.innerHTML=generatedItems.map(generatedCard).join('');generatedSection.hidden=false;}
    if(!verified.length&&!generatedItems.length){
      state.className='template-state empty';
      state.innerHTML='<strong>Nenhum gabarito disponível.</strong><span>Este produto ainda não possui arquivo técnico publicado.</span>';
    }else{
      state.hidden=true;
    }
  }catch(error){
    state.hidden=false;
    state.className='template-state error';
    state.innerHTML=`<strong>Não foi possível carregar os gabaritos.</strong><span>${esc(error.message)}. Tente novamente ou volte ao produto.</span><a class="btn secondary" href="/produto.html?slug=${encodeURIComponent(slug)}">Voltar ao produto</a>`;
  }
}

await load();
