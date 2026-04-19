// src/minigen.js — Mini-game popup for generate button
// Shows 3 quality variants of an image; player picks the best quality (lowest n = best).
// Returns: 'correct' | 'partial' | 'wrong' | 'skip'

import { state, saveState } from './state.js';
import { checkBeatHit, getRhythmCombo } from './rhythm.js';

// Labels that trigger the mini-game
const TRIGGER_LABELS = new Set(['Работать', 'Создавать', 'Публиковать', 'Генерировать']);
const RESULT_EMOJI   = { correct: '✅', partial: '⚠️', wrong: '❌' };

// Beat quality of the last inline cell pick — read by work.js after runMinigen resolves
let _lastBeatQuality = 'off';
export function getLastBeatQuality() { return _lastBeatQuality; }

const MANIFEST_URL = 'data/minigen-game/manifest.json';
let _manifest = null;

async function _loadManifest() {
    if (_manifest) return _manifest;
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) throw new Error(`[minigen] manifest fetch error: ${res.status}`);
    _manifest = await res.json();
    return _manifest;
}

function _pickGroup(manifest, allowedTags) {
    let g = manifest.groups;
    if (allowedTags && allowedTags.length) {
        const tagSet = new Set(allowedTags);
        const filtered = g.filter(gr => tagSet.has(gr.tag));
        if (filtered.length) g = filtered;
    }
    return g[Math.floor(Math.random() * g.length)];
}

/** Pick up to `n` distinct groups (falls back to repeating if pool is too small). */
function _pickDistinctGroups(manifest, allowedTags, n) {
    let pool = manifest.groups;
    if (allowedTags && allowedTags.length) {
        const tagSet = new Set(allowedTags);
        const filtered = pool.filter(gr => tagSet.has(gr.tag));
        if (filtered.length) pool = filtered;
    }
    const shuffled = _shuffle([...pool]);
    const result = [];
    for (let i = 0; i < n; i++) result.push(shuffled[i % shuffled.length]);
    return result;
}

function _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ─────────────────────────────────────────────────────────────
// Combo-driven cell entrance animation
// intensity 0 = combo ≤ 4 (no effect), 1 = combo ≥ 10 (full chaos)
// ─────────────────────────────────────────────────────────────

function _applyComboCellEntrance(cells) {
    const combo     = getRhythmCombo();
    const intensity = Math.min(1, Math.max(0, (combo - 4) / 6)); // 0..1
    if (intensity <= 0) return;

    // 120 BPM → beat = 500ms → 2 shakes per beat → period = 250ms
    const shakeAmp = Math.round(intensity * 7); // px, 0..7

    cells.forEach((cell, i) => {
        // Random "throw" direction per card — seeded by index for variety
        const angle  = (Math.random() - 0.5) * intensity * 22;   // ±0..11 deg
        const dx     = (Math.random() - 0.5) * intensity * 38;   // ±0..19 px
        const dy     = (Math.random() - 0.5) * intensity * 28;   // ±0..14 px

        // Start displaced + rotated, then spring back to identity
        cell.style.transform  = `translate(${dx}px, ${dy}px) rotate(${angle}deg) scale(0.82)`;
        cell.style.transition = 'none';
        cell.style.opacity    = '0';

        // Tiny stagger so cards don't all land at the exact same frame
        const delay = i * Math.round(intensity * 30);

        requestAnimationFrame(() => {
            setTimeout(() => {
                cell.style.transition =
                    `transform 260ms cubic-bezier(0.18, 1.4, 0.4, 1), opacity 100ms ease`;
                cell.style.transform = '';
                cell.style.opacity   = '';

                // Once landed, start shake if intensity high enough
                if (shakeAmp > 0) {
                    cell.style.setProperty('--shake-amp', shakeAmp + 'px');
                    cell.classList.add('minigen-cell--combo-shake');
                }
            }, delay);
        });
    });
}

// ─────────────────────────────────────────────────────────────
// Emoji result particle (floats up above the chosen image)
// Pre-computed coords prevent forced-reflow mid-transition.
// ─────────────────────────────────────────────────────────────

