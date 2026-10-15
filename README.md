# 🎤Randel Karaoke Player - Next-Gen Karaoke Experience

A premium, modern web-based Karaoke player designed with a sleek **Glassmorphism** aesthetic and an **Apple-style Dynamic Island** interface. Built for a seamless "Karaoke Box" experience directly in your browser.

![Version](https://img.shields.io/badge/version-2.9.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- **💎 Premium Glass UI:** Sophisticated glassmorphism design with blur effects, interactive shimmers, and smooth floating animations.
- **🏝️ Dynamic Island Header:** A smart, sticky header that reacts to playback states and displays "Now Playing" information.
- **🎙️ Hybrid Visualizer:** Real-time microphone audio visualization for singers, with an automatic "Simulation Mode" to keep the UI dynamic even when the mic is off.
- **💯 Performance Scoring System:** Evaluates vocal energy and pitch steadiness in real time. Steady singing is rewarded and erratic pitch loses ground, while breathing between phrases is not punished. Includes a live floating score badge and a final overlay showing your rank (Legendary, Rockstar, Pro, Amateur, Beginner).

### How the score is calculated
Every 50ms (the `TICK_MS` setting in `SCORING`) the app takes one sample of the microphone:

1. **Rest or voice?** Samples below the voice gate are ignored entirely — breathing between phrases cannot drag the score down.
2. **How loud?** Energy above the gate maps to a credit that saturates, so a hotter microphone or a louder singer cannot simply buy a better score.
3. **Is a note trackable?** A detectable pitch earns a bonus; untrackable noise is penalised.
4. **How steady?** Frame-to-frame pitch movement is tracked in *cents* with a smoothed moving average, so an expressive melody and natural vibrato are not punished while an untrackable pitch still loses ground.

Those points feed a **rolling meter**, not a cumulative average: the displayed score follows how the singer is doing *right now*, rising as the phrases land and drifting down more slowly. Simply singing audibly earns a solid score, so volume, a trackable pitch and steadiness are bonuses rather than gates. The **final score is the peak the singer actually held**, so a quiet outro or a soft last line cannot erase a strong performance.

Typical results: soft singing ≈ 77, ordinary singing ≈ 84, loud and steady ≈ 90+. All thresholds live in the `SCORING` block of `CONFIG` in `app.js` and can be retuned without touching the scoring logic.

Pitch is detected by autocorrelation over the vocal range only (60–1200Hz), with a half-period correction so smooth voices are not reported an octave too high. The microphone is captured with browser auto-gain disabled, so the level stays under the singer's control instead of being pumped up and down between phrases.

- **🎉 Custom Score Sounds:** Plays celebration or feedback sounds (`scoreSound.mp3`) when a song ends.
- **📋 Smart Queue System:** Add and manage songs with a beautiful "Up Next" card interface. The queue seamlessly auto-plays the next song the moment your score sound finishes.
- **🔍 Robust Search:** Integrated YouTube search through the backend proxy, with a Supabase-backed cache in front of it and a relevance filter that rejects off-target results.
- **📱 Phone Remote:** Pair via QR code or the printed Player ID to queue songs from a phone (`remote.html`) or the Android app.
- **📈 SEO & Accessibility Optimized:** Valid `title`/description/canonical/robots meta, inline `WebSite` + `WebApplication` JSON-LD, Open Graph and Twitter cards, a `sitemap.xml` declared in `robots.txt`, a custom `404.html`, and visible on-page copy (no hidden keyword text). `remote.html`, `songbook.html` and `manage.html` are `noindex` app surfaces and stay out of the sitemap.
- **⌨️ Power-User Shortcuts:** 
  - `Z` - Play/Pause
  - `C` - Restart
  - `B` - Skip to the next queued song
  - `M` - Toggle Microphone
  - `Q` - Show/Hide the QR code
  - `F` - Fullscreen

  Song search lives on the phone remote, so the player itself no longer has
  `Enter` / `Shift + Enter` shortcuts.

## 🚀 Getting Started

### Prerequisites
YouTube search runs through the backend proxy at `https://karaoke-backend-topaz.vercel.app/api/youtube-search`. No key is needed in this repo:
1. Set the `YOUTUBE_API_KEY` environment variable in the backend (Vercel Dashboard -> Settings -> Environment Variables) for Production and Preview.
2. Create the key in the **Google Cloud Console** (YouTube Data API v3) and restrict it to that API only.

### Installation
The project is built entirely with frontend technologies.
1. Download or clone this repository.
2. Ensure you have the core files (`index.html`, `style.css`, `app.js`, `soundEffects/scoreSound.mp3`).
3. Run the project using a local development server (e.g., VS Code Live Server or Python HTTP Server).
4. Open the local address in any modern web browser and start singing!

## 🛠️ Tech Stack
- **HTML5:** Semantic structure and accessibility-first markup.
- **CSS3:** Custom variables, Glassmorphism, hardware-accelerated animations, and responsive layout.
- **Vanilla JavaScript:** Core logic, YouTube IFrame API integration, Web Audio API, and modular event handling.
- **Web Audio API:** `AnalyserNode` for real-time energy metering and autocorrelation-based pitch detection.

## 🔐 Security & Protection
The YouTube API key is never exposed to the browser — it lives only in the backend's Vercel environment variables. The Supabase anon key in `app.js` is a public key by design; access is governed by Row Level Security.

### Backend requirements (not enforced client-side)
These are **required** in the `karaoke-backend-topaz` Vercel project and cannot be fixed from this repo:

1. **`POST /api/karaoke-cache` must validate its payload.** The endpoint is reachable with no auth, so without server-side checks any visitor can remap a cached song query to an arbitrary `videoId` for every user. Validate the `videoId` against `/^[A-Za-z0-9_-]{11}$/`, cap the query length, and rate-limit by IP. (`app.js` performs the same checks as hygiene, but a client-side check is trivially bypassed and is **not** a security control.)
2. **Review RLS on `remote_commands` and `online_players`.** Any client holding the anon key can insert command rows addressed to a specific `player_id`, so the policies should be reviewed to confirm only intended writes are permitted.
3. `remote_commands.status` is expected to be `pending` → `ack` | `failed`. The player tolerates a `processing` value for atomic command claiming, but only if the column's `CHECK` constraint allows it.

### Songbook admin is not authenticated

`manage.html` (with `admin.js`) is a full write console for
`karaoke_search_cache` and ships with no login. The anon key is public by
design, so unless Row Level Security blocks it, anyone who opens the URL can
add, edit or delete songs — and the console only works at all if RLS *allows*
anon writes. `noindex` keeps search engines out, not people. The fix belongs in
Supabase, not in this repo:

1. Enable Supabase Auth and create an admin account.
2. Rewrite the `karaoke_search_cache` write policies to require an
   authenticated user. Reads stay public: the player, remote and songbook only
   ever `SELECT`.
3. Add a login step to `manage.html`, or move the console to a private
   deployment.

### Optional: now-playing status for the remote

Add this column once in the Supabase SQL editor and the phone remote can tell
whether "Play Now" starts immediately or is queued behind the current song:

```sql
alter table public.online_players add column if not exists now_playing text;
```

The player includes the current song in its heartbeat and the remote reads it
next to `last_seen`. Until the column exists the remote shows a neutral
"Accepted" confirmation for play commands instead, and everything else —
presence, discovery, commands — works exactly the same either way.

### Known limitation: duplicated tabs
The Player ID is persisted in `window.name`, so duplicating a player tab produces a second tab with the **same** Player ID. Both tabs will then poll and act on the same remote commands. Open a single player tab per Player ID. (`window.name` is also origin-scoped and reset on cross-origin navigation; `sessionStorage` would be a cleaner store if a behavior change is ever wanted.)

## 📜 License
This project is open-source and available under the [MIT License](LICENSE).

---
*Created with ❤️ by Randel*
