# Handoff — DDA flat-booking project

Read this with `AGENTS.md` (the detailed feature log of the desktop booking engine). This file is the higher-level map: what the two apps are, how they fit together, and the current state of the work. Last updated 2026-10-15.

## What this project is

A system for booking DDA (Delhi Development Authority) housing flats the moment a scheme's booking window opens. DDA books first-come-first-served, so the whole system is built for speed and reliability in a short, controlled booking session. Next booking: **20 Oct 2026, 12:00 noon** — Awaas Nivesh Yojana (LIG, Pockets 3 & 4, Sector G2–G6 Narela, ₹1 lakh booking amount).

There are two apps plus a serverless backend:

### 1. Desktop app — `dda-electron-demo` (Electron, branch `master`)
The booking client the operator runs. It drives DDA's portal (`eservices.dda.org.in`) inside an Electron `<webview>`:
- **Fast booking engine** — polls the schemes page for the Apply link, builds the Step 2 (flat-select) URL ahead of time via a locality→sector→pocket→block→tower cascade, and reserves a target flat by direct POST, with conflict auto-recovery to the next preference.
- **Local ONNX captcha solver** — ~3 ms per captcha, native, no cloud. The 69 KB model ships in the app; the training dataset/pipeline do not.
- **Multi-Reload** — hard-reloads the flat page through DDA's database/gateway errors until it genuinely loads.
- **Fast Payment** — CBI/SBI via BillDesk, stopping at the bank OTP screen for the operator.
- **Multi-window** — several windows on one computer, each booking a different applicant, isolated by session partition.
- **Applicant picker + per-window login lock** — each window locks onto one DDA login; the lock survives DDA logouts, app sign-outs and restarts.

### 2. Web app — `dda-application-main` (React + Vite, branch `frontend-design`, live at dda-db-rs.web.app)
The admin/applicant portal where applicants and their data are managed. Backed by:
- **Cloudflare Worker `dda-engine`** (`worker.js`) — the API the desktop app and the website both call; it talks to Firestore with a service account.
- **Firestore** — applicants, users, schemes, booking config, analytics runs.
- **Analytics dashboard** — booking-run telemetry (timings, captcha attempts, logs).

### How they connect
The desktop app authenticates (Firebase) and passes a booking key. The Worker gates access by key + allowed-users + booking window, and returns the operator's applicants (the admin gets all). Each applicant's **DDA portal password is stored encrypted** (AES-GCM, key in the Worker secret `DDA_LOGIN_KEY`) and only the owner or admin can read it back. The desktop app caches the applicant list and logins in a local JSON file and syncs from the server at sign-in / on demand.

## Current status (2026-10-15)

### Done and pushed
- **Desktop `faf959f` (origin/master):** applicant list + logins download from the server at sign-in and on demand (refresh / Sync), not on every window; new windows and reloads use the local copy; live updates patch only the applicant that changed (via the Worker's "changed" note); 5-minute booking-key check; "Opening window…" screen instead of a flash of the login form; no-password prompt on the DDA login page; window-lock rules across closes and restarts (one lock survives → Window 1; new windows reuse the lowest free number).
- **Web `86efed5` (frontend-design + main, pushed):** Worker records which applicants changed; `GET /extension/applicants?pans=…` downloads just those; website edits record the changed PAN; `firestore.rules` allows the `changed` field.

### Done, NOT yet committed (desktop working tree)
- Flat-page weak spots: failed-build cooldown 15 s → 5 s (`main.js`); cascade-rebuild fallback after ~20 consecutive flat-page failures (`src/utils/multiReload.js`, `src/views/Workspace.jsx`).

### Pushed, NOT yet deployed (web)
`86efed5` is a Worker + rules + hosting change. Deploy order is strict:
1. **Firestore rules** (else the live website's change-note writes are rejected and desktop live-updates stop)
2. **Worker** (`npx wrangler deploy`)
3. **Hosting** (`rm -rf dist && npx vite build && npx firebase deploy --only hosting`)
The standing rule is that a normal hosting deploy is hosting-only; rules and Worker are deployed deliberately, as here.

### Next tasks (user's order, 2026-10-15)
1. Auto-key generation at a set time (the booking key activates itself; the admin doesn't set it by hand).
2. PDF download for all / single / selected applicants — builds on the parked `pdf-download` branch in the web repo (review first; `ApplicantModal.jsx` has changed a lot).
3. Exe rebuild — **once, at the very end**, after all fixes.

## Ground rules from the user
- Short controlled booking session; plaintext credentials in the desktop app are accepted. Focus on speed and reliability; don't break the app.
- Commit, push and deploy are each separate approvals — ask before deploying unless told to deploy.
- Web release flow: commit on `frontend-design`, fast-forward `main`, push both, deploy hosting only when asked; never deploy rules/Worker as part of a hosting deploy.
- The applicant being booked may legitimately differ from the DDA login — never block on a PAN mismatch.
- Don't commit the loose page dumps / PDFs / images in the working trees (`cbi_page1.txt`, `sbi_page*.txt/html`, `html_pages/*.txt`, `*.pdf`, `download*.jpg`, release folders).
- The parked `pdf-download` feature stays off the live line until its own task.

## How to verify changes
- Syntax: `node --check main.js preload-dda.js step2Resolver.js db/database.js preload.cjs`; `npx vite build`.
- `main.js` / `step2Resolver.js` changes need a full app restart; preload changes apply on the next page load; renderer changes need `vite build` / the dev server.
- Isolated logic (e.g. the Multi-Reload engine, the restart lock rule, the DB cache pruning) is tested with small Node scripts in the session scratchpad — recreate if needed, they are not in the repo.
- Trace logs for diagnosing real runs live at `%APPDATA%\flat-book\runs\<date>\` (local only, never committed).
