-- ohmyself! — brain bucket RLS becomes space-membership based.
-- Objects live at `<spaceId>/<path>`. For self spaces spaceId == userId, so every
-- existing object keeps the same key and stays accessible. Company spaces get their
-- own prefix, readable/writable by their members. (The trusted server uses the
-- service role and enforces role/visibility in app code; this is defense in depth.)

drop policy if exists brain_read_own on storage.objects;
create policy brain_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'brain'
    and (storage.foldername(name))[1] in (
      select m.space_id::text from public.space_members m where m.user_id = auth.uid()
    )
  );

drop policy if exists brain_insert_own on storage.objects;
create policy brain_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brain'
    and (storage.foldername(name))[1] in (
      select m.space_id::text from public.space_members m where m.user_id = auth.uid()
    )
  );

drop policy if exists brain_update_own on storage.objects;
create policy brain_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'brain'
    and (storage.foldername(name))[1] in (
      select m.space_id::text from public.space_members m where m.user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'brain'
    and (storage.foldername(name))[1] in (
      select m.space_id::text from public.space_members m where m.user_id = auth.uid()
    )
  );

drop policy if exists brain_delete_own on storage.objects;
create policy brain_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'brain'
    and (storage.foldername(name))[1] in (
      select m.space_id::text from public.space_members m where m.user_id = auth.uid()
    )
  );
