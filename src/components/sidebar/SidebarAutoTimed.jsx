import React, { useEffect, useState } from 'react';
import { useAutomationStore } from '../../store/useAutomationStore';
import { serverNow } from '../../utils/serverClock';

const countdown = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// One small line after the "Controls" label on the schemes page, only while
// the admin's Auto TIMED is working for this window: "starts in 3:12" before
// the start, "armed · 0:27" until the apply time. Nothing is shown when it is
// not set, was stopped here, or it is too late to start by itself. Tap it to
// turn Auto TIMED off in this window (a small "Auto off" then lets you back on).
export default function SidebarAutoTimed() {
  const status = useAutomationStore((s) => s.autoTimedStatus);
  const windowOff = useAutomationStore((s) => s.autoTimedWindowOff);
  const setWindowOff = useAutomationStore((s) => s.setAutoTimedWindowOff);
  const addLog = useAutomationStore((s) => s.addLog);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!status) return null;
  const now = serverNow();

  const toggle = (off) => {
    addLog?.('USER_ACTION', 'Auto TIMED', `User switched Auto TIMED ${off ? 'OFF' : 'ON'} for this window`, '');
    setWindowOff(off);
  };

  // Turned off here by the operator: a tiny way back on
  if (windowOff) {
    return (
      <button
        type="button"
        onClick={() => toggle(false)}
        title="Auto TIMED is off in this window. Tap to turn it on."
        className="text-[9.5px] font-bold text-slate-400 hover:text-[#4b2c83] cursor-pointer"
      >
        Auto off
      </button>
    );
  }

  let text = '';
  let tone = 'text-[#4b2c83] bg-[#faf5ff] border-[#e9d5ff]';
  switch (status.state) {
    case 'before': text = `Auto TIMED · starts in ${countdown(status.startMs - now)}`; break;
    case 'armed': text = now < status.dropMs ? `Auto TIMED · armed · ${countdown(status.dropMs - now)}` : 'Auto TIMED · armed'; break;
    case 'notready':
      text = 'Auto TIMED · not ready';
      tone = 'text-amber-800 bg-amber-50 border-amber-300';
      break;
    default: return null; // off, stopped, late
  }

  return (
    <button
      type="button"
      onClick={() => toggle(true)}
      title="Auto TIMED starts TIMED for you at the admin's time. Tap to turn it off in this window."
      className={`text-[9.5px] font-extrabold font-mono px-1.5 py-0.5 rounded-full border whitespace-nowrap cursor-pointer ${tone}`}
    >
      {text}
    </button>
  );
}
