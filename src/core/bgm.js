// src/core/bgm.js — Ambient BGM manager (non-work screens)
// Work screen audio is managed by rhythm.js; bgm.js stops there.
//
// Usage:
//   playBgm('planning' | 'results' | 'rest' | 'work')  — call on phase change
//   stopBgm()                                           — hard stop (e.g. app hidden)
//   setBgmVolume(0..1)                                  — update master volume live
//   getBgmVolume()                                      — current master volume

const FADE_MS       = 900;      // crossfade duration ms
const VOLUME_KEY    = 'bgm_volume';
const VOLUME_DEFAULT = 0.28;

// ── Shuffle pool — played on all non-work screens ─────────────────────────
// spikes.mp3 is used exclusively by rhythm.js (work screen).
const SHUFFLE_POOL = [
    'data/audio/bass.mp3',
    'data/audio/edge runner.mp3',
    'data/audio/waiting zone.mp3',
    'data/audio/coming_up_next.mp3',
];

// ── Internal state: volume (persisted) ───────────────────────────────────
let _volume     = parseFloat(localStorage.getItem(VOLUME_KEY) ?? VOLUME_DEFAULT);

// ── Internal state ─────────────────────────────────────────────────────────

let _ctx        = null;
let _gainNode   = null;
let _source     = null;
let _bufCache   = {};         // url → AudioBuffer
let _wantScreen = null;       // last requested screen (for race-condition guard)
let _shuffleQueue = [];       // remaining urls in current shuffle pass

// ── Shuffle helpers ────────────────────────────────────────────────────────

function _nextShuffleUrl() {
    if (_shuffleQueue.length === 0) {
        // refill: Fisher-Yates shuffle of pool
        _shuffleQueue = [...SHUFFLE_POOL];
        for (let i = _shuffleQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [_shuffleQueue[i], _shuffleQueue[j]] = [_shuffleQueue[j], _shuffleQueue[i]];
        }
    }
    return _shuffleQueue.pop();
}

// ── AudioContext (lazy, created on first playBgm call) ────────────────────

function _getCtx() {
    if (_ctx) return _ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _ctx = new Ctx();
    return _ctx;
}

// ── Buffer loader (cached) ────────────────────────────────────────────────

async function _loadBuffer(url) {
    if (_bufCache[url]) return _bufCache[url];
    const ctx = _getCtx();
    if (!ctx) return null;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab  = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(ab);
        _bufCache[url] = buf;
        return buf;
    } catch (e) {
        console.warn('[bgm] Load failed:', url, e.message);
        return null;
    }
}

// ── Playback helpers ──────────────────────────────────────────────────────

function _fadeOut(onDone) {
    if (!_gainNode || !_ctx) { onDone?.(); return; }
    const g   = _gainNode;
    const src = _source;
    g.gain.setValueAtTime(g.gain.value, _ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, _ctx.currentTime + FADE_MS / 1000);
    setTimeout(() => {
        try { src?.stop(); } catch (_) {}
        src?.disconnect();
        g.disconnect();
        if (_gainNode === g) { _gainNode = null; _source = null; }
        onDone?.();
    }, FADE_MS + 60);
}

function _fadeIn(buffer, screenTag) {
    const ctx = _getCtx();
    if (!ctx || !buffer) return;
    if (ctx.state === 'suspended') ctx.resume();

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(_volume, ctx.currentTime + FADE_MS / 1000);
    gain.connect(ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop   = false;
    src.connect(gain);
    src.start(0);

    // When track ends, auto-advance to next shuffle track (if still on same screen)
    src.onended = () => {
        if (_source !== src) return;   // another track took over
        _gainNode = null;
        _source   = null;
        if (_wantScreen === screenTag) _playNextShuffle(screenTag);
    };

    _gainNode = gain;
    _source   = src;
}

async function _playNextShuffle(screenTag) {
    if (_wantScreen !== screenTag) return;
    const url = _nextShuffleUrl();
    const buf = await _loadBuffer(url);
    if (_wantScreen !== screenTag) return;
    _fadeIn(buf, screenTag);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Switch BGM to the given screen.
 * - 'work'  → fade out (rhythm.js takes over)
 * - others  → fade out current, then start shuffle pool
 */
export async function playBgm(screen) {
    _wantScreen = screen;

    _fadeOut(async () => {
        if (_wantScreen !== screen) return;
        if (screen === 'work') return;   // rhythm.js handles work audio
        await _playNextShuffle(screen);
    });
}

/**
 * Immediately fade out and stop all BGM (e.g. app goes to background).
 */
export function stopBgm() {
    _wantScreen = null;
    _fadeOut();
}

/**
 * Set master BGM volume (0–1). Persisted to localStorage.
 * Takes effect immediately on the currently playing gain node.
 */
export function setBgmVolume(v) {
    _volume = Math.max(0, Math.min(1, v));
    localStorage.setItem(VOLUME_KEY, _volume.toFixed(3));
    if (_gainNode && _ctx) {
        _gainNode.gain.cancelScheduledValues(_ctx.currentTime);
        _gainNode.gain.setTargetAtTime(_volume, _ctx.currentTime, 0.05);
    }
}

/** Returns current master volume (0–1). */
export function getBgmVolume() {
    return _volume;
}
