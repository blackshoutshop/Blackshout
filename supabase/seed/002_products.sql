-- ============================================================================
-- BLACKSHOUT — Etapa 1: carga del catálogo (generado desde BS.products de index.html)
-- Ejecutar DESPUÉS de 001_schema.sql. Se puede volver a ejecutar: actualiza precios y datos.
-- IMPORTANTE: estos son los precios con los que el servidor cobra. Si cambiás un precio en
-- index.html, cambialo también acá (o pedime que regenere este archivo).
-- ============================================================================

insert into public.products (id, name, category, collection, color, price, sizes) values
  ('ww-negra-rosa', 'Worldwide Tee Negra Rosa', 'remeras', 'worldwide', 'Negro / Rosa', 25000.00, array['S','M','L','XL']),
  ('ww-negra-bordo', 'Worldwide Tee Negra Bordó', 'remeras', 'worldwide', 'Negro / Bordó', 25000.00, array['S','M','L','XL']),
  ('bs-crema-celeste-grande', 'BS Oval Tee Crema Celeste Grande', 'remeras', 'bs-oval', 'Crema / Celeste', 25000.00, array['S','M','L','XL']),
  ('bs-crema-celeste-chica', 'BS Oval Tee Crema Celeste Chica', 'remeras', 'bs-oval', 'Crema / Celeste', 25000.00, array['S','M','L','XL']),
  ('bs-crema-plata-chica', 'BS Oval Tee Crema Plata Chica', 'remeras', 'bs-oval', 'Crema / Plata', 25000.00, array['S','M','L','XL']),
  ('bs-crema-lima-chica', 'BS Oval Tee Crema Lima Chica', 'remeras', 'bs-oval', 'Crema / Lima y rojo', 25000.00, array['S','M','L','XL']),
  ('baby-roja-worldwide', 'Baby Tee BSHOUT Negra', 'remeras', 'worldwide', 'Negro / Rojo', 20000.00, array['S','M','L','XL']),
  ('baby-bs-plata', 'Baby Tee BS Oval Plata', 'remeras', 'bs-oval', 'Negro / Plata', 20000.00, array['S','M','L','XL']),
  ('baby-bs-lima', 'Baby Tee BS Oval Lima', 'remeras', 'bs-oval', 'Negro / Lima y rojo', 20000.00, array['S','M','L','XL']),
  ('bs-negra-lima', 'BS Oval Tee Negra Lima', 'remeras', 'bs-oval', 'Negro / Lima y rojo', 25000.00, array['S','M','L','XL']),
  ('bs-negra-plata', 'BS Oval Tee Negra Plata', 'remeras', 'bs-oval', 'Negro / Plata', 25000.00, array['S','M','L','XL']),
  ('bs-crema-plata', 'BS Oval Tee Crema Plata', 'remeras', 'bs-oval', 'Crema / Plata', 25000.00, array['S','M','L','XL']),
  ('bs-crema-lima', 'BS Oval Tee Crema Lima', 'remeras', 'bs-oval', 'Crema / Lima y rojo', 25000.00, array['S','M','L','XL']),
  ('bshout-crema-rosa', 'BSHOUT Tee Crema Rosa', 'remeras', 'worldwide', 'Crema / Rosa', 25000.00, array['S','M','L','XL']),
  ('ss-negra-azul', 'Secret Society Company Tee Negra', 'remeras', 'secret-society', 'Negro / Celeste', 25000.00, array['S','M','L','XL']),
  ('ss-crema-rosa', 'Secret Society Company Tee Crema', 'remeras', 'secret-society', 'Crema / Rosa', 25000.00, array['S','M','L','XL']),
  ('studios-blanca', 'Black Shout Studios Tee Blanca', 'remeras', 'worldwide', 'Blanco / Azul', 25000.00, array['S','M','L','XL']),
  ('studios-negra', 'Black Shout Studios Tee Negra', 'remeras', 'worldwide', 'Negro / Blanco', 25000.00, array['S','M','L','XL'])
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  collection = excluded.collection,
  color = excluded.color,
  price = excluded.price,
  sizes = excluded.sizes,
  active = true;

-- Productos que ya no se venden (se retiraron del catálogo de la web): quedan guardados pero inactivos.
update public.products set active = false where collection = 'chaleco';
