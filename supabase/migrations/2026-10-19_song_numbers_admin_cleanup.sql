-- ============================================================================
-- Randel Karaoke Player - schema upgrade (2026-10-19)
--
--   1. Random 6-digit song codes 000000-999999 (karaoke_search_cache.song_number)
--   2. `source` column ('admin' | 'public' | 'auto' | 'import')
--   3. Admin registry (admin_users) + RLS for karaoke_search_cache
--   4. Cleanup indexes + cleanup_presence_and_commands() for the
--      manage.html "Clean up now" button
--
-- Run this ONCE in the Supabase dashboard:
--   Project -> SQL Editor -> New query -> paste -> Run
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS / DO blocks.
-- Existing codes are NEVER reshuffled by a re-run; only rows whose
-- song_number is NULL get one. To randomize already-numbered songs use
-- 2026-10-19b_randomize_existing_songs.sql (one-time, deliberate).
-- Run while nobody is inserting songs (the NOT NULL step assumes every row
-- got a code in the backfill above it).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. RANDOM 6-DIGIT SONG CODES (000000-999999)
-- ----------------------------------------------------------------------------

-- Stored as an integer; the UI zero-pads for display (42 -> "000042").
-- Nullable first so existing rows can be backfilled before constraints land.
alter table public.karaoke_search_cache
  add column if not exists song_number integer;

-- Backfill every row that has no code yet with a random, unused one.
-- A random pick can collide (birthday paradox), so each candidate is checked
-- against the table; the unique index created below remains the final guard.
do $$
declare
  r record;
  candidate integer;
begin
  -- One lock for all number assignment; held until this transaction ends.
  perform pg_advisory_xact_lock(20261019, 1);

  for r in
    select id from public.karaoke_search_cache
     where song_number is null
     order by id
  loop
    loop
      candidate := floor(random() * 1000000)::int;   -- 0 .. 999999
      exit when not exists (
        select 1 from public.karaoke_search_cache where song_number = candidate
      );
    end loop;

    update public.karaoke_search_cache
       set song_number = candidate
     where id = r.id;
  end loop;
end $$;

-- One code, one song. This index is the final guarantee against conflicts.
create unique index if not exists karaoke_search_cache_song_number_key
  on public.karaoke_search_cache (song_number);

-- Six slots including leading zeros: 000000-999999 (1,000,000 codes).
-- Dropped and recreated so databases that ran the sequential version are
-- upgraded from the old 100000-999999 range.
alter table public.karaoke_search_cache
  drop constraint if exists karaoke_search_cache_song_number_range;
alter table public.karaoke_search_cache
  add constraint karaoke_search_cache_song_number_range
  check (song_number between 0 and 999999);

alter table public.karaoke_search_cache
  alter column song_number set not null;

-- Random generator for every future insert, whatever the path (admin UI,
-- backend cache, public submission, SQL). Covers all of them, so no
-- application code has to generate or retry codes.
create or replace function public.assign_random_song_number()
returns trigger
language plpgsql
as $$
declare
  candidate integer;
  attempts  integer := 0;
begin
  -- Explicit codes are respected (imports/fixes can still set one).
  if new.song_number is not null then
    return new;
  end if;

  -- Serialize selection so two concurrent inserts cannot pick the same code.
  -- Transaction-scoped: released when the insert commits or rolls back.
  perform pg_advisory_xact_lock(20261019, 1);

  loop
    candidate := floor(random() * 1000000)::int;   -- 0 .. 999999
    exit when not exists (
      select 1 from public.karaoke_search_cache where song_number = candidate
    );

    attempts := attempts + 1;
    if attempts >= 200 then
      raise exception 'Could not allocate a free song number after % attempts', attempts;
    end if;
  end loop;

  new.song_number := candidate;
  return new;
end $$;

drop trigger if exists karaoke_random_song_number on public.karaoke_search_cache;
create trigger karaoke_random_song_number
  before insert on public.karaoke_search_cache
  for each row execute function public.assign_random_song_number();

-- Retire the old sequential generator (harmless if it was never created).
alter table public.karaoke_search_cache
  alter column song_number set default null;
drop sequence if exists public.karaoke_song_number_seq;

-- The internal id PK (karaoke_search_cache.id) can fall behind the table when
-- rows were ever seeded with explicit ids. New inserts then fail with
--   duplicate key value violates unique constraint "karaoke_search_cache_pkey"
-- until the sequence catches up. Resync it to the current max id so the very
-- next insert gets a free value.
do $$
declare
  seq_name text;
  max_id bigint;
begin
  seq_name := pg_get_serial_sequence('public.karaoke_search_cache', 'id');
  if seq_name is null then
    select substring(column_default from 'nextval\(''([^'']+)''')
      into seq_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'karaoke_search_cache'
        and column_name = 'id';
  end if;

  if seq_name is not null then
    select coalesce(max(id), 1) into max_id from public.karaoke_search_cache;
    perform setval(seq_name::regclass, max_id);
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 2. SOURCE COLUMN (who added the song)
-- ----------------------------------------------------------------------------

