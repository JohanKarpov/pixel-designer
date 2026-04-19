// src/core/rhythm.js — Beat-sync rhythm system
// Plays the work BGM and scores player input against 120 BPM beat grid.
// Exports:
//   initRhythm()          — preload audio (call once)
//   startRhythm()         — begin playback + scoring
//   stopRhythm()          — pause playback
//   setRhythmVolume(v)    — update gain live (0–1)
//   checkBeatHit()        — call on any player input; returns hit quality
//   getRhythmMultiplier() — current payout multiplier based on combo
//   getRhythmCombo()      — current combo value (float)
//   onRhythmComboChange() — register listener for combo/multiplier updates

import { getBgmVolume } from './bgm.js';

const BPM         = 120;
const BEAT_MS     = 60000 / BPM;     // 500 ms
const HALF_BEAT   = BEAT_MS / 2;     // 250 ms

// Offset (ms) between audio file t=0 and the first musical beat.
// Tune this if the visual dot fires between musical beats.
// +250 = beat grid shifts 250ms forward relative to audio start.
const BEAT_OFFSET_MS = 250;

// Minimum ms gap between card-disappear and next beat spawn.
// If the next beat is closer than this, we skip to the one after.
const BEAT_SPAWN_MIN_GAP_MS = 80;

// Hit windows (one-sided, ms)
const W_PERFECT   = 100;
const W_GOOD      = 150;
const W_OK        = 200;
// > W_OK = miss

const COMBO_MAX   = 20;
const DECAY_RATE  = 0.5;   // combo units subtracted per missed beat

// ── State ─────────────────────────────────────────────────────────────────

let _audioCtx    = null;
let _buffer      = null;    // decoded AudioBuffer
let _source      = null;    // BufferSourceNode (while playing)
let _gainNode    = null;
let _startTime   = 0;       // audioCtx.currentTime at playback start

let _combo       = 0;       // float 0 … COMBO_MAX
let _lastHitBeat = -1;      // beatIndex of the most recent hit
let _decayTimer  = null;

let _onComboChange = null;  // (combo: number, mult: number) => void
let _onBeatCheck   = null;  // (quality: string) => void

// ── Audio lifecycle ───────────────────────────────────────────────────────

/**
 * Preload audio buffer. Safe to call multiple times (no-op after first load).
 */
export async function initRhythm() {
    if (_buffer) return;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) { console.warn('[rhythm] Web Audio API not supported'); return; }
        _audioCtx = new Ctx();
        const res = await fetch('data/audio/spikes.mp3');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        _buffer = await _audioCtx.decodeAudioData(ab);
    } catch (e) {
        console.warn('[rhythm] Audio load failed:', e.message);
        _audioCtx = null;
        _buffer   = null;
    }
}

/**
 * Start playback and rhythm scoring. Resets combo.
 */
export function startRhythm() {
    if (!_audioCtx || !_buffer) return;
    stopRhythm();

    // Resume if suspended (browser autoplay policy)
    if (_audioCtx.state === 'suspended') _audioCtx.resume();

    _gainNode = _audioCtx.createGain();
    _gainNode.gain.value = getBgmVolume();
    _gainNode.connect(_audioCtx.destination);

    _source = _audioCtx.createBufferSource();
    _source.buffer = _buffer;
    _source.loop   = true;
    _source.connect(_gainNode);
    _source.start(0);

    _startTime   = _audioCtx.currentTime;
    _combo       = 0;
    _lastHitBeat = -1;

    // Decay: every beat that passes without a hit, reduce combo
    _decayTimer = setInterval(_decayTick, BEAT_MS);

    _onComboChange?.(_combo, getRhythmMultiplier());
}

/**
 * Stop playback and decay timer.
 */
export function stopRhythm() {
    if (_source) {
        try { _source.stop(); } catch (_) {}
        _source.disconnect();
        _source = null;
    }
    if (_gainNode) {
        _gainNode.disconnect();
        _gainNode = null;
    }
    if (_decayTimer) {
        clearInterval(_decayTimer);
        _decayTimer = null;
    }
}

/**
 * Update the live gain volume (0–1). Called when global volume slider changes.
 */
export function setRhythmVolume(v) {
    const clamped = Math.max(0, Math.min(1, v));
    if (_gainNode && _audioCtx) {
        _gainNode.gain.setTargetAtTime(clamped, _audioCtx.currentTime, 0.05);
    }
}

// ── Beat math ─────────────────────────────────────────────────────────────

function _elapsedMs() {
    if (!_audioCtx) return 0;
    return (_audioCtx.currentTime - _startTime) * 1000 + BEAT_OFFSET_MS;
}

function _beatIndex() {
    return Math.round(_elapsedMs() / BEAT_MS);
}

/** Distance in ms to the nearest beat grid line (0 = on beat, HALF_BEAT = farthest) */
function _distToBeat() {
    const phase = _elapsedMs() % BEAT_MS;
    return phase <= HALF_BEAT ? phase : BEAT_MS - phase;
}

function _decayTick() {
    if (!_source) return;
    const beat = _beatIndex();
    if (_lastHitBeat < beat - 1) {
        _combo = Math.max(0, _combo - DECAY_RATE);
        _onComboChange?.(_combo, getRhythmMultiplier());
    }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Call on any player input (generate press OR minigen cell click).
 * Returns { quality: 'perfect'|'good'|'ok'|'miss'|'off', distMs, combo, multiplier }
 *
 * 'off'     — rhythm not running (no audio), result is neutral
 * 'perfect' — ≤100ms to beat, combo +1
 * 'good'    — ≤150ms,          combo +0.5
 * 'ok'      — ≤200ms,          combo unchanged (but current multiplier applies)
 * 'miss'    — >200ms,          combo reset to 0
 */
export function checkBeatHit() {
    if (!_source) return { quality: 'off', distMs: 0, combo: 0, multiplier: 1 };

    const distMs = _distToBeat();
    const beat   = _beatIndex();
    _lastHitBeat = beat;   // mark this beat as touched (prevents decay)

    let quality;
    if      (distMs <= W_PERFECT) { quality = 'perfect'; _combo = Math.min(_combo + 1,   COMBO_MAX); }
    else if (distMs <= W_GOOD)    { quality = 'good';    _combo = Math.min(_combo + 0.5, COMBO_MAX); }
    else if (distMs <= W_OK)      { quality = 'ok';      /* combo unchanged */                        }
    else                           { quality = 'miss';    _combo = 0;                                  }

    _onComboChange?.(_combo, getRhythmMultiplier());
    _onBeatCheck?.(quality);
    return { quality, distMs: Math.round(distMs), combo: _combo, multiplier: getRhythmMultiplier() };
}

/**
 * Current payout multiplier.
 * combo 0  → ×1.0
 * combo 5  → ×1.5
 * combo 10 → ×2.0
 * combo 20 → ×3.0
 */
export function getRhythmMultiplier() {
    return 1 + Math.floor(_combo) * 0.1;
}

export function getRhythmCombo() { return _combo; }

/**
 * Current beat phase 0..1 within the current half-second beat.
 * 0 = exactly on the beat, 1 = halfway to next beat.
 * Returns 0 when rhythm is not running.
 */
export function getBeatPhase() {
    if (!_audioCtx || !_source) return 0;
    return (_elapsedMs() % BEAT_MS) / BEAT_MS;
}

/** Register a listener called whenever combo or multiplier changes. */
export function onRhythmComboChange(fn) { _onComboChange = fn; }

/** Register a listener called whenever checkBeatHit() fires. Receives quality string. */
export function onBeatCheck(fn) { _onBeatCheck = fn; }

/** Total non-fractional beat count since rhythm started. Used for smooth pendulum. */
export function getElapsedBeats() {
    if (!_audioCtx || !_source) return 0;
    return _elapsedMs() / BEAT_MS;
}

export function isRhythmActive() { return !!_source; }

/**
 * Returns a Promise that resolves on the next beat boundary.
 * If the next beat is closer than BEAT_SPAWN_MIN_GAP_MS, waits for the beat after.
 * Resolves immediately when rhythm is not running.
 */
export function waitForNextBeat() {
    return new Promise(resolve => {
        if (!_audioCtx || !_source) { resolve(); return; }
        // Positive-modulo phase within current beat (0 = on beat, 500 = one full beat later)
        const phase     = ((_elapsedMs() % BEAT_MS) + BEAT_MS) % BEAT_MS;
        let msUntilBeat = BEAT_MS - phase;
        // Too close — skip to the beat after so there's a visible gap
        if (msUntilBeat < BEAT_SPAWN_MIN_GAP_MS) msUntilBeat += BEAT_MS;
        setTimeout(resolve, msUntilBeat);
    });
}
