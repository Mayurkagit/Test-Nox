# 02 — Booking flow, page by page

DDA's flow and the app's stage IDs (`src/utils/ddaRoutes.js` → `detectDdaStage`):

| # | DDA page | URL contains | Stage id |
|---|---|---|---|
| 1 | Login | `/user`, `/user/login` | `LOGIN` |
| 2 | Scheme list | `schemelist` | `SCHEME` |
| 3 | Application form | `userApplicationfrom`, `applicationform`, `fcfsuserapplicantstore` | `APPLICATION_FORM` |
| 4 | Locality (Step 1) | `step1_form`, `searchsector` | `LOCALITY` |
| 5 | Flat select (Step 2) | `step2_form` | `FLAT_SELECT` |
| 6 | 15-minute hold page | `getlayout`, payment/challan pages | `PAYMENT_HOLD` |
| 7 | Gateway + bank | BillDesk, `onlinesbi.sbi`, bank ACS pages | (payment flow, see 04) |

Master switches (Automation Modes in the sidebar, `useSettingsStore`): **Autofill** (master), **Pre-Filled / Skip Form** and **Fast Payment**. Auto Captcha and Auto Submit are always on while Autofill is on (no switch). **Direct URL Jump** is always on too: there is no toggle.

---

## 1. Login

