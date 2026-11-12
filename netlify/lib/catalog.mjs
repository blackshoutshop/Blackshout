/*
 * Valida el carrito que manda la web y lo convierte en ítems de cobro.
 *
 * REGLA DE ORO: el navegador nunca decide cuánto se cobra. De lo que manda la
 * web solo se usan el id del producto, el talle y la cantidad. El nombre y el
 * precio salen de catalog.generated.mjs, que se genera desde el index.html.
 */
import { CATALOG } from './catalog.generated.mjs';

export const MAX_LINES = 30;
export const MAX_QTY_PER_LINE = 20;

export class OrderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'OrderError';
    this.status = status;
  }
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function priceItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new OrderError('El carrito está vacío.');
  if (rawItems.length > MAX_LINES) throw new OrderError('El carrito tiene demasiados productos.');

  const merged = new Map();
  for (const raw of rawItems) {
    const id = typeof raw?.id === 'string' ? raw.id : '';
    const size = typeof raw?.size === 'string' ? raw.size : '';
    const qty = Number(raw?.quantity);

    if (!has(CATALOG.products, id)) throw new OrderError('Hay un producto que ya no está disponible.');
    const product = CATALOG.products[id];

    if (!has(product.stock, size) || !(product.stock[size] > 0)) {
      throw new OrderError(`El talle ${size.slice(0, 8) || '?'} no está disponible para ${product.name}.`);
    }
    if (!Number.isInteger(qty) || qty < 1) throw new OrderError('Cantidad inválida.');

    const key = `${id}|${size}`;
    const total = (merged.get(key)?.quantity || 0) + qty;
    if (total > Math.min(product.stock[size], MAX_QTY_PER_LINE)) {
      throw new OrderError(`No hay stock suficiente de ${product.name} en talle ${size}.`);
    }
    merged.set(key, { id, size, quantity: total, product });
  }

  return [...merged.values()].map(({ id, size, quantity, product }) => ({
    id,
    title: `${product.name} - Talle ${size}`,
    quantity,
    unit_price: product.price,
    currency_id: CATALOG.currency
  }));
}

export function orderTotal(items) {
  return items.reduce((sum, it) => sum + it.unit_price * it.quantity, 0);
}
