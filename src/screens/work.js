// src/screens/work.js — WORK phase UI
// Manages generate button, combo display, stress bars,
// active order card, order pool, autogen ticker, day timer bar.

import { state, saveState }        from '../core/state.js';
import { Config }                  from '../core/config.js';
import { endWorkEarly }            from '../day/day-cycle.js';
import {
    startOrder,
    generateForActiveOrder,
    smokeBreak,
    isOrderStartLocked,
    seedOrdersFromQueue,
} from '../core/economy.js';
import { runMinigen, getLastBeatQuality } from '../core/minigen.js';
import {
    initRhythm,
    startRhythm,
    stopRhythm,
    checkBeatHit,
    getRhythmMultiplier,
    onRhythmComboChange,
    onBeatCheck,
    getBeatPhase,
    getElapsedBeats,
    waitForNextBeat,
} from '../core/rhythm.js';

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────

const _dayLabel        = document.getElementById('work-day-label');
const _hourLabel       = document.getElementById('work-hour');
const _timeLabelEl     = document.getElementById('work-time-label');
const _dayProgress     = document.getElementById('work-day-progress');
const _earnedEl        = document.getElementById('work-earned');
const _completedEl     = document.getElementById('work-completed');
const _comboCnt        = document.getElementById('combo-count');
// _comboMult moved into rhythm-bar (combo-val shows multiplier now)
const _stressBarCurr   = document.getElementById('stress-bar-curr');
const _stressValCurr   = document.getElementById('stress-val-curr');
const _stressBarAcc    = document.getElementById('stress-bar-acc');
const _stressValAcc    = document.getElementById('stress-val-acc');
const _activeCard      = document.getElementById('active-order-card');
const _activeTitle     = document.getElementById('active-order-title');
const _activeGens      = document.getElementById('active-order-gens');
const _activeProgress  = document.getElementById('active-order-progress');
const _orderPool       = document.getElementById('order-pool');
const _autogenTicker   = document.getElementById('autogen-ticker');
const _autogenCount    = document.getElementById('autogen-count');
const _btnGenerate     = document.getElementById('btn-generate');
const _genZone         = document.getElementById('work-gen-zone');
const _btnSmoke        = document.getElementById('btn-smoke');
const _btnEndWork      = document.getElementById('btn-end-work');
const _rhythmBar       = document.getElementById('rhythm-bar');
const _rhythmComboVal  = document.getElementById('rhythm-combo-val');
const _rhythmBarFill   = document.getElementById('rhythm-bar-fill');
const _rhythmToast     = document.getElementById('rhythm-toast');
const _rhythmMetroInd  = document.getElementById('rhythm-metro-indicator');
const _beatFlash       = document.getElementById('work-beat-flash');

// ─────────────────────────────────────────────────────────────
// Entry point — call when entering WORK phase
// ─────────────────────────────────────────────────────────────

let _tickRAF = null;

export function onEnterWork() {
    seedOrdersFromQueue();
    _render();
    _bindButtons();
    _startTick();
    // Init rhythm (no-op if already loaded), then start playback
    initRhythm().then(() => {
        startRhythm();
        if (_rhythmBar) _rhythmBar.style.display = 'flex';
    });
    onRhythmComboChange(_onRhythmUpdate);
    onBeatCheck(_handleBeatCheck);
}

export function onLeaveWork() {
    _stopTick();
    stopRhythm();
    if (_rhythmBar) _rhythmBar.style.display = 'none';
    _chainCancelled = true;
    _generating     = false;
    _clearGapState();
    onBeatCheck(null);
}

// ─────────────────────────────────────────────────────────────
// Tick (RAF-driven for smooth day bar + hour label)
// ─────────────────────────────────────────────────────────────

function _startTick() {
    _stopTick();
    const loop = () => {
        _updateDayTimerBar();
        _updateBeatCues();
        _tickRAF = requestAnimationFrame(loop);
    };
    _tickRAF = requestAnimationFrame(loop);
}

function _stopTick() {
    if (_tickRAF) { cancelAnimationFrame(_tickRAF); _tickRAF = null; }
}

