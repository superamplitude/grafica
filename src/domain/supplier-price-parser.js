import crypto from 'node:crypto';

function decodeSource(bytes){
  const utf8=bytes.toString('utf8');
  return Buffer.from(utf8,'utf8').equals(bytes)?utf8:bytes.toString('latin1');
}

function decodeEntities(text=''){
  return String(text)
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}

function cellText(html=''){
  return decodeEntities(String(html).replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
}

function decimalPtBr(value){
  const text=String(value??'').trim().replace(/R\$\s*/gi,'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');
  if(!text)return null;
  const n=Number(text);
  return Number.isFinite(n)?n:null;
}

function decimalLoose(value){
  const text=String(value??'').trim().replace(',','.').replace(/[^0-9.-]/g,'');
  if(!text)return null;
  const n=Number(text);
  return Number.isFinite(n)?n:null;
}

function intLoose(value){
  const n=decimalLoose(value);
  return n==null?null:Math.max(0,Math.trunc(n));
}

export function parseSourceDate(text=''){
  const m=String(text).match(/TABELA\s+DE\s+PRE[CÇ]OS\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  return m?`${m[3]}-${m[2]}-${m[1]}`:null;
}

export function parseHtmlXlsPriceTable(buffer){
  const bytes=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  const checksum=crypto.createHash('sha256').update(bytes).digest('hex');
  const html=decodeSource(bytes);
  if(!/<table\b/i.test(html))throw new Error('PRICE_SOURCE_NOT_HTML_TABLE');
  const sourceDate=parseSourceDate(cellText(html.slice(0,20000)));
  const rows=[];
  const rowRe=/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let physicalRow=0;
  while((rowMatch=rowRe.exec(html))){
    physicalRow++;
    const cells=[];
    const cellRe=/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while((cellMatch=cellRe.exec(rowMatch[1])))cells.push(cellText(cellMatch[1]));
    if(cells.length!==9)continue;
    if(/^c[oó]digo$/i.test(cells[0])||!cells[0])continue;
    const price=decimalPtBr(cells[8]);
    if(price==null)continue;
    rows.push({
      row_number:physicalRow,
      source_code:cells[0].slice(0,190),
      category_name:cells[1].slice(0,255),
      service_description:cells[2],
      color_configuration:cells[3]?cells[3].slice(0,80):null,
      weight_value:decimalLoose(cells[4]),
      quantity_value:decimalLoose(cells[5]),
      size_label:cells[6]?cells[6].slice(0,190):null,
      production_days:intLoose(cells[7]),
      supplier_price:price,
      raw_json:{code:cells[0],category:cells[1],description:cells[2],colors:cells[3],weight:cells[4],quantity:cells[5],size:cells[6],lead_time:cells[7],price:cells[8]}
    });
  }
  if(!rows.length)throw new Error('PRICE_SOURCE_NO_ROWS');
  const codes=new Set();
  for(const row of rows){if(codes.has(row.source_code))throw new Error(`PRICE_SOURCE_DUPLICATE_CODE:${row.source_code}`);codes.add(row.source_code);}
  return {checksum_sha256:checksum,source_date:sourceDate,rows,row_count:rows.length,category_count:new Set(rows.map(r=>r.category_name)).size};
}
