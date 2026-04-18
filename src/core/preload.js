// src/core/preload.js — Preloads all game images before the loading screen disappears.
// Reads manifest.json (already in SW cache after install) to discover minigen images.
// Progress: 0.0 → 1.0 as each image finishes loading.

const ROOM_IMAGES = [
    'data/img/room/room-bg.png',
    'data/img/room/monitor-lights.png',
    'data/img/room/skill-monitor-light.png',
    'data/img/room/room-light-shadows.png',
    'data/img/room/windows-city-softlight.png',
];

/**
 * Preloads all game images.
 * @param {(progress: number) => void} onProgress  — called with 0..1 as images load
 */
export async function preloadAssets(onProgress = () => {}) {
    // Discover minigen image paths from the manifest
    let minigenImages = [];
    try {
        const res = await fetch('data/minigen-game/manifest.json');
        const manifest = await res.json();
        for (const group of manifest.groups || []) {
            const variants = group.variants ?? 3;
            for (let v = 1; v <= variants; v++) {
                minigenImages.push(`data/minigen-game/minigen-${group.tag}-${v}.png`);
            }
        }
    } catch {
        // Manifest unavailable — skip minigen images, continue with room images
    }

    const allImages = [...ROOM_IMAGES, ...minigenImages];
    if (allImages.length === 0) { onProgress(1); return; }

    let loaded = 0;
    onProgress(0);

    await Promise.all(
        allImages.map(src =>
            new Promise(resolve => {
                const img = new Image();
                img.onload = img.onerror = () => {
                    onProgress(++loaded / allImages.length);
                    resolve();
                };
                img.src = src;
            })
        )
    );
}