/** @param {{ x: number, y: number, r: number }} coords */
function _spawnEmojiParticleAt(container, coords, emoji) {
    const { x: spawnX, y: spawnY, r } = coords;
    const floatDist = r * 130;

    const div = document.createElement('div');
    div.textContent = emoji;
    div.setAttribute('aria-hidden', 'true');
    div.style.cssText =
        `position:absolute;pointer-events:none;z-index:9850;` +
        `font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',emoji,sans-serif;` +
        `font-size:${(r * 96).toFixed(1)}px;line-height:1;` +
        `left:${spawnX.toFixed(1)}px;top:${spawnY.toFixed(1)}px;` +
        `transform:translateX(-50%) scale(0.3);opacity:0;`;
    container.appendChild(div);

    const T_POP = 180, T_HOLD = 350, T_FADE = 220;
    const T_TOTAL = T_POP + T_HOLD + T_FADE;
    const t0 = performance.now();

    const tick = (now) => {
        const e   = now - t0;
        const fp  = Math.min(1, e / T_TOTAL);
        const dy  = floatDist * (1 - Math.pow(1 - fp, 2.5));
        let sc, op;

        if (e < T_POP) {
            const p = e / T_POP;
            sc = 0.3 + (1.25 - 0.3) * (1 - Math.pow(1 - p, 2));
            op = p;
        } else if (e < T_POP + T_HOLD) {
            sc = 1.0; op = 1;
        } else if (e < T_TOTAL) {
            const p = (e - T_POP - T_HOLD) / T_FADE;
            sc = 1 + 0.1 * p; op = 1 - p;
        } else {
            div.remove();
            return;
        }

        div.style.opacity   = op.toFixed(3);
        div.style.transform = `translateX(-50%) scale(${sc.toFixed(3)})`;
        div.style.top       = (spawnY - dy).toFixed(1) + 'px';
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

// ─────────────────────────────────────────────────────────────
// First-time tutorial dialog (vn-style, chat-theme)
// ─────────────────────────────────────────────────────────────

const TUTORIAL_LINES = [
    'На всякий случай напомню — я дам тебе несколько вариантов генерации на выбор. Твоя задача — выбрать лучший результат!',
    'Если сейчас не до выбора — можешь пропустить, но придётся генерировать заново.',
];

function _waitForTutorial(container) {
    return new Promise(resolve => {
        let lineIdx = 0;

        const tut = document.createElement('div');
        tut.className = 'minigen-tutorial-overlay';
        tut.innerHTML =
            `<div class="minigen-tutorial-dialog">` +
            `<div class="minigen-tutorial-speaker-row">` +
            `<img class="minigen-tutorial-speaker-icon" src="images/cinematic/chatdjbt-icon.png" alt="">` +
            `<span class="minigen-tutorial-speaker-name">ChatDJBT</span>` +
            `</div>` +
            `<p class="minigen-tutorial-text"></p>` +
            `<div class="vn-actions">` +
            `<button class="dialog-next-btn minigen-tutorial-next" type="button">▶</button>` +
            `</div>` +
            `</div>`;
        container.appendChild(tut);

        const textEl  = tut.querySelector('.minigen-tutorial-text');
        const nextBtn = tut.querySelector('.minigen-tutorial-next');

        textEl.textContent = TUTORIAL_LINES[0];
        requestAnimationFrame(() => tut.classList.add('minigen-tutorial-overlay--visible'));

        nextBtn.addEventListener('click', () => {
            lineIdx++;
            if (lineIdx < TUTORIAL_LINES.length) {
                textEl.textContent = TUTORIAL_LINES[lineIdx];
            } else {
                tut.classList.remove('minigen-tutorial-overlay--visible');
                tut.addEventListener('transitionend', () => { tut.remove(); resolve(); }, { once: true });
            }
        });
    });
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Returns true if the given generateActionLabel should trigger the mini-game.
 */
export function shouldShowMiniGen(label) {
    return TRIGGER_LABELS.has(label);
}

/**
 * Shows the image quality mini-game popup.
 * @param {object} [options]
 * @param {string[]} [options.allowedTags]   If set, only groups with these tags are used.
 * @param {number}   [options.autoSelectMs]  If > 0, auto-picks the correct cell after this many ms (autogen mode).
 * Resolves to 'correct' | 'partial' | 'wrong' | 'skip'.
 */
export async function showMiniGenPopup({ allowedTags, autoSelectMs = 0, mode = 'standard', inlineContainer = null } = {}) {
    let manifest;
    try {
        manifest = await _loadManifest();
    } catch (e) {
        console.warn('[minigen] Could not load manifest, skipping:', e.message);
        return 'skip';
    }

    if (!manifest?.groups?.length) return 'skip';

    // Delegate to mode-specific handlers
    if (mode === 'study') return _showStudyPopup(manifest);
    if (mode === 'sort')  return _showSortPopup(manifest, allowedTags);
    if (inlineContainer)  return _showInlinePopup(manifest, { allowedTags, inlineContainer, autoSelectMs });

    const container = document.querySelector('.game-container') || document.body;

    // Skip tutorial in autogen mode (no human present)
    if (!autoSelectMs && !state.miniGenTutorialSeen) {
        state.miniGenTutorialSeen = true;
        saveState();
        await _waitForTutorial(container);
    }

    const group    = _pickGroup(manifest, allowedTags);
    const count    = Math.min(group.variants || 3, 3);
    const variants = _shuffle(Array.from({ length: count }, (_, i) => i + 1));
    const basePath = `data/minigen-game/minigen-${group.tag}-`;

    // ai_vis: highlight a cell with accuracy chance per tier (0.50 / 0.60 / 0.70 / 0.90 / 0.95)
    const _visTier     = state.skillTree?.tiers?.ai_vis || 0;
    const _visAccuracy = [0, 0.50, 0.60, 0.70, 0.90, 0.95][Math.min(_visTier, 5)];
    const _visActive   = _visTier >= 1;

    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'minigen-overlay';

        const cellsHtml = variants.map(n =>
            `<div class="minigen-cell" data-variant="${n}">` +
            `<img class="minigen-img" src="${basePath}${n}.png" alt="" draggable="false">` +
            `</div>`
        ).join('');

        // Auto-bar shown only in autogen mode
        const autoBarHtml = autoSelectMs > 0
            ? `<div class="minigen-auto-bar-wrap"><div class="minigen-auto-bar"></div></div>`
            : '';

        overlay.innerHTML =
            `<div class="minigen-popup">` +
            `<div class="minigen-prompt"><span class="minigen-prompt-text">Выбери генерацию</span></div>` +
            autoBarHtml +
            `<div class="minigen-images">${cellsHtml}</div>` +
            `<button class="minigen-skip-btn" type="button">Пропустить</button>` +
            `</div>`;

        container.appendChild(overlay);

        // Highlight a cell based on ai_vis accuracy roll
        if (_visActive) {
            const accuracyHit    = Math.random() < _visAccuracy;
            const highlightVariant = accuracyHit
                ? 1
                : variants.filter(n => n !== 1)[Math.floor(Math.random() * (variants.length - 1))];
            const highlightCell  = overlay.querySelector(`.minigen-cell[data-variant="${highlightVariant}"]`);
            if (highlightCell) highlightCell.classList.add('minigen-cell--correct');
        }

        requestAnimationFrame(() => {
            overlay.classList.add('minigen-overlay--visible');
            _applyComboCellEntrance(Array.from(overlay.querySelectorAll('.minigen-cell')));
        });

        // Declared before `finish` so they can be referenced inside it
        let _autoTimer = null;
        let _autoRaf   = null;

        function finish(result, chosenCellEl, spawnCoords) {
            // Cancel any pending auto-timer
            if (_autoTimer) clearTimeout(_autoTimer);
            if (_autoRaf)   cancelAnimationFrame(_autoRaf);

            // Disable all interactions immediately
            overlay.querySelectorAll('.minigen-cell').forEach(c => { c.style.pointerEvents = 'none'; });
            overlay.querySelector('.minigen-skip-btn').style.pointerEvents = 'none';

            if (chosenCellEl) {
                // Fade out non-chosen cells
                overlay.querySelectorAll('.minigen-cell').forEach(c => {
                    if (c !== chosenCellEl) c.classList.add('minigen-cell--hidden');
                });
                // Brief press effect then collapse
                chosenCellEl.classList.add('minigen-cell--pressed');
                setTimeout(() => {
                    chosenCellEl.classList.remove('minigen-cell--pressed');
                    chosenCellEl.classList.add('minigen-cell--collapsing');
                    if (spawnCoords) {
                        _spawnEmojiParticleAt(container, spawnCoords, RESULT_EMOJI[result]);
                    }
                }, 35);
                // Fade overlay — resolve immediately so button re-enables fast
                setTimeout(() => {
                    overlay.classList.remove('minigen-overlay--visible');
                    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
                    resolve(result);
                }, 150);
            } else {
                // Skip — just fade out immediately
                overlay.classList.remove('minigen-overlay--visible');
                overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
                resolve(result);
            }
        }

        overlay.querySelectorAll('.minigen-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                checkBeatHit(); // weak beat — score the minigen pick
                const v = parseInt(cell.dataset.variant, 10);
                let result;
                if (v === 1)          result = 'correct';
                else if (v === count) result = 'wrong';
                else                  result = 'partial';

                // Pre-capture spawn position BEFORE any DOM changes (prevents
                // getBoundingClientRect forcing a reflow mid-transition).
                let spawnCoords = null;
                if (result !== 'skip' && RESULT_EMOJI[result]) {
                    const ctxRect  = container.getBoundingClientRect();
                    const cellRect = cell.getBoundingClientRect();
                    spawnCoords = {
                        x: (cellRect.left - ctxRect.left) + cellRect.width  * 0.5,
                        y: (cellRect.top  - ctxRect.top)  + cellRect.height * 0.45,
                        r: ctxRect.width / 1080,
                    };
                }

                finish(result, cell, spawnCoords);
                // Track manual correct pick on 'tema' group for achievement
                if (result === 'correct' && group.tag === 'tema') {
                    state.stats.temaCorrectPicks = (state.stats.temaCorrectPicks || 0) + 1;
                }
            });
        });

        overlay.querySelector('.minigen-skip-btn').addEventListener('click', () => {
            finish('skip', null, null);
        });

        // ── Autogen auto-timer ──────────────────────────────────
        if (autoSelectMs > 0) {
            // Animate the countdown bar
            const bar = overlay.querySelector('.minigen-auto-bar');
            if (bar) {
                const t0 = performance.now();
                const tick = (now) => {
                    const progress = Math.max(0, 1 - (now - t0) / autoSelectMs);
                    bar.style.transform = `scaleX(${progress.toFixed(4)})`;
                    if (progress > 0) _autoRaf = requestAnimationFrame(tick);
                };
                _autoRaf = requestAnimationFrame(tick);
            }

            // Auto-pick the ai_vis-highlighted cell, or a random cell if none is highlighted
            _autoTimer = setTimeout(() => {
                _autoTimer = null;
                // Prefer the cell highlighted by ai_vis (minigen-cell--correct);
                // fall back to a random cell when ai_vis is inactive.
                let targetCell = overlay.querySelector('.minigen-cell--correct');
                if (!targetCell) {
                    const allCells = Array.from(overlay.querySelectorAll('.minigen-cell'));
                    targetCell = allCells.length
                        ? allCells[Math.floor(Math.random() * allCells.length)]
                        : null;
                }
                if (!targetCell) { finish('skip', null, null); return; }

                const v = parseInt(targetCell.dataset.variant, 10);
                let result;
                if (v === 1)          result = 'correct';
                else if (v === count) result = 'wrong';
                else                  result = 'partial';

                const ctxRect  = container.getBoundingClientRect();
                const cellRect = targetCell.getBoundingClientRect();
                const spawnCoords = {
                    x: (cellRect.left - ctxRect.left) + cellRect.width  * 0.5,
                    y: (cellRect.top  - ctxRect.top)  + cellRect.height * 0.45,
                    r: ctxRect.width / 1080,
                };
                finish(result, targetCell, spawnCoords);
            }, autoSelectMs);
        }
    });
}

