import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupplierPriceTable, productCatalogKey, variantDisplayName } from '../src/domain/supplier-price-import.js';

function fixture(rows,title='TABELA DE PREÇOS 12/09/2026'){
  return `<table><tbody><tr><th>${title}</th></tr><tr><th>Código</th><th>Categoria</th><th>Descrição do Serviço</th><th>Cores</th><th>Peso</th><th>Qtde</th><th>Tam</th><th>Prazo</th><th>Preço R$</th></tr>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
test('parses supplier HTML disguised as XLS without exposing price as public price',()=>{
  const parsed=parseSupplierPriceTable(fixture([
    ['GIFT1515','ABRIDORES E CHAVEIROS','ABRIDORES E CHAVEIROS - IMPRESSÃO UV - 10g','4X0','1250','25','57 x 57','5','R$ 560,98'],
    ['GIFT1516','ABRIDORES E CHAVEIROS','ABRIDORES E CHAVEIROS - IMPRESSÃO UV - 10g','4X0','500','10','57 x 57','5','R$ 237,58'],
    ['PANF1','PANFLETOS','COUCHE 90g','4X4','1000','1000','100 x 150','2','R$ 89,90']
  ]));
  assert.equal(parsed.report_date,'2026-09-12');
  assert.equal(parsed.row_count,3);
  assert.equal(parsed.category_count,2);
  assert.equal(parsed.product_count,2);
  assert.equal(parsed.rows[0].supplier_price,560.98);
  assert.equal(parsed.rows[0].quantity,25);
  assert.equal(parsed.rows[0].production_days,5);
  assert.match(parsed.source_sha256,/^[a-f0-9]{64}$/);
  assert.equal(parsed.rows[0].product_catalog_key,parsed.rows[1].product_catalog_key);
  assert.notEqual(parsed.rows[0].product_catalog_key,parsed.rows[2].product_catalog_key);
  assert.equal(productCatalogKey('ÁDESIVOS','Teste'),productCatalogKey('adesivos','teste'));
  assert.match(variantDisplayName(parsed.rows[0]),/25 un\./);
});
test('rejects duplicate supplier code instead of guessing identity',()=>{
  assert.throws(()=>parseSupplierPriceTable(fixture([
    ['X1','CAT','DESC','4X0','10','1','10 x 10','2','R$ 10,00'],
    ['X1','CAT','DESC','4X0','10','2','10 x 10','2','R$ 20,00']
  ])),error=>error?.code==='SUPPLIER_PRICE_INVALID_ROWS'&&error?.invalid_count===1);
});
test('requires the exact 9-column supplier header',()=>{
  assert.throws(()=>parseSupplierPriceTable('<table><tbody><tr><th>qualquer cabeçalho de tabela sem as nove colunas esperadas</th></tr><tr><td>X</td></tr></tbody></table>'),error=>error?.code==='SUPPLIER_PRICE_HEADER_NOT_FOUND');
});
