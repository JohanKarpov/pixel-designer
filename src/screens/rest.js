// src/screens/rest.js — REST phase UI (Concept C: room + hotspots)

import { state, saveState }                                                     from '../core/state.js';
import { startNextDay, doRestActivity, getRestHoursLeft, REST_ACTIVITIES }      from '../day/day-cycle.js';
import { getPlayerDeckWithDefs, setCardEnabled }                                 from '../core/deck.js';
import { startFlicker, stopFlicker, updateWindowOpacity, setChannelBoost }      from '../core/flicker.js';

// ─────────────────────────────────────────────────────────────
// Display metadata
// ─────────────────────────────────────────────────────────────

const QUICK_META = {
    smoke:  { icon: '🚬', name: 'Перекур',  buffLabel: '−10% стартового стресса'     },
    coffee: { icon: '☕', name: 'Кофе',     buffLabel: '+0.5ч свободного времени'    },
};

const OUTSIDE_META = {
    walk:  {
        icon: '🚶',
        name: 'Прогулка',
        story: 'Свежий воздух немного прочищает голову...',
        effects: ['↓ −15% накопленного стресса'],
    },
    movie: {
        icon: '🎬',
        name: 'Кино',
        story: 'Пара часов в тёмном зале — отличный способ отключиться.',
        effects: ['↑ +10% бонус комбо завтра'],
    },
    bar: {
        icon: '🍺',
        name: 'Бар',
        story: 'Знакомое место, знакомые лица... и, возможно, новые.',
        effects: ['★ +5 известности'],
    },
};

const SHOP_ITEMS = [
    { id: 'cigs',      icon: '🚬', name: 'Пачка сигарет', desc: '+20 сигарет',               price: 500  },
    { id: 'energizer', icon: '⚡', name: 'Энергетик',     desc: '+20% скорость завтра',       price: 300  },
    { id: 'vitamins',  icon: '💊', name: 'Витамины',      desc: '−10% стартовый стресс',      price: 400  },
    { id: 'juice',     icon: '🧃', name: 'Сок',           desc: '−10% накопл. стресса сразу', price: 150  },
];

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────

const _dayLabel        = document.getElementById('rest-day-label');
const _hourLabel       = document.getElementById('rest-hour');
const _quickStrip      = document.getElementById('rest-quick-strip');
const _hoursEl         = document.getElementById('rest-hours-left');
const _outsideList     = document.getElementById('rest-outside-list');
const _room            = document.getElementById('rest-room');
const _scene           = document.getElementById('rest-scene');
const _btnNextDay      = document.getElementById('btn-next-day');
// Outside popup
const _popup           = document.getElementById('rest-outside-popup');
const _popupBackdrop   = document.getElementById('rest-popup-backdrop');
const _popupIcon       = document.getElementById('rest-popup-icon');
const _popupTitle      = document.getElementById('rest-popup-title');
const _popupStory      = document.getElementById('rest-popup-story');
const _popupEffects    = document.getElementById('rest-popup-effects');
const _popupCost       = document.getElementById('rest-popup-cost');
const _popupCancel     = document.getElementById('rest-popup-cancel');
const _popupConfirm    = document.getElementById('rest-popup-confirm');
// Generic bottom sheet
const _sheet           = document.getElementById('rest-sheet');
const _sheetBackdrop   = document.getElementById('rest-sheet-backdrop');
const _sheetTitle      = document.getElementById('rest-sheet-title');
const _sheetBody       = document.getElementById('rest-sheet-body');
const _sheetClose      = document.getElementById('rest-sheet-close');

let _pendingActivityId = null;
let _windowEl          = null;

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

export function onEnterRest() {
    _dayLabel.textContent  = `День ${state.dayCount || 1}`;
    _hourLabel.textContent = _fmtHour(state.inGameHour ?? 18);
    _updateHours();
    _renderQuickStrip();
    _renderOutsideList();
    _updateNotificationDots();
    _bindHotspots();
    _bindSheet();
    _bindPopup();
    _btnNextDay.onclick = () => startNextDay();

    // Start ambient light flicker (3 channels)
    const monitorsEl    = document.getElementById('rest-layer-monitors');
    const skillEl       = document.getElementById('rest-layer-skill-monitor');
    const lampEl        = document.getElementById('rest-layer-lamp-shadows');
    _windowEl           = document.getElementById('rest-layer-window-city');
    state.restUsageCounts = {};
    startFlicker(monitorsEl, skillEl, lampEl);
    updateWindowOpacity(_windowEl, state.inGameHour ?? 18);
}

