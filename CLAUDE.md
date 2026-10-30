# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Flat book** — a Windows Electron + React desktop app that books flats on the DDA housing portal (`eservices.dda.org.in`) during a live first-come-first-served drop. It wraps the real portal in a `<webview>` and automates every stage (login → scheme apply → application form → locality → flat select + captcha → 15-minute hold → payment), stopping at the bank OTP, which is always manual.

Deep documentation already exists and is the first thing to read for anything non-trivial:

- [HANDOFF.md](HANDOFF.md) — the higher-level map: both apps, the backend, current state, the user's task order and ground rules. Read it first.
- [docs/project/README.md](docs/project/README.md) — index and one-minute orientation
- `01-architecture.md` (processes, key files, IPC channels, sessions, storage, Chromium switches)
- `02-booking-flow.md` (page-by-page automation behaviour and stage IDs)
- `03-captcha.md`, `04-payment.md`, `05-ui-and-sidebars.md`, `06-data-and-telemetry.md`
- `08-decisions-and-quirks.md` — **read before "fixing" anything that looks wrong**
- `09-status-and-roadmap.md`
- [AGENTS.md](AGENTS.md) — long feature-by-feature changelog of implemented behaviour

## The wider system

This repo is only the booking client. Two other pieces, both documented in HANDOFF.md:

- **`dda-application-main`** — the React + Vite admin/applicant web app (branch `frontend-design`, live at `dda-db-rs.web.app`) where applicants and their documents are managed, plus the booking analytics dashboard.
- **Cloudflare Worker `dda-engine` + Firestore** — the shared API both apps call. It gates access by booking key, allowed-users and booking window, and returns the operator's applicants (admin gets all). Each applicant's DDA portal password is stored AES-GCM encrypted (Worker secret `DDA_LOGIN_KEY`) and readable only by the owner or an admin.

The desktop app downloads applicants and logins at sign-in and on demand (refresh / Sync) — not per window — caches them locally, and patches only the applicant the Worker reports as changed. That list is light (`?light=1`: no photo/signature/document `data:` URLs, their paths in `_omitted`); the files come from the local copy, the window's applicant gets its full record (`ensureFullRecord`), and files the PC lacks are filled in the background (`backfillMissingFiles`). The form fill waits up to 6 s for missing files (`_missingMedia`).

## Commands

```bash
npm run dev          # Vite on :5173 + Electron (webview console appears as [Webview] … lines)
npm run build        # vite build → dist/
npm run start        # Electron against existing dist/
npm run package:exe  # NSIS installer + portable exe (win x64) → release/
npm run package:dir  # unpacked build (win-unpacked); starts faster, preferred for other PCs
```

There is **no automated test suite**. Verification is done with:

```bash
node --check main.js preload-dda.js step2Resolver.js db/database.js preload.cjs
npx vite build
```

