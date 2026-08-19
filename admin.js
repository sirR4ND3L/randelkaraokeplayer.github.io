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
        <div class="song-card ${isVerified ? 'verified' : ''}" data-unverified="${!isVerified}" data-id="${id}">
            <p><strong>Number: ${id}</strong></p> 
            <p><strong>ID: ${video_id}</strong></p> 
            <p>${statusLabel}: ${video_title}</p>
            <input type="text" id="tit-${id}" placeholder="Title" value="${title}">
            <input type="text" id="art-${id}" placeholder="Artist" value="${artist}">
            <input type="text" id="vid-${id}" placeholder="Video ID" value="${video_id}">
            
            <div class="button-row">
                ${isVerified 
                    ? `<button onclick="reEditSong('${id}')" class="reEditSong" style="background-color: #f59e0b;">Re-edit</button>` 
                    : `<button onclick="saveSong('${id}')" class="saveSong">Save</button>`
                }
                <button onclick="deleteSong('${id}')" class="deleteSong">Delete</button>
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
    if (!await showConfirm(`Are you sure you want to delete song #${id}?`)) return;

    const { error } = await supabaseClient.from(CONFIG.TABLE_NAME).delete().eq('id', id);
    if (error) showAlert("Error: " + error.message);
    else loadSongs();
}

async function saveSong(id, refresh = true) {
    try {
        const artist = document.getElementById(`art-${id}`).value.trim().toUpperCase();
        const title = document.getElementById(`tit-${id}`).value.trim().toUpperCase();
        const videoId = document.getElementById(`vid-${id}`).value.trim();
        
        const { error } = await supabaseClient
            .from(CONFIG.TABLE_NAME)
            .update({ video_title: `${title} - ${artist}`, video_id: videoId, is_verified: true })
            .eq('id', id);

        if (error) throw error;
        
        if (refresh) {
            showAlert('Updated!');
            loadSongs();
        }
    } catch (err) {
        showAlert(`Save failed: ${err.message}`);
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
});