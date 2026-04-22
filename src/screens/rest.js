// src/screens/rest.js — REST phase UI (Concept C: room + hotspots)

import { state, saveState }                                                     from '../core/state.js';
import { startNextDay, sleepToMorning, doRestActivity, getRestHoursLeft, REST_ACTIVITIES } from '../day/day-cycle.js';
import { getPlayerDeckWithDefs, setCardEnabled, ensurePlayerDeck }               from '../core/deck.js';
import { startFlicker, stopFlicker, updateWindowOpacity, setChannelBoost }      from '../core/flicker.js';
import { selectScene, applyOutcomes }                                            from '../core/story.js';
import { showScene }                                                             from '../ui/scene-dialog.js';
import { getGyro, recalibrateGyro, initGyro }                                   from '../core/gyro.js';

// ─────────────────────────────────────────────────────────────
// Display metadata
// ─────────────────────────────────────────────────────────────

const QUICK_META = {
    smoke:          { icon: '🚬', name: 'Перекур',   buffLabel: '−0% стартового стресса'   },
    coffee_morning: { icon: '☕',    name: 'Кофе',      buffLabel: '+1 энергия завтра'         },
    coffee_evening: { icon: '☕',    name: 'Кофе',      buffLabel: '+1ч времени, +5 стресса' },
};

