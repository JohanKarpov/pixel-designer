// src/screens/upgrades.js — Skills/Upgrades placeholder screen

import { showScreen } from '../../main.js';

export function onEnterUpgrades() {
    const btn = document.getElementById('upgrades-back-btn');
    if (btn) btn.onclick = () => showScreen('rest');
}
