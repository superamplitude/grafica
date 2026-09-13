import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHtmlXlsPriceTable } from '../src/domain/supplier-price-parser.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const fixture=await fs.readFile(path.join(__dirname,'fixtures','TabelaPreco-sample.xls'));

test('parses HTML disguised as XLS with date and pt-BR currency',()=>{
  const result=parseHtmlXlsPriceTable(fixture);
  assert.equal(result.source_date,'2026-09-12');
  assert.equal(result.row_count,3);
  assert.equal(result.category_count,2);
  assert.equal(result.rows[0].source_code,'GIFT1515');
  assert.equal(result.rows[0].supplier_price,560.98);
  assert.equal(result.rows[0].quantity_value,25);
  assert.equal(result.rows[2].supplier_price,89.9);
  assert.match(result.checksum_sha256,/^[a-f0-9]{64}$/);
});

test('rejects non-table source',()=>{
  assert.throws(()=>parseHtmlXlsPriceTable(Buffer.from('not a workbook')),/PRICE_SOURCE_NOT_HTML_TABLE/);
});

test('rejects duplicate source codes in same price file',()=>{
  const text=fixture.toString('latin1').replace('CV100','GIFT1515');
  assert.throws(()=>parseHtmlXlsPriceTable(Buffer.from(text,'latin1')),/PRICE_SOURCE_DUPLICATE_CODE:GIFT1515/);
});