/**
 * High-level wrapper for work.js generate button.
 * Measures reaction time from popup-open to player pick.
 * @param {object} [options]
 * @param {string[]|null} [options.tags]  Forwarded as allowedTags to showMiniGenPopup.
 * @param {string} [options.mode]         'standard' | 'study' | 'sort'
 * @param {HTMLElement|null} [options.inlineContainer]  If provided, renders cards inline (no overlay).
 * @returns {Promise<{ result: string, reactionMs: number }>}
 */
export async function runMinigen({ tags = null, mode = 'standard', inlineContainer = null } = {}) {
    const t0 = performance.now();
    let result = 'skip';
    try {
        result = await showMiniGenPopup({ allowedTags: tags || undefined, mode, inlineContainer });
    } catch (e) {
        console.warn('[minigen] runMinigen error:', e);
    }
    const reactionMs = performance.now() - t0;
    return { result, reactionMs };
}

// ────────────────────────────────────────────────────────────
// Inline mode — renders cards directly into a zone element (no overlay/backdrop)
// The caller manages zone visibility (work-gen-zone--active class + button hide/show).
// ────────────────────────────────────────────────────────────

async function _showInlinePopup(manifest, { allowedTags, inlineContainer, autoSelectMs = 0 }) {
    const group    = _pickGroup(manifest, allowedTags);
    const count    = Math.min(group.variants || 3, 3);
    const variants = _shuffle(Array.from({ length: count }, (_, i) => i + 1));
    const basePath = `data/minigen-game/minigen-${group.tag}-`;

    const _visTier     = state.skillTree?.tiers?.ai_vis || 0;
    const _visAccuracy = [0, 0.50, 0.60, 0.70, 0.90, 0.95][Math.min(_visTier, 5)];
    const _visActive   = _visTier >= 1;

    // Replace any leftover cells from previous round
    const oldCells = inlineContainer.querySelector('.minigen-images-inline');
    if (oldCells) oldCells.remove();
    // Remove quality feedback from previous round
    inlineContainer.querySelector('.gen-feedback')?.remove();

    const imagesDiv = document.createElement('div');
    imagesDiv.className = 'minigen-images minigen-images-inline';
    imagesDiv.innerHTML = variants.map(n =>
        `<div class="minigen-cell" data-variant="${n}">` +
        `<img class="minigen-img" src="${basePath}${n}.png" alt="" draggable="false">` +
        `</div>`
    ).join('');

    inlineContainer.appendChild(imagesDiv);

    if (_visActive) {
        const accuracyHit      = Math.random() < _visAccuracy;
        const highlightVariant = accuracyHit
            ? 1
            : variants.filter(n => n !== 1)[Math.floor(Math.random() * (variants.length - 1))];
        const highlightCell = inlineContainer.querySelector(`.minigen-cell[data-variant="${highlightVariant}"]`);
        if (highlightCell) highlightCell.classList.add('minigen-cell--correct');
    }

    requestAnimationFrame(() => {
        _applyComboCellEntrance(Array.from(inlineContainer.querySelectorAll('.minigen-cell')));
    });

    // Add beat-pulse class to grid after enter animation completes (200ms)
    setTimeout(() => {
        if (document.contains(imagesDiv)) imagesDiv.classList.add('minigen-images-inline--pulsing');
    }, 200);

    // Emoji particles float up relative to game-container
    const emojiCtx = document.querySelector('.game-container') || document.body;

    return new Promise(resolve => {
        let _autoTimer = null;
        let _autoRaf   = null;

        function finish(result, chosenCellEl, spawnCoords) {
            if (_autoTimer) clearTimeout(_autoTimer);
            if (_autoRaf)   cancelAnimationFrame(_autoRaf);

            imagesDiv.querySelectorAll('.minigen-cell').forEach(c => { c.style.pointerEvents = 'none'; });

            if (chosenCellEl) {
                imagesDiv.querySelectorAll('.minigen-cell').forEach(c => {
                    if (c !== chosenCellEl) c.classList.add('minigen-cell--hidden');
                });
                chosenCellEl.classList.add('minigen-cell--pressed');
                setTimeout(() => {
                    chosenCellEl.classList.remove('minigen-cell--pressed');
                    chosenCellEl.classList.add('minigen-cell--collapsing');
                    // Emoji: fire-and-forget, does NOT block chain
                    if (spawnCoords) _spawnEmojiParticleAt(emojiCtx, spawnCoords, RESULT_EMOJI[result]);
                    // Resolve as soon as collapse transition ends (80ms), with 100ms safety fallback
                    let _resolved = false;
                    const _doResolve = () => {
                        if (_resolved) return;
                        _resolved = true;
                        imagesDiv.remove();
                        resolve(result);
                    };
                    chosenCellEl.addEventListener('transitionend', _doResolve, { once: true });
                    setTimeout(_doResolve, 100);
                }, 35);
            } else {
                imagesDiv.remove();
                resolve(result);
            }
        }

        imagesDiv.querySelectorAll('.minigen-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                _lastBeatQuality = checkBeatHit().quality;
                const v = parseInt(cell.dataset.variant, 10);
                let result;
                if (v === 1)          result = 'correct';
                else if (v === count) result = 'wrong';
                else                  result = 'partial';

                let spawnCoords = null;
                if (RESULT_EMOJI[result]) {
                    const ctxRect  = emojiCtx.getBoundingClientRect();
                    const cellRect = cell.getBoundingClientRect();
                    spawnCoords = {
                        x: (cellRect.left - ctxRect.left) + cellRect.width  * 0.5,
                        y: (cellRect.top  - ctxRect.top)  + cellRect.height * 0.45,
                        r: ctxRect.width / 1080,
                    };
                }

                finish(result, cell, spawnCoords);
                if (result === 'correct' && group.tag === 'tema') {
                    state.stats.temaCorrectPicks = (state.stats.temaCorrectPicks || 0) + 1;
                }
            });
        });

        if (autoSelectMs > 0) {
            _autoTimer = setTimeout(() => {
                _autoTimer = null;
                let targetCell = inlineContainer.querySelector('.minigen-cell--correct');
                if (!targetCell) {
                    const all = Array.from(inlineContainer.querySelectorAll('.minigen-cell'));
                    targetCell = all.length ? all[Math.floor(Math.random() * all.length)] : null;
                }
                if (!targetCell) { finish('skip', null, null); return; }

                const v      = parseInt(targetCell.dataset.variant, 10);
                const result = v === 1 ? 'correct' : v === count ? 'wrong' : 'partial';
                const ctxRect  = emojiCtx.getBoundingClientRect();
                const cellRect = targetCell.getBoundingClientRect();
                finish(result, targetCell, {
                    x: (cellRect.left - ctxRect.left) + cellRect.width  * 0.5,
                    y: (cellRect.top  - ctxRect.top)  + cellRect.height * 0.45,
                    r: ctxRect.width / 1080,
                });
            }, autoSelectMs);
        }
    });
}

