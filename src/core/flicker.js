// src/core/flicker.js — ambient room light flicker
// Three independent RAF-driven channels + time-based window opacity helper.
//
//  Channel            | blend      | opacity range | character
//  monitor-lights     | screen     | 10%–25%       | CRT jumps every 1.2–3.5s
//  skill-monitor-light| screen     | 20%–40%       | slightly slower jumps, 0.8–2.5s
//  room-light-shadows | multiply   | 0%–15%        | rare lamp twitches every 4–10s
//
// Usage:
//   startFlicker(monitorsEl, skillEl, lampEl)
//   stopFlicker()
//   updateWindowOpacity(windowEl, inGameHour)  — call once on enter

let _raf = null;

// ── Generic channel object ─────────────────────────────────────
// { el, base, nextAt, frames, cfg: { minBase, maxBase, minBurst, maxBurst, maxFrames, minInt, maxInt } }

function _rnd(min, max) { return min + Math.random() * (max - min); }

function _makeChannel(el, cfg) {
    const now = performance.now();
    return {
        el,
        cfg,
        base:   _rnd(cfg.minBase, cfg.maxBase),
        nextAt: now + _rnd(0, cfg.maxInt * 0.4),   // stagger initial events
        frames: 0,
    };
}

function _tickChannel(ch, now) {
    if (!ch?.el) return;
    let alpha = ch.base;
    if (ch.frames > 0) {
        alpha = _rnd(ch.cfg.minBurst, ch.cfg.maxBurst);
        ch.frames--;
    } else if (now >= ch.nextAt) {
        ch.frames  = Math.floor(_rnd(1, ch.cfg.maxFrames + 1));
        alpha      = _rnd(ch.cfg.minBurst, ch.cfg.maxBurst);
        ch.base    = _rnd(ch.cfg.minBase, ch.cfg.maxBase);
        ch.nextAt  = now + _rnd(ch.cfg.minInt, ch.cfg.maxInt);
    }
    // Boost multiplier: when zone is pressed, widen opacity range
    if (ch.boosted) alpha = Math.min(1, alpha * 2.0 + 0.08);
    ch.el.style.opacity = alpha.toFixed(4);
}

// ── State ─────────────────────────────────────────────────────
let _monitors     = null;
let _skillMonitor = null;
let _lampShadows  = null;

// ── RAF loop ──────────────────────────────────────────────────
function _tick() {
    _raf = requestAnimationFrame(_tick);
    const now = performance.now();
    _tickChannel(_monitors,     now);
    _tickChannel(_skillMonitor, now);
    _tickChannel(_lampShadows,  now);
}

// ── Public API ────────────────────────────────────────────────

export function startFlicker(monitorsEl, skillEl, lampEl) {
    stopFlicker();

    _monitors = _makeChannel(monitorsEl, {
        minBase: 0.10, maxBase: 0.15,
        minBurst: 0.17, maxBurst: 0.25,
        maxFrames: 3,
        minInt: 1200, maxInt: 3500,
    });

    _skillMonitor = _makeChannel(skillEl, {
        minBase: 0.20, maxBase: 0.28,
        minBurst: 0.30, maxBurst: 0.40,
        maxFrames: 2,
        minInt: 800, maxInt: 2500,
    });

    _lampShadows = _makeChannel(lampEl, {
        minBase: 0.00, maxBase: 0.04,
        minBurst: 0.08, maxBurst: 0.15,
        maxFrames: 2,
        minInt: 4000, maxInt: 10000,
    });

    _raf = requestAnimationFrame(_tick);
}

export function stopFlicker() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    [_monitors, _skillMonitor, _lampShadows].forEach(ch => {
        if (ch?.el) ch.el.style.opacity = '0';
    });
    _monitors = _skillMonitor = _lampShadows = null;
}

/**
 * Temporarily boost a flicker channel (e.g. while the zone is pressed).
 * channel: 'monitors' | 'skill' | 'lamp'
 */
export function setChannelBoost(channel, boosted) {
    const ch = channel === 'monitors' ? _monitors
             : channel === 'skill'    ? _skillMonitor
             : channel === 'lamp'     ? _lampShadows
             : null;
    if (ch) ch.boosted = boosted;
}

/**
 * Compute and apply windows overlay opacity from in-game hour (float).
 *   18→23 : 0% → 50%   (sunset → deep night)
 *   23→26  : 50% → 15%  (night → post-midnight fade)
 *   other  : 0%
 */
export function updateWindowOpacity(el, hour) {
    if (!el) return;
    let opacity;
    if (hour < 18) {
        opacity = 0;
    } else if (hour < 23) {
        opacity = ((hour - 18) / 5) * 0.50;
    } else if (hour <= 26) {
        opacity = 0.50 - ((hour - 23) / 3) * 0.35;
    } else {
        opacity = 0.15;
    }
    el.style.opacity = opacity.toFixed(4);
}
