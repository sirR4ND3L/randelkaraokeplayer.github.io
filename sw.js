// v5: song codes are random 000000-999999 and render zero-padded, so the
// cached remote shell is refreshed once on upgrade.
const CACHE_NAME = 'rk-remote-v5';
const CORE_ASSETS = [
    'remote.html',
    'manifest.json',
    'images/favicon-32x32.png',
    'images/favicon-16x16.png',
    'images/apple-touch-icon.png',
    'images/icon.png',
    // Number-pad digit feedback. Without these the keypad is silent offline.
    'soundEffects/zero.mp3',
    'soundEffects/one.mp3',
    'soundEffects/two.mp3',
    'soundEffects/three.mp3',
    'soundEffects/four.mp3',
    'soundEffects/five.mp3',
    'soundEffects/six.mp3',
    'soundEffects/seven.mp3',
    'soundEffects/eight.mp3',
    'soundEffects/nine.mp3'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            // addAll is atomic: one 404 would reject the whole install and the
            // remote would lose its offline shell. Assets are added
            // individually so a single missing file cannot break the install.
            .then((cache) => Promise.all(CORE_ASSETS.map((asset) =>
                cache.add(asset).catch((err) => console.warn('SW: could not cache', asset, err))
            )))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.hostname === 'unpkg.com' && url.pathname.includes('jsqr')) {
        event.respondWith(
            caches.match(request).then((cached) => cached || fetch(request).then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            }))
        );
        return;
    }
    if (url.origin !== location.origin) return;

    if (request.mode === 'navigate') {
        // Only the remote has an offline shell. Caching *every* navigation
        // under the 'remote.html' key meant a songbook, player or admin visit
        // could overwrite the offline remote UI, and a later offline visit to
        // any page was then answered with that last-cached document.
        const isRemote = url.pathname.endsWith('/remote.html');
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok && isRemote) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put('remote.html', copy));
                    }
                    return response;
                })
                .catch(async () => {
                    if (isRemote) {
                        const cached = await caches.match('remote.html');
                        return cached || Response.error();
                    }
                    // Other pages have no offline shell; fail rather than serve
                    // a different page's HTML as their document.
                    return Response.error();
                })
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request).then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            });
            if (cached) {
                // Stale-while-revalidate: the cached copy is served instantly
                // and refreshed in the background, so a deploy is picked up on
                // the next visit instead of being pinned until CACHE_NAME
                // changes.
                network.catch(() => {});
                return cached;
            }
            return network;
        })
    );
});