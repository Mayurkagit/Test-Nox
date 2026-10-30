# 07 — Build, run and test

## Run in development

```bash
npm install
npm run dev
```

`npm run dev` starts Vite on port 5173 and then Electron (`concurrently` + `wait-on`). Webview console output is forwarded to this terminal as `[Webview] …` lines.

What needs what after a change:

| Changed | To see it |
|---|---|
| `src/**` (React) | Hot reload (dev) or `npx vite build` (production files) |
| `preload-dda.js` | Reload the DDA page (next navigation) |
| `main.js`, `step2Resolver.js`, `engine/*`, `db/*`, `preload.cjs`, `preload-pdfviewer.cjs` | Restart the app |

## Build the exe

```bash
npm run package:exe
```

- electron-builder targets **NSIS installer** and **portable** exe (Windows x64), product name "Flat book", app id `com.flatbook.app`. `npm run package:dir` builds an unpacked folder (`win-unpacked`), which starts faster than the portable exe and is the recommended way to run on other PCs.
- `build.files` must include every runtime file: `dist/**`, `main.js`, `preload.cjs`, `preload.js`, `preload-dda.js`, `preload-pdfviewer.cjs`, `payment_banks.json`, `step2Resolver.js`, `db/**`, `dda_db/**`, `engine/**`, both model files, `icon.png`, `package.json`. **When you add a new runtime file, add it here.**
- `asarUnpack`: `onnxruntime-node` and `models/nd_core_layer.*` (onnxruntime needs real files on disk; the solver maps `app.asar` → `app.asar.unpacked`).
- Data lives in `%APPDATA%\flat-book` for both dev and exe, so saved cards, bank logins and applicants carry over. Saved card/bank logins are encrypted per Windows user (DPAPI): they do **not** transfer to another PC or user.
- Build into a fresh output folder if a previous build is locked (EBUSY from a running app, leftover Electron processes or antivirus).
- The portable exe unpacks itself on every start, so it starts slowly.
- **Plan:** rebuild the exe once, only after the remaining work is done (the last exe predates the 2026-10-07 commit; much has changed since). When adding runtime files, remember `src/views/ApplicantPick.jsx` and `src/utils/loginLock.js` build into `dist/**` already — but any new top-level runtime file (like `step2Resolver.js` was) must be added to `build.files`.

## Verify nothing is broken

```bash
node --check main.js
node --check preload-dda.js
node --check step2Resolver.js
npx vite build
```

For injected scripts, also check that the generated code parses, e.g. `new Function(ddaAutomations.getFormAutofillCode(record, false))`.

## How changes were tested

There is no automated test suite in the repo. Changes were verified with throwaway harnesses (kept outside the repo):

- **Headless Electron + mock pages:** a mock DDA application form (with readonly fields, Karmajeevi sections, hidden joint section) driven by the real fill code with real applicant records; mock BillDesk/SBI pages (net banking, card, fee sheet, SBI chooser) for Fast Payment; a fake `eservices.dda.org.in` origin via `session.protocol.handle` for page-engine hooks.
- **Mock DDA servers / fake clocks** (jsdom) for schemes polling, Step 2 search and the reservation chain.
- **Rendering checks** with `webContents.capturePage()` (note: hidden windows don't render the PDF viewer; use a visible off-screen/transparent window).
- Use `node_modules/electron/dist/electron.exe <script>` directly; `npx electron` can hang in background shells.

## Live checks the user does

- Test Application Form button on the form page: fills without submitting.
- Bookings on the live portal, then check the sidebar logs, `dda_logs/runs` and `fastpay_trace.log` (captcha investigation).
- Fast Payment up to the bank OTP/login.

## Git

- Branch `master`, remote `origin` → GitHub `rs1705/dda-desktop-electron`. Commit, push and deploy are each a separate approval; nothing is pushed or deployed unless asked.
- Never commit `cbi_page1.txt`, `sbi_page1.html`, `sbi_page2.txt`, `html_pages/*.txt` (payment tokens + personal details — delete them), loose `*.pdf` / `download*.jpg`, or `release*/` build folders (`release*/` is already in `.gitignore`).
- The web app (`dda-application-main`): commit on `frontend-design`, fast-forward `main`, push both; deploy hosting with `rm -rf dist && npx vite build && npx firebase deploy --only hosting`; the Worker with `npx wrangler deploy`; rules with the Firebase CLI. A change touching rules + Worker + hosting deploys in that order.
