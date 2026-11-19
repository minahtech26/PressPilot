create or replace function public.super_admin_create_shop(
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
begin
  if not public.is_super_admin() then
    raise exception 'Super administrator access required' using errcode = '42501';
  end if;

  return public.create_shop(shop_name, shop_phone, shop_email, shop_address);
end;
$$;

create or replace function public.super_admin_set_shop_active(
  target_shop_id uuid,
  active boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super administrator access required' using errcode = '42501';
  end if;
  if target_shop_id is null or active is null then
    raise exception 'A shop and status are required' using errcode = '22023';
  end if;

  update public.shops
  set is_active = active
  where id = target_shop_id;

  if not found then
    raise exception 'Shop not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.get_super_admin_analytics()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  daily_orders jsonb;
  analytics_summary jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Super administrator access required' using errcode = '42501';
  end if;

  with days as (
    select generate_series(current_date - 6, current_date, interval '1 day')::date as day
  ),
  order_counts as (
    select o.created_at::date as day, count(*) as order_count
    from public.orders o
    where o.created_at >= current_date - 6
      and o.created_at < current_date + 1
      and o.status <> 'cancelled'
    group by o.created_at::date
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('day', days.day, 'orders', coalesce(order_counts.order_count, 0))
      order by days.day
    ),
    '[]'::jsonb
  )
  into daily_orders
  from days
  left join order_counts on order_counts.day = days.day;

  select jsonb_build_object(
    'orders_7d', count(*) filter (
      where o.created_at >= current_date - 6 and o.created_at < current_date + 1
        and o.status <> 'cancelled'
    ),
    'shops_with_orders_7d', count(distinct o.shop_id) filter (
      where o.created_at >= current_date - 6 and o.created_at < current_date + 1
        and o.status <> 'cancelled'
    ),
    'new_shops_7d', (
      select count(*) from public.shops s
      where s.created_at >= current_date - 6 and s.created_at < current_date + 1
    )
  )
  into analytics_summary
  from public.orders o;

  return jsonb_build_object('summary', analytics_summary, 'daily_orders', daily_orders);
end;
$$;

revoke all on function public.super_admin_create_shop(text, text, text, text) from public, anon;
revoke all on function public.super_admin_set_shop_active(uuid, boolean) from public, anon;
revoke all on function public.get_super_admin_analytics() from public, anon;
grant execute on function public.super_admin_create_shop(text, text, text, text) to authenticated;
grant execute on function public.super_admin_set_shop_active(uuid, boolean) to authenticated;
grant execute on function public.get_super_admin_analytics() to authenticated;
