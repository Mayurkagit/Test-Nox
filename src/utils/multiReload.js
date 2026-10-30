// Multi-Reload engine: reloads the DDA page until it genuinely loads, then stops.
//
// Success is decided from what the browser reports, not from guesswork:
//   1. the navigation must COMMIT with a good HTTP status (a 4xx/5xx "database error" page, a failed
//      connection or Chrome's own error page all count as failures),
//   2. the page must finish loading,
//   3. its content must pass a check (on step2_form: the flat grid must be present and no error text).
// Once the page is good the loop simply stops: the page's own scripts (preload) already ran on that load,
// so the normal Step 2 flow carries on by itself.
//
// Navigation facts come from the store (DdaWebview writes lastNavInfo on did-navigate / did-fail-load and
// lastStopInfo on did-stop-loading), which keeps this module free of React and easy to test.

const ERROR_PATTERNS = [
  '502 bad gateway',
  '503 service',
  '504 gateway',
  'gateway time-out',
  'gateway timeout',
  'service unavailable',
  '500 internal',
  'internal server error',
  'server error',
  'database error',
  'database connection',
  'error establishing a database connection',
  'sqlstate',
  'whoops',
  'too many connections',
  'pdoexception',
  'queryexception',
  'an error occurred while processing your request',
  "this site can't be reached",
  'err_connection',
];

// Runs INSIDE the webview. Returns { ok, reason, redirected? }.
export function buildPageCheckScript(expectStep2) {
  return `(() => {
    try {
      const href = String(location.href || '');
      const title = String(document.title || '').toLowerCase();
      const text = String((document.body && (document.body.innerText || document.body.textContent)) || '').slice(0, 6000).toLowerCase();
      const patterns = ${JSON.stringify(ERROR_PATTERNS)};
      if (/^chrome-error:/i.test(href)) return { ok: false, reason: 'browser error page' };
      const hit = patterns.find((p) => title.includes(p) || text.includes(p));
      if (hit) return { ok: false, reason: 'error page ("' + hit + '")' };
      const isStep2 = /\\/step2_form\\//i.test(href);
      const hasGrid = !!document.querySelector('.building, .floorblock');
      const hasContent = !!document.querySelector('table, .midarea, .boxshadowcontainer, form, nav, .navbar, .header');
      if (${expectStep2 ? 'true' : 'false'}) {
        if (!isStep2) return { ok: false, redirected: true, reason: 'redirected to ' + href };
        return hasGrid ? { ok: true, reason: 'flat grid present' } : { ok: false, reason: 'flat grid missing' };
      }
      return hasContent ? { ok: true, reason: 'page content present' } : { ok: false, reason: 'blank page' };
    } catch (e) {
      return { ok: false, reason: 'check failed: ' + (e && e.message) };
    }
  })()`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} deps
 * @param {{ getState: Function, subscribe: Function }} deps.store     useAutomationStore (needs lastNavInfo/lastStopInfo + setIsMultiReloading/setMultiReloadAttempt)
 * @param {() => any} deps.getWebview                                   returns the webview handle (stop/reloadIgnoringCache/reload/executeJavaScript)
 * @param {(type: string, source: string, msg: string) => void} deps.addLog
 * @param {object} [deps.timing]                                        overridable for tests
 * @param {() => Promise<number>} [deps.getRateWaitMs]                   ms to wait before the next flat-page load
 */