// Pendulum + beat-flash driven by getBeatPhase(). Called every RAF frame.
// Pendulum: sin(totalBeats * π) → period = 2 beats, center on every beat.
// At center (phase=0) = on beat = PERFECT zone. Extremes = between beats = MISS zone.
let _metroBeatClass  = false;
let _lastMetroXPx    = 0;   // recorded each frame for click-dot placement
function _updateBeatCues() {
    const phase      = getBeatPhase();   // 0..1 fractional within current beat
    const totalBeats = getElapsedBeats(); // non-fractional total

    // Pendulum — sin(totalBeats * π), period = 2 beats (1000ms at 120 BPM)
    if (_rhythmMetroInd) {
        const track    = _rhythmMetroInd.parentElement;
        const halfSpan = (track.offsetWidth - _rhythmMetroInd.offsetWidth) / 2;
        const xPx      = Math.sin(totalBeats * Math.PI) * halfSpan;
        _lastMetroXPx  = xPx;
        _rhythmMetroInd.style.setProperty('--metro-x', xPx.toFixed(1) + 'px');

        // Flash glow exactly on beat
        const onBeat = phase < 0.06 || phase > 0.97;
        if (onBeat && !_metroBeatClass) {
            _metroBeatClass = true;
            _rhythmMetroInd.classList.add('rhythm-metro__indicator--beat');
            setTimeout(() => {
                _metroBeatClass = false;
                _rhythmMetroInd?.classList.remove('rhythm-metro__indicator--beat');
            }, 60);
        }
    }

    // Beat-flash background — asymmetric sawtooth
    if (_beatFlash && !_beatFlash.classList.contains('work-beat-flash--miss')) {
        let flashNorm;
        if (phase <= 0.88) {
            flashNorm = 1 - phase / 0.88;
        } else {
            flashNorm = (phase - 0.88) / 0.12;
        }
        _beatFlash.style.opacity = (flashNorm * 0.18).toFixed(4);
    }
}



export function renderWork() {
    _render();
}

function _render() {
    // Header
    _dayLabel.textContent = `День ${state.dayCount || 1}`;

    // Stats
    const earned    = state.dailyStats?.earned    ?? 0;
    const completed = state.dailyStats?.completedOrders ?? 0;
    _earnedEl.textContent    = _fmt(earned);
    _completedEl.textContent = completed;

    // Combo — _comboCnt shows correct-pick streak (yellow); rhythm multiplier in _rhythmComboVal
    if (_comboCnt) _comboCnt.textContent  = state.comboCount > 0 ? `🔥${state.comboCount}` : '';
    // (multiplier displayed in _rhythmComboVal via _onRhythmUpdate)

    // Stress bars
    const stressCurr = Math.min(100, state.stress || 0);
    const stressAcc  = Math.min(100, state.accumulatedStress || 0);
    _stressBarCurr.style.width = `${stressCurr}%`;
    _stressBarAcc.style.width  = `${stressAcc}%`;
    _stressValCurr.textContent = Math.round(stressCurr);
    _stressValAcc.textContent  = Math.round(stressAcc);

    // Active order card + generate button type cue
    const ao = state.activeOrder;
    const activeType = ao?.taskType || null;
    // Apply color cue to generate button
    _btnGenerate.dataset.type = activeType || '';
    if (ao) {
        _activeCard.style.display = 'flex';
        _activeTitle.textContent  = ao.title;
        const gens = ao.generationsAttempted ?? 0;
        const req  = ao.requiredGenerations  ?? 1;
        _activeGens.textContent = `Генераций: ${gens} / ${req}`;
        _activeProgress.style.width = `${Math.min(100, (gens / Math.max(1, req)) * 100)}%`;
    } else {
        _activeCard.style.display = 'none';
    }

    // Autogen ticker
    const autogens = state.dailyStats?.autogenGenerations ?? 0;
    if (autogens > 0) {
        _autogenTicker.style.display = 'block';
        _autogenCount.textContent    = autogens;
    }

    // Order pool
    _renderOrderPool();

    // Generate button: enabled if not generating AND (there is an active order OR a queued one)
    const hasWork = !!state.activeOrder || (state.orders || []).some(o => !isOrderStartLocked(o));
    _btnGenerate.disabled = _generating || !hasWork;
    if (!_generating) {
        _btnGenerate.textContent = state.activeOrder ? '⚡ Генерация' : '▶ Начать работу';
    }
    _btnSmoke.disabled    = (state.goods?.cigarettes ?? 0) <= 0;
}

