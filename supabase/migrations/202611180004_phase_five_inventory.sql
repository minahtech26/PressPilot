create or replace function public.create_inventory_item(
  target_shop_id uuid,
  item_name text,
  item_unit text,
  low_stock_limit numeric default 0
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item_row public.inventory_items%rowtype;
begin
  if not public.has_shop_role(target_shop_id, array['owner','manager']::public.shop_role[]) then
    raise exception 'Only shop owners and managers can manage inventory' using errcode = '42501';
  end if;
  if item_name is null or char_length(btrim(item_name)) not between 2 and 80
     or item_unit is null or char_length(btrim(item_unit)) not between 1 and 24
     or low_stock_limit is null or low_stock_limit < 0 then
    raise exception 'Enter a valid inventory name, unit, and low-stock threshold' using errcode = '22023';
  end if;

  insert into public.inventory_items (shop_id, name, unit, quantity, low_stock_threshold)
  values (target_shop_id, btrim(item_name), btrim(item_unit), 0, low_stock_limit)
  returning * into item_row;
  return item_row;
end;
$$;

create or replace function public.save_product_recipe(
  target_shop_id uuid,
  target_product_id uuid,
  recipe_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_count integer;
  valid_inventory_count integer;
begin
  if not public.has_shop_role(target_shop_id, array['owner','manager']::public.shop_role[]) then
    raise exception 'Only shop owners and managers can manage recipes' using errcode = '42501';
  end if;
  if recipe_items is null or jsonb_typeof(recipe_items) <> 'array'
     or jsonb_array_length(recipe_items) > 100 then
    raise exception 'Provide a valid recipe with at most 100 ingredients' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = target_product_id and p.shop_id = target_shop_id
  ) then
    raise exception 'Product not found in this shop' using errcode = 'P0002';
  end if;

  select count(*) into requested_count
  from jsonb_array_elements(recipe_items) entry(value);
  if exists (
    select 1
    from jsonb_array_elements(recipe_items) entry(value)
    where nullif(entry.value ->> 'inventory_item_id', '') is null
       or (entry.value ->> 'quantity') is null
       or (entry.value ->> 'quantity')::numeric <= 0
  ) then
    raise exception 'Each recipe ingredient needs an inventory item and positive quantity' using errcode = '22023';
  end if;
  if requested_count <> (
    select count(distinct (entry.value ->> 'inventory_item_id')::uuid)
    from jsonb_array_elements(recipe_items) entry(value)
  ) then
    raise exception 'An inventory item can only appear once in a recipe' using errcode = '22023';
  end if;
  select count(*) into valid_inventory_count
  from public.inventory_items i
  where i.shop_id = target_shop_id
    and i.id in (
      select (entry.value ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(recipe_items) entry(value)
    );
  if valid_inventory_count <> requested_count then
    raise exception 'A recipe ingredient does not belong to this shop' using errcode = '23514';
  end if;

  delete from public.product_ingredients
  where shop_id = target_shop_id and product_id = target_product_id;
  insert into public.product_ingredients (shop_id, product_id, inventory_item_id, quantity)
  select target_shop_id, target_product_id,
    (entry.value ->> 'inventory_item_id')::uuid,
    (entry.value ->> 'quantity')::numeric
  from jsonb_array_elements(recipe_items) entry(value);
end;
$$;

create or replace function public.receive_inventory_purchase(
  target_shop_id uuid,
  target_inventory_item_id uuid,
  target_supplier_id uuid,
  purchased_quantity numeric,
  purchase_unit_cost numeric default 0,
  purchase_notes text default null
)
returns public.purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item_row public.inventory_items%rowtype;
  purchase_row public.purchases%rowtype;
begin
  if not public.has_shop_role(target_shop_id, array['owner','manager']::public.shop_role[]) then
    raise exception 'Only shop owners and managers can receive purchases' using errcode = '42501';
  end if;
  if purchased_quantity is null or purchased_quantity <= 0
     or purchased_quantity <> round(purchased_quantity, 3)
     or purchase_unit_cost is null or purchase_unit_cost < 0
     or purchase_unit_cost <> round(purchase_unit_cost, 2)
     or char_length(coalesce(purchase_notes, '')) > 500 then
    raise exception 'Enter a valid purchase quantity, unit cost, and note' using errcode = '22023';
  end if;
  if target_supplier_id is not null and not exists (
    select 1 from public.suppliers s
    where s.id = target_supplier_id and s.shop_id = target_shop_id
  ) then
    raise exception 'Supplier not found in this shop' using errcode = 'P0002';
  end if;

  select * into item_row
  from public.inventory_items i
  where i.id = target_inventory_item_id and i.shop_id = target_shop_id
  for update;
  if item_row.id is null then
    raise exception 'Inventory item not found in this shop' using errcode = 'P0002';
  end if;

  insert into public.purchases (
    shop_id, supplier_id, inventory_item_id, quantity, unit_cost, created_by, notes
  ) values (
    target_shop_id, target_supplier_id, item_row.id, purchased_quantity,
    purchase_unit_cost, auth.uid(), nullif(btrim(purchase_notes), '')
  )
  returning * into purchase_row;

  update public.inventory_items
  set quantity = quantity + purchased_quantity,
      updated_at = now()
  where id = item_row.id and shop_id = target_shop_id;
  insert into public.stock_movements (
    shop_id, inventory_item_id, quantity_delta, reason, reference_id, created_by
  ) values (
    target_shop_id, item_row.id, purchased_quantity, 'purchase', purchase_row.id, auth.uid()
  );
  return purchase_row;
end;
$$;

create or replace function public.adjust_inventory_stock(
  target_shop_id uuid,
  target_inventory_item_id uuid,
  quantity_change numeric,
  adjustment_reason text
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item_row public.inventory_items%rowtype;
  negative_stock_allowed boolean;
begin
  if not public.has_shop_role(target_shop_id, array['owner','manager']::public.shop_role[]) then
    raise exception 'Only shop owners and managers can adjust inventory' using errcode = '42501';
  end if;
  if quantity_change is null or quantity_change = 0
     or quantity_change <> round(quantity_change, 3)
     or adjustment_reason is null or char_length(btrim(adjustment_reason)) not between 3 and 200 then
    raise exception 'Enter a non-zero adjustment and a reason' using errcode = '22023';
  end if;

  select coalesce(s.allow_negative_stock, false)
  into negative_stock_allowed
  from public.shop_settings s
  where s.shop_id = target_shop_id;
  negative_stock_allowed := coalesce(negative_stock_allowed, false);

  select * into item_row
  from public.inventory_items i
  where i.id = target_inventory_item_id and i.shop_id = target_shop_id
  for update;
  if item_row.id is null then
    raise exception 'Inventory item not found in this shop' using errcode = 'P0002';
  end if;
  if not negative_stock_allowed and item_row.quantity + quantity_change < 0 then
    raise exception 'This adjustment would take stock below zero' using errcode = '22023';
  end if;

  update public.inventory_items
  set quantity = quantity + quantity_change,
      updated_at = now()
  where id = item_row.id and shop_id = target_shop_id
  returning * into item_row;

  insert into public.stock_movements (
    shop_id, inventory_item_id, quantity_delta, reason, created_by
  ) values (
    target_shop_id, item_row.id, quantity_change, btrim(adjustment_reason), auth.uid()
  );
  return item_row;
end;
$$;

create or replace function public.consume_inventory_for_order_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inventory_enabled boolean;
  negative_stock_allowed boolean;
  ingredient record;
  required_quantity numeric(14,3);
begin
  select coalesce(s.inventory_enabled, false), coalesce(s.allow_negative_stock, false)
  into inventory_enabled, negative_stock_allowed
  from public.shop_settings s
  where s.shop_id = new.shop_id;
  if not coalesce(inventory_enabled, false) or new.product_id is null then
    return new;
  end if;

  for ingredient in
    select pi.inventory_item_id, pi.quantity
    from public.product_ingredients pi
    where pi.shop_id = new.shop_id and pi.product_id = new.product_id
    order by pi.inventory_item_id
  loop
    required_quantity := ingredient.quantity * new.quantity;
    update public.inventory_items
    set quantity = quantity - required_quantity,
        updated_at = now()
    where id = ingredient.inventory_item_id and shop_id = new.shop_id
      and (negative_stock_allowed or quantity >= required_quantity);
    if not found then
      raise exception 'Not enough stock to place this order' using errcode = '23514';
    end if;
    insert into public.stock_movements (
      shop_id, inventory_item_id, quantity_delta, reason, reference_id
    ) values (
      new.shop_id, ingredient.inventory_item_id, -required_quantity, 'order_consumption', new.order_id
    );
  end loop;
  return new;
end;
$$;

create or replace function public.restock_cancelled_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  consumed record;
begin
  if old.status is distinct from new.status and new.status = 'cancelled' then
    for consumed in
      select sm.inventory_item_id, sum(-sm.quantity_delta) as quantity
      from public.stock_movements sm
      where sm.shop_id = new.shop_id
        and sm.reference_id = new.id
        and sm.reason = 'order_consumption'
      group by sm.inventory_item_id
      order by sm.inventory_item_id
    loop
      update public.inventory_items
      set quantity = quantity + consumed.quantity,
          updated_at = now()
      where id = consumed.inventory_item_id and shop_id = new.shop_id;
      insert into public.stock_movements (
        shop_id, inventory_item_id, quantity_delta, reason, reference_id
      ) values (
        new.shop_id, consumed.inventory_item_id, consumed.quantity,
        'order_cancellation_restock', new.id
      );
    end loop;
    if new.table_id is not null then
      perform public.refresh_billing_table_status(new.shop_id, new.table_id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.update_order_status(
  target_shop_id uuid,
  target_order_id uuid,
  next_status public.order_status,
  cancel_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders%rowtype;
  actor_is_kitchen boolean;
begin
  if not public.has_shop_role(
    target_shop_id,
    array['owner','manager','cashier','kitchen']::public.shop_role[]
  ) then
    raise exception 'You do not have permission to update orders in this shop' using errcode = '42501';
  end if;

  select * into current_order
  from public.orders
  where id = target_order_id and shop_id = target_shop_id
  for update;
  if current_order.id is null then
    raise exception 'Order not found in this shop' using errcode = 'P0002';
  end if;

  actor_is_kitchen := public.has_shop_role(target_shop_id, array['kitchen']::public.shop_role[]);
  if actor_is_kitchen and next_status not in ('accepted','preparing','ready') then
    raise exception 'Kitchen staff can only accept, prepare, and ready orders' using errcode = '42501';
  end if;

  if next_status = 'cancelled' then
    if current_order.status not in ('new','accepted','preparing','ready')
       or cancel_reason is null or char_length(btrim(cancel_reason)) not between 3 and 250 then
      raise exception 'Provide a cancellation reason between 3 and 250 characters' using errcode = '22023';
    end if;
  elsif not (
    (current_order.status = 'new' and next_status = 'accepted')
    or (current_order.status = 'accepted' and next_status = 'preparing')
    or (current_order.status = 'preparing' and next_status = 'ready')
    or (current_order.status = 'ready' and next_status = 'served')
    or (current_order.status = 'served' and next_status = 'completed')
  ) then
    raise exception 'That order status transition is not allowed' using errcode = '22023';
  end if;

  update public.orders
  set status = next_status,
      cancellation_reason = case when next_status = 'cancelled' then btrim(cancel_reason) else null end
  where id = current_order.id
  returning * into current_order;

  if current_order.table_id is not null then
    update public.dining_tables t
    set status = case
      when exists (
        select 1 from public.orders o
        where o.table_id = t.id and o.shop_id = target_shop_id
          and o.status = 'new' and o.payment_status <> 'paid'
      ) then 'order_pending'::public.table_status
      when exists (
        select 1 from public.orders o
        where o.table_id = t.id and o.shop_id = target_shop_id
          and o.status in ('accepted','preparing') and o.payment_status <> 'paid'
      ) then 'preparing'::public.table_status
      when exists (
        select 1 from public.bills b
        where b.table_id = t.id and b.shop_id = target_shop_id and b.status = 'open'
      ) or exists (
        select 1 from public.orders o
        where o.table_id = t.id and o.shop_id = target_shop_id
          and o.status in ('served','completed') and o.payment_status <> 'paid'
      ) then 'bill_pending'::public.table_status
      when exists (
        select 1 from public.orders o
        where o.table_id = t.id and o.shop_id = target_shop_id
          and o.payment_status <> 'paid' and o.status <> 'cancelled'
      ) then 'occupied'::public.table_status
      else 'available'::public.table_status
    end,
    updated_at = now()
    where t.id = current_order.table_id and t.shop_id = target_shop_id;
  end if;
  return current_order;
end;
$$;

create trigger order_items_consume_inventory
after insert on public.order_items
for each row execute function public.consume_inventory_for_order_item();

create trigger orders_restock_inventory_on_cancel
after update of status on public.orders
for each row execute function public.restock_cancelled_order();

create index if not exists stock_movements_shop_created_idx
  on public.stock_movements (shop_id, created_at desc);
create index if not exists purchases_shop_purchased_idx
  on public.purchases (shop_id, purchased_at desc);

revoke insert, update, delete on public.product_ingredients from authenticated;
revoke insert, update, delete on public.purchases from authenticated;
revoke insert, update, delete on public.stock_movements from authenticated;
revoke insert on public.inventory_items from authenticated;
revoke update on public.inventory_items from authenticated;
grant update (name, unit, low_stock_threshold) on public.inventory_items to authenticated;

revoke all on function public.create_inventory_item(uuid, text, text, numeric) from public, anon;
revoke all on function public.save_product_recipe(uuid, uuid, jsonb) from public, anon;
revoke all on function public.receive_inventory_purchase(uuid, uuid, uuid, numeric, numeric, text) from public, anon;
revoke all on function public.adjust_inventory_stock(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.create_inventory_item(uuid, text, text, numeric) to authenticated;
grant execute on function public.save_product_recipe(uuid, uuid, jsonb) to authenticated;
grant execute on function public.receive_inventory_purchase(uuid, uuid, uuid, numeric, numeric, text) to authenticated;
grant execute on function public.adjust_inventory_stock(uuid, uuid, numeric, text) to authenticated;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['inventory_items','product_ingredients','suppliers','purchases','stock_movements']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;
