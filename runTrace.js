// Run trace: a full, read-only record of every DDA run, from the schemes page
// to the bank and back, so the booking-day flow (above all how DDA confirms a
// payment) can be studied afterwards.
//
//   userData/runs/<YYYY-MM-DD>/trace.log         one line per event, all accounts
//   userData/runs/<YYYY-MM-DD>/pages/<time>_<who>_<page>/
//       page.txt   visible text of the page and of every frame (BillDesk iframe)
//       page.html  the page HTML, card / CVV / OTP / password values blanked
//       shot.jpg   what the page looked like
//
// Nothing here clicks, types or delays anything; pages are only read. Files
// stay on this computer. Card numbers, CVV, OTP and passwords are never
// written (inputs are read by name, never by value).

import fs from 'fs';
import path from 'path';

let rootDir = null;
const labels = new Map(); // webview webContents.id -> account label (DDA login PAN)
const lastSnapshotAt = new Map(); // `${wcId} ${url}` -> ts
const watchState = new Map(); // wcId -> { popup, timerMin, timer }

const pad = (n, w = 2) => String(n).padStart(w, '0');
const dayStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStamp = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;

export function initRunTrace(userDataDir) {
  rootDir = path.join(userDataDir, 'runs');
}

export function runsDir() {
  return rootDir;
}

