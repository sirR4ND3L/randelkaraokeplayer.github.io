# QR Code + Unique Player ID

This guide explains how the Randel Karaoke Player turns a **unique player instance ID** into a **QR code**, so any other device can scan it and address that specific player instance.

This is the foundation for the planned **Android remote control app**: the app will scan the QR, extract the player ID, and use it as the address to send remote commands (play, reserve, queue) to that exact player.

---

## 1. Overview

Every time `index.html` (the player) is opened, it gets a **unique ID** that lives for the lifetime of that tab:

| Concept | Value |
|---|---|
| Full player ID | `rk_player_<uuid>` (e.g. `rk_player_3f9a2c7e-...`) |
| Short display ID | `P-XXXXXX` (e.g. `P-3F9A2C`) |
| Where it lives | `window.name` (survives refresh, unique per tab) |
| QR payload | `https://sirr4nd3l.github.io/randelkaraokeplayer.github.io/remote.html?player=<playerId>` |

The QR code is simply a **scannable copy of the remote URL that carries the player ID** in the `player` query parameter.

```
Unique player ID  ──►  remote.html?player=<id>  ──►  QR code
```

---

## 2. Step 1 — Creating the unique player ID

**File:** `app.js` — `KaraokeApp.getPlayerId()` (line ~873)

```js
getPlayerId() {
    if (this.state.playerId) return this.state.playerId;
    const prefix = 'rk_player_';
    let id = window.name;
    if (!id || !id.startsWith(prefix)) {
        const rand = window.crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        id = prefix + rand;
        window.name = id;
    }
    this.state.playerId = id;
    return id;
},
```

Key behaviors:

- The ID is generated **once per tab** using `crypto.randomUUID()`.
- It is persisted in `window.name`, so **refreshing the page keeps the same ID**.
- Because `window.name` is per-tab, **duplicated player tabs always get different IDs** — no two players share an identity.
- `getPlayerShortId()` (`app.js` line ~887) returns the display form: `'P-' + id.slice(-6).toUpperCase()` → e.g. `P-3F9A2C`.
- For external use (e.g. the Android app), the full ID is exposed globally:

```js
window.getPlayerId = () => KaraokeApp.getPlayerId();
window.getPlayerShortId = () => KaraokeApp.getPlayerShortId();
```

### Player ID badge (index.html)

The short ID is shown in the player control bar so you can see each tab's identity and copy it:

```html
<!-- index.html (player control bar, .pcb-right) -->
<span id="playerIdBadge" class="player-id-badge">P-</span>
```

- `initPlayerBadge()` (`app.js` line ~892) sets the short ID text and the full ID as a tooltip.
- **Clicking the badge copies the full ID** to the clipboard (`copyPlayerId()`, line ~900) with a brief `Copied ✓` feedback.
- Styled by `.player-id-badge` in `style.css`.

---

## 3. Step 2 — Encoding the player ID into a QR code

**File:** `app.js` — `KaraokeApp.initSidebarQR()` (line ~855)

```js
initSidebarQR() {
    const container = this.elements.sidebarQrCode;
    if (!container || typeof QRCode === 'undefined') return;
    container.innerHTML = '';
    new QRCode(container, {
        text: "https://sirr4nd3l.github.io/randelkaraokeplayer.github.io/remote.html?player=" + encodeURIComponent(this.getPlayerId()),
        width: 160,
        height: 160
    });
},
```

### How it works

1. `index.html` includes the QR rendering library on the CDN:
   ```html
   <script src="https://cdn.rawgit.com/davidshimjs/qrcodejs/gh-pages/qrcode.min.js"></script>
   ```
2. The sidebar has an empty container:
   ```html
   <!-- index.html, QR Section -->
   <div class="sidebar-section qr-section glass-panel">
       <div class="qr-label">QR Remote</div>
       <div id="sidebarQrCode"></div>
       <p class="qr-caption">Scan to control with your phone</p>
   </div>
   ```
3. `initSidebarQR()` builds the target URL with this tab's unique ID and hands it to `new QRCode(...)`.

**Result:** the QR code encodes:

```
https://sirr4nd3l.github.io/randelkaraokeplayer.github.io/remote.html?player=rk_player_<uuid>
```

> Note: because the payload embeds the per-tab ID, **every player tab renders its own unique QR code** — even if you duplicate the tab.

The same ID is also passed by the **Open SongBook button** (the songbook is still used for printing):

```js
// app.js — KaraokeApp.openSongBook()
openSongBook() {
    window.open('songbook.html?player=' + encodeURIComponent(this.getPlayerId()), '_blank');
},
```

---

## 4. Step 3 — Reading the QR

