import { loadState, state }         from './src/core/state.js';
import { Config }                   from './src/core/config.js';
import {
    calcOfflineOnStartup,
    restorePhaseFromState,
    setDayCycleCallbacks,
    getCurrentPhase,
    startDay,
} from './src/day/day-cycle.js';
import {
    startHeadhunterTicker,
    startLifetimeTicker,
    startZenTicker,
    startAgentTicker,
    startAutogenTicker,
    stopAllTickers,
    setEconomyCallbacks,
} from './src/core/economy.js';
import { onEnterPlanning }                      from './src/screens/planning.js';
import { onEnterWork, onLeaveWork, onOrdersChanged, onStateChanged } from './src/screens/work.js';
import { onEnterResults }           from './src/screens/results.js';
import { onEnterRest, onLeaveRest }  from './src/screens/rest.js';
import { onEnterUpgrades }           from './src/screens/upgrades.js';
import { bindHelpButtons }           from './src/ui/help.js';
import { playBgm, stopBgm, setBgmVolume, getBgmVolume } from './src/core/bgm.js';
import { setRhythmVolume }           from './src/core/rhythm.js';
import { preloadAssets }            from './src/core/preload.js';

// ── Service Worker ────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── Scaling: set --r and --vh on :root ──────────────────────────────────────
// --r  : 1/390 of capped viewport width (max 430px — widest common phone)
// --vh : 1/100 of real visible height (tg.viewportHeight > visualViewport > innerHeight)
function _setScaleRoot() {
    const tg = window.Telegram?.WebApp;
    const w  = Math.min(window.innerWidth, 430);
    const h  = tg?.viewportHeight || window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--r',  `${w / 390}px`);
    document.documentElement.style.setProperty('--vh', `${h / 100}px`);
}
_setScaleRoot();
window.addEventListener('resize', _setScaleRoot);
window.visualViewport?.addEventListener('resize', _setScaleRoot);

