# Random 6-Digit Song Numbers — Plan

**Status:** 📋 Plan — awaiting approval
**Date:** 2026-10-19
**Supersedes:** the numbering design in [`SONG-NUMBER-ADMIN-UPGRADE.md`](SONG-NUMBER-ADMIN-UPGRADE.md) (sections about `karaoke_song_number_seq`). Everything else there (admin roles, RLS, public submissions, cleanup) stays as implemented.

---

## 1. Goal

Replace the sequential numbering (100000, 100001, 100002, …) with a **random 6-digit code for every song, in the full `000000–999999` range** — exactly how real karaoke machines work, where the pad shows six slots including leading zeros (`000042`).

Requirements:

- Every song gets a random code automatically at insert time (admin, guest submission, cache save, SQL import).
- Codes are unique — the existing unique index stays as the final guarantee.
- Codes display as **six characters, zero-padded**: `42` → `000042`, `0` → `000000`, `999999` → `999999`.
- No other behavior changes: search, pending review, admin roles, RLS, cleanup, rate limits stay as they are.

---

## 2. What changes vs. today

| | Today | After |
|---|---|---|
| Range | `100000–999999` | `000000–999999` (1,000,000 codes) |
| Generator | Postgres sequence (`nextval`) | Random pick + collision check in a `BEFORE INSERT` trigger |
| Value of `song_number` | Integer, shown as-is | Integer `0–999999`, shown zero-padded |
| Existing songs | 100000–100174 | Random (see §5 — needs your decision) |
| Printouts / old links | Sequential codes | All codes change → regenerate the songbook |

**Collision math:** picking randomly from 1M codes, the chance of any collision at 175 songs is ~1.5%; at 10,000 songs it is effectively certain that *some* retry is needed. That's fine — the generator checks for an existing code and simply rolls again (cheap, indexed lookup). It is not a problem, it is just why the generator cannot be a naive `random()` default.

---

## 3. Generation design (database)

### 3.1 Trigger with an advisory lock

A `BEFORE INSERT` trigger assigns the number whenever the insert did not provide one. It covers **every write path** — the admin UI (PostgREST), the backend `pg` pool (`/api/public-songs`, `/api/karaoke-cache`), and manual SQL — with no changes to application code.

```sql
create or replace function public.assign_random_song_number()
returns trigger
language plpgsql
as $$
declare
  candidate integer;
  attempts  integer := 0;
begin
  -- Explicit numbers are respected (imports/fixes can still set one).
  if new.song_number is not null then
    return new;
  end if;

  -- Serialize selection so two concurrent inserts cannot pick the same code.
  -- The lock is transaction-scoped and releases on commit.
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
```

### 3.2 Constraint + sequence changes

```sql
-- Full 6-slot range, including leading-zero codes.
alter table public.karaoke_search_cache
  drop constraint if exists karaoke_search_cache_song_number_range;
alter table public.karaoke_search_cache
  add constraint karaoke_search_cache_song_number_range
  check (song_number between 0 and 999999);

-- The sequence is no longer the source of numbers.
alter table public.karaoke_search_cache
  alter column song_number set default null;
drop sequence if exists public.karaoke_song_number_seq;
```

The unique index (`karaoke_search_cache_song_number_key`) is unchanged and remains the hard guarantee, even if the trigger were ever bypassed.

### 3.3 Alternatives considered

| Option | Why not |
|---|---|
| Keep the sequence, just start it lower | Still sequential — not what was asked. |
| Random column default (`floor(random()*1000000)`) | No collision check; inserts would fail on the unique index and every path would need retry logic. |
| Application-side random + retry | Three write paths (admin UI, backend, SQL); races and duplicated logic. |
| Precomputed shuffled pool of 1M codes | Works, but a 1M-row table to maintain where one trigger is enough. |

### 3.4 Notes

- Deleted songs: their code becomes available to a future random draw (like a real machine). If "never reuse a code" is ever wanted, it needs a separate used-codes registry — deliberately out of scope.
- Max capacity: 1,000,000 songs; the loop keeps the generator correct as the table fills (expected attempts at 500k songs ≈ 2).

---

## 4. Display: zero-padding everywhere

