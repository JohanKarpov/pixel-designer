// sw.js — Service Worker for pixel-designer
// Strategy: cache-first for all GET requests.
// Precache: all JS/CSS/HTML/data files at install.
// Runtime caching: images and audio cached on first fetch (lazy).
// Version bump CACHE_NAME to force re-cache on new deploy.

const CACHE_NAME = 'pixel-designer-v0.3';

// On localhost, skip all caching — always fetch fresh files
const IS_DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

// Critical assets to cache immediately on SW install
const PRECACHE_URLS = [
    './',
    './index.html',
    './main.js',
    './styles.css',
    './data/orders.js',
    './data/cards.js',
    './data/minigen-game/manifest.json',
    './src/core/bgm.js',
    './src/core/break_infinity.js',
    './src/core/combos.js',
    './src/core/config.js',
    './src/core/deck.js',
    './src/core/economy.js',
    './src/core/flicker.js',
    './src/core/i18n.js',
    './src/core/minigen.js',
    './src/core/preload.js',
    './src/core/rhythm.js',
    './src/core/state.js',
    './src/core/upgrades-data.js',
    './src/day/day-cycle.js',
    './src/screens/planning.js',
    './src/screens/rest.js',
    './src/screens/results.js',
    './src/screens/work.js',
    // Room images — critical for first paint
    './data/img/room/room-bg.png',
    './data/img/room/monitor-lights.png',
    './data/img/room/skill-monitor-light.png',
    './data/img/room/room-light-shadows.png',
    './data/img/room/windows-city-softlight.png',
    './data/img/room/desk-deck.png',
    // New screens and UI
    './src/screens/upgrades.js',
    './src/ui/help.js',
];

// ── Install: precache critical files ─────────────────────────────────────────
self.addEventListener('install', event => {
    self.skipWaiting();
    if (IS_DEV) return; // Skip precache on localhost
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            for (const url of PRECACHE_URLS) {
                try {
                    const response = await fetch(url);
                    if (response.ok) await cache.put(url, response);
                } catch {
                    // Don't fail install if one asset is unavailable
                }
            }
        })
    );
});

// ── Activate: delete stale caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// ── Fetch: cache-first, runtime-cache misses ─────────────────────────────────
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    // Skip cross-origin (Telegram SDK, analytics, etc.)
    if (!event.request.url.startsWith(self.location.origin)) return;
    // On localhost, always fetch fresh — no caching
    if (IS_DEV) return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request).then(response => {
                // Cache successful same-origin responses
                if (response.ok && response.type !== 'opaque') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});
