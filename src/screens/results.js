// src/screens/results.js — RESULTS phase UI
// Shows daily stats, SVG stress graph (stressHistory), level-up banner.

import { state }          from '../core/state.js';
import { advanceToRest }  from '../day/day-cycle.js';

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────

const _dayLabel      = document.getElementById('results-day-label');
const _earnedEl      = document.getElementById('results-earned');
const _xpEl          = document.getElementById('results-xp');
const _completedEl   = document.getElementById('results-completed');
const _failedEl      = document.getElementById('results-failed');
const _autogenEl     = document.getElementById('results-autogen');
const _accStressEl   = document.getElementById('results-acc-stress');
const _accBar        = document.getElementById('results-acc-bar');
const _levelBanner   = document.getElementById('levelup-banner');
const _levelValue    = document.getElementById('levelup-value');
const _svgEl         = document.getElementById('stress-graph-svg');
const _lineCurr      = document.getElementById('stress-line-curr');
const _lineAcc       = document.getElementById('stress-line-acc');
const _btnToRest     = document.getElementById('btn-to-rest');

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

export function onEnterResults(dailyStats) {
    _render(dailyStats);
    _btnToRest.onclick = () => advanceToRest();
}

// ─────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────

function _render(passedStats) {
    const s = passedStats || state.dailyStats || {};

    _dayLabel.textContent = `День ${state.dayCount || 1}`;

    // Stats
    _earnedEl.textContent    = _fmt(s.earned    ?? 0);
    _xpEl.textContent        = `+${s.xpGained  ?? 0}`;
    _completedEl.textContent = s.completedOrders ?? 0;
    _failedEl.textContent    = s.failedOrders    ?? 0;
    _autogenEl.textContent   = s.autogenGenerations ?? 0;

    // Accumulated stress
    const acc = Math.min(100, state.accumulatedStress ?? 0);
    _accStressEl.textContent    = Math.round(acc);
    _accBar.style.width         = `${acc}%`;

    // Level up
    if (s.leveledUp) {
        _levelBanner.classList.add('visible');
        _levelValue.textContent = `Уровень ${state.level}`;
    } else {
        _levelBanner.classList.remove('visible');
    }

    // SVG stress graph
    _drawGraph();
}

// ─────────────────────────────────────────────────────────────
// SVG stress graph
// stressHistory: Array of { t: seconds, stress: 0–100, accStress: 0–100 }
// viewBox: "0 0 100 40"
// ─────────────────────────────────────────────────────────────

function _drawGraph() {
    const history = state.stressHistory;
    if (!history || history.length < 2) {
        _lineCurr.setAttribute('points', '');
        _lineAcc.setAttribute('points',  '');
        return;
    }

    const VW = 100, VH = 40;
    const tMin   = history[0].h;
    const tMax   = history[history.length - 1].h;
    const tRange = Math.max(1, tMax - tMin);

    // Build point strings for both lines
    const ptsCurr = [];
    const ptsAcc  = [];

    for (const entry of history) {
        const x  = ((entry.h - tMin) / tRange) * VW;
        const yC = VH - (Math.min(100, entry.v   ?? 0) / 100) * (VH - 2) - 1;
        const yA = VH - (Math.min(100, entry.acc ?? 0) / 100) * (VH - 2) - 1;
        ptsCurr.push(`${x.toFixed(1)},${yC.toFixed(1)}`);
        ptsAcc.push( `${x.toFixed(1)},${yA.toFixed(1)}`);
    }

    _lineCurr.setAttribute('points', ptsCurr.join(' '));
    _lineAcc.setAttribute( 'points', ptsAcc.join(' '));
}

// ─────────────────────────────────────────────────────────────
// Format currency
// ─────────────────────────────────────────────────────────────

function _fmt(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M₽';
    if (n >= 1_000)     return (n / 1_000).toFixed(1)     + 'K₽';
    return Math.round(n) + '₽';
}
