let token=sessionStorage.getItem('cp-admin-token')||'';
let user=null;
let categories=[];
let products=[];
let selectedId=null;
const productList=document.querySelector('#productList');
const productEditor=document.querySelector('#productEditor');
const categoryList=document.querySelector('#categoryList');
const esc=(v='')=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(url,options={}){
 const response=await fetch(url,{...options,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...options.headers}});
 const data=await response.json().catch(()=>({}));
 if(response.status===401){sessionStorage.removeItem('cp-admin-token');location.href='/admin/';throw new Error('UNAUTHORIZED');}
 if(!response.ok)throw Object.assign(new Error(data.error||`HTTP_${response.status}`),{data,status:response.status});
 return data;
}
function numberOrNull(value){if(value===''||value==null)return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function bool(form,name){return Boolean(form.elements[name]?.checked);}
function statusBadge(status){return `<span class="badge ${status==='active'?'':status==='draft'?'warn':'danger'}">${esc(status)}</span>`;}

async function loadRuntime(){try{const r=await fetch('/api/ready');const d=await r.json();document.querySelector('#editorRuntime').textContent=r.ok?`Online · DB ${d.database}`:`Atenção · ${d.database}`;}catch{document.querySelector('#editorRuntime').textContent='Indisponível';}}
async function loadCategories(){const d=await api('/api/v1/admin/catalog/categories');categories=d.items||[];renderCategories();}
function renderCategories(){categoryList.innerHTML=categories.length?categories.map(c=>`<div class="category-row"><div><strong>${esc(c.name)}</strong><small>${Number(c.product_count||0)} produto(s) · ${esc(c.status)}</small></div><span>${statusBadge(c.status)}</span></div>`).join(''):'<div class="editor-empty">Nenhuma categoria.</div>';}

async function loadProducts(q=''){
 const p=new URLSearchParams();if(q)p.set('q',q);
 const d=await api(`/api/v1/admin/products?${p}`);products=d.items||[];renderProductList();
}
function renderProductList(){productList.innerHTML=products.length?products.map(p=>`<button type="button" data-product-id="${p.id}" class="${Number(selectedId)===Number(p.id)?'active':''}"><strong>${esc(p.name)}</strong><small>${esc(p.category_name||'Sem categoria')} · ${Number(p.variants_count||0)} variante(s) · ${esc(p.status)}</small></button>`).join(''):'<div class="editor-empty">Nenhum produto encontrado.</div>';productList.querySelectorAll('[data-product-id]').forEach(button=>button.addEventListener('click',()=>openProduct(Number(button.dataset.productId))));}
function categoryOptions(selected){return `<option value="">Sem categoria</option>`+categories.map(c=>`<option value="${c.id}" ${Number(selected)===Number(c.id)?'selected':''}>${esc(c.name)}</option>`).join('');}

function renderProductForm(product=null,variants=[]){
 const isNew=!product?.id;
 const p=product||{status:'draft',requires_artwork:1,supports_front:1,supports_back:0,featured:0,sort_order:0,base_price:0};
 productEditor.innerHTML=`<form class="editor-form" id="productForm">
 <label>Nome<input name="name" required minlength="2" maxlength="255" value="${esc(p.name||'')}"></label>
 <label>SKU<input name="sku" maxlength="120" value="${esc(p.sku||'')}"></label>
 <label>Slug<input name="slug" maxlength="190" value="${esc(p.slug||'')}" placeholder="gerado automaticamente"></label>
 <label>Categoria<select name="category_id">${categoryOptions(p.category_id)}</select></label>
 <label>Status<select name="status" ${isNew?'disabled':''}>${['draft','active','paused','archived'].map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`).join('')}</select></label>
 <label>Preço base<input name="base_price" type="number" min="0" step="0.01" value="${Number(p.base_price||0)}"></label>
 <label class="wide">Descrição curta<textarea name="short_description" maxlength="5000">${esc(p.short_description||'')}</textarea></label>
 <label class="wide">Descrição completa<textarea class="long" name="description" maxlength="200000">${esc(p.description||'')}</textarea></label>
 <label>Ordem<input name="sort_order" type="number" step="1" value="${Number(p.sort_order||0)}"></label>
 <label>Destaque<select name="featured"><option value="0" ${!p.featured?'selected':''}>Não</option><option value="1" ${p.featured?'selected':''}>Sim</option></select></label>
 <label><span>Arte obrigatória</span><input name="requires_artwork" type="checkbox" ${p.requires_artwork?'checked':''}></label>
 <label><span>Frente</span><input name="supports_front" type="checkbox" ${p.supports_front?'checked':''}></label>
 <label><span>Verso</span><input name="supports_back" type="checkbox" ${p.supports_back?'checked':''}></label>
 <div class="editor-message" id="productMessage"></div>
 <div class="editor-actions">${!isNew&&p.status==='active'?`<a class="product-preview-link" href="/produto.html?slug=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">Ver produto público ↗</a>`:''}<button class="editor-button primary" type="submit">${isNew?'Criar rascunho':'Salvar produto'}</button></div>
 </form>${isNew?'':variantSection(variants)}`;
 document.querySelector('#productForm').addEventListener('submit',saveProduct);
 if(!isNew)bindVariantActions();
}

function variantSection(variants){
 return `<section class="variant-section"><div class="editor-toolbar"><h3>Variantes</h3><button class="editor-button orange" type="button" id="addVariant">+ Variante</button></div><div id="variantList">${variants.length?variants.map(variantCard).join(''):'<div class="editor-empty">Este produto ainda não possui variantes. Produtos só ficam compráveis quando houver variante ativa com preço público.</div>'}</div></section>`;
}
function variantCard(v){return `<article class="variant-card" data-variant="${v.id}"><header><strong>${esc(v.name)}</strong>${statusBadge(v.status)}</header><div class="variant-grid"><label>Nome<input data-v="name" value="${esc(v.name||'')}"></label><label>SKU<input data-v="sku" value="${esc(v.sku||'')}"></label><label>Código externo<input data-v="external_code" value="${esc(v.external_code||'')}"></label><label>Preço público<input data-v="public_price" type="number" min="0" step="0.01" value="${Number(v.public_price||0)}"></label><label>Custo fornecedor<input data-v="supplier_cost" type="number" min="0" step="0.01" value="${Number(v.supplier_cost||0)}"></label><label>Custo adicional<input data-v="additional_cost" type="number" min="0" step="0.01" value="${Number(v.additional_cost||0)}"></label><label>Quantidade<input data-v="quantity" type="number" min="0.001" step="0.001" value="${Number(v.quantity||1)}"></label><label>Tamanho<input data-v="size_label" value="${esc(v.size_label||'')}"></label><label>Impressão<input data-v="print_configuration" value="${esc(v.print_configuration||'')}"></label><label>Dias produção<input data-v="production_days" type="number" min="0" step="1" value="${v.production_days??''}"></label><label>Disponibilidade<select data-v="availability">${['available','on_request','unavailable'].map(x=>`<option ${v.availability===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Status<select data-v="status"><option ${v.status==='active'?'selected':''}>active</option><option ${v.status==='inactive'?'selected':''}>inactive</option></select></label></div><div class="editor-actions"><button class="editor-button primary" type="button" data-save-variant>Salvar variante</button></div></article>`;}

async function saveProduct(event){
 event.preventDefault();const form=event.currentTarget;const msg=document.querySelector('#productMessage');msg.className='editor-message';msg.textContent='Salvando…';
 const body={name:form.elements.name.value.trim(),sku:form.elements.sku.value.trim()||null,slug:form.elements.slug.value.trim()||null,category_id:numberOrNull(form.elements.category_id.value),short_description:form.elements.short_description.value.trim()||null,description:form.elements.description.value.trim()||null,base_price:Number(form.elements.base_price.value||0),featured:form.elements.featured.value==='1',sort_order:Number(form.elements.sort_order.value||0),requires_artwork:bool(form,'requires_artwork'),supports_front:bool(form,'supports_front'),supports_back:bool(form,'supports_back')};
 try{
  if(selectedId){body.status=form.elements.status.value;if(body.status==='active'){if(user.role!=='super_admin'){throw new Error('Somente Super Admin pode publicar.')}if(!confirm('Publicar este produto individualmente no catálogo público?')){msg.textContent='Publicação cancelada.';return;}body.confirmPublish=true;}await api(`/api/v1/admin/catalog/products/${selectedId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});msg.className='editor-message ok';msg.textContent='Produto salvo.';await loadProducts(document.querySelector('#productSearch').value.trim());await openProduct(selectedId);}
  else{const d=await api('/api/v1/admin/catalog/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});selectedId=d.product.id;await loadProducts();await openProduct(selectedId);}
 }catch(error){msg.className='editor-message error';msg.textContent=`Falha: ${error.message}`;}
}

async function openProduct(id){selectedId=id;renderProductList();productEditor.innerHTML='<div class="editor-empty">Carregando produto…</div>';try{const d=await api(`/api/v1/admin/catalog/products/${id}`);renderProductForm(d.product,d.variants||[]);}catch(error){productEditor.innerHTML=`<div class="editor-empty">Falha: ${esc(error.message)}</div>`;}}
function bindVariantActions(){
 document.querySelector('#addVariant')?.addEventListener('click',()=>{const host=document.querySelector('#variantList');host.insertAdjacentHTML('afterbegin',`<article class="variant-card" id="newVariant"><header><strong>Nova variante</strong><span class="badge warn">nova</span></header><div class="variant-grid"><label>Nome<input data-v="name" placeholder="Ex.: 1000 un. 9x5 cm" required></label><label>SKU<input data-v="sku"></label><label>Código externo<input data-v="external_code"></label><label>Preço público<input data-v="public_price" type="number" min="0" step="0.01" value="0"></label><label>Custo fornecedor<input data-v="supplier_cost" type="number" min="0" step="0.01" value="0"></label><label>Custo adicional<input data-v="additional_cost" type="number" min="0" step="0.01" value="0"></label><label>Quantidade<input data-v="quantity" type="number" min="0.001" step="0.001" value="1"></label><label>Tamanho<input data-v="size_label"></label><label>Impressão<input data-v="print_configuration"></label><label>Dias produção<input data-v="production_days" type="number" min="0" step="1"></label><label>Disponibilidade<select data-v="availability"><option>available</option><option>on_request</option><option>unavailable</option></select></label><label>Status<select data-v="status"><option>active</option><option>inactive</option></select></label></div><div class="editor-actions"><button class="editor-button primary" type="button" id="createVariant">Criar variante</button></div></article>`);document.querySelector('#createVariant').addEventListener('click',createVariant);});
 document.querySelectorAll('[data-save-variant]').forEach(btn=>btn.addEventListener('click',()=>saveVariant(btn.closest('[data-variant]'))));
}
function variantPayload(card){const val=n=>card.querySelector(`[data-v="${n}"]`)?.value??'';return{name:val('name').trim(),sku:val('sku').trim()||null,external_code:val('external_code').trim()||null,public_price:Number(val('public_price')||0),supplier_cost:Number(val('supplier_cost')||0),additional_cost:Number(val('additional_cost')||0),quantity:Number(val('quantity')||1),size_label:val('size_label').trim()||null,print_configuration:val('print_configuration').trim()||null,production_days:numberOrNull(val('production_days')),availability:val('availability'),status:val('status')};}
async function createVariant(){const card=document.querySelector('#newVariant');const body=variantPayload(card);if(!body.name)return alert('Informe o nome da variante.');try{await api(`/api/v1/admin/catalog/products/${selectedId}/variants`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await openProduct(selectedId);await loadProducts(document.querySelector('#productSearch').value.trim());}catch(error){alert(`Falha: ${error.message}`);}}
async function saveVariant(card){const id=Number(card.dataset.variant);try{await api(`/api/v1/admin/catalog/variants/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(variantPayload(card))});await openProduct(selectedId);}catch(error){alert(`Falha: ${error.message}`);}}

async function bootstrap(){
 if(!token){location.href='/admin/';return;}
 try{const d=await api('/api/v1/admin/auth/me');user=d.user;document.querySelector('#editorUser').textContent=user.name;document.querySelector('#editorRole').textContent=user.role;await Promise.all([loadRuntime(),loadCategories(),loadProducts()]);}
 catch{location.href='/admin/';}
}
document.querySelector('#newProduct').addEventListener('click',()=>{selectedId=null;renderProductList();renderProductForm();});
document.querySelector('#productSearch').addEventListener('input',e=>{clearTimeout(window.__cpSearchTimer);window.__cpSearchTimer=setTimeout(()=>loadProducts(e.target.value.trim()),250);});
document.querySelector('#categoryCreate').addEventListener('submit',async e=>{e.preventDefault();const input=document.querySelector('#newCategoryName');try{await api('/api/v1/admin/catalog/categories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:input.value.trim(),status:'active'})});input.value='';await loadCategories();if(selectedId)await openProduct(selectedId);}catch(error){alert(`Falha: ${error.message}`);}});
document.querySelector('#editorLogout').addEventListener('click',async()=>{try{await api('/api/v1/admin/auth/logout',{method:'POST'})}catch{}sessionStorage.removeItem('cp-admin-token');location.href='/admin/';});
await bootstrap();
