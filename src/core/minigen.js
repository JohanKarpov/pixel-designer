// src/core/minigen.js — Mini-game popup for generate button
// Three modes:
//   'gen'   — slot machine (3 drums, beat-tap to stop each, combo multipliers)
//   'sort'  — pick the best image from 3 options (variant 1 = correct)
//   'study' — alias for sort (same UI, different order context)

import { state } from './state.js';
import { checkBeatHit, getRhythmCombo, getBeatPhase, isRhythmActive } from './rhythm.js';

const RESULT_EMOJI = { correct: '✅', partial: '⚠️', wrong: '❌' };

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

// ─────────────────────────────────────────────────────────────
// Beat-sync pulse: set animation-delay on each img so the loop
// is already at the correct phase when cards first appear.
// ─────────────────────────────────────────────────────────────
function _applyBeatPulse(wrapEls) {
    const phase = isRhythmActive() ? getBeatPhase() : 0; // 0..1
    const delayMs = -Math.round(phase * 250);             // half-period sync
    wrapEls.forEach(el => { el.style.animationDelay = delayMs + 'ms'; });
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
// Shared inline cell finish helper (used by sort/study)
// ─────────────────────────────────────────────────────────────

function _finishInlineCell(imagesDiv, chosenCellEl, result, spawnCoords, emojiCtx, resolve) {
    imagesDiv.querySelectorAll('.minigen-cell').forEach(c => { c.style.pointerEvents = 'none'; });

    if (chosenCellEl) {
        imagesDiv.querySelectorAll('.minigen-cell').forEach(c => {
            if (c !== chosenCellEl) c.classList.add('minigen-cell--hidden');
        });
        chosenCellEl.classList.add('minigen-cell--pressed');
        setTimeout(() => {
            chosenCellEl.classList.remove('minigen-cell--pressed');
            chosenCellEl.classList.add('minigen-cell--collapsing');
            if (spawnCoords) _spawnEmojiParticleAt(emojiCtx, spawnCoords, RESULT_EMOJI[result] || '');

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

// ─────────────────────────────────────────────────────────────
// Sort mode (and study alias) — pick the best image from 3
// variant 1 = correct, variant 2 = partial, variant 3 = wrong
// ─────────────────────────────────────────────────────────────

async function _showSortPopup(manifest, { allowedTags, inlineContainer }) {
    const group    = _pickGroup(manifest, allowedTags);
    const count    = Math.min(group.variants || 3, 3);
    const variants = _shuffle(Array.from({ length: count }, (_, i) => i + 1));
    const basePath = `data/minigen-game/minigen-${group.tag}-`;

    const _visTier     = state.skillTree?.tiers?.ai_vis || 0;
    const _visAccuracy = [0, 0.50, 0.60, 0.70, 0.90, 0.95][Math.min(_visTier, 5)];
    const _visActive   = _visTier >= 1;

    inlineContainer.querySelector('.minigen-images-inline')?.remove();

    const imagesDiv = document.createElement('div');
    imagesDiv.className = 'minigen-images minigen-images-inline';
    imagesDiv.innerHTML = variants.map(n =>
        `<div class="minigen-cell-wrap">` +
        `<div class="minigen-cell" data-variant="${n}">` +
        `<img class="minigen-img" src="${basePath}${n}.png" alt="" draggable="false">` +
        `</div>` +
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

    _applyBeatPulse(Array.from(imagesDiv.querySelectorAll('.minigen-cell-wrap')));
    requestAnimationFrame(() => _applyComboCellEntrance(Array.from(imagesDiv.querySelectorAll('.minigen-cell'))));

    const emojiCtx = document.querySelector('.game-container') || document.body;

    return new Promise(resolve => {
        imagesDiv.querySelectorAll('.minigen-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const wrapEl = cell.parentElement;
                if (wrapEl?.classList.contains('minigen-cell-wrap')) wrapEl.classList.add('minigen-cell-wrap--tapped');
                const flashEl = document.createElement('div');
                flashEl.className = 'minigen-tap-flash';
                cell.appendChild(flashEl);

                checkBeatHit();
                const v      = parseInt(cell.dataset.variant, 10);
                const result = v === 1 ? 'correct' : v === count ? 'wrong' : 'partial';

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

                _finishInlineCell(imagesDiv, cell, result, spawnCoords, emojiCtx, resolve);

                if (result === 'correct' && group.tag === 'tema') {
                    state.stats.temaCorrectPicks = (state.stats.temaCorrectPicks || 0) + 1;
                }
            });
        });
    });
}

// ─────────────────────────────────────────────────────────────
// Slot machine combo evaluator
// ─────────────────────────────────────────────────────────────

function _evalSlotCombo(drums) {
    // drums = [{ tag, quality }, { tag, quality }, { tag, quality }]
    const tags      = drums.map(d => d.tag);
    const qualities = drums.map(d => d.quality);

    const sameTag     = tags[0] === tags[1] && tags[1] === tags[2];
    const sameQuality = qualities[0] === qualities[1] && qualities[1] === qualities[2];
    const count1      = qualities.filter(q => q === 1).length;
    const count2      = qualities.filter(q => q === 2).length;

    let mult   = 0;
    let result = 'wrong';

    if (sameTag && sameQuality)  { result = 'correct'; mult = 100; }
    else if (count1 === 3)       { result = 'correct'; mult = 50;  }
    else if (sameTag)            { result = 'correct'; mult = 50;  }
    else if (count2 === 3)       { result = 'correct'; mult = 25;  }
    else if (qualities[0] === 3 && qualities[1] === 3 && qualities[2] === 3) { result = 'correct'; mult = 5; }
    else if (count1 === 2)       { result = 'correct'; mult = 2;   }
    else if (count1 === 1)       { result = 'correct'; mult = 1;   }

    return { result, mult };
}

// ─────────────────────────────────────────────────────────────
// Preload images — module-level cache keeps strong refs so GC
// never discards decoded bitmaps before the drums start spinning.
// ─────────────────────────────────────────────────────────────

const _imgCache = new Map(); // url → HTMLImageElement, lives forever

function _preloadImages(urls) {
    return Promise.allSettled(urls.map(url => new Promise(res => {
        if (_imgCache.has(url)) { res(); return; } // already loaded
        const img = new Image();
        img.onload  = () => { _imgCache.set(url, img); res(); };
        img.onerror = () => { res(); };             // fail silently
        img.src     = url;
    })));
}

// ─────────────────────────────────────────────────────────────
// Slot machine mode — 3 drums, tap to stop each
// Uses CSS background-image cells to guarantee zero blank frames
// even at 20+ cells/sec on mobile.
// ─────────────────────────────────────────────────────────────

async function _showSlotPopup(manifest, { allowedTags, inlineContainer, onBeatHit = null }) {
    // Cells per second per drum (normalized by cellH at runtime — screen-size independent)
    const SPEEDS_PPS = [8, 8, 8];
    const STRIP_SIZE = 5; // 5 unique images per drum

    // Build flat pool of all available images split by quality
    let allGroups = manifest.groups;
    if (allowedTags && allowedTags.length) {
        const tagSet   = new Set(allowedTags);
        const filtered = allGroups.filter(g => tagSet.has(g.tag));
        if (filtered.length) allGroups = filtered;
    }
    const poolQ1  = []; // quality = 1 (best variant of each group)
    const poolAll = []; // all variants of all groups
    allGroups.forEach(g => {
        const count = Math.min(g.variants || 3, 3);
        for (let v = 1; v <= count; v++) {
            const img = { src: `data/minigen-game/minigen-${g.tag}-${v}.png`, tag: g.tag, quality: v };
            poolAll.push(img);
            if (v === 1) poolQ1.push(img);
        }
    });

    // Build strip per drum:
    //   cell[0]   = 1 random quality-1 image
    //   cell[1-4] = 4 fully random images (any quality, any group)
    //   cell[5]   = duplicate of cell[0] for seamless modulo wrap
    function _buildDrumStrip() {
        const q1img = poolQ1[Math.floor(Math.random() * poolQ1.length)];
        const strip = [q1img];
        for (let i = 0; i < 4; i++) {
            strip.push(poolAll[Math.floor(Math.random() * poolAll.length)]);
        }
        strip.push(strip[0]); // 6th cell = copy of [0] for seamless wrap
        return strip;
    }

    const drumImages = [_buildDrumStrip(), _buildDrumStrip(), _buildDrumStrip()];

    // ── Preload guarantees GPU decode before any spinning ─────────
    const allUrls = [...new Set(drumImages.flat().map(i => i.src))];
    await _preloadImages(allUrls);

    // ── Build DOM ────────────────────────────────────────────────
    inlineContainer.querySelector('.minigen-slot')?.remove();

    const slotDiv = document.createElement('div');
    slotDiv.className = 'minigen-slot';

    drumImages.forEach((strip, di) => {
        const drum    = document.createElement('div');
        drum.className = 'minigen-slot__drum';
        drum.dataset.drum = di;

        const stripEl = document.createElement('div');
        stripEl.className = 'minigen-slot__strip';

        // Each cell: wrapper (pitch/gaps) + <img> from module cache — never blank
        strip.forEach(imgData => {
            const cell    = document.createElement('div');
            cell.className = 'minigen-slot__cell';
            const imgEl   = document.createElement('img');
            imgEl.className  = 'minigen-slot__cell-img';
            imgEl.alt        = '';
            imgEl.draggable  = false;
            // Reuse the already-decoded Image from cache; fallback to plain src
            const cached = _imgCache.get(imgData.src);
            imgEl.src = cached ? cached.src : imgData.src;
            cell.appendChild(imgEl);
            stripEl.appendChild(cell);
        });

        drum.appendChild(stripEl);
        slotDiv.appendChild(drum);
    });

    inlineContainer.appendChild(slotDiv);

    // Sync drum beat-pulse to current rhythm phase (same logic as _applyBeatPulse)
    {
        const phase   = isRhythmActive() ? getBeatPhase() : 0; // 0..1
        const baseDelay = -Math.round(phase * 250);             // align to beat
        slotDiv.querySelectorAll('.minigen-slot__drum').forEach((d, i) => {
            d.style.animationDelay = (baseDelay - i * 20) + 'ms'; // tiny stagger per drum
        });
    }

    // ── Measure layout (2 frames to ensure CSS applies) ───────────
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const drumEl = slotDiv.querySelector('.minigen-slot__drum');
    const cellEl = slotDiv.querySelector('.minigen-slot__cell');
    // Use offsetHeight (layout size) — NOT getBoundingClientRect which is affected
    // by the beat-pulse transform:scale() animation running on the drum.
    // offsetHeight ignores CSS transforms and returns the true CSS pixel height.
    const cellH  = cellEl.offsetHeight;
    // cOff = 0 by design: cell height === drum inner height (both 184r in CSS)
    const totalH = cellH * STRIP_SIZE;

    // px/ms per drum — speed in cells/sec, normalised to actual pixel cellH
    const speeds = SPEEDS_PPS.map(s => (s * cellH) / 1000);

    const drumEls  = Array.from(slotDiv.querySelectorAll('.minigen-slot__drum'));
    const stripEls = drumEls.map(d => d.querySelector('.minigen-slot__strip'));

    // cell[0] starts at drum top (translateY=0) — visible immediately
    stripEls.forEach(s => { s.style.transform = 'translateY(0px)'; });

    // ── Spin state ───────────────────────────────────────────────
    const distances    = [0, 0, 0]; // monotonically increasing scroll distance per drum
    const stopped      = [false, false, false];
    const resolvedDrums = [];
    let nextToStop     = 0;
    let _spinRaf       = null;
    let lastNow        = performance.now();

    function spinFrame(now) {
        const dt = now - lastNow;
        lastNow  = now;
        drumEls.forEach((_, i) => {
            if (stopped[i]) return;
            distances[i] += speeds[i] * dt;
            // translateY = -pos: strip scrolls upward, images enter from below
            // Seamless: at pos=totalH the strip wraps; cell[5]=cell[0] copy masks the jump
            const pos = distances[i] % totalH;
            stripEls[i].style.transform = `translateY(${(-pos).toFixed(1)}px)`;
        });
        _spinRaf = requestAnimationFrame(spinFrame);
    }
    _spinRaf = requestAnimationFrame(spinFrame);

    const emojiCtx = document.querySelector('.game-container') || document.body;

    return new Promise(resolve => {
        function stopDrum(drumIdx) {
            if (stopped[drumIdx]) return;
            stopped[drumIdx] = true;

            // Score this tap against the beat — builds rhythm combo for payout bonus
            const hit = checkBeatHit();
            if (onBeatHit) onBeatHit(hit.quality);

            // Use rawIdx (0..STRIP_SIZE) for snapY to avoid reverse-jump when pos≈totalH:
            //   rawIdx=5 → snapY = -(5*cellH) = position of the 6th duplicate cell (smooth).
            //   rawIdx%STRIP_SIZE → still correct image lookup (0..4).
            const pos     = distances[drumIdx] % totalH;
            const rawIdx  = Math.round(pos / cellH);        // 0..STRIP_SIZE inclusive
            const cellIdx = rawIdx % STRIP_SIZE;            // 0..4 for image lookup
            const snapY   = -(rawIdx * cellH);              // proximity-preserving snap

            stripEls[drumIdx].style.transition = 'transform 120ms cubic-bezier(0.22, 1, 0.36, 1)';
            stripEls[drumIdx].style.transform  = `translateY(${snapY.toFixed(1)}px)`;

            drumEls[drumIdx].classList.add('minigen-slot__drum--stopped');
            drumEls[drumIdx].classList.add('minigen-slot__drum--snap');
            setTimeout(() => drumEls[drumIdx].classList.remove('minigen-slot__drum--snap'), 200);

            resolvedDrums[drumIdx] = drumImages[drumIdx][cellIdx];

            if (stopped.every(Boolean)) {
                if (_spinRaf) { cancelAnimationFrame(_spinRaf); _spinRaf = null; }
                const combo = _evalSlotCombo(resolvedDrums);
                // Show result overlay immediately; resolve only on next click
                setTimeout(() => {
                    _showSlotResult(slotDiv, combo, emojiCtx, () => {
                        slotDiv.remove();
                        resolve({ result: combo.result, slotMult: combo.mult });
                    });
                }, 80); // tiny pause so snap finishes before overlay appears
            }
        }

        slotDiv.addEventListener('click', () => {
            if (nextToStop < 3) {
                stopDrum(nextToStop);
                nextToStop++;
            }
            // clicks after all stopped are handled by result overlay
        });
    });
}

function _showSlotResult(container, combo, emojiCtx, onDone) {
    const overlay = document.createElement('div');
    overlay.className = 'minigen-slot__result-overlay';

    const label = combo.mult > 0
        ? (combo.mult >= 50 ? `×${combo.mult} 🎰` : `×${combo.mult}`)
        : '✗';
    overlay.textContent = label;
    overlay.dataset.result = combo.result;

    container.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('minigen-slot__result-overlay--visible'));

    const ctxRect = emojiCtx.getBoundingClientRect();
    const cRect   = container.getBoundingClientRect();
    if (combo.mult > 0) {
        _spawnEmojiParticleAt(emojiCtx, {
            x: (cRect.left - ctxRect.left) + cRect.width  * 0.5,
            y: (cRect.top  - ctxRect.top)  + cRect.height * 0.4,
            r: ctxRect.width / 1080,
        }, combo.mult >= 50 ? '🎰' : (combo.result === 'correct' ? '✨' : '💀'));
    }

    // Wait for click anywhere on overlay — small delay prevents click-through
    // from the 3rd-drum stop tap
    setTimeout(() => {
        overlay.addEventListener('click', () => onDone(), { once: true });
    }, 250);
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} [options]
 * @param {string[]|null} [options.tags]
 * @param {string} [options.mode]  'sort' | 'study' | 'gen'
 * @param {HTMLElement|null} [options.inlineContainer]
 * @returns {Promise<{ result: string, reactionMs: number, slotMult: number }>}
 */
export async function runMinigen({ tags = null, mode = 'sort', inlineContainer = null, onBeatHit = null } = {}) {
    const t0 = performance.now();
    let result   = 'skip';
    let slotMult = 1;
    try {
        const manifest = await _loadManifest();
        if (!manifest?.groups?.length) return { result: 'skip', reactionMs: 0, slotMult: 1 };

        if (mode === 'gen') {
            const r = await _showSlotPopup(manifest, { allowedTags: tags || undefined, inlineContainer, onBeatHit });
            result   = r.result;
            slotMult = r.slotMult;
        } else {
            // 'sort' and 'study' both use the inline picker
            result = await _showSortPopup(manifest, { allowedTags: tags || undefined, inlineContainer });
        }
    } catch (e) {
        console.warn('[minigen] runMinigen error:', e);
    }
    const reactionMs = performance.now() - t0;
    return { result, reactionMs, slotMult };
}

