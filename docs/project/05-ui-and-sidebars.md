# 05 — UI and sidebars

## Applicant picker (`ApplicantPick.jsx`)

Shown full-screen after every app sign-in and on every window opened with **+** (not on a plain reload). It is where a window is locked onto one DDA login.

- Lists this computer's logins; preselects this window's lock, else its last pick, else nobody (never the first in the list).
- Applicants locked in other open windows are greyed out ("In use in Window N") — two windows on one login would log each other out.
- Tags: **No password**, **Local edit**, **Archived**. A login with no password offers **Add password** (opens the Add-user form prefilled).
- **Lock and continue** / **Skip** / **Unlock**, and **Sync from server** (downloads the applicants + logins again, replacing this computer's logins; see 06). A download runs only here and on the sidebar refresh — not when a window simply opens.
- Window locks persist across restarts by a set rule (one lock survives → Window 1; new windows reuse the lowest free number). See 08.

## Workspace layout

- **Top strip** (in `Workspace.jsx`): the stage rail, the run-status chip (flat page), and the DDA Login / DDA Logout / Back to DDA buttons. There are no back/forward buttons or address bar (DDA signs the applicant out on history navigation). Each window shows "Flat book - Window N".
- **Sidebar header** (`SidebarHeader.jsx`): the portal clock (`PortalClock.jsx`) on the left, a **+** new-window button, and a user menu with Sign out. A wide, rounded stage rail (`StageRail.jsx`) shows the booking stages.
- **DDA webview** (`DdaWebview.jsx`): the real portal. A 4 s watchdog prevents a stuck loading spinner; auto-reload timers stay quiet while Multi-Reload runs.
- **Right sidebar** (`RightControlSidebar.jsx`): changes per page (below).
- **Logs console** (`SidebarLogsConsole.jsx`): live run log; expands on search, folds on stop; hidden on payment and "other" pages.
- **Stage rail** and **run status chip** show run state.

## Sidebar per page (`getSidebarMode` in `src/utils/ddaRoutes.js`)

| Mode | Pages | Sidebar |
|---|---|---|
| `login` | DDA login | Login panel: the window's locked applicant, the lock toggle, captcha box and sign-in. If the locked applicant has no saved password: a "No saved password" prompt with **Add password** (prefilled) and **Edit users** |
| `scheme` | Scheme list | Applicant selector (+ 👁 details), preferences, target scheme, automation modes, TIMED / MANUAL / STOP / SCHEMES, logs |
| `appform` | Application form | As today: applicant, automation modes (incl. Test Application Form), controls |
| `flatselect` | Step 2 | Applicant + preferences (target flats, floor/parity fallback), search duration, Search/Manual/Timed/Stop, logs. Collapsible to full-width webview; auto-tucks when the reservation modal opens, re-opens when targets are unavailable; user's collapse choice is remembered |
| `payment` | Hold page → gateway → bank pages (until another DDA page, or 20 min) | 1) Fast Payment settings, 2) held flat card with DDA's countdown and **FAST PAY** (hold page only), 3) Schemes + Reload. No Autofill/Skip Form toggles. Always open: only the flat-select sidebar can collapse |
| `other` | Locality and any other page | Only Schemes + Reload, placed lower (~30% down). The locality page has no sidebar of its own (it is normally skipped by Direct Jump) |

Only DDA's own host counts as "DDA" for these decisions (the payment flow continues across gateway and bank hosts via `paymentFlowSince` in `useAutomationStore`).

## Hold timer

- Shows DDA's exact countdown, not an assumed 15:00. The page engine reads `#time` (trusted once it changes) or DDA's `fiveMinutes` script value and sends `dda:payment-hold-info {holdExpiresAt}` whenever the two drift by > 1.5 s.
- Shows `--:--` until the real value is known; turns urgent under 2 minutes.
- The previous booking's expiry is cleared on every new reservation and on entering DDA's real schemes page (`/user/schemeList`, via `getSidebarMode`) (cleared with `setState`, because `setReservedFlatDetails` ignores nulls). Gateway, bank and OTP pages keep the countdown (`detectDdaStage` files unknown hosts under SCHEME, so it must not be used for this).

## Applicant details modal (👁, scheme page only)

- Fixed height; tabs in DDA's form order: Personal, Bank, Address, Photo/Sign, Joint Applicant, Karmajeevi Documents, Preferences.
- Karmajeevi tab shows only the chosen and uploaded documents (DDA's OR-conditions), each with **👁 View**.
- **PDF viewing:** PDFs are drawn with pdf.js (`PdfPages.jsx`) inside the preview; images show as images. Chromium's built-in PDF viewer cannot be used (see 01, Chromium switches).
- Closes automatically if the page leaves the scheme stage.

## PDFs opened from DDA pages

Every PDF the webview opens as a page or new window goes to the app's pdf.js viewer window (`PdfDocWindow.jsx`, one-time token, 10-minute expiry, own sandboxed preload):
- **In-memory PDFs** (DDA's "View Uploaded Document" `blob:` links, or `window.open(blob)` from script): the page engine (`setupDdaPdfLinks`) hands the bytes to main (`doc:openPdf`).
- **PDFs served by DDA or any site** (e.g. "My Applications" documents): main's `onHeadersReceived` sees a PDF response for a page load, stops it (the current page stays), re-downloads it with the same session cookies and opens the viewer; an empty popup is closed.
- Junk before `%PDF` (within 1 KB) is skipped. PDFs embedded inside a page are left alone. Images open the normal way.

## Sounds

- One chime when DDA reserves the flat (Status 0) — `playFlatSelectBeep` in `DdaWebview.jsx`.
- Chime at the bank OTP screen.
