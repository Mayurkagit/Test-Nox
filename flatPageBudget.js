// DDA allows each login 60 flat-page (/user/step2_form/...) requests a minute: page loads,
// Multi-Reload and Search polls all count (the locality cascade does not). Request 61 gets
// HTTP 429 "Too Many Requests" until that minute is over. Every response carries
// X-RateLimit-Limit / X-RateLimit-Remaining; a 429 adds Retry-After (seconds). Measured 17 Oct 2026.
//
// One budget per DDA window. Main tells it when each flat-page request is sent and feeds it every response; Multi-Reload and Search
// ask it how long to wait before their next request. It spreads what is left of the minute
// evenly over the requests left (keeping `reserve` back for a reload or the user), and after a
// 429 waits out Retry-After. Without headers (DDA turns the limit off) it never makes anyone wait.

export function createFlatPageBudget({ now = () => Date.now(), windowMs = 60000, reserve = 2, safetyMs = 300 } = {}) {
  let limit = 0;
  let remaining = null; // null = DDA has not told us (no limit known)
  let windowEnd = 0; // when our estimate of DDA's current minute is over
  let blockedUntil = 0; // after a 429
  let lastAt = 0; // last flat-page response
  let lastSentAt = 0; // last flat-page request sent (spacing counts from here, so the reply time doesn't add to it)
  let inFlight = []; // send times not answered yet (not in DDA's remaining count we last saw);
  // a request that was cancelled or failed never answers, so entries also expire after 10 s
  const pruneInFlight = (t) => { inFlight = inFlight.filter((x) => t - x < 10000); };

  return {
    // a flat-page request was just sent
    sent() {
      lastSentAt = now();
      inFlight.push(lastSentAt);
    },

    // a flat-page request failed or was cancelled (no response will come)
    failed() {
      inFlight.shift();
    },

    // status: HTTP status; headers already picked out: { limit, remaining, retryAfter } (strings or numbers)
    note(status, { limit: lim, remaining: rem, retryAfter } = {}) {
      const t = now();
      lastAt = t;
      inFlight.shift();
      if (Number(lim) > 0) limit = Number(lim);
      if (Number(status) === 429) {
        // DDA rounds Retry-After down to whole seconds (3 when 3.6 s were left), so add one
        const ra = retryAfter === '' || retryAfter == null ? NaN : Number(retryAfter);
        blockedUntil = t + (Number.isFinite(ra) && ra >= 0 ? (ra + 1) * 1000 : windowMs) + safetyMs;
        remaining = 0;
        windowEnd = Math.max(windowEnd, blockedUntil);
        return;
      }
      if (rem === '' || rem == null || !Number.isFinite(Number(rem))) return;
      const r = Number(rem);
      // first request of a new minute (DDA counts from the first request; our clock starts at its
      // response, so our minute ends a little after DDA's, which is the safe side)
      if (t >= windowEnd || (limit && r === limit - 1)) windowEnd = t + windowMs + safetyMs;
      remaining = r;
    },

    // ms to wait before the next flat-page request (0 = go now)
    waitMs() {
      const t = now();
      if (blockedUntil > t) return blockedUntil - t;
      if (remaining == null || t >= windowEnd) return 0;
      pruneInFlight(t);
      const usable = remaining - reserve - inFlight.length;
      if (usable <= 0) return windowEnd - t;
      // spread what is left evenly from the last send to the end of the minute
      const from = Math.max(lastSentAt, 0) || lastAt;
      const gap = (windowEnd - from) / usable;
      return Math.max(0, Math.round(from + gap - t));
    },

    state() {
      return { limit, remaining, windowEnd, blockedUntil, lastAt, lastSentAt, inFlight: inFlight.length };
    },
  };
}

// Picks the rate-limit headers out of an Electron webRequest responseHeaders object
export function rateHeaders(responseHeaders) {
  const h = responseHeaders || {};
  const get = (name) => {
    const k = Object.keys(h).find((x) => x.toLowerCase() === name);
    return k ? String([].concat(h[k])[0] ?? '') : '';
  };
  return {
    limit: get('x-ratelimit-limit'),
    remaining: get('x-ratelimit-remaining'),
    retryAfter: get('retry-after'),
    reset: get('x-ratelimit-reset'),
  };
}
