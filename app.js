/**
 * Randel Karaoke Player - Next-Gen karaoke Experience
 */

const KaraokeApp = {
    // --- 1. Configuration & Constants ---
    // Stores API keys, endpoints, and asset paths used throughout the app.
    CONFIG: {
        APP_TITLE: "Randel Karaoke Player",
        YOUTUBE_API_KEY: [ 
            'AIzaSyBthjxnP2yj4_3tLVFhVHqRi7TwP2_jUlI'
        ],
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
            'UCjpmz7p9aFNuHP_AuQDxYRw' //HARANA KARAOKE
        ]
    },

    // --- 2. Application State ---
    // Centralized store for the app's current status, timers, and audio objects.
    state: {
        player: null,
        songQueue: [],
        audioContext: null,
        micAnalyser: null,
        micBuffer: null,
        micStream: null,
        isMicActive: false,
        currentScore: 0,
        earnedPoints: 0,
        possiblePoints: 0,
        scoringInterval: null,
        isScoreRevealed: false,
        scoreAudio: null,
        lastDetectedPitch: 0,
        pendingSongbook: null,
        playerId: null,
        supabaseClient: null,
        heartbeatInterval: null
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
        this.loadYouTubeAPI();
        this.attachEventListeners();
        this.initMobileScaling();
        this.initSidebarQR();
        this.initSongbookBridge();
        this.initRemoteControl();
        this.parseURLParams();
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
            'player', 'nowPlaying', 'playerPlaceholder', 'dynamicIsland', 
            'queueList', 'videoContainer', 'audioStatus', 
            'audioText', 'scoreMeter', 'liveScoreBadge', 'scoreBarFill', 
            'liveScoreValue', 'liveScorePlayer', 'scoreOverlay', 'finalScore', 
            'finalRank', 'finalMessage', 'micPulseIndicator',
            'sidebarSearchInput', 'sidebarPlayBtn', 'sidebarReserveBtn', 'sidebarToggleSearchBtn',
            'sidebarQrCode', 'playPauseBtn', 'openSBBtn', 'playerIdBadge',
            'alertTitle', 'alertMessage', 'customAlert'
        ];
        ids.forEach(id => this.elements[id] = document.getElementById(id));
    },

    // --- 5. YouTube API Integration ---
    // Logic for loading and interacting with the YouTube IFrame Player API.
    loadYouTubeAPI() {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
        // Global callback for YT API
        window.onYouTubeIframeAPIReady = () => this.onYouTubeIframeAPIReady();
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

        // If the page was opened from the songbook (?code=X&play=Y), start that song now
        if (this.state.pendingSongbook) {
            const pending = this.state.pendingSongbook;
            this.state.pendingSongbook = null;
            this.playSongByNumber(pending.code, pending.playNow);
        }
    },

    // Handles logic for when a song ends or is paused.
    onPlayerStateChange(event) {
        if (event.data === YT.PlayerState.ENDED) {
            this.state.isMicActive ? this.showFinalScore() : this.playNextInQueue();
        }
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
        const query = this.elements.sidebarSearchInput.value.trim();
        if (!query) return;

        const searchBtn = playNow ? this.elements.sidebarPlayBtn : this.elements.sidebarReserveBtn;
        const originalText = searchBtn.innerText;
        const successText = playNow ? "Done ✓" : "Reserved ✓";

        // Handle Direct Links
        const directId = this.extractVideoId(query);
        if (directId) {
            this.elements.sidebarSearchInput.value = "";
            this.handleFoundVideo(directId, playNow, "Direct Link / ID: " + directId);
            this.showSearchFeedback(searchBtn, successText, originalText);
            return;
        }

        this.setSearchLoading(true, searchBtn, originalText);
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
        } finally {
            this.setSearchLoading(false, searchBtn, originalText);
            if (isSuccess) this.showSearchFeedback(searchBtn, successText, originalText);
        }
    },

    // --- New Search by ID function ---
    async playByCode(playNow = true) {
        if (this.state.isScoreRevealed) return;
        const input = this.elements.sidebarSearchInput;
        const id = input.value.trim();

        if (!id) return;
        
        const searchBtn = playNow ? this.elements.sidebarPlayBtn : this.elements.sidebarReserveBtn;
        const originalText = searchBtn.innerText;
        const successText = playNow ? "Done ✓" : "Reserved ✓";

        console.log(`🔢 Looking up song code: ${id}`);

        this.setSearchLoading(true, searchBtn, originalText);
        const isSuccess = await this.playSongByNumber(id, playNow);
        this.setSearchLoading(false, searchBtn, originalText);

        if (isSuccess) {
            input.value = "";
            this.showSearchFeedback(searchBtn, successText, originalText);
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
            
            return (data.found || data.videoId) ? { id: data.videoId, title: data.videoTitle || data.title } : null;
        } catch (err) {
            console.error(`❌ Cache fetch error: ${err.message}`);
            return null;
        }
    },

    // Primary search fallback using the official YouTube Data API.
    async fetchFromYouTubeAPI(query) {
        const apiKey = Array.isArray(this.CONFIG.YOUTUBE_API_KEY) ? this.CONFIG.YOUTUBE_API_KEY[0] : this.CONFIG.YOUTUBE_API_KEY;
        if (!apiKey) return null;

        // Helper function to check if the result title is actually relevant
        const isRelevant = (resultTitle, originalQuery) => {
            // 1. Decode HTML entities (like &#39; to ')
            const doc = new DOMParser().parseFromString(resultTitle, "text/html");
            const decodedTitle = doc.documentElement.textContent.toLowerCase();
            
            // 2. Clean the title and query of special characters
            const cleanTitle = decodedTitle.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
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

        // 1. Preferred Channels Loop
        for (const channelId of this.CONFIG.PREFERRED_CHANNELS) {
            console.log('Searching in preferred channel:', channelId);
            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&q=${encodeURIComponent(query)}&type=video&videoEmbeddable=true&channelId=${channelId}&key=${apiKey}`;
        
            try {
                const res = await fetch(url);
                const data = await res.json();
                
                // Find the first item that actually matches our criteria
                const item = data.items?.find(it => isRelevant(it.snippet.title, query));

                if (item) {
                    console.log(`✅ Found in preferred channel: ${channelId}`);
                    return { id: item.id.videoId, title: item.snippet.title };
                }
            } catch (err) {
                console.error(`❌Song not found in preferred channel: ${channelId}❗${err.message}`);
            }
        }

        console.log("🔍 Not in preferred channels. Searching globally...");
        const globalUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&q=${encodeURIComponent(query)}&type=video&videoEmbeddable=true&key=${apiKey}`;

        try {
            const res = await fetch(globalUrl);
            const data = await res.json();
            
            const item = data.items?.find(it => isRelevant(it.snippet.title, query));

            if (item) {
                return { id: item.id.videoId, title: item.snippet.title};
            }
        } catch { return null; }

        return null;
    },

    // Saves new successful API search results to the backend cache.
    saveToCache(query, videoId, videoTitle) {
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
            this.resetScore();
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
        this.resetScore();
        if (this.state.songQueue.length > 0) {
            const nextSong = this.state.songQueue.shift();
            this.state.player.loadVideoById(nextSong.id);
            this.updateNowPlayingUI(nextSong.title);
            this.updateQueueUI();
        } else {
            this.state.player.stopVideo();
            this.updateNowPlayingUI("");
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
    updateQueueUI() {
        const list = this.elements.queueList;
        if (this.state.songQueue.length === 0) {
            list.innerHTML = '<li class="empty-queue-state">Queue is empty</li>';
            return;
        }
        list.innerHTML = '';
        this.state.songQueue.forEach((song, index) => {
            const li = document.createElement('li');
            if (index === 0) li.innerHTML = '<div class="next-tag">Next Up</div>';
            
            li.innerHTML += `
                <img class="song-thumb" src="${song.thumbnail}" alt="">
                <div class="song-info">
                    <span class="song-title">${song.title}</span>
                    <div class="song-meta">Pos: ${index + 1} • Ready to sing</div>
                </div>
                <button class="queue-remove-btn" onclick="KaraokeApp.removeFromQueue(${index})">✕</button>
            `;
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
        const { audioStatus, audioText, scoreMeter, liveScoreBadge, micPulseIndicator } = this.elements;

        if (this.state.isMicActive) {
            this.stopScoring();
            if (this.state.micStream) {
                this.state.micStream.getTracks().forEach(t => t.stop());
                this.state.micStream = null;
            }
            this.state.isMicActive = false;
            
            audioStatus.classList.remove('active');
            audioText.innerText = "Mic: Off";
            [scoreMeter, liveScoreBadge].forEach(el => el.style.display = "none");
                micPulseIndicator.style.display = 'none';
            return;
        }

        try {
            // Disabling 'autoGainControl' prevents the browser from lowering your mic volume while you sing.
            // We keep 'echoCancellation' enabled to help the app ignore the music from your speakers.
            this.state.micStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: false
                } 
            });

            if (!this.state.audioContext) {
                this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            this.state.micAnalyser = this.state.audioContext.createAnalyser();
            this.state.micAnalyser.fftSize = 2048;
            this.state.audioContext.createMediaStreamSource(this.state.micStream).connect(this.state.micAnalyser);
            this.state.micBuffer = new Float32Array(this.state.micAnalyser.fftSize);
            
            this.state.isMicActive = true;

            audioStatus.classList.add('active');
            audioText.innerText = "Mic: On";
            [scoreMeter, liveScoreBadge].forEach(el => el.style.display = "flex");
            
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

        if (volume > 1.5) {
            const scale = 1 + (volume / 65);
            micPulseIndicator.style.display = 'inline-block';
            micPulseIndicator.style.transform = `scale(${scale})`;
            micPulseIndicator.style.backgroundColor = '#70ff9d';
        } else {
            micPulseIndicator.style.transform = 'scale(1)';
            micPulseIndicator.style.backgroundColor = '#4cd964';
        }

        requestAnimationFrame(() => this.runPulseAnimation());
    },

    // Periodic task that calculates points based on vocal energy and pitch stability.
    updateScore() {
        if (!this.state.isMicActive || !this.state.micAnalyser) return;
        if (this.state.player.getPlayerState() !== YT.PlayerState.PLAYING) return;

        this.state.micAnalyser.getFloatTimeDomainData(this.state.micBuffer);
        let sum = 0;
        for (let i = 0; i < this.state.micBuffer.length; i++) sum += this.state.micBuffer[i] ** 2;
        const energy = Math.sqrt(sum / this.state.micBuffer.length) * 100;
        const pitch = this.autoCorrelate(this.state.micBuffer, this.state.audioContext.sampleRate);

        // Prevent initial spikes by skipping all accumulation for the first 10 samples (approx 2s).
        // This ensures initialization noise from the hardware/AudioContext doesn't leak into the score.
        if (this.state.possiblePoints < 10) {
            this.state.possiblePoints += 1;
            return;
        }

        this.state.possiblePoints += 1;
        if (energy > 3.0) {
            // Increase logic: reward stable pitch and high vocal energy
            let mult = pitch > 0 ? (Math.abs(pitch - this.state.lastDetectedPitch) > 5 ? 1.3 : 0.3) : 0.4;
            this.state.earnedPoints += Math.min((energy / 15) * mult, 1.2);
            this.state.lastDetectedPitch = pitch;
        }

        // Calculation: Sticky scoring (only goes up) until 80.
        // Once at 80, accuracy-based decrease is allowed, but we prevent a sudden "snap" to a low average.
        const rawScore = (this.state.earnedPoints / this.state.possiblePoints) * 100;

        if (rawScore > this.state.currentScore) {
            this.state.currentScore = rawScore;
        } else if (this.state.currentScore >= 80) {
            // Allow decrease only if we are in the "Pro" zone, but don't fall below the 80 threshold
            this.state.currentScore = Math.max(80, rawScore);
        }
        
        const display = Math.min(Math.floor(this.state.currentScore), 100);
        this.elements.scoreBarFill.style.width = display + "%";
        this.elements.liveScoreValue.innerText = display;
        this.elements.liveScorePlayer.innerText = display;
    },

    // Triggers the end-of-song overlay and calculates the final rank.
    showFinalScore() {
        if (this.state.isScoreRevealed) return;
        this.state.isScoreRevealed = true;
        this.stopScoring();

        const score = Math.min(Math.floor(this.state.currentScore), 100);
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
        [this.elements.sidebarPlayBtn, this.elements.sidebarReserveBtn]
            .forEach(btn => { if (btn) btn.disabled = true; });
    },

    // Determines label and color based on the numeric score.
    getRankData(score) {
        if (score >= 95) return { rank: 'legendary', label: "Legendary", color: "#ffcc00", msg: "Masterpiece!" };
        if (score >= 85) return { rank: 'rockstar', label: "Rockstar", color: "#007aff", msg: "Incredible!" };
        if (score >= 70) return { rank: 'pro', label: "Pro", color: "#4cd964", msg: "Great job!" };
        if (score >= 40) return { rank: 'amateur', label: "Amateur", color: "#ff9500", msg: "Not bad!" };
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
            const timer = setInterval(() => {
                seconds--;
                if (seconds <= 0 || !this.elements.scoreOverlay.classList.contains('active')) {
                    clearInterval(timer);
                    this.closeScore();
                } else updateMsg();
            }, 1000);
        };

        if (audio && isNaN(audio.duration)) {
            audio.addEventListener('loadedmetadata', () => startCountdown(audio.duration), { once: true });
        } else {
            startCountdown(audio ? audio.duration : 15);
        }
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

    // Toggles button loading states during async search operations.
    setSearchLoading(isLoading, btn, text, container) {
        btn.innerText = isLoading ? "Searching..." : text;
        btn.disabled = isLoading;
        if (container) container.classList.toggle('loading', isLoading);
    },

    // Provides visual confirmation of a successful song addition.
    showSearchFeedback(btn, successText, originalText) {
        if (!btn) return;
        
        // Immediately remove focus from input to "deactivate" the search bar visual state
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        btn.classList.add('success-state');
        btn.innerText = successText;

        setTimeout(() => {
            btn.classList.remove('success-state');
            btn.innerText = originalText;
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

    // Resets points and score UI for a new song.
    resetScore() {
        Object.assign(this.state, { currentScore: 0, earnedPoints: 0, possiblePoints: 0, isScoreRevealed: false, lastDetectedPitch: 0 });
        this.elements.scoreBarFill.style.width = "0%";
        this.elements.liveScoreValue.innerText = "0";
        this.elements.liveScorePlayer.innerText = "0";
    },

    // Complex math for detecting the fundamental frequency (pitch) of mic input.
    autoCorrelate(buffer, sampleRate) {
        let size = buffer.length;
        let rms = 0;
        for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i];
        if (Math.sqrt(rms / size) < 0.015) return -1;

        let r1 = 0, r2 = size - 1, thres = 0.2;
        for (let i = 0; i < size / 2; i++) if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
        for (let i = size - 1; i >= size / 2; i--) if (Math.abs(buffer[i]) < thres) { r2 = i; break; }
        
        let clipped = buffer.slice(r1, r2);
        let c = new Float32Array(clipped.length);
        for (let i = 0; i < clipped.length; i++) {
            for (let j = 0; j < clipped.length - i; j++) c[i] += clipped[j] * clipped[j + i];
        }
        let d = 0; while (c[d] > 0) d++;
        let maxVal = -1, maxPeriod = -1;
        for (let i = d; i < clipped.length; i++) {
            if (c[i] > maxVal) { maxVal = c[i]; maxPeriod = i; }
        }
        let freq = sampleRate / maxPeriod;
        return (freq > 50 && freq < 2000) ? freq : -1;
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

    // Closes the score overlay and resumes the app flow.
    closeScore() {
        if (this.state.scoreAudio) this.state.scoreAudio.pause();
        this.elements.scoreOverlay.classList.remove('active');
        this.playNextInQueue();
        if (this.state.isMicActive) this.startScoring();

        // Security: Re-enable search controls
        [this.elements.sidebarPlayBtn, this.elements.sidebarReserveBtn]
            .forEach(btn => { if (btn) btn.disabled = false; });
    },

    // Sync checker to detect when the YouTube video is nearing its end.
    startSync() {
        setInterval(() => {
            if (!this.state.player?.getCurrentTime) return;
            const remain = this.state.player.getDuration() - this.state.player.getCurrentTime();
            if (remain <= 0.5 && this.state.player.getPlayerState() === YT.PlayerState.PLAYING) {
                this.state.isMicActive ? this.showFinalScore() : this.playNextInQueue();
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
            text: "https://sirr4nd3l.github.io/randelkaraokeplayer.github.io/songbook.html?player=" + encodeURIComponent(this.getPlayerId()),
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

    // Connects this player to the remote-control channel used by the future
    // Android app: listens for Supabase Realtime commands addressed to THIS
    // player's unique ID and publishes a heartbeat so remote apps can find it.
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
        this.subscribeRemoteCommands();
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
            client.from('online_players').delete().eq('player_id', playerId).catch(() => {});
        });
    },

    // Reacts to remote commands (play / reserve) inserted for THIS player ID.
    subscribeRemoteCommands() {
        const client = this.state.supabaseClient;
        const playerId = this.getPlayerId();

        client.channel('remote-commands-' + playerId)
            .on('postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'remote_commands',
                    filter: `player_id=eq.${playerId}`
                },
                async (payload) => {
                    const row = payload.new;
                    if (!row || !row.song_code || row.status !== 'pending') return;

                    try {
                        // Existing safety rules apply: e.g. gets queued instead of
                        // interrupting an active performance, guarded while score is shown
                        const playNow = row.action === 'play';
                        const ok = await this.playSongByNumber(row.song_code, playNow);
                        await client.from('remote_commands')
                            .update({ status: ok ? 'ack' : 'failed' })
                            .eq('id', row.id);
                    } catch (err) {
                        console.warn("Remote command failed:", err.message);
                    }
                }
            )
            .subscribe((status, err) => {
                if (err) console.warn("Remote command channel error:", err.message);
            });
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
        this.elements.alertTitle.innerText = title;
        this.elements.alertMessage.innerText = message;
        this.elements.customAlert.style.display = 'flex';

        // Auto-focus the OK button so the Enter key works naturally for accessibility
        const okBtn = this.elements.customAlert.querySelector('button');
        if (okBtn) okBtn.focus();
    },

    closeCustomAlert() {
        this.elements.customAlert.style.display = 'none';
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

        this.elements.scoreOverlay.classList.remove('active');
        this.resetScore();
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
window.changeVolume = (val) => KaraokeApp.state.player?.setVolume(val);
window.playVideo = () => KaraokeApp.togglePlayPause();
window.pauseVideo = () => KaraokeApp.togglePlayPause();
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
