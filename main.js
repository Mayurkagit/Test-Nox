// Electron Main Process for Northdesk
// Manages Multi-Applicant Isolated Partitions, Offline SQLite/JSON DB, and Dashboard

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

import electron from 'electron';
const { app, BrowserWindow, ipcMain, session, Menu, nativeImage, powerSaveBlocker, webContents, shell, safeStorage, dialog } = electron;
import { EventEmitter } from 'node:events';
EventEmitter.defaultMaxListeners = 50;
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from './db/database.js';
// The captcha solver (onnxruntime) is a native library that needs Microsoft's
// Visual C++ runtime. It is loaded on its own, so a PC where it can't load
// still runs the app; captchas are then typed by hand (every solver call
// already falls back to that when it reports success: false).
let captchaSolverError = '';
const captchaSolverReady = import('./engine/vision.js').catch((err) => {
  captchaSolverError = err?.message || String(err);
  console.error('❌ [Native ONNX] Captcha solver could not load; captchas must be typed:', captchaSolverError);
  return null;
});
const captchaSolverUnavailable = () => ({
  success: false,
  error: `Captcha solver not available on this PC: ${captchaSolverError}`,
});
async function initLocalCaptchaModel(...args) {
  const solver = await captchaSolverReady;
  return solver ? solver.initLocalCaptchaModel(...args) : null;
}
async function solveCaptchaTensor(...args) {
  const solver = await captchaSolverReady;
  return solver ? solver.solveCaptchaTensor(...args) : captchaSolverUnavailable();
}
async function solveCaptchaBase64(...args) {
  const solver = await captchaSolverReady;
  return solver ? solver.solveCaptchaBase64(...args) : captchaSolverUnavailable();
}

import { resolveStep2Url } from './step2Resolver.js';
import { initStep2Tree, treeFor, putLearnedPath, dropScheme as dropStep2Scheme, clearStep2Tree, saveNow as saveStep2Tree, summary as step2TreeSummary } from './step2Tree.js';
import { createFlatPageBudget, rateHeaders } from './flatPageBudget.js';
import { initRunTrace, runsDir, runTrace, setRunLabel, attachRunTrace, cleanUrl, labelFor } from './runTrace.js';
import { createRequire } from 'node:module';

// Placeholder photo / signature (see dda:blankImages below). Loaded so that a
// missing file can never stop the app from starting.
let placeholderImages = null;
try {
  placeholderImages = createRequire(import.meta.url)('./placeholderImages.cjs');
} catch (err) {
  console.warn('⚠️ Placeholder photo/signature not loaded:', err?.message || err);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// One data folder for every way the app runs: `npm run dev` is named
// "flat-book" (package.json name) but the packaged exe would be "Northdesk"
// (build.productName), which would start empty. Pin it to
// %APPDATA%\flat-book so the exe sees the saved card, bank logins,
// applicants and DDA sessions. Must run before anything reads userData.
app.setPath('userData', path.join(app.getPath('appData'), 'flat-book'));

// Strip bot detection automation flags
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// Payment gateways wrap BillDesk in a cross-site iframe (SBI: merchant.onlinesbi.sbi
// page + pay.billdesk.com #sdk-iframe). The DDA webview already runs with
// webSecurity=no, but with site isolation the iframe lives in another process
// and the top-frame preload cannot reach it, so Fast Payment could not pick the
// net-banking bank or fill the card there.
app.commandLine.appendSwitch('disable-site-isolation-trials');

// ⚡ Edge / Chromium High-Performance Engine Flags (macOS & Windows Parity)
// Disables background window throttling, timer deprioritization, and native occlusion sleep
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Hardware acceleration & low-latency rendering pipeline
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('use-angle', 'd3d11');
}
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,DirectComposition,NetworkService,NetworkServiceInProcess');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// V8 Turbo Engine & Fast API Calls
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096 --turbo-fast-api-calls');

// High-speed network stack: TCP Fast Open, QUIC, HTTP/2
app.commandLine.appendSwitch('enable-tcp-fastopen');
app.commandLine.appendSwitch('enable-tcp-fast-open');
app.commandLine.appendSwitch('enable-quic');
app.commandLine.appendSwitch('enable-http2');

let mainWindow = null;
const dashboardWindows = new Set();
const dashboardWebContentsIds = new Set();
let dashboardWindowsList = [];

function isAuthorizedDashboardCaller(event) {
  if (!event || !event.sender) return false;
  // 1. Must be a registered top-level dashboard window's webContents ID (never an attached webview guest)
  if (!dashboardWebContentsIds.has(event.sender.id)) {
    return false;
  }
  // 2. Must have a sender frame; reject if absent (fail closed)
  if (!event.senderFrame) {
    return false;
  }
  // 3. Must be the top-level frame (parent === null); reject subframes and iframes
  if (event.senderFrame.parent !== null) {
    return false;
  }
  return true;
}

function isAuthorizedDdaWebviewCaller(event) {
  if (!event?.sender) return false;
  // Must have a sender frame; reject if absent
  if (!event.senderFrame) return false;
  // Must be the top-level frame within the webview guest
  if (event.senderFrame.parent !== null) return false;
  // Must be hosted by a registered dashboard window
  const hostId = event.sender.hostWebContents?.id;
  if (!hostId || !dashboardWebContentsIds.has(hostId)) return false;
  // Must be serving the exact DDA portal hostname; reject empty or unknown URLs
  try {
    const rawUrl = event.sender.getURL();
    if (!rawUrl) return false;
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === 'eservices.dda.org.in';
  } catch (_) {
    return false;
  }
}

function updateDashboardWindowIndices() {
  dashboardWindowsList = dashboardWindowsList.filter(w => !w.isDestroyed());
  dashboardWindowsList.forEach((w, idx) => {
    const displayIndex = idx + 1;
    w.__ddaDisplayIndex = displayIndex;
    try {
      w.webContents.send('window:display-index-updated', displayIndex);
    } catch (_) {}
  });
}
const activeSessionWindows = new Map(); // pan -> BrowserWindow
// Per-applicant partitions actually opened by launchApplicantSession this run
// (the only ones that can hold a DDA login; sign-out clears just these)
const launchedApplicantPartitions = new Set();
const webviewToWindowMap = new Map(); // webContents.id -> BrowserWindow
const runTracedWebviews = new Set(); // DDA <webview> webContents ids (run trace)

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload Workspace',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.reload();
            }
          }
        },
        {
          label: 'Force Reload Workspace',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.reloadIgnoringCache();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Open Run Logs Folder',
          click: () => {
            try {
              fs.mkdirSync(runsDir(), { recursive: true });
              shell.openPath(runsDir());
            } catch (_) {}
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.toggleDevTools();
            }
          }
        },
        {
          label: 'Toggle Developer Tools (F12)',
          accelerator: 'F12',
          visible: false,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.toggleDevTools();
            }
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'DDA Portal Official Site',
          click: async () => {
            const { shell } = electron;
            await shell.openExternal('https://eservices.dda.org.in');
          }
        },
        {
          label: 'About Northdesk',
          click: () => {
            const { dialog } = electron;
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Northdesk',
              message: 'Northdesk',
              detail: 'Version 1.0.0'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── WINDOW LOCKS ACROSS CLOSES AND RESTARTS ───────────────────────────
// Each window keeps its login lock (and its DDA login) under its session id.
//  - A window closed while others stay open starts afresh: its lock, its
//    applicant choice and its DDA login are cleared.
//  - Only one lock outlives the app: the last window's when windows are
//    closed one by one; when several are open at quit (or after a crash), the
//    oldest open window that has a lock. Next time it is Window 1's lock
//    (moved there by the renderer, carryLockAfterRestart).
// window_state.json keeps the open windows in opening order, so the oldest
// is still known after a crash.
const WINDOW_IDENTITY_KEYS = [
  'dda_locked_login_pan',
  'dda_last_selected_login_pan',
  'dda_selected_login_pan',
  'dda_last_logged_in_pan',
  'dda_authenticated_pan',
  'dda_submitting_pan',
  'dda_active_applicant_pan',
  'dda_selected_person',
];
let openSessionOrder = [];
let lockCarryPlan = null; // { sessionId, previousOrder } for the first window
let appQuitting = false;
const pendingPartitionClears = new Map(); // sessionId -> Promise

function windowStateFile() {
  return path.join(app.getPath('userData'), 'dda_db', 'window_state.json');
}
function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')) || {};
  } catch (_) {
    return {};
  }
}
function saveOpenSessionOrder() {
  try {
    fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true });
    fs.writeFileSync(windowStateFile(), JSON.stringify({ openOrder: openSessionOrder }, null, 2));
  } catch (_) {}
}

// Removes DDA's cookies and site storage from one partition
async function clearDdaPartition(targetSession) {
  if (!targetSession) return;
  try {
    const cookies = await targetSession.cookies.get({ domain: 'dda.org.in' });
    for (const c of cookies) {
      const proto = c.secure ? 'https' : 'http';
      const domain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
      await targetSession.cookies.remove(`${proto}://${domain}${c.path}`, c.name).catch(() => {});
    }
  } catch (_) {}
  await targetSession.clearStorageData({ origin: 'https://eservices.dda.org.in' }).catch(() => {});
  await targetSession.clearStorageData({ storages: ['cookies'] }).catch(() => {});
}

// A window's DDA partition (the <webview> uses persist:dda_<sessionId>)
function clearWindowDdaLogin(sessionId) {
  const job = clearDdaPartition(session.fromPartition(`persist:dda_${String(sessionId).toLowerCase().replace(/[^a-z0-9_]/g, '')}`))
    .catch(() => {})
    .finally(() => {
      if (pendingPartitionClears.get(sessionId) === job) pendingPartitionClears.delete(sessionId);
    });
  pendingPartitionClears.set(sessionId, job);
  return job;
}

// Partitions of windows from earlier runs (every window but Window 1 starts
// afresh, so their DDA logins go)
function clearEarlierWindowLogins() {
  const ids = new Set();
  for (let n = 2; n <= 10; n++) ids.add(`session_${n}`);
  try {
    for (const name of fs.readdirSync(path.join(app.getPath('userData'), 'Partitions'))) {
      const m = /^dda_(session_\d+)$/.exec(name);
      if (m && m[1] !== 'session_1') ids.add(m[1]);
    }
  } catch (_) {}
  for (const id of ids) clearWindowDdaLogin(id);
}

// The lowest window number not open now
function nextFreeSessionId() {
  const used = new Set(dashboardWindowsList.filter((w) => !w.isDestroyed()).map((w) => w.__ddaSessionId));
  for (let n = 1; ; n++) {
    if (!used.has(`session_${n}`)) return `session_${n}`;
  }
}

app.on('before-quit', () => {
  appQuitting = true;
  saveStep2Tree();
});

function createDashboardWindow(preferredSessionId, { pick = false } = {}) {
  // The first window after none were open (app start, or macOS reopening):
  // it carries the one lock that outlived the windows before
  const firstOfRun = dashboardWindows.size === 0;
  const sessionId = preferredSessionId || nextFreeSessionId();
  if (firstOfRun) {
    const previousOrder = readWindowState().openOrder;
    lockCarryPlan = { sessionId, previousOrder: Array.isArray(previousOrder) ? previousOrder : null };
    openSessionOrder = [];
    appQuitting = false;
    clearEarlierWindowLogins();
  }
  openSessionOrder = [...openSessionOrder.filter((sid) => sid !== sessionId), sessionId];
  saveOpenSessionOrder();
  const initialDisplayIndex = dashboardWindowsList.length + 1;
  const appIconPath = path.join(__dirname, 'icon.png');
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 480,
    minHeight: 480,
    backgroundColor: '#0f172a',
    title: `Northdesk - Window ${initialDisplayIndex}`,
    icon: appIconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  win.on('page-title-updated', (event, title) => {
    event.preventDefault();
    if (title && title.startsWith('Northdesk')) {
      win.setTitle(title);
    } else {
      const currentIdx = win.__ddaDisplayIndex || initialDisplayIndex;
      win.setTitle(`Northdesk - Window ${currentIdx}`);
    }
  });

  win.__ddaSessionId = sessionId;
  win.__ddaDisplayIndex = initialDisplayIndex;
  dashboardWindows.add(win);
  dashboardWebContentsIds.add(win.webContents.id);
  dashboardWindowsList.push(win);
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = win;
  }

  win.webContents.on('did-finish-load', () => {
    updateDashboardWindowIndices();
  });

  try {
    win.webContents.setMaxListeners(50);
  } catch (_) {}

  win.setMenuBarVisibility(false);

  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    try {
      webPreferences.webSecurity = false;
      webPreferences.contextIsolation = false;
      webPreferences.allowRunningInsecureContent = true;
      webPreferences.nodeIntegrationInSubFrames = false; // Disables Node in subframes & payment iframes
    } catch (_) {}
  });

  win.webContents.on('did-attach-webview', (event, webviewWebContents) => {
    try {
      webviewToWindowMap.set(webviewWebContents.id, win);
      webviewWebContents.__ddaOwnerWindow = win;
      webviewWebContents.__ddaSessionId = sessionId;
      webviewWebContents.on('destroyed', () => {
        webviewToWindowMap.delete(webviewWebContents.id);
        ddaManualLogoutAt.delete(webviewWebContents.id);
        ddaReloginAt.delete(webviewWebContents.id);
        ddaReloginHistory.delete(webviewWebContents.id);
      });
      // A logout the user asked for (DDA's Logout link or the app's DDA Logout) always goes
      // through /user/logout; remembered so it is never taken for DDA ending the session.
      webviewWebContents.on('did-start-navigation', (details) => {
        try {
          if (details?.isMainFrame && /\/user\/logout/i.test(details.url || '')) {
            ddaManualLogoutAt.set(webviewWebContents.id, Date.now());
          }
        } catch (_) {}
      });
      // DDA ending the session sends the next page to its home page ("/") or /admin. Go straight
      // to the login page instead of loading those first (preload-dda.js "DDA logout recovery"
      // picks it up there via dda:takeRelogin and logs back in for the locked applicant).
      webviewWebContents.on('will-redirect', (event, legacyUrl, _inPlace, legacyIsMainFrame) => {
        try {
          const url = event?.url || legacyUrl || '';
          const isMainFrame = event?.isMainFrame ?? legacyIsMainFrame;
          if (!isMainFrame) return;
          const to = new URL(url);
          if (to.hostname !== 'eservices.dda.org.in') return;
          const p = to.pathname.toLowerCase().replace(/\/+$/, '');
          if (!(p === '' || p === '/admin' || p.startsWith('/admin/'))) return;
          if (!noteDdaRelogin(webviewWebContents.id)) return; // manual logout, or the 10-minute limit
          const where = p || '/';
          ddaReloginAt.set(webviewWebContents.id, { at: Date.now(), where });
          event.preventDefault();
          runTrace(webviewWebContents.id, 'DDA-LOGOUT', `redirect to ${where}: opening the login page`);
          setImmediate(() => {
            if (!webviewWebContents.isDestroyed()) {
              webviewWebContents.loadURL('https://eservices.dda.org.in/user').catch(() => {});
            }
          });
        } catch (_) {}
      });
    } catch (_) {}
  });

  // Intercept window.open calls: ensure dashboard popups spawn controlled windows & block dangerous schemes
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.includes('5173') || url.includes('dist/index.html')) {
      createDashboardWindow();
      return { action: 'deny' };
    }
    // Block dangerous non-web schemes (file:, javascript:, data:, custom protocols)
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        console.warn('[Security] Blocked non-web protocol popup:', url);
        return { action: 'deny' };
      }
    } catch (_) {
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Shortcut for Developer Tools (F12) even when menu bar is hidden
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  // pick=1: a window opened with "+" starts on the applicant picker
  const pickParam = pick ? '&pick=1' : '';
  const devServerUrl = `http://localhost:5173?winSession=${sessionId}${pickParam}`;
  const distPath = path.join(__dirname, 'dist', 'index.html');
  const legacyRendererPath = path.join(__dirname, 'renderer', 'index.html');

  const search = `?winSession=${sessionId}${pickParam}`;
  const loadRenderer = () => {
    if (win.isDestroyed()) return;
    if (isDev) {
      win.loadURL(devServerUrl).catch(() => {
        if (fs.existsSync(distPath)) {
          win.loadFile(distPath, { search });
        } else {
          win.loadFile(legacyRendererPath, { search });
        }
      });
    } else if (fs.existsSync(distPath)) {
      win.loadFile(distPath, { search });
    } else {
      win.loadFile(legacyRendererPath, { search });
    }
  };
  // A window number just freed may still have its old DDA login being cleared
  const pendingClear = pendingPartitionClears.get(sessionId);
  if (pendingClear) pendingClear.finally(loadRenderer);
  else loadRenderer();

  // Windows shutting down / signing out: treat like quitting (keep the locks
  // for the restart rule rather than clearing them window by window)
  win.on('query-session-end', () => { appQuitting = true; });
  win.on('session-end', () => { appQuitting = true; });

  // Capture now: webContents is already destroyed by the time 'closed' fires
  const winWebContentsId = win.webContents.id;
  win.on('closed', () => {
    dashboardWindows.delete(win);
    dashboardWebContentsIds.delete(winWebContentsId);
    dashboardWindowsList = dashboardWindowsList.filter(w => w !== win && !w.isDestroyed());
    if (mainWindow === win) {
      mainWindow = dashboardWindowsList.length > 0 ? dashboardWindowsList[0] : null;
    }
    updateDashboardWindowIndices();
    // Closed while other windows stay open: this window number starts afresh
    // (the last window, or windows closing at quit, keep their locks)
    if (!appQuitting && dashboardWindowsList.length > 0) {
      openSessionOrder = openSessionOrder.filter((sid) => sid !== sessionId);
      saveOpenSessionOrder();
      const keys = WINDOW_IDENTITY_KEYS.map((k) => `${sessionId}::${k}`);
      dashboardWindowsList[0].webContents
        .executeJavaScript(`(() => { try { for (const k of ${JSON.stringify(keys)}) localStorage.removeItem(k); } catch (_) {} })()`)
        .catch(() => {});
      clearWindowDdaLogin(sessionId);
    }
    if (dashboardWindows.size === 0) {
      // Close all applicant browser windows when all main dashboards close
      for (const [pan, sessionW] of activeSessionWindows.entries()) {
        if (!sessionW.isDestroyed()) sessionW.close();
      }
      activeSessionWindows.clear();
    }
  });

  return win;
}

// ─── HIGH-SPEED NETWORK OPTIMIZATIONS & TRACKER SHIELD ─────────────────

const TRACKER_PATTERNS = [
  '*://*.google-analytics.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.clarity.ms/*',
  '*://*.doubleclick.net/*',
  '*://*.facebook.net/*',
  '*://stats.wp.com/*'
];

// The last "Too Many Requests" (429) per DDA webview: when, and DDA's Retry-After in seconds
const ddaRetryAfter = new Map(); // webContents id -> { at, seconds }

