/*
 * Pruebas del cobro con Mercado Pago. No usan internet ni credenciales reales:
 * la API de Mercado Pago se simula y los tokens de acá son valores falsos.
 *
 *   npm test        (o: node --test tests/mercadopago.test.mjs)
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import createPreference from '../netlify/functions/create-preference.mjs';
import orderStatus from '../netlify/functions/order-status.mjs';
import webhook from '../netlify/functions/mp-webhook.mjs';
import { verifySignature } from '../netlify/lib/signature.mjs';
import { priceItems } from '../netlify/lib/catalog.mjs';
import { CATALOG } from '../netlify/lib/catalog.generated.mjs';
import { loadStore, buildCatalogSource } from '../scripts/build-catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Valores falsos, solo para estas pruebas. */
const FAKE_TOKEN = 'token-falso-solo-para-pruebas';
const LEAKY_TOKEN = 'token-falso-que-nunca-debe-filtrarse';
const SECRET = 'clave-falsa-de-webhook';

/* ---------- Entorno simulado ---------- */
const ENV_KEYS = ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'APP_URL', 'URL'];
const realFetch = globalThis.fetch;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
let savedEnv;
let calls;
let logs;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  calls = [];
  logs = [];
  console.log = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  globalThis.fetch = async () => {
    throw new Error('fetch no simulado: la prueba intentó salir a internet');
  };
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
});

function mockMp(handler) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
}
const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const post = (url, body) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const PREF_URL = 'https://tienda.test/api/create-preference';
const INIT_POINT = 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=123-abc';

/* =====================================================================
 * Catálogo
 * ===================================================================== */
test('catálogo: el archivo generado coincide con los precios del index.html', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const expected = buildCatalogSource(loadStore(html));
  const current = readFileSync(join(root, 'netlify/lib/catalog.generated.mjs'), 'utf8');
  assert.equal(current, expected, 'Corré: node scripts/build-catalog.mjs');
});

test('catálogo: todos los precios son enteros positivos y hay productos', () => {
  const entries = Object.entries(CATALOG.products);
  assert.ok(entries.length > 0);
  for (const [id, p] of entries) {
    assert.ok(Number.isInteger(p.price) && p.price > 0, `precio inválido en ${id}`);
  }
});

test('priceItems: ignora el precio y el título que manda el navegador', () => {
  const [line] = priceItems([{ id: 'baby-bs-plata', size: 'M', quantity: 1, unit_price: 1, title: 'GRATIS', price: 0 }]);
  assert.equal(line.unit_price, CATALOG.products['baby-bs-plata'].price);
  assert.equal(line.title, 'Baby Tee BS Oval Plata - Talle M');
});

