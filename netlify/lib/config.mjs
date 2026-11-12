/*
 * Configuración que se lee de variables de entorno (Netlify > Site configuration >
 * Environment variables). Nada secreto vive en el código ni en GitHub.
 *
 *   MP_ACCESS_TOKEN    Access Token de Mercado Pago (secreto).
 *   MP_WEBHOOK_SECRET  Clave secreta de la firma de Webhooks (secreto).
 *   APP_URL            Dirección pública de la tienda, ej. https://blackshout.com.ar
 *                      Si falta se usa la URL que Netlify le asigna al sitio.
 */

const LOCAL_HTTPS = /^https:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i;

/** Dirección base de la tienda, sin barra final. */
export function resolveAppUrl(req) {
  const configured = (process.env.APP_URL || process.env.URL || '').trim();
  const raw = configured || new URL(req.url).origin;
  return raw.replace(/\/+$/, '');
}

/**
 * auto_return y notification_url solo funcionan con una dirección pública HTTPS.
 * Mercado Pago rechaza la preferencia si se las manda con localhost.
 */
export function isPublicHttps(url) {
  return /^https:\/\//i.test(url) && !LOCAL_HTTPS.test(url);
}

/** Respuesta JSON sin caché. */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
