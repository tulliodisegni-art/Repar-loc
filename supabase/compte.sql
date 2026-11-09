-- Répar'Loc : suppression des données Répar'Loc d'un compte (Menu → Confidentialité → Supprimer mon compte).
-- Le compte de connexion (e-mail) est commun à d'autres applis du même projet Supabase : il n'est pas supprimé ici.
-- Appliqué comme migration « reparloc_compte ».

-- messages écrits depuis le lien de réponse du professionnel : pas d'auteur connecté
alter table public.rl_messages alter column author drop not null;

create or replace function public.rl_delete_my_data() returns void language plpgsql security definer set search_path = '' as $function$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'non_connecte'; end if;
  -- propriétaire : ses logements (avec leurs dossiers, messages et notifications) et ses professionnels
  delete from public.rl_logements where owner_id = me;
  delete from public.rl_pros where owner_id = me;
  delete from public.rl_invites where owner_id = me;
  -- locataire ou professionnel : détaché des logements et des propriétaires
  update public.rl_logements set tenant_id = null where tenant_id = me;
  update public.rl_pros set user_id = null where user_id = me;
  delete from public.rl_messages where author = me;
  delete from public.rl_notifs where to_user = me;
  delete from public.push_subs where user_id = me and app = 'reparloc';
  delete from public.push_queue where user_id = me and app = 'reparloc';
  delete from public.rl_profiles where user_id = me;
end $function$;
revoke execute on function public.rl_delete_my_data() from public, anon;
grant execute on function public.rl_delete_my_data() to authenticated;