alter table public.karaoke_search_cache
  add column if not exists source text not null default 'admin';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'karaoke_search_cache_source_check'
      and conrelid = 'public.karaoke_search_cache'::regclass
  ) then
    alter table public.karaoke_search_cache
      add constraint karaoke_search_cache_source_check
      check (source in ('admin', 'public', 'auto', 'import'));
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 3. ADMIN REGISTRY + RLS
-- ----------------------------------------------------------------------------

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists "admin_users_self_read" on public.admin_users;
create policy "admin_users_self_read"
  on public.admin_users for select
  to authenticated
  using (user_id = auth.uid());

-- Used by every write policy below and by cleanup_presence_and_commands().
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to anon, authenticated;

alter table public.karaoke_search_cache enable row level security;

-- Drop the legacy permissive policies from plan/SECURITY-UPDATE.md.
-- Names created by hand in the dashboard may differ: also open
-- Dashboard -> Authentication -> Policies and delete every anon/authenticated
-- policy on karaoke_search_cache that is NOT one of the four created below.
drop policy if exists "anon_delete_karaoke_search_cache" on public.karaoke_search_cache;
drop policy if exists "songbook_read_all"       on public.karaoke_search_cache;
drop policy if exists "songbook_admin_insert"   on public.karaoke_search_cache;
drop policy if exists "songbook_admin_update"   on public.karaoke_search_cache;
drop policy if exists "songbook_admin_delete"   on public.karaoke_search_cache;

-- Reads stay public: the player, remote, songbook and admin list all SELECT.
create policy "songbook_read_all"
  on public.karaoke_search_cache for select
  to anon, authenticated
  using (true);

-- Writes: admins only. There is deliberately NO anon INSERT policy:
-- public submissions go through the Vercel backend (/api/public-songs),
-- which validates and rate-limits before touching the database.
create policy "songbook_admin_insert"
  on public.karaoke_search_cache for insert
  to authenticated
  with check (public.is_admin());

create policy "songbook_admin_update"
  on public.karaoke_search_cache for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "songbook_admin_delete"
  on public.karaoke_search_cache for delete
  to authenticated
  using (public.is_admin());


-- ----------------------------------------------------------------------------
-- 4. CLEANUP: indexes + admin-triggered cleanup function
-- ----------------------------------------------------------------------------

-- remote_commands rows are only useful for the remote's ~20s confirmation
-- poll; give the table a timestamp so old commands can be pruned.
alter table public.remote_commands
  add column if not exists created_at timestamptz not null default now();

create index if not exists online_players_last_seen_idx
  on public.online_players (last_seen);

create index if not exists remote_commands_created_at_idx
  on public.remote_commands (created_at);

create index if not exists remote_commands_player_pending_idx
  on public.remote_commands (player_id) where status = 'pending';

-- Called from manage.html ("Clean up now") as an authenticated admin.
-- The scheduled daily job lives in the Vercel backend (/api/cleanup).
create or replace function public.cleanup_presence_and_commands()
returns table(players_deleted bigint, commands_deleted bigint)
language plpgsql security definer set search_path = public
as $$
declare
  p bigint;
  c bigint;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  delete from public.online_players
   where last_seen < now() - interval '2 days';
  get diagnostics p = row_count;

  delete from public.remote_commands
   where created_at < now() - interval '2 days';
  get diagnostics c = row_count;

  return query select p, c;
end $$;

revoke all on function public.cleanup_presence_and_commands() from public;
grant execute on function public.cleanup_presence_and_commands() to authenticated;


-- ----------------------------------------------------------------------------
-- OPTIONAL: database-side schedule instead of / in addition to Vercel cron.
-- Uncomment only if the pg_cron extension is available on your plan.
-- ----------------------------------------------------------------------------
-- create extension if not exists pg_cron;
-- select cron.schedule(
--   'rk-cleanup-presence-and-commands',
--   '0 3 * * *',
--   $$
--     delete from public.online_players where last_seen < now() - interval '2 days';
--     delete from public.remote_commands where created_at < now() - interval '2 days';
--   $$
-- );


-- ----------------------------------------------------------------------------
-- VERIFY (run these after the migration and check the output)
-- ----------------------------------------------------------------------------
-- select count(*) as total_songs,
--        count(distinct song_number) as numbered_songs,
--        min(song_number) as first_number,
--        max(song_number) as last_number
--   from public.karaoke_search_cache;
--
-- -- Random generator present:
-- select tgname from pg_trigger
--  where tgname = 'karaoke_random_song_number';
--
-- -- Insert a row without a code and check it lands in 0..999999, then clean up:
-- insert into public.karaoke_search_cache (search_query, video_id, video_title)
-- values ('random-number-check', 'abcdefghijk', 'DELETE ME') returning song_number;
-- delete from public.karaoke_search_cache where search_query = 'random-number-check';
--
-- -- Should point to (or past) the highest id; if not, re-run section 1.
-- select last_value from pg_sequences
--  where schemaname = 'public' and sequencename = 'karaoke_search_cache_id_seq';
--
-- select policyname, cmd, roles
--   from pg_policies
--  where schemaname = 'public' and tablename = 'karaoke_search_cache';
