import crypto from 'node:crypto';

export const SUPPLIER_PRICE_BODY_LIMIT = 24 * 1024 * 1024;

const HEADER = ['código','categoria','descrição do serviço','cores','peso','qtde','tam','prazo','preço r$'];

function decodeEntities(value='') {
  const named={
    amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',
    aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',
    agrave:'à',egrave:'è',igrave:'ì',ograve:'ò',ugrave:'ù',
    acirc:'â',ecirc:'ê',icirc:'î',ocirc:'ô',ucirc:'û',
    atilde:'ã',otilde:'õ',ccedil:'ç',uuml:'ü',ordm:'º',ordf:'ª'
  };
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi,(_m,n)=>String.fromCodePoint(Number.parseInt(n,16)))
    .replace(/&#(\d+);/g,(_m,n)=>String.fromCodePoint(Number.parseInt(n,10)))
    .replace(/&([a-z]+);/gi,(m,n)=>named[n.toLowerCase()] ?? m);
}

function cellText(value='') {
  return decodeEntities(String(value).replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]+>/g,' '))
    .replace(/\s+/g,' ')
    .trim();
}

function normalizeLabel(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}

function parseNumber(value) {
  const clean=String(value??'').trim().replace(/\s+/g,'').replace(/\./g,'').replace(',','.');
  if(!/^[-+]?\d+(?:\.\d+)?$/.test(clean)) return null;
  const number=Number(clean);
  return Number.isFinite(number) ? number : null;
}

function parsePrice(value) {
  return parseNumber(String(value??'').replace(/R\$/gi,''));
}

function parseDateFromTitle(title) {
  const match=String(title||'').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if(!match) return null;
  const [,dd,mm,yyyy]=match;
  const iso=`${yyyy}-${mm}-${dd}`;
  const date=new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value),'utf8').digest('hex');
}

export function productCatalogKey(category, description) {
  return sha256(`${normalizeLabel(category)}\n${normalizeLabel(description)}`);
}

export function variantDisplayName(row) {
  const quantity=Number(row.quantity || 0);
  const q=Number.isInteger(quantity) ? String(quantity) : String(quantity).replace('.',',');
  return [q ? `${q} un.` : '', row.size || '', row.colors || ''].filter(Boolean).join(' · ').slice(0,255) || row.code;
}

export function parseSupplierPriceTable(input) {
  const source=Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');
  if(source.length < 64) throw Object.assign(new Error('SUPPLIER_PRICE_FILE_EMPTY'),{code:'SUPPLIER_PRICE_FILE_EMPTY'});
  if(source.length > SUPPLIER_PRICE_BODY_LIMIT) throw Object.assign(new Error('SUPPLIER_PRICE_FILE_TOO_LARGE'),{code:'SUPPLIER_PRICE_FILE_TOO_LARGE'});

  const rowRegex=/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const titleCandidates=[];
  const rows=[];
  const invalid=[];
  const seenCodes=new Set();
  let headerFound=false;
  let rowMatch;
  let sourceRow=0;

  while((rowMatch=rowRegex.exec(source))!==null) {
    sourceRow += 1;
    const rowHtml=rowMatch[1];
    const cells=[];
    const cellRegex=/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi;
    let cellMatch;
    while((cellMatch=cellRegex.exec(rowHtml))!==null) cells.push({tag:`t${cellMatch[1].toLowerCase()}`,value:cellText(cellMatch[2])});
    if(!cells.length) continue;
    if(cells.length===1 && cells[0].tag==='th') {
      titleCandidates.push(cells[0].value);
      continue;
    }
    if(cells.length===9 && cells.every(c=>c.tag==='th')) {
      const normalized=cells.map(c=>normalizeLabel(c.value));
      if(HEADER.every((v,i)=>normalized[i]===normalizeLabel(v))) headerFound=true;
      continue;
    }
    if(cells.length!==9 || !cells.every(c=>c.tag==='td')) continue;

    const [code,category,description,colors,weightRaw,quantityRaw,size,daysRaw,priceRaw]=cells.map(c=>c.value);
    const weight=parseNumber(weightRaw);
    const quantity=parseNumber(quantityRaw);
    const productionDays=parseNumber(daysRaw);
    const price=parsePrice(priceRaw);
    const errors=[];
    if(!code || code.length>120) errors.push('invalid_code');
    if(!category || category.length>190) errors.push('invalid_category');
    if(!description || description.length>255) errors.push('invalid_description');
    if(quantity==null || quantity<=0) errors.push('invalid_quantity');
    if(productionDays==null || productionDays<0 || !Number.isInteger(productionDays)) errors.push('invalid_production_days');
    if(price==null || price<=0) errors.push('invalid_price');
    if(code && seenCodes.has(code)) errors.push('duplicate_code');
    if(errors.length) {
      invalid.push({source_row:sourceRow,code:code||null,errors});
      continue;
    }
    seenCodes.add(code);
    rows.push({
      code,
      category,
      description,
      colors:colors || null,
      weight:weight == null ? null : Number(weight.toFixed(3)),
      weight_raw:weightRaw || null,
      quantity:Number(quantity.toFixed(3)),
      size:size || null,
      production_days:productionDays,
      supplier_price:Number(price.toFixed(2)),
      product_catalog_key:productCatalogKey(category,description)
    });
  }

  if(!headerFound) throw Object.assign(new Error('SUPPLIER_PRICE_HEADER_NOT_FOUND'),{code:'SUPPLIER_PRICE_HEADER_NOT_FOUND'});
  if(!rows.length) throw Object.assign(new Error('SUPPLIER_PRICE_NO_VALID_ROWS'),{code:'SUPPLIER_PRICE_NO_VALID_ROWS',invalid});
  if(invalid.length) throw Object.assign(new Error('SUPPLIER_PRICE_INVALID_ROWS'),{code:'SUPPLIER_PRICE_INVALID_ROWS',invalid:invalid.slice(0,100),invalid_count:invalid.length});

  const title=titleCandidates.find(v=>/tabela\s+de\s+pre[çc]os/i.test(v)) || titleCandidates[0] || null;
  const categories=new Set(rows.map(r=>normalizeLabel(r.category)));
  const products=new Set(rows.map(r=>r.product_catalog_key));
  const prices=rows.map(r=>r.supplier_price);
  const quantities=rows.map(r=>r.quantity);
  const days=rows.map(r=>r.production_days);
  return {
    format:'supplier-html-price-table-v1',
    source_sha256:sha256(source),
    title,
    report_date:parseDateFromTitle(title),
    row_count:rows.length,
    category_count:categories.size,
    product_count:products.size,
    stats:{
      min_price:Math.min(...prices),max_price:Math.max(...prices),
      min_quantity:Math.min(...quantities),max_quantity:Math.max(...quantities),
      min_production_days:Math.min(...days),max_production_days:Math.max(...days)
    },
    rows
  };
}
