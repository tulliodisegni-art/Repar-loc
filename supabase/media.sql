-- Répar'Loc : photos et vidéos des dossiers (rangement privé « rl-media »)
-- Un dossier par signalement ; seuls les participants du dossier (et l'administrateur) peuvent voir les fichiers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rl-media', 'rl-media', false, 52428800, array['image/*', 'video/*'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists rl_media_select on storage.objects;
drop policy if exists rl_media_insert on storage.objects;

create policy rl_media_select on storage.objects for select to authenticated
  using (bucket_id = 'rl-media' and (public.rl_dossier_role((storage.foldername(name))[1]) is not null or public.rl_is_admin()));

create policy rl_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'rl-media' and public.rl_dossier_role((storage.foldername(name))[1]) is not null);
