// ─── Window-Scoped LocalStorage Namespace Helper ────────────────────────
// Each Electron BrowserWindow gets a unique `winSession` (e.g., 'session_1').
// This helper namespaces localStorage keys so Window 1 and Window 2
// never read/write each other's per-window state.
//
// Usage:
//   import { wsGet, wsSet, wsRemove } from '../utils/storageHelper';
//   wsGet('dda_hunt_seconds')    → reads 'session_1::dda_hunt_seconds'
//   wsSet('dda_hunt_seconds', 30) → writes 'session_1::dda_hunt_seconds'

// The Gemini captcha fallback was removed (the local ONNX model solves all
// captchas); drop any key an older version stored.
try {
  localStorage.removeItem('dda_gemini_key');
  localStorage.removeItem('dda_gemini_model');
} catch (_) {}

// ─── GLOBAL KEYS (shared across all windows, never namespaced) ──────────
const GLOBAL_KEYS = new Set([
  // Auth & identity
  'dda_auth_user',
  'dda_auth_email',
  'dda_auth_uid',
  'dda_id_token',
  'dda_is_admin',
  'dda_user_role',
  'dda_booking_key',
  'dda_remember_me',
  'dda_remembered_credentials',

  // Applicant data (read-only reference, per-user not per-window)
  'dda_extension_applicants',
  'dda_user_applicants',
  'ddaData',
  'dda_deleted_pans',

  // Backend config (worker-sent, same for all windows)
  'dda_schemes',
  'dda_mode',

  // Login credentials vault
  'dda_login_users',

  // Fast Payment Settings (shared across all windows & webviews)
  'dda_fast_payment_enabled',
  'dda_fast_payment_gateway',
  'dda_fast_payment_method',
  'dda_fast_payment_bank',
]);

// 🛡️ One-time purge of plaintext payment card remnants from storage
try {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('dda_fast_payment_card');
    sessionStorage.removeItem('dda_fast_payment_card');
  }
} catch (_) {}

// ─── STRICTLY WINDOW KEYS (must NEVER fall back to global localStorage) ─
const STRICTLY_WINDOW_KEYS = new Set([
  'dda_active_applicant_pan',
  'dda_selected_person',
  'dda_last_logged_in_pan',
  'dda_last_selected_login_pan',
  'dda_selected_login_pan',
  'dda_locked_login_pan',
  'dda_submitting_pan',
  'dda_authenticated_pan',
  'dda_direct_mode',
  'dda_selected_scheme',
  'dda_target_scheme',
  'dda_active_scheme_name'
]);

/**
 * Get the current window's session ID.
 * sessionStorage is inherently per-window in Chromium, making it the
 * perfect anchor for window identity.
 */
export function getWinSession() {
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      const sp = new URLSearchParams(window.location.search);
      const fromUrl = sp.get('winSession');
      if (fromUrl) {
        try { sessionStorage.setItem('dda_win_session', fromUrl); } catch (_) {}
        return fromUrl;
      }
    }
    return sessionStorage.getItem('dda_win_session') || 'session_1';
  } catch (_) {
    return 'session_1';
  }
}

/**
 * Returns the namespaced key for window-scoped storage.
 * Global keys are returned as-is (never namespaced).
 */
export function wsKey(key) {
  if (GLOBAL_KEYS.has(key)) return key;
  return `${getWinSession()}::${key}`;
}

/**
 * Read a value from localStorage, namespaced by window session.
 * Falls back to the un-namespaced (global) key if the namespaced
 * key doesn't exist — EXCEPT for strictly window-isolated keys.
 */
export function wsGet(key) {
  try {
    if (GLOBAL_KEYS.has(key)) {
      return localStorage.getItem(key);
    }
    const namespaced = `${getWinSession()}::${key}`;
    const val = localStorage.getItem(namespaced);
    if (val !== null) return val;
    // Strict isolation guard: applicant identity & window state must NEVER bleed across windows
    if (STRICTLY_WINDOW_KEYS.has(key)) {
      return null;
    }
    // Migration fallback: read from old un-namespaced key
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

/**
 * Write a value to localStorage, namespaced by window session.
 */
export function wsSet(key, value) {
  try {
    if (GLOBAL_KEYS.has(key)) {
      localStorage.setItem(key, value);
    } else {
      localStorage.setItem(`${getWinSession()}::${key}`, value);
    }
  } catch (_) {}
}

/**
 * Remove a value from localStorage, namespaced by window session.
 */
export function wsRemove(key) {
  try {
    if (GLOBAL_KEYS.has(key)) {
      localStorage.removeItem(key);
    } else {
      localStorage.removeItem(`${getWinSession()}::${key}`);
      // Also clean old un-namespaced key if it exists (migration cleanup)
      localStorage.removeItem(key);
    }
  } catch (_) {}
}

/**
 * Check if a key is a global (shared) key.
 */
export function isGlobalKey(key) {
  return GLOBAL_KEYS.has(key);
}
