# Index HTML Re-design — Implementation Plan

**Target file:** `index.html`
**Supporting:** `style.css`, `app.js`

---

# ROUND 2 — Requested changes (not yet implemented)

Recorded verbatim from the request. **These supersede parts of the Round 1 plan below** — see §0.2 for the conflicts. Nothing here has been implemented yet.

## 0.1 The requirements

### Controls
1. Remove the volume control.
2. Place the control buttons at the **bottom center of the player**, sized small so they are not annoying.
3. Add a button to show/hide the QR code.

### Queue section
Use this layout:

```
UP NEXT 0 | Number, Number, so on
Next | Song Title
```

### QR code
Make it small, but not too small — perfect for scanning.

## 0.2 Conflicts with Round 1 (needs a call)

| Round 1 says | Round 2 says | Status |
|---|---|---|
| Search lives in the control bar | — | **Already resolved differently.** Search was removed from the player entirely (it lives on `remote.html`). Control-bar real estate is now free. |
| `.player-control-bar` is a bar **below** the video | Buttons go **inside** the player, bottom-center | **Conflict.** The bar becomes an overlay. §0.3. |
| QR is **always visible**, bottom-left of the stage | Needs a **show/hide button** | **Conflict.** Default state is undecided — see §0.4. |
| `.pcb-left` holds the volume slider | Volume removed | `.pcb-left` becomes empty and should be deleted. |
| `Open SongBook` + player-ID badge sit in the bar | Not mentioned | **Open question** — do they stay below the video, or join the in-player overlay? |

## 0.3 Notes / risks

- **Volume removal is a real functional loss — confirmed, not assumed.** Checked before writing this:
  - `app.js:192` sets `player.setVolume(100)` once on ready, so the karaoke track simply stays at 100%.
  - `app.js:1348` exposes `window.changeVolume`, used *only* by `#volumeSlider`'s `oninput` in `index.html`. Deleting both is safe — nothing else calls it.
  - **`remote.html` has no player-volume control** (its only `.volume` is a sound-effect clip at `remote.html:1503`). So after this change the player volume is **fixed at 100% and unreachable from any screen**.
  - Decide whether that is acceptable, or whether volume should move to `remote.html` instead of simply disappearing.
- **In-player controls + fullscreen.** `toggleFullscreen` fullscreens `.video-container`, so the buttons ride along automatically. Good — but the overlay must not overlap the YouTube player's own control bar, which appears on hover near the bottom of the iframe. The overlay needs bottom padding clear of it.
- **Bottom-center sits over lyric territory.** Lyrics are very often lower-center. The queue overlay (top-left) and the control strip (bottom-center) are in different quadrants, so they do not collide with each other, but the control strip may cover lyrics. Needs testing on real tracks.
- **Small buttons vs. touch targets.** "Small so it is not annoying" conflicts with the ≥40px touch target already established for phones. Recommend small *visually*, but keep an invisible enlarged hit area via padding/pseudo-element.

## 0.4b Round 3 — full-screen stage (implemented)

Three further changes, applied after the Round 2 work:

| Request | Implementation |
|---|---|
| Controls at **bottom center** | Already positioned there; now anchored to the full-screen stage instead of the page flow. |
| Dynamic island at **top center** | Moved **inside** `.video-container` as an absolutely-positioned overlay, centered via `left:50% + translateX(-50%)`. |
| **Make the player full screen** | `.video-container` is now `position: fixed; inset: 0; height: 100dvh`, with `aspect-ratio: auto` and no border-radius. The page no longer scrolls — the stage *is* the app. |
| **Remove the fullscreen button** | Button and the `F` shortcut deleted. `toggleFullscreen()` is kept in `app.js` in case an external/native wrapper calls `window.toggleFullscreen`, but nothing on the page uses it. |

### Consequences worth knowing

