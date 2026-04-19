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
    const _DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const _dowIndex = ((state.dayCount || 1) - 1) % 7;
    _dayLabel.textContent = _DOW[_dowIndex];
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
        empty.style.cssText = 'font-size:calc(var(--r)*12);color:var(--clr-text-muted);padding:calc(var(--r)*8) 0';
        empty.textContent = state.drawPile?.length === 0
            ? 'Колода исчерпана'
            : 'Нет карт';
        _poolCol.appendChild(empty);
    } else {
        hand.forEach(card => {
            const affordable = (state.energyResourceMax - usedEnergy) >= card.cost;
            _poolCol.appendChild(_makeCard(card, !affordable));
        });
    }

    // Queue — compact squares
    const queue = state.orderQueue || [];
    queue.forEach((card, i) => _queueCol.appendChild(_makeSquare(card, i)));

    // Fill remaining slots with placeholder squares
    for (let i = queue.length; i < MAX_QUEUE; i++) {
        const ph = document.createElement('div');
        ph.className = 'kanban-square kanban-square--placeholder';
        _queueCol.appendChild(ph);
    }

    // Start button — dimmed when queue is empty
    const hasQueue = queue.length > 0;
    _startBtn.disabled = !hasQueue;
    _startBtn.classList.toggle('btn--disabled', !hasQueue);
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

// ── Card type → emoji icon ──────────────────────────────────
const CARD_ICON = {
    task:     '📋',
    research: '🔬',
    promo:    '📢',
    utility:  '⚡',
};
// miniGenMode → short badge label
const MODE_LABEL = {
    study:    'study',
    sort:     'sort',
    standard: 'gen',
};

/** Resolve color-coding class from card */
function _colorClass(card) {
    if (card.tags?.includes('планирование')) return 'planning';
    if (card.cardType === 'utility')          return 'utility';
    if (card.miniGenMode === 'study')         return 'study';
    if (card.miniGenMode === 'sort')          return 'sort';
    if (card.miniGenMode === 'standard')      return 'gen';
    return null;
}

/** Build reward summary line */
function _rewardStr(card) {
    const r = card.reward || {};
    const parts = [];
    if (r.moneyPerGen)  parts.push(`${r.moneyPerGen}₽/г`);
    if (r.xpPerGen)     parts.push(`${r.xpPerGen}XP/г`);
    if (r.xpFlat)       parts.push(`+${r.xpFlat}XP`);
    if (r.famePerGen)   parts.push(`${r.famePerGen}★/г`);
    if (r.fameFlat)     parts.push(`+${r.fameFlat}★`);
    if (card.requiredGenerations > 0) parts.unshift(`${card.requiredGenerations}г`);
    return parts.join(' · ');
}

/** Pool card — horizontal compact row */
function _makeCard(card, disabled = false) {
    const el = document.createElement('div');
    el.className = 'kanban-card';
    if (disabled) el.classList.add('kanban-card--disabled');
    const cc = _colorClass(card);
    if (cc) el.classList.add(`kanban-card--${cc}`);

    el.dataset.id  = card.id ?? Math.random();
    el.dataset.col = 'pool';

    const icon      = CARD_ICON[card.cardType] || '📋';
    const modeBadge = MODE_LABEL[card.miniGenMode]
        ? `<span class="kanban-card__mode">${MODE_LABEL[card.miniGenMode]}</span>` : '';

    // Show description only for effect/modifier cards (utility with effect, no generations)
    const showDesc = card.effect && !card.requiredGenerations && card.description;
    const descLine = showDesc
        ? `<span class="kanban-card__desc">${card.description}</span>` : '';

    el.innerHTML =
        `<span class="kanban-card__icon">${icon}</span>` +
        `<span class="kanban-card__body">` +
            `<span class="kanban-card__title">${card.title}</span>` +
            (descLine || `<span class="kanban-card__reward">${_rewardStr(card)}</span>`) +
        `</span>` +
        (modeBadge ? modeBadge : '') +
        `<span class="kanban-card__cost">⚡${card.cost}</span>`;

    el._itemData = card;

    if (!disabled) {
        _bindCardInteraction(el, card);
    }
    return el;
}

/** Queue compact square */
function _makeSquare(card, index) {
    const el = document.createElement('div');
    el.className = 'kanban-square';
    const cc = _colorClass(card);
    if (cc) el.classList.add(`kanban-square--${cc}`);

    el.dataset.id  = card.id ?? Math.random();
    el.dataset.col = 'queue';
    el.dataset.idx = index;

    const icon = CARD_ICON[card.cardType] || '📋';
    el.innerHTML =
        `<span class="kanban-square__icon">${icon}</span>` +
        `<span class="kanban-square__cost">⚡${card.cost}</span>`;

    el._itemData = card;
    el._index    = index;

    // Tap → remove from queue
    el.addEventListener('click', () => {
        _removeFromQueue(card);
        _renderKanban();
        _renderCombos();
        _renderEnergyCounter();
        _bindDragTargets();
    });

    // Long-press → drag
    _bindSquareLongPress(el, card);
    return el;
}

// ── Tap-to-add + long-press-drag for pool cards ──────────────
const LONG_PRESS_MS = 220;

