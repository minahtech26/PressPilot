create extension if not exists pgcrypto;

create type public.shop_role as enum ('owner', 'manager', 'cashier', 'kitchen');
create type public.order_status as enum ('new', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled');
create type public.payment_status as enum ('unpaid', 'partial', 'paid', 'refunded');
create type public.table_status as enum ('available', 'occupied', 'order_pending', 'preparing', 'bill_pending', 'payment_completed');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  logo_url text,
  cover_url text,
  address text,
  phone text,
  email text,
  gstin text,
  currency char(3) not null default 'INR',
  is_active boolean not null default true,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role public.shop_role not null default 'cashier',
  created_at timestamptz not null default now(),
  unique (shop_id, profile_id)
);

create table public.shop_settings (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  tax_rate numeric(7,4) not null default 0 check (tax_rate between 0 and 100),
  tax_inclusive boolean not null default false,
  service_charge_rate numeric(7,4) not null default 0 check (service_charge_rate between 0 and 100),
  invoice_prefix text not null default 'INV',
  receipt_footer text,
  inventory_enabled boolean not null default false,
  allow_negative_stock boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  table_number text not null,
  status public.table_status not null default 'available',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, table_number)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  name text not null,
  sku text,
  description text,
  image_url text,
  base_price numeric(12,2) not null check (base_price >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate between 0 and 100),
  is_available boolean not null default true,
  is_featured boolean not null default false,
  is_vegetarian boolean,
  available_from time,
  available_until time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, sku)
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  price numeric(12,2) not null check (price >= 0),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, name)
);

create table public.customization_groups (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  selection_type text not null default 'single' check (selection_type in ('single', 'multiple')),
  is_required boolean not null default false,
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer check (max_selections is null or max_selections >= min_selections),
  created_at timestamptz not null default now()
);