- **Layout wrappers are pass-through.** `.main-layout` / `.left-panel` now just `display: block`. They exist only to preserve the DOM shape and remain the fullscreen target.
- **The island uses `z-index: 120`** — deliberately above the score overlay (`100`), so the now-playing title stays readable on the results screen, matching the old behaviour where the island was never covered. `pointer-events: none` so it never swallows a click.
- **Landscape media query was rewritten.** The old block fought the fixed stage (`height: auto !important`, flex row, etc.); it now only tightens the overlays and the score screen.
- **Android body padding neutralised.** `.android-app body { padding-top: 44px }` cannot offset a `position: fixed` stage, so it is set to `0`; the overlays use `env(safe-area-inset-*)` instead.
- **`--yt-clear` still matters.** The controls keep 44px of bottom clearance so YouTube's own hover control bar does not sit on top of them.

---

## 0.4a Volume on remote.html — REQUIRES a database migration

Volume moved off the player screen and onto `remote.html` (a guest/host controls it from the phone). The player still inits at 100% (`app.js` `setVolume(this.state.volume)`), but the slider itself now lives on the remote.

**This does not work until you run this SQL** — `remote_commands.action` has a CHECK constraint that only allows `'play'` and `'reserve'` (see `md/QRCODE-PLAYER-ID.md:228`), and there is no column to carry a volume value. Without the migration, the insert fails and the remote shows "Could not reach the player".

```sql
-- Run in Supabase Dashboard -> SQL Editor
alter table public.remote_commands
  drop constraint if exists remote_commands_action_check;

alter table public.remote_commands
  add column if not exists volume int;

alter table public.remote_commands
  add constraint remote_commands_action_check
  check (action in ('play', 'reserve', 'volume'));
```

- Safe to re-run (`if not exists` + `drop constraint if exists`).
- If your constraint has a different auto-generated name, run `\d public.remote_commands` and drop that exact name instead.
- RLS already allows anon read/write on this table, so no policy change is needed.

**Behaviour once live:**
- Remote inserts `{ action: 'volume', volume: N, status: 'pending' }`.
- Player's command poller routes it to `handleVolumeCommand()` → `setVolume()`, then flips the row to `ack`.
- Volume persists across song changes (the YouTube player instance is reused) but **resets to 100 on a page reload** — `state.volume` starts at 100. If you want it remembered across reloads, it should be persisted in `localStorage` like the QR visibility.

---

## 0.4 Open question before implementing

1. **QR default state** — hidden on load (cleaner video, one tap to show) or visible (a guest can scan immediately)?
2. **Should the QR toggle also be a keyboard shortcut?** If yes, which key is free? `Z C B F M` are taken.
3. **SongBook button + player-ID badge** — keep them below the video, or move them into the new in-player control strip?

## 0.5 Queue layout — already matches, no work needed

Checked against the built markup (`index.html:102-108`):

| Requested | Current | Status |
|---|---|---|
| `UP NEXT 0` | `Up Next` + `#queueCountBadge` on one row | Already correct |
| `Number, Number, …` | `#queueList` horizontal chip strip | Already correct |
| `Next \| Song Title` | `#queueNextTitle` on the line under the chips | Already correct |

The only open detail is cosmetic: the separator glyph between the count and the first chip in the requested sketch. Say the word and it is done, or leave the current gap.

---

# ROUND 1 — Implementation plan (superseded in part by Round 2)

**Target file:** `index.html` (205 lines)
**Supporting:** `style.css` (1822 lines), `app.js` (1683 lines)

`Re-design Index HTML.md` was **empty (0 bytes)** when this plan was authored. The plan is built from the 5 requirements in the request plus the current source. Section 12 records what was inferred vs. confirmed.

---

## 1. Current state

