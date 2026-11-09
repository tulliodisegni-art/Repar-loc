-- Répar'Loc : étapes vérifiées par le serveur, notifications sur le téléphone, lien de réponse pour le professionnel.
-- Appliqué comme migration « reparloc_etapes_push_lien ».

/* ---------- 1. Ordre des étapes contrôlé par le serveur ---------- */
-- Qui peut faire passer un dossier d'un statut à un autre (miroir des actions de l'appli).
create or replace function public.rl_step_ok(r text, a text, b text) returns boolean language sql immutable set search_path = '' as $$
  select a is not distinct from b or coalesce(case r
    when 'owner' then (a in ('NOUVEAU','A_CHOISIR','SUIVI') and b in ('PRECISIONS','ATTENTE_PRO','CLASSE'))
      or (a = 'PRECISIONS' and b in ('CLASSE','ATTENTE_PRO'))
      or (a = 'PROPOSITION' and b in ('RDV_A_ORGANISER','RDV_PROPOSE','RDV_CONFIRME','ATTENTE_PRO','A_CHOISIR'))
      or (a = 'TERMINEE' and b in ('CLOTURE','SUIVI'))
    when 'tenant' then (a = 'PRECISIONS' and b in ('NOUVEAU','A_CHOISIR','SUIVI'))
      or (a = 'RDV_PROPOSE' and b in ('RDV_CONFIRME','RDV_A_ORGANISER'))
      or (a = 'RDV_CONFIRME' and b = 'RDV_A_ORGANISER')
    when 'pro' then (a = 'ATTENTE_PRO' and b in ('PROPOSITION','PRECISIONS','A_CHOISIR'))
      or (a in ('RDV_A_ORGANISER','RDV_PROPOSE','RDV_CONFIRME') and b in ('RDV_PROPOSE','PROPOSITION'))
      or (a = 'RDV_CONFIRME' and b = 'TERMINEE')
  end, false)
$$;

create or replace function public.rl_dossier_guard() returns trigger language plpgsql security definer set search_path = '' as $function$
declare r text; o jsonb; n jsonb;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if coalesce(new.data->>'status', '') <> 'NOUVEAU' then raise exception 'etape_non_autorisee'; end if;
    return new;
  end if;
  if new.logement_id <> old.logement_id then raise exception 'logement_immuable'; end if;
  -- sans compte connecté (lien de réponse du professionnel, traité par le serveur) : rôle « pro »
  select case when l.owner_id = auth.uid() then 'owner' when l.tenant_id = auth.uid() then 'tenant' else 'pro' end into r
    from public.rl_logements l where l.id = old.logement_id;
  if new.pro_id is distinct from old.pro_id then
    if r = 'owner' then
      if new.pro_id is not null and not exists(select 1 from public.rl_pros p join public.rl_logements l on l.owner_id = p.owner_id where p.id = new.pro_id and l.id = new.logement_id) then
        raise exception 'pro_inconnu'; end if;
    elsif not (r = 'pro' and new.pro_id is null) then raise exception 'seul_le_proprietaire_choisit_le_pro';
    end if;
  end if;
  o := old.data; n := new.data;
  if not public.rl_step_ok(r, o->>'status', n->>'status') then raise exception 'etape_non_autorisee'; end if;
  if (n->'title') is distinct from (o->'title') or (n->'description') is distinct from (o->'description')
     or (n->'category') is distinct from (o->'category') or (n->'num') is distinct from (o->'num') or (n->'createdAt') is distinct from (o->'createdAt') then
    raise exception 'etape_non_autorisee'; end if;
  if (n->'closure') is distinct from (o->'closure') and r <> 'owner' then raise exception 'etape_non_autorisee'; end if;
  if (n->'feedback') is distinct from (o->'feedback') and nullif(n->'feedback', 'null'::jsonb) is not null and r <> 'tenant' then raise exception 'etape_non_autorisee'; end if;
  if (n->'report') is distinct from (o->'report') and nullif(n->'report', 'null'::jsonb) is not null and r <> 'pro' then raise exception 'etape_non_autorisee'; end if;
  if coalesce((n->>'accepted')::boolean, false) and not coalesce((o->>'accepted')::boolean, false) and r <> 'pro' then raise exception 'etape_non_autorisee'; end if;
  return new;
end $function$;

-- La proposition (devis) : seul le professionnel l'envoie, seul le propriétaire l'accepte, la refuse ou demande une modification.
create or replace function public.rl_pp_guard() returns trigger language plpgsql security definer set search_path = '' as $function$
declare r text; oq jsonb; nq jsonb;
begin
  r := public.rl_dossier_role(new.dossier_id);
  if r is null then return new; end if; -- traitement serveur (lien de réponse)
  select nullif(p.data->'quote', 'null'::jsonb) into oq from public.rl_dossier_pp p where p.dossier_id = new.dossier_id;
  nq := nullif(new.data->'quote', 'null'::jsonb);
  if nq is not null and nq is distinct from oq then
    if nq->>'status' = 'proposée' and r <> 'pro' then raise exception 'etape_non_autorisee'; end if;
    if nq->>'status' in ('acceptée','refusée','modification demandée') and r <> 'owner' then raise exception 'etape_non_autorisee'; end if;
  end if;
  return new;
end $function$;
create or replace trigger rl_pp_guard before insert or update on public.rl_dossier_pp for each row execute function public.rl_pp_guard();

/* ---------- 2. Notifications sur le téléphone ---------- */
-- Chaque notification de l'appli part aussi en notification sur le téléphone (file commune « push_queue »,
-- envoyée chaque minute par la fonction « notifications », comme pour les autres applis).
create or replace function public.rl_notif_push() returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.push_queue (user_id, app, key, kind, send_at, title, body, url)
  values (new.to_user, 'reparloc', 'n:' || new.id, 'dossier', now(), 'Répar''Loc', new.text, './?d=' || coalesce(new.dossier_id, ''))
  on conflict do nothing;
  return new;
end $function$;
create or replace trigger rl_notif_push after insert on public.rl_notifs for each row execute function public.rl_notif_push();

/* ---------- 3. Lien de réponse pour le professionnel (sans compte) ---------- */
create table if not exists public.rl_pro_links (
  token text primary key check (char_length(token) between 20 and 64),
  dossier_id text not null references public.rl_dossiers(id) on delete cascade,
  pro_id uuid not null references public.rl_pros(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (dossier_id, pro_id)
);
alter table public.rl_pro_links enable row level security;
create policy rl_links_sel on public.rl_pro_links for select to authenticated using (created_by = (select auth.uid()));
create policy rl_links_ins on public.rl_pro_links for insert to authenticated
  with check (created_by = (select auth.uid()) and public.rl_owns_pro(pro_id) and public.rl_dossier_role(dossier_id) = 'owner');
revoke all on public.rl_pro_links from anon;

-- messages écrits depuis le lien : pas de compte, on garde le professionnel concerné
alter table public.rl_messages add column if not exists pro_id uuid references public.rl_pros(id) on delete set null;

/* ---------- 4. Photos : le propriétaire peut effacer celles de ses dossiers (suppression de compte) ---------- */
create policy rl_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'rl-media' and public.rl_dossier_role((storage.foldername(name))[1]) = 'owner');
