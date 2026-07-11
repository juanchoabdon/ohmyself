-- ohmyself! — Hybrid retrieval (Layer 1 of the Brain Retrieval & Research Agent spec).
--
-- Moves recall from single-shot lexical FTS to hybrid retrieval: chunk-level
-- semantic embeddings (pgvector) fused with Postgres full-text ranking. Markdown
-- in the vault stays the source of truth; note_chunks is derived + rebuildable.

create extension if not exists vector;

-- ── note_chunks ────────────────────────────────────────────────────────────────
-- One row per meaningful chunk of a note. Keyed by (space_id, path, chunk_pos)
-- so a note's chunks can be replaced atomically on every write. Carries enough
-- note metadata to filter + rank without joining note_index on the hot path.
create table if not exists public.note_chunks (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces (id) on delete cascade,
  path        text not null,
  note_id     text,
  title       text not null default '',
  type        text not null default 'note',
  visibility  visibility not null default 'private',
  tags        text[] not null default '{}',
  section     text not null default '',   -- nearest heading for the chunk
  chunk_pos   int not null default 0,     -- 0-based position within the note
  content     text not null default '',   -- raw chunk text (for excerpt/display)
  created     date,
  updated     date,
  embedding   vector(1536),               -- text-embedding-3-small; null until embedded
  indexed_at  timestamptz not null default now(),
  fts         tsvector generated always as (
                to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(section, '') || ' ' || coalesce(content, ''))
              ) stored,
  unique (space_id, path, chunk_pos)
);

create index if not exists note_chunks_space_idx      on public.note_chunks (space_id);
create index if not exists note_chunks_space_path_idx on public.note_chunks (space_id, path);
create index if not exists note_chunks_space_type_idx on public.note_chunks (space_id, type);
create index if not exists note_chunks_fts_idx        on public.note_chunks using gin (fts);
create index if not exists note_chunks_tags_idx       on public.note_chunks using gin (tags);
-- Approximate nearest-neighbour over cosine distance. Fine to build before rows
-- exist; it fills as embeddings are written/backfilled.
create index if not exists note_chunks_embedding_idx
  on public.note_chunks using hnsw (embedding vector_cosine_ops);

-- ── RLS ─────────────────────────────────────────────────────────────────────────
-- The trusted server uses the service role (bypasses RLS) and enforces visibility
-- in application code; this governs any direct client access (mirrors note_index).
alter table public.note_chunks enable row level security;
drop policy if exists note_chunks_all_own on public.note_chunks;
create policy note_chunks_all_own on public.note_chunks
  for all using (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  ) with check (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  );

-- ── hybrid_search_notes ──────────────────────────────────────────────────────────
-- Fuses semantic (vector) and lexical (fts) chunk candidates with Reciprocal Rank
-- Fusion, then collapses to the single best-scoring chunk per note. Visibility and
-- scope filtering happen here, at the query layer — never only in the prompt.
--
--   p_tsquery   pre-built to_tsquery string (e.g. "amal:* & mob:*"); '' to skip lexical
--   p_embedding query embedding as a pgvector text literal ("[0.1,...]"); '' to skip vector
--   p_allowed   visibilities the caller may see
--   p_limit     number of notes to return (callers over-fetch, then rerank app-side)
create or replace function public.hybrid_search_notes(
  p_space     uuid,
  p_tsquery   text,
  p_embedding text,
  p_allowed   text[],
  p_types     text[] default null,
  p_tags      text[] default null,
  p_limit     int default 40,
  p_pool      int default 80,
  p_sem_weight float default 1.0,
  p_lex_weight float default 1.0,
  p_rrf_k     int default 60
)
returns table (
  path       text,
  note_id    text,
  title      text,
  type       text,
  visibility text,
  tags       text[],
  created    date,
  updated    date,
  section    text,
  chunk_pos  int,
  excerpt    text,
  score      float,
  sem_rank   int,
  lex_rank   int,
  similarity float
)
language sql
stable
as $$
with
qv as (
  select case when p_embedding is null or p_embedding = '' then null else p_embedding::vector end as v
),
base as (
  select c.*
  from public.note_chunks c
  where c.space_id = p_space
    and c.visibility::text = any (p_allowed)
    and (p_types is null or c.type = any (p_types))
    and (p_tags  is null or c.tags && p_tags)
),
sem as (
  select b.id, b.path,
         row_number() over (order by b.embedding <=> (select v from qv)) as rnk,
         1 - (b.embedding <=> (select v from qv)) as sim
  from base b
  where (select v from qv) is not null and b.embedding is not null
  order by b.embedding <=> (select v from qv)
  limit p_pool
),
lex as (
  select b.id, b.path,
         row_number() over (order by ts_rank(b.fts, to_tsquery('simple', p_tsquery)) desc) as rnk
  from base b
  where p_tsquery is not null and p_tsquery <> ''
    and b.fts @@ to_tsquery('simple', p_tsquery)
  order by ts_rank(b.fts, to_tsquery('simple', p_tsquery)) desc
  limit p_pool
),
fused as (
  select
    coalesce(sem.id, lex.id)     as id,
    coalesce(sem.path, lex.path) as path,
    sem.rnk as sem_rank,
    lex.rnk as lex_rank,
    sem.sim as similarity,
    ( case when sem.rnk is not null then p_sem_weight * (1.0 / (p_rrf_k + sem.rnk)) else 0 end
    + case when lex.rnk is not null then p_lex_weight * (1.0 / (p_rrf_k + lex.rnk)) else 0 end
    ) as score
  from sem
  full outer join lex on sem.id = lex.id
),
best as (
  select f.*, row_number() over (partition by f.path order by f.score desc) as pr
  from fused f
),
top as (
  select * from best where pr = 1 order by score desc limit p_limit
)
select c.path, c.note_id, c.title, c.type, c.visibility::text, c.tags, c.created, c.updated,
       c.section, c.chunk_pos, left(c.content, 400) as excerpt,
       t.score, t.sem_rank, t.lex_rank, t.similarity
from top t
join public.note_chunks c on c.id = t.id
order by t.score desc;
$$;
