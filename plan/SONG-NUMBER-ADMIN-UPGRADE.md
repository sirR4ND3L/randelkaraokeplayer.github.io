# Song Numbers, Managed Search Cache, Real Admin, and Scheduled Cleanup

**Date:** 2026-10-19
**Status:** ✅ Implemented 2026-10-19. Remaining manual steps: run the Supabase
migration (`supabase/README.md`), create the admin user, deploy `karaoke-backend`
with `CRON_SECRET`. See "Implementation notes" at the bottom, and the
step-by-step [`SONG-NUMBER-ADMIN-DEPLOYMENT-CHECKLIST.md`](SONG-NUMBER-ADMIN-DEPLOYMENT-CHECKLIST.md).
**Revision (2026-10-19b):** ⚠️ Feature A below (sequence-based 6-digit numbers
`100000`–`999999`) was **replaced** — numbers are now **random** across the full
`000000`–`999999` range, displayed zero-padded. See
[`RANDOM-SONG-NUMBERS-PLAN.md`](RANDOM-SONG-NUMBERS-PLAN.md) for the current
design. Everything else in this document still applies.
**Scope:** `randelkaraokeplayer.github.io` (frontend) + `karaoke-backend` (Vercel API) + Supabase schema/RLS
**Goal:** Give every song a unique auto-generated 6-digit number, make it the search key everywhere, turn `manage.html` into a search + cache console with real admin roles, and prune stale presence/command data automatically.

---

## 1. What the review found (current behavior)

| # | Today | File / line |
|---|---|---|
| 1 | The songbook "number" **is** `karaoke_search_cache.id` (an internal integer PK). Manual add computes `max(id) + 1`; remote, songbook, deep links and remote commands all carry `song.id`. | `admin.js:268-288`, `remote.html:1381-1394`, `songbook.html:660-704`, `app.js:326-368` |
| 2 | `manage.html` has **no login** and writes directly with the anon key. Per `plan/SECURITY-UPDATE.md`, anon INSERT/UPDATE/DELETE were granted. Anyone with the URL can edit/delete the songbook. | `admin.js:1-8`, `plan/SECURITY-UPDATE.md` (§4/§5) |
| 3 | `manage.html` has **no YouTube search and no cache flow**. Search only filters the table. The cache-first → YouTube → save-to-cache flow exists only in `remote.html` (`fetchFromCache`, `saveToCache`, `fetchFromYouTubeAPI` + `isRelevant`). | `admin.js:320-343`, `remote.html:1696-1768` |
| 4 | `online_players` rows are deleted only on `beforeunload`; a crashed/closed-killed tab leaves a stale row forever. `remote_commands` rows are **never** pruned (statuses `pending`/`ack`/`failed` accumulate). | `app.js:1187-1192`, `app.js:1270-1310` |
| 5 | Backend `GET /api/karaoke-cache` looks up by `?id=` or `?query=`; `POST` inserts with `ON CONFLICT (search_query) DO NOTHING` and returns no row data (so no song number can be returned). | `karaoke-backend/pages/api/karaoke-cache.js` |
| 6 | `remote.html` already caps the number pad at 6 digits (`MAX_CODE_LENGTH: 6`) — the UI is ready for 6-digit numbers; only the data source changes. | `remote.html:1008`, `remote.html:1560` |

**Conclusion:** the 6-digit number must be introduced at the database level (single source of truth), every consumer must switch from `id` to `song_number`, public writes must go through a validated server path, and cleanup belongs in a scheduled server job — not in browser code.

---

## 2. Feature A — Unique auto-generated 6-digit song number

### 2.1 Design

