// src/day/day-cycle.js — Day phase management, in-game clock, offline agent
// Imports only from core/config and core/state to avoid circular deps.
// Tickers (economy.js) are wired externally via setDayCycleCallbacks().

import { Config } from '../core/config.js';
import { state, saveState } from '../core/state.js';

// ─────────────────────────────────────────────────────────────
// Phase state
// ─────────────────────────────────────────────────────────────

// _phase is the authoritative runtime value; state.currentPhase mirrors it for persistence.
let _phase = Config.DAY_PHASE.PLANNING;

export function getCurrentPhase() { return _phase; }

/**
 * Restore phase from persisted state.currentPhase after loadState().
 * WORK phase cannot be restored (timer state is lost on reload) → falls back to PLANNING.
 */
export function restorePhaseFromState() {
    const saved = state.currentPhase;
    const restorable = [Config.DAY_PHASE.REST, Config.DAY_PHASE.RESULTS, Config.DAY_PHASE.PLANNING];
    _phase = restorable.includes(saved) ? saved : Config.DAY_PHASE.PLANNING;
    state.currentPhase = _phase;
}

// ─────────────────────────────────────────────────────────────
// Work timer state
// ─────────────────────────────────────────────────────────────

let _workStartedAt  = 0;   // Date.now() when WORK phase began
let _workPausedAt   = 0;   // Date.now() when tab hid (0 = not paused)
let _workPausedMs   = 0;   // cumulative ms spent paused this session
let _workTimerId    = null;
let _stressHistId   = null;

// ─────────────────────────────────────────────────────────────
// Callbacks (wired by main.js via setDayCycleCallbacks)
// ─────────────────────────────────────────────────────────────

let _onPhaseChange   = null;  // (phase: string) => void
let _onWorkTick      = null;  // ({inGameHour: float, progress: float}) => void
let _onOfflineResult = null;  // ({earnedFunds: Decimal, hoursElapsed: float}) => void
let _onDayResults    = null;  // (resultsData: object) => void

export function setDayCycleCallbacks({ onPhaseChange, onWorkTick, onOfflineResult, onDayResults } = {}) {
    if (onPhaseChange)   _onPhaseChange   = onPhaseChange;
    if (onWorkTick)      _onWorkTick      = onWorkTick;
    if (onOfflineResult) _onOfflineResult = onOfflineResult;
    if (onDayResults)    _onDayResults    = onDayResults;
}

// ─────────────────────────────────────────────────────────────
// Phase transitions
// ─────────────────────────────────────────────────────────────

/**
 * Enter PLANNING phase. Resets daily transients, applies nextDayBuffs.
 * Called by startNextDay() and on first load.
 */
export function startDay() {
    _setPhase(Config.DAY_PHASE.PLANNING);
    // Halve current stress (accumulated is untouched until weekend)
    state.stress = Math.floor(state.stress * 0.5);
    _applyNextDayBuffs();
    state.nextDayBuffs   = {};   // clear AFTER applying
    state.inGameHour     = 9.0;
    state.stressHistory  = [];
    state.comboCount     = 0;
    state.comboMultiplier = 1.0;
    state.restUsageCounts = {};
    saveState();
}

/**
 * Transition PLANNING → WORK. Starts work timer and tickers (via onPhaseChange callback).
 */
export function advanceToWork() {
    if (_phase !== Config.DAY_PHASE.PLANNING) return;
    _setPhase(Config.DAY_PHASE.WORK);
    _workStartedAt = Date.now();
    _workPausedAt  = 0;
    _workPausedMs  = 0;
    state.inGameHour     = 9.0;
    state.stressHistory  = [];
    state.comboCount     = 0;
    state.comboMultiplier = 1.0;
    _startWorkTimer();
    saveState();
}

/**
 * End WORK early (player presses "End Day") or called when timer expires.
 */
export function endWorkEarly() {
    if (_phase !== Config.DAY_PHASE.WORK) return;
    _finalizeWorkHour();
    _doTransitionToResults();
}

/**
 * Transition RESULTS → REST. Tickers remain stopped; zen ticker started by onPhaseChange.
 */