| Area | Today | Gap |
|---|---|---|
| Layout (`style.css:269-300`) | `.main-layout` flex row → `.left-panel` (flex 6) + `.right-panel` (flex 4, `max-width:380px`, sticky) | Right panel holds **4** sections, not 3 — Search is in there too (`index.html:156-170`) |
| Queue (`index.html:173-178`) | Vertical `<li>` list, 60px rows, thumbnail + title + `Pos: N • Ready to sing` + remove ✕ | Vertical, in the sidebar, nowhere near the video |
| Next-song title | Only inside the queue `<li>` as `song-title` | No dedicated, glanceable "now playing next" line |
| QR (`index.html:195-199`) | `#sidebarQrCode`, **160×160** canvas (`app.js:1339`) | In the sidebar; 160px is small for scanning across a room |
| Shortcuts (`index.html:181-192`) | Separate `.shortcuts-legend` card, 7 rows in a 2-col grid | Pure documentation sitting apart from the buttons it describes |
| Search (`index.html:156-170`) | `.search-section` in the right panel | Travels with the panel being removed |
| Player ID (`index.html:149`) | `P-XXXXXX` badge, click-to-copy (`app.js:1370`) | Lives in `.pcb-right`, gets no new home by default |

### Already available — reuse, do not rebuild

- **Queue rendering** — `updateQueueUI()` (`app.js:700-754`) already builds safe DOM (no `innerHTML` interpolation of song titles). Rewriting the *markup* is enough; do not touch the title/thumb/remove-button construction.
- **Queue state** — `state.songQueue[]` of `{id, title, thumbnail}`; `removeFromQueue(index)` (`app.js:757`) already wired.
- **QR generation** — `initSidebarQR()` (`app.js:1333`) only needs a new container + width.
- **Shortcut labels** — one `SHORTCUT_LABELS` map drives both the button badges and the keyboard map, so they can never drift again.
- **Player ID** — `getPlayerShortId()` (`app.js:1365`) + `copyPlayerId()` (`app.js:1379`) are already complete.

### Confirmed bugs this redesign fixes

1. **`B` does not cancel.** `handleGlobalKeyDown` maps `'b'` → `playNextInQueue()` (`app.js:1616`), and `window.cancelCurrentSong` is *aliased to the same function* (`app.js:1670`). The button labeled `⏹️ Cancel` and the legend entry `B → Cancel` both advance the queue instead.
2. **`.right-panel` sticky + `top:100px`** (`style.css:297-298`) is overridden to `static` below 1023px (`style.css:392-394`) — the two-column layout silently collapses to a stack with no intermediate state.
3. **`.queue-container` is declared twice** — `padding:24px` at `style.css:933` then `max-height:150px` at `style.css:850`. The 150px cap is why the queue is permanently scrollable regardless of content.

---

## 2. Decisions (locked)

1. **Search stays in the control bar** below the player, as one row: input + mode toggle + Play Now / Reserve. Element IDs are preserved so no JS search code changes.
2. **`B` = Skip, relabeled honestly.** Behavior is unchanged (`playNextInQueue`); button text, legend and `aria-label` all say Skip.
3. **Queue overlay is always visible** (glass, top-left of the video) — no auto-fade, no collapse toggle.
4. **Queue renders as a horizontal strip of numbered chips**, with the next song's title on the line underneath.
5. **Shortcuts live on the buttons** as `<kbd>` badges; the `.shortcuts-legend` card is deleted, not hidden.
6. **Overlays sit above the score overlay's threshold but below the alert.** Score overlay is `z-index:100` (`style.css:1179`), so queue/QR take `z-index:10`, keeping the score screen uncontaminated.
7. **QR size is fixed at 200×200** with a quiet zone — see §5 for the reasoning.

---

## 3. Phase 1 — Remove the right panel, relocate Search

### Markup
- Delete `.right-panel` and all four of its sections from `index.html:154-200`.
- Move the search markup (unchanged IDs) into `.player-control-bar` as a **second row**:
  ```
  .player-control-bar
    ├─ .pcb-left     (volume)
    ├─ .pcb-center   (play/restart/skip/full/mic)
    ├─ .pcb-right    (player ID badge, Songbook)
    └─ .pcb-search   ← moved verbatim from .search-section
       ```
