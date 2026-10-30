import React from 'react';
import { Loader2 } from 'lucide-react';
import { useAutomationStore } from '../store';
import { detectDdaStage } from '../utils/ddaRoutes';

const mmss = (sec) => {
  if (sec == null || isNaN(sec)) return null;
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Top-bar readout for a manual target-flat search.
 *
 * Scoped deliberately to the Flat Select stage: that is the one place where the sidebar
 * auto-collapses the moment a flat matches, so without this the run becomes invisible exactly
 * when it matters. Everywhere else the sidebar is pinned and already shows the state — the
 * Schemes stage, for instance, has the TIMED button's own "Applying..." readout.
 *
 * Renders nothing when idle, and carries no "held"/reserved state: the hold page and sidebar
 * cover that.
 */
export default function RunStatusChip() {
  const isSearching = useAutomationStore((s) => s.isSearching);
  const searchRemainingSec = useAutomationStore((s) => s.searchRemainingSec);
  const targetFlats = useAutomationStore((s) => s.flatAvailability?.targetFlats);
  const currentUrl = useAutomationStore((s) => s.currentUrl);
  const logs = useAutomationStore((s) => s.logs);

  const isFlatSelect = detectDdaStage(currentUrl).id === 'FLAT_SELECT';

  // The injected hunter reports its own attempt counter through the log stream; there is no
  // store field for it, so read it back off the most recent matching line.
  const attempt = React.useMemo(() => {
    if (!isSearching) return null;
    for (let i = logs.length - 1; i >= 0; i--) {
      const m = /Searching for target flats.*#(\d+)\s*$/.exec(logs[i]?.message || '');
      if (m) return Number(m[1]);
    }
    return null;
  }, [logs, isSearching]);

  if (!isSearching || !isFlatSelect) return null;

  const targets = Array.isArray(targetFlats) && targetFlats.length > 0 ? targetFlats.join(', ') : null;
  // `core` always survives; the target list is dropped first, since the sidebar lists it anyway.
  const core = [attempt ? `#${attempt}` : null, mmss(searchRemainingSec)].filter(Boolean).join(' · ');
  const full = [core, targets].filter(Boolean).join(' · ');

  return (
    <div
      className="hidden sm:flex items-center gap-1.5 px-2 lg:px-2.5 py-1 rounded-xl border shadow-xs min-w-0 shrink animate-fade-in bg-[#4b2c83] border-[#4b2c83] text-white"
      title={full ? `Searching for target flats — ${full}` : 'Searching for target flats'}
    >
      <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
      <span className="text-[10px] font-black uppercase tracking-wider shrink-0">Searching</span>
      {core && (
        <span className="font-mono text-[10px] font-bold tabular-nums shrink-0 opacity-90">{core}</span>
      )}
      {targets && (
        <span className="hidden xl:inline font-mono text-[10px] font-bold tabular-nums truncate opacity-90">
          · {targets}
        </span>
      )}
    </div>
  );
}
