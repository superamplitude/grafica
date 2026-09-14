import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSizeMm, renderProductPreviewSvg, renderVariantGabaritoSvg } from '../src/domain/generated-assets.js';

test('parseSizeMm aceita medidas numericas e rejeita 0 x 0',()=>{
  assert.deepEqual(parseSizeMm('91 x 51'),{width_mm:91,height_mm:51});
  assert.deepEqual(parseSizeMm('45,5 x 51 mm'),{width_mm:45.5,height_mm:51});
  assert.equal(parseSizeMm('0 x 0'),null);
  assert.equal(parseSizeMm('A4'),null);
});

test('gabarito SVG usa dimensao final sem inventar sangria',()=>{
  const svg=renderVariantGabaritoSvg({code:'ABC123',productName:'Cartão & Visita',sizeLabel:'91 x 51',printConfiguration:'4X4'});
  assert.match(svg,/width="91mm"/);
  assert.match(svg,/height="51mm"/);
  assert.match(svg,/91 × 51 mm/);
  assert.match(svg,/Sangria\/área segura não presumidas/);
  assert.match(svg,/Cartão &amp; Visita/);
  assert.doesNotMatch(svg,/bleed="3/);
});

test('gabarito sem medida convertivel vira ficha tecnica explicita',()=>{
  const svg=renderVariantGabaritoSvg({code:'X',productName:'Produto',sizeLabel:'A4 aberto',printConfiguration:'4X0'});
  assert.match(svg,/Medida não convertível automaticamente em milímetros/);
  assert.match(svg,/não presumida/i);
});

test('preview tecnico se identifica como tecnico e escapa XML',()=>{
  const svg=renderProductPreviewSvg({name:'Produto <Teste>',category:'Categoria & Cia',shortDescription:'descrição'});
  assert.match(svg,/Imagem técnica neutra/);
  assert.match(svg,/Produto &lt;Teste&gt;/);
  assert.match(svg,/Categoria &amp; Cia/);
});