- Wrap search in `<form class="pcb-search" role="search">` so Enter submits naturally — but keep `onsubmit="return false"` since `handleGlobalKeyDown` already routes Enter (`app.js:1603-1611`) and double-handling would fire the search twice.

### JS
- **No changes.** `cacheElements()` (`app.js:151`) keeps resolving `sidebarSearchInput` / `sidebarPlayBtn` / `sidebarReserveBtn` / `sidebarToggleSearchBtn` — the IDs move, the lookups don't.
- Rename nothing. The `sidebar*` prefix becomes a misnomer, but renaming touches ~20 call sites for zero user-visible gain. Leave it; note it in code with a short comment.

### CSS
- `.right-panel` block (`style.css:290-300`) → delete.
- `.main-layout` (`style.css:269`) becomes a plain single-column centered stack; `max-width` moves onto `.left-panel` so the video keeps a sane cap on ultrawide monitors.
- `.pcb-search` gets `display:flex; gap:10px; align-items:center` and `flex-basis:100%` so it wraps to its own line inside the bar.
- Drop the `min-width:1000px` / `1024-1399px` / `1400px` split (`style.css:302-390`) in favor of §7's breakpoints — that ladder exists only to balance two columns.

---

## 4. Phase 2 — Queue as a horizontal overlay, top-left

### Markup
New element inside `.video-container`, **before** `#scoreOverlay` in DOM order so stacking is predictable:

```html
<div id="queueOverlay" class="stage-overlay stage-overlay--tl glass-panel">
    <div class="queue-strip" id="queueList" role="list" aria-label="Song queue"></div>
    <div class="queue-next">
        <span class="queue-next-label">Next</span>
        <span class="queue-next-title" id="queueNextTitle">Queue is empty</span>
    </div>
</div>
```

- `#queueList` changes tag from `<ul>` to `<div>` — the horizontal chip strip has no list semantics left. `role="list"` + `role="listitem"` on each chip preserves the a11y tree.
- **Drop `#queueList`'s old children contract**: `updateQueueUI()` no longer emits `<li>`, thumbnails, or `.next-tag`.

### JS — `updateQueueUI()` (`app.js:700-754`)
Rewrite the body; keep the `songQueue` source and the empty-state string. Per song:

| Element | Class | Content |
|---|---|---|
| chip | `.queue-chip` | `<span class="queue-chip-num">` + the song's **songbook number** or index+1 |
| remove | `.queue-chip-x` | `✕`, `aria-label="Remove {title} from queue"` |

- **Numbering decision:** use `song.queueNumber` when present (remote/songbook reservations carry `song_code`), else fall back to `index + 1`. A queue entry that arrived by number search must not display a misleading positional number.
- `#queueNextTitle` = `state.songQueue[0].title` or `"Queue is empty"`.
- `.queue-chip-num` for index 0 gets `.is-next` (accent ring) to match the `Next` label beneath.
- **Thumbnails are dropped.** At ~34px tall chips a YouTube thumbnail is an unreadable smudge; the number carries the meaning. This also removes the only remaining `thumbnail` read in the UI.

### CSS
- `.stage-overlay` — `position:absolute; z-index:10; pointer-events:auto; max-width:` capped so it can't run into the score overlay.
- `.queue-strip` — `display:flex; gap:6px; overflow-x:auto; scrollbar-width:thin;` chips are `flex:0 0 auto`.
- **Remove** `.queue-list li` (`style.css:957`), `.song-thumb` (`style.css:977`), `.song-info`, `.song-title`, `.song-meta`, `.next-tag`, `.queue-remove-btn` (`style.css:1024`) — all dead after this phase. `.empty-queue-state` (`style.css:1077`) is restyled for the strip.
- Delete the duplicate `.queue-container` declarations (`style.css:933-946` and `850-853`).

