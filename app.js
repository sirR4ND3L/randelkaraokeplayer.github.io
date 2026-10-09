/**
 * Randel Karaoke Player - Next-Gen karaoke Experience
 */

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
        NUMBER_SOUND_EFFECTS: {
            1: 'soundEffects/one.mp3',
            2: 'soundEffects/two.mp3',
            3: 'soundEffects/three.mp3',
            4: 'soundEffects/four.mp3',
            5: 'soundEffects/five.mp3',
            6: 'soundEffects/six.mp3',
            7: 'soundEffects/seven.mp3',
            8: 'soundEffects/eight.mp3',
            9: 'soundEffects/nine.mp3',
            0: 'soundEffects/zero.mp3'
        },
        PREFERRED_CHANNELS: [
            'UCutZyApGOjqhOS-pp7yAj4Q', // ATOME KARAOKE
            'UCNbFgUCJj2Ls6LVzBbL8fqA', // KARAOKETV
            'UCjpmz7p9aFNuHP_AuQDxYRw', //HARANA KARAOKE
            'UCLibmOHbJSf1EAke-seSp8A' //Global karaoke tv
        ],
        BACKGROUND_VIDEO: 'backgroundVideo/bgv.mp4',

        // --- Scoring model ---
        // Tuned to be forgiving: simply singing audibly already earns a solid
        // score, and volume, pitch and steadiness are bonuses rather than gates.
        // A steady everyday singer lands in the 70-85 "Pro/Rockstar" band, and
        // 90+ is reserved for a loud, on-key, consistent voice held for a while.
        SCORING: {
            VOICE_GATE: 2.0,        // energy below this is a rest, not a missed note
            LOUDNESS_SPAN: 18,      // energy above the gate that earns full volume credit
            VOICE_FLOOR: 0.66,      // credit for merely singing audibly
            PITCH_MULT: 1.10,       // bonus multiplier for a trackable note
            PITCHLESS_MULT: 0.85,   // penalty when no pitch can be detected at all
            JITTER_SPAN: 300,       // cents of pitch movement treated as maximum instability
            JITTER_SMOOTHING: 0.18, // EMA weight: one sloppy moment must not crater the score
            JITTER_FLOOR: 0.85,     // worst-case multiplier applied by instability
            PERF_SMOOTHING: 0.15,   // how fast the meter chases current performance
            RISE_RATE: 0.12,        // score climbs within a few good phrases
            FALL_RATE: 0.05,        // ...and drifts down more slowly
            WARMUP_SAMPLES: 10,     // voiced samples discarded while the analyser settles
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
        voicedWarmup: 0,
        pendingSongbook: null,
        playerId: null,
        supabaseClient: null,
        heartbeatInterval: null,
        commandPollInterval: null,
        songEnded: false,
        remoteWarned: false,
        bgvReady: false,
        searchIdleLabel: { play: null, reserve: null },
        searchFeedbackTimers: {}
    },

    // --- 3. Cached DOM Elements ---
    // Stores references to frequently accessed HTML elements to avoid repeated lookups.
    elements: {},

    // --- 4. Initialization ---
    // The entry point that kicks off API loading and element caching.
    async init() {
        await this.loadGlobalComponents();
        this.cacheElements();
        this.initSearchButtonLabels();
        this.initPlayerBadge();
        this.initBackgroundVideo();
        // parseURLParams must run before loadYouTubeAPI so a ?code= deep link is
        // already queued when the player fires onReady.
        this.parseURLParams();
        this.loadYouTubeAPI();
        this.attachEventListeners();
        this.initMobileScaling();
        this.initSidebarQR();
        this.initSongbookBridge();
        this.initRemoteControl();
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
            'audioText', 'scoreMeter', 'scoreBarFill', 
            'liveScoreValue', 'scoreOverlay', 'finalScore', 
            'finalRank', 'finalMessage', 'micPulseIndicator',
            'sidebarSearchInput', 'sidebarPlayBtn', 'sidebarReserveBtn', 'sidebarToggleSearchBtn',
            'sidebarQrCode', 'playPauseBtn', 'playerIdBadge',
            'alertTitle', 'alertMessage', 'customAlert', 'bgvPlayer'
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
                'onStateChange': (e) => this.onPlayerStateChange(e)
            }
        });
    },

    // Setup tasks once the player is ready (e.g., volume sync).
    onPlayerReady() {
        this.startSync();
        this.state.player.setVolume(100);
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
        // Every state transition can move the player in or out of "a karaoke
        // video is loaded", which is what decides the idle background loop.
        this.syncBackgroundVideo();
        if (event.data === YT.PlayerState.ENDED) {
            this.handleSongEnded();
        }
    },

    // Single entry point for "the current song finished".
    // The YouTube ENDED event and the startSync() poll can both fire for the same
    // song, so a latch guarantees the queue only ever advances by one.
    handleSongEnded() {
        if (this.state.songEnded) return;
        this.state.songEnded = true;
        this.state.isMicActive ? this.showFinalScore() : this.playNextInQueue();
    },

    // --- 6. Search Logic ---
    // Processes user input, checks the local cache, and falls back to YouTube/Invidious APIs.

    // Dispatches search to the correct mode based on toggle state.
    sidebarSearch(playNow) {
        const toggleBtn = this.elements.sidebarToggleSearchBtn;
        const isNumberSearch = toggleBtn && toggleBtn.classList.contains('active');
        if (isNumberSearch) {
            this.playByCode(playNow);
        } else {
            this.handleSearch(playNow);
        }
    },

    async handleSearch(playNow = true) {
        if (this.state.isScoreRevealed) return;
        const input = this.elements.sidebarSearchInput;
        if (!input) return;
        const query = input.value.trim();
        if (!query) return;

        const searchBtn = playNow ? this.elements.sidebarPlayBtn : this.elements.sidebarReserveBtn;
        if (!searchBtn) return;
        const idleText = this.getSearchIdleLabel(playNow);

        // Handle Direct Links
        const directId = this.extractVideoId(query);
        if (directId) {
            input.value = "";
            this.handleFoundVideo(directId, playNow, "Direct Link / ID: " + directId);
            this.showSearchFeedback(searchBtn, playNow);
            return;
        }

        this.setSearchLoading(true, searchBtn, idleText);
        let isSuccess = false;

        try {
            console.log("🔍 Raw Query:", query);
            let processedQuery = query.toLowerCase().replace(/['"]/g, "").replace(/\s+/g, " ").trim();
            if (!processedQuery.includes("karaoke")) processedQuery += " karaoke";
            const cleanCacheQuery = processedQuery.replace(/[^a-z0-9]/g, "");
            console.log("🛠️ Formatted Cache Query:", cleanCacheQuery);

            // Try Cache
            let result = await this.fetchFromCache(cleanCacheQuery);
            
            // Fallback to API
            if (!result) {
                console.log("⚠️ Cache Miss. Moving to API Fallback.");
                result = await this.fetchFromYouTubeAPI(processedQuery);
                
                if (result) {
                    console.log("✨ Found via API:", result.id);
                    this.saveToCache(cleanCacheQuery, result.id, result.title);
                }
            } else {
                console.log("✅ Cache Hit! Found:", result.id);
            }
            if (result) {
                this.elements.sidebarSearchInput.value = "";
                this.handleFoundVideo(result.id, playNow, result.title);
                isSuccess = true;
            } else {
                this.showCustomAlert("Song not found!");
            }
        } catch (err) {
            console.error("Search error:", err);
            this.showCustomAlert("Search failed. Please try again.");
        } finally {
            this.setSearchLoading(false, searchBtn, idleText);
            if (isSuccess) this.showSearchFeedback(searchBtn, playNow);
        }
    },

    // --- New Search by ID function ---
    async playByCode(playNow = true) {
        if (this.state.isScoreRevealed) return;
        const input = this.elements.sidebarSearchInput;
        if (!input) return;
        const id = input.value.trim();

        if (!id) return;

        const searchBtn = playNow ? this.elements.sidebarPlayBtn : this.elements.sidebarReserveBtn;
        if (!searchBtn) return;
        const idleText = this.getSearchIdleLabel(playNow);

        console.log(`🔢 Looking up song code: ${id}`);

        this.setSearchLoading(true, searchBtn, idleText);
        const isSuccess = await this.playSongByNumber(id, playNow);
        this.setSearchLoading(false, searchBtn, idleText);

        if (isSuccess) {
            input.value = "";
            this.showSearchFeedback(searchBtn, playNow);
        }
    },

    // Fetch a cached song's video details by its songbook number.
    async fetchSongByCode(id) {
        const res = await fetch(`${this.CONFIG.CACHE_ENDPOINT}?id=${encodeURIComponent(id)}`);

        // Explicit check for 404 Not Found or 204 No Content
        if (res.status === 404 || res.status === 204) {
            console.log("❌ Song number is not listed in the songbook.");
            return { found: false, reason: 'not_listed' };
        }

        if (!res.ok) throw new Error("❌ Database connection error");

        const data = await res.json();
        if (data && data.videoId) {
            return { found: true, videoId: data.videoId, videoTitle: data.videoTitle };
        }
        return { found: false, reason: 'not_found' };
    },

    // Shared number-lookup used by the search bar AND remote songbook requests.
    async playSongByNumber(id, playNow = true) {
        if (this.state.isScoreRevealed) return false;
        const code = String(id).trim();
        if (!code) return false;

        try {
            const result = await this.fetchSongByCode(code);
            if (result.found) {
                console.log(`✅ Found song: (Number: ${code}) (Title: ${result.videoTitle}) (ID: ${result.videoId})`);
                this.handleFoundVideo(result.videoId, playNow, result.videoTitle);
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

    // Fetches previously searched results from the custom backend.
    async fetchFromCache(query) {
        console.log(`🚀 Starting cache lookup for: ${query}`);
        try {
            const res = await fetch(`${this.CONFIG.CACHE_ENDPOINT}?query=${encodeURIComponent(query)}`);
            
            // 1. Explicity check for 204 No Content
            if (res.status === 204) {
                console.log("📦 Cache returned 204: No entry found for this query.")
                return null;
            }
            
            // 2. Check for other non-OK responses
            if (!res.ok) return null;

            // 3. Now it is safe to parse JSON
            const data = await res.json();
            console.log("📦 Cache Response:", data);

            // Require videoId to be present and non-empty to prevent undefined propagation
            return data.videoId && data.videoId.trim() ? { id: data.videoId, title: data.videoTitle || data.title } : null;
        } catch (err) {
            console.error(`❌ Cache fetch error: ${err.message}`);
            return null;
        }
    },

    // Primary search fallback using the backend YouTube search proxy.
    async fetchFromYouTubeAPI(query) {
        const endpoint = this.CONFIG.YOUTUBE_SEARCH_ENDPOINT;
        if (!endpoint) return null;

        // Helper function to check if the result title is actually relevant
        const isRelevant = (resultTitle, originalQuery) => {
            // 1. Decode HTML entities (like &#39; to ')
            const doc = new DOMParser().parseFromString(resultTitle, "text/html");
            const decodedTitle = doc.documentElement.textContent.toLowerCase();
            
            // 2. Clean the title and query of special characters
            const cleanQuery = originalQuery.toLowerCase().replace(/karaoke/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
            
            if (!cleanQuery) return false;

            // 3. Segmented Relevance Check
            // Karaoke titles are usually "Artist - Title (Metadata)". We split by common delimiters.
            const segments = decodedTitle.split(/[-|()\[\]]/).map(s => 
                s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
            ).filter(s => s.length > 0);

            // 4. Match Logic: One of the segments must contain the query words.
            const queryWords = cleanQuery.split(/\s+/).filter(word => word.length > 0);
            const squashedQuery = cleanQuery.replace(/\s+/g, "");

            return segments.some(seg => {
                const segWords = seg.split(/\s+/).filter(word => word.length > 0);
                const squashedSeg = seg.replace(/\s+/g, "");
                
                // Check 1: Exact Phrase Sequence (e.g., "bakit ngayon ka lang")
                const isPhraseFound = segWords.some((_, i) => 
                    queryWords.every((word, j) => segWords[i + j] === word)
                );

                // Check 2: Squashed Match (handles "kalang" vs "ka lang")
                const isSquashedMatch = squashedSeg.includes(squashedQuery);

                // Validation: Prevent over-matching (e.g., "Your Man" vs "When I Was Your Man")
                // We allow a difference of up to 2 words to account for minor spacing differences or metadata like "Karaoke".
                const wordCountDiff = Math.abs(segWords.length - queryWords.length);
                const isLengthValid = wordCountDiff <= 2;

                return (isPhraseFound || isSquashedMatch) && isLengthValid;
            });
        };

        // Bounds each backend call so a hung request cannot leave "Searching..." stuck.
        const fetchWithTimeout = async (url, ms = 6000) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), ms);
            try {
                return await fetch(url, { signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
        };

        // 1. Preferred Channels Loop
        for (const channelId of this.CONFIG.PREFERRED_CHANNELS) {
            console.log('Searching in preferred channel:', channelId);
            const url = `${endpoint}?q=${encodeURIComponent(query)}&channelId=${channelId}`;
        
            try {
                const res = await fetchWithTimeout(url);
                const data = await res.json();
                
                // Find the first item that actually matches our criteria
                const item = data.items?.find(it => isRelevant(it.title, query));

                if (item) {
                    console.log(`✅ Found in preferred channel: ${channelId}`);
                    return { id: item.id, title: item.title };
                }
            } catch (err) {
                console.error(`❌Song not found in preferred channel: ${channelId}❗${err.message}`);
            }
        }

        console.log("🔍 Not in preferred channels. Searching globally...");
        const globalUrl = `${endpoint}?q=${encodeURIComponent(query)}`;

        try {
            const res = await fetchWithTimeout(globalUrl);
            const data = await res.json();
            
            const item = data.items?.find(it => isRelevant(it.title, query));

            if (item) {
                return { id: item.id, title: item.title};
            }
        } catch { return null; }

        return null;
    },

    // Saves new successful API search results to the backend cache.
    saveToCache(query, videoId, videoTitle) {
        // Client-side hygiene only, not a security control: the Vercel handler must
        // re-validate these fields, because the anon client can post anything.
        const validId = /^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''));
        const key = String(query || '');
        if (!validId || key.length < 2 || key.length > 80) {
            console.warn("Skipped cache save (unexpected payload shape)");
            return;
        }
        fetch(this.CONFIG.CACHE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, videoId, videoTitle })
        })
        .then(res => {
            if (res.ok) console.log("💾 Successfully Saved to Supabase Cloud Cache!");
            else console.warn("⚠️ Cache save failed (Server responded with error)");
        })
        .catch(e => console.error("Cache save error:", e));
    },

    // --- 7. Queue & Playback Management ---
    // Logic for handling the song list, "Now Playing" UI, and video transitions.

    handleFoundVideo(id, playNow, title, thumbnail = null) {
        const song = { id, title: title || `Video: ${id}`, thumbnail: thumbnail || `https://img.youtube.com/vi/${id}/mqdefault.jpg` };

        // Security check: Prevent interrupting an active performance.
        const playerState = this.state.player && typeof this.state.player.getPlayerState === 'function' ? 
                           this.state.player.getPlayerState() : -1;
        const isSongActive = playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING;

        if (playNow && !isSongActive) {
            this.prepareForNewSong();
            this.hideBackgroundVideo();
            this.state.player.loadVideoById(id);
            this.updateNowPlayingUI(song.title);
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
            this.hideBackgroundVideo();
            this.state.player.loadVideoById(nextSong.id);
            this.updateNowPlayingUI(nextSong.title);
            this.updateQueueUI();
        } else {
            this.state.player.stopVideo();
            this.updateNowPlayingUI("");
            // Nothing left to play: hand the stage back to the idle loop.
            this.syncBackgroundVideo();
        }
    },

    // Updates the Dynamic Island and status text.
    updateNowPlayingUI(title) {
        const { nowPlaying, playerPlaceholder, dynamicIsland } = this.elements;
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
    },

    // Toggles play/pause state of the YouTube player.
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
    },

    // Re-renders the "Up Next" list in the right panel.
    // Song titles and thumbnails come from the YouTube API or a remote command,
    // so they are attached as text/attributes rather than interpolated into HTML.
    updateQueueUI() {
        const list = this.elements.queueList;
        if (!list) return;
        list.textContent = '';

        if (this.state.songQueue.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty-queue-state';
            empty.textContent = '(Queue is Empty)';
            list.appendChild(empty);
            return;
        }

        this.state.songQueue.forEach((song, index) => {
            const li = document.createElement('li');

            if (index === 0) {
                const nextTag = document.createElement('div');
                nextTag.className = 'next-tag';
                nextTag.textContent = 'Next Up';
                li.appendChild(nextTag);
            }

            const thumb = document.createElement('img');
            thumb.className = 'song-thumb';
            thumb.setAttribute('src', song.thumbnail);
            thumb.setAttribute('alt', '');

            const info = document.createElement('div');
            info.className = 'song-info';

            const title = document.createElement('span');
            title.className = 'song-title';
            title.textContent = song.title;

            const meta = document.createElement('div');
            meta.className = 'song-meta';
            meta.textContent = `Pos: ${index + 1} • Ready to sing`;

            info.appendChild(title);
            info.appendChild(meta);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'queue-remove-btn';
            removeBtn.type = 'button';
            removeBtn.textContent = '✕';
            removeBtn.setAttribute('aria-label', `Remove ${song.title} from queue`);
            removeBtn.addEventListener('click', () => this.removeFromQueue(index));

            li.appendChild(thumb);
            li.appendChild(info);
            li.appendChild(removeBtn);
            list.appendChild(li);
        });
    },

    // Removes a specific song from the user's queue.
    removeFromQueue(index) {
        this.state.songQueue.splice(index, 1);
        this.updateQueueUI();
    },

    // --- 8. Audio Analysis & Scoring Engine ---
    // Handles microphone access, real-time pitch detection, and score calculation.

    async toggleVisualizer() {
        const { audioStatus, audioText, scoreMeter, micPulseIndicator } = this.elements;

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
            audioText.innerText = "Mic: Off";
            scoreMeter.style.display = "none";
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

            audioStatus.classList.add('active');
            audioText.innerText = "Mic: On";
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

        // A rest credits nothing, but it is also not counted against the singer:
        // breathing between phrases must not drag the average down.
        if (energy <= S.VOICE_GATE) return;

        // Discard the first few VOICED samples so AudioContext start-up noise
        // cannot leak into the score.
        if (this.state.voicedWarmup < S.WARMUP_SAMPLES) {
            this.state.voicedWarmup += 1;
            return;
        }

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
            const target = Math.min(cents / S.JITTER_SPAN, 1);
            this.state.pitchJitter += (target - this.state.pitchJitter) * S.JITTER_SMOOTHING;
            this.state.lastDetectedPitch = pitch;
        } else {
            points *= S.PITCHLESS_MULT;
            this.state.pitchJitter += (1 - this.state.pitchJitter) * S.JITTER_SMOOTHING;
        }

        points *= S.JITTER_FLOOR + (1 - S.JITTER_FLOOR) * (1 - this.state.pitchJitter);

        // The score is a rolling meter, not a cumulative average, so it reflects
        // how the singer is doing *right now*. A cumulative average converges
        // within seconds and the old 80-point floor latched that early reading
        // permanently; this way a high number has to be sustained to be kept.
        this.state.performance += (Math.min(points, 1) * 100 - this.state.performance) * S.PERF_SMOOTHING;

        // Rise steadily, drift down even more slowly.
        const score = this.state.currentScore;
        this.state.currentScore = this.state.performance > score
            ? score + (this.state.performance - score) * S.RISE_RATE
            : score - (score - this.state.performance) * S.FALL_RATE;
        this.state.currentScore = Math.min(Math.max(this.state.currentScore, 0), 100);

        // Peak hold: the final result is the best level the singer actually held,
        // so a soft outro or a quiet last line cannot erase a strong performance.
        this.state.peakScore = Math.max(this.state.peakScore, this.state.currentScore);

        const display = Math.min(Math.floor(this.state.currentScore), 100);
