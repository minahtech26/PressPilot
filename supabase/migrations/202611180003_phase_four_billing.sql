create or replace function public.refresh_billing_table_status(
  target_shop_id uuid,
  target_table_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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
  where t.id = target_table_id and t.shop_id = target_shop_id;
end;
$$;

revoke all on function public.refresh_billing_table_status(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_bill_for_orders(
  target_shop_id uuid,
  target_order_ids uuid[],
  bill_discount numeric default 0
)
returns public.bills
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bill_row public.bills%rowtype;
  valid_order_count integer;
  table_count integer;
  table_order_count integer;
  next_invoice_number bigint;
  invoice_number_prefix text;
  service_rate numeric(7,4);
  bill_subtotal numeric(12,2);
  bill_tax numeric(12,2);
  bill_service_charge numeric(12,2);
  bill_total numeric(12,2);
begin
  if not public.has_shop_role(
    target_shop_id,
    array['owner','manager','cashier']::public.shop_role[]
  ) then
    raise exception 'You do not have permission to create bills in this shop' using errcode = '42501';
  end if;

  if target_order_ids is null or cardinality(target_order_ids) = 0
     or cardinality(target_order_ids) > 50
     or cardinality(target_order_ids) <> (
       select count(distinct requested.order_id)
       from unnest(target_order_ids) as requested(order_id)
     )
     or bill_discount is null or bill_discount < 0 then
    raise exception 'Select valid orders and a non-negative discount' using errcode = '22023';
  end if;

  perform 1
  from public.orders o
  where o.shop_id = target_shop_id and o.id = any(target_order_ids)
  order by o.id
  for update;

  select count(*), count(distinct o.table_id), count(o.table_id)
  into valid_order_count, table_count, table_order_count
  from public.orders o
  where o.shop_id = target_shop_id
    and o.id = any(target_order_ids)
    and o.status in ('served','completed')
    and o.payment_status in ('unpaid','partial');

  if valid_order_count <> cardinality(target_order_ids) then
    raise exception 'Every order must belong to this shop, be served, and remain unpaid' using errcode = '22023';
  end if;
  if table_count > 1
     or (table_order_count > 0 and table_order_count < valid_order_count)
     or (table_count = 0 and valid_order_count > 1) then
    raise exception 'A bill can include orders from only one table or one pickup order' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.bill_items bi
    join public.order_items oi on oi.id = bi.order_item_id
    join public.bills b on b.id = bi.bill_id
    where oi.order_id = any(target_order_ids)
      and oi.shop_id = target_shop_id
      and b.shop_id = target_shop_id
      and b.status <> 'void'
  ) then
    raise exception 'One or more orders already have a bill' using errcode = '23505';
  end if;

  select coalesce(sum(oi.unit_price * oi.quantity - oi.discount), 0),
         coalesce(sum(oi.tax), 0)
  into bill_subtotal, bill_tax
  from public.order_items oi
  where oi.shop_id = target_shop_id and oi.order_id = any(target_order_ids);

  if not exists (
    select 1 from public.order_items oi
    where oi.shop_id = target_shop_id and oi.order_id = any(target_order_ids)
  ) then
    raise exception 'Cannot create a bill without order items' using errcode = '22023';
  end if;
  if bill_discount > bill_subtotal then
    raise exception 'Discount cannot exceed the bill subtotal' using errcode = '22023';
  end if;

  select s.service_charge_rate, s.invoice_prefix
  into service_rate, invoice_number_prefix
  from public.shop_settings s
  where s.shop_id = target_shop_id;
  service_rate := coalesce(service_rate, 0);
  invoice_number_prefix := coalesce(nullif(btrim(invoice_number_prefix), ''), 'INV');

  update public.invoice_sequences
  set next_value = next_value + 1,
      updated_at = now()
  where shop_id = target_shop_id
  returning next_value - 1 into next_invoice_number;
  if next_invoice_number is null then
    raise exception 'Invoice sequence is not configured for this shop' using errcode = 'P0002';
  end if;

  bill_service_charge := round(bill_subtotal * service_rate / 100, 2);
  bill_total := bill_subtotal + bill_tax + bill_service_charge - bill_discount;

  insert into public.bills (
    shop_id, table_id, invoice_number, status, subtotal, discount, tax,
    service_charge, total, paid_amount, created_by, settled_at
  ) values (
    target_shop_id,
    (select o.table_id from public.orders o where o.shop_id = target_shop_id and o.id = any(target_order_ids) limit 1),
    invoice_number_prefix || '-' || lpad(next_invoice_number::text, 6, '0'),
    case when bill_total = 0 then 'settled' else 'open' end,
    bill_subtotal, bill_discount, bill_tax, bill_service_charge, bill_total, 0,
    auth.uid(), case when bill_total = 0 then now() else null end
  )
  returning * into bill_row;

  insert into public.bill_items (
    shop_id, bill_id, order_item_id, product_name, quantity, unit_price,
    discount, tax, line_total
  )
  select oi.shop_id, bill_row.id, oi.id, oi.product_name, oi.quantity,
    oi.unit_price, oi.discount, oi.tax, oi.line_total
  from public.order_items oi
  where oi.shop_id = target_shop_id and oi.order_id = any(target_order_ids);

  if bill_row.status = 'settled' then
    update public.orders o
    set payment_status = 'paid',
        status = case when o.status = 'served' then 'completed'::public.order_status else o.status end,
        updated_at = now()
    where o.shop_id = target_shop_id and o.id = any(target_order_ids);
  end if;

  if bill_row.table_id is not null then
    perform public.refresh_billing_table_status(target_shop_id, bill_row.table_id);
  end if;

  return bill_row;
end;
$$;

create or replace function public.record_bill_payment(
  target_shop_id uuid,
  target_bill_id uuid,
  payment_method text,
  payment_amount numeric,
  payment_reference text default null
)
returns public.bills
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bill_row public.bills%rowtype;
  paid_so_far numeric(12,2);
  new_paid_amount numeric(12,2);
begin
  if not public.has_shop_role(
    target_shop_id,
    array['owner','manager','cashier']::public.shop_role[]
  ) then
    raise exception 'You do not have permission to record payments in this shop' using errcode = '42501';
  end if;
  if payment_method is null or payment_method not in ('cash','upi','card','other')
     or payment_amount is null or payment_amount <= 0
     or payment_amount <> round(payment_amount, 2)
     or char_length(coalesce(payment_reference, '')) > 120 then
    raise exception 'Enter a valid payment amount, method, and reference' using errcode = '22023';
  end if;

  select * into bill_row
  from public.bills b
  where b.id = target_bill_id and b.shop_id = target_shop_id
  for update;
  if bill_row.id is null then
    raise exception 'Bill not found in this shop' using errcode = 'P0002';
  end if;
  if bill_row.status <> 'open' then
    raise exception 'Only open bills can receive payments' using errcode = '22023';
  end if;

  select coalesce(sum(p.amount), 0)
  into paid_so_far
  from public.payments p
  where p.bill_id = bill_row.id and p.shop_id = target_shop_id;
  if payment_amount > bill_row.total - paid_so_far then
    raise exception 'Payment exceeds the outstanding bill amount' using errcode = '22023';
  end if;

  insert into public.payments (
    shop_id, bill_id, method, amount, reference, received_by
  ) values (
    target_shop_id, bill_row.id, payment_method, payment_amount,
    nullif(btrim(payment_reference), ''), auth.uid()
  );

  new_paid_amount := paid_so_far + payment_amount;
  update public.bills
  set paid_amount = new_paid_amount,
      status = case when new_paid_amount = total then 'settled' else 'open' end,
      settled_at = case when new_paid_amount = total then now() else null end,
      updated_at = now()
  where id = bill_row.id and shop_id = target_shop_id
  returning * into bill_row;

  update public.orders o
  set payment_status = case when bill_row.status = 'settled' then 'paid'::public.payment_status else 'partial'::public.payment_status end,
      status = case when bill_row.status = 'settled' and o.status = 'served' then 'completed'::public.order_status else o.status end,
      updated_at = now()
  where o.shop_id = target_shop_id
    and o.id in (
      select distinct oi.order_id
      from public.bill_items bi
      join public.order_items oi on oi.id = bi.order_item_id
      where bi.bill_id = bill_row.id and bi.shop_id = target_shop_id
    );

  if bill_row.table_id is not null then
    perform public.refresh_billing_table_status(target_shop_id, bill_row.table_id);
  end if;
  return bill_row;
end;
$$;

create or replace function public.notify_bill_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_invoice text;
begin
  select invoice_number into current_invoice
  from public.bills
  where id = new.bill_id and shop_id = new.shop_id;

  insert into public.notifications (shop_id, type, title, body, entity_id)
  values (
    new.shop_id,
    'payment_received',
    'Payment received' || case when current_invoice is null then '' else ' · ' || current_invoice end,
    new.method || ' payment of ' || new.amount::text || ' recorded.',
    new.bill_id
  );
  return new;
end;
$$;

create trigger payments_notify_staff
after insert on public.payments
for each row execute function public.notify_bill_payment();

revoke insert, update on public.bills from authenticated;
revoke insert, update on public.bill_items from authenticated;
revoke insert, update, delete on public.payments from authenticated;
revoke all on function public.create_bill_for_orders(uuid, uuid[], numeric) from public, anon;
revoke all on function public.record_bill_payment(uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.create_bill_for_orders(uuid, uuid[], numeric) to authenticated;
grant execute on function public.record_bill_payment(uuid, uuid, text, numeric, text) to authenticated;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['bills','bill_items','payments']
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
