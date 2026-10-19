// Randel Karaoke Player — manage.html
//
// Two audiences share this page:
//   • guests (public mode) — can search YouTube and add songs; entries are
//     saved as "pending review" (is_verified = false)
//   • admins (admin mode)  — can edit, verify, delete, run cleanup
//
// Hidden buttons are UX only. Supabase Row Level Security is the real gate:
// public writes go through the backend (/api/public-songs), admin writes go
// through the signed-in Supabase session.

// 1. CONFIGURATION & STATE
const CONFIG = {
    SUPABASE_URL: 'https://blbwxnbbdsqkxbuvcrtn.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsYnd4bmJiZHNxa3hidXZjcnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5Nzc5NDgsImV4cCI6MjA5NTU1Mzk0OH0._OH1HSCUO1DfZOzefGk-j7GT-M3HplVULlziFnn--18',
    TABLE_NAME: 'karaoke_search_cache',
    YOUTUBE_SEARCH_ENDPOINT: 'https://karaoke-backend-topaz.vercel.app/api/youtube-search',
    CACHE_ENDPOINT: 'https://karaoke-backend-topaz.vercel.app/api/karaoke-cache',
    PUBLIC_SONGS_ENDPOINT: 'https://karaoke-backend-topaz.vercel.app/api/public-songs',
    PREFERRED_CHANNELS: [
        'UCutZyApGOjqhOS-pp7yAj4Q', // ATOME KARAOKE
        'UCNbFgUCJj2Ls6LVzBbL8fqA', // KARAOKETV
        'UCjpmz7p9aFNuHP_AuQDxYRw', // HARANA KARAOKE
        'UCLibmOHbJSf1EAke-seSp8A' // Global karaoke tv
    ],
    MAX_SEARCH_RESULTS: 6,
    MAX_SONGS_RENDERED: 300
};

const supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

let confirmResolve = null;
let searchTimeout = null;
let refreshTimer = null;
let session = null;
let isAdmin = false;
let authReady = false;
let adminCheckFailed = false;
let searchMode = 'songbook';        // 'songbook' | 'youtube'
let searchResults = [];             // [{ id, title, source, songNumber }]
let addSongSubmitting = false;
let previewTimer = null;
let previewRequestId = 0;

// 2. ALERTS (customAlert.html)
async function loadGlobalComponents() {
    try {
        const response = await fetch('customAlert.html');
        if (!response.ok) throw new Error('Alert component not found');
        const html = await response.text();
        document.body.insertAdjacentHTML('afterbegin', html);
    } catch (err) {
        console.warn("Global component loader:", err.message);
    }
}

window.triggerCustomAlert = (message, title = "Alert") => {
    const modal = document.getElementById('customAlert');
    if (!modal) {
        alert(message);
        return;
    }

    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerText = message;

    const cancelBtn = document.getElementById('cancelAlert');
    if (cancelBtn) cancelBtn.style.display = 'none';

    modal.style.display = 'flex';
};

window.triggerCustomConfirm = (message, title = "Confirm") => {
    return new Promise((resolve) => {
        const modal = document.getElementById('customAlert');
        if (!modal) {
            resolve(confirm(message));
            return;
        }

        confirmResolve = resolve;
        document.getElementById('alertTitle').innerText = title;
        document.getElementById('alertMessage').innerText = message;

        const cancelBtn = document.getElementById('cancelAlert');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';

        modal.style.display = 'flex';
    });
};

window.closeCustomAlert = (result = true) => {
    const modal = document.getElementById('customAlert');
    if (modal) modal.style.display = 'none';

    if (confirmResolve) {
        confirmResolve(result);
        confirmResolve = null;
    }
};

function showAlert(message, title = "Alert") {
    if (window.triggerCustomAlert) window.triggerCustomAlert(message, title);
    else alert(message);
}

async function showConfirm(message, title = "Confirm") {
    if (window.triggerCustomConfirm) return await window.triggerCustomConfirm(message, title);
    return confirm(message);
}

// 3. REAL-TIME SUBSCRIPTION
supabaseClient
    .channel('karaoke-admin-refresh')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: CONFIG.TABLE_NAME },
        () => {
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                loadSongs();
            }, 500);
        }
    )
    .subscribe();

// 4. UTILITIES
const formatSongDisplay = (fullTitle) => {
    if (!fullTitle || !fullTitle.includes(' - ')) return { title: fullTitle || '', artist: '' };
    const [title, ...artistParts] = fullTitle.split(' - ');
    return { title, artist: artistParts.join(' - ') };
};

// Song fields are free text and are rendered into innerHTML by createSongCard,
// so anything that came from a database row must be escaped here.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[char]));

