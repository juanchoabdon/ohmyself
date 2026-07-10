-- Aggregate note counts per top-level folder (first path segment), scoped to
-- the visibilities the caller may see. Powers the lazy-loading sidebar: the
-- client shows pillars + counts up front and only fetches a folder's notes on
-- expand, so a large brain never has to ship every row to build the tree.

create or replace function public.note_folder_counts(p_user uuid, p_allowed text[])
returns table (folder text, n bigint)
language sql
stable
as $$
  select split_part(path, '/', 1) as folder, count(*)::bigint as n
  from public.note_index
  where user_id = p_user
    and visibility::text = any (p_allowed)
  group by 1;
$$;
