-- Tag songs that were requested from a catalog.
--
-- `source` still records who added the song ('admin' | 'public' | 'auto' |
-- 'import'). `origin` records which catalog the request came from, so
-- manage.html can show "From Admin" without overloading `source`.
--
-- Today the only allowed value is 'admin' (the Admin song library served by
-- admin-songs.html). Rows added from anywhere else keep origin = NULL.

alter table public.karaoke_search_cache
  add column if not exists origin text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'karaoke_search_cache_origin_check'
      and conrelid = 'public.karaoke_search_cache'::regclass
  ) then
    alter table public.karaoke_search_cache
      add constraint karaoke_search_cache_origin_check
      check (origin is null or origin in ('admin'));
  end if;
end $$;

-- Partial index: most rows are NULL, so only catalog-tagged rows are indexed.
create index if not exists karaoke_search_cache_origin_idx
  on public.karaoke_search_cache (origin)
  where origin is not null;

-- VERIFY (optional):
--   select origin, count(*) from public.karaoke_search_cache group by origin;
--   select conname from pg_constraint
--    where conrelid = 'public.karaoke_search_cache'::regclass
--      and conname = 'karaoke_search_cache_origin_check';