create table public.customization_options (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  group_id uuid not null references public.customization_groups (id) on delete cascade,
  name text not null,
  price_delta numeric(12,2) not null default 0,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

create table public.product_customization_groups (
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  group_id uuid not null references public.customization_groups (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (product_id, group_id)
);

create table public.addons (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  price numeric(12,2) not null default 0 check (price >= 0),
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table public.product_addons (
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  addon_id uuid not null references public.addons (id) on delete cascade,
  primary key (product_id, addon_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  table_id uuid references public.dining_tables (id) on delete set null,
  order_number bigint generated by default as identity,
  customer_name text,
  customer_phone text,
  notes text,
  status public.order_status not null default 'new',
  payment_status public.payment_status not null default 'unpaid',
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  tax numeric(12,2) not null default 0 check (tax >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  variant_name text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  tax numeric(12,2) not null default 0 check (tax >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  instructions text,
  created_at timestamptz not null default now()
);

create table public.order_item_customizations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  option_id uuid references public.customization_options (id) on delete set null,
  group_name text not null,
  option_name text not null,
  price_delta numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.order_item_addons (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  addon_id uuid references public.addons (id) on delete set null,
  addon_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  table_id uuid references public.dining_tables (id) on delete set null,
  invoice_number text,
  status text not null default 'open' check (status in ('open', 'settled', 'void')),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  tax numeric(12,2) not null default 0 check (tax >= 0),
  service_charge numeric(12,2) not null default 0 check (service_charge >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, invoice_number)
);

create table public.bill_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  bill_id uuid not null references public.bills (id) on delete cascade,
  order_item_id uuid references public.order_items (id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  tax numeric(12,2) not null default 0 check (tax >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  bill_id uuid not null references public.bills (id) on delete restrict,
  method text not null check (method in ('cash', 'upi', 'card', 'other')),
  amount numeric(12,2) not null check (amount > 0),
  reference text,
  received_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  unit text not null,
  quantity numeric(14,3) not null default 0,
  low_stock_threshold numeric(14,3) not null default 0 check (low_stock_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table public.product_ingredients (
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items (id) on delete cascade,
  quantity numeric(14,3) not null check (quantity > 0),
  primary key (product_id, inventory_item_id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  supplier_id uuid references public.suppliers (id) on delete set null,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  purchased_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  notes text
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  reason text not null,
  reference_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  recipient_id uuid references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.invoice_sequences (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  next_value bigint not null default 1 check (next_value > 0),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index shops_created_by_idx on public.shops (created_by);
create index shop_members_profile_idx on public.shop_members (profile_id);
create index dining_tables_shop_status_idx on public.dining_tables (shop_id, status);
create index categories_shop_sort_idx on public.categories (shop_id, sort_order);
create index products_shop_available_idx on public.products (shop_id, is_available);
create index products_category_idx on public.products (category_id);
create index product_variants_product_idx on public.product_variants (product_id, sort_order);
create index customization_options_group_idx on public.customization_options (group_id, sort_order);
create index orders_shop_created_idx on public.orders (shop_id, created_at desc);
create index orders_shop_status_idx on public.orders (shop_id, status, created_at desc);
create index orders_table_status_idx on public.orders (table_id, payment_status);
create index order_items_order_idx on public.order_items (order_id);
create index bills_shop_created_idx on public.bills (shop_id, created_at desc);
create index payments_bill_idx on public.payments (bill_id, created_at);
create index inventory_items_low_stock_idx on public.inventory_items (shop_id, quantity, low_stock_threshold);
create index stock_movements_item_idx on public.stock_movements (inventory_item_id, created_at desc);
create index notifications_shop_created_idx on public.notifications (shop_id, created_at desc);
create index audit_logs_shop_created_idx on public.audit_logs (shop_id, created_at desc);

insert into public.profiles (id, full_name)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
on conflict (id) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_shop_relations()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'products' then
    if new.category_id is not null and not exists (
      select 1 from public.categories c
      where c.id = new.category_id and c.shop_id = new.shop_id
    ) then
      raise exception 'Category must belong to the same shop' using errcode = '23514';
    end if;
  elsif tg_table_name = 'orders' then
    if new.table_id is not null and not exists (
      select 1 from public.dining_tables t
      where t.id = new.table_id and t.shop_id = new.shop_id
    ) then
      raise exception 'Table must belong to the same shop' using errcode = '23514';
    end if;
  elsif tg_table_name = 'product_variants' then
    if not exists (
      select 1 from public.products p
      where p.id = new.product_id and p.shop_id = new.shop_id
    ) then
      raise exception 'Product must belong to the same shop' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger products_validate_shop before insert or update of shop_id, category_id
on public.products for each row execute function public.validate_shop_relations();
create trigger orders_validate_shop before insert or update of shop_id, table_id
on public.orders for each row execute function public.validate_shop_relations();
create trigger variants_validate_shop before insert or update of shop_id, product_id
on public.product_variants for each row execute function public.validate_shop_relations();

create or replace function public.has_shop_role(target_shop_id uuid, allowed_roles public.shop_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.shop_members m
    where m.shop_id = target_shop_id
      and m.profile_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;

create or replace function public.is_active_shop(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.shops s
    where s.id = target_shop_id and s.is_active
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update
    set full_name = excluded.full_name;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger shops_updated_at before update on public.shops
for each row execute function public.set_updated_at();
create trigger shop_settings_updated_at before update on public.shop_settings
for each row execute function public.set_updated_at();
create trigger dining_tables_updated_at before update on public.dining_tables
for each row execute function public.set_updated_at();
create trigger categories_updated_at before update on public.categories
for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders
for each row execute function public.set_updated_at();
create trigger bills_updated_at before update on public.bills
for each row execute function public.set_updated_at();
create trigger inventory_items_updated_at before update on public.inventory_items
for each row execute function public.set_updated_at();

create or replace function public.create_shop(
  shop_name text,
  shop_phone text default null,
  shop_email text default null,
  shop_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  new_shop_id uuid;
  shop_slug text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if shop_name is null or char_length(btrim(shop_name)) not between 2 and 80 then
    raise exception 'Shop name must be between 2 and 80 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = actor_id) then
    raise exception 'Profile not found' using errcode = '23503';
  end if;

  shop_slug := trim(both '-' from regexp_replace(lower(btrim(shop_name)), '[^a-z0-9]+', '-', 'g'));
  if shop_slug = '' then
    shop_slug := 'shop';
  end if;
  shop_slug := left(shop_slug, 60) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.shops (name, slug, phone, email, address, created_by)
  values (btrim(shop_name), shop_slug, nullif(btrim(shop_phone), ''), nullif(btrim(shop_email), ''), nullif(btrim(shop_address), ''), actor_id)
  returning id into new_shop_id;

  insert into public.shop_members (shop_id, profile_id, role)
  values (new_shop_id, actor_id, 'owner');
  insert into public.shop_settings (shop_id) values (new_shop_id);
  insert into public.invoice_sequences (shop_id) values (new_shop_id);

  return new_shop_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.shop_settings enable row level security;
alter table public.dining_tables enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.customization_groups enable row level security;
alter table public.customization_options enable row level security;
alter table public.product_customization_groups enable row level security;
alter table public.addons enable row level security;
alter table public.product_addons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_customizations enable row level security;
alter table public.order_item_addons enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_items enable row level security;
alter table public.product_ingredients enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.stock_movements enable row level security;
alter table public.notifications enable row level security;
alter table public.invoice_sequences enable row level security;
alter table public.audit_logs enable row level security;

create policy "Profiles are visible to their account" on public.profiles
for select to authenticated using (id = auth.uid());
create policy "Users update their own profile" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "Members can view their shops" on public.shops
for select to authenticated using (public.has_shop_role(id, array['owner','manager','cashier','kitchen']::public.shop_role[]));
create policy "Owners and managers update shops" on public.shops
for update to authenticated using (public.has_shop_role(id, array['owner','manager']::public.shop_role[]))
with check (public.has_shop_role(id, array['owner','manager']::public.shop_role[]));

create policy "Shop members can view their team" on public.shop_members
for select to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[]));
create policy "Owners remove other team members" on public.shop_members
for delete to authenticated using (
  profile_id <> auth.uid()
  and public.has_shop_role(shop_id, array['owner']::public.shop_role[])
);

create policy "Members view shop settings" on public.shop_settings
for select to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[]));
create policy "Owners and managers update shop settings" on public.shop_settings
for update to authenticated using (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]));

create policy "Staff manage tables" on public.dining_tables
for all to authenticated
using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff manage categories" on public.categories
for all to authenticated
using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Public can view active menu categories" on public.categories
for select to anon, authenticated using (is_active and public.is_active_shop(shop_id));
create policy "Staff manage products" on public.products
for all to authenticated
using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Public can view available products" on public.products
for select to anon, authenticated using (is_available and public.is_active_shop(shop_id));
create policy "Staff manage product variants" on public.product_variants
for all to authenticated
using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Public can view available variants" on public.product_variants
for select to anon, authenticated using (is_available and public.is_active_shop(shop_id));

create policy "Staff manage customization groups" on public.customization_groups
for all to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff manage customization options" on public.customization_options
for all to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff manage product customization groups" on public.product_customization_groups
for all to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff manage add-ons" on public.addons
for all to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff manage product add-ons" on public.product_addons
for all to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));

create policy "Staff view orders" on public.orders
for select to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[]));
create policy "Staff create orders" on public.orders
for insert to authenticated with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff update orders" on public.orders
for update to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[]));
create policy "Staff view order items" on public.order_items
for select to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[]));
create policy "Staff create order items" on public.order_items
for insert to authenticated with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff update order items" on public.order_items
for update to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff view order customizations" on public.order_item_customizations
for select to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[]));
create policy "Staff create order customizations" on public.order_item_customizations
for insert to authenticated with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff view order add-ons" on public.order_item_addons
for select to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[]));
create policy "Staff create order add-ons" on public.order_item_addons
for insert to authenticated with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));

