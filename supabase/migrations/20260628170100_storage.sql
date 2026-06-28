-- ohmyself! — Storage bucket for the markdown brain.
-- One private bucket; each user owns the prefix `<userId>/...`.

insert into storage.buckets (id, name, public)
values ('brain', 'brain', false)
on conflict (id) do nothing;

-- Helper: first path segment of an object name == the owning user id.
-- e.g. object name "a1b2.../projects/rappi/_index.md" -> owner = "a1b2..."

drop policy if exists brain_read_own on storage.objects;
create policy brain_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'brain' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists brain_insert_own on storage.objects;
create policy brain_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'brain' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists brain_update_own on storage.objects;
create policy brain_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'brain' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'brain' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists brain_delete_own on storage.objects;
create policy brain_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'brain' and (storage.foldername(name))[1] = auth.uid()::text);
