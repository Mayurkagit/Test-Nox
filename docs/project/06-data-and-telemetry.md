# 06 — Data and telemetry

## Users and roles

- App users log in through the Worker (`/me`) and Firebase. Roles: **admin** (all applicants, scheme choice, no booking key) and **normal user** (own applicants only, scheme locked to the Worker's broadcast, needs a booking key, logged out when the booking window ends).
- **DDA logins come from the server, not the app.** Each applicant's DDA password is stored encrypted on the Worker (AES-GCM, key in `DDA_LOGIN_KEY`) and arrives with the applicant list. The desktop app keeps the logins in this computer's `dda_db/login_profiles.json`, each with a `localEdit` flag; a login edited on this computer is kept until "Sync from server". The app no longer reads `users.json` / `user.json`; the copies still in the repo root hold old logins (8 entries each, tracked in git), while the `public/` and `src/data/` copies are empty. An admin's edit in the app is saved back to the Worker; a normal user's stays local.
- On app logout, `session:clearDdaSession` wipes DDA cookies/storage/cache in every partition; app reloads (Ctrl+R) keep DDA sessions alive. The per-window login lock is preserved across the logout wipe.

## Applicants

**When the list is downloaded (changed 2026-10-15):** the full list is pulled from the Worker **only at app sign-in and on demand** (the sidebar refresh beside the lock, and "Sync from server" on the picker). A new window, a reload, or the app reopening while signed in uses this computer's cached copy — no download. A computer with no copy yet downloads once. Logins come with the list (`ddaPassword` per applicant), so a window loads applicants and logins in one request instead of three.

**Live updates (one applicant at a time):** `realtimeSync.js` watches Firestore `meta/sync`. The Worker records which applicants changed there (`changed.{PAN} = { at, owner }`) on every create/update/password-save/delete/restore; the app downloads just those (`GET /extension/applicants?pans=…`, `patchApplicantsFromServer`) and a removed one leaves the list. More than 25 at once, or a change that names no PAN, falls back to one full download. The booking-key / window-end check runs every 5 minutes (and every 60 s from `Workspace.jsx`).

**Sources (merged, never destructively overwritten):**
1. Cloudflare Worker: `/extension/applicants` (full, or `?pans=` for a patch; the admin gets all), plus Firestore realtime sync (`realtimeSync.js`).
2. Local database `dda_db/dda_offline_store.json` (`db/database.js`): the cloud list is cached here (`db:cacheApplicants`; cloud fields win, local-only fields kept; a normal user's records are stored under that user) and served instantly on start-up and when the cloud is unreachable. A **full** download prunes cached cloud records that were removed in the cloud (`db:uncacheApplicants`); records saved only on this computer are kept.
3. Renderer storage tiers (`ddaData`, `dda_extension_applicants`) merged by `useApplicantStore`.

**Record shape (fields the form fill uses):**

```
pan, password
personal: firstName, middleName, lastName, fatherName, motherName, dob, gender (M/F/T),
          nationality ("1"), maritalStatus ("1"/"2"), spouseName, categoryId, aadhar,
          mobile, email, isPhysicallyDisabled, photo, sign (base64 data URLs)
bank:     bankId (DDA's id), bankName, branchName, ifscCode, accountNumber
address:  houseNo, street, area, town, pinCode, stateId, districtId, region ("1" Delhi / "2" outside)
jointApplicant: relation, firstName, …, photo, sign
eligibility (Karmajeevi): enabled, paraType ("1a"/"1b"), empIdCardCertificateType,
          salarySlipForm16Type, empIdCard1a, empCertificate1a, salarySlip, form16,
          professionalDegreeCertificate, incomeTaxReturn, proRegCertificateIssued,
          otherProRegCertificateIssued, proRegCertificateIssuedDoc, empIdCardCertificate1b,
          empIdCard1b, empCertificate1b   (documents are base64 data URLs: PDF or image)
preferences: locality, sector, pocket, block, tower, target flat numbers
```

Notes:
- Mobile, email and date of birth are often missing in records; DDA prefills them from the account, so the fill leaves them alone.
- An applicant with `eligibility.enabled === false` is **not** Karmajeevi-eligible even if `paraType` is set.
- In the local copy, the Income Tax Return of two applicants starts with bytes that are not a PDF; worth comparing with what the Worker serves (the frontend shows them fine).
- A few documents saved as `image/jpeg` are actually WebP; DDA may refuse them as `.jpg` uploads.
- Old bug (fixed): the local DB used to delete 14 real applicants on every start as "demo data".

## Settings

`useSettingsStore` (persisted via `db:saveSettings`, pushed to the webview as `session:settingsUpdated`): `automationEnabled`, `fullAuto` / `halfAuto`, `captchaAutoSolveEnabled`, `loginCaptchaAutoSolveEnabled`, `captchaAutoSubmitEnabled`, `prefilledFastPass` (Skip Form), `directUrlJumpEnabled` (stored, but Direct Jump is always on), `fastPaymentEnabled`, `fastPaymentGateway` (`cbi`/`sbi`), `fastPaymentMethod` (`card`/`netbanking`), `fastPaymentBank`, `theme`. The page engine reads the app setting first and its own `localStorage` copy only when the setting never arrived.

## Booking telemetry (one record per booking)

**When:** only for bookings that reach the hold/timer page and are confirmed there (`step7_hold_confirmed`). Runs that never reach the timer page send nothing. If the user leaves the hold page (SCHEMES, logout) before confirmation finishes (~2 s), the record is sent on `pagehide`, provided DDA reserved the flat this run (`step5_reserved`) and no error popup showed; its step7 message says the page was left early.

**How:** the page engine (`sendAnalyticsPayloadOnce`) builds the record once and sends `dda:analytics-dispatched` → the dashboard saves it locally (`analytics:save` → `db:saveBookingRun` + `dda_logs/runs/`) and sends it to the Worker `/extension/analytics` (Firestore `bookingRuns`, document id = run id). Main skips its own Worker call when the renderer already synced it (`cloudSynced`), so there are no duplicates. A Workspace fallback sends a record only if the hold was confirmed but no record arrived within 20 s — never for an unconfirmed hold.

**What's in it:**
- Applicant and app user (the logged-in app user's email, not a fake address), scheme, flat, preferences.
- **Steps exactly as recorded** (nothing estimated): `step1_apply`, `step2_form`, `step3_locality`, `step4_page_load`, `step4_flat_select`, `step5_captcha_submit`, `step5_reserved`, `step6_payment_timer_ok`, `step7_hold_confirmed`. Missing steps are left out.
- **Timing:** measured from the first recorded step to DDA reserving the flat (`measuredMs`), with `durationMeasured` / `durationFrom` saying how; `reservedAt`, `holdConfirmedAt`.
- **Captcha attempts** since the run's first step (or the last 60 s if no start was recorded), each with status (`SOLVED`, `SUBMITTED`, `RESERVED`, `SERVER_REJECTED`, `ANOMALY`, `NO_RESPONSE`, `FAILED`), answer and confidence; `lastCaptcha`.
- **Identity check:** `pagePan` (DDA login on the form), `selectedPan` (sidebar applicant, saved as `selectedApplicantPan`), `applicantMismatch` (log/warn only; intentional during testing — the record is always sent). On a mismatch the record's PAN, name and father's name come from the hold page and none of the sidebar applicant's personal details are used; Workspace only applies the sidebar profile name when there is no mismatch.

## Logs and trace files

| What | Where | Use |
|---|---|---|
| Live run log | Sidebar logs console; `appendRunLog` / `dda:log` | What the automation is doing now |
| Per-run logs | `dda_logs/runs/<PAN>_<name>_<flat>_<time>.json/.log` | Forensics after a run |
| Payment / captcha trace | `%APPDATA%\flat-book\fastpay_trace.log` | ARM, PLAN, NAV, LOG, CAPTCHA, CAPTCHA-IMG, STEP2BUILD lines (see 03, 04) |
| Terminal (`npm run dev`) | `[Webview]` lines | All webview console output is forwarded to the terminal |

## Privacy

- Third-party trackers on DDA are blocked; cloud captcha/OCR is off (local ONNX only).
- Telemetry goes only to the user's own Worker/Firestore and only after a confirmed hold.
- Git history contains some personal data from early commits (`dda_logs/runs`, `users.json`); GitHub history outlives the app.
