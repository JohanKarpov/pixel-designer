// data/orders.js — Loaded as a plain <script> tag before main.js module.
// Populates window.ORDER_TEMPLATES used by config.js → getOrderTemplates().

window.ORDER_TEMPLATES = [
  // ── luck ────────────────────────────────────────────────────
  { title: 'Логотип для стартапа',          'task-type': 'luck',     payout: [80,  220], durationSec: [8, 20],  generations: [1, 2] },
  { title: 'Баннер для соцсети',            'task-type': 'luck',     payout: [60,  160], durationSec: [6, 15],  generations: [1, 2] },
  { title: 'Иконка для мобильного приложения', 'task-type': 'luck',  payout: [70,  180], durationSec: [7, 18],  generations: [1, 3] },
  { title: 'Обложка для подкаста',          'task-type': 'luck',     payout: [50,  130], durationSec: [5, 12],  generations: [1, 2] },
  { title: 'Аватар для Telegram-канала',    'task-type': 'luck',     payout: [40,  100], durationSec: [4, 10],  generations: [1, 2] },
  { title: 'Стикер-пак (один стикер)',      'task-type': 'luck',     payout: [30,   80], durationSec: [3,  8],  generations: [1, 2] },
  { title: 'Превью для YouTube',            'task-type': 'luck',     payout: [55,  140], durationSec: [5, 14],  generations: [1, 2] },
  { title: 'Визитка (простая)',             'task-type': 'luck',     payout: [45,  110], durationSec: [4, 12],  generations: [1, 2] },
  { title: 'Логотип для Discord-сервера',   'task-type': 'luck',     payout: [60,  150], durationSec: [6, 15],  generations: [1, 2] },
  { title: 'Обложка для альбома',           'task-type': 'luck',     payout: [90,  250], durationSec: [9, 22],  generations: [2, 3] },

  // ── social ──────────────────────────────────────────────────
  { title: 'Пост для Instagram (карточка)', 'task-type': 'social',   payout: [55,  140], durationSec: [5, 13],  generations: [1, 2] },
  { title: 'Stories-шаблон × 3',           'task-type': 'social',   payout: [100, 260], durationSec: [10, 25], generations: [2, 4] },
  { title: 'Баннер для VK-группы',          'task-type': 'social',   payout: [60,  160], durationSec: [6, 16],  generations: [1, 3] },
  { title: 'Шапка профиля Twitter/X',       'task-type': 'social',   payout: [50,  130], durationSec: [5, 12],  generations: [1, 2] },
  { title: 'Контент-план визуал (1 пост)',  'task-type': 'social',   payout: [70,  180], durationSec: [7, 18],  generations: [1, 3] },

  // ── print ───────────────────────────────────────────────────
  { title: 'Флаер для кофейни',             'task-type': 'print',    payout: [90,  230], durationSec: [9, 22],  generations: [2, 3] },
  { title: 'Меню (одна страница)',          'task-type': 'print',    payout: [130, 320], durationSec: [12, 28], generations: [2, 4] },
  { title: 'Плакат для мероприятия',        'task-type': 'print',    payout: [110, 280], durationSec: [11, 26], generations: [2, 4] },
  { title: 'Открытка (поздравительная)',    'task-type': 'print',    payout: [60,  150], durationSec: [6, 15],  generations: [1, 2] },
  { title: 'Упаковка (этикетка)',           'task-type': 'print',    payout: [150, 380], durationSec: [14, 32], generations: [3, 5] },

  // ── web ─────────────────────────────────────────────────────
  { title: 'Макет лендинга (1 секция)',     'task-type': 'web',      payout: [160, 400], durationSec: [15, 35], generations: [3, 5] },
  { title: 'Иконки для сайта (набор 6)',    'task-type': 'web',      payout: [120, 300], durationSec: [11, 26], generations: [2, 4] },
  { title: 'Баннер для сайта (Hero)',       'task-type': 'web',      payout: [100, 250], durationSec: [9, 22],  generations: [2, 3] },
  { title: 'UI-кит (базовый)',              'task-type': 'web',      payout: [200, 500], durationSec: [18, 40], generations: [4, 6] },

  // ── illustration ────────────────────────────────────────────
  { title: 'Персонаж для игры (концепт)',   'task-type': 'illustration', payout: [180, 450], durationSec: [16, 36], generations: [3, 5] },
  { title: 'Иллюстрация для статьи',       'task-type': 'illustration', payout: [120, 300], durationSec: [11, 26], generations: [2, 4] },
  { title: 'Детская иллюстрация',           'task-type': 'illustration', payout: [140, 360], durationSec: [13, 30], generations: [2, 4] },
  { title: 'Арт для настольной игры',      'task-type': 'illustration', payout: [200, 520], durationSec: [18, 42], generations: [4, 6] },

  // ── срочные ─────────────────────────────────────────────────
  { title: 'Срочно: логотип к презентации', 'task-type': 'luck',     payout: [200, 450], durationSec: [6, 14],  generations: [1, 2] },
  { title: 'Срочно: баннер для рекламы',   'task-type': 'social',   payout: [180, 400], durationSec: [5, 12],  generations: [1, 2] },
];
