-- ============================================================================
-- Randel Karaoke Player - one-time random code backfill (2026-10-19b)
--
-- Randomizes the song_number of EVERY song, replacing the sequential codes
-- (100000, 100001, ...) that earlier migrations produced.
--
-- Run this ONCE, after 2026-10-19_song_numbers_admin_cleanup.sql, and only if
-- the songbook still holds sequential codes. Re-running it reshuffles every
-- code again - never schedule it, never re-run it by accident.
--
-- Run while nobody is adding songs. The Supabase SQL editor wraps the whole
-- file in one transaction: it either finishes or rolls back completely.
--
-- Afterwards the printed songbook is obsolete and must be regenerated.
-- ============================================================================

do $$
declare
  r record;
  candidate integer;
  done_count integer := 0;
begin
  -- Same lock the insert trigger uses, so no new song grabs a code while the
  -- backfill is mid-flight.
  perform pg_advisory_xact_lock(20261019, 1);

  for r in select id from public.karaoke_search_cache order by id loop
    loop
      candidate := floor(random() * 1000000)::int;   -- 0 .. 999999
      exit when not exists (
        select 1 from public.karaoke_search_cache where song_number = candidate
      );
    end loop;

    update public.karaoke_search_cache
       set song_number = candidate
     where id = r.id;

    done_count := done_count + 1;
  end loop;

  raise notice 'Randomized % songs.', done_count;
end $$;


-- ----------------------------------------------------------------------------
-- VERIFY (run after; the first query must return 0 rows)
-- ----------------------------------------------------------------------------
-- select song_number, count(*) as copies
--   from public.karaoke_search_cache
--  group by song_number having count(*) > 1;
--
-- select count(*) as total_songs,
--        count(*) filter (where song_number < 100000) as with_leading_zeros,
--        min(song_number) as first_number,
--        max(song_number) as last_number
--   from public.karaoke_search_cache;
