create or replace function public.complete_order(
  target_shop_id uuid,
  target_order_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders%rowtype;
begin
  if not public.has_shop_role(
    target_shop_id,
    array['owner','manager','cashier']::public.shop_role[]
  ) then
    raise exception 'You do not have permission to complete orders in this shop' using errcode = '42501';
  end if;

  select * into current_order
  from public.orders
  where id = target_order_id and shop_id = target_shop_id
  for update;
  if current_order.id is null then
    raise exception 'Order not found in this shop' using errcode = 'P0002';
  end if;
  if current_order.status not in ('accepted','preparing','ready','served') then
    raise exception 'Only active orders can be completed' using errcode = '22023';
  end if;

  update public.orders
  set status = 'completed'
  where id = current_order.id and shop_id = target_shop_id
  returning * into current_order;

  if current_order.table_id is not null then
    perform public.refresh_billing_table_status(target_shop_id, current_order.table_id);
  end if;

  return current_order;
end;
$$;

revoke all on function public.complete_order(uuid, uuid) from public, anon;
grant execute on function public.complete_order(uuid, uuid) to authenticated;