// ─── Hold page address ───
// DDA's hold page loads at /user/getlayout/<6 codes>/<flat code>, then its own
// script shortens the address to /user/getlayout/<6 codes>/. Reloading that
// shortened address answers 404 and the hold page is gone (flat 43, 20 Oct).
// The full address of each webview's last hold page is kept, and a page load
// of its shortened form goes to the full one instead.
const HOLD_URL_TTL_MS = 16 * 60 * 1000; // DDA's hold is 15 minutes
const lastHoldUrl = new Map(); // webContents id -> { url, at }
const HOLD_FULL_RE = /^\/user\/getlayout\/(?:[A-Za-z0-9]+\/){6}[A-Za-z0-9]+\/?$/;
const HOLD_SHORT_RE = /^\/user\/getlayout\/(?:[A-Za-z0-9]+\/){5}[A-Za-z0-9]+\/?$/;

function noteHoldPage(d) {
  try {
    if (d.webContentsId == null || d.resourceType !== 'mainFrame' || (d.method || 'GET') !== 'GET' || d.statusCode !== 200) return;
    const u = new URL(d.url);
    if (u.hostname !== 'eservices.dda.org.in' || !HOLD_FULL_RE.test(u.pathname)) return;
    if (!lastHoldUrl.has(d.webContentsId)) {
      try { webContents.fromId(d.webContentsId)?.once('destroyed', () => lastHoldUrl.delete(d.webContentsId)); } catch (_) {}
    }
    lastHoldUrl.set(d.webContentsId, { url: u.origin + u.pathname.replace(/\/$/, ''), at: Date.now() });
  } catch (_) {}
}

// The full hold address to load instead of d.url, or null
function fullHoldUrlFor(d) {
  try {
    if (d.webContentsId == null || d.resourceType !== 'mainFrame' || (d.method || 'GET') !== 'GET') return null;
    const u = new URL(d.url);
    if (u.hostname !== 'eservices.dda.org.in' || !HOLD_SHORT_RE.test(u.pathname)) return null;
    const hold = lastHoldUrl.get(d.webContentsId);
    if (!hold || Date.now() - hold.at > HOLD_URL_TTL_MS) return null;
    const prefix = u.origin + u.pathname.replace(/\/$/, '') + '/';
    return hold.url.startsWith(prefix) ? hold.url : null;
  } catch (_) {
    return null;
  }
}

// Every call to the Worker / Google gets a deadline. Without one a slow line does not fail, it
// hangs: the connection opens, nothing comes back, the promise never settles, and the catch below
// it - which already holds the right message and, for sign-in, a whole fallback path - never runs.
// The caller's await then waits for ever and the screen only spins.
const NET_TIMEOUT_MS = 8000;
const netSignal = (ms = NET_TIMEOUT_MS) => AbortSignal.timeout(ms);

// DDA's 60-a-minute flat-page limit, one budget per DDA webview (see flatPageBudget.js)
const flatPageBudgets = new Map(); // webContents id -> budget
function flatPageBudgetFor(id) {
  let b = flatPageBudgets.get(id);
  if (!b) {
    b = createFlatPageBudget();
    flatPageBudgets.set(id, b);
    try { webContents.fromId(id)?.once('destroyed', () => flatPageBudgets.delete(id)); } catch (_) {}
  }
  return b;
}

function setupSessionOptimizations(targetSession) {
  if (!targetSession || targetSession._ddaOptimized) return;
  targetSession._ddaOptimized = true;

  // Set realistic Desktop Chrome User-Agent across all sessions
  try {
    targetSession.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    );
  } catch (_) {}

  // 1. Block third-party trackers & analytics while strictly whitelisting core
  // endpoints; send a reload of the shortened hold page to its full address
  // (one onBeforeRequest listener per session, so both live here)
  try {
    targetSession.webRequest.onBeforeRequest({ urls: [...TRACKER_PATTERNS, '*://eservices.dda.org.in/user/getlayout/*'] }, (details, callback) => {
      const holdUrl = fullHoldUrlFor(details);
      if (holdUrl) {
        fastPayTrace(`HOLD-RELOAD wc=${details.webContentsId} shortened hold address -> full address`);
        return callback({ redirectURL: holdUrl });
      }
      const url = (details.url || '').toLowerCase();
      // Absolute Whitelist Guard: Never block DDA, Firebase, Worker, or local endpoints
      if (
        url.includes('eservices.dda.org.in') ||
        url.includes('firestore.googleapis.com') ||
        url.includes('identitytoolkit.googleapis.com') ||
        url.includes('firebaseio.com') ||
        url.includes('workers.dev') ||
        url.includes('localhost') ||
        url.includes('127.0.0.1')
      ) {
        return callback({ cancel: false });
      }
      callback({ cancel: true });
    });
  } catch (err) {
    console.warn('⚠️ [webRequest.onBeforeRequest] tracker block setup notice:', err.message);
  }

  // 2. DDA's static files (jQuery, Bootstrap, fonts, logo, spinner): 30 days for the page.
  // Note: this rewrite reaches the page, not Chromium's disk cache, which stores DDA's
  // own headers. Those have no expiry but an old Last-Modified, so the disk cache keeps
  // each file for ~10% of its age (months: they are unchanged since 2019-2023) without
  // asking DDA. The login page's warm-up (preload-dda.js, warmDdaStaticFiles) fills
  // that cache and re-checks it once a day.
  try {
    const STATIC_EXT_REGEX = /\.(js|css|woff2?|ttf|svg|png|jpe?g|gif)(\?.*)?$/i;
    const DYNAMIC_PATH_REGEX = /(captcha|search|store|form|applicant|api|login|step2_form|session)/i;

    targetSession.webRequest.onHeadersReceived((details, callback) => {
      try {
        const url = details.url || '';
        const method = (details.method || 'GET').toUpperCase();

        // A PDF opened as a page or in a new window: Chromium's
        // viewer shows it blank here (site isolation is off), so the load is
        // stopped and the same file is shown in the pdf.js viewer window.
        if (isPdfPageResponse(details, method)) {
          // Stopping first keeps the current page; a bare cancel would replace
          // it with Chromium's "blocked" error page.
          try { webContents.fromId(details.webContentsId)?.stop(); } catch (_) {}
          callback({ cancel: true });
          showPdfFromResponse(targetSession, details);
          return;
        }

        // Strict Whitelist: Only GET requests to DDA static assets
        if (
          method === 'GET' &&
          url.includes('eservices.dda.org.in') &&
          STATIC_EXT_REGEX.test(url) &&
          !DYNAMIC_PATH_REGEX.test(url)
        ) {
          const responseHeaders = { ...details.responseHeaders };
          responseHeaders['cache-control'] = ['public, max-age=2592000'];
          delete responseHeaders['pragma'];
          delete responseHeaders['expires'];
          return callback({ responseHeaders });
        }
      } catch (_) {}
      callback({ responseHeaders: details.responseHeaders });
    });
  } catch (err) {
    console.warn('⚠️ [webRequest.onHeadersReceived] static caching setup notice:', err.message);
  }

  // 3. Trace every DDA captcha image request (sent / done, cache flag). DDA
  // keeps one captcha per session and replaces it on each /captcha/ load; with
  // STEP2BUILD lines this shows overlaps behind "Invalid captcha code" on a
  // correct answer. Observe-only listeners; nothing is changed or delayed.
  //
  // 4. Trace DDA's own requests (REQ / REDIRECT lines): method, type, status,
  // redirect target. A session that DDA ends shows up as a request answered
  // with a redirect to "/" or the login page, so this names the request that
  // logged the user out. Static files, captcha images and the Step 2 polling
  // GETs are skipped to keep the log small. (One listener per event per
  // session, so captcha and request tracing share these.)
  try {
    const ddaFilter = { urls: ['*://eservices.dda.org.in/*'] };
    const key = (u) => String(u || '').split('/captcha/')[1] || '';
    const isCaptcha = (u) => String(u || '').includes('/captcha/');
    const pathOf = (u) => { try { const x = new URL(u); return x.pathname + (x.search ? '?…' : ''); } catch (_) { return String(u || '').slice(0, 80); } };
    const skipReq = (d) =>
      /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map)(\?|$)/i.test(d.url) ||
      ((d.method || 'GET') === 'GET' && /\/step2_form\//i.test(d.url) && d.resourceType !== 'mainFrame');
    const isFlatPageGet = (d) => d.webContentsId != null && (d.method || 'GET') === 'GET' && /\/user\/step2_form\//i.test(d.url);
    // 5. Per page: how DDA's static files (scripts, styles, fonts, images) arrived, as one
    // STATIC line ~3 s after the page's last one: from the disk cache, from DDA (with
    // the slowest), or failed. Files served from memory never reach these listeners.
    // Shows whether the 30-day cache and the login-page warm-up pay off on booking day.
    const STATIC_RE = /\.(js|css|png|jpe?g|gif|svg|woff2?|ttf)(\?|$)/i;
    const isDdaStatic = (d) => /^https?:\/\/eservices\.dda\.org\.in\//i.test(d.url || '') && STATIC_RE.test(d.url || '') && !isCaptcha(d.url) && (d.method || 'GET') === 'GET';
    const staticPage = new Map(); // wc -> current page path
    const staticStats = new Map(); // wc -> { page, cache, net, netMs, slowest, slowestMs, failed, timer }
    const staticSent = new Map(); // request id -> send time
    const staticName = (u) => { try { return new URL(u).pathname.split('/').pop(); } catch (_) { return ''; } };
    const flushStatic = (wc) => {
      const s = staticStats.get(wc);
      if (!s) return;
      clearTimeout(s.timer);
      staticStats.delete(wc);
      const total = s.cache + s.net + s.failed;
      if (!total) return;
      fastPayTrace(`STATIC wc=${wc} page=${s.page || '-'} files=${total} cache=${s.cache} dda=${s.net}` +
        (s.net ? ` (slowest ${s.slowest} ${s.slowestMs} ms)` : '') +
        (s.failed ? ` failed=${s.failed} [${s.failedNames.slice(0, 4).join(', ')}]` : ''));
    };
    const statFor = (wc) => {
      let s = staticStats.get(wc);
      if (!s) {
        s = { page: staticPage.get(wc) || '', cache: 0, net: 0, slowest: '', slowestMs: 0, failed: 0, failedNames: [], timer: null };
        staticStats.set(wc, s);
      }
      clearTimeout(s.timer);
      s.timer = setTimeout(() => flushStatic(wc), 3000);
      return s;
    };
    const noteStaticDone = (d) => {
      if (d.webContentsId == null || !isDdaStatic(d)) return;
      const s = statFor(d.webContentsId);
      const sentAt = staticSent.get(d.id);
      staticSent.delete(d.id);
      if (d.statusCode >= 400) { s.failed++; s.failedNames.push(`${staticName(d.url)} ${d.statusCode}`); return; }
      if (d.fromCache) { s.cache++; return; }
      s.net++;
      const ms = sentAt ? Math.round(d.timestamp - sentAt) : 0;
      if (ms >= s.slowestMs) { s.slowestMs = ms; s.slowest = staticName(d.url); }
    };
    const noteStaticFailed = (d) => {
      if (d.webContentsId == null || !isDdaStatic(d)) return;
      staticSent.delete(d.id);
      if (d.error === 'net::ERR_ABORTED') return;
      const s = statFor(d.webContentsId);
      s.failed++;
      s.failedNames.push(`${staticName(d.url)} ${d.error}`);
    };
    targetSession.webRequest.onSendHeaders(ddaFilter, (d) => {
      // A new DDA page in this window: report the previous page's files first
      if (d.resourceType === 'mainFrame' && d.webContentsId != null) {
        flushStatic(d.webContentsId);
        staticPage.set(d.webContentsId, pathOf(d.url));
      } else if (isDdaStatic(d)) {
        staticSent.set(d.id, d.timestamp);
      }
      if (isCaptcha(d.url)) fastPayTrace(`CAPTCHA-IMG sent ${key(d.url)} wc=${d.webContentsId ?? '-'}`);
      // the flat-page budget spaces requests from when they are sent
      try { if (isFlatPageGet(d)) flatPageBudgetFor(d.webContentsId).sent(); } catch (_) {}
    });
    // Bank / BillDesk requests of a DDA webview go to the run trace only
    // (pages, frames and calls; no static files, no query strings).
    const allFilter = { urls: ['<all_urls>'] };
    const isDda = (u) => /^https?:\/\/eservices\.dda\.org\.in\//i.test(String(u || ''));
    const isOtherTraced = (d) =>
      runTracedWebviews.has(d.webContentsId) && !isDda(d.url) && /^https?:/i.test(d.url) &&
      ['mainFrame', 'subFrame', 'xhr', 'fetch', 'other', 'ping'].includes(d.resourceType) &&
      !/\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map)(\?|$)/i.test(d.url);
    targetSession.webRequest.onBeforeRedirect(allFilter, (d) => {
      if (!isDda(d.url)) {
        if (isOtherTraced(d)) runTrace(d.webContentsId, 'NET-REDIRECT', `${d.method} ${d.resourceType} ${cleanUrl(d.url)} status=${d.statusCode} -> ${cleanUrl(d.redirectURL)}`);
        return;
      }
      if (isCaptcha(d.url) || skipReq(d)) return;
      fastPayTrace(`REDIRECT wc=${d.webContentsId ?? '-'} ${d.method} ${d.resourceType} ${pathOf(d.url)} status=${d.statusCode} -> ${pathOf(d.redirectURL)}`);
      try { recoverStaleLoginPage(d); } catch (_) {}
    });
    targetSession.webRequest.onErrorOccurred(allFilter, (d) => {
      try { if (isDda(d.url) && isFlatPageGet(d)) flatPageBudgets.get(d.webContentsId)?.failed(); } catch (_) {}
      try { noteStaticFailed(d); } catch (_) {}
      if (d.error === 'net::ERR_ABORTED' || !runTracedWebviews.has(d.webContentsId)) return;
      if (!isDda(d.url) && !isOtherTraced(d)) return;
      runTrace(d.webContentsId, 'NET-ERROR', `${d.method} ${d.resourceType} ${cleanUrl(d.url)} ${d.error}`);
    });
    targetSession.webRequest.onCompleted(allFilter, (d) => {
      noteHoldPage(d);
      // A flat-page link DDA does not know (404 / 400): the shared tree for its
      // scheme may be wrong, so it is dropped and the next build asks DDA again.
      // Not on 429 / 5xx (load) or redirects (session ended).
      try {
        if (d.resourceType === 'mainFrame' && (d.statusCode === 404 || d.statusCode === 400)) {
          const m = String(d.url || '').match(/\/user\/step2_form\/([A-Za-z0-9_-]+)\//i);
          if (m && dropStep2Scheme(m[1])) {
            for (const [k, e] of step2SharedCache) if (e.schemeId === m[1]) step2SharedCache.delete(k);
            fastPayTrace(`STEP2TREE wc=${d.webContentsId ?? '-'} DDA refused a flat-page link (HTTP ${d.statusCode}); shared tree for ${m[1]} dropped`);
          }
        }
      } catch (_) {}
      try { noteStaticDone(d); } catch (_) {}
      if (!isDda(d.url)) {
        if (isOtherTraced(d)) runTrace(d.webContentsId, 'NET', `${d.method} ${d.resourceType} ${cleanUrl(d.url)} status=${d.statusCode}`);
        return;
      }
      if (isCaptcha(d.url)) {
        fastPayTrace(`CAPTCHA-IMG done ${key(d.url)} wc=${d.webContentsId ?? '-'} status=${d.statusCode} fromCache=${d.fromCache}`);
        return;
      }
      // DDA's rate limit (429 "Too Many Requests"): log its headers so the trace shows the limit,
      // what counts toward it and when it resets. Every 429, plus the countdown every 10 and the last 10.
      try {
        const rh = rateHeaders(d.responseHeaders);
        const remaining = rh.remaining;
        const limit = Number(rh.limit);
        // feeds the window's flat-page budget (Multi-Reload and Search pace themselves by it)
        if (isFlatPageGet(d)) {
          flatPageBudgetFor(d.webContentsId).note(d.statusCode, rh);
        }
        // any DDA page refused with 429: remember how long DDA said to wait (the page asks)
        if (d.statusCode === 429 && d.webContentsId != null) {
          const ra = rh.retryAfter === '' ? NaN : Number(rh.retryAfter);
          ddaRetryAfter.set(d.webContentsId, { at: Date.now(), seconds: Number.isFinite(ra) && ra >= 0 ? ra : null });
        }
        if (d.statusCode === 429 || (remaining !== '' && (Number(remaining) <= 10 || Number(remaining) % 10 === 0 || Number(remaining) === limit - 1))) {
          fastPayTrace(`RATE wc=${d.webContentsId ?? '-'} ${d.method} ${d.resourceType} ${pathOf(d.url)} status=${d.statusCode} limit=${rh.limit || '-'} remaining=${remaining || '-'} retry-after=${rh.retryAfter || '-'} reset=${rh.reset || '-'}`);
        }
      } catch (_) {}
      // Step 2 polling GETs are skipped while they succeed; a refused one (429 / 5xx) is still logged
      if (skipReq(d) && d.statusCode < 400) return;
      fastPayTrace(`REQ wc=${d.webContentsId ?? '-'} ${d.method} ${d.resourceType} ${pathOf(d.url)} status=${d.statusCode}`);
    });
  } catch (err) {
    console.warn('⚠️ [webRequest captcha trace] setup notice:', err.message);
  }
}

// ─── MULTI-SESSION ISOLATED PARTITION LAUNCHER ─────────────────────────

function launchApplicantSession(pan) {
  const cleanPan = (pan || '').toUpperCase().trim();
  const applicant = db.getApplicantByPan(cleanPan);
  if (!applicant) throw new Error(`Applicant with PAN ${cleanPan} not found in offline DB`);

  // If window already open, focus it
  if (activeSessionWindows.has(cleanPan)) {
    const existing = activeSessionWindows.get(cleanPan);
    if (!existing.isDestroyed()) {
      existing.focus();
      return { success: true, alreadyRunning: true };
    }
  }

  // Create isolated session partition per applicant PAN
  const partitionKey = `persist:applicant_${cleanPan.toLowerCase()}`;
  launchedApplicantPartitions.add(partitionKey);
  const customSession = session.fromPartition(partitionKey);
  setupSessionOptimizations(customSession);

  // Prime isolated partition with warm TLS connections and DNS resolution
  try {
    customSession.preconnect({ url: 'https://eservices.dda.org.in', numSockets: 6 });
    customSession.resolveHost('eservices.dda.org.in').catch(() => {});
  } catch (_) {}

  // Set realistic desktop Chrome User-Agent
  customSession.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
  );

  const appIconPath = path.join(__dirname, 'icon.png');
  const sessionWin = new BrowserWindow({
    width: 1280,
    height: 850,
    title: `DDA Session — ${applicant.personal.firstName} ${applicant.personal.lastName} (${cleanPan})`,
    backgroundColor: '#ffffff',
    icon: appIconPath,
    autoHideMenuBar: true,
    session: customSession,
    webPreferences: {
      preload: path.join(__dirname, 'preload-dda.js'),
      contextIsolation: false, // Allows seamless DOM & page context automation
      nodeIntegration: false,
      sandbox: false
    }
  });

  try {
    sessionWin.webContents.setMaxListeners(50);
  } catch (_) {}

  sessionWin.setMenuBarVisibility(false);

  // Store active applicant in window-scoped metadata
  sessionWin.__ddaApplicantPan = cleanPan;
  sessionWin.__ddaApplicantData = applicant;

  sessionWin.loadURL('https://eservices.dda.org.in/user');

  activeSessionWindows.set(cleanPan, sessionWin);

  sessionWin.on('closed', () => {
    activeSessionWindows.delete(cleanPan);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:status-change', { pan: cleanPan, status: 'CLOSED' });
    }
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('session:status-change', { pan: cleanPan, status: 'RUNNING' });
  }

  return { success: true, pan: cleanPan };
}

