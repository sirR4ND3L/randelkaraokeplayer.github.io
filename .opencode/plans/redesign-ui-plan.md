# UI Redesign Plan: Drawing Match

## Overview
Redesign the Randel Karaoke Player UI to match the user's drawing. Moves from a centered-search layout to a **desktop-optimized sidebar layout** with the player dominating the left side and a stacked sidebar on the right.

---

## Files to Modify

| File | Changes |
|------|---------|
| `index.html` | Restructure header, controls, right panel; remove old search/QR modal |
| `style.css` | Add new layout styles; remove old search/QR modal styles |
| `app.js` | Update element cache, add/remove functions, update exports |

---

## 1. `index.html` Changes

### Remove These Elements (lines as of current file)
- Lines 68-74: QR modal (`#qrModal`)
- Lines 94-98: Slogan `<p>` ("Search and sing karaoke...")
- Lines 100-124: Entire `search-layout-wrapper` (both `.search-container` divs, tip text, `#toggleSearchBtn`)
- Lines 178-182: Songbook buttons inside controls (`#songbook-content` with `#showSongbookQR` and `#songbookButton`)

### Modify Header (lines 82-92)
**Current:**
```html
<div id="dynamicIsland" class="dynamic-island">
    <h2 id="nowPlaying">Ready to Sing</h2>
    <div class="score-meter-container" id="scoreMeter" style="display: none;">
        <div class="score-bar-bg">
            <div id="scoreBarFill"></div>
        </div>
        <span id="liveScoreValue">0</span>
    </div>
</div>
```

**Change:** Only the default `h2` text — `"Ready to Sing"` → `"D.I R.T.S."`. The `updateNowPlayingUI` function in JS handles swapping this text when a song plays. Everything else stays the same (score meter inside island).

### Restructure Left Panel Controls (lines 160-184)
**Remove the old `.controls.glass-panel` entirely** and replace with:

```html
<div class="player-control-bar glass-panel">
    <div class="pcb-left">
        <button id="playPauseBtn" class="play-pause-btn" onclick="togglePlayPause()" aria-label="Play/Pause">
            <span class="icon">▶️</span> Play
        </button>
        <div class="volume-control">
            <span aria-hidden="true">🔈</span>
            <label for="volumeSlider" class="sr-only">Volume control</label>
            <input type="range" id="volumeSlider" min="0" max="100" value="100" oninput="changeVolume(this.value)" aria-label="Volume control">
            <span aria-hidden="true">🔊</span>
        </div>
    </div>
    <div class="pcb-center">
        <button onclick="restartVideo()" aria-label="Restart video"><span class="icon" aria-hidden="true">🔄</span> Restart</button>
        <button onclick="cancelCurrentSong()" class="cancel-btn" aria-label="Cancel current song"><span class="icon" aria-hidden="true">⏹️</span> Cancel</button>
        <button onclick="toggleFullscreen()" aria-label="Toggle full screen"><span class="icon" aria-hidden="true">⛶</span> Full</button>
    </div>
    <div class="pcb-right">
        <button id="openSBBtn" onclick="openSongBook()" class="primary" aria-label="Open Songbook">Open SB</button>
    </div>
</div>
```

### Restructure Right Panel (lines 186-208)
**Replace entirely** with:

```html
<div class="right-panel">
    <!-- Search Section -->
    <div class="sidebar-section search-section glass-panel">
        <div class="search-mode-toggle">
            <button id="sidebarToggleSearchBtn" onclick="toggleSearchMode()">Switch to Number Search</button>
        </div>
        <div class="search-input-wrapper">
            <label for="sidebarSearchInput" class="sr-only">Search karaoke song</label>
            <input type="text" id="sidebarSearchInput" placeholder="Search for a song..." aria-label="Search karaoke song">
        </div>
        <div class="sidebar-search-actions">
            <button id="sidebarPlayBtn" class="primary" onclick="sidebarSearch(true)" aria-label="Play video instantly">Play Now</button>
            <button id="sidebarReserveBtn" onclick="sidebarSearch(false)" aria-label="Reserve song to queue">Reserve</button>
        </div>
    </div>

    <!-- Queue Section -->
    <div class="sidebar-section queue-container glass-panel">
        <h3>Up Next</h3>
        <ul class="queue-list" id="queueList" aria-label="Song queue">
            <li class="empty-queue-state">(Queue is Empty)</li>
        </ul>
    </div>

    <!-- Shortcuts Section -->
    <div class="sidebar-section shortcuts-legend glass-panel">
        <h4>Shortcuts</h4>
        <div class="shortcut-grid">
            <div class="shortcut-item"><span class="key">Z</span> <span>Play/Pause</span></div>
            <div class="shortcut-item"><span class="key">C</span> <span>Restart</span></div>
            <div class="shortcut-item"><span class="key">B</span> <span>Cancel</span></div>
            <div class="shortcut-item"><span class="key">F</span> <span>Full</span></div>
            <div class="shortcut-item"><span class="key">↵</span> <span>Play</span></div>
            <div class="shortcut-item"><span class="key">⇧+↵</span> <span>Reserve</span></div>
            <div class="shortcut-item"><span class="key">M</span> <span>Mic</span></div>
        </div>
    </div>

    <!-- QR Section -->
    <div class="sidebar-section qr-section glass-panel">
        <div class="qr-label">QR SB</div>
        <div id="sidebarQrCode"></div>
        <p class="qr-caption">Scan this to show Song Book</p>
    </div>
</div>
```

---

## 2. `style.css` Changes

### Add: Player Control Bar

```css
.player-control-bar {
    margin-top: 10px;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    background: var(--glass-bg);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--glass-border);
    border-radius: 32px;
    box-shadow: var(--panel-shadow);
}

.pcb-left,
.pcb-center,
.pcb-right {
    display: flex;
    align-items: center;
    gap: 12px;
}

.pcb-right {
    flex-shrink: 0;
}

.play-pause-btn {
    background: var(--accent-color);
    border: none;
    box-shadow: 0 8px 20px rgba(0, 122, 255, 0.3);
    min-width: 90px;
}

.play-pause-btn:hover {
    background: #0084ff;
    box-shadow: 0 12px 25px rgba(0, 122, 255, 0.5);
}

#openSBBtn {
    background: var(--accent-color);
    box-shadow: 0 8px 20px rgba(0, 122, 255, 0.3);
    padding: 12px 20px;
    font-weight: 700;
    letter-spacing: 1px;
}
```

### Add: Sidebar Sections

```css
.sidebar-section {
    width: 100%;
    padding: 20px;
    border-radius: 20px;
}

/* Search Section */
.search-section .search-mode-toggle {
    margin-bottom: 10px;
}

.search-section .search-mode-toggle button {
    font-size: 11px;
    padding: 6px 14px;
    border-radius: 100px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--text-tertiary);
    cursor: pointer;
    transition: var(--transition-smooth);
    font-family: inherit;
}

.search-section .search-mode-toggle button.active {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(0, 122, 255, 0.3);
    color: var(--text-primary);
}

#sidebarSearchInput {
    width: 100%;
    padding: 12px 18px;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: white;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
    transition: var(--transition-smooth);
}

#sidebarSearchInput:focus {
    border-color: rgba(0, 122, 255, 0.4);
    background: rgba(255, 255, 255, 0.07);
    box-shadow: 0 0 20px rgba(0, 122, 255, 0.1);
}

#sidebarSearchInput::placeholder {
    color: var(--text-tertiary);
}

.sidebar-search-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
}

.sidebar-search-actions button {
    flex: 1;
    padding: 10px 14px;
    font-size: 13px;
    border-radius: 14px;
}

/* Queue Section — Scrollable */
.queue-container {
    max-height: clamp(200px, 35vh, 400px);
    overflow-y: auto;
}

/* Shortcuts in Sidebar */
.shortcuts-legend {
    padding: 20px;
    margin-top: 0;
}

/* QR Section */
.qr-section {
    text-align: center;
    padding: 20px;
}

.qr-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 12px;
}

#sidebarQrCode {
    background: white;
    padding: 12px;
    border-radius: 16px;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    margin-bottom: 10px;
}

#sidebarQrCode img,
#sidebarQrCode canvas {
    display: block;
    max-width: 100%;
    height: auto;
}

.qr-caption {
    font-size: 11px;
    color: var(--text-tertiary);
    margin: 0;
    line-height: 1.4;
}
```

### Remove These Old Styles
- Lines ~450-480: `.search-layout-wrapper`, `.search-container`, `#searchInput`, `#codeSearchInput`, `#toggleSearchBtn` styles
- Lines ~492-566: `.songbook-button-container`, `.songbook-button`, `.songbook-qr-modal`, `#qrcode` (modal), `.songbook-qr-modal button`, etc.
- Line 124: The inline `display: none` div for SEO text — keep that, it's for SEO

### Update Mobile Responsive Styles

**For `<768px`** — in the existing media query block (around line 1121), update:
- Keep right panel stacking below left panel
- Ensure `.player-control-bar` wraps gracefully

Add new block after existing mobile rules:
```css
@media (max-width: 768px) {
    .player-control-bar {
        flex-wrap: wrap;
        justify-content: center;
        padding: 12px 16px;
        gap: 12px;
    }
    .pcb-left,
    .pcb-center,
    .pcb-right {
        flex: 1 1 auto;
        justify-content: center;
    }
    .sidebar-section {
        padding: 16px;
    }
    #sidebarSearchInput {
        font-size: 16px; /* Prevent iOS zoom */
    }
}
```