For injected scripts, check the generated code parses, e.g. `new Function(ddaAutomations.getFormAutofillCode(record, false))`.
Ad-hoc harnesses (headless Electron + mock DDA/BillDesk pages, jsdom mock servers with fake clocks) live outside the repo — recreate them in the session scratchpad; isolated logic such as the Multi-Reload engine, the window-lock rule or DB cache pruning is tested that way. Run Electron as `node_modules/electron/dist/electron.exe <script>`; `npx electron` can hang in background shells. Trace logs from real runs are at `%APPDATA%\flat-book\runs\<date>\` (local only, never committed).

What a change needs to take effect:

| Changed | To see it |
|---|---|
| `src/**` | hot reload in dev |
| `preload-dda.js` | reload the DDA page |
| `main.js`, `step2Resolver.js`, `engine/*`, `db/*`, `preload*.cjs` | restart the app |

## Architecture

Three places code runs, and knowing which one you are editing matters more than anything else here:

1. **Main process — `main.js`** (ESM, ~2.7k lines): windows and per-applicant sessions, all IPC handlers (auth, `db:*`, `dda:*`, `captcha:*`, `step2:*`, `payment:*`, `banklogin:*`), local JSON database (`db/database.js`), local ONNX captcha solving (`engine/vision.js`), the Step 2 URL cascade (`step2Resolver.js`), payment arming/plan, card + bank logins encrypted with `safeStorage`, `fastpay_trace.log`, pdf.js viewer windows. IPC senders are validated (`isAuthorizedDashboardCaller`, `isAuthorizedDdaWebviewCaller`, `isPaymentWebviewCaller`).
2. **Dashboard renderer — `src/`** (React 19, Zustand, Tailwind 4): `App.jsx` routes WelcomeLogin → KeyVerification (booking key; admins skip) → `views/Workspace.jsx`. Workspace owns the webview, stage detection, applicant/login matching, telemetry fallback; `components/RightControlSidebar.jsx` + `components/sidebar/*` render a different sidebar per stage via `getSidebarMode`. Stores: `useApplicantStore`, `useAutomationStore`, `useSettingsStore`, `useAuthStore`.
3. **DDA page engine — `preload-dda.js`** (~12.6k lines, context isolation off): the real automation, running inside the webview on DDA *and* on BillDesk/SBI/bank pages. Login autofill + captcha, scheme polling + session heartbeat, application form fill/submit, locality cascade or direct jump, Step 2 polling + headless direct reservation + conflict recovery, hold-page confirmation/timer/telemetry, the whole Fast Payment chain, saved bank logins.

Alongside it, `src/utils/ddaAutomations.js` holds scripts the **dashboard injects** into the webview for button-driven actions (Timed poller, flat hunter, form autofill, hold analytics). Page-engine and injected paths often implement the same rules twice — change both.

Stage detection and sidebar mode live in `src/utils/ddaRoutes.js` (`detectDdaStage`: `LOGIN`, `SCHEME`, `APPLICATION_FORM`, `LOCALITY`, `FLAT_SELECT`, `PAYMENT_HOLD`).

Backend: a Cloudflare Worker (`WORKER_BASE_URL` in `src/services/api.js`) for login, booking keys, applicants, schemes and telemetry; Firebase auth + Firestore `bookingRuns`; `src/services/realtimeSync.js` for SSE/Firestore applicant pushes. Applicant data is merged from Worker + local store + renderer storage tiers and must never be destructively overwritten.

All user data lives in `%APPDATA%\flat-book` (same for dev and the exe): `dda_db/dda_offline_store.json`, `dda_db/login_profiles.json`, `payment_card.bin`, `bank_logins.bin`, `fastpay_trace.log`, `Partitions/…`.

## Constraints to respect

- **Speed and reliability on booking day come first.** Prefer small, verified changes; the user directs work page by page and expects proposals before unasked changes. The next booking is 20 Oct 2026, 12:00 noon.
- **Commit, push and deploy are three separate approvals.** Ask each time unless told otherwise; nothing is pushed on your own initiative. In the web repo: commit on `frontend-design`, fast-forward `main`, push both, and deploy hosting only when asked — never ship Firestore rules or the Worker as part of a hosting deploy.
- **The exe is rebuilt once, at the very end**, after the remaining fixes.
- **The DDA account decides the applicant** (since 22 Oct 2026): the sidebar follows the logged-in account, the form is never filled with another person's details, and after login the sidebar shows the account's applicant as a locked name + PAN card (no dropdown). Admins only: the testing switch `allowDifferentApplicant` ("Testing: allow other applicants" under the card; off by default, reset at every start) brings the list back.
- **Never automate bank OTPs or bank captchas**, and never train the model for them. Automation stops at the ACS/OTP screen by design.
- **Search never restarts by itself** — only Search/Manual/Timed start it; the per-poll `Searching for target flats (…) #N` lines are intentional.
- **Chromium runs with `disable-site-isolation-trials`** because Fast Payment must reach BillDesk's cross-site `#sdk-iframe` inside SBI's page. Side effect: Chromium's built-in PDF viewer renders every PDF blank, so **all PDFs go through pdf.js** (`src/components/PdfPages.jsx`, `src/views/PdfDocWindow.jsx`).
- **DDA login salt is re-rendered on every load of `/user`** — any background request to `/user` while the login page is open breaks the next login. Probe static files for server time, never `/user`.
- Login/stage detection must be scoped to `eservices.dda.org.in`: SBI gateway URLs contain "login" too.
- When you add a new runtime file, add it to `build.files` in `package.json`; a new main-process or preload script goes instead in `FILES` of `scripts/obfuscate.cjs`, which packages minified, name-mangled copies from `obf/` in place of the sources. `onnxruntime-node` and `models/nd_core_layer.*` must stay in `asarUnpack`. The model file records its weights file's name inside it (`nd_core_layer.weights`), so renaming that file means patching the model.
- The packaged app is named **Northdesk** (renamed 28 Oct 2026 so it isn't recognisable); the data folder stays `%APPDATA%\flat-book`, pinned in `main.js`.
- Do not commit the loose page dumps and media in the working tree: `cbi_page1.txt`, `sbi_page*.txt/html`, `html_pages/*.txt` (payment tokens and personal details), `*.pdf`, `download*.jpg`, `release*/`.
