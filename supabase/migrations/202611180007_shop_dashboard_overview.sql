create or replace function public.get_shop_dashboard_overview(
  target_shop_id uuid,
  timezone_name text default 'UTC'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today_local date;
  day_start timestamptz;
  next_day_start timestamptz;
  week_start timestamptz;
  overview_summary jsonb;
  payment_trend jsonb;
  setup_status jsonb;
  recent_order_list jsonb;
  active_table_count bigint;
  member_count bigint;
  available_product_count bigint;
  active_order_count bigint;
begin
  if not public.has_shop_role(
    target_shop_id,
    array['owner','manager','cashier','kitchen']::public.shop_role[]
  ) then
    raise exception 'You do not have permission to view this shop overview' using errcode = '42501';
  end if;

  if timezone_name is null or char_length(timezone_name) > 100
     or not exists (select 1 from pg_timezone_names where name = timezone_name) then
    raise exception 'Choose a valid time zone' using errcode = '22023';
  end if;

  today_local := (now() at time zone timezone_name)::date;
  day_start := today_local::timestamp at time zone timezone_name;
  next_day_start := (today_local + 1)::timestamp at time zone timezone_name;
  week_start := (today_local - 6)::timestamp at time zone timezone_name;

  select count(*) into active_table_count
  from public.dining_tables t
  where t.shop_id = target_shop_id and t.is_active;

  select count(*) into member_count
  from public.shop_members m
  where m.shop_id = target_shop_id;

  select count(*) into available_product_count
  from public.products p
  where p.shop_id = target_shop_id and p.is_available;

  select count(*) into active_order_count
  from public.orders o
  where o.shop_id = target_shop_id and o.status <> 'cancelled';

  select jsonb_build_object(
    'payments_today', coalesce((
      select sum(p.amount)
      from public.payments p
      where p.shop_id = target_shop_id
        and p.created_at >= day_start
        and p.created_at < next_day_start
    ), 0),
    'orders_today', (
      select count(*)
      from public.orders o
      where o.shop_id = target_shop_id
        and o.created_at >= day_start
        and o.created_at < next_day_start
        and o.status <> 'cancelled'
    ),
    'active_tables', active_table_count,
    'team_members', member_count
  )
  into overview_summary;

  with calendar as (
    select generate_series(today_local - 6, today_local, interval '1 day')::date as report_day
  ),
  daily_payments as (
    select
      (p.created_at at time zone timezone_name)::date as report_day,
      sum(p.amount) as amount
    from public.payments p
    where p.shop_id = target_shop_id
      and p.created_at >= week_start
      and p.created_at < next_day_start
    group by (p.created_at at time zone timezone_name)::date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', calendar.report_day,
    'amount', coalesce(daily_payments.amount, 0)
  ) order by calendar.report_day), '[]'::jsonb)
  into payment_trend
  from calendar
  left join daily_payments using (report_day);

  select jsonb_build_object(
    'has_menu', available_product_count > 0,
    'has_tables', active_table_count > 0,
    'has_team', member_count > 1,
    'has_orders', active_order_count > 0
  )
  into setup_status;

  select coalesce(jsonb_agg(to_jsonb(recent_orders) order by recent_orders.created_at desc), '[]'::jsonb)
  into recent_order_list
  from (
    select
      o.id,
      o.order_number,
      o.status,
      o.total,
      o.created_at,
      t.table_number
    from public.orders o
    left join public.dining_tables t
      on t.id = o.table_id and t.shop_id = o.shop_id
    where o.shop_id = target_shop_id and o.status <> 'cancelled'
    order by o.created_at desc
    limit 5
  ) recent_orders;

  return jsonb_build_object(
    'summary', overview_summary,
    'payments_by_day', payment_trend,
    'setup', setup_status,
    'recent_orders', recent_order_list
  );
end;
$$;

revoke all on function public.get_shop_dashboard_overview(uuid, text) from public, anon;
grant execute on function public.get_shop_dashboard_overview(uuid, text) to authenticated;
