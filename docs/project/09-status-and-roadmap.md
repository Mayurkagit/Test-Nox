# 09 — Status and roadmap

*As of 2026-10-15, commit `faf959f` (pushed). Two sets of changes sit on top of it: the flat-page weak-spot fixes are in the working tree, uncommitted; the web app's `86efed5` is pushed but not yet deployed — deploy in the order Firestore rules → Worker → hosting.*

## History (main commits, oldest first)

| Commit | What it brought |
|---|---|
| `64a6ad5` | Initial suite: isolated partitions, Zustand state |
| `babc057`, `e1b5b10` | Stage-aware sidebar; extension automation logic ported; Firebase auth |
| `c5a0771`, `4272cef` | Native ONNX captcha, 7-stage pipeline, modular sidebar; retrained dual-head model |
| `0b50c5c`, `3353c5c` | Payment stage overhaul, admin scheme persistence, 200 ms polling; login profiles, active-learning captcha, zero-scroll Step 2 |
| `a0f5a89`, `185ec50` | DDA session wipe on app logout; 100% captcha accuracy (1 vs 7 fine-tuning) |
| `6637047`, `084e8c7`, `5ff5040` | Faster headless POST; multi-session isolation, 2x2 controls; locality parallel race, Multi-Reload, taken-flat auto-switch, captcha audit |
| `acdf398`, `f83ed76`, `d9fc9c9`, `89ecfbd` | Multi-window isolation, Karmajeevi OR-filtering, form data-bleed fix; tower/stack flat generator, heartbeat jitter; footer removal, side-by-side windows, Fast Payment gating; window re-indexing |
| `c39a9f6` | Hardened flat-select engine, rebuilt top bar, removed dead polling code |
| `4c2ae00`, `b9ab908` | Normal users logged out at booking-window end; telemetry sends the app user's email |
| `b3d7f5d` | Fast Payment net banking, per-gateway bank lists, saved bank logins, SBI chooser |
| `e81599b` | Auto-confirm BillDesk convenience fee for net banking only |
| `2bbc137` | Honest telemetry (hold-confirmed, single send, measured), captcha tracing + stale refresh, applicant DB fix + cloud cache, per-page sidebars, DDA countdown timer, Skip Form setting, safe application-form fill (no invented values, PIN fix, required check, Karmajeevi eligibility, rejection handling, read-only fields kept), pdf.js PDF viewing, exe data folder + ONNX unpack |
| `bd635dd`, `237bbbb`, `eecd1c6` | Applicant editing moved to the website only; local flat preferences kept across app logout; applicants loaded once |
| `62b0f58` | Local, read-only run trace of every page from schemes to payment (`%APPDATA%\flat-book\runs`) |
| `84b3649`, `5a01206`, `6af6f42`, `50b6d01`, `775b40f`, `68ce2b3`, `7f5be89`, `8e79366` | Faster locality dropdowns; archive login users + A–Z + Region fix; clear-hashes button + login/logout swap + session-running notice; plain-language link-build logs; Direct Jump always on + DDA red field errors restored; payment sidebar stays open; plain PC clock + busy spinner + flat-search summary in telemetry; sidebar shows edited flats for non-admins |
| `b6903f5` | Several saved cards for Fast Payment, one picked per window (`payment_cards.bin`) |
| `be4726e` | After 7 failed direct tries on a flat, hand off to DDA's own popup with an empty, focused captcha (app never fills/submits it) |
| `cf1ffd2` | Per-window login lock, sidebar header user menu + clock, wider rounded stage rail |
| `be1e316` | DDA sessions kept alive on error pages (schemes-page redirect on form error); logins come from the server (encrypted DDA passwords); the applicant picker |
| `faf959f` | Applicant list + logins downloaded at sign-in / on demand; live per-applicant patch via `meta/sync` "changed" note; 5-minute key check; "Opening window…" restore screen; no-password prompt on the DDA login page; window-lock rules across closes and restarts; local-cache pruning |
| *(uncommitted)* | Flat-page weak spots: build cooldown 15 s → 5 s; Multi-Reload cascade-rebuild fallback after ~20 straight failures |
| *(web, `86efed5`, pushed, not deployed)* | Worker records which applicants changed; `?pans=` patch endpoint; website edits record the changed PAN; `firestore.rules` allows `changed` |

