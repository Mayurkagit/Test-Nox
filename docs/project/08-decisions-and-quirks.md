# 08 — User decisions and DDA quirks

## Decisions by the user (keep them)

| Decision | Detail |
|---|---|
| Work page by page, user directs | Propose before changing; don't change unasked things |
| Commit / push / deploy are separate | Each needs its own approval; don't push or deploy unasked |
| No bundled passwords | DDA passwords live encrypted on the Worker and come with the applicant list; this computer keeps them in `login_profiles.json`. the old root `users.json`/`user.json` are no longer read |
| Per-window login lock | Each window locks onto one DDA login via the picker; survives DDA logout, app sign-out and restart; only the user unlocks. This stops one window booking under another applicant's login |
| One lock survives a restart | Last window closed one-by-one keeps its lock; else the oldest open window with a lock (at quit/shutdown/crash). It becomes Window 1's lock next run; new windows reuse the lowest free number |
| Applicant picker | Shown after every sign-in and on every new window, never on a plain reload; preselects the lock/last pick, never the first applicant |
| Server download only on demand | At sign-in, sidebar refresh, and picker "Sync"; otherwise the local copy. Live edits patch only the changed applicant |
| Plaintext credentials accepted | Short, controlled booking session |
| Applicant ≠ DDA login during testing | Intentional. On booking day the user selects the logged-in applicant. Never block on PAN mismatch; a log/warn line is fine |
| Search starts only on user action | Search/Manual/Timed; never restarts by itself; "Searching for target flats #N" lines stay |
| Direct URL Jump | Always on; no toggle (commit `775b40f`) |
| Step 2 URL build | One attempt, no retry with another window's session; failures not cached |
| Several saved cards | A list of cards; each window picks one |
| Flat: 7 failed tries | Hand off to DDA's own popup with an empty, focused captcha; app never fills/submits it |
| Multi-Reload fallback | After ~20 straight step2 failures, rebuild the link via the locality cascade instead of reloading a dead URL |
| Card autofill | Slow human-like typing (the fast all-at-once fill broke the expiry and was reverted); Pay is auto-clicked |
| Convenience fee | Auto-confirm for net banking only; stop at the sheet for card |
| Hold page | Never auto-continues; FAST PAY starts payment |
| Telemetry | Only bookings that reach the timer page; one record; real measured timings only |
| Payment sidebar | Fast Payment settings first, held flat + timer + FAST PAY second, navigation third; no auto-hide |
| Sidebar timer | Must show DDA's exact countdown (holds can be 10–12 min) |
| Bank captchas / OTP | Never automated; no model training for bank captchas |
| Logout after payment | DDA's own behaviour; not a bug, don't investigate |
| Photo / signature | DDA stopped asking applicants for them (25 Oct 2026): the form no longer waits for those files to download, it fills at once. `fillPhotoAndSignature` is kept as a guard - it attaches the 116x140 off-white placeholder (5.3 KB, `placeholderImages.cjs`) only where DDA asks for an upload and has nothing on file (`ddaWantsUpload`). Don't put the 6 s wait back |
| Payment status recording | On hold; to be worked out later |
| Exe | Rebuild only after the remaining work is done |
| Captcha investigation | Keep checking the trace now and then |

## DDA and gateway quirks (not visible from the code)

- **Login salt:** DDA renders a new password salt on every load of `/user` (HEAD included). Any background request to `/user` while the login page is open makes the next login fail ("Invalid username or password"; captcha errors say "Invalid captcha code." instead). Probe static files for server time.
- **One captcha per session:** mews captcha keeps one value per session; a parallel request can replace it (suspected cause of rare flat-page "Invalid captcha code").
- **Apply link before 12:00:** DDA comments the anchor out until the drop; detection stays loose on purpose.
- **Back/Forward** on step1/step2/hold pages logs the user out (DDA script).
- **Hold timer** runs on the PC clock; wrong clock/timezone can release the hold early. Holds often start below 15:00.
- **DDA's form HTML bug:** `<form formnovalidate>` plus `required` on hidden fields silently cancels submits; the app sets `noValidate` and strips hidden `required`.
- **Karmajeevi "View Uploaded Document"** links are `blob:` URLs of the attached file (DDA's `previewFileLink`).
- **Logout after a successful payment** (DDA behaviour).
- **SBI gateway URLs** (`merchant.onlinesbi.sbi/…/merchantprelogin.htm`) contain "login": login detection must be limited to `eservices.dda.org.in`.
- **BillDesk inside SBI's page** is a cross-site `#sdk-iframe`; reaching it needs `disable-site-isolation-trials` (nodeIntegrationInSubFrames is off).
- **That switch kills Chromium's PDF viewer** app-wide (data:, blob: and http PDFs all blank). Narrower `disable-features=IsolateOrigins,site-per-process` keeps PDFs but loses iframe access. → All PDFs go through pdf.js.

## Things that look wrong but are intentional

- Sidebar applicant can differ from the DDA login (testing).
- Locality page has no dedicated sidebar.
- The payment sidebar has no Autofill/Skip Form toggles.
- The hold page waits for FAST PAY instead of continuing.
- Card payments stop at the convenience-fee sheet.
- The scheme-page heartbeat runs only on the scheme list.
