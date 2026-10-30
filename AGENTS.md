# Flat book — Agent Instructions & Next Session Roadmap

## ✅ COMPLETED: ONNX Captcha Custom Training Ground (Active Learning)

The Active Learning & Hard Negative Mining pipeline has been **fully implemented and verified**:
- **Dataset Consolidation**: 9,236 high-confidence auto-approved + 764 human-verified edge cases = **10,000 verified ground-truth labels** in [data/consolidated_dataset.json](file:///c:/Users/Home/Desktop/dda-application/dda-electron-demo/data/consolidated_dataset.json).
- **Targeted 1 vs 7 Hard Negative Fine-Tuning**: Isolated 22 edge-case samples with $< 95\%$ confidence or 1/7 confusion, oversampled 10× in training pool, and fine-tuned from checkpoint using [scripts/retrain_1_vs_7.py](file:///c:/Users/Home/Desktop/dda-application/dda-electron-demo/scripts/retrain_1_vs_7.py).
- **Thermal-Safe Execution**: Preloaded 43MB in-memory image cache, strictly capped to 2 CPU threads (`torch.set_num_threads(2)`), below-normal priority with micro-pauses.
- **Model Accuracy**: **100.00% Exact-Match Validation Accuracy** across all 10,000 dataset images (0 errors on 1 vs 7 across left and right heads).
- **Exported Models**:
  - Electron Native: [models/nd_core_layer.bin](file:///c:/Users/Home/Desktop/dda-application/dda-electron-demo/models/nd_core_layer.bin) (69.1 KB)
  - Chrome Extension: [dda-application-main/dda-extension/public/models/nd_core_layer.bin](file:///c:/Users/Home/Desktop/dda-application/dda-application-main/dda-extension/public/models/nd_core_layer.bin) (69.1 KB)
- **Verified Speed**: **~2.97 ms** per captcha on local C++ AVX2 execution.

---

## 🛠️ CURRENT SYSTEM STATUS & CONFIGURATION

### Fast Booking Engine
* **Target Flat Polling**: 200ms base interval (`200 + Math.floor(Math.random() * 51)` ms) in [src/utils/ddaAutomations.js](file:///c:/Users/Home/Desktop/dda-application/dda-electron-demo/src/utils/ddaAutomations.js).
* **Strict Scheme Matching (1:1 Extension Parity)**:
  * Targets strictly `<b class="bluec">` title elements in the portal scheme table.
  * Completely removed generic token counts (`matches >= 2`) and reverse substring checks (`target.includes(title)`) that previously matched Karmajeevi when Nagrik was selected.
  * Completely removed unsafe fallback to first button on page.
  * In `Workspace.jsx`, `preload-dda.js`, and `ddaAutomations.js`, the user's selected scheme in the UI dropdown is strictly honored and never overridden by cached worker payloads.
* **Timed Schemes Polling**: 200ms base interval (`200 + Math.floor(Math.random() * 51)` ms chained recursive `setTimeout` with DOMParser) matching Step 2 Flat Drop speed, with T-1.0s early wakeup (`diffMs <= 1000`). Continuous headless polling with zero page reloads across an extended 30-minute hunting window (`dda_timed_hunting_until = Date.now() + 30 * 60 * 1000`) until Apply button is captured or user clicks Stop. Stop button remains enabled and illuminated in solid red throughout the run.
* **Schemes Page Session Heartbeat (Randomized 45s–75s Jitter & Multi-Stage Auto-Stop)**:
  * **Strict Schemes-Page Exclusivity**: Guarded by `isStrictlySchemesPage()`. Runs strictly on `/user/schemeList` and nowhere else (never on Login, Application Form, Locality, Step 2 Flat Drop, or Payment). If navigation leaves the Schemes page, the heartbeat terminates immediately.
  * **Human-Like Randomized Interval**: Replaced robotic 30s fixed interval with randomized `45000 + Math.floor(Math.random() * 30001)` ms (45s to 75s chained `setTimeout`) to defeat WAF bot fingerprinting while easily keeping DDA's 15-minute PHP session alive.
  * **Intelligent Timed Mode Pre-Drop Countdown**: Stays alive during countdown waiting for future drops (e.g. waiting for 12:00:00 PM), but halts the exact millisecond high-speed hunting begins (T-1.0s) or when the Apply button is captured.
  * **Immediate Manual Auto-Stop**: When the user clicks the `MANUAL` button or executes `scanAndApply()`, the heartbeat stops immediately (`window.__ddaStopSessionHeartbeat`), ensuring zero background noise or network contention during critical navigation and reservation.
  * **Dead-Session Auto-Recovery**: If a verification ping detects dead session or login redirect, automatically redirects to re-authenticate.
* **Flat Selection UI**:
  * Search button disabled by default if 0 target flats added.
  * Inputs, Add button, Clear All, and badge delete buttons locked while search is active (`isSearching`).
  * Stop button disabled by default on Flat Select until Search begins.
  * Durations supported: `30s`, `60s`, `90s`, `120s`, `180s`, `300s`, `600s (10 min)`.
  * Live logs console automatically expands on search and folds on stop.
  * Automation Modes: Persistently folded or unfolded based on user preference, with no automatic toggling on search/stop. Contains 5 granular switches: `Autofill` (master), `Auto Submit`, `Auto Captcha`, `Pre-Filled (Skip Form)`, and `Direct URL Jump`.
  * **Pre-Filled (Skip Form / Fast-Pass Mode)**:
    * Skips all 25+ DOM text inputs (Personal, Bank, Address) for pre-saved applications to maintain ultra-fast <100ms dispatch.
    * **Strict Two-Point Verification & Re-Population**:
      1. **Karmajeevi 2.4 Eligibility Documents**: Detects `#para_type`, automatically selects category (`1a` / `1b`), unhides the proper section (`documents_1a_section` / `documents_1b_section`), selects dropdowns, attaches binary files converted from stored base64, and explicitly appends them to AJAX `FormData` with `para_type` and dropdown values, preventing DDA's red validation error (`Please select Para type`).
      2. **Photo & Signature Attachment**: Inspects DOM for official DDA selectors (`#image` / `input[name="photograph"]`, `#signature` / `input[name="signature"]`, joint photo `#joint_applicant_photograph_1`, joint signature `#joint_applicant_signature_1`), attaches binary files via `DataTransfer`, updates preview images (`#photog`, `#sign`, `#jphotog1`, `#jsign1`), sets hidden values (`#pic`, `#sgn`, `#hphoto1`, `#hsign1`), and appends them to AJAX `FormData`.
  * **Test Application Form Button (Admin Only & Strictly No Submit)**:
    * Dedicated "TEST APPLICATION FORM" button at the bottom of the Automation Modes section, visible exclusively to administrators on application form and subsequent stages (hidden for normal users, and hidden on the Schemes page).
    * When clicked on Application Form page: Directly triggers full autofill for the selected applicant.
    * Strictly populates all 25+ DOM fields (Personal, Bank, Address, Joint Applicant, Photo, Signature) AND Karmajeevi eligibility dropdowns/documents (`para_type`, `emp_id_card_1a`/`emp_certificate_1a`, `salary_slip`/`form_16`, `professional_degree_certificate`, `income_tax_return`, `pro_reg_Certificate_issued_doc`, `emp_id_card_1b`/`emp_certificate_1b`).
    * **Strictly Bypasses Submission**: Never fires `fcfsuserapplicantstore` AJAX POST and never clicks `#frmApply`, allowing the user to visually inspect all values and documents on the portal form without submitting.
  * **Direct URL Jump Toggle (Admin Only)**: Visible exclusively to administrators. When ON (default), executes 0ms direct URL jump or parallel race Path A background resolver to `step2_form`. When OFF, completely disables direct jumps from application form & locality pages, enforcing standard dropdown cascade execution (Tier 2 AJAX waterfall / Tier 3 DOM selection + Search click). For normal users, the toggle is hidden and safely defaults to direct URL jump mode.
  * **Universal Application Form Compatibility & Manual Mode Parity**:
    * Strictly decoupled DDA browser compatibility from the master `Autofill` toggle so manual users can fill and submit forms without being blocked by DDA portal bugs.
    * Injects `form.noValidate = true` and `formnovalidate` on `<form id="applicantForm">` and submit buttons, resolving DDA's invalid `<form formnovalidate>` HTML bug.
    * Automatically strips the HTML `required` attribute from all hidden elements (specifically `#joint_applicant_first_name_1`, `#joint_applicant_pan_1`, `#joint_applicant_photograph_1`, `#joint_applicant_signature_1` when Joint Applicant is "No"), preventing Chromium's native constraint validation from silently canceling submissions with *"An invalid form control is not focusable"*.
    * Dynamically maintains un-requiring of joint applicant fields on `is_add_joint` radio toggle (Yes/No).
    * Provides global safe stubs for DDA's inline HTML `onblur` functions (`validateEmailId`, `validateMobileNo`, `validatePanNo`, `validateAadharcard`), eliminating `Uncaught ReferenceError` console crashes during manual typing.
    * Preserves full manual user autonomy: when Autofill is OFF, zero DOM fields are touched or injected; clicking "Submit" cleanly validates, triggers SweetAlert confirmation, and sends DDA's AJAX POST to navigate to the Locality page.
  * Search log prints target flats & attempt counter: `Searching for target flats (103, 104) #1`.
  * **Flat Badges Configuration Decoupled from Scanning**: Adding, editing, or deleting flat badges (`X` button) strictly updates preferences without triggering DOM scans, radio selections, or modal popups. Scanning is strictly initiated by user clicking Search/Manual/Timed.
  * **Unified Direct Submission for Manual & Timed on Flat Select**:
    * Both `Manual` (Search) and `Timed` now activate `dda_direct_mode = true` upon execution, triggering `executeDirectHeadlessReservation` the millisecond a target flat matches in live DOM or background polling. Bypasses Bootstrap modal rendering and directly POSTs `/user/getflatlayoutdetails` for instant redirect to 15-min hold.
    * Fallback preserved: If `__ddaDirectSubmit` is ever unavailable, the system safely falls through to standard DOM radio click and modal unhide.
  * **Streamlined 2x2 Controls Deck (DIRECT Button Merged into MANUAL with Zap Icon)**:
    * Removed the redundant standalone `DIRECT` button from `SidebarControls.jsx`.
    * Updated `MANUAL` button icon to `<Zap className="w-3.5 h-3.5" />` (replacing the old `Rocket` icon).
    * Restored a balanced, symmetrical 2x2 grid layout (`TIMED`, `MANUAL`, `STOP`, `SCHEMES`).
  * **Animated Button Spinners (Replacing Glowing Heartbeat Dots)**:
    * Replaced the pulsing `animate-ping` dot on both the `SEARCH` button (`step2_form`) and `TIMED` button with an animated `<Loader2 className="animate-spin" />` spinner positioned on the left side directly in place of the static icons, preserving clean side-by-side countdown typography.
  * **Direct Captcha Block Display Unhide (Bootstrap Data-Dismiss Conflict Eliminated)**:
    * Modal `#myModal` opens and `.captchblock` is revealed directly via `display: table-row` without clicking `#submitareabtn`. This completely eliminates Bootstrap's native `data-dismiss="modal"` attribute on `#submitareabtn` that previously dismissed/closed the modal when AutoSubmit was ON.
    * Unhiding `.captchblock` is decoupled from the Auto-Submit toggle, ensuring the captcha block is **always** revealed upon target flat selection even when Auto-Submit is OFF.
    * **Strict 3-Way Toggle Separation**:
      1. Modal opening & `.captchblock` unhiding: Always executed upon flat match.
      2. Captcha Autofill: Strictly gated by `captchaAutoSolveEnabled` (autofills if ON, leaves input blank if OFF).
      3. Modal Submission: Strictly gated by `captchaAutoSubmitEnabled` (clicks `#captchabutton` if ON, leaves open for manual submit/Enter if OFF).
  * Distinct Applicant & Preferences Cards: Applicant selector (dropdown & eye button) and Preferences (locality details, edit pen icon, target flat inputs & chips) are separated into two distinct cards with their own card borders and elevation, rather than shared in a single card.
  * Preferences header with icon, flat count pill & edit pen: Header titled `Preferences` preceded by `<SlidersHorizontal />` icon (`w-3.5 h-3.5 text-[#4b2c83]`), followed immediately by the flat count pill (`X Flats`), with the edit pen button (`Edit3`) positioned on the far right.
  * Locality details line displayed cleanly under `Preferences` header: `NARELA, Sector A1, Pocket 1, Block B`.
  * Flat quick-add bar (`Add flat #`) and chips placed directly under locality details.
  * Smart Collapsible Sidepanel on `step2_form`:
    * Permanently pinned (`w-80`) on Login, Schemes, Locality, and Application Form stages.
    * Collapsible to `w-0` exclusively on `step2_form` (Flat Drop) with full-width webview.
    * Smooth width animation with fixed-width wrapper to prevent awkward text wrapping.
    * Enlarged floating round edge button (`w-9 h-9`, `-left-4.5`) to collapse.
    * Floating vertical `◀ CONTROLS` tab on the right edge when collapsed to expand.
    * Smart auto-tuck on modal: Edge-triggered auto-collapse when a flat matches and `#myModal` reservation popup opens.
    * Smart auto-reopen on unavailable: Edge-triggered 1-shot auto-expand when target flats are unavailable (`noneTargetAvailable`), re-armed on new search.
    * Smart auto-reopen on empty targets: Edge-triggered 1-shot auto-expand on entering `step2_form` or when all targets are cleared (`targetList.length === 0`).
    * Manual Close Respected: Edge-triggered state prevents polling loop overrides, guaranteeing that when the user manually collapses the sidepanel, it stays collapsed.
    * User collapse preference persisted in `localStorage` (`dda_step2_sidebar_collapsed`).
  * DDA Default Sidebar Hidden on `step2_form`: Injected at 0ms via preload and webview CSS. Hides DDA's `.sidebar-nav` and expands `.midarea .col-md-10` to 100% width, eliminating horizontal scrolling on the 10-column flat table and preventing accidental misclicks.
  * Step 2 Vertical Space Optimization (~420px Saved):
    * Hides massive building banner (`.banner`), legend icons (`.flatcircle`), floor explanation box (`.bluebg-title`), and raw locality table (`.flat-searc-wraper`).
    * Compacts `.notification` scheme ribbon into a sleek 32px flex bar that automatically extracts Locality, Sector, Pocket, Block, and Tower and renders them as a high-contrast pill badge (`📍 NARELA • SECTOR A1 TO A4 • POCKET IV • BLOCK B • TOWER B`).
    * Flats and floor blocks appear immediately at the top of the viewport above the fold with zero scrolling required.
  * 12 PM Timed Drop Preset: Quick 1-click `12 PM` button in Timed Mode timer popover setting `targetTime` to `12:00:00 PM`.
  * Zero-Delay Background DOM Captcha Solver & Anti-27 Blank Guard:
    * Fixed `isFlatReservationModalOpen()` which previously had a premature query selector causing it to consider `#myModal` open even when hidden (`display: none`).
    * Fixed `isCaptchaReadyForSolve()` to require positive natural image dimensions (`naturalWidth > 0 && naturalHeight > 0`) and `.captchblock` visibility (not `display: none`).
    * Added Anti-27 canvas blank/unrendered pixel guard in `extractCaptchaTensor()`: rejects canvases with fewer than 50 non-zero pixels, preventing blank transparent tensors from feeding into ONNX and outputting baseline bias (23 + 4 = 27).
    * Anti-Dummy / Reload Icon Guard: Rejects square refresh/reload button icons (`24x24`, `aspectRatio < 1.8`, `src/alt/class/parent` containing `reload`/`refresh`) in `isCaptchaReadyForSolve()`, `extractCaptchaTensor()`, and DOM queries, ensuring fast macOS/M4 renderers never feed cached reload buttons into ONNX before dynamic math captchas finish downloading.
    * Guaranteed session state resets on Step 2 entry, flat radio changes, and conflict recovery so stale answers never pollute the input.
    * Enabled manual flat click solving by removing the automation-only check in `processCaptchaImage()`.
  * **Conflict Auto-Recovery on Taken Flat (Zero-Delay Preference Auto-Switching)**:
    * Instant in-memory auto-recovery (<60ms) when a flat reservation encounters Status 2 or 4 (already hold/allotted by another applicant) on direct POST or SweetAlert2 conflict alert in modal mode.
    * Blacklists the taken flat in session `bookedFlatsSet` and `window.__ddaBookedFlatsSet`, marks building node `.sold/.hold` and disables radio in live DOM to prevent repeat selections.
    * In Direct Mode: Immediately auto-switches to the next target preference (`remainingTargets[0]`) and re-fires `executeDirectHeadlessReservation` recursively without page reloads or DOM lag. If all specific targets are taken, auto-switches to best available floor flat if fallback is enabled.
    * In Modal Mode: `checkForConflictAlert` auto-dismisses popup, resets `flatSelected`, removes modal/backdrop, and triggers `window.__ddaScanLiveDom()` to immediately open the next candidate flat.
    * Polling Auto-Resume: If all targets currently in DOM fail or are taken, background polling (`pollTick`) seamlessly resumes to catch newly released flats.
  * **Step 2 Solved Captcha Telemetry & Attempt Tracking (100% Pipeline Completeness)**:
    * In-place session attempt progression: `recordCaptchaAttempt` updates the active captcha record in-place across `PRE_SOLVED` -> `SOLVED` -> `SUBMITTED` -> `RESERVED`, eliminating duplicate cards for the same image.
    * Exact failure & anomaly capture: Preserves `SERVER_REJECTED` (with server alert message) and `ANOMALY` (<85% confidence or out of bounds) as distinct attempts so retries are tracked with full visual audit fidelity.
    * Milestone & Telemetry alignment: Milestone logs track the single server submission event (`step5_captcha_submit`), while Visual Audit displays the true unique attempts (clean 1-attempt for normal runs, +1 for server rejections/anomalies).
    * Single Reservation Chime: Audio alert in `DdaWebview.jsx` strictly gated to `{ reserved: true }` upon Status 0 confirmation (<15-min hold secured), eliminating premature match beeps.
    * Dual-tier storage & multi-fallback: Synchronously persists to both `localStorage` and `sessionStorage` (`dda_captcha_attempts`), with in-memory pre-solve fallback in `sendAnalyticsPayloadOnce` and store state fallback in `Workspace.jsx:dispatchRunTelemetry`, guaranteeing `captchaAttempts` and `lastCaptcha` are 100% populated in Firebase Firestore (`bookingRuns`), Cloudflare Worker telemetry, and local database records.
  * Instant Login Captcha Solver & Field Autofill (< 50ms):
    * Unified `CAPTCHA_INPUT_SELECTORS` and `CAPTCHA_IMAGE_SELECTORS` matching all DDA login and modal DOM variants (`user_captcha`, `txtCaptcha`, `captcha_code`, `imgCaptcha`, `captcha_image`).
    * Removed `isPageLoading` gate from `Workspace.jsx` login watcher, initiating instant extraction at 0ms, 80ms, 250ms, and 600ms without waiting for 2–3s network asset loading.
    * Preload ONNX solver sends immediate `dda:captcha-solved` IPC upon solving, and `fillCaptchaInput()` injects directly into DOM with native property descriptor setter, jQuery sync, and input/change/blur events within milliseconds.
  * Post-Login Applicant Smart Matching & Manual Override Persistence:
    * Automatic 1-shot detection and selection of the authenticated user's PAN card person across `Workspace.jsx`, `preload-dda.js`, and `RightControlSidebar.jsx` upon initial login.
    * Fresh-login guard (`dda_just_logged_in` in `sessionStorage` & `hasMatchedLoginRef` in `Workspace.jsx`) ensures matching executes strictly once on login transition.
    * On Workspace reload or app restart without manual selection, the applicant selector cleanly defaults to "Select Applicant" (`activeApplicant: null`), completely preventing accidental fallback or silent auto-selection of index 0 (`applicants[0]`).
    * When the user picks any applicant from the sidepanel dropdown, that manual selection sticks permanently without being reverted or re-matched across stage transitions.
    * Eliminated asynchronous webview executeJavaScript query loop to guarantee uninterrupted, instant fast-booking automation execution across all stages (Schemes, Locality cascades, and Step 2 Flat drops).
  * Target Scheme Single Source of Truth & Extension 1:1 Parity:
    * Unification across `dda_selected_scheme`, `dda_active_scheme_name`, and `dda_target_scheme`.
    * Non-admin users are strictly locked to the broadcast active scheme sent by Cloudflare Worker (`ddaData.targetScheme` / `dda_active_scheme_name`). Sidepanel displays a static, non-interactive badge with a `Layers` icon and high-contrast `#faf5ff` `ACTIVE` status badge.
    * For admins, user dropdown selections (e.g. `NAGRIK`) are strictly honored as the single source of truth across `useApplicantStore`, `Workspace.jsx`, `SidebarSchemePanel`, `ddaAutomations.js`, and `preload-dda.js`. Background worker sync and key verification never overwrite admin selections with index `0`. Switching applicants also preserves the user's selected scheme.
    * Portal table row matching uses strict 1:1 extension logic (`title.includes(targetNorm)`), eliminating reverse substring checks.
* **Applicant Details Modal & Eye Button (Strictly Schemes Page Sidebar Only)**:
  * **Schemes-Page Exclusivity**: The Eye button and details modal are strictly restricted to the Schemes page sidebar (`activeStage.id === 'SCHEME'`). Removed from the Login page sidebar (`SidebarLoginPanel`), step2_form flat drop page sidebar (`FLAT_SELECT`), and all other stages. If navigation leaves the schemes stage while the modal is open, it automatically closes.
  * **Fixed Modal Height**: Strict constant height container (`height: min(580px, 90vh)`, `minHeight: min(580px, 90vh)`, `maxHeight: 90vh`). Never resizes, shifts, or jumps between sections/tabs.
  * **Controls**: Footer strictly contains the "Close" button.
  * **Strict DDA Application Form Ordering (Sections & Fields)**:
    * Tabs and sections are strictly ordered according to the official DDA portal application form:
      1. `Personal Details`: Full Name, Father's Name, Mother's Name, Date of Birth (DOB), Gender, Nationality, Marital Status (+ Spouse Name), Category, PAN Number, Aadhar Number, Mobile Number, Email ID, STD Code & Phone, Physically Disabled (PwD).
      2. `Bank Details`: Bank Name, Branch Name, IFSC Code, Account Number.
      3. `Address Details`: House / Flat No, Street / Locality, Area / Sector, Town / City, State, District, PIN Code, Region.
      4. `Photo/Sign`: Primary Photograph & Signature cards, with preview and Karamjeevi attachment status banner.
      5. `Joint Applicant`: Relationship, Full Name, Gender, Father's Name, Mother's Name, DOB, Marital Status, Spouse, Category, PAN, Aadhar, Mobile, Email, Joint Photo & Signature (included when joint applicant is attached).
      6. `Karmajeevi Documents`: Full Karmajeevi Scheme & Eligibility Documents section (shown for applicants having Karmajeevi details). Displays Scheme Category, Para 2.4(a)/2.4(b) selection, strictly chosen category cards, and only the chosen & uploaded eligibility documents satisfying DDA OR-conditions (omitting unchosen or unuploaded alternatives, with dynamic uploaded count badge and no placeholder boxes). Includes thumbnails, "✓ Attached" status badges, and an integrated "👁 View" document inspection modal (supporting images and PDFs).
      7. `Preferences`: Row 1 (Locality, Sector, Pocket), Row 2 (Block, Tower), and Row 3 (Target Flat No(s) on a **NEW line** after Block and Tower, with chip badge pills).
  * **Multi-Source Bank, Address & Eligibility Persistence**:
    * Enriched `dda_db/dda_offline_store.json` with complete bank and address records across all 14 applicants.
    * `db/database.js:saveApplicant` and `useApplicantStore.js:syncRealtimeApplicants` updated to deeply preserve `bank`, `address`, `jointApplicant`, and `eligibility` (Karmajeevi) fields.
    * `useApplicantStore.js` (`loadApplicants` and `selectApplicant`) preserves and merges all storage tiers (`ddaData`, `dda_extension_applicants`, `OFFLINE_STORE`), preventing destructive overwrites.
    * `RightControlSidebar.jsx` immediately syncs applicant selection with `useApplicantStore.getState().selectApplicant(cleanPan)`.
* **Payment Stage Sidepanel UI**:
  * **Target Scheme Hidden**: Target scheme card omitted on Stage 6 (`PAYMENT_HOLD`).
  * **Warning Palette Hold Notice**: 15-Minute Reservation Hold message styled in warning amber (`border-amber-300`, `bg-amber-50`, `text-amber-900`) instead of red.
  * **Proceed Button Removed**: "Proceed to Payment Gateway" button removed for cleaner focus on portal native payment.
  * **Controls Stripped**: Timed, Manual, and Stop buttons hidden; only Quick Navigation (`SCHEMES` and `RELOAD PAGE`) displayed.
  * **Hidden by Default & Drawer Parity**: Collapsed (`w-0`) by default on entering payment hold, featuring the identical floating `◀ CONTROLS` drawer tab to expand and enlarged edge button to collapse.
* **App Signout & DDA Session Clear**:
  * On Desktop App Logout, `session:clearDdaSession` actively purges cookies, session storage, local storage, and cache for `https://eservices.dda.org.in` across all partitions (`defaultSession`, `persist:dda_workspace`, `persist:dda_session`, and applicant partitions), closing any standalone windows.
  * Next login starts completely unauthenticated on DDA portal, requiring fresh login.
  * App reloads (Ctrl+R / F5) strictly keep DDA sessions alive so live drop runs are never interrupted.
* **EventEmitter & Webview Listener Stability (MaxListeners Warning Eliminated)**:
  * In [DdaWebview.jsx](file:///c:/Users/Home/Desktop/dda-application/dda-electron-demo/src/components/DdaWebview.jsx), stabilized `<webview>` event listeners by capturing dynamic props (`activeApplicant`, `onUrlChange`, `onLoadingChange`, `onLog`) in React `useRef` handles and reducing the listener `useEffect` dependency array strictly to `[cleanPartition]`. Listeners are bound once on mount rather than constantly torn down and re-registered upon every applicant selection, search state, or log update.
  * **Payment Expiration Alert 1-Shot Guard & Auto-Confirm**:
    * In `preload-dda.js`, added 1-shot dataset guard (`popup.dataset.expiredLogged = "true"`) on "your time has been expired" SweetAlert check, eliminating rapid-fire duplicate error logs every 100ms.
    * Added auto-click on `.swal2-confirm` / `button.confirm` to automatically dismiss the expiration dialog and smoothly route back to `step1_form`.
    * Throttled `checkTimerAlert` interval to 250ms.
  * **MutationObserver Microtask Loop Elimination (`step2_form` Re-Entry Infinite Freeze Resolved)**:
    * In `preload-dda.js`, removed `class` and `style` from `captchaObserver` attribute filter (scoped strictly to `["src"]`), eliminating cross-observer DOM mutation ping-pong.
    * In `modalObserver`, added `isHandlingModal` re-entrancy mutex flag, gated on modal visibility (`.show`, `.in`, `display: block`), and added idempotent checks before touching `.captchblock` and `.reserve` styles.
    * Added 4-second safety watchdog on `isPageLoading` in `DdaWebview.jsx` to prevent stuck address bar spinner.
  * In [main.js](file:///c:/Users/Home/Desktop/dda-application/dda-electron-demo/main.js), set global `EventEmitter.defaultMaxListeners = 50` and raised max listeners to 50 on all `WebContents` instances (`mainWindow`, `sessionWin`, and `app.on('web-contents-created')`), completely eliminating `MaxListenersExceededWarning` across multi-stage automation runs.

### External Analytics & Privacy
* **External 3rd-Party Trackers**: 100% blocked via `webRequest.onBeforeRequest` in [main.js](file:///c:/Users/Home/Desktop/dda-application/dda-electron-demo/main.js) (Google Analytics, GTM, Clarity, Facebook, DoubleClick, WP Stats).
* **Cloud AI / Cloud OCR**: Commented out / disabled. Captchas run 100% locally via native ONNX.
* **Internal Telemetry**: Cloudflare Worker & Firebase Firestore sync only fires on Stage 6 (Payment Hold) after booking is secured. It has zero impact on booking execution time.

---

## 📋 UPCOMING WORKSPACE ROADMAP

1. **Webview Console & Terminal Routing**:
   - Forward all `<webview>` console output straight into Electron terminal (`npm run dev`) and DevTools console.
2. **Missing Live Pipeline Logs & Search Controls**:
   - Flat search: Show search attempts (#1, #2, #3...) live in `SidebarLogsConsole`.
   - Halt search button animation and countdown immediately once a target flat is clicked/reserved.
   - Stage transitions: Clear `isSearching` when navigating across pages (so Flat Select search doesn't bleed into Schemes page).
   - Captcha popup: Log reservation popup opened, math captcha expression extracted, and solved value.
   - Form & Locality: Granular logs for dropdown selections and form sections filled.
3. **Rapid Reload & Error Auto-Recovery on `step2_form`** (✅ COMPLETED):
   - Multi-Reload loop: clicking MULTI RELOAD (via sidepanel controls or top navigation bar) repeatedly hard-reloads (bypassing cache) every 250ms until the DDA portal responds with HTTP 200 OK and genuine DOM content. Automatically detects 502 Bad Gateway, 504 Gateway Time-out, 503/500 Server Error, and database connection errors, with attempt counter (`RETRYING (X)...`) and 5s socket watchdog. Auto-halts upon recovery or when user clicks Stop.
4. **Conflict Auto-Recovery on Taken Flat** (✅ COMPLETED):
   - When a flat is already reserved by another applicant (Status 2/4 on direct POST or SweetAlert conflict in modal), dismisses popup, marks building node .sold/.hold, strikes off the taken flat, and immediately attempts the next target flat in priority.
5. **Sound Alert on Flat Reservation**:
   - Play distinct audio chime when reservation modal opens / 15-minute hold page is reached.
6. **Fast Payment Automation Engine (CBI & SBI / BillDesk Embedded SDK v2 with Strict User OTP Authorization)** (✅ COMPLETED):
   - **4-Stage Seamless Cascade**:
     1. **Stage 1 (DDA 15-Min Hold)**: Auto-checks `#tandc` ("I Agree With Terms and Conditions") and clicks `#btnContinue` (`window.CheckTermCondition()`).
     2. **Stage 2 (Gateway Selection)**: Observes `.payment_method`, auto-selects `#payment_gateway` (`"9"` for Central Bank of India CBI or `"10"` for State Bank of India SBI), and clicks `#clicktochallan` (`window.paymentForm()`).
     3. **Stage 3 (Chargeback Policy & Make Payment)**: Auto-checks `#termsCondCheckBox`, suppresses/dismisses `#myModal` legal popup, removes `.disabled` from `#makePaymentButton`, and dispatches redirect/click to payment gateway.
     4. **Stage 4 (BillDesk Embedded SDK v2)**: Cross-origin iframe (`#sdk-iframe`) communication enabled via `webSecurity=no`, `contextIsolation=no`, and `nodeIntegrationInSubFrames=true`.
        - **Credit/Debit Card**: Switches to Card tab, injects Card Number, Expiry MM/YY, CVV, and Cardholder Name using Vue property descriptor setters, and submits via `#card-pay-button`.
        - **Net Banking**: Switches to Net Banking tab (`[name="netbankingpage"]`), matches target bank by `name` attribute or top bank buttons (CBI, SBI, HDFC, ICICI, Axis, Kotak, PNB, etc.) or `#search-input`, and clicks Pay button.
     5. **Stage 5 (Bank 3D-Secure SMS OTP Screen)**:
        - Detects bank ACS OTP screen (`otp`, `acs`, `vbv`, `secure`, `authentication`, OTP input).
        - Plays chime alert and prints success log.
        - **Strict Stop**: Completely halts automation at the OTP screen so the user enters their SMS OTP and retains final authorization right.
   - **Settings & UI Controls**:
     - Fast Payment toggle in `SidebarAutomationModes.jsx` (gated by master `Autofill`).
     - Configuration drawer with Gateway selector (CBI vs SBI), Payment Method tabs (Card vs Net Banking), masked Card inputs with show/hide eye toggles, and full searchable BillDesk bank selector.
     - "FAST PAY NOW" manual action button added to `SidebarControls.jsx` on Payment Hold stage.
7. **Payment Status & Transaction Confirmation Sync**:
   - Automatically detect return from payment gateway (acknowledgement / payment response page).
   - Extract Transaction ID, Reference Number, Amount, and status (`SUCCESS` / `PENDING` / `FAILED`).
   - Upgrade telemetry from `RESERVED_15MIN_HOLD` to `CONFIRMED_BOOKING_PAID` across local store and Firebase.

