/*
 * Genera netlify/lib/catalog.generated.mjs a partir de BS.products del index.html.
 *
 * Por qué existe: el servidor tiene que cobrar los precios reales, no los que
 * diga el navegador. Para no cargar precios en dos lugares, se leen del propio
 * index.html (única fuente de verdad) cada vez que se publica el sitio.
 *
 *   node scripts/build-catalog.mjs          genera el archivo
 *   node scripts/build-catalog.mjs --check  falla si el archivo está desactualizado
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'index.html');
const outPath = join(root, 'netlify', 'lib', 'catalog.generated.mjs');

/** Ejecuta los <script> del index.html sin navegador y devuelve el objeto BS. */
export function loadStore(html) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const code of scripts) {
    try {
      vm.runInContext(code, sandbox, { timeout: 10000 });
    } catch {
      /* Las partes de interfaz necesitan document/DOM y fallan acá. Es esperado:
         el catálogo se define antes y no depende del DOM. */
    }
  }
  if (!sandbox.BS || !Array.isArray(sandbox.BS.products)) {
    throw new Error('No se encontró BS.products en index.html');
  }
  return sandbox.BS;
}

export function buildCatalogSource(BS) {
  const currency = BS.config?.currency || 'ARS';
  const products = {};

  for (const p of BS.products) {
    if (!p.id || !p.name) throw new Error(`Producto sin id o nombre: ${JSON.stringify(p.id)}`);
    if (Object.hasOwn(products, p.id)) throw new Error(`Producto repetido: ${p.id}`);
    if (!Number.isInteger(p.price) || p.price <= 0) {
      throw new Error(`Precio inválido en ${p.id}: ${p.price}. Tiene que ser un número entero mayor a 0.`);
    }
    products[p.id] = { name: p.name, price: p.price, stock: { ...p.stock } };
  }

  return (
    '/*\n' +
    ' * ARCHIVO GENERADO. No editar a mano.\n' +
    ' * Se regenera desde index.html con: node scripts/build-catalog.mjs\n' +
    ' * (Netlify lo corre solo en cada publicación.)\n' +
    ' */\n' +
    `export const CATALOG = ${JSON.stringify({ currency, products }, null, 2)};\n`
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const source = buildCatalogSource(loadStore(readFileSync(htmlPath, 'utf8')));
  const count = Object.keys(JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1)).products).length;

  if (process.argv.includes('--check')) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
    if (current !== source) {
      console.error('catalog.generated.mjs está desactualizado respecto de index.html. Corré: node scripts/build-catalog.mjs');
      process.exit(1);
    }
    console.log(`Catálogo al día (${count} productos).`);
  } else {
    writeFileSync(outPath, source);
    console.log(`Catálogo generado: ${count} productos -> netlify/lib/catalog.generated.mjs`);
  }
}
