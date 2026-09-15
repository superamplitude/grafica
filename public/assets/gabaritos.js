const params=new URLSearchParams(location.search);
const slug=(params.get('slug')||'').trim();
const state=document.querySelector('#templateState');
const title=document.querySelector('#templatePageTitle');
const intro=document.querySelector('#templatePageIntro');
const productLink=document.querySelector('#templateProductLink');
const fileList=document.querySelector('#gabaritoFileList');

const ORDER=['cdr','ai','psd','pdf','svg'];
function esc(value=''){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));}
async function api(url){const response=await fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`HTTP_${response.status}`);return response.json();}
function safeName(value='arquivo'){return String(value||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'arquivo';}
function nativeName(product,item,ext){const ref=item.reference||product.sku||product.slug;return `${safeName(product.name)}-${safeName(ref)}.${ext}`;}
function collectFiles(product,generated){
  const files=[];
  for(const item of product.templates||[]){
    const format=String(item.template_type||'').toLowerCase();
    if(!ORDER.includes(format)||!item.url)continue;
    files.push({format,name:nativeName(product,item,format),url:item.url,native:true});
  }
  for(const item of generated.items||[]){
    for(const format of item.formats||[]){
      const type=String(format.format||'').toLowerCase();
      if(!ORDER.includes(type)||!format.url)continue;
      files.push({format:type,name:format.file_name||`${safeName(product.name)}-${safeName(item.reference||item.code)}.${type}`,url:format.url,native:false});
    }
  }
  const seen=new Set();
  return files.filter(file=>{const key=`${file.format}|${file.name}|${file.url}`;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>ORDER.indexOf(a.format)-ORDER.indexOf(b.format)||a.name.localeCompare(b.name,'pt-BR'));
}
function renderFiles(files){
  if(!files.length){fileList.innerHTML='<p class="gabarito-empty">Nenhum arquivo disponível.</p>';return;}
  fileList.innerHTML=files.map(file=>`<a class="gabarito-file-row" href="${esc(file.url)}" ${file.native?'target="_blank" rel="noopener"':'download'}><span class="gabarito-format">${esc(file.format.toUpperCase())}</span><strong>${esc(file.name)}</strong><span class="gabarito-download">Baixar</span></a>`).join('');
}

async function load(){
  if(!slug){state.textContent='Produto não informado.';return;}
  productLink.href=`/produto.html?slug=${encodeURIComponent(slug)}`;
  try{
    const [product,generated]=await Promise.all([api(`/api/v1/products/${encodeURIComponent(slug)}`),api(`/api/v1/products/${encodeURIComponent(slug)}/generated-gabaritos`)]);
    document.title=`Gabaritos · ${product.name} · Central Prints`;
    title.textContent='Baixar gabaritos';
    intro.textContent=product.name;
    renderFiles(collectFiles(product,generated));
    state.hidden=true;
  }catch(error){
    state.hidden=false;
    state.textContent='Não foi possível carregar os arquivos.';
  }
}

await load();
