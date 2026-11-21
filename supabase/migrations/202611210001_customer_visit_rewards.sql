create index if not exists orders_completed_customer_phone_idx
  on public.orders (
    shop_id,
    (regexp_replace(customer_phone, '[^0-9]', '', 'g'))
  )
  where status = 'completed' and customer_phone is not null;

create or replace function public.get_customer_visit_count(
  menu_slug text,
  customer_phone text
)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_shop_id uuid;
  normalized_phone text;
  completed_visits integer;
begin
  normalized_phone := regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g');
  if char_length(normalized_phone) < 7 or char_length(normalized_phone) > 15 then
    raise exception 'Enter a valid phone number to check completed visits' using errcode = '22023';
  end if;

  select s.id into target_shop_id
  from public.shops s
  where s.slug = lower(btrim(menu_slug)) and s.is_active;

  if target_shop_id is null then
    raise exception 'This menu is not available' using errcode = 'P0002';
  end if;

  select count(*)::integer into completed_visits
  from public.orders o
  where o.shop_id = target_shop_id
    and o.status = 'completed'
    and o.customer_phone is not null
    and regexp_replace(o.customer_phone, '[^0-9]', '', 'g') = normalized_phone;

  return coalesce(completed_visits, 0);
end;
$$;

revoke all on function public.get_customer_visit_count(text, text) from public;
grant execute on function public.get_customer_visit_count(text, text) to anon, authenticated;