// The 6-digit number shown to singers. Falls back to the internal id while a
// database has not run the song_number migration yet.
const songNumberOf = (song) => String(song.song_number != null ? song.song_number : song.id);

// Every branch below funnels through this: the id ends up in innerHTML (the
// video preview) and in the database, so a URL like watch?v="><script>... must
// not be able to smuggle arbitrary text through as an "id".
const isValidVideoId = (id) => /^[\w-]{11}$/.test(String(id || ''));

// Accepts any of the URL shapes a person is likely to paste, plus a raw ID.
function extractYouTubeId(input) {
    const value = String(input || '').trim();
    if (!value) return null;

    if (isValidVideoId(value)) return value;

    try {
        const url = new URL(value);
        const candidate = url.hostname.includes('youtube.com')
            ? url.searchParams.get('v')
                || (url.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]+)/) || [])[1]
                || null
            : url.hostname === 'youtu.be'
                ? url.pathname.slice(1)
                : null;
        return isValidVideoId(candidate) ? candidate : null;
    } catch {}

    return null;
}

// Mirrors the cache key the player and remote build from their search boxes,
// so songs added here are found by the same text search as automatic ones.
function buildSearchQuery(title) {
    let query = String(title || '').toLowerCase().replace(/['"]/g, "").replace(/\s+/g, " ").trim();
    if (!query.includes("karaoke")) query += " karaoke";
    return query.replace(/[^a-z0-9]/g, "");
}

// PostgREST reports a missing column as a 400/42703-style error. Used for the
// song_number/source rollout so the page keeps working pre-migration.
const isMissingColumn = (error, columnName = null) => {
    if (!error) return false;
    const message = String(error.message || '');
    if (error.code === '42703' || error.code === 'PGRST204') return true;
    const looksLikeMissing = /does not exist|schema cache/i.test(message);
    return columnName ? looksLikeMissing && message.includes(columnName) : looksLikeMissing;
};

// YouTube's oEmbed endpoint needs no API key and answers CORS, so it is the
// cheapest way to read back the real title of a pasted video.
async function fetchVideoTitle(videoId) {
    try {
        const url = `https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&format=json`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(response.status === 404 ? 'not found' : `HTTP ${response.status}`);
        return await response.json();
    } catch (err) {
        console.warn('oEmbed lookup failed:', err.message);
        return null;
    }
}

// 5. ADD-SONG FORM PREVIEW
function setAddSongHint(message) {
    const hint = document.getElementById('addSongHint');
    if (hint) hint.textContent = message || '';
}

// Shows the pasted video straight away, so the person can confirm it really is
// the karaoke version before committing the row to the songbook. Debounced
// because "input" fires on every keystroke of a long URL.
function updateAddSongPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
        const preview = document.getElementById('newSongPreview');
        const input = document.getElementById('newSongVideo');
        if (!preview || !input) return;

        const typed = input.value.trim();
        if (!typed) {
            preview.hidden = true;
            preview.innerHTML = '';
            return;
        }

        const videoId = extractYouTubeId(typed);
        if (!videoId) {
            preview.hidden = false;
            preview.innerHTML = '<p class="add-song-preview-error">Not a valid YouTube link yet...</p>';
            return;
        }

        const requestId = ++previewRequestId;

        // youtube-nocookie keeps the preview from being tracked. The id is
        // safe to interpolate: extractYouTubeId only returns an 11-character
        // [A-Za-z0-9_-] match, and everything rendered as text is escaped.
        preview.hidden = false;
        preview.innerHTML = `
            <p class="add-song-preview-title is-loading">Loading title&hellip;</p>
            <div class="add-song-preview-frame">
                <iframe src="https://www.youtube-nocookie.com/embed/${videoId}"
                        title="YouTube preview of ${escapeHtml(videoId)}"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>
            </div>
            <p class="add-song-preview-meta">
                Previewing <span>${escapeHtml(videoId)}</span> &middot;
                <a href="https://www.youtube.com/watch?v=${escapeHtml(videoId)}" target="_blank" rel="noopener">Open on YouTube</a>
            </p>`;

        // The embed is already on screen; only the heading above it is pending.
        (async () => {
            const data = await fetchVideoTitle(videoId);
            if (requestId !== previewRequestId) return;

            const heading = preview.querySelector('.add-song-preview-title');
            if (!heading) return;
            heading.classList.remove('is-loading');

            if (data && data.title) {
                // The title comes from whoever uploaded the video, so it is
                // untrusted text: render it as text, never as markup.
                heading.textContent = data.title;
                if (data.author_name) {
                    const meta = preview.querySelector('.add-song-preview-meta');
                    if (meta) {
                        const channel = document.createElement('span');
                        channel.className = 'add-song-preview-channel';
                        channel.textContent = data.author_name;
                        meta.prepend(channel);
                    }
                }
            } else {
                // oEmbed 404s for private, deleted or age-restricted videos. The
                // embed still plays, so this is a hint, not a failure.
                heading.textContent = 'Title unavailable (video may be private or deleted)';
                heading.classList.add('is-unavailable');
            }
        })();
    }, 300);
}

