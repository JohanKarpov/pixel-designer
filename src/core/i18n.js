// src/i18n.js — ES module wrapper over window.GAME_STRINGS

import { state } from './state.js';

/**
 * Look up a localised string by dot-separated key.
 * Key format: 'section.subkey' or 'section.subkey.property'
 *
 * window.GAME_STRINGS is populated by the root localization.js <script> tag
 * which must load before this module executes.
 */
export function t(key, lang) {
    const l = lang || state.language || 'ru';
    const strings = window.GAME_STRINGS;
    if (!strings) return key;

    const parts = key.split('.');
    let node = strings;
    for (const p of parts) {
        if (node == null || typeof node !== 'object') return key;
        node = node[p];
    }

    if (typeof node === 'string') return node;

    if (node && typeof node === 'object') {
        if (node[l]) return node[l];
        if (node.ru) return node.ru;
        if (node.en) return node.en;
    }

    return key;
}

export function getLang() {
    return state.language || 'ru';
}

export function setLang(lang) {
    state.language = lang;
    try {
        localStorage.setItem('mid_designer_lang', lang);
    } catch (_) {}
}