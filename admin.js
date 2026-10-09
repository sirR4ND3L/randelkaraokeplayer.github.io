// 1. CONFIGURATION & STATE
const CONFIG = {
    SUPABASE_URL: 'https://blbwxnbbdsqkxbuvcrtn.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsYnd4bmJiZHNxa3hidXZjcnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5Nzc5NDgsImV4cCI6MjA5NTU1Mzk0OH0._OH1HSCUO1DfZOzefGk-j7GT-M3HplVULlziFnn--18',
    TABLE_NAME: 'karaoke_search_cache'
};

const supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

let confirmResolve = null;
let searchTimeout = null;
let refreshTimer = null;

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

// 2. REAL-TIME SUBSCRIPTION
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

// 3. UTILITIES
function showAlert(message, title = "Alert") {
    if (window.triggerCustomAlert) window.triggerCustomAlert(message, title);
    else alert(message);
}

async function showConfirm(message, title = "Confirm") {
    if (window.triggerCustomConfirm) return await window.triggerCustomConfirm(message, title);
    return confirm(message);
}

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

// Accepts any of the URL shapes a person is likely to paste, plus a raw ID.
function extractYouTubeId(input) {
    const value = String(input || '').trim();
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.hostname.includes('youtube.com')) {
            return url.searchParams.get('v')
                || (url.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/) || [])[1]
                || null;
        }
        if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
    } catch {}
    return /^[\w-]{11}$/.test(value) ? value : null;
}

// Mirrors the cache key the player builds from its search box (app.js), so a
// manually added song is found by the same text search as an automatic one.
function buildSearchQuery(title) {
    let query = String(title || '').toLowerCase().replace(/['"]/g, "").replace(/\s+/g, " ").trim();
    if (!query.includes("karaoke")) query += " karaoke";
    return query.replace(/[^a-z0-9]/g, "");
}

let addSongSubmitting = false;

function setAddSongHint(message) {
    const hint = document.getElementById('addSongHint');
    if (hint) hint.textContent = message || '';
}

// Validation problems are reported in the hint and the modal together, so the
// reason is visible even after the modal is dismissed.
function showAddSongError(message) {
    setAddSongHint(message);
    showAlert(message);
}

// Reads the highest existing number so an empty number field appends the song
// at the end of the songbook, the same way the automatic cache insert numbers.
async function getNextSongNumber() {
    const { data, error } = await supabaseClient
        .from(CONFIG.TABLE_NAME)
        .select('id')
        .order('id', { ascending: false })
        .limit(1);

    if (error) throw error;
    return (data && data[0] ? data[0].id : 0) + 1;
}

// Keeps the "Auto" placeholder showing the number that will be used.
async function refreshNextSongNumber() {
    const input = document.getElementById('newSongNumber');
    if (!input || input.value.trim()) return;
    try {
        input.placeholder = 'Number (Auto: ' + await getNextSongNumber() + ')';
    } catch {
        input.placeholder = 'Number';
    }
}

// 4. CORE LOGIC
function debouncedLoad() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadSongs, 400);
}

const createSongCard = (song) => {
    const { is_verified: isVerified, id, video_id, video_title } = song;
    const { title, artist } = isVerified ? formatSongDisplay(video_title) : { title: '', artist: '' };
    const statusLabel = isVerified ? '✅ Verified' : '⚠️ Unverified';

    return `
        <div class="song-card ${isVerified ? 'verified' : ''}" data-unverified="${!isVerified}" data-id="${escapeHtml(id)}" data-title="${escapeHtml(video_title)}">
            <p><strong>Number: ${escapeHtml(id)}</strong></p> 
            <p><strong>ID: ${escapeHtml(video_id)}</strong></p> 
            <p>${statusLabel}: ${escapeHtml(video_title)}</p>
            <input type="text" id="tit-${escapeHtml(id)}" placeholder="Title" value="${escapeHtml(title)}">
            <input type="text" id="art-${escapeHtml(id)}" placeholder="Artist" value="${escapeHtml(artist)}">
            <input type="text" id="vid-${escapeHtml(id)}" placeholder="Video ID" value="${escapeHtml(video_id)}">
            
            <div class="button-row">
                ${isVerified 
                    ? `<button onclick="reEditSong('${escapeHtml(id)}')" class="reEditSong" style="background-color: #f59e0b;">Re-edit</button>` 
                    : `<button onclick="saveSong('${escapeHtml(id)}')" class="saveSong">Save</button>`
                }
                <button onclick="deleteSong('${escapeHtml(id)}')" class="deleteSong">Delete</button>
            </div>
        </div>`;
};

