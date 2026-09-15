import { parseSizeMm } from './generated-assets.js';

const MM_TO_PT=72/25.4;
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function clean(value=''){return String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();}
function ascii(value=''){return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?');}
function psEscape(value=''){return ascii(value).replace(/([\\()])/g,'\\$1');}
function resolvedGeometry(sizeLabel){
  const parsed=parseSizeMm(sizeLabel);
  if(!parsed) return {parsed:null,width_mm:210,height_mm:297,margin_mm:10,footer_mm:34};
  const margin=clamp(Math.min(parsed.width_mm,parsed.height_mm)*0.08,4,18);
  const footer=clamp(Math.min(parsed.width_mm,parsed.height_mm)*0.22,18,36);
  return {parsed,width_mm:parsed.width_mm,height_mm:parsed.height_mm,margin_mm:margin,footer_mm:footer};
}

export function renderVariantGabaritoEps({code,productName,sizeLabel,printConfiguration}){
  const g=resolvedGeometry(sizeLabel);
  const pageW=Math.ceil((g.width_mm+g.margin_mm*2)*MM_TO_PT);
  const pageH=Math.ceil((g.height_mm+g.margin_mm*2+g.footer_mm)*MM_TO_PT);
  const x=g.margin_mm*MM_TO_PT;
  const y=(g.margin_mm+g.footer_mm)*MM_TO_PT;
  const w=g.width_mm*MM_TO_PT;
  const h=g.height_mm*MM_TO_PT;
  const title=psEscape(productName||'Produto grafico');
  const codeText=psEscape(code||'');
  const sizeText=psEscape(sizeLabel||'Medida nao informada');
  const printText=psEscape(printConfiguration||'Configuracao nao informada');
  return `%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Central Prints\n%%Title: Gabarito ${codeText}\n%%BoundingBox: 0 0 ${pageW} ${pageH}\n%%LanguageLevel: 2\n%%Pages: 1\n%%EndComments\n/Helvetica findfont 9 scalefont setfont\n1 1 1 setrgbcolor 0 0 ${pageW} ${pageH} rectfill\n0.94 0.18 0.18 setrgbcolor 1 setlinewidth ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} rectstroke\n0.07 0.24 0.18 setrgbcolor\n${x.toFixed(2)} ${(g.margin_mm*MM_TO_PT+18).toFixed(2)} moveto (CENTRAL PRINTS - GABARITO TECNICO) show\n${x.toFixed(2)} ${(g.margin_mm*MM_TO_PT+7).toFixed(2)} moveto (${title}) show\n/Helvetica findfont 7 scalefont setfont\n${x.toFixed(2)} ${(g.margin_mm*MM_TO_PT-5).toFixed(2)} moveto (Codigo: ${codeText}  |  Medida: ${sizeText}  |  Impressao: ${printText}) show\n0.4 0.46 0.43 setrgbcolor\n${x.toFixed(2)} ${(g.margin_mm*MM_TO_PT-15).toFixed(2)} moveto (Linha vermelha = dimensao final informada. Sangria e area segura nao presumidas.) show\nshowpage\n%%EOF\n`;
}

function buildPdf(objects){
  let body='%PDF-1.4\n';
  const offsets=[0];
  for(let i=0;i<objects.length;i++){
    offsets.push(Buffer.byteLength(body,'ascii'));
    body+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref=Buffer.byteLength(body,'ascii');
  body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=objects.length;i++) body+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  body+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body,'ascii');
}
function pdfEscape(value=''){return ascii(value).replace(/([\\()])/g,'\\$1');}

export function renderVariantGabaritoPdf({code,productName,sizeLabel,printConfiguration}){
  const g=resolvedGeometry(sizeLabel);
  const pageW=clamp((g.width_mm+g.margin_mm*2)*MM_TO_PT,200,14000);
  const pageH=clamp((g.height_mm+g.margin_mm*2+g.footer_mm)*MM_TO_PT,200,14000);
  const x=g.margin_mm*MM_TO_PT;
  const y=(g.margin_mm+g.footer_mm)*MM_TO_PT;
  const w=g.width_mm*MM_TO_PT;
  const h=g.height_mm*MM_TO_PT;
  const title=pdfEscape(productName||'Produto grafico');
  const codeText=pdfEscape(code||'');
  const sizeText=pdfEscape(sizeLabel||'Medida nao informada');
  const printText=pdfEscape(printConfiguration||'Configuracao nao informada');
  const content=[
    'q','1 1 1 rg',`0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)} re f`,
    '0.94 0.18 0.18 RG','1 w',`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`,
    '0.07 0.24 0.18 rg','BT','/F1 11 Tf',`${x.toFixed(2)} ${(g.margin_mm*MM_TO_PT+19).toFixed(2)} Td`,`(CENTRAL PRINTS - GABARITO TECNICO) Tj`,'ET',
    'BT','/F1 8 Tf',`${x.toFixed(2)} ${(g.margin_mm*MM_TO_PT+7).toFixed(2)} Td`,`(${title}) Tj`,'ET',
    '0.35 0.42 0.39 rg','BT','/F1 7 Tf',`${x.toFixed(2)} ${(g.margin_mm*MM_TO_PT-5).toFixed(2)} Td`,`(Codigo: ${codeText} | Medida: ${sizeText} | Impressao: ${printText}) Tj`,'ET',
    'BT','/F1 6 Tf',`${x.toFixed(2)} ${(g.margin_mm*MM_TO_PT-15).toFixed(2)} Td`,`(Linha vermelha = dimensao final informada. Sangria e area segura nao presumidas.) Tj`,'ET','Q'
  ].join('\n');
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content,'ascii')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  return buildPdf(objects);
}

function setPixel(planes,width,height,x,y,r,g,b){
  if(x<0||y<0||x>=width||y>=height)return;
  const i=y*width+x;planes[0][i]=r;planes[1][i]=g;planes[2][i]=b;
}
function drawLine(planes,width,height,x1,y1,x2,y2,r,g,b,thickness=2){
  const dx=Math.abs(x2-x1),sx=x1<x2?1:-1,dy=-Math.abs(y2-y1),sy=y1<y2?1:-1;let err=dx+dy,x=x1,y=y1;
  for(;;){for(let ox=-thickness;ox<=thickness;ox++)for(let oy=-thickness;oy<=thickness;oy++)setPixel(planes,width,height,x+ox,y+oy,r,g,b);if(x===x2&&y===y2)break;const e2=2*err;if(e2>=dy){err+=dy;x+=sx}if(e2<=dx){err+=dx;y+=sy}}
}

export function renderVariantGabaritoPsd({sizeLabel}){
  const parsed=parseSizeMm(sizeLabel);
  let width=900,height=650;
  if(parsed){
    const scale=Math.min(1000/parsed.width_mm,1000/parsed.height_mm,8);
    width=Math.max(96,Math.round(parsed.width_mm*scale));
    height=Math.max(96,Math.round(parsed.height_mm*scale));
  }
  width=clamp(width,96,1200);height=clamp(height,96,1200);
  const pixels=width*height;
  const planes=[Buffer.alloc(pixels,255),Buffer.alloc(pixels,255),Buffer.alloc(pixels,255)];
  const m=Math.max(10,Math.round(Math.min(width,height)*0.06));
  drawLine(planes,width,height,m,m,width-m-1,m,239,68,68,2);
  drawLine(planes,width,height,width-m-1,m,width-m-1,height-m-1,239,68,68,2);
  drawLine(planes,width,height,width-m-1,height-m-1,m,height-m-1,239,68,68,2);
  drawLine(planes,width,height,m,height-m-1,m,m,239,68,68,2);
  drawLine(planes,width,height,m,m,width-m-1,height-m-1,223,232,226,1);
  drawLine(planes,width,height,width-m-1,m,m,height-m-1,223,232,226,1);
  const header=Buffer.alloc(26);
  header.write('8BPS',0,'ascii');
  header.writeUInt16BE(1,4);
  header.writeUInt16BE(3,12);
  header.writeUInt32BE(height,14);
  header.writeUInt32BE(width,18);
  header.writeUInt16BE(8,22);
  header.writeUInt16BE(3,24);
  const zero32=Buffer.alloc(4);
  const compression=Buffer.alloc(2);compression.writeUInt16BE(0,0);
  return Buffer.concat([header,zero32,zero32,zero32,compression,...planes]);
}