export function onLeaveRest() {
    stopFlicker();
}

// ─────────────────────────────────────────────────────────────
// Hours display
// ─────────────────────────────────────────────────────────────

function _updateHours() {
    const h = getRestHoursLeft();
    _hoursEl.textContent = `${h.toFixed(1)}ч`;
    _hourLabel.textContent = _fmtHour(state.inGameHour);
    if (_windowEl) updateWindowOpacity(_windowEl, state.inGameHour);
}

// ─────────────────────────────────────────────────────────────
// Quick action pills (in-room, instant)
// ─────────────────────────────────────────────────────────────

function _renderQuickStrip() {
    _quickStrip.innerHTML = '';
    const quickActs = REST_ACTIVITIES.filter(a => a.quick);
    const hoursLeft = getRestHoursLeft();

    quickActs.forEach(act => {
        const meta      = QUICK_META[act.id] || { icon: '❓', name: act.id, buffLabel: '' };
        const canAfford = hoursLeft >= act.costHours;
        const usesLeft  = act.maxUses !== undefined
            ? act.maxUses - ((state.restUsageCounts && state.restUsageCounts[act.id]) || 0)
            : Infinity;
        const canUse    = canAfford && usesLeft > 0;
        const applied   = state.nextDayBuffs && Object.keys(act.buff)
            .some(k => state.nextDayBuffs[k] !== undefined);

        const pill = document.createElement('button');
        pill.className = 'rest-quick-pill' +
            (!canUse    ? ' rest-quick-pill--disabled' : '') +
            (applied    ? ' rest-quick-pill--applied'  : '');
        pill.disabled = !canUse;
        const costText = act.maxUses !== undefined
            ? `${act.costHours}ч · ${usesLeft}/${act.maxUses}`
            : `${act.costHours}ч`;
        pill.innerHTML =
            `<span class="rest-quick-pill__icon">${meta.icon}</span>` +
            `<span class="rest-quick-pill__name">${meta.name}</span>` +
            `<span class="rest-quick-pill__cost">${costText}</span>`;

        pill.addEventListener('click', () => {
            const ok = doRestActivity(act.id);
            if (ok) {
                _updateHours();
                _renderQuickStrip();
                _renderOutsideList();
                _updateNotificationDots();
                _showToast(`${meta.icon} ${meta.buffLabel}`);
            }
        });
        _quickStrip.appendChild(pill);
    });
}

// ─────────────────────────────────────────────────────────────
// Outside activities list (horizontal scroll, popup-driven)
// ─────────────────────────────────────────────────────────────

function _renderOutsideList() {
    _outsideList.innerHTML = '';
    const outsideActs = REST_ACTIVITIES.filter(a => !a.quick);
    const hoursLeft   = getRestHoursLeft();

    outsideActs.forEach(act => {
        const meta      = OUTSIDE_META[act.id] || { icon: '❓', name: act.id, story: '', effects: [] };
        const canAfford = hoursLeft >= act.costHours;
        const applied   = state.nextDayBuffs && Object.keys(act.buff)
            .some(k => state.nextDayBuffs[k] !== undefined);

        const card = document.createElement('button');
        card.className = 'rest-outside-card' +
            (!canAfford ? ' rest-outside-card--disabled' : '') +
            (applied    ? ' rest-outside-card--applied'  : '');
        card.disabled = !canAfford;
        card.innerHTML =
            `<span class="rest-outside-card__icon">${meta.icon}</span>` +
            `<span class="rest-outside-card__name">${meta.name}</span>` +
            `<span class="rest-outside-card__cost">${act.costHours}ч</span>`;

        card.addEventListener('click', () => _showOutsidePopup(act.id));
        _outsideList.appendChild(card);
    });
}

// ─────────────────────────────────────────────────────────────
// Outside popup
// ─────────────────────────────────────────────────────────────

