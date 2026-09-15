let menuReady=false;

function esc(value=''){return String(value).replace(/[&<>'\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[ch]));}

async function loadCategories(){
  const response=await fetch('/api/v1/categories',{headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(`HTTP_${response.status}`);
  const data=await response.json();
  return (data.items||[])
    .filter(item=>Number(item.product_count||0)>0)
    .sort((a,b)=>Number(b.product_count||0)-Number(a.product_count||0)||String(a.name).localeCompare(String(b.name),'pt-BR'));
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
  menu.className='product-mega-menu';
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
    panel.innerHTML=`<div class="mega-menu-head"><div><span>Produtos</span><strong>Escolha uma categoria</strong></div><a class="mega-menu-all" href="/catalogo.html">Ver todos os produtos →</a></div><div class="mega-menu-grid">${items.map(item=>`<a class="mega-menu-link" href="/catalogo.html?category=${encodeURIComponent(item.slug)}"><span>${esc(item.name)}</span><small>${Number(item.product_count||0).toLocaleString('pt-BR')}</small></a>`).join('')}</div>`;
  }catch{
    panel.innerHTML='<a class="mega-menu-all standalone" href="/catalogo.html">Ver todos os produtos →</a>';
  }
}
