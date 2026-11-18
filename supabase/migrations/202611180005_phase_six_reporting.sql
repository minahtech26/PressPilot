create or replace function public.get_shop_report(
  target_shop_id uuid,
  start_at timestamptz,
  end_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  report_summary jsonb;
  daily_breakdown jsonb;
  product_breakdown jsonb;
begin
  if not public.has_shop_role(
    target_shop_id,
    array['owner','manager']::public.shop_role[]
  ) then
    raise exception 'You do not have permission to view reports in this shop' using errcode = '42501';
  end if;

  if start_at is null or end_at is null or end_at <= start_at
     or end_at - start_at > interval '366 days' then
    raise exception 'Choose a valid report period of 366 days or less' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'order_count', count(*) filter (where o.status <> 'cancelled'),
    'cancelled_count', count(*) filter (where o.status = 'cancelled'),
    'gross_order_value', coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0),
    'average_order_value', coalesce(round(avg(o.total) filter (where o.status <> 'cancelled'), 2), 0)
  )
  into report_summary
  from public.orders o
  where o.shop_id = target_shop_id
    and o.created_at >= start_at
    and o.created_at < end_at;

  with calendar as (
    select generate_series(
      date_trunc('day', start_at at time zone 'UTC'),
      date_trunc('day', (end_at - interval '1 microsecond') at time zone 'UTC'),
      interval '1 day'
    )::date as report_day
  ),
  daily as (
    select
      (o.created_at at time zone 'UTC')::date as report_day,
      count(*) filter (where o.status <> 'cancelled') as order_count,
      coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0) as order_value
    from public.orders o
    where o.shop_id = target_shop_id
      and o.created_at >= start_at
      and o.created_at < end_at
    group by (o.created_at at time zone 'UTC')::date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', calendar.report_day,
    'orders', coalesce(daily.order_count, 0),
    'order_value', coalesce(daily.order_value, 0)
  ) order by calendar.report_day), '[]'::jsonb)
  into daily_breakdown
  from calendar
  left join daily using (report_day);

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_name', ranked.product_name,
    'quantity', ranked.quantity,
    'item_value', ranked.item_value
  ) order by ranked.quantity desc, ranked.product_name), '[]'::jsonb)
  into product_breakdown
  from (
    select
      oi.product_name,
      sum(oi.quantity) as quantity,
      sum(oi.line_total) as item_value
    from public.order_items oi
    join public.orders o
      on o.id = oi.order_id
     and o.shop_id = oi.shop_id
    where oi.shop_id = target_shop_id
      and o.created_at >= start_at
      and o.created_at < end_at
      and o.status <> 'cancelled'
    group by oi.product_name
    order by sum(oi.quantity) desc, oi.product_name
    limit 10
  ) ranked;

  return jsonb_build_object(
    'summary', report_summary,
    'daily', daily_breakdown,
    'top_products', product_breakdown
  );
end;
$$;

revoke all on function public.get_shop_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_shop_report(uuid, timestamptz, timestamptz) to authenticated;
