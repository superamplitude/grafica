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

export function renderProductPreviewSvg({name,category,shortDescription=''}) {
  const title=xml(name||'Produto gráfico');
  const cat=xml(category||'Central Prints');
  const desc=xml(String(shortDescription||'').slice(0,180));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" role="img" aria-label="${title}">
  <rect width="1200" height="900" fill="#f7f7fb"/>
  <rect x="70" y="70" width="1060" height="760" rx="36" fill="#ffffff" stroke="#e5e7eb" stroke-width="4"/>
  <rect x="70" y="70" width="1060" height="180" rx="36" fill="#301269"/>
  <rect x="70" y="214" width="1060" height="36" fill="#301269"/>
  <text x="120" y="150" font-family="Arial,Helvetica,sans-serif" font-size="32" font-weight="700" fill="#ffffff">CENTRAL PRINTS</text>
  <text x="120" y="205" font-family="Arial,Helvetica,sans-serif" font-size="24" fill="#e9ddff">${cat}</text>
  <g transform="translate(600 460)">
    <rect x="-260" y="-145" width="520" height="290" rx="18" fill="#f3effb" stroke="#7c3aed" stroke-width="6"/>
    <line x1="-220" y1="-95" x2="220" y2="95" stroke="#c4b5fd" stroke-width="8"/>
    <line x1="220" y1="-95" x2="-220" y2="95" stroke="#c4b5fd" stroke-width="8"/>
    <circle cx="0" cy="0" r="52" fill="#ffffff" stroke="#7c3aed" stroke-width="6"/>
  </g>
  <text x="600" y="670" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="700" fill="#1f2937">${title}</text>
  <text x="600" y="720" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#6b7280">Imagem técnica neutra · foto real em revisão quando aplicável</text>
  ${desc?`<text x="600" y="765" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="18" fill="#6b7280">${desc}</text>`:''}
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
  <rect x="10" y="10" width="190" height="277" fill="none" stroke="#301269" stroke-width="0.8"/>
  <text x="15" y="28" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#301269">CENTRAL PRINTS · GABARITO TÉCNICO</text>
  <text x="15" y="48" font-family="Arial,sans-serif" font-size="5.5" fill="#111827">${product}</text>
  <text x="15" y="62" font-family="Arial,sans-serif" font-size="4.5" fill="#374151">Código: ${codeText}</text>
  <text x="15" y="74" font-family="Arial,sans-serif" font-size="4.5" fill="#374151">Medida da tabela: ${sizeText}</text>
  <text x="15" y="86" font-family="Arial,sans-serif" font-size="4.5" fill="#374151">Impressão: ${printText}</text>
  <rect x="15" y="105" width="180" height="90" fill="#f9fafb" stroke="#9ca3af" stroke-width="0.5" stroke-dasharray="3 2"/>
  <text x="105" y="145" text-anchor="middle" font-family="Arial,sans-serif" font-size="6" fill="#6b7280">Medida não convertível automaticamente em milímetros.</text>
  <text x="105" y="158" text-anchor="middle" font-family="Arial,sans-serif" font-size="4.5" fill="#6b7280">Use a medida textual acima e confirme acabamento/sangria antes da produção.</text>
  <text x="15" y="255" font-family="Arial,sans-serif" font-size="4" fill="#6b7280">Origem dimensional: tabela de preços importada. Sangria/área segura não presumidas.</text>
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
  <line x1="${margin}" y1="${margin}" x2="${margin+w}" y2="${margin+h}" stroke="#e5e7eb" stroke-width="0.3"/>
  <line x1="${margin+w}" y1="${margin}" x2="${margin}" y2="${margin+h}" stroke="#e5e7eb" stroke-width="0.3"/>
  <text x="${margin+w/2}" y="${margin+h/2}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${font}" font-weight="700" fill="#301269">${product}</text>
  <text x="${margin+w/2}" y="${margin+h/2+font*1.5}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${font*0.72}" fill="#4b5563">${sizeText} mm · ${printText}</text>
  <text x="${margin}" y="${margin+h+footer*0.42}" font-family="Arial,sans-serif" font-size="${clamp(font*0.62,2.5,5)}" fill="#374151">Código: ${codeText}</text>
  <text x="${margin}" y="${margin+h+footer*0.72}" font-family="Arial,sans-serif" font-size="${clamp(font*0.52,2.2,4.2)}" fill="#6b7280">Linha vermelha = dimensão final informada na tabela (${w} × ${h} mm). Sangria/área segura não presumidas.</text>
</svg>`;
}
