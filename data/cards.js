// data/cards.js — Card definitions for the planning card system
// Each card represents a task the player can queue during PLANNING phase.
//
// Fields:
//   id            — unique string identifier
//   title         — display name
//   description   — short description shown on card
//   tags          — array of string tags used for combo detection
//   cardType      — 'task' | 'research' | 'promo' | 'utility'
//   miniGenMode   — 'standard' | 'study' | 'sort' (how the minigen mini-game runs for this card)
//   requiredGenerations — number of minigen rounds needed
//   reward        — { moneyPerGen, xpPerGen, xpFlat, famePerGen, fameFlat }
//   cost          — energy resource cost (integer ≥ 1)
//   source        — 'starter' | 'client' | 'reputation' | 'event' (origin of the card)
//   rarity        — 'common' | 'rare' | 'epic'
//   enabled       — true by default; player can disable in deck builder

export const CARD_DEFINITIONS = [
    // ── Starter task cards ────────────────────────────────────────────────

    {
        id: 'contract_work',
        title: 'По контракту',
        description: 'Выполни 10 генераций для клиента',
        tags: ['задача', 'генерации', 'контракт', 'реализация', 'концепты'],
        cardType: 'task',
        miniGenMode: 'standard',
        requiredGenerations: 10,
        reward: { moneyPerGen: 50, xpPerGen: 10 },
        cost: 2,
        source: 'starter',
        rarity: 'common',
        enabled: true,
    },
    {
        id: 'moodboard',
        title: 'Мудборд',
        description: 'Выполни 25 генераций концептов',
        tags: ['задача', 'генерации', 'фриланс', 'концепты'],
        cardType: 'task',
        miniGenMode: 'standard',
        requiredGenerations: 25,
        reward: { moneyPerGen: 25, xpPerGen: 5 },
        cost: 1,
        source: 'starter',
        rarity: 'common',
        enabled: true,
    },
    {
        id: 'storyboard',
        title: 'Раскадровка',
        description: 'Выполни 7 генераций для раскадровки',
        tags: ['задача', 'генерации', 'фриланс', 'реализация', 'концепты'],
        cardType: 'task',
        miniGenMode: 'standard',
        requiredGenerations: 7,
        reward: { moneyPerGen: 45, xpPerGen: 10 },
        cost: 1,
        source: 'starter',
        rarity: 'common',
        enabled: true,
    },

    // ── Research cards ────────────────────────────────────────────────────

    {
        id: 'prompt_research',
        title: 'Ресёрч промтов',
        description: 'Изучи 5 генераций — найди нужный тег',
        tags: ['задача', 'генерации', 'ресерч', 'ИИ-модели', 'энергия'],
        cardType: 'research',
        miniGenMode: 'study',
        requiredGenerations: 5,
        reward: { xpPerGen: 50 },
        cost: 1,
        source: 'starter',
        rarity: 'common',
        enabled: true,
    },
    {
        id: 'deep_research',
        title: 'Глубокий ресёрч',
        description: 'Изучи 10 генераций и систематизируй паттерны',
        tags: ['ресерч', 'ИИ-модели', 'энергия', 'генерации'],
        cardType: 'research',
        miniGenMode: 'study',
        requiredGenerations: 10,
        reward: { xpPerGen: 70, xpFlat: 50 },
        cost: 2,
        source: 'starter',
        rarity: 'rare',
        enabled: true,
    },

    // ── Promo cards ───────────────────────────────────────────────────────

    {
        id: 'blog_post',
        title: 'Постить в блог',
        description: 'Отсортируй 5 генераций — выбери худшую',
        tags: ['задача', 'сортировка', 'концепты', 'насмотренность', 'промо'],
        cardType: 'promo',
        miniGenMode: 'sort',
        requiredGenerations: 5,
        reward: { xpPerGen: 15, famePerGen: 1 },
        cost: 1,
        source: 'starter',
        rarity: 'common',
        enabled: true,
    },
    {
        id: 'portfolio_update',
        title: 'Обновить портфолио',
        description: 'Отсортируй 8 работ для портфолио',
        tags: ['сортировка', 'концепты', 'насмотренность', 'промо', 'репутация'],
        cardType: 'promo',
        miniGenMode: 'sort',
        requiredGenerations: 8,
        reward: { xpPerGen: 20, famePerGen: 2, xpFlat: 30 },
        cost: 2,
        source: 'starter',
        rarity: 'rare',
        enabled: true,
    },

    // ── Utility cards ─────────────────────────────────────────────────────

    {
        id: 'find_tasks',
        title: 'Поиск задач',
        description: 'Вытяни ещё 2 карты из колоды',
        tags: ['планирование'],
        cardType: 'utility',
        miniGenMode: null,
        requiredGenerations: 0,
        reward: {},
        cost: 1,
        source: 'starter',
        rarity: 'common',
        enabled: true,
        effect: 'draw_2',   // special effect handled in planning.js
    },

    // ── Rush / deadline cards ─────────────────────────────────────────────

    {
        id: 'rush_logo',
        title: 'Срочный логотип',
        description: 'Срочный заказ — 5 генераций, двойная оплата',
        tags: ['задача', 'генерации', 'контракт', 'дедлайн', 'реализация'],
        cardType: 'task',
        miniGenMode: 'standard',
        requiredGenerations: 5,
        reward: { moneyPerGen: 100, xpPerGen: 8 },
        cost: 2,
        source: 'client',
        rarity: 'rare',
        enabled: true,
    },

    // ── Modifier cards ────────────────────────────────────────────────────

    {
        id: 'focus_boost',
        title: 'Состояние потока',
        description: '+20% к награде след. задачи',
        tags: ['модификатор', 'концентрация'],
        cardType: 'utility',
        miniGenMode: null,
        requiredGenerations: 0,
        reward: {},
        cost: 1,
        source: 'starter',
        rarity: 'rare',
        enabled: true,
        effect: 'next_card_reward_plus20',
    },
];

/** Map from id → definition for O(1) lookup */
export const CARD_MAP = Object.fromEntries(CARD_DEFINITIONS.map(c => [c.id, c]));

/** Returns the default starter deck as array of card ids */
export function getStarterDeckIds() {
    return CARD_DEFINITIONS
        .filter(c => c.source === 'starter')
        .map(c => c.id);
}

// ── DEBUG card — always injected into hand at planning, not in deck ──────
export const DEBUG_RHYTHM_CARD = {
    id: 'debug_rhythm_test',
    title: '🐛 Тест ритм игры',
    description: '3 раунда стандартного минигена. Для отладки тайминга.',
    tags: ['дебаг'],
    cardType: 'task',
    miniGenMode: 'standard',
    requiredGenerations: 100,
    reward: { moneyPerGen: 1, xpPerGen: 0 },
    cost: 0,
    source: 'debug',
    rarity: 'common',
    enabled: true,
};