export function advanceToRest() {
    if (_phase !== Config.DAY_PHASE.RESULTS) return;
    _setPhase(Config.DAY_PHASE.REST);
    saveState();
}

/**
 * Sleep: increment day counters and move time to 8:00 AM.
 * Switches rest screen to morning mode without changing phase.
 */
export function sleepToMorning() {
    if (_phase !== Config.DAY_PHASE.REST) return;
    state.dayCount  = (state.dayCount  || 1) + 1;
    state.dayOfWeek = (((state.dayOfWeek || 1) - 1 + 1) % Config.WEEKEND_CYCLE_DAYS) + 1;
    if (state.dayOfWeek === 1) {
        state.accumulatedStress = 0;   // weekend: accumulated stress fully resets
    }
    state.dailyStats      = _freshDailyStats();
    state.inGameHour      = 8.0;
    state.restMorning     = true;
    state.restUsageCounts = {};
    saveState();
}

/**
 * Transition REST (morning) → PLANNING. Must call sleepToMorning() first.
 */
export function startNextDay() {
    if (_phase !== Config.DAY_PHASE.REST) return;
    // Guard: if somehow called without sleeping first, do the day increment now
    if (!state.restMorning) {
        state.dayCount  = (state.dayCount  || 1) + 1;
        state.dayOfWeek = (((state.dayOfWeek || 1) - 1 + 1) % Config.WEEKEND_CYCLE_DAYS) + 1;
        if (state.dayOfWeek === 1) state.accumulatedStress = 0;
        state.dailyStats = _freshDailyStats();
    }
    state.restMorning = false;
    startDay();   // _applyNextDayBuffs() is called inside startDay()
}

// ─────────────────────────────────────────────────────────────
// REST activities (spend in-game hours, grant next-day buffs)
// ─────────────────────────────────────────────────────────────

/**
 * Registry of REST activity definitions.
 * morning:true  — only shown in morning sub-state
 * morning:false — only shown in evening
 * morning undefined — shown in both (quick pills only)
 */
export const REST_ACTIVITIES = [
    // ── Quick pills (smoke — evening only; coffee — both, context-aware) ──
    { id: 'smoke',          quick: true,  costHours: 0.5,         maxUses: 2,  morning: false,
      buff: { startingStressMultiplier: 0.90 } },
    { id: 'coffee_morning', quick: true,  costHours: 0.25,        maxUses: 1,  morning: true,
      buff: { energyBonus: 1 } },
    { id: 'coffee_evening', quick: true,  costHours: 0,           maxUses: 1,  morning: false,
      buff: { freeTimeBonus: 1.0, stressBonus: 5 } },
    // ── Evening outside activities ──
    { id: 'walk',   quick: false, costHours: 2,   morning: false, buff: { accumulatedStressReduction: 0.15 } },
    { id: 'movie',  quick: false, costHours: 3,   morning: false, buff: { comboBonusMultiplier: 1.10 }       },
    { id: 'bar',    quick: false, costHours: 2,   morning: false, buff: { fameBonus: 5 }                     },
    // ── Morning outside activities ──
    { id: 'breakfast', quick: false, costHours: 0.33, morning: true, buff: { energyBonus: 1 }                       },
    { id: 'park',      quick: false, costHours: 0.5,  morning: true, buff: { startingStressMultiplier: 0.90 }        },
    { id: 'exercise',  quick: false, costHours: 0.5,  morning: true, buff: { xpBonusMultiplier: 1.15 }               },
];

/** Available in-game hours remaining for REST activities.
 * Morning pool: 8:00 → 9:00 (1 hour to burn before work).
 * Evening pool: current time → midnight.
 */
export function getRestHoursLeft() {
    if (state.restMorning) {
        return Math.max(0, 9.0 - (state.inGameHour ?? 8.0));
    }
    return Math.max(0, 24 - (state.inGameHour ?? 18));
}

/**
 * Perform a REST activity. Returns true if successful, false if not enough hours.
 * Applies `costHours` to state.inGameHour and merges buff into state.nextDayBuffs.
 */