### Overlay vs. lyric collision
The queue sits over the **top-left** of a 15:8 frame. Karaoke lyrics are usually centre or lower-centre, so top-left is the safest quadrant — but on some tracks, burned-in title/lyric headers live there. Mitigation: `opacity:.92` with a blur backdrop, and at ≤600px the overlay shrinks rather than hides (§7).

---

## 5. Phase 3 — QR in the bottom-left

### Markup
```html
<div id="qrOverlay" class="stage-overlay stage-overlay--bl glass-panel">
    <div class="qr-label">Scan to control</div>
    <div id="qrStage"></div>
</div>
```

### JS
- `initSidebarQR()` (`app.js:1333-1342`): retarget `sidebarQrCode` → `qrStage`, **width/height 160 → 200**.
- `cacheElements()` (`app.js:152`): update the id list entry.

### Sizing rationale — "normal, not too big, not too small"
- **200px canvas + 12px white padding = 224px rendered.** A phone camera needs roughly ≥ 150px of QR across to lock on reliably at a 2–4 m viewing distance; 160px was marginally under, which is likely why it feels fiddly.
- 200 stays well clear of stealing attention from the video while remaining scannable.
- Keep the white plate — the library renders dark modules on a transparent canvas, and a dark theme behind them destroys contrast and scan reliability.
- **Add `imageSmoothing: none` / `renderedImageSmoothing: false`** so the QR is not bilinearly rescaled into an unscannable blur at non-integer ratios. This is the single most common cause of "the QR won't scan" complaints.
- `width:200,height:200` also needs `CORRECT_LEVEL: QRCode.CorrectLevel.M` — default `L` is fine at this size but `M` survives a photographed/screen-reflected QR, which is the realistic venue case.

---

## 6. Phase 4 — Shortcuts inside their buttons

### Markup
Each control button gains a `<kbd class="keycap">`. Example for Skip:

```html
<button onclick="cancelCurrentSong()" class="skip-btn" aria-label="Skip to next song (B)">
    <span class="icon" aria-hidden="true">⏭️</span> Skip <kbd class="keycap">B</kbd>
</button>
```

| Button | Icon | Label | Keycap | Action |
|---|---|---|---|---|
| Play/Pause | `▶️`/`⏸️` | Play / Pause | `Z` | `togglePlayPause` |
| Restart | `🔄` | Restart | `C` | `restartVideo` |
| **Skip** | `⏭️` | **Skip** | `B` | `playNextInQueue` |
| Full | `⛶` | Full | `F` | `toggleFullscreen` |
| Mic | `🎙️` | Mic: On/Off | `M` | `toggleVisualizer` |

- **Delete** the `.shortcuts-legend` card (`index.html:181-192`) and its CSS (`.shortcuts-legend`, `.shortcut-grid`, `.shortcut-item`, `.key` at `style.css:1065-1122`), plus the `.android-app .shortcuts-legend` hide rule at `style.css:1072-1074`.
- Drop the `↵`/`⇧+↵` entries from the legend — they document the *search field's* behavior and belong as `title`/`aria-keyshortcuts` on the search input instead.

### JS — one source of truth
Replace the inline map at `app.js:1613-1619` with a declared constant near `CONFIG`:

```js
const SHORTCUT_LABELS = {
  z: 'Play/Pause', c: 'Restart', b: 'Skip', f: 'Full', m: 'Mic'
};
```
`handleGlobalKeyDown` builds its `map` from it, and (Phase 6) the keycap `<kbd>` labels are rendered from the same object at startup. A badge can then never claim a key the handler doesn't listen for — the exact drift that produced the `B = Cancel` bug.

- Add `aria-keyshortcuts="b"` etc. to each button so screen readers announce the shortcut natively.
- Rename the `cancel-btn` class → `skip-btn`, and the `cancelCurrentSong` window alias keeps its name purely so the existing `onclick` works — but it is documented as a misnomer. (Renaming the global means editing `index.html` inline handlers too; acceptable, do it if the buttons are being rewritten anyway in Phase 6.)

---

## 7. Phase 5 — Responsive & UX pass