// ── Block pinch-zoom and Safari gesture zoom ─────────────────────────────
// (viewport meta user-scalable=no is ignored in some iOS versions)
document.addEventListener('touchstart', e => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
document.addEventListener('touchmove', e => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
// Safari-specific gesture events
document.addEventListener('gesturestart',  e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('gestureend',    e => e.preventDefault());

// ── Telegram WebApp setup ────────────────────────────────────────────────────
if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.expand();
    window.Telegram.WebApp.onEvent('viewportChanged', _setScaleRoot);
}

// ── Screen routing ──────────────────────────────────────────────────────────
// Each phase maps to a [data-screen="<phase>"] element in index.html.
// body[data-phase] lets CSS scope phase-specific styles simply.

export function showScreen(name) {
    document.querySelectorAll('[data-screen]').forEach(el => {
        el.classList.toggle('screen--active', el.dataset.screen === name);
    });
    document.body.dataset.phase = name;
}

// Handle navigation requests dispatched by sub-screens (avoids circular imports)
document.addEventListener('rest:navigate', e => {
    const target = e.detail.screen;
    showScreen(target);
    if (target === 'upgrades') onEnterUpgrades();
});

// ── Phase change handler ────────────────────────────────────────────────────

let _prevPhase = null;

function _onPhaseChange(phase, payload) {
    stopAllTickers();

    // Leave hooks
    if (_prevPhase === 'work') onLeaveWork();
    if (_prevPhase === 'rest') onLeaveRest();

    if (phase === 'work') {
        startHeadhunterTicker();
        startLifetimeTicker();
        startZenTicker();
        startAgentTicker();
        startAutogenTicker();
    } else if (phase === 'rest' || phase === 'results') {
        startZenTicker();
        startAgentTicker();
    }

    showScreen(phase);
    // Only change BGM when transitioning to/from work screen.
    // Between non-work screens, the current track keeps playing.
    if (phase === 'work' || _prevPhase === 'work') playBgm(phase);
    _prevPhase = phase;

    // Enter hooks
    if (phase === 'planning') onEnterPlanning();
    else if (phase === 'work')    onEnterWork();
    else if (phase === 'results') onEnterResults(payload);
    else if (phase === 'rest')    onEnterRest();
}

// ── Init ────────────────────────────────────────────────────────────────────

// Version check: if stored version ≠ current, wipe SW caches and reload once
// so the browser fetches all fresh assets (SW activate will also clean up).
// Game save data (localStorage SAVE_KEY) is deliberately NOT wiped.
;(function _checkVersion() {
    const storedVer = localStorage.getItem(Config.BUILD_VERSION_KEY);
    if (storedVer === Config.BUILD_VERSION) return; // up to date
    localStorage.setItem(Config.BUILD_VERSION_KEY, Config.BUILD_VERSION);
    if ('caches' in window) {
        caches.keys()
            .then(keys => Promise.all(keys.map(k => caches.delete(k))))
            .then(() => location.reload());
        return; // don't continue init — page will reload
    }
})();

loadState();
setDayCycleCallbacks({
    onPhaseChange: _onPhaseChange,
    onOfflineResult: ({ earnedFunds, hoursElapsed }) => {
        const banner = document.getElementById('offline-banner');
        const text   = document.getElementById('offline-banner-text');
        const close  = document.getElementById('offline-banner-close');
        if (!banner) return;
        text.textContent = `Агент работал ${hoursElapsed.toFixed(1)}ч и заработал ${Math.round(earnedFunds)} ₽`;
        banner.classList.add('visible');
        close.onclick = () => banner.classList.remove('visible');
    },
    onDayResults: (stats) => {
        // stats are passed through _onPhaseChange payload when transitioning to RESULTS
    },
});
setEconomyCallbacks({
    onOrdersChanged: () => { if (_prevPhase === 'work') onOrdersChanged(); },
    onStateChanged:  () => { if (_prevPhase === 'work') onStateChanged();  },
});
calcOfflineOnStartup();

// ── Preload all images, then reveal game ───────────────────────────────
const _loadingBar = document.getElementById('loading-bar');
const _loadingPct = document.getElementById('loading-pct');
await preloadAssets(p => {
    const pct = Math.round(p * 100);
    if (_loadingBar) _loadingBar.style.width = `${pct}%`;
    if (_loadingPct) _loadingPct.textContent = `${pct}%`;
});
const _loadingScreen = document.getElementById('loading-screen');
if (_loadingScreen) {
    _loadingScreen.classList.add('loading-screen--done');
    _loadingScreen.addEventListener('transitionend', () => _loadingScreen.remove(), { once: true });
}

restorePhaseFromState();

// Wire tickers for the restored phase (onPhaseChange not called for restored phases)
const _phase = getCurrentPhase();
if (_phase === 'rest' || _phase === 'results') {
    startZenTicker();
    startAgentTicker();
}

showScreen(_phase);
// Start BGM on initial load (work screen is handled by rhythm.js)
if (_phase !== 'work') playBgm(_phase);

// Enter hook for restored phase
if (_phase === 'planning')      onEnterPlanning();
else if (_phase === 'work')     onEnterWork();
else if (_phase === 'results')  onEnterResults(state.dailyStats);
else if (_phase === 'rest')     onEnterRest();

bindHelpButtons();

// ── Volume control ──────────────────────────────────────────────────────────

(function _initVolumeUI() {
    const panel  = document.getElementById('vol-panel');
    const slider = document.getElementById('vol-slider');
    const pct    = document.getElementById('vol-pct');
    if (!panel || !slider) return;

    // Init slider from persisted volume
    const init = Math.round(getBgmVolume() * 100);
    slider.value = init;
    pct.textContent = `${init}%`;

    // All vol-btn clicks toggle the panel
    document.addEventListener('click', e => {
        if (e.target.closest('.vol-btn')) {
            const isOpen = !panel.hidden;
            if (isOpen) {
                panel.hidden = true;
                panel.classList.remove('vol-panel--open');
            } else {
                panel.hidden = false;
                panel.classList.add('vol-panel--open');
            }
            return;
        }
        // Clicks outside the panel close it
        if (!panel.hidden && !e.target.closest('.vol-panel__inner')) {
            panel.hidden = true;
            panel.classList.remove('vol-panel--open');
        }
    });

    const _updateVolIcon = (v) => {
        document.querySelectorAll('.vol-btn').forEach(btn => {
            btn.textContent = v === 0 ? '🔇' : '🔊';
        });
    };
    _updateVolIcon(init);

    slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10);
        pct.textContent = `${v}%`;
        setBgmVolume(v / 100);
        setRhythmVolume(v / 100);
        _updateVolIcon(v);
    });
})();

// Expose day-cycle for console testing
import('./src/day/day-cycle.js').then(dc => { window.__dc = dc; });
