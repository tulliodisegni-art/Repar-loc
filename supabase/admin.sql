-- Répar'Loc : espace administrateur (réservé au compte tulliodisegni@icloud.com)
create table if not exists public.rl_admins (user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz default now());
alter table public.rl_admins enable row level security;
drop policy if exists rl_admins_sel on public.rl_admins;
create policy rl_admins_sel on public.rl_admins for select to authenticated using (user_id = auth.uid());
insert into public.rl_admins(user_id) values ('36cd7f8d-6cb5-4dcc-8a44-b915f98212f2') on conflict do nothing;

create or replace function public.rl_is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.rl_admins where user_id = auth.uid());
$$;

create or replace function public.rl_admin_overview() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.rl_is_admin() then raise exception 'non_autorise'; end if;
  return jsonb_build_object(
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', p.name, 'role', p.role, 'email', u.email, 'created_at', u.created_at, 'last_sign_in', u.last_sign_in_at) order by u.created_at desc) from public.rl_profiles p left join auth.users u on u.id = p.user_id), '[]'::jsonb),
    'logements', coalesce((select jsonb_agg(to_jsonb(l)) from public.rl_logements l), '[]'::jsonb),
    'pros', coalesce((select jsonb_agg(to_jsonb(x)) from public.rl_pros x), '[]'::jsonb),
    'dossiers', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'logement_id', d.logement_id, 'pro_id', d.pro_id, 'data', d.data, 'lp', lp.data, 'pp', pp.data)) from public.rl_dossiers d left join public.rl_dossier_lp lp on lp.dossier_id = d.id left join public.rl_dossier_pp pp on pp.dossier_id = d.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.rl_messages m), '[]'::jsonb)
  );
end $$;

create or replace function public.rl_admin_unlink_tenant(p_logement uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.rl_is_admin() then raise exception 'non_autorise'; end if;
  update public.rl_logements set tenant_id = null where id = p_logement;
end $$;

create or replace function public.rl_admin_unlink_pro(p_pro uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.rl_is_admin() then raise exception 'non_autorise'; end if;
  update public.rl_pros set user_id = null where id = p_pro;
end $$;

create or replace function public.rl_admin_delete_dossier(p_id text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.rl_is_admin() then raise exception 'non_autorise'; end if;
  delete from public.rl_notifs where dossier_id = p_id;
  delete from public.rl_messages where dossier_id = p_id;
  delete from public.rl_dossier_lp where dossier_id = p_id;
  delete from public.rl_dossier_pp where dossier_id = p_id;
  delete from public.rl_dossiers where id = p_id;
end $$;

revoke execute on function public.rl_is_admin(), public.rl_admin_overview(), public.rl_admin_unlink_tenant(uuid), public.rl_admin_unlink_pro(uuid), public.rl_admin_delete_dossier(text) from public, anon;
grant execute on function public.rl_is_admin(), public.rl_admin_overview(), public.rl_admin_unlink_tenant(uuid), public.rl_admin_unlink_pro(uuid), public.rl_admin_delete_dossier(text) to authenticated;