create policy "Staff view bills" on public.bills
for select to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff create bills" on public.bills
for insert to authenticated with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff update bills" on public.bills
for update to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff view bill items" on public.bill_items
for all to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));
create policy "Staff view payments" on public.payments
for select to authenticated using (public.has_shop_role(shop_id, array['owner','manager','cashier']::public.shop_role[]));

create policy "Staff manage inventory" on public.inventory_items
for all to authenticated using (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]));
create policy "Staff manage product ingredients" on public.product_ingredients
for all to authenticated using (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]));
create policy "Staff manage suppliers" on public.suppliers
for all to authenticated using (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]));
create policy "Staff manage purchases" on public.purchases
for all to authenticated using (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]))
with check (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]));
create policy "Staff view stock movements" on public.stock_movements
for select to authenticated using (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]));
create policy "Managers record stock movements" on public.stock_movements
for insert to authenticated with check (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]));

create policy "Members view notifications" on public.notifications
for select to authenticated using (
  (recipient_id = auth.uid() or recipient_id is null)
  and public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[])
);
create policy "Members update their notifications" on public.notifications
for update to authenticated using (
  (recipient_id = auth.uid() or recipient_id is null)
  and public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[])
) with check (
  (recipient_id = auth.uid() or recipient_id is null)
  and public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[])
);
create policy "Owners view invoice sequence" on public.invoice_sequences
for select to authenticated using (public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]));
create policy "Owners view audit logs" on public.audit_logs
for select to authenticated using (shop_id is not null and public.has_shop_role(shop_id, array['owner','manager']::public.shop_role[]));

revoke all on function public.create_shop(text, text, text, text) from public, anon;
grant execute on function public.create_shop(text, text, text, text) to authenticated;
revoke all on function public.has_shop_role(uuid, public.shop_role[]) from public, anon;
grant execute on function public.has_shop_role(uuid, public.shop_role[]) to authenticated;
revoke all on function public.is_active_shop(uuid) from public;
grant execute on function public.is_active_shop(uuid) to anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
grant select on public.shops to authenticated;
grant update (name, logo_url, cover_url, address, phone, email, gstin, currency) on public.shops to authenticated;
grant select, delete on public.shop_members to authenticated;
grant select, update on public.shop_settings to authenticated;
grant select, insert, update, delete on public.dining_tables, public.categories, public.products,
  public.product_variants, public.customization_groups, public.customization_options,
  public.product_customization_groups, public.addons, public.product_addons to authenticated;
grant select, insert, update on public.orders, public.order_items, public.order_item_customizations,
  public.order_item_addons to authenticated;
grant select, insert, update on public.bills, public.bill_items to authenticated;
grant select on public.payments to authenticated;
grant select, insert, update, delete on public.inventory_items, public.product_ingredients,
  public.suppliers, public.purchases, public.stock_movements to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.invoice_sequences, public.audit_logs to authenticated;
grant select on public.categories, public.products, public.product_variants to anon;
grant select on public.categories, public.products, public.product_variants to authenticated;
