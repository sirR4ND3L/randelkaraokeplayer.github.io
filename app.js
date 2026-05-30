/**
 * Karaoke Pro - Next-Gen Experience
 * Refactored for Robustness and Maintainability
 */

const KaraokeApp = {
    // Configuration & Constants
    CONFIG: {
        YOUTUBE_API_KEY: "AIzaSyBthjxnP2yj4_3tLVFhVHqRi7TwP2_jUlI",
        CACHE_ENDPOINT: "https://karaoke-backend-topaz.vercel.app/api/karaoke-cache",
        INVIDIOUS_INSTANCES: [
            'https://invidious.nerdvpn.de/api/v1/search?q=',
            'https://invidious.lunar.icu/api/v1/search?q='
        ],
        SOUND_EFFECTS: {
            CHEER: "scoreSound.mp3",
            SUCCESS: "scoreSound.mp3",
            FAIL: "scoreSound.mp3"
        }
    },

    // Application State
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

    // Cached DOM Elements
    elements: {},

    init() {
        this.cacheElements();
        this.loadYouTubeAPI();
        this.attachEventListeners();
        this.initMobileScaling();
    },

    cacheElements() {
        const ids = [
            'player', 'nowPlaying', 'playerPlaceholder', 'dynamicIsland', 
            'queueList', 'searchInput', 'videoContainer', 'audioStatus', 
            'audioText', 'scoreMeter', 'liveScoreBadge', 'scoreBarFill', 
            'liveScoreValue', 'liveScorePlayer', 'scoreOverlay', 'finalScore', 
            'finalRank', 'finalMessage'
        ];
        ids.forEach(id => this.elements[id] = document.getElementById(id));
        this.elements.searchContainer = document.querySelector('.search-container');
        this.elements.searchButtons = document.querySelectorAll('.search-container button');
    },

    loadYouTubeAPI() {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
        // Global callback for YT API
        window.onYouTubeIframeAPIReady = () => this.onYouTubeIframeAPIReady();
    },

    onYouTubeIframeAPIReady() {
        this.state.player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            playerVars: { 'rel': 0, 'iv_load_policy': 3, 'controls': 0, 'disablekb': 1 },
            events: {
                'onReady': () => this.onPlayerReady(),
                'onStateChange': (e) => this.onPlayerStateChange(e)
            }
        });
    },

    onPlayerReady() {
        this.startSync();
        this.state.player.setVolume(100);
    },

    onPlayerStateChange(event) {
        if (event.data === YT.PlayerState.ENDED) {
            this.state.isMicActive ? this.showFinalScore() : this.playNextInQueue();
        }
    },

    // --- Search Logic ---

    async handleSearch(playNow = true) {
        const query = this.elements.searchInput.value.trim();
        if (!query) return;

        console.log("🔍 Raw Input:", query);

        // Handle Direct Links
        const directId = this.extractVideoId(query);
        if (directId) {
            this.elements.searchInput.value = "";
            this.handleFoundVideo(directId, playNow, "Direct Link / ID: " + directId);
            return;
        }

        const searchBtn = playNow ? this.elements.searchButtons[0] : this.elements.searchButtons[1];
        const originalText = searchBtn.innerText;

        this.setSearchLoading(true, searchBtn);

        try {
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
                if (!result) result = await this.fetchFromInvidious(processedQuery);
                
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
            } else {
                alert("Search failed. Please try a different song.");
            }
        } catch (err) {
            console.error("Search error:", err);
        } finally {
            this.setSearchLoading(false, searchBtn, originalText);
        }
    },

    async fetchFromCache(query) {
        console.log(`🚀 Starting cache lookup for: ${query}`);
        try {
            const res = await fetch(`${this.CONFIG.CACHE_ENDPOINT}?query=${encodeURIComponent(query)}`);
            if (!res.ok) return null;
            const data = await res.json();
            console.log("📦 Cache Response:", data);
            return (data.found || data.videoId) ? { id: data.videoId, title: data.videoTitle || data.title } : null;
        } catch (err) {
            console.error(`❌ Cache fetch error: ${err.message}`);
            return null;
        }
    },

    async fetchFromYouTubeAPI(query) {
        if (!this.CONFIG.YOUTUBE_API_KEY) return null;
        try {
            const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(query)}&type=video&videoEmbeddable=true&key=${this.CONFIG.YOUTUBE_API_KEY}`);
            const data = await res.json();
            return data.items?.[0] ? { id: data.items[0].id.videoId, title: data.items[0].snippet.title } : null;
        } catch { return null; }
    },

    async fetchFromInvidious(query) {
        for (let baseUrl of this.CONFIG.INVIDIOUS_INSTANCES) {
            try {
                const res = await fetch(baseUrl + encodeURIComponent(query));
                const data = await res.json();
                const video = data.find(item => item.videoId);
                if (video) return { id: video.videoId, title: video.title };
            } catch { continue; }
        }
        return null;
    },

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

    // --- Queue & Playback ---

    handleFoundVideo(id, playNow, title, thumbnail = null) {
        const song = { id, title: title || `Video: ${id}`, thumbnail: thumbnail || `https://img.youtube.com/vi/${id}/mqdefault.jpg` };

        if (playNow) {
            this.resetScore();
            this.state.player.loadVideoById(id);
            this.updateNowPlayingUI(song.title);
        } else {
            this.state.songQueue.push(song);
            this.updateQueueUI();
            const playerState = this.state.player.getPlayerState();
            if (playerState === YT.PlayerState.ENDED || playerState === -1 || playerState === YT.PlayerState.CUED) {
                this.playNextInQueue();
            }
        }
    },

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

    updateNowPlayingUI(title) {
        const { nowPlaying, playerPlaceholder, dynamicIsland } = this.elements;
        if (title) {
            nowPlaying.innerText = "🎵 " + title;
            playerPlaceholder.classList.add('hidden');
            dynamicIsland.classList.add('active');
        } else {
            nowPlaying.innerText = "Ready to Sing";
            playerPlaceholder.classList.remove('hidden');
            dynamicIsland.classList.remove('active');
        }
    },

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

    removeFromQueue(index) {
        this.state.songQueue.splice(index, 1);
        this.updateQueueUI();
    },

    // --- Audio & Scoring ---

    async toggleMic() {
        const { audioStatus, audioText, scoreMeter, liveScoreBadge } = this.elements;

        if (this.state.isMicActive) {
            this.stopScoring();
            if (this.state.micStream) this.state.micStream.getTracks().forEach(t => t.stop());
            this.state.isMicActive = false;
            audioStatus.classList.remove('active');
            audioText.innerText = "Mic: Off";
            [scoreMeter, liveScoreBadge].forEach(el => el.style.display = "none");
            return;
        }

        try {
            this.state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!this.state.audioContext) this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            this.state.micAnalyser = this.state.audioContext.createAnalyser();
            this.state.micAnalyser.fftSize = 2048;
            this.state.audioContext.createMediaStreamSource(this.state.micStream).connect(this.state.micAnalyser);
            this.state.micBuffer = new Float32Array(this.state.micAnalyser.fftSize);
            
            this.state.isMicActive = true;
            audioStatus.classList.add('active');
            audioText.innerText = "Mic: On";
            [scoreMeter, liveScoreBadge].forEach(el => el.style.display = "flex");
            this.startScoring();
        } catch (err) {
            alert("Microphone access is required for scoring.");
        }
    },

    updateScore() {
        if (!this.state.isMicActive || !this.state.micAnalyser) return;
        if (this.state.player.getPlayerState() !== YT.PlayerState.PLAYING) return;

        this.state.micAnalyser.getFloatTimeDomainData(this.state.micBuffer);
        let sum = 0;
        for (let i = 0; i < this.state.micBuffer.length; i++) sum += this.state.micBuffer[i] ** 2;
        const energy = Math.sqrt(sum / this.state.micBuffer.length) * 100;
        const pitch = this.autoCorrelate(this.state.micBuffer, this.state.audioContext.sampleRate);

        this.state.possiblePoints += 1;
        if (energy > 3.0) {
            let mult = pitch > 0 ? (Math.abs(pitch - this.state.lastDetectedPitch) > 5 ? 1.3 : 0.3) : 0.4;
            this.state.earnedPoints += Math.min((energy / 15) * mult, 1.2);
            this.state.lastDetectedPitch = pitch;
        }

        this.state.currentScore = (this.state.earnedPoints / this.state.possiblePoints) * 100;
        const display = Math.min(Math.floor(this.state.currentScore), 100);
        this.elements.scoreBarFill.style.width = display + "%";
        this.elements.liveScoreValue.innerText = display;
        this.elements.liveScorePlayer.innerText = display;
    },

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
    },

    getRankData(score) {
        if (score >= 95) return { rank: 'legendary', label: "Legendary", color: "#ffcc00", msg: "Masterpiece!" };
        if (score >= 85) return { rank: 'rockstar', label: "Rockstar", color: "#007aff", msg: "Incredible!" };
        if (score >= 70) return { rank: 'pro', label: "Pro", color: "#4cd964", msg: "Great job!" };
        if (score >= 40) return { rank: 'amateur', label: "Amateur", color: "#ff9500", msg: "Not bad!" };
        return { rank: 'beginner', label: "Beginner", color: "#ff3b30", msg: "Keep practicing!" };
    },

    startFinalScoreTimer() {
        let seconds = 15;
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
    },

    // --- Utilities ---

    extractVideoId(query) {
        try {
            const url = new URL(query);
            if (url.hostname.includes('youtube.com')) return url.searchParams.get('v');
            if (url.hostname === 'youtu.be') return url.pathname.slice(1);
        } catch {}
        return (query.length === 11 && !query.includes(' ')) ? query : null;
    },

    setSearchLoading(isLoading, btn, text) {
        btn.innerText = isLoading ? "Searching..." : text;
        btn.disabled = isLoading;
        this.elements.searchContainer.classList.toggle('loading', isLoading);
    },

    startScoring() {
        if (this.state.scoringInterval) clearInterval(this.state.scoringInterval);
        this.state.scoringInterval = setInterval(() => this.updateScore(), 200);
    },

    stopScoring() {
        clearInterval(this.state.scoringInterval);
        this.state.scoringInterval = null;
    },

    resetScore() {
        Object.assign(this.state, { currentScore: 0, earnedPoints: 0, possiblePoints: 0, isScoreRevealed: false, lastDetectedPitch: 0 });
        this.elements.scoreBarFill.style.width = "0%";
        this.elements.liveScoreValue.innerText = "0";
        this.elements.liveScorePlayer.innerText = "0";
    },

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

    playScoreSound(rank) {
        if (this.state.scoreAudio) this.state.scoreAudio.pause();
        const sound = ['legendary', 'rockstar'].includes(rank) ? this.CONFIG.SOUND_EFFECTS.CHEER : 
                      ['pro', 'amateur'].includes(rank) ? this.CONFIG.SOUND_EFFECTS.SUCCESS : this.CONFIG.SOUND_EFFECTS.FAIL;
        this.state.scoreAudio = new Audio(sound);
        this.state.scoreAudio.volume = 0.5;
        this.state.scoreAudio.play().catch(() => {});
    },

    closeScore() {
        if (this.state.scoreAudio) this.state.scoreAudio.pause();
        this.elements.scoreOverlay.classList.remove('active');
        this.playNextInQueue();
        if (this.state.isMicActive) this.startScoring();
    },

    startSync() {
        setInterval(() => {
            if (!this.state.player?.getCurrentTime) return;
            const remain = this.state.player.getDuration() - this.state.player.getCurrentTime();
            if (remain <= 0.5 && this.state.player.getPlayerState() === YT.PlayerState.PLAYING) {
                this.state.isMicActive ? this.showFinalScore() : this.playNextInQueue();
            }
        }, 100);
    },

    // --- Event Listeners ---

    attachEventListeners() {
        document.addEventListener('keydown', (e) => this.handleGlobalKeyDown(e));
        // The volume change and fullscreen toggle can be called via buttons in HTML
    },

    handleGlobalKeyDown(event) {
        if (document.activeElement === this.elements.searchInput) {
            if (event.key === 'Enter') this.handleSearch(!event.shiftKey);
            return;
        }
        const map = {
            'z': () => this.state.player.playVideo(),
            'x': () => this.state.player.pauseVideo(),
            'c': () => this.restartVideo(),
            'b': () => this.playNextInQueue(),
            'f': () => this.toggleFullscreen()
        };
        const action = map[event.key.toLowerCase()];
        if (action) action();
    },

    restartVideo() {
        this.elements.scoreOverlay.classList.remove('active');
        this.resetScore();
        this.state.player.seekTo(0);
        this.state.player.playVideo();
        if (this.state.isMicActive) this.startScoring();
    },

    toggleFullscreen() {
        const container = this.elements.videoContainer;
        if (!document.fullscreenElement) container.requestFullscreen().catch(() => {});
        else document.exitFullscreen();
    },

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

// Initialize application
document.addEventListener('DOMContentLoaded', () => KaraokeApp.init());
