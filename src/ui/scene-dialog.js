// src/ui/scene-dialog.js — Scene panel UI
// Bottom sheet with speaker portrait, text, progress dots, and Next/Finish button.
// Usage:
//   import { showScene } from '../ui/scene-dialog.js';
//   await showScene(scene);   ← resolves when player finishes all panels

// ─────────────────────────────────────────────────────────────
// One-time DOM build (lazy)
// ─────────────────────────────────────────────────────────────

let _overlay = null;
let _portrait, _speaker, _text, _dots, _nextBtn, _choiceRow;

function _build() {
    if (_overlay) return;

    _overlay = document.createElement('div');
    _overlay.className = 'scene-dialog';
    _overlay.setAttribute('inert', '');
    _overlay.innerHTML = `
        <div class="scene-dialog__backdrop"></div>
        <div class="scene-dialog__panel" role="dialog" aria-modal="true">
            <div class="scene-dialog__speaker-row">
                <div class="scene-dialog__portrait" id="sd-portrait"></div>
                <span class="scene-dialog__speaker-name" id="sd-speaker"></span>
            </div>
            <p class="scene-dialog__text" id="sd-text"></p>
            <div class="scene-dialog__choice-row" id="sd-choices" hidden></div>
            <div class="scene-dialog__footer">
                <div class="scene-dialog__dots" id="sd-dots"></div>
                <button class="scene-dialog__next-btn" id="sd-next">Далее →</button>
            </div>
        </div>`;

    document.body.appendChild(_overlay);

    _portrait  = document.getElementById('sd-portrait');
    _speaker   = document.getElementById('sd-speaker');
    _text      = document.getElementById('sd-text');
    _dots      = document.getElementById('sd-dots');
    _nextBtn   = document.getElementById('sd-next');
    _choiceRow = document.getElementById('sd-choices');
}

// ─────────────────────────────────────────────────────────────
// Public
// ─────────────────────────────────────────────────────────────

/**
 * Display a scene panel-by-panel.
 * Returns a Promise that resolves with an array of applied choice outcomes.
 */
export function showScene(scene) {
    _build();

    return new Promise(resolve => {
        const panels = scene.panels || [];
        let panelIdx = 0;
        const collectedOutcomes = [...(scene.outcomes || [])];

        function _renderPanel(idx) {
            const p = panels[idx];
            if (!p) { _close(); resolve(collectedOutcomes); return; }

            _portrait.textContent = p.portrait || '👤';
            _speaker.textContent  = p.speaker  || '';
            _text.textContent     = p.text     || '';

            // Dots
            _dots.innerHTML = panels.map((_, i) =>
                `<span class="scene-dialog__dot${i === idx ? ' scene-dialog__dot--active' : ''}"></span>`
            ).join('');

            // Choices
            if (p.choices?.length) {
                _choiceRow.hidden = false;
                _nextBtn.hidden   = true;
                _choiceRow.innerHTML = '';
                p.choices.forEach(ch => {
                    const btn = document.createElement('button');
                    btn.className = 'scene-dialog__choice-btn';
                    btn.textContent = ch.label;
                    btn.addEventListener('click', () => {
                        if (ch.outcomes) collectedOutcomes.push(...ch.outcomes);
                        const nextIdx = ch.next ?? idx + 1;
                        _renderPanel(nextIdx);
                    }, { once: true });
                    _choiceRow.appendChild(btn);
                });
            } else {
                _choiceRow.hidden = true;
                _nextBtn.hidden   = false;
                const isLast = idx >= panels.length - 1;
                _nextBtn.textContent = isLast ? 'Закрыть' : 'Далее →';
                _nextBtn.onclick = () => _renderPanel(idx + 1);
            }
        }

        function _close() {
            _overlay.classList.remove('scene-dialog--visible');
            _overlay.setAttribute('inert', '');
        }

        _overlay.removeAttribute('inert');
        _overlay.classList.add('scene-dialog--visible');
        _renderPanel(panelIdx);
    });
}
