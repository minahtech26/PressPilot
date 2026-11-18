create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_super_admin
  );
$$;

create or replace function public.get_super_admin_dashboard(
  page_number integer default 1,
  page_size integer default 25,
  shop_search text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  platform_summary jsonb;
  shop_list jsonb;
  filtered_count bigint;
  search_term text := btrim(coalesce(shop_search, ''));
begin
  if not public.is_super_admin() then
    raise exception 'Super administrator access required' using errcode = '42501';
  end if;

  if page_number is null or page_number < 1
     or page_number > 1000000
     or page_size is null or page_size < 1 or page_size > 100 then
    raise exception 'Choose a valid page and page size' using errcode = '22023';
  end if;
  if char_length(search_term) > 100 then
    raise exception 'Shop search must be 100 characters or fewer' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'total_shops', count(*),
    'active_shops', count(*) filter (where s.is_active),
    'inactive_shops', count(*) filter (where not s.is_active),
    'orders_today', coalesce((
      select count(*)
      from public.orders o
      where o.created_at >= date_trunc('day', now())
    ), 0),
    'open_orders', coalesce((
      select count(*)
      from public.orders o
      where o.status in ('new','accepted','preparing','ready')
    ), 0)
  )
  into platform_summary
  from public.shops s;

  select count(*)
  into filtered_count
  from public.shops s
  where search_term = ''
     or position(lower(search_term) in lower(s.name)) > 0;

  with member_counts as (
    select sm.shop_id, count(*) as member_count
    from public.shop_members sm
    group by sm.shop_id
  ),
  product_counts as (
    select p.shop_id, count(*) filter (where p.is_available) as available_products
    from public.products p
    group by p.shop_id
  ),
  order_counts as (
    select
      o.shop_id,
      count(*) filter (where o.created_at >= date_trunc('day', now())) as orders_today,
      count(*) filter (where o.status in ('new','accepted','preparing','ready')) as open_orders,
      max(o.created_at) as last_order_at
    from public.orders o
    group by o.shop_id
  ),
  page_shops as (
    select
      s.id,
      s.name,
      s.slug,
      s.is_active,
      s.created_at,
      coalesce(mc.member_count, 0) as member_count,
      coalesce(pc.available_products, 0) as available_products,
      coalesce(oc.orders_today, 0) as orders_today,
      coalesce(oc.open_orders, 0) as open_orders,
      oc.last_order_at
    from public.shops s
    left join member_counts mc on mc.shop_id = s.id
    left join product_counts pc on pc.shop_id = s.id
    left join order_counts oc on oc.shop_id = s.id
    where search_term = ''
       or position(lower(search_term) in lower(s.name)) > 0
    order by s.created_at desc, s.id
    offset (page_number::bigint - 1) * page_size
    limit page_size
  )
  select coalesce(jsonb_agg(to_jsonb(page_shops) order by page_shops.created_at desc, page_shops.id), '[]'::jsonb)
  into shop_list
  from page_shops;

  return jsonb_build_object(
    'summary', platform_summary,
    'page', page_number,
    'page_size', page_size,
    'filtered_shop_count', filtered_count,
    'shops', shop_list
  );
end;
$$;

revoke all on function public.is_super_admin() from public, anon;
revoke all on function public.get_super_admin_dashboard(integer, integer, text) from public, anon;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.get_super_admin_dashboard(integer, integer, text) to authenticated;
