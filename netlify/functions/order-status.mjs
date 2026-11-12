/*
 * GET /api/order-status?payment_id=...&external_reference=...
 *
 * Cuando el cliente vuelve de Mercado Pago, la dirección trae datos que cualquiera
 * puede escribir a mano. Esta función le pregunta a Mercado Pago el estado real del
 * pago y confirma que corresponda al pedido, antes de mostrarle "pago aprobado".
 */
import { getPayment, MpError } from '../lib/mp.mjs';
import { json } from '../lib/config.mjs';

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('[order-status] Falta la variable MP_ACCESS_TOKEN en Netlify.');
    return json({ error: 'not_configured' }, 503);
  }

  const params = new URL(req.url).searchParams;
  const paymentId = params.get('payment_id') || '';
  const reference = params.get('external_reference') || '';
  if (!/^\d{1,20}$/.test(paymentId) || !/^BS-[A-Z0-9-]{4,40}$/.test(reference)) {
    return json({ error: 'invalid_params' }, 400);
  }

  try {
    const payment = await getPayment(accessToken, paymentId);

    // El pago tiene que ser de ESTE pedido. Si no, no se confirma nada.
    if (payment.external_reference !== reference) return json({ error: 'not_found' }, 404);

    return json({
      status: payment.status,
      status_detail: payment.status_detail,
      payment_id: payment.id,
      external_reference: reference,
      total: payment.transaction_amount,
      currency: payment.currency_id
    });
  } catch (err) {
    if (err instanceof MpError && err.status === 404) return json({ error: 'not_found' }, 404);
    console.error('[order-status] No se pudo consultar el pago:', err?.status || '', err?.message);
    return json({ error: 'mp_error' }, 502);
  }
};

export const config = { path: '/api/order-status' };
