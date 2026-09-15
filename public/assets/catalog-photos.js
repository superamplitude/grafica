const photo=(id,ext='jpeg')=>`https://images.pexels.com/photos/${id}/pexels-photo-${id}.${ext}?auto=compress&cs=tinysrgb&w=1200&h=900&fit=crop`;

// Fotografias reais e livres para uso usadas apenas como fallback comercial.
// Uma capa própria aprovada no painel sempre tem prioridade sobre esta biblioteca.
const PHOTOS=Object.freeze({
  businessCards:photo(8489961),
  flyers:photo(7648516),
  brochures:photo(7648305),
  envelopes:photo(6633050),
  folders:photo(5668837),
  notebooks:photo(12039670),
  calendars:photo(15556833),
  paperBags:photo(25533235),
  boxes:photo(9594430),
  labels:photo(11441227),
  bottles:photo(8217497),
  mugs:photo(6312177),
  apparel:photo(12025472),
  menus:photo(8693898),
  posters:photo(7247514),
  stamps:photo(6445417),
  playingCards:photo(5477760),
  magnets:photo(10252336),
  buttons:photo(14420435),
  tags:photo(9594430),
  catalogs:photo(4841487),
  shipping:photo(6169665),
  flags:photo(34204553),
  stationery:photo(733857),
  genericPrint:photo(8947634)
});

// Regras específicas primeiro. Evita, por exemplo, que envelope, caixa e caderno
// recebam a mesma fotografia genérica de papelaria.
const RULES=[
  [/cart[aã]o\s+(de\s+)?visita|mini\s*cart[aã]o|cart[aã]o\s+duplo|cart[aã]o\s+fidelidade/i,'businessCards'],
  [/envelope|mala\s+direta/i,'envelopes'],
  [/folder\s*\d|folder\b|tr[ií]ptico|dobra/i,'brochures'],
  [/flyer|panfleto|folheto|leaflet|santinho|sant[aã]o|colinha/i,'flyers'],
  [/pasta|porta[- ]?document|arquivo\s+executivo/i,'folders'],
  [/caderno|agenda|planner|bloco\s+de\s+anota|bloco\s+de\s+rascunho|notepad/i,'notebooks'],
  [/calend[aá]rio|folhinha/i,'calendars'],
  [/sacola|saco\s+kraft|shopping\s*bag/i,'paperBags'],
  [/caixa|embalagem\s+para\s+correios|packaging|estojo/i,'boxes'],
  [/r[oó]tulo|rotulo|etiqueta|adesivo|sticker|vinil|bopp|lacre|void|casca\s+de\s+ovo/i,'labels'],
  [/squeeze|garrafa|frasco|bottle/i,'bottles'],
  [/caneca|copo|x[ií]cara|mug/i,'mugs'],
  [/camiset|camisa|uniforme|vestu[aá]rio|tecido|dtf\b/i,'apparel'],
  [/card[aá]pio|menu\b/i,'menus'],
  [/cartaz|p[oô]ster|poster|postal\b|certificado/i,'posters'],
  [/carimbo|stamp/i,'stamps'],
  [/baralho|playing\s*card/i,'playingCards'],
  [/[ií]m[aã]|magnet/i,'magnets'],
  [/botton|button|pin\b|badge/i,'buttons'],
  [/\btag\b|cartela\s+para\s+semijoias|cinta\s+para/i,'tags'],
  [/cat[aá]logo|revista|livro|jornal|plano\s+de\s+governo/i,'catalogs'],
  [/correios|delivery|e-?commerce|expedi[cç][aã]o/i,'shipping'],
  [/bandeira|bandeirola|wind\s*(banner|flag)|ventarola|abanador/i,'flags'],
  [/banner|lona|faixa|backdrop|roll\s*up|display|totem|placa|painel/i,'posters'],
  [/papel\s+timbrado|receitu[aá]rio|recibo|tal[aã]o|comanda|ficha|convite|papelaria/i,'stationery']
];

function productText(item={}){
  return [item.name,item.category_name,item.category_slug,item.slug,item.short_description].filter(Boolean).join(' ');
}

export function catalogPhoto(item={}){
  const text=productText(item);
  const match=RULES.find(([pattern])=>pattern.test(text));
  return PHOTOS[match?.[1]||'genericPrint'];
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