- New column `song_number integer`, **exactly 6 digits** (`100000`–`999999`).
- Number comes from a **Postgres sequence** (`karaoke_song_number_seq`), so it is unique by construction — no random collisions, no retry loops, safe under concurrent inserts.
- Uniqueness is enforced twice: sequence + `UNIQUE` index. The `CHECK` constraint guarantees the 6-digit format.
- The internal PK `id` **stays** for CRUD keys, RLS, realtime channels and admin UI element ids. Only the *user-facing song number* changes.
- Raw sequence values are consumed even when `ON CONFLICT (search_query) DO NOTHING` skips an insert, so gaps are normal and harmless (the current `max(id)+1` scheme also allowed gaps).
- Capacity: 900,000 songs. Above that the sequence stops and inserts fail loudly (`nextval` error) instead of silently breaking the format.
- Rationale for `100000`+ instead of `000000`+`: no leading zeros to lose in number pads, URLs, `Number()` casts, or spreadsheet exports. If leading zeros are ever wanted, the column would have to become `text` with `lpad`.

### 2.2 SQL migration (run once, in order, in the Supabase SQL editor)

```sql
-- 1. Add the column (nullable first, backfill next)
alter table public.karaoke_search_cache
  add column if not exists song_number integer;

-- 2. Backfill every existing song with a unique 6-digit number, in id order
with numbered as (
  select id,
         100000 + row_number() over (order by id) - 1 as candidate
  from public.karaoke_search_cache
  where song_number is null
)
update public.karaoke_search_cache c
set song_number = n.candidate
from numbered n
where c.id = n.id;

-- 3. Enforce uniqueness + 6-digit range
create unique index if not exists karaoke_search_cache_song_number_key
  on public.karaoke_search_cache (song_number);

alter table public.karaoke_search_cache
  add constraint karaoke_search_cache_song_number_range
  check (song_number between 100000 and 999999);

alter table public.karaoke_search_cache
  alter column song_number set not null;

-- 4. Generator for all future inserts (any path: admin, cache, public, backend)
create sequence if not exists public.karaoke_song_number_seq
  start with 100000
  maxvalue 999999;

-- Continue after the highest backfilled number (100000 if the table was empty)
select setval(
  'public.karaoke_song_number_seq',
  coalesce((select max(song_number) from public.karaoke_search_cache), 99999)
);

alter table public.karaoke_search_cache
  alter column song_number set default nextval('public.karaoke_song_number_seq');
alter sequence public.karaoke_song_number_seq
  owned by public.karaoke_search_cache.song_number;
```

> The `CHECK` constraint validates after the `DEFAULT` is applied, so any insert into any path gets a valid 6-digit number with zero client code.

### 2.3 Consumer changes

**`karaoke-backend/pages/api/karaoke-cache.js`**
- `GET ?number=100123` → `select ... where song_number = $1` (validate `^\d{6}$`).
- Keep `?id=` as a deprecated alias for one release, but it now resolves `song_number` (document the break for old links).
- All responses add `songNumber: row.song_number` so callers can display/confirm it.
- `POST` keeps `ON CONFLICT (search_query) DO NOTHING` and returns `{ success, songNumber, duplicate: boolean }` by re-selecting the row by `search_query` afterwards.

**`app.js`**
- `fetchSongByCode()` → call `?number=` instead of `?id=`.
- Error text stays the same, but examples in comments show 6 digits.
- `playSongByNumber()` unchanged (it is already code-agnostic); remote commands keep sending `song_code`, now holding the 6-digit number.

**`remote.html`**
- `loadSongbook()` selects `song_number, video_title`; map `code: String(song.song_number)`.
- `MAX_CODE_LENGTH: 6` stays. `updatePadPreview()` wording becomes "Enter the 6-digit song number"; a partial entry (≠ 6 digits) shows "Enter all 6 digits".
- `sendCommand({ songCode })` unchanged; `song_code` column must accept 6 chars (verify with the discovery query in §5.2).

**`songbook.html`**
- `loadSongbook()` selects `song_number, video_title`; render `song.song_number` and put it in `data-code` (deep link `?code=` then matches the new number end-to-end).

**`admin.js` / `manage.html`**
- `createSongCard()` shows `Number: <song_number>` and keeps using internal `id` for element ids and update/delete filters.
- Numeric search filter becomes `song_number.eq.<term>` (strip non-digits first).
- **Delete `getNextSongNumber()` / `refreshNextSongNumber()`** and the `#newSongNumber` input: the number is never typed again.
- Manual add inserts **without** `id` and **without** `song_number` (both come from the DB), then re-selects the row to report the generated number: `Added "X - Y" as song #100123.`

