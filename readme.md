# BLACKSHOUT — Tienda web

Streetwear premium hecho en Argentina. Tienda estática de una sola página: no necesita instalar nada ni tener servidor propio para funcionar.

## Contenido del proyecto

```
blackshout-web/
├── index.html        Toda la web: HTML, CSS y JavaScript en un solo archivo
├── README.md         Este archivo
└── img/              Logo y fotos de producto y campaña (23 archivos)
```

- No hay archivos CSS ni JavaScript separados: están dentro de `index.html` (el CSS en la etiqueta `<style>` y el JavaScript en la etiqueta `<script>` al final).
- No hay archivos de configuración separados: la configuración vive al principio del `<script>`, en `BS.config`.
- Los comentarios del código mencionan rutas como `js/` o `docs/`; esos archivos no existen en este proyecto, todo está en `index.html`.
- La tipografía (Archivo e IBM Plex Mono) se carga desde Google Fonts, así que la web necesita internet para verse con su fuente original.

## Probarla en tu computadora

Opción simple: hacé doble clic en `index.html`.

Opción con servidor local (recomendada para probar el carrito y el guardado):

```
cd blackshout-web
python3 -m http.server 8000
```

Después abrí http://localhost:8000

## Publicarla

Es una web estática: alcanza con subir la carpeta completa (`index.html` + `img/`), manteniendo la carpeta `img` al lado del `index.html`. Si la carpeta `img` no está, la web se ve sin fotos ni logo.

- **Netlify**: entrá a app.netlify.com/drop y arrastrá la carpeta `blackshout-web`.
- **Vercel**: importá la carpeta o subila a un repositorio de GitHub y conectalo.
- **GitHub Pages**: subí los archivos a un repositorio y activá Pages desde Settings.
- **Hosting tradicional (cPanel, etc.)**: subí `index.html` y la carpeta `img` a `public_html`.

No hace falta configurar redirecciones: la navegación usa `#` en la URL (por ejemplo `#tienda`, `#producto-bs-negra`), así que funciona en cualquier hosting.

## Qué editar antes de publicar

Todo está en `index.html`, dentro del `<script>`.

1. **Datos de contacto** — `BS.config.contact`
   - `whatsapp`: ya cargado (`5492216993207`). Se usa en el pie de página y en "Finalizar compra".
   - `instagram` y `tiktok`: están vacíos. Pegá la URL completa del perfil.
   - `email`: vacío, opcional.
2. **Aviso de catálogo de prueba** — `BS.config.devNotice`
   - Está en `true` y muestra una franja naranja arriba con etiquetas "a confirmar". Pasalo a `false` cuando los datos sean reales.
3. **Catálogo** — `BS.products`
   - Precios, stock por talle y descripciones. Los precios y el stock actuales son de ejemplo.
   - Para sumar un producto, copiá un bloque, cambiá los datos y agregá sus fotos a la carpeta `img` (relación 4:5, 1000 x 1250 px recomendado).
4. **Guía de talles** — `BS.config.sizeGuide`
   - Las medidas son de ejemplo. Reemplazalas por las reales.
5. **Páginas informativas** — `BS.pages`
   - FAQ, cambios y devoluciones, envíos y medios de pago están vacías ("a definir"). Solo Contacto tiene texto.
   - Texto corto de envíos en la ficha de producto: `BS.shippingNote`.
6. **URL pública** — `BS.config.siteUrl`
   - Cuando tengas dominio, cargalo para completar los datos de SEO.
7. **Newsletter** — `BS.config.newsletterEndpoint`
   - Está vacío: el formulario avisa que todavía no está conectado.

## Pagos y envíos

- **Pagos**: `BS.config.payments.provider` está en `'none'`. Hoy "Finalizar compra" arma el pedido para copiarlo o enviarlo por WhatsApp. Para cobrar con Mercado Pago hace falta un backend propio que cree la preferencia de pago con tu Access Token (secreto, nunca va en la web) y devuelva `{ init_point }`. Después se cargan `provider: 'mercadopago'` y `checkoutEndpoint` con la URL de ese backend.
- **Envíos**: `BS.config.shipping.provider` está en `'none'`. La web no muestra costos de envío inventados. Para cotizar con Correo Argentino, Andreani o Envío Pack hace falta un backend con tus credenciales que devuelva las opciones en este formato: `{ options: [{ carrier, service, price, days }] }`.

## Funciones incluidas

- Catálogo con filtros, orden y búsqueda.
- Ficha de producto con galería, zoom, guía de talles y control de stock por talle.
- Carrito con guardado en el navegador del cliente.
- Secciones: Shop, New Drop, Best Sellers, Collections, About Us y Last Units.
- Diseño adaptado a celular y computadora.
