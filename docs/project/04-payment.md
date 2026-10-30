# 04 — Payment (Fast Payment)

Fast Payment takes the user from DDA's 15-minute hold page to the bank's OTP / net-banking login with as few clicks as possible. **It never enters an OTP, never solves a bank captcha and never authorises a payment.** Everything is in `preload-dda.js` (page side) and `main.js` (plan, arming, encrypted storage).

## Settings (sidebar → Fast Payment drawer)

- Toggle **Fast Payment** (gated by the master Autofill switch).
- **Gateway:** CBI (Central Bank of India, DDA value `"9"`) or SBI (State Bank of India, value `"10"`).
- **Method:** Card or Net Banking (with SBI the method is always net banking).
- **Bank:** grouped list per gateway (top banks, then all others) (`payment_banks.json`).
- **Card:** number, expiry, CVV, holder name — saved encrypted in `payment_cards.bin` (Windows DPAPI via `safeStorage`). Several cards can be saved; each window picks one. The renderer only ever gets a masked summary; editing with blank number/CVV keeps the saved ones.
- On the payment pages the sidebar shows only these settings (no Autofill/Skip Form toggles), plus the held flat card with the timer and **FAST PAY**.

## The chain

1. **Hold page** — never auto-continues. **FAST PAY** (sidebar) starts the chain: ticks `#tandc` ("I agree") and clicks `#btnContinue`. A "Kindly check Terms and Conditions" alert is dismissed and retried.
2. **Gateway selection** — selects `#payment_gateway` (`9`/`10`) and clicks `#clicktochallan` (`paymentForm()`).
3. **Chargeback policy / Make Payment** — ticks `#termsCondCheckBox`, suppresses the legal modal, enables and clicks `#makePaymentButton`.
4. **Arming:** every click that leaves DDA (step 2 and step 3) goes through `armThenRun()`: it sends `payment:arm` with the plan `{gateway (from the live #payment_gateway value), method, bank}` and waits up to 1.5 s for main's answer before clicking. Main accepts the arm only while the frame is still on DDA. Log: `🔐 Payment armed — SBI via net banking`.
5. **Gateway pages** (`runGatewayAutomation`): the page asks main for the plan (`payment:getGatewayPlan`). Main hands it over only if armed (20-minute TTL) and only once (`payment:submitted` marks it used). No plan → the gateway is left to the user.
   - **SBI chooser** (`merchant.onlinesbi.sbi`, `runSbiChooserFlow`): SBI bank → "SBI Net Banking" (goes to SBI's login); any other bank → "Other Bank Net Banking" → BillDesk.
   - **BillDesk net banking** (`runBillDeskNetBankingFlow`): opens the Net Banking tab, finds the bank (name attribute, top bank buttons or search box), clicks Pay. BillDesk sits in a cross-site `#sdk-iframe` on SBI's page — reaching it needs the `disable-site-isolation-trials` switch.
   - **BillDesk card** (`fillCardFields`): fills number, expiry, CVV and name **one field at a time with human-like typing** (400 ms settle, max 3 writes per field, expiry typed so the "/" lands right), then clicks Pay. A faster all-at-once fill was tried and reverted (it broke the expiry).
   - Any trusted user click/typing on the gateway hands control to the user.
6. **Convenience fee sheet** (`runFeeConfirmation`): BillDesk shows a fee sheet after Pay (`button[name="proceedBtn"]` / `cancelBtn`).
   - **Net banking:** auto-confirmed — only within 20 s of our Pay, only if the user hasn't interacted, the sheet mentions "Convenience Fee" and the amount matches.
   - **Card:** stops at the sheet; the user confirms.
7. **Bank OTP / ACS page:** detected by URL/inputs (`otp`, `/acs/`, `authentication`…). Chime + log "Bank 3D-Secure SMS OTP screen reached", automation stops. The user enters the OTP.

## Saved net-banking logins (Chrome-style)

- `setupBankLoginAssist()` runs on bank login pages (any https page that is not DDA or BillDesk).
- When the user logs in by hand (trusted Login click / Enter / submit), the ID + password go to main, and the app shows a "Save password?" bar (`BankLoginSaveBar.jsx`). Saved encrypted in `bank_logins.bin`.
- Next time on the same host, the saved login is filled and focus moves to the bank's captcha. The user solves the captcha and logs in.
- Manage saved logins in the sidebar (`SidebarBankLogins.jsx`, shown for SBI / net banking).
- Popups opened from non-DDA / non-BillDesk pages load in the same webview, so the preload keeps working on bank sites reached from a link.

## Trace

Every step writes a line to `%APPDATA%\flat-book\fastpay_trace.log` (`ARM`, `PLAN`, `NAV`, `LOG`). Check it when a payment step misbehaves; a rejected arm logs the sender URL in the terminal.

## Known behaviour and open items

- **DDA logs the user out right after a successful payment.** The user has seen this many times; it is DDA's behaviour, not a bug. Don't try to "fix" it.
- **Payment status recording (open, on hold):** detect the gateway's return/acknowledgement, extract transaction ID, reference, amount and status, and upgrade the booking record from `RESERVED_15MIN_HOLD` to a paid status. Because of the logout above, it must not rely on the DDA session staying alive — read the status from the gateway return page or DDA's response before the logout.
- Bank dropdown names should eventually match BillDesk's real Net Banking list exactly.
- Fast Payment was confirmed live on the SBI chooser (SBI Net Banking / Other Bank) on 2026-10-06.
