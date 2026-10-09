# Security Update — API Key Hardening

**Date:** 2026-08-09
**Goal:** Remove all secrets from the browser-facing repo; move them behind the Vercel backend.

## 1. What's exposed today

| Item | Where | Verdict |
|---|---|---|
| YouTube API key `AIzaSyBthjxn...` | `app.js:11`, `remote.html:644` + git history | 🔴 REAL LEAK → rotate + move server-side |
| Supabase **anon** key + URL | `app.js:14-15`, `remote.html:641-642`, `songbook.html:625-626` | 🟢 Public by design (JWT `role:anon`) — RLS is the real protection |
| Vercel `CACHE_ENDPOINT` URL | `app.js:13`, `remote.html:643` | 🟢 Public URL — backend secrets must stay in Vercel env vars |
| `DATABASE_URL`, Service Role key | NOT in any repo (backend has no git) | ✅ Keep env-only, never commit |

## 2. Backend — `D:\FOR CODING\REAL\WEBSITE PROJECTS\karaoke-backend`

### 2a. NEW `pages/api/youtube-search.js`
```js
const API_URL = 'https://www.googleapis.com/youtube/v3/search';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { q, channelId } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter q is required' });

  const params = new URLSearchParams({
    part: 'snippet', maxResults: '5', q,
    type: 'video', videoEmbeddable: 'true', key: process.env.YOUTUBE_API_KEY
  });
  if (channelId) params.set('channelId', channelId);

  try {
    const r = await fetch(`${API_URL}?${params}`);
    const data = await r.json();
    if (data.error) return res.status(502).json({ error: 'YouTube API error' });
    return res.json({ items: (data.items || []).map(i => ({ id: i.id.videoId, title: i.snippet.title })) });
  } catch (e) {
    console.error('YouTube proxy error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
```

### 2b. `pages/api/karaoke-cache.js` — POST spam protection
Before the INSERT, add:
```js
if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
  return res.status(400).json({ error: 'Invalid videoId format' });
}
if (typeof videoTitle !== 'string' || videoTitle.length > 200) {
  return res.status(400).json({ error: 'Invalid videoTitle' });
}
```

### 2c. Add `.gitignore` (node_modules, .env*, .vercel) + `git init`

## 3. Frontend — this repo (`randelkaraokeplayer.github.io`)

| File | Change |
|---|---|
| `app.js:10-12` | Delete `YOUTUBE_API_KEY` from CONFIG |
| `app.js:327` `fetchFromYouTubeAPI` | Call `https://karaoke-backend-topaz.vercel.app/api/youtube-search?q=...&channelId=...` instead of Google directly; keep `isRelevant` + channel loop |
| `remote.html:644` | Delete `YOUTUBE_API_KEY` |
| `remote.html:1012` `fetchFromYouTubeAPI` | Same backend-call rewrite (keep `isRelevant` logic) |
| `songbook.html` | No change (anon key is public by design) |
| `README.md` | Update "add your key in app.js" instructions |

## 4. Account-level to-dos (manual)

- [ ] **Vercel Dashboard** -> add env var `YOUTUBE_API_KEY` (Production + Preview); confirm `DATABASE_URL`
- [ ] **Google Cloud Console** -> create NEW YouTube Data API v3 key; restrict to that API only
- [ ] **Supabase** -> confirm RLS enabled + policies for `online_players`, `remote_commands`, `karaoke_search_cache`

## 5. Notes

- Old YouTube key stays in git history -> rotation is mandatory
- Anon key is NOT a secret - removing it from the repo is cosmetic; RLS is the real defense
- POST `/api/karaoke-cache` was writable by any website (CORS `*`) - validation added