/**
 * Randel Karaoke Player - Next-Gen karaoke Experience
 */

// --- Keyboard shortcuts ---
// Single source of truth for the keydown map, so the handler and the README
// can never advertise different keys. (The <kbd> badges this table used to
// render went away with the old control bar.)
const SHORTCUTS = {
    z: { label: 'Play/Pause', action: () => KaraokeApp.togglePlayPause() },
    c: { label: 'Restart',    action: () => KaraokeApp.restartVideo() },
    b: { label: 'Skip',       action: () => KaraokeApp.playNextInQueue() },
    m: { label: 'Mic',        action: () => KaraokeApp.toggleVisualizer() },
    q: { label: 'QR',         action: () => KaraokeApp.toggleQR() },
    f: { label: 'Fullscreen', action: () => KaraokeApp.toggleFullscreen() },
    // Hidden admin shortcut: not advertised in the UI, but useful for the
    // operator. Ignored while typing in a form field, like every other key.
    p: { label: 'Manage songs', action: () => KaraokeApp.openManage() }
};

// Song codes are six slots including leading zeros, like a karaoke machine
// (42 -> "000042", 0 -> "000000"). The database stores plain integers.
const formatSongNumber = (value) => String(value ?? '').padStart(6, '0');

const KaraokeApp = {
    // --- 1. Configuration & Constants ---
    // Stores API keys, endpoints, and asset paths used throughout the app.
    CONFIG: {
        APP_TITLE: "Randel Karaoke Player",
        YOUTUBE_SEARCH_ENDPOINT: "https://karaoke-backend-topaz.vercel.app/api/youtube-search",
        CACHE_ENDPOINT: "https://karaoke-backend-topaz.vercel.app/api/karaoke-cache",
        SUPABASE_URL: "https://blbwxnbbdsqkxbuvcrtn.supabase.co",
        SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsYnd4bmJiZHNxa3hidXZjcnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5Nzc5NDgsImV4cCI6MjA5NTU1Mzk0OH0._OH1HSCUO1DfZOzefGk-j7GT-M3HplVULlziFnn--18",
        SOUND_EFFECTS: {
            CHEER: "soundEffects/scoreSound.mp3",
            SUCCESS: "soundEffects/scoreSound.mp3",
            FAIL: "soundEffects/scoreSound.mp3"
        },
        PREFERRED_CHANNELS: [
            'UCutZyApGOjqhOS-pp7yAj4Q', // ATOME KARAOKE
            'UCNbFgUCJj2Ls6LVzBbL8fqA', // KARAOKETV
            'UCjpmz7p9aFNuHP_AuQDxYRw', //HARANA KARAOKE
            'UCLibmOHbJSf1EAke-seSp8A' //Global karaoke tv
        ],
        BACKGROUND_VIDEO: 'backgroundVideo/bgv.mp4',

        // Grace period after loadVideoById before the stage is assumed stuck and
        // the tap-to-start prompt takes over. Long enough to cover a cold BUFFERING
        // on a slow connection, short enough that nobody stares at a black screen.
        PLAY_GATE_GRACE_MS: 4000,

// --- Scoring model ---
// Tuned to be forgiving: simply singing audibly already earns a solid
// score, and volume, pitch and steadiness are bonuses rather than gates.
// A steady everyday singer lands in the 70-85 "Pro/Rockstar" band, and
// 90+ is reserved for a loud, on-key, consistent voice held for a while.
SCORING: {
            TICK_MS: 50,            // scoring sample interval
            VOICE_GATE: 2.0,        // energy below this counts as a rest
            LOUDNESS_SPAN: 18,      // energy above the gate that earns full volume credit
            VOICE_FLOOR: 0.66,      // credit for merely singing audibly
            PITCH_MULT: 1.10,       // bonus multiplier for a trackable note
            PITCHLESS_MULT: 0.85,   // penalty when no pitch can be detected at all
            JITTER_SPAN: 300,       // cents of pitch movement treated as maximum instability
            JITTER_FLOOR: 0.85,     // worst-case multiplier applied by instability
            // Smoothing weights are expressed per SECOND and converted to a per-tick
            // factor by tickAlpha(), so changing TICK_MS no longer silently retunes
            // the whole model. (Values below are the old per-tick numbers converted:
            // 0.18 @200ms, 0.15 @200ms, 0.12 @200ms, 0.05 @200ms.)
            JITTER_SMOOTHING: 0.556, // pitch-instability tracking speed
            PERF_SMOOTHING: 0.556,   // how fast the meter chases current performance
            RISE_RATE: 0.472,        // score climbs within a few good phrases
            FALL_RATE: 0.226,        // ...and drifts down more slowly
            WARMUP_MS: 2000,         // voiced time discarded while the analyser settles
            MIN_PITCH_HZ: 60,       // widest vocal range accepted from the detector
            MAX_PITCH_HZ: 1200
        }
    },

    // --- 2. Application State ---
    // Centralized store for the app's current status, timers, and audio objects.
    state: {
        player: null,
        songQueue: [],
        audioContext: null,
        micAnalyser: null,
        micSource: null,
        micBuffer: null,
        scoreBuffer: null,
        micStream: null,
        isMicActive: false,
        currentScore: 0,
        peakScore: 0,
        performance: 0,
        scoringInterval: null,
        isScoreRevealed: false,
        scoreAudio: null,
        finalScoreTimer: null,
        lastDetectedPitch: 0,
        pitchJitter: 0,
        voicedWarmupMs: 0,
        pendingSongbook: null,
        playerId: null,
        supabaseClient: null,
        heartbeatInterval: null,
        commandPollInterval: null,
        songEnded: false,
        idle: false,
        remoteWarned: false,
        bgvReady: false,
        playGateTimer: null,
        queueFlashTimer: null,
        volume: 100,
        nowPlayingTitle: null,
        heartbeatBusy: false,
        heartbeatDebounce: null,
        heartbeatHasNowPlaying: null,
        // Embedded songbook panel (top-left of the stage)
        songbookSongs: [],
        songbookClient: null,
        songbookRefreshTimer: null,
        songbookStatusTimer: null,
        songbookLive: false
    },

    // --- 3. Cached DOM Elements ---
    // Stores references to frequently accessed HTML elements to avoid repeated lookups.
    elements: {},

    // --- 4. Initialization ---
    // The entry point that kicks off API loading and element caching.
    async init() {
        await this.loadGlobalComponents();
        this.cacheElements();
        this.initPlayerBadge();
        this.initBackgroundVideo();
        // parseURLParams must run before loadYouTubeAPI so a ?code= deep link is
        // already queued when the player fires onReady.
        this.parseURLParams();
        this.loadYouTubeAPI();
        this.attachEventListeners();
        this.initMobileScaling();
        this.initStageQR();
        this.restoreQRState();
        this.initSongbookBridge();
        this.initRemoteControl();
        this.initSongbookPanel();
    },

    // Fetches and injects modular UI components like the custom alert.
    async loadGlobalComponents() {
        try {
            const response = await fetch('customAlert.html');
            if (!response.ok) throw new Error('Alert component not found');
            const html = await response.text();
            document.body.insertAdjacentHTML('afterbegin', html);
        } catch (err) {
            console.warn("Global component loader:", err.message);
        }
    },

    // Helper to store DOM nodes in the `elements` object.
    cacheElements() {
        const ids = [
            'nowPlaying', 'playerPlaceholder', 'dynamicIsland', 
            'queueList', 'videoContainer', 'audioStatus', 
            'scoreMeter', 'scoreBarFill', 
            'liveScoreValue', 'scoreOverlay', 'finalScore', 
            'finalRank', 'finalMessage', 'micPulseIndicator',
            'qrOverlay', 'qrStage', 'qrToggleBtn', 'playPauseBtn', 'playerIdBadge',
            'queueOverlay', 'queueNextTitle', 'queueNextRow', 'queueCountBadge',
            'alertTitle', 'alertMessage', 'customAlert', 'bgvPlayer', 'playGate', 'playGateReason',
            'songbookPanel', 'songbookList', 'songbookFilter', 'songbookStatus',
            'songbookCount', 'songbookCloseBtn', 'openSBBtn'
        ];
        ids.forEach(id => this.elements[id] = document.getElementById(id));
    },

    // --- 5. YouTube API Integration ---
    // Logic for loading and interacting with the YouTube IFrame Player API.
    loadYouTubeAPI() {
        // Global callback for YT API. Registered BEFORE the script is appended so a
        // cache-warm synchronous callback cannot be missed.
        window.onYouTubeIframeAPIReady = () => this.onYouTubeIframeAPIReady();
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
    },

    // Callback fired when the YouTube script is ready.
    onYouTubeIframeAPIReady() {
        this.state.player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            playerVars: { 
                'rel': 0, 
                'showinfo': 0, 
                'iv_load_policy': 3, 
                'controls': 0, 
                'disablekb': 1,
                'cc_load_policy': 1
            },
            events: {
                'onReady': () => this.onPlayerReady(),
                'onStateChange': (e) => this.onPlayerStateChange(e),
                'onError': (e) => this.onPlayerError(e)
            }
        });
    },

    // Setup tasks once the player is ready (e.g., volume sync).
    onPlayerReady() {
        this.startSync();
        this.state.player.setVolume(this.state.volume);
        this.syncBackgroundVideo();

        // If the page was opened from the songbook (?code=X&play=Y), start that song now
        if (this.state.pendingSongbook) {
            const pending = this.state.pendingSongbook;
            this.state.pendingSongbook = null;
            this.playSongByNumber(pending.code, pending.playNow);
        }
    },

    // Handles logic for when a song ends or is paused.
    onPlayerStateChange(event) {
        // The stage is only safe to hand over once the iframe is actually
        // painting frames; until then the recovery prompt owns the screen.
        if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.BUFFERING) {
            this.hidePlayGate();
        }

        // Every state transition can move the player in or out of "a karaoke
        // video is loaded", which is what decides the idle background loop.
        this.syncBackgroundVideo();
        // ...and in or out of "the stage is busy" for the phone remote.
        this.requestHeartbeat();
        if (event.data === YT.PlayerState.ENDED) {
            this.handleSongEnded();
        }
    },

    // YouTube load/playback failures. Without this handler a video that cannot be
    // embedded (101/150) or no longer exists (100) leaves the stage black forever,
    // because the idle loop was already hidden and nothing restores it.
    onPlayerError(event) {
        const code = event && event.data;
        // 5 is a transient HTML5/network fault: the video is still loaded, so offer
        // a manual retry instead of tearing the song down.
        if (code === 5) {
            this.showPlayGate("Playback hiccup — tap to retry");
            return;
        }
        const reason = code === 101 || code === 150
            ? "This video does not allow embedded playback."
            : code === 100
                ? "This video is unavailable or was removed."
                : "This video could not be loaded.";
        this.failPlayback(reason);
    },

    // Single teardown point for a song that will never play: drop the stage back
    // to the welcome screen + idle loop and tell the singer why.
    failPlayback(reason) {
        console.warn("Playback failed:", reason);
        this.hidePlayGate();
        this.goIdle();
        this.showCustomAlert(reason, "Cannot Play This Song");
    },

    // Replaces the three duplicated loadVideoById sequences so every song arms the
    // autoplay watchdog exactly once.
    loadSong(id, title) {
        this.prepareForNewSong();
        this.state.idle = false;
        this.hideBackgroundVideo();
        this.state.player.loadVideoById(id);
        this.updateNowPlayingUI(title);
        this.armPlayGate();
    },

    // If YouTube has not started painting within the grace window it never will —
    // almost always because the browser refused autoplay (typical for a song queued
    // from the phone remote, where nobody touched the player screen). Without the
    // gate that state is a black rectangle: controls are off, so there is nothing
    // to click and no error is emitted.
    armPlayGate() {
        this.clearPlayGateTimer();
        this.state.playGateTimer = setTimeout(() => {
            this.state.playGateTimer = null;
            const player = this.state.player;
            if (!player || typeof player.getPlayerState !== 'function') return;
            const state = player.getPlayerState();
            if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) return;
            this.showPlayGate("Playback was blocked by the browser");
        }, this.CONFIG.PLAY_GATE_GRACE_MS);
    },

    clearPlayGateTimer() {
        clearTimeout(this.state.playGateTimer);
        this.state.playGateTimer = null;
    },

    showPlayGate(reason) {
        const gate = this.elements.playGate;
        if (!gate) return;
        this.clearPlayGateTimer();
        if (this.elements.playGateReason) this.elements.playGateReason.innerText = reason;
        gate.classList.add('active');
    },

    hidePlayGate() {
        this.clearPlayGateTimer();
        if (this.elements.playGate) this.elements.playGate.classList.remove('active');
    },

    // Bound to the gate's click. A real user gesture also unblocks the autoplay
    // policy, so this doubles as the retry for a transient failure.
    startPendingSong() {
        this.hidePlayGate();
        if (this.state.player && typeof this.state.player.playVideo === 'function') {
            this.state.player.playVideo();
        }
        this.armPlayGate();
    },

    // Single entry point for "the current song finished".
    // The YouTube ENDED event and the startSync() poll can both fire for the same
    // song, so a latch guarantees the queue only ever advances by one.
    handleSongEnded() {
        if (this.state.songEnded) return;
        this.state.songEnded = true;
        this.state.isMicActive ? this.showFinalScore() : this.playNextInQueue();
    },

    // --- 6. Song resolution by number ---
    // The player no longer searches by title: that lives on remote.html, which
    // guests use from their phones. What stays here is the songbook-number lookup
    // that remote commands and the songbook bridge arrive through.

    // Fetch a cached song's video details by its 6-digit songbook number.
    // Codes may carry leading zeros, so numeric input is padded to six slots
    // ("42" -> "000042") before the lookup.
    async fetchSongByCode(id) {
        const original = String(id).trim();
        const code = /^\d{1,6}$/.test(original) ? original.padStart(6, '0') : original;

        // `number` is the 6-digit song_number. A 400 means the deployed backend
        // does not know that parameter yet, so retry the legacy `id` form.
        let res = await fetch(`${this.CONFIG.CACHE_ENDPOINT}?number=${encodeURIComponent(code)}`);
        if (res.status === 400) {
            res = await fetch(`${this.CONFIG.CACHE_ENDPOINT}?id=${encodeURIComponent(original)}`);
        }

        // Explicit check for 404 Not Found or 204 No Content
        if (res.status === 404 || res.status === 204) {
            console.log("❌ Song number is not listed in the songbook.");
            return { found: false, reason: 'not_listed' };
        }

        if (!res.ok) throw new Error("❌ Database connection error");

        const data = await res.json();
        if (data && data.videoId) {
            return {
                found: true,
                videoId: data.videoId,
                videoTitle: data.videoTitle,
                songNumber: data.songNumber != null ? formatSongNumber(data.songNumber) : code
            };
        }
        return { found: false, reason: 'not_found' };
    },

    // Shared number-lookup used by the search bar AND remote songbook requests.
    async playSongByNumber(id, playNow = true) {
        if (this.state.isScoreRevealed) return false;
        const original = String(id).trim();
        if (!original) return false;
        const code = /^\d{1,6}$/.test(original) ? original.padStart(6, '0') : original;

        try {
            const result = await this.fetchSongByCode(code);
            if (result.found) {
                console.log(`✅ Found song: (Number: ${code}) (Title: ${result.videoTitle}) (ID: ${result.videoId})`);
                this.handleFoundVideo(result.videoId, playNow, result.videoTitle, null, code);
                console.log("🎉 Successfully added song using number!");
                return true;
            }
            if (result.reason === 'not_listed') {
                this.showCustomAlert(`Song number ${code} is not listed in the songbook.`, "Song Not Found");
            } else {
                this.showCustomAlert("Song number not found!");
            }
        } catch (err) {
            console.error("Number lookup error:", err);
            this.showCustomAlert("Error connecting to database.");
        }
        return false;
    },

    // --- 7. Queue & Playback Management ---
    // Logic for handling the song list, "Now Playing" UI, and video transitions.

    // songbookNumber is the song's number in the karaoke songbook, when known.
    // It is NOT the YouTube id: the chip shows this number so the host can match it
    // against the songbook. Left null for title searches, where the host picked the
    // song by name and a number would be meaningless.
    handleFoundVideo(id, playNow, title, thumbnail = null, songbookNumber = null) {
        const song = {
            id,
            title: title || `Video: ${id}`,
            thumbnail: thumbnail || `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
            queueNumber: songbookNumber
        };

        // Security check: Prevent interrupting an active performance.
        const playerState = this.state.player && typeof this.state.player.getPlayerState === 'function' ? 
                           this.state.player.getPlayerState() : -1;
        const isSongActive = playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING;

        if (playNow && !isSongActive) {
            this.loadSong(id, song.title);
        } else {
            // Security: If 'Play Now' is clicked while active, or if 'Reserve' is clicked,
            // the song is added to the end of the queue to avoid interrupting the performance.
            this.state.songQueue.push(song);
            this.updateQueueUI();
            
            // Auto-trigger playback if the player is currently idle/cued
            if (playerState === YT.PlayerState.ENDED || playerState === -1 || playerState === YT.PlayerState.CUED) {
                this.playNextInQueue();
            }
        }
    },

    // Logic for advancing to the next item in the songQueue.
    playNextInQueue() {
        this.prepareForNewSong();
        if (this.state.songQueue.length > 0) {
            const nextSong = this.state.songQueue.shift();
            this.loadSong(nextSong.id, nextSong.title);
            this.updateQueueUI();
        } else {
            this.goIdle();
        }
    },

    // Puts the stage back to the welcome screen + idle loop after a deliberate
    // stop (Cancel, queue finished, unrecoverable load failure).
    //
    // Two things make this more than "stopVideo + show the placeholder":
    //  - stopVideo() emits ENDED, and prepareForNewSong() has just cleared the
    //    songEnded latch, so handleSongEnded() would treat the deliberate stop as a
    //    finished song and open the score overlay. closeScore() then calls back
    //    into playNextInQueue(), re-clearing the latch and re-triggering it, which
    //    locked the stage behind the 85%-black overlay permanently.
    //  - stopVideo() can leave YouTube reporting CUED with a stale video_id, which
    //    makes isKaraokeActive() true and keeps the idle loop hidden, leaving the
    //    near-black placeholder as the only visible layer.
    // The idle flag settles both, instead of trusting the player state.
    goIdle() {
        this.state.songEnded = true;
        this.state.idle = true;
        if (this.state.player) {
            try { this.state.player.stopVideo(); } catch (e) { /* player already torn down */ }
        }
        this.updateNowPlayingUI("");
        this.showBackgroundVideo();
    },

    // Updates the Dynamic Island and status text.
    updateNowPlayingUI(title) {
        const { nowPlaying, playerPlaceholder, dynamicIsland } = this.elements;
        this.state.nowPlayingTitle = title || null;
        if (title) {
            nowPlaying.innerText = "🎵 " + title;
            playerPlaceholder.classList.add('hidden');
            dynamicIsland.classList.add('active');
            document.title = `🎤 Now Playing: ${title}`;
        } else {
            nowPlaying.innerText = "Ready to Sing";
            playerPlaceholder.classList.remove('hidden');
            dynamicIsland.classList.remove('active');
            document.title = this.CONFIG.APP_TITLE;
        }
        // Presence includes what is playing, so remotes can confirm with the
        // truth instead of a guess.
        this.requestHeartbeat();
    },

    // Toggles play/pause state of the YouTube player.
    togglePlayPause() {
        if (!this.state.player || typeof this.state.player.getPlayerState !== 'function') return;
        const state = this.state.player.getPlayerState();
        const btn = this.elements.playPauseBtn;
        if (state === YT.PlayerState.PLAYING) {
            this.state.player.pauseVideo();
            btn.innerHTML = '<span class="icon" aria-hidden="true">▶️</span>';
        } else {
            // Resuming from goIdle() puts a song back on the stage, so the idle
            // flag has to be released or the idle loop would stay painted over it.
            this.state.idle = false;
            this.state.player.playVideo();
            btn.innerHTML = '<span class="icon" aria-hidden="true">⏸️</span>';
        }
    },

    // Renders the queue as a horizontal strip of numbered chips inside the stage.
    // Song titles/thumbnails come from the YouTube API or a remote command, so
    // everything is attached as textContent or attributes, never interpolated HTML.
    //
    // Chip numbers show the songbook number when the entry arrived by number
    // (remote / songbook reservation), because that is the number the host will
    // recognise from the songbook. Otherwise they fall back to queue position.
    updateQueueUI() {
        const strip = this.elements.queueList;
        const nextTitle = this.elements.queueNextTitle;
        const countBadge = this.elements.queueCountBadge;
        const nextRow = this.elements.queueNextRow;
        if (!strip) return;
        strip.textContent = "";

        const total = this.state.songQueue.length;

        if (countBadge) countBadge.textContent = String(total);

        if (total === 0) {
            const empty = document.createElement("div");
            empty.className = "queue-empty";
            empty.textContent = "Queue is empty \u2014 search or scan to add songs";
            strip.appendChild(empty);
            if (nextTitle) nextTitle.textContent = 'Nothing queued';
            if (nextRow) nextRow.classList.remove("is-flashing");
            return;
        }

        this.state.songQueue.forEach((song, index) => {
            const chip = document.createElement("div");
            chip.className = "queue-chip";
            chip.setAttribute("role", "listitem");
            chip.title = song.title;
            if (index === 0) chip.classList.add("is-next");

            const num = document.createElement("span");
            num.className = "queue-chip-num";
            num.textContent = song.queueNumber != null && song.queueNumber !== ""
                ? formatSongNumber(song.queueNumber)
                : String(index + 1);

            const remove = document.createElement("button");
            remove.className = "queue-chip-x";
            remove.type = "button";
            remove.textContent = "\u2715";
            remove.setAttribute("aria-label", `Remove ${song.title} from queue`);
            remove.addEventListener("click", () => this.removeFromQueue(index));

            chip.appendChild(num);
            chip.appendChild(remove);
            strip.appendChild(chip);
        });

        // The line under the strip is the host's "what plays next" answer.
        if (nextTitle) nextTitle.textContent = this.state.songQueue[0].title;
        this.flashNextRow();
    },

    // Briefly highlights the next-song line so a reservation made from a phone is
    // noticed without having to hunt for it.
    flashNextRow() {
        const row = this.elements.queueNextRow;
        if (!row) return;
        clearTimeout(this.state.queueFlashTimer);
        row.classList.remove("is-flashing");
        // Force a reflow so the animation restarts on repeat changes.
        void row.offsetWidth;
        row.classList.add("is-flashing");
        this.state.queueFlashTimer = setTimeout(() => {
            row.classList.remove("is-flashing");
        }, 900);
    },

    // Removes a specific song from the user's queue.
    removeFromQueue(index) {
        if (index < 0 || index >= this.state.songQueue.length) return;
        this.state.songQueue.splice(index, 1);
        this.updateQueueUI();
    },

    // --- 8. Audio Analysis & Scoring Engine ---
    // Handles microphone access, real-time pitch detection, and score calculation.

    async toggleVisualizer() {
        const { audioStatus, scoreMeter, micPulseIndicator } = this.elements;

        if (this.state.isMicActive) {
            this.stopScoring();
            if (this.state.micStream) {
                this.state.micStream.getTracks().forEach(t => t.stop());
                this.state.micStream = null;
            }
            // Disconnect the source node, otherwise every mic toggle leaves another
            // live node attached to the analyser.
            if (this.state.micSource) {
                this.state.micSource.disconnect();
                this.state.micSource = null;
            }
            this.state.isMicActive = false;
            
            audioStatus.classList.remove('active');
            this.setMicLabel(false);
            scoreMeter.style.display = "none";
            this.syncMicPressed();
            micPulseIndicator.style.display = 'none';
            return;
        }

        try {
            // 'autoGainControl' is switched off so the browser never auto-adjusts the
            // mic volume mid-performance: AGC pumps the level up and down between
            // phrases, which both distorts what the singer hears and makes the
            // energy-based score swing for no real reason. 'echoCancellation' stays
            // on so the app can ignore the music coming from the speakers.
            this.state.micStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    autoGainControl: false,
                    echoCancellation: true,
                    noiseSuppression: false
                } 
            });

            if (!this.state.audioContext) {
                this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            // iOS Safari leaves the context suspended, which makes the analyser read
            // silence for the whole session unless it is resumed.
            if (this.state.audioContext.state === 'suspended') {
                this.state.audioContext.resume().catch(() => {});
            }
            
            this.state.micAnalyser = this.state.audioContext.createAnalyser();
            this.state.micAnalyser.fftSize = 2048;
            this.state.micSource = this.state.audioContext.createMediaStreamSource(this.state.micStream);
            this.state.micSource.connect(this.state.micAnalyser);
            // The scorer needs its own buffer: micBuffer is refilled every animation
            // frame by the pulse loop.
            this.state.micBuffer = new Float32Array(this.state.micAnalyser.fftSize);
            this.state.scoreBuffer = new Float32Array(this.state.micAnalyser.fftSize);
            
            this.state.isMicActive = true;
        this.syncMicPressed();

            audioStatus.classList.add('active');
            this.setMicLabel(true);
            scoreMeter.style.display = "flex";
            
            this.startScoring();
            this.runPulseAnimation();
        } catch (err) {
            console.error("Microphone access error:", err);
            this.showCustomAlert("Microphone access is required for scoring. Please allow microphone permissions and try again.");
            this.state.isMicActive = false;
        }
    },

    // Smooth animation loop for the microphone pulse effect (RequestAnimationFrame).
    runPulseAnimation() {
        if (!this.state.isMicActive || !this.state.micAnalyser) return;
        
        const { micPulseIndicator } = this.elements;
        if (!micPulseIndicator) return;

        this.state.micAnalyser.getFloatTimeDomainData(this.state.micBuffer);
        let sum = 0;
        for (let i = 0; i < this.state.micBuffer.length; i++) {
            sum += this.state.micBuffer[i] * this.state.micBuffer[i];
        }
        const volume = Math.sqrt(sum / this.state.micBuffer.length) * 100;

        // Always set a resting state first, otherwise the dot stays hidden from the
        // display:none applied when the mic was last switched off.
        micPulseIndicator.style.display = 'inline-block';

        if (volume > 1.5) {
            const scale = 1 + (volume / 65);
            micPulseIndicator.style.transform = `scale(${scale})`;
            micPulseIndicator.style.backgroundColor = '#70ff9d';
        } else {
            micPulseIndicator.style.transform = 'scale(1)';
            micPulseIndicator.style.backgroundColor = '#4cd964';
        }

        requestAnimationFrame(() => this.runPulseAnimation());
    },

    // Periodic task that converts vocal energy and pitch steadiness into points.
    updateScore() {
        if (!this.state.isMicActive || !this.state.micAnalyser || !this.state.scoreBuffer) return;
        if (!this.state.player || typeof this.state.player.getPlayerState !== 'function') return;
        if (this.state.player.getPlayerState() !== YT.PlayerState.PLAYING) return;

        const S = this.CONFIG.SCORING;
        const buf = this.state.scoreBuffer;
        this.state.micAnalyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] ** 2;
        const energy = Math.sqrt(sum / buf.length) * 100;
        const pitch = this.autoCorrelate(buf, this.state.audioContext.sampleRate);

        // A rest holds the meter exactly where it is. Points already earned for
        // singing stay earned: breathing between phrases, holding a note quietly,
        // or listening through the instrumental intro must not take the score away.
        if (energy <= S.VOICE_GATE) return;

        // Discard the first stretch of VOICED time so AudioContext start-up noise
        // cannot leak into the score. Measured in ms so the warm-up window is the
        // same length regardless of TICK_MS.
        this.state.voicedWarmupMs += S.TICK_MS;
        if (this.state.voicedWarmupMs < S.WARMUP_MS) return;

        // Volume credit above the gate, saturating so a hotter mic or a louder
        // singer cannot simply buy a better score.
        const loudness = Math.min(Math.max((energy - S.VOICE_GATE) / S.LOUDNESS_SPAN, 0), 1);
        let points = S.VOICE_FLOOR + (1 - S.VOICE_FLOOR) * loudness;

        if (pitch > 0) {
            points *= S.PITCH_MULT;
            // Track steadiness with a smoothed measure rather than a hard
            // threshold. Songs legitimately move between notes, so frame-to-frame
            // movement is normal; the EMA means an expressive melody is not
            // punished, while an untrackable pitch still loses ground.
            const cents = this.state.lastDetectedPitch > 0
                ? 1200 * Math.abs(Math.log2(pitch / this.state.lastDetectedPitch))
                : 0;
            const jitterTarget = Math.min(cents / S.JITTER_SPAN, 1);
            this.state.pitchJitter += (jitterTarget - this.state.pitchJitter) * this.tickAlpha(S.JITTER_SMOOTHING);
            this.state.lastDetectedPitch = pitch;
        } else {
            points *= S.PITCHLESS_MULT;
            this.state.pitchJitter += (1 - this.state.pitchJitter) * this.tickAlpha(S.JITTER_SMOOTHING);
        }

        points *= S.JITTER_FLOOR + (1 - S.JITTER_FLOOR) * (1 - this.state.pitchJitter);

        // The score is a rolling meter, not a cumulative average, so it reflects
        // how the singer is doing *right now*. A cumulative average converges
        // within seconds and the old 80-point floor latched that early reading
        // permanently; this way a high number has to be sustained to be kept.
        const target = Math.min(points, 1) * 100;
        this.state.performance += (target - this.state.performance) * this.tickAlpha(S.PERF_SMOOTHING);

        // Rise steadily, fall only when the singing itself gets worse.
        const score = this.state.currentScore;
        this.state.currentScore = this.state.performance > score
            ? score + (this.state.performance - score) * this.tickAlpha(S.RISE_RATE)
            : score - (score - this.state.performance) * this.tickAlpha(S.FALL_RATE);
        this.state.currentScore = Math.min(Math.max(this.state.currentScore, 0), 100);

        // Peak hold: the final result is the best level the singer actually held,
        // so a soft outro or a quiet last line cannot erase a strong performance.
        this.state.peakScore = Math.max(this.state.peakScore, this.state.currentScore);

        const display = Math.min(Math.floor(this.state.currentScore), 100);
        this.elements.scoreBarFill.style.width = display + "%";
        this.elements.liveScoreValue.innerText = display;
    },

    // Converts a per-second smoothing rate into the equivalent per-tick factor, so
    // the scoring model behaves identically no matter what TICK_MS is set to.
    tickAlpha(ratePerSecond) {
        const seconds = this.CONFIG.SCORING.TICK_MS / 1000;
        return 1 - Math.pow(1 - Math.min(Math.max(ratePerSecond, 0), 1), seconds);
    },

    // Triggers the end-of-song overlay and calculates the final rank.
    showFinalScore() {
        if (this.state.isScoreRevealed) return;
        this.state.isScoreRevealed = true;
        this.stopScoring();

        const score = Math.min(Math.floor(this.state.peakScore), 100);
        const { scoreOverlay, finalScore, finalRank, finalMessage } = this.elements;

        finalScore.innerText = score;
        let rankData = this.getRankData(score);
        finalRank.innerText = rankData.label;
        finalRank.style.color = rankData.color;
        finalMessage.innerText = rankData.msg;

        scoreOverlay.classList.add('active');
        this.playScoreSound(rankData.rank);
        this.startFinalScoreTimer();

    },

    // Determines label and color based on the numeric score.
    getRankData(score) {
        if (score >= 90) return { rank: 'legendary', label: "Legendary", color: "#ffcc00", msg: "Masterpiece!" };
        if (score >= 78) return { rank: 'rockstar', label: "Rockstar", color: "#007aff", msg: "Incredible!" };
        if (score >= 60) return { rank: 'pro', label: "Pro", color: "#4cd964", msg: "Great job!" };
        if (score >= 35) return { rank: 'amateur', label: "Amateur", color: "#ff9500", msg: "Not bad!" };
        return { rank: 'beginner', label: "Beginner", color: "#ff3b30", msg: "Keep practicing!" };
    },

    // Manages the countdown timer on the final score screen.
    startFinalScoreTimer() {
        const audio = this.state.scoreAudio;

        const startCountdown = (duration) => {
            let seconds = Math.ceil(duration || 15);
            const updateMsg = () => {
                this.elements.finalMessage.innerText = this.state.songQueue.length > 0 ? `Next song in ${seconds}s...` : `Closing in ${seconds}s...`;
            };

            updateMsg();
            this.clearFinalScoreTimer();
            this.state.finalScoreTimer = setInterval(() => {
                seconds--;
                if (seconds <= 0 || !this.elements.scoreOverlay.classList.contains('active')) {
                    this.clearFinalScoreTimer();
                    this.closeScore();
                } else updateMsg();
            }, 1000);
        };

        if (audio && isNaN(audio.duration)) {
            // Wait for metadata, but never let a failed sound fetch strand the overlay open.
            audio.addEventListener('loadedmetadata', () => startCountdown(audio.duration), { once: true });
            audio.addEventListener('error', () => startCountdown(15), { once: true });
        } else {
            startCountdown(audio ? audio.duration : 15);
        }
    },

    // Cancels the pending final-score countdown. Safe to call repeatedly.
    clearFinalScoreTimer() {
        clearInterval(this.state.finalScoreTimer);
        this.state.finalScoreTimer = null;
    },

    // Single teardown point for the final-score overlay. Without this the countdown
    // interval survives the overlay and later fires closeScore() against a new song.
    hideScoreOverlay() {
        this.clearFinalScoreTimer();
        this.hidePlayGate();
        if (this.state.scoreAudio) this.state.scoreAudio.pause();
        if (this.elements.scoreOverlay) this.elements.scoreOverlay.classList.remove('active');
        this.state.isScoreRevealed = false;
    },

    // Runs before any new song begins, so no overlay or score state leaks across songs.
    prepareForNewSong() {
        this.hideScoreOverlay();
        this.resetScore();
        this.state.songEnded = false;
    },

    // Starts the internal scoring interval. The period lives in CONFIG so the
    // smoothing math and the timer can never drift apart.
    startScoring() {
        if (this.state.scoringInterval) clearInterval(this.state.scoringInterval);
        this.state.scoringInterval = setInterval(() => this.updateScore(), this.CONFIG.SCORING.TICK_MS);
    },

    // Stops the internal scoring interval.
    stopScoring() {
        clearInterval(this.state.scoringInterval);
        this.state.scoringInterval = null;
    },

    // Resets points and score UI for a new song. The overlay flag is owned by
    // hideScoreOverlay() so the lock can never be lifted while the overlay is up.
    resetScore() {
        Object.assign(this.state, {
            currentScore: 0,
            peakScore: 0,
            performance: 0,
            lastDetectedPitch: 0,
            pitchJitter: 0,
            voicedWarmupMs: 0
        });
        this.elements.scoreBarFill.style.width = "0%";
        this.elements.liveScoreValue.innerText = "0";
    },

    // Autocorrelation pitch detection.
    // Only lags long enough to represent a human voice are correlated, which both
    // bounds the O(n^2) scan and stops noise from producing absurd long-period wins.
    autoCorrelate(buffer, sampleRate) {
        const S = this.CONFIG.SCORING;
        const size = buffer.length;
        let rms = 0;
        for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i];
        rms = Math.sqrt(rms / size);
        // Use the same gate the scorer uses. Never report a pitch for silence or
        // room noise: a bogus reading would poison the steadiness comparison.
        if (rms * 100 <= S.VOICE_GATE) return -1;

        const maxLag = Math.min(size - 1, Math.floor(sampleRate / S.MIN_PITCH_HZ));
        if (maxLag < 2) return -1;

        let c = new Float32Array(maxLag + 1);
        for (let lag = 0; lag <= maxLag; lag++) {
            let sum = 0;
            const n = size - lag;
            for (let i = 0; i < n; i++) sum += buffer[i] * buffer[i + lag];
            c[lag] = sum;
        }

        // Skip the initial descent, then take the strongest remaining peak.
        let d = 0;
        while (d <= maxLag && c[d] > 0) d++;
        let maxVal = -1, maxPeriod = -1;
        for (let i = d; i <= maxLag; i++) {
            if (c[i] > maxVal) { maxVal = c[i]; maxPeriod = i; }
        }
        if (maxPeriod <= 0) return -1;

        // Octave-error guard: a smooth waveform correlates as strongly at half
        // its true period, which would report the note an octave too high.
        // Corrected in that direction only, so harmonic-rich voices are untouched.
        const doubled = maxPeriod * 2;
        if (doubled <= maxLag && c[doubled] > c[maxPeriod] * 0.95) maxPeriod = doubled;

        const freq = sampleRate / maxPeriod;
        return (freq > S.MIN_PITCH_HZ && freq < S.MAX_PITCH_HZ) ? freq : -1;
    },

    // Plays the celebration or failure audio clip.
    playScoreSound(rank) {
        if (this.state.scoreAudio) this.state.scoreAudio.pause();
        const sound = ['legendary', 'rockstar'].includes(rank) ? this.CONFIG.SOUND_EFFECTS.CHEER : 
                      ['pro', 'amateur'].includes(rank) ? this.CONFIG.SOUND_EFFECTS.SUCCESS : this.CONFIG.SOUND_EFFECTS.FAIL;
        this.state.scoreAudio = new Audio(sound);
        this.state.scoreAudio.volume = 0.125;
        this.state.scoreAudio.play().catch(() => {});
    },

    // --- 8.5 Idle Background Video ---
    // Plays a local looping video whenever the YouTube player has no karaoke
    // video loaded, so the stage never sits on an empty black screen.

    initBackgroundVideo() {
        const bgv = this.elements.bgvPlayer;
        if (!bgv) return;

        // The mute flag must be set through the property as well as the markup:
        // browsers only grant un-gesture'd autoplay when the element reports
        // itself as muted at play() time.
        bgv.muted = true;
        bgv.loop = true;
        bgv.playsInline = true;
        // Single source of truth: the path lives in CONFIG, not in the markup.
        bgv.src = this.CONFIG.BACKGROUND_VIDEO;

        bgv.addEventListener('canplay', () => {
            this.state.bgvReady = true;
            this.syncBackgroundVideo();
        }, { once: true });

        bgv.addEventListener('error', () => {
            console.warn("Background video unavailable:", this.CONFIG.BACKGROUND_VIDEO);
        });

        // Some browsers still refuse the very first play() and only allow it
        // after a gesture, so retry once the user touches the page or a key.
        const retry = () => this.syncBackgroundVideo();
        document.addEventListener('pointerdown', retry, { once: true });
        document.addEventListener('keydown', retry, { once: true });

        this.syncBackgroundVideo();
    },

    // True when the YouTube player is showing (or about to show) a karaoke
    // video. PLAYING/BUFFERING are obvious; PAUSED/CUED still paint a frame or
    // thumbnail, so the idle loop must stay out of the way for those too.
    isKaraokeActive() {
        const player = this.state.player;
        if (!player || typeof player.getPlayerState !== 'function') return false;

        // A deliberate stop can leave the player reporting CUED/PAUSED with a stale
        // video_id. The explicit idle flag is set by goIdle() and cleared by
        // loadSong(), so it overrides the player state instead of being fooled by it.
        if (this.state.idle) return false;

        const playerState = player.getPlayerState();
        if (playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING) return true;
        if (playerState === YT.PlayerState.PAUSED || playerState === YT.PlayerState.CUED) {
            const data = typeof player.getVideoData === 'function' ? player.getVideoData() : null;
            return !!(data && data.video_id);
        }
        return false;
    },

    // Single decision point for the background loop: shown when idle, hidden
    // and paused the moment a song takes over.
    syncBackgroundVideo() {
        if (this.isKaraokeActive()) this.hideBackgroundVideo();
        else this.showBackgroundVideo();
    },

    showBackgroundVideo() {
        const bgv = this.elements.bgvPlayer;
        if (!bgv) return;

        // Wait until there is something to paint. Revealing the layer early puts its
        // own background-color:#000 on screen as a black rectangle over the welcome
        // screen while the 24 MB file is still decoding. canplay re-enters this.
        if (!this.state.bgvReady) {
            this.setBackgroundVideoVisible(false);
            return;
        }

        this.setBackgroundVideoVisible(true);

        const attempt = bgv.play();
        if (attempt && typeof attempt.catch === 'function') {
            // Autoplay refused (no gesture yet): hide the layer so no black frame
            // is left on screen. bgvReady stays true, so the next state change or
            // the first user gesture retries the play and the loop appears.
            attempt.catch(() => this.setBackgroundVideoVisible(false));
        }
    },

    hideBackgroundVideo() {
        const bgv = this.elements.bgvPlayer;
        if (!bgv) return;
        this.setBackgroundVideoVisible(false);
        bgv.pause();
    },

    setBackgroundVideoVisible(visible) {
        const bgv = this.elements.bgvPlayer;
        const container = this.elements.videoContainer;
        if (!bgv) return;
        bgv.classList.toggle('active', visible);
        if (container) container.classList.toggle('bgv-active', visible);
    },

    // Closes the score overlay and resumes the app flow.
    closeScore() {
        this.hideScoreOverlay();
        this.playNextInQueue();
        if (this.state.isMicActive) this.startScoring();
    },

    // Sync checker to detect when the YouTube video is nearing its end.
    startSync() {
        setInterval(() => {
            if (!this.state.player?.getCurrentTime) return;
            const remain = this.state.player.getDuration() - this.state.player.getCurrentTime();
            // Re-arm the latch if the viewer seeks well away from the end, so the
            // same song can still finish (and score) again.
            if (remain > 5) this.state.songEnded = false;
            if (remain <= 0.5 && this.state.player.getPlayerState() === YT.PlayerState.PLAYING) {
                this.handleSongEnded();
            }
        }, 100);
    },

    // --- 10. Event Listeners & UI Helpers ---
    // Logic for keyboard shortcuts and responsive layout adjustments.
    // Renders the remote-control QR into the bottom-left stage overlay.
    // 200px (+ the CSS quiet zone) is the sweet spot: reliably scannable from a
    // few metres away without dominating the video frame.
    initStageQR() {
        const container = this.elements.qrStage;
        if (!container || typeof QRCode === 'undefined') return;
        container.innerHTML = "";
        new QRCode(container, {
            text: "https://sirr4nd3l.github.io/randelkaraokeplayer.github.io/remote.html?player=" + encodeURIComponent(this.getPlayerId()),
            width: 200,
            height: 200,
            // M survives a photographed or screen-reflected code, which is the
            // realistic venue case. L is cheaper to generate but fails there.
            correctLevel: QRCode.CorrectLevel ? QRCode.CorrectLevel.M : undefined
        });
        // Without this the browser bilinearly rescales the modules into a blur,
        // which is the usual cause of a QR that "looks fine but will not scan".
        container.querySelectorAll("img, canvas").forEach(node => {
            node.style.imageRendering = "pixelated";
        });
    },

    // Restores the QR overlay visibility chosen earlier this session/event.
    restoreQRState() {
        let saved = null;
        try { saved = localStorage.getItem('rk_qr_visible'); } catch (e) { /* private mode */ }
        // Default is visible: a guest should be able to scan without a prompt.
        this.toggleQR(saved === null ? true : saved === '1');
    },

    // Shows/hides the QR overlay. Persisted so the host sets the stage up once
    // and the choice survives a reload mid-event.
    toggleQR(force) {
        const overlay = this.elements.qrOverlay;
        if (!overlay) return;
        const btn = this.elements.qrToggleBtn;
        const show = typeof force === 'boolean'
            ? force
            : overlay.classList.contains('is-hidden');
        overlay.classList.toggle('is-hidden', !show);
        if (btn) btn.setAttribute("aria-pressed", show ? "true" : "false");
        try { localStorage.setItem('rk_qr_visible', show ? '1' : '0'); } catch (e) { /* private mode */ }
    },

    // Applies a restored/remote volume. The YouTube player instance survives
    // loadVideoById, so this persists across songs automatically.
    setVolume(value) {
        const vol = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
        this.state.volume = vol;
        if (this.state.player && typeof this.state.player.setVolume === 'function') {
            this.state.player.setVolume(vol);
        }
        return vol;
    },

    // Handles a `volume` command sent from remote.html. Returns true if accepted.
    handleVolumeCommand(row) {
        const raw = row.volume != null ? row.volume : NaN;
        if (raw === null || Number.isNaN(Number(raw))) return false;
        this.setVolume(raw);
        return true;
    },

    // Toggles the in-page songbook panel. The standalone songbook.html page
    // still exists for printing/sharing, but the control-strip button no longer
    // opens a separate tab.
    openSongBook() {
        this.toggleSongbook();
    },

    // Returns this tab's unique, persistent player instance ID.
    // The ID survives refreshes (window.name) but is unique per tab,
    // so duplicated player tabs never share the same identity.
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

    // Short readable form of the player ID for display (e.g. P-3F9A2C).
    getPlayerShortId() {
        return 'P-' + this.getPlayerId().slice(-6).toUpperCase();
    },

    // Shows the short player ID badge and enables click-to-copy of the full ID.
    initPlayerBadge() {
        const badge = this.elements.playerIdBadge;
        if (!badge) return;
        badge.innerText = this.getPlayerShortId();
        badge.title = 'Player ID: ' + this.getPlayerId() + ' (click to copy)';
        badge.addEventListener('click', () => this.copyPlayerId(badge));
    },

    // Copies the full player ID to the clipboard with brief visual feedback.
    async copyPlayerId(badge) {
        const original = badge.innerText;
        try {
            await navigator.clipboard.writeText(this.getPlayerId());
            badge.innerText = 'Copied ✓';
            badge.classList.add('copied');
        } catch (err) {
            badge.innerText = 'Copy failed';
        }
        setTimeout(() => {
            badge.innerText = original;
            badge.classList.remove('copied');
        }, 1500);
    },

    // Listens for Play Now / Reserve requests coming from THIS tab's linked songbook.
    // The channel name includes this player's unique ID, so other duplicate
    // player tabs never receive (or react to) these messages.
    initSongbookBridge() {
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel('karaoke-sb-' + this.getPlayerId());
        channel.onmessage = async (e) => {
            const msg = e.data;
            if (!msg || msg.type !== 'karaoke-song-action') return;
            // Acknowledge immediately so the songbook knows a player tab is listening
            channel.postMessage({ type: 'karaoke-song-action-ack' });
            const playNow = msg.action === 'play';
            await this.playSongByNumber(msg.code, playNow);
        };
    },

    // --- Embedded songbook panel (top-left) ---
    // Renders the same verified songs as songbook.html, but in-page. The host
    // can filter the list and play/reserve a song without leaving the player.

    initSongbookPanel() {
        const panel = this.elements.songbookPanel;
        if (!panel) return;

        const { songbookFilter, songbookList, songbookCloseBtn } = this.elements;
        if (songbookFilter) {
            songbookFilter.addEventListener('input', () => this.filterSongbook(songbookFilter.value));
        }
        if (songbookList) {
            songbookList.addEventListener('click', (event) => this.handleSongbookListClick(event));
        }
        if (songbookCloseBtn) {
            songbookCloseBtn.addEventListener('click', () => this.toggleSongbook(false));
        }

        // Match the QR overlay: the host's show/hide choice survives a reload.
        let saved = null;
        try { saved = localStorage.getItem('rk_songbook_visible'); } catch (e) { /* private mode */ }
        this.toggleSongbook(saved === null ? true : saved === '1');

        // Do not block startup on the network; the panel shows its loading
        // state and fills in when the query returns.
        this.loadSongbook();
    },

    // Shows/hides the panel. Called by the 🎵 control-strip button, the panel's
    // own ✕, and initSongbookPanel (restoring the saved state).
    toggleSongbook(force) {
        const panel = this.elements.songbookPanel;
        if (!panel) return;
        const show = typeof force === 'boolean'
            ? force
            : !panel.classList.contains('is-open');
        panel.classList.toggle('is-open', show);

        const btn = this.elements.openSBBtn;
        if (btn) {
            btn.setAttribute('aria-pressed', show ? 'true' : 'false');
            btn.setAttribute('aria-label', show ? 'Hide the songbook' : 'Show the songbook');
        }
        try { localStorage.setItem('rk_songbook_visible', show ? '1' : '0'); } catch (e) { /* private mode */ }
    },

    // Reuses the Supabase client opened for remote control when possible, so
    // the page never runs two realtime connections to the same project.
    getSongbookClient() {
        if (this.state.songbookClient) return this.state.songbookClient;
        if (this.state.supabaseClient) {
            this.state.songbookClient = this.state.supabaseClient;
            return this.state.songbookClient;
        }
        if (typeof supabase === 'undefined') return null;
        try {
            this.state.songbookClient = supabase.createClient(this.CONFIG.SUPABASE_URL, this.CONFIG.SUPABASE_ANON_KEY);
            return this.state.songbookClient;
        } catch (err) {
            console.warn("Songbook unavailable:", err.message);
            return null;
        }
    },

    async loadSongbook() {
        const list = this.elements.songbookList;
        if (!list) return;

        const client = this.getSongbookClient();
        if (!client) {
            this.setSongbookStatus('Songbook unavailable right now.');
            return;
        }

        if (this.state.songbookSongs.length === 0) {
            this.setSongbookStatus('Loading songs…');
        }

        try {
            // select() = all columns so the panel keeps working before and after
            // the song_number migration; id is the fallback for older rows.
            const { data, error } = await client
                .from('karaoke_search_cache')
                .select()
                .eq('is_verified', true)
                .order('video_title', { ascending: true });
            if (error) throw error;

            // Titles/artists are untrusted database text. renderSongbook() builds
            // every node with textContent, so nothing here can inject markup.
            this.state.songbookSongs = (data || []).map((song) => {
                const parts = String(song.video_title || '').split(' - ');
                return {
                    code: formatSongNumber(song.song_number != null ? song.song_number : song.id),
                    title: parts[0] || 'Untitled',
                    artist: parts.slice(1).join(' - ') || 'N/A'
                };
            });

            this.renderSongbook();
            const filter = this.elements.songbookFilter;
            this.filterSongbook(filter ? filter.value : '');
            this.subscribeSongbookLive(client);
        } catch (err) {
            console.error("Songbook load error:", err);
            this.setSongbookStatus('Could not load the songbook.');
        }
    },

    // Live-refresh when a song is verified/edited from manage.html, matching the
    // standalone songbook page. Debounced so a bulk import triggers one re-read.
    subscribeSongbookLive(client) {
        if (this.state.songbookLive) return;
        this.state.songbookLive = true;
        client
            .channel('songbook-panel-live')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'karaoke_search_cache' },
                () => {
                    clearTimeout(this.state.songbookRefreshTimer);
                    this.state.songbookRefreshTimer = setTimeout(() => this.loadSongbook(), 500);
                }
            )
            .subscribe();
    },

    renderSongbook() {
        const list = this.elements.songbookList;
        if (!list) return;
        list.textContent = '';

        const fragment = document.createDocumentFragment();
        this.state.songbookSongs.forEach((song) => {
            const row = document.createElement('div');
            row.className = 'songbook-row';
            row.setAttribute('role', 'listitem');
            row.dataset.code = song.code;
            row.dataset.search = `${song.code} ${song.title} ${song.artist}`.toLowerCase();

            const number = document.createElement('span');
            number.className = 'songbook-row-num';
            number.textContent = song.code;

            const text = document.createElement('span');
            text.className = 'songbook-row-text';

            const title = document.createElement('span');
            title.className = 'songbook-row-title';
            title.textContent = song.title;
            title.title = song.title;

            const artist = document.createElement('span');
            artist.className = 'songbook-row-artist';
            artist.textContent = song.artist;
            artist.title = song.artist;

            text.append(title, artist);

            const actions = document.createElement('span');
            actions.className = 'songbook-row-actions';
            actions.append(
                this.makeSongbookAction('play', '▶', `Play ${song.title} now`),
                this.makeSongbookAction('reserve', '＋', `Reserve ${song.title}`)
            );

            row.append(number, text, actions);
            fragment.appendChild(row);
        });
        list.appendChild(fragment);

        const count = this.elements.songbookCount;
        if (count) count.textContent = String(this.state.songbookSongs.length);
    },

    makeSongbookAction(action, glyph, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'songbook-row-action';
        button.dataset.songbookAction = action;
        button.textContent = glyph;
        button.title = label;
        button.setAttribute('aria-label', label);
        return button;
    },

    filterSongbook(value) {
        const list = this.elements.songbookList;
        if (!list) return;

        const query = String(value || '').trim().toLowerCase();
        let visible = 0;
        Array.from(list.children).forEach((row) => {
            const match = !query || (row.dataset.search || '').includes(query);
            row.hidden = !match;
            if (match) visible += 1;
        });

        // Keep loading/error messages intact until the first successful load.
        if (!this.state.songbookSongs.length) return;
        if (query && visible === 0) {
            this.setSongbookStatus('No songs match that search.');
        } else {
            this.setSongbookStatus('');
        }
    },

    handleSongbookListClick(event) {
        const button = event.target.closest('[data-songbook-action]');
        if (!button) return;
        const row = button.closest('.songbook-row');
        if (!row || !row.dataset.code) return;

        const playNow = button.dataset.songbookAction === 'play';
        button.disabled = true;
        this.runSongbookAction(row.dataset.code, playNow)
            .finally(() => { button.disabled = false; });
    },

    async runSongbookAction(code, playNow) {
        const ok = await this.playSongByNumber(code, playNow);
        if (!ok) return;

        this.setSongbookStatus(playNow
            ? `Playing #${code}…`
            : `#${code} added to the queue.`);
        clearTimeout(this.state.songbookStatusTimer);
        this.state.songbookStatusTimer = setTimeout(() => {
            const filter = this.elements.songbookFilter;
            this.filterSongbook(filter ? filter.value : '');
        }, 2500);
    },

    setSongbookStatus(text) {
        const status = this.elements.songbookStatus;
        if (!status) return;
        status.textContent = text || '';
        status.hidden = !text;
    },

    // Connects this player to the remote-control channel used by the phone
    // remote / future Android app: publishes a heartbeat so remotes can find it,
    // and polls for remote commands addressed to THIS player's unique ID.
    initRemoteControl() {
        if (typeof supabase === 'undefined') {
            console.warn("Remote control unavailable: supabase-js not loaded.");
            return;
        }
        try {
            this.state.supabaseClient = supabase.createClient(this.CONFIG.SUPABASE_URL, this.CONFIG.SUPABASE_ANON_KEY);
        } catch (err) {
            console.warn("Remote control unavailable:", err.message);
            return;
        }
        this.startHeartbeat();
        this.startCommandPoller();
    },

    // Periodically updates this player's online_players row so remote apps
    // (Android app) can discover and list it. Removes the row on unload.
    startHeartbeat() {
        const client = this.state.supabaseClient;
        const playerId = this.getPlayerId();

        this.sendHeartbeat();
        this.state.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 10000);

        window.addEventListener('beforeunload', () => {
            clearInterval(this.state.heartbeatInterval);
            clearInterval(this.state.commandPollInterval);
            client.from('online_players').delete().eq('player_id', playerId)
                .then(() => {}, () => {});
        });
    },

    // Writes the presence row, including what the stage is doing. `now_playing`
    // is what lets remote.html promise "Playing now" only when that is true:
    // while a song is on, a play command is queued behind it instead of
    // interrupting, so the remote says "Accepted" for those commands.
    //
    // The column is optional. Projects that have not added it answer the upsert
    // with an error naming the column; that is detected once and the heartbeat
    // falls back to the original row shape so discovery keeps working either way.
    async sendHeartbeat() {
        const client = this.state.supabaseClient;
        if (!client || this.state.heartbeatBusy) return;
        this.state.heartbeatBusy = true;

        const base = {
            player_id: this.getPlayerId(),
            short_id: this.getPlayerShortId(),
            last_seen: new Date().toISOString()
        };
        const row = this.state.heartbeatHasNowPlaying === false
            ? base
            : { ...base, now_playing: this.getBusySongTitle() };

        try {
            const { error } = await client.from('online_players').upsert(row, { onConflict: 'player_id' });
            if (error) throw error;
            if (this.state.heartbeatHasNowPlaying !== false) this.state.heartbeatHasNowPlaying = true;
        } catch (err) {
            const message = String((err && err.message) || '');
            if (this.state.heartbeatHasNowPlaying !== false && message.includes('now_playing')) {
                // Optional column not present yet: retry without it and stop
                // asking (per session), instead of losing the heartbeat entirely.
                this.state.heartbeatHasNowPlaying = false;
                client.from('online_players').upsert(base, { onConflict: 'player_id' })
                    .then(() => {}, () => {});
            } else if (this.state.remoteWarned !== true) {
                // Fail silently: the remote-control tables may not exist yet
                this.state.remoteWarned = true;
                console.warn("Heartbeat failed:", message);
            }
        } finally {
            this.state.heartbeatBusy = false;
        }
    },

    // The song on stage while it is busy, else null. Mirrors the
    // PLAYING/BUFFERING test handleFoundVideo() uses to queue instead of play,
    // so the remote's confirmation matches what the player will actually do.
    getBusySongTitle() {
        if (this.state.idle || !this.state.player) return null;
        if (typeof YT === 'undefined' || typeof this.state.player.getPlayerState !== 'function') return null;
        const state = this.state.player.getPlayerState();
        const busy = state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING;
        return busy ? (this.state.nowPlayingTitle || 'A song') : null;
    },

    // Nudges a heartbeat right after a playback transition, so the remote's
    // idea of "stage busy" is fresh; the 10s interval alone can lag behind.
    requestHeartbeat() {
        if (!this.state.supabaseClient) return;
        clearTimeout(this.state.heartbeatDebounce);
        this.state.heartbeatDebounce = setTimeout(() => this.sendHeartbeat(), 400);
    },

    // Reacts to remote commands (play / reserve) by POLLING the pending rows
    // for THIS player ID. Uses plain REST (works on the free Supabase tier) —
    // Realtime postgres_changes would require the paid Realtime add-on.
    startCommandPoller() {
        const client = this.state.supabaseClient;
        const playerId = this.getPlayerId();
        let processing = false;
        // Rows are read as 'pending' and only flipped to ack/failed after the
        // network lookup returns, so a second poll can otherwise pick up the same
        // row and enqueue the song twice. Remember what this tab already handled.
        const handled = new Set();

        const poll = async () => {
            if (processing) return;
            processing = true;
            try {
                const { data } = await client.from('remote_commands')
                    .select('*')
                    .eq('player_id', playerId)
                    .eq('status', 'pending')
                    .limit(5);

                for (const row of data || []) {
                    if (handled.has(row.id)) continue;
                    handled.add(row.id);
                    // Bound the set so a long-running player tab cannot grow it forever.
                    if (handled.size > 50) handled.delete(handled.values().next().value);

                    // A volume command is not a song command: handle and ack it
                    // without touching the queue.
                    let ok;
                    if (row.action === 'volume') {
                        ok = this.handleVolumeCommand(row);
                    } else {
                        const playNow = row.action === 'play';
                        ok = row.video_id
                            ? this.handleRemoteVideo(row, playNow)
                            : await this.playSongByNumber(row.song_code, playNow);
                    }
                    await client.from('remote_commands')
                        .update({ status: ok ? 'ack' : 'failed' })
                        .eq('id', row.id);
                }
            } catch (err) {
                console.warn("Remote command poll failed:", err.message);
            } finally {
                processing = false;
            }
        };

        poll();
        this.state.commandPollInterval = setInterval(poll, 2500);
    },

    // Plays a remote video_id command. Returns true if the command was accepted.
    handleRemoteVideo(row, playNow) {
        if (this.state.isScoreRevealed) return false;
        if (!row.video_id) return false;
        this.handleFoundVideo(
            row.video_id,
            playNow,
            row.video_title || `Video: ${row.video_id}`,
            null,
            row.song_code != null ? formatSongNumber(row.song_code) : null
        );
        return true;
    },

    // Reads ?code=X&play=Y from the URL (opened directly from the songbook)
    // and schedules playback once the YouTube player is ready.
    parseURLParams() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (!code) return;
        this.state.pendingSongbook = {
            code,
            playNow: params.get('play') !== '0'
        };
        // Clean the URL so a refresh doesn't replay the song
        history.replaceState({}, '', window.location.pathname);
    },

    showCustomAlert(message, title = "System Alert!") {
        // The alert markup is fetched at runtime and loadGlobalComponents() swallows
        // failures, so every one of these nodes can legitimately be missing.
        const { alertTitle, alertMessage, customAlert } = this.elements;
        if (!customAlert || !alertTitle || !alertMessage) {
            console.warn("Custom alert unavailable:", message);
            return;
        }
        alertTitle.innerText = title;
        alertMessage.innerText = message;
        customAlert.style.display = 'flex';

        // Auto-focus the OK button so the Enter key works naturally for accessibility.
        // Must target #closeAlert: the first <button> in the markup is the hidden
        // #cancelAlert, which cannot take focus.
        const okBtn = customAlert.querySelector('#closeAlert')
            || Array.from(customAlert.querySelectorAll('button')).find(b => b.offsetParent !== null);
        if (okBtn) okBtn.focus();
    },

    closeCustomAlert() {
        if (this.elements.customAlert) this.elements.customAlert.style.display = 'none';
    },

    // Keeps aria-pressed honest on the mic toggle so its state is not carried by
    // colour and text alone.
    // The mic control is an icon-only circle inside the player, so its state is
    // carried by the accessible name rather than a visible text span.
    setMicLabel(active) {
        const btn = this.elements.audioStatus;
        if (!btn) return;
        btn.setAttribute("aria-label", active ? "Microphone scoring is on, tap to turn off" : "Turn on microphone scoring");
        btn.title = active ? "Mic: On (M)" : "Mic: Off (M)";
    },

    syncMicPressed() {
        const btn = this.elements.audioStatus;
        if (!btn) return;
        btn.setAttribute("aria-pressed", this.state.isMicActive ? "true" : "false");
    },

    attachEventListeners() {
        document.addEventListener('keydown', (e) => this.handleGlobalKeyDown(e));
    },

    // Maps physical keys (Z, C, B, M, Q, F, P) to app actions.
    handleGlobalKeyDown(event) {
        // Never hijack browser/OS shortcuts (Ctrl+F find, Cmd+, settings, Alt+Tab).
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        // Priority: If the custom alert is active, Enter closes it
        if (this.elements.customAlert && this.elements.customAlert.style.display === 'flex') {
            if (event.key === 'Enter') {
                this.closeCustomAlert();
                event.preventDefault(); // Stop Enter from triggering search underneath
            }
            return; // Block other shortcuts while alert is active
        }

        // Typing in a form field (e.g. the songbook filter) must never trigger
        // Z/C/B/M/Q/F shortcuts.
        const target = event.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
            || target.tagName === 'SELECT' || target.isContentEditable)) {
            return;
        }

        // Built from the SHORTCUTS table so the handler and the <kbd> badges on
        // the buttons can never disagree.
        const shortcut = SHORTCUTS[event.key.toLowerCase()];
        if (shortcut) shortcut.action();
    },

    // Reloads the current video and resets the score.
    restartVideo() {
        // Guard: Prevent restart logic if no video is currently loaded to avoid YouTube player errors.
        if (!this.state.player || typeof this.state.player.getVideoData !== 'function' || !this.state.player.getVideoData().video_id) {
            return;
        }

        this.prepareForNewSong();
        this.state.idle = false;
        this.state.player.seekTo(0);
        if (this.elements.playerPlaceholder) this.elements.playerPlaceholder.classList.add('hidden');
        this.state.player.playVideo();
        this.armPlayGate();
        if (this.state.isMicActive) this.startScoring();
    },

    // Fullscreen API toggle for the video container.
    toggleFullscreen() {
        const container = this.elements.videoContainer;
        if (!document.fullscreenElement) container.requestFullscreen().catch(() => {});
        else document.exitFullscreen();
    },

    // Opens song management (manage.html) in a new tab. Reachable from the
    // hidden P shortcut and from the focus-only link in index.html, so the
    // stage stays free of admin controls.
    openManage() {
        window.open('manage.html', '_blank', 'noopener');
    },

    // Dynamically updates CSS variables for better scaling on mobile devices.
    initMobileScaling() {
        const apply = () => {
            const w = window.innerWidth || screen.width;
            const ratio = Math.max(0.6, Math.min(1, w / 375));
            const root = document.documentElement;
            root.style.setProperty('--mobile-button-size', Math.round(44 * ratio) + 'px');
            root.style.setProperty('--mobile-icon-size', Math.round(20 * ratio) + 'px');
            root.style.setProperty('--mobile-score-number-size', Math.round(120 * ratio) + 'px');
        };
        window.addEventListener('resize', apply);
        apply();
    }
};

// --- 11. Compatibility Layer ---
// Exposes specific methods to the global window object for legacy HTML 'onclick' support.
window.toggleVisualizer = () => KaraokeApp.toggleVisualizer();
window.restartVideo = () => KaraokeApp.restartVideo();
window.toggleFullscreen = () => KaraokeApp.toggleFullscreen();
window.playVideo = () => KaraokeApp.state.player?.playVideo();
window.pauseVideo = () => KaraokeApp.state.player?.pauseVideo();
// Honest name for what this actually does: advance to the next queued song, or
// return to idle when the queue is empty. It never aborts the current song.
window.skipToNext = () => KaraokeApp.playNextInQueue();
// Back-compat: the old name promised a cancel that never existed. Kept so any
// cached page still works, but it is a misnomer.
window.cancelCurrentSong = window.skipToNext;
window.closeScore = () => KaraokeApp.closeScore();
window.startPendingSong = () => KaraokeApp.startPendingSong();
window.closeCustomAlert = () => KaraokeApp.closeCustomAlert();
window.openSongBook = () => KaraokeApp.openSongBook();
window.openManage = () => KaraokeApp.openManage();
window.togglePlayPause = () => KaraokeApp.togglePlayPause();
window.toggleQR = () => KaraokeApp.toggleQR();
window.getPlayerShortId = () => KaraokeApp.getPlayerShortId();
window.getPlayerId = () => KaraokeApp.getPlayerId();

// --- 12. App Launch ---
// Self-executing initialization on DOM load.
document.addEventListener('DOMContentLoaded', () => KaraokeApp.init());