**For `<600px`** — integrate into existing mobile rules:
- `.pcb-center` buttons use circular compact style (same as current mobile `.button-row` rules)
- `.sidebar-search-actions` switches to horizontal with equal buttons
- `.qr-section` padding reduces

---

## 3. `app.js` Changes

### Update `cacheElements()` (line ~84-96)

**Old IDs to remove:**
```js
'searchInput', 'codeSearchInput',
'textsearchContainer', 'codeSearchContainer', 'toggleSearchBtn',
'textPlayBtn', 'textReserveBtn', 'codePlayBtn', 'codeReserveBtn',
'qrModal', 'qrcode'
```

**New IDs to add:**
```js
'sidebarSearchInput', 'sidebarPlayBtn', 'sidebarReserveBtn', 'sidebarToggleSearchBtn',
'sidebarQrCode', 'playPauseBtn', 'openSBBtn'
```

### Update `updateNowPlayingUI()` (line ~420)

Change the else branch (idle state):
```js
// Old:
nowPlaying.innerText = "Ready to Sing";
// New:
nowPlaying.innerText = "D.I R.T.S.";
```

### Add `togglePlayPause()` (new function)

```js
togglePlayPause() {
    if (!this.state.player || typeof this.state.player.getPlayerState !== 'function') return;
    const state = this.state.player.getPlayerState();
    const btn = this.elements.playPauseBtn;
    if (state === YT.PlayerState.PLAYING) {
        this.state.player.pauseVideo();
        btn.innerHTML = '<span class="icon">▶️</span> Play';
    } else {
        this.state.player.playVideo();
        btn.innerHTML = '<span class="icon">⏸️</span> Pause';
    }
}
```

### Add `sidebarSearch()` (new function — dispatches to correct search mode)

```js
sidebarSearch(playNow) {
    const toggleBtn = this.elements.sidebarToggleSearchBtn;
    const isNumberSearch = toggleBtn && toggleBtn.classList.contains('active');
    if (isNumberSearch) {
        this.playByCode(playNow);
    } else {
        this.handleSearch(playNow);
    }
}
```

### Update `handleSearch()` (existing, line ~143)

The function references `this.elements.searchInput` — update to use `this.elements.sidebarSearchInput`:

Search for all occurrences of `this.elements.searchInput` inside `handleSearch` and replace with `this.elements.sidebarSearchInput` (about 3 references).

Also update:
- `this.elements.textPlayBtn` → `this.elements.sidebarPlayBtn` 
- `this.elements.textReserveBtn` → `this.elements.sidebarReserveBtn`
- `this.elements.textsearchContainer` → don't pass container param (or remove that line)

Inside `handleSearch`, the `setSearchLoading` call and `showSearchFeedback` call reference old button/container elements. Update them.

**Simplified approach:** Replace all references to old search elements inside `handleSearch`:
- `this.elements.searchInput` → `this.elements.sidebarSearchInput`
- `this.elements.textPlayBtn` → `this.elements.sidebarPlayBtn`
- `this.elements.textReserveBtn` → `this.elements.sidebarReserveBtn`
- `this.elements.textsearchContainer` → leave as undefined or remove — the loading state on container is not critical

### Update `playByCode()` (line ~202)

Replace references:
- `this.elements.codeSearchInput` → `this.elements.sidebarSearchInput`
- `this.elements.codePlayBtn` → `this.elements.sidebarPlayBtn`
- `this.elements.codeReserveBtn` → `this.elements.sidebarReserveBtn`
- `this.elements.codeSearchContainer` → leave/remove

### Update `toggleSearchMode()` (line ~829)

Replace with simplified version:

```js
toggleSearchMode() {
    const input = this.elements.sidebarSearchInput;
    const toggleBtn = this.elements.sidebarToggleSearchBtn;
    if (!input || !toggleBtn) return;

    const isText = !toggleBtn.classList.contains('active');
    if (isText) {
        toggleBtn.classList.add('active');
        toggleBtn.innerText = "Switch to Text Search";
        input.placeholder = "Enter song number...";
    } else {
        toggleBtn.classList.remove('active');
        toggleBtn.innerText = "Switch to Number Search";
        input.placeholder = "Search for a song...";
    }
    input.value = '';
}
```

### Add `initSidebarQR()` (new function)

```js
initSidebarQR() {
    const container = this.elements.sidebarQrCode;
    if (!container || typeof QRCode === 'undefined') return;
    container.innerHTML = '';
    new QRCode(container, {
        text: "https://sirr4nd3l.github.io/randelkaraokeplayer.github.io/songbook.html",
        width: 160,
        height: 160
    });
}
```

### Update `init()` (line ~63)

