let menuReady=false;

function esc(value=''){return String(value).replace(/[&<>'\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[ch]));}

async function loadCategories(){
  const response=await fetch('/api/v1/categories',{headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(`HTTP_${response.status}`);
  const data=await response.json();
  return Array.isArray(data.items)?data.items:[];
}

function buildGroups(items){
  const byId=new Map(items.map(item=>[Number(item.id),item]));
  const active=items.filter(item=>Number(item.product_count||0)>0);
  const groups=new Map();
  const standalone=[];

  for(const item of active){
    const parentId=Number(item.parent_id||0);
    const parent=parentId?byId.get(parentId):null;
    if(parent){
      const key=Number(parent.id);
      if(!groups.has(key))groups.set(key,{parent,children:[]});
      groups.get(key).children.push(item);
    }else{
      standalone.push(item);
    }
  }

  const result=[...groups.values()].map(group=>({
    title:group.parent.name,
    slug:Number(group.parent.product_count||0)>0?group.parent.slug:null,
    items:group.children.sort((a,b)=>Number(b.product_count||0)-Number(a.product_count||0)||String(a.name).localeCompare(String(b.name),'pt-BR'))
  }));

  if(standalone.length){
    result.push({
      title:'Outros produtos',
      slug:null,
      items:standalone.sort((a,b)=>Number(b.product_count||0)-Number(a.product_count||0)||String(a.name).localeCompare(String(b.name),'pt-BR'))
    });
  }

  return result.sort((a,b)=>String(a.title).localeCompare(String(b.title),'pt-BR'));
}

function groupMarkup(group){
  const titleLink=group.slug?`<a class="mega-menu-group-title" href="/catalogo.html?category=${encodeURIComponent(group.slug)}">${esc(group.title)}</a>`:`<strong class="mega-menu-group-title">${esc(group.title)}</strong>`;
  const links=group.items.map(item=>`<a class="mega-menu-link" href="/catalogo.html?category=${encodeURIComponent(item.slug)}"><span>${esc(item.name)}</span><small>${Number(item.product_count||0).toLocaleString('pt-BR')}</small></a>`).join('');
  return `<section class="mega-menu-group">${titleLink}<div class="mega-menu-group-links">${links}</div></section>`;
}

export async function setupProductMenu(){
  if(menuReady)return;
  const navrow=document.querySelector('.navrow');
  const trigger=navrow?.querySelector('.all-products');
  if(!navrow||!trigger)return;
  menuReady=true;

  trigger.setAttribute('role','button');
  trigger.setAttribute('aria-expanded','false');
  trigger.setAttribute('aria-haspopup','true');

  const menu=document.createElement('div');
  menu.className='product-mega-menu benchmark-mega-menu';
  menu.hidden=true;
  menu.innerHTML='<div class="container mega-menu-panel"><div class="loading compact">Carregando produtos…</div></div>';
  navrow.appendChild(menu);
  const panel=menu.querySelector('.mega-menu-panel');

  const close=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
  const open=()=>{menu.hidden=false;trigger.setAttribute('aria-expanded','true');};
  const toggle=()=>menu.hidden?open():close();

  trigger.addEventListener('click',event=>{event.preventDefault();toggle();});
  trigger.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle();}});
  document.addEventListener('click',event=>{if(!menu.hidden&&!navrow.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});

  try{
    const items=await loadCategories();
    const groups=buildGroups(items);
    const populated=items.filter(item=>Number(item.product_count||0)>0).length;
    panel.innerHTML=`<div class="mega-menu-head"><div><span>Catálogo completo</span><strong>Todos os produtos</strong></div><a class="mega-menu-all" href="/catalogo.html">Ver os ${populated.toLocaleString('pt-BR')} grupos/produtos →</a></div><div class="mega-menu-columns">${groups.map(groupMarkup).join('')}</div>`;
  }catch{
    panel.innerHTML='<a class="mega-menu-all standalone" href="/catalogo.html">Ver todos os produtos →</a>';
  }
}