function clearAddSongPreview() {
    clearTimeout(previewTimer);
    // Invalidates any in-flight title lookup so it cannot write into a preview
    // that has since been cleared.
    previewRequestId++;
    const preview = document.getElementById('newSongPreview');
    if (preview) {
        preview.hidden = true;
        preview.innerHTML = '';
    }
}

// Validation problems are reported in the hint and the modal together, so the
// reason is visible even after the modal is dismissed.
function showAddSongError(message) {
    setAddSongHint(message);
    showAlert(message);
}

// 6. AUTH / MODES
async function initAuth() {
    try {
        const { data } = await supabaseClient.auth.getSession();
        await applySession(data && data.session);
    } catch (err) {
        console.warn('Auth unavailable:', err.message);
        await applySession(null);
    }

    supabaseClient.auth.onAuthStateChange((_event, newSession) => {
        applySession(newSession);
    });

    authReady = true;
}

async function applySession(newSession) {
    session = newSession || null;
    let admin = false;

    if (session && session.user) {
        // Only UIDs listed in admin_users pass. Missing table (pre-migration)
        // means "not an admin", never an error page.
        const { data, error } = await supabaseClient
            .from('admin_users')
            .select('user_id')
            .eq('user_id', session.user.id)
            .maybeSingle();

        if (error) {
            adminCheckFailed = true;
            console.warn('Admin check failed (run the supabase migration?):', error.message);
        } else {
            adminCheckFailed = false;
            if (data) admin = true;
        }
    } else {
        adminCheckFailed = false;
    }

    setAdminMode(admin, session && session.user ? session.user.email : null);
}

function setAdminMode(admin, email) {
    const changed = isAdmin !== !!admin;
    isAdmin = !!admin;

    document.body.classList.toggle('admin-mode', isAdmin);
    document.body.classList.toggle('public-mode', !isAdmin);

    const status = document.getElementById('authStatus');
    if (status) {
        status.textContent = isAdmin
            ? `Signed in as ${email || 'admin'} — full access.`
            : (session && session.user && adminCheckFailed)
                ? 'Signed in, but admin access is not set up yet — run the Supabase migration and add this user to admin_users.'
                : 'Guest mode — songs you add are reviewed before they join the songbook.';
    }

    // Re-render so admin-only controls appear/disappear. Skipped during the
    // first load, where the page renders once anyway.
    if (authReady && changed && document.getElementById('songContainer')) loadSongs();
}