- Each window is **locked** onto one DDA login by the applicant picker (`ApplicantPick.jsx`, see 05). `preload-dda.js` fills that login's user ID/password and solves the login captcha locally (ONNX) in well under 100 ms; injection retries at 0/80/250/600 ms so it doesn't wait for slow assets.
- The login (PAN, name, password) comes from this computer's `login_profiles.json`, which is synced from the Worker; no passwords are bundled. If the locked applicant has **no saved password**, the login sidebar shows "No saved password" with **Add password** and **Edit users** (see 05) and the user types it on DDA's page.
- The lock survives DDA logouts, app sign-outs and restarts, so a window always logs in as the same applicant until the user unlocks it (the picker's Skip leaves a window unlocked). This is what prevents one window booking under another applicant's login.
- Login detection only runs on `eservices.dda.org.in` (SBI's gateway URLs contain "login" too).
- **DDA quirk:** the login page renders a new password salt on every load of `/user`. Any background request to `/user` while the login page is open makes the next login fail with "Invalid username or password". Server-time probes therefore hit static files, never `/user`.

## 2. Scheme list

- **Target scheme:** admins pick it in the sidebar (their choice is the single source of truth); normal users are locked to the scheme broadcast by the Worker. Matching uses the `<b class="bluec">` title only, strict `title.includes(target)` (no reverse/loose matching, no "first button" fallback).
- **MANUAL:** applies immediately.
- **TIMED:** waits for the drop time (12 PM preset), wakes at T-2 s and polls the scheme list headlessly (DOMParser, no page reloads). Ticks are tiered, start-to-start: ~1 s until T-2 s, 250–300 ms until T+5 min, 400–450 ms until T+15 min, ~1 s after; 60-minute window. If the Apply link is already visible when Timed is armed (testing), capture is held until T-1 s. Stop stays active throughout.
  - **Checks don't wait on each other (since 26 Oct 2026).** A tick sends a check only when none is waiting, so with DDA answering within 4 s it is one check at a time, as before. When the newest check has had no answer for 4 s a backup check goes out; at most 3 wait at once, and each is given up after 20 s (`HEDGE_AFTER_MS`, `MAX_IN_FLIGHT`, `CHECK_TIMEOUT_MS`). Before this, one hung request froze TIMED until it ended and the Apply link was never seen (load simulation, 26 Oct). Failures show in the Live Console (first one, then at most one line per 5 s; a recovery line after 3+). Both copies follow this: the injected poller (`getTimedSchemePollerCode`) and the preload's own search that takes over after a page reload. Leaving the page aborts the waiting checks without a warning.
  - **TIMED waits for the schemes page (since 26 Oct 2026).** `handleTimedSchemeApply` (Workspace) first reads the page's own `location.href`: a failed load shows Chromium's error page (`chrome-error://chromewebdata/`) while the webview still reports DDA's URL, so stage detection alone can't tell. If it isn't `/user/schemeList` (error page, or DDA's login page after a logout), TIMED says so in the Live Console, keeps "Applying…", and starts within ~1 s of the schemes page being back (the failed load is retried every 2 s). STOP cancels the wait. An injection that reports failure is retried the same way, except "target scheme not selected".
- **Session heartbeat:** only on the scheme list page, every 45–75 s (randomised), to keep DDA's PHP session alive; stops when Timed hunting starts, on MANUAL, or when leaving the page. A dead session redirects to login.

## 3. Application form

Handled by `handleApplicationFormPage()` in `preload-dda.js` (automatic) and by `getFormAutofillCode()` in `ddaAutomations.js` (sidebar MANUAL button / test fallback). Both follow the same rules:

- **DDA compatibility (always, even with Autofill off):** `noValidate` on the form, `required` stripped from hidden fields (joint applicant when "No"), stubs for DDA's missing inline validators, so manual users can submit.
- **Full fill:** personal, bank, address, joint applicant, photo/signature (attached as real files via `DataTransfer`), Karmajeevi eligibility documents.
- **Only real values:** a field is filled only if the applicant record has a value. No invented defaults (gender, marital status, category, bank, area, PIN, state, district). A value DDA already shows is never blanked.
- **Read-only fields are never changed:** readonly/disabled, a `readonly` class, `aria-readonly`, not clickable (`pointer-events: none`), or any radio in a locked group.
- **Field mapping notes:** records store `address.pinCode` (not `pincode`), `address.town`, `address.stateId`/`districtId`, `bank.bankId` (DDA's bank id). While DDA's district list is still loading, the record's own district id is sent.
- **Skip Form (Pre-Filled):** for applications already saved on DDA: skips the 25+ text fields, still attaches photo/signature and checks Karmajeevi. Falls back to full fill if DDA's form is blank. The page follows the app's Skip Form setting; its own stored flag only if the setting never arrived.
- **Karmajeevi (para 2.4):** only applicants marked eligible (`eligibility.enabled !== false` and a `paraType`) get para 2.4(a)/(b) and document choices + files. Others: the section is left alone and the log says to fill it by hand. In Skip Form, or when DDA locked it, DDA's saved para choice is kept.
- **Required-field check:** before the quick save, DDA's required fields are checked against what will be sent (hidden sections skipped, file uploads left to DDA). If any are empty, the quick save is skipped, the log lists them (`⚠️ Missing: …`), and the form is handed to DDA's own Submit button so DDA marks the problem fields in red.
- **Submit:** direct AJAX POST to `/user/fcfsuserapplicantstore` with the form's data. On success → Direct Jump to Step 2 (if the URL is ready; waits up to 400 ms for an in-flight build) or to the locality page.
- **Rejection:** DDA's reason is logged (`❌ DDA did not accept the application form: …`), then the form is submitted once through DDA's own button so the problem fields show in red. Only DDA's normal confirmation popup is auto-confirmed; error popups stay open and are logged.
- **Test Application Form:** fills everything for inspection and never submits.
- **Applicant ≠ DDA login is intentional during testing** — never block on it (the booking record just notes `applicantMismatch`).

## 4. Locality (Step 1) and the Step 2 URL

- The Step 2 (flat select) URL needs hashes for locality → sector → pocket → block → tower. `step2Resolver.js` builds it in the main process with a 5-request cascade (`session.fetch`), started as early as the application form page. One shared cache keyed by scheme + preferences serves all windows (in-flight builds are joined; failures are not cached; one attempt only).
- Direct URL Jump is always on: the form page jumps straight to Step 2 when the URL is ready, and the locality page jumps the moment it arrives (one-shot guard). If the link cannot be built, the dropdown cascade + Search on the locality page is the fallback.
- In-page fallback resolver ("Path B") logs `step3_locality` when it wins.

## 5. Flat select (Step 2)

- Search starts **only** when the user presses Search/Manual/Timed; it never restarts by itself. The per-poll log line "Searching for target flats (…) #N" is intentional.
- **Poller** (`getFlatHunterCode`): start-to-start 250–300 ms, 10 s per-poll timeout (`POLL_TIMEOUT_MS`; 3 s before 25 Oct, which aborted every check on a slow line), three failed polls in a row show "Checks not getting through" (any failure counts, HTTP 500s included, since 26 Oct — on 20 Oct 87–99% of flat checks got 500; the injected poller leaves `window.__ddaPollStalled` for Workspace's `inspectFlats` to read, because injected page code can't message the app: `window.ipcRenderer` only exists in the preload's scope, so its `sendToHost` calls never arrive), stops on login page / redirect away from step2, pauses 1 s on HTTP 5xx and 2 s on 429; a new Search press stops any leftover poller. Durations 30 s – 600 s or continuous.
- **Direct reservation** (`executeDirectHeadlessReservation`): the moment a target flat is available, POSTs `/user/getflatlayoutdetails` with a solved captcha (no modal). One lock across preferences; fresh captcha after every POST (direct `/captcha/default?<rand>`, `refresh_captcha` after two rejections); up to 7 attempts per flat; 10 s POST timeout; network errors / non-JSON retry with a fresh captcha.
- **Conflict auto-recovery:** Status 2/4 (held/allotted by someone else) → flat blacklisted for 30 s (`FLAT_BLACKLIST_TTL_MS`), marked sold in the DOM, next preference tried at once; optional fallback to the best available flat on the chosen floor/parity.
- **Status 0 = reserved:** chime plays immediately, log "🎉 Flat X reserved by DDA — opening the 15-min hold page…", `step5_reserved` milestone.
- **7 failed direct tries on one flat** (not a taken-flat conflict, which moves on): the search stops, the page leaves direct mode, and DDA's own reservation popup for that flat is opened with an empty, focused captcha box for the user to finish by hand. The app does not fill or submit that captcha.
- After a failed chain nothing restarts: "Search is stopped — press Search to look again".
- Layout: DDA's sidebar, banner, legend and locality table are hidden; the scheme ribbon becomes a compact location pill so the flat grid is above the fold. The app's right sidebar can collapse to give the webview full width.
- **Multi-Reload** (`src/utils/multiReload.js`): hard-reloads every 250 ms until DDA really loads (HTTP OK + page finished + flat grid present, no error text); 8 s hang cap; refuses while a reservation is in flight. After ~20 consecutive failures on a `step2_form` page it stops reloading the same (possibly dead) URL and **rebuilds a fresh flat-page link via the locality cascade** (`window.resolveStep2DirectUrl`), loads that, and carries on; if it can't rebuild right then it keeps reloading.
- **Step 2 build cooldown:** after a failed build the schemes page waits 5 s before building again (was 15 s), so it recovers sooner while still throttling repeated requests to DDA's erroring form.

## 6. Hold page (15-minute timer)

- **Hold confirmation** (`watchHoldConfirmation`): the hold is confirmed when the payment form is stable for 1.5 s, DDA's timer popup appears, or the countdown runs; an error popup aborts; 15 s timeout. Confirmation logs `step7_hold_confirmed`, tells the app (`holdConfirmed`) and sends the booking telemetry record (see 06). Leaving the hold page before that (SCHEMES / logout within ~2 s) records the hold on `pagehide` if DDA reserved the flat and no error popup showed.
- **Timer:** the sidebar mirrors DDA's own countdown (`startHoldTimerSync`, 500 ms tick). Holds don't always start at 15:00 (often 10–12 min). The on-page text is trusted only once it changes; DDA's `fiveMinutes` script value is used as a fallback. The previous booking's expiry is cleared on every new reservation.
- "Your 15 minutes timer has been started" popup is auto-confirmed; "time has been expired" is logged once and dismissed.
- The hold page never auto-continues to payment: **FAST PAY** (sidebar) starts the payment chain (see 04).
- Avoid Back/Forward on step1/step2/hold pages (DDA's script logs the user out). The hold timer uses the PC clock, so the PC clock/timezone must be right.

## 7. Payment

See [04-payment.md](04-payment.md). DDA logs the user out right after a successful payment; this is DDA's own behaviour, not an app bug.
