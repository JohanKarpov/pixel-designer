// src/core/deck.js — Card deck management
// Handles the player's card collection, daily draw pile, and hand dealing.

import { state, saveState } from './state.js';
import { CARD_DEFINITIONS, CARD_MAP, getStarterDeckIds } from '../../data/cards.js';

// ─────────────────────────────────────────────────────────────
// Deck initialization
// ─────────────────────────────────────────────────────────────

/** Ensures the player has a deck. Call once on first load. */
export function ensurePlayerDeck() {
    if (!state.playerDeck || state.playerDeck.length === 0) {
        state.playerDeck = getStarterDeckIds().map(id => ({ id, enabled: true }));
        saveState();
    }
}

// ─────────────────────────────────────────────────────────────
// Daily shuffle — call at the start of each PLANNING phase
// ─────────────────────────────────────────────────────────────

/**
 * Builds a fresh draw pile from the player's enabled cards and shuffles it.
 * Call at the start of each day (onEnterPlanning).
 */
export function shuffleDeck() {
    const enabled = (state.playerDeck || []).filter(entry => entry.enabled !== false);
    const pile = enabled.map(entry => entry.id);
    _fisherYates(pile);
    state.drawPile = pile;
}

// ─────────────────────────────────────────────────────────────
// Drawing cards
// ─────────────────────────────────────────────────────────────

/**
 * Draw n cards from the draw pile into currentHand.
 * Replaces currentHand entirely (use at planning start).
 */
export function dealHand(n = 5) {
    state.currentHand = [];
    _drawInto(state.currentHand, n);
}

/**
 * Draw n additional cards into the existing currentHand
 * (used by the "Поиск задач" / draw_2 utility card effect).
 */
export function drawCards(n = 2) {
    _drawInto(state.currentHand, n);
}

/** Internal: move up to n card ids from drawPile into target array. */
function _drawInto(target, n) {
    for (let i = 0; i < n; i++) {
        if (!state.drawPile || state.drawPile.length === 0) break;
        const id = state.drawPile.pop();
        const def = CARD_MAP[id];
        if (def) target.push({ ...def });   // shallow copy of definition
    }
}

// ─────────────────────────────────────────────────────────────
// Deck modification
// ─────────────────────────────────────────────────────────────

/**
 * Add a new card to the player's deck (from unlock, client reward, etc.).
 * Does nothing if the card id is already in the deck.
 */
export function addCardToDeck(cardId) {
    if (!CARD_MAP[cardId]) {
        console.warn(`[deck] Unknown card id: ${cardId}`);
        return;
    }
    const already = (state.playerDeck || []).some(e => e.id === cardId);
    if (already) return;
    state.playerDeck.push({ id: cardId, enabled: true });
    saveState();
}

/**
 * Toggle a card's enabled state (from deck builder UI in rest screen).
 */
export function setCardEnabled(cardId, enabled) {
    const entry = (state.playerDeck || []).find(e => e.id === cardId);
    if (!entry) return;
    entry.enabled = enabled;
    saveState();
}

/**
 * Returns array of { entry, def } pairs for all cards in playerDeck,
 * sorted by rarity then title — used by the deck builder UI.
 */
export function getPlayerDeckWithDefs() {
    const rarityOrder = { epic: 0, rare: 1, common: 2 };
    return (state.playerDeck || [])
        .map(entry => ({ entry, def: CARD_MAP[entry.id] }))
        .filter(({ def }) => !!def)
        .sort((a, b) => {
            const ro = (rarityOrder[a.def.rarity] ?? 3) - (rarityOrder[b.def.rarity] ?? 3);
            return ro !== 0 ? ro : a.def.title.localeCompare(b.def.title);
        });
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function _fisherYates(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}
