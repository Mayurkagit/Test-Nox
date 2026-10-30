// Main-process Step 2 direct-URL resolver.
//
// Builds https://eservices.dda.org.in/user/step2_form/<scheme>/<loc>/<sector>/<pocket>/<block>/<tower>
// by walking DDA's own locality cascade (step1_form HTML -> searchSector -> searchpocketbysector ->
// blockbypocket -> searchtowerbyblock) using the webview's own session (cookies) via session.fetch().
//
// It runs in the main process so it survives page navigations (the Schemes page navigates away the
// instant the Apply link is captured, which aborts any in-page fetch). Matching logic is a port of
// smartMatchPrefOptions()/parseSelectOptions() from preload-dda.js and must stay in sync with it.

const DDA_ORIGIN = 'https://eservices.dda.org.in';

// ─── Text matching (port of preload-dda.js) ──────────────────────────────

// A sector written as a range has several spellings for the same sector:
// "SECTOR G-2 & G-6", "G2 - G6", "G2-G6", "G2 & G6", "G-2 AND G-6",
// "A1 TO A4", "A1-A4". sectorRangeKey turns each into the same key
// ("G2 G6", "A1 A4"): the word SECTOR dropped, every letter joined to its
// number, and "&" / AND / TO / "," / "/" / dashes read as separators. Names
// that aren't such a range (BLOCK A, TOWER B, POCKET 3, SECTOR 11) get no key
// and are matched as before. matchBySectorKey accepts only an option with
// exactly the same key, and only when one option has it.
export function sectorRangeKey(text) {
  let s = String(text || "").toUpperCase();
  s = s.replace(/\b(SECTOR|SEC)\b\.?/g, " ").replace(/\b(AND|TO)\b/g, " ").replace(/[&,/]/g, " ");
  s = s.replace(/\b([A-Z])\s*[-–—_.]?\s*(\d+)\b/g, "$1$2");
  const parts = s.replace(/[-–—_.]/g, " ").split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.every((p) => /^[A-Z]\d+$/.test(p)) ? parts.join(" ") : "";
}

function matchBySectorKey(options, targetName, nameOf) {
  const key = sectorRangeKey(targetName);
  if (!key || !options || !options.length) return null;
  const hits = options.filter((o) => sectorRangeKey(nameOf(o)) === key);
  return hits.length === 1 ? hits[0] : null;
}

