// Auto TIMED: the admin sets (runtime config) when every window starts TIMED
// and when it applies. This file is the decision logic only (no storage, no
// React), so it can be tested with a fake clock.
//
// Times are server milliseconds: the PC's clock plus its offset from the
// Worker's clock (serverClock.js), so a PC that is minutes off still starts and
// applies at the right moment.

// Nothing arms this close to the drop or after it: TIMED would roll to
// tomorrow. Press MANUAL instead.
export const AUTO_TIMED_NO_ARM_MS = 2000;

// { startAt, dropAt } (ISO) -> { startMs, dropMs, key } or null when not usable
export function parseSchedule(cfg) {
  if (!cfg || !cfg.startAt || !cfg.dropAt) return null;
  const startMs = new Date(cfg.startAt).getTime();
  const dropMs = new Date(cfg.dropAt).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(dropMs) || startMs >= dropMs) return null;
  return { startMs, dropMs, key: `${cfg.startAt}|${cfg.dropAt}` };
}

// The target time TIMED takes ("HH:MM:SS", this PC's clock) that falls on the
// true drop moment: the PC reaches it when the server reaches dropMs.
// offsetMs = server clock - PC clock.
export function localTargetTime(dropMs, offsetMs = 0) {
  const pcMs = Math.round((dropMs - (offsetMs || 0)) / 1000) * 1000;
  const d = new Date(pcMs);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// What this window should do now.
//   nowMs     server time
//   schedule  parseSchedule() result, or null (not set / switched off by admin)
//   ctx       { windowOff, stoppedKey, armedKey, onScheme, hasLogin, hasApplicant,
//               autofill, timedActive, searching }
// -> { action: 'arm' } or { action: 'none', state }, state being one of
//   off (no schedule or this window's switch is off), stopped, before,
//   armed (armed by this feature, or TIMED / a search already running),
//   late (too close to the drop or past it), notready (due, but the window
//   isn't on the schemes page logged in with an applicant and Autofill on)
export function decideAutoTimed({ nowMs, schedule, ctx = {} }) {
  if (!schedule) return { action: 'none', state: 'off' };
  if (ctx.windowOff) return { action: 'none', state: 'off' };
  if (ctx.stoppedKey === schedule.key) return { action: 'none', state: 'stopped' };
  if (ctx.armedKey === schedule.key || ctx.timedActive || ctx.searching) return { action: 'none', state: 'armed' };
  if (nowMs < schedule.startMs) return { action: 'none', state: 'before' };
  if (nowMs >= schedule.dropMs - AUTO_TIMED_NO_ARM_MS) return { action: 'none', state: 'late' };
  if (!ctx.onScheme || !ctx.hasLogin || !ctx.hasApplicant || ctx.autofill === false) {
    return { action: 'none', state: 'notready' };
  }
  return { action: 'arm' };
}
