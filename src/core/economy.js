// src/economy.js — All game logic: order lifecycle, stress, smoking, tickers

import { Config, getOrderTemplates, STORY_ORDERS, RESEARCH_TASKS, PROMOTION_TASKS, CONTRACT_TASKS } from './config.js';
import { state, saveState } from './state.js';
import { t } from './i18n.js';
import { getCurrentPhase } from '../day/day-cycle.js';

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Rebuild and shuffle the template deck from window.ORDER_TEMPLATES filtered by unlocked types */
function refillDeck() {
    const templates = getOrderTemplates().filter(t => {
        const type = t['task-type'] || t.taskType || 'luck';
        // 'out' type is now handled as contracts, not freelance spawn
        if (type === 'out') return false;
        return state.unlockedTaskTypes.includes(type) || type === 'luck';
    });
    // Fisher-Yates shuffle
    const deck = [...templates];
    for (let i = deck.length - 1; i > 0; i--) {
        const j = randomInt(0, i);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    state.templateDeck = deck;
}

function pullTemplateFromDeck() {
    if (state.templateDeck.length === 0) refillDeck();
    // If still empty (no templates loaded yet), return a fallback
    if (state.templateDeck.length === 0) {
        return { title: 'Тестовый заказ', 'task-type': 'luck', durationSec: [10, 20], generations: [1, 3], payout: [50, 150] };
    }
    return state.templateDeck.pop();
}

// ─────────────────────────────────────────────────────────────
// Order Builders
// ─────────────────────────────────────────────────────────────

export function buildOrder(index = 0) {
    const template = pullTemplateFromDeck();
    const sourceTitle = String(template.title || '');
    const taskType = template['task-type'] || template.taskType || 'default';

    const payoutMin = Array.isArray(template.payout) ? template.payout[0] : 50;
    const payoutMax = Array.isArray(template.payout) ? template.payout[1] : 200;
    const basePayout = randomInt(payoutMin, payoutMax);
    const payoutRatio = payoutMax > payoutMin ? (basePayout - payoutMin) / (payoutMax - payoutMin) : 1;

    const durMin = Array.isArray(template.durationSec) ? template.durationSec[0] : 10;
    const durMax = Array.isArray(template.durationSec) ? template.durationSec[1] : 30;
    const baseDuration = randomInt(durMin, durMax);

    const genMin = Array.isArray(template.generations) ? template.generations[0] : 1;
    const genMax = Array.isArray(template.generations) ? template.generations[1] : 3;
    const baseGenerations = randomInt(genMin, genMax);
    const scaledGenerations = Math.max(1, Math.ceil(baseGenerations * state.level * Config.EXPONENT_GROWTH));

    const urgent = /^\s*(urgent:|срочно:)/i.test(sourceTitle);
    const jobLossSec = urgent ? 5 : randomInt(15, 30);
    const riskMultiplier = urgent ? 1.2 : 1;

    const realPayout = Math.max(1, Math.round(
        (1 / Math.max(1, baseDuration)) *
        (baseGenerations * state.level) *
        basePayout *
        Config.PAYOUT_SCALE *
        riskMultiplier
    ));

    const now = Date.now();
    return {
        id: `${now}-${index}-${Math.random().toString(16).slice(2, 8)}`,
        title: sourceTitle,
        taskCategory: Config.TASK_CATEGORIES.ORDERS,
        taskType,
        durationSec: baseDuration,
        generations: baseGenerations,
        requiredGenerations: scaledGenerations,
        basePayout,
        realPayout,
        iconUrl: `images/icons/job/icon-job-${taskType}.png`,
        isHighPayout: payoutRatio >= 0.8,
        job_loss: jobLossSec,
        spawnedAt: now,
        expiresAt: now + jobLossSec * 1000,
        isLocked: false,
        generationsAttempted: 0,
        generateActionLabel: template.generateActionLabel || 'Работать',
    };
}

export function buildStoryOrder(template) {
    const now = Date.now();
    return {
        id: `story-${template.id}-${now}`,
        storyId: template.id,
        title: template.title,
        taskCategory: Config.TASK_CATEGORIES.STORY,
        taskType: template.taskType || 'story',
        isStory: true,
        durationSec: template.durationSec || 60,
        requiredGenerations: template.requiredGenerations || template.generations || 1,
        generationsAttempted: 0,
        realPayout: template.realPayout || 0,
        xpReward: template.xpReward || 0,
        iconUrl: template.iconUrl || 'images/icons/job/icon-job-story.png',
        noFailPenalty: template.noFailPenalty || false,
        generateActionLabel: template.generateActionLabel || 'Работать',
        expiresAt: Infinity,
        job_loss: Infinity,
        spawnedAt: now,
        unlockTaskTypes:    template.unlockTaskTypes    || [],
        unlockSpecialTasks: template.unlockSpecialTasks || [],
        chanceBonus: template.chanceBonus || 0,
        miniGenTags: template.miniGenTags  || null,
    };
}

export function isOrderStartLocked(order) {
    if (!order) return true;
    if (order.isLocked) return true;
    // Gate: stays locked until the tshirt slot is equipped (purchased from shop)
    return order.storyId === 'call_with_client'
        && !state.wardrobeSelected?.tshirt
        && !!state.ch1FiredEvents?.outfit_gate_start_call_with_client;
}

// ─────────────────────────────────────────────────────────────
// Spawning
// ─────────────────────────────────────────────────────────────

export function spawnOrder() {
    if (getCurrentPhase() !== Config.DAY_PHASE.WORK) return;
    const regularCount = state.orders.filter(o => !o.isStory).length;
    if (regularCount >= Config.MAX_VISIBLE_ORDERS) return;
    state.orders.push(buildOrder(state.orders.length));
    // Notify UI if overlay is open
    _notifyOrdersChanged();
}

export function spawnStoryOrder(storyId) {
    // Don't duplicate
    if (state.orders.some(o => o.storyId === storyId)) return;
    if (state.completedStoryOrderIds.includes(storyId)) return;

    const template = STORY_ORDERS.find(t => t.id === storyId);
    if (!template) return;

    state.orders.push(buildStoryOrder(template));
    _notifyOrdersChanged();
}

// ─────────────────────────────────────────────────────────────
// Order Lifecycle
// ─────────────────────────────────────────────────────────────

export function startOrder(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return false;
    if (isOrderStartLocked(order)) return false;

    // First attempt on this story task triggers the outfit gate;
    // after that the task stays locked until the tshirt is purchased.
    if (order.storyId === 'call_with_client' && !state.wardrobeSelected?.tshirt) {
        _fireCh1EventCallback?.('outfit_gate_start_call_with_client');
        _notifyOrdersChanged();
        _notifyStateChanged();
        return false;
    }
    // If a repeatable/special task is currently active, cancel it silently
    const prev = state.activeOrder;
    if (prev && (prev.autoRepeat || prev.isSpecial || prev.isRepeatable)) {
        state.activeOrder = null;
        delete state.pendingAutoRepeatSpecialTaskId;
    }

    order.startedAt = Date.now();
    state.activeOrder = order;
    state.currentStatus = Config.STATUS.WORK;
    _notifyStateChanged();
    return true;
}

export function completeOrder(orderId) {
    // Find in orders pool; special tasks live only in activeOrder
    let order = state.orders.find(o => o.id === orderId);
    if (!order && state.activeOrder?.id === orderId) order = state.activeOrder;
    if (!order) return;

    _tryShowContextualComment(order, 'order_completed');

    // Award payout (with optional mini-game modifier + rhythm bonus + ai_neural stack bonus)
    const _minigenBonus = order.minigenPayoutBonus || 0;
    const _rhythmBonus  = order.rhythmBonusTotal   || 0;
    const _neuralMult   = 1 + (state.neuralStack || 0);  // 1.0 (no neural) to 2.0 (max stack)
    // gg_contractor: bonus payout multiplier for contract tasks (+50/100/250/500/1500%)
    const _contractorBonuses = [0, 0.50, 1.00, 2.50, 5.00, 15.00];
    const _contractorTier    = Math.min(state.skillTree?.tiers?.gg_contractor || 0, 5);
    const _contractorMult    = (_contractorTier > 0 && (order.taskType === 'contract' || order.taskCategory === 'contracts'))
        ? 1 + _contractorBonuses[_contractorTier]
        : 1;
    const _finalPayout  = Math.max(0, Math.round((order.realPayout + _minigenBonus + _rhythmBonus) * _neuralMult * _contractorMult));
    state.funds = state.funds.add(_finalPayout);
    state.stats.totalMoneyEarned = state.stats.totalMoneyEarned.add(_finalPayout);
    state.stats.completedOrders++;

    // Award XP — contractor bonus applies to contract xpReward too
    const _rawXp = order.xpReward != null ? order.xpReward : Math.round(order.realPayout * Config.XP_PER_PAYOUT_RATIO);
    const xpGain = Math.round(_rawXp * _contractorMult);
    gainXp(xpGain);

    // Card-based orders: award fame reward
    if (order.isCardBased && order.fameReward) {
        state.fame = (state.fame || 0) + order.fameReward;
    }

    // Story-specific effects
    if (order.isStory) {
        state.completedStoryOrderIds.push(order.storyId);
        if (order.unlockTaskTypes?.length) {
            for (const t of order.unlockTaskTypes) {
                if (!state.unlockedTaskTypes.includes(t)) state.unlockedTaskTypes.push(t);
            }
        }
        if (order.unlockSpecialTasks?.length) {
            if (!state.unlockedSpecialTasks) state.unlockedSpecialTasks = {};
            for (const tid of order.unlockSpecialTasks) {
                state.unlockedSpecialTasks[tid] = true;
            }
        }
        if (order.chanceBonus) state.storyChanceBonus += order.chanceBonus;
        _fireCh1EventCallback?.('story_complete_' + order.storyId);
    }

    // Special task (research / promotion) effects
    if (order.isSpecial) {
        const tid = order.specialTaskId;
        state.researchTaskCompletions[tid] = (state.researchTaskCompletions[tid] || 0) + 1;
        // Apply template rewards that weren't in the live order object
        const tmpl = RESEARCH_TASKS.find(t => t.id === tid)
                   || PROMOTION_TASKS.find(t => t.id === tid)
                   || CONTRACT_TASKS.find(t => t.id === tid);
        if (tmpl) {
            if (tmpl.chanceBonus)       state.storyChanceBonus += tmpl.chanceBonus;
            if (tmpl.skillPointsReward) state.skillPoints = (state.skillPoints || 0) + tmpl.skillPointsReward;
            if (tmpl.prestigePoolBonus) state.virtualPrestigePool = (state.virtualPrestigePool || 0) + tmpl.prestigePoolBonus;
            if (tmpl.prestigeReward)    state.prestige = (state.prestige || 0) + tmpl.prestigeReward;
            if (tmpl.skillPointsCost)   state.skillPoints = Math.max(0, (state.skillPoints || 0) - tmpl.skillPointsCost);
            if (tmpl.expertPointsReward) state.expertPoints = (state.expertPoints || 0) + tmpl.expertPointsReward;
            if (tmpl.maxCompletions === 1) delete state.unlockedSpecialTasks[tid];
        }
        _fireCh1EventCallback?.('special_complete_' + tid);
    }

    // Funds milestone trigger
    _tryFireFundsMilestone();

    // Remove from orders pool (no-op for special tasks not in pool)
    state.orders = state.orders.filter(o => o.id !== orderId);
    if (state.activeOrder?.id === orderId) {
        const wasAutoRepeat = state.activeOrder.autoRepeat === true;
        const specialId     = state.activeOrder.specialTaskId;
        const completedType = state.activeOrder.taskType;
        state.activeOrder = null;
        // Auto-repeat: smoke break between batches, then restart
        if (wasAutoRepeat && specialId) {
            const tmpl = RESEARCH_TASKS.find(t => t.id === specialId)
                      || PROMOTION_TASKS.find(t => t.id === specialId)
                      || CONTRACT_TASKS.find(t => t.id === specialId);
            if (tmpl && tmpl.repeatable) {
                // Store pending restart; smoke break ticker will resume it
                state.pendingAutoRepeatSpecialTaskId = specialId;
                const didSmoke = doSmokeBreak();
                if (!didSmoke) {
                    // No cigs — restart immediately without break
                    delete state.pendingAutoRepeatSpecialTaskId;
                    const newOrder = buildSpecialTask(tmpl);
                    newOrder.autoRepeat = true;
                    state.activeOrder   = newOrder;
                    state.currentStatus = Config.STATUS.WORK;
                }
                saveState();
                _notifyOrdersChanged();
                _notifyStateChanged();
                return;
            }
        }
        // Auto smoke break after finishing a task; falls back to REST if no cigs
        if (!doSmokeBreak()) {
            state.currentStatus = Config.STATUS.REST;
        }
    }

    saveState();
    _notifyOrdersChanged();
    _notifyStateChanged();
}

export function failOrder(orderId) {
    let order = state.orders.find(o => o.id === orderId);
    if (!order && state.activeOrder?.id === orderId) order = state.activeOrder;
    if (!order) return;

    _tryShowContextualComment(order, 'order_failed');

    if (!order.noFailPenalty) {
        // Differentiate: order was accepted+started (failed) vs expired in pool (missed)
        if (order.startedAt) {
            state.stats.failedOrders++;
        } else {
            state.stats.missedOrders = (state.stats.missedOrders || 0) + 1;
        }
    }

    // Fire fail event for story orders
    if (order.isStory) {
        _fireCh1EventCallback?.('story_fail_' + order.storyId);
    }

    state.orders = state.orders.filter(o => o.id !== orderId);
    if (state.activeOrder?.id === orderId) {
        state.activeOrder = null;
        // Auto smoke break after failing a task
        if (!doSmokeBreak()) {
            state.currentStatus = Config.STATUS.REST;
        }
    }
    _notifyOrdersChanged();
    _notifyStateChanged();
}

// ─────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────

export function registerGenerationStep(isAutogen = false) {
    if (!state.activeOrder) return;
    // Cooldown only applies to autogen — manual clicks are throttled by the minigen popup itself
    if (isAutogen && Date.now() < state.generationCooldownUntil) return;

    state.activeOrder.generationsAttempted++;
    if (isAutogen) {
        state.generationCooldownUntil = Date.now() + state.generationCooldownMs;
    }

    if (isAutogen) {
        state.stats.autogenGenerations++;
    } else {
        state.stats.manualGenerations++;
        _tryShowManualGenerationMilestoneComment();
    }

    // gg_conf: снижение стресса от кликов (−2/−3/−5, минимум 1)
    let _stressAmt = Config.STRESS_PER_GENERATION;
    const _confTier = state.skillTree?.tiers?.gg_conf || 0;
    if (_confTier >= 1) _stressAmt = Math.max(1, _stressAmt - 2);
    if (_confTier >= 2) _stressAmt = Math.max(1, _stressAmt - 3);
    if (_confTier >= 3) _stressAmt = Math.max(1, _stressAmt - 5);
    // gg_willpower: generation_nostress_chance_set — chance to skip stress entirely
    const _willChances = [0, 0.05, 0.10, 0.15, 0.25, 0.50];
    const _willTier = Math.min(state.skillTree?.tiers?.gg_willpower || 0, 5);
    if (_willTier === 0 || Math.random() >= _willChances[_willTier]) {
        addStress(_stressAmt);
    }

    // Fire per-generation CH1 events
    const order = state.activeOrder;
    const n = order.generationsAttempted;
    if (order.isStory) {
        _fireCh1EventCallback?.('story_gen_' + order.storyId + '_' + n);
    } else if (order.isSpecial) {
        _fireCh1EventCallback?.('special_gen_' + order.specialTaskId + '_' + n);
    }

    if (order.generationsAttempted >= order.requiredGenerations) {
        completeOrder(order.id);
    } else {
        _notifyStateChanged();
    }
}

/**
 * Called when the mini-game popup resolves for a manual generation step.
 * 'correct' → gen counts; no payout change; streak++; streak==n → releaseStress
 * 'partial' → gen counts; deduct (1/n * payout) / 2; reset streak
 * 'wrong'   → gen NOT counted; deduct 1/n * payout; reset streak
 * 'skip'    → gen NOT counted; no payout change
 */
export function registerGenerationStepWithResult(result, isAutogen = false) {
    if (!state.activeOrder) return;
    const order   = state.activeOrder;
    const n       = Math.max(1, order.requiredGenerations);
    const penalty = Math.round(order.realPayout / n);  // 1/n * 100% of payout

    order.minigenPayoutBonus = order.minigenPayoutBonus || 0;
    order.minigenStreak      = order.minigenStreak      || 0;

    // Chapter 1 story tasks are exempt from mini-game payout penalties
    const applyPenalty = !order.isStory;

    if (result === 'correct') {
        if (isAutogen) state.stats.autogenSuccesses = (state.stats.autogenSuccesses || 0) + 1;
        order.minigenStreak++;
        if (order.minigenStreak >= n) {
            order.minigenStreak = 0;
            releaseStress(Config.STRESS_PER_GENERATION);  // reward: cancel one gen's stress
        }
        // ai_autoresearch: direct XP to research pool on correct choice
        // Cumulative values: tier 1=10, 2=+50(60), 3=+100(160), 4=+500(660), 5=+1000(1660)
        const _autoresearchCumulative = [0, 10, 60, 160, 660, 1660];
        const _autoresearchTier = Math.min(state.skillTree?.tiers?.ai_autoresearch || 0, 5);
        if (_autoresearchTier > 0 && state.activeResearchPool) {
            state.activeResearchPool.xp = state.activeResearchPool.xp.add(_autoresearchCumulative[_autoresearchTier]);
            if (state.activeResearchPool.xp.gte(state.activeResearchPool.xpRequired)) {
                _completeResearchPool();
            }
        }
        // ai_neural: increment payout stack on correct choice
        if (state.skillTree?.purchased?.ai_neural) {
            state.neuralStack = Math.min(1.0, (state.neuralStack || 0) + 0.005);
        }
        // gg_focus: accumulate smoke-skip chance on correct choice
        if (state.skillTree?.purchased?.gg_focus) {
            state.focusSkipChance = Math.min(1, (state.focusSkipChance || 0) + 0.2);
        }
        registerGenerationStep(isAutogen);
    } else if (result === 'partial') {
        if (applyPenalty) order.minigenPayoutBonus -= Math.round(penalty * 0.5);
        order.minigenStreak = 0;
        registerGenerationStep(isAutogen);
    } else if (result === 'wrong') {
        if (isAutogen) state.stats.autogenFailures = (state.stats.autogenFailures || 0) + 1;
        if (applyPenalty) order.minigenPayoutBonus -= penalty;
        order.minigenStreak = 0;
        // ai_neural: reset stack on wrong choice
        if (state.skillTree?.purchased?.ai_neural) state.neuralStack = 0;
        if (order.isStory) {
            // Story tasks: wrong choice still counts the generation, just no penalty
            registerGenerationStep(isAutogen);
        } else {
            // Non-story: wrong choice doesn't count the generation
            _notifyStateChanged();
        }
    } else {
        // 'skip' — generation not counted, no payout change
        _notifyStateChanged();
    }
}

/**
 * Called by work.js after the mini-game resolves.
 * Applies combo logic then delegates to registerGenerationStepWithResult.
 * @param {'correct'|'partial'|'wrong'|'skip'} result
 * @param {number} reactionMs       Time from popup open to player pick.
 * @param {number} [rhythmMult=1]   Rhythm multiplier from rhythm.js (1.0 = no bonus).
 */
export function generateForActiveOrder(result, reactionMs = 9999, rhythmMult = 1) {
    if (!state.activeOrder) return;
    const order = state.activeOrder;

    // ── Rhythm bonus ─────────────────────────────────────────────
    // Per-gen value × (multiplier - 1) accumulated as rhythmBonusTotal
    if (rhythmMult > 1) {
        const perGenValue = Math.round(order.realPayout / Math.max(1, order.requiredGenerations));
        order.rhythmBonusTotal = (order.rhythmBonusTotal || 0) + Math.round(perGenValue * (rhythmMult - 1));
    }

    // ── Combo logic ──────────────────────────────────────────────
    const isFast = result === 'correct' && reactionMs < Config.COMBO_FAST_REACTION_MS;
    if (isFast) {
        state.comboCount      = (state.comboCount      || 0) + 1;
        state.comboMultiplier = 1 + state.comboCount * Config.COMBO_PAYOUT_PER_STEP;
        // Reward: add a per-step combo bonus to this order's payout
        order.minigenPayoutBonus =
            (order.minigenPayoutBonus || 0) +
            Math.round(order.realPayout * Config.COMBO_PAYOUT_PER_STEP);
    } else if (result === 'wrong') {
        state.comboCount      = 0;
        state.comboMultiplier = 1.0;
    }
    // partial / skip: preserve current combo without rewarding it

    // ── Snapshot for dailyStats diff ─────────────────────────────
    const _prevCompleted = state.stats.completedOrders;
    const _prevFailed    = state.stats.failedOrders || 0;
    const _prevEarned    = state.stats.totalMoneyEarned;
    const _prevLevel     = state.level;
    const _prevXp        = state.xp;

    registerGenerationStepWithResult(result, false);

    // ── Update dailyStats ─────────────────────────────────────────
    if (!state.dailyStats) {
        state.dailyStats = { earned: 0, completedOrders: 0, failedOrders: 0, autogenGenerations: 0, xpGained: 0, leveledUp: false };
    }
    const ds = state.dailyStats;
    if (state.stats.completedOrders > _prevCompleted) {
        ds.completedOrders = (ds.completedOrders || 0) + (state.stats.completedOrders - _prevCompleted);
        ds.earned = (ds.earned || 0) + state.stats.totalMoneyEarned.sub(_prevEarned).toNumber();
    }
    if ((state.stats.failedOrders || 0) > _prevFailed) {
        ds.failedOrders = (ds.failedOrders || 0) + ((state.stats.failedOrders || 0) - _prevFailed);
    }
    // XP delta: level-up resets xp to 0, so only count post-reset xp gains
    if (state.level > _prevLevel) {
        ds.leveledUp = true;
        if (state.xp.gt(0)) ds.xpGained = (ds.xpGained || 0) + state.xp.toNumber();
    } else if (state.xp.gt(_prevXp)) {
        ds.xpGained = (ds.xpGained || 0) + state.xp.sub(_prevXp).toNumber();
    }
    ds.autogenGenerations = state.stats.autogenGenerations || 0;
}

/** Alias used by work.js smoke-break button. */
export const smokeBreak = doSmokeBreak;

// ─────────────────────────────────────────────────────────────
// Stress & Smoking
// ─────────────────────────────────────────────────────────────

// ── Effective stress maximum (gg_self_aware bonus) ─────────────
const _SELF_AWARE_CUMULATIVE = [0, 10, 25, 50, 75, 100];
export function getEffectiveStressMax() {
    const t = Math.min(state.skillTree?.tiers?.gg_self_aware || 0, 5);
    return Config.STRESS_MAX + _SELF_AWARE_CUMULATIVE[t];
}

export function addStress(n) {
    // Nicotine withdrawal: all stress sources deal 3x damage
    const multiplier = state.nicotineWithdrawal ? 3 : 1;
    const actual = n * multiplier;
    const _maxStress = getEffectiveStressMax();
    state.stress = Math.min(_maxStress, state.stress + actual);
    _onStressAdded?.(actual);
    // Auto smoke break when stress bar fills up
    if (state.stress >= _maxStress && state.currentStatus !== Config.STATUS.SMOKE) {
        doSmokeBreak();
    }
    _notifyStateChanged();
}

export function releaseStress(n) {
    const _actual = Math.min(n, state.stress);
    if (_actual > 0) state.stats.totalStressRelieved = (state.stats.totalStressRelieved || 0) + _actual;
    state.stress = Math.max(0, state.stress - n);
    _notifyStateChanged();
}

export function doSmokeBreak() {
    if (state.goods.cigarettes <= 0) _tryAutoBuyCigs();
    if (state.goods.cigarettes <= 0) {
        // No cigarettes — enter withdrawal, fire panic event once
        if (!state.nicotineWithdrawal) {
            state.nicotineWithdrawal = true;
            _notifyStateChanged();
        }
        _onNoCigsCallback?.();
        return false;
    }

    // gg_focus: smoke-skip chance check
    if (state.skillTree?.purchased?.gg_focus && state.focusSkipChance > 0) {
        if (Math.random() < state.focusSkipChance) {
            state.focusSkipChance = 0;  // consumed
            _notifyStateChanged();
            return false;  // skip smoke break
        }
        state.focusSkipChance = Math.max(0, state.focusSkipChance - 0.3);
    }

    // cig_abst: smoke-skip charges check
    const _abstMax = (() => { const t = Math.min(state.skillTree?.tiers?.cig_abst || 0, 4); return [0,1,2,3,5][t]; })();
    if (_abstMax > 0 && state.smokeSkipCharges > 0) {
        state.smokeSkipCharges--;
        _notifyStateChanged();
        return false;  // skip smoke using a charge (no stress release)
    }

    state.goods.cigarettes--;
    state.smokeBreakCount++;
    state.stats.totalSmokeBreaks++;
    state.cigaretteButts = (state.cigaretteButts || 0) + 1;
    state.stats.totalCigaretteButtsEarned = (state.stats.totalCigaretteButtsEarned || 0) + 1;

    // cig_speed: faster smoke break (tier values: 1.25/1.50/2.00 — last tier wins)
    const _speedVals = [1, 1.25, 1.50, 2.00];
    const _speedTier = Math.min(state.skillTree?.tiers?.cig_speed || 0, 3);
    const _smokeDurationMs = Math.round(Config.SMOKE_DURATION_MS / _speedVals[_speedTier]);
    state.smokeUntil = Date.now() + _smokeDurationMs;
    state.currentStatus = Config.STATUS.SMOKE;
    // Smoking clears withdrawal
    state.nicotineWithdrawal = false;

    // cig_slowmo: pause deadline timer on smoke start
    if (state.activeOrder?.startedAt) {
        const _slowmoTier = Math.min(state.skillTree?.tiers?.cig_slowmo || 0, 3);
        if (_slowmoTier > 0) state.activeOrder.startedAt += _slowmoTier * 1000;
    }

    // cig_memory: post-smoke decay boost (3 seconds after smoke ends)
    const _memoryBoosts = [0, 0.10, 0.25, 0.50, 1.00];
    const _memoryTier = Math.min(state.skillTree?.tiers?.cig_memory || 0, 4);
    if (_memoryTier > 0) {
        state.postSmokeDecayBoostUntil = Date.now() + _smokeDurationMs + 3000;
    }

    // cig_kaif тиры: smoke_relief_bonus +5/+10/+15/+25/+50
    const _kaifTier = state.skillTree?.tiers?.cig_kaif || 0;
    const _kaifBonuses = [0, 5, 15, 30, 55, 105];
    const _reliefBonus = _kaifBonuses[Math.min(_kaifTier, 5)];
    const relief = randomInt(Config.CIGARETTE_RELIEF_MIN, Config.CIGARETTE_RELIEF_MAX) + _reliefBonus;
    state.stats.stressRelievedByCigarettes += relief;
    // Release stress gradually over the smoke duration (see tickSmokeRelief, called by HUD ticker)
    state.smokeRelief = { total: relief, applied: 0, start: Date.now(), duration: _smokeDurationMs };

    saveState();
    _notifyStateChanged();
    return true;
}

// ─────────────────────────────────────────────────────────────
// Smoke relief ticker (called every HUD tick ~50ms)
// ─────────────────────────────────────────────────────────────

/**
 * Apply any pending smoke relief to state.stress proportionally.
 * Must be called frequently (e.g. every 50ms from the HUD ticker).
 * Does NOT call _notifyStateChanged — caller handles display.
 */
export function tickSmokeRelief() {
    const r = state.smokeRelief;
    if (!r || r.applied >= r.total) { state.smokeRelief = null; return; }
    const elapsed      = Date.now() - r.start;
    const targetApplied = Math.min(r.total, Math.round(r.total * elapsed / r.duration));
    const delta         = targetApplied - r.applied;
    if (delta > 0) {
        r.applied       = targetApplied;
        const _actual   = Math.min(delta, state.stress);
        if (_actual > 0) state.stats.totalStressRelieved = (state.stats.totalStressRelieved || 0) + _actual;
        state.stress    = Math.max(0, state.stress - delta);
    }
    if (r.applied >= r.total) state.smokeRelief = null;
}

// ─────────────────────────────────────────────────────────────
// Shop
// ─────────────────────────────────────────────────────────────

const _ENERG_COOLDOWN_MULT = 0.65;
const _AI_AUTOGEN_COOLDOWN_REDUCTION_MS = 3000;
const _MIN_GENERATION_COOLDOWN_MS = 2000;

export function recomputeGenerationCooldown() {
    const now = Date.now();
    const previousCooldownMs = state.generationCooldownMs || Config.BASE_GENERATION_COOLDOWN_MS;
    const previousRemainingMs = Math.max(0, state.generationCooldownUntil - now);
    const previousElapsedMs = Math.max(0, previousCooldownMs - previousRemainingMs);
    let cooldownMs = Config.BASE_GENERATION_COOLDOWN_MS;

    if (state.goods.energizerActive) {
        cooldownMs = Math.round(cooldownMs * _ENERG_COOLDOWN_MULT);
    }

    // ai_chatPRO: −3000ms кулдаун
    if (state.skillTree?.purchased?.ai_chatPRO) {
        cooldownMs = Math.max(_MIN_GENERATION_COOLDOWN_MS, cooldownMs - _AI_AUTOGEN_COOLDOWN_REDUCTION_MS);
    }

    // ai_tokens тиры: −100/−100/−300/−500/−500ms
    const _pt = state.skillTree?.tiers || {};
    let _tokenReductionMs = 0;
    if (_pt.ai_tokens >= 1) _tokenReductionMs += 100;
    if (_pt.ai_tokens >= 2) _tokenReductionMs += 100;
    if (_pt.ai_tokens >= 3) _tokenReductionMs += 300;
    if (_pt.ai_tokens >= 4) _tokenReductionMs += 500;
    if (_pt.ai_tokens >= 5) _tokenReductionMs += 500;
    if (_tokenReductionMs > 0) {
        cooldownMs = Math.max(_MIN_GENERATION_COOLDOWN_MS, cooldownMs - _tokenReductionMs);
    }

    state.generationCooldownMs = cooldownMs;

    if (previousRemainingMs > 0) {
        const nextRemainingMs = Math.max(0, cooldownMs - previousElapsedMs);
        state.generationCooldownUntil = now + nextRemainingMs;
    }

    return cooldownMs;
}

function _tryAutoBuyCigs() {
    if (!state.goods.cigsAutoBuy) return;
    const price = 120;
    if (state.funds.lt(price)) return;
    state.funds = state.funds.sub(price);
    state.stats.totalMoneySpent = state.stats.totalMoneySpent.add(price);
    state.goods.cigarettes += Config.CIGARETTES_PER_PACK;
}

export function buyGood(id, price) {
    if (state.funds.lt(price)) return false;
    state.funds = state.funds.sub(price);
    state.stats.totalMoneySpent = state.stats.totalMoneySpent.add(price);
    switch (id) {
        case 'cigs':
            state.goods.cigarettes += Config.CIGARETTES_PER_PACK;
            break;
        case 'energ':
            state.goods.energizerActive = true;
            break;
        case 'borj':
            state.goods.energizerActive = false;
            break;
        case 'meds':
            state.goods.energizerActive = false;
            state.goods.vitaminsActive  = true;
            break;
    }
    recomputeGenerationCooldown();
    saveState();
    _notifyStateChanged();
    return true;
}

export function toggleCigsAutoBuy() {
    state.goods.cigsAutoBuy = !state.goods.cigsAutoBuy;
    saveState();
    _notifyStateChanged();
}

// ─────────────────────────────────────────────────────────────
// Wardrobe
// ─────────────────────────────────────────────────────────────

/** Purchase a clothing item variant. Returns false if funds are insufficient or already owned. */
export function buyClothingItem(slotId, variantId, price) {
    if (state.funds.lt(price)) return false;
    if (!state.wardrobeOwned) state.wardrobeOwned = {};
    if (!state.wardrobeOwned[slotId]) state.wardrobeOwned[slotId] = [];
    if (state.wardrobeOwned[slotId].includes(variantId)) return false;
    state.funds = state.funds.sub(price);
    state.stats.totalMoneySpent = state.stats.totalMoneySpent.add(price);
    state.wardrobeOwned[slotId].push(variantId);
    _equipClothingInternal(slotId, variantId);
    // First-ever clothing purchase fires the "ЖЕНИХ!" reaction sequence
    const totalOwned = Object.values(state.wardrobeOwned).reduce((s, arr) => s + arr.length, 0);
    if (totalOwned === 1) {
        _fireCh1EventCallback?.('clothes_first_purchase');
    }
    return true;
}

/** Equip an already-owned clothing variant. Returns false if not owned. */
export function equipClothingItem(slotId, variantId) {
    if (!(state.wardrobeOwned?.[slotId] || []).includes(variantId)) return false;
    _equipClothingInternal(slotId, variantId);
    return true;
}

function _equipClothingInternal(slotId, variantId) {
    if (!state.wardrobeSelected) state.wardrobeSelected = {};
    state.wardrobeSelected[slotId] = variantId;
    // Update currentOutfit flag so story gates work
    state.currentOutfit = Object.values(state.wardrobeSelected).some(v => v != null) ? 1 : 0;
    saveState();
    _notifyStateChanged();
}

export function selectFullOutfit(tag) {
    // tag: null = кэжуал (slot-based), string = full costume tag
    state.selectedOutfitTag = tag;
    saveState();
    _notifyStateChanged();
}

// ─────────────────────────────────────────────────────────────
// Property
// ─────────────────────────────────────────────────────────────

/** Purchase a property decoration item. Returns false if funds insufficient or already purchased. */
export function buyPropertyItem(locationId, itemId, price) {
    if (!state.property) state.property = { activeLocationId: 'abandoned', locations: {} };
    if (!state.property.locations[locationId]) state.property.locations[locationId] = { items: {} };
    const loc = state.property.locations[locationId];
    if (!loc.items) loc.items = {};
    if (!loc.items[itemId]) loc.items[itemId] = { purchased: false, active: false };
    const item = loc.items[itemId];
    if (item.purchased) return false;
    if (state.funds.lt(price)) return false;
    state.funds = state.funds.sub(price);
    state.stats.totalMoneySpent = state.stats.totalMoneySpent.add(price);
    item.purchased = true;
    item.active = true;
    saveState();
    _notifyStateChanged();
    return true;
}

/** Toggle visibility of a purchased property item. No-op if not purchased. */
export function togglePropertyItem(locationId, itemId) {
    const loc = state.property?.locations?.[locationId];
    if (!loc) return;
    const item = loc.items?.[itemId];
    if (!item?.purchased) return;
    item.active = !item.active;
    saveState();
    _notifyStateChanged();
}

// ─────────────────────────────────────────────────────────────
// XP / Leveling
// ─────────────────────────────────────────────────────────────

function _chapterLevelCap() {
    return Infinity;
}

function gainXp(amount) {
    if (amount <= 0) return;
    state.xp = state.xp.add(amount);

    // Research pool accumulation (parallel with leveling xp)
    // gg_int: research_pool_xp_bonus_pct tiers +25%/+50%/+100%
    if (state.activeResearchPool) {
        const _intBonuses = [0, 0.25, 0.50, 1.00];
        const _intTier = Math.min(state.skillTree?.tiers?.gg_int || 0, 3);
        const poolXp = _intTier > 0 ? Math.ceil(amount * (1 + _intBonuses[_intTier])) : amount;
        state.activeResearchPool.xp = state.activeResearchPool.xp.add(poolXp);
        if (state.activeResearchPool.xp.gte(state.activeResearchPool.xpRequired)) {
            _completeResearchPool();
        }
    }

    const cap = _chapterLevelCap();
    while (state.xp.gte(state.xpToNext) && state.level < cap) {
        const prevXpToNext = state.xpToNext;
        state.xp = state.xp.sub(state.xpToNext);
        state.level++;
        // Level 2: base 100 already set; level 3+: prev * 1.15 + targetLevel * 500
        state.xpToNext = state.level >= 2
            ? new Decimal(prevXpToNext).mul(Config.XP_LEVEL_SCALE_MULT).add((state.level + 1) * Config.XP_LEVEL_LINEAR).floor()
            : new Decimal(Config.XP_BASE_TO_NEXT);
    }
    // At cap — clamp bar to full so it stays visible but doesn't overflow
    if (state.level >= cap) {
        state.xp = state.xpToNext.sub(1);
    }
}

function _completeResearchPool() {
    const pool = state.activeResearchPool;
    if (!pool) return;
    if (pool.rewardType === 'skillPoints') {
        state.skillPoints = (state.skillPoints || 0) + pool.rewardAmount;
    } else if (pool.rewardType === 'expertPoints') {
        state.expertPoints = (state.expertPoints || 0) + pool.rewardAmount;
    }
    state.researchTaskCompletions[pool.taskId] = (state.researchTaskCompletions[pool.taskId] || 0) + 1;
    state.activeResearchPool = null;
    saveState();
    _notifyStateChanged();
}

export function startResearchPool(taskId) {
    const template = RESEARCH_TASKS.find(t => t.id === taskId && t.repeatable);
    if (!template) return false;
    if (state.activeResearchPool) return false; // only one pool at a time
    const startCost = template.realPayout < 0 ? Math.abs(template.realPayout) : 0;
    if (startCost > 0 && state.funds.lt(startCost)) return false; // can't afford
    if (startCost > 0) {
        state.funds = state.funds.sub(startCost);
        state.stats.totalMoneySpent = state.stats.totalMoneySpent.add(startCost);
    }
    const completions = state.researchTaskCompletions[taskId] || 0;
    const xpRequired = new Decimal(completions * 100 + 100);
    const rewardType = (template.expertPointsReward > 0) ? 'expertPoints' : 'skillPoints';
    const rewardAmount = template.expertPointsReward || template.skillPointsReward || 1;
    state.activeResearchPool = { taskId, xp: new Decimal(0), xpRequired, rewardType, rewardAmount };
    saveState();
    _notifyStateChanged();
    return true;
}

// ─────────────────────────────────────────────────────────────
// Spawn chance calculation
// ─────────────────────────────────────────────────────────────

function calcJobChance() {
    const base = Config.BASE_JOB_CHANCE;
    const levelBonus = state.level / Config.JOB_SEARCH_K1_LEVEL;
    const prestigeBonus = state.prestige / Config.JOB_SEARCH_K2_PRESTIGE;
    return Math.min(1, base + levelBonus + prestigeBonus + (state.storyChanceBonus || 0));
}

// ─────────────────────────────────────────────────────────────
// Tickers
// ─────────────────────────────────────────────────────────────

export function startSpawnTicker() {
    // Spawn is now driven solely by startHeadhunterTicker (probability roll at headhunter interval).
    // This function only cancels any previously running ticker to avoid duplicate intervals.
    if (state.spawnIntervalId) clearInterval(state.spawnIntervalId);
    state.spawnIntervalId = null;
}

export function startHeadhunterTicker() {
    if (state.headhunterIntervalId) clearInterval(state.headhunterIntervalId);
    // ai_headhunter tier values: 25/15/5/2/1 sec; tier 0 = base headhunterSpawnSec
    const _tierSecs = [state.headhunterSpawnSec || 30, 25, 15, 5, 2, 1];
    const _hTier = Math.min(state.skillTree?.tiers?.ai_headhunter || 0, 5);
    const ms = _tierSecs[_hTier] * 1000;
    // Each tick rolls the probability formula instead of guaranteed spawn.
    // This merges the two old spawn systems: interval = headhunter, chance = calcJobChance().
    state.headhunterIntervalId = setInterval(() => {
        if (getCurrentPhase() !== Config.DAY_PHASE.WORK) return;
        const chance = calcJobChance();
        if (Math.random() < chance) spawnOrder();
    }, ms);
}

export function startLifetimeTicker() {
    if (state.lifetimeIntervalId) clearInterval(state.lifetimeIntervalId);
    state.lifetimeIntervalId = setInterval(() => {
        const now = Date.now();
        // Expire orders sitting in the pool (not yet started)
        const expired = state.orders.filter(o =>
            !o.isStory &&
            o.expiresAt !== Infinity &&
            now >= o.expiresAt &&
            state.activeOrder?.id !== o.id   // don’t kill active order via pool expiry
        );
        for (const o of expired) failOrder(o.id);

        // Fail active order if its work-duration has elapsed
        const active = state.activeOrder;
        if (active && active.startedAt && active.taskCategory === Config.TASK_CATEGORIES.ORDERS) {
            let deadline = active.startedAt + (active.durationSec || 60) * 1000;
            // gg_speed: slow deadline at high stress (≥70% of max) — extend deadline by half a tick each tick
            if (state.skillTree?.purchased?.gg_speed) {
                const _effMax = getEffectiveStressMax();
                if (state.stress >= _effMax * 0.7) {
                    active.deadlineExtendedMs = (active.deadlineExtendedMs || 0) + Config.ORDER_LIFETIME_TICK_MS * 0.5;
                    deadline += active.deadlineExtendedMs;
                } else if (active.deadlineExtendedMs) {
                    deadline += active.deadlineExtendedMs;
                }
            }
            if (now >= deadline) failOrder(active.id);
        }

        // Smoke break end
        if (state.currentStatus === Config.STATUS.SMOKE && now >= state.smokeUntil) {
            state.currentStatus = Config.STATUS.REST;
            // Restore cig_abst skip charges to max on smoke completion
            const _abstMaxVal = (() => { const t = Math.min(state.skillTree?.tiers?.cig_abst || 0, 4); return [0,1,2,3,5][t]; })();
            if (_abstMaxVal > 0) state.smokeSkipCharges = Math.min(_abstMaxVal, state.smokeSkipCharges + 1);
            // nicotineWithdrawal stays false after a successful smoke;
            // it is only set true inside doSmokeBreak() when there are no cigarettes.
            // Resume auto-repeat task that was paused for this smoke break
            if (state.pendingAutoRepeatSpecialTaskId) {
                const tid = state.pendingAutoRepeatSpecialTaskId;
                delete state.pendingAutoRepeatSpecialTaskId;
                const tmpl = RESEARCH_TASKS.find(t => t.id === tid)
                          || PROMOTION_TASKS.find(t => t.id === tid)
                          || CONTRACT_TASKS.find(t => t.id === tid);
                if (tmpl && tmpl.repeatable) {
                    const newOrder = buildSpecialTask(tmpl);
                    newOrder.autoRepeat = true;
                    state.activeOrder   = newOrder;
                    state.currentStatus = Config.STATUS.WORK;
                }
            }
            _notifyStateChanged();
        }
    }, Config.ORDER_LIFETIME_TICK_MS);
}

// ── Autogen dynamic interval (ai_autogen tiers) ──────────────
function getAutogenIntervalMs() {
    const _tier = Math.min(state.skillTree?.tiers?.ai_autogen || 0, 5);
    const _vals = [Config.AUTOGEN_TICK_MS, 5000, 2000, 1000, 500, 100];
    return _vals[_tier];
}

// ── Autogen batch bonus (ai_autobatch tiers: cumulative +1/+1/+2/+4) ──
function getAutogenBatchBonus() {
    const _increments = [0, 1, 1, 2, 4];
    let _total = 0;
    const _t = Math.min(state.skillTree?.tiers?.ai_autobatch || 0, 4);
    for (let i = 1; i <= _t; i++) _total += _increments[i];
    return _total;
}

export function startAutogenTicker() {
    if (state.autogenIntervalId) clearInterval(state.autogenIntervalId);
    const ms = Math.max(getAutogenIntervalMs(), 50);
    state.autogenIntervalId = setInterval(() => {
        if (!state.autogenEnabled || !state.activeOrder || state.miniGenPopupActive) return;
        if (Date.now() < state.generationCooldownUntil) return; // wait for cooldown before showing popup
        if (_autogenStepFn) {
            _autogenStepFn(getAutogenBatchBonus()).catch(err => console.warn('[autogen]', err));
        } else {
            // Fallback: no minigen callback wired — direct generation
            const batch = 1 + getAutogenBatchBonus();
            for (let i = 0; i < batch; i++) {
                if (!state.activeOrder) break;
                state.generationCooldownUntil = 0;
                registerGenerationStep(true);
            }
        }
    }, ms);
}

export function startZenTicker() {
    if (state.zenIntervalId) clearInterval(state.zenIntervalId);
    state.zenIntervalId = setInterval(() => {
        // Stress passively decays unless currently smoking (smoke does its own release)
        if (state.stress > 0 && state.currentStatus !== Config.STATUS.SMOKE) {
            let decay = randomInt(Config.ZEN_DECAY_MIN, Config.ZEN_DECAY_MAX);
            if (state.goods.vitaminsActive) decay *= 2;
            // gg_stoic тиры: stress_decay_bonus_set +15%/+50%/+100%/+150%/+250%
            const _stoicBonuses = [0, 0.15, 0.50, 1.00, 1.50, 2.50];
            const _stoicTier = Math.min(state.skillTree?.tiers?.gg_stoic || 0, 5);
            if (_stoicTier > 0) decay = Math.floor(decay * (1 + _stoicBonuses[_stoicTier]));
            // cig_memory: post-smoke decay boost for 3 sec after smoke ends
            if (state.postSmokeDecayBoostUntil > Date.now()) {
                const _memBoosts = [0, 0.10, 0.25, 0.50, 1.00];
                const _memTier = Math.min(state.skillTree?.tiers?.cig_memory || 0, 4);
                if (_memTier > 0) decay = Math.floor(decay * (1 + _memBoosts[_memTier]));
            }
            // Nicotine withdrawal halves natural stress decay
            if (state.nicotineWithdrawal) decay = Math.max(0, Math.floor(decay * 0.5));
            if (decay > 0) releaseStress(decay);
        }
        // gg_focus: focus skip chance decays 0.1/sec
        if ((state.focusSkipChance || 0) > 0 && state.skillTree?.purchased?.gg_focus) {
            state.focusSkipChance = Math.max(0, state.focusSkipChance - 0.1);
        }
    }, Config.ZEN_TICK_MS);
}

export function startAgentTicker() {
    if (state.agentIntervalId) clearInterval(state.agentIntervalId);
    if (!state.skillTree?.purchased?.ai_agent) return;
    // ai_agentboost tiers reduce interval: 30/25/20/15/10/5 sec
    const _boostTier = Math.min(state.skillTree?.tiers?.ai_agentboost || 0, 5);
    const _intervalSec = [30, 25, 20, 15, 10, 5][_boostTier];
    // ai_agentbuff tiers set payout %: 25/50/100/200/350/500
    const _buffTier = Math.min(state.skillTree?.tiers?.ai_agentbuff || 0, 5);
    const _pct = [25, 50, 100, 200, 350, 500][_buffTier] / 100;
    state.agentLastFundsSnapshot = state.stats.totalMoneyEarned.add(0);
    state.agentIntervalId = setInterval(() => {
        const earned = state.stats.totalMoneyEarned.sub(state.agentLastFundsSnapshot);
        state.agentLastFundsSnapshot = state.stats.totalMoneyEarned.add(0);
        if (earned.gt(0)) {
            const bonus = earned.mul(_pct).floor();
            if (bonus.gt(0)) {
                state.funds = state.funds.add(bonus);
                _notifyStateChanged();
            }
        }
    }, _intervalSec * 1000);
}

export function stopAllTickers() {
    clearInterval(state.spawnIntervalId);
    clearInterval(state.lifetimeIntervalId);
    clearInterval(state.autogenIntervalId);
    clearInterval(state.zenIntervalId);
    clearInterval(state.headhunterIntervalId);
    clearInterval(state.agentIntervalId);
    state.spawnIntervalId = null;
    state.lifetimeIntervalId = null;
    state.autogenIntervalId = null;
    state.zenIntervalId = null;
    state.headhunterIntervalId = null;
    state.agentIntervalId = null;
}

// ─────────────────────────────────────────────────────────────
// Special task lifecycle
// ─────────────────────────────────────────────────────────────

function buildSpecialTask(template) {
    const now = Date.now();
    return {
        id: 'special-' + template.id + '-' + now,
        specialTaskId: template.id,
        isSpecial: true,
        title: template.title,
        taskCategory: template.taskCategory,
        taskType: template.taskType,
        durationSec: template.durationSec || 60,
        requiredGenerations: template.requiredGenerations || 1,
        generationsAttempted: 0,
        realPayout: template.realPayout || 0,
        xpReward: template.xpReward || 0,
        iconUrl: template.iconUrl || '',
        noFailPenalty: true,
        generateActionLabel: template.generateActionLabel || 'Работать',
        repeatable: template.repeatable === true,
        expiresAt: Infinity,
        job_loss: Infinity,
        spawnedAt: now,
        startedAt: now,
    };
}

function _queueRuntimeComment(text) {
    _queueRuntimeCommentDelayed(text, 0);
}

function _resolveNarrativeText(value) {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';
    if (typeof value.locKey === 'string' && value.locKey.trim()) {
        return String(t(value.locKey) || '').trim();
    }
    const lang = state.language || 'ru';
    return String(value[lang] || value.ru || value.en || '').trim();
}

function _queueRuntimeCommentDelayed(text, delayMs = 0) {
    const safeText = _resolveNarrativeText(text);
    if (!safeText) return;
    const events = window.CH1_EVENTS || (window.CH1_EVENTS = {});
    events.__runtime_comment_sequence = {
        firedOnce: false,
        dialogue: [{ type: 'dialog', speaker: 'self', text: safeText }],
        dialogueDelay: delayMs,
    };
    _fireCh1EventCallback?.('__runtime_comment_sequence');
}

function _tryFireFundsMilestone() {
    if (state.funds.lt(1000)) return false;
    if (state.ch1FiredEvents?.funds_reached_1000) return false;
    _fireCh1EventCallback?.('funds_reached_1000');
    return true;
}

function _tryShowContextualComment(order, triggerType) {
    const contextual = Array.isArray(window.NARRATIVE_COMMENTS?.contextual)
        ? window.NARRATIVE_COMMENTS.contextual
        : [];
    const match = contextual.find(comment => {
        if (!comment?.id || comment.triggerType !== triggerType) return false;
        if (state.shownCharacterComments?.[comment.id]) return false;
        if (typeof comment.condition === 'function') return !!comment.condition(order);
        return true;
    });
    if (!match) return false;
    if (!state.shownCharacterComments) state.shownCharacterComments = {};
    state.shownCharacterComments[match.id] = true;
    saveState();
    _queueRuntimeComment(match.text);
    return true;
}

function _tryShowManualGenerationMilestoneComment() {
    const milestones = {
        1: 'chat_generation_after_first_once',
        3: 'chat_generation_after_third_once',
        4: 'chat_generation_after_fourth_once',
    };
    const commentId = milestones[state.stats.manualGenerations];
    if (!commentId || state.shownCharacterComments?.[commentId]) return false;
    const payload = window.NARRATIVE_COMMENTS?.firstOpen?.[commentId];
    const text = Array.isArray(payload) ? payload[0] : payload;
    const resolvedText = _resolveNarrativeText(text);
    if (!resolvedText) return false;
    if (!state.shownCharacterComments) state.shownCharacterComments = {};
    state.shownCharacterComments[commentId] = true;
    saveState();
    _queueRuntimeCommentDelayed(resolvedText, 4000);
    return true;
}

export function startSpecialTask(taskId, autoRepeat = false) {
    // Find template in research, promo, or contract lists
    const template =
        RESEARCH_TASKS.find(t => t.id === taskId) ||
        PROMOTION_TASKS.find(t => t.id === taskId) ||
        CONTRACT_TASKS.find(t => t.id === taskId);
    if (!template) return;
    // Don't start if already working on something
    if (state.activeOrder) return;
    // Enforce maxCompletions (skip for repeatable without limit)
    if (template.maxCompletions != null &&
        (state.researchTaskCompletions[taskId] || 0) >= template.maxCompletions) return;
    const order = buildSpecialTask(template);
    if (autoRepeat) order.autoRepeat = true;
    state.activeOrder = order;
    state.currentStatus = Config.STATUS.WORK;
    _notifyStateChanged();
}

export function setActiveOrderAutoRepeat(value) {
    if (!state.activeOrder) return;
    state.activeOrder.autoRepeat = value;
    _notifyStateChanged();
}

export function stopRepeatableTask() {
    if (!state.activeOrder) return;
    state.activeOrder.autoRepeat = false;
    // Force-complete (skip payout) to stop — cancel without reward
    const orderId = state.activeOrder.id;
    state.orders = state.orders.filter(o => o.id !== orderId);
    state.activeOrder = null;
    if (!doSmokeBreak()) state.currentStatus = Config.STATUS.REST;
    saveState();
    _notifyOrdersChanged();
    _notifyStateChanged();
}

// ─────────────────────────────────────────────────────────────
// Callback hooks (set by game.js to avoid circular imports)
// ─────────────────────────────────────────────────────────────

let _notifyOrdersChanged = () => {};
let _notifyStateChanged = () => {};
let _fireCh1EventCallback = null;
let _onStressAdded = null;
let _onNoCigsCallback = null;
let _autogenStepFn = null;

export function setEconomyCallbacks({ onOrdersChanged, onStateChanged, onCh1Event, onStressAdded, onNoCigs, onAutogenStep }) {
    if (onOrdersChanged) _notifyOrdersChanged = onOrdersChanged;
    if (onStateChanged) _notifyStateChanged = onStateChanged;
    if (onCh1Event) _fireCh1EventCallback = onCh1Event;
    if (onStressAdded) _onStressAdded = onStressAdded;
    if (onNoCigs) _onNoCigsCallback = onNoCigs;
    if (onAutogenStep) _autogenStepFn = onAutogenStep;
}

// ─────────────────────────────────────────────────────────────
// Card system — order building and queue seeding
// ─────────────────────────────────────────────────────────────

/**
 * Convert a card definition (from data/cards.js) into a work order object,
 * applying the current activeComboEffects multipliers.
 * Utility cards (requiredGenerations === 0) should not be passed here.
 */
export function buildOrderFromCard(cardDef) {
    const fx = state.activeComboEffects || {};
    const r  = cardDef.reward || {};
    const now = Date.now();

    const incomeMult      = fx.incomeMultiplier ?? 1;
    const xpMult          = fx.xpMultiplier    ?? 1;
    const fameMult        = fx.fameMultiplier  ?? 1;
    const nasmotrXpBonus  = (fx.promoWaveActive && (cardDef.tags || []).includes('насмотренность')) ? 1.25 : 1;
    const bonusXpFlat     = fx.bonusXpFlat || 0;

    const n = Math.max(1, cardDef.requiredGenerations || 1);

    const totalMoney    = Math.round((r.moneyPerGen || 0) * n * incomeMult);
    const totalXp       = Math.round((r.xpPerGen   || 0) * n * xpMult * nasmotrXpBonus)
                        + Math.round((r.xpFlat     || 0)     * xpMult * nasmotrXpBonus)
                        + Math.round(bonusXpFlat);
    const totalFame     = Math.round((r.famePerGen || 0) * n * fameMult)
                        + Math.round((r.fameFlat   || 0)     * fameMult);

    return {
        id:                   `card-${cardDef.id}-${now}-${Math.random().toString(16).slice(2, 6)}`,
        title:                cardDef.title,
        taskCategory:         'card',
        taskType:             cardDef.cardType,
        isCardBased:          true,
        cardId:               cardDef.id,
        miniGenMode:          cardDef.miniGenMode || 'standard',
        requiredGenerations:  n,
        generationsAttempted: 0,
        realPayout:           totalMoney,
        xpReward:             totalXp,
        fameReward:           totalFame,
        iconUrl:              `images/icons/job/icon-job-${cardDef.cardType}.png`,
        isHighPayout:         false,
        isLocked:             false,
        expiresAt:            Infinity,   // card tasks never expire
        job_loss:             Infinity,
        spawnedAt:            now,
        generateActionLabel:  'Работать',
    };
}

/**
 * Called at the start of WORK phase.
 * Converts state.orderQueue (card objects) → order objects and inserts them into
 * state.orders in queue order, preserving any existing story orders.
 * Skips utility cards (requiredGenerations === 0).
 */
export function seedOrdersFromQueue() {
    const queue = state.orderQueue || [];
    if (!queue.length) return;
    // Keep story orders already in pool; discard any stale regular orders
    state.orders = (state.orders || []).filter(o => o.isStory);
    for (const card of queue) {
        if (!card || card.cardType === 'utility') continue;
        state.orders.push(buildOrderFromCard(card));
    }
}

/**
 * Add fame (notoriety/reputation) to the player.
 * Combo multiplier from activeComboEffects is applied automatically.
 */
export function addFame(amount) {
    if (!amount || amount <= 0) return;
    const mult = state.activeComboEffects?.fameMultiplier ?? 1;
    state.fame = (state.fame || 0) + Math.round(amount * mult);
    saveState();
    _notifyStateChanged();
}

/**
 * Apply the rewards of a completed card execution.
 * Called once per completed generation (for per-gen rewards) or once at end (for flat rewards).
 *
 * @param {object} cardDef   — the card definition from CARD_MAP
 * @param {'perGen'|'flat'}  rewardMode — 'perGen' applies per-generation rewards; 'flat' applies flat rewards
 */
export function applyCardReward(cardDef, rewardMode = 'perGen') {
    if (!cardDef) return;
    const r = cardDef.reward || {};
    const fx = state.activeComboEffects || {};

    const incomeMult = fx.incomeMultiplier ?? 1;
    const xpMult = fx.xpMultiplier ?? 1;
    const fameMult = fx.fameMultiplier ?? 1;

    // For promo cards with promoWaveActive: apply +25% XP bonus for 'насмотренность' tag
    const promoNasmotrXpMult = (fx.promoWaveActive && (cardDef.tags || []).includes('насмотренность'))
        ? 1.25 : 1;

    if (rewardMode === 'perGen') {
        if (r.moneyPerGen) {
            const earned = Math.round(r.moneyPerGen * incomeMult);
            state.funds = state.funds.add(earned);
            state.stats.totalMoneyEarned = state.stats.totalMoneyEarned.add(earned);
            state.dailyStats.earned = (state.dailyStats.earned || 0) + earned;
        }
        if (r.xpPerGen) {
            gainXp(Math.round(r.xpPerGen * xpMult * promoNasmotrXpMult));
        }
        if (r.famePerGen) {
            state.fame = (state.fame || 0) + Math.round(r.famePerGen * fameMult);
        }
    } else {
        // flat rewards — applied once at card completion
        if (r.xpFlat) {
            gainXp(Math.round(r.xpFlat * xpMult * promoNasmotrXpMult));
        }
        if (r.fameFlat) {
            state.fame = (state.fame || 0) + Math.round(r.fameFlat * fameMult);
        }
        if (fx.bonusXpFlat) {
            gainXp(Math.round(fx.bonusXpFlat));
        }
    }

    saveState();
    _notifyStateChanged();
}

