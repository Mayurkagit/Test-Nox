import { useEffect, useState } from 'react';
import { wsKey } from './storageHelper';

// Whether DDA's own left menu is hidden in this window's DDA page (on by default). Each window
// keeps its own choice; Workspace passes it to the page (preload-dda applyDdaSidebarVisibility).
const KEY = 'dda_hide_dda_sidebar';
const EVENT = 'flatbook:dda-sidebar';

export function readDdaSidebarHidden() {
  try {
    return localStorage.getItem(wsKey(KEY)) !== '0';
  } catch (_) {
    return true;
  }
}

export function setDdaSidebarHidden(hidden) {
  try { localStorage.setItem(wsKey(KEY), hidden ? '1' : '0'); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch (_) {}
}

export function useDdaSidebarHidden() {
  const [hidden, setHidden] = useState(readDdaSidebarHidden);
  useEffect(() => {
    const sync = () => setHidden(readDdaSidebarHidden());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return hidden;
}
