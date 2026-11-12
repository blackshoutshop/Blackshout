# Activar el cobro automático con Mercado Pago

Cómo funciona: el cliente arma el carrito, toca **PAGAR CON MERCADO PAGO**, paga en Mercado Pago y vuelve a la tienda. La web le pregunta a Mercado Pago si el pago es real. Si está aprobado, lo lleva solo a WhatsApp con el pedido, el número de pedido y el número de pago.

## Importante: dónde tiene que estar publicada la web

GitHub Pages (`blackshoutshop.github.io`) solo muestra páginas: **no puede cobrar**, porque no guarda secretos ni recibe avisos de Mercado Pago. El cobro funciona cuando la web está publicada en **Netlify**, conectada a este mismo repo de GitHub. El sitio en GitHub Pages sigue mostrando el botón anterior (pedido por WhatsApp) hasta que se publique en Netlify.

## Pasos

1. **Subir estos archivos al repo** (rama `main`), respetando las carpetas:
   `index.html`, `netlify.toml`, `package.json`, `.gitignore`, `.env.example`, `scripts/`, `netlify/`, `tests/`.
2. **Netlify**: importar el repo (Add new site → Import from Git). No hace falta configurar nada más: `netlify.toml` ya trae todo.
3. **Cargar las variables secretas** en Netlify → Site configuration → Environment variables:
   - `MP_ACCESS_TOKEN`: Mercado Pago Developers → tu aplicación → Credenciales.
   - `MP_WEBHOOK_SECRET`: lo da Mercado Pago en el paso 4.
   - `APP_URL`: la dirección pública de la tienda, sin barra al final (ej. `https://blackshout.netlify.app`).
4. **Webhook en Mercado Pago**: Developers → tu aplicación → Webhooks → Configurar notificaciones.
   - URL: `https://TU-TIENDA/api/mp-webhook`
   - Evento: **Pagos**
   - Copiá la **Clave secreta** y cargala como `MP_WEBHOOK_SECRET` (paso 3).
5. **Volver a publicar** en Netlify (Deploys → Trigger deploy) para que tome las variables.

## Probar antes de cobrar de verdad

1. Cargá primero el Access Token de **prueba** (pestaña "Prueba" de las credenciales).
2. Hacé una compra con una tarjeta de prueba de Mercado Pago, con un usuario comprador de prueba.
3. Verificá que aparezca **PAGO APROBADO** y que te lleve a WhatsApp con el pedido.
4. Recién ahí reemplazá `MP_ACCESS_TOKEN` por el de **producción** y volvé a publicar.

## Seguridad

- Nunca subas el Access Token ni la clave del webhook a GitHub ni los pegues en el código: van solo como variables de Netlify.
- Los precios los cobra el servidor desde `index.html`. Si cambiás un precio ahí y publicás, el cobro se actualiza solo. Nadie puede cambiar el monto desde el navegador.
- Si algún día se filtra el token, regeneralo en Mercado Pago y actualizalo en Netlify.

## Volver al modo solo WhatsApp

En `index.html`, dentro de `BS.config.payments`, poné `provider: 'none'`.

## Para el equipo técnico

- `npm test` corre las 40 pruebas del servidor (sin internet ni credenciales reales).
- `node scripts/build-catalog.mjs` regenera el catálogo de precios del servidor (Netlify lo corre solo en cada publicación).
- El aviso de Mercado Pago queda registrado en Netlify → Logs → Functions. El punto para sumar acciones (por ejemplo un mail al aprobar un pago) es `onPaymentUpdated` en `netlify/functions/mp-webhook.mjs`.