function _showOutsidePopup(actId) {
    const act  = REST_ACTIVITIES.find(a => a.id === actId);
    const meta = OUTSIDE_META[actId] || { icon: '❓', name: actId, story: '', effects: [] };
    if (!act) return;
    _pendingActivityId      = actId;
    _popupIcon.textContent  = meta.icon;
    _popupTitle.textContent = meta.name;
    _popupStory.textContent = meta.story;
    _popupEffects.innerHTML = meta.effects
        .map(e => `<div class="rest-outside-popup__effect-row">${e}</div>`).join('');
    _popupCost.textContent  = `⏰ Стоит: ${act.costHours}ч`;
    _popup.classList.add('rest-outside-popup--visible');
}

function _hideOutsidePopup() {
    _popup.classList.remove('rest-outside-popup--visible');
    _pendingActivityId = null;
}

function _bindPopup() {
    _popupCancel.onclick   = _hideOutsidePopup;
    _popupBackdrop.onclick = _hideOutsidePopup;
    _popupConfirm.onclick  = () => {
        if (!_pendingActivityId) return;
        const id   = _pendingActivityId;
        const meta = OUTSIDE_META[id] || { icon: '❓', name: id };
        const ok   = doRestActivity(id);
        _hideOutsidePopup();
        if (ok) {
            _updateHours();
            _renderQuickStrip();
            _renderOutsideList();
            _updateNotificationDots();
            _showToast(`${meta.icon} ${meta.name} — готово`);
        }
    };
}

// ─────────────────────────────────────────────────────────────
// Hotspots
// ─────────────────────────────────────────────────────────────

function _bindHotspots() {
    // Each zone: { id, channel to boost, action on tap }
    const zones = [
        {
            id:      'hotspot-shop',
            channel: 'monitors',
            action:  () => _openSheet('shop'),
        },
        {
            id:      'hotspot-deck',
            channel: 'lamp',
            action:  () => _openSheet('deck'),
        },
        {
            id:      'hotspot-skills',
            channel: 'skill',
            action:  () => document.dispatchEvent(
                new CustomEvent('rest:navigate', { detail: { screen: 'upgrades' } })
            ),
        },
    ];

    zones.forEach(({ id, channel, action }) => {
        const el = document.getElementById(id);
        if (!el) return;

        // Boost flicker on hover (desktop) and while finger is down (touch)
        el.addEventListener('mouseenter', () => setChannelBoost(channel, true));
        el.addEventListener('mouseleave', () => setChannelBoost(channel, false));

        el.addEventListener('touchstart', () => {
            el.classList.add('rest-zone--active');
            setChannelBoost(channel, true);
        }, { passive: true });
        const _unboost = () => {
            el.classList.remove('rest-zone--active');
            setChannelBoost(channel, false);
        };
        el.addEventListener('touchend',    _unboost);
        el.addEventListener('touchcancel', _unboost);

        el.onclick = action;
    });
}

// ─────────────────────────────────────────────────────────────
// Generic bottom sheet
// ─────────────────────────────────────────────────────────────

function _openSheet(type) {
    if (type === 'deck') {
        _sheetTitle.textContent = '📚 Моя колода';
        _renderDeckBuilder();
    } else if (type === 'shop') {
        _sheetTitle.textContent = '🛒 Магазин';
        _renderShop();
    }
    _sheet.classList.add('rest-sheet--visible');
}

function _closeSheet() {
    _sheet.classList.remove('rest-sheet--visible');
}

function _bindSheet() {
    _sheetClose.onclick    = _closeSheet;
    _sheetBackdrop.onclick = _closeSheet;
}

// ─────────────────────────────────────────────────────────────
// Deck builder (inside sheet)
// ─────────────────────────────────────────────────────────────