function _bindCardInteraction(el, card) {
    let _pressTimer = null;
    let _dragging   = false;

    const startLongPress = (e) => {
        _dragging = false;
        const capturedE = e; // capture before async — currentTarget becomes null in setTimeout
        _pressTimer = setTimeout(() => {
            _dragging = true;
            el.setAttribute('draggable', 'true');
            el.classList.add('kanban-card--hold');
            _onTouchStart(capturedE, el);
        }, LONG_PRESS_MS);
    };

    const cancelLongPress = () => {
        clearTimeout(_pressTimer);
        _pressTimer = null;
    };

    el.addEventListener('touchstart', startLongPress, { passive: true });
    el.addEventListener('touchend', (e) => {
        cancelLongPress();
        if (!_dragging) {
            // Tap: add to queue
            e.preventDefault();
            _addToQueue(card);
            _renderKanban();
            _renderCombos();
            _renderEnergyCounter();
            _bindDragTargets();
        }
        _dragging = false;
        el.setAttribute('draggable', 'false');
        el.classList.remove('kanban-card--hold');
    });
    el.addEventListener('touchcancel', () => {
        cancelLongPress();
        _dragging = false;
        el.setAttribute('draggable', 'false');
        el.classList.remove('kanban-card--hold');
    });
    el.addEventListener('touchmove', () => {
        // If finger moves during long press, cancel press and switch to drag
        if (_pressTimer) {
            clearTimeout(_pressTimer);
            _pressTimer = null;
            _dragging = true;
            el.setAttribute('draggable', 'true');
        }
    }, { passive: true });

    // Desktop click
    el.addEventListener('click', () => {
        if (!_dragging) {
            _addToQueue(card);
            _renderKanban();
            _renderCombos();
            _renderEnergyCounter();
            _bindDragTargets();
        }
    });

    // Desktop drag (initiated by mouse)
    el.addEventListener('dragstart', _onDragStart);
    el.addEventListener('dragend',   _onDragEnd);
}

function _bindSquareLongPress(el, card) {
    let _pressTimer = null;

    el.addEventListener('touchstart', (e) => {
        // Capture touch reference before setTimeout (currentTarget becomes null async)
        const capturedE = e;
        _pressTimer = setTimeout(() => {
            el.setAttribute('draggable', 'true');
            el.classList.add('kanban-square--hold');
            _onTouchStart(capturedE, el);
        }, LONG_PRESS_MS);
    }, { passive: true });
    el.addEventListener('touchend', () => {
        clearTimeout(_pressTimer);
        _pressTimer = null;
        el.setAttribute('draggable', 'false');
        el.classList.remove('kanban-square--hold');
    });
    el.addEventListener('touchcancel', () => {
        clearTimeout(_pressTimer);
        _pressTimer = null;
        el.setAttribute('draggable', 'false');
        el.classList.remove('kanban-square--hold');
    });

    el.addEventListener('dragstart', _onDragStart);
    el.addEventListener('dragend',   _onDragEnd);
}

// ─────────────────────────────────────────────────────────────
// Drag & drop — desktop
// ─────────────────────────────────────────────────────────────

let _dragging = null;

function _onDragStart(e) {
    _dragging = e.currentTarget;
    const cls = _dragging.classList.contains('kanban-square') ? 'kanban-square--dragging' : 'kanban-card--dragging';
    _dragging.classList.add(cls);
    e.dataTransfer.effectAllowed = 'move';
}

function _onDragEnd() {
    if (_dragging) {
        _dragging.classList.remove('kanban-card--dragging', 'kanban-square--dragging');
    }
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
            _renderEnergyCounter();
            _bindDragTargets();
        });
    });
}

// ─────────────────────────────────────────────────────────────
// Touch drag — mobile emulation
// ─────────────────────────────────────────────────────────────

let _touchCard = null;
let _touchClone = null;

function _onTouchStart(e, overrideEl) {
    _touchCard = overrideEl || e.currentTarget;
    const touch = e.touches[0];
    const rect  = _touchCard.getBoundingClientRect();

    // Clone as compact square (matches queue style)
    const squareSize = Math.round(rect.height * 1.1);
    _touchClone = document.createElement('div');
    _touchClone.className = 'kanban-square kanban-drag-clone';
    // Copy color class from original
    ['study','sort','planning','utility','gen'].forEach(c => {
        if (_touchCard.classList.contains(`kanban-card--${c}`) ||
            _touchCard.classList.contains(`kanban-square--${c}`)) {
            _touchClone.classList.add(`kanban-square--${c}`);
        }
    });
    const icon = _touchCard.querySelector('.kanban-card__icon, .kanban-square__icon')?.textContent || '📋';
    const cost = _touchCard.querySelector('.kanban-card__cost, .kanban-square__cost')?.textContent || '';
    _touchClone.innerHTML =
        `<span class="kanban-square__icon">${icon}</span>` +
        `<span class="kanban-square__cost">${cost}</span>`;
    _touchClone.style.cssText =
        `position:fixed;z-index:9999;width:${squareSize}px;height:${squareSize}px;pointer-events:none;` +
        `opacity:0.9;left:${touch.clientX - squareSize/2}px;top:${touch.clientY - squareSize/2}px;`;
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
        _touchClone.style.top  = `${touch.clientY - _touchClone.offsetHeight / 2}px`;
    }
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
    _touchCard.classList.remove('kanban-card--dragging', 'kanban-square--dragging');
    _touchCard = null;

    if (col && fromCol !== toCol && itemData) {
        if (toCol === 'queue') _addToQueue(itemData);
        else                   _removeFromQueue(itemData);
        _renderKanban();
        _renderCombos();
        _renderEnergyCounter();
        _bindDragTargets();
    }
}

function _onTouchCancel() {
    document.removeEventListener('touchmove', _onTouchMove);
    _touchClone?.remove();
    _touchClone = null;
    _touchCard?.classList.remove('kanban-card--dragging', 'kanban-square--dragging');
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
        // Remove the utility card from the queue AND hand after triggering
        state.orderQueue  = state.orderQueue.filter(q => q.id !== card.id);
        state.currentHand = (state.currentHand || []).filter(c => c.id !== card.id);
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
