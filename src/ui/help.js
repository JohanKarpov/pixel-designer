// src/ui/help.js — Screen help/explanation sheet
// One ❓ button per screen → opens a bottom sheet with structured sections.

// ─────────────────────────────────────────────────────────────
// Help texts: one entry per screen
// Each section: { icon, title, body }
// ─────────────────────────────────────────────────────────────

const HELP_TEXTS = {
    planning: {
        title: 'Планирование',
        sections: [
            {
                icon: '⚡',
                title: 'Энергия',
                body: 'Каждая карта тратит энергию. Когда энергия закончится — больше карт в очередь не добавить. Энергия восстанавливается каждый день.',
            },
            {
                icon: '🎯',
                title: 'Фокус дня',
                body: 'Определяет бонус на весь рабочий день: Работа — +20% доход, Ресёрч — +30% опыт, Инструменты — +20% автоматизация.',
            },
            {
                icon: '✦',
                title: 'Комбо',
                body: 'Правильные сочетания карт в очереди активируют комбо-бонусы. Например, 3 карты с тегом «генерации» подряд дают «Генерационный стак» (+25% доход).',
            },
            {
                icon: '🃏',
                title: 'Карты',
                body: 'Тяни карты из колоды в пул, затем тапай чтобы поставить в очередь. Карты в очереди будут выполняться по порядку во время работы.',
            },
        ],
    },

    work: {
        title: 'Рабочий день',
        sections: [
            {
                icon: '⚡',
                title: 'Генерация',
                body: 'Нажми кнопку «Генерация» чтобы запустить мини-игру. Попади в зелёную зону в нужный момент — результат влияет на множитель дохода.',
            },
            {
                icon: '🎵',
                title: 'Ритм и множитель',
                body: 'PERFECT → множитель растёт быстро. GOOD → чуть медленнее. MISS → множитель сбрасывается. Следи за полосой ритма — чем она полнее, тем выше потенциальный доход.',
            },
            {
                icon: '😰',
                title: 'Стресс',
                body: 'Текущий стресс растёт в течение дня. Накопленный стресс копится несколько дней и сбрасывается в выходной. Высокий стресс снижает эффективность.',
            },
            {
                icon: '📋',
                title: 'Пул заказов',
                body: 'Активный заказ — тот, по которому идут генерации прямо сейчас. Остальные карты в пуле ждут очереди. Тапни на карту в пуле чтобы переключиться.',
            },
        ],
    },

    results: {
        title: 'Итоги дня',
        sections: [
            {
                icon: '💰',
                title: 'Дневная статистика',
                body: 'Сколько заработано, сколько заказов выполнено и провалено, сколько опыта получено за день.',
            },
            {
                icon: '📈',
                title: 'График стресса',
                body: 'Синяя линия — текущий стресс в течение дня. Красная линия — накопленный стресс (растёт медленнее, но сбрасывается только в выходной).',
            },
            {
                icon: '🤖',
                title: 'Агент',
                body: 'Агент работает в фоне даже когда ты не играешь. Его генерации приносят небольшой пассивный доход. Апгрейдь агента чтобы увеличить отдачу.',
            },
        ],
    },

    rest: {
        title: 'Отдых',
        sections: [
            {
                icon: '⏰',
                title: 'Свободное время',
                body: 'Утром у тебя 1 час до начала работы (8:00–9:00). Вечером — с конца работы до полуночи. Каждая активность тратит время.',
            },
            {
                icon: '🚪',
                title: 'Активности',
                body: 'Утром: завтрак (+1 энергия), парк (−10% стресс), зарядка (+15% XP). Вечером: прогулка (−15% накопл. стресс), кино (+10% комбо), бар (+5 известности).',
            },
            {
                icon: '☕',
                title: 'Быстрые действия',
                body: 'Пилюли в комнате: кофе утром даёт +1 энергию, вечером — +1ч времени (но +5 стресса). Перекур снижает стартовый стресс на 10%.',
            },
            {
                icon: '🏪',
                title: 'Магазин и колода',
                body: 'Кликни на рабочий стол → магазин расходников. Кликни на ящики → управление колодой карт. Серые карты — в колоде, но не будут тянуться.',
            },
        ],
    },
};

// ─────────────────────────────────────────────────────────────
// DOM refs (lazy — will be null until HTML is ready)
// ─────────────────────────────────────────────────────────────

let _sheet    = null;
let _backdrop = null;
let _title    = null;
let _body     = null;
let _close    = null;

function _lazyInit() {
    if (_sheet) return;
    _sheet    = document.getElementById('help-sheet');
    _backdrop = document.getElementById('help-sheet-backdrop');
    _title    = document.getElementById('help-sheet-title');
    _body     = document.getElementById('help-sheet-body');
    _close    = document.getElementById('help-sheet-close');
    if (_close)    _close.onclick    = closeHelp;
    if (_backdrop) _backdrop.onclick = closeHelp;
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export function showHelp(screenId) {
    _lazyInit();
    const data = HELP_TEXTS[screenId];
    if (!data || !_sheet) return;

    _title.textContent = data.title;
    _body.innerHTML = data.sections.map(s =>
        `<div class="help-section">` +
            `<div class="help-section__header">` +
                `<span class="help-section__icon">${s.icon}</span>` +
                `<span class="help-section__title">${s.title}</span>` +
            `</div>` +
            `<p class="help-section__body">${s.body}</p>` +
        `</div>`
    ).join('');

    _sheet.classList.add('help-sheet--visible');
    _sheet.removeAttribute('inert');
    // Move focus to the close button for accessibility
    _close?.focus();
}

export function closeHelp() {
    _lazyInit();
    if (!_sheet) return;
    _sheet.classList.remove('help-sheet--visible');
    _sheet.setAttribute('inert', '');
}

/** Wire all [data-help] buttons in the document. Call once after DOM is ready. */
export function bindHelpButtons() {
    document.addEventListener('click', e => {
        const btn = e.target.closest('[data-help]');
        if (btn) showHelp(btn.dataset.help);
    });
    // Close on Escape
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeHelp();
    });
}