// ─── IPC HANDLERS ──────────────────────────────────────────────────────

// 1. Offline Database & Authentication CRUD
ipcMain.handle('auth:login', (event, email, password) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  return db.loginUser(email, password);
});
ipcMain.handle('auth:validateBookingKey', async (event, key) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!key) return { success: false, error: 'Booking key is required.' };
  const cleanKey = String(key).trim().toUpperCase();

  // Real-time server validation strictly against Cloudflare Worker
  try {
    const workerUrl = process.env.VITE_WORKER_URL || 'https://dda-engine.asmrahul17.workers.dev';
    const idToken = verifiedSessionToken || '';
    const headers = {};
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    const res = await fetch(`${workerUrl}/extension/validate-key?key=${encodeURIComponent(cleanKey)}`, { headers, signal: netSignal() });
    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        key: cleanKey,
        scheme: data?.scheme || data?.targetScheme || 'DDA Housing Scheme 2026',
        mode: data?.mode || 'LIVE',
        windowEnd: data?.windowEnd || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        message: 'Booking key verified with server.'
      };
    }
    let errorMsg = 'Invalid booking key. Please verify with admin.';
    try {
      const errJson = await res.json();
      if (errJson?.error) errorMsg = errJson.error;
    } catch (_) {}
    return { success: false, error: errorMsg };
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    console.warn('[Main] Worker booking key validation network error:', err.message);
    return {
      success: false,
      error: timedOut
        ? `The key server did not answer within ${Math.round(NET_TIMEOUT_MS / 1000)}s. Check the internet connection and try again.`
        : 'Unable to connect to key validation server. Please check internet connection.'
    };
  }
});
ipcMain.handle('db:getApplicants', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!verifiedSessionUser) return [];
  if (verifiedSessionUser.isAdmin) {
    return db.getAllApplicants();
  }
  return db.getApplicantsByUser(verifiedSessionUser);
});
ipcMain.handle('db:getApplicantsByUser', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!verifiedSessionUser) return [];
  if (verifiedSessionUser.isAdmin) {
    return db.getAllApplicants();
  }
  return db.getApplicantsByUser(verifiedSessionUser);
});
ipcMain.handle('db:getApplicantByPan', (event, pan) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!verifiedSessionUser) return null;
  return db.getApplicantByPan(pan, verifiedSessionUser);
});
ipcMain.handle('db:saveApplicant', (event, appData) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!verifiedSessionUser) throw new Error('Unauthenticated: login required to save applicant');
  return db.saveApplicant(appData, verifiedSessionUser);
});
// Dashboard: the applicant list the cloud just returned, cached locally as
// the fallback for when the cloud is unreachable.
ipcMain.handle('db:cacheApplicants', (event, list, opts) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!verifiedSessionUser) return 0;
  return db.cacheApplicants(list, verifiedSessionUser, { full: Boolean(opts?.full) });
});
// Applicants removed in the cloud (or no longer this user's): drop their cached copy
ipcMain.handle('db:uncacheApplicants', (event, pans) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!verifiedSessionUser) return 0;
  return db.uncacheApplicants(pans, verifiedSessionUser);
});
// Flat preferences changed in the app (kept on this computer, per app user).
ipcMain.handle('db:getLocalPrefs', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  return verifiedSessionUser ? db.getLocalPrefs(verifiedSessionUser) : {};
});
ipcMain.handle('db:saveLocalPrefs', (event, pan, entry) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  return verifiedSessionUser ? db.saveLocalPrefs(pan, entry, verifiedSessionUser) : false;
});
ipcMain.handle('db:clearLocalPrefs', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  return verifiedSessionUser ? db.clearLocalPrefs(verifiedSessionUser) : false;
});
ipcMain.handle('db:deleteApplicant', (event, pan) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!verifiedSessionUser) return false;
  return db.deleteApplicant(pan, verifiedSessionUser);
});

// ─── PER-COMPUTER DDA LOGIN PROFILES ───────────────────────────────────
// Keep credentials in one writable file under Electron userData. The file is
// intentionally local to this installation and independent of app roles or
// applicant ownership records.
const getLoginUsersJsonPath = () => {
  const userDataPath = app ? app.getPath('userData') : process.cwd();
  return path.join(userDataPath, 'dda_db', 'login_profiles.json');
};

const findLegacyLoginUsersJsonPath = () => {
  const userDataPath = app ? app.getPath('userData') : process.cwd();
  const cwd = process.cwd();
  // Only this computer's own older files. Files that ship with the app (in
  // the project or the install folder) are never read: logins come from the
  // server now.
  void cwd;
  const candidatePaths = [
    path.join(userDataPath, 'users.json'),
    path.join(userDataPath, 'user.json'),
    path.join(userDataPath, 'dda_db', 'users.json'),
    path.join(userDataPath, 'dda_db', 'user.json'),
  ];

  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {}
  }
  return null;
};

ipcMain.handle('db:loadLoginUsers', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  try {
    const localPath = getLoginUsersJsonPath();
    const filePath = fs.existsSync(localPath) ? localPath : findLegacyLoginUsersJsonPath();
    if (filePath && fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const normalize = (u) => {
        if (!u) return null;
        const pan = (u.pan || u.PAN || u.username || u.userId || u.user || u.personal?.pan || '').toUpperCase().trim();
        if (!pan) return null;
        return {
          name: (u.name || u.Name || u.personal?.firstName || pan).trim(),
          pan,
          password: (u.password || u.Password || u.pass || u.pwd || u.personal?.password || '').trim(),
          ...(u.archived ? { archived: true } : {}),
          ...(u.localEdit ? { localEdit: true } : {})
        };
      };

      let list = null;
      if (Array.isArray(parsed)) {
        list = parsed.map(normalize).filter(Boolean);
      } else if (typeof parsed === 'object' && parsed !== null) {
        if (Array.isArray(parsed.users)) {
          list = parsed.users.map(normalize).filter(Boolean);
        } else {
          const asList = Object.entries(parsed).map(([k, v]) => {
            if (typeof v === 'string') return normalize({ pan: k, password: v });
            return normalize({ ...(v || {}), pan: v?.pan || k });
          }).filter(Boolean);
          if (asList.length > 0) list = asList;
        }
      }
      // Profiles found only in a legacy file: copy them to login_profiles.json
      // once, so later loads read (and never rewrite) that file.
      if (list && filePath !== localPath) {
        try {
          fs.mkdirSync(path.dirname(localPath), { recursive: true });
          fs.writeFileSync(localPath, JSON.stringify(list, null, 2), 'utf8');
          console.log(`💾 [Users JSON] Copied ${list.length} login profiles from ${path.basename(filePath)} to login_profiles.json.`);
        } catch (err) {
          console.warn('Could not copy legacy login profiles:', err.message);
        }
      }
      if (list) return list;
    }
  } catch (err) {
    console.warn('Could not load local DDA login profiles:', err);
  }
  return null;
});

ipcMain.handle('db:saveLoginUsers', (event, users) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  try {
    if (!Array.isArray(users)) return { success: false, error: 'Invalid users array' };
    const cleanList = users
      .map((u) => {
        const pan = (u.pan || u.PAN || u.username || u.personal?.pan || '').toUpperCase().trim();
        if (!pan) return null;
        return {
          name: (u.name || u.personal?.firstName || pan).trim(),
          pan,
          password: (u.password || u.personal?.password || '').trim(),
          ...(u.archived ? { archived: true } : {}),
          ...(u.localEdit ? { localEdit: true } : {}),
        };
      })
      .filter(Boolean);

    const filePath = getLoginUsersJsonPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cleanList, null, 2), 'utf8');

    console.log(`💾 [Users JSON] Saved ${cleanList.length} login profiles locally.`);
    return { success: true, count: cleanList.length, filePath };
  } catch (err) {
    console.error('Could not save local DDA login profiles:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('db:getSettings', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const win = getWindowFromSender(event.sender);
  const sessionId = win?.__ddaSessionId;
  return db.getSettings(sessionId);
});

