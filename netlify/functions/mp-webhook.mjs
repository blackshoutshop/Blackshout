/*
 * POST /api/mp-webhook
 *
 * Mercado Pago avisa acá cada vez que cambia el estado de un pago, aunque el
 * cliente haya cerrado la pestaña. Orden de trabajo:
 *   1. Validar la firma (HMAC-SHA256). Sin firma válida no se toca nada.
 *   2. Consultar el pago real a Mercado Pago (el aviso solo trae un id).
 *   3. Registrar el resultado (onPaymentUpdated).
 *
 * Nota sobre Netlify: a diferencia de un servidor común, una función se congela
 * apenas responde. Por eso acá se procesa ANTES de contestar 200 (son un par de
 * segundos) en vez de responder primero y procesar después.
 */
import { verifySignature } from '../lib/signature.mjs';
import { getPayment, MpError } from '../lib/mp.mjs';

const text = (body, status) => new Response(body, { status });

/**
 * Punto de extensión: se llama por cada notificación de pago ya verificada.
 * Puede repetirse para el mismo pago (Mercado Pago reintenta), así que lo que
 * se agregue acá tiene que ser seguro de ejecutar más de una vez.
 * Hoy deja un registro en Netlify > Logs > Functions. Ahí se puede sumar, por
 * ejemplo, un aviso por mail a la marca cuando status === 'approved'.
 */
export async function onPaymentUpdated(payment) {
  console.log(
    '[mp-webhook] pago verificado',
    JSON.stringify({
      payment_id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail,
      external_reference: payment.external_reference,
      amount: payment.transaction_amount,
      currency: payment.currency_id,
      method: payment.payment_method_id
    })
  );
}

export default async (req) => {
  if (req.method !== 'POST') return text('Method Not Allowed', 405);

  const secret = process.env.MP_WEBHOOK_SECRET;
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!secret || !accessToken) {
    console.error('[mp-webhook] Faltan MP_WEBHOOK_SECRET o MP_ACCESS_TOKEN en Netlify.');
    return text('Not configured', 503);
  }

  const url = new URL(req.url);
  let body = {};
  try {
    body = JSON.parse((await req.text()) || '{}');
  } catch {
    /* El id también viaja en la URL; el cuerpo es secundario. */
  }

  const dataId = url.searchParams.get('data.id') || (body?.data?.id != null ? String(body.data.id) : '');

  // 1. Firma primero, antes de mirar el contenido.
  const valid = verifySignature({
    secret,
    signatureHeader: req.headers.get('x-signature'),
    requestId: req.headers.get('x-request-id'),
    dataId
  });
  if (!valid) {
    console.warn('[mp-webhook] Firma inválida: notificación descartada.');
    return text('Invalid signature', 401);
  }

  const topic = body?.type || url.searchParams.get('type') || url.searchParams.get('topic') || '';
  if (topic !== 'payment') {
    // Otros avisos (merchant_order, etc.) no hacen falta: se confirman y listo.
    return text('OK', 200);
  }
  if (!/^\d{1,20}$/.test(dataId)) return text('Bad request', 400);

  // 2 y 3. Estado real del pago y registro.
  try {
    const payment = await getPayment(accessToken, dataId);
    await onPaymentUpdated(payment);
    return text('OK', 200);
  } catch (err) {
    // Mercado Pago manda pagos de prueba con ids que no existen: no reintentar.
    if (err instanceof MpError && err.status === 404) {
      console.warn('[mp-webhook] El pago', dataId, 'no existe en esta cuenta (¿notificación de prueba?).');
      return text('OK', 200);
    }
    // Error temporal: un 500 le pide a Mercado Pago que reintente más tarde.
    console.error('[mp-webhook] No se pudo procesar el pago', dataId, err?.status || '', err?.message);
    return text('Error', 500);
  }
};

export const config = { path: '/api/mp-webhook' };