const TASK_EMOJI = {
    luck:         '🎲',
    social:       '💬',
    print:        '🖼️',
    web:          '🌐',
    illustration: '✏️',
    story:        '📚',
    contract:     '📄',
    default:      '📋',
};

function _renderOrderPool() {
    _orderPool.innerHTML = '';

    const orders = state.orders || [];
    if (!orders.length) {
        _orderPool.innerHTML = `<span style="color:var(--clr-text-muted);font-size:calc(var(--r)*13)">Нет заказов</span>`;
        return;
    }

    orders.forEach(order => {
        const isActive = state.activeOrder?.id === order.id;
        const locked   = isOrderStartLocked(order);
        const card = document.createElement('div');
        card.className = 'order-card order-card--type-' + (order.taskType || 'default') +
            (isActive         ? ' order-card--active' : '') +
            (order.isStory    ? ' order-card--story'  : '');

        // Time left
        const secLeft = order.expiresAt === Infinity
            ? '∞'
            : Math.max(0, Math.round((order.expiresAt - Date.now()) / 1000)) + 'с';

        card.innerHTML =
            `<div class="order-card__icon">${TASK_EMOJI[order.taskType] || TASK_EMOJI.default}</div>` +
            `<div class="order-card__body">` +
            `  <div class="order-card__title">${order.title}</div>` +
            `  <div class="order-card__meta">${order.requiredGenerations} ген. · ${secLeft}</div>` +
            `</div>` +
            `<div class="order-card__payout">${_fmt(order.realPayout)}</div>`;

        if (!locked && !isActive) {
            card.addEventListener('click', () => {
                startOrder(order.id);
                _render();
            });
        }

        _orderPool.appendChild(card);
    });
}

function _updateDayTimerBar() {
    // inGameHour goes from 9 → 18 during WORK phase
    const START_H = 9;
    const END_H   = 9 + (Config.WORK_HOURS_SPAN || 9);
    const h       = state.inGameHour ?? START_H;
    const pct     = Math.min(100, Math.max(0, ((h - START_H) / (END_H - START_H)) * 100));
    _dayProgress.style.width = `${pct}%`;

    // Format like "9:30"
    const hrs  = Math.floor(h);
    const mins = Math.floor((h - hrs) * 60);
    const label = `${hrs}:${String(mins).padStart(2, '0')}`;
    _hourLabel.textContent = label;
    _timeLabelEl.textContent = `${label} → ${END_H}:00`;
}

// ─────────────────────────────────────────────────────────────
// Rhythm UI
// ─────────────────────────────────────────────────────────────

const TOAST_LABELS = { perfect: 'PERFECT', good: 'GOOD', ok: 'OK', miss: 'MISS' };
let _toastTimeout = null;

const QUALITY_COLOR = {
    perfect: '#22c55e',   // saturated green
    good:    '#86efac',   // desaturated light green
    ok:      '#9ca3af',   // gray
    miss:    '#f87171',   // unsaturated red
};

/**
 * Show beat-quality feedback in the gen-zone during the gap between rounds.
 * Clears automatically when the next round appends new cards.
 */
function _showGenFeedback(beatQuality) {
    if (!_genZone) return;
    _genZone.querySelector('.gen-feedback')?.remove();

    const label = TOAST_LABELS[beatQuality];
    if (!label) return;

    if (beatQuality === 'miss') {
        _showMissFlash();
        // For miss: brief text (240ms), then zone stays clickable until auto-advance
        const el = document.createElement('div');
        el.className = 'gen-feedback gen-feedback--miss';
        el.innerHTML = `<span class="gen-feedback__quality" style="--quality-color:${QUALITY_COLOR.miss}">${label}</span>`;
        _genZone.appendChild(el);
        setTimeout(() => el.remove(), 240);
        return;
    }

    const comboStr = state.comboCount > 0 ? `🔥${state.comboCount}` : '';
    const el = document.createElement('div');
    el.className = `gen-feedback gen-feedback--${beatQuality}`;
    el.innerHTML =
        `<span class="gen-feedback__quality" style="--quality-color:${QUALITY_COLOR[beatQuality] || QUALITY_COLOR.ok}">${label}</span>` +
        (comboStr ? `<span class="gen-feedback__combo">${comboStr}</span>` : '') +
        `<span class="gen-feedback__tap-hint">tap</span>`;
    _genZone.appendChild(el);
    // No auto-cleanup — element is removed when next round appends new cards
}