### 2.4 Optional follow-up (recommended, not blocking)

Split `video_title` into real `title` and `artist` columns, backfilled with `split_part(video_title, ' - ', 1)` / remainder. It makes searching "by song title **and** singer" exact, avoids repeated `split(' - ')` in 4 files, and gives public submissions a safe place to store the fields. Schedule as Phase 2 so this plan stays shippable in one pass.

---

## 3. Feature B — `manage.html`: song search + Supabase caching

### 3.1 UX

Add a **"Search & Cache"** panel above the song grid:

```
[ title / artist / YouTube link or ID ........ ] [ Search ]  [ Songbook | YouTube ]  (toggle)
```

- **Songbook mode** — queries `karaoke_search_cache` (title/artist/number) as today; shows the existing card grid.
- **YouTube mode** — runs the same pipeline the remote uses, then renders result cards:
  - thumbnail `https://img.youtube.com/vi/<id>/mqdefault.jpg`
  - title, channel, video id, "Already in songbook as #100123" badge when `video_id` exists
  - actions: **Preview** (reuses the existing embeds preview), **Save to cache**, **Add to Songbook** (admin-mode only), **Copy number**
- **Auto-cache on search** (checkbox, default on): when YouTube returns the matched result, save it to Supabase immediately so the player/remote can find it later — exactly mirroring `remote.html`.

### 3.2 Flow (cache-first, then YouTube, then save)

```
query → normalizeQuery()  (lowercase, strip quotes, append "karaoke", keep [a-z0-9])
      → fetchFromCache(cleanQuery)        // backend GET ?query=
          hit  → use it
          miss → fetchFromYouTubeAPI(query) // backend, preferred channels + isRelevant()
                  hit → saveToCache(...)    // backend POST → returns songNumber
                  miss → "Song not found"
```

### 3.3 Code changes in `admin.js`

- Copy the two helpers that currently live only in `remote.html` — `isRelevant()` and the preferred-channel search loop — or (better, small refactor) extract them into a shared `search-utils.js` loaded by `admin.js` and `remote.html`. Avoids a third divergent copy.
- New functions: `normalizeQuery()`, `fetchFromCache()`, `saveToCache()`, `searchYouTubeAndCache()`, `renderSearchResults()`, `addSearchResultToSongbook(result, { verified })`.
- `saveToCache` POSTs to `/api/karaoke-cache`; the backend answer now includes `songNumber`, which is displayed immediately ("Saved as #100234").
- Duplicate guards before insert: existing `video_id` and existing normalized `search_query` lookups (already present in `addSongManually()`; reuse the helpers).
- **Pagination:** `loadSongs()` currently selects everything. Add `.range(from, from + 199)` and "Load more", or a `count` header — with public submissions the table will grow.

### 3.4 Backend adjustments

- `karaoke-cache.js` `POST` returns `songNumber` + `duplicate` (see §2.3).
- Rate-limit `POST /api/karaoke-cache` (anonymous, already flagged in `SECURITY-UPDATE.md`): e.g. 30 requests/hour/IP, simple in-memory/Upstash counter.

---

## 4. Feature C — Real admin (login) + limited public access

### 4.1 Role model

| Capability | Public (not signed in) | Admin (signed in) |
|---|---|---|
| Browse / filter songbook | ✅ | ✅ |
| Search YouTube + auto-cache | ✅ | ✅ |
| Add song manually | ✅ **saved as pending review** | ✅ saved as verified |
| Add from YouTube result | ✅ pending | ✅ verified |
| Preview / copy number | ✅ | ✅ |
| Edit title / artist / video | ❌ | ✅ |
| Verify / re-edit / unverify | ❌ | ✅ |
| Delete | ❌ | ✅ |
| Regenerate a song number | ❌ | ✅ (with warning) |
| Run cleanup now | ❌ | ✅ |

