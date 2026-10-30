import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { DDA_STAGES } from '../utils/ddaRoutes';
import { useAutomationStore } from '../store/useAutomationStore';

// Per-stage accent. DDA_STAGES carries a `color` name; map it to concrete classes so Tailwind
// can see every literal at build time (dynamic `bg-${color}-500` strings get purged).
const ACCENT = {
  indigo:  { on: 'bg-[#4b2c83] text-white border-[#4b2c83] shadow-[#4b2c83]/25' },
  cyan:    { on: 'bg-cyan-600 text-white border-cyan-600 shadow-cyan-600/25' },
  emerald: { on: 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-600/25' },
  amber:   { on: 'bg-amber-500 text-white border-amber-500 shadow-amber-500/25' },
  rose:    { on: 'bg-rose-600 text-white border-rose-600 shadow-rose-600/25' }
};

/**
 * Six-step progress rail for the DDA booking cascade. It stretches across the free width of
 * the top bar: the connectors grow, the steps keep their size.
 * It sizes itself by its OWN width (container queries), not the window's, since the sidebar
 * and the top-bar buttons take a varying share of the window:
 *   >= 700px  every step shows its label
 *   >= 380px  only the current step shows its label; the others are round dots
 *    < 380px  only the current step, with "n/6"
 */
export default function StageRail({ activeStage }) {
  const activeNum = activeStage?.num || 1;
  // Spin only while something is happening: a page loading, a flat search,
  // or a TIMED run (countdown or hunting). Otherwise the step shows its number.
  const isBusy = useAutomationStore((s) => s.isPageLoading || s.isSearching || s.isTimedActive);

  return (
    <div className="@container w-full min-w-0">
    <div className="flex items-center w-full min-w-0 select-none" role="list" aria-label="Booking progress">
      {DDA_STAGES.map((stage, i) => {
        const isActive = stage.num === activeNum;
        const isDone = stage.num < activeNum;
        const accent = ACCENT[stage.color] || ACCENT.indigo;

        return (
          <React.Fragment key={stage.id}>
            {i > 0 && (
              <div
                className={`hidden @[380px]:block flex-1 min-w-2 h-0.5 mx-1.5 rounded-full transition-colors ${
                  isDone || isActive ? 'bg-[#4b2c83]/40' : 'bg-slate-200'
                }`}
                aria-hidden="true"
              />
            )}
            <div
              role="listitem"
              aria-current={isActive ? 'step' : undefined}
              title={`${stage.num}. ${stage.fullTitle} — ${stage.badge}`}
              className={`h-8 items-center gap-1.5 rounded-full border transition-all shrink-0 ${
                isActive
                  ? `flex ${accent.on} pl-1.5 pr-3 shadow-md`
                  : isDone
                    ? 'hidden @[380px]:flex bg-white border-slate-200 text-slate-600 px-1.5 @[700px]:pr-3 shadow-2xs'
                    : 'hidden @[380px]:flex bg-white/60 border-slate-200/70 text-slate-400 px-1.5 @[700px]:pr-3'
              }`}
            >
              {/* A completed step shows a tick, the current step spins while the app is working
                  on it, the others show their number. */}
              <span
                className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black shrink-0 ${
                  isActive
                    ? 'bg-white/25 text-white'
                    : isDone
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {isDone
                  ? <Check className="w-3 h-3 stroke-[3.5]" />
                  : isActive && isBusy
                    ? <Loader2 className="w-3 h-3 animate-spin stroke-[3]" aria-label="Working" />
                    : stage.num}
              </span>
              <span
                className={`text-[10.5px] font-extrabold uppercase tracking-wider whitespace-nowrap ${
                  isActive ? 'inline' : 'hidden @[700px]:inline'
                }`}
              >
                {stage.label}
                {isActive && (
                  <span className="@[380px]:hidden ml-1.5 opacity-75 normal-case tracking-normal">
                    {stage.num}/{DDA_STAGES.length}
                  </span>
                )}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
    </div>
  );
}