ipcMain.handle('db:saveSettings', (event, s) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const win = getWindowFromSender(event.sender);
  const sessionId = win?.__ddaSessionId;
  const cleanSettings = { ...(s || {}) };
  delete cleanSettings.fastPaymentCard;
  delete cleanSettings.autoPaySubmitEnabled;
  const res = db.saveSettings(cleanSettings, sessionId);
  try {
    sendToSenderWindow(event.sender, 'session:settingsUpdated', cleanSettings);
    if (win && !win.isDestroyed()) {
      for (const wc of webContents.getAllWebContents()) {
        if (wc.__ddaOwnerWindow === win || (sessionId && wc.__ddaSessionId === sessionId)) {
          try {
            wc.send('session:settingsUpdated', cleanSettings);
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  return res;
});
ipcMain.handle('db:getBookingRuns', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  return db.getBookingRuns();
});
ipcMain.handle('db:saveBookingRun', (event, run) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  return db.saveBookingRun(run);
});

// Helper to format comprehensive human-readable forensic run audit log
function formatForensicLog(runData, payload) {
  const sep = '='.repeat(84);
  const lines = [];
  lines.push(sep);
  lines.push('DDA FAST BOOKING ENGINE — COMPLETE FORENSIC RUN AUDIT LOG');
  lines.push(sep);
  lines.push(`Run ID              : ${runData.id}`);
  lines.push(`Recorded At         : ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)`);
  lines.push(`ISO Timestamp       : ${runData.completedAt}`);
  lines.push(`User Account        : ${payload.userEmail || 'N/A'}`);
  lines.push(`Applicant Name      : ${runData.applicantName || 'Applicant'}`);
  lines.push(`Applicant PAN       : ${runData.applicantPan || 'N/A'}`);
  lines.push(`Target Scheme       : ${runData.scheme || 'N/A'}`);
  lines.push(`Target Flats        : ${Array.isArray(payload.targetFlats) ? payload.targetFlats.join(', ') : (payload.targetFlats || 'N/A')}`);
  lines.push(`Booked Flat         : ${runData.flatNo ? `Flat #${runData.flatNo}` : 'N/A'}`);
  if (runData.bookedFlat) {
    const bf = runData.bookedFlat;
    lines.push(`Locality Details    : ${[bf.locality, bf.sector, bf.pocket, bf.block, bf.tower].filter(Boolean).join(' • ') || 'N/A'}`);
  }
  lines.push(`Booking Status      : ${runData.status || 'SUCCESS'} (15-Minute Hold Reached)`);
  lines.push(`Hold Expiration     : ${runData.holdExpiresAt || 'N/A'}`);
  lines.push(`Total Elapsed Time  : ${runData.totalDurationSec}s (${runData.totalDurationMs} ms)`);
  lines.push(sep);
  lines.push('');
  lines.push('--- PIPELINE MILESTONES & STEP TIMINGS ---');
  const steps = runData.steps || {};
  for (const [stepKey, stepVal] of Object.entries(steps)) {
    if (stepVal) {
      const timeStr = stepVal.time || '';
      const dur = stepVal.durationMs !== undefined ? ` [took ${stepVal.durationMs}ms]` : '';
      lines.push(`• ${stepKey.padEnd(26)}: ${timeStr} - ${stepVal.message || 'Completed'}${dur}`);
    }
  }
  lines.push('');
  lines.push('--- ONNX CAPTCHA NEURAL SOLVER AUDIT ---');
  const captchas = runData.captchaAttempts || [];
  lines.push(`Total Solve Attempts: ${captchas.length}`);
  captchas.forEach((c, idx) => {
    lines.push(`  [Attempt #${idx + 1}] Expression: "${c.expression || c.text || 'N/A'}" | Solved Answer: "${c.answer ?? 'N/A'}" | Confidence: ${c.confidence ? (c.confidence * 100).toFixed(1) + '%' : 'N/A'} | Latency: ${c.solveTimeMs ? c.solveTimeMs + 'ms' : 'N/A'} | Engine: ${c.engine || 'Local ONNX'}`);
  });
  if (runData.lastCaptcha) {
    lines.push(`Last Captcha Result : Answer "${runData.lastCaptcha.answer ?? 'N/A'}" (${runData.lastCaptcha.solveTimeMs || 'N/A'}ms)`);
  }
  lines.push('');
  lines.push('--- COMPLETE CHRONOLOGICAL ACTIVITY TRACE (USER ACTIONS & AUTOMATION) ---');
  const logs = runData.logs || [];
  logs.forEach((l) => {
    const t = l.time || (l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '00:00:00');
    const lvl = (l.level || 'INFO').toUpperCase().padEnd(11);
    const page = (l.page || l.source || 'DDA').padEnd(12);
    const msg = l.msg || l.message || '';
    const pan = l.pan ? ` [${l.pan}]` : '';
    lines.push(`[${t}] [${lvl}] [${page}]${pan} ${msg}`);
  });
  lines.push('');
  lines.push(sep);
  lines.push('END OF FORENSIC RUN AUDIT LOG');
  lines.push(sep);
  return lines.join('\n');
}

// Phase 5: Analytics Pipeline Persistence (Local DB + Forensic Disk Log Export + Worker Cloud Fallback)
ipcMain.handle('analytics:save', async (event, payload) => {
  if (!isAuthorizedDashboardCaller(event) && !isAuthorizedDdaWebviewCaller(event)) {
    throw new Error('Unauthorized IPC caller');
  }
  try {
    const runData = {
      id: payload.runId || `run_${Date.now()}`,
      applicantPan: payload.applicantPan || payload.applicant?.pan || '',
      applicantName: payload.applicantName || '',
      flatNo: payload.bookedFlat?.flatNo || '',
      scheme: payload.scheme || payload.schemeName || '',
      status: 'SUCCESS',
      totalDurationMs: payload.totalDurationMs || 0,
      totalDurationSec: payload.totalDurationSec || 0,
      captchaAttempts: payload.captchaAttempts || [],
      lastCaptcha: payload.lastCaptcha || (payload.captchaAttempts?.length > 0 ? payload.captchaAttempts[payload.captchaAttempts.length - 1] : null),
      logs: payload.runLogs || payload.logs || [],
      steps: payload.steps || {},
      bookedFlat: payload.bookedFlat || {},
      holdExpiresAt: payload.holdExpiresAt || null,
      completedAt: payload.completedAt || new Date().toISOString()
    };

    const savedLocal = db.saveBookingRun(runData);

    // Write forensic .log and .json files directly to disk (dda_logs/runs/)
    let logFilePath = null;
    let jsonFilePath = null;
    let logFileName = null;
    try {
      const baseDir = app.isPackaged ? app.getPath('userData') : process.cwd();
      const logsDir = path.join(baseDir, 'dda_logs', 'runs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      const cleanPan = (runData.applicantPan || 'APP').replace(/[^a-zA-Z0-9]/g, '');
      const cleanName = (runData.applicantName || 'Applicant').replace(/[^a-zA-Z0-9_ ]/g, '').replace(/\s+/g, '_').toUpperCase();
      const flatNum = (runData.flatNo || '').replace(/[^a-zA-Z0-9]/g, '');
      const flatPart = flatNum ? `_${flatNum}` : '';
      logFileName = `${cleanPan}_${cleanName}${flatPart}_${dateStr}.log`;
      const jsonFileName = `${cleanPan}_${cleanName}${flatPart}_${dateStr}.json`;
      logFilePath = path.join(logsDir, logFileName);
      jsonFilePath = path.join(logsDir, jsonFileName);

      const formattedLog = formatForensicLog(runData, payload);
      await fs.promises.writeFile(logFilePath, formattedLog, 'utf8');
      await fs.promises.writeFile(jsonFilePath, JSON.stringify({ runData, payload }, null, 2), 'utf8');
    } catch (fileErr) {
      console.error('Failed to write forensic run log file:', fileErr);
    }

    // Cloudflare Worker: only when the dashboard's own post did not reach it
    // (payload.cloudSynced), so each booking is sent once.
    let workerResult = null;
    if (payload.cloudSynced !== true) try {
      const workerUrl = process.env.VITE_WORKER_URL || 'https://dda-engine.asmrahul17.workers.dev';
      const bookingKey = payload.bookingKey || '';
      // Prefer the token-verified user; if verification failed (e.g. expired
      // token), keep the app user the page resolved instead of sending nothing,
      // which made the worker fabricate "<pan>@dda.local".
      const payloadEmail = payload.userEmail && payload.userEmail !== 'extension@dda.local' ? payload.userEmail : '';
      const payloadUid = payload.userId && payload.userId !== 'user' ? payload.userId : '';
      const resolvedEmail = verifiedSessionUser?.email || payloadEmail;
      const resolvedUid = verifiedSessionUser?.uid || payloadUid;
      const resolvedToken = verifiedSessionToken || '';

      const cloudPayload = {
        ...payload,
        userEmail: resolvedEmail,
        userId: resolvedUid,
        runLogs: payload.runLogs || payload.logs || runData.logs || [],
        logs: payload.logs || payload.runLogs || runData.logs || [],
        captchaAttempts: payload.captchaAttempts || runData.captchaAttempts || [],
        lastCaptcha: payload.lastCaptcha || runData.lastCaptcha || null
      };

      const headers = {
        'Content-Type': 'application/json',
        'X-Booking-Key': bookingKey
      };
      if (resolvedEmail && resolvedEmail !== 'extension@dda.local') headers['X-User-Email'] = resolvedEmail;
      if (resolvedUid) headers['X-User-Id'] = resolvedUid;
      if (resolvedToken) headers['Authorization'] = `Bearer ${resolvedToken}`;

      const res = await fetch(`${workerUrl}/extension/analytics`, {
        method: 'POST',
        headers,
        body: JSON.stringify(cloudPayload),
        signal: netSignal()
      });
      if (res.ok) {
        workerResult = await res.json().catch(() => ({ success: true }));
      }
    } catch (_) {}

    // Send log update to the originating renderer window
    const analyticsLog = {
      level: 'SUCCESS',
      page: 'Analytics',
      pan: runData.applicantPan,
      msg: `📊 Saved booking run analytics for flat ${runData.flatNo || 'target'} (${runData.totalDurationSec}s)${logFileName ? ` [File: ${logFileName}]` : ''}`
    };
    if (!sendToSenderWindow(event.sender, 'dda:session-log', analyticsLog)) {
      if (dashboardWindows.size <= 1 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('dda:session-log', analyticsLog);
      }
    }

    return {
      success: true,
      local: savedLocal,
      worker: workerResult,
      logFilePath,
      jsonFilePath,
      logFileName
    };
  } catch (err) {
    console.error('Failed to save analytics in main process:', err);
    return { success: false, error: err.message };
  }
});

// IPC handler to open a specific log file in the system default text editor
ipcMain.handle('logs:openFile', async (_e, filePath) => {
  try {
    if (!filePath) return { success: false, error: 'No file path specified' };
    if (!fs.existsSync(filePath)) return { success: false, error: 'File does not exist' };
    await shell.openPath(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC handler to open the runs log folder in the file manager
ipcMain.handle('logs:openFolder', async (_e, folderPath) => {
  try {
    const baseDir = app.isPackaged ? app.getPath('userData') : process.cwd();
    const targetDir = folderPath && fs.existsSync(folderPath)
      ? folderPath
      : path.join(baseDir, 'dda_logs', 'runs');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    await shell.openPath(targetDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 3. High-Speed Captcha Solver IPC (100% Native C++ ONNX Engine)
ipcMain.handle('captcha:solveLocal', async (_e, payload) => {
  try {
    const { floatArray, base64Image, pan } = payload || {};
    let result = null;

    if (floatArray && (floatArray.length === 4320 || Object.keys(floatArray).length === 4320)) {
      result = await solveCaptchaTensor(floatArray);
    } else if (base64Image) {
      result = await solveCaptchaBase64(base64Image, nativeImage);
    } else {
      return { success: false, error: 'No floatArray or base64Image provided to solveLocal' };
    }


    return result;
  } catch (err) {
    console.error('❌ [Captcha IPC] solveLocal error:', err);
    return { success: false, error: err.message || 'Captcha solving error' };
  }
});


ipcMain.handle('captcha:warmup', async () => {
  const session = await initLocalCaptchaModel();
  return { success: !!session };
});

// ─── STEP 2 DIRECT-URL PREFETCH (runs in main, survives page navigation) ──────
// The Schemes page navigates away the instant the Apply link is captured, which aborts any in-page
// fetch. The 5-request locality cascade therefore runs here, with the webview's own session cookies,
// and the result is pushed to / pulled by the page (same localStorage keys the page already reads).
// The in-page resolver in preload-dda.js remains as a fallback if this fails or is slow.
const STEP2_RESULT_TTL_MS = 10 * 60 * 1000;
const STEP2_REUSE_FRESH_MS = 60 * 1000;
// After a failed build, the schemes page waits this long before building again.
// While DDA's form is erroring, every Apply attempt would otherwise re-request
// step1_form; the form page's own prefetch is not held back by this. A build
// DDA bounced (scheme not open yet: Apply can show before DDA takes bookings)
// waits longer, so a schemes page waiting for noon asks only every 15 s.
const STEP2_FAIL_COOLDOWN_MS = 5 * 1000;
const STEP2_BOUNCED_COOLDOWN_MS = 15 * 1000;
const step2FailedAt = new Map(); // key -> time the schemes page may build again

// The cascade result (locality/sector/pocket/block/tower hashes) is global for a scheme + preference set,
// not per user: different applicants with the same preferences get the identical step2_form URL. So ONE
// shared cache serves every window. The first window that asks runs the 5-request cascade (with its own
// session cookies); every other window with the same preferences joins that build or reuses its result.
const step2SharedCache = new Map(); // key -> entry { schemeId, targets, startedAt, finishedAt, result, promise, waiters:Set<webContents> }
const step2KeyBySession = new WeakMap(); // Session -> Map<schemeId, key> (what THIS window asked for, so it only ever reads its own preference set)

function sanitizeStep2Payload(p) {
  if (!p || typeof p !== 'object') return null;
  const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const schemeId = str(p.schemeId, 60);
  if (!/^[A-Za-z0-9_-]{2,60}$/.test(schemeId)) return null;
  const t = p.targets || {};
  const targets = { loc: str(t.loc), sec: str(t.sec), poc: str(t.poc), blk: str(t.blk), twr: str(t.twr) };
  if (!targets.sec || !targets.poc || !targets.blk || !targets.loc) return null;
  return { schemeId, targets, csrfToken: str(p.csrfToken, 300) };
}

function step2PublicResult(entry) {
  const r = entry && entry.result;
  if (!r || !r.ok) return null;
  return { schemeId: entry.schemeId, url: r.url, hashes: r.hashes, durationMs: r.durationMs };
}

function step2KeyFor(clean) {
  return [clean.schemeId, clean.targets.loc, clean.targets.sec, clean.targets.poc, clean.targets.blk, clean.targets.twr]
    .map((x) => String(x).toUpperCase())
    .join('|');
}

function pruneStep2Cache() {
  const now = Date.now();
  for (const [key, entry] of step2SharedCache) {
    if (entry.finishedAt && now - entry.finishedAt > STEP2_RESULT_TTL_MS) step2SharedCache.delete(key);
  }
}

function startStep2Prefetch(sender, payload, { fresh = false, joinOnly = false, fromSchemes = false } = {}) {
  const clean = sanitizeStep2Payload(payload);
  if (!clean || !sender || !sender.session) return null;
  pruneStep2Cache();
  const key = step2KeyFor(clean);

  // remember which preference set this window asked for (used by step2:getResolved)
  let perSession = step2KeyBySession.get(sender.session);
  if (!perSession) {
    perSession = new Map();
    step2KeyBySession.set(sender.session, perSession);
  }
  perSession.set(clean.schemeId, key);

  const existing = step2SharedCache.get(key);
  if (!existing && fromSchemes && Date.now() < (step2FailedAt.get(key) || 0)) {
    return null;
  }
  if (existing) {
    if (!existing.finishedAt) {
      existing.waiters.add(sender); // join the build already in flight
      return existing;
    }
    const age = Date.now() - existing.finishedAt;
    if (existing.result?.ok && age < (fresh ? STEP2_REUSE_FRESH_MS : STEP2_RESULT_TTL_MS)) {
      // finished and still good: a window that was not waiting yet gets it pushed straight away
      try {
        if (!sender.isDestroyed()) sender.send('dda:step2-url-ready', { ...step2PublicResult(existing), shared: true });
      } catch (_) {}
      return existing;
    }
  }
  if (joinOnly) return null;

  const entry = {
    schemeId: clean.schemeId,
    targets: clean.targets,
    startedAt: Date.now(),
    finishedAt: 0,
    result: null,
    promise: null,
    waiters: new Set([sender]),
  };
  entry.promise = resolveStep2Url({
    ses: sender.session,
    schemeId: clean.schemeId,
    targets: clean.targets,
    csrfToken: clean.csrfToken,
    tree: treeFor(clean.schemeId),
    trace: (m) => fastPayTrace(`STEP2BUILD wc=${sender.id} ${m}`),
  })
    .catch((err) => ({ ok: false, reason: `error:${err?.message || err}`, durationMs: Date.now() - entry.startedAt }))
    .then((result) => {
      entry.result = result;
      entry.finishedAt = Date.now();
      if (result.ok) {
        console.log(
          `⚡ [Step2 Prefetch] URL built in main in ${result.durationMs}ms for ${entry.waiters.size} window(s): ${result.url}`,
        );
        fastPayTrace(`STEP2TREE wc=${sender.id} link built in ${result.durationMs}ms, ${result.levelsFromTree || 0} of ${result.hashes?.towerName ? 5 : 4} levels from the shared tree`);
        const pub = step2PublicResult(entry);
        for (const w of entry.waiters) {
          try {
            if (!w.isDestroyed()) w.send('dda:step2-url-ready', pub);
          } catch (_) {}
        }
      } else {
        console.warn(`⚠️ [Step2 Prefetch] main-process build failed (${result.reason}) — in-page resolver will cover it`);
        // Do not cache failures (one window's session problem must not poison the others): allow a later retry
        if (step2SharedCache.get(key) === entry) step2SharedCache.delete(key);
        const bounced = /^stopped:redirected/.test(result.reason || '');
        step2FailedAt.set(key, Date.now() + (bounced ? STEP2_BOUNCED_COOLDOWN_MS : STEP2_FAIL_COOLDOWN_MS));
      }
      return result;
    });
  step2SharedCache.set(key, entry);
  return entry;
}

ipcMain.on('step2:prefetch', (event, payload) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return;
  try {
    let fromSchemes = false;
    try { fromSchemes = /schemelist/i.test(event.sender.getURL() || ''); } catch (_) {}
    // From the schemes page as soon as the target scheme's Apply link shows (24 Oct): the link is
    // ready when the form is saved, even when DDA serves the form minutes later (20 Oct).
    startStep2Prefetch(event.sender, payload, { fresh: true, fromSchemes });
  } catch (err) {
    console.warn('[Step2 Prefetch] start error:', err?.message || err);
  }
});

ipcMain.on('step2:getResolved', (event, schemeId) => {
  event.returnValue = null;
  try {
    if (!isAuthorizedDdaWebviewCaller(event)) return;
    const key = step2KeyBySession.get(event.sender.session)?.get(String(schemeId || ''));
    if (!key) return; // this window never asked for this scheme: never hand it another window's preference set
    const entry = step2SharedCache.get(key);
    if (!entry || !entry.result?.ok) return;
    if (Date.now() - entry.finishedAt > STEP2_RESULT_TTL_MS) return;
    event.returnValue = step2PublicResult(entry);
  } catch (_) {
    event.returnValue = null;
  }
});

// A link a page built through DDA's own dropdowns: each level it chose goes
// into the shared tree (as partial lists), so other windows can skip them
ipcMain.on('step2:learned', (event, hashes) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return;
  try {
    const schemeId = String(hashes?.schemeId || '');
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(schemeId)) return;
    const n = putLearnedPath(schemeId, hashes);
    if (n) fastPayTrace(`STEP2TREE wc=${event.sender.id} learned ${n} level(s) of ${schemeId} from the page`);
  } catch (_) {}
});

// Form page / locality page: join (or start) the build; answer within 3s. A build
// still running (DDA slow, steps being asked again) answers { pending: true }: the
// page then waits for it (the result is pushed to every waiting window) instead
// of starting its own copy; null means it failed and the page may try its own.
ipcMain.handle('step2:ensure', async (event, payload) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return null;
  const entry = startStep2Prefetch(event.sender, payload);
  if (!entry) return null;
  const result = await Promise.race([entry.promise, new Promise((resolve) => setTimeout(() => resolve(null), 3000))]);
  if (result && result.ok) return step2PublicResult(entry);
  return !entry.finishedAt ? { pending: true } : null;
});

// Wait (up to timeoutMs) for this window's running build; same answer as step2:ensure
ipcMain.handle('step2:wait', async (event, payload, timeoutMs) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return null;
  const entry = startStep2Prefetch(event.sender, payload, { joinOnly: true });
  if (!entry) return null;
  const ms = Math.min(Math.max(Number(timeoutMs) || 0, 1000), 120000);
  const result = await Promise.race([entry.promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
  if (result && result.ok) return step2PublicResult(entry);
  return !entry.finishedAt ? { pending: true } : null;
});

// Cross-Platform Network Optimization IPC (TCP Pre-Connect & DNS Resolver)
ipcMain.handle('session:preconnect', async (event, url = 'https://eservices.dda.org.in', partitionKey) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'eservices.dda.org.in') {
      return { success: false, error: 'Unsupported preconnect target' };
    }
    const targetSession = partitionKey ? session.fromPartition(partitionKey) : session.defaultSession;
    setupSessionOptimizations(targetSession);
    targetSession.preconnect({ url, numSockets: 6 });
    targetSession.resolveHost(parsed.hostname).catch(() => {});
    return { success: true, url, partitionKey: partitionKey || 'default' };
  } catch (err) {
    console.warn('⚠️ [session:preconnect] error:', err.message);
    return { success: false, error: err.message };
  }
});

// 2. Session & Webview DevTools Management
ipcMain.handle('app:openWebviewDevTools', () => {
  const { webContents } = require('electron');
  const allWebContents = webContents.getAllWebContents();
  for (const wc of allWebContents) {
    const url = wc.getURL().toLowerCase();
    if (url.includes('dda.org.in') || url.includes('/user')) {
      wc.openDevTools({ mode: 'detach' });
      return true;
    }
  }
  if (allWebContents.length > 1) {
    allWebContents[1].openDevTools({ mode: 'detach' });
    return true;
  }
  return false;
});
ipcMain.handle('window:createDashboard', () => {
  createDashboardWindow(undefined, { pick: true });
  return { success: true };
});
// Open dashboard windows: their session ids and window numbers (the picker
// only treats locks of windows that are open right now as "in use").
ipcMain.handle('window:listOpenSessions', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  return dashboardWindowsList
    .filter((w) => w && !w.isDestroyed())
    .map((w, idx) => ({ sessionId: w.__ddaSessionId, displayIndex: w.__ddaDisplayIndex || idx + 1 }));
});
// The first window of a run asks once which windows were open before (in
// opening order), to carry the one surviving lock to itself
ipcMain.handle('window:takeLockStartupPlan', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!lockCarryPlan || !win || win.__ddaSessionId !== lockCarryPlan.sessionId) return null;
  const plan = lockCarryPlan;
  lockCarryPlan = null;
  return { sessionId: plan.sessionId, previousOrder: plan.previousOrder };
});
// This window's DDA login (when it took over another window's lock)
ipcMain.handle('window:clearOwnDdaLogin', async (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win?.__ddaSessionId) return false;
  await clearWindowDdaLogin(win.__ddaSessionId);
  return true;
});
ipcMain.handle('window:setTitle', (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed() && title) {
    win.setTitle(title);
    return true;
  }
  return false;
});
ipcMain.handle('window:getDisplayIndex', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && win.__ddaDisplayIndex) {
    return win.__ddaDisplayIndex;
  }
  const idx = dashboardWindowsList.indexOf(win);
  return idx !== -1 ? idx + 1 : 1;
});
ipcMain.handle('session:launch', (event, pan) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  return launchApplicantSession(pan);
});
ipcMain.handle('session:close', (event, pan) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const win = activeSessionWindows.get((pan || '').toUpperCase().trim());
  if (win && !win.isDestroyed()) {
    win.close();
    return true;
  }
  return false;
});
ipcMain.handle('session:getActive', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  return Array.from(activeSessionWindows.keys());
});
ipcMain.handle('app:getDdaPreloadUrl', () => {
  const p = path.join(__dirname, 'preload-dda.js');
  return 'file://' + p.replace(/\\/g, '/');
});

// Clear DDA webview session cookies and storage data on desktop app logout
// Clear the saved step2 hashes (hash tree and the last built link) in every open
// DDA page, plus the shared build cache here. The DDA login and everything else stay.
ipcMain.handle('session:clearHashes', async (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  step2SharedCache.clear();
  clearStep2Tree();
  let pages = 0;
  for (const wc of webContents.getAllWebContents()) {
    try {
      if (wc.isDestroyed() || !/eservices\.dda\.org\.in/i.test(wc.getURL())) continue;
      await wc.executeJavaScript(`(() => {
        ['dda_scheme_hash_tree', 'dda_locality_hashes', 'dda_direct_flat_url'].forEach((k) => localStorage.removeItem(k));
        sessionStorage.removeItem('dda_step2_nomatch');
        delete window.__ddaDirectFlatUrl;
      })()`);
      pages++;
    } catch (_) {}
  }
  return { success: true, pages };
});

ipcMain.handle('session:clearDdaSession', async (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  try {
    // 1. Close any running standalone applicant windows
    for (const [pan, win] of activeSessionWindows.entries()) {
      try {
        if (win && !win.isDestroyed()) win.close();
      } catch (_) {}
    }
    activeSessionWindows.clear();

    // 2. Clear the partitions that can hold a DDA login: the windows' webviews
    // (Window 1-10, any higher window still on disk or open) and per-applicant
    // windows opened this run. Not one partition per applicant in the
    // database: opening ~150 unused partitions one by one made sign-out take
    // up to half a minute, and created those partitions on disk.
    const partitionKeys = new Set([
      null, // defaultSession
      'persist:dda_workspace',
      'persist:dda_session',
    ]);
    for (let n = 1; n <= 10; n++) partitionKeys.add(`persist:dda_session_${n}`);
    try {
      for (const name of fs.readdirSync(path.join(app.getPath('userData'), 'Partitions'))) {
        if (/^dda_session_\d+$/.test(name)) partitionKeys.add(`persist:${name}`);
      }
    } catch (_) {}
    for (const w of dashboardWindowsList) {
      if (w && !w.isDestroyed() && w.__ddaSessionId) {
        partitionKeys.add(`persist:dda_${String(w.__ddaSessionId).toLowerCase().replace(/[^a-z0-9_]/g, '')}`);
      }
    }
    for (const key of launchedApplicantPartitions) partitionKeys.add(key);

    // DDA cookies, DDA site storage, then all cookies of each session; all at once
    const sessions = new Set();
    for (const key of partitionKeys) {
      try {
        const s = key ? session.fromPartition(key) : session.defaultSession;
        if (s) sessions.add(s);
      } catch (_) {}
    }
    await Promise.all([...sessions].map((s) => clearDdaPartition(s).catch(() => {})));

    console.log('🧹 [Main] DDA portal session cookies & webview storage wiped on app logout.');
    return { success: true };
  } catch (err) {
    console.error('❌ [Main] clearDdaSession error:', err);
    return { success: false, error: err.message };
  }
});

// Injected preload requests active applicant data for that specific window
let globalActiveApplicant = null;
const sessionApplicantMap = new Map();

function getWindowFromSender(sender) {
  if (!sender) return null;
  if (sender.__ddaOwnerWindow) return sender.__ddaOwnerWindow;
  if (webviewToWindowMap.has(sender.id)) return webviewToWindowMap.get(sender.id);
  if (typeof sender.getOwnerBrowserWindow === 'function') {
    const owner = sender.getOwnerBrowserWindow();
    if (owner) return owner;
  }
  const win = BrowserWindow.fromWebContents(sender);
  if (win) return win;
  if (sender.hostWebContents) {
    const hostWin = BrowserWindow.fromWebContents(sender.hostWebContents);
    if (hostWin) return hostWin;
  }
  for (const dWin of dashboardWindows) {
    if (!dWin.isDestroyed()) {
      if (dWin.webContents === sender || (sender.hostWebContents && dWin.webContents === sender.hostWebContents)) {
        return dWin;
      }
    }
  }
  return null;
}

ipcMain.handle('session:setActiveApplicant', (event, applicant, customSessionId) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const win = getWindowFromSender(event.sender);
  const sessionId = customSessionId || win?.__ddaSessionId || event.sender?.__ddaSessionId || 'session_1';
  if (applicant) {
    sessionApplicantMap.set(sessionId, applicant);
    const cleanPan = (applicant.pan || applicant.personal?.pan || '').toUpperCase().trim();
    if (cleanPan) {
      sessionApplicantMap.set(cleanPan, applicant);
    }
  }
  if (win) {
    win.__ddaApplicantData = applicant;
    try {
      win.webContents.send('session:applicantUpdated', applicant);
    } catch (_) {}
  }
  return true;
});