"Pending review" = `is_verified = false`, `source = 'public'`. Pending rows are still found by **title search** (the backend cache GET does not filter on verification and the remote's quick text search uses it), so the guest who added a song can play it right away; it only stays out of the *printed/listed* songbook until an admin verifies it. If the owner would rather publish instantly, flip a single flag in the backend route (see §4.4) and accept the moderation risk.

### 4.2 Supabase Auth setup (manual, one-time)

1. Dashboard → Authentication → Providers → **Email** on; **disable public sign-up**.
2. Create the admin account(s) by hand (Users → Add user) with email + password.
3. Redirect URLs: add the GitHub Pages origin (`https://sirr4nd3l.github.io/randelkaraokeplayer.github.io/*`) for future magic links.

### 4.3 RLS + admin check

```sql
-- Admin registry (IDs copied from auth.users)
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

alter table public.karaoke_search_cache enable row level security;

-- Drop the old permissive policies (SECURITY-UPDATE.md granted anon DELETE/UPDATE/INSERT)
drop policy if exists "anon_delete_karaoke_search_cache" on public.karaoke_search_cache;
-- (+ any other anon write policies created in the dashboard)

-- Reads stay public: player, remote and songbook only SELECT
create policy "songbook_read_all"
  on public.karaoke_search_cache for select to anon, authenticated using (true);

-- Writes: admins only. There is deliberately NO anon INSERT policy:
-- public submissions go through the backend (validated + rate-limited).
create policy "songbook_admin_insert"
  on public.karaoke_search_cache for insert to authenticated
  with check (public.is_admin());
create policy "songbook_admin_update"
  on public.karaoke_search_cache for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "songbook_admin_delete"
  on public.karaoke_search_cache for delete to authenticated
  using (public.is_admin());
```

**Why no anon INSERT even though "public can add":** an RLS `WITH CHECK` on a public table is the wrong place to enforce moderation and rate limits — the client controls the payload, and a permissive check (`is_verified = false`) can still be spammed. Routing public writes through the backend means one place validates the video id/title, owns rate limiting, sets `source='public'` and `is_verified=false` itself, and uses `DATABASE_URL` (which bypasses RLS). This also keeps `app.js`'s heartbeat and `remote.html` command writes on their existing anon policies untouched.

**Add `source`:**

```sql
alter table public.karaoke_search_cache
  add column if not exists source text not null default 'admin';
alter table public.karaoke_search_cache
  add constraint karaoke_search_cache_source_check
  check (source in ('admin', 'public', 'auto', 'import'));
```

### 4.4 Backend: public submissions endpoint

New `karaoke-backend/pages/api/public-songs.js`:

- `POST { title, artist, videoId }` (manual) or `{ videoId, videoTitle, query }` (from YouTube result).
- Validates: video id `^[A-Za-z0-9_-]{11}$`, title/artist trimmed, 1–120 chars each, no control characters.
- Normalizes `search_query` with the exact same rule as `app.js`/`remote.html` (`buildSearchQuery`) so all three screens hit the same cache key.
- Checks duplicates (`video_id`, `search_query`): if found, responds `200 { duplicate: true, songNumber, isVerified }` instead of inserting.
- Insert uses `DATABASE_URL` pool (existing pattern) with `source='public'`, `is_verified=false` (or the env flag `PUBLIC_AUTO_VERIFY=true` to publish instantly), and returns the DB-generated `song_number`.
- Rate limit: 20 submissions/hour/IP (in-memory map is fine for one Vercel instance; Upstash/Postgres counter if needed). Return `429` with a friendly message.

Optional admin proxy: `/api/cleanup` and other privileged operations can reuse this route pattern with `Authorization` verified against the Supabase JWT, but for v1 the admin UI talks to Supabase directly with the signed-in session — that is what RLS is for.

### 4.5 `manage.html` / `admin.js` UI changes

- Header gains a **login panel**: email + password, "Sign in", "Sign out", "Signed in as …" chip.
- On load: `supabaseClient.auth.getSession()` → if no session, `public-mode`; else verify `admin_users` has the uid (`select 1 from admin_users where user_id = auth.uid()`) → `admin-mode`.
- Subscribe to `onAuthStateChange` to toggle modes live (also across tabs).
- Mark admin-only nodes with `data-admin-only` and toggle `body.classList` (`admin-mode` / `public-mode`); CSS hides edit/delete/verify/number-regenerate/cleanup controls when signed out.
- **Hiding buttons is UX only — RLS is the enforcement.** Verify by curl: an anon update must affect 0 rows.
- Public mode banner: "You can add songs. Sign in as admin to edit, verify or delete."
- Manual add form: remove `#newSongNumber` (auto number, §2.3); in public mode the submit calls `/api/public-songs`, in admin mode it inserts directly through Supabase with `is_verified: true`.
- Cards show a `pending` badge when `is_verified = false` and `source = 'public'`.
- Keep `escapeHtml()` on every rendered field; keep the `oEmbed` preview.
- `showAlert`/confirm helpers already exist and are reused for the login errors.

---

## 5. Feature D — Scheduled cleanup of `online_players` and `remote_commands`

> The request says "remote_command"; the real table is **`remote_commands`** (plural) — see `app.js:1274`.

### 5.1 Retention policy

| Table | Rule | Reason |
|---|---|---|
| `online_players` | `delete where last_seen < now() - interval '2 days'` | Stale tabs that never fired `beforeunload`; live players heartbeat every 10 s, so 2 days is far beyond stale. |
| `remote_commands` | `delete where created_at < now() - interval '2 days'` | Acked/failed rows are only useful for the remote's 20 s confirmation poll; pending rows that old belong to offline players and will never be claimed. |

Run **daily** (well within "every 1 to 2 days"); a row lives at most ~48 h plus one cron cycle.

### 5.2 First: confirm the schema

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('online_players', 'remote_commands')
order by table_name, ordinal_position;
```

Expected: `online_players(player_id, short_id, last_seen, now_playing)`, `remote_commands(id, player_id, action, song_code, video_id, video_title, volume, status, created_at)`.
If `remote_commands.created_at` is missing: `alter table public.remote_commands add column if not exists created_at timestamptz not null default now();` (old rows get "now"; the first cleanup then starts the clock).

### 5.3 Indexes (make the deletes cheap)

```sql
create index if not exists online_players_last_seen_idx
  on public.online_players (last_seen);

create index if not exists remote_commands_created_at_idx
  on public.remote_commands (created_at);

create index if not exists remote_commands_player_pending_idx
  on public.remote_commands (player_id) where status = 'pending';
```

### 5.4 Runner — Option A (recommended): Vercel Cron in `karaoke-backend`

The backend already has a pooled `pg` connection, and Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.

`karaoke-backend/vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cleanup", "schedule": "0 3 * * *" }
  ]
}
```

`karaoke-backend/pages/api/cleanup.js`:

```js
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const players = await pool.query(
      `delete from public.online_players where last_seen < now() - interval '2 days'`
    );
    const commands = await pool.query(
      `delete from public.remote_commands where created_at < now() - interval '2 days'`
    );
    console.log(`cleanup: players=${players.rowCount} commands=${commands.rowCount}`);
    return res.status(200).json({ ok: true, players: players.rowCount, commands: commands.rowCount });
  } catch (error) {
    console.error('cleanup failed:', error);
    return res.status(500).json({ error: 'Cleanup failed' });
  }
}
```

Notes:
- Set `CRON_SECRET` in Vercel → Settings → Environment Variables (Production + Preview).
- Vercel Hobby allows one cron run per day (within the hour) — this schedule fits.
- The endpoint is idempotent; also callable by hand (`curl -H "Authorization: Bearer $CRON_SECRET" .../api/cleanup`) for testing.

### 5.5 Runner — Option B: Supabase `pg_cron`

If you prefer the database to own the schedule (check Dashboard → Database → Extensions that `pg_cron` is available on your plan):

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'rk-cleanup-presence-and-commands',
  '0 3 * * *',            -- daily 03:00 (server time; use '0 3 */2 * *' for every 2 days)
  $$
    delete from public.online_players
     where last_seen < now() - interval '2 days';

    delete from public.remote_commands
     where created_at < now() - interval '2 days';
  $$
);
```