## Working well (user-confirmed)

- Login autofill + captcha, scheme apply (Manual/Timed), Direct Jump, Step 2 search and direct reservation with captcha.
- Fast Payment: CBI card (slow typing, Pay auto-clicked), net banking with fee auto-confirm, SBI chooser (live 2026-10-06), saved bank logins.
- Per-page sidebars, payment sidebar order, no auto-hide, exact DDA countdown.
- PDF viewing in the applicant modal and from DDA's "View Uploaded Document" links (pdf.js; confirmed live 2026-10-07).

## Not yet tested in the running app

The 2026-10-15 work (sign-in/on-demand sync, per-applicant live patch, faster window open, window-lock rules across restarts, the no-password prompt) and the uncommitted weak-spot fixes are built and pass `vite build`; the isolated logic (restart-lock rule, DB cache pruning, Multi-Reload fallback) was unit-checked with throwaway Node scripts, but none of it has been exercised in the running app yet. The main-process parts need a full restart.

## Open items

| Item | Status / next step |
|---|---|
| Flat-page "Invalid captcha code" | 2 rejections in 14 traced runs (~0.55 s lost each). The 51.9%-confidence one was a misread with no builder overlap. Proposed, not built: skip the POST below ~90% confidence and solve a fresh captcha instead |
| Payment status recording | On hold. Must work despite DDA's logout after payment (read the gateway return / DDA response before the logout) |
| Exe rebuild | Once, at the very end, after the remaining features; prefer the unpacked `win-unpacked` folder |
| Auto-key generation | Planned next: the booking key activates itself at a set time so the admin doesn't set it by hand |
| PDF download (all / single / selected applicants) | Planned: builds on the parked `pdf-download` branch in the web repo (review first; `ApplicantModal.jsx` has moved a lot) |
| Bank lists | Match BillDesk's real Net Banking names |
| Two ITR files in the local store aren't PDFs | Compare with what the Worker serves |
| `launchApplicantSession` | Calls `db.getApplicantByPan(pan)` without a user, so it always gets `null` (standalone session windows) |
| Back/Forward on step1/step2/hold | Logs the user out (DDA script); consider disabling those buttons on those pages |
| Step 2 leftovers (low value) | Dashboard 800 ms grid check can read stale data; leftover timers per Search press |
| Personal data in git history | Early commits contain run logs / user files; GitHub history outlives the app |
| Docs | `AGENTS.md` is the detailed engine log; `HANDOFF.md` (project root) is the high-level map; this folder is the current per-topic summary |

## Not doing (by decision)

- Logout after payment (DDA behaviour).
- Bank captcha / OTP automation, or training the model for bank captchas.
- Blocking on applicant/DDA-login mismatch.

## The frontend web app (companion, `dda-application-main`)

Work now moves between the desktop app and the web portal that manages applicants and sends their data through the Worker. Already done there (Oct 2026): bulk applicant delete; analytics filters / sorting / paging; and each applicant's DDA password stored encrypted on the Worker, editable by its owner or the admin, and served to the desktop app. Planned: PDF download for all / single / selected applicants, and the auto-key. Release flow: commit on `frontend-design`, fast-forward `main`, push both, deploy hosting only when asked (never the rules/Worker as part of a hosting deploy). Things from this project that touch it:

- The applicant record shape the desktop app expects (see 06), especially `address.pinCode`, `bank.bankId`, `eligibility.enabled` + `paraType`, and documents as base64 data URLs.
- Document quality: the two non-PDF ITR files, WebP images labelled JPEG, DDA's 100 KB per-document limit and allowed types (png/jpg/jpeg/pdf).
- Mobile/email/DOB are missing in many records (DDA prefills them; fine for the desktop app, but the frontend may want them).
- Telemetry records in Firestore `bookingRuns` (one per confirmed hold, measured timings) can feed a frontend dashboard.
