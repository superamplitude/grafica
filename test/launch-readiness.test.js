import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLaunchChecklist, evaluateProductReadiness, repairSuggestions } from '../src/domain/launch-readiness.js';

test('product readiness requires all commercial and technical evidence', () => {
  const result = evaluateProductReadiness({
    id: 7,
    name: 'Cartão premium',
    status: 'draft',
    category_id: 2,
    category_slug: 'cartoes',
    description: 'Descrição comercial suficientemente longa para explicar o produto, acabamento e contexto de uso ao cliente.',
    requires_artwork: 1,
    supplier_id: null,
    supplier_status: null,
    variant_count: 2,
    priced_variant_count: 2,
    cover_count: 1,
    template_count: 1,
    outsourced_variant_count: 0
  });
  assert.equal(result.complete, true);
  assert.equal(result.missing.length, 0);
});

test('outsourced product requires approved supplier and template when artwork is required', () => {
  const result = evaluateProductReadiness({
    id: 8,
    name: 'Banner terceirizado',
    status: 'draft',
    category_id: 2,
    category_slug: 'banners',
    description: 'Descrição comercial suficientemente longa para o produto terceirizado e para o contexto de venda ao cliente final.',
    requires_artwork: 1,
    supplier_id: 3,
    supplier_status: 'testing',
    variant_count: 1,
    priced_variant_count: 1,
    cover_count: 1,
    template_count: 0,
    outsourced_variant_count: 1
  });
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing.map((item) => item.key).sort(), ['supplier','template']);
});

test('repair suggestions never invent content and only use existing price or description', () => {
  const suggestions = repairSuggestions({ base_price: 0, starting_price: 49.9, description: '', short_description: 'Texto existente com conteúdo suficiente para reutilização segura como descrição comercial sem gerar qualquer texto novo automaticamente.' });
  assert.deepEqual(suggestions.map((item) => item.field).sort(), ['base_price','description']);
});

test('stable readiness remains blocked until external attestations are verified', () => {
  const result = buildLaunchChecklist({
    storage: 'ok',
    metrics: { products_total: 12, pilot_candidates: 6, active_hero_banners: 1, active_payment_integrations:1, active_shipping_integrations:0 },
    attestations: { payment:{status:'verified'}, shipping:{status:'pending'}, email:{status:'pending'}, mobile:{status:'pending'} }
  });
  assert.equal(result.ready_for_stable, false);
  assert.ok(result.critical_failures.includes('shipping'));
});

test('human attestation alone does not mark payment or shipping ready without active verified connector', () => {
  const result = buildLaunchChecklist({
    storage:'ok',
    metrics:{products_total:10,pilot_candidates:5,active_hero_banners:1,active_payment_integrations:0,active_shipping_integrations:0},
    attestations:{payment:{status:'verified'},shipping:{status:'verified'},email:{status:'verified'},mobile:{status:'verified'}}
  });
  assert.equal(result.ready_for_stable,false);
  assert.ok(result.critical_failures.includes('payment'));
  assert.ok(result.critical_failures.includes('shipping'));
});
