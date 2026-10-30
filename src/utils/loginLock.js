import { useEffect, useState } from 'react';
import { wsGet, wsSet, wsRemove } from './storageHelper';

// Login-page applicant lock, per window. While a PAN is locked, every place
// that picks the login applicant uses it: a DDA logout, a session expiry,
// an app reload or a change to the login list can't switch it. Only the
// user unlocks it.
const KEY = 'dda_locked_login_pan';
const EVENT = 'dda:login-lock-changed';

export function getLockedLoginPan() {
  try { return (wsGet(KEY) || '').toUpperCase().trim(); } catch (_) { return ''; }
}

export function setLockedLoginPan(pan) {
  const clean = (pan || '').toUpperCase().trim();
  try {
    if (clean) wsSet(KEY, clean);
    else wsRemove(KEY);
  } catch (_) {}
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: clean })); } catch (_) {}
}

// The locked login profile from a list (archived included: a lock wins).
export function findLockedLogin(list) {
  const pan = getLockedLoginPan();
  if (!pan || !Array.isArray(list)) return null;
  return list.find((u) => (u?.pan || '').toUpperCase().trim() === pan) || null;
}

// Per-window applicant identity: cleared for a window that starts afresh
// (same list as WINDOW_IDENTITY_KEYS in main.js)
const IDENTITY_KEYS = [
  'dda_locked_login_pan',
  'dda_last_selected_login_pan',
  'dda_selected_login_pan',
  'dda_last_logged_in_pan',
  'dda_authenticated_pan',
  'dda_submitting_pan',
  'dda_active_applicant_pan',
  'dda_selected_person',
];
const sessionNum = (sid) => parseInt(String(sid).replace('session_', ''), 10) || 0;

// First window of a run: only one lock outlives the app. previousOrder is
// the windows open at the end of the last run, oldest first (null when not
// recorded, e.g. the first run of this version). The oldest of them with a
// lock wins (without a record: the lowest window number with a lock); that
// lock becomes this window's and every other window's identity is cleared.
// Returns the session the lock came from ('' when none).
export function carryLockAfterRestart(previousOrder, mySession) {
  const locks = new Map();
  const identityKeys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && /^(session_\d+)::(.+)$/.exec(k);
      if (!m || !IDENTITY_KEYS.includes(m[2])) continue;
      identityKeys.push([m[1], k]);
      if (m[2] === KEY) {
        const pan = (localStorage.getItem(k) || '').toUpperCase().trim();
        if (pan) locks.set(m[1], pan);
      }
    }
  } catch (_) {
    return '';
  }
  const from = Array.isArray(previousOrder)
    ? previousOrder.find((sid) => locks.has(sid)) || ''
    : [...locks.keys()].sort((a, b) => sessionNum(a) - sessionNum(b))[0] || '';
  try {
    for (const [sid, k] of identityKeys) {
      // This window keeps its own identity when the lock is its own
      if (sid === mySession && from === mySession) continue;
      localStorage.removeItem(k);
    }
    if (from && from !== mySession) localStorage.setItem(`${mySession}::${KEY}`, locks.get(from));
  } catch (_) {}
  return from;
}

export function useLockedLoginPan() {
  const [pan, setPan] = useState(getLockedLoginPan);
  useEffect(() => {
    const onChange = () => setPan(getLockedLoginPan());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return pan;
}