Stored value is an integer; **every string that shows a code must pad to 6**. Each page gets the same tiny helper (the pages don't share a module):

```js
const formatSongNumber = (value) => String(value ?? '').padStart(6, '0');
```

| File | Change |
|---|---|
| `admin.js` | `songNumberOf()` → returns padded; card `data-number`; duplicate/alert messages (`#000042`); number filter keeps working (typing `42` or `000042` both normalize to `Number(term) = 42`). |
| `app.js` | `fetchSongByCode()` pads numeric input before calling `?number=`; returned `songNumber` padded; queue chip (`queueNumber`) padded. `?code=000042` deep link works as-is. |
| `remote.html` | Songbook map keys padded (`songByCode`); list rows, pad preview, modal and `song_code` payload all padded (pad input is already exactly 6 digits). Hints mention the `000000` range. |
| `songbook.html` | Table/print codes padded; the dialog `#` number padded. |
| `manage.html` | Hint copy: "6-digit code (000000–999999), generated automatically". |
| `sw.js` | Cache name bump (`rk-remote-v5`) so phones pick up the new remote. |
| `index.html` | `app.js?v=` cache-buster bump. |
| `karaoke-cache.js` (backend) | One fix found during testing: a six-digit code that finds no row must NOT fall back to the internal id (`?number=000042` was resolving row id 42 → wrong song). The id fallback now only applies to non-6-digit legacy links. |
| `public-songs.js` (backend) | No change: returns the integer; the UI pads it. |

**Search behavior after the change**

- Remote pad: type all six digits — `000042` resolves the song; `42` still triggers "Enter all 6 digits".
- Manage search: `42`, `000042` both match the row with `song_number = 42`; title text still matches too.
- Old short internal ids (`?id=35`) keep the legacy fallback only when the input is not 6 digits.

---

## 5. Existing songs — ✅ randomize all 175

**Chosen: Option A — randomize all 175 existing songs.** The whole book becomes random before it is reprinted; every code changes one last time. (Option B — keeping 100000–100174 for existing songs — was rejected.)

One-time backfill (separate file, run once):

```sql
-- supabase/migrations/2026-10-19b_randomize_existing_songs.sql
do $$
declare
  r record;
  candidate integer;
begin
  for r in select id from public.karaoke_search_cache order by id loop
    loop
      candidate := floor(random() * 1000000)::int;
      exit when not exists (
        select 1 from public.karaoke_search_cache where song_number = candidate
      );
    end loop;
    update public.karaoke_search_cache set song_number = candidate where id = r.id;
  end loop;
end $$;
```

> Run while nobody is adding songs. Wrapped in one transaction by the SQL editor — partial failure rolls back.

---

## 6. Migration file updates

The existing file `supabase/migrations/2026-10-19_song_numbers_admin_cleanup.sql` is the single source of truth and stays re-runnable. Section 1 is rewritten to:

1. add `song_number` if missing;
2. backfill **random** codes for any `NULL` rows (fresh installs);
3. keep the unique index; change the CHECK to `0–999999`;
4. replace the sequence + default with the `assign_random_song_number()` function + trigger (§3);
5. keep the internal `id` sequence resync block added earlier.

Then:

- **On this database:** re-run the updated file (safe) → new songs get random codes from that moment.
- **Optional:** run the backfill file from §5 if Option A is chosen.

---

## 7. Test plan

1. **SQL sanity** (transaction, rolled back):
   - insert 20 rows without `song_number` → all get unique codes in `0–999999`, no duplicates;
   - force a row to `song_number = 42` → displays as `000042` end to end.
2. **UI (headless + manual):**
   - manage: add a song → random code shown padded; search `42` and `000042` both find the `000042` song; duplicate alert shows `#000042`.
   - remote: pad shows 6 slots, `000042` preview resolves, unknown/partial hints unchanged; songbook list shows padded codes only.
   - player: open `?code=000042&play=0` → resolves and queues with a `000042` chip.
   - songbook page/print: every code is 6 chars, including leading zeros.
3. **Backend:** `?number=000042`, `?number=42` (should not be needed but harmless), `?id=000042` → same song; unknown → 404.
4. **Regression:** guest add still pending, duplicate check still by video id/search key, admin login/delete, cleanup 401/authorized, rate limit 429.
5. **Cleanup:** delete the test rows afterwards.

---

## 8. Rollout order

1. Run the updated migration in the Supabase SQL editor.
2. Run the one-time backfill (if Option A).
3. Deploy the frontend (push to `main`).
4. Smoke test the leading-zero case (`000042`-style) on the live site with the headless script.
5. Regenerate/print the songbook — **all codes are new**.
6. Tell guests the old printed numbers/links are obsolete.

No backend redeploy is required except for the `karaoke-cache.js` six-digit
fallback fix above — deploy `karaoke-backend` too.

---

## 9. Risks & rollback

| Risk | Mitigation |
|---|---|
| Leading-zero display bug somewhere | Central `formatSongNumber()` + explicit `000042` test on every page before reprint. |
| Collision during random pick | Exists-check under advisory lock; unique index as final safety net; retry loop. |
| Reused code after a song is deleted | Accepted (matches real machines); optional registry out of scope. |
| Reprint invalidates old codes | Unavoidable; only reprint once this lands. |
| Rollback | Revert the frontend commit; DB can keep random codes (they are valid 6-digit numbers). Restoring the sequence is possible but pointless unless returning to sequential. |

---

## 10. Decisions

| # | Decision | Status |
|---|---|---|
| 1 | Range `000000–999999`, zero-padded display | ✅ requested |
| 2 | Random per insert via DB trigger + advisory lock | 📋 proposed |
| 3 | Randomize the 175 existing songs too, or only new ones? | ✅ all 175 randomized (backfill file) |
| 4 | Allow a deleted code to be reused later | 📋 proposed: yes (simple) |
