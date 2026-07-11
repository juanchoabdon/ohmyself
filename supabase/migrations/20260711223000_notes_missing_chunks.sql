-- Reconcile helper for the embedding safety net: notes that have no embedded
-- chunk yet (e.g. a write whose best-effort embed failed, or a note created
-- before the hybrid layer). The scheduler embeds these gradually each tick.

create or replace function public.notes_missing_chunks(p_space uuid, p_limit int default 50)
returns table (
  path       text,
  note_id    text,
  title      text,
  type       text,
  visibility text,
  tags       text[],
  created    date,
  updated    date,
  content    text
)
language sql
stable
as $$
  select n.path, n.note_id, n.title, n.type, n.visibility::text, n.tags, n.created, n.updated, n.content
  from public.note_index n
  where n.space_id = p_space
    and n.content <> ''
    and not exists (
      select 1 from public.note_chunks c
      where c.space_id = n.space_id and c.path = n.path and c.embedding is not null
    )
  order by n.updated desc nulls last
  limit p_limit;
$$;