ipcMain.handle('session:getApplicantData', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const win = getWindowFromSender(event.sender);
  const sessionId = win?.__ddaSessionId || event.sender?.__ddaSessionId;
  if (sessionId && sessionApplicantMap.has(sessionId)) {
    return sessionApplicantMap.get(sessionId);
  }
  if (win && win.__ddaApplicantData) {
    return win.__ddaApplicantData;
  }
  return null;
});

// Narrow, owner-scoped data bridge for the trusted DDA portal webview preload.
ipcMain.handle('session:getWebviewContext', (event) => {
  if (!isAuthorizedDdaWebviewCaller(event)) throw new Error('Unauthorized IPC caller');
  const win = getWindowFromSender(event.sender);
  if (!win) return null;
  return {
    applicant: win.__ddaApplicantData || null,
    settings: db.getSettings(win.__ddaSessionId)
  };
});

// Authentic logged-in user tracking with server-verified token validation
let globalActiveUser = null;
let verifiedSessionUser = null;
let verifiedSessionToken = null;

// Expiry from the token's own exp claim (signature checks stay with the Worker)
function idTokenExpired(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8'));
    return !payload?.exp || payload.exp * 1000 <= Date.now() + 30 * 1000;
  } catch (_) {
    return true;
  }
}

async function verifyFirebaseIdToken(token) {
  if (!token || typeof token !== 'string') return null;












  // 1. Verify against Cloudflare Worker /me backend (which validates JWT against Google certs)
  try {
    const workerUrl = process.env.VITE_WORKER_URL || 'https://dda-engine.asmrahul17.workers.dev';
    const res = await fetch(`${workerUrl}/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: netSignal()
    });
    if (res.ok) {
      const data = await res.json();
      const me = data?.data || data || {};
      const uid = me.uid || me.user_id || me.sub;
      if (uid) {
        const isAdmin = Boolean(me.isAdmin || me.role === 'admin');
        return {
          uid,
          email: me.email || '',
          name: me.name || '',
          role: isAdmin ? 'admin' : (me.role || 'user'),
          isAdmin
        };
      }
    }
  } catch (err) {
    console.warn('[Auth] Worker token verification failed:', err.message);
  }

  // 2. Direct identity verification fallback via Google Identity Toolkit.
  // The lookup response verifies the Firebase UID, but it does not verify custom
  // role claims. Only the Worker /me response may grant the admin role.
  try {
    const apiKey = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyCCa91TCGNpAUkPT1Q0ORWMFWWue0VBvow';
    const googleRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
      signal: netSignal()
    });
    if (googleRes.ok) {
      const gData = await googleRes.json();
      const user = gData?.users?.[0];
      if (user && user.localId) {
        return {
          uid: user.localId,
          email: user.email || '',
          name: user.displayName || '',
          role: 'user',
          isAdmin: false
        };
      }
    }
  } catch (err) {
    console.warn('[Auth] Google token verification failed:', err.message);
  }

  return null;
}

ipcMain.handle('session:authenticateToken', async (event, token) => {
  if (!isAuthorizedDashboardCaller(event)) {
    throw new Error('Unauthorized IPC caller: Caller is not a dashboard main frame');
  }
  // The same token another window already had confirmed, and not expired:
  // no need to ask the Worker again (a new window opens straight away)
  if (token && token === verifiedSessionToken && verifiedSessionUser && !idTokenExpired(token)) {
    return { success: true, user: verifiedSessionUser };
  }
  const verified = await verifyFirebaseIdToken(token);
  if (!verified) {
    verifiedSessionUser = null;
    verifiedSessionToken = null;
    globalActiveUser = null;
    return { success: false, error: 'Token verification failed' };
  }
  verifiedSessionUser = verified;
  verifiedSessionToken = token;
  globalActiveUser = verified;
  return { success: true, user: verified };
});

ipcMain.handle('session:clearActiveUser', (event) => {
  if (!isAuthorizedDashboardCaller(event)) {
    throw new Error('Unauthorized IPC caller');
  }
  verifiedSessionUser = null;
  verifiedSessionToken = null;
  globalActiveUser = null;
  return true;
});

ipcMain.handle('session:setActiveUser', async (event, user) => {
  if (!isAuthorizedDashboardCaller(event)) {
    throw new Error('Unauthorized IPC caller');
  }
  if (!user) {
    verifiedSessionUser = null;
    verifiedSessionToken = null;
    globalActiveUser = null;
    return true;
  }
  if (user.idToken) {
    const verified = await verifyFirebaseIdToken(user.idToken);
    if (verified) {
      verifiedSessionUser = verified;
      verifiedSessionToken = user.idToken;
      globalActiveUser = verified;
      return true;
    }
  }
  return false;
});

ipcMain.handle('session:getActiveUser', (event) => {
  if (!isAuthorizedDashboardCaller(event)) {
    return null;
  }
  return verifiedSessionUser;
});

ipcMain.on('session:getActiveUserSync', (event) => {
  if (!isAuthorizedDashboardCaller(event)) {
    event.returnValue = null;
    return;
  }
  event.returnValue = verifiedSessionUser;
});

function format12HourTime(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m}:${s}.${ms} ${ap}`;
}

function sendToSenderWindow(sender, channel, data) {
  const win = getWindowFromSender(sender);
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send(channel, data);
      return true;
    } catch (_) {}
  }
  return false;
}

// Apply re-try Stop (preload-dda.js "Apply retry"). While a window re-tries Apply its DDA
// page never finishes loading, so the dashboard cannot reach the page to stop it; the Stop
// time is kept here per DDA webview, and the page asks for it before every re-try.
const applyRetryStoppedAt = new Map(); // DDA webview webContents id -> ms
function markApplyRetryStopped(wc) {
  const id = wc.id;
  if (!applyRetryStoppedAt.has(id)) wc.once('destroyed', () => applyRetryStoppedAt.delete(id));
  applyRetryStoppedAt.set(id, Date.now());
}
// Dashboard Stop button: the webview's own webContents id, which must belong to this window
ipcMain.on('apply:stopFor', (event, webContentsId) => {
  try {
    if (!isAuthorizedDashboardCaller(event)) return;
    const wc = webContents.fromId(Number(webContentsId));
    if (!wc || wc.isDestroyed() || wc.hostWebContents?.id !== event.sender.id) return;
    markApplyRetryStopped(wc);
  } catch (_) {}
});
// The page itself (its own Stop path)
ipcMain.on('apply:stop', (event) => {
  try {
    if (!isAuthorizedDdaWebviewCaller(event)) return;
    markApplyRetryStopped(event.sender);
  } catch (_) {}
});
ipcMain.handle('apply:stoppedAt', (event) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return 0;
  return applyRetryStoppedAt.get(event.sender.id) || 0;
});

// After a 429 on a DDA page (e.g. the application form): ms until DDA's Retry-After is over,
// +1 s because DDA rounds it down. null when DDA gave no Retry-After for this window lately.
ipcMain.handle('dda:retryAfterMs', (event) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return null;
  const r = ddaRetryAfter.get(event.sender.id);
  if (!r || r.seconds == null || Date.now() - r.at > 120000) return null;
  return Math.max(0, r.at + (r.seconds + 1) * 1000 - Date.now());
});

// How long the next flat-page request should wait (DDA's 60-a-minute limit). The page's Search
// asks for itself; the dashboard's Multi-Reload asks for its webview.
ipcMain.handle('dda:flatPageWait', (event) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return 0;
  return flatPageBudgets.get(event.sender.id)?.waitMs() || 0;
});
ipcMain.handle('dda:flatPageWaitFor', (event, webContentsId) => {
  try {
    if (!isAuthorizedDashboardCaller(event)) return 0;
    const wc = webContents.fromId(Number(webContentsId));
    if (!wc || wc.isDestroyed() || wc.hostWebContents?.id !== event.sender.id) return 0;
    return flatPageBudgets.get(wc.id)?.waitMs() || 0;
  } catch (_) {
    return 0;
  }
});

// When this DDA webview last went to /user/logout (see did-attach-webview); 0 if never.
// The page asks before treating a redirect to DDA's home page as DDA ending the session.
const ddaManualLogoutAt = new Map(); // DDA webview webContents id -> ms
ipcMain.handle('dda:manualLogoutAt', (event) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return 0;
  return ddaManualLogoutAt.get(event.sender.id) || 0;
});

// Automatic logins after DDA ended the session: at most 3 per DDA window in 10 minutes, never
// within a minute of a /user/logout. Shared by the redirect catch above and the page's own
// fallback (it reached "/" or /admin itself), so the limit holds whichever path saw it.
const ddaReloginAt = new Map(); // id -> { at, where } waiting for the login page to pick up
const ddaReloginHistory = new Map(); // id -> [ms]
function noteDdaRelogin(id) {
  const manualAt = ddaManualLogoutAt.get(id) || 0;
  if (manualAt && Date.now() - manualAt < 60 * 1000) return false;
  const history = (ddaReloginHistory.get(id) || []).filter((t) => Date.now() - t < 10 * 60 * 1000);
  if (history.length >= 3) return false;
  history.push(Date.now());
  ddaReloginHistory.set(id, history);
  return true;
}
// DDA answers a login POST (sent by the page's own script) with a redirect to /admin when it
// refuses it: the login page is stale (expired session or security token), or another login
// took over. DDA's script then fails on the /admin page it was handed ("Unexpected token '<'
// ... is not valid JSON") and every further press of Login repeats it until the page is
// reloaded (25 Oct: 3-4 failed presses, 20-33 s, before the page was reloaded). Reload the
// login page at once instead; the DDA-logout recovery then presses Login again for the locked
// applicant (same limits: 3 in 10 minutes, never within a minute of a manual logout, never on a
// wrong password). Past the limit the page is still reloaded, Login is then pressed by hand.
const staleLoginFixAt = new Map(); // webContents id -> ms of the last fix
function recoverStaleLoginPage(d) {
  if (d.method !== 'POST' || d.resourceType !== 'xhr' || d.webContentsId == null) return;
  let from; let to;
  try { from = new URL(d.url); to = new URL(d.redirectURL); } catch (_) { return; }
  if (from.hostname !== 'eservices.dda.org.in' || to.hostname !== 'eservices.dda.org.in') return;
  if (from.pathname.replace(/\/+$/, '').toLowerCase() !== '/user/login') return;
  const dest = to.pathname.toLowerCase().replace(/\/+$/, '');
  if (!(dest === '' || dest === '/admin' || dest.startsWith('/admin/'))) return;
  const id = d.webContentsId;
  if (Date.now() - (staleLoginFixAt.get(id) || 0) < 15 * 1000) return;
  const wc = webContents.fromId(id);
  if (!wc || wc.isDestroyed() || !runTracedWebviews.has(id)) return;
  staleLoginFixAt.set(id, Date.now());
  wc.once('destroyed', () => staleLoginFixAt.delete(id));
  const auto = noteDdaRelogin(id);
  if (auto) ddaReloginAt.set(id, { at: Date.now(), where: '/admin (the login was refused)' });
  runTrace(id, 'LOGIN-STALE', `login POST refused (redirect to ${dest || '/'}): reloading the login page${auto ? ' and pressing Login again' : ' (press Login again)'}`);
  setImmediate(() => {
    if (!wc.isDestroyed()) wc.loadURL('https://eservices.dda.org.in/user').catch(() => {});
  });
}
ipcMain.handle('dda:noteRelogin', (event) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return false;
  return noteDdaRelogin(event.sender.id);
});
ipcMain.handle('dda:takeRelogin', (event) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return null;
  const r = ddaReloginAt.get(event.sender.id) || null;
  ddaReloginAt.delete(event.sender.id);
  return r && Date.now() - r.at < 2 * 60 * 1000 ? r : null;
});

// Relay DDA logs to Dashboard UI
// Placeholder photo / signature for the application form (placeholderImages.cjs).
// DDA's page is sandboxed, so its page engine can't require() the file; it asks
// here once as it loads. Only the two placeholder images, nothing else.
const BLANK_IMAGES_FOR_PAGE = {
  photo: placeholderImages?.BLANK_PHOTO_JPG || '',
  signature: placeholderImages?.BLANK_SIGNATURE_JPG || '',
};
ipcMain.on('dda:blankImages', (event) => {
  event.returnValue = BLANK_IMAGES_FOR_PAGE;
});

ipcMain.on('dda:log', (event, logData) => {
  const now = logData?.timestamp || Date.now();
  const fullLog = {
    ...logData,
    timestamp: now,
    timeStr: logData?.time || format12HourTime(now)
  };
  // Gateway and bank pages (SBI, BillDesk, the bank) aren't given the
  // applicant, so their page code tags lines with whatever that site's own
  // storage last held (an earlier payment's applicant). Their lines take this
  // window's applicant instead, the one DDA's pages are tagged with.
  try {
    if (new URL(event.sender.getURL()).hostname !== 'eservices.dda.org.in') {
      const app = getWindowFromSender(event.sender)?.__ddaApplicantData;
      fullLog.pan = String(app?.pan || app?.personal?.pan || '').toUpperCase().trim();
    }
  } catch (_) {}
  // ⚡ Terminal stdout console log
  console.log(`⚡ [${fullLog.timeStr}] [${fullLog.level || 'INFO'}] [${fullLog.page || 'DDA'}]${fullLog.pan ? ' (' + fullLog.pan + ')' : ''} ${fullLog.msg || fullLog.message || ''}`);
  const logText = String(fullLog.msg || fullLog.message || '');
  runTrace(event.sender?.id, 'LOG', `[${fullLog.level || 'INFO'}] [${fullLog.page || ''}]${fullLog.pan ? ' applicant=' + fullLog.pan : ''} ${logText.slice(0, 2000)}`);
  if (logText.includes('[Fast Payment]') || /payment/i.test(String(fullLog.page || ''))) {
    fastPayTrace(`LOG wc=${event.sender?.id} [${fullLog.level || 'INFO'}] [${fullLog.page || ''}] ${logText.slice(0, logText.includes('layout:') ? 4000 : 300)}`);
  }
  if (!sendToSenderWindow(event.sender, 'dda:session-log', fullLog)) {
    if (dashboardWindows.size <= 1 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dda:session-log', fullLog);
    }
  }
});

// Relay Schemes page reset event to Dashboard UI
ipcMain.on('dda:reset-run-logs', (event, data) => {
  console.log('🧹 [Main] Relaying dda:reset-run-logs to window UI');
  if (!sendToSenderWindow(event.sender, 'dda:reset-run-logs', data)) {
    if (dashboardWindows.size <= 1 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dda:reset-run-logs', data);
    }
  }
});

// Relay analytics dispatched event to Dashboard UI
ipcMain.on('dda:analytics-dispatched', (event, data) => {
  console.log('📊 [Main] Relaying dda:analytics-dispatched to window UI');
  if (!sendToSenderWindow(event.sender, 'dda:analytics-dispatched', data)) {
    if (dashboardWindows.size <= 1 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dda:analytics-dispatched', data);
    }
  }
});

// Relay flat availability to Dashboard UI
ipcMain.on('dda:flat-availability', (event, data) => {
  if (!sendToSenderWindow(event.sender, 'dda:flat-availability', data)) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dda:flat-availability', data);
    }
  }
});

function broadcastToDashboards(channel, data) {
  for (const win of dashboardWindows) {
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send(channel, data);
      } catch (_) {}
    }
  }
}

// ─── Fast Payment card (BillDesk card flow, stops at bank OTP) ──────────
// The card is encrypted with the OS keystore (DPAPI on Windows) and never
// written to web storage. The DDA webview can read it only after the Fast
// Payment flow has armed this payment (Make Payment dispatched), and only once:
// the page reports the Pay click and the arm is cleared, so a reload or a
// BillDesk error page can never auto-submit a second charge attempt.
const PAYMENT_ARM_TTL_MS = 20 * 60 * 1000;
const paymentArmedAt = new Map(); // webview webContents.id -> ts
const paymentSubmittedAt = new Map(); // webview webContents.id -> ts
const paymentPlans = new Map(); // webview webContents.id -> { gateway, method, bankId }
const PAYMENT_BANKS_FILE = JSON.parse(fs.readFileSync(path.join(__dirname, 'payment_banks.json'), 'utf8'));
const PAYMENT_BANKS = PAYMENT_BANKS_FILE.banks;
const PAYMENT_BANK_LEGACY = PAYMENT_BANKS_FILE.legacy || {};

// Saved cards: one file, encrypted with the OS keystore, holding a list.
// Each dashboard window picks one (settings.fastPaymentCardId).
// payment_card.bin is the old single-card file; it becomes the first card.
function paymentCardPath() {
  return path.join(app.getPath('userData'), 'payment_card.bin');
}

function paymentCardsPath() {
  return path.join(app.getPath('userData'), 'payment_cards.bin');
}

function luhnOk(num) {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function readPaymentCards() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return [];
    const file = paymentCardsPath();
    if (fs.existsSync(file)) {
      const list = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      return Array.isArray(list) ? list.filter((c) => c && c.id && c.cardNumber) : [];
    }
    const old = paymentCardPath();
    if (fs.existsSync(old)) {
      const card = JSON.parse(safeStorage.decryptString(fs.readFileSync(old)));
      if (card?.cardNumber) {
        const list = [{ id: crypto.randomUUID(), label: '', ...card }];
        writePaymentCards(list);
        try { fs.rmSync(old, { force: true }); } catch (_) {}
        return list;
      }
    }
  } catch (err) {
    console.warn('[Fast Payment] Could not read saved cards:', err.message);
  }
  return [];
}

function writePaymentCards(list) {
  fs.writeFileSync(paymentCardsPath(), safeStorage.encryptString(JSON.stringify(list)));
}

// The card a window uses: the one it picked; with no pick, the only saved card.
// Never some other card.
function resolvePaymentCard(cardId) {
  const cards = readPaymentCards();
  if (cardId) return cards.find((c) => c.id === cardId) || null;
  return cards.length === 1 ? cards[0] : null;
}

function paymentCardSummary(card) {
  if (!card) return null;
  return {
    id: card.id,
    label: card.label || '',
    last4: card.cardNumber.slice(-4),
    expiry: `${card.expMonth}/${card.expYear}`,
    cardHolderName: card.cardHolderName
  };
}

// The applicant's website card, edited on this PC (like the local flat list):
// { [PAN]: { cardNumber ('' = keep the website's number), expMonth, expYear,
// cardHolderName, baseMask, savedAt } }, encrypted with the OS keystore.
// baseMask is the website card's mask when the edit was made; the dashboard
// drops the edit once the website card changes. No CVV: it is typed on BillDesk.
function applicantCardEditsPath() {
  return path.join(app.getPath('userData'), 'applicant_card_edits.bin');
}

function readApplicantCardEdits() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return {};
    const file = applicantCardEditsPath();
    if (!fs.existsSync(file)) return {};
    const map = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  } catch (_) {
    return {};
  }
}