function dayDir() {
  const dir = path.join(rootDir, dayStamp());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function labelFor(wcId) {
  return labels.get(wcId) || (wcId ? `wc${wcId}` : '-');
}

export function setRunLabel(wcId, pan) {
  const clean = String(pan || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!wcId || !clean || labels.get(wcId) === clean) return;
  labels.set(wcId, clean);
  runTrace(wcId, 'ACCOUNT', `browser tab wc${wcId} is DDA login ${clean}`);
}

// One line: local time, account, kind, message. Never throws.
export function runTrace(wcId, kind, msg) {
  if (!rootDir) return;
  try {
    const line = `${timeStamp()} [${labelFor(wcId)}] ${kind} ${String(msg ?? '').replace(/\s+/g, ' ').trim()}\n`;
    fs.appendFileSync(path.join(dayDir(), 'trace.log'), line);
  } catch (_) {}
}

// Address without the query string or fragment (tokens live there).
export function cleanUrl(u) {
  try {
    const x = new URL(u);
    return x.host + x.pathname + (x.search ? '?…' : '');
  } catch (_) {
    return String(u || '').split('?')[0].slice(0, 160);
  }
}

// Short page name for folder names: DDA path segment, else the host.
function pageName(u) {
  try {
    const x = new URL(u);
    if (/(^|\.)dda\.org\.in$/i.test(x.hostname)) {
      const seg = x.pathname.split('/').filter(Boolean).filter((s) => s.toLowerCase() !== 'user')[0];
      return (seg || 'login').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'dda';
    }
    return x.hostname.replace(/[^a-z0-9.-]/gi, '').slice(0, 40);
  } catch (_) {
    return 'page';
  }
}

// Runs inside the page (read-only): visible text plus HTML with secret input
// values blanked.
const SNAPSHOT_SCRIPT = `(() => {
  const SECRET = /card|cvv|cvc|otp|pin|pass|expiry|exp_|expm|expy|mm|yy|secret|token/i;
  const text = (document.body && document.body.innerText) || '';
  let html = '';
  try {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('input, textarea').forEach((el) => {
      const key = [el.name, el.id, el.type, el.autocomplete, el.placeholder].join(' ');
      if (el.type === 'password' || SECRET.test(key)) {
        el.setAttribute('value', '***');
        if (el.tagName === 'TEXTAREA') el.textContent = '***';
      }
    });
    clone.querySelectorAll('script').forEach((s) => { if (!s.src && s.textContent.length > 20000) s.textContent = '/* long script cut */'; });
    html = '<!doctype html>\\n' + clone.outerHTML;
  } catch (e) { html = 'HTML read failed: ' + e.message; }
  return { title: document.title, url: location.href, text: text.slice(0, 300000), html: html.slice(0, 3000000) };
})()`;

// Popups and DDA's hold countdown, read once a second.
const WATCH_SCRIPT = `(() => {
  const vis = (el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const pick = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => e.innerText.trim()).filter(Boolean);
  const popups = pick('.swal2-popup.swal2-show, .swal-modal, .sweet-alert.visible, .modal.show .modal-content, .modal.in .modal-content, .alert, .toast.show');
  let timer = '';
  for (const el of document.querySelectorAll('#time, span.timer, #timer, .timer')) {
    const t = (el.textContent || '').trim();
    if (vis(el) && /^\\d{1,2}\\s*:\\s*\\d{2}$/.test(t)) { timer = t; break; }
  }
  return { popup: popups.join(' || ').slice(0, 1500), timer };
})()`;

function writeSnapshot(contents, tag) {
  if (!rootDir || contents.isDestroyed()) return;
  const wcId = contents.id;
  let url = contents.getURL();
  if (!url || url.startsWith('about:') || url.startsWith('chrome')) return;

  const now = new Date();
  // Named after the page actually read: a page change can land between the
  // timer and the read.
  const folderFor = (u) => path.join(
    dayDir(),
    'pages',
    `${timeStamp(now).replace(/[:.]/g, '')}_${labelFor(wcId)}_${pageName(u)}${tag ? '_' + tag : ''}`,
  );
  let folder = folderFor(url);

  (async () => {
    try {
      // Flat page: screenshot only. Reading its DOM would run in the page
      // while the flat / captcha race is on.
      if (/step2_form/i.test(url)) {
        fs.mkdirSync(folder, { recursive: true });
        const img = await contents.capturePage();
        if (!img.isEmpty()) fs.writeFileSync(path.join(folder, 'shot.jpg'), img.toJPEG(70));
        runTrace(wcId, 'SNAPSHOT', `${cleanUrl(url)} (screenshot only) -> pages/${path.basename(folder)}`);
        return;
      }
      let main = null;
      try {
        main = await contents.executeJavaScript(SNAPSHOT_SCRIPT, false);
      } catch (e) {
        main = { title: '', url, text: `Page read failed: ${e.message}`, html: '' };
      }
      if (main?.url && main.url !== url) {
        url = main.url;
        // Changed to the flat page meanwhile: keep nothing from that read.
        if (/step2_form/i.test(url)) return;
        folder = folderFor(url);
      }
      fs.mkdirSync(folder, { recursive: true });

      // Frames (BillDesk's iframe, bank frames): text of each.
      const parts = [
        `URL: ${cleanUrl(url)}`,
        `Title: ${main?.title || ''}`,
        `Saved: ${now.toISOString()}`,
        '',
        main?.text || '',
      ];
      try {
        const frames = contents.mainFrame?.framesInSubtree || [];
        for (const frame of frames) {
          if (frame === contents.mainFrame) continue;
          try {
            const f = await frame.executeJavaScript(SNAPSHOT_SCRIPT);
            parts.push('', `===== FRAME ${cleanUrl(f?.url || frame.url)} =====`, f?.text || '');
            if (f?.html) fs.writeFileSync(path.join(folder, `frame_${pageName(f.url || frame.url)}.html`), f.html);
          } catch (_) {
            parts.push('', `===== FRAME ${cleanUrl(frame.url)} (not readable) =====`);
          }
        }
      } catch (_) {}

      fs.writeFileSync(path.join(folder, 'page.txt'), parts.join('\n'));
      if (main?.html) fs.writeFileSync(path.join(folder, 'page.html'), main.html);
      try {
        const img = await contents.capturePage();
        if (!img.isEmpty()) fs.writeFileSync(path.join(folder, 'shot.jpg'), img.toJPEG(70));
      } catch (_) {}
      runTrace(wcId, 'SNAPSHOT', `${cleanUrl(url)} -> pages/${path.basename(folder)}`);
    } catch (e) {
      runTrace(wcId, 'SNAPSHOT-FAILED', `${cleanUrl(url)} ${e.message}`);
    }
  })();
}

// Snapshot a page soon after it loads and again a few seconds later (pages
// that fill in by script, DDA's timer popup). The same address is saved at
// most once per 10 s, so a reload loop does not flood the disk.
function scheduleSnapshots(contents) {
  const url = contents.getURL();
  const key = `${contents.id} ${url.split('#')[0]}`;
  const last = lastSnapshotAt.get(key) || 0;
  if (Date.now() - last < 10000) return;
  lastSnapshotAt.set(key, Date.now());
  setTimeout(() => {
    if (!contents.isDestroyed() && contents.getURL() === url) writeSnapshot(contents, 'a');
  }, 1200);
  setTimeout(() => {
    if (!contents.isDestroyed() && contents.getURL() === url) writeSnapshot(contents, 'b');
  }, 6000);
}

// Hook one DDA <webview>.
export function attachRunTrace(contents) {
  const wcId = contents.id;

  contents.on('did-navigate', (_e, url, httpCode, httpStatus) => {
    runTrace(wcId, 'PAGE', `${cleanUrl(url)} http=${httpCode || '-'} ${httpStatus || ''}`);
  });
  contents.on('did-frame-navigate', (_e, url, httpCode, _status, isMainFrame) => {
    if (!isMainFrame) runTrace(wcId, 'FRAME', `${cleanUrl(url)} http=${httpCode || '-'}`);
  });
  contents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) runTrace(wcId, 'PAGE-INPAGE', cleanUrl(url));
  });
  contents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (code === -3) return; // aborted by a newer navigation
    runTrace(wcId, 'LOAD-FAILED', `${isMainFrame ? 'page' : 'frame'} ${cleanUrl(url)} ${code} ${desc}`);
  });
  contents.on('did-finish-load', () => {
    runTrace(wcId, 'LOADED', `${cleanUrl(contents.getURL())} title="${contents.getTitle()}"`);
    scheduleSnapshots(contents);
  });
  contents.on('render-process-gone', (_e, details) => {
    runTrace(wcId, 'CRASHED', `${details?.reason || ''} exit=${details?.exitCode ?? ''}`);
  });

  // Popups and the hold countdown: logged when they change.
  const timer = setInterval(async () => {
    if (contents.isDestroyed()) return clearInterval(timer);
    if (!/^https:/.test(contents.getURL())) return;
    try {
      const r = await contents.executeJavaScript(WATCH_SCRIPT, false);
      const st = watchState.get(wcId) || {};
      if (r.popup && r.popup !== st.popup) {
        runTrace(wcId, 'POPUP', `${cleanUrl(contents.getURL())} "${r.popup}"`);
        writeSnapshot(contents, 'popup');
      }
      st.popup = r.popup;
      const min = r.timer ? r.timer.split(':')[0].trim() : '';
      if (r.timer && (min !== st.timerMin || !st.timer)) runTrace(wcId, 'HOLD-TIMER', `${r.timer} on ${cleanUrl(contents.getURL())}`);
      if (!r.timer && st.timer) runTrace(wcId, 'HOLD-TIMER', `gone (last ${st.timer}) on ${cleanUrl(contents.getURL())}`);
      st.timerMin = min;
      st.timer = r.timer;
      watchState.set(wcId, st);
    } catch (_) {}
  }, 1000);
  contents.once('destroyed', () => {
    clearInterval(timer);
    watchState.delete(wcId);
  });
}
