import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogGroups, displayCase, normalizeDescription, parseMoney, productIdentity, supportsBack, variantName } from '../src/domain/catalog-import.js';

test('catalog normalizes supplier descriptions without exposing supplier branding',()=>{
  assert.equal(displayCase('CARTÕES DE VISITA'),'Cartões de Visita');
  assert.equal(normalizeDescription('ABRIDORES E CHAVEIROS','ABRIDORES E CHAVEIROS - IMPRESSÃO UV - 10g'),'IMPRESSÃO UV');
  const id=productIdentity('ABRIDORES E CHAVEIROS','ABRIDORES E CHAVEIROS - IMPRESSÃO UV - 10g');
  assert.equal(id.name,'Abridores e Chaveiros — Impressão UV');
  assert.match(id.sku,/^AC-P-[A-F0-9]{12}$/);
  assert.ok(!/atual card/i.test(id.name));
});

test('catalog parses Brazilian money and technical sides',()=>{
  assert.equal(parseMoney('R$ 560,98'),560.98);
  assert.equal(supportsBack('4X0'),false);
  assert.equal(supportsBack('4X4'),true);
});

test('catalog groups variants deterministically',()=>{
  const rows=[
    ['GIFT1515','ABRIDORES E CHAVEIROS','ABRIDORES E CHAVEIROS - IMPRESSÃO UV - 10g','4X0','1250','25','57 x 57','5','R$ 560,98'],
    ['GIFT1516','ABRIDORES E CHAVEIROS','ABRIDORES E CHAVEIROS - IMPRESSÃO UV - 10g','4X4','2500','50','57 x 57','5','R$ 740,00']
  ];
  const groups=buildCatalogGroups(rows);
  assert.equal(groups.length,1);
  assert.equal(groups[0].rows.length,2);
  assert.equal(groups[0].supports_back,true);
  assert.equal(variantName(rows[0]),'25 un. · 57 x 57 · 4X0 · 5 dia(s)');
});
