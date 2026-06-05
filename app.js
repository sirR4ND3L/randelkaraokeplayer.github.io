/**
 * Karaoke Pro - Next-Gen Experience
 * Refactored for Robustness and Maintainability
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
        SOUND_EFFECTS: {
            CHEER: "scoreSound.mp3",
            SUCCESS: "scoreSound.mp3",
            FAIL: "scoreSound.mp3"
        },
        PREFERRED_CHANNELS: [
            'UCutZyApGOjqhOS-pp7yAj4Q', // ATOME KARAOKE
            'UCNbFgUCJj2Ls6LVzBbL8fqA' // KARAOKETV
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
        lastDetectedPitch: 0
    },

    // --- 3. Cached DOM Elements ---
    // Stores references to frequently accessed HTML elements to avoid repeated lookups.
    elements: {},

    // --- 4. Initialization ---
    // The entry point that kicks off API loading and element caching.
    init() {
        this.cacheElements();
        this.loadYouTubeAPI();
        this.attachEventListeners();
        this.initMobileScaling();
    },

    // Helper to store DOM nodes in the `elements` object.
    cacheElements() {
        const ids = [
            'player', 'nowPlaying', 'playerPlaceholder', 'dynamicIsland', 
            'queueList', 'searchInput', 'videoContainer', 'audioStatus', 
            'audioText', 'scoreMeter', 'liveScoreBadge', 'scoreBarFill', 
            'liveScoreValue', 'liveScorePlayer', 'scoreOverlay', 'finalScore', 
            'finalRank', 'finalMessage', 'micPulseIndicator', 'codeSearchInput',
            'textsearchContainer', 'codeSearchContainer', 'toggleSearchBtn',
            'textPlayBtn', 'textReserveBtn', 'codePlayBtn', 'codeReserveBtn',
            'alertTitle', 'alertMessage', 'customAlert', 'qrModal', 'qrcode'
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
            playerVars: { 'rel': 0, 'showinfo': 0, 'iv_load_policy': 3, 'controls': 0, 'disablekb': 1 },
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
    },

    // Handles logic for when a song ends or is paused.
    onPlayerStateChange(event) {
        if (event.data === YT.PlayerState.ENDED) {
            this.state.isMicActive ? this.showFinalScore() : this.playNextInQueue();
        }
    },

    // --- 6. Search Logic ---
    // Processes user input, checks the local cache, and falls back to YouTube/Invidious APIs.

    async handleSearch(playNow = true) {
        if (this.state.isScoreRevealed) return;
        const query = this.elements.searchInput.value.trim();
        if (!query) return;

        const searchBtn = playNow ? this.elements.textPlayBtn : this.elements.textReserveBtn;
        const originalText = searchBtn.innerText;
        const successText = playNow ? "Done ✓" : "Reserved ✓";

        // Handle Direct Links
        const directId = this.extractVideoId(query);
        if (directId) {
            this.elements.searchInput.value = "";
            this.handleFoundVideo(directId, playNow, "Direct Link / ID: " + directId);
            this.showSearchFeedback(searchBtn, successText, originalText);
            return;
        }

        this.setSearchLoading(true, searchBtn, originalText, this.elements.textsearchContainer);
        let isSuccess = false;

        try {
            console.log("🔍 Raw Query:", query);
            let processedQuery = query.toLowerCase().replace(/['"]/g, "").replace(/\s+/g, " ");
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
                this.elements.searchInput.value = "";
                this.handleFoundVideo(result.id, playNow, result.title);
                isSuccess = true;
            } else {
                this.showCustomAlert("Song not found!");
            }
        } catch (err) {
            console.error("Search error:", err);
        } finally {
            this.setSearchLoading(false, searchBtn, originalText, this.elements.textsearchContainer);
            if (isSuccess) this.showSearchFeedback(searchBtn, successText, originalText);
        }
    },

    // --- New Search by ID function ---
    async playByCode(playNow = true) {
        if (this.state.isScoreRevealed) return;
        const input = this.elements.codeSearchInput;
        const id = input.value.trim();

        if (!id) return;
        
        const searchBtn = playNow ? this.elements.codePlayBtn : this.elements.codeReserveBtn;
        const originalText = searchBtn.innerText;
        const successText = playNow ? "Done ✓" : "Reserved ✓";

        console.log(`🔢 Looking up song code: ${id}`);

        this.setSearchLoading(true, searchBtn, originalText, this.elements.codeSearchContainer);
        let isSuccess = false;

        try {
            // Fetching from your backend using the ID parameter
            const res = await fetch(`${this.CONFIG.CACHE_ENDPOINT}?id=${encodeURIComponent(id)}`);

            // Explicit check for 404 Not Found or 204 No Content
            if (res.status === 404 || res.status === 204) {
                this.showCustomAlert(`Song number ${id} is not listed in the songbook.`, "Song Not Found");
                console.log("❌ Song number is not listed in the songbook.");
                return;
            }

            if (!res.ok) throw new Error("❌ Database connection error");

            const data = await res.json();
            
            if (data && data.videoId) {
                input.value = "";
                console.log(`✅ Found song: (Number: ${id}) (Title: ${data.videoTitle}) (ID: ${data.videoId})`);
                this.handleFoundVideo(data.videoId, playNow, data.videoTitle);
                isSuccess = true;
                console.log("🎉 Successfully added song using number!");
            } else {
                this.showCustomAlert("Song number not found!");
            }
        } catch (err) {
            console.error("Number lookup error:", err);
            this.showCustomAlert("Error connecting to database.");
        } finally {
            this.setSearchLoading(false, searchBtn, originalText, this.elements.codeSearchContainer);
            if (isSuccess) this.showSearchFeedback(searchBtn, successText, originalText);
        }
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
        if (!this.CONFIG.YOUTUBE_API_KEY) return null;

        // Helper function to check if the result title is actually relevant
        const isRelevant = (resultTitle, originalQuery) => {
            // 1. Decode HTML entities (like &#39; to ')
            const doc = new DOMParser().parseFromString(resultTitle, "text/html");
            const decodedTitle = doc.documentElement.textContent.toLowerCase();
            
            // 2. Clean the title and query of special characters
            const cleanTitle = decodedTitle.replace(/[^a-z0-9\s]/g, "");
            const cleanQuery = originalQuery.toLowerCase().replace("karaoke", "").replace(/[^a-z0-9\s]/g, "").trim();
            
            // 3. Split query into words and check if ALL exist in title
            const keywords = cleanQuery.split(" ");
            return keywords.every(word => cleanTitle.includes(word));
        };

        // 1. Preferred Channels Loop
        for (const channelId of this.CONFIG.PREFERRED_CHANNELS) {
            console.log('Searching in preferred channel:', channelId);
            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(query)}&type=video&videoEmbeddable=true&channelId=${channelId}&key=${this.CONFIG.YOUTUBE_API_KEY}`;
        
            try {
                const res = await fetch(url);
                const data = await res.json();
                const item = data.items?.[0];

                if (item) {
                    // VALIDATION: Only return if it matches the keywords
                    if (isRelevant(item.snippet.title, query)) {
                        console.log(`✅ Found in preferred channel: ${channelId}`);
                        return { id: item.id.videoId, title: item.snippet.title };
                    } else {
                        console.warn(`⚠️ Found video but title didn't match closely: ${item.snippet.title}`);
                        // Continue to next channer if not relevant
                    }
                }
            } catch (err) {
                console.error(`❌Song not found in preferred channel: ${channelId}❗${err.message}`);
            }
        }

        console.log("🔍 Not in preferred channels. Searching globally...");
        const globalUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(query)}&type=video&videoEmbeddable=true&key=${this.CONFIG.YOUTUBE_API_KEY}`;

        try {
            const res = await fetch(globalUrl);
            const data = await res.json();
            const item = data.items?.[0];

            if (item && isRelevant(item.snippet.title, query)) {
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
        [this.elements.textPlayBtn, this.elements.textReserveBtn, this.elements.codePlayBtn, this.elements.codeReserveBtn]
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

    // Resets search inputs in both text and number search fields.
    clearSearchInputs() {
        this.elements.searchInput.value = "";
        this.elements.codeSearchInput.value = "";
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

    // Closes the score overlay and resumes the app flow.
    closeScore() {
        if (this.state.scoreAudio) this.state.scoreAudio.pause();
        this.elements.scoreOverlay.classList.remove('active');
        this.playNextInQueue();
        if (this.state.isMicActive) this.startScoring();

        // Security: Re-enable search controls
        [this.elements.textPlayBtn, this.elements.textReserveBtn, this.elements.codePlayBtn, this.elements.codeReserveBtn]
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
    showSongbookQR() {
        const modal = this.elements.qrModal;
        const qrContainer = this.elements.qrcode;
        if (!modal || !qrContainer) return;

        qrContainer.innerHTML = "";

        new QRCode(qrContainer, {
            text: "https://sirr4nd3l.github.io/randelkaraokeplayer.github.io/songbook.html",
            width: 200,
            height: 200
        });

        modal.style.display = "flex";
    },

    closeSongbookQR() {
        this.elements.qrModal.style.display = "none";
    },

    openSongBook() {
        window.open('songbook.html', '_blank');
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
        const textContainer = this.elements.textsearchContainer;
        const codeContainer = this.elements.codeSearchContainer;
        const toggleBtn = this.elements.toggleSearchBtn;

        const isTextVisible = textContainer.style.display !== 'none';

        if (isTextVisible) {
            textContainer.style.display = 'none';
            codeContainer.style.display = '';
            toggleBtn.innerText = "Switch to Text Search";
            toggleBtn.classList.add('active');
        } else {
            textContainer.style.display = '';
            codeContainer.style.display = 'none';
            toggleBtn.innerText = "Switch to Number Search";
            toggleBtn.classList.remove('active');
        }
    },


    attachEventListeners() {
        document.addEventListener('keydown', (e) => this.handleGlobalKeyDown(e));
        // The volume change and fullscreen toggle can be called via buttons in HTML
    },

    // Maps physical keys (Z, X, C, B, F) to app actions.
    handleGlobalKeyDown(event) {
        // Priority: If the QR modal is active, Enter or Escape closes it
        if (this.elements.qrModal && this.elements.qrModal.style.display === 'flex') {
            if (event.key === 'Enter' || event.key === 'Escape') {
                this.closeSongbookQR();
                event.preventDefault();
            }
            return;
        }

        // Priority: If the custom alert is active, Enter closes it
        if (this.elements.customAlert && this.elements.customAlert.style.display === 'flex') {
            if (event.key === 'Enter') {
                this.closeCustomAlert();
                event.preventDefault(); // Stop Enter from triggering search underneath
            }
            return; // Block other shortcuts while alert is active
        }

        if (document.activeElement === this.elements.searchInput || document.activeElement === this.elements.codeSearchInput) {
            if (event.key === 'Enter') {
                const playerState = this.state.player && typeof this.state.player.getPlayerState === 'function' ? 
                                   this.state.player.getPlayerState() : -1;
                const isSongActive = playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING;
                
                const playNow = event.shiftKey ? false : !isSongActive;

                if (document.activeElement === this.elements.searchInput) {
                    this.handleSearch(playNow);
                } else {
                    this.playByCode(playNow);
                }
            }
            return;
        }
        const map = {
            'z': () => this.state.player.playVideo(),
            'x': () => this.state.player.pauseVideo(),
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
window.loadVideo = (playNow) => KaraokeApp.handleSearch(playNow);
window.restartVideo = () => KaraokeApp.restartVideo();
window.toggleFullscreen = () => KaraokeApp.toggleFullscreen();
window.changeVolume = (val) => KaraokeApp.state.player?.setVolume(val);
window.playVideo = () => KaraokeApp.state.player?.playVideo();
window.pauseVideo = () => KaraokeApp.state.player?.pauseVideo();
window.cancelCurrentSong = () => KaraokeApp.playNextInQueue();
window.closeScore = () => KaraokeApp.closeScore();
window.playByCode = (id) => KaraokeApp.playByCode(id);
window.toggleSearchMode = () => KaraokeApp.toggleSearchMode();
window.closeCustomAlert = () => KaraokeApp.closeCustomAlert();
window.openSongBook = () => KaraokeApp.openSongBook();
window.showSongbookQR = () => KaraokeApp.showSongbookQR();
window.closeSongbookQR = () => KaraokeApp.closeSongbookQR();

// --- 12. App Launch ---
// Self-executing initialization on DOM load.
document.addEventListener('DOMContentLoaded', () => KaraokeApp.init());
