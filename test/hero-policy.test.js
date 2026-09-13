import test from 'node:test';
import assert from 'node:assert/strict';
import { heroTextHasPricing } from '../src/domain/hero-policy.js';

test('hero without price remains allowed', () => {
  assert.equal(heroTextHasPricing({title:'Impressão profissional',body:'Qualidade para sua marca',cta_label:'Ver catálogo'}),false);
});

test('hero rejects BRL price text', () => {
  assert.equal(heroTextHasPricing({title:'Cartões a partir de R$ 39,90'}),true);
});

test('hero rejects discount language with percentage', () => {
  assert.equal(heroTextHasPricing({body:'20% de desconto nesta semana'}),true);
});

test('hero rejects generic explicit price wording', () => {
  assert.equal(heroTextHasPricing({eyebrow:'Preço especial',title:'Sua gráfica online'}),true);
});
