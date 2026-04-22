// src/core/gyro.js — Device orientation (gyroscope) module
// Provides smoothed beta/gamma values for parallax effects.
// Falls back to mousemove on desktop (same coefficient space).

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let _beta  = 0;   // smoothed forward/back tilt  (-90..+90°, typical neutral ≈ 45°)
let _gamma = 0;   // smoothed left/right tilt     (-45..+45°, typical neutral ≈ 0°)
let _baseBeta  = null;  // calibrated zero-point (set on first reading)
let _baseGamma = null;

const SMOOTH = 0.08;   // lerp factor — lower = smoother but laggier

let _active   = false;
let _hasGyro  = false;

// ─────────────────────────────────────────────────────────────
// iOS 13+ permission request (must be called inside user gesture)
// ─────────────────────────────────────────────────────────────

export async function requestGyroPermission() {
    if (typeof DeviceOrientationEvent === 'undefined') return false;

    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const result = await DeviceOrientationEvent.requestPermission();
            if (result !== 'granted') return false;
        } catch {
            return false;
        }
    }

    _startGyro();
    return true;
}

// ─────────────────────────────────────────────────────────────
// Auto-start on non-iOS (Android + desktop DeviceOrientation)
// ─────────────────────────────────────────────────────────────

export function initGyro() {
    if (typeof DeviceOrientationEvent === 'undefined') {
        _startMouseFallback();
        return;
    }

    // Check if events actually fire (Android doesn't need permission)
    const probe = (e) => {
        if (e.gamma !== null) {
            _hasGyro = true;
            _startGyro();
        } else {
            _startMouseFallback();
        }
        window.removeEventListener('deviceorientation', probe);
    };
    window.addEventListener('deviceorientation', probe, { once: true });

    // If no event fires in 1s → fallback to mouse
    setTimeout(() => {
        if (!_hasGyro) _startMouseFallback();
    }, 1000);
}

// ─────────────────────────────────────────────────────────────
// Listeners
// ─────────────────────────────────────────────────────────────

function _startGyro() {
    if (_active) return;
    _active = true;
    _hasGyro = true;
    window.addEventListener('deviceorientation', _onOrientation);
}

function _onOrientation(e) {
    const rawBeta  = e.beta  ?? 0;
    const rawGamma = e.gamma ?? 0;

    // Calibrate on first reading — treat initial position as "neutral"
    if (_baseBeta  === null) _baseBeta  = rawBeta;
    if (_baseGamma === null) _baseGamma = rawGamma;

    const db = rawBeta  - _baseBeta;
    const dg = rawGamma - _baseGamma;

    // Lerp (low-pass filter — removes jitter)
    _beta  += (db - _beta)  * SMOOTH;
    _gamma += (dg - _gamma) * SMOOTH;
}

// Desktop fallback — mousemove simulates tilt
function _startMouseFallback() {
    if (_active) return;
    _active = true;
    window.addEventListener('mousemove', _onMouse);
}

function _onMouse(e) {
    // Map mouse position to ±15° range (same as typical gyro range used for parallax)
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    const targetGamma = ((e.clientX - cx) / cx) * 15;
    const targetBeta  = ((e.clientY - cy) / cy) * 10;

    _gamma += (targetGamma - _gamma) * SMOOTH;
    _beta  += (targetBeta  - _beta)  * SMOOTH;
}

// ─────────────────────────────────────────────────────────────
// Public getter — call every rAF frame
// Returns { beta, gamma } in degrees (calibrated, smoothed)
// ─────────────────────────────────────────────────────────────

export function getGyro() {
    return { beta: _beta, gamma: _gamma };
}

// Recalibrate to current position (call when screen enters)
export function recalibrateGyro() {
    _baseBeta  = null;
    _baseGamma = null;
}