// ─────────────────────────────────────────────────────────────
// 2-beat interactive gap between minigen rounds
// ─────────────────────────────────────────────────────────────

/**
 * Returns a promise that resolves when the player taps the gen-zone
 * OR after 2000ms (2 beats) from the original card-spawn time.
 */
function _waitForNextRound(spawnTime) {
    _clearGapState();
    return new Promise(resolve => {
        const elapsed  = performance.now() - spawnTime;
        const remaining = Math.max(80, 2000 - elapsed);

        let resolved = false;
        const done = () => {
            if (resolved) return;
            resolved = true;
            _clearGapState();
            resolve();
        };

        _gapAutoTimer    = setTimeout(done, remaining);
        _gapClickHandler = done;

        if (_genZone) {
            _genZone.classList.add('work-gen-zone--gap');
            _genZone.addEventListener('click', _gapClickHandler, { once: true });
        }
    });
}

function _clearGapState() {
    if (_gapAutoTimer) { clearTimeout(_gapAutoTimer); _gapAutoTimer = null; }
    if (_genZone && _gapClickHandler) {
        _genZone.removeEventListener('click', _gapClickHandler);
    }
    _gapClickHandler = null;
    if (_genZone) _genZone.classList.remove('work-gen-zone--gap');
}

// ─────────────────────────────────────────────────────────────
// Metro click dot + zone flash  (fired via onBeatCheck hook)
// ─────────────────────────────────────────────────────────────

const _ZONE_PCT = {
    perfect: [[30, 70]],
    good:    [[15, 30], [70, 85]],
    ok:      [[ 8, 15], [85, 92]],
    miss:    [[ 0,  8], [92, 100]],
};
const _ZONE_FLASH_COLOR = {
    perfect: 'rgba(74,222,128,0.70)',
    good:    'rgba(134,239,172,0.60)',
    ok:      'rgba(156,163,175,0.55)',
    miss:    'rgba(248,113,113,0.70)',
};

function _handleBeatCheck(quality) {
    _showClickDot(_lastMetroXPx);
    _showZoneFlash(quality);
}

function _showClickDot(xPx) {
    const track = document.getElementById('rhythm-metro');
    if (!track) return;
    const dot = document.createElement('div');
    dot.className = 'rhythm-metro__click-dot';
    dot.style.setProperty('--dot-x', xPx.toFixed(1) + 'px');
    track.appendChild(dot);
    setTimeout(() => dot.remove(), 220);
}

function _showZoneFlash(quality) {
    const track = document.getElementById('rhythm-metro');
    if (!track) return;
    const ranges = _ZONE_PCT[quality];
    const color  = _ZONE_FLASH_COLOR[quality];
    if (!ranges || !color) return;

    // Build gradient: highlight only the target zone ranges
    const boundaries = new Set([0, 100]);
    ranges.forEach(([a, b]) => { boundaries.add(a); boundaries.add(b); });
    const pts = [...boundaries].sort((a, b) => a - b);

    const parts = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const inZone = ranges.some(([a, b]) => pts[i] >= a && pts[i + 1] <= b);
        parts.push(`${inZone ? color : 'transparent'} ${pts[i]}% ${pts[i + 1]}%`);
    }

    const el = document.createElement('div');
    el.style.cssText =
        'position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:4;' +
        `background:linear-gradient(to right,${parts.join(',')});` +
        'opacity:1;transition:opacity 100ms ease-out;';
    track.appendChild(el);
    // Trigger fade-out on next frame
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '0'; }));
    setTimeout(() => el.remove(), 130);
}

function _showMissFlash() {
    if (!_beatFlash) return;
    _beatFlash.classList.add('work-beat-flash--miss');
    _beatFlash.style.opacity = '';   // let CSS !important take over
    setTimeout(() => _beatFlash.classList.remove('work-beat-flash--miss'), 200);
}

