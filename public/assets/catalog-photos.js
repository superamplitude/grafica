const PHOTOS={
  cards:'https://images.pexels.com/photos/8947634/pexels-photo-8947634.jpeg?auto=compress&cs=tinysrgb&w=1260',
  flyer:'https://images.pexels.com/photos/8217368/pexels-photo-8217368.jpeg?auto=compress&cs=tinysrgb&w=1260',
  labels:'https://images.pexels.com/photos/8066772/pexels-photo-8066772.png?auto=compress&cs=tinysrgb&w=1260',
  banner:'https://images.pexels.com/photos/12883028/pexels-photo-12883028.jpeg?auto=compress&cs=tinysrgb&w=1260',
  folder:'https://images.pexels.com/photos/8947698/pexels-photo-8947698.jpeg?auto=compress&cs=tinysrgb&w=1260',
  stationery:'https://images.pexels.com/photos/5420979/pexels-photo-5420979.jpeg?auto=compress&cs=tinysrgb&w=1260',
  bags:'https://images.pexels.com/photos/12024975/pexels-photo-12024975.jpeg?auto=compress&cs=tinysrgb&w=1260',
  mug:'https://images.pexels.com/photos/6312237/pexels-photo-6312237.jpeg?auto=compress&cs=tinysrgb&w=1260',
  apparel:'https://images.pexels.com/photos/12025472/pexels-photo-12025472.jpeg?auto=compress&cs=tinysrgb&w=1260',
  generic:'https://images.pexels.com/photos/8533348/pexels-photo-8533348.jpeg?auto=compress&cs=tinysrgb&w=1260'
};

const RULES=[
  [/camiset|camisa|uniforme|vestu[aá]rio|tecido|dtf\b/i,'apparel'],
  [/caneca|copo|squeeze|garrafa/i,'mug'],
  [/sacola|saco\b|embalagem|packaging|caixa/i,'bags'],
  [/banner|lona|wind|faixa|placa|totem|display|backdrop/i,'banner'],
  [/pasta|porta[- ]?document|folder executivo/i,'folder'],
  [/adesiv|r[oó]tulo|rotulo|etiquet|sticker|lacr|vinil|bopp/i,'labels'],
  [/flyer|panfleto|folheto|brochura|encarte|cartaz|folder/i,'flyer'],
  [/cart[aã]o|cartao|crach[aá]|tag\b|im[aã]|marcador/i,'cards'],
  [/papel|timbrado|envelope|bloco|caderno|receitu[aá]rio|convite|calend[aá]rio|agenda|caneta|r[eé]gua/i,'stationery']
];

function productText(item={}){
  return [item.name,item.category_name,item.category_slug,item.slug].filter(Boolean).join(' ');
}

export function catalogPhoto(item={}){
  const text=productText(item);
  const match=RULES.find(([pattern])=>pattern.test(text));
  return PHOTOS[match?.[1]||'generic'];
}

export function preferredProductImage(item={}){
  const primary=item.cover_url||item.image_url||'';
  const technical=item.image_type==='technical_preview'||String(primary).includes('/preview.svg')||String(primary).endsWith('.svg');
  if(primary&&!technical)return primary;
  return catalogPhoto(item);
}

export function wireImageFallbacks(root=document){
  for(const image of root.querySelectorAll('img[data-catalog-photo]')){
    if(image.dataset.fallbackWired==='1')continue;
    image.dataset.fallbackWired='1';
    image.addEventListener('error',()=>{
      const fallback=image.dataset.fallback;
      if(fallback&&image.src!==fallback){image.src=fallback;return;}
      image.closest('.product-image,.main-visual-wrap')?.classList.add('image-load-failed');
    },{once:false});
  }
}