Inspect/remove: `select * from cron.job;` / `select cron.unschedule('rk-cleanup-presence-and-commands');`

### 5.6 Manual "Clean up now" (admin convenience, optional)

- `SECURITY DEFINER` function + button:

```sql
create or replace function public.cleanup_presence_and_commands()
returns table(players_deleted bigint, commands_deleted bigint)
language plpgsql security definer set search_path = public as $$
declare p bigint; c bigint;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.online_players where last_seen < now() - interval '2 days';
  get diagnostics p = row_count;
  delete from public.remote_commands where created_at < now() - interval '2 days';
  get diagnostics c = row_count;
  return query select p, c;
end $$;

revoke all on function public.cleanup_presence_and_commands() from public, anon;
grant execute on function public.cleanup_presence_and_commands() to authenticated;
```

- `admin.js` admin-mode button calls `supabaseClient.rpc('cleanup_presence_and_commands')` and reports the counts.
- Also add a **lightweight opportunistic pass** in admin mode: on first load each 24 h (`localStorage` stamp), call the same RPC. Never rely on this — the cron job is the guarantee.

### 5.7 Do not touch

- **`karaoke_search_cache` must never be pruned by this job** — it is the songbook.
- `app.js` keeps its 10 s heartbeat and `beforeunload` delete; the cron only catches what those miss.
- `remote_commands` in-flight rows are naturally safe: a pending command older than 2 days is unclaimable anyway.

