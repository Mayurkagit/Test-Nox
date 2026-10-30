import React, { useState, useEffect } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';

/**
 * Live clock for the top bar.
 *
 * The drop is time-critical and DDA's 15-minute hold timer runs off this PC's clock, so a wrong
 * clock or timezone can release a held flat. `skewMs` is this machine's offset from the portal's
 * own `Date` header (positive = PC ahead of DDA); anything past a couple of seconds is surfaced.
 */
export default function PortalClock({ skewMs = null, onDark = false }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    // Align to the top of each second so the display never visibly skips a digit.
    let interval;
    const align = setTimeout(() => {
      tick();
      interval = setInterval(tick, 1000);
    }, 1000 - (Date.now() % 1000));
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, []);

  const hh = String(now.getHours() % 12 || 12).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';

  const absSkew = skewMs == null ? null : Math.abs(skewMs);
  const isOff = absSkew != null && absSkew >= 2000;
  const isBadlyOff = absSkew != null && absSkew >= 10000;

  const skewLabel = absSkew == null
    ? null
    : absSkew < 1000
      ? '<1s'
      : absSkew < 60000
        ? `${(absSkew / 1000).toFixed(absSkew < 10000 ? 1 : 0)}s`
        : `${Math.round(absSkew / 60000)}m`;

  return (
    <div
      className={`flex items-center gap-1.5 lg:gap-2 px-2 lg:px-2.5 shrink-0 transition-colors border ${onDark ? 'h-8 rounded-full px-3 shadow-xs' : 'py-1 rounded-xl shadow-xs'} ${
        isBadlyOff
          ? 'bg-rose-50 border-rose-300'
          : isOff
            ? 'bg-amber-50 border-amber-300'
            : onDark ? 'bg-white border-white shadow-sm' : 'bg-white border-slate-200'
      }`}
      title={
        skewMs == null
          ? 'Local clock. Portal time not checked yet.'
          : isOff
            ? `This PC is ${skewMs > 0 ? 'AHEAD OF' : 'BEHIND'} the DDA server by ${skewLabel}. ` +
              'The 15-minute hold timer runs off the PC clock — fix the system time before a drop.'
            : `Clock matches the DDA server (within ${skewLabel}).`
      }
    >
      {isOff ? (
        <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${isBadlyOff ? 'text-rose-600' : 'text-amber-600'}`} />
      ) : (
        <Clock className="w-3.5 h-3.5 text-[#4b2c83] shrink-0" />
      )}

      <span className="font-mono font-black text-sm tracking-tight text-slate-900 tabular-nums">
        {hh}:{mm}
        <span className={isOff ? (isBadlyOff ? 'text-rose-600' : 'text-amber-600') : 'text-[#4b2c83]'}>:{ss}</span>
      </span>
      {/* AM/PM is the first thing to go when space is tight — the hour already disambiguates it
          in practice, and the skew badge matters far more. */}
      <span className="hidden sm:inline text-[9px] font-black uppercase text-slate-500 tracking-wider">{ampm}</span>

      {isOff && (
        <span
          className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0 ${
            isBadlyOff ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'
          }`}
        >
          {skewMs > 0 ? '+' : '−'}{skewLabel}
        </span>
      )}
    </div>
  );
}
