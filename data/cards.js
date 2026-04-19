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
        icon:  '📋',
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
        icon:  '🎨',
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
        icon:  '🎬',
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
    {
        id: 'social_media_pack',
        title: 'Посты для соцсетей',
        icon:  '📱',
        description: 'Выполни 35 генераций для соцсетей',
        tags: ['задача', 'генерации', 'фриланс', 'концепты', 'промо'],
        cardType: 'task',
        miniGenMode: 'standard',
        requiredGenerations: 35,
        reward: { moneyPerGen: 12, xpPerGen: 3 },
        cost: 1,
        source: 'starter',
        rarity: 'common',
        enabled: true,
    },
    {
        id: 'ui_mockup',
        title: 'UI-мокапы',
        icon:  '🖥️',
        description: 'Выполни 20 генераций интерфейсов',
        tags: ['задача', 'генерации', 'фриланс', 'реализация'],
        cardType: 'task',
        miniGenMode: 'standard',
        requiredGenerations: 20,
        reward: { moneyPerGen: 18, xpPerGen: 6 },
        cost: 1,
        source: 'starter',
        rarity: 'common',
        enabled: true,
    },

    // ── Research cards ────────────────────────────────────────────────────

    {
        id: 'prompt_research',
        title: 'Ресёрч промтов',
        icon:  '🔍',
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
        icon:  '🔬',
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
        icon:  '✍️',
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
        icon:  '🗂️',
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
        icon:  '🃏',
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
        icon:  '⚡',
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
        icon:  '🎯',
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

/** Returns the default starter deck as array of card ids (with duplicates for multi-copy cards) */
export function getStarterDeckIds() {
    // Gen tasks: ~70% of hand (14/20)
    return [
        'contract_work', 'contract_work', 'contract_work', 'contract_work',
        'moodboard',      'moodboard',     'moodboard',
        'storyboard',     'storyboard',    'storyboard',
        'social_media_pack', 'social_media_pack',
        'ui_mockup',         'ui_mockup',
        // Non-gen: ~30%
        'prompt_research',
        'deep_research',
        'blog_post',
        'find_tasks',
        'focus_boost',
        'focus_boost',
    ];
}