Add `initSidebarQR()` call:
```js
async init() {
    await this.loadGlobalComponents();
    this.cacheElements();
    this.loadYouTubeAPI();
    this.attachEventListeners();
    this.initMobileScaling();
    this.initSidebarQR();  // <-- ADD THIS
}
```

### Update `handleGlobalKeyDown()` (line ~865)

Change the `'z'` mapping:
```js
// Old:
'z': () => this.state.player.playVideo(),
// New:
'z': () => this.togglePlayPause(),
```

Also update the input focus check (line 884):
```js
// Old:
if (document.activeElement === this.elements.searchInput || document.activeElement === this.elements.codeSearchInput) {
// New:
if (document.activeElement === this.elements.sidebarSearchInput) {
```

Update the Enter key handler inside that block (lines 885-898):
```js
if (event.key === 'Enter') {
    const playerState = this.state.player && typeof this.state.player.getPlayerState === 'function' ? 
                       this.state.player.getPlayerState() : -1;
    const isSongActive = playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING;
    const playNow = event.shiftKey ? false : !isSongActive;
    this.sidebarSearch(playNow);
}
```

Update the QR/custom alert checks — remove the QR modal check (lines 867-873), keep only the custom alert check.

### Remove These Functions
- `showSongbookQR()` — delete entirely
- `closeSongbookQR()` — delete entirely

### Update Global Exports (bottom of file, ~line 951-965)

**Remove:**
```js
window.loadVideo = (playNow) => KaraokeApp.handleSearch(playNow);
window.playByCode = (id) => KaraokeApp.playByCode(id);
window.showSongbookQR = () => KaraokeApp.showSongbookQR();
window.closeSongbookQR = () => KaraokeApp.closeSongbookQR();
window.playVideo = () => KaraokeApp.state.player?.playVideo();
window.pauseVideo = () => KaraokeApp.state.player?.pauseVideo();
```

**Add:**
```js
window.togglePlayPause = () => KaraokeApp.togglePlayPause();
window.sidebarSearch = (playNow) => KaraokeApp.sidebarSearch(playNow);
```

**Keep/update:**
```js
window.playVideo = () => KaraokeApp.togglePlayPause(); // redirect to toggle
window.pauseVideo = () => KaraokeApp.togglePlayPause(); // redirect to toggle
```

### Remove `clearSearchInputs()` references

Inside `showSearchFeedback` (line ~669-686), there's a call to `this.clearSearchInputs()` — update that:

```js
clearSearchInputs() {
    this.elements.sidebarSearchInput.value = "";
}
```

### Update `attachEventListeners()` (line ~850)

Remove the codeSearchInput event listener (the number sound effect one — lines 854-861) since the input is now shared. Instead, add a more targeted listener to play number sounds when in number mode:

```js
if (this.elements.sidebarSearchInput) {
    this.elements.sidebarSearchInput.addEventListener('keydown', (e) => {
        if (/^[0-9]$/.test(e.key) && !e.repeat) {
            const toggleBtn = this.elements.sidebarToggleSearchBtn;
            if (toggleBtn && toggleBtn.classList.contains('active')) {
                this.playNumberSound(e.key);
            }
        }
    });
}
```

### Update `showSearchFeedback()` (line ~669)

Replace:
```js
this.elements.searchInput.value = "";
this.elements.codeSearchInput.value = "";
```
With:
```js
this.elements.sidebarSearchInput.value = "";
```

---

## 4. Verification Checklist

After all changes, verify:

| Check | Expected |
|-------|----------|
| `index.html` loads without console errors | No broken element references |
| Header shows "D.I R.T.S." on idle | Text changes to song title when playing |
| Play/Pause toggle works | Icon swaps, video plays/pauses |
| RESTART, CANCEL, FULL work | Same behavior as before |
| OPEN SB opens songbook in new tab | Links correctly |
| Sidebar search works (text mode) | Searches YouTube, plays/reserves |
| Sidebar search works (number mode) | Looks up by code, plays/reserves |
| Toggle button changes placeholder/text | "Switch to Number/Text Search" |
| Queue shows in sidebar with scroll | Max-height works, scrollable |
| Shortcuts display correctly | All keys listed |
| QR code shows inline in sidebar | Generated on page load |
| Keyboard shortcuts work | Z = play/pause, etc. |
| Mobile <768px stacks sidebar below player | Layout works, no overflow |
| Mobile <600px controls compact | Circular buttons, proper spacing |
| Score overlay works | End-of-song score shows correctly |
| Mic scoring works | Toggle, pulse, score bar all functional |

---

## 5. Files Not Modified

These files remain untouched:
- `songbook.html`
- `customAlert.html`
- `soundEffects/` (entire folder)
- `images/` (entire folder)
- `seo.jsonld`, `sitemap.xml`, `robots.txt`, `version.json`
- `README.md`