async function loadSongs() {
    try {
        const searchTerm = document.getElementById('searchInput').value.trim();
        let query = supabaseClient.from(CONFIG.TABLE_NAME).select('*');

        if (searchTerm) {
            query = /^\d+$/.test(searchTerm) 
                ? query.or(`video_title.ilike.%${searchTerm}%,id.eq.${searchTerm}`)
                : query.ilike('video_title', `%${searchTerm}%`);
        }

        const { data, error } = await query
            .order('is_verified', { ascending: true })
            .order('video_title', { ascending: true });

        if (error) throw error;

        document.getElementById('songContainer').innerHTML = data.map(createSongCard).join('');
        document.getElementById('totalSongs').innerText = data.length;
    } catch (err) {
        console.error("Error loading songs:", err);
        showAlert("Failed to load songs: " + err.message);
    }
}

async function reEditSong(id) {
    const { error } = await supabaseClient.from(CONFIG.TABLE_NAME).update({ is_verified: false }).eq('id', id);
    if (error) showAlert("Error: " + error.message);
    else loadSongs();
}

async function reEditAllSongs() {
    if (!await showConfirm("Mark all songs as unverified for re-editing?")) return;

    const { error } = await supabaseClient.from(CONFIG.TABLE_NAME).update({ is_verified: false }).eq('is_verified', true);
    if (error) showAlert("Error: " + error.message);
    else loadSongs();
}