async function signIn() {
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return showAlert('Enter the admin email and password.');

    const btn = document.getElementById('loginBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

    try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        passwordInput.value = '';
    } catch (err) {
        showAlert('Sign in failed: ' + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
    }
}

async function signOut() {
    try {
        await supabaseClient.auth.signOut();
    } catch (err) {
        showAlert('Sign out failed: ' + err.message);
    }
}

// 7. SUPABASE HELPERS
// Inserts a row, dropping the `source` column if the migration has not run.
async function insertSongRow(row) {
    let attempt = await supabaseClient.from(CONFIG.TABLE_NAME).insert(row).select().single();
    if (attempt.error && isMissingColumn(attempt.error, 'source')) {
        const { source, ...withoutSource } = row;
        attempt = await supabaseClient.from(CONFIG.TABLE_NAME).insert(withoutSource).select().single();
    }
    if (attempt.error) throw attempt.error;
    return attempt.data;
}

async function findDuplicate(videoId, searchQuery) {
    // select('*') keeps this working before the song_number migration (the
    // displayed number falls back to the internal id via songNumberOf()).
    const [videoMatch, queryMatch] = await Promise.all([
        supabaseClient.from(CONFIG.TABLE_NAME).select().eq('video_id', videoId).limit(1),
        supabaseClient.from(CONFIG.TABLE_NAME).select().eq('search_query', searchQuery).limit(1)
    ]);

    if (videoMatch.error) throw videoMatch.error;
    if (queryMatch.error) throw queryMatch.error;

    if (videoMatch.data && videoMatch.data.length) {
        return { by: 'video', song: videoMatch.data[0] };
    }
    if (queryMatch.data && queryMatch.data.length) {
        return { by: 'query', song: queryMatch.data[0] };
    }
    return null;
}

// Single write path for "save a song" from either audience.
//   admin  -> direct Supabase insert, verified immediately
//   public -> backend /api/public-songs (validated + rate-limited, pending review);
//             falls back to a direct pending insert while the route is not
//             deployed yet.
async function submitSong({ title, artist, videoId, searchQueryInput }) {
    const cleanTitle = String(title || '').trim().toUpperCase();
    const cleanArtist = String(artist || '').trim().toUpperCase();

    if (!cleanTitle) throw new Error('Fill in the song title.');
    if (!isValidVideoId(videoId)) {
        throw new Error('Invalid YouTube link or ID. Paste a watch/shorts/youtu.be link, or an 11-character ID.');
    }

    const searchQuery = buildSearchQuery(searchQueryInput ? searchQueryInput : cleanTitle);
    const videoTitle = cleanArtist ? `${cleanTitle} - ${cleanArtist}` : cleanTitle;

    const duplicate = await findDuplicate(videoId, searchQuery);
    if (duplicate) {
        throw new Error(`This song is already in the songbook as #${songNumberOf(duplicate.song)}.`);
    }

    if (isAdmin) {
        const row = await insertSongRow({
            search_query: searchQuery,
            video_id: videoId,
            video_title: videoTitle,
            is_verified: true,
            source: 'admin',
            created_at: new Date().toISOString()
        });
        return { songNumber: songNumberOf(row), verified: true, duplicate: false };
    }

    // Public path: the backend owns validation, moderation flags and rate
    // limiting. A 404/405 or network failure means the route is not deployed
    // yet, so fall back to a direct pending insert.
    try {
        const res = await fetch(CONFIG.PUBLIC_SONGS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: cleanTitle, artist: cleanArtist, videoId })
        });

        if (res.status === 429) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Too many submissions — please try again later.');
        }
        if (res.ok) {
            const data = await res.json();
            return {
                songNumber: String(data.songNumber),
                verified: data.isVerified === true,
                duplicate: data.duplicate === true
            };
        }
        if (res.status !== 404 && res.status !== 405) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Submission failed (HTTP ${res.status}).`);
        }
    } catch (err) {
        // Re-throw real HTTP errors; only network failures fall through.
        if (!(err instanceof TypeError)) throw err;
        console.warn('Public submissions endpoint unreachable, inserting directly:', err.message);
    }

    const row = await insertSongRow({
        search_query: searchQuery,
        video_id: videoId,
        video_title: videoTitle,
        is_verified: false,
        source: 'public',
        created_at: new Date().toISOString()
    });
    return { songNumber: songNumberOf(row), verified: false, duplicate: false };
}

// 8. CORE LOGIC — songbook list
function debouncedLoad() {
    if (searchMode !== 'songbook') return;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadSongs, 400);
}

const createSongCard = (song) => {
    const { is_verified: isVerified, id, video_id, video_title } = song;
    const number = songNumberOf(song);
    const { title, artist } = formatSongDisplay(video_title);
    const statusLabel = isVerified ? '✅ Verified' : '⚠️ Pending review';
    const badge = isVerified
        ? '<span class="badge badge-verified">Verified</span>'
        : '<span class="badge badge-pending">Pending</span>';

    // Admin-only editor. In public mode CSS hides [data-admin-only] and the
    // static lines below are all a guest sees.
    const adminControls = `
        <div data-admin-only>
            <input type="text" id="tit-${escapeHtml(id)}" placeholder="Title" value="${escapeHtml(title)}">
            <input type="text" id="art-${escapeHtml(id)}" placeholder="Artist" value="${escapeHtml(artist)}">
            <input type="text" id="vid-${escapeHtml(id)}" placeholder="Video ID" value="${escapeHtml(video_id)}">
            <div class="button-row">
                ${isVerified
                    ? `<button type="button" onclick="reEditSong('${escapeHtml(id)}')" class="reEditSong" style="background-color: #f59e0b;">Re-edit</button>`
                    : `<button type="button" onclick="saveSong('${escapeHtml(id)}')" class="saveSong">Save &amp; verify</button>`
                }
                <button type="button" onclick="deleteSong('${escapeHtml(id)}')" class="deleteSong">Delete</button>
            </div>
        </div>`;

    return `
        <div class="song-card ${isVerified ? 'verified' : ''}" data-unverified="${!isVerified}" data-id="${escapeHtml(id)}" data-number="${escapeHtml(number)}" data-title="${escapeHtml(video_title)}">
            <p><strong>Number: ${escapeHtml(number)}</strong> ${badge}</p>
            <p class="song-line">${statusLabel}: ${escapeHtml(video_title || '')}</p>
            <p class="song-line">Video ID: <span>${escapeHtml(video_id)}</span></p>
            ${adminControls}
        </div>`;
};

async function fetchSongRows(term) {
    const order = (query) => query
        .order('is_verified', { ascending: true })
        .order('video_title', { ascending: true })
        .limit(CONFIG.MAX_SONGS_RENDERED);

    const base = () => supabaseClient.from(CONFIG.TABLE_NAME).select();

    if (!term) return await order(base());

    if (/^\d+$/.test(term)) {
        const numeric = Number(term);
        let result = await order(base().or(`video_title.ilike.%${term}%,song_number.eq.${numeric}`));
        // Pre-migration fallback: search the internal id instead.
        if (result.error && isMissingColumn(result.error, 'song_number')) {
            result = await order(base().or(`video_title.ilike.%${term}%,id.eq.${numeric}`));
        }
        return result;
    }

    return await order(base().ilike('video_title', `%${term}%`));
}

async function loadSongs() {
    try {
        const term = document.getElementById('searchInput').value.trim();
        const { data, error } = await fetchSongRows(term);
        if (error) throw error;

        document.getElementById('songContainer').innerHTML = (data || []).map(createSongCard).join('');
        document.getElementById('totalSongs').innerText = (data || []).length;
    } catch (err) {
        console.error("Error loading songs:", err);
        showAlert("Failed to load songs: " + err.message);
    }
}

// 9. SEARCH MODES + YOUTUBE SEARCH & CACHE
function setSearchMode(mode) {
    searchMode = mode;
    const songbookBtn = document.getElementById('modeSongbook');
    const youtubeBtn = document.getElementById('modeYoutube');
    if (songbookBtn) songbookBtn.classList.toggle('active', mode === 'songbook');
    if (youtubeBtn) youtubeBtn.classList.toggle('active', mode === 'youtube');

    const input = document.getElementById('searchInput');
    if (input) {
        input.placeholder = mode === 'songbook'
            ? 'Search by title, artist, or number...'
            : 'Search YouTube by title or artist...';
    }

    if (mode === 'songbook') {
        const results = document.getElementById('searchResults');
        if (results) { results.hidden = true; results.innerHTML = ''; }
    }
}

function searchKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        runSearch();
    }
}

async function runSearch() {
    if (searchMode === 'songbook') return loadSongs();
    return searchYouTube();
}

// Noise words that appear in karaoke video titles but are not part of the
// song identity. They are ignored so "Perfect Ed Sheeran Karaoke" still
// matches a title carrying "(HD Karaoke Version)".
const KARAOKE_NOISE_WORDS = new Set([
    'karaoke', 'version', 'lyrics', 'lyric', 'instrumental', 'minus',
    'backing', 'track', 'videoke', 'hd', 'hq', 'audio', 'official',
    'video', 'screen', 'guide', 'melody', 'songs', 'song', 'full',
    'original', 'the', 'a', 'an', 'and', 'of', 'in', 'on', 'with',
    'by', 'ft', 'feat', 'featuring'
]);

const tokenizeForMatch = (text) => String(text || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

// A result is relevant when every meaningful query word (title + artist)
// appears in its title. Extra title words are allowed; titles matching only
// part of the query are rejected.
function isRelevant(resultTitle, originalQuery) {
    const doc = new DOMParser().parseFromString(String(resultTitle || ''), 'text/html');
    const decodedTitle = doc.documentElement.textContent.toLowerCase();

    const titleTokens = tokenizeForMatch(decodedTitle);
    const titleSet = new Set(titleTokens);
    const squashedTitle = titleTokens.join('');

    const queryTokens = tokenizeForMatch(originalQuery)
        .filter(token => !KARAOKE_NOISE_WORDS.has(token));
    if (!queryTokens.length) return false;

    return queryTokens.every(token =>
        titleSet.has(token) || (token.length >= 4 && squashedTitle.includes(token))
    );
}

async function fetchFromCache(cleanQuery) {
    try {
        const res = await fetch(CONFIG.CACHE_ENDPOINT + '?query=' + encodeURIComponent(cleanQuery));
        if (res.status === 204 || !res.ok) return null;
        const data = await res.json();
        return (data.found || data.videoId)
            ? { videoId: data.videoId, videoTitle: data.videoTitle, songNumber: data.songNumber }
            : null;
    } catch (err) {
        console.error('Cache fetch error:', err);
        return null;
    }
}

function saveToCache(cleanQuery, videoId, videoTitle) {
    fetch(CONFIG.CACHE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: cleanQuery, videoId, videoTitle })
    }).catch(err => console.warn('Cache save error:', err));
}

async function fetchYouTubeResults(query) {
    const endpoint = CONFIG.YOUTUBE_SEARCH_ENDPOINT;
    const collected = new Map();

    const collect = (items) => {
        (items || []).forEach(item => {
            if (item && item.id && item.title && isRelevant(item.title, query) && !collected.has(item.id)) {
                collected.set(item.id, item);
            }
        });
    };

    for (const channelId of CONFIG.PREFERRED_CHANNELS) {
        try {
            const res = await fetch(`${endpoint}?q=${encodeURIComponent(query)}&channelId=${channelId}`);
            const data = await res.json();
            collect(data.items);
        } catch (err) {
            console.warn('Preferred channel search error:', err.message);
        }
        if (collected.size >= CONFIG.MAX_SEARCH_RESULTS) break;
    }

    if (collected.size < CONFIG.MAX_SEARCH_RESULTS) {
        try {
            const res = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            collect(data.items);
        } catch (err) {
            console.warn('Global search error:', err.message);
        }
    }

    return Array.from(collected.values()).slice(0, CONFIG.MAX_SEARCH_RESULTS);
}

// Parenthetical karaoke qualifiers, e.g. "(HD Karaoke)", "[Karaoke Version]",
// "(with lyrics)". Removed from the title/artist fields pre-filled from a
// YouTube result so the saved song reads cleanly.
const KARAOKE_QUALIFIER_RE = /[\(\[]\s*[^\)\]]*\b(karaoke|hd|hq|lyrics?|instrumental|version|videoke|minus|audio|official|guide)\b[^\)\]]*[\)\]]/gi;

function stripKaraokeQualifiers(text) {
    return String(text || '')
        .replace(KARAOKE_QUALIFIER_RE, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s\-–|,]+|[\s\-–|,]+$/g, '')
        .trim();
}

function parseVideoTitle(videoTitle) {
    const { title, artist } = formatSongDisplay(videoTitle || '');
    return {
        title: stripKaraokeQualifiers(title),
        artist: stripKaraokeQualifiers(artist)
    };
}

async function searchYouTube() {
    const input = document.getElementById('searchInput');
    const raw = input.value.trim();
    const resultsBox = document.getElementById('searchResults');
    if (!resultsBox) return;

    if (!raw) return showAlert('Type a song title or artist to search YouTube.');

    resultsBox.hidden = false;
    resultsBox.innerHTML = '<p class="search-status">Searching…</p>';

    // A pasted link or raw video id skips the search entirely.
    const directId = extractYouTubeId(raw);
    if (directId) {
        searchResults = [{ id: directId, title: '', source: 'direct' }];
        renderSearchResults();
        return;
    }

    const cleanQuery = buildSearchQuery(raw);
    // Google fares much better when the word "karaoke" is in the query (same
    // processing as the remote).
    let processedQuery = raw.toLowerCase().replace(/['"]/g, '').replace(/\s+/g, ' ').trim();
    if (!processedQuery.includes('karaoke')) processedQuery += ' karaoke';

    try {
        // Cache first: one YouTube query maps to one cached song.
        const cached = await fetchFromCache(cleanQuery);
        if (cached && cached.videoId) {
            searchResults = [{
                id: cached.videoId,
                title: cached.videoTitle || '',
                source: 'cache',
                songNumber: cached.songNumber
            }];
            renderSearchResults();
            return;
        }

        const items = await fetchYouTubeResults(processedQuery);
        if (!items.length) {
            searchResults = [];
            resultsBox.innerHTML = '<p class="search-status">No relevant YouTube results. Try a different title or paste a video link.</p>';
            return;
        }

        searchResults = items.map(item => ({ id: item.id, title: item.title, source: 'youtube' }));
        renderSearchResults();

        // Auto-cache the best match under this query, exactly like the remote
        // does, so the player finds it by the same text search later.
        if (document.getElementById('autoCache') && document.getElementById('autoCache').checked) {
            saveToCache(cleanQuery, searchResults[0].id, searchResults[0].title || 'Karaoke');
        }
    } catch (err) {
        console.error('YouTube search failed:', err);
        resultsBox.innerHTML = '<p class="search-status">Search failed. Check your connection and try again.</p>';
    }
}

function resultCardHtml(result, index) {
    const parsed = parseVideoTitle(result.title);
    const numberBadge = result.songNumber
        ? `<span class="badge badge-verified">In songbook #${escapeHtml(result.songNumber)}</span>`
        : '';

    return `
        <div class="result-card" data-index="${index}">
            <div class="result-thumb">
                <img src="https://img.youtube.com/vi/${escapeHtml(result.id)}/mqdefault.jpg" alt="" loading="lazy">
            </div>
            <div class="result-meta">
                <p class="result-title">${escapeHtml(result.title || 'YouTube video')} ${numberBadge}</p>
                <input type="text" class="result-title-input" value="${escapeHtml(parsed.title)}" placeholder="Title" autocomplete="off">
                <input type="text" class="result-artist-input" value="${escapeHtml(parsed.artist)}" placeholder="Artist" autocomplete="off">
                <p class="result-id">Video ID: <span>${escapeHtml(result.id)}</span> &middot;
                    <a href="https://www.youtube.com/watch?v=${escapeHtml(result.id)}" target="_blank" rel="noopener">Open on YouTube</a>
                </p>
                <div class="button-row">
                    <button type="button" class="preview-result-btn" onclick="toggleResultPreview(${index}, this)">Preview</button>
                    <button type="button" class="add-result-btn" onclick="addResultToSongbook(${index})" ${isAdmin ? '' : 'title="Saved as pending review"'}>
                        ${isAdmin ? 'Add to Songbook' : 'Save for review'}
                    </button>
                </div>
                <div class="result-preview" hidden></div>
            </div>
        </div>`;
}