export function doRestActivity(activityId) {
    if (_phase !== Config.DAY_PHASE.REST) return false;
    const activity = REST_ACTIVITIES.find(a => a.id === activityId);
    if (!activity) return false;
    if (getRestHoursLeft() < activity.costHours) return false;
    // Check per-session usage limit
    if (activity.maxUses !== undefined) {
        if (!state.restUsageCounts) state.restUsageCounts = {};
        const used = state.restUsageCounts[activityId] || 0;
        if (used >= activity.maxUses) return false;
        state.restUsageCounts[activityId] = used + 1;
    }
    state.inGameHour += activity.costHours;
    // ── Immediate effects ──
    if (activity.buff.freeTimeBonus) {
        // Evening coffee: add free time by rewinding the clock, then add stress
        state.inGameHour = Math.max(0, state.inGameHour - activity.buff.freeTimeBonus);
    }
    if (activity.buff.stressBonus) {
        state.stress = Math.min(100, (state.stress || 0) + activity.buff.stressBonus);
    }
    if (activity.buff.fameBonus) {
        state.fame = (state.fame || 0) + activity.buff.fameBonus;
    }
    // ── Next-day buffs ──
    Object.keys(activity.buff)
        .filter(k => !['freeTimeBonus', 'stressBonus', 'fameBonus'].includes(k))
        .forEach(k => { state.nextDayBuffs[k] = activity.buff[k]; });
    saveState();
    return true;
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function _setPhase(phase, payload) {
    _phase = phase;
    state.currentPhase = phase;
    _onPhaseChange?.(phase, payload);
}

function _applyNextDayBuffs() {
    const buffs = state.nextDayBuffs || {};
    if (buffs.accumulatedStressReduction) {
        state.accumulatedStress = Math.max(
            0,
            state.accumulatedStress - Math.round(state.accumulatedStress * buffs.accumulatedStressReduction)
        );
    }
    if (buffs.startingStressMultiplier) {
        state.stress = Math.floor(state.stress * buffs.startingStressMultiplier);
    }
    if (buffs.energyBonus) {
        state.energyResourceMax = (state.energyResourceMax || 5) + buffs.energyBonus;
        state.energyResource    = state.energyResourceMax;
    }
    if (buffs.xpBonusMultiplier) {
        // Stored on state for economy.js to read at point of use (buildOrderFromCard)
        state.xpBonusMultiplier = buffs.xpBonusMultiplier;
    } else {
        state.xpBonusMultiplier = 1;
    }
    // comboBonusMultiplier is read at the point of use in economy.js
}

function _doTransitionToResults() {
    _clearWorkTimer();

    const peakStress = state.stressHistory.length
        ? Math.max(...state.stressHistory.map(p => p.v))
        : state.stress;
    const accGain = Math.round(peakStress * Config.STRESS_ACCUMULATED_RATIO);
    state.accumulatedStress = Math.min(100, (state.accumulatedStress || 0) + accGain);

    const resultsData = {
        dayCount:           state.dayCount,
        earned:             state.dailyStats?.earned ?? 0,
        completedOrders:    state.dailyStats?.completedOrders ?? 0,
        failedOrders:       state.dailyStats?.failedOrders ?? 0,
        autogenGenerations: state.dailyStats?.autogenGenerations ?? 0,
        xpGained:           state.dailyStats?.xpGained ?? 0,
        leveledUp:          state.dailyStats?.leveledUp ?? false,
        stressHistory:      [...state.stressHistory],
        accumulatedStress:  state.accumulatedStress,
    };
    saveState();
    _setPhase(Config.DAY_PHASE.RESULTS, resultsData);
    _onDayResults?.(resultsData);
}

function _freshDailyStats() {
    return { earned: 0, completedOrders: 0, failedOrders: 0, autogenGenerations: 0, xpGained: 0, leveledUp: false };
}

// ─────────────────────────────────────────────────────────────
// Work timer
// ─────────────────────────────────────────────────────────────

function _startWorkTimer() {
    _workTimerId = setInterval(_workTick, 100);
    _stressHistId = setInterval(
        _recordStressPoint,
        Config.STRESS_HISTORY_INTERVAL_SEC * 1000
    );
}

function _clearWorkTimer() {
    clearInterval(_workTimerId);
    clearInterval(_stressHistId);
    _workTimerId  = null;
    _stressHistId = null;
}

function _getWorkElapsedMs() {
    const now      = Date.now();
    const pauseNow = _workPausedAt ? (now - _workPausedAt) : 0;
    return Math.max(0, now - _workStartedAt - _workPausedMs - pauseNow);
}

function _workTick() {
    const elapsed  = _getWorkElapsedMs();
    const progress = Math.min(1, elapsed / Config.WORK_DURATION_MS);
    state.inGameHour = 9.0 + progress * Config.WORK_HOURS_SPAN;
    _onWorkTick?.({ inGameHour: state.inGameHour, progress });
    if (elapsed >= Config.WORK_DURATION_MS) {
        _finalizeWorkHour();
        _doTransitionToResults();
    }
}

function _finalizeWorkHour() {
    state.inGameHour = 9.0 + Config.WORK_HOURS_SPAN;
}

function _recordStressPoint() {
    if (_phase === Config.DAY_PHASE.WORK) {
        state.stressHistory.push({
            h:   +(state.inGameHour.toFixed(2)),
            v:   state.stress,
            acc: Math.min(100, state.accumulatedStress ?? 0),
        });
    }
}

// ─────────────────────────────────────────────────────────────
// Visibility / pause
// ─────────────────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        state.lastActiveTimestamp = Date.now();
        if (_phase === Config.DAY_PHASE.WORK && _workPausedAt === 0) {
            _workPausedAt = Date.now();
        }
        saveState();
    } else {
        const now = Date.now();
        if (_phase === Config.DAY_PHASE.WORK && _workPausedAt > 0) {
            _workPausedMs += now - _workPausedAt;
            _workPausedAt  = 0;
        }
        _calcOfflineAgent(now);
        state.lastActiveTimestamp = now;
        saveState();
    }
});