The two-column ladder dies with the right panel, so this is a rewrite, not an adjustment. Target widths: 1920, 1440, 1280, 1024, 900, 768, 600, 430, 390, 360, 320 — plus landscape phone.

1. **Control bar wraps by priority.** `.pcb-center` (transport) never wraps; `.pcb-left` and `.pcb-right` drop to a second line below ~900px; search always takes its own full-width line. Add `flex-wrap: wrap` + `row-gap`.
2. **Overlay scaling is `clamp()`-driven, not breakpoint-driven.** Both overlays size off `--queue-chip` and `--qr-size` custom properties set once in `:root` and clamped down per breakpoint — so the queue strip shrinks smoothly instead of jumping between two hardcoded layouts.
3. **Portrait phones** — `.video-container` keeps `aspect-ratio:15/8` (currently forced to `auto` at `style.css:1483` in landscape); overlays reduce to icon-sized chips with the next-title clamped to 1 line, so they never cover more than ~20% of the frame.
4. **Landscape phone** (`max-height:600px and orientation:landscape`, already at `style.css:1459`) — overlays must not exceed 25% of viewport height; the QR is the first thing to shrink, the queue strip second.
5. **`100dvh` / `100svh`** — the header + bar + video stack currently risks a cut-off control bar on iOS Safari when the URL bar collapses. Add the `dvh`→`svh` fallback pair.
6. **Safe areas** — add `env(safe-area-inset-*)` to the overlay offsets so a notched phone never clips the queue chips or the QR plate.
7. **Touch targets** — `.queue-chip-x` and every `.keycap` hit area ≥ 40px via padding, even though the visual chip is ~34px.
8. **`prefers-reduced-motion`** — the `.dynamic-island` float animation (`style.css:177-180`) runs forever and sits directly above the new overlays. Respect the media query or drop the float.
9. **`focus-visible`** — add an explicit ring; the existing CSS removes outlines.
10. **Scroll lock** — `overscroll-behavior: contain` on `.queue-strip` so a horizontal swipe through a long queue doesn't scroll the page.
11. **`touch-action: manipulation`** on the strip's chips to kill the 300ms double-tap delay during a live event.

---

## 8. Phase 6 — Polish

Grouped by impact; P1 first.

**P1 — Close the shortcut drift at the source.** Render keycaps from `SHORTCUT_LABELS` (§6) and assert the map and the badges read the same object. Also fix `window.cancelCurrentSong` (`app.js:1670`) to point at an honestly-named `skipToNext()` while keeping the old alias for safety.

**P2 — Queue interaction.** Chip hover lifts the strip's `overflow-x` into view; clicking a chip's ✕ gives a 150ms removal animation before the list reflows, so items don't teleport. Guard `removeFromQueue` against removing the song that is currently playing.

**P3 — Queue count badge.** `Up Next · 3` in the overlay's label row. On a phone-sized frame the strip shows ~4 chips and silently truncating to 4 is the kind of thing a host notices mid-event.

**P4 — Next-song announcement.** When the queue changes, briefly flash `.queue-next` (`animation: nextFlash 600ms`) so a reservation from the phone is visible without hunting for it.

**P5 — QR resilience.** `imageSmoothing: none`, `CorrectLevel.M` (§5). Also re-generate the QR on `playerId` change rather than only at init.

**P6 — Button hierarchy.** Six `.keycap`-bearing buttons plus three search buttons is a wall of same-weight controls. One accent element per region: Play/Pause and Play Now stay accent; Skip/Mic/Full/Reserve go glass. Give `.skip-btn` a distinct warning tint so the one destructive-ish control is findable.

**P7 — Motion budget.** Add `--transition-fast: 160ms cubic-bezier(.4,0,.2,1)` and use it for every interactive state. The existing `--transition-smooth` is ~0.4s and animates `all`, which animates layout properties and is visibly laggy on tap.

**P8 — Empty & error states.** Queue empty state should read as an affordance (`Scan or search to add songs`), not as `(Queue is Empty)` in parentheses.