function renderSearchResults() {
    const resultsBox = document.getElementById('searchResults');
    if (!resultsBox) return;

    if (!searchResults.length) {
        resultsBox.innerHTML = '<p class="search-status">No results.</p>';
        return;
    }
    resultsBox.innerHTML = searchResults.map(resultCardHtml).join('');
}

function toggleResultPreview(index, btn) {
    const card = document.querySelector(`.result-card[data-index="${index}"]`);
    if (!card) return;
    const box = card.querySelector('.result-preview');
    if (!box) return;

    if (box.hidden) {
        // The id is safe to interpolate: every result id passed isValidVideoId
        // or came from the cache/YouTube API in the same [\w-]{11} shape.
        box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${searchResults[index].id}"
            title="YouTube preview" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        box.hidden = false;
        if (btn) btn.textContent = 'Hide preview';
    } else {
        box.hidden = true;
        box.innerHTML = '';
        if (btn) btn.textContent = 'Preview';
    }
}

async function addResultToSongbook(index) {
    const result = searchResults[index];
    if (!result) return;

    const card = document.querySelector(`.result-card[data-index="${index}"]`);
    const titleInput = card && card.querySelector('.result-title-input');
    const artistInput = card && card.querySelector('.result-artist-input');
    const btn = card && card.querySelector('.add-result-btn');

    if (titleInput && !titleInput.value.trim()) {
        return showAlert('Fill in the song title before saving.');
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        // Fall back to the YouTube title when the fields were left empty.
        const parsed = parseVideoTitle(result.title);
        const saved = await submitSong({
            title: (titleInput && titleInput.value.trim()) || parsed.title || result.id,
            artist: (artistInput && artistInput.value.trim()) || parsed.artist,
            videoId: result.id
        });

        setAddSongHint(`Saved as #${saved.songNumber}${saved.verified ? '' : ' — pending review'}.`);
        showAlert(saved.duplicate
            ? `Already in the songbook as #${saved.songNumber}.`
            : `Saved "${result.title || result.id}" as song #${saved.songNumber}${saved.verified ? '' : ' (pending review)'}.`);
        await loadSongs();
    } catch (err) {
        console.error('Add from search failed:', err);
        showAlert('Save failed: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = isAdmin ? 'Add to Songbook' : 'Save for review';
        }
    }
}

