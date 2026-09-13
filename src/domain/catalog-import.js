import crypto from 'node:crypto';

const LOWER_WORDS=new Set(['a','as','o','os','de','da','das','do','dos','e','em','para','por','com','sem']);
const ACRONYMS=new Map([['uv','UV'],['pvc','PVC'],['bopp','BOPP'],['psai','PSAI'],['dtf','DTF'],['pet','PET'],['pdf','PDF'],['a4','A4'],['a3','A3'],['a5','A5'],['a6','A6']]);

export function slugifyCatalog(value,max=180){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,max);
}

export function displayCase(value){
  const words=String(value||'').trim().toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean);
  return words.map((word,index)=>{
    const prefix=word.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
    const lead=prefix?.[1]||''; const core=prefix?.[2]||word; const tail=prefix?.[3]||'';
    const normalized=core.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(ACRONYMS.has(normalized)) return `${lead}${ACRONYMS.get(normalized)}${tail}`;
    if(index>0&&LOWER_WORDS.has(normalized)) return `${lead}${core}${tail}`;
    return `${lead}${core.charAt(0).toLocaleUpperCase('pt-BR')}${core.slice(1)}${tail}`;
  }).join(' ');
}

export function normalizeDescription(category,description){
  const cat=String(category||'').trim();
  let desc=String(description||'').trim().replace(/\s+/g,' ');
  const prefix=new RegExp(`^${cat.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*-\\s*`,'i');
  desc=desc.replace(prefix,'');
  desc=desc.replace(/\s*-\s*\d+(?:[.,]\d+)?g$/i,'').trim();
  return desc||cat;
}

export function productIdentity(category,description){
  const groupKey=`${String(category||'').trim()}\u0000${String(description||'').trim()}`;
  const hash=crypto.createHash('sha256').update(groupKey).digest('hex');
  const catName=displayCase(category);
  const descName=displayCase(normalizeDescription(category,description));
  const name=descName.toLocaleLowerCase('pt-BR')===catName.toLocaleLowerCase('pt-BR')?catName:`${catName} — ${descName}`;
  const slugBase=slugifyCatalog(name,160)||'produto';
  return {key:groupKey,hash,name,sku:`AC-P-${hash.slice(0,12).toUpperCase()}`,slug:`${slugBase}-${hash.slice(0,8)}`};
}

export function parseMoney(value){
  const clean=String(value??'').replace(/R\$/gi,'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'').trim();
  const n=Number(clean); return Number.isFinite(n)&&n>=0?n:0;
}
export function parseNumber(value,fallback=0){const n=Number(String(value??'').replace(',','.').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:fallback;}
export function parseDays(value){const n=parseInt(String(value??'').replace(/\D+/g,''),10);return Number.isInteger(n)&&n>=0?n:null;}
export function supportsBack(print){const m=String(print||'').match(/(\d+)\s*[xX]\s*(\d+)/);return Boolean(m&&Number(m[2])>0);}

export function variantName(row){
  const [, , , colors, , qty, size, days]=row;
  const parts=[];
  if(qty)parts.push(`${qty} un.`);
  if(size)parts.push(String(size));
  if(colors)parts.push(String(colors).toUpperCase());
  if(days)parts.push(`${days} dia(s)`);
  return parts.join(' · ').slice(0,255)||String(row[0]||'Opção');
}

export function buildCatalogGroups(rows){
  const groups=new Map();
  for(const raw of rows){
    if(!Array.isArray(raw)||raw.length<9)continue;
    const row=raw.map(v=>String(v??'').trim());
    const [code,category,description]=row;
    if(!code||!category||!description)continue;
    const identity=productIdentity(category,description);
    if(!groups.has(identity.key))groups.set(identity.key,{...identity,category,description,rows:[],supports_back:false});
    const g=groups.get(identity.key);g.rows.push(row);if(supportsBack(row[3]))g.supports_back=true;
  }
  return [...groups.values()];
}
