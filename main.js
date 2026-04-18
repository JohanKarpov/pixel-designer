import { loadState, state }         from './src/core/state.js';
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
import { playBgm, stopBgm, setBgmVolume, getBgmVolume } from './src/core/bgm.js';

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
document.addEventListener('rest:navigate', e => showScreen(e.detail.screen));

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
    playBgm(phase);
    _prevPhase = phase;

    // Enter hooks
    if (phase === 'planning') onEnterPlanning();
    else if (phase === 'work')    onEnterWork();
    else if (phase === 'results') onEnterResults(payload);
    else if (phase === 'rest')    onEnterRest();
}

// ── Init ────────────────────────────────────────────────────────────────────

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
restorePhaseFromState();

// Wire tickers for the restored phase (onPhaseChange not called for restored phases)
const _phase = getCurrentPhase();
if (_phase === 'rest' || _phase === 'results') {
    startZenTicker();
    startAgentTicker();
}

showScreen(_phase);

// Enter hook for restored phase
if (_phase === 'planning')      onEnterPlanning();
else if (_phase === 'work')     onEnterWork();
else if (_phase === 'results')  onEnterResults(state.dailyStats);
else if (_phase === 'rest')     onEnterRest();

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

    slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10);
        pct.textContent = `${v}%`;
        setBgmVolume(v / 100);
    });
})();

// Expose day-cycle for console testing
import('./src/day/day-cycle.js').then(dc => { window.__dc = dc; });