test('priceItems: junta líneas repetidas del mismo producto y talle', () => {
  const lines = priceItems([
    { id: 'baby-bs-plata', size: 'M', quantity: 1 },
    { id: 'baby-bs-plata', size: 'M', quantity: 2 },
    { id: 'baby-bs-plata', size: 'L', quantity: 1 }
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines.find((l) => l.title.endsWith('Talle M')).quantity, 3);
});

for (const [label, items] of [
  ['carrito vacío', []],
  ['sin items', undefined],
  ['producto inexistente', [{ id: 'no-existe', size: 'M', quantity: 1 }]],
  ['id __proto__', [{ id: '__proto__', size: 'M', quantity: 1 }]],
  ['id constructor', [{ id: 'constructor', size: 'M', quantity: 1 }]],
  ['talle inexistente', [{ id: 'baby-bs-plata', size: 'XXL', quantity: 1 }]],
  ['talle __proto__', [{ id: 'baby-bs-plata', size: '__proto__', quantity: 1 }]],
  ['cantidad 0', [{ id: 'baby-bs-plata', size: 'M', quantity: 0 }]],
  ['cantidad negativa', [{ id: 'baby-bs-plata', size: 'M', quantity: -1 }]],
  ['cantidad decimal', [{ id: 'baby-bs-plata', size: 'M', quantity: 1.5 }]],
  ['cantidad texto', [{ id: 'baby-bs-plata', size: 'M', quantity: 'mucho' }]],
  ['cantidad excesiva', [{ id: 'baby-bs-plata', size: 'M', quantity: 21 }]],
  ['demasiadas líneas', Array.from({ length: 31 }, () => ({ id: 'baby-bs-plata', size: 'M', quantity: 1 }))]
]) {
  test(`priceItems: rechaza ${label}`, () => {
    assert.throws(() => priceItems(items), { name: 'OrderError' });
  });
}

/* =====================================================================
 * Firma del webhook
 * ===================================================================== */
function sign({ secret = SECRET, dataId, requestId, ts = '1700000000000' }) {
  const v1 = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

test('firma: acepta una firma válida', () => {
  const signatureHeader = sign({ dataId: '987654321', requestId: 'req-1' });
  assert.equal(verifySignature({ secret: SECRET, signatureHeader, requestId: 'req-1', dataId: '987654321' }), true);
});

test('firma: rechaza si cambia el id, la clave, el request-id o falta algo', () => {
  const signatureHeader = sign({ dataId: '987654321', requestId: 'req-1' });
  const base = { secret: SECRET, signatureHeader, requestId: 'req-1', dataId: '987654321' };
  assert.equal(verifySignature({ ...base, dataId: '111' }), false);
  assert.equal(verifySignature({ ...base, secret: 'otra' }), false);
  assert.equal(verifySignature({ ...base, requestId: 'req-2' }), false);
  assert.equal(verifySignature({ ...base, signatureHeader: '' }), false);
  assert.equal(verifySignature({ ...base, signatureHeader: 'ts=1' }), false);
  assert.equal(verifySignature({ ...base, signatureHeader: 'v1=abc' }), false);
  assert.equal(verifySignature({ ...base, secret: '' }), false);
});

test('firma: un id alfanumérico se firma en minúsculas', () => {
  const signatureHeader = sign({ dataId: 'abc123', requestId: 'r' });
  assert.equal(verifySignature({ secret: SECRET, signatureHeader, requestId: 'r', dataId: 'ABC123' }), true);
});

/* =====================================================================
 * POST /api/create-preference
 * ===================================================================== */
test('create-preference: crea la preferencia con precios del servidor y devuelve init_point', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  process.env.APP_URL = 'https://tienda.test';
  mockMp(() => reply({ id: '123-abc', init_point: INIT_POINT }, 201));

  const res = await createPreference(
    post(PREF_URL, { items: [{ id: 'baby-bs-plata', size: 'M', quantity: 2, unit_price: 1, title: 'GRATIS' }] })
  );
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.init_point, INIT_POINT);
  assert.match(data.external_reference, /^BS-[A-Z0-9]+-[A-F0-9]{6}$/);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.mercadopago.com/checkout/preferences');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
  assert.ok(calls[0].init.headers['X-Idempotency-Key']);

  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.items.length, 1);
  assert.equal(sent.items[0].unit_price, CATALOG.products['baby-bs-plata'].price, 'el precio no puede venir del navegador');
  assert.equal(sent.items[0].quantity, 2);
  assert.equal(sent.items[0].title, 'Baby Tee BS Oval Plata - Talle M');
  assert.equal(sent.items[0].currency_id, 'ARS');
  assert.equal(sent.external_reference, data.external_reference);
  assert.deepEqual(sent.back_urls, {
    success: 'https://tienda.test/?mp=success',
    failure: 'https://tienda.test/?mp=failure',
    pending: 'https://tienda.test/?mp=pending'
  });
  assert.equal(sent.auto_return, 'approved');
  assert.equal(sent.notification_url, 'https://tienda.test/api/mp-webhook');
  assert.ok(!JSON.stringify(sent).includes('sandbox'));
});

test('create-preference: sin dirección pública HTTPS no manda auto_return ni notification_url', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  mockMp(() => reply({ init_point: INIT_POINT }, 201));

  for (const origin of ['http://localhost:8888', 'https://localhost:8888', 'http://tienda.test']) {
    calls.length = 0;
    const res = await createPreference(post(`${origin}/api/create-preference`, { items: [{ id: 'baby-bs-plata', size: 'S', quantity: 1 }] }));
    assert.equal(res.status, 200, origin);
    const sent = JSON.parse(calls[0].init.body);
    assert.ok(!('auto_return' in sent), `auto_return con ${origin}`);
    assert.ok(!('notification_url' in sent), `notification_url con ${origin}`);
    assert.ok(sent.back_urls.success.startsWith(origin));
  }
});