export function createMultiReloadEngine(deps) {
  const { store, getWebview, addLog, timing = {} } = deps;
  const T = {
    // 15s, the same limit step2Resolver allows a request: under booking load DDA answered in 1-9s
    // (20 Oct), and on a slow line a page that would have arrived at 10s was being stopped and
    // reloaded at 8s, so the loop could never succeed while still spending the 60-a-minute budget.
    navTimeoutMs: 15000, // no response at all within this -> treat as a hung server and retry
    stopTimeoutMs: 15000, // committed but never finished loading
    checkTimeoutMs: 3000,
    // A page that committed but is still arriving has no flat grid yet: look again before
    // calling it a failure, instead of reloading a page that was nearly there.
    recheckTries: 3,
    recheckDelayMs: 1000,
    retryDelayMs: 250,
    ...timing,
  };

  // After this many straight failures on a step2_form page, stop reloading the
  // same (possibly dead) URL and rebuild a fresh one via the locality cascade.
  // 0 / no onCascadeFallback disables it (behaviour then unchanged).
  const cascadeFallbackAfter = Number.isFinite(timing.cascadeFallbackAfter) ? timing.cascadeFallbackAfter : 20;
  const onCascadeFallback = typeof deps.onCascadeFallback === 'function' ? deps.onCascadeFallback : null;
  // ms to wait before the next flat-page request (DDA's 60-a-minute limit, tracked in main); optional
  const getRateWaitMs = typeof deps.getRateWaitMs === 'function' ? deps.getRateWaitMs : null;
  const rateWait = async () => {
    try {
      const v = await Promise.race([getRateWaitMs(), sleep(500).then(() => 0)]);
      return Number(v) > 0 ? Math.min(Number(v), 70000) : 0;
    } catch (_) {
      return 0;
    }
  };

  let running = false;
  let runId = 0;
  let attempt = 0;

  const setAttempt = (n) => {
    attempt = n;
    try {
      store.getState().setMultiReloadAttempt(n);
    } catch (_) {}
  };

  const waitForEvent = (selector, since, timeoutMs) =>
    new Promise((resolve) => {
      let done = false;
      let unsub = () => {};
      const timer = setTimeout(() => finish(null), timeoutMs);
      function finish(v) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          unsub();
        } catch (_) {}
        resolve(v);
      }
      unsub = store.subscribe((state) => {
        const v = selector(state);
        if (v && v.ts >= since) finish(v);
      });
      const cur = selector(store.getState());
      if (cur && cur.ts >= since) finish(cur);
    });

  const runCheck = async (expectStep2) => {
    try {
      const wv = getWebview();
      if (!wv || typeof wv.executeJavaScript !== 'function') return null;
      return await Promise.race([
        wv.executeJavaScript(buildPageCheckScript(expectStep2)),
        sleep(T.checkTimeoutMs).then(() => null),
      ]);
    } catch (_) {
      return null;
    }
  };

  const finishRun = () => {
    running = false;
    try {
      store.getState().setIsMultiReloading(false);
      store.getState().setMultiReloadAttempt(0);
    } catch (_) {}
  };

  async function loop(myRun, targetUrl, opts = {}) {
    const alive = () => running && runId === myRun;
    let expectStep2 = /\/step2_form\//i.test(targetUrl || '');
    let failsSinceCascade = 0; // consecutive failures since the last cascade rebuild
    const runStartedAt = Date.now();
    const maxDurationMs = Number(opts.maxDurationMs) > 0 ? Number(opts.maxDurationMs) : 0;

    while (alive()) {
      // Automatic runs give up after a while so a window never reloads unattended forever
      if (maxDurationMs && Date.now() - runStartedAt >= maxDurationMs) {
        finishRun();
        addLog('WARN', 'Recovery', `⏹️ Multi-Reload stopped after ${maxDurationMs >= 60000 ? Math.round(maxDurationMs / 60000) + ' minutes' : Math.round(maxDurationMs / 1000) + 's'} without the page loading — press Multi-Reload to try again.`);
        return;
      }
      // DDA refuses a login's 61st flat-page request in a minute (HTTP 429), so space them out
      if (expectStep2 && getRateWaitMs) {
        const waitMs = await rateWait();
        if (!alive()) return;
        if (waitMs > 0) {
          if (waitMs >= 2000) addLog('INFO', 'Recovery', `⏳ [Multi-Reload] DDA allows 60 flat-page loads a minute - waiting ${Math.ceil(waitMs / 1000)}s so the next one isn't refused...`);
          const until = Date.now() + waitMs;
          while (alive() && Date.now() < until) await sleep(Math.min(100, until - Date.now()));
          if (!alive()) return;
        }
      }
      const startedAt = Date.now();

      // After enough straight failures on a step2 page, reloading the same URL
      // is unlikely to help (the built URL may be stale). Rebuild a fresh one
      // via the locality cascade and switch to it, instead of reloading again.
      let navigatedByFallback = false;
      if (expectStep2 && onCascadeFallback && cascadeFallbackAfter > 0 && failsSinceCascade >= cascadeFallbackAfter) {
        addLog('ACTION', 'Recovery', `🔁 [Multi-Reload] ${failsSinceCascade} failures in a row — rebuilding the flat-page link via the locality cascade...`);
        let fresh = null;
        try {
          fresh = await onCascadeFallback(targetUrl, alive); // must not open the link if stopped meanwhile
        } catch (err) {
          addLog('WARN', 'Recovery', `Cascade rebuild error: ${err?.message || err}`);
        }
        if (!alive()) return;
        failsSinceCascade = 0;
        if (fresh && typeof fresh === 'string') {
          targetUrl = fresh;
          expectStep2 = /\/step2_form\//i.test(fresh);
          navigatedByFallback = true; // onCascadeFallback already navigated the webview
          addLog('ACTION', 'Recovery', `➡️ [Multi-Reload] Rebuilt the flat-page link; loading it...`);
        } else {
          addLog('WARN', 'Recovery', `Could not rebuild the link now; still retrying the current page.`);
        }
      }

      if (!navigatedByFallback) {
        addLog('ACTION', 'Recovery', `⚡ [Multi-Reload #${attempt}] Reloading ${expectStep2 ? 'Step 2 page' : 'page'}...`);

        const wv = getWebview();
        try {
          wv?.stop?.();
        } catch (_) {}
        try {
          // exactly ONE reload command per attempt. A normal reload always asks DDA for the page
          // again (DDA sends it "no-cache", and error pages are never cached), while DDA's
          // unchanged stylesheets and scripts come from this PC's cache instead of being
          // downloaded again from a struggling server on every attempt.
          if (typeof wv?.reload === 'function') wv.reload();
          else wv?.reloadIgnoringCache?.();
        } catch (_) {}
      }

      let failReason = '';

      // 1) did the navigation commit with a good status?
      const nav = await waitForEvent((s) => s.lastNavInfo, startedAt, T.navTimeoutMs);
      if (!alive()) return;
      if (!nav) failReason = `no response within ${Math.round(T.navTimeoutMs / 1000)}s (server hung)`;
      else if (nav.failed) failReason = `connection failed (${nav.errorDescription || nav.errorCode})`;
      else if (/^chrome-error:/i.test(nav.url || '')) failReason = 'browser error page';
      else if (nav.code && nav.code >= 400) failReason = `HTTP ${nav.code}`;

      // 2) page finished loading + 3) content check
      if (!failReason) {
        await waitForEvent((s) => s.lastStopInfo, startedAt, T.stopTimeoutMs);
        if (!alive()) return;
        // Look again a few times: on a slow line the body is still arriving when the first
        // check runs, and a missing flat grid then means "not yet", not "broken page".
        let chk = null;
        for (let look = 1; look <= Math.max(1, T.recheckTries); look++) {
          chk = await runCheck(expectStep2);
          if (!alive()) return;
          if (chk && (chk.ok || chk.redirected)) break;
          if (look < Math.max(1, T.recheckTries)) {
            await sleep(T.recheckDelayMs);
            if (!alive()) return;
          }
        }
        if (chk && chk.ok) {
          const n = attempt;
          finishRun();
          addLog('SUCCESS', 'Recovery', `✅ [Multi-Reload #${n}] Page loaded correctly (${chk.reason}). Normal flow continues.`);
          return;
        }
        if (chk && chk.redirected) {
          finishRun();
          addLog('WARN', 'Recovery', `⏹️ Multi-Reload stopped: ${chk.reason}. Reloading cannot fix this (session / navigation changed).`);
          return;
        }
        failReason = (chk && chk.reason) || 'could not verify the page';
      }

      // failed attempt -> short pause, retry
      failsSinceCascade += 1;
      setAttempt(attempt + 1);
      addLog('WARN', 'Recovery', `⚠️ [Multi-Reload #${attempt - 1}] ${failReason}. Retrying #${attempt} in ${T.retryDelayMs}ms...`);
      await sleep(T.retryDelayMs);
    }
  }

  return {
    isRunning: () => running,
    // opts.maxDurationMs: give up after this long (automatic runs); 0/absent = until it loads or Stop
    start(targetUrl = '', opts = {}) {
      if (running) return false;
      running = true;
      runId += 1;
      setAttempt(1);
      try {
        store.getState().setIsMultiReloading(true);
      } catch (_) {}
      addLog('ACTION', 'Recovery', '⚡ Multi-Reload active: reloading until the page loads correctly...');
      loop(runId, targetUrl, opts).catch((err) => {
        addLog('WARN', 'Recovery', `Multi-Reload error: ${err?.message || err}`);
        finishRun();
      });
      return true;
    },
    stop(reason = 'user') {
      const was = running;
      runId += 1; // invalidates the running loop
      if (was) finishRun();
      if (was && reason === 'user') addLog('INFO', 'Recovery', '⏹️ Multi-Reload loop stopped by user.');
      return was;
    },
  };
}