function _onRhythmUpdate(combo, mult) {
    if (!_rhythmComboVal) return;
    _rhythmComboVal.textContent = '\xd7' + mult.toFixed(1);
    // Fill = combo / 20 * 100%
    if (_rhythmBarFill) _rhythmBarFill.style.width = Math.min(100, (combo / 20) * 100) + '%';
    // Colour accent at high combo
    if (combo >= 10) {
        _rhythmComboVal.style.color = '#ffe94d';
    } else {
        _rhythmComboVal.style.color = '';
    }
}

function _showRhythmToast(quality) {
    if (!_rhythmToast || quality === 'off') return;
    clearTimeout(_toastTimeout);
    _rhythmToast.className = 'rhythm-toast';
    void _rhythmToast.offsetWidth; // force reflow to restart animation
    _rhythmToast.textContent  = TOAST_LABELS[quality] || '';
    _rhythmToast.className    = `rhythm-toast rhythm-toast--${quality} rhythm-toast--show`;
    _toastTimeout = setTimeout(() => {
        if (_rhythmToast) _rhythmToast.className = 'rhythm-toast';
    }, 600);
}

// ─────────────────────────────────────────────────────────────
// Buttons
// ─────────────────────────────────────────────────────────────

function _bindButtons() {
    _btnGenerate.onclick = _onGenerate;
    _btnSmoke.onclick    = () => { smokeBreak(); _render(); };
    _btnEndWork.onclick  = () => endWorkEarly();
}

let _generating = false;
let _chainCancelled = false;
let _roundSpawnTime = 0;
let _gapClickHandler = null;
let _gapAutoTimer = null;

/** Small delay helper (ms) */
const _sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Single ⚡ press launches a full generation chain:
 * - If no activeOrder, auto-starts the first available order
 * - Loops minigen rounds until the order is complete (state.activeOrder → null)
 * - After chain ends, re-enables the button (next order auto-highlighted by _render)
 */
async function _onGenerate() {
    if (_generating) return;

    // If no active order, start the first available one
    if (!state.activeOrder) {
        const next = (state.orders || []).find(o => !isOrderStartLocked(o));
        if (!next) return;
        startOrder(next.id);
        _render();
    }

    _generating = true;
    _chainCancelled = false;
    _btnGenerate.disabled = true;

    // Score the first press against the beat
    const startHit = checkBeatHit();
    _showRhythmToast(startHit.quality);

    // Open the inline generation zone
    if (_genZone) {
        _genZone.classList.add('work-gen-zone--active');
    }

    try {
        while (state.activeOrder && !_chainCancelled) {
            const order = state.activeOrder;
            _roundSpawnTime = performance.now();
            const { result, reactionMs } = await runMinigen({
                tags: order.miniGenTags || null,
                mode: order.miniGenMode || 'standard',
                inlineContainer: _genZone || null,
            });

            generateForActiveOrder(result, reactionMs, getRhythmMultiplier());
            _render();

            // Quality feedback + beat-aligned gap (only between rounds, not after final pick)
            if (state.activeOrder && !_chainCancelled) {
                _showGenFeedback(getLastBeatQuality());
                await _waitForNextRound(_roundSpawnTime);
            }
        }
    } catch (err) {
        console.error('[work] chain error:', err);
        try { generateForActiveOrder('skip', 9999, 1); } catch (_) {}
        _render();
    } finally {
        // Always reset generating flag and collapse zone
        _generating = false;
        if (_genZone) {
            _genZone.classList.remove('work-gen-zone--active');
        }
    }

    _render(); // re-enables button, shows updated order pool
}

// ─────────────────────────────────────────────────────────────
// Format currency (compact)
// ─────────────────────────────────────────────────────────────

function _fmt(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M₽';
    if (n >= 1_000)     return (n / 1_000).toFixed(1)     + 'K₽';
    return Math.round(n) + '₽';
}

// ─────────────────────────────────────────────────────────────
// Economy callbacks — call these from main.js when economy fires
// ─────────────────────────────────────────────────────────────

export function onOrdersChanged() { _render(); }
export function onStateChanged()  { _render(); }