test('create-preference: APP_URL manda sobre la dirección del pedido y se limpia la barra final', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  process.env.APP_URL = 'https://blackshout.example/';
  mockMp(() => reply({ init_point: INIT_POINT }, 201));
  await createPreference(post('http://otro-dominio.test/api/create-preference', { items: [{ id: 'baby-bs-plata', size: 'S', quantity: 1 }] }));
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.back_urls.success, 'https://blackshout.example/?mp=success');
});

test('create-preference: sin MP_ACCESS_TOKEN responde 503 y no llama a Mercado Pago', async () => {
  mockMp(() => reply({}));
  const res = await createPreference(post(PREF_URL, { items: [{ id: 'baby-bs-plata', size: 'S', quantity: 1 }] }));
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test('create-preference: método y cuerpo inválidos', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  mockMp(() => reply({}));
  assert.equal((await createPreference(new Request(PREF_URL, { method: 'GET' }))).status, 405);
  assert.equal((await createPreference(post(PREF_URL, '{no es json'))).status, 400);
  assert.equal(calls.length, 0);
});

test('create-preference: un pedido inválido responde 400 y no llama a Mercado Pago', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  mockMp(() => reply({}));
  for (const items of [[], [{ id: 'no-existe', size: 'M', quantity: 1 }], [{ id: 'baby-bs-plata', size: 'M', quantity: 0 }], [{ id: '__proto__', size: 'M', quantity: 1 }]]) {
    const res = await createPreference(post(PREF_URL, { items }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_order');
  }
  assert.equal(calls.length, 0);
});

test('create-preference: si Mercado Pago falla, responde 502 sin filtrar detalles ni el token', async () => {
  process.env.MP_ACCESS_TOKEN = LEAKY_TOKEN;
  mockMp(() => reply({ message: 'detalle interno de MP', cause: [{ code: 3000 }] }, 400));
  const res = await createPreference(post(PREF_URL, { items: [{ id: 'baby-bs-plata', size: 'M', quantity: 1 }] }));
  const raw = await res.text();
  assert.equal(res.status, 502);
  assert.deepEqual(JSON.parse(raw), { error: 'mp_error' });
  assert.ok(!raw.includes('detalle interno'));
  assert.ok(!raw.includes(LEAKY_TOKEN));
  assert.ok(!logs.join('\n').includes(LEAKY_TOKEN), 'el token no debe aparecer en los logs');
});

test('create-preference: si la respuesta no trae init_point responde 502', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  mockMp(() => reply({ id: 'x', sandbox_init_point: 'https://sandbox.example' }, 201));
  const res = await createPreference(post(PREF_URL, { items: [{ id: 'baby-bs-plata', size: 'M', quantity: 1 }] }));
  assert.equal(res.status, 502);
});

/* =====================================================================
 * GET /api/order-status
 * ===================================================================== */
const STATUS_URL = 'https://tienda.test/api/order-status';
const REF = 'BS-ABC123-A1B2C3';

test('order-status: devuelve el estado real cuando el pago corresponde al pedido', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  mockMp(() => reply({ id: 123456, status: 'approved', status_detail: 'accredited', external_reference: REF, transaction_amount: 40000, currency_id: 'ARS', payer: { email: 'privado@x.com' } }));
  const res = await orderStatus(new Request(`${STATUS_URL}?payment_id=123456&external_reference=${REF}`));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.status, 'approved');
  assert.equal(data.total, 40000);
  assert.ok(!JSON.stringify(data).includes('privado@x.com'), 'no debe devolver datos del comprador');
  assert.equal(calls[0].url, 'https://api.mercadopago.com/v1/payments/123456');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
});

test('order-status: si el pago es de otro pedido no confirma nada', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  mockMp(() => reply({ id: 123456, status: 'approved', external_reference: 'BS-OTRO-000000' }));
  const res = await orderStatus(new Request(`${STATUS_URL}?payment_id=123456&external_reference=${REF}`));
  assert.equal(res.status, 404);
  assert.ok(!(await res.text()).includes('approved'));
});

test('order-status: parámetros inválidos no llegan a Mercado Pago', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  mockMp(() => reply({}));
  for (const qs of [
    '', `payment_id=12ab&external_reference=${REF}`, `payment_id=1/../2&external_reference=${REF}`,
    'payment_id=123&external_reference=XX-1', 'payment_id=123&external_reference=BS-abc-def', `external_reference=${REF}`
  ]) {
    const res = await orderStatus(new Request(`${STATUS_URL}?${qs}`));
    assert.equal(res.status, 400, qs);
  }
  assert.equal(calls.length, 0);
});

