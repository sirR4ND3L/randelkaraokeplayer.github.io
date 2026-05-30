// Load YouTube IFrame API
var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
document.body.appendChild(tag);

var player;
var songQueue = [];

const SOUND_EFFECTS = {
    CHEER: "scoreSound.mp3",
    SUCCESS: "scoreSound.mp3",
    FAIL: "scoreSound.mp3"
};

function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        playerVars: {
            'rel': 0,
            'iv_load_policy': 3,
            'controls': 0,
            'disablekb': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
        if (visualizerInitialized) {
            showFinalScore();
        } else {
            playNextInQueue();
        }
    }
}

function setNowPlaying(title) {
    const el = document.getElementById('nowPlaying');
    const placeholder = document.getElementById('playerPlaceholder');
    const island = document.getElementById('dynamicIsland');
    
    if (title) {
        el.innerText = "🎵 " + title;
        placeholder.classList.add('hidden');
        island.classList.add('active');
    } else {
        el.innerText = "Ready to Sing";
        placeholder.classList.remove('hidden');
        island.classList.remove('active');
    }
}

function playNextInQueue() {
    resetScore();
    if (songQueue.length > 0) {
        let nextSong = songQueue.shift();
        player.loadVideoById(nextSong.id);
        setNowPlaying(nextSong.title);
        updateQueueUI();
    } else {
        let videoData = player.getVideoData();
        if (videoData && videoData.video_id) {
            player.cueVideoById(videoData.video_id);
        } else {
            player.stopVideo();
        }
        setNowPlaying("");
    }
}

function removeFromQueue(index) {
    songQueue.splice(index, 1);
    updateQueueUI();
}

function updateQueueUI() {
    const list = document.getElementById('queueList');
    if (songQueue.length === 0) {
        list.innerHTML = '<li style="justify-content: center; color: var(--text-secondary); font-style: italic; border: none; background: transparent;">Queue is empty</li>';
        return;
    }
    list.innerHTML = '';
    songQueue.forEach((song, index) => {
        let li = document.createElement('li');
        
        if (index === 0) {
            let tag = document.createElement('div');
            tag.className = 'next-tag';
            tag.innerText = 'Next Up';
            li.appendChild(tag);
        }

        let img = document.createElement('img');
        img.className = 'song-thumb';
        img.src = song.thumbnail || `https://img.youtube.com/vi/${song.id}/mqdefault.jpg`;
        img.alt = '';

        let info = document.createElement('div');
        info.className = 'song-info';

        let title = document.createElement('span');
        title.className = 'song-title';
        title.innerText = song.title;

        let meta = document.createElement('div');
        meta.className = 'song-meta';
        meta.innerText = `Pos: ${index + 1} • Ready to sing`;

        info.appendChild(title);
        info.appendChild(meta);

        let removeBtn = document.createElement('button');
        removeBtn.className = 'queue-remove-btn';
        removeBtn.innerHTML = '✕';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeFromQueue(index);
        };

        li.appendChild(img);
        li.appendChild(info);
        li.appendChild(removeBtn);
        list.appendChild(li);
    });
}

function handleFoundVideo(id, playNow, title, thumbnail = null) {
    let songName = title || "Video: " + id;
    let thumbUrl = thumbnail || `https://img.youtube.com/vi/${id}/mqdefault.jpg`;

    if (playNow) {
        resetScore();
        player.loadVideoById(id);
        setNowPlaying(songName);
    } else {
        songQueue.push({ id: id, title: songName, thumbnail: thumbUrl });
        updateQueueUI();

        let state = player.getPlayerState ? player.getPlayerState() : -1;
        if (state === YT.PlayerState.ENDED || state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED || state === -1) {
            playNextInQueue();
        }
    }
}

function onPlayerReady() {
    startSync();
    player.setVolume(100);
}

function playVideo() {
    player.playVideo();
}

function pauseVideo() {
    player.pauseVideo();
}

function restartVideo() {
    if (scoreAudio) {
        scoreAudio.pause();
        scoreAudio = null;
    }
    document.getElementById('scoreOverlay').classList.remove('active');
    
    let videoData = player.getVideoData();
    if (videoData && videoData.title) {
        setNowPlaying(videoData.title);
    }
    
    resetScore();
    player.seekTo(0);
    player.playVideo();
    if (visualizerInitialized) startScoring();
}

function changeVolume(val) {
    if (player && player.setVolume) {
        player.setVolume(val);
    }
}

function toggleFullscreen() {
    const container = document.getElementById('videoContainer');
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => {
            console.error("Error attempting to enable fullscreen:", err);
        });
    } else {
        document.exitFullscreen();
    }
}

async function loadVideo(playNow = true) {
    let rawQuery = document.getElementById('searchInput').value.trim();
    if (!rawQuery) return;

    // 1. Direct YouTube URL or ID parsing
    let videoId = null;
    try {
        let url = new URL(rawQuery);
        if (url.hostname.includes('youtube.com')) {
            videoId = url.searchParams.get('v');
        } else if (url.hostname === 'youtu.be') {
            videoId = url.pathname.slice(1);
        }
    } catch (e) { }

    if (!videoId && rawQuery.length === 11 && !rawQuery.includes(' ')) {
        videoId = rawQuery;
    }

    if (videoId) {
        document.getElementById('searchInput').value = "";
        handleFoundVideo(videoId, playNow, "Direct Link / ID: " + videoId);
        return;
    }

    // 2. Setup UI state for searching
    let searchBtn = document.querySelector('.search-container button');
    let originalText = searchBtn.innerText;
    searchBtn.innerText = "Searching...";
    searchBtn.disabled = true;

    // --- DEBUG: Show raw input ---
    console.log("🔍 Raw Input:", rawQuery);

    // ✨ LOGIC PATCH: Lowercase, remove quotes, and clear multiple spaces
    let processedQuery = rawQuery.toLowerCase().replace(/['"]/g, "").replace(/\s+/g, " ");

    // Append the karaoke suffix if missing to mirror mobile behavior perfectly
    if (!processedQuery.includes("karaoke")) {
        processedQuery += " karaoke";
    }

    // Structural normalization pass
    const cleanCacheQuery = processedQuery.trim().replace(/\s+/g, " ");

    // --- DEBUG: Show formatted query ---
    console.log("🛠️ Formatted Cache Query:", cleanCacheQuery);

    // --- CACHE-FIRST STRATEGY ---
    const CACHE_ENDPOINT = "https://karaoke-backend-topaz.vercel.app/api/karaoke-cache"; 
    let foundId = null;
    let foundTitle = null;

    try {
        console.log("📡 Checking Cache...");
        // Query param points directly to our unified clean format string
        const cacheRes = await fetch(`${CACHE_ENDPOINT}?query=${encodeURIComponent(cleanCacheQuery)}`);
        
        if (cacheRes.ok) {
            const cacheData = await cacheRes.json();
            // --- DEBUG: Show backend response ---
            console.log("📦 Cache Response:", cacheData);
            if (cacheData.found || cacheData.videoId) {
                foundId = cacheData.videoId;
                foundTitle = cacheData.videoTitle || cacheData.title; 
                console.log("✅ Cache Hit! Found:", foundId);
            } else {
                console.log("⚠️ Cache Miss. Moving to API Fallback.");
            }
        }
    } catch (e) { 
        console.error("❌ Cache Error:", e);
    }

    // --- API FALLBACK (If Cache Miss) ---
    if (!foundId) {
        console.log("🌐 Starting API Fallback search for:", cleanCacheQuery);
        const YOUTUBE_API_KEY = "AIzaSyBthjxnP2yj4_3tLVFhVHqRi7TwP2_jUlI";

        // Try YouTube API
        if (YOUTUBE_API_KEY.length > 20 && !YOUTUBE_API_KEY.includes('YOUR_API_KEY')) {
            try {
                let res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(cleanCacheQuery)}&type=video&videoEmbeddable=true&key=${YOUTUBE_API_KEY}`);
                if (res.ok) {
                    let data = await res.json();
                    if (data.items?.length > 0) {
                        foundId = data.items[0].id.videoId;
                        foundTitle = data.items[0].snippet.title;
                    }
                }
            } catch (e) { console.error("YouTube API Error:", e); }
        }

        // Try Invidious Fallback
        if (!foundId) {
            const instances = ['https://invidious.nerdvpn.de/api/v1/search?q=', 'https://invidious.lunar.icu/api/v1/search?q='];
            for (let baseUrl of instances) {
                try {
                    let res = await fetch(baseUrl + encodeURIComponent(cleanCacheQuery));
                    let data = await res.json();
                    let video = data.find(item => item.videoId);
                    if (video) {
                        foundId = video.videoId;
                        foundTitle = video.title;
                        break;
                    }
                } catch (e) { continue; }
            }
        }

        // --- SAVE TO CACHE (Only if result found via API) ---
        if (foundId && foundTitle) {
            console.log("✨ Found via API:", foundId)
            fetch(CACHE_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: cleanCacheQuery, // 💾 Saves structural string '14 karaoke' 
                    videoId: foundId, 
                    videoTitle: foundTitle 
                })
            })
            .then(res => {
                if (res.ok) console.log("💾 Successfully Saved to Supabase Cloud Cache!");
            })
            .catch(e => console.error("Cache Save Error:", e));
        }
    }

    // 3. Finalize UI state and handle results
    searchBtn.innerText = originalText;
    searchBtn.disabled = false;

    if (foundId) {
        document.getElementById('searchInput').value = "";
        handleFoundVideo(foundId, playNow, foundTitle || cleanCacheQuery);
    } else {
        alert("Search failed. Please try a different song or paste a YouTube URL.");
    }
}

// =========================================================================
// 🎙️ MIC-ONLY ADVANCED PITCH-TRACKING SCORING ENGINE
// =========================================================================
let audioContext;
let micAnalyser;
let micBuffer; 
let micStream;
let visualizerInitialized = false;

let currentScore = 0;
let earnedPoints = 0;
let possiblePoints = 0;
let scoringInterval;
let isScoreRevealed = false;
let scoreAudio = null;

let lastDetectedPitch = 0; 

async function toggleVisualizer() {
    const statusEl = document.getElementById('audioStatus');
    const textEl = document.getElementById('audioText');
    const scoreMeter = document.getElementById('scoreMeter');
    const liveBadge = document.getElementById('liveScoreBadge');

    if (visualizerInitialized) {
        stopScoring();
        if (micStream) micStream.getTracks().forEach(track => track.stop());
        visualizerInitialized = false;
        statusEl.classList.remove('active');
        textEl.innerText = "Mic: Off";
        scoreMeter.style.display = "none";
        liveBadge.style.display = "none";
        return;
    }

    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        micAnalyser = audioContext.createAnalyser();
        micAnalyser.fftSize = 2048; 
        
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(micAnalyser);
        
        micBuffer = new Float32Array(micAnalyser.fftSize);
        
        visualizerInitialized = true;
        statusEl.classList.add('active');
        textEl.innerText = "Mic: On";
        scoreMeter.style.display = "flex";
        liveBadge.style.display = "flex";
        
        startScoring();
        
    } catch (err) {
        console.error("Audio access denied:", err);
        alert("Scoring requires Microphone access. Please grant mic permission to sing!");
        
        if (micStream) micStream.getTracks().forEach(track => track.stop());
        visualizerInitialized = false;
    }
}

function startScoring() {
    if (scoringInterval) clearInterval(scoringInterval);
    scoringInterval = setInterval(updateScore, 200); 
}

function stopScoring() {
    if (scoringInterval) clearInterval(scoringInterval);
    scoringInterval = null;
}

function autoCorrelate(buffer, sampleRate) {
    let size = buffer.length;
    let rms = 0;

    for (let i = 0; i < size; i++) {
        let val = buffer[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / size);
    
    if (rms < 0.015) return -1; 

    let r1 = 0, r2 = size - 1;
    let thres = 0.2;
    for (let i = 0; i < size / 2; i++) {
        if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
    }
    for (let i = size - 1; i >= size / 2; i--) {
        if (Math.abs(buffer[i]) < thres) { r2 = i; break; }
    }
    let clippedBuffer = buffer.slice(r1, r2);
    let clippedSize = clippedBuffer.length;

    let c = new Float32Array(clippedSize);
    for (let i = 0; i < clippedSize; i++) {
        for (let j = 0; j < clippedSize - i; j++) {
            c[i] += clippedBuffer[j] * clippedBuffer[j + i];
        }
    }

    let d = 0;
    while (c[d] > 0) d++;
    
    let maxVal = -1;
    let maxPeriod = -1;
    for (let i = d; i < clippedSize; i++) {
        if (c[i] > maxVal) {
            maxVal = c[i];
            maxPeriod = i;
        }
    }

    let fundamentalFrequency = sampleRate / maxPeriod;
    if (fundamentalFrequency > 50 && fundamentalFrequency < 2000) {
        return fundamentalFrequency;
    }
    return -1;
}

function updateScore() {
    if (!visualizerInitialized || !micAnalyser) return;
    
    const isPlaying = player && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING;
    if (!isPlaying) return;

    micAnalyser.getFloatTimeDomainData(micBuffer);

    let sumSquares = 0;
    for (let i = 0; i < micBuffer.length; i++) {
        sumSquares += micBuffer[i] * micBuffer[i];
    }
    let vocalVolumeEnergy = Math.sqrt(sumSquares / micBuffer.length) * 100;

    let currentPitch = autoCorrelate(micBuffer, audioContext.sampleRate);
    possiblePoints += 1.0;

    if (vocalVolumeEnergy > 3.0) {
        let frameMultiplier = 1.0;

        if (currentPitch > 0) {
            if (lastDetectedPitch > 0) {
                let pitchDelta = Math.abs(currentPitch - lastDetectedPitch);
                if (pitchDelta === 0) {
                    frameMultiplier = 0.3; 
                } else if (pitchDelta > 5 && pitchDelta < 40) {
                    frameMultiplier = 1.3; 
                } else if (pitchDelta > 120) {
                    frameMultiplier = 0.2; 
                }
            }
            lastDetectedPitch = currentPitch;
        } else {
            frameMultiplier = 0.4;
        }

        let earnedTick = Math.min((vocalVolumeEnergy / 15) * frameMultiplier, 1.2);
        earnedPoints += earnedTick;
    } else {
        lastDetectedPitch = 0;
    }

    if (possiblePoints > 0) {
        currentScore = (earnedPoints / possiblePoints) * 100;
    }

    const displayScore = Math.min(Math.floor(currentScore), 100);
    document.getElementById('scoreBarFill').style.width = displayScore + "%";
    document.getElementById('liveScoreValue').innerText = displayScore;
    document.getElementById('liveScorePlayer').innerText = displayScore;
}

function showFinalScore() {
    if (!visualizerInitialized || isScoreRevealed) return;
    isScoreRevealed = true;

    const score = Math.min(Math.floor(currentScore), 100);
    const overlay = document.getElementById('scoreOverlay');
    const scoreEl = document.getElementById('finalScore');
    const rankEl = document.getElementById('finalRank');
    const msgEl = document.getElementById('finalMessage');

    scoreEl.innerText = score;
    
    let rank = "";
    if (score >= 95) {
        rank = "legendary";
        rankEl.innerText = "Legendary";
        rankEl.style.color = "#ffcc00";
        msgEl.innerText = "Absolute masterpiece! You're a star!";
    } else if (score >= 85) {
        rank = "rockstar";
        rankEl.innerText = "Rockstar";
        rankEl.style.color = "#007aff";
        msgEl.innerText = "Incredible performance! The crowd loves you!";
    } else if (score >= 70) {
        rank = "pro";
        rankEl.innerText = "Pro";
        rankEl.style.color = "#4cd964";
        msgEl.innerText = "Great job! Your timing was excellent.";
    } else if (score >= 40) {
        rank = "amateur";
        rankEl.innerText = "Amateur";
        rankEl.style.color = "#ff9500";
        msgEl.innerText = "Not bad! Keep practicing to hit those high notes.";
    } else {
        rank = "beginner";
        rankEl.innerText = "Beginner";
        rankEl.style.color = "#ff3b30";
        msgEl.innerText = "Nice try! Sing louder and stay with the beat.";
    }

    overlay.classList.add('active');
    stopScoring();
    playScoreSound(rank);

    if (scoreAudio) {
        if (songQueue.length > 0) {
            msgEl.innerText = "Waiting for sound...";
        } else {
            msgEl.innerText = "Done! Select a new song or wait...";
        }
        
        scoreAudio.addEventListener('timeupdate', () => {
            if (overlay.classList.contains('active') && !isNaN(scoreAudio.duration)) {
                const remaining = Math.ceil(scoreAudio.duration - scoreAudio.currentTime);
                if (songQueue.length > 0) {
                    msgEl.innerText = `Next song in ${remaining}s...`;
                } else {
                    msgEl.innerText = `Closing in ${remaining}s...`;
                }
            }
        });

        scoreAudio.addEventListener('ended', () => {
            if (overlay.classList.contains('active')) {
                closeScore();
            }
        });

        scoreAudio.addEventListener('error', startFallbackTimer);
    } else {
        startFallbackTimer();
    }

    function startFallbackTimer() {
        let secondsLeft = 15;
        if (songQueue.length > 0) {
            msgEl.innerText = `Next song in ${secondsLeft}s...`;
        } else {
            msgEl.innerText = `Closing in ${secondsLeft}s...`;
        }
        const timer = setInterval(() => {
            secondsLeft--;
            if (secondsLeft <= 0 || !overlay.classList.contains('active')) {
                clearInterval(timer);
                if (overlay.classList.contains('active')) closeScore();
            } else {
                if (songQueue.length > 0) {
                    msgEl.innerText = `Next song in ${secondsLeft}s...`;
                } else {
                    msgEl.innerText = `Closing in ${secondsLeft}s...`;
                }
            }
        }, 1000);
    }
}

function playScoreSound(rank) {
    if (scoreAudio) {
        scoreAudio.pause();
        scoreAudio = null;
    }

    let soundUrl = "";
    switch(rank) {
        case 'legendary':
        case 'rockstar':
            soundUrl = SOUND_EFFECTS.CHEER;
            break;
        case 'pro':
        case 'amateur':
            soundUrl = SOUND_EFFECTS.SUCCESS;
            break;
        default:
            soundUrl = SOUND_EFFECTS.FAIL;
    }
    
    scoreAudio = new Audio(soundUrl);
    scoreAudio.volume = 0.5;
    scoreAudio.play().catch(e => console.log("Sound blocked by browser policy until user interacts."));
}

function closeScore() {
    if (scoreAudio) {
        scoreAudio.pause();
        scoreAudio = null;
    }
    document.getElementById('scoreOverlay').classList.remove('active');
    playNextInQueue();
    if (visualizerInitialized) startScoring();
}

function resetScore() {
    currentScore = 0;
    earnedPoints = 0;
    possiblePoints = 0;
    isScoreRevealed = false;
    lastDetectedPitch = 0;
    document.getElementById('scoreBarFill').style.width = "0%";
    document.getElementById('liveScoreValue').innerText = "0";
    document.getElementById('liveScorePlayer').innerText = "0";
}

function startSync() {
    setInterval(() => {
        if (!player || !player.getCurrentTime) return;

        const currentTime = player.getCurrentTime();
        const duration = player.getDuration();

        if (duration) {
            if (duration - currentTime <= 0.5 && player.getPlayerState() === YT.PlayerState.PLAYING) {
                if (visualizerInitialized) {
                    showFinalScore();
                } else {
                    playNextInQueue();
                }
            }
        }
    }, 100);
}

function cancelCurrentSong() {
    resetScore();
    if (songQueue.length > 0) {
        playNextInQueue();
    } else {
        if (player && player.stopVideo) {
            player.stopVideo();
        }
        setNowPlaying("");
    }
}

document.addEventListener('keydown', function (event) {
    const searchInput = document.getElementById('searchInput');
    const isInputFocused = document.activeElement === searchInput;

    if (isInputFocused) {
        if (event.key === 'Enter') {
            if (event.shiftKey) {
                loadVideo(false);
            } else {
                loadVideo(true);
            }
        }
        return;
    }

    switch (event.key.toLowerCase()) {
        case 'z': playVideo(); break;
        case 'x': pauseVideo(); break;
        case 'c': restartVideo(); break;
        case 'b': cancelCurrentSong(); break;
        case 'f': toggleFullscreen(); break;
    }
});

(function(){
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    function applyMobileVariables(width) {
        const base = 375; 
        const ratio = clamp(width / base, 0.6, 1);

        const buttonSize = Math.round(clamp(44 * ratio, 34, 52));
        const iconSize = Math.round(clamp(buttonSize * 0.45, 12, 22));
        const thumbW = Math.round(clamp(60 * ratio, 40, 72));
        const thumbH = Math.round(clamp(45 * ratio, 30, 54));
        const scoreNumber = Math.round(clamp(120 * ratio, 40, 120));

        const root = document.documentElement;
        root.style.setProperty('--mobile-button-size', buttonSize + 'px');
        root.style.setProperty('--mobile-icon-size', iconSize + 'px');
        root.style.setProperty('--mobile-song-thumb-width', thumbW + 'px');
        root.style.setProperty('--mobile-song-thumb-height', thumbH + 'px');
        root.style.setProperty('--mobile-score-number-size', scoreNumber + 'px');

        root.style.setProperty('--detected-viewport-width', Math.round(width) + 'px');
        root.style.setProperty('--detected-device-dpr', (window.devicePixelRatio || 1).toString());
    }

    function detectAndApply() {
        const chosen = window.innerWidth || document.documentElement.clientWidth || screen.width || 375;
        applyMobileVariables(chosen);
    }

    let resizeTimer = null;
    function schedule() {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { detectAndApply(); resizeTimer = null; }, 120);
    }

    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    document.addEventListener('DOMContentLoaded', detectAndApply);
    detectAndApply();
})();