function writeApplicantCardEdits(map) {
  if (!Object.keys(map).length) {
    try { fs.rmSync(applicantCardEditsPath(), { force: true }); } catch (_) {}
    return;
  }
  fs.writeFileSync(applicantCardEditsPath(), safeStorage.encryptString(JSON.stringify(map)));
}

// The CVV typed for an applicant's card, by PAN: in memory only, never written
// to disk or sent anywhere; gone when the app closes or the edit is reset.
const applicantCardCvvs = new Map();

// The applicant's card for a payment: the website card with this PC's edit on top
function applicantCardWithEdit(pan, websiteCard) {
  const edit = pan ? readApplicantCardEdits()[pan] : null;
  if (!edit) return websiteCard || null;
  const cardNumber = edit.cardNumber || websiteCard?.cardNumber || '';
  if (!cardNumber) return null;
  return {
    cardNumber, expMonth: edit.expMonth, expYear: edit.expYear, cardHolderName: edit.cardHolderName,
    cvv: applicantCardCvvs.get(pan) || '', edited: true,
  };
}

// Only the top frame of a DDA webview hosted by one of our dashboard windows.
// `ddaOnly`: arming happens on the DDA hold page. Reading the card and
// reporting the Pay click come from the gateway page, which is often the
// bank's own merchant page wrapping BillDesk in #sdk-iframe (SBI does this:
// merchant.onlinesbi.sbi + pay.billdesk.com iframe), so any https page is
// accepted there — the arm (set only from DDA, 20 min, one Pay) is the gate,
// and the preload only types the card into billdesk.com documents.
// Fast Payment trace: one line per step in userData/fastpay_trace.log, so a
// failed live run can be diagnosed afterwards. Never card data or passwords;
// URLs are reduced to host + path.
function fastPayTrace(msg) {
  const wc = Number(/wc=(\d+)/.exec(msg)?.[1]) || 0;
  runTrace(wc, 'TRACE', msg);
  try {
    const file = path.join(app.getPath('userData'), 'fastpay_trace.log');
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.old');
    } catch (_) {}
    fs.appendFileSync(file, `${new Date().toISOString()} ${msg}
`);
  } catch (_) {}
}

function traceUrl(u) {
  try {
    const x = new URL(u);
    return x.host + x.pathname;
  } catch (_) {
    return String(u || '').split('?')[0].slice(0, 120);
  }
}

function describePaymentCaller(event) {
  let url = '';
  try { url = event.senderFrame?.url || event.sender.getURL(); } catch (_) {}
  return `wc=${event?.sender?.id} host=${event?.sender?.hostWebContents?.id ?? 'none'} topFrame=${event?.senderFrame ? event.senderFrame.parent === null : 'n/a'} url=${traceUrl(url)}`;
}

function isPaymentWebviewCaller(event, { ddaOnly = false } = {}) {
  if (!event?.sender || !event.senderFrame || event.senderFrame.parent !== null) return false;
  const hostId = event.sender.hostWebContents?.id;
  if (!hostId || !dashboardWebContentsIds.has(hostId)) return false;
  try {
    const url = new URL(event.senderFrame.url || event.sender.getURL());
    if (url.protocol !== 'https:') return false;
    return ddaOnly ? url.hostname === 'eservices.dda.org.in' : true;
  } catch (_) {
    return false;
  }
}

// ─── PDFs opened from the DDA page ───
// Site isolation is off for Fast Payment (see disable-site-isolation-trials),
// and with it off Chromium's built-in PDF viewer shows every PDF blank. So the
// DDA page hands a PDF it is about to open (its "View Uploaded Document"
// links) to main, which shows it in an app window that draws it with pdf.js
// (src/views/PdfDocWindow.jsx).
const PDF_DOC_TTL_MS = 10 * 60 * 1000;
const pdfDocs = new Map(); // token -> { bytes, title, expires }
const pdfViewerIds = new Set();

function openPdfViewerWindow(bytes, title) {
  const now = Date.now();
  for (const [k, v] of pdfDocs) if (v.expires < now) pdfDocs.delete(k);
  const token = crypto.randomBytes(16).toString('hex');
  pdfDocs.set(token, { bytes, title, expires: now + PDF_DOC_TTL_MS });

  const win = new BrowserWindow({
    width: 900,
    height: 1000,
    title: title || 'Document',
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-pdfviewer.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const wcId = win.webContents.id;
  pdfViewerIds.add(wcId);
  win.on('closed', () => {
    pdfViewerIds.delete(wcId);
    pdfDocs.delete(token);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  const distPath = path.join(__dirname, 'dist', 'index.html');
  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  if (isDev) {
    win.loadURL(`http://localhost:5173/?pdfDoc=${token}`).catch(() => {
      if (fs.existsSync(distPath)) win.loadFile(distPath, { search: `?pdfDoc=${token}` });
    });
  } else {
    win.loadFile(distPath, { search: `?pdfDoc=${token}` });
  }
}

ipcMain.handle('doc:get', (event, token) => {
  if (!event?.sender || !pdfViewerIds.has(event.sender.id)) throw new Error('Unauthorized IPC caller');
  const doc = pdfDocs.get(String(token || ''));
  if (!doc || doc.expires < Date.now()) return null;
  return { bytes: new Uint8Array(doc.bytes), title: doc.title };
});

// A page / new-window response that is a PDF (by content type, or a .pdf
// served as a generic download type). Only plain GETs: a POST can't be
// fetched again. PDFs embedded in a page are left alone (a viewer window
// popping up on every page load would be worse than a blank box).
function isPdfPageResponse(details, method) {
  if (method !== 'GET' || !/^https?:/i.test(details.url || '')) return false;
  if (details.resourceType !== 'mainFrame') return false;
  if (details.statusCode < 200 || details.statusCode >= 300) return false;
  const viewerOrDashboard = pdfViewerIds.has(details.webContentsId) || dashboardWebContentsIds.has(details.webContentsId);
  if (viewerOrDashboard) return false;
  const headers = details.responseHeaders || {};
  const header = (name) => {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return key ? String([].concat(headers[key])[0] || '').toLowerCase() : '';
  };
  const type = header('content-type');
  if (type.includes('application/pdf')) return true;
  const named = /\.pdf(["';\s]|$)/i.test(header('content-disposition')) || /\.pdf(\?|#|$)/i.test(details.url);
  return named && (type.includes('octet-stream') || type === '');
}

function pdfNameFrom(details) {
  const headers = details.responseHeaders || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-disposition');
  const disp = key ? String([].concat(headers[key])[0] || '') : '';
  const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disp);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
  }
  try { return decodeURIComponent(new URL(details.url).pathname.split('/').pop() || '') || 'Document'; } catch (_) { return 'Document'; }
}

async function showPdfFromResponse(ses, details) {
  // A new window opened just for this PDF would stay empty: close it.
  try {
    const wc = webContents.fromId(details.webContentsId);
    if (details.resourceType === 'mainFrame' && wc && wc.getType() === 'window') {
      const current = wc.getURL();
      if (!current || current === 'about:blank' || current === details.url) {
        const win = BrowserWindow.fromWebContents(wc);
        if (win && !win.isDestroyed()) win.close();
      }
    }
  } catch (_) {}

  try {
    // Same session, so the DDA login cookies come along.
    const res = await ses.fetch(details.url, { credentials: 'include' });
    let bytes = Buffer.from(await res.arrayBuffer());
    const head = bytes.subarray(0, 1024).indexOf('%PDF');
    if (head < 0) {
      console.warn('[PDF] response was not a PDF after all:', details.url);
      return;
    }
    if (head > 0) bytes = bytes.subarray(head);
    openPdfViewerWindow(bytes, pdfNameFrom(details));
  } catch (err) {
    console.warn('[PDF] could not load document for the viewer:', err?.message || err);
  }
}

ipcMain.handle('doc:openPdf', (event, input) => {
  const sender = event?.sender;
  if (!sender || !event.senderFrame || event.senderFrame.parent !== null) throw new Error('Unauthorized IPC caller');
  let fromDda = false;
  try { fromDda = new URL(sender.getURL()).hostname === 'eservices.dda.org.in'; } catch (_) {}
  const hosted = !!sender.hostWebContents && dashboardWebContentsIds.has(sender.hostWebContents.id);
  if (!fromDda || (!hosted && !BrowserWindow.fromWebContents(sender))) throw new Error('Unauthorized IPC caller');
  let bytes = Buffer.from(input?.bytes || []);
  if (bytes.length < 5 || bytes.length > 25 * 1024 * 1024) return false;
  // Like PDF readers, accept "%PDF" within the first 1 KB (some stored files
  // carry junk before it) and show the document from there.
  const head = bytes.subarray(0, 1024).indexOf('%PDF');
  if (head < 0) return false;
  if (head > 0) bytes = bytes.subarray(head);
  openPdfViewerWindow(bytes, String(input?.title || 'Document').slice(0, 120));
  return true;
});

// True once the card's expiry month has passed (cards are valid through the
// end of their expiry month)
function paymentCardExpired(card, now = new Date()) {
  const m = Number(card?.expMonth);
  const y = Number(String(card?.expYear || '').slice(-2));
  if (!m || Number.isNaN(y)) return false;
  const yy = now.getFullYear() % 100;
  return y < yy || (y === yy && m < now.getMonth() + 1);
}

ipcMain.handle('payment:saveCard', (event, input) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, error: 'OS encryption is not available; card not saved.' };
  }
  // Editing: a blank card number / CVV keeps the saved one (the renderer never
  // sees them, so it cannot pre-fill those boxes).
  const cards = readPaymentCards();
  const existing = input?.id ? cards.find((c) => c.id === input.id) : null;
  if (input?.id && !existing) return { success: false, error: 'That card no longer exists.' };
  const cardNumber = String(input?.cardNumber || '').replace(/\D/g, '') || existing?.cardNumber || '';
  const expDigits = String(input?.expiry || '').replace(/\D/g, '');
  const cvv = String(input?.cvv || '').replace(/\D/g, '') || existing?.cvv || '';
  const cardHolderName = String(input?.cardHolderName || '').trim().replace(/\s+/g, ' ');
  const label = String(input?.label || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  if (cardNumber.length < 12 || cardNumber.length > 19 || !luhnOk(cardNumber)) {
    return { success: false, error: 'Card number is not valid.' };
  }
  if (expDigits.length !== 4 && expDigits.length !== 6) {
    return { success: false, error: 'Expiry must be MM/YY.' };
  }
  const expMonth = expDigits.slice(0, 2);
  const expYear = expDigits.slice(-2);
  const m = Number(expMonth);
  if (m < 1 || m > 12) return { success: false, error: 'Expiry month must be 01-12.' };
  const now = new Date();
  const yy = now.getFullYear() % 100;
  if (Number(expYear) < yy || (Number(expYear) === yy && m < now.getMonth() + 1)) {
    return { success: false, error: 'Card has expired.' };
  }
  if (cvv.length < 3 || cvv.length > 4) return { success: false, error: 'CVV must be 3 or 4 digits.' };
  if (!cardHolderName) return { success: false, error: 'Name on card is required.' };

  const card = { id: existing?.id || crypto.randomUUID(), label, cardNumber, expMonth, expYear, cvv, cardHolderName };
  const list = existing ? cards.map((c) => (c.id === card.id ? card : c)) : [...cards, card];
  writePaymentCards(list);
  return { success: true, card: paymentCardSummary(card) };
});

// Dashboard: this PC's edits of applicants' website cards, masked
ipcMain.handle('payment:listApplicantCardEdits', (event) => {
  if (!isAuthorizedDashboardCaller(event)) return {};
  const out = {};
  for (const [pan, e] of Object.entries(readApplicantCardEdits())) {
    out[pan] = {
      last4: e.cardNumber ? e.cardNumber.slice(-4) : '',
      expiry: `${e.expMonth}/${e.expYear}`,
      cardHolderName: e.cardHolderName || '',
      baseMask: e.baseMask || '',
      hasCvv: applicantCardCvvs.has(pan),
    };
  }
  return out;
});

// Dashboard: edit an applicant's website card on this PC. A blank number keeps
// the website's number (the renderer only ever sees its mask).
ipcMain.handle('payment:saveApplicantCardEdit', (event, input) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, error: 'OS encryption is not available; card not saved.' };
  }
  const pan = String(input?.pan || '').toUpperCase().trim();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return { success: false, error: 'No applicant PAN.' };
  const baseMask = String(input?.baseMask || '').slice(0, 40);
  const edits = readApplicantCardEdits();
  const cardNumber = String(input?.cardNumber || '').replace(/\D/g, '') || edits[pan]?.cardNumber || '';
  if (cardNumber && (cardNumber.length < 12 || cardNumber.length > 19 || !luhnOk(cardNumber))) {
    return { success: false, error: 'Card number is not valid.' };
  }
  if (!cardNumber && !baseMask) return { success: false, error: 'Card number is required.' };
  const expDigits = String(input?.expiry || '').replace(/\D/g, '');
  if (expDigits.length !== 4 && expDigits.length !== 6) return { success: false, error: 'Expiry must be MM/YY.' };
  const expMonth = expDigits.slice(0, 2);
  const expYear = expDigits.slice(-2);
  if (Number(expMonth) < 1 || Number(expMonth) > 12) return { success: false, error: 'Expiry month must be 01-12.' };
  if (paymentCardExpired({ expMonth, expYear })) return { success: false, error: 'Card has expired.' };
  const cardHolderName = String(input?.cardHolderName || '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 60);
  if (!cardHolderName) return { success: false, error: 'Name on card is required.' };
  // CVV: blank keeps the one typed earlier in this run; "clear" removes it
  const cvv = String(input?.cvv || '').replace(/\D/g, '');
  if (cvv && (cvv.length < 3 || cvv.length > 4)) return { success: false, error: 'CVV must be 3 or 4 digits.' };
  // A new card number makes an earlier CVV meaningless
  const numberChanged = String(input?.cardNumber || '').replace(/\D/g, '') !== '' && cardNumber !== edits[pan]?.cardNumber;
  edits[pan] = { cardNumber, expMonth, expYear, cardHolderName, baseMask, savedAt: Date.now() };
  writeApplicantCardEdits(edits);
  if (cvv) applicantCardCvvs.set(pan, cvv);
  else if (input?.clearCvv === true || numberChanged) applicantCardCvvs.delete(pan);
  return { success: true, last4: cardNumber ? cardNumber.slice(-4) : '', expiry: `${expMonth}/${expYear}`, hasCvv: applicantCardCvvs.has(pan) };
});

// Dashboard: back to the website card (or drop an edit whose website card changed)
ipcMain.handle('payment:removeApplicantCardEdit', (event, pan) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const edits = readApplicantCardEdits();
  const key = String(pan || '').toUpperCase().trim();
  applicantCardCvvs.delete(key);
  if (edits[key]) {
    delete edits[key];
    try { writeApplicantCardEdits(edits); } catch (_) {}
  }
  return true;
});

ipcMain.handle('payment:listCards', (event) => {
  if (!isAuthorizedDashboardCaller(event)) return [];
  return readPaymentCards().map(paymentCardSummary);
});

ipcMain.handle('payment:removeCard', (event, id) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const list = readPaymentCards().filter((c) => c.id !== id);
  try {
    if (list.length) writePaymentCards(list);
    else fs.rmSync(paymentCardsPath(), { force: true });
  } catch (_) {}
  return true;
});

// ─── Saved net-banking logins (Chrome-style "Save password?") ───
// Stored like the card: one file encrypted with the OS keystore. Keyed by the
// login page's exact hostname; handed back only to a page on that host, inside
// a DDA webview of one of our dashboards. The dashboard only ever sees the
// host and a masked login ID.
const BANK_LOGIN_EXCLUDED_HOST = /(^|\.)(dda\.org\.in|billdesk\.com)$/i;
const BANK_LOGIN_OFFER_TTL_MS = 5 * 60 * 1000;
const pendingBankLoginOffers = new Map(); // offer id -> { host, username, password, wcId }
let bankLoginOfferSeq = 0;

function bankLoginsPath() {
  return path.join(app.getPath('userData'), 'bank_logins.bin');
}

function readBankLogins() {
  const empty = { logins: {}, never: [] };
  try {
    if (!safeStorage.isEncryptionAvailable()) return empty;
    const file = bankLoginsPath();
    if (!fs.existsSync(file)) return empty;
    const d = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    return { logins: d.logins || {}, never: Array.isArray(d.never) ? d.never : [] };
  } catch (err) {
    console.warn('[Bank logins] Could not read saved logins:', err.message);
    return empty;
  }
}

function writeBankLogins(store) {
  fs.writeFileSync(bankLoginsPath(), safeStorage.encryptString(JSON.stringify(store)));
  for (const id of dashboardWebContentsIds) {
    try { webContents.fromId(id)?.send('banklogin:changed'); } catch (_) {}
  }
}

function maskLoginId(id) {
  const s = String(id || '');
  if (!s) return '';
  if (s.length <= 4) return `${s[0]}${'*'.repeat(s.length - 1)}`;
  return `${s.slice(0, 2)}${'*'.repeat(Math.min(8, s.length - 4))}${s.slice(-2)}`;
}