this.elements.scoreBarFill.style.width = display + "%";
        this.elements.liveScoreValue.innerText = display;
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

        // Security: Disable search controls while score is revealed
        this.setSearchButtonsDisabled(true);
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
        if (this.state.scoreAudio) this.state.scoreAudio.pause();
        if (this.elements.scoreOverlay) this.elements.scoreOverlay.classList.remove('active');
        this.state.isScoreRevealed = false;
        this.setSearchButtonsDisabled(false);
    },

    // Runs before any new song begins, so no overlay or score state leaks across songs.
    prepareForNewSong() {
        this.hideScoreOverlay();
        this.resetScore();
        this.state.songEnded = false;
    },

    // --- 9. Utility Functions ---
    // Generic helpers for string parsing, UI loading states, and audio processing.
    extractVideoId(query) {
        try {
            const url = new URL(query);
            if (url.hostname.includes('youtube.com')) return url.searchParams.get('v');
            if (url.hostname === 'youtu.be') return url.pathname.slice(1);
        } catch {}
        return (query.length === 11 && !query.includes(' ')) ? query : null;
    },

    // Captures the resting label of each search button exactly once, at startup.
    // Reading btn.innerText at click time is unreliable: a previous success
    // message may still be on screen and would become the new "original" label.
    initSearchButtonLabels() {
        const play = this.elements.sidebarPlayBtn;
        const reserve = this.elements.sidebarReserveBtn;
        if (play) this.state.searchIdleLabel.play = play.innerText;
        if (reserve) this.state.searchIdleLabel.reserve = reserve.innerText;
    },

    // Returns the resting label for the button behind a given playNow flag.
    getSearchIdleLabel(playNow) {
        const cached = playNow ? this.state.searchIdleLabel.play : this.state.searchIdleLabel.reserve;
        // Fall back to the live button text if startup capture somehow did not run,
        // so the button can never be restored as the string "null".
        const btn = playNow ? this.elements.sidebarPlayBtn : this.elements.sidebarReserveBtn;
        if (cached) return cached;
        return (btn && btn.innerText) || (playNow ? 'Play Now' : 'Reserve');
    },

    // Toggles button loading states during async search operations.
    setSearchLoading(isLoading, btn, text, container) {
        btn.innerText = isLoading ? "Searching..." : text;
        // Never clear the score-overlay lock from here.
        btn.disabled = isLoading || this.state.isScoreRevealed;
        if (container) container.classList.toggle('loading', isLoading);
    },

    // Enables or disables both search actions together, so the score-overlay
    // lock can never be lifted by a single button update.
    setSearchButtonsDisabled(disabled) {
        [this.elements.sidebarPlayBtn, this.elements.sidebarReserveBtn]
            .forEach(btn => { if (btn) btn.disabled = disabled; });
    },

    // Provides visual confirmation of a successful song addition.
    showSearchFeedback(btn, playNow) {
        if (!btn) return;

        // Cancel any feedback window still running for this button, so overlapping
        // searches cannot restore a stale label out of order.
        const key = playNow ? 'play' : 'reserve';
        clearTimeout(this.state.searchFeedbackTimers[key]);

        // Immediately remove focus from input to "deactivate" the search bar visual state
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        const successText = playNow ? "Done ✓" : "Reserved ✓";
        btn.classList.add('success-state');
        btn.innerText = successText;

        this.state.searchFeedbackTimers[key] = setTimeout(() => {
            delete this.state.searchFeedbackTimers[key];
            btn.classList.remove('success-state');
            btn.innerText = this.getSearchIdleLabel(playNow);
            // Clear search inputs without resetting the UI mode
            this.clearSearchInputs();
        }, 2000);
    },

    // Clears the search input.
    clearSearchInputs() {
        if (this.elements.sidebarSearchInput) {
            this.elements.sidebarSearchInput.value = "";
        }
    },

    // Starts the internal scoring interval (200ms).
    startScoring() {
        if (this.state.scoringInterval) clearInterval(this.state.scoringInterval);
        this.state.scoringInterval = setInterval(() => this.updateScore(), 200);
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
            voicedWarmup: 0
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

    // Plays the sound effect for a specific digit during number search.
    playNumberSound(digit) {
        const player = this.state.player;
        if (player && typeof player.getPlayerState === 'function') {
            const state = player.getPlayerState();
            // Disable sound effects if a song is currently playing or buffering
            if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) return;
        }

        const soundPath = this.CONFIG.NUMBER_SOUND_EFFECTS[digit];
        if (soundPath) {
            const audio = new Audio(soundPath);
            audio.volume = 0.3; // Moderate volume for typing feedback
            audio.play().catch(() => {});
        }
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

        this.setBackgroundVideoVisible(true);
        // Wait until there is something to paint, otherwise the freshly revealed
        // layer flashes black over the welcome screen.
        if (!this.state.bgvReady) return;

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

    openSongBook() {
        window.open('songbook.html?player=' + encodeURIComponent(this.getPlayerId()), '_blank');
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

        const heartbeat = async () => {
            try {
                await client.from('online_players').upsert({
                    player_id: playerId,
                    short_id: this.getPlayerShortId(),
                    last_seen: new Date().toISOString()
                }, { onConflict: 'player_id' });
            } catch (err) {
                // Fail silently: the remote-control tables may not exist yet
                if (this.state.remoteWarned !== true) {
                    this.state.remoteWarned = true;
                    console.warn("Heartbeat failed:", err.message);
                }
            }
        };

        heartbeat();
        this.state.heartbeatInterval = setInterval(heartbeat, 10000);

        window.addEventListener('beforeunload', () => {
            clearInterval(this.state.heartbeatInterval);
            clearInterval(this.state.commandPollInterval);
            client.from('online_players').delete().eq('player_id', playerId)
                .then(() => {}, () => {});
        });
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

                    const playNow = row.action === 'play';
                    const ok = row.video_id
                        ? this.handleRemoteVideo(row, playNow)
                        : await this.playSongByNumber(row.song_code, playNow);
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
        this.handleFoundVideo(row.video_id, playNow, row.video_title || `Video: ${row.video_id}`);
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

    toggleSearchMode() {
        const input = this.elements.sidebarSearchInput;
        const toggleBtn = this.elements.sidebarToggleSearchBtn;
        if (!input || !toggleBtn) return;

        const isText = !toggleBtn.classList.contains('active');
        if (isText) {
            toggleBtn.classList.add('active');
            toggleBtn.innerText = "Text Search";
            input.placeholder = "Enter song number...";
        } else {
            toggleBtn.classList.remove('active');
            toggleBtn.innerText = "Number Search";
            input.placeholder = "Search for a song...";
        }
        input.value = '';
    },


    attachEventListeners() {
        document.addEventListener('keydown', (e) => this.handleGlobalKeyDown(e));

        // Audio feedback for number search input (Voice Guide)
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
    },

    // Maps physical keys (Z, C, B, F) to app actions.
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

        if (document.activeElement === this.elements.sidebarSearchInput) {
            if (event.key === 'Enter') {
                const playerState = this.state.player && typeof this.state.player.getPlayerState === 'function' ? 
                                   this.state.player.getPlayerState() : -1;
                const isSongActive = playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING;
                const playNow = event.shiftKey ? false : !isSongActive;
                this.sidebarSearch(playNow);
            }
            return;
        }
        const map = {
            'z': () => this.togglePlayPause(),
            'c': () => this.restartVideo(),
            'b': () => this.playNextInQueue(),
            'f': () => this.toggleFullscreen(),
            'm': () => this.toggleVisualizer()
        };
        const action = map[event.key.toLowerCase()];
        if (action) action();
    },

    // Reloads the current video and resets the score.
    restartVideo() {
        // Guard: Prevent restart logic if no video is currently loaded to avoid YouTube player errors.
        if (!this.state.player || typeof this.state.player.getVideoData !== 'function' || !this.state.player.getVideoData().video_id) {
            return;
        }

        this.prepareForNewSong();
        this.state.player.seekTo(0);
        if (this.elements.playerPlaceholder) this.elements.playerPlaceholder.classList.add('hidden');
        this.state.player.playVideo();
        if (this.state.isMicActive) this.startScoring();
    },

    // Fullscreen API toggle for the video container.
    toggleFullscreen() {
        const container = this.elements.videoContainer;
        if (!document.fullscreenElement) container.requestFullscreen().catch(() => {});
        else document.exitFullscreen();
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
window.changeVolume = (val) => KaraokeApp.state.player?.setVolume(Number(val));
window.playVideo = () => KaraokeApp.state.player?.playVideo();
window.pauseVideo = () => KaraokeApp.state.player?.pauseVideo();
window.cancelCurrentSong = () => KaraokeApp.playNextInQueue();
window.closeScore = () => KaraokeApp.closeScore();
window.toggleSearchMode = () => KaraokeApp.toggleSearchMode();
window.closeCustomAlert = () => KaraokeApp.closeCustomAlert();
window.openSongBook = () => KaraokeApp.openSongBook();
window.togglePlayPause = () => KaraokeApp.togglePlayPause();
window.sidebarSearch = (playNow) => KaraokeApp.sidebarSearch(playNow);
window.getPlayerShortId = () => KaraokeApp.getPlayerShortId();
window.getPlayerId = () => KaraokeApp.getPlayerId();

// --- 12. App Launch ---
// Self-executing initialization on DOM load.
document.addEventListener('DOMContentLoaded', () => KaraokeApp.init());
