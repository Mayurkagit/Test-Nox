# 03 — Captcha

## The model

- DDA's captchas are simple math images (e.g. `23 + 4`), served by Laravel's mews captcha at `/captcha/default?<8 random chars>`; one active captcha per session.
- Local dual-head ONNX model: `models/nd_core_layer.bin` (~69 KB graph) + `models/nd_core_layer.weights` (external weights, **must ship with it**).
- Trained on 10,000 verified labels (9,236 auto-approved + 764 human-verified), with targeted 1-vs-7 hard-negative fine-tuning (the training scripts are not in this repo). 100% exact match on the validation set; ~3 ms per solve on CPU (AVX2).
- Loaded in the main process by `engine/vision.js` (`initLocalCaptchaModel` at launch, warm-up images in `models/warmup*.png`). In the packaged exe the model is unpacked from `app.asar` (`asarUnpack: models/nd_core_layer.*`) and loaded from `app.asar.unpacked`, because onnxruntime needs a real disk path.
- There is no cloud fallback: the Gemini route was removed and all captchas are solved by the local model.

## Solving paths (preload-dda.js)

1. **Login page:** extract → `captcha:solveLocal` → fill instantly (native setter + jQuery + events). Under load (`checkLoginCaptchaHealth`, every second): an image that failed (HTTP 500) or has not arrived after `CAPTCHA_IMG_WAIT_MS` (30 s), or one the solver can't read, gets a new captcha the way DDA's reload icon does (`GET /user/refresh_captcha`, which keeps the login salt; never a reload of `/user`): the preload clicks `img.btn-refresh` (DDA's jQuery handler is on the icon, not the `<a>` around it, and the page's `refreshCaptcha()` is in a script world the preload can't call), or makes the same request itself when the icon is missing. At most 3 per page (`LOGIN_CAPTCHA_MAX_REFRESHES`), spaced out: the 1st at least 5 s after the failing image appeared, the 2nd 10 s and the 3rd 20 s after the one before (`LOGIN_CAPTCHA_REFRESH_GAPS_MS`; DDA's 500s come in bursts and three quick refreshes all landed inside one). Each new image gets its own full wait, then it hands over with one log line. An unreadable image is marked (`loginCaptchaUnreadableSrc`) and goes through the same watcher. Typing in the captcha box switches it off for the page; DDA's own "invalid captcha" box is left to DDA, which refreshes the captcha itself.
2. **Flat select, direct mode:** the reservation chain fetches its own fresh captcha image, solves it, and POSTs with the answer. Pre-solve runs while the flat is being matched. An image that fails or doesn't arrive costs one attempt ("Captcha image did not arrive… Getting a fresh one (n/7)"), not the flat; its `GET /user/refresh_captcha` is capped at `REFRESH_CAPTCHA_TIMEOUT_MS` (15 s) so a hung answer can't stall the chain.
3. **Flat select, modal mode / manual click:** `processCaptchaImage()` solves the modal's captcha (`.captchblock` is always revealed on flat match; autofill gated by the Auto Captcha setting; once solved, the submit button is always clicked).
4. **Flat select, manual handoff:** after 7 failed direct tries on one flat, the app opens DDA's own reservation popup for that flat with an **empty, focused** captcha box and does **not** fill or submit it — the user finishes by hand (see 02).

## Guards

- Image must be loaded (`naturalWidth/Height > 0`) and visible; square reload/refresh icons are rejected (aspect ratio / name checks). A captcha image may take up to `CAPTCHA_IMG_WAIT_MS` = 30 s to arrive (20 Oct: 1–30 s under load, some up to 53 s); this applies to the flat page's direct chain too.
- **Anti-blank ("anti-27") guard:** canvases with fewer than 50 non-zero pixels are rejected (a blank tensor makes the model output its bias, 23 + 4 = 27).
- Answers with confidence < 85% or out of range are flagged `ANOMALY`.
- **Stale captcha:** a page captcha older than 45 s (`STALE_PAGE_CAPTCHA_MS`) is replaced by a fresh one before solving.
- Session state is reset on Step 2 entry, flat changes and conflict recovery, so a stale answer never fills the input.

## Attempt tracking

Each captcha is one record updated in place: `PRE_SOLVED → SOLVED → SUBMITTED → RESERVED`. Failures stay separate: `SERVER_REJECTED` (with DDA's message), `ANOMALY`, `NO_RESPONSE` (network error / no reply), `FAILED`. ONNX confidence is logged with every solve. These attempts go into the booking record (see 06).

## Open investigation: flat-page "Invalid captcha code"

- **Symptom:** rarely (4–5 times across many bookings) DDA rejects a flat-page captcha the model read correctly.
- **Hypothesis:** DDA keeps one captcha per session; a request from the background Step 2 URL builder may write the session at the same moment (session last-write race), replacing the captcha DDA expects.
- **Tracing in place** (`%APPDATA%\flat-book\fastpay_trace.log`):
  - `CAPTCHA` — each solve and DDA's verdict (`captcha:trace`)
  - `CAPTCHA-IMG` — every captcha image request seen by the main process (`onSendHeaders`/`onCompleted`)
  - `STEP2BUILD` — every request of the background Step 2 builder (`trace` option in `step2Resolver.js`)
- **Status:** since the trace went in, every flat captcha in the user's bookings was accepted first time (only the earlier flat 806 rejection exists, from before the trace). Keep checking the trace after bookings. If a rejection overlaps a builder request, the planned fix is to fetch a fresh captcha after the builder finishes.

## Decisions

- No retraining is needed for DDA captchas (validation is 100%; the rare rejections are not model errors).
- **Bank captchas are never automated** and the model is never trained for them (they are a bank security control).