// ─────────────────────────────────────────────────────────────
// Offline agent
// ─────────────────────────────────────────────────────────────

/**
 * Call once after loadState() to award any offline agent earnings.
 */
export function calcOfflineOnStartup() {
    const lastTs = state.lastActiveTimestamp;
    if (!lastTs || lastTs <= 0) {
        state.lastActiveTimestamp = Date.now();
        return;
    }
    _calcOfflineAgent(Date.now());
    state.lastActiveTimestamp = Date.now();
    saveState();
}

function _calcOfflineAgent(now) {
    if (!state.skillTree?.purchased?.ai_agent) return;
    const lastTs = state.lastActiveTimestamp;
    if (!lastTs || lastTs <= 0) return;
    const elapsed = now - lastTs;
    if (elapsed < 10_000) return;   // ignore sub-10s gaps

    const capHours = state.offlineAgentCapHours || Config.OFFLINE_AGENT_CAP_BASE_HOURS;
    const capMs    = capHours * 3_600_000;
    const effectMs = Math.min(elapsed, capMs);

    // Mirror startAgentTicker formula
    const _boostTier  = Math.min(state.skillTree?.tiers?.ai_agentboost || 0, 5);
    const _intervalMs = [30, 25, 20, 15, 10, 5][_boostTier] * 1000;
    const _buffTier   = Math.min(state.skillTree?.tiers?.ai_agentbuff  || 0, 5);
    const _pct        = [25, 50, 100, 200, 350, 500][_buffTier] / 100;

    const ticks = Math.floor(effectMs / _intervalMs);
    if (ticks <= 0) return;

    // Estimate per-tick agent income from historical earnings
    const ticksPerDay     = Math.max(1, Math.floor(Config.WORK_DURATION_MS / _intervalMs));
    const estPerDay       = state.stats.totalMoneyEarned.div(Math.max(1, state.dayCount));
    const perTick         = estPerDay.mul(_pct).div(ticksPerDay);
    const earned          = perTick.mul(ticks).floor();
    if (earned.lte(0)) return;

    state.funds = state.funds.add(earned);
    state.stats.totalMoneyEarned = state.stats.totalMoneyEarned.add(earned);
    _onOfflineResult?.({ earnedFunds: earned, hoursElapsed: effectMs / 3_600_000 });
}
