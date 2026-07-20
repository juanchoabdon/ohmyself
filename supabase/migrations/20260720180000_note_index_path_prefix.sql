-- Speed up lazy sidebar folder loads: ?prefix=culture/ scans on note_index.
create index if not exists note_index_space_path_prefix_idx
  on public.note_index (space_id, path text_pattern_ops);
