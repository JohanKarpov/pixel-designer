// src/screens/planning.js — PLANNING phase UI
// Manages focus selection, card hand (pool), queue, IP resource, and combos.

import { state, saveState } from '../core/state.js';
import { advanceToWork } from '../day/day-cycle.js';
import { buyGood } from '../core/economy.js';
import { ensurePlayerDeck, shuffleDeck, dealHand, drawCards } from '../core/deck.js';
import { DEBUG_RHYTHM_CARD } from '../../data/cards.js';
import { evaluateCombos } from '../core/combos.js';

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────

const _dayLabel    = document.getElementById('planning-day-label');
const _cigsCount   = document.getElementById('planning-cigs');
const _buyCigsBtn  = document.getElementById('planning-buy-cigs');
const _startBtn    = document.getElementById('btn-start-work');
const _poolCol     = document.getElementById('kanban-pool');
const _queueCol    = document.getElementById('kanban-queue');

// ─────────────────────────────────────────────────────────────
// Entry point — call when entering PLANNING phase
// ─────────────────────────────────────────────────────────────

export function onEnterPlanning() {
    ensurePlayerDeck();
    // New day: shuffle deck and deal hand
    shuffleDeck();
    dealHand(5);
    // Inject debug card at the front of the hand (always visible)
    if (!state.currentHand) state.currentHand = [];
    if (!state.currentHand.find(c => c.id === DEBUG_RHYTHM_CARD.id)) {
        state.currentHand.unshift(DEBUG_RHYTHM_CARD);
    }
    // Reset queue and combo effects for the new day
    state.orderQueue = [];
    state.activeComboEffects = {};
    // Reset energy to max
    state.energyResource = state.energyResourceMax;
    saveState();

    _render();
    _bindButtons();
}

// ─────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────

function _render() {
    _dayLabel.textContent = `День ${state.dayCount || 1}`;
    _cigsCount.textContent = state.goods.cigarettes ?? 0;

    // Focus buttons
    document.querySelectorAll('.focus-btn').forEach(btn => {
        const f = btn.dataset.focus;
        btn.classList.toggle('focus-btn--active', f === state.currentDayFocus);
    });

    // IP counter
    _renderEnergyCounter();

    // Kanban
    _renderKanban();

    // Combos
    _renderCombos();
}

function _renderEnergyCounter() {
    let el = document.getElementById('planning-energy-counter');
    if (!el) {
        el = document.createElement('div');
        el.id = 'planning-energy-counter';
        el.className = 'planning-energy-counter';
        // Insert before the kanban board
        const kanban = document.querySelector('.kanban') || _poolCol?.parentElement;
        kanban?.parentElement?.insertBefore(el, kanban);
    }
    const used = _usedEnergy();
    const max  = state.energyResourceMax;
    el.textContent = `⚡ Энергия: ${max - used} / ${max}`;
    el.classList.toggle('planning-energy-counter--full', used >= max);
}

// Placeholder — no dedicated IP-counter element currently in DOM.
function _renderIPCounter() {}

function _renderKanban() {
    // Keep title node, replace rest
    const poolTitle  = _poolCol.querySelector('.kanban__col-title');
    const queueTitle = _queueCol.querySelector('.kanban__col-title');
    _poolCol.innerHTML  = '';
    _queueCol.innerHTML = '';
    _poolCol.appendChild(poolTitle);
    queueTitle && _queueCol.appendChild(queueTitle);

    const usedEnergy = _usedEnergy();

    // Pool: currentHand — skip cards already in queue
    const queueIds = new Set((state.orderQueue || []).map(c => c.id));
    const hand = (state.currentHand || []).filter(c => !queueIds.has(c.id));

    if (hand.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'kanban-empty';
        empty.textContent = state.drawPile?.length === 0
            ? 'Колода исчерпана на сегодня'
            : 'Нет карт в руке';
        _poolCol.appendChild(empty);
    } else {
        hand.forEach(card => {
            const affordable = (state.energyResourceMax - usedEnergy) >= card.cost;
            _poolCol.appendChild(_makeCard(card, 'pool', !affordable));
        });
    }

    // Queue
    (state.orderQueue || []).forEach(card => _queueCol.appendChild(_makeCard(card, 'queue', false)));
}

function _renderCombos() {
    let panel = document.getElementById('planning-combo-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'planning-combo-panel';
        panel.className = 'planning-combo-panel';
        // Insert after the queue column
        _queueCol?.parentElement?.after?.(panel) || _queueCol?.parentElement?.appendChild(panel);
    }

    const queue = state.orderQueue || [];
    if (queue.length === 0) {
        panel.innerHTML = '';
        return;
    }

    const { activeCombos, merged } = evaluateCombos(queue);
    state.activeComboEffects = merged;

    if (activeCombos.length === 0) {
        panel.innerHTML = '<div class="combo-hint">Нет активных комбо</div>';
        return;
    }

    panel.innerHTML = activeCombos.map(c =>
        `<div class="combo-badge">
            <span class="combo-badge__label">✦ ${c.label}</span>
            <span class="combo-badge__desc">${c.description}</span>
        </div>`
    ).join('');
}

function _getPoolItems() {
    // Legacy shim — no longer used internally, kept for safety
    return state.currentHand || [];
}

function _makeCard(card, colType, disabled = false) {
    const el = document.createElement('div');
    el.className = 'kanban-card';
    if (disabled)         el.classList.add('kanban-card--disabled');
    if (card.rarity)      el.classList.add(`kanban-card--${card.rarity}`);
    if (card.cardType)    el.classList.add(`kanban-card--type-${card.cardType}`);

    // Color coding by miniGenMode / planning tag / utility type
    if (card.tags?.includes('планирование')) {
        el.classList.add('kanban-card--planning');
    } else if (card.cardType === 'utility') {
        el.classList.add('kanban-card--utility');
    } else if (card.miniGenMode === 'study') {
        el.classList.add('kanban-card--study');
    } else if (card.miniGenMode === 'sort') {
        el.classList.add('kanban-card--sort');
    }
    el.draggable = !disabled;
    el.dataset.id    = card.id ?? Math.random();
    el.dataset.col   = colType;

    // Build reward summary line
    const r = card.reward || {};
    const rewardParts = [];
    if (r.moneyPerGen)  rewardParts.push(`${r.moneyPerGen}₽/ген`);
    if (r.xpPerGen)     rewardParts.push(`${r.xpPerGen} XP/ген`);
    if (r.xpFlat)       rewardParts.push(`+${r.xpFlat} XP`);
    if (r.famePerGen)   rewardParts.push(`${r.famePerGen} ★/ген`);
    if (r.fameFlat)     rewardParts.push(`+${r.fameFlat} ★`);
    const rewardStr = rewardParts.join('  ') || '';

    // Mode badge
    const modeBadge = card.miniGenMode && card.miniGenMode !== 'standard'
        ? `<span class="kanban-card__mode">${card.miniGenMode}</span>` : '';

    el.innerHTML =
        `<div class="kanban-card__header">
            <span class="kanban-card__title">${card.title}</span>
            ${modeBadge}
        </div>` +
        `<div class="kanban-card__desc">${card.description || ''}</div>` +
        `<div class="kanban-card__meta">
            <span class="kanban-card__gens">${card.requiredGenerations > 0 ? card.requiredGenerations + ' ген.' : ''}</span>
            <span class="kanban-card__reward">${rewardStr}</span>
            <span class="kanban-card__cost">⚡${card.cost}</span>
        </div>`;

    // Drag & drop (desktop) — only for non-disabled cards
    if (!disabled) {
        el.addEventListener('dragstart', _onDragStart);
        el.addEventListener('dragend',   _onDragEnd);
        el.addEventListener('touchstart', _onTouchStart, { passive: true });
    }

    el._itemData = card;
    return el;
}

// ─────────────────────────────────────────────────────────────
// Drag & drop — desktop
// ─────────────────────────────────────────────────────────────

let _dragging = null;

function _onDragStart(e) {
    _dragging = e.currentTarget;
    _dragging.classList.add('kanban-card--dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function _onDragEnd() {
    if (_dragging) _dragging.classList.remove('kanban-card--dragging');
    _dragging = null;
    document.querySelectorAll('.kanban__col').forEach(c => c.classList.remove('kanban__col--drop-target'));
}

function _bindDragTargets() {
    document.querySelectorAll('.kanban__col').forEach(col => {
        col.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            col.classList.add('kanban__col--drop-target');
        });
        col.addEventListener('dragleave', () => col.classList.remove('kanban__col--drop-target'));
        col.addEventListener('drop', e => {
            e.preventDefault();
            col.classList.remove('kanban__col--drop-target');
            if (!_dragging) return;
            const fromCol = _dragging.dataset.col;
            const toCol   = col.dataset.col;
            if (fromCol === toCol) return;
            if (toCol === 'queue') _addToQueue(_dragging._itemData);
            else                   _removeFromQueue(_dragging._itemData);
            _renderKanban();
            _renderCombos();
            _renderIPCounter();
            _bindDragTargets();
        });
    });
}

// ─────────────────────────────────────────────────────────────
// Touch drag — mobile emulation
// ─────────────────────────────────────────────────────────────

let _touchCard = null;
let _touchClone = null;

