// src/core/story.js — Narrative engine
// Selects and resolves scenes from data/scenes.js + data/story-draft.js (local).
// Called by rest.js after a player confirms an outside activity.

import { state, saveState } from './state.js';
import { SCENES as PUBLISHED_SCENES } from '../../data/scenes.js';
import { addCardToDeck } from './deck.js';

// ─────────────────────────────────────────────────────────────
// Scene registry — merge published + local draft (if available)
// ─────────────────────────────────────────────────────────────

let _allScenes = [...PUBLISHED_SCENES];

// Try to load the local draft (gitignored). Dynamic import so a missing
// file doesn't crash the module — it just silently adds nothing.
try {
    const draft = await import('../../data/story-draft.js');
    if (Array.isArray(draft.default)) {
        _allScenes = [..._allScenes, ...draft.default];
    }
} catch {
    // story-draft.js doesn't exist — that's fine
}

// ─────────────────────────────────────────────────────────────
// Condition check
// ─────────────────────────────────────────────────────────────

function _meetsCondition(scene) {
    const c = scene.condition || {};
    if (c.minDay   && (state.dayCount  || 1)  < c.minDay)   return false;
    if (c.minFame  && (state.fame      || 0)  < c.minFame)  return false;
    if (c.minLevel && (state.level     || 1)  < c.minLevel) return false;
    const flags = state.storyFlags || {};
    if (c.flags?.some(f => !flags[f]))    return false;
    if (c.notFlags?.some(f => flags[f]))  return false;
    // oneShot: skip if already seen
    if (scene.oneShot && flags[`_seen_${scene.id}`]) return false;
    return true;
}

// ─────────────────────────────────────────────────────────────
// Public: pick a scene for a location (weighted random)
// Returns a scene object or null if nothing qualifies.
// ─────────────────────────────────────────────────────────────

export function selectScene(locationId) {
    const candidates = _allScenes.filter(s =>
        s.location === locationId && _meetsCondition(s)
    );
    if (candidates.length === 0) return null;

    const totalWeight = candidates.reduce((sum, s) => sum + (s.weight ?? 1), 0);
    let roll = Math.random() * totalWeight;
    for (const s of candidates) {
        roll -= (s.weight ?? 1);
        if (roll <= 0) return s;
    }
    return candidates[candidates.length - 1];
}

// ─────────────────────────────────────────────────────────────
// Public: apply scene outcomes + mark seen
// callbacks: { showToast, unlockMenu }  (injected from rest.js)
// ─────────────────────────────────────────────────────────────

export function applyOutcomes(scene, callbacks = {}) {
    if (!scene) return;

    // Mark oneShot as seen
    if (scene.oneShot) {
        if (!state.storyFlags) state.storyFlags = {};
        state.storyFlags[`_seen_${scene.id}`] = true;
    }

    for (const o of (scene.outcomes || [])) {
        switch (o.type) {
            case 'set_flag':
                if (!state.storyFlags) state.storyFlags = {};
                state.storyFlags[o.flag] = true;
                break;
            case 'unlock_card':
                addCardToDeck(o.cardId);
                break;
            case 'unlock_menu':
                if (state.unlockedMenus) state.unlockedMenus[o.menu] = true;
                break;
            case 'add_fame':
                state.fame = (state.fame || 0) + o.value;
                break;
            case 'add_xp':
                // xp is a Decimal — add safely
                if (state.xp?.add) state.xp = state.xp.add(o.value);
                else state.xp = (state.xp || 0) + o.value;
                break;
            case 'show_toast':
                callbacks.showToast?.(o.text);
                break;
        }
    }

    saveState();
}