test('order-status: errores de Mercado Pago y configuración', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  const url = `${STATUS_URL}?payment_id=123&external_reference=${REF}`;
  mockMp(() => reply({ message: 'not found' }, 404));
  assert.equal((await orderStatus(new Request(url))).status, 404);
  mockMp(() => reply({ message: 'boom' }, 500));
  assert.equal((await orderStatus(new Request(url))).status, 502);
  assert.equal((await orderStatus(new Request(url, { method: 'POST' }))).status, 405);
  delete process.env.MP_ACCESS_TOKEN;
  assert.equal((await orderStatus(new Request(url))).status, 503);
});

/* =====================================================================
 * POST /api/mp-webhook
 * ===================================================================== */
function webhookRequest({ dataId = '987654321', type = 'payment', secret = SECRET, requestId = 'req-1', signature, query } = {}) {
  const qs = query ?? `data.id=${dataId}&type=${type}`;
  return new Request(`https://tienda.test/api/mp-webhook?${qs}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': requestId,
      'x-signature': signature ?? sign({ secret, dataId, requestId })
    },
    body: JSON.stringify({ type, data: { id: dataId } })
  });
}

function configureWebhookEnv() {
  process.env.MP_WEBHOOK_SECRET = SECRET;
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
}

test('webhook: con firma válida consulta el pago real, lo registra y responde 200', async () => {
  configureWebhookEnv();
  mockMp(() => reply({ id: 987654321, status: 'approved', status_detail: 'accredited', external_reference: REF, transaction_amount: 25000, currency_id: 'ARS', payment_method_id: 'visa', payer: { email: 'privado@x.com' } }));
  const res = await webhook(webhookRequest());
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.mercadopago.com/v1/payments/987654321');
  const log = logs.find((l) => l.includes('pago verificado'));
  assert.ok(log && log.includes('"status":"approved"') && log.includes(REF));
  assert.ok(!logs.join('\n').includes('privado@x.com'), 'el mail del comprador no se registra');
});

test('webhook: firma inválida se descarta con 401 sin consultar nada', async () => {
  configureWebhookEnv();
  mockMp(() => reply({}));
  assert.equal((await webhook(webhookRequest({ secret: 'clave-equivocada' }))).status, 401);
  assert.equal((await webhook(webhookRequest({ signature: 'ts=1,v1=00' }))).status, 401);
  // Firma válida para otro id: cambiar el id de la URL la invalida.
  const stolen = webhookRequest({ dataId: '111', signature: sign({ dataId: '222', requestId: 'req-1' }) });
  assert.equal((await webhook(stolen)).status, 401);
  assert.equal(calls.length, 0);
});

test('webhook: sin firma ni headers responde 401', async () => {
  configureWebhookEnv();
  mockMp(() => reply({}));
  const res = await webhook(new Request('https://tienda.test/api/mp-webhook?data.id=1&type=payment', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('webhook: sin MP_WEBHOOK_SECRET no procesa nada (503)', async () => {
  process.env.MP_ACCESS_TOKEN = FAKE_TOKEN;
  mockMp(() => reply({}));
  assert.equal((await webhook(webhookRequest())).status, 503);
  assert.equal(calls.length, 0);
});

test('webhook: otros temas con firma válida se confirman sin consultar', async () => {
  configureWebhookEnv();
  mockMp(() => reply({}));
  const res = await webhook(webhookRequest({ type: 'merchant_order', dataId: '555' }));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('webhook: un id que no es numérico responde 400', async () => {
  configureWebhookEnv();
  mockMp(() => reply({}));
  assert.equal((await webhook(webhookRequest({ dataId: 'abc' }))).status, 400);
  assert.equal(calls.length, 0);
});

test('webhook: pago inexistente (notificación de prueba) = 200; error de Mercado Pago = 500 para que reintente', async () => {
  configureWebhookEnv();
  mockMp(() => reply({ message: 'payment not found' }, 404));
  assert.equal((await webhook(webhookRequest({ dataId: '123456' }))).status, 200);
  mockMp(() => reply({ message: 'boom' }, 500));
  assert.equal((await webhook(webhookRequest())).status, 500);
});

test('webhook: solo acepta POST', async () => {
  configureWebhookEnv();
  assert.equal((await webhook(new Request('https://tienda.test/api/mp-webhook'))).status, 405);
});
