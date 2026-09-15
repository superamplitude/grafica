function xml(value='') {
  return String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
}

export function parseSizeMm(label) {
  const text=String(label||'').trim().replace(/,/g,'.');
  const match=text.match(/^(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)(?:\s*mm)?$/i);
  if(!match) return null;
  const width=Number(match[1]);
  const height=Number(match[2]);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) return null;
  return { width_mm:width, height_mm:height };
}

function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function compact(value,max=56){const text=String(value||'').replace(/\s+/g,' ').trim();return text.length>max?`${text.slice(0,max-1).trim()}…`:text;}
function previewKind(name,category){
  const hay=`${category||''} ${name||''}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/adesiv|rotulo|etiquet/.test(hay))return'labels';
  if(/cartao de visita|cartoes de visita/.test(hay))return'cards';
  if(/panfle|flyer|folheto|folder/.test(hay))return'flyer';
  if(/banner|lona|faixa/.test(hay))return'banner';
  if(/placa|display|totem|letra caixa/.test(hay))return'sign';
  if(/caneca|copo|taca|garrafa|squeeze/.test(hay))return'cup';
  if(/sacola|saco|ecobag/.test(hay))return'bag';
  if(/caixa|embalagem/.test(hay))return'box';
  if(/calendario|agenda|caderno|bloco|livro|catalogo/.test(hay))return'book';
  return'print';
}
function previewArtwork(kind){
  const common='stroke="#123c2d" stroke-width="8" stroke-linejoin="round"';
  if(kind==='labels')return `<g ${common} fill="none"><circle cx="-125" cy="0" r="100" fill="#fff7ec"/><rect x="20" y="-105" width="210" height="210" rx="34" fill="#ffffff"/><circle cx="-125" cy="0" r="46" stroke="#ef7d00"/><path d="M55 -45h140M55 0h100M55 45h120" stroke="#ef7d00"/></g>`;
  if(kind==='cards')return `<g ${common}><rect x="-245" y="-105" width="310" height="190" rx="16" fill="#ffffff" transform="rotate(-7)"/><rect x="-40" y="-80" width="310" height="190" rx="16" fill="#fff7ec" transform="rotate(7)"/><path d="M20 -20h170M20 25h125" stroke="#ef7d00" fill="none"/></g>`;
  if(kind==='flyer')return `<g ${common}><rect x="-185" y="-150" width="255" height="300" rx="12" fill="#ffffff" transform="rotate(-7)"/><rect x="-35" y="-135" width="255" height="300" rx="12" fill="#fff7ec" transform="rotate(6)"/><path d="M20 -60h130M20 -12h155M20 36h110M20 84h140" stroke="#ef7d00" fill="none"/></g>`;
  if(kind==='banner')return `<g ${common}><rect x="-250" y="-125" width="500" height="250" rx="12" fill="#ffffff"/><circle cx="-220" cy="-95" r="10" fill="#ef7d00"/><circle cx="220" cy="-95" r="10" fill="#ef7d00"/><circle cx="-220" cy="95" r="10" fill="#ef7d00"/><circle cx="220" cy="95" r="10" fill="#ef7d00"/><path d="M-160 -35h320M-120 25h240" stroke="#ef7d00" fill="none"/></g>`;
  if(kind==='sign')return `<g ${common}><rect x="-230" y="-125" width="460" height="250" rx="20" fill="#ffffff"/><path d="M-150 -35h300M-105 30h210" stroke="#ef7d00" fill="none"/><path d="M-170 125v75M170 125v75" fill="none"/></g>`;
  if(kind==='cup')return `<g ${common}><path d="M-145 -125h245l-20 260c-4 42-38 70-78 70h-65c-40 0-74-28-78-70z" fill="#ffffff"/><path d="M98 -55h50c90 0 90 145 0 145h-58" fill="none"/><circle cx="-20" cy="20" r="55" fill="#fff7ec" stroke="#ef7d00"/></g>`;
  if(kind==='bag')return `<g ${common}><path d="M-170 -70h340l30 260h-400z" fill="#ffffff"/><path d="M-75 -70c0-120 150-120 150 0" fill="none"/><rect x="-90" y="35" width="180" height="85" rx="12" fill="#fff7ec" stroke="#ef7d00"/></g>`;
  if(kind==='box')return `<g ${common}><path d="M-190 -70l190-90 190 90-190 95z" fill="#fff7ec"/><path d="M-190 -70v215L0 235V25z" fill="#ffffff"/><path d="M190 -70v215L0 235V25z" fill="#f3f7f5"/><path d="M0 -160V25" fill="none" stroke="#ef7d00"/></g>`;
  if(kind==='book')return `<g ${common}><path d="M-235 -135h205c45 0 75 20 75 55v275c-20-25-45-35-85-35h-195z" fill="#ffffff"/><path d="M235 -135H30c-45 0-75 20-75 55v275c20-25 45-35 85-35h195z" fill="#fff7ec"/><path d="M0 -90v245" stroke="#ef7d00" fill="none"/></g>`;
  return `<g ${common}><rect x="-225" y="-145" width="450" height="290" rx="18" fill="#ffffff"/><rect x="-175" y="-90" width="350" height="70" rx="12" fill="#fff7ec" stroke="#ef7d00"/><path d="M-160 45h320M-125 92h250" stroke="#ef7d00" fill="none"/></g>`;
}

export function renderProductPreviewSvg({name,category,shortDescription=''}) {
  const rawName=name||'Produto gráfico';
  const title=xml(compact(rawName,52));
  const cat=xml(compact(category||'Central Prints',48));
  const desc=xml(compact(shortDescription,92));
  const kind=previewKind(rawName,category);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" role="img" aria-label="${xml(rawName)}">
  <rect width="1200" height="900" fill="#f4f7f5"/>
  <rect x="54" y="54" width="1092" height="792" rx="38" fill="#ffffff" stroke="#dfe8e2" stroke-width="4"/>
  <rect x="54" y="54" width="1092" height="154" rx="38" fill="#123c2d"/>
  <rect x="54" y="171" width="1092" height="37" fill="#123c2d"/>
  <circle cx="1070" cy="130" r="42" fill="#ef7d00"/>
  <text x="106" y="125" font-family="Arial,Helvetica,sans-serif" font-size="31" font-weight="800" fill="#ffffff">CENTRAL PRINTS</text>
  <text x="106" y="172" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#d5e5dc">${cat}</text>
  <g transform="translate(600 450)">${previewArtwork(kind)}</g>
  <text x="600" y="682" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="37" font-weight="800" fill="#123c2d">${title}</text>
  <text x="600" y="730" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="700" fill="#ef7d00">Imagem técnica neutra</text>
  <text x="600" y="763" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="17" fill="#64756d">Prévia ilustrativa do tipo de produto · não substitui fotografia comercial</text>
  ${desc?`<text x="600" y="802" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="16" fill="#64756d">${desc}</text>`:''}
</svg>`;
}