---

## 6. Deployment order (important)

1. **DB migration** (§2.2, §4.3 tables/RLS, §5.3 indexes). `song_number` must exist before any client selects it.
2. **Backend**: deploy `karaoke-cache.js` changes, `public-songs.js`, `cleanup.js`, `vercel.json`; add `CRON_SECRET` (+ optional `PUBLIC_AUTO_VERIFY`).
3. **Frontend**: `app.js` + `remote.html` + `songbook.html` (read `song_number`), then `manage.html` + `admin.js` (number output, search/cache, auth).
4. **Supabase Auth**: create admin user, add its uid to `admin_users`, then flip RLS policies live (do this **after** §3 so the anon-era admin UI cannot lock itself out mid-deploy — order within steps is flexible, but test before and after).
5. **Cron**: confirm the first `/api/cleanup` run in the Vercel logs.
6. Update `README.md` (number scheme, admin login, public submissions, cleanup) and bump `sw.js` `CACHE_NAME` if the remote's number handling changes materially.

---

## 7. Test checklist / acceptance criteria

**6-digit numbers**
- [ ] Every pre-existing row has a unique `song_number` between 100000 and 999999 (count distinct = count rows).
- [ ] Two simultaneous inserts (public + admin) receive different numbers.
- [ ] Inserting with `song_number` omitted auto-generates; inserting a duplicate number fails on the unique index.
- [ ] App, remote, songbook and `?code=` deep link all resolve the same song by its new number.
- [ ] Old numeric `id` links no longer resolve (documented break; reprint/rescan songbook QR links).

**manage.html search + cache**
- [ ] Searching a title in Songbook mode filters the grid; YouTube mode returns relevant results only (`isRelevant` filters junk).
- [ ] "Save to cache" writes a row and shows its `songNumber`; a second search hits the cache (no YouTube call).
- [ ] Duplicate `video_id`/`search_query` is reported with the existing number instead of inserting.

**Admin / public**
- [ ] Signed out: add works (row `is_verified=false`, `source='public'`), edit/verify/delete controls hidden, cleanup button hidden.
- [ ] Signed in as admin: edit, verify, re-edit, delete, cleanup all work; `admin_users` check passes.
- [ ] Anon `update`/`delete` via REST affects 0 rows and is reported as an error by `admin.js` (the `.select()` guard already in place).
- [ ] Public submission over the rate limit gets `429` and a plain-language message.
- [ ] A pending public song is playable by title search on the remote, invisible in the listed songbook until verified.

**Cleanup**
- [ ] `/api/cleanup` without `CRON_SECRET` → 401.
- [ ] With the secret → deletes only rows older than 2 days; a freshly heartbeated player survives.
- [ ] Vercel cron shows a 200 run once per day.
- [ ] `karaoke_search_cache` untouched by cleanup.

---

## 8. Risks / open questions for the owner

