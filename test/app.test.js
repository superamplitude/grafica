import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

process.env.DB_REQUIRED = 'true';
delete process.env.DB_NAME;
delete process.env.DB_USER;

const app = await buildApp();
await app.ready();

test('GET / serves Central Prints home', async () => {
  const response = await app.inject({ method: 'GET', url: '/' });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Central Prints/i);
});

for (const [url, marker] of [
  ['/catalogo.html', /Catálogo Central Prints/i],
  ['/precos.html', /Tabela de preços/i],
  ['/produto.html', /Configurar produto/i],
  ['/checkout.html', /Finalizar/i],
  ['/pedido.html', /Acompanhe sua solicitação/i],
  ['/admin/', /Super Admin/i],
  ['/admin/catalogo.html', /Editor de Catálogo/i],
  ['/admin/site.html', /Editor do Site/i],
  ['/admin/pedidos.html', /Pedidos/i],
  ['/admin/prepress.html', /Pré-impressão/i],
  ['/admin/finalizacao.html', /Finalização e Publicação/i]
]) {
  test(`GET ${url} serves essential site page`, async () => {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, marker);
  });
}

test('GET /api returns service metadata', async () => {
  const response = await app.inject({ method: 'GET', url: '/api' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.name, 'Central Prints API');
});

test('GET /api/health is liveness and remains 200 without database', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.database, 'unconfigured');
});

test('GET /api/ready blocks readiness while required database is unavailable', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/ready' });
  assert.equal(response.statusCode, 503);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.equal(body.dbRequired, true);
});

test.after(async () => {
  await app.close();
});
