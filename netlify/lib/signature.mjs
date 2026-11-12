/*
 * Validación de la firma de los webhooks de Mercado Pago (HMAC-SHA256).
 *
 * El header x-signature llega como "ts=...,v1=...". v1 es el HMAC-SHA256, con la
 * clave secreta de Webhooks, del texto:
 *
 *     id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * data.id sale de la URL de la notificación (?data.id=...). Si es alfanumérico,
 * Mercado Pago lo firma en minúsculas. Si algún dato falta se omite de ese texto.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function parseSignatureHeader(header) {
  const parts = {};
  for (const piece of String(header || '').split(',')) {
    const i = piece.indexOf('=');
    if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }
  return parts;
}

export function buildManifest({ dataId, requestId, ts }) {
  let manifest = '';
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return manifest;
}

export function verifySignature({ secret, signatureHeader, requestId, dataId }) {
  if (!secret) return false;
  const { ts, v1 } = parseSignatureHeader(signatureHeader);
  if (!ts || !v1) return false;

  const expected = createHmac('sha256', secret)
    .update(buildManifest({ dataId, requestId, ts }))
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