function normalizePrefText(text) {
  if (typeof text !== 'string') return '';
  return text
    .trim()
    .replace(/[-_–—/\\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function extractPrefNumber(text) {
  const match = String(text || '').match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function toPrefRoman(num) {
  // 1 to 39: I, V and X only, so a block or tower letter (L, C, D, M)
  // is never read as a number
  if (!Number.isInteger(num) || num < 1 || num > 39) return null;
  let out = "";
  for (const [v, r] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) {
    while (num >= v) { out += r; num -= v; }
  }
  return out;
}

export function smartMatchPrefOptions(options, targetName) {
  if (!options || !options.length) return null;
  const target = String(targetName || '').trim();
  if (!target) return null;

  const normTarget = normalizePrefText(target);
  const targetNum = extractPrefNumber(target);
  const romanTarget = targetNum ? toPrefRoman(targetNum) : null;

  // 1. Exact or normalized match
  let match = options.find((o) => o.name === target || normalizePrefText(o.name) === normTarget);
  if (match) return match;

  // 1b. Same sector range, however it is written ("G-2 & G-6" = "G2 - G6")
  match = matchBySectorKey(options, target, (o) => o.name);
  if (match) return match;

  // Strict number constraint: "Pocket 4" must match a candidate containing 4 or IV
  const candidateOptions =
    targetNum !== null
      ? options.filter((o) => {
          const num = extractPrefNumber(o.name);
          const norm = normalizePrefText(o.name);
          return num === targetNum || (romanTarget && norm.split(/[^A-Z0-9]+/).includes(romanTarget));
        })
      : options;

  if (!candidateOptions.length) return null;

  // 2. Clean token match ("BLOCK B" matches "B", "PKT 4" matches "4")
  const cleanTarget = normTarget.replace(/\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\b/g, '').trim();
  if (cleanTarget) {
    match = candidateOptions.find((o) => {
      const cleanOpt = normalizePrefText(o.name).replace(/\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\b/g, '').trim();
      return cleanOpt === cleanTarget;
    });
    if (match) return match;
  }

  // 3. Roman numeral match
  if (romanTarget) {
    match = candidateOptions.find((o) => normalizePrefText(o.name).split(/[^A-Z0-9]+/).includes(romanTarget));
    if (match) return match;
  }

  // 4. Forward includes match (never reverse substring)
  match = candidateOptions.find((o) => {
    const normOpt = normalizePrefText(o.name);
    return normOpt.includes(normTarget) || normOpt.startsWith(normTarget);
  });
  if (match) return match;

  // 5. Word-boundary match
  if (cleanTarget) {
    const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp('(^|\\s|[^A-Z0-9])' + escaped + '($|\\s|[^A-Z0-9])', 'i');
    match = candidateOptions.find((o) => wordRegex.test(normalizePrefText(o.name)));
    if (match) return match;
  }

  return null;
}

// ─── HTML <option> parsing (Node has no DOMParser) ───────────────────────

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function parseOptionsFromHtml(html) {
  const out = [];
  if (!html) return out;
  const re = /<option\b([^>]*)>([\s\S]*?)(?=<\/option>|<option\b|<\/select>|$)/gi;
  let m;
  while ((m = re.exec(String(html))) !== null) {
    const attrs = m[1] || '';
    const text = decodeEntities(m[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    const valueMatch = attrs.match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawValue = valueMatch ? valueMatch[1] ?? valueMatch[2] ?? valueMatch[3] ?? '' : text;
    out.push({ hash: decodeEntities(rawValue).trim(), name: text.toUpperCase() });
  }
  return out;
}

function filterRealOptions(options) {
  return options.filter((o) => o.hash && o.hash !== '0' && !o.name.includes('SELECT'));
}

// Mirrors parseSelectOptions(): the AJAX endpoints answer with JSON whose html lives in one of these keys.
export function parseSelectOptions(rawInput) {
  if (!rawInput) return [];
  const str =
    typeof rawInput === 'object'
      ? rawInput.sector || rawInput.pocket || rawInput.block || rawInput.tower || rawInput.data || rawInput.html || rawInput.raw || ''
      : String(rawInput);
  if (!str) return [];
  return filterRealOptions(parseOptionsFromHtml(str));
}

// Locality options from the step1_form page: prefer <select id/name="locality">, else any <select>.
export function parseLocalityOptions(html) {
  const str = String(html || '');
  const selects = [...str.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)];
  const preferred = selects.find((s) => /\b(?:id|name)\s*=\s*["']?locality["'\s>]/i.test(s[1]));
  const source = preferred ? preferred[2] : selects.map((s) => s[2]).join('\n');
  return filterRealOptions(parseOptionsFromHtml(source));
}

// ─── Resolver ────────────────────────────────────────────────────────────

function cleanStr(v, max = 120) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * @param {object} opts
 * @param {Electron.Session} opts.ses            Session of the webview (carries the DDA login cookies)
 * @param {string} opts.schemeId                 Hash from the Apply link (/userApplicationfrom/<schemeId>)
 * @param {{loc:string,sec:string,poc:string,blk:string,twr?:string}} opts.targets
 * @param {string} opts.csrfToken
 * @param {string} [opts.referer]
 * @param {number} [opts.requestTimeoutMs]
 * @param {number} [opts.deadlineMs]             Overall deadline for the whole chain
 * @param {string} [opts.baseUrl]                Override for tests
 * @returns {Promise<{ok:boolean,url?:string,hashes?:object,durationMs:number,reason?:string}>}
 */
export async function resolveStep2Url(opts) {
  const started = Date.now();
  const fail = (reason) => ({ ok: false, reason, durationMs: Date.now() - started });

  const base = opts.baseUrl || DDA_ORIGIN;
  const schemeId = cleanStr(opts.schemeId, 60);
  const t = opts.targets || {};
  const targetLoc = cleanStr(t.loc);
  const targetSec = cleanStr(t.sec);
  const targetPoc = cleanStr(t.poc);
  const targetBlk = cleanStr(t.blk);
  const targetTwr = cleanStr(t.twr || '');
  // The token can come from the page that asked; if that page had none (DDA's
  // error page), it is read from the step1_form page below. No token, no POST:
  // DDA logs the session out on a POST without one.
  let csrfToken = cleanStr(opts.csrfToken, 300);
  const referer = opts.referer || `${base}/user/schemeList`;

  if (!opts.ses || typeof opts.ses.fetch !== 'function') return fail('no-session-fetch');
  if (!schemeId) return fail('no-scheme-id');
  // Direct step2_form URLs require at least locality, sector, pocket and block
  if (!targetLoc || !targetSec || !targetPoc || !targetBlk) return fail('incomplete-preferences');

  // Under booking load each DDA step took 1-9 s (20 Oct); a 9 s limit on the
  // whole chain cut off chains one step from done. Each request gets 15 s, the
  // chain as long as it keeps getting answers (2 min at most), and a failed
  // step is asked again without redoing the steps before it.
  const requestTimeoutMs = opts.requestTimeoutMs || 15000;
  const deadline = AbortSignal.timeout(opts.deadlineMs || 120000);
  const stepTries = opts.stepTries || 5;
  const retryDelayMs = opts.retryDelayMs ?? 1000;

  const baseHeaders = {
    Origin: base,
    Referer: referer,
    'X-Requested-With': 'XMLHttpRequest',
  };

  const signalFor = () => AbortSignal.any([deadline, AbortSignal.timeout(requestTimeoutMs)]);

  // A request DDA did not answer properly. final: asking again won't help
  // (a redirect = scheme not open / not valid / session gone; a 4xx).
  class StepError extends Error {
    constructor(message, final) {
      super(message);
      this.final = final;
    }
  }

  // One step, asked again on a DDA error, no answer or an empty list; the
  // steps before it are kept. An empty list on a 200 counts as a DDA hiccup.
  async function step(label, run, listOf) {
    let last;
    for (let i = 1; i <= stepTries; i++) {
      if (deadline.aborted) break;
      try {
        const out = await run();
        if (listOf && !listOf(out).length) throw new StepError(`empty list from ${label}`, false);
        return out;
      } catch (err) {
        last = err;
        if (err instanceof StepError && err.final) throw err;
        if (deadline.aborted) break;
        if (i < stepTries) {
          try { opts.trace?.(`retry ${label} (${err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'no answer' : err?.message || err}) ${i}/${stepTries - 1}`); } catch (_) {}
          await new Promise((r) => setTimeout(r, Math.min(retryDelayMs * i, 3000)));
        }
      }
    }
    throw last || new Error(`${label} failed`);
  }

  // Optional trace of each request's start/end (opts.trace): these run on the
  // page's own DDA session, so their timing vs the flat page's captcha load
  // matters (DDA's session is rewritten by whichever request finishes last).
  async function traced(label, run) {
    const t0 = Date.now();
    let status = 'error';
    try {
      const res = await run();
      status = res.status;
      return res;
    } finally {
      try {
        opts.trace?.(`${label} start=${new Date(t0).toISOString().slice(11, 23)} took=${Date.now() - t0}ms status=${status}`);
      } catch (_) {}
    }
  }

  async function getText(path) {
    const res = await traced(`GET ${path}`, () => opts.ses.fetch(`${base}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers: { ...baseHeaders, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      signal: signalFor(),
    }));
    if (res.redirected) throw new StepError(`redirected on GET ${path}`, true);
    if (!res.ok) throw new StepError(`HTTP ${res.status} on GET ${path}`, res.status < 500);
    return res.text();
  }

  async function postAjax(endpoint, data) {
    const body = new URLSearchParams();
    body.append('_token', csrfToken);
    for (const [k, v] of Object.entries(data)) body.append(k, v);
    const res = await traced(`POST /user/${endpoint}`, () => opts.ses.fetch(`${base}/user/${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual', // never follow DDA's bounce to /admin; the non-200 stops the build
      headers: { ...baseHeaders, 'X-CSRF-TOKEN': csrfToken, Accept: 'application/json, text/javascript, */*; q=0.01' },
      body,
      signal: signalFor(),
    }));
    // A redirect here (DDA sends a bad POST to /admin) means the session is in trouble: stop.
    if (res.redirected || (res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
      throw new StepError(`redirected on POST ${endpoint}`, true);
    }
    if (!res.ok) throw new StepError(`HTTP ${res.status} on POST ${endpoint}`, res.status < 500);
    const raw = await res.text();
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }

  // Shared tree of DDA's lists (step2Tree.js, opts.tree = { get, put }): a level
  // whose list is known and holds the preference costs no request. A preference
  // the kept list does not hold is asked from DDA (the list may have changed).
  const tree = opts.tree || null;
  let levelsFromTree = 0;
  const fromTree = (level, parent, target) => {
    try {
      const kept = tree?.get(level, parent);
      const m = kept ? smartMatchPrefOptions(kept.options, target) : null;
      if (m && m.hash) {
        levelsFromTree++;
        return m;
      }
    } catch (_) {}
    return null;
  };
  const keep = (level, parent, options) => {
    try { tree?.put(level, parent, options); } catch (_) {}
  };

  let step1Html = null;
  const loadStep1 = async () => {
    if (step1Html == null) {
      step1Html = await step('locality page', () => getText(`/user/step1_form/${encodeURIComponent(schemeId)}`), parseLocalityOptions);
      keep('loc', '', parseLocalityOptions(step1Html));
    }
    return step1Html;
  };
  // A POST needs the token; when the page had none, it is read from step1_form
  const ensureToken = async () => {
    if (csrfToken) return true;
    const html = await loadStep1();
    const m = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/name=["']_token["'][^>]+value=["']([^"']+)["']/i);
    csrfToken = m ? cleanStr(m[1], 300) : '';
    return Boolean(csrfToken);
  };

  try {
    // 1. LOCALITY (from the step1_form page)
    let locMatch = fromTree('loc', '', targetLoc);
    if (!locMatch) {
      // "not-matched" only when DDA sent a real list without the preference
      locMatch = smartMatchPrefOptions(parseLocalityOptions(await loadStep1()), targetLoc);
      if (!locMatch || !locMatch.hash) return fail(`locality-not-matched:${targetLoc}`);
    }
    const locHash = locMatch.hash;

    // 2. SECTOR
    let secMatch = fromTree('sec', locHash, targetSec);
    if (!secMatch) {
      if (!(await ensureToken())) return fail('no-csrf-token');
      const secRes = await step('sector list', () => postAjax('searchSector', { locality: locHash, locality_id: locHash, scheme_id: schemeId }), parseSelectOptions);
      keep('sec', locHash, parseSelectOptions(secRes));
      secMatch = smartMatchPrefOptions(parseSelectOptions(secRes), targetSec);
      if (!secMatch || !secMatch.hash) return fail(`sector-not-matched:${targetSec}`);
    }
    const secHash = secMatch.hash;

    // 3. POCKET
    const pocParent = `${locHash}/${secHash}`;
    let pocMatch = fromTree('poc', pocParent, targetPoc);
    if (!pocMatch) {
      if (!(await ensureToken())) return fail('no-csrf-token');
      const pocRes = await step('pocket list', () => postAjax('searchpocketbysector', {
        locality_id: locHash, locality: locHash, sector_id: secHash, sector: secHash, scheme_id: schemeId,
      }), parseSelectOptions);
      keep('poc', pocParent, parseSelectOptions(pocRes));
      pocMatch = smartMatchPrefOptions(parseSelectOptions(pocRes), targetPoc);
      if (!pocMatch || !pocMatch.hash) return fail(`pocket-not-matched:${targetPoc}`);
    }
    const pocHash = pocMatch.hash;

    // 4. BLOCK
    const blkParent = `${pocParent}/${pocHash}`;
    let blkMatch = fromTree('blk', blkParent, targetBlk);
    if (!blkMatch) {
      if (!(await ensureToken())) return fail('no-csrf-token');
      const blkRes = await step('block list', () => postAjax('blockbypocket', {
        locality_id: locHash, locality: locHash, sector_id: secHash, sector: secHash,
        pocket_id: pocHash, pocket: pocHash, scheme_id: schemeId,
      }), parseSelectOptions);
      keep('blk', blkParent, parseSelectOptions(blkRes));
      blkMatch = smartMatchPrefOptions(parseSelectOptions(blkRes), targetBlk);
      if (!blkMatch || !blkMatch.hash) return fail(`block-not-matched:${targetBlk}`);
    }
    const blkHash = blkMatch.hash;

    // 5. TOWER (only when the applicant specified one)
    let twrHash = '0';
    if (normalizePrefText(targetTwr)) {
      const twrParent = `${blkParent}/${blkHash}`;
      let twrMatch = fromTree('twr', twrParent, targetTwr);
      if (!twrMatch) {
        if (!(await ensureToken())) return fail('no-csrf-token');
        const twrRes = await step('tower list', () => postAjax('searchtowerbyblock', {
          scheme_id: schemeId, locality_id: locHash, locality: locHash, sector_id: secHash, sector: secHash,
          pocket_id: pocHash, pocket: pocHash, block_id: blkHash, block: blkHash,
        }), parseSelectOptions);
        keep('twr', twrParent, parseSelectOptions(twrRes));
        twrMatch = smartMatchPrefOptions(parseSelectOptions(twrRes), targetTwr);
        if (!twrMatch || !twrMatch.hash) return fail(`tower-not-matched:${targetTwr}`);
      }
      twrHash = twrMatch.hash;
    }

    const url = `${base}/user/step2_form/${schemeId}/${locHash}/${secHash}/${pocHash}/${blkHash}/${twrHash}`;
    // Same shape the preload stores in localStorage["dda_locality_hashes"]
    const hashes = {
      schemeId: String(schemeId),
      localityHash: locHash,
      sectorHash: secHash,
      pocketHash: pocHash,
      blockHash: blkHash,
      towerHash: twrHash,
      localityName: targetLoc,
      sectorName: targetSec,
      pocketName: targetPoc,
      blockName: targetBlk,
      towerName: targetTwr,
    };
    return { ok: true, url, hashes, durationMs: Date.now() - started, levelsFromTree };
  } catch (err) {
    if (err?.final) return fail(`stopped:${err.message}`);
    return fail(err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : `error:${err?.message || err}`);
  }
}
