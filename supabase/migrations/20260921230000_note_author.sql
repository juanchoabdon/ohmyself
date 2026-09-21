-- Quién cargó cada nota.
--
-- Hasta ahora una nota solo sabía CUÁNDO se escribió, no QUIÉN la escribió:
-- `user_id` es el dueño del space, y en un brain compartido (una pareja, un
-- grupo, una empresa) eso es todo el mundo. Sin esto, "¿qué fue lo último que
-- cargó Sebas?" no tiene respuesta — hay que adivinarla por el título.
--
-- Sale del frontmatter (`author:`), que ya viaja round-trip; acá solo se
-- indexa para poder listar y filtrar sin abrir cada nota. Nullable a
-- propósito: todo lo que ya existe se queda sin autor y eso está bien.
alter table public.note_index add column if not exists author text;

create index if not exists note_index_space_author_idx
  on public.note_index (space_id, author);