// ─────────────────────────────────────────────────────────────
// Study mode — pick the image matching the shown tag
// ─────────────────────────────────────────────────────────────

/**
 * Picks 3 distinct groups, announces the target tag as the prompt.
 * Player must click the image from the target group.
 * Returns 'correct' | 'wrong'.
 */
async function _showStudyPopup(manifest) {
    const container = document.querySelector('.game-container') || document.body;
    const groups    = manifest.groups;
    if (groups.length < 3) return 'skip';

    // Pick 3 distinct groups
    const shuffled = [...groups];
    _shuffle(shuffled);
    const chosen  = shuffled.slice(0, 3);
    const targetIdx = Math.floor(Math.random() * 3);   // which of the 3 is the target
    const target  = chosen[targetIdx];

    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'minigen-overlay';

        const cellsHtml = chosen.map((g, i) =>
            `<div class="minigen-cell minigen-cell--study" data-group-idx="${i}">` +
            `<img class="minigen-img" src="data/minigen-game/minigen-${g.tag}-1.png" alt="" draggable="false">` +
            `</div>`
        ).join('');

        overlay.innerHTML =
            `<div class="minigen-popup minigen-popup--study">` +
            `<div class="minigen-prompt">` +
            `<span class="minigen-prompt-label">Найди:</span>` +
            `<span class="minigen-prompt-text minigen-prompt-tag">${target.tag}</span>` +
            `</div>` +
            `<div class="minigen-images">${cellsHtml}</div>` +
            `<button class="minigen-skip-btn" type="button">Пропустить</button>` +
            `</div>`;

        container.appendChild(overlay);
        requestAnimationFrame(() => {
            overlay.classList.add('minigen-overlay--visible');
            _applyComboCellEntrance(Array.from(overlay.querySelectorAll('.minigen-cell')));
        });

        function finish(result, chosenCellEl) {
            overlay.querySelectorAll('.minigen-cell').forEach(c => { c.style.pointerEvents = 'none'; });
            if (chosenCellEl) {
                overlay.querySelectorAll('.minigen-cell').forEach(c => {
                    if (c !== chosenCellEl) c.classList.add('minigen-cell--hidden');
                });
                chosenCellEl.classList.add('minigen-cell--pressed');
                const ctxRect  = container.getBoundingClientRect();
                const cellRect = chosenCellEl.getBoundingClientRect();
                const spawnCoords = {
                    x: (cellRect.left - ctxRect.left) + cellRect.width  * 0.5,
                    y: (cellRect.top  - ctxRect.top)  + cellRect.height * 0.45,
                    r: ctxRect.width / 1080,
                };
                setTimeout(() => {
                    chosenCellEl.classList.remove('minigen-cell--pressed');
                    chosenCellEl.classList.add('minigen-cell--collapsing');
                    _spawnEmojiParticleAt(container, spawnCoords, RESULT_EMOJI[result] || '');
                }, 35);
                setTimeout(() => {
                    overlay.classList.remove('minigen-overlay--visible');
                    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
                    resolve(result);
                }, 150);
            } else {
                overlay.classList.remove('minigen-overlay--visible');
                overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
                resolve('skip');
            }
        }

        overlay.querySelectorAll('.minigen-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                checkBeatHit(); // weak beat
                const idx = parseInt(cell.dataset.groupIdx, 10);
                finish(idx === targetIdx ? 'correct' : 'wrong', cell);
            });
        });

        overlay.querySelector('.minigen-skip-btn').addEventListener('click', () => finish('skip', null));
    });
}

