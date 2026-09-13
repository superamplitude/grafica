const DEFAULT_CATEGORY_SLUGS = new Set(['uncategorized','sem-categoria','sem-categoria-de-produto']);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value) {
  return String(value ?? '').trim();
}

export function evaluateProductReadiness(row = {}) {
  const description = text(row.description);
  const requiresArtwork = Boolean(Number(row.requires_artwork));
  const outsourced = num(row.outsourced_variant_count) > 0;
  const categorySlug = text(row.category_slug).toLowerCase();

  const checks = {
    cover: num(row.cover_count) > 0,
    priced_variant: num(row.priced_variant_count) > 0,
    category: num(row.category_id) > 0 && categorySlug && !DEFAULT_CATEGORY_SLUGS.has(categorySlug),
    description: description.length >= 80,
    variant: num(row.variant_count) > 0,
    template: !requiresArtwork || num(row.template_count) > 0,
    supplier: !outsourced || (num(row.supplier_id) > 0 && text(row.supplier_status) === 'approved'),
    status: !['archived'].includes(text(row.status))
  };

  const labels = {
    cover: 'foto real principal revisada, licenciada e sem marca de fornecedor',
    priced_variant: 'variante disponível com preço público',
    category: 'categoria comercial válida',
    description: 'descrição comercial suficiente',
    variant: 'variante ativa',
    template: 'gabarito técnico neutro e verificado',
    supplier: 'fornecedor aprovado para produção terceirizada/híbrida',
    status: 'status publicável'
  };
  const missing = Object.entries(checks).filter(([,ok]) => !ok).map(([key]) => ({ key, label: labels[key] }));

  return {
    product_id: num(row.id),
    name: text(row.name),
    status: text(row.status),
    complete: missing.length === 0,
    checks,
    missing
  };
}

export function repairSuggestions(row = {}) {
  const suggestions = [];
  const basePrice = num(row.base_price);
  const startingPrice = num(row.starting_price);
  const description = text(row.description);
  const shortDescription = text(row.short_description);

  if (basePrice <= 0 && startingPrice > 0) {
    suggestions.push({ field: 'base_price', before: basePrice, after: startingPrice, reason: 'Menor preço público de variante ativa disponível.' });
  }
  if (!description && shortDescription.length >= 80) {
    suggestions.push({ field: 'description', before: row.description ?? null, after: shortDescription, reason: 'Descrição curta já existente e suficiente; nenhum texto novo é inventado.' });
  }
  return suggestions;
}

export function buildLaunchChecklist({ storage = 'unconfigured', metrics = {}, attestations = {} } = {}) {
  const attestation = (key) => attestations[key]?.status || 'pending';
  const paymentReady = num(metrics.active_payment_integrations) > 0 && attestation('payment') === 'verified';
  const shippingReady = num(metrics.active_shipping_integrations) > 0 && attestation('shipping') === 'verified';
  const items = [
    { id:'storage', label:'Armazenamento público/privado', critical:true, weight:15, status:storage === 'ok' ? 'pass' : 'fail', detail:`R2: ${storage}` },
    { id:'catalog', label:'Catálogo com produtos', critical:true, weight:10, status:num(metrics.products_total) > 0 ? 'pass' : 'fail', detail:`${num(metrics.products_total)} produto(s)` },
    { id:'pilot', label:'Mínimo de 5 produtos completos para piloto', critical:true, weight:20, status:num(metrics.pilot_candidates) >= 5 ? 'pass' : 'fail', detail:`${num(metrics.pilot_candidates)} candidato(s)` },
    { id:'payment', label:'Gateway de pagamento implementado, ativo e verificado', critical:true, weight:15, status:paymentReady ? 'pass' : (attestation('payment') === 'blocked' ? 'fail' : 'pending'), detail:paymentReady ? `${num(metrics.active_payment_integrations)} gateway(s) ativo(s) e homologado(s)` : (attestations.payment?.note || `${num(metrics.active_payment_integrations)} gateway(s) ativo(s) verificado(s)`) },
    { id:'shipping', label:'Transportadora/entrega implementada, ativa e verificada', critical:true, weight:15, status:shippingReady ? 'pass' : (attestation('shipping') === 'blocked' ? 'fail' : 'pending'), detail:shippingReady ? `${num(metrics.active_shipping_integrations)} integração(ões) de entrega ativa(s)` : (attestations.shipping?.note || `${num(metrics.active_shipping_integrations)} integração(ões) de entrega ativa(s) verificada(s)`) },
    { id:'hero', label:'Hero ativo sem preço e com imagem revisada', critical:false, weight:5, status:num(metrics.active_hero_banners) > 0 ? 'pass' : 'pending', detail:`${num(metrics.active_hero_banners)} campanha(s) segura(s) ativa(s)` },
    { id:'email', label:'E-mail transacional verificado', critical:false, weight:10, status:attestation('email') === 'verified' ? 'pass' : (attestation('email') === 'blocked' ? 'fail' : 'pending'), detail:attestations.email?.note || 'Validar durante compra controlada.' },
    { id:'mobile', label:'Compra e acompanhamento em mobile verificados', critical:false, weight:10, status:attestation('mobile') === 'verified' ? 'pass' : (attestation('mobile') === 'blocked' ? 'fail' : 'pending'), detail:attestations.mobile?.note || 'Validar na homologação.' }
  ];
  const max = items.reduce((sum,item) => sum + item.weight, 0);
  const earned = items.reduce((sum,item) => sum + (item.status === 'pass' ? item.weight : 0), 0);
  const criticalFailures = items.filter((item) => item.critical && item.status !== 'pass');
  return {
    items,
    score: max ? Math.round((earned / max) * 100) : 0,
    ready_for_stable: criticalFailures.length === 0,
    critical_failures: criticalFailures.map((item) => item.id)
  };
}
