export function heroTextHasPricing(data = {}) {
  const text = [data.eyebrow,data.title,data.body,data.cta_label,data.secondary_cta_label]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase();
  if (!text) return false;
  return /r\$\s*\d|\bpre[cç]o\b|\ba partir de\b|\bpor apenas\b|\bde\s+r\$|\d+[.,]\d{2}(?:\s|$)|\b\d+\s*%\s*(?:off|de desconto)\b/i.test(text);
}