// 10. ADMIN-ONLY SONG ACTIONS
async function reEditSong(id) {
    if (!isAdmin) return showAlert('Sign in as admin to edit songs.');
    const { error } = await supabaseClient.from(CONFIG.TABLE_NAME).update({ is_verified: false }).eq('id', id);
    if (error) showAlert("Error: " + error.message);
    else loadSongs();
}

async function deleteSong(id) {
    if (!isAdmin) return showAlert('Sign in as admin to delete songs.');

    // Confirm by song name, not just the number: a bare "#100123" is easy to
    // misread and delete the wrong card.
    const card = Array.from(document.querySelectorAll('.song-card'))
        .find(el => el.getAttribute('data-id') === String(id));
    const title = card && card.getAttribute('data-title');
    const number = card && card.getAttribute('data-number');

    if (!await showConfirm(`Delete song #${number || id}${title ? `:\n"${title}"` : ''}?\nThis cannot be undone.`)) return;

    const btn = card && card.querySelector('.deleteSong');
    if (btn) btn.disabled = true;

    try {
        // `.select('id')` is required, not decorative. Supabase reports a DELETE
        // that a row-level-security policy filtered out as a plain success
        // (HTTP 204, no error), so the only reliable proof that the row really
        // went away is whether one row came back.
        const { data, error } = await supabaseClient
            .from(CONFIG.TABLE_NAME)
            .delete()
            .eq('id', id)
            .select('id');

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error(`Song #${number || id} was NOT deleted. The database refused the request — sign in as an admin (see README "Admin access").`);
        }

        showAlert(`Deleted song #${number || id}.`);
        await loadSongs();
    } catch (err) {
        console.error('Delete failed:', err);
        showAlert('Delete failed: ' + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function saveSong(id) {
    if (!isAdmin) return showAlert('Sign in as admin to edit songs.');

    try {
        const artist = document.getElementById(`art-${id}`).value.trim().toUpperCase();
        const title = document.getElementById(`tit-${id}`).value.trim().toUpperCase();
        const videoId = document.getElementById(`vid-${id}`).value.trim();
        // Same reasoning as deleteSong: an update blocked by RLS also reports
        // success, so the affected rows are what prove the save landed.
        const { data, error } = await supabaseClient
            .from(CONFIG.TABLE_NAME)
            .update({ video_title: `${title} - ${artist}`, video_id: videoId, is_verified: true })
            .eq('id', id)
            .select('id');

        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Song was NOT updated. Sign in as an admin (see README "Admin access").');

        showAlert('Updated!');
        loadSongs();
    } catch (err) {
        showAlert(`Save failed: ${err.message}`);
    }
}

// 11. MANUAL ADD
// Adds a song with automatic 6-digit numbering — the number is generated by
// the database (song_number default) and never typed by hand.
async function addSongManually() {
    if (addSongSubmitting) return;

    const titleInput = document.getElementById('newSongTitle');
    const artistInput = document.getElementById('newSongArtist');
    const videoInput = document.getElementById('newSongVideo');
    const queryInput = document.getElementById('newSongQuery');
    if (!titleInput || !artistInput || !videoInput) return;

    const title = titleInput.value.trim();
    const artist = artistInput.value.trim();
    const videoId = extractYouTubeId(videoInput.value);

    if (!title) return showAddSongError('Fill in the song title.');
    if (!artist) return showAddSongError('Fill in the artist (the singer).');
    if (!videoId) return showAddSongError('Invalid YouTube link or ID. Paste a watch/shorts/youtu.be link, or an 11-character ID.');

    addSongSubmitting = true;
    const btn = document.getElementById('addSongBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    setAddSongHint('Saving to the songbook...');

    try {
        const saved = await submitSong({
            title,
            artist,
            videoId,
            searchQueryInput: queryInput && queryInput.value.trim() ? queryInput.value.trim() : ''
        });

        [titleInput, artistInput, videoInput].forEach((input) => { input.value = ''; });
        if (queryInput) queryInput.value = '';
        clearAddSongPreview();

        const suffix = saved.verified ? '' : ' — pending review';
        setAddSongHint(`Saved as song #${saved.songNumber}${suffix}.`);
        showAlert(saved.duplicate
            ? `Already in the songbook as #${saved.songNumber}.`
            : `Saved "${title.toUpperCase()} - ${artist.toUpperCase()}" as song #${saved.songNumber}${suffix}.`);
        await loadSongs();
    } catch (err) {
        console.error('Manual add failed:', err);
        showAddSongError(err.message);
    } finally {
        addSongSubmitting = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Save Song'; }
    }
}

// 12. MAINTENANCE (admin)
async function runCleanup() {
    if (!isAdmin) return showAlert('Sign in as admin to run cleanup.');

    if (!await showConfirm('Delete stale player rows and remote commands older than 2 days?')) return;

    const btn = document.getElementById('cleanupBtn');
    const hint = document.getElementById('cleanupHint');
    if (btn) { btn.disabled = true; btn.textContent = 'Cleaning…'; }

    try {
        const { data, error } = await supabaseClient.rpc('cleanup_presence_and_commands');
        if (error) throw error;

        const row = Array.isArray(data) ? data[0] : data;
        const players = (row && row.players_deleted) || 0;
        const commands = (row && row.commands_deleted) || 0;

        if (hint) hint.textContent = `Removed ${players} stale player row(s) and ${commands} old command(s).`;
        showAlert('Cleanup complete.');
    } catch (err) {
        console.error('Cleanup failed:', err);
        showAlert('Cleanup failed: ' + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Clean up now'; }
    }
}

// Main initialization entry point
window.addEventListener('DOMContentLoaded', async () => {
    await loadGlobalComponents();
    await initAuth();
    loadSongs();
    setSearchMode('songbook');

    // Enter anywhere in the manual-entry form submits it, so the panel behaves
    // like the search box above it.
    ['newSongTitle', 'newSongArtist', 'newSongVideo', 'newSongQuery'].forEach((fieldId) => {
        const field = document.getElementById(fieldId);
        if (field) field.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addSongManually(); }
        });
    });

    // "input" covers paste as well as typing, so the video preview appears the
    // moment a link lands in the field.
    const videoInput = document.getElementById('newSongVideo');
    if (videoInput) {
        videoInput.addEventListener('input', updateAddSongPreview);
        // Opening the panel with a link already in the field previews it too.
        document.getElementById('addSongPanel')?.addEventListener('toggle', updateAddSongPreview);
    }
});
