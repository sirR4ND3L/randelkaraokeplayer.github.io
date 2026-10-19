# Implementation Summary & Deployment Checklist

**Feature set:** 6-digit song numbers, managed search cache, real admin roles, scheduled cleanup
**Implemented:** 2026-10-19
**Plan:** [`SONG-NUMBER-ADMIN-UPGRADE.md`](SONG-NUMBER-ADMIN-UPGRADE.md)
**Revision (2026-10-19b):** song numbers are now **random** `000000–999999`
(zero-padded). The migration file was updated in place; if you already ran the
sequential version, re-run it, then run the one-time backfill
`supabase/migrations/2026-10-19b_randomize_existing_songs.sql`. Code and the
backend `?number=` fix are pushed and tested (31/31); the two SQL files still
need to be run in Supabase.
See [`RANDOM-SONG-NUMBERS-PLAN.md`](RANDOM-SONG-NUMBERS-PLAN.md).
**Status:** Code complete and smoke-tested locally. The account-level steps below still have to be done in Supabase / Vercel.

---

## 1. What was implemented

| Area | Result |
|---|---|
| Song numbers | `karaoke_search_cache.song_number` — unique random code in six slots (`000000`–`999999`), assigned by the `karaoke_random_song_number` trigger for every new song. |
| Search key | Player, remote, songbook, deep links and remote commands now use the 6-digit number. Internal `id` stays as the database CRUD key. |
| manage.html | Songbook/YouTube search modes, cache-first → YouTube → save-to-Supabase pipeline, result cards with preview, editable title/artist, duplicate detection. |
| Manual add | No number field — the database generates it. Reports the new number after saving. |
| Admin access | Supabase Auth login, `admin_users` allow-list, public/admin modes, admin-only edit/verify/delete/cleanup. |
| Public access | Guests can search and add songs. Entries are saved as **pending review** (`is_verified = false`) unless `PUBLIC_AUTO_VERIFY=true`. |
| RLS | Reads stay public; writes are admin-only. Guest submissions go through the validated, rate-limited backend `/api/public-songs`. |
| Cleanup | `/api/cleanup` daily Vercel cron deletes `online_players` stale > 2 days and `remote_commands` older than 2 days. Admin "Clean up now" button calls `cleanup_presence_and_commands()`. |
| Bonus fix | `remote.html`'s relevance filter was rejecting valid YouTube results; replaced in both `remote.html` and `admin.js`. |

### Files added

| File | Purpose |
|---|---|
| `supabase/migrations/2026-10-19_song_numbers_admin_cleanup.sql` | Schema, random-number trigger, admin registry, RLS, cleanup indexes/function. |
| `supabase/migrations/2026-10-19b_randomize_existing_songs.sql` | One-time backfill: randomizes the codes of songs that still hold sequential numbers. |
| `supabase/README.md` | Migration + admin-user walkthrough. |
| `karaoke-backend/pages/api/public-songs.js` | Guest submissions (validation + rate limit). |
| `karaoke-backend/pages/api/cleanup.js` | Scheduled cleanup runner. |
| `karaoke-backend/vercel.json` | Daily cron `0 3 * * *`. |
| `karaoke-backend/lib/{db,validate,rate-limit}.js` | Shared backend helpers. |
| `plan/SONG-NUMBER-ADMIN-DEPLOYMENT-CHECKLIST.md` | This file. |

### Files changed

`manage.html`, `admin.js`, `app.js`, `remote.html`, `songbook.html`, `style.css`, `sw.js`, `index.html`, `README.md`,
`karaoke-backend/pages/api/karaoke-cache.js`.

---

## 2. Needs to do — account-level steps

Do these in order.

### ☐ Step 1 — Run the Supabase migration

1. Open the Supabase dashboard for project `blbwxnbbdsqkxbuvcrtn`.
2. **SQL Editor → New query**.
3. Paste the entire contents of
   `supabase/migrations/2026-10-19_song_numbers_admin_cleanup.sql`.
4. **Run** it, then run the VERIFY queries at the bottom of that file.
5. (One-time, already-numbered books) Paste and run
   `supabase/migrations/2026-10-19b_randomize_existing_songs.sql` to
   randomize every existing song. **Run it only once** — it reshuffles every
   code each time.

Expected:

- `total_songs = numbered_songs`
- every `song_number` is between `0` and `999999`
- (after the backfill) some codes start with `0` in the print preview
- four policies exist on `karaoke_search_cache`: `songbook_read_all`,
  `songbook_admin_insert`, `songbook_admin_update`, `songbook_admin_delete`

> Safe to re-run, and re-runs never reshuffle codes that are already assigned.
> Run while nobody is adding songs. If you ran this migration before the
> "internal id sequence resync" block was added, re-run the whole file (or just
> that `do $$ ... $$;` block) — inserts otherwise fail with a `karaoke_search_cache_pkey`
> duplicate-key error.

### ☐ Step 2 — Create the admin account

1. **Authentication → Providers → Email**: enable Email, **disable public sign-up**.
2. **Authentication → Users → Add user**: create the admin email + password, auto-confirm.
3. Copy the new user's **UID** and run in the SQL Editor:

```sql
insert into public.admin_users (user_id)
values ('PASTE-USER-UID-HERE')
on conflict (user_id) do nothing;
```

Repeat for additional admins. Only UIDs in this table pass `is_admin()`.