// ─────────────────────────────────────────────────────────────
// Sort mode — pick the WORST image to exclude
// ─────────────────────────────────────────────────────────────

/**
 * Shows only variant 1 (good) and variant 2 (partial/medium).
 * Player must pick the WORST (variant 2) to exclude it.
 * Correct = picking variant 2.  Wrong = picking variant 1.
 */
async function _showSortPopup(manifest, allowedTags) {
    const container = document.querySelector('.game-container') || document.body;

    // Pick 3 distinct groups: 2 show variant 1 (good), 1 shows variant 2 (medium)
    const groups = _pickDistinctGroups(manifest, allowedTags, 3);
    const mediumIdx = Math.floor(Math.random() * 3); // which slot gets the medium image

    const cells = _shuffle(groups.map((group, i) => {
        const variant  = (i === mediumIdx) ? 2 : 1;
        const isWrong  = (variant === 1); // good image = wrong to exclude
        return { src: `data/minigen-game/minigen-${group.tag}-${variant}.png`, variant, isWrong };
    }));

    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'minigen-overlay';

        const cellsHtml = cells.map((cell, i) =>
            `<div class="minigen-cell minigen-cell--sort" data-idx="${i}">` +
            `<img class="minigen-img" src="${cell.src}" alt="" draggable="false">` +
            `</div>`
        ).join('');

        overlay.innerHTML =
            `<div class="minigen-popup minigen-popup--sort">` +
            `<div class="minigen-prompt"><span class="minigen-prompt-text">Исключи худшее</span></div>` +
            `<div class="minigen-images">${cellsHtml}</div>` +
            `<button class="minigen-skip-btn" type="button">Пропустить</button>` +
            `</div>`;

        container.appendChild(overlay);
        requestAnimationFrame(() => {
            overlay.classList.add('minigen-overlay--visible');
            _applyComboCellEntrance(Array.from(overlay.querySelectorAll('.minigen-cell')));
        });

        function finish(result, chosenCellEl) {
            overlay.querySelectorAll('.minigen-cell').forEach(c => { c.style.pointerEvents = 'none'; });
            if (chosenCellEl) {
                overlay.querySelectorAll('.minigen-cell').forEach(c => {
                    if (c !== chosenCellEl) c.classList.add('minigen-cell--hidden');
                });
                chosenCellEl.classList.add('minigen-cell--pressed');
                const ctxRect  = container.getBoundingClientRect();
                const cellRect = chosenCellEl.getBoundingClientRect();
                const spawnCoords = {
                    x: (cellRect.left - ctxRect.left) + cellRect.width  * 0.5,
                    y: (cellRect.top  - ctxRect.top)  + cellRect.height * 0.45,
                    r: ctxRect.width / 1080,
                };
                setTimeout(() => {
                    chosenCellEl.classList.remove('minigen-cell--pressed');
                    chosenCellEl.classList.add('minigen-cell--collapsing');
                    _spawnEmojiParticleAt(container, spawnCoords, RESULT_EMOJI[result] || '');
                }, 35);
                setTimeout(() => {
                    overlay.classList.remove('minigen-overlay--visible');
                    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
                    resolve(result);
                }, 150);
            } else {
                overlay.classList.remove('minigen-overlay--visible');
                overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
                resolve('skip');
            }
        }

        overlay.querySelectorAll('.minigen-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                checkBeatHit(); // weak beat
                const idx = parseInt(cell.dataset.idx, 10);
                // isWrong = true means it's a good image — wrong to exclude
                finish(cells[idx].isWrong ? 'wrong' : 'correct', cell);
            });
        });

        overlay.querySelector('.minigen-skip-btn').addEventListener('click', () => finish('skip', null));
    });
}

