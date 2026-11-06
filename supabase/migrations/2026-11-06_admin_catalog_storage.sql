-- Keep the Admin catalog out of the public site root.
--
-- GitHub Pages serves every committed file to anyone, so the 1.6 MB catalog
-- JSON must not live under the site. It is stored in a private Supabase
-- Storage bucket instead and downloaded only after the admin check passes.
-- Row Level Security on storage.objects (is_admin()) is the real gate.
--
-- Bucket: catalogs (private). Object: admin-songs.json
-- Upload the file with the Supabase dashboard (Storage -> catalogs -> Upload)
-- or via `tools/build-admin-songlist.mjs --upload` with
-- SUPABASE_SERVICE_ROLE_KEY set.

insert into storage.buckets (id, name, public)
values ('catalogs', 'catalogs', false)
on conflict (id) do nothing;

drop policy if exists "catalogs_admin_read" on storage.objects;
create policy "catalogs_admin_read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'catalogs' and public.is_admin());

drop policy if exists "catalogs_admin_insert" on storage.objects;
create policy "catalogs_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'catalogs' and public.is_admin());

drop policy if exists "catalogs_admin_update" on storage.objects;
create policy "catalogs_admin_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'catalogs' and public.is_admin())
  with check (bucket_id = 'catalogs' and public.is_admin());

drop policy if exists "catalogs_admin_delete" on storage.objects;
create policy "catalogs_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'catalogs' and public.is_admin());

-- VERIFY (optional):
--   select id, name, public from storage.buckets where id = 'catalogs';
--   select policyname from pg_policies where tablename = 'objects'
--     and policyname like 'catalogs_%';