-- ============================================================================
-- BLACKSHOUT — Etapa 1: esquema de base de datos (Supabase / PostgreSQL)
--
-- Cómo usarlo: Supabase > SQL Editor > New query > pegar TODO este archivo > Run.
-- Se puede volver a ejecutar sin romper nada (usa "if not exists" / "drop ... if exists").
--
-- Modelo de seguridad:
--   * Los clientes (rol anon) NO tienen acceso directo a ninguna tabla.
--   * Todo lo que escribe un pedido o un pago lo hacen las Edge Functions con la
--     service_role key (secreta, nunca va en la web). Esa clave ignora RLS.
--   * Solo los administradores (tabla admin_users + login de Supabase Auth) pueden
--     leer pedidos y cambiar el estado de producción, la dirección y las notas.
--   * Nadie con login puede tocar importes, datos de pago ni payment_status:
--     los permisos de UPDATE están limitados por columna.
-- ============================================================================


-- ---------- Productos (precios de verdad: el backend NUNCA usa precios del navegador) ----------
create table if not exists public.products (
  id          text primary key,                    -- mismo id que BS.products en index.html
  name        text not null,
  category    text not null,
  collection  text,
  color       text not null,
  price       numeric(12,2) not null check (price > 0),   -- en pesos argentinos
  sizes       text[] not null default array['S','M','L','XL'],
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- ---------- Pedidos / comandas ----------
-- El número de comanda sale de una secuencia: único, correlativo y atómico (#000001, #000002...).
create sequence if not exists public.order_number_seq start 1 minvalue 1;

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      bigint not null unique default nextval('public.order_number_seq'),
  idempotency_key   text not null unique,          -- evita pedidos duplicados (doble toque, reintentos)
  status_token      uuid not null default gen_random_uuid(),  -- permite que la pantalla de retorno lea SOLO su pedido

  -- Datos del cliente (el domicilio se pide después del pago, por WhatsApp)
  customer_name     text not null check (char_length(customer_name) between 2 and 120),
  customer_email    text not null check (customer_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  customer_phone    text not null check (char_length(customer_phone) between 6 and 30),

  -- Importes (los calcula el servidor con la tabla products)
  currency          text not null default 'ARS' check (currency = 'ARS'),
  total_amount      numeric(12,2) not null check (total_amount > 0),

  -- Pago
  payment_method    text not null default 'MERCADO PAGO',
  payment_status    text not null default 'PENDIENTE'
                    check (payment_status in ('PENDIENTE','PAGADO','RECHAZADO','CANCELADO','REEMBOLSADO')),
  mp_order_id       text unique,                   -- id de la orden en Mercado Pago
  mp_payment_id     text,
  mp_status         text,                          -- estado crudo informado por Mercado Pago
  mp_status_detail  text,
  paid_at           timestamptz,

  -- Producción y logística (las edita el administrador)
  production_status text not null default 'PENDIENTE'
                    check (production_status in ('PENDIENTE','EN PRODUCCIÓN','LISTO','ENTREGADO')),
  shipping_address  text,
  notes             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Un pedido solo puede figurar como PAGADO si tiene fecha de pago.
  constraint paid_requires_date check (payment_status <> 'PAGADO' or paid_at is not null)
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_payment_status_idx on public.orders (payment_status);


-- ---------- Ítems del pedido (foto fija: conserva nombre, color, talle y precio de ese momento) ----------
create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  product_id    text references public.products(id) on update cascade on delete set null,
  product_name  text not null,
  color         text not null,
  size          text not null check (char_length(size) between 1 and 6),
  quantity      integer not null check (quantity between 1 and 20),
  unit_price    numeric(12,2) not null check (unit_price > 0),
  line_total    numeric(12,2) generated always as (unit_price * quantity) stored,
  created_at    timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);


-- ---------- Notificaciones de Mercado Pago (registro + deduplicación) ----------
create table if not exists public.webhook_events (
  id            bigint generated always as identity primary key,
  event_key     text not null unique,              -- clave de deduplicación que define la función webhook
  event_type    text,
  data_id       text,
  request_id    text,
  signature_ok  boolean not null default false,
  payload       jsonb,
  status        text not null default 'RECIBIDO' check (status in ('RECIBIDO','PROCESADO','IGNORADO','ERROR')),
  error         text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

create index if not exists webhook_events_data_idx on public.webhook_events (data_id);


-- ---------- Registro de errores para diagnóstico ----------
create table if not exists public.error_log (
  id          bigint generated always as identity primary key,
  source      text not null,                       -- por ejemplo 'create-order' o 'mp-webhook'
  message     text not null,
  detail      jsonb,
  order_id    uuid references public.orders(id) on delete set null,
  created_at  timestamptz not null default now()
);


-- ---------- Administradores ----------
-- Solo los emails de esta tabla (y que inicien sesión con Supabase Auth) ven los pedidos.
create table if not exists public.admin_users (
  email       text primary key check (email = lower(email)),
  created_at  timestamptz not null default now()
);


-- ---------- updated_at automático ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();


-- ---------- ¿Quien consulta es administrador? ----------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;


-- ---------- Seguridad: RLS + permisos mínimos ----------
alter table public.products       enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.webhook_events enable row level security;
alter table public.error_log      enable row level security;
alter table public.admin_users    enable row level security;

-- Supabase otorga permisos amplios por defecto: se quitan todos y se da solo lo necesario.
revoke all on table public.products, public.orders, public.order_items,
                    public.webhook_events, public.error_log, public.admin_users
  from anon, authenticated;
revoke all on sequence public.order_number_seq from anon, authenticated;

-- Un administrador logueado puede leer pedidos, ítems y productos...
grant select on public.orders, public.order_items, public.products to authenticated;
-- ...y modificar únicamente producción, domicilio y notas. NUNCA importes ni estado de pago.
grant update (production_status, shipping_address, notes) on public.orders to authenticated;

drop policy if exists admin_select_orders on public.orders;
create policy admin_select_orders on public.orders
  for select to authenticated using (public.is_admin());

drop policy if exists admin_update_orders on public.orders;
create policy admin_update_orders on public.orders
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_select_items on public.order_items;
create policy admin_select_items on public.order_items
  for select to authenticated using (public.is_admin());

drop policy if exists admin_select_products on public.products;
create policy admin_select_products on public.products
  for select to authenticated using (public.is_admin());

-- webhook_events, error_log y admin_users: RLS activo y SIN políticas = solo service_role (las funciones).


-- ---------- Vista para el panel de administración ----------
-- security_invoker: la vista respeta las políticas RLS de quien consulta.
create or replace view public.admin_orders
with (security_invoker = true) as
select
  o.id,
  '#' || lpad(o.order_number::text, 6, '0') as order_code,
  o.order_number,
  o.created_at,
  o.customer_name,
  o.customer_email,
  o.customer_phone,
  o.total_amount,
  o.currency,
  o.payment_method,
  o.payment_status,
  o.production_status,
  o.shipping_address,
  o.notes,
  coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'prenda', i.product_name,
               'color', i.color,
               'talle', i.size,
               'cantidad', i.quantity,
               'precio_unitario', i.unit_price
             ) order by i.created_at, i.id)
    from public.order_items i
    where i.order_id = o.id
  ), '[]'::jsonb) as items
from public.orders o;

revoke all on public.admin_orders from anon, authenticated;
grant select on public.admin_orders to authenticated;