function _renderDeckBuilder() {
    const cards  = getPlayerDeckWithDefs();
    const active = cards.filter(({ entry }) => entry.enabled !== false).length;

    _sheetBody.innerHTML =
        `<div class="deck-builder">` +
        `<div class="deck-builder__header">` +
        `<span class="deck-builder__title">Колода</span>` +
        `<span class="deck-builder__count">Активных: ${active} / ${cards.length}</span>` +
        `</div>` +
        `<div class="deck-builder__list">` +
        cards.map(({ entry, def }) => {
            const enabled = entry.enabled !== false;
            return `<div class="deck-card deck-card--${def.rarity} ${enabled ? '' : 'deck-card--disabled'}" data-card-id="${def.id}">` +
                `<div class="deck-card__header">` +
                `<span class="deck-card__title">${def.title}</span>` +
                `<span class="deck-card__rarity">${def.rarity}</span>` +
                `</div>` +
                `<div class="deck-card__desc">${def.description}</div>` +
                `<div class="deck-card__footer">` +
                `<span class="deck-card__cost">⚡${def.cost}</span>` +
                `<span class="deck-card__type">${def.cardType}</span>` +
                `<label class="deck-card__toggle">` +
                `<input type="checkbox" data-card-id="${def.id}" ${enabled ? 'checked' : ''}> В колоде` +
                `</label>` +
                `</div>` +
                `</div>`;
        }).join('') +
        `</div>` +
        `</div>`;

    _sheetBody.querySelectorAll('input[data-card-id]').forEach(input => {
        input.addEventListener('change', () => {
            setCardEnabled(input.dataset.cardId, input.checked);
            const cardEl = _sheetBody.querySelector(`.deck-card[data-card-id="${input.dataset.cardId}"]`);
            if (cardEl) cardEl.classList.toggle('deck-card--disabled', !input.checked);
            const newActive = getPlayerDeckWithDefs().filter(({ entry }) => entry.enabled !== false).length;
            const counter = _sheetBody.querySelector('.deck-builder__count');
            if (counter) counter.textContent = `Активных: ${newActive} / ${cards.length}`;
        });
    });
}

// ─────────────────────────────────────────────────────────────
// Shop (inside sheet)
// ─────────────────────────────────────────────────────────────

function _renderShop() {
    _sheetBody.innerHTML = `<div class="shop-grid">${
        SHOP_ITEMS.map(item => {
            const funds     = state.funds?.toNumber ? state.funds.toNumber() : (state.funds || 0);
            const canAfford = funds >= item.price;
            return `<div class="shop-item ${canAfford ? '' : 'shop-item--broke'}">` +
                `<span class="shop-item__icon">${item.icon}</span>` +
                `<div class="shop-item__info">` +
                `<span class="shop-item__name">${item.name}</span>` +
                `<span class="shop-item__desc">${item.desc}</span>` +
                `</div>` +
                `<button class="btn btn--ghost shop-item__btn" data-shop-id="${item.id}" ${canAfford ? '' : 'disabled'}>` +
                `${item.price}₽</button>` +
                `</div>`;
        }).join('')
    }</div>`;

    _sheetBody.querySelectorAll('[data-shop-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            _buyShopItem(btn.dataset.shopId);
            _renderShop();
            _updateNotificationDots();
        });
    });
}

function _buyShopItem(id) {
    const item  = SHOP_ITEMS.find(i => i.id === id);
    if (!item) return;
    const funds = state.funds?.toNumber ? state.funds.toNumber() : (state.funds || 0);
    if (funds < item.price) return;
    if (state.funds?.sub) state.funds = state.funds.sub(item.price);
    else state.funds = (state.funds || 0) - item.price;
    switch (id) {
        case 'cigs':      state.goods.cigarettes = (state.goods.cigarettes || 0) + 20; break;
        case 'energizer': state.goods.energizerActive = true; break;
        case 'vitamins':  state.goods.vitaminsActive  = true; break;
        case 'juice':
            state.accumulatedStress = Math.max(
                0,
                state.accumulatedStress - Math.round((state.accumulatedStress || 0) * 0.10)
            );
            break;
    }
    saveState();
    _showToast(`${item.icon} ${item.name} куплен`);
}

// ─────────────────────────────────────────────────────────────
// Notification dots
// ─────────────────────────────────────────────────────────────

function _updateNotificationDots() {
    _setDot('hotspot-dot-skills', !!state.unlockedMenus?.upgrades);
    _setDot('hotspot-dot-deck',   (state.playerDeck?.length || 0) > 0);
    _setDot('hotspot-dot-shop',   (state.goods?.cigarettes  || 0) < 5);
}

function _setDot(id, visible) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('rest-hotspot__dot--visible', visible);
}

// ─────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────

function _showToast(text) {
    const existing = _scene.querySelector('.rest-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'rest-toast';
    toast.textContent = text;
    _scene.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('rest-toast--visible')));
    setTimeout(() => {
        toast.classList.remove('rest-toast--visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 1800);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function _fmtHour(h) {
    const hrs  = Math.floor(h);
    const mins = Math.floor((h - hrs) * 60);
    return `${hrs}:${String(mins).padStart(2, '0')}`;
}