async function deleteSong(id) {
    // Confirm by song name, not just the number: the numbers are sparse, so a
    // bare "#97" is easy to misread and delete the wrong card.
    const card = Array.from(document.querySelectorAll('.song-card'))
        .find(el => el.getAttribute('data-id') === String(id));
    const title = card && card.getAttribute('data-title');

    if (!await showConfirm(`Delete song #${id}${title ? `:\n"${title}"` : ''}?\nThis cannot be undone.`)) return;

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
            throw new Error(`Song #${id} was NOT deleted. The database silently refused the request, which means the anon role is missing DELETE access to "${CONFIG.TABLE_NAME}". Run the policy in SECURITY-UPDATE.md §4.`);
        }

        showAlert(`Deleted song #${id}.`);
        await loadSongs();
    } catch (err) {
        console.error('Delete failed:', err);
        showAlert('Delete failed: ' + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function saveSong(id, refresh = true) {
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
        if (!data || data.length === 0) throw new Error(`Song #${id} was NOT updated. The anon role may be missing UPDATE access to "${CONFIG.TABLE_NAME}".`);
        
        if (refresh) {
            showAlert('Updated!');
            loadSongs();
        }
    } catch (err) {
        showAlert(`Save failed: ${err.message}`);
    }
}

// Adds a verified song straight to the songbook, bypassing the automatic
// cache flow (which would otherwise only ever create "unverified" rows).
async function addSongManually() {
    if (addSongSubmitting) return;

    const titleInput = document.getElementById('newSongTitle');
    const artistInput = document.getElementById('newSongArtist');
    const videoInput = document.getElementById('newSongVideo');
    const numberInput = document.getElementById('newSongNumber');
    const queryInput = document.getElementById('newSongQuery');
    if (!titleInput || !artistInput || !videoInput || !numberInput) return;

    const title = titleInput.value.trim().toUpperCase();
    const artist = artistInput.value.trim().toUpperCase();
    const videoId = extractYouTubeId(videoInput.value);

    if (!title || !artist) return showAddSongError('Fill in both the title and the artist.');
    if (!videoId) return showAddSongError('Invalid YouTube link or ID. Paste a watch/shorts/youtu.be link, or an 11-character ID.');

    // The search key defaults to the title, but a title carrying a qualifier
    // ("Dapat Ka Bang Maulit (Live)") produces a key nobody types, so the
    // override lets the admin enter the words players actually search for.
    const searchQuery = buildSearchQuery(queryInput && queryInput.value.trim() ? queryInput.value : title);

    const typedNumber = numberInput.value.trim();
    addSongSubmitting = true;

    const btn = document.getElementById('addSongBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }
    setAddSongHint('Saving to the songbook...');

    try {
        const songNumber = typedNumber ? Number(typedNumber) : await getNextSongNumber();
        if (!Number.isInteger(songNumber) || songNumber < 1) throw new Error('Song number must be a whole number above 0.');
        if (typedNumber && songNumber > await getNextSongNumber()) throw new Error(`Song number ${songNumber} is above the last song number, which would leave a gap in the songbook.`);

        const [videoMatch, queryMatch, numberMatch] = await Promise.all([
            supabaseClient.from(CONFIG.TABLE_NAME).select('id').eq('video_id', videoId).limit(1),
            supabaseClient.from(CONFIG.TABLE_NAME).select('id').eq('search_query', searchQuery).limit(1),
            supabaseClient.from(CONFIG.TABLE_NAME).select('id').eq('id', songNumber).limit(1)
        ]);

        for (const [result, message] of [
            [videoMatch, `This video is already in the songbook as song #${videoMatch.data?.[0]?.id}.`],
            [queryMatch, `The search key "${searchQuery}" is already used by song #${queryMatch.data?.[0]?.id}. Change the title or the search key.`],
            [numberMatch, `Song number ${songNumber} is already taken. Pick another number or leave it empty to append.`]
        ]) {
            if (result.error) throw result.error;
            if (result.data && result.data.length) throw new Error(message);
        }

        const { error } = await supabaseClient.from(CONFIG.TABLE_NAME).insert({
            id: songNumber,
            search_query: searchQuery,
            video_id: videoId,
            video_title: `${title} - ${artist}`,
            is_verified: true,
            created_at: new Date().toISOString()
        });

        if (error) throw error;

        [titleInput, artistInput, videoInput].forEach((input) => { input.value = ''; });
        if (queryInput) queryInput.value = '';
        numberInput.value = '';
        setAddSongHint(`Added as song #${songNumber} — searchable as "${searchQuery}".`);
        showAlert(`Added "${title} - ${artist}" as song #${songNumber}.`);
        await loadSongs();
        await refreshNextSongNumber();
    } catch (err) {
        console.error('Manual add failed:', err);
        showAddSongError(err.message);
    } finally {
        addSongSubmitting = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Add to Songbook'; }
    }
}

async function saveAllUnverified() {
    const unverifiedDivs = document.querySelectorAll('.song-card[data-unverified="true"]');
    const promises = [];

    for (const div of unverifiedDivs) {
        const id = div.getAttribute('data-id');
        const artist = document.getElementById(`art-${id}`).value.trim();
        const title = document.getElementById(`tit-${id}`).value.trim();

        if (artist && title) promises.push(saveSong(id, false));
    }

    if (promises.length === 0) return showAlert("No valid unverified songs to save.");
    await Promise.all(promises);
    showAlert('Bulk update complete!');
    await loadSongs();
}

// Main initialization entry point
window.addEventListener('DOMContentLoaded', async () => {
    await loadGlobalComponents();
    loadSongs();

    // Enter anywhere in the manual-entry form submits it, so the panel behaves
    // like the search box above it.
    ['newSongTitle', 'newSongArtist', 'newSongVideo', 'newSongNumber', 'newSongQuery'].forEach((fieldId) => {
        const field = document.getElementById(fieldId);
        if (field) field.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addSongManually(); }
        });
    });

    refreshNextSongNumber();
});