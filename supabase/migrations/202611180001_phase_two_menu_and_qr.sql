alter table public.products drop constraint if exists products_category_id_fkey;
alter table public.products
  add constraint products_category_id_fkey
  foreign key (category_id) references public.categories (id) on delete restrict;

drop policy if exists "Public can view active menu categories" on public.categories;
drop policy if exists "Public can view available products" on public.products;
drop policy if exists "Public can view available variants" on public.product_variants;
revoke select on public.categories, public.products, public.product_variants from anon;
revoke all on function public.is_active_shop(uuid) from anon;

drop function if exists public.save_menu_product(uuid, uuid, uuid, text, text, text, text, numeric, boolean, boolean, jsonb);

alter table public.customization_options
  add constraint customization_options_nonnegative_price_delta check (price_delta >= 0);

create or replace function public.validate_menu_customization_shop()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  related_shop_id uuid;
begin
  if tg_table_name = 'customization_options' then
    select shop_id into related_shop_id
    from public.customization_groups
    where id = new.group_id;
    if related_shop_id is distinct from new.shop_id then
      raise exception 'Customization group must belong to this shop' using errcode = '23514';
    end if;
  else
    select shop_id into related_shop_id
    from public.products
    where id = new.product_id;
    if related_shop_id is distinct from new.shop_id then
      raise exception 'Product must belong to this shop' using errcode = '23514';
    end if;
    select shop_id into related_shop_id
    from public.customization_groups
    where id = new.group_id;
    if related_shop_id is distinct from new.shop_id then
      raise exception 'Customization group must belong to this shop' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger customization_options_validate_shop
before insert or update of shop_id, group_id on public.customization_options
for each row execute function public.validate_menu_customization_shop();
create trigger product_customization_groups_validate_shop
before insert or update of shop_id, product_id, group_id on public.product_customization_groups
for each row execute function public.validate_menu_customization_shop();

