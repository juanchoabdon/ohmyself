-- Public bucket for space logos. Served openly so the space switcher and any
-- public agent page can render a company's logo without an auth token. Uploads
-- go through the server's service-role client (which bypasses RLS), so no
-- write policies are needed here; reads are public by virtue of `public = true`.
insert into storage.buckets (id, name, public)
values ('space-logos', 'space-logos', true)
on conflict (id) do update set public = true;