const OUTSIDE_META = {
    // ── Evening ──
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
    // ── Morning ──
    breakfast: {
        icon: '🍳',
        name: 'Завтрак',
        story: 'Хороший завтрак — хорошее начало дня.',
        effects: ['⚡ +1 энергия завтра'],
    },
    park: {
        icon: '🌳',
        name: 'Парк',
        story: 'Полчаса в парке перед рабочим днём.',
        effects: ['😌 −10% стартового стресса завтра'],
    },
    exercise: {
        icon: '🏋️',
        name: 'Зарядка',
        story: 'Немного движения утром — и день пойдёт лучше.',
        effects: ['📚 +15% XP за весь рабочий день'],
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
const _screenTitle     = document.getElementById('rest-screen-title');
const _debugResetBtn   = document.getElementById('debug-reset-btn');
if (_debugResetBtn) {
    _debugResetBtn.addEventListener('click', async () => {
        if (!confirm('Полный сброс? Сохранение и кэш будут удалены.')) return;
        localStorage.clear();
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
        location.reload();
    });
}
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
let _cityInnerEl       = null;
let _cityWrapEl        = null;
let _parallaxRafId     = null;

// ─────────────────────────────────────────────────────────────
// City layer switching + time-of-day
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// City layer switching — smooth crossfade by hour
// ─────────────────────────────────────────────────────────────
//
// Schedule:
//   sunrise: 6:00–10:00
//   day:    10:00–17:00
//   sunrise: 17:00–20:00  (sunset placeholder)
//   night:  20:00–6:00
//
// ±30 min fade zones at each boundary.

function _lerp01(val, lo, hi) {
    if (hi <= lo) return 0;
    return Math.max(0, Math.min(1, (val - lo) / (hi - lo)));
}

function _computeCityOpacities(hour) {
    const h    = ((hour % 24) + 24) % 24;
    // For night, which wraps midnight, map hours 0–6 → 24–30
    const h24  = h < 6.5 ? h + 24 : h;
    const FADE = 0.5; // half-width of each transition window (30 min)

    const sunrise = Math.max(
        // morning: 6–10
        Math.min(_lerp01(h,   5.5, 6.5),  1 - _lerp01(h,   9.5, 10.5)),
        // evening: 17–20
        Math.min(_lerp01(h,  16.5, 17.5), 1 - _lerp01(h,  19.5, 20.5))
    );

    const day = Math.min(
        _lerp01(h, 9.5, 10.5),
        1 - _lerp01(h, 16.5, 17.5)
    );

    // night wraps midnight: active 20–30 (= 20–6 next day)
    const night = Math.min(
        _lerp01(h24, 19.5, 20.5),
        1 - _lerp01(h24, 29.5, 30.5)
    );

    return { day, sunrise, night, rain: 0 };
}

function _updateCityLayer(hour) {
    if (!_cityWrapEl) return;
    const opacities = _computeCityOpacities(hour);
    // rain driven by state.weather only — not part of hour schedule
    opacities.rain = (state.weather === 'rain') ? 1 : 0;
    _cityWrapEl.querySelectorAll('.rest-city-layer').forEach(el => {
        const key = el.dataset.city;
        el.style.opacity = (opacities[key] ?? 0).toFixed(3);
    });
}

// ─────────────────────────────────────────────────────────────
// City parallax (gyro → inner container translate)
// ─────────────────────────────────────────────────────────────

const PARALLAX_GAMMA_SCALE = 0.5;   // degrees → px  (horizontal)
const PARALLAX_BETA_SCALE  = 0.3;   // degrees → px  (vertical)

function _startParallax() {
    if (_parallaxRafId) return;
    function _frame() {
        if (_cityInnerEl) {
            const { beta, gamma } = getGyro();
            const tx = -gamma * PARALLAX_GAMMA_SCALE;
            const ty = -beta  * PARALLAX_BETA_SCALE;
            _cityInnerEl.style.transform = `translate(${tx}px, ${ty}px)`;
        }
        _parallaxRafId = requestAnimationFrame(_frame);
    }
    _parallaxRafId = requestAnimationFrame(_frame);
}

function _stopParallax() {
    if (_parallaxRafId) {
        cancelAnimationFrame(_parallaxRafId);
        _parallaxRafId = null;
    }
}

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

export function onEnterRest() {
    ensurePlayerDeck();   // init deck on first visit (before planning)
    _renderRestMode();
    _updateHours();
    _renderQuickStrip();
    _renderOutsideList();
    _updateNotificationDots();
    _bindHotspots();
    _bindSheet();
    _bindPopup();
    _btnNextDay.onclick = _handleNextDayBtn;

    // Start ambient light flicker (3 channels)
    const monitorsEl    = document.getElementById('rest-layer-monitors');
    const skillEl       = document.getElementById('rest-layer-skill-monitor');
    const lampEl        = document.getElementById('rest-layer-lamp-shadows');
    _windowEl           = document.getElementById('rest-layer-window-city');
    _cityInnerEl        = document.getElementById('rest-city-inner');
    _cityWrapEl         = document.getElementById('rest-city-wrap');
    state.restUsageCounts = {};
    startFlicker(monitorsEl, skillEl, lampEl);
    updateWindowOpacity(_windowEl, state.inGameHour ?? 18);

    // City parallax
    initGyro();
    recalibrateGyro();
    _updateCityLayer(state.inGameHour ?? 18);
    _startParallax();
}

export function onLeaveRest() {
    stopFlicker();
    _stopParallax();
}

// ─────────────────────────────────────────────────────────────
// Hours display
// ─────────────────────────────────────────────────────────────

function _updateHours() {
    const h = getRestHoursLeft();
    _hoursEl.textContent = `${h.toFixed(1)}ч`;
    _hourLabel.textContent = _fmtHour(state.inGameHour);
    if (_windowEl) updateWindowOpacity(_windowEl, state.inGameHour);
    _updateCityLayer(state.inGameHour ?? 18);
}

// ─────────────────────────────────────────────────────────────
// Quick action pills (in-room, instant)
// ─────────────────────────────────────────────────────────────

function _renderQuickStrip() {
    _quickStrip.innerHTML = '';
    const isMorning = !!state.restMorning;
    const quickActs = REST_ACTIVITIES.filter(a => a.quick &&
        (a.morning === undefined || a.morning === isMorning));
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
    const isMorning   = !!state.restMorning;
    const outsideActs = REST_ACTIVITIES.filter(a => !a.quick && a.morning === isMorning);
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
    _popupConfirm.onclick  = async () => {
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

            // Try to trigger a scene for this location
            const scene = selectScene(id);
            if (scene) {
                const outcomes = await showScene(scene);
                applyOutcomes({ ...scene, outcomes }, { showToast: _showToast });
            } else {
                _showToast(`${meta.icon} ${meta.name} — готово`);
            }
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
        const _deckHover = id === 'hotspot-deck';
        el.addEventListener('mouseenter', () => {
            setChannelBoost(channel, true);
            if (_deckHover) _scene?.classList.add('rest-scene--skills-hover');
        });
        el.addEventListener('mouseleave', () => {
            setChannelBoost(channel, false);
            if (_deckHover) _scene?.classList.remove('rest-scene--skills-hover');
        });

        el.addEventListener('touchstart', () => {
            el.classList.add('rest-zone--active');
            setChannelBoost(channel, true);
            if (_deckHover) _scene?.classList.add('rest-scene--skills-hover');
        }, { passive: true });
        const _unboost = () => {
            // Linger 150ms before removing visual
            setTimeout(() => {
                el.classList.remove('rest-zone--active');
                setChannelBoost(channel, false);
                if (_deckHover) _scene?.classList.remove('rest-scene--skills-hover');
            }, 150);
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
        _shopActiveTab = 'shop';
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

function _rewardLabel(def) {
    const r = def.reward || {};
    if (r.moneyPerGen) return `💰 ${r.moneyPerGen * (def.requiredGenerations || 1)}₽`;
    if (r.xpPerGen) {
        const total = r.xpPerGen * (def.requiredGenerations || 1) + (r.xpFlat || 0);
        return `📚 ${total} XP`;
    }
    if (r.famePerGen) return `★ ${r.famePerGen * (def.requiredGenerations || 1)}`;
    if (def.effect === 'draw_2') return '🃏 +2 карты';
    if (def.effect === 'next_card_reward_plus20') return '✶ +20%';
    return '—';
}

function _renderDeckBuilder() {
    const cards  = getPlayerDeckWithDefs();
    const active = cards.filter(({ entry }) => entry.enabled !== false).length;

    _sheetBody.innerHTML =
        `<div class="deck-builder">` +
        `<div class="deck-builder__header">` +
        `<span class="deck-builder__title">Колода</span>` +
        `<span class="deck-builder__count">${active} / ${cards.length} активны</span>` +
        `</div>` +
        `<div class="deck-grid">` +
        cards.map(({ entry, def }) => {
            const enabled = entry.enabled !== false;
            const reward  = _rewardLabel(def);
            const gens    = def.requiredGenerations ? `${def.requiredGenerations} ген` : '—';
            return `<div class="deck-grid-card deck-grid-card--${def.rarity}${enabled ? '' : ' deck-grid-card--off'}" data-card-id="${def.id}" role="button" tabindex="0">` +
                `<div class="deck-grid-card__icon">${def.icon || '🃏'}</div>` +
                `<div class="deck-grid-card__title">${def.title}</div>` +
                `<div class="deck-grid-card__gens">${gens}</div>` +
                `<div class="deck-grid-card__reward">${reward}</div>` +
                `<div class="deck-grid-card__state">${enabled ? '✓' : '✕'}</div>` +
                `</div>`;
        }).join('') +
        `</div>` +
        `</div>`;

    _sheetBody.querySelectorAll('.deck-grid-card[data-card-id]').forEach(card => {
        card.addEventListener('click', () => {
            const id         = card.dataset.cardId;
            const wasEnabled = !card.classList.contains('deck-grid-card--off');
            if (wasEnabled) {
                const disabledCount = getPlayerDeckWithDefs().filter(({ entry }) => entry.enabled === false).length;
                if (disabledCount >= 3) { _showToast('Можно отключить не более 3 карт'); return; }
            }
            setCardEnabled(id, !wasEnabled);
            card.classList.toggle('deck-grid-card--off', wasEnabled);
            card.querySelector('.deck-grid-card__state').textContent = wasEnabled ? '✕' : '✓';
            const newActive = getPlayerDeckWithDefs().filter(({ entry }) => entry.enabled !== false).length;
            const counter = _sheetBody.querySelector('.deck-builder__count');
            if (counter) counter.textContent = `${newActive} / ${cards.length} активны`;
        });
    });
}

// ─────────────────────────────────────────────────────────────
// Shop (inside sheet)
// ─────────────────────────────────────────────────────────────

let _shopActiveTab = 'shop';

function _renderShop() {
    _sheetBody.innerHTML =
        `<div class="shop-tabs">` +
        `<button class="shop-tab${_shopActiveTab === 'shop' ? ' shop-tab--active' : ''}" data-stab="shop">🛒 Магазин</button>` +
        `<button class="shop-tab${_shopActiveTab === 'inv'  ? ' shop-tab--active' : ''}" data-stab="inv">🎒 Инвентарь</button>` +
        `</div>` +
        `<div id="shop-tab-content"></div>`;

    _sheetBody.querySelectorAll('[data-stab]').forEach(btn => {
        btn.addEventListener('click', () => {
            _shopActiveTab = btn.dataset.stab;
            _sheetBody.querySelectorAll('[data-stab]').forEach(b =>
                b.classList.toggle('shop-tab--active', b.dataset.stab === _shopActiveTab));
            _renderShopTab();
        });
    });
    _renderShopTab();
}

function _renderShopTab() {
    const el = document.getElementById('shop-tab-content');
    if (!el) return;
    if (_shopActiveTab === 'shop') {
        el.innerHTML = `<div class="shop-grid">${
            SHOP_ITEMS.map(item => {
                const funds     = state.funds?.toNumber ? state.funds.toNumber() : (state.funds || 0);
                const canAfford = funds >= item.price;
                const stock     = _itemStockLabel(item.id);
                return `<div class="shop-item${canAfford ? '' : ' shop-item--broke'}">` +
                    `<span class="shop-item__icon">${item.icon}</span>` +
                    `<div class="shop-item__info">` +
                    `<span class="shop-item__name">${item.name}</span>` +
                    `<span class="shop-item__desc">${item.desc}</span>` +
                    `<span class="shop-item__stock">${stock}</span>` +
                    `</div>` +
                    `<button class="btn btn--ghost shop-item__btn" data-shop-id="${item.id}" ${canAfford ? '' : 'disabled'}>` +
                    `${item.price}₽</button>` +
                    `</div>`;
            }).join('')
        }</div>`;
        el.querySelectorAll('[data-shop-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                _buyShopItem(btn.dataset.shopId);
                _renderShopTab();
                _updateNotificationDots();
            });
        });
    } else {
        _renderInventory(el);
    }
}

function _itemStockLabel(id) {
    switch (id) {
        case 'cigs':      return `В запасе: ${state.goods.cigarettes ?? 0} шт`;
        case 'energizer': return state.goods.energizerActive ? '✓ Активен' : 'Нет';
        case 'vitamins':  return state.goods.vitaminsActive  ? '✓ Активны' : 'Нет';
        case 'juice':     return `В запасе: ${state.goods.juice ?? 0} шт`;
        default:          return '';
    }
}

function _renderInventory(el) {
    const rows = [
        {
            icon: '🚬', name: 'Сигареты',
            count: `${state.goods.cigarettes ?? 0} шт`,
            note: 'Быстрые действия → Перекур',
            canUse: false,
        },
        {
            icon: '⚡', name: 'Энергетик',
            count: state.goods.energizerActive ? '✓ Активен' : '—',
            note: '+20% скорость генераций в рабочий день',
            canUse: false,
        },
        {
            icon: '💊', name: 'Витамины',
            count: state.goods.vitaminsActive ? '✓ Активны' : '—',
            note: 'Замедляют стресс-распад в рабочий день',
            canUse: false,
        },
        {
            icon: '🧃', name: 'Сок',
            count: `${state.goods.juice ?? 0} шт`,
            note: '−10% накопленного стресса',
            canUse: (state.goods.juice ?? 0) > 0,
            useId: 'juice',
        },
    ];
    el.innerHTML = `<div class="inv-list">${
        rows.map(r =>
            `<div class="inv-item">` +
            `<span class="inv-item__icon">${r.icon}</span>` +
            `<div class="inv-item__info">` +
            `<span class="inv-item__name">${r.name}</span>` +
            `<span class="inv-item__note">${r.note}</span>` +
            `</div>` +
            `<div class="inv-item__right">` +
            `<span class="inv-item__count${r.count.startsWith('✓') ? ' inv-item__count--active' : ''}">${r.count}</span>` +
            (r.canUse
                ? `<button class="btn btn--ghost inv-item__use" data-use-id="${r.useId}">Выпить</button>`
                : '') +
            `</div>` +
            `</div>`
        ).join('')
    }</div>`;
    el.querySelectorAll('[data-use-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            _useInventoryItem(btn.dataset.useId);
            _renderShopTab();
        });
    });
}