function _onTouchStart(e) {
    _touchCard = e.currentTarget;
    const touch = e.touches[0];
    const rect  = _touchCard.getBoundingClientRect();

    _touchClone = _touchCard.cloneNode(true);
    _touchClone.style.cssText =
        `position:fixed;z-index:9999;width:${rect.width}px;pointer-events:none;` +
        `opacity:0.85;left:${rect.left}px;top:${rect.top}px;`;
    document.body.appendChild(_touchClone);
    _touchCard.classList.add('kanban-card--dragging');

    document.addEventListener('touchmove',  _onTouchMove,  { passive: false });
    document.addEventListener('touchend',   _onTouchEnd,   { once: true });
    document.addEventListener('touchcancel',_onTouchCancel,{ once: true });
}

function _onTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    if (_touchClone) {
        _touchClone.style.left = `${touch.clientX - _touchClone.offsetWidth / 2}px`;
        _touchClone.style.top  = `${touch.clientY - 20}px`;
    }
    // Highlight target column
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const col = el?.closest('.kanban__col');
    document.querySelectorAll('.kanban__col').forEach(c => c.classList.toggle('kanban__col--drop-target', c === col));
}

function _onTouchEnd(e) {
    document.removeEventListener('touchmove', _onTouchMove);
    _touchClone?.remove();
    _touchClone = null;
    if (!_touchCard) return;

    const touch = e.changedTouches[0];
    const el    = document.elementFromPoint(touch.clientX, touch.clientY);
    const col   = el?.closest('.kanban__col');
    const toCol = col?.dataset.col;
    const fromCol = _touchCard.dataset.col;
    const itemData = _touchCard._itemData;

    document.querySelectorAll('.kanban__col').forEach(c => c.classList.remove('kanban__col--drop-target'));
    _touchCard.classList.remove('kanban-card--dragging');
    _touchCard = null;

    if (col && fromCol !== toCol && itemData) {
        if (toCol === 'queue') _addToQueue(itemData);
        else                   _removeFromQueue(itemData);
        _renderKanban();
        _renderCombos();
        _renderIPCounter();
        _bindDragTargets();
    }
}

function _onTouchCancel() {
    document.removeEventListener('touchmove', _onTouchMove);
    _touchClone?.remove();
    _touchClone = null;
    _touchCard?.classList.remove('kanban-card--dragging');
    _touchCard = null;
    document.querySelectorAll('.kanban__col').forEach(c => c.classList.remove('kanban__col--drop-target'));
}

// ─────────────────────────────────────────────────────────────
// Queue management
// ─────────────────────────────────────────────────────────────

const MAX_QUEUE = 5;

/** Returns total energy cost of current queue */
function _usedEnergy() {
    return (state.orderQueue || []).reduce((sum, c) => sum + (c.cost || 1), 0);
}

function _addToQueue(card) {
    if (!card) return;
    if (!state.orderQueue) state.orderQueue = [];
    if (state.orderQueue.length >= MAX_QUEUE) return;
    // Avoid duplicates
    if (state.orderQueue.some(q => q.id === card.id)) return;
    // Check IP budget
    if (_usedEnergy() + (card.cost || 1) > state.energyResourceMax) return;
    state.orderQueue.push(card);

    // Handle utility effects that fire immediately
    if (card.effect === 'draw_2') {
        drawCards(2);
        // Remove the utility card from the queue after triggering
        state.orderQueue = state.orderQueue.filter(q => q.id !== card.id);
    }

    _recomputeCombos();
    saveState();
}

function _removeFromQueue(card) {
    if (!card) return;
    state.orderQueue = (state.orderQueue || []).filter(q => q.id !== card.id);
    _recomputeCombos();
    saveState();
}

function _recomputeCombos() {
    const { merged } = evaluateCombos(state.orderQueue || []);
    state.activeComboEffects = merged;
}

// ─────────────────────────────────────────────────────────────
// Button handlers
// ─────────────────────────────────────────────────────────────

function _bindButtons() {
    // Focus selection
    document.querySelectorAll('.focus-btn').forEach(btn => {
        btn.onclick = () => {
            const f = btn.dataset.focus;
            state.currentDayFocus = (state.currentDayFocus === f) ? null : f;
            saveState();
            document.querySelectorAll('.focus-btn').forEach(b =>
                b.classList.toggle('focus-btn--active', b.dataset.focus === state.currentDayFocus)
            );
        };
    });

    // Buy cigs
    _buyCigsBtn.onclick = () => {
        const bought = buyGood('cigs', 120);
        if (bought) _cigsCount.textContent = state.goods.cigarettes;
    };

    // Start work
    _startBtn.onclick = () => advanceToWork();

    // Wire drag/drop targets
    _bindDragTargets();
}