Two consumers read the `player` query param today:

### 4a. `remote.html` (primary — phone browser remote)

**File:** `remote.html` — `getPlayerIdParam()`

```js
function getPlayerIdParam() {
    const param = new URLSearchParams(window.location.search).get('player');
    if (param) return param;
    if (window.opener && window.opener.name && window.opener.name.startsWith('rk_player_')) {
        return window.opener.name;
    }
    return null;
}
```

`remote.html` is the **installed-PWA phone remote**: it lists the verified songbook, offers quick search by text (cache → YouTube API) or number, and sends Play Now / Reserve commands to the paired player via Supabase Realtime (`remote_commands`). Because the command travels through the server, the phone can control the desktop player across devices.

The remote also:
- Shows the paired player's short ID (`P-XXXXXX`) with a live **online/offline dot** by polling `online_players` (REST, free tier).
- Tracks each command (`pending` → `ack`/`failed`) and gives toast + haptic feedback.
- Is installable (see `manifest.json` + `sw.js`) for an app-like experience.

### 4b. `songbook.html` — print/browse (BroadcastChannel, same-device only)

**File:** `songbook.html` — `getLinkedPlayerId()`

```js
function getLinkedPlayerId() {
    const param = new URLSearchParams(window.location.search).get('player');
    if (param) return param;
    if (window.opener && window.opener.name && window.opener.name.startsWith(PLAYER_ID_PREFIX)) {
        return window.opener.name;
    }
    return null;
}
```

When a songbook page opens from the QR URL (or the Open SongBook button), it knows **which player instance** it belongs to and sends Play Now / Reserve actions **only to that player's private channel**:

```js
const channel = new BroadcastChannel('karaoke-sb-' + targetPlayerId);
```

- The channel name includes the unique player ID, so **duplicate player tabs never receive or react** to the message — only the intended player does.
- If the target player does not acknowledge within ~500 ms (e.g. the QR was scanned on a **phone**, where `BroadcastChannel` cannot cross devices), the songbook falls back to opening a fresh player: `index.html?code=<songNumber>&play=<1|0>`.
- The songbook also assigns itself a unique ID (`window.name = 'rk_songbook_<uuid>'`) and includes it as `from` in every message.

### Flow diagram

```
Desktop (duplicated players A & B open)
  A's QR/button ──► songbook.html?player=A
                    └─► BroadcastChannel("karaoke-sb-A")  ──► Player A reacts ONLY
                    └─► Player B never sees the message

Phone (QR scanned on a different device)
  remote.html?player=A ──► insert row in remote_commands (player_id=A)
                          ──► Player A's poller picks up the pending row
                          ──► Player A plays/reserves and flips status to ack
```

---

## 5. Step 4 — Remote control (player-side implemented; phone remote live)

`BroadcastChannel` only works **between tabs of the same browser on the same device**. Phone → desktop control uses the **Supabase REST API with polling** — no paid Realtime add-on needed (`postgres_changes` is a paid feature; the free tier supports plain REST queries fine). This is already live via `remote.html` (the phone browser remote / PWA) and is the same contract the future Android app will use.

The QR code is the **pairing step** of that flow:

```
Phone browser, remote.html (or Android app)
  ──► scans QR  ──► extracts "player" value (remote.html?player=<id>)
  ──► stores the player ID as the target
  ──► inserts a command row for that player_id into remote_commands
        │
        ▼
  Player tab polls remote_commands every ~2.5s (REST)
        │
        ▼
  the player tab with matching window.getPlayerId() executes it
```

### Supabase schema (create in the Supabase dashboard — no Realtime setup needed)

```sql
-- Online players registry (heartbeat written by each player tab)
create table public.online_players (
  player_id text primary key,
  short_id   text,
  last_seen  timestamptz default now()
);

-- Command inbox: remote.html / the Android app inserts rows, the player updates status
create table public.remote_commands (
  id           uuid primary key default gen_random_uuid(),
  player_id    text not null,
  action       text not null check (action in ('play', 'reserve')),
  song_code    text,
  video_id     text,
  video_title  text,
  status       text not null default 'pending' check (status in ('pending', 'ack', 'failed')),
  created_at   timestamptz default now()
);

-- If the table already exists without the video columns (e.g. older setup), run:
alter table public.remote_commands
  add column if not exists song_code  text,
  add column if not exists video_id   text,
  add column if not exists video_title text;
```

> **Command routing rules (player-side, `startCommandPoller`):** a row carrying `video_id` is played directly via `handleFoundVideo` (used by the remote's text search for songs not in the songbook); a row carrying `song_code` is resolved through `playSongByNumber`. Either way existing safety rules apply — Play Now during an active song is queued, commands are ignored while the score is revealed.

> **No Realtime required.** The player polls `remote_commands` for `status='pending'` rows every ~2.5s and the remote polls its command row for the result — everything is plain REST, which works on the free Supabase tier. (Supabase `postgres_changes` / "Replication" is a paid add-on and is **not** used.)

### Step-by-step: setting it up in the Supabase dashboard

1. Open the Supabase dashboard for project `blbwxnbbdsqkxbuvcrtn` → **SQL Editor**.
2. Paste the two `create table` statements above into a new query and click **Run**.
3. **(Optional but recommended even for dev) Add permissive RLS policies** so the anon key can read/write both tables. Open **Authentication → Policies** (or run in the SQL Editor):

   ```sql
   alter table public.online_players enable row level security;
   alter table public.remote_commands enable row level security;

   create policy "anon can read online_players" on public.online_players
     for select using (true);
   create policy "anon can write online_players" on public.online_players
     for all using (true) with check (true);

   create policy "anon can read remote_commands" on public.remote_commands
     for select using (true);
   create policy "anon can write remote_commands" on public.remote_commands
     for all using (true) with check (true);
   ```

5. **Verify without Android:** with the player open, refresh `online_players` in the dashboard's **Table Editor** — you should see a row for this tab (player_id + short_id). Open `remote.html` on your phone, scan the player's QR (or paste the full ID), search a song and press **Play Now** — within ~2.5s it should play on the desktop player with `status` flipping to `ack`.

### Security note

- The Supabase **anon key is public by design** — it's embedded in the website and, later, the Android app. Treat all data as readable: never store private data in these tables.
- The scheme trusts any client to send commands; if you need auth, add user authentication later and tighten the RLS policies to `auth.uid()`.
- The heartbeat deletes its row via `beforeunload`, but closed tabs that crash will linger until a future cleanup job (the app can hide players whose `last_seen` is older than ~30s).

### Command contract

| Field | Values | Meaning |
|---|---|---|
| `player_id` | `rk_player_<uuid>` | The exact ID from the QR code |
| `action` | `play` \| `reserve` | Play Now or add to queue |
| `song_code` | songbook number, or null | Looked up via the existing backend (`playSongByNumber`) |
| `video_id` | YouTube video id, or null | Played directly (`handleFoundVideo`) — used for text-search results |
| `video_title` | string | Title to show on the player while queued |
| `status` | `pending` → `ack` \| `failed` | `ack` = executed, `failed` = not found/blocked |

### Player-side behavior (already implemented in `app.js`)

- `initRemoteControl()` — connects Supabase, starts the heartbeat, and starts the command poller.
- `startHeartbeat()` — upserts this player's `online_players` row every 10s (with `short_id` so the app can show "P-3F9A2C"), deletes it on tab close.
- `startCommandPoller()` — polls `remote_commands` every ~2.5s for `player_id=eq.<this tab's id>` rows with `status='pending'`, runs `playSongByNumber(song_code, action === 'play')` (or `handleFoundVideo(video_id, ...)` when the row carries a `video_id`), then marks the row `ack` (or `failed`). A `processing` guard prevents overlapping polls.
- Existing safety rules still apply: Play Now during an active song is queued; commands are ignored while the final score is revealed.

### Flow diagram

```
remote.html / Android app           Supabase                     Player tab (index.html)
   pairing ──► player_id
   insert (player_id, 'play', code_or_video)
                                    ◄── poller (every ~2.5s):
                                     "any pending rows for player_id=eq.<id>?"
                                    ──► playSongByNumber / handleFoundVideo
                                    ──► update row status='ack'
                                     ◄── remote polls its row → shows "✓ Playing now"
```

---

## 6. Step 5 — Building the Android app with Android Studio's AI

Android Studio's built-in AI (Gemini) can only read files that exist **inside the open Android project**. Do this to point it at this website's code:

1. **Create the Android project** — *New Project → Empty Views Activity*, name it e.g. `KaraokeRemote` (Kotlin + Material 3).
2. **Copy the website reference files into the project** so Gemini can index them:
   ```
   KaraokeRemote/
     reference/
       QRCODE-PLAYER-ID.md     ← the main spec the agent must follow
       app.js                  ← player-side implementation (contract examples)
       remote.html             ← phone remote reference implementation
       songbook.html           ← QR URL parsing example
   ```
3. **Open `reference/QRCODE-PLAYER-ID.md` in the editor** (keep it in context), then open the **Gemini panel** (right side).
4. **Paste this prompt** (adjust names as needed):

> Read `reference/QRCODE-PLAYER-ID.md` and `reference/app.js` first. Build a Kotlin + Material 3 Android remote-control app for the Randel Karaoke Player implementing this exact contract: (1) QR scan pairing using CameraX + ML Kit that parses the `player` query param from `remote.html?player=<id>`; (2) manual player-ID entry as an alternative; (3) an online-players list from the `online_players` Supabase table (show `short_id`, refresh on `last_seen`); (4) Play Now / Reserve buttons that insert rows into the `remote_commands` table for the paired `player_id` (`song_code` and/or `video_id`), then poll the row until `status` becomes `ack` or `failed`. Use the anon key with the Supabase URL in `app.js`'s CONFIG. Persist the paired player ID securely (Android Keystore / EncryptedSharedPreferences).

The agent will follow the file paths, so keep those reference files in the project until the feature is complete. If it suggests backend changes, they belong in the Vercel/Supabase side, not in `reference/`.

---

## 7. FAQ

**Does the player ID change when I refresh the page?**
No. It's stored in `window.name`, which survives refreshes within the same tab.

**Does duplicating a tab (or opening a second player) share the same ID?**
No. Each tab gets its own fresh `rk_player_<uuid>` — that's exactly why duplicate players can't cross-trigger each other.

**My badge shows `P-XXXXXX` — is that what I pair with?**
The Android app pairs with the **full ID**. Click the badge to copy the full `rk_player_<uuid>` value. The short form is only for human-friendly display (e.g. the online-players list).

**I scanned the QR on my phone and nothing played on the desktop.**
The QR now opens **`remote.html`**, which sends commands through Supabase REST (the player polls for them every ~2.5s) — so it *can* control the desktop player from the phone. If nothing plays, check: the `remote_commands` and `online_players` tables exist (see §5), the desktop player tab is open (online dot green) and has an internet connection, and the paired ID matches the player's badge. If you open the *songbook* (Open SongBook button) on your phone instead, that one still can't cross devices — it opens a fresh player on the phone.

**What if the Supabase tables don't exist yet?**
The player logs a console warning (`Heartbeat failed...`) and keeps working normally — playback, songbook, and scoring are unaffected. Create the tables whenever you're ready (see Step-by-step above).

**I see `Remote control unavailable` in the console.**
The supabase-js CDN script failed to load (e.g. offline). Everything else still works; remote control just stays dormant.

**Can I manually type the player ID instead of scanning?**
Yes — the badge has click-to-copy, and `remote.html` shows a pairing screen for pasting the full ID (no scanner needed).

**The song I sent from a remote device didn't interrupt the current song.**
By design: Play Now during an active performance is queued ("Up Next") instead of interrupting. The command still reports `ack`.

---

## 8. Code reference

| Concern | Location |
|---|---|
| Player ID creation | `app.js` — `getPlayerId()` (~line 873) |
| Short display ID | `app.js` — `getPlayerShortId()` (~line 887) |
| Badge setup | `app.js` — `initPlayerBadge()` (~line 892) |
| Copy full ID | `app.js` — `copyPlayerId()` (~line 900) |
| QR rendering | `app.js` — `initSidebarQR()` (~line 855) |
| Open SongBook with ID | `app.js` — `openSongBook()` (~line 866) |
| Private player channel listener | `app.js` — `initSongbookBridge()` (~line 919) |
| Remote control init (Supabase) | `app.js` — `initRemoteControl()` (~line 935) |
| Heartbeat watchdog | `app.js` — `startHeartbeat()` (~line 952) |
| Remote command poller | `app.js` — `startCommandPoller()` (~line 987) |
| Remote video_id command handler | `app.js` — `handleRemoteVideo()` (after `startCommandPoller`) |
| Global exposure | `app.js` bottom — `window.getPlayerId()` (~line 1164) |
| QR container | `index.html` — `<div id="sidebarQrCode">` (line ~187) |
| Player ID badge markup | `index.html` — `<span id="playerIdBadge">` (line ~139) |
| Badge styles | `style.css` — `.player-id-badge` |
| Remote page (phone browser/PWA) | `remote.html` |
| Remote PWA manifest | `manifest.json` |
| Remote service worker | `sw.js` |
| Remote → player command insert | `remote.html` — `sendCommand()` |
| Remote presence dot | `remote.html` — `watchPlayerStatus()` |
| QR → remote linkage | `remote.html` — `getPlayerIdParam()` |
| QR → songbook linkage | `songbook.html` — `getLinkedPlayerId()` |
| Songbook own ID | `songbook.html` — `getSongbookId()` |
| Targeted messaging + fallback | `songbook.html` — `songAction()` |
