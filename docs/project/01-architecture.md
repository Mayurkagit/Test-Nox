# 01 — Architecture

## Stack

| Part | Technology |
|---|---|
| Desktop shell | Electron 34 (Chromium 132), `main.js` is an ES module (`"type": "module"`) |
| UI | React 19, Zustand 5, Tailwind CSS 4, lucide-react icons, Vite 8 |
| Captcha | `onnxruntime-node` with a local model (`models/nd_core_layer.bin` + external weights `nd_core_layer.weights`) |
| PDF rendering | `pdfjs-dist` 4.x (Chromium's built-in PDF viewer cannot be used, see below) |
| Backend | Cloudflare Worker (REST + SSE) and Firebase (auth, Firestore `bookingRuns`) |
| Packaging | electron-builder (NSIS installer and portable exe, Windows x64) |

## Processes and where code runs

```
┌──────────────── main process (main.js) ─────────────────┐
│ windows & sessions · IPC · local DB (db/database.js)     │
│ ONNX captcha (engine/vision.js)                      │
│ Step 2 URL builder (step2Resolver.js, session.fetch)      │
│ payment arm/plan · encrypted card + bank logins           │
│ fastpay_trace.log · PDF viewer windows                    │
└───────────────▲─────────────────────────▲────────────────┘
                │ IPC (preload.cjs bridge)│ IPC (ipcRenderer, sendToHost)
┌───────────────┴──────────┐   ┌──────────┴─────────────────────────┐
│ Dashboard renderer (src/) │   │ <webview> with the real DDA portal  │
│ React: Workspace, sidebar,│──▶│ preload-dda.js (contextIsolation   │
│ top bar, modals           │   │ off) = the page automation engine   │
│ injects ddaAutomations.js │   │ also runs on BillDesk / bank pages │
└───────────────────────────┘   └────────────────────────────────────┘
```

- **Dashboard window:** `BrowserWindow` with `preload.cjs` (context isolation on, sandbox off, `webviewTag: true`). Exposes `window.ddaElectronAPI`.
- **DDA webview:** `<webview allowpopups webpreferences="webSecurity=no, contextIsolation=no">` with `preload-dda.js`. One partition per window/applicant so sessions stay isolated.
- **PDF viewer window:** opened by main for PDFs the DDA page shows; loads the app with `?pdfDoc=<token>` and the tiny sandboxed `preload-pdfviewer.cjs`.
- **Standalone DDA session windows:** `launchApplicantSession` can open a DDA window per applicant (rarely used).

## Key files

| File | Role |
|---|---|
| `main.js` (~2,700 lines) | App lifecycle, Chromium switches, dashboard windows, session optimisation (pre-connect, tracker blocking, static caching), all IPC handlers, payment plan/arming, card + bank-login storage (safeStorage), Step 2 shared cache, fastpay trace, PDF viewer windows |
| `preload-dda.js` (~12,600 lines) | Page engine inside the DDA webview: login autofill + captcha, schemes polling + heartbeat, application form fill, locality cascade / direct jump, Step 2 search + direct reservation + captcha, conflict recovery, hold page (confirmation, timer sync, telemetry), Fast Payment (DDA stages, gateway, BillDesk, SBI chooser, fee sheet, OTP stop), saved bank logins, DDA PDF links |
| `preload.cjs` | Dashboard bridge `ddaElectronAPI` (DB, sessions, settings, payment config, bank logins, logs, captcha) |
| `preload-pdfviewer.cjs` | Viewer-window bridge: only `getPdfDocument(token)` |
| `step2Resolver.js` | Main-process 5-request cascade that builds the Step 2 (flat select) URL from scheme + preferences |
| `engine/vision.js` | Loads the ONNX model (maps `app.asar` → `app.asar.unpacked` in the exe), solves tensors/base64 images |
| `db/database.js` | JSON-file local database: applicants, settings, booking runs, login users, cloud applicant cache |
| `src/views/Workspace.jsx` | The main screen: webview, stage detection, login/applicant matching, buttons → injected scripts, telemetry fallback, payment-flow tracking |
| `src/components/DdaWebview.jsx` | Webview element, event wiring, IPC from the page (`dda:flat-selected`, reserved chime, hold info), auto-reload timers |
| `src/components/RightControlSidebar.jsx` | Chooses the sidebar layout per page (`getSidebarMode`) |
| `src/components/sidebar/*` | Sidebar pieces: applicant selector, preferences, scheme panel + hold card, automation modes, controls, logs console, bank logins |
| `src/utils/ddaAutomations.js` | Scripts injected by dashboard buttons (Timed schemes poller, flat hunter, form autofill, hold analytics extraction…) |
| `src/utils/ddaRoutes.js` | URL → stage detection, `getSidebarMode`, payment-flow helpers |
| `src/utils/multiReload.js` | Multi-Reload engine (retry until DDA really loads; cascade-rebuild fallback after ~20 straight failures) |
| `src/views/ApplicantPick.jsx` | The applicant picker: shown after every sign-in and on every new window; locks the window onto one DDA login |
| `src/utils/loginLock.js` | Per-window login lock (`dda_locked_login_pan`): get/set, the restart carry rule (`carryLockAfterRestart`), the `useLockedLoginPan` hook |
| `src/services/api.js` | Worker calls: login, booking key, applicants (full + by-PAN patch), schemes, telemetry, config sync, saved DDA password |
| `src/services/realtimeSync.js` | Firestore `meta/sync` "changed" listener (patches only the applicants that changed), schemes + public config listeners, 5-minute booking-key check (`Workspace.jsx` runs the same check every 60 s too) |
| `src/store/*` | Zustand stores: `useApplicantStore`, `useAutomationStore`, `useSettingsStore`, `useAuthStore` |
| `src/components/PdfPages.jsx`, `src/views/PdfDocWindow.jsx` | pdf.js page rendering and the PDF viewer window |
| `payment_banks.json` | Per-gateway bank lists for Fast Payment net banking |

## App flow (renderer)

`App.jsx` routes between these views:
1. **RESTORING** — a short "Opening window…" screen shown while a saved sign-in is restored (a reopened app, a reload, a new window), so the login form never flashes when the user is already signed in.
2. **WelcomeLogin** — app user login (Worker `/me`, Firebase).
3. **KeyVerification** — normal users must enter a valid booking key (Worker `/extension/validate-key`); admins skip it. The key also sets the booking window end; normal users are logged out when it ends (`auth:setBookingWindowEnd`).
4. **ApplicantPick** — the applicant picker (`ApplicantPick.jsx`), shown after every sign-in and on every window opened with **+**. It locks the window onto one DDA login; applicants locked in other open windows are greyed out.
5. **Workspace** — the booking screen. Each window is a session (`?winSession=session_N`, title "Flat book - Window N"); several windows can run side by side, each with its own DDA partition and locked applicant.

## IPC channels (main.js)

- **Auth / session:** `auth:login`, `auth:validateBookingKey`, `auth:setBookingWindowEnd`, `auth:reportBookingBusy`, `session:*` (launch, preconnect, active user/applicant, webview context, clear DDA session, close, authenticate token)
- **Database:** `db:getApplicants`, `db:getApplicantsByUser`, `db:getApplicantByPan`, `db:saveApplicant`, `db:deleteApplicant`, `db:cacheApplicants` (with `{ full }` to also drop applicants removed in the cloud), `db:uncacheApplicants`, `db:getLocalPrefs`, `db:saveLocalPrefs`, `db:clearLocalPrefs` (flat preferences changed in the app, per app user), `db:getSettings`, `db:saveSettings`, `db:saveBookingRun`, `db:getBookingRuns`, `db:loadLoginUsers`, `db:saveLoginUsers`
- **Page engine → app:** `dda:log`, `dda:flat-selected` (`reserved:true` / `holdConfirmed:true`), `dda:flat-availability`, `dda:payment-hold-info`, `dda:analytics-dispatched`, `dda:reset-run-logs`, `dda:user-logged-in`, `dda:applicant-logout`, `dda:update-profile-name`, `dda:prompt-save-password`
- **Captcha:** `captcha:solveLocal`, `captcha:warmup`, `captcha:trace`
- **Step 2:** `step2:prefetch`, `step2:ensure`, `step2:getResolved`
- **Payment:** `payment:saveCard`, `payment:listCards`, `payment:removeCard`, `payment:arm`, `payment:getGatewayPlan`, `payment:submitted`
- **Bank logins:** `banklogin:captured`, `banklogin:respond`, `banklogin:getForPage`, `banklogin:list`, `banklogin:delete`
- **Telemetry / logs:** `analytics:save`, `logs:openFile`, `logs:openFolder`
- **PDF:** `doc:openPdf` (DDA page → main), `doc:get` (viewer window → main)
- **Windows:** `window:createDashboard`, `window:listOpenSessions`, `window:getDisplayIndex`, `window:setTitle`, `window:takeLockStartupPlan` (first window of a run: which windows were open before, so the one surviving lock can carry to it), `window:clearOwnDdaLogin`, `app:getDdaPreloadUrl`, `app:openWebviewDevTools`

DDA passwords are **not** an IPC channel: the desktop app reads each applicant's decrypted password from the Worker (it arrives with the applicant list), and admins save one through the Worker (`PUT /applicants/:pan/password`). See 06.

IPC callers are checked: dashboard-only handlers use `isAuthorizedDashboardCaller` (registered dashboard webContents, top frame); page handlers check that the sender is a DDA webview hosted by a dashboard (`isAuthorizedDdaWebviewCaller` / `isPaymentWebviewCaller`).

## Storage (all under `%APPDATA%\flat-book`)

`main.js` pins `userData` to `%APPDATA%\flat-book`, so `npm run dev` and the packaged exe share the same data.

| Path | Contents |
|---|---|
| `dda_db/dda_offline_store.json` | Local DB: applicants (incl. base64 photos/signatures/Karmajeevi documents), settings, booking runs, the cached cloud applicant list |
| `dda_db/login_profiles.json` | This computer's DDA logins (PAN, name, password), each with a `localEdit` flag; synced from the server, local edits kept until "Sync from server". No passwords are bundled with the app |
| `dda_db/window_state.json` | The open windows in opening order, so the one surviving login lock can carry to Window 1 after a quit or crash |
| `payment_cards.bin` | Saved cards (a list; one picked per window), encrypted with Windows DPAPI via `safeStorage` |
| `bank_logins.bin` | Saved net-banking logins, encrypted with `safeStorage` |
| `fastpay_trace.log` | One line per payment / navigation / captcha event (ARM, PLAN, NAV, LOG, CAPTCHA, CAPTCHA-IMG, STEP2BUILD) |
| `dda_logs/runs/*.json, *.log` | Per-run forensic logs (in dev these go to the project folder) |
| `runs/<date>/trace.log` + `pages/` | Read-only run trace (`runTrace.js`): one line per event of every DDA/bank webview, plus page text/HTML/screenshot snapshots with card, CVV, OTP and password values blanked |
| `Partitions/…` | Chromium storage for each DDA session partition |

## Chromium switches that matter

- `disable-site-isolation-trials` — **required by Fast Payment**: SBI's page embeds BillDesk in a cross-site iframe that the top-frame preload must reach. Side effect: Chromium's built-in PDF viewer shows every PDF blank, so all PDFs are rendered with pdf.js.
- `disable-blink-features=AutomationControlled`, background-throttling switches (`disable-backgrounding-occluded-windows`, `disable-renderer-backgrounding`, `disable-background-timer-throttling`), GPU/raster flags, QUIC/HTTP2/TCP fast open.

## Session optimisation (main.js `setupSessionOptimizations`)

- Pre-connects TLS sockets to DDA on default, webview and isolated sessions.
- Blocks third-party trackers (Google Analytics, GTM, Clarity, Facebook, DoubleClick, WP stats).
- Forces 24 h caching for DDA static assets (js/css/fonts), never for dynamic pages.
- Observes captcha image requests (`*://eservices.dda.org.in/engine/*`) for the trace log.

## Security model (summary)

- Card and bank logins are encrypted with the OS keystore; the renderer never sees the card number or CVV after saving.
- DDA portal passwords are stored encrypted on the Worker (AES-GCM, key in the `DDA_LOGIN_KEY` secret) and only the owner or admin can read one back; the desktop app keeps them only in this computer's `login_profiles.json`. No passwords ship inside the app.
- The webview runs with web security off and context isolation off (needed for automation and cross-frame payment pages); IPC handlers validate the caller.
- Popups from non-DDA/non-BillDesk pages load in the same webview so the preload keeps working (Google → bank sites).
- Plaintext DDA credentials inside the app were accepted by the user for a short, controlled booking session.
