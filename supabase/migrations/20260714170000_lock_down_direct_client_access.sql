-- Defense-in-depth: the web app uses Supabase Auth only; all brain data flows
-- through the trusted API (service role). Drop permissive membership-only policies
-- that ignored note visibility and company-space roles.

drop policy if exists note_index_all_own on public.note_index;
drop policy if exists user_config_all_own on public.user_config;
drop policy if exists note_versions_all_member on public.note_versions;

drop policy if exists brain_read_own on storage.objects;
drop policy if exists brain_insert_own on storage.objects;
drop policy if exists brain_update_own on storage.objects;
drop policy if exists brain_delete_own on storage.objects;

-- RLS stays enabled with no permissive policies → authenticated/anon direct access denied.