create or replace function public.save_menu_product(
  target_shop_id uuid,
  target_product_id uuid,
  target_category_id uuid,
  product_name text,
  product_sku text,
  product_description text,
  product_image_url text,
  product_base_price numeric,
  product_available boolean,
  product_featured boolean,
  product_variants jsonb default '[]'::jsonb,
  product_customizations jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_product_id uuid;
  variant jsonb;
  variant_index bigint;
  customization jsonb;
  custom_option jsonb;
  old_group_ids uuid[];
  new_group_id uuid;
begin
  if not public.has_shop_role(target_shop_id, array['owner','manager','cashier']::public.shop_role[]) then
    raise exception 'You do not have permission to manage this shop menu' using errcode = '42501';
  end if;
  if product_name is null or char_length(btrim(product_name)) not between 1 and 120 then
    raise exception 'Product name must be between 1 and 120 characters' using errcode = '22023';
  end if;
  if product_base_price is null or product_base_price < 0 then
    raise exception 'Product price must be zero or more' using errcode = '22023';
  end if;
  if target_category_id is null then
    raise exception 'Choose a category for this product' using errcode = '22023';
  end if;
  if product_variants is null or jsonb_typeof(product_variants) <> 'array' or jsonb_array_length(product_variants) > 20 then
    raise exception 'Variants must be a list of at most 20 entries' using errcode = '22023';
  end if;
  for variant, variant_index in
    select value, ordinality
    from jsonb_array_elements(product_variants) with ordinality as entries(value, ordinality)
  loop
    if jsonb_typeof(variant) <> 'object'
       or char_length(btrim(coalesce(variant ->> 'name', ''))) not between 1 and 50
       or coalesce(variant ->> 'price', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'Each variant needs a name and a non-negative price' using errcode = '22023';
    end if;
  end loop;
  if product_customizations is null or jsonb_typeof(product_customizations) <> 'array' or jsonb_array_length(product_customizations) > 8 then
    raise exception 'Customization groups must be a list of at most 8 entries' using errcode = '22023';
  end if;
  for customization in select value from jsonb_array_elements(product_customizations)
  loop
    if jsonb_typeof(customization) <> 'object'
       or char_length(btrim(coalesce(customization ->> 'name', ''))) not between 1 and 50
       or jsonb_typeof(customization -> 'options') is distinct from 'array'
       or jsonb_array_length(customization -> 'options') < 1
       or jsonb_array_length(customization -> 'options') > 20 then
      raise exception 'Each customization group needs a name and 1 to 20 options' using errcode = '22023';
    end if;
    for custom_option in select value from jsonb_array_elements(customization -> 'options')
    loop
      if jsonb_typeof(custom_option) <> 'object'
         or char_length(btrim(coalesce(custom_option ->> 'name', ''))) not between 1 and 50
         or coalesce(custom_option ->> 'price_delta', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
        raise exception 'Each customization option needs a name and a non-negative price' using errcode = '22023';
      end if;
    end loop;
  end loop;
  if target_category_id is not null and not exists (
    select 1 from public.categories c where c.id = target_category_id and c.shop_id = target_shop_id
  ) then
    raise exception 'Category must belong to this shop' using errcode = '23514';
  end if;

  if target_product_id is not null then
    update public.products
    set category_id = target_category_id,
        name = btrim(product_name),
        sku = nullif(btrim(product_sku), ''),
        description = nullif(btrim(product_description), ''),
        image_url = nullif(btrim(product_image_url), ''),
        base_price = product_base_price,
        is_available = coalesce(product_available, true),
        is_featured = coalesce(product_featured, false)
    where id = target_product_id and shop_id = target_shop_id
    returning id into saved_product_id;
    if saved_product_id is null then
      raise exception 'Product not found in this shop' using errcode = 'P0002';
    end if;
  else
    insert into public.products (
      shop_id, category_id, name, sku, description, image_url, base_price, is_available, is_featured
    )
    values (
      target_shop_id, target_category_id, btrim(product_name), nullif(btrim(product_sku), ''),
      nullif(btrim(product_description), ''), nullif(btrim(product_image_url), ''),
      product_base_price, coalesce(product_available, true), coalesce(product_featured, false)
    )
    returning id into saved_product_id;
  end if;

  delete from public.product_variants where product_id = saved_product_id;
  for variant, variant_index in
    select value, ordinality
    from jsonb_array_elements(product_variants) with ordinality as entries(value, ordinality)
  loop
    insert into public.product_variants (shop_id, product_id, name, price, sort_order)
    values (
      target_shop_id, saved_product_id, btrim(variant ->> 'name'),
      (variant ->> 'price')::numeric, variant_index::integer
    );
  end loop;

  select coalesce(array_agg(group_id), array[]::uuid[])
  into old_group_ids
  from public.product_customization_groups
  where product_id = saved_product_id;
  delete from public.product_customization_groups where product_id = saved_product_id;
  delete from public.customization_groups cg
  where cg.id = any(old_group_ids)
    and not exists (
      select 1 from public.product_customization_groups mapping where mapping.group_id = cg.id
    );

  for customization in select value from jsonb_array_elements(product_customizations)
  loop
    insert into public.customization_groups (shop_id, name, selection_type, is_required, min_selections, max_selections)
    values (target_shop_id, btrim(customization ->> 'name'), 'single', true, 1, 1)
    returning id into new_group_id;

    insert into public.product_customization_groups (shop_id, product_id, group_id)
    values (target_shop_id, saved_product_id, new_group_id);

    for custom_option in select value from jsonb_array_elements(customization -> 'options')
    loop
      insert into public.customization_options (shop_id, group_id, name, price_delta)
      values (
        target_shop_id, new_group_id, btrim(custom_option ->> 'name'),
        (custom_option ->> 'price_delta')::numeric
      );
    end loop;
  end loop;

  return saved_product_id;
end;
$$;

create or replace function public.get_public_menu(menu_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  menu_data jsonb;
begin
  select jsonb_build_object(
    'shop', jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'slug', s.slug,
      'logo_url', s.logo_url,
      'cover_url', s.cover_url,
      'address', s.address,
      'phone', s.phone,
      'currency', s.currency
    ),
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'description', c.description,
          'products', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'name', p.name,
                'description', p.description,
                'image_url', p.image_url,
                'base_price', p.base_price,
                'tax_rate', p.tax_rate,
                'is_featured', p.is_featured,
                'is_vegetarian', p.is_vegetarian,
                'variants', coalesce((
                  select jsonb_agg(jsonb_build_object('id', pv.id, 'name', pv.name, 'price', pv.price) order by pv.sort_order, pv.name)
                  from public.product_variants pv
                  where pv.product_id = p.id and pv.is_available
                ), '[]'::jsonb),
                'customization_groups', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', cg.id,
                      'name', cg.name,
                      'is_required', cg.is_required,
                      'options', coalesce((
                        select jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name, 'price_delta', co.price_delta) order by co.sort_order, co.name)
                        from public.customization_options co
                        where co.group_id = cg.id and co.is_available
                      ), '[]'::jsonb)
                    ) order by pcg.sort_order, cg.name
                  )
                  from public.product_customization_groups pcg
                  join public.customization_groups cg on cg.id = pcg.group_id
                  where pcg.product_id = p.id and pcg.shop_id = s.id and cg.shop_id = s.id
                ), '[]'::jsonb)
              ) order by p.is_featured desc, p.name
            )
            from public.products p
            where p.category_id = c.id and p.shop_id = s.id and p.is_available
              and (p.available_from is null or localtime >= p.available_from)
              and (p.available_until is null or localtime <= p.available_until)
          ), '[]'::jsonb)
        ) order by c.sort_order, c.name
      )
      from public.categories c
      where c.shop_id = s.id and c.is_active
    ), '[]'::jsonb)
  )
  into menu_data
  from public.shops s
  where s.slug = lower(btrim(menu_slug)) and s.is_active;

  return menu_data;
end;
$$;

create or replace function public.place_public_order(
  menu_slug text,
  requested_table_id uuid,
  customer_name text,
  customer_phone text,
  order_notes text,
  order_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_shop public.shops%rowtype;
  target_table public.dining_tables%rowtype;
  item jsonb;
  item_product public.products%rowtype;
  item_variant public.product_variants%rowtype;
  requested_product_id uuid;
  requested_variant_id uuid;
  requested_quantity integer;
  unit_price numeric(12,2);
  item_subtotal numeric(12,2);
  item_tax numeric(12,2);
  selected_customizations jsonb;
  selected_option_id uuid;
  selected_option record;
  selected_group_count integer;
  selected_customization_delta numeric(12,2);
  new_order_item_id uuid;
  running_subtotal numeric(12,2) := 0;
  running_tax numeric(12,2) := 0;
  new_order public.orders%rowtype;
begin
  if order_items is null or jsonb_typeof(order_items) <> 'array'
     or jsonb_array_length(order_items) < 1 or jsonb_array_length(order_items) > 50 then
    raise exception 'Your cart must contain between 1 and 50 items' using errcode = '22023';
  end if;
  if customer_name is not null and char_length(btrim(customer_name)) > 100 then
    raise exception 'Customer name is too long' using errcode = '22023';
  end if;
  if customer_phone is not null and char_length(btrim(customer_phone)) > 30 then
    raise exception 'Phone number is too long' using errcode = '22023';
  end if;
  if order_notes is not null and char_length(btrim(order_notes)) > 500 then
    raise exception 'Order notes are too long' using errcode = '22023';
  end if;

  select * into target_shop from public.shops
  where slug = lower(btrim(menu_slug)) and is_active;
  if target_shop.id is null then
    raise exception 'This menu is not available' using errcode = 'P0002';
  end if;

  if requested_table_id is not null then
    select * into target_table
    from public.dining_tables
    where id = requested_table_id and shop_id = target_shop.id and is_active;
    if target_table.id is null then
      raise exception 'This table does not belong to the selected shop' using errcode = '23514';
    end if;
  end if;

  insert into public.orders (
    shop_id, table_id, customer_name, customer_phone, notes, status, payment_status
  )
  values (
    target_shop.id, requested_table_id, nullif(btrim(customer_name), ''),
    nullif(btrim(customer_phone), ''), nullif(btrim(order_notes), ''), 'new', 'unpaid'
  )
  returning * into new_order;

  for item in select value from jsonb_array_elements(order_items)
  loop
    requested_product_id := (item ->> 'product_id')::uuid;
    requested_variant_id := nullif(item ->> 'variant_id', '')::uuid;
    requested_quantity := (item ->> 'quantity')::integer;
    if requested_quantity is null or requested_quantity < 1 or requested_quantity > 99 then
      raise exception 'Item quantities must be between 1 and 99' using errcode = '22023';
    end if;

    select * into item_product from public.products
    where id = requested_product_id and shop_id = target_shop.id and is_available
      and (available_from is null or localtime >= available_from)
      and (available_until is null or localtime <= available_until);
    if item_product.id is null then
      raise exception 'A menu item is no longer available' using errcode = 'P0002';
    end if;

    unit_price := item_product.base_price;
    item_variant := null;
    if requested_variant_id is not null then
      select * into item_variant from public.product_variants
      where id = requested_variant_id and product_id = item_product.id
        and shop_id = target_shop.id and is_available;
      if item_variant.id is null then
        raise exception 'A selected size is no longer available' using errcode = 'P0002';
      end if;
      unit_price := item_variant.price;
    end if;

    selected_customizations := coalesce(item -> 'customizations', '[]'::jsonb);
    if jsonb_typeof(selected_customizations) <> 'array' or jsonb_array_length(selected_customizations) > 8 then
      raise exception 'Invalid product customizations' using errcode = '22023';
    end if;
    if exists (
      select 1
      from public.product_customization_groups pcg
      join public.customization_groups cg on cg.id = pcg.group_id
      where pcg.product_id = item_product.id and pcg.shop_id = target_shop.id
        and cg.shop_id = target_shop.id and cg.is_required
        and not exists (
          select 1
          from jsonb_array_elements(selected_customizations) selected(value)
          join public.customization_options co
            on co.id = nullif(selected.value ->> 'option_id', '')::uuid
           and co.group_id = cg.id and co.is_available
        )
    ) then
      raise exception 'Choose an option for each required customization' using errcode = '22023';
    end if;

    selected_customization_delta := 0;
    for selected_option_id in
      select nullif(value ->> 'option_id', '')::uuid
      from jsonb_array_elements(selected_customizations)
    loop
      select cg.name as group_name, co.id, co.group_id, co.name as option_name, co.price_delta
      into selected_option
      from public.customization_options co
      join public.customization_groups cg on cg.id = co.group_id
      join public.product_customization_groups pcg on pcg.group_id = cg.id
      where co.id = selected_option_id and co.shop_id = target_shop.id
        and co.is_available and pcg.product_id = item_product.id
        and pcg.shop_id = target_shop.id and cg.shop_id = target_shop.id;
      if not found then
        raise exception 'A selected customization is not available for this item' using errcode = '23514';
      end if;
      select count(*) into selected_group_count
        from jsonb_array_elements(selected_customizations) selected(value)
        join public.customization_options co on co.id = nullif(selected.value ->> 'option_id', '')::uuid
        where co.group_id = selected_option.group_id;
      if selected_group_count > 1 then
        raise exception 'Choose only one option per customization group' using errcode = '22023';
      end if;
      selected_customization_delta := selected_customization_delta + selected_option.price_delta;
    end loop;
    unit_price := unit_price + selected_customization_delta;
    item_subtotal := unit_price * requested_quantity;
    item_tax := round(item_subtotal * item_product.tax_rate / 100, 2);
    running_subtotal := running_subtotal + item_subtotal;
    running_tax := running_tax + item_tax;

    insert into public.order_items (
      shop_id, order_id, product_id, product_name, variant_name, quantity,
      unit_price, tax, line_total, instructions
    )
    values (
      target_shop.id, new_order.id, item_product.id, item_product.name,
      item_variant.name, requested_quantity, unit_price, item_tax,
      item_subtotal + item_tax, left(nullif(btrim(item ->> 'instructions'), ''), 240)
    )
    returning id into new_order_item_id;

    for selected_option_id in
      select nullif(value ->> 'option_id', '')::uuid
      from jsonb_array_elements(selected_customizations)
    loop
      select cg.name as group_name, co.name as option_name, co.price_delta
      into selected_option
      from public.customization_options co
      join public.customization_groups cg on cg.id = co.group_id
      join public.product_customization_groups pcg on pcg.group_id = cg.id
      where co.id = selected_option_id and co.shop_id = target_shop.id
        and co.is_available and pcg.product_id = item_product.id
        and pcg.shop_id = target_shop.id and cg.shop_id = target_shop.id;

      insert into public.order_item_customizations (
        shop_id, order_item_id, option_id, group_name, option_name, price_delta
      )
      values (
        target_shop.id, new_order_item_id, selected_option_id,
        selected_option.group_name, selected_option.option_name, selected_option.price_delta
      );
    end loop;
  end loop;

  update public.orders
  set subtotal = running_subtotal, tax = running_tax, total = running_subtotal + running_tax
  where id = new_order.id
  returning * into new_order;

  if requested_table_id is not null then
    update public.dining_tables
    set status = 'order_pending'
    where id = requested_table_id;
  end if;

  return jsonb_build_object(
    'id', new_order.id,
    'order_number', new_order.order_number,
    'total', new_order.total,
    'created_at', new_order.created_at
  );
end;
$$;

revoke all on function public.save_menu_product(uuid, uuid, uuid, text, text, text, text, numeric, boolean, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.save_menu_product(uuid, uuid, uuid, text, text, text, text, numeric, boolean, boolean, jsonb, jsonb) to authenticated;
revoke all on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;
revoke all on function public.place_public_order(text, uuid, text, text, text, jsonb) from public;
grant execute on function public.place_public_order(text, uuid, text, text, text, jsonb) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create policy "Menu images are publicly readable"
on storage.objects for select to anon, authenticated
using (bucket_id = 'menu-images');

create policy "Shop members upload menu images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'menu-images'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.has_shop_role((storage.foldername(name))[1]::uuid, array['owner','manager','cashier']::public.shop_role[])
);

create policy "Shop members update menu images"
on storage.objects for update to authenticated
using (
  bucket_id = 'menu-images'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.has_shop_role((storage.foldername(name))[1]::uuid, array['owner','manager','cashier']::public.shop_role[])
)
with check (
  bucket_id = 'menu-images'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.has_shop_role((storage.foldername(name))[1]::uuid, array['owner','manager','cashier']::public.shop_role[])
);

create policy "Shop members delete menu images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'menu-images'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.has_shop_role((storage.foldername(name))[1]::uuid, array['owner','manager','cashier']::public.shop_role[])
);
