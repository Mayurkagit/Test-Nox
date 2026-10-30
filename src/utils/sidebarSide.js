import { useEffect, useState } from 'react';
import { wsKey } from './storageHelper';

// Which side of this window the control sidebar sits on ('right' by default). Each window keeps
// its own choice (stored under the window's session key, so it comes back when that window
// reopens); changing it in one window leaves the others where they are.
const KEY = 'dda_sidebar_side';
const EVENT = 'flatbook:sidebar-side'; // tells this window's components the choice changed

// One-time cleanup: the first version stored a single choice for every window under this key
try { localStorage.removeItem('flatbook_sidebar_side'); } catch (_) {}

export function readSidebarSide() {
  try {
    return localStorage.getItem(wsKey(KEY)) === 'left' ? 'left' : 'right';
  } catch (_) {
    return 'right';
  }
}

export function setSidebarSide(side) {
  const value = side === 'left' ? 'left' : 'right';
  try { localStorage.setItem(wsKey(KEY), value); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch (_) {}
}

export function useSidebarSide() {
  const [side, setSide] = useState(readSidebarSide);
  useEffect(() => {
    const sync = () => setSide(readSidebarSide());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return side;
}