export function renderVariantGabaritoSvg({code,productName,sizeLabel,printConfiguration}) {
  const parsed=parseSizeMm(sizeLabel);
  const codeText=xml(code||'');
  const product=xml(productName||'Produto gráfico');
  const sizeText=xml(sizeLabel||'Medida não informada');
  const printText=xml(printConfiguration||'Configuração não informada');

  if(!parsed){
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297" role="img" aria-label="Gabarito ${codeText}">
  <rect width="210" height="297" fill="#fff"/>
  <rect x="10" y="10" width="190" height="277" fill="none" stroke="#123c2d" stroke-width="0.8"/>
  <rect x="10" y="10" width="190" height="28" fill="#123c2d"/>
  <text x="15" y="28" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#ffffff">CENTRAL PRINTS · GABARITO TÉCNICO</text>
  <text x="15" y="52" font-family="Arial,sans-serif" font-size="5.5" fill="#173126">${product}</text>
  <text x="15" y="66" font-family="Arial,sans-serif" font-size="4.5" fill="#53675e">Código: ${codeText}</text>
  <text x="15" y="78" font-family="Arial,sans-serif" font-size="4.5" fill="#53675e">Medida da tabela: ${sizeText}</text>
  <text x="15" y="90" font-family="Arial,sans-serif" font-size="4.5" fill="#53675e">Impressão: ${printText}</text>
  <rect x="15" y="108" width="180" height="90" fill="#f4f7f5" stroke="#9fb4a8" stroke-width="0.5" stroke-dasharray="3 2"/>
  <text x="105" y="148" text-anchor="middle" font-family="Arial,sans-serif" font-size="6" fill="#53675e">Medida não convertível automaticamente em milímetros.</text>
  <text x="105" y="161" text-anchor="middle" font-family="Arial,sans-serif" font-size="4.5" fill="#64756d">Use a medida textual acima e confirme acabamento/sangria antes da produção.</text>
  <text x="15" y="255" font-family="Arial,sans-serif" font-size="4" fill="#64756d">Origem dimensional: tabela de preços importada. Sangria/área segura não presumidas.</text>
</svg>`;
  }

  const {width_mm:w,height_mm:h}=parsed;
  const margin=clamp(Math.min(w,h)*0.08,4,20);
  const footer=clamp(Math.min(w,h)*0.18,14,32);
  const vbW=w+margin*2;
  const vbH=h+margin*2+footer;
  const font=clamp(Math.min(w,h)*0.045,2.8,8);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${vbW} ${vbH}" role="img" aria-label="Gabarito ${codeText}">
  <rect width="${vbW}" height="${vbH}" fill="#ffffff"/>
  <rect x="${margin}" y="${margin}" width="${w}" height="${h}" fill="#ffffff" stroke="#ef4444" stroke-width="0.6"/>
  <line x1="${margin}" y1="${margin}" x2="${margin+w}" y2="${margin+h}" stroke="#dfe8e2" stroke-width="0.3"/>
  <line x1="${margin+w}" y1="${margin}" x2="${margin}" y2="${margin+h}" stroke="#dfe8e2" stroke-width="0.3"/>
  <text x="${margin+w/2}" y="${margin+h/2}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${font}" font-weight="700" fill="#123c2d">${product}</text>
  <text x="${margin+w/2}" y="${margin+h/2+font*1.5}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${font*0.72}" fill="#53675e">${sizeText} mm · ${printText}</text>
  <text x="${margin}" y="${margin+h+footer*0.42}" font-family="Arial,sans-serif" font-size="${clamp(font*0.62,2.5,5)}" fill="#173126">Código: ${codeText}</text>
  <text x="${margin}" y="${margin+h+footer*0.72}" font-family="Arial,sans-serif" font-size="${clamp(font*0.52,2.2,4.2)}" fill="#64756d">Linha vermelha = dimensão final informada na tabela (${w} × ${h} mm). Sangria/área segura não presumidas.</text>
</svg>`;
}
