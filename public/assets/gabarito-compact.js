(()=>{
  const ORDER=['CDR','AI','PSD','PDF','SVG'];
  const SELECTOR='.catalog-gabaritos,.product-gabarito-list,.matrix-gabarito-list';

  function labelOf(anchor){
    const text=String(anchor.textContent||'').trim().toUpperCase();
    return ORDER.includes(text)?text:'';
  }

  function compact(box){
    if(!box||box.dataset.compacting==='1')return;
    const anchors=[...box.querySelectorAll('a')];
    if(!anchors.length)return;

    const firstByFormat=new Map();
    for(const anchor of anchors){
      const format=labelOf(anchor);
      if(format&&!firstByFormat.has(format))firstByFormat.set(format,anchor);
    }
    if(!firstByFormat.size)return;

    box.dataset.compacting='1';
    const fragment=document.createDocumentFragment();

    ORDER.forEach((format,index)=>{
      if(index){
        const separator=document.createElement('span');
        separator.className='gabarito-format-separator';
        separator.textContent='|';
        fragment.append(separator);
      }

      const source=firstByFormat.get(format);
      if(source){
        const link=document.createElement('a');
        link.className='gabarito-format-link';
        link.textContent=format;
        link.href=source.href;
        if(source.hasAttribute('download'))link.setAttribute('download',source.getAttribute('download')||'');
        if(source.target)link.target=source.target;
        if(source.rel)link.rel=source.rel;
        fragment.append(link);
      }else{
        const unavailable=document.createElement('span');
        unavailable.className='gabarito-format-unavailable';
        unavailable.textContent=format;
        unavailable.setAttribute('aria-disabled','true');
        fragment.append(unavailable);
      }
    });

    box.replaceChildren(fragment);
    box.classList.add('gabarito-format-bar');
    box.dataset.compacted='1';
    delete box.dataset.compacting;
  }

  function scan(root=document){
    if(root.matches?.(SELECTOR))compact(root);
    root.querySelectorAll?.(SELECTOR).forEach(compact);
  }

  const observer=new MutationObserver(records=>{
    for(const record of records){
      if(record.target?.matches?.(SELECTOR))compact(record.target);
      for(const node of record.addedNodes){
        if(node.nodeType===1)scan(node);
      }
    }
  });

  observer.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scan(),{once:true});
  else scan();
})();
