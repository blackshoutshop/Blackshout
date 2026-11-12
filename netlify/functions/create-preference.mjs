/*
 * POST /api/create-preference
 *
 * Recibe el carrito, recalcula los precios en el servidor y crea la preferencia
 * de Checkout Pro. Devuelve { init_point, external_reference }; la web lleva al
 * cliente a init_point para pagar en Mercado Pago.
 */
import { randomBytes } from 'node:crypto';
import { priceItems, OrderError } from '../lib/catalog.mjs';
import { createPreference, MpError } from '../lib/mp.mjs';
import { resolveAppUrl, isPublicHttps, json } from '../lib/config.mjs';

/** Número de pedido legible y único. Es el ancla para reconciliar el pago. */
function newReference() {
  return `BS-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('[create-preference] Falta la variable MP_ACCESS_TOKEN en Netlify.');
    return json({ error: 'not_configured' }, 503);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // Solo se toman id, talle y cantidad. El precio sale del catálogo del servidor.
  let items;
  try {
    items = priceItems(body?.items);
  } catch (err) {
    if (err instanceof OrderError) return json({ error: 'invalid_order', message: err.message }, err.status);
    throw err;
  }

  const appUrl = resolveAppUrl(req);
  // Regla: auto_return y notification_url solo se mandan si la dirección de la tienda
  // (APP_URL) empieza con https:// y es pública. Con localhost (pruebas en tu
  // computadora) Mercado Pago rechaza la preferencia, así que ahí se omiten.
  const publicAppUrl = isPublicHttps(appUrl);
  const reference = newReference();

  try {
    const preference = await createPreference(accessToken, {
      items,
      back_urls: {
        success: `${appUrl}/?mp=success`,
        failure: `${appUrl}/?mp=failure`,
        pending: `${appUrl}/?mp=pending`
      },
      ...(publicAppUrl
        ? { auto_return: 'approved', notification_url: `${appUrl}/api/mp-webhook` }
        : {}),
      external_reference: reference,
      statement_descriptor: 'BLACKSHOUT'
    });

    // Se usa siempre init_point: Mercado Pago ya no tiene un entorno de pruebas aparte.
    if (!preference.init_point) {
      console.error('[create-preference] La respuesta de Mercado Pago no trae init_point.');
      return json({ error: 'mp_error' }, 502);
    }
    return json({ init_point: preference.init_point, external_reference: reference });
  } catch (err) {
    if (err instanceof MpError) {
      // El detalle va al log de Netlify, nunca a la respuesta del navegador.
      console.error('[create-preference] Mercado Pago rechazó la preferencia:', err.status, JSON.stringify(err.body));
    } else {
      console.error('[create-preference] Error inesperado:', err?.message);
    }
    return json({ error: 'mp_error' }, 502);
  }
};

export const config = { path: '/api/create-preference' };