// The host of a bank page asking from inside one of our DDA webviews (any
// frame); null for anything else, including DDA and BillDesk themselves.
function bankLoginCallerHost(event) {
  if (!event?.sender || !event.senderFrame) return null;
  const hostId = event.sender.hostWebContents?.id;
  if (!hostId || !dashboardWebContentsIds.has(hostId)) return null;
  try {
    const u = new URL(event.senderFrame.url);
    if (u.protocol !== 'https:' || BANK_LOGIN_EXCLUDED_HOST.test(u.hostname)) return null;
    if (isCardAuthUrl(u)) return null; // a card OTP page, never a login
    return u.hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

// Card 3-D Secure pages (the bank's OTP screen after a card payment) are never
// net-banking logins: their password-type box holds the OTP. Seen: ICICI
// secureicici-cr1…/v1/acs/…, HDFC securehdfc-acs2ui-…. Same rule in preload-dda.js.
const CARD_AUTH_HOST = /(^|[.-])acs\d*([.-]|ui|$)|3ds|securecode|verifiedbyvisa|wibmo|^secure[a-z]+-cr\d+\./i;
const CARD_AUTH_PATH = /\/acs\/|\/3ds|\/creq(\/|$)|\/challenge(\/|$)/i;
function isCardAuthUrl(u) {
  return CARD_AUTH_HOST.test(u.hostname || '') || CARD_AUTH_PATH.test(u.pathname || '');
}

// Logins saved from card OTP pages before that rule (the OTP, offered as a
// "login"): removed once at start.
function purgeCardAuthBankLogins() {
  try {
    const store = readBankLogins();
    const bad = Object.keys(store.logins).filter((h) => CARD_AUTH_HOST.test(h));
    const badNever = store.never.filter((h) => CARD_AUTH_HOST.test(h));
    if (!bad.length && !badNever.length) return;
    for (const h of bad) delete store.logins[h];
    store.never = store.never.filter((h) => !CARD_AUTH_HOST.test(h));
    writeBankLogins(store);
    runTrace(0, 'BANK-LOGIN', `removed ${bad.length} saved "login(s)" from card OTP pages: ${bad.join(', ') || '-'}${badNever.length ? `; ${badNever.length} from the Never list` : ''}`);
  } catch (err) {
    console.warn('[Bank logins] Could not clean card OTP entries:', err.message);
  }
}

// Webview (bank page): the user just logged in by hand. Offer to save it in
// the dashboard that hosts this webview, unless nothing changed or the user
// chose "Never" for this host.
ipcMain.on('banklogin:captured', (event, data) => {
  const host = bankLoginCallerHost(event);
  // Trace every captured bank login and what became of it (host and outcome only)
  const note = (outcome) => { try { runTrace(event.sender.id, 'BANK-LOGIN', `${host || '(not a bank page)'} ${outcome}`); } catch (_) {} };
  if (!host) return note('ignored: not a bank login page');
  if (!safeStorage.isEncryptionAvailable()) return note('not offered: OS encryption unavailable');
  const password = String(data?.password || '').slice(0, 256);
  if (!password) return note('not offered: password box was empty when the login was sent');
  const store = readBankLogins();
  if (store.never.includes(host)) return note('not offered: this site is on the "Never" list');
  const saved = store.logins[host];
  const username = String(data?.username || '').trim().slice(0, 128) || saved?.username || '';
  if (saved && saved.username === username && saved.password === password) return note('not offered: same as the saved login');
  note(saved ? 'offered: Update saved login' : 'offered: Save login');
  for (const [k, o] of pendingBankLoginOffers) if (o.wcId === event.sender.id) pendingBankLoginOffers.delete(k);
  const id = String(++bankLoginOfferSeq);
  pendingBankLoginOffers.set(id, { host, username, password, wcId: event.sender.id });
  setTimeout(() => pendingBankLoginOffers.delete(id), BANK_LOGIN_OFFER_TTL_MS);
  try {
    event.sender.hostWebContents.send('banklogin:offer', {
      id, wcId: event.sender.id, host, usernameMasked: maskLoginId(username), update: !!saved,
    });
  } catch (_) {}
});

// Dashboard: the user's answer to the offer: 'save' | 'never' | 'dismiss'.
ipcMain.handle('banklogin:respond', (event, { id, action } = {}) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const offer = pendingBankLoginOffers.get(String(id));
  pendingBankLoginOffers.delete(String(id));
  if (!offer || action === 'dismiss') return { success: !!offer };
  if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'OS encryption is not available; login not saved.' };
  const store = readBankLogins();
  if (action === 'save') {
    store.logins[offer.host] = { username: offer.username, password: offer.password, savedAt: Date.now() };
    store.never = store.never.filter((h) => h !== offer.host);
  } else if (action === 'never') {
    if (!store.never.includes(offer.host)) store.never.push(offer.host);
  } else {
    return { success: false };
  }
  writeBankLogins(store);
  return { success: true };
});

// Webview (bank page): the saved login for exactly this host, or null.
ipcMain.handle('banklogin:getForPage', (event) => {
  const host = bankLoginCallerHost(event);
  if (!host) return null;
  // An armed payment with the applicant's own net-banking login uses it on the bank's page
  const plan = paymentPlans.get(event.sender.id);
  const armedAt = paymentArmedAt.get(event.sender.id);
  if (plan?.bankLogin && armedAt && Date.now() - armedAt < PAYMENT_ARM_TTL_MS) {
    return { username: plan.bankLogin.username, password: plan.bankLogin.password, applicant: true };
  }
  const saved = readBankLogins().logins[host];
  return saved ? { username: saved.username, password: saved.password } : null;
});

ipcMain.handle('banklogin:list', (event) => {
  if (!isAuthorizedDashboardCaller(event)) return { logins: [], never: [] };
  const store = readBankLogins();
  return {
    logins: Object.entries(store.logins)
      .map(([host, l]) => ({ host, usernameMasked: maskLoginId(l.username), savedAt: l.savedAt || 0 }))
      .sort((a, b) => a.host.localeCompare(b.host)),
    never: store.never.slice().sort(),
  };
});

// Dashboard: save a bank login typed in by hand (no payment needed). The address can be the
// bank's login-page link or just its host; the login is kept for that exact host, like a
// login saved from the bank page itself.
function bankLoginHostFrom(address) {
  const raw = String(address || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    if (!host.includes('.') || BANK_LOGIN_EXCLUDED_HOST.test(host)) return null;
    return host;
  } catch (_) {
    return null;
  }
}
ipcMain.handle('banklogin:add', (event, { address, username, password } = {}) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'OS encryption is not available; login not saved.' };
  const host = bankLoginHostFrom(address);
  if (!host) return { success: false, error: 'Enter the bank login page link or address (not DDA or BillDesk).' };
  const store = readBankLogins();
  const updated = !!store.logins[host];
  // Editing a saved login: an empty login ID keeps the saved one
  const user = String(username || '').trim().slice(0, 128) || (updated ? store.logins[host].username || '' : '');
  const pass = String(password || '').slice(0, 256);
  if (!user || !pass) return { success: false, error: 'Enter both the login ID and the password.' };
  store.logins[host] = { username: user, password: pass, savedAt: Date.now() };
  store.never = store.never.filter((h) => h !== host);
  writeBankLogins(store);
  return { success: true, host, updated };
});

// Export / import of the saved bank logins, to carry them to the user's other computers.
// The saved file itself is locked to this Windows account, so the export is a separate file,
// scrambled with a key built into the app (no passphrase, by the user's choice: every bank
// still asks for an OTP). Only while signed in to the app. Import re-saves each login with
// that computer's own lock; a login for a host that is already saved is replaced.
const BANK_LOGIN_EXPORT_KIND = 'flat-book-bank-logins';
function bankLoginExportKey(salt) {
  return crypto.scryptSync('flat-book bank-login export v1 · 3f9c1e7a52d84b06', salt, 32);
}
ipcMain.handle('banklogin:export', async (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!verifiedSessionUser) return { success: false, error: 'Sign in to the app first.' };
  const store = readBankLogins();
  const count = Object.keys(store.logins).length;
  if (!count) return { success: false, error: 'There are no saved bank logins to export.' };
  const win = BrowserWindow.fromWebContents(event.sender);
  const stamp = new Date().toISOString().slice(0, 10);
  const pick = await dialog.showSaveDialog(win, {
    title: 'Export saved bank logins',
    defaultPath: path.join(app.getPath('desktop'), `flat-book-bank-logins-${stamp}.fbk`),
    filters: [{ name: 'Northdesk bank logins', extensions: ['fbk'] }],
  });
  if (pick.canceled || !pick.filePath) return { success: false, canceled: true };
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', bankLoginExportKey(salt), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ logins: store.logins }), 'utf8'), cipher.final()]);
  const file = {
    kind: BANK_LOGIN_EXPORT_KIND, v: 1, exportedAt: new Date().toISOString(), count,
    salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'),
  };
  fs.writeFileSync(pick.filePath, JSON.stringify(file));
  return { success: true, count, filePath: pick.filePath };
});
function readBankLoginExport(text) {
  const f = JSON.parse(text);
  if (f?.kind !== BANK_LOGIN_EXPORT_KIND || f.v !== 1) throw new Error('This is not a Northdesk bank-logins file.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', bankLoginExportKey(Buffer.from(f.salt, 'base64')), Buffer.from(f.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(f.tag, 'base64'));
  const json = Buffer.concat([decipher.update(Buffer.from(f.data, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(json).logins || {};
}
ipcMain.handle('banklogin:import', async (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (!verifiedSessionUser) return { success: false, error: 'Sign in to the app first.' };
  if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'OS encryption is not available; nothing imported.' };
  const win = BrowserWindow.fromWebContents(event.sender);
  const pick = await dialog.showOpenDialog(win, {
    title: 'Import saved bank logins',
    properties: ['openFile'],
    filters: [{ name: 'Northdesk bank logins', extensions: ['fbk'] }],
  });
  if (pick.canceled || !pick.filePaths?.[0]) return { success: false, canceled: true };
  let incoming;
  try {
    incoming = readBankLoginExport(fs.readFileSync(pick.filePaths[0], 'utf8'));
  } catch (err) {
    return { success: false, error: /Northdesk/.test(err.message) ? err.message : 'The file could not be read (damaged or not a bank-logins export).' };
  }
  const store = readBankLogins();
  let added = 0;
  let replaced = 0;
  for (const [h, l] of Object.entries(incoming)) {
    const host = bankLoginHostFrom(h);
    if (!host || !l?.password) continue;
    if (store.logins[host]) replaced++; else added++;
    store.logins[host] = { username: String(l.username || '').slice(0, 128), password: String(l.password).slice(0, 256), savedAt: Number(l.savedAt) || Date.now() };
    store.never = store.never.filter((x) => x !== host);
  }
  if (added + replaced) writeBankLogins(store);
  return { success: true, added, replaced };
});

// Dashboard: forget a saved login, or take a host off the "Never" list.
ipcMain.handle('banklogin:delete', (event, host) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const h = String(host || '').toLowerCase();
  const store = readBankLogins();
  delete store.logins[h];
  store.never = store.never.filter((x) => x !== h);
  writeBankLogins(store);
  return { success: true };
});

// Webview (DDA hold page): Fast Payment dispatched Make Payment for this
// webview, with the gateway / method / bank chosen in the sidebar.
// invoke (not send): the page waits for this before clicking Make Payment, so
// the frame is still on DDA when its origin is checked.
// The applicant's own card / net-banking login (web form, encrypted on the
// Worker), handed over by the window's dashboard when it reaches the hold page
// for its logged-in DDA account. Kept in memory on that window only; used for
// a payment armed for the same PAN, before this PC's saved card / bank login.
// The CVV is never part of it: the user types it on BillDesk.
ipcMain.handle('payment:setApplicantDetails', (event, details) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const win = getWindowFromSender(event.sender);
  if (!win) return false;
  const pan = String(details?.pan || '').toUpperCase().trim();
  if (!details || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    win.__ddaPaymentDetails = null;
    return true;
  }
  const c = details.card;
  const card = c && /^\d{12,19}$/.test(String(c.cardNumber || '')) && /^\d{2}$/.test(String(c.expMonth || '')) && /^\d{2}$/.test(String(c.expYear || ''))
    ? { cardNumber: String(c.cardNumber), expMonth: String(c.expMonth), expYear: String(c.expYear), cardHolderName: String(c.cardHolderName || '').slice(0, 60), cvv: '' }
    : null;
  const n = details.netbanking;
  const netbanking = n && n.userId && n.password ? { username: String(n.userId).slice(0, 128), password: String(n.password).slice(0, 256) } : null;
  win.__ddaPaymentDetails = card || netbanking ? { pan, card, netbanking } : null;
  return true;
});

function applicantPaymentDetailsFor(event, pan) {
  const d = getWindowFromSender(event.sender)?.__ddaPaymentDetails;
  return d && pan && d.pan === pan ? d : null;
}

ipcMain.handle('payment:arm', (event, plan) => {
  if (!isPaymentWebviewCaller(event, { ddaOnly: true })) {
    let from = '';
    try { from = event.senderFrame?.url || event.sender.getURL(); } catch (_) {}
    console.warn(`[Fast Payment] Arm rejected (caller not a DDA webview top frame): ${from || 'unknown frame'}`);
    fastPayTrace(`ARM REJECTED ${describePaymentCaller(event)} known-dashboards=[${[...dashboardWebContentsIds].join(',')}]`);
    return false;
  }
  const gateway = plan?.gateway === 'sbi' ? 'sbi' : 'cbi';
  // SBI's gateway offers net banking only.
  const method = gateway === 'sbi' || plan?.method === 'netbanking' ? 'netbanking' : 'card';
  // Older settings used short ids ("cbi", "pnb"); map them via the legacy table.
  const asked = String(plan?.bank || '').toLowerCase();
  const wanted = PAYMENT_BANK_LEGACY[asked] || asked;
  // Only banks this gateway's BillDesk page actually lists.
  const bankId = PAYMENT_BANKS.some((b) => b.id === wanted && (b.gateways || []).includes(gateway)) ? wanted : null;
  // The card is fixed now, so editing cards in another window cannot change
  // the card of a payment that is already under way.
  const cardId = String(plan?.cardId || '');
  // The DDA account's own applicant's details come first; this PC's saved
  // card / bank login otherwise
  const planPan = String(plan?.pan || '').toUpperCase().trim();
  const own = applicantPaymentDetailsFor(event, planPan);
  // An expired card is never filled (BillDesk rejects it and locks its number and CVV
  // boxes); the applicant's card is skipped when the sidebar chose this PC's card.
  // The applicant's card is the website card with this PC's edit of it on top.
  const wantPcCard = plan?.cardSource === 'pc';
  const ownCardRaw = gateway === 'cbi' && method === 'card' && !wantPcCard ? applicantCardWithEdit(planPan, own?.card) : null;
  const ownCard = ownCardRaw && !paymentCardExpired(ownCardRaw) ? ownCardRaw : null;
  const pcCardRaw = gateway === 'cbi' && method === 'card' && !ownCard ? resolvePaymentCard(cardId) : null;
  const pcCard = pcCardRaw && !paymentCardExpired(pcCardRaw) ? pcCardRaw : null;
  const card = ownCard || pcCard;
  const skipped = [
    ownCardRaw && !ownCard ? "applicant's card expired" : '',
    pcCardRaw && !pcCard ? "PC card expired" : '',
    wantPcCard && own?.card ? "applicant's card skipped (PC card chosen)" : '',
  ].filter(Boolean).join(', ');
  const bankLogin = method === 'netbanking' || gateway === 'sbi' ? own?.netbanking || null : null;
  paymentPlans.set(event.sender.id, { gateway, method, bankId, card, bankLogin, cardNote: card ? '' : skipped });
  paymentArmedAt.set(event.sender.id, Date.now());
  paymentSubmittedAt.delete(event.sender.id);
  fastPayTrace(`ARM OK ${describePaymentCaller(event)} gateway=${gateway} method=${method} bank=${bankId} (asked: ${String(plan?.bank || '')})${method === 'card' ? ` card=${card ? (ownCard ? (ownCard.edited ? "applicant's (edited on this PC)" : "applicant's") : 'set') : 'NONE'}${cardId && !ownCard ? ' (picked)' : ''}${skipped ? ` [${skipped}]` : ''}` : ` login=${bankLogin ? "applicant's" : 'PC'}`}`);
  return true;
});

// Webview (gateway): what to do for this armed payment — the card, or the bank
// to pick for net banking. After the Pay click it returns { submitted: true }
// so a gateway reload steps aside quietly. null = not armed (do nothing).
ipcMain.handle('payment:getGatewayPlan', (event) => {
  if (!isPaymentWebviewCaller(event)) {
    fastPayTrace(`PLAN null (caller rejected) ${describePaymentCaller(event)}`);
    return null;
  }
  const submittedAt = paymentSubmittedAt.get(event.sender.id);
  if (submittedAt && Date.now() - submittedAt < PAYMENT_ARM_TTL_MS) {
    fastPayTrace(`PLAN submitted (already handed over) ${describePaymentCaller(event)}`);
    return { submitted: true };
  }
  const armedAt = paymentArmedAt.get(event.sender.id);
  if (!armedAt || Date.now() - armedAt > PAYMENT_ARM_TTL_MS) {
    fastPayTrace(`PLAN null (${armedAt ? 'arm expired' : 'not armed'}) ${describePaymentCaller(event)} armed-webviews=[${[...paymentArmedAt.keys()].join(',')}]`);
    return null;
  }
  const plan = paymentPlans.get(event.sender.id) || { gateway: 'cbi', method: 'card', bankId: null };
  fastPayTrace(`PLAN ok ${describePaymentCaller(event)} gateway=${plan.gateway} method=${plan.method} bank=${plan.bankId}`);
  // The bank always travels: SBI-hosted pages use net banking whatever the
  // method says. The card only for CBI card payments.
  return {
    armedAt,
    gateway: plan.gateway,
    method: plan.method,
    // { id, name (exact BillDesk label), code (BillDesk logo id) }
    bank: PAYMENT_BANKS.find((b) => b.id === plan.bankId) || null,
    card: plan.gateway === 'cbi' && plan.method === 'card' && plan.card
      ? { cardNumber: plan.card.cardNumber, expMonth: plan.card.expMonth, expYear: plan.card.expYear, cvv: plan.card.cvv, cardHolderName: plan.card.cardHolderName }
      : null,
    // Why no card was handed over (e.g. "applicant's card expired"), for the log
    cardNote: plan.cardNote || '',
  };
});

// Webview (DDA flat page): one line per flat-captcha attempt and its verdict,
// to trace "Invalid captcha code" on correct answers. No images, no answers
// beyond the captcha sum.
ipcMain.on('captcha:trace', (event, msg) => {
  const hostId = event?.sender?.hostWebContents?.id;
  if (!hostId || !dashboardWebContentsIds.has(hostId)) return;
  fastPayTrace(`CAPTCHA wc=${event.sender.id} ${String(msg || '').slice(0, 400)}`);
});

// Dashboard: TIMED arm / wake / start, with server and PC times side by side
ipcMain.on('timed:trace', (event, msg) => {
  if (!isAuthorizedDashboardCaller(event)) return;
  fastPayTrace(`TIMED win=${event.sender.id} ${String(msg || '').slice(0, 400)}`);
});

// Webview (DDA login page): one line per static-file warm-up (counts only)
ipcMain.on('assets:trace', (event, msg) => {
  const hostId = event?.sender?.hostWebContents?.id;
  if (!hostId || !dashboardWebContentsIds.has(hostId)) return;
  fastPayTrace(`ASSETS wc=${event.sender.id} ${String(msg || '').slice(0, 300)}`);
});

// Webview (DDA payment result page): DDA's verdict on the payment, kept on this
// PC's booking run and in the trace. The dashboard sends it to the server.
ipcMain.on('payment:result', (event, info) => {
  if (!isAuthorizedDdaWebviewCaller(event)) return;
  const p = info?.payment || {};
  const pan = String(info?.pan || '').toUpperCase().trim();
  let runId = null;
  try { runId = db.setBookingRunPayment(String(info?.runId || ''), pan, p); } catch (_) {}
  runTrace(event.sender.id, 'PAYMENT-RESULT',
    `${p.status || '?'} dda="${String(p.ddaStatus || p.message || '').slice(0, 60)}" amount=${p.amount || '-'} txn=${p.transactionId || '-'} ref=${p.referenceNo || '-'} gateway=${p.gateway || '-'} run=${runId || 'not found on this PC'}`);
});

// Webview (gateway): Pay clicked; one auto-submit per armed payment.
ipcMain.on('payment:submitted', (event) => {
  if (!isPaymentWebviewCaller(event)) return;
  fastPayTrace(`HANDED OVER (no more automation for this payment) ${describePaymentCaller(event)}`);
  paymentArmedAt.delete(event.sender.id);
  paymentSubmittedAt.set(event.sender.id, Date.now());
});

// ─── Web portal (applicant manager) in a Northdesk window ───────────────
// Opened from the account menu and signed in with the app's own login (the
// same Firebase account). That login is kept encrypted (safeStorage) while the
// app is signed in and deleted on sign-out; only the portal window's page, on
// the portal's own host, can read it, to fill the portal's sign-in form.
const PORTAL_URL = 'https://dda-db-rs.web.app/';
const PORTAL_HOSTS = new Set(['dda-db-rs.web.app', 'dda-db-rs.firebaseapp.com']);
const PORTAL_PARTITION = 'persist:web_portal';
let portalWindow = null;

function appLoginPath() {
  return path.join(app.getPath('userData'), 'app_login.bin');
}

function readAppLogin() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const file = appLoginPath();
    if (!fs.existsSync(file)) return null;
    const d = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    return d?.email && d?.password ? { email: d.email, password: d.password } : null;
  } catch (_) {
    return null;
  }
}

function isPortalUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && PORTAL_HOSTS.has(u.hostname);
  } catch (_) {
    return false;
  }
}

// Closes the portal window and signs it out (its Firebase sign-in lives in its partition)
async function clearWebPortal() {
  try {
    if (portalWindow && !portalWindow.isDestroyed()) portalWindow.destroy();
  } catch (_) {}
  portalWindow = null;
  try { await session.fromPartition(PORTAL_PARTITION).clearStorageData(); } catch (_) {}
}

ipcMain.handle('applogin:save', async (event, login) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const email = String(login?.email || '').trim().toLowerCase();
  const password = String(login?.password || '');
  if (!email || !password) return { success: false, error: 'missing email or password' };
  if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'OS encryption is not available' };
  const previous = readAppLogin();
  try {
    fs.writeFileSync(appLoginPath(), safeStorage.encryptString(JSON.stringify({ email, password })));
  } catch (err) {
    return { success: false, error: err.message };
  }
  // Another account: the portal window's sign-in was the previous one's
  if (previous && previous.email !== email) await clearWebPortal();
  return { success: true };
});

ipcMain.handle('applogin:clear', async (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  try { fs.rmSync(appLoginPath(), { force: true }); } catch (_) {}
  await clearWebPortal();
  return { success: true };
});

ipcMain.handle('portal:open', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  if (portalWindow && !portalWindow.isDestroyed()) {
    if (portalWindow.isMinimized()) portalWindow.restore();
    portalWindow.focus();
    return { success: true, reused: true };
  }
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    title: 'Web portal - Northdesk',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      partition: PORTAL_PARTITION,
      preload: path.join(__dirname, 'preload-portal.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  portalWindow = win;
  win.on('closed', () => { if (portalWindow === win) portalWindow = null; });
  // The portal stays in this window; any other site opens in the normal browser
  win.webContents.on('will-navigate', (e, url) => {
    if (isPortalUrl(url)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // The portal's print sheets open a blank window of their own
    if (url === 'about:blank' || isPortalUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: PORTAL_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.loadURL(PORTAL_URL).catch(() => {});
  return { success: true };
});

// Only the portal window's own top frame, on the portal's host
function isPortalWindowCaller(event) {
  if (!portalWindow || portalWindow.isDestroyed() || event.sender !== portalWindow.webContents) return false;
  if (!event.senderFrame || event.senderFrame.parent !== null) return false;
  return isPortalUrl(event.senderFrame.url);
}

// The portal window's sign-in filler asks for the app's login
ipcMain.handle('portal:getLogin', (event) => {
  if (!isPortalWindowCaller(event)) return null;
  return readAppLogin();
});

// A sign-in typed in the portal window that worked: kept as the app's login
// when it is the account signed in to the app (an app session restored
// without typing the password has none saved), so the next time it fills itself
ipcMain.handle('portal:learnLogin', (event, login) => {
  if (!isPortalWindowCaller(event)) return { success: false };
  const email = String(login?.email || '').trim().toLowerCase();
  const password = String(login?.password || '');
  const appEmail = String(verifiedSessionUser?.email || globalActiveUser?.email || '').trim().toLowerCase();
  if (!email || !password || !appEmail || email !== appEmail) return { success: false, error: 'not the app account' };
  if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'OS encryption is not available' };
  const saved = readAppLogin();
  if (saved && saved.email === email && saved.password === password) return { success: true, unchanged: true };
  try {
    fs.writeFileSync(appLoginPath(), safeStorage.encryptString(JSON.stringify({ email, password })));
  } catch (err) {
    return { success: false, error: err.message };
  }
  return { success: true };
});

// ─── Booking window expiry (normal users) ───────────────────────────────
// Logout wipes DDA cookies in every partition, so expiry is decided here once
// for all dashboard windows, and deferred while any window is mid-booking
// (reservation in flight, 15-min hold, payment gateway / bank OTP).
let bookingWindowEnd = null;
let bookingExpiryTimer = null;
const busyDashboards = new Map(); // webContents.id -> boolean

function scheduleBookingExpiry(delayMs) {
  if (bookingExpiryTimer) {
    clearTimeout(bookingExpiryTimer);
    bookingExpiryTimer = null;
  }
  if (!bookingWindowEnd) return;
  const delay = delayMs ?? Math.max(0, bookingWindowEnd - Date.now());
  // setTimeout overflows past ~24.8 days; fireBookingExpiry re-checks the clock.
  bookingExpiryTimer = setTimeout(fireBookingExpiry, Math.min(delay, 2 ** 31 - 1));
}

function fireBookingExpiry() {
  bookingExpiryTimer = null;
  if (!bookingWindowEnd) return;
  if (Date.now() < bookingWindowEnd) return scheduleBookingExpiry();
  const anyBusy = [...dashboardWindows].some(
    (w) => w && !w.isDestroyed() && busyDashboards.get(w.webContents.id)?.busy
  );
  if (anyBusy) {
    console.log('[Auth] Booking window ended; logout deferred while a booking is in progress');
    return scheduleBookingExpiry(10000);
  }
  console.log('[Auth] Booking window ended; logging out all dashboard windows');
  bookingWindowEnd = null;
  busyDashboards.clear();
  broadcastToDashboards('auth:booking-window-expired', {});
}

ipcMain.on('auth:setBookingWindowEnd', (event, iso) => {
  if (!isAuthorizedDashboardCaller(event)) return;
  const t = iso ? new Date(iso).getTime() : NaN;
  bookingWindowEnd = Number.isFinite(t) ? t : null;
  scheduleBookingExpiry();
});

ipcMain.on('auth:reportBookingBusy', (event, report) => {
  if (!isAuthorizedDashboardCaller(event)) return;
  const busy = typeof report === 'object' && report ? Boolean(report.busy) : Boolean(report);
  const what = typeof report === 'object' && report ? String(report.what || '').slice(0, 120) : '';
  busyDashboards.set(event.sender.id, { busy, what });
});

// App sign-out is for the whole app (one app user for all windows): the window
// signing out first asks which windows are mid-booking, to warn about them...
ipcMain.handle('auth:getBusyWindows', (event) => {
  if (!isAuthorizedDashboardCaller(event)) throw new Error('Unauthorized IPC caller');
  const list = [];
  for (const w of dashboardWindows) {
    if (!w || w.isDestroyed()) continue;
    const b = busyDashboards.get(w.webContents.id);
    if (b?.busy) list.push({ window: w.__ddaDisplayIndex || 0, what: b.what, self: w.webContents.id === event.sender.id });
  }
  return list.sort((a, b) => a.window - b.window);
});

// ...then, once signed out, the other windows go to the login screen too.
ipcMain.on('auth:signedOutAll', (event) => {
  if (!isAuthorizedDashboardCaller(event)) return;
  busyDashboards.clear();
  runTrace(0, 'APP-SIGNOUT', `window ${BrowserWindow.fromWebContents(event.sender)?.__ddaDisplayIndex || '?'} signed out; all windows go to the login screen`);
  for (const win of dashboardWindows) {
    if (!win || win.isDestroyed() || win.webContents.id === event.sender.id) continue;
    try { win.webContents.send('auth:signed-out', {}); } catch (_) {}
  }
});

// Relay flat selected event to Dashboard UI for 0ms sidepanel collapse
ipcMain.on('dda:flat-selected', (event, data) => {
  try { runTrace(event.sender?.id, 'FLAT-SELECTED', JSON.stringify(data).slice(0, 1500)); } catch (_) {}
  sendToSenderWindow(event.sender, 'dda:flat-selected', data);
});

// Relay payment hold info to Dashboard UI
ipcMain.on('dda:payment-hold-info', (event, data) => {
  try { runTrace(event.sender?.id, 'HOLD-INFO', JSON.stringify(data).slice(0, 1500)); } catch (_) {}
  sendToSenderWindow(event.sender, 'dda:payment-hold-info', data);
});

// Relay applicant logout from DDA Portal to Dashboard UI
ipcMain.on('dda:applicant-logout', (event, data) => {
  try { runTrace(event.sender?.id, 'DDA-LOGOUT', JSON.stringify(data || {}).slice(0, 300)); } catch (_) {}
  console.log('🚪 [Main] Relaying dda:applicant-logout to window UI:', data);
  sendToSenderWindow(event.sender, 'dda:applicant-logout', data);
});

// Relay authenticated user login from DDA Portal strictly to THAT window's Dashboard UI
ipcMain.on('dda:user-logged-in', (event, data) => {
  setRunLabel(event.sender?.id, data?.pan);
  runTrace(event.sender?.id, 'DDA-LOGIN', `pan=${data?.pan || '?'}`);
  sendToSenderWindow(event.sender, 'dda:user-logged-in', data);
});

// Relay save password prompt strictly to THAT window's Dashboard UI
ipcMain.on('dda:prompt-save-password', (event, data) => {
  sendToSenderWindow(event.sender, 'dda:prompt-save-password', data);
});

// Relay profile name updates strictly to THAT window's Dashboard UI
ipcMain.on('dda:update-profile-name', (event, data) => {
  sendToSenderWindow(event.sender, 'dda:update-profile-name', data);
});



// The trace's times are this PC's clock; TIMED and the console run on the
// Worker's clock (src/utils/serverClock.js). This line gives the difference so
// a trace can be read in server time: server = trace time + offset.
async function traceServerClock() {
  const base = process.env.VITE_WORKER_URL || 'https://dda-engine.asmrahul17.workers.dev';
  let best = null;
  for (let i = 0; i < 3; i++) {
    try {
      const t0 = Date.now();
      const res = await fetch(`${base}/time`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const t1 = Date.now();
      const data = res.ok ? await res.json() : null;
      if (typeof data?.now === 'number' && (!best || t1 - t0 < best.rtt)) {
        best = { offset: Math.round(data.now - (t0 + t1) / 2), rtt: t1 - t0 };
      }
    } catch (_) {}
  }
  if (!best) return runTrace(0, 'CLOCK', 'server time not reached; TIMED uses this PC\'s clock');
  const s = (Math.abs(best.offset) / 1000).toFixed(2);
  const how = Math.abs(best.offset) < 50 ? 'in step with' : best.offset < 0 ? `${s} s ahead of` : `${s} s behind`;
  runTrace(0, 'CLOCK', `offset=${best.offset}ms rtt=${best.rtt}ms — this PC is ${how} server time (server = trace time ${best.offset < 0 ? '-' : '+'} ${s} s)`);
}

// ─── APP LIFECYCLE ─────────────────────────────────────────────────────

app.whenReady().then(() => {
  initRunTrace(app.getPath('userData'));
  runTrace(0, 'APP-START', `version=${app.getVersion()} pid=${process.pid}`);
  traceServerClock();
  {
    const t = initStep2Tree(path.join(app.getPath('userData'), 'dda_db', 'step2_tree.json'));
    runTrace(0, 'STEP2TREE', `loaded ${t.schemes} scheme(s), ${t.lists} list(s) from disk`);
  }
  setInterval(traceServerClock, 10 * 60 * 1000);
  purgeCardAuthBankLogins();
  if (process.platform === 'win32') {
    try {
      app.setAppUserModelId('org.dda.housing.automation');
    } catch (_) {}
  }
  setupApplicationMenu();

  // 🛡️ Cross-Platform App Nap & Sleep Blocker (macOS App Nap + Windows Idle Sleep)
  try {
    const blockerId = powerSaveBlocker.start('prevent-app-suspension');
    console.log(`⚡ [PowerSaveBlocker] Active (ID: ${blockerId}) - macOS App Nap & Windows sleep disabled`);
  } catch (err) {
    console.warn('⚠️ [PowerSaveBlocker] Failed to initialize:', err);
  }

  // 🚀 Cross-Platform Process Priority Elevation (macOS & Windows Parity)
  try {
    if (os.constants?.priority) {
      os.setPriority(process.pid, os.constants.priority.PRIORITY_HIGH);
      console.log('⚡ [Process Priority] Elevated to HIGH');
    }
  } catch (_) {
    try {
      os.setPriority(process.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
      console.log('⚡ [Process Priority] Elevated to ABOVE_NORMAL');
    } catch (e) {
      console.warn('⚠️ [Process Priority] Priority elevation notice:', e.message);
    }
  }

  // 🌐 High-Speed Network Sockets Pre-Connect & DNS Pre-Resolution (Zero-Latency Warm Pool)
  const ddaOrigin = 'https://eservices.dda.org.in';
  try {
    setupSessionOptimizations(session.defaultSession);
    session.defaultSession.preconnect({ url: ddaOrigin, numSockets: 6 });
    session.defaultSession.resolveHost('eservices.dda.org.in').catch(() => {});

    const webviewSession = session.fromPartition('persist:dda_session');
    setupSessionOptimizations(webviewSession);
    webviewSession.preconnect({ url: ddaOrigin, numSockets: 6 });
    webviewSession.resolveHost('eservices.dda.org.in').catch(() => {});

    for (let i = 1; i <= 3; i++) {
      const s = session.fromPartition(`persist:dda_session_${i}`);
      setupSessionOptimizations(s);
      s.preconnect({ url: ddaOrigin, numSockets: 6 });
      s.resolveHost('eservices.dda.org.in').catch(() => {});
    }
    console.log('⚡ [Network Pre-Connect] Default, webview & isolated sessions (1-3) primed with 6 persistent TLS sockets & static caching');
  } catch (err) {
    console.warn('⚠️ [Network Pre-Connect] Initialization notice:', err);
  }

  db.init();

  // 🔥 Pre-warm native C++ ONNX captcha engine immediately on launch
  initLocalCaptchaModel().catch((err) => {
    console.warn('⚠️ [Native ONNX] Startup initialization notice:', err);
  });
  // Which engine runs the captcha model (native, else WebAssembly) goes in the
  // trace. Only if neither can run it: say so once on screen; the app carries
  // on with typed captchas.
  captchaSolverReady.then(async (solver) => {
    if (solver) {
      const session = await solver.initLocalCaptchaModel().catch(() => null);
      const info = solver.captchaEngineInfo?.() || {};
      if (session) {
        runTrace(null, 'CAPTCHA-SOLVER', `ready (${info.engine === 'wasm' ? 'WebAssembly engine' : 'native engine'})${info.nativeError ? `; native engine failed: ${info.nativeError}` : ''}`);
        return;
      }
      captchaSolverError = info.lastInitError || info.nativeError || 'unknown error';
    }
    runTrace(null, 'CAPTCHA-SOLVER', `unavailable, captchas must be typed: ${captchaSolverError}`);
    dialog.showMessageBox({
      type: 'warning',
      title: 'Northdesk',
      message: 'The captcha solver could not start on this PC.',
      detail:
        'The app works, but you will need to type the captchas yourself (the flat page opens DDA\'s captcha box for you).\n\n' +
        'Usual cause: Microsoft Visual C++ Redistributable (x64) is missing. Installing it from Microsoft and restarting Northdesk fixes this.\n\n' +
        `Details: ${captchaSolverError}`,
    }).catch(() => {});
  });

  // Forward all <webview> console output straight into Electron terminal
  app.on('web-contents-created', (event, contents) => {
    try {
      contents.setMaxListeners(50);
    } catch (_) {}

    if (contents.getType() === 'webview') {
      runTracedWebviews.add(contents.id);
      contents.once('destroyed', () => runTracedWebviews.delete(contents.id));
      attachRunTrace(contents);
      // Popup windows DDA / BillDesk open from this page are traced too.
      contents.on('did-create-window', (win) => {
        try {
          const child = win.webContents;
          runTracedWebviews.add(child.id);
          child.once('destroyed', () => runTracedWebviews.delete(child.id));
          runTrace(contents.id, 'POPUP-WINDOW', `opened as wc${child.id}`);
          setRunLabel(child.id, labelFor(contents.id).startsWith('wc') ? '' : labelFor(contents.id));
          attachRunTrace(child);
        } catch (_) {}
      });
      contents.on('did-navigate', (_e, url) => fastPayTrace(`NAV wc=${contents.id} ${traceUrl(url)}`));
      // Where a page change started: a redirect, a page script, a link. With
      // the REQ/REDIRECT lines this shows what sent the user to the login page.
      contents.on('did-start-navigation', (details) => {
        try {
          if (!details?.isMainFrame || details.isSameDocument) return;
          const by = details.initiator ? (() => { try { return new URL(details.initiator.url).pathname; } catch (_) { return 'page'; } })() : 'app/user';
          fastPayTrace(`NAV-START wc=${contents.id} ${traceUrl(details.url)}${details.isRedirect ? ' (redirect)' : ''} by=${by}`);
        } catch (_) {}
      });
      // Every webview partition gets the session hooks (PDF viewer, caching,
      // trackers), not only the pre-warmed ones; it is a no-op when done.
      setupSessionOptimizations(contents.session);
      // Google / bank sites (reached via the Google shortcut) that open a link
      // in a new window: load it in this webview instead, so the page keeps the
      // preload (saved bank logins). DDA and BillDesk popups are left as they were.
      contents.setWindowOpenHandler(({ url }) => {
        try {
          const opener = new URL(contents.getURL());
          const target = new URL(url);
          const fromDdaOrGateway = /(^|\.)(dda\.org\.in|billdesk\.com)$/i.test(opener.hostname);
          if (!fromDdaOrGateway && target.protocol === 'https:') {
            contents.loadURL(url).catch(() => {});
            return { action: 'deny' };
          }
        } catch (_) {}
        return { action: 'allow' };
      });
      contents.on('console-message', (event, level, message, line, sourceId) => {
        if (message.includes("Bootstrap's JavaScript requires at least jQuery")) return;
        if (level >= 3) {
          // Name the script for errors (DDA's own scripts vs ours).
          let src = '';
          try { if (sourceId) src = ` (${new URL(sourceId).pathname.split('/').pop() || sourceId}:${line})`; } catch (_) { if (sourceId) src = ` (${String(sourceId).slice(-40)}:${line})`; }
          console.error(`[Webview Error] ${message}${src}`);
          fastPayTrace(`PAGE-ERROR wc=${contents.id} ${message.slice(0, 160)}${src}`);
        } else if (level === 2) {
          console.warn(`[Webview Warn] ${message}`);
        } else {
          console.log(`[Webview] ${message}`);
        }
      });
    }
  });

  createDashboardWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createDashboardWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
