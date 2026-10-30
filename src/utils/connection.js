// Internet connection watch for this window: 'online', 'offline', or 'back'
// (3 s after the connection returns). Windows' online/offline signal is not
// trusted alone (captive Wi-Fi, VPNs, blips): it only starts a check, and
// "offline" is declared after a real request fails twice. Checks go to
// Google's empty 204 page first (the Worker only as a second opinion), never
// to DDA's /user, which re-renders the login salt.
import { useSyncExternalStore } from 'react';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'https://dda-engine.asmrahul17.workers.dev';
const PROBES = ['https://www.gstatic.com/generate_204', `${WORKER_URL}/`];
const ONLINE_EVERY_MS = 30000; // a quiet check while online (Wi-Fi up, internet down)
const OFFLINE_EVERY_MS = 10000; // while offline, how often to look for the way back
const RECHECK_MS = 3000; // a failed check is repeated once before "offline"
const BACK_MS = 3000;

let state = 'online';
let started = false;
let timer = null;
let backTimer = null;
let checking = false;
const listeners = new Set();

const setState = (next) => {
  if (next === state) return;
  state = next;
  listeners.forEach((fn) => { try { fn(state); } catch (_) {} });
};

// Any answer at all (no-cors: the response itself is not readable) means the
// internet works
async function reachable() {
  for (const url of PROBES) {
    try {
      await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
        mode: 'no-cors',
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      return true;
    } catch (_) {}
  }
  return false;
}

const schedule = (ms) => {
  clearTimeout(timer);
  timer = setTimeout(check, ms);
};

async function check({ quick = false } = {}) {
  if (checking) return;
  checking = true;
  try {
    let ok = await reachable();
    // Not on Windows' word alone, and not on one failed request
    if (!ok && state !== 'offline' && !quick) {
      await new Promise((r) => setTimeout(r, RECHECK_MS));
      ok = await reachable();
    }
    if (ok) {
      if (state === 'offline') {
        setState('back');
        clearTimeout(backTimer);
        backTimer = setTimeout(() => { if (state === 'back') setState('online'); }, BACK_MS);
      }
      schedule(ONLINE_EVERY_MS);
    } else {
      clearTimeout(backTimer);
      setState('offline');
      schedule(OFFLINE_EVERY_MS);
    }
  } finally {
    checking = false;
  }
}

export function startConnectionWatch() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('offline', () => check());
  window.addEventListener('online', () => check({ quick: true }));
  check();
}

export function getConnectionState() {
  return state;
}

export function onConnectionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useConnectionState() {
  return useSyncExternalStore(onConnectionChange, getConnectionState);
}
