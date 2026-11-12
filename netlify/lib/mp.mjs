/*
 * Cliente mínimo de la API de Mercado Pago (REST directo, sin dependencias).
 * Siempre se usa la API de producción: Mercado Pago no tiene sandbox, la
 * diferencia entre probar y cobrar de verdad es solo qué Access Token se carga.
 */
import { randomUUID } from 'node:crypto';

const API = 'https://api.mercadopago.com';
const TIMEOUT_MS = 8000;

export class MpError extends Error {
  constructor(status, body) {
    super(`Mercado Pago respondió ${status}`);
    this.name = 'MpError';
    this.status = status;
    this.body = body;
  }
}

async function request(accessToken, path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MpError(res.status, data);
  return data;
}

/** POST /checkout/preferences (Checkout Pro). Devuelve la preferencia con init_point. */
export function createPreference(accessToken, body) {
  return request(accessToken, '/checkout/preferences', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': randomUUID() },
    body: JSON.stringify(body)
  });
}

/** GET /v1/payments/{id}. Es la única fuente confiable del estado de un pago. */
export function getPayment(accessToken, paymentId) {
  if (!/^\d{1,20}$/.test(String(paymentId))) throw new TypeError('payment id inválido');
  return request(accessToken, `/v1/payments/${paymentId}`, { method: 'GET' });
}
