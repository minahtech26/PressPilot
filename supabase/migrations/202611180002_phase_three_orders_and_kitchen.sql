create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  reason text,
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index order_status_history_order_idx on public.order_status_history (order_id, created_at);
alter table public.order_status_history enable row level security;

create policy "Staff view order status history" on public.order_status_history
for select to authenticated using (
  public.has_shop_role(shop_id, array['owner','manager','cashier','kitchen']::public.shop_role[])
);
grant select on public.order_status_history to authenticated;

revoke insert, update on public.orders from authenticated;
revoke insert, update on public.order_items, public.order_item_customizations, public.order_item_addons from authenticated;

create or replace function public.record_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  notification_title text;
  notification_body text;
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (shop_id, order_id, from_status, to_status, changed_by)
    values (new.shop_id, new.id, null, new.status, auth.uid());
    notification_title := 'New order #' || new.order_number;
    notification_body := coalesce(nullif(btrim(new.customer_name), ''), 'A customer')
      || case when new.table_id is null then ' placed an order.' else ' placed a table order.' end;
    insert into public.notifications (shop_id, type, title, body, entity_id)
    values (new.shop_id, 'new_order', notification_title, notification_body, new.id);
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.order_status_history (shop_id, order_id, from_status, to_status, reason, changed_by)
    values (new.shop_id, new.id, old.status, new.status, new.cancellation_reason, auth.uid());

    notification_title := 'Order #' || new.order_number || ' ' || replace(new.status::text, '_', ' ');
    notification_body := case
      when new.status = 'cancelled' then coalesce(new.cancellation_reason, 'The order was cancelled.')
      else 'The order status has been updated.'
    end;
    insert into public.notifications (shop_id, type, title, body, entity_id)
    values (new.shop_id, 'order_status', notification_title, notification_body, new.id);
  end if;
  return new;
end;
$$;

create trigger orders_record_status_change
after insert or update of status on public.orders
for each row execute function public.record_order_status_change();

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
        select 1 from public.orders o
        where o.table_id = t.id and o.shop_id = target_shop_id
          and o.status in ('served','completed') and o.payment_status <> 'paid'
      ) then 'bill_pending'::public.table_status
      when exists (
        select 1 from public.orders o
        where o.table_id = t.id and o.shop_id = target_shop_id
          and o.payment_status <> 'paid'
      ) then 'occupied'::public.table_status
      else 'payment_completed'::public.table_status
    end
    where t.id = current_order.table_id and t.shop_id = target_shop_id;
  end if;

  return current_order;
end;
$$;

revoke all on function public.update_order_status(uuid, uuid, public.order_status, text) from public, anon;
grant execute on function public.update_order_status(uuid, uuid, public.order_status, text) to authenticated;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['orders','notifications','dining_tables']
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
