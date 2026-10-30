import React, { useEffect, useRef } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { startConnectionWatch, useConnectionState } from '../utils/connection';
import { useAutomationStore } from '../store/useAutomationStore';

// A pill at the top of the window while the internet is down (and briefly
// when it is back). It blocks nothing: clicks pass through and no control is
// disabled, since a short drop often recovers by itself.
export default function ConnectionBanner() {
  const state = useConnectionState();
  const prev = useRef(state);

  useEffect(() => { startConnectionWatch(); }, []);

  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    const log = useAutomationStore.getState().addLog;
    if (state === 'offline' && was !== 'offline') {
      log?.('ERROR', 'Network', 'No internet connection. Booking actions will fail until it is back.');
    } else if (state === 'back') {
      log?.('INFO', 'Network', 'Internet connection is back.');
    }
  }, [state]);

  if (state === 'online') return null;
  const offline = state === 'offline';
  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none" role="status" aria-live="assertive">
      <div
        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full shadow-lg text-[12px] font-bold text-white whitespace-nowrap ${
          offline ? 'bg-red-600' : 'bg-emerald-600'
        }`}
      >
        {offline ? <WifiOff className="w-3.5 h-3.5 shrink-0" /> : <Wifi className="w-3.5 h-3.5 shrink-0" />}
        {offline
          ? 'No internet connection. Please connect to the internet; booking actions will fail until then.'
          : 'Back online'}
      </div>
    </div>
  );
}