**P9 — `dynamic-island` collision.** It's centered at the top of the page while the queue is top-left *inside* the video. On short viewports they can visually crowd. Verify at ≤600px and, if needed, drop the island's title to a single-line ellipsis when a queue is non-empty.

**P10 — Typography.** `font-variant-numeric: tabular-nums` on queue chips so numbers don't jitter as the queue grows.

---

## 9. Files touched

| File | Change |
|---|---|
| `index.html` | Phases 1-4, 6 (205 lines → ~120; the right panel is 47 lines of it) |
| `style.css` | Phases 1-4, 5, 6. **Net deletion expected** — ~200 lines of sidebar/queue/shortcut CSS leaves |
| `app.js` | `cacheElements` (`app.js:152`), `updateQueueUI` (`app.js:700`), `initSidebarQR` (`app.js:1333`), `handleGlobalKeyDown` (`app.js:1590`), global aliases (`app.js:1664-1683`) |
| `sw.js` | **No change.** `CORE_ASSETS` (`sw.js:2-20`) covers `remote.html` only; `index.html` is not precached and the fetch handler is remote-scoped. Out of scope unless offline player support is wanted. |

---

## 10. Verification

No test runner or `package.json` in this repo — verification is manual.

```bash
npx serve .          # or: python -m http.server 8000
```

1. Right panel is gone; nothing overlaps or reflows oddly at 1920 and 1280.
2. Search still works end-to-end from the control bar: title search, number search, mode toggle, Play Now, Reserve, and the `Done ✓`/`Reserved ✓` feedback labels all behave exactly as before.
3. Queue overlay is top-left of the video, chips run horizontally, next title shows underneath and updates on every reserve.
4. Reserve from `remote.html` on a phone → the chip appears in the player overlay within the poll interval, and the next-title line flashes.
5. Remove a queued song via its ✕ → chip disappears, remaining chips reflow, `removeFromQueue` still correct.
6. Keyboard: `Z` `C` `B` `F` `M` each do what the keycap on the matching button says. **`B` advances the queue and the button says Skip** — the mismatch is gone.
7. Every button's `<kbd>` badge matches a key the handler actually listens for.
8. QR scans from ~2m and ~4m with a normal phone camera, in both light and dark rooms. Zoom the image — modules must have hard edges, not a blur.
9. Score overlay opens → **no queue chips or QR bleeding through**. Mic on/off, song end, and idle background video all leave the overlays clean.
10. Widths 1024 / 768 / 430 / 360 / 320: no horizontal page scroll, control bar wraps sensibly, overlays never cover more than ~25% of the video frame.
11. iPhone Safari: scrolling past the URL-bar collapse does not clip the control bar.

Polish (Phase 6): 12. queue count badge present; 13. queue empty state reads as an affordance; 14. exactly one accent element per region; 15. every tap responds within ~160ms; 16. `prefers-reduced-motion` stops the island float; 17. chip numbers use tabular figures.

---

## 11. Risks

- **Overlay over lyrics** (§4) — the real unknown. Test against several actual karaoke tracks, not just one. The top-left quadrant is conventional for lyric-free real estate but burned-in header lyrics exist.
- **`#queueList` tag change** — `<ul>`→`<div>` is fine, but any *other* file querying `#queueList li` will silently break. Verified: only `app.js:701` touches it.
- **Shortcuts-legend deletion** — if the `.android-app` native wrapper has its own copy or an in-app help screen, it needs updating separately. Only the CSS hide rule was found in this repo.
- **Removing the sidebar** frees horizontal space, but the header's `dynamic-island` and the control bar now carry everything. Watch for a lopsided bar on ultrawide — hence the `.left-panel` max-width in §3.
- **Shortcuts were the only on-screen documentation** for a host-facing app. Moving them onto buttons is the requested design, but if the audience includes non-technical operators, consider keeping a `?` popover rather than restoring the card.