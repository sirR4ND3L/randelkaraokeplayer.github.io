# Remote HTML Re-design — Implementation Plan

**Target file:** `remote.html` (self-contained: inline `<style>` + inline `<script>`, no build step)
**Secondary:** `sw.js` (offline cache manifest)

`Remote HTML Re-design.md` was empty, so this plan is authored from the current `remote.html` source (1249 lines).

---

## 1. Current state

| Area | Today | Gap |
|---|---|---|
| Quick Search (`remote.html:577-589`) | Text input + `Play Now` / `Reserve` | Title-only. No number path, though the player already supports it (`app.js:1492` → `playSongByNumber`) |
| Songbook (`remote.html:592-598`) | Always-visible filter + virtual-less grid of every song | No collapse; `filterSongs()` (`remote.html:953`) reads `innerText` for every row on every keystroke — O(n) layout thrash |
| Number input | None | No keypad; `soundEffects/{0-9}.mp3` exist and are used only by `app.js:1193 playNumberSound` |
| Feedback states | `.success-state` / `.fail-state` styled at `remote.html:236-248` | **Dead CSS** — never applied by any JS. Confirmation arrives only via toast |
| Button styling | One global `button {}` rule at `remote.html:207` | Paints every button accent-blue; no hierarchy for the new toggles/pad keys |
| Responsive | 5 media queries at `remote.html:488-546` | No safe-area handling inside overlays, no landscape keypad layout, no `focus-visible` rings, no `aria-pressed` on toggles |

### Already available — reuse, do not rebuild
- **Digit SFX:** `soundEffects/zero.mp3` … `soundEffects/nine.mp3` (map copied from `app.js:20-29`)
- **Number lookup endpoint:** `CONFIG.CACHE_ENDPOINT?id=<code>` → `{ videoId, videoTitle }` (mirror of `app.js:414 fetchSongByCode`)
- **Songbook data already in memory:** `allSongsData[]` of `{ code, title, artist }`, where `code === String(karaoke_search_cache.id)` — the same key the player resolves
- **Command pipeline:** `sendCommand()` (`remote.html:1122`) already accepts `songCode`; player acks/fails → toast. No backend change needed.
- **Pattern precedent:** `toggleSearchMode()` in `app.js:1554` — `.active` class on the toggle button, label flips to the *other* mode. The remote will use the identical convention so both screens behave identically.

---

## 2. Decisions (locked)

1. **Quick Search mode toggle**, not two fields — a single segmented control in `.search-row`, mirroring `sidebarToggleSearchBtn`.
2. **Toggle label shows the mode you switch TO** (matches `app.js`).
3. **Songbook is collapsible and remembers state** in `localStorage`.
4. **Number pad is a real on-screen keypad** (`<button>` grid, `inputmode` hidden), not a styled `<input type=number>` — no OS keyboard, digit sounds fire on tap.
5. **Local pre-lookup is advisory only.** A number not in `allSongsData` still sends the command; the player stays the source of truth (its `CACHE_ENDPOINT?id=` may cover rows filtered out of the remote's `is_verified` query).
6. **All new state lives in a single `quickMode` variable** (`'text' | 'number'`); no new globals beyond a keypad/sound pool.

---

## 3. Phase 1 — Quick Search mode toggle

### Markup (`remote.html:577-589`)
```
.search-row
  ├─ .search-input-wrapper > input#quickSearchInput
  └─ button#quickModeToggle            ← new
     .search-actions  (Play Now | Reserve — unchanged)
p#quickHint                            ← dynamic copy per mode
```
- `#quickModeToggle` — text `Number Search` initially (label = target mode).
- `#quickSearchInput` — add `inputmode="numeric"` `pattern="[0-9]*"` toggled by JS; keep `type="text"` so the same element works in both modes.

### JS
- `let quickMode = 'text';`
- `toggleQuickMode()` — mirrors `app.js:1554`:
  - flips `quickMode`; toggles `.active` on the toggle button;
  - sets label to the opposite mode;
  - switches `inputmode` / `pattern` / `placeholder` (`"Search the title songs..."` ↔ `"Enter song number..."`);
  - clears `input.value` and the pad buffer; re-renders `#quickHint`.
- `sanitizeNumberInput(raw)` — strips non-digits, caps length at **6**, and (in number mode only) plays the digit sound per added digit.
- Refactor `quickText(playNow)` (`remote.html:1047`) into a dispatcher:
  ```
  quickText(playNow) → quickMode === 'number' ? quickNumber(playNow) : <existing body>
  ```
- New `quickNumber(playNow)`:
  1. read + validate code (empty → toast "Enter a song number");
  2. if `allSongsData` has the code, show `resolveTitle(code)` inline under the field (`▶ #123 — Title — Artist`) so the guest sees what is about to play;
  3. `sendCommand({ action: playNow ? 'play' : 'reserve', songCode: code, videoTitle: <resolved title or 'Code: '+code> })`;
  4. clear field + pad on ack (reuse the existing poll in `sendCommand`; simplest is to clear on send, matching text mode).
- `#quickHint` copy per mode:
  - text → `Not in the songbook? Search by title/artist for best results.`
  - number → `Tap the keypad to enter the songbook number.`
- Keyboard: `Enter` in the input → `quickText(true)` (already wired at `remote.html:1220`); add `Shift+Enter` → `quickText(false)` to mirror `app.js:1608`.

---

## 4. Phase 2 — Songbook toggle

- Wrap the card body (`#songFilter`, hint, `#songList`, `#songEmpty`) in `<div id="songbookBody">`.
- Card header becomes a flex row: `Songbook` label + a right-aligned `#songbookToggle` button (`Show` / `Hide`, `aria-expanded`, `aria-controls="songbookBody"`).
- `setSongbookOpen(open)`:
  - toggles `.hidden` on `#songbookBody` and syncs the label + `aria-expanded`;
  - persists to `localStorage['rk_remote_songbook']`;
  - on load, restores before `loadSongbook()` so a returning guest lands on the same view.
- Collapsed state shows a compact summary line (`1,240 songs`) instead of nothing.
- **Fix the filter while in here** — `filterSongs()` (`remote.html:953`) must stop reading `row.innerText` per keystroke:
  - store `_search` on each row object at render time (`(code + ' ' + title + ' ' + artist).toUpperCase()`);
  - render **only** matching rows into `#songList` from an in-memory filtered array, debounced ~80 ms (`requestAnimationFrame` is enough);
  - show `#songEmpty` with `"No songs match "…"` when the filter returns nothing (currently it is hard-wired to "songbook not loaded").
- Add a result count badge next to the label (`#songbookCount`).

---

## 5. Phase 3 — Custom number pad

### Markup
New glass card under Quick Search, `hidden` unless `quickMode === 'number'`:
```
#numberPad
  .pad-grid  (3 cols)
    button.pad-key[data-digit="1"] … "9", "clear", "0", "back"
  (back = ⌫, clear = C)
```
- 4×3 grid via `grid-template-columns: repeat(3, 1fr)`; keys `min-height: 56px` (touch target).
- Keys must be `<button type="button">` inside the form-less page — **no form**, so no submit-on-enter surprises.

### Sounds
```js
const NUMBER_SOUND_EFFECTS = {
  1:'soundEffects/one.mp3', … 0:'soundEffects/zero.mp3'
};   // copied verbatim from app.js:20-29
let padAudioPool = {};        // digit -> HTMLAudioElement
```
- `initPadAudio()` — on **first** pad open (which is a user gesture, so autoplay policy is satisfied), build one `Audio` per digit with `preload='auto'` and `volume = 0.3` (match `app.js:1204`).
- `playDigitSound(d)` — reuse the pooled element: `el.currentTime = 0; el.play().catch(()=>{})`. Pooling avoids a fresh network/decode hit per tap.
- **Backspace** → play `soundEffects/zero.mp3`? No — keep it silent (or reuse the same pool only for digits; decide: digits only, backspace silent). **Clear** → silent.
- Add a 🔊/🔇 toggle `#padSoundBtn` persisted in `localStorage['rk_remote_pad_sound']` (default **on**) — venues are loud.
- Rapid-tap guard: ignore a repeat of the same digit within 60 ms? Not needed — each tap is a distinct element.

### Behavior
- `pressPadKey(digit)` → append to `#quickSearchInput` (numeric mode), `playDigitSound`, Haptic `vibrate(8)`, live `#padPreview` lookup from `allSongsData`.
- `padBackspace()` / `padClear()`.
- Physical keyboard already works through the `keydown` listener — add the same `playDigitSound` there when `quickMode === 'number'`, mirroring `app.js:1578`.
- `Escape` closes the pad back to text mode? No — `Escape` stays bound to modal/scanner close (`remote.html:1224`). Do not hijack.

---

## 6. Phase 4 — Responsive / UX pass (all phones)

Breakpoints to cover: 320, 360, 390/393/412, 430, tablets ≥600, landscape ≤520 px height.

1. **Overlay safe areas** — `.song-modal-overlay`, `.scanner-overlay`, `.toast-container` currently pad with `clamp()` only. Add `env(safe-area-inset-*)` so the notch/home bar never clips the modal action row or the toast.
2. **Landscape keypad** — `@media (orientation: landscape) and (max-height: 520px)`: `.pad-grid` becomes `grid-template-columns: repeat(6, 1fr)`, i.e. **two rows of six** (1-9, C, 0, backspace) with keys at `min-height: 40px`. A single row of twelve would only give ~43 px per key against a `640px` max-width card — below the 44 px touch target. Also drop `.song-modal` to a two-column layout (text left / actions right) so it fits short viewports, and keep `.pad-head` visible (compacted) so the Sound toggle stays reachable.
3. **`100dvh` / `100svh` hardening** — the overlay max-heights use `100dvh`; add an `svh` variant so iOS Safari's collapsing chrome does not resize the modal mid-animation. Replace bare `100vh` occurrences in `body` min-height with the existing `dvh` fallback pair already present at `remote.html:77-78`.
4. **Height budget** — when the songbook is expanded the stack can exceed the viewport. Add `scroll-margin`/`scroll-padding` on the body and keep `overscroll-behavior-y: contain` on `.song-list` (already present).
5. **Accessibility** — `aria-pressed` on `#quickModeToggle` and `#songbookToggle`; `:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px }` (the current CSS removes outlines without a replacement on focus); `role="group"` + `aria-label` on `.pad-grid`; live-region copy for `#padPreview`.
6. **Tap ergonomics** — every new control gets `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent` to match the existing convention (`remote.html:114-116`).
7. **`prefers-reduced-motion`** — already handled globally at `remote.html:548`; new toggle/pad transitions are covered by it for free.
8. **Landscape/portrait toggle state** — the songbook toggle and mode are orthogonal; do not couple them.

---

## 7. Phase 5 — `sw.js`

`CORE_ASSETS` (`sw.js:2-9`) has no audio, so the keypad would be silent on first load while offline.

- Bump `CACHE_NAME` to `'rk-remote-v2'` (old cache is auto-deleted on activate by `sw.js:20-23`).
- Append `soundEffects/zero.mp3` … `nine.mp3` to `CORE_ASSETS` (~100 KB total).
- Pre-caching 10 files in one `cache.addAll` is fine; if it becomes flaky, switch those to a lazy `cache.add` inside the `fetch` handler — **do not** make `addAll` reject the whole install.

---

## 8. Phase 6 — Polish & micro-interaction pass

Applies across Phases 1-4. Grouped by impact; **P1 is the highest-value item in the whole plan.**

### 8.1 P1 — Wire the dead success/fail button states

`button.success-state` and `button.fail-state` are styled at `remote.html:236-248` but **no JS ever adds them** — today the only confirmation is a toast. The player already has this exact pattern in `app.js:1078 showSearchFeedback`.

Wire them into the ack/failed branches of the poll at `remote.html:1165-1173`:

| Poll result | Class | Label | Restore |
|---|---|---|---|
| `ack` + play | `.success-state` | `Done ✓` | 2000 ms → idle label |
| `ack` + reserve | `.success-state` | `Reserved ✓` | 2000 ms → idle label |
| `failed` | `.fail-state` | `Failed` | 2000 ms → idle label |
| 20 s timeout | `.fail-state` | `No reply` | 2000 ms → idle label |

- Capture the idle label once per button (`btn.dataset.idleLabel`) — `setQuickLoading` (`remote.html:1088`) already passes the original text around; store it instead of re-reading `innerText`.
- Clear any pending restore timer before applying a new state, so overlapping sends can't restore a stale label out of order (same guard as `app.js:1084`).
- Keep the toast as-is — the button state is confirmation *in place*, the toast is confirmation *after a delay*.

### 8.2 P2 — Button hierarchy (the global `button {}` rule)

`remote.html:207` paints **every** `<button>` accent-blue. Once the toggle, songbook toggle, 12 pad keys, torch and cancel exist, the screen becomes a wall of blue and `Play Now` stops standing out.

- Re-scope the accent gradient to `.btn-primary` (play now, confirm, scan QR).
- Add `.btn-glass` for toggles, pad keys, torch, cancel — transparent fill + `--glass-border`, matching `button.reserve` (`remote.html:228`).
- Rule of thumb: **exactly one accent-blue element per card.**

### 8.3 P3 — Motion

- `--transition: all 0.4s` (`remote.html:37`) is too slow for a keypad tap and animates layout properties. Add `--transition-fast: 160ms cubic-bezier(0.4,0,0.2,1)` and use it for all interactive states; keep 0.4s only for the songbook expand.
- Songbook collapse: animate `grid-template-rows: 0fr → 1fr` on a grid wrapper, not `max-height` (janky and needs a guessed pixel value).
- Modal exit: `closeSongModal()` (`remote.html:1104`) sets `display:none` instantly — no exit animation. Add a `.closing` class, hide on `animationend`.
- Toast exit: `remote.html:1199` calls `toast.remove()` hard. Add a slide-out before removal, cap the stack at 3 (drop oldest), and allow swipe-up to dismiss.

### 8.4 P4 — Loading & empty states

- **Skeleton shimmer rows** while `loadSongbook()` is in flight. Today `(No songs loaded)` (`remote.html:597`) is shown for the entire load, which reads as "this songbook is broken" on slow venues Wi-Fi.
- Three distinct states for `#songEmpty`: *loading* / *songbook empty* / *no match for filter*. Today it is hard-wired to the "not loaded" copy.
- Inline spinner on `Play Now` / `Reserve` instead of swapping text to `Searching...` (`remote.html:1089`) — swapping text changes button width and shifts the row.

### 8.5 P5 — Status & double-send

- Player pill: the dot pulses when online (`remote.html:130`) but "connecting" and "offline" look identical. Give the offline dot a dimmed style and put "Last seen Xs ago" in the pill's `title`.
- While any command is in flight, dim **both** action buttons. Today only the pressed one is disabled (`setQuickLoading`, `remote.html:1088`), so a guest can fire a second command while the first is still polling.

### 8.6 P6 — Keypad micro-interactions

- Key press: `scale(0.94)` + accent glow at `--transition-fast`.
- `font-variant-numeric: tabular-nums` on the search field — default proportional numerals visibly jitter as digits land on the keypad.
- **Long-press `⌫` (600 ms) → clear.** One extra timer, big usability win on a 4-6 digit code.
- Pad keys are glass (per 8.2), digits large and light-weight — the pad should read as an input device, not a row of primary buttons.

### 8.7 P7 — Typography

- `.song-row .meta .title` (`remote.html:327`) is single-line ellipsis. Switch to a 2-line `-webkit-line-clamp` so long titles are readable; keep the artist single-line.
- Audit emoji usage for consistency (📷 🔦 ▶ 📥 currently mix leading-glyph and inline usage).

### 8.8 P8 — Haptics tidy

Existing patterns: 20 ms scan, 10 ms send, 15 ms ack, `[30,40,30]` fail (`remote.html:834`, `1147`, `1167`, `1172`). Pad tap (8 ms) and toggle (6 ms) come from Phases 1-3. Collapse them into one `HAPTICS` const map so every pattern is tunable in one place and `vibrate()` stays a thin wrapper.

---

## 9. Files touched

| File | Change |
|---|---|
| `remote.html` | Phases 1-4 + 6 (markup + inline `<style>` + inline `<script>`) |
| `sw.js` | Phase 5 only |
| `app.js` / `index.html` / `style.css` | **No change.** `app.js:1554 toggleSearchMode` and `app.js:1078 showSearchFeedback` are the behavioral references only |

---

## 10. Verification

No test runner or `package.json` in this repo — verification is manual.

```bash
npx serve .          # or: python -m http.server 8000
```
Then on a real phone (or DevTools device mode at each width listed in §6.1):

1. Quick Search → tap `Number Search` → label flips to `Text Search`, `inputmode` becomes numeric, keypad appears, pad is hidden again in text mode.
2. Tap `1 2 3` → three digit sounds, `123` in the field, live preview resolves to `#123` when that song exists.
3. `Play Now` inserts a `remote_commands` row with `song_code` set; player acks → green toast. `Reserve` → queued.
4. Text mode regression: title search still hits cache → YouTube API → `video_id` command.
5. Songbook toggle: collapse/expand persists across reload; filter still matches title, artist **and** number; count badge updates.
6. Reload with DevTools **Offline** → remote shell loads from cache and keypad digit sounds still play.
7. 320 px width: no horizontal scroll; landscape: keypad on one row, modal fully visible.

Polish checks (Phase 6):

8. Send a command → the pressed button turns green `Done ✓` for 2 s, then restores its own label (not the wrong one after a rapid second send).
9. Force a `failed` ack (send an unlisted number) → button turns red `Failed`; offline player → `No reply`.
10. Scan the whole screen: `Play Now` is the only accent-blue element per card; toggles/pad/torch are glass.
11. All interactive transitions feel instant (≤160 ms); the songbook expand is the only slow one.
12. Throttle the network to Slow 3G → skeleton shimmer shows while the songbook loads, not "(No songs loaded)".
13. Both action buttons dim while a command is in flight — a second tap cannot fire a second command.
14. Long-press `⌫` clears the whole code; digits do not jitter while landing.

---

## 11. Risks / open questions

- **`is_verified` mismatch** (§2.5) — if the remote's songbook and `CACHE_ENDPOINT?id=` ever diverge, the live preview will show "not in songbook" for a playable number. Toast on player `failed` already covers it.
- **Code length** — max 6 digits is a guess; confirm the real range of `karaoke_search_cache.id` and tighten.
- **Autoplay policy** — digit sounds only unlock after the first keypad tap; nothing plays before that, by design.
- **Rate limits** — `sendCommand` polls every 2 s for up to 20 s. Rapid number tapping can stack overlapping polls; consider a single shared poller keyed by row id if this shows up in testing.
- **Idle-label restoration** (§8.1) — `setQuickLoading` captures `innerText` per call. Once labels are swapped at runtime (`Done ✓`), a later capture could persist a temporary label. Always restore from `dataset.idleLabel`, never from the live text.
- **Skeleton vs. real content flash** (§8.4) — if the songbook resolves from a warm Supabase cache in under ~150 ms the skeleton will flicker; only show it past a 300 ms delay.