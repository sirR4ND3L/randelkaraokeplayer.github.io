# Supabase setup (run once)

These steps are manual because they need dashboard/service access. Everything
else is handled by the code in this repo and in `karaoke-backend`.

## 1. Run the migration

1. Open the Supabase dashboard for project `blbwxnbbdsqkxbuvcrtn`.
2. **SQL Editor → New query**.
3. Paste the whole of [`migrations/2026-10-19_song_numbers_admin_cleanup.sql`](migrations/2026-10-19_song_numbers_admin_cleanup.sql) and **Run**.
4. Run the VERIFY queries at the bottom of the file. Expect
   `total_songs = numbered_songs` and codes between `0` and `999999`.
5. Optional one-time step: paste and run
   [`migrations/2026-10-19b_randomize_existing_songs.sql`](migrations/2026-10-19b_randomize_existing_songs.sql)
   if the book still holds sequential codes (`100000`, `100001`, …) and you
   want every existing song randomized too. It reshuffles every code, so run
   it once, while nobody is adding songs, then regenerate the printed songbook.

What it does:

- adds `karaoke_search_cache.song_number` (unique, six slots `000000`–`999999`,
  assigned randomly by the `karaoke_random_song_number` trigger for every
  future insert — all insert paths covered, no retries in application code),
- adds `karaoke_search_cache.source`,
- creates `admin_users` + `is_admin()` and replaces the legacy anon write
  policies with admin-only write policies (reads stay public),
- resyncs the internal `id` primary-key sequence when it lags behind the
  table (explicit seed ids otherwise make new inserts fail with
  `duplicate key value violates unique constraint "karaoke_search_cache_pkey"`),
- adds cleanup indexes, `remote_commands.created_at`, and the
  `cleanup_presence_and_commands()` function used by manage.html.

The migration is re-runnable (guarded statements; existing codes are never
reshuffled by a re-run).

## 2. Create the admin account

1. **Authentication → Providers → Email**: enable Email, **disable public sign-up**.
2. **Authentication → Users → Add user**: create the admin email + password
   (auto-confirm). Copy the new user's **UID**.
3. In the SQL Editor, register that UID:

```sql
insert into public.admin_users (user_id)
values ('PASTE-USER-UID-HERE')
on conflict (user_id) do nothing;
```

Repeat for any additional admin. Only UIDs in `admin_users` pass `is_admin()`.

## 3. Legacy policies

The migration drops the policies named in `plan/SECURITY-UPDATE.md`. If you
ever created differently named policies by hand, open
**Authentication → Policies** and delete every anon write policy on
`karaoke_search_cache` that is not one of:

- `songbook_read_all` (select, anon + authenticated)
- `songbook_admin_insert` / `songbook_admin_update` / `songbook_admin_delete` (authenticated)

`online_players` and `remote_commands` keep their existing anon policies — the
player heartbeat and phone remote depend on them. Cleanup of those tables is
server-side only.

## 4. Verify RLS from the browser console (optional)

While signed out on `manage.html`:

```js
// must affect 0 rows (blocked)
await supabaseClient.from('karaoke_search_cache').update({ is_verified: false }).eq('id', 1).select('id');
```

While signed in as an admin it must affect 1 row.