4. **Authentication → Policies**: remove any legacy anon write policy on
   `karaoke_search_cache` that is not one of the four created by the migration
   (names created by hand may differ from the ones the migration dropped).

### ☐ Step 3 — Deploy `karaoke-backend`

Deploy the backend folder to the existing `karaoke-backend-topaz` Vercel project
(`vercel --prod` or your usual deploy path). It must include:

- `pages/api/karaoke-cache.js` (number lookup + `songNumber` responses)
- `pages/api/public-songs.js`
- `pages/api/cleanup.js`
- `vercel.json`
- `lib/`

Then set these Vercel environment variables (Production + Preview):

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | already set | Supabase Postgres connection string |
| `YOUTUBE_API_KEY` | already set | Google Cloud key |
| `CRON_SECRET` | **new, required** | any long random string |
| `PUBLIC_AUTO_VERIFY` | optional | `true` to publish guest adds instantly; omit for pending review |

Check: **Vercel → Deployments → Cron Jobs** should list `/api/cleanup` daily at
03:00. You can also test it manually:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://karaoke-backend-topaz.vercel.app/api/cleanup
# expect: {"ok":true,"players":N,"commands":N}
```

### ☐ Step 4 — Deploy the frontend

Push the changed files to `main` so GitHub Pages publishes:

`manage.html`, `admin.js`, `app.js`, `remote.html`, `songbook.html`,
`style.css`, `sw.js`, `index.html`, `README.md`, `supabase/`, `plan/`.

The service worker cache name was bumped to `rk-remote-v4`, so phones pick up
the new remote on their next online visit.

### ☐ Step 5 — Smoke test in production

- [ ] `manage.html` loads as **Guest mode**; login inputs visible, no Delete/Re-edit buttons.
- [ ] Admin sign-in works; status shows the email; edit/verify/delete and Maintenance appear.
- [ ] Guest add (manual and YouTube result) saves and shows `#100XXX — pending review`.
- [ ] Signed-out `update`/`delete` via browser console affects **0 rows** (RLS working).
- [ ] Admin verifies the pending song; it then appears in `remote.html` and `songbook.html`.
- [ ] Number search on the remote finds a song by its 6-digit number.
- [ ] Old short number (internal id) no longer appears in lists; backend still resolves old `?id=` links where possible.
- [ ] `/api/cleanup` without the secret returns **401**.
- [ ] Admin **Clean up now** returns counts.
- [ ] Submit 21 songs in an hour from one IP → the 21st returns **429** (rate limit).

### ☐ Step 6 — Reprint the songbook

Existing printed numbers (internal ids like 35, 112, 255) are replaced by the
backfilled 6-digit numbers. Regenerate/print `songbook.html` after the
migration. Old printed copies and old `?code=` deep links will not match the
new numbers.

---

## 3. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| New songs fail with `500` and the log says `duplicate key value violates unique constraint "karaoke_search_cache_pkey"` | The internal `id` sequence lags behind the table (rows were seeded with explicit ids). Re-run the migration — its "internal id sequence resync" block runs `setval` to `max(id)`. |
| Login succeeds but page stays guest mode | `admin_users` table missing or the UID is not inserted (Step 2). The status line says "admin access is not set up yet". |
| Guest add fails with an RLS error | The backend is not deployed yet or `/api/public-songs` is unreachable. Deploy Step 3, or temporarily keep the old anon policies (not recommended). |
| `?number=100123` returns 404 | Migration not run, or no row has that number. Check the VERIFY queries. |
| Cleanup cron returns 401 | `CRON_SECRET` missing/mismatched in Vercel. The endpoint fails closed by design. |
| Cleanup returns 500 | `remote_commands.created_at`/`online_players.last_seen` missing — re-run the migration. |
| All YouTube searches say "No relevant results" | The old relevance filter bug (fixed in this deploy). Confirm the browser loaded the new `admin.js`/`remote.html` (hard refresh; SW cache is `rk-remote-v4`). |
| Song added twice | The old backend may not have the `songNumber` read-back yet; redeploy `karaoke-cache.js`. The unique `search_query` constraint still prevents exact duplicates. |

---

## 4. Rollback

- **Frontend:** `git revert` the deployment commit. The pages keep working
  before the migration because every read falls back to `id`.
- **Database:** do **not** drop `song_number` once songs reference it. To relax
  admin-only writes temporarily:

```sql
-- emergency only: restore anonymous writes
create policy "temp_anon_write" on public.karaoke_search_cache
  for all to anon using (true) with check (true);
```

  Remove that policy and re-run the migration section once the backend is deployed.
- **Cron:** delete `vercel.json`'s cron entry or remove `CRON_SECRET` (the
  endpoint then always returns 401).

---

## 5. Verified locally (already done)

- `node --check` on all changed JS and the inline scripts in `remote.html` / `songbook.html`.
- Headless Chrome against the live pre-migration database:
  - `manage.html`: 175 songs rendered via id fallback, public mode hides admin controls, number filter matches the right card.
  - YouTube search returns relevant results (6 for "perfect ed sheeran") and pre-fills title/artist.
  - `remote.html`: 175 songs rendered, 6-digit guards ("Enter all 6 digits"), pad hints working.
  - `songbook.html`: all rows rendered.
- CSS braces balanced; every HTML handler has a matching JS function; every static element id referenced by `admin.js` exists (custom alert ids are injected at runtime).