function _useInventoryItem(id) {
    if (id === 'juice') {
        if ((state.goods.juice ?? 0) <= 0) return;
        state.goods.juice = (state.goods.juice ?? 1) - 1;
        state.accumulatedStress = Math.max(
            0,
            state.accumulatedStress - Math.round((state.accumulatedStress || 0) * 0.10)
        );
        saveState();
        _showToast('🧃 −10% накопленного стресса');
    }
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
        case 'juice':     state.goods.juice = (state.goods.juice ?? 0) + 1; break;
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

// ─────────────────────────────────────────────────────────────
// Evening ↔ Morning mode
// ─────────────────────────────────────────────────────────────

const _DOW_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function _renderRestMode() {
    const dow = _DOW_NAMES[((state.dayCount || 1) - 1) % 7];
    _dayLabel.textContent = dow;
    if (state.restMorning) {
        if (_screenTitle) _screenTitle.textContent = 'Утро';
        _hourLabel.textContent  = _fmtHour(state.inGameHour ?? 8.0);
        _btnNextDay.textContent = '▶ Начать рабочий день';
        _btnNextDay.className   = 'btn btn--success btn--large';
    } else {
        if (_screenTitle) _screenTitle.textContent = 'Вечер';
        _hourLabel.textContent  = _fmtHour(state.inGameHour ?? 18);
        _btnNextDay.textContent = '💤 Спать';
        _btnNextDay.className   = 'btn btn--primary btn--large';
    }
}

function _handleNextDayBtn() {
    if (state.restMorning) {
        // Morning mode → go to planning
        startNextDay();
    } else {
        // Evening mode → fade to black, sleep, fade back in
        const fade = document.getElementById('screen-fade');
        fade.classList.add('screen-fade--in');
        setTimeout(() => {
            sleepToMorning();
            _renderRestMode();
            _updateHours();
            _renderQuickStrip();
            _renderOutsideList();
            setTimeout(() => fade.classList.remove('screen-fade--in'), 80);
        }, 450);
    }
}

function _fmtHour(h) {
    const hrs  = Math.floor(h);
    const mins = Math.floor((h - hrs) * 60);
    const time = `${hrs}:${String(mins).padStart(2, '0')}`;
    // Time-of-day emoji: 🌅 dawn, 🏙 day, 🌇 evening, 🌃 night
    let emoji;
    if (hrs >= 5  && hrs < 10) emoji = '🌅'; // рассвет / утро
    else if (hrs >= 10 && hrs < 17) emoji = '🏙'; // день
    else if (hrs >= 17 && hrs < 21) emoji = '🌇'; // закат / вечер
    else emoji = '🌃';                             // ночь
    return `${emoji} ${time}`;
}