1. **Existing printed songbooks** — backfilled numbers (100000, 100001, …) do not match printed `id`s. A reprint is required; that is unavoidable when the scheme changes.
2. **Public submissions visibility** — default is pending-review (safe). Flip `PUBLIC_AUTO_VERIFY=true` if instant publication is wanted; abuse then depends on the rate limit.
3. **Admin identity** — email/password is planned. Supabase magic links or Google OAuth are drop-in later; the `admin_users` gate does not change.
4. **Random vs sequential numbers** — the plan uses a sequence for guaranteed uniqueness. If random 6-digit numbers are preferred, the same `UNIQUE` index works but every insert needs a collision-retry loop (keep the sequence as a fallback; random is not recommended).
5. **`remote_commands.song_code` type** — must accept 6-character strings; confirm in §5.2 before deploying the remote change.
6. **Rate limiting** — in-memory counters reset on Vercel cold starts. Acceptable for v1; move to Upstash if abuse appears.

---

## 9. Estimated phases

| Phase | Work | Touch |
|---|---|---|
| 1 | DB migration + backfill + constraint | Supabase SQL |
| 2 | Backend number lookup + `/api/public-songs` | `karaoke-backend` |
| 3 | Number rollout | `app.js`, `remote.html`, `songbook.html` |
| 4 | manage search + cache + auth UI + mode gating | `manage.html`, `admin.js`, `style.css` |
| 5 | RLS + admin user + public endpoint wiring | Supabase + backend |
| 6 | Cron cleanup + manual button + README | backend, `admin.js`, `README.md` |
| 7 | Optional: `title`/`artist` columns, pagination, shared `search-utils.js` | all |

---

## 10. Implementation notes (2026-10-19)

### Files added
- `supabase/migrations/2026-10-19_song_numbers_admin_cleanup.sql` — the full,
  re-runnable schema + RLS + cleanup migration.
- `supabase/README.md` — migration and admin-user walkthrough.
- `karaoke-backend/pages/api/public-songs.js` — validated, rate-limited guest
  submissions (`is_verified = false` by default, `PUBLIC_AUTO_VERIFY=true` to
  publish instantly).
- `karaoke-backend/pages/api/cleanup.js` — daily cleanup runner.
- `karaoke-backend/vercel.json` — cron schedule `0 3 * * *`.
- `karaoke-backend/lib/{db,validate,rate-limit}.js` — shared helpers.

### Files changed
- `manage.html` — login panel, Songbook/YouTube search, result cards, manual
  add without a number field, maintenance panel.
- `admin.js` — auth + modes, search/cache pipeline, submitSong (admin direct /
  public backend), number display, cleanup, relevance filter fix.
- `app.js` — `fetchSongByCode()` resolves `?number=`, legacy `?id=` fallback.
- `remote.html` — songbook renders `song_number` (id fallback), 6-digit hints
  and guard, fixed relevance filter.
- `songbook.html` — renders `song_number` (id fallback).
- `karaoke-backend/pages/api/karaoke-cache.js` — number lookup, `songNumber`
  in responses, id fallback, rate limiting, row read-back.
- `style.css` — auth panel, mode toggle, result cards, badges, maintenance.
- `sw.js` — cache name bumped to `rk-remote-v4`.
- `index.html` — `app.js?v=10`.
- `README.md` — feature list, admin access, numbers, cleanup.

### Verified locally
- `node --check` on every changed JS file and both inline HTML scripts.
- Headless Chrome smoke test (pre-migration database):
  - manage.html renders 175 songs with `id` fallback, public mode hides admin
    controls, number filter finds the right card.
  - YouTube search returns relevant results (6 for "perfect ed sheeran") and
    pre-fills title/artist.
  - Remote songbook renders 175 songs, 6-digit guard shows
    "Enter all 6 digits", partial/full number hints work.
  - Songbook page renders all rows.

### Manual steps left (account-level, cannot be done from this repo)
1. Run the SQL migration in Supabase (section 2.2 / `supabase/README.md`).
2. Create the admin user and insert its UID into `admin_users`.
3. Deploy `karaoke-backend` (public-songs, cleanup, cache changes, vercel.json)
   and add `CRON_SECRET` (+ optional `PUBLIC_AUTO_VERIFY`) in Vercel.
4. Re-print / regenerate printed songbooks with the new 6-digit numbers.
