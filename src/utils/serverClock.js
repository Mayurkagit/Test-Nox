// This PC's offset from the Worker's clock (server - PC, in ms), for Auto TIMED.
// The Worker's GET /time answers with its own clock; the sample with the
// shortest round trip is the most exact (the answer was made about halfway).

import { WORKER_BASE_URL } from '../services/api';

let offsetMs = null;
let rttMs = null;
let syncedAt = 0;

// One sample: t0 before the request, t1 after, serverMs from the answer
export const sampleOffset = (t0, t1, serverMs) => ({
  offset: serverMs - (t0 + t1) / 2,
  rtt: t1 - t0,
});

// The sample with the shortest round trip
export const bestSample = (samples) =>
  samples.reduce((best, s) => (!best || s.rtt < best.rtt ? s : best), null);

export const getServerOffsetMs = () => offsetMs;
export const getServerClockInfo = () => ({ offsetMs, rttMs, syncedAt });
export const serverNow = () => Date.now() + (offsetMs || 0);

// "server 21:38:30.000 / PC 21:38:33.720 (offset -3720ms)" for TIMED trace lines
const hms = (ms) => {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};
export const clockStamp = () => {
  const pc = Date.now();
  return `server ${hms(pc + (offsetMs || 0))} / PC ${hms(pc)} (offset ${offsetMs == null ? 'unknown' : Math.round(offsetMs) + 'ms'})`;
};

// A TIMED line in the run trace (main process), with both clocks
export const timedTrace = (msg) => {
  try { window.ddaElectronAPI?.timedTrace?.(`${msg} — at ${clockStamp()}`); } catch (_) {}
};

// A few samples; keeps the old offset if none gets through. Returns the offset
// in ms, or null when the Worker could not be reached and none is known.
export async function syncServerClock({ tries = 3, fetchImpl = fetch, base = WORKER_BASE_URL, now = Date.now } = {}) {
  const samples = [];
  for (let i = 0; i < tries; i++) {
    try {
      const t0 = now();
      // Without a deadline one unanswered sample stalls all three and Auto TIMED silently
      // falls back to this PC's clock; a sample slower than 5 s is useless as a sample anyway.
      const res = await fetchImpl(`${base}/time`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const t1 = now();
      if (!res.ok) continue;
      const data = await res.json();
      if (typeof data?.now === 'number') samples.push(sampleOffset(t0, t1, data.now));
    } catch (_) { /* try again */ }
  }
  const best = bestSample(samples);
  if (best) {
    offsetMs = best.offset;
    rttMs = best.rtt;
    syncedAt = now();
  }
  return offsetMs;
}
