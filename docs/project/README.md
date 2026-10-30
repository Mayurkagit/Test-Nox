# Flat book — project summary

**Flat book** is a Windows desktop app (Electron + React) that books flats on the DDA housing portal (`eservices.dda.org.in`) as fast and reliably as possible during a live, first-come-first-served drop. It wraps the real DDA portal in a webview and automates each step: login, scheme apply, application form, locality, flat selection with captcha, the 15-minute hold page, and payment up to the bank OTP. The user stays in control: the bank OTP and final payment authorisation are always manual.

- **Repo:** `C:\Users\Home\Desktop\dda-application\dda-electron-demo` (GitHub remote `rs1705/dda-desktop-electron`, branch `master`)
- **Latest commit when this was written:** `faf959f` (2026-10-15)
- **Next booking:** 20 Oct 2026, 12:00 noon — Awaas Nivesh Yojana (LIG; Pockets 3 & 4, Sector G2–G6 Narela; ₹1 lakh booking amount). A first booking on 11 Oct 2026 has already happened.
- **Companion project:** a separate frontend web app (`dda-application-main`, same Cloudflare Worker + Firebase backend) where applicants, their documents and their DDA passwords are managed. Work now moves between the two. Each applicant's DDA portal password is stored encrypted on the Worker and the desktop app pulls it from there — the desktop app no longer bundles any passwords.

## Documents in this folder

| File | What it covers |
|---|---|
| [01-architecture.md](01-architecture.md) | Processes, key files, IPC channels, sessions and windows, storage, Chromium switches, security model |
| [02-booking-flow.md](02-booking-flow.md) | Page by page: what the automation does on Login, Schemes, Application Form, Locality, Flat Select and the Hold page |
| [03-captcha.md](03-captcha.md) | Local ONNX captcha model, solving paths, guards, retries, the open "Invalid captcha code" investigation |
| [04-payment.md](04-payment.md) | Fast Payment: arming, CBI/SBI gateways, card vs net banking, convenience fee, saved bank logins, OTP hand-over |
| [05-ui-and-sidebars.md](05-ui-and-sidebars.md) | Workspace layout, per-page sidebars, hold timer, controls, applicant modal, PDF viewing |
| [06-data-and-telemetry.md](06-data-and-telemetry.md) | Applicant data sources, settings, booking telemetry rules, run logs and trace files |
| [07-build-run-test.md](07-build-run-test.md) | Running in dev, building the exe, data folder, verification commands, how changes were tested |
| [08-decisions-and-quirks.md](08-decisions-and-quirks.md) | User decisions, DDA/gateway quirks, and things that must not be "fixed" |
| [09-status-and-roadmap.md](09-status-and-roadmap.md) | What is done (by commit), what is open, and what comes next |

## One-minute orientation

- **Main process** (`main.js`): windows, sessions, IPC, local database, ONNX captcha, the Step 2 URL builder, payment plan/arming, encrypted card and bank-login storage, per-window login-lock rules across restarts, trace log.
- **Renderer** (`src/`): React 19 + Zustand + Tailwind 4 dashboard: login, key check, the applicant picker, the Workspace with the DDA webview, top bar and right sidebar.
- **DDA page engine** (`preload-dda.js`, ~12,600 lines): runs inside the DDA webview (context isolation off) and does the page-level automation for every stage, including the payment gateway pages.
- **Manual-button scripts** (`src/utils/ddaAutomations.js`): code the dashboard injects into the webview for button-driven actions (Timed/Manual search, form autofill, etc.).
- **Backend:** a Cloudflare Worker (`WORKER_BASE_URL` in `src/services/api.js`) for login, booking keys, applicants, schemes and telemetry; Firebase for auth and realtime sync.

## Ground rules for working on it

1. The user directs the work page by page. Don't change things that weren't asked for; propose first.
2. Speed and reliability on booking day come first. Prefer small, tested changes.
3. Never block a booking on a PAN mismatch (testing deliberately books a different applicant than the DDA login).
4. Never automate the bank OTP or bank captchas, and never retrain the model for bank captchas.
5. After `main.js` changes the app must be restarted; preload changes apply on the next page load; renderer changes hot-reload in dev.
6. Never commit `cbi_page1.txt`, `sbi_page1.html`, `sbi_page2.txt`, `html_pages/*.txt` (payment tokens and personal details), loose `*.pdf` / `download*.jpg`, or the `release*` build folders.
7. Each window locks onto one DDA login (the applicant picker); the lock survives DDA logouts, app sign-outs and restarts. Only the user unlocks it. This is what stops one window booking under another applicant's login.
8. Commit, push and deploy are each separate approvals — don't push or deploy unless asked.
