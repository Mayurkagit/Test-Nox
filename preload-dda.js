// Injected Preload Script for DDA Browser Sessions in Electron
// Direct access to Applicant Profile, Isolated Session Partitions, 0ms Autofill & Autonomous Execution Engine

const { ipcRenderer } = require("electron");

// Placeholder photo / signature for an applicant with none saved (only when
// DDA's form asks for them; see fillPhotoAndSignature). This page is sandboxed
// and can't require() files, so main hands them over (placeholderImages.cjs).
// Shared with the dashboard's Autofill script through window.__ddaBlankImages.
let BLANK_IMAGES = { photo: "", signature: "" };
try {
  const fromMain = ipcRenderer.sendSync("dda:blankImages");
  if (fromMain && typeof fromMain.photo === "string") {
    BLANK_IMAGES = { photo: fromMain.photo, signature: fromMain.signature || "" };
  }
} catch (_) {}
if (typeof window !== "undefined") window.__ddaBlankImages = BLANK_IMAGES;

// DDA's photo / signature box is on the form and shown (DDA has commented these
// out at times), and DDA has nothing on file: its preview still shows DDA's own
// "no photo" picture and the hidden name field is empty.
function ddaWantsUpload(input, previewId, hiddenId) {
  if (!input || input.disabled) return false;
  if (input.closest('[style*="display: none"], [style*="display:none"], .d-none, .hide, .hidden')) return false;
  const preview = previewId ? document.getElementById(previewId) : null;
  const src = String(preview?.getAttribute("src") || "");
  const ddaDefault = !src || /\/images\/(userimage|signature)\.png(\?|$)/i.test(src);
  const hidden = hiddenId ? document.getElementById(hiddenId) : null;
  return ddaDefault && !String(hidden?.value || "").trim();
}

function format12HourTime(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m}:${s}.${ms} ${ap}`;
}

const loggedMilestones = new Set();

// 📊 Intercept ipcRenderer.send to accumulate granular event traces for analytics (100% Extension Parity)
try {
  const origIpcSend = ipcRenderer.send.bind(ipcRenderer);
  ipcRenderer.send = function (channel, data, ...args) {
    if (channel === "dda:log" && data) {
      try {
        if (data._stored) {
          try {
            if (typeof ipcRenderer.sendToHost === "function") {
              ipcRenderer.sendToHost("dda:log", data);
            }
          } catch (_) {}
          return origIpcSend(channel, data, ...args);
        }
        const msg = String(data.msg || data.message || "");
        // Filter out internal setup messages from entering run logs
        if (
          data.page === "Session Init" ||
          msg.includes("Isolated session active") ||
          msg.includes("Live logs initialized") ||
          msg.includes("Scheme List loaded") ||
          msg.includes("Fast-Pass Store Saved") ||
          msg.includes("Solving captcha via Native C++")
        ) {
          return origIpcSend(channel, data, ...args);
        }
        const now = data.timestamp || Date.now();
        const timeStr = data.time || format12HourTime(now);
        const entry = {
          ...data,
          timestamp: now,
          ts: now,
          time: timeStr,
          level: (data.level || "INFO").toUpperCase(),
          page: data.page || "DDA",
          msg: msg,
          _stored: true,
        };
        const existing = JSON.parse(
          sessionStorage.getItem("dda_session_run_logs") ||
            localStorage.getItem("dda_run_logs") ||
            "[]",
        );
        existing.push(entry);
        if (existing.length > 300) existing.shift();
        sessionStorage.setItem(
          "dda_session_run_logs",
          JSON.stringify(existing),
        );
        try {
          localStorage.setItem("dda_run_logs", JSON.stringify(existing));
        } catch (_) {}
        try {
          if (typeof ipcRenderer.sendToHost === "function") {
            ipcRenderer.sendToHost("dda:log", entry);
            return; // Delivered directly to webview host; avoid duplicate dispatch
          }
        } catch (_) {}
      } catch (_) {}
    }
    return origIpcSend(channel, data, ...args);
  };
} catch (_) {}

console.log(
  "⚡ [DDA Electron Session Preload] Loaded into DDA Browser Context",
);

let currentApplicant = null;
let currentSettings = {};
let isAutomationRunning = true;
const activeObservers = [];
const activeIntervals = [];
let lastFocusSyncTime = 0;
let lastSolvedCaptchaAnswer = null;
let currentFillToken = 0;

// Direct URL Jump is always on: jump to the flat page as soon as its link is
// built. There is no switch for it any more; a stale "off" saved by the old
// switch (or by turning Autofill off) is ignored. Autofill off still stops
// all automation before this is reached.
function isDirectUrlJumpEnabled() {
  return true;
}

function stopAllAutomation() {
  isAutomationRunning = false;
  while (activeIntervals.length > 0) {
    const id = activeIntervals.pop();
    clearInterval(id);
    clearTimeout(id);
  }
  while (activeObservers.length > 0) {
    const obs = activeObservers.pop();
    try {
      obs.disconnect();
    } catch (_) {}
  }
  if (window.__ddaTimedSearchTimer) {
    clearTimeout(window.__ddaTimedSearchTimer);
    clearInterval(window.__ddaTimedSearchTimer);
    window.__ddaTimedSearchTimer = null;
  }
  if (window.__ddaTimedPoller) {
    clearTimeout(window.__ddaTimedPoller);
    clearInterval(window.__ddaTimedPoller);
    window.__ddaTimedPoller = null;
  }
  if (window.__ddaFlatHunterTimer) {
    clearTimeout(window.__ddaFlatHunterTimer);
    window.__ddaFlatHunterTimer = null;
  }
  if (window.__ddaFlatHunterTimeout) {
    clearTimeout(window.__ddaFlatHunterTimeout);
    window.__ddaFlatHunterTimeout = null;
  }
  window.__ddaFlatHunterActive = false;
  console.log(
    "🛑 [DDA Preload] Autofill OFF: stopped all active flat polling, observers, and hunters.",
  );
}
if (typeof window !== "undefined") {
  window.__ddaStopAllAutomation = stopAllAutomation;
}

// ⚡ Zero-Latency CSS Animation & Modal Transition Neutralizer (Optimization 1)
function injectZeroLatencyStyles() {
  try {
    if (typeof document === "undefined") return;
    if (document.getElementById("__dda_instant_ui_style")) return;
    const target = document.head || document.documentElement;
    if (!target) return;
    const style = document.createElement("style");
    style.id = "__dda_instant_ui_style";
    style.textContent = `
      *, *::before, *::after {
        transition-duration: 0.001ms !important;
        transition-delay: 0s !important;
        animation-duration: 0.001ms !important;
        animation-delay: 0s !important;
      }
      .fade {
        opacity: 1 !important;
        transition: none !important;
      }
      .modal.fade .modal-dialog {
        transform: none !important;
        transition: none !important;
      }
      .modal-backdrop.fade {
        opacity: 0.5 !important;
        transition: none !important;
      }
      .swal2-popup, .swal-modal, .sweet-alert {
        animation: none !important;
        transform: none !important;
        transition: none !important;
      }
    `;
    target.appendChild(style);
  } catch (_) {}
}

// ⚡ Universal DDA Footer Removal across all pages
function injectDdaFooterRemovalStyles() {
  try {
    if (typeof document === "undefined") return;
    if (document.getElementById("__dda_hide_footer_style")) return;
    const target = document.head || document.documentElement;
    if (!target) return;
    const style = document.createElement("style");
    style.id = "__dda_hide_footer_style";
    style.textContent = `
      /* Universal DDA Footer Removal across all pages */
      footer,
      .footerarea,
      .footarea,
      .footer-area,
      .footer-bottom,
      .footer-section,
      .copyright,
      .copyrights,
      .footbg,
      body > footer,
      #footer,
      .footer:not(.modal-footer),
      p.copyright,
      .row:has(> .copyright),
      .col-12:has(> .copyright),
      div:has(> p.copyright) {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    target.appendChild(style);
  } catch (_) {}
}

function removeDdaFooters() {
  try {
    if (typeof document === "undefined") return;
    const footers = document.querySelectorAll(
      'footer, .footerarea, .footarea, .footer-area, .footer-bottom, .footer-section, .copyright, .copyrights, .footbg, body > footer, #footer, .footer:not(.modal-footer), p.copyright'
    );
    footers.forEach((el) => {
      try {
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("height", "0px", "important");
        el.style.setProperty("visibility", "hidden", "important");
      } catch (_) {}
    });
  } catch (_) {}
}

// DDA's own left menu (.sidebar-nav, a col-md-2 beside the col-md-10 page). Hidden on every DDA
// page unless this window's "DDA sidebar" toggle in the app is off; display:none hides it at
// every width (on a narrow window DDA stacks it above the page). The app sets it through
// window.__ddaSetDdaSidebarHidden; the choice lives in this window's DDA localStorage.
const DDA_SIDEBAR_KEY = "dda_hide_dda_sidebar"; // "0" = show DDA's menu, anything else = hide
function applyDdaSidebarVisibility() {
  try {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    if (window.location.hostname !== "eservices.dda.org.in") return;
    let hide = true;
    try { hide = localStorage.getItem(DDA_SIDEBAR_KEY) !== "0"; } catch (_) {}
    const id = "__dda_hide_sidebar_style";
    const existing = document.getElementById(id);
    if (!hide) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const target = document.head || document.documentElement;
    if (!target) return;
    const href = (window.location.href || "").toLowerCase();
    const isStep2 = href.includes("step2_form") || href.includes("getflat") || href.includes("flatlayout");
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      html body .sidebar-nav { display: none !important; }
      .midarea > .row > .col-md-10${isStep2 ? ", .midarea .col-md-10, .col-12.col-sm-12.col-md-10, .col-md-10" : ""} {
        flex: 0 0 100% !important;
        max-width: 100% !important;
        width: 100% !important;
      }
    `;
    target.appendChild(style);
  } catch (_) {}
}
if (typeof window !== "undefined") {
  window.__ddaSetDdaSidebarHidden = (hide) => {
    try { localStorage.setItem(DDA_SIDEBAR_KEY, hide ? "1" : "0"); } catch (_) {}
    applyDdaSidebarVisibility();
    return hide;
  };
}

// ⚡ Step 2 (Flat Drop) Edge-to-Edge & Vertical Optimization: Hide DDA's Banner, Legend & Explainer
// (DDA's sidebar and the full-width page follow the app's toggle, see applyDdaSidebarVisibility)
function injectStep2FullWidthStyles() {
  try {
    if (typeof document === "undefined" || typeof window === "undefined")
      return;
    const href = (window.location.href || "").toLowerCase();
    const isStep2 =
      href.includes("step2_form") ||
      href.includes("getflat") ||
      href.includes("flatlayout");
    const existing = document.getElementById("__dda_step2_fullwidth_style");
    if (isStep2) {
      if (existing) return;
      const target = document.head || document.documentElement;
      if (!target) return;
      const style = document.createElement("style");
      style.id = "__dda_step2_fullwidth_style";
      style.textContent = `
        /* Step 2 Flat Drop Edge-to-Edge & Vertical Space Optimization */
        .banner,
        .flatcircle,
        .bluebg-title,
        .flat-searc-wraper,
        .boxshadowcontainer > .row:has(.flatcircle),
        .boxshadowcontainer > .row:has(.bluebg-title) {
          display: none !important;
        }
        .boxshadowcontainer {
          padding-top: 2px !important;
          padding-bottom: 2px !important;
          margin-top: 0 !important;
          border-top: none !important;
          box-shadow: none !important;
        }
        .boxshadowcontainer.borderbottom {
          border-bottom: none !important;
        }
        .notification {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          flex-wrap: wrap !important;
          gap: 8px !important;
          padding: 6px 14px !important;
          margin-top: 2px !important;
          margin-bottom: 2px !important;
          min-height: 32px !important;
        }

        /* ⚡ Stealth Background Modal & Backdrop Neutralizer (Zero Screen Popup when Auto-Submit ON) */
        body:not(.dda-manual-submit-mode) #myModal,
        body:not(.dda-manual-submit-mode) #flatDetailModal,
        body:not(.dda-manual-submit-mode) .modal[id*="Modal"],
        body:not(.dda-manual-submit-mode) .modal {
          opacity: 0 !important;
          pointer-events: none !important;
          position: fixed !important;
          top: -9999px !important;
          left: -9999px !important;
          z-index: -9999 !important;
          transform: scale(0.001) !important;
        }
        body:not(.dda-manual-submit-mode) .modal-backdrop {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
          z-index: -9999 !important;
        }
      `;
      target.appendChild(style);
    } else if (existing) {
      existing.remove();
    }
  } catch (_) {}
}

// ⚡ Compact Scheme Ribbon & Relocate Locality-Tower Metadata directly into header ribbon
function compactStep2Header() {
  try {
    if (typeof document === "undefined" || typeof window === "undefined")
      return;
    const href = (window.location.href || "").toLowerCase();
    const isStep2 =
      href.includes("step2_form") ||
      href.includes("getflat") ||
      href.includes("flatlayout");
    if (!isStep2) return;

    const notifEl = document.querySelector(".notification");
    const wrapper = document.querySelector(".flat-searc-wraper");
    if (!notifEl || !wrapper) return;

    if (notifEl.querySelector(".dda-compact-location-tag")) return;

    const getVal = (label) => {
      const divs = Array.from(wrapper.querySelectorAll("div"));
      for (const d of divs) {
        const text = (d.innerText || d.textContent || "").trim();
        if (text.toLowerCase().includes(label.toLowerCase() + ":")) {
          const parts = text.split(":");
          return parts.slice(1).join(":").trim();
        }
      }
      return "";
    };

    const locality = getVal("Locality");
    const sector = getVal("Sector");
    const pocket = getVal("Pocket");
    let block = getVal("Block");
    let tower = getVal("Tower");

    if (block && !/^block\b/i.test(block)) block = `Block ${block}`;
    if (tower && !/^tower\b/i.test(tower)) tower = `Tower ${tower}`;

    const items = [locality, sector, pocket, block, tower].filter(Boolean);
    if (items.length === 0) return;

    const pill = document.createElement("span");
    pill.className = "dda-compact-location-tag";
    pill.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 700;
      color: #ffffff;
      background: rgba(255, 255, 255, 0.22);
      border: 1px solid rgba(255, 255, 255, 0.38);
      border-radius: 9999px;
      padding: 3px 12px;
      letter-spacing: 0.3px;
      white-space: nowrap;
      text-transform: uppercase;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
      margin-left: auto;
    `;
    pill.textContent = `📍 ${items.join(" • ")}`;

    notifEl.appendChild(pill);
  } catch (_) {}
}

function syncAutoSubmitModeClass() {
  try {
    if (typeof document === "undefined" || !document.body) return;
    const isAutoSubmit =
      currentSettings?.captchaAutoSubmitEnabled !== false &&
      localStorage.getItem("captchaAutoSubmitEnabled") !== "false";
    if (!isAutoSubmit || window.__ddaManualCaptchaFlat) {
      // (also while the user types a captcha in DDA's popup: it must stay on screen)
      document.body.classList.add("dda-manual-submit-mode");
    } else {
      document.body.classList.remove("dda-manual-submit-mode");
    }
  } catch (_) {}
}

injectZeroLatencyStyles();
injectDdaFooterRemovalStyles();
removeDdaFooters();
injectStep2FullWidthStyles();
applyDdaSidebarVisibility();
compactStep2Header();
syncAutoSubmitModeClass();

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        injectZeroLatencyStyles();
        injectDdaFooterRemovalStyles();
        removeDdaFooters();
        injectStep2FullWidthStyles();
        applyDdaSidebarVisibility();
        compactStep2Header();
        syncAutoSubmitModeClass();
      },
      { once: true },
    );
  } else {
    injectDdaFooterRemovalStyles();
    removeDdaFooters();
    applyDdaSidebarVisibility();
    syncAutoSubmitModeClass();
  }
  window.addEventListener("popstate", () => {
    injectDdaFooterRemovalStyles();
    removeDdaFooters();
    injectStep2FullWidthStyles();
    applyDdaSidebarVisibility();
    compactStep2Header();
    syncAutoSubmitModeClass();
  });
  window.addEventListener("hashchange", () => {
    injectDdaFooterRemovalStyles();
    removeDdaFooters();
    injectStep2FullWidthStyles();
    applyDdaSidebarVisibility();
    compactStep2Header();
    syncAutoSubmitModeClass();
  });

  // Short polling to ensure dynamic DOM render is compacted smoothly and footers stay removed
  let step2CompactTimer = setInterval(() => {
    removeDdaFooters();
    compactStep2Header();
    if (document.querySelector(".dda-compact-location-tag")) {
      clearInterval(step2CompactTimer);
    }
  }, 250);
  setTimeout(() => clearInterval(step2CompactTimer), 10000);

  // 🚪 Intercept DDA Website Applicant Logout clicks
  document.addEventListener(
    "click",
    (e) => {
      try {
        let logoutTarget = e.target?.closest?.(
          "a[href*='logout'], a[href*='Logout'], a[href*='signout'], a[href*='SignOut'], button[class*='logout'], button[id*='logout'], .logout-btn, a[title*='Logout']",
        );
        if (!logoutTarget) {
          const iconOrSpan = e.target?.closest?.(
            "i.fa-sign-out, i.fa-power-off, .fa-sign-out, .fa-power-off",
          );
          if (iconOrSpan) {
            logoutTarget = iconOrSpan.closest("a, button") || iconOrSpan;
          } else {
            const textElem = e.target?.closest?.("a, button");
            if (
              textElem &&
              /^\s*(logout|sign\s*out)\s*$/i.test(textElem.textContent || "")
            ) {
              logoutTarget = textElem;
            }
          }
        }
        if (logoutTarget) {
          console.log(
            "🚪 [DDA Preload] DDA Portal Applicant Logout clicked by user!",
          );
          let pan = (
            currentApplicant?.pan ||
            localStorage.getItem("dda_active_applicant_pan") ||
            localStorage.getItem("dda_selected_person") ||
            ""
          )
            .toUpperCase()
            .trim();
          if (!pan) {
            try {
              const raw = localStorage.getItem("window.__ACTIVE_APPLICANT__");
              if (raw) pan = (JSON.parse(raw)?.pan || "").toUpperCase().trim();
            } catch (_) {}
          }
          ipcRenderer.send("dda:applicant-logout", {
            pan,
            url: window.location.href,
            source: "click",
          });
          if (typeof ipcRenderer.sendToHost === "function") {
            ipcRenderer.sendToHost("dda:applicant-logout", {
              pan,
              url: window.location.href,
              source: "click",
            });
          }
        }
      } catch (err) {
        console.warn("Logout click listener error:", err);
      }
    },
    true,
  );
}

try {
  const currentHref = (
    typeof window !== "undefined" ? window.location.href : ""
  ).toLowerCase();
  if (currentHref.includes("/logout") || currentHref.includes("/signout")) {
    console.log("🚪 [DDA Preload] DDA Portal Logout page loaded:", currentHref);
    let pan = (
      localStorage.getItem("dda_active_applicant_pan") ||
      localStorage.getItem("dda_selected_person") ||
      ""
    )
      .toUpperCase()
      .trim();
    if (!pan) {
      try {
        const raw = localStorage.getItem("window.__ACTIVE_APPLICANT__");
        if (raw) pan = (JSON.parse(raw)?.pan || "").toUpperCase().trim();
      } catch (_) {}
    }
    ipcRenderer.send("dda:applicant-logout", {
      pan,
      url: window.location.href,
      source: "url",
    });
    if (typeof ipcRenderer.sendToHost === "function") {
      ipcRenderer.sendToHost("dda:applicant-logout", {
        pan,
        url: window.location.href,
        source: "url",
      });
    }
  }
} catch (_) {}

// ─────────────────────────────────────────────────────────────────────────────
// FLAT BLACKLIST WITH EXPIRY
// A flat the server just reported as hold/allotted by another applicant is blocked for 30s so
// the engine moves on and secures the next preference without being distracted by a flapping
// flat. After 30s it becomes eligible again (a 15-minute hold may have been released).
// Drop-in replacement for a Set (has/add/delete/clear/size/iterator); persisted per tab so
// page reloads inside the 30s window keep the block.
// ─────────────────────────────────────────────────────────────────────────────
const FLAT_BLACKLIST_TTL_MS = 30 * 1000;
const FLAT_BLACKLIST_STORAGE_KEY = "dda_booked_flats_ttl";
// "Is this the same flat?": DDA and the applicant's preferences may write a ground-floor
// flat as "1" or "01". A label that is only digits is compared without its leading zeros;
// any other label as written (case and spaces ignored). Same rule in src/utils/flatKey.js
// and in the injected search poller (ddaAutomations getFlatHunterCode).
function ddaFlatKey(f) {
  const s = String(f == null ? "" : f).trim().toUpperCase().replace(/\s+/g, "");
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}
if (typeof window !== "undefined") window.__ddaFlatKey = ddaFlatKey;

// DDA's 60-flat-page-requests-a-minute limit (tracked per window in main, flatPageBudget.js):
// ms the Search poller should wait before its next check. 0 if main can't say.
if (typeof window !== "undefined") {
  window.__ddaFlatPageWaitMs = async () => {
    try {
      return Number(await ipcRenderer.invoke("dda:flatPageWait")) || 0;
    } catch (_) {
      return 0;
    }
  };
}

class ExpiringFlatSet {
  constructor() {
    this.map = new Map();
    try {
      // Old format stored permanent entries; drop it so stale permanent blocks never resurface
      sessionStorage.removeItem("dda_booked_flats");
      const raw = sessionStorage.getItem(FLAT_BLACKLIST_STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        const now = Date.now();
        for (const [k, v] of Object.entries(obj || {})) {
          if (Number(v) > now) this.map.set(this._norm(k), Number(v));
        }
      }
    } catch (_) {}
  }
  _norm(f) {
    return ddaFlatKey(f);
  }
  _save() {
    try {
      sessionStorage.setItem(FLAT_BLACKLIST_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.map)));
    } catch (_) {}
  }
  _prune() {
    const now = Date.now();
    let changed = false;
    for (const [k, v] of this.map) {
      if (v <= now) {
        this.map.delete(k);
        changed = true;
      }
    }
    if (changed) this._save();
  }
  has(f) {
    this._prune();
    return this.map.has(this._norm(f));
  }
  add(f, ttlMs = FLAT_BLACKLIST_TTL_MS) {
    const k = this._norm(f);
    if (!k) return this;
    this.map.set(k, Date.now() + ttlMs);
    this._save();
    return this;
  }
  delete(f) {
    const had = this.map.delete(this._norm(f));
    if (had) this._save();
    return had;
  }
  clear() {
    this.map.clear();
    this._save();
  }
  get size() {
    this._prune();
    return this.map.size;
  }
  remainingMs(f) {
    this._prune();
    const v = this.map.get(this._norm(f));
    return v ? Math.max(0, v - Date.now()) : 0;
  }
  keys() {
    this._prune();
    return this.map.keys();
  }
  values() {
    return this.keys();
  }
  forEach(cb) {
    for (const k of this.keys()) cb(k, k, this);
  }
  [Symbol.iterator]() {
    return this.keys();
  }
}

// 🛡️ Defensive DDA Global Stubs & Anti-Crash Guards (Roadmap 5C.7, 5E.7, 5E.8)
if (typeof window !== "undefined") {
  // Only on the DDA portal: on the payment gateway (BillDesk / bank OTP) the
  // user must see error alerts and answer confirms themselves.
  if (window.location?.hostname === "eservices.dda.org.in") {
    window.alert = function () {};
    window.confirm = function () {
      return true;
    };
    window.prompt = function () {
      return null;
    };
  }

  window.get_sector = window.get_sector || function () {};
  window.getpocket = window.getpocket || function () {};
  window.getblock = window.getblock || function () {};
  window.gettower = window.gettower || function () {};
  window.ToggleCheckbox = window.ToggleCheckbox || function () {};
  window.get_district = window.get_district || function () {};
  window.getflatdetails = window.getflatdetails || function () {};

  // 🛡️ Universal stubs for DDA's inline HTML onblur validators (omitted from DDA website scripts)
  window.validateEmailId = window.validateEmailId || function () { return true; };
  window.validateMobileNo = window.validateMobileNo || function () { return true; };
  window.validatePanNo = window.validatePanNo || function () { return true; };
  window.validateAadharcard = window.validateAadharcard || function () { return true; };

  // 🛡️ Comprehensive jQuery & jQuery Validate Anti-Crash Hook (Roadmap 5E.8)
  const sanitizeJQuery = (jq) => {
    if (!jq) return;
    try {
      if (jq.fn) {
        try {
          // Object.defineProperty(window.jQuery.fn, 'jquery', { get: () => '3.5.1' });
          Object.defineProperty(jq.fn, "jquery", {
            get: () => "3.5.1",
            set: () => {},
            configurable: true,
          });
        } catch (_) {
          jq.fn.jquery = "3.5.1";
        }
        if (!jq.fn.datepicker) {
          jq.fn.datepicker = function () {
            return this;
          }; // window.jQuery.fn.datepicker = function () { return this; }
        }
      }
    } catch (_) {}
  };

  // Immediate patch if already loaded
  if (window.jQuery) sanitizeJQuery(window.jQuery);
  if (window.$) sanitizeJQuery(window.$);

  // Synchronous property traps on window to intercept inline jQuery loading at 0ms
  let _rawJQuery = window.jQuery;
  try {
    Object.defineProperty(window, "jQuery", {
      configurable: true,
      enumerable: true,
      get: () => _rawJQuery,
      set: (val) => {
        _rawJQuery = val;
        sanitizeJQuery(_rawJQuery);
        patchJQueryValidate();
      },
    });
  } catch (_) {}

  let _rawDollar = window.$;
  try {
    Object.defineProperty(window, "$", {
      configurable: true,
      enumerable: true,
      get: () => _rawDollar,
      set: (val) => {
        _rawDollar = val;
        sanitizeJQuery(_rawDollar);
        patchJQueryValidate();
      },
    });
  } catch (_) {}

  // Trap and suppress any Bootstrap jQuery version mismatch uncaught error during HTML parsing
  window.addEventListener(
    "error",
    (event) => {
      const errorMsg = event?.message || event?.error?.message || "";
      if (
        errorMsg.includes("Bootstrap's JavaScript requires at least jQuery")
      ) {
        console.warn(
          "🛡️ [DDA Preload] Suppressed Bootstrap jQuery version warning on DDA portal.",
        );
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
    },
    true,
  );

  const patchJQueryValidate = () => {
    try {
      if (
        typeof window.jQuery === "undefined" &&
        typeof _rawJQuery === "undefined"
      )
        return;
      const jq = window.jQuery || _rawJQuery;
      sanitizeJQuery(jq);

      // 1. Never patch $.data(form, "validator"): jQuery Validate itself uses it to decide
      //    whether a validator already exists. Faking it makes DDA's own
      //    $("#applicantForm").validate({ ..., submitHandler }) a no-op, so the manual
      //    Submit button silently does nothing (Autofill OFF).

      // 2. Patch $.fn.rules so DDA's early .rules("add") calls (made before .validate()
      //    exists) cannot throw. It must NEVER create a validator: an options-less
      //    validator created here would swallow DDA's later .validate({ submitHandler }).
      if (jq.fn && (!jq.fn.rules || !jq.fn.rules._ddaPatched)) {
        const origRules = jq.fn.rules;
        jq.fn.rules = function (command, argument) {
          try {
            if (typeof origRules === "function") {
              return origRules.apply(this, arguments);
            }
            return {};
          } catch (_) {
            return {};
          }
        };
        jq.fn.rules._ddaPatched = true;
      }

      if (jq.validator) {
        jq.validator._ddaPatched = true;
      }

      // 3. 🛡️ Defensive $.fn.datepicker stub for DDA /user/getlayout/*
      if (jq.fn && !jq.fn.datepicker) {
        jq.fn.datepicker = function () {
          return this;
        };
      }

      // 4. 🛡️ Guard $.fn.jquery version string so Bootstrap check never throws
      sanitizeJQuery(jq);
    } catch (_) {}
  };

  // Immediate patch attempt
  patchJQueryValidate();

  // Fast poll during initial 5 seconds as DDA dynamically inserts <script src="...jquery.validate.js">
  const jqValidateInterval = setInterval(patchJQueryValidate, 15);
  setTimeout(() => clearInterval(jqValidateInterval), 5000);

  // Cross-navigation blacklist of flats reported hold/allotted (expires after 30s)
  if (!window.__ddaBookedFlatsSet) {
    window.__ddaBookedFlatsSet = new ExpiringFlatSet();
  }

  function blacklistFlat(flatNo) {
    if (!flatNo) return;
    const clean = String(flatNo).trim().toUpperCase();
    if (!clean) return;
    if (!window.__ddaBookedFlatsSet) window.__ddaBookedFlatsSet = new ExpiringFlatSet();
    window.__ddaBookedFlatsSet.add(clean);
    try {
      appendRunLog(
        "🚫 Flat " + clean + " blacklisted for " + Math.round(FLAT_BLACKLIST_TTL_MS / 1000) + "s (reported hold/allotted by another applicant)",
        "Direct",
      );
    } catch (_) {}
  }
  window.__ddaBlacklistFlat = blacklistFlat;

  // 🛡️ Global Defensive Stubs for DDA's inline onblur HTML attributes
  if (typeof window !== "undefined") {
    if (!window.validatePanNo) window.validatePanNo = function () { return true; };
    if (!window.validateEmailId) window.validateEmailId = function () { return true; };
    if (!window.validateMobileNo) window.validateMobileNo = function () { return true; };
    if (!window.validateAadharcard) window.validateAadharcard = function () { return true; };
  }
}

function runWhenReady(fn) {
  if (
    document.readyState === "interactive" ||
    document.readyState === "complete"
  ) {
    fn();
  } else {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  }
}

// Fetch active applicant profile and settings immediately from Main process
async function initSessionData() {
  try {
    const webviewContext = await ipcRenderer
      .invoke("session:getWebviewContext")
      .catch(() => null);
    currentApplicant = webviewContext?.applicant || null;
    currentSettings = webviewContext?.settings || null;
    try {
      localStorage.removeItem("dda_fast_payment_card");
      sessionStorage.removeItem("dda_fast_payment_card");
    } catch (_) {}

    // Robust local storage / window context resolution for embedded webview context
    if (!currentApplicant || !currentApplicant.personal) {
      try {
        if (typeof window !== "undefined" && window.__ACTIVE_APPLICANT__) {
          currentApplicant = window.__ACTIVE_APPLICANT__;
        }
      } catch (_) {}

      if (!currentApplicant || !currentApplicant.personal) {
        try {
          const rawApp = localStorage.getItem("window.__ACTIVE_APPLICANT__");
          if (rawApp) currentApplicant = JSON.parse(rawApp);
        } catch (_) {}
      }

      if (!currentApplicant || !currentApplicant.personal) {
        try {
          if (isLoginPageUrl()) {
            const rawLoginApp = localStorage.getItem(
              "window.__DDA_LOGIN_APPLICANT__",
            );
            if (rawLoginApp) {
              currentApplicant = JSON.parse(rawLoginApp);
            } else {
              const rawLoginPan =
                localStorage.getItem("dda_selected_login_pan") ||
                localStorage.getItem("dda_last_selected_login_pan") ||
                localStorage.getItem("dda_last_logged_in_pan");
              const rawData = localStorage.getItem("ddaData");
              if (rawData && rawLoginPan) {
                const parsed = JSON.parse(rawData);
                if (parsed?.applicants && parsed.applicants[rawLoginPan]) {
                  currentApplicant = parsed.applicants[rawLoginPan];
                }
              }
            }
          }
          if (!currentApplicant || !currentApplicant.personal) {
            const rawPerson =
              localStorage.getItem("dda_selected_person") ||
              localStorage.getItem("dda_active_applicant_pan");
            const rawData = localStorage.getItem("ddaData");
            if (rawData && rawPerson) {
              const parsed = JSON.parse(rawData);
              if (parsed?.applicants && parsed.applicants[rawPerson]) {
                currentApplicant = parsed.applicants[rawPerson];
              }
            }
          }
        } catch (_) {}
      }
    }

    if (!currentSettings || typeof currentSettings !== "object") {
      try {
        const raw = localStorage.getItem("dda_settings");
        if (raw) currentSettings = JSON.parse(raw);
        else
          currentSettings = {
            automationEnabled: true,
            captchaAutoSolveEnabled: true,
            loginCaptchaAutoSolveEnabled: true,
            captchaAutoSubmitEnabled: true,
          };
      } catch (_) {
        currentSettings = {
          automationEnabled: true,
          captchaAutoSolveEnabled: true,
          loginCaptchaAutoSolveEnabled: true,
          captchaAutoSubmitEnabled: true,
        };
      }
    }

    try {
      delete window.__ddaDirectFlatUrl;
      localStorage.removeItem("dda_direct_flat_url");
      localStorage.removeItem("automationEnabled");
    } catch (_) {}

    console.log(
      "👤 [DDA Electron Session] Active Applicant:",
      currentApplicant?.personal?.firstName || "(None selected)",
      currentApplicant?.pan || "(No PAN)",
    );

    // Session initialized cleanly

    ipcRenderer.on("session:applicantUpdated", (_e, newApp) => {
      if (newApp && (newApp.pan || newApp.personal?.pan)) {
        currentApplicant = newApp;
        try {
          window.__ACTIVE_APPLICANT__ = newApp;
          delete window.__ddaDirectFlatUrl;
          localStorage.removeItem("dda_direct_flat_url");
          localStorage.removeItem("dda_locality_hashes");
          localStorage.setItem(
            "window.__ACTIVE_APPLICANT__",
            JSON.stringify(newApp),
          );
          const cleanPan = (newApp.pan || newApp.personal?.pan || "")
            .toUpperCase()
            .trim();
          if (cleanPan) {
            localStorage.setItem("dda_selected_person", cleanPan);
            localStorage.setItem("dda_active_applicant_pan", cleanPan);
          }
        } catch (_) {}
        if (typeof window.__ddaRefillLoginCredentials === "function") {
          window.__ddaRefillLoginCredentials(newApp);
        }
        if (typeof window.__ddaOnApplicantUpdated === "function") {
          try {
            window.__ddaOnApplicantUpdated(newApp);
          } catch (_) {}
        }
      } else {
        currentApplicant = null;
        try {
          delete window.__ACTIVE_APPLICANT__;
          delete window.__ddaDirectFlatUrl;
          localStorage.removeItem("dda_direct_flat_url");
          localStorage.removeItem("dda_locality_hashes");
          localStorage.removeItem("window.__ACTIVE_APPLICANT__");
          localStorage.removeItem("dda_selected_person");
          localStorage.removeItem("dda_active_applicant_pan");
        } catch (_) {}
      }
    });

    ipcRenderer.on("session:settingsUpdated", (_e, newSettings) => {
      if (!newSettings) return;
      currentSettings = { ...currentSettings, ...newSettings };
      try {
        localStorage.setItem("dda_settings", JSON.stringify(currentSettings));
        localStorage.removeItem("automationEnabled");
        localStorage.setItem(
          "captchaAutoSubmitEnabled",
          String(currentSettings.captchaAutoSubmitEnabled !== false),
        );
        localStorage.setItem(
          "captchaAutoSolveEnabled",
          String(currentSettings.captchaAutoSolveEnabled !== false),
        );
        localStorage.setItem(
          "directUrlJumpEnabled",
          String(currentSettings.directUrlJumpEnabled !== false),
        );
        localStorage.setItem(
          "dda_direct_url_jump_enabled",
          String(currentSettings.directUrlJumpEnabled !== false),
        );
      } catch (_) {}
      syncAutoSubmitModeClass();
      if (currentSettings.automationEnabled === false) {
        stopAllAutomation();
      } else {
        isAutomationRunning = true;
      }
    });

    try {
      window.addEventListener("dda:stop-automation", () => {
        stopAllAutomation();
      });
      window.addEventListener("dda:settings-updated", (e) => {
        const newSettings = e?.detail;
        if (newSettings) {
          currentSettings = { ...currentSettings, ...newSettings };
          try {
            localStorage.setItem(
              "dda_settings",
              JSON.stringify(currentSettings),
            );
            localStorage.removeItem("automationEnabled");
            localStorage.setItem(
              "directUrlJumpEnabled",
              String(currentSettings.directUrlJumpEnabled !== false),
            );
            localStorage.setItem(
              "dda_direct_url_jump_enabled",
              String(currentSettings.directUrlJumpEnabled !== false),
            );
          } catch (_) {}
          syncAutoSubmitModeClass();
          if (currentSettings.automationEnabled === false) {
            stopAllAutomation();
          } else {
            isAutomationRunning = true;
          }
        }
      });
    } catch (_) {}

    try {
      window.addEventListener("dda:set-applicant", (e) => {
        const newApp = e?.detail;
        if (newApp && (newApp.pan || newApp.personal?.pan)) {
          currentApplicant = newApp;
          try {
            window.__ACTIVE_APPLICANT__ = newApp;
            delete window.__ddaDirectFlatUrl;
            localStorage.removeItem("dda_direct_flat_url");
            localStorage.removeItem("dda_locality_hashes");
            localStorage.setItem(
              "window.__ACTIVE_APPLICANT__",
              JSON.stringify(newApp),
            );
            const cleanPan = (newApp.pan || newApp.personal?.pan || "")
              .toUpperCase()
              .trim();
            if (cleanPan) {
              localStorage.setItem("dda_selected_person", cleanPan);
              localStorage.setItem("dda_active_applicant_pan", cleanPan);
            }
          } catch (_) {}
          if (typeof window.__ddaOnApplicantUpdated === "function") {
            try {
              window.__ddaOnApplicantUpdated(newApp);
            } catch (_) {}
          }
        }
      });
    } catch (_) {}

    startAutomation();
  } catch (err) {
    console.error("Session init error:", err);
  }
}

function startAutomation() {
  const url = window.location.href.toLowerCase();
  const isLogin = isLoginPageUrl();

  // 1. Zoom Styling: strictly native scale (reset if previously modified)
  try {
    runWhenReady(() => {
      if (
        document.body &&
        document.body.style.zoom &&
        document.body.style.zoom !== "" &&
        document.body.style.zoom !== "1" &&
        document.body.style.zoom !== "1.0"
      ) {
        document.body.style.zoom = "";
      }
    });
  } catch (_) {}

  // 2. Login Page Autofill & Captcha - Always active on login page independent of post-login automation toggles
  if (isLogin) {
    stopSessionHeartbeat("On login page");
    clearDdaAccountPan(); // logged out: the next login decides the account
    handleLoginPage();
    setupCaptchaEngine();
    startReloginAutoSubmit();
    installLoginServerErrorRetry();
    return;
  }

  // ─── SMART AUTHENTICATED USER DETECTION ON EVERY POST-LOGIN PAGE ───
  // Must run on all authenticated pages regardless of whether auto-hunting is toggled on or off!
  try {
    emitAuthenticatedPanIfPresent();
  } catch (_) {}
  // The sidebar follows the DDA account (also after an app restart, when DDA
  // keeps the tab logged in and no login happens). Every page that knows the
  // account says so, so the sidebar shows it confirmed; only the schemes page
  // asks for a switch when the sidebar shows someone else.
  try {
    const accountPan = getDdaAccountPan();
    if (accountPan) {
      const differs = applicantPanOf(currentApplicant) !== accountPan;
      if (differs && isStrictlySchemesPage() && !differentApplicantAllowed()) reportDdaAccount(accountPan);
      else reportDdaAccount(accountPan, { confirmOnly: true });
    }
  } catch (_) {}

  // ─── SESSION HEARTBEAT ON SCHEMES PAGE ───
  // Strictly attached to Schemes page: MUST run ONLY on Schemes page and nowhere else!
  if (isStrictlySchemesPage()) {
    startSessionHeartbeat();
  } else {
    stopSessionHeartbeat("Not on Schemes page");
  }

  // ─── APPLICATION FORM DOM COMPATIBILITY & FORM SUBMISSION GUARD ───
  // Guaranteed to run on every Application Form load, REGARDLESS of whether Autofill is ON or OFF.
  // Fixes DDA's invalid formnovalidate attribute and strips required from hidden fields
  // so manual users can fill and submit the application form without Chromium validation crashes.
  if (
    !url.includes("myapplication") &&
    (url.includes("applicationform") ||
      url.includes("applicationfrom") ||
      url.includes("userapplication") ||
      url.includes("applicantdetails"))
  ) {
    setupApplicationFormCompatibility();
  }

  const isAutomationEnabled = currentSettings?.automationEnabled !== false;
  isAutomationRunning = isAutomationEnabled;

  if (!isAutomationEnabled) {
    console.log(
      "⏸️ [DDA Electron] Automation is turned OFF in settings. Standing by.",
    );
    // Still run global safety and timer watcher for payment hold info & alerts
    setupGlobalSafetyAndTimerWatcher();
    return;
  }

  // 3. Scheme List Selection
  if (url.includes("schemelist")) {
    try {
      delete window.__ddaResolvingDirectUrl;
    } catch (_) {}
    handleSchemeListPage();
  }

  // 4. Locality Selection (Step 1)
  if (url.includes("step1_form")) {
    handleLocalityPage();
  }

  // 5. Step 2 Flat Select & Reservation
  if (url.includes("step2_form")) {
    // DDA's 5xx error page and its 429 "Too Many Requests" page are not the flat page: no scan,
    // no "loaded" milestone, nothing cleared. The dashboard starts Multi-Reload for them
    // (Workspace "Flat page arriving as...").
    if (ddaNavStatus() >= 500 || ddaNavStatus() === 429) {
      console.log(`[DDA Electron] Flat page answered HTTP ${ddaNavStatus()} — skipping flat-page handling`);
    } else {
      handleStep2FlatPage();
    }
  }

  // 6. Application Form
  if (
    !url.includes("myapplication") &&
    (url.includes("applicationform") ||
      url.includes("applicationfrom") ||
      url.includes("userapplication"))
  ) {
    // DDA's 5xx error page and its 429 "Too Many Requests" page are not a form: no fill, no
    // link build, no "loaded" milestone. The error check reloads the form instead.
    if (ddaNavStatus() >= 500 || ddaNavStatus() === 429) {
      console.log(`[DDA Electron] Application form answered HTTP ${ddaNavStatus()} — skipping form handling`);
    } else {
      handleApplicationFormPage();
    }
  }

  // 7. Payment Hold & Fast Payment Engine
  if (
    url.includes("getlayout") ||
    url.includes("payment") ||
    url.includes("challan") ||
    url.includes("billdesk")
  ) {
    handleFastPaymentEngine();
  }

  // 8. Global 15-min Payment Timer Auto-Confirm & Alert Stubs
  setupGlobalSafetyAndTimerWatcher();

  // 9. High-Speed Native C++ ONNX Captcha Auto-Solver Engine
  setupCaptchaEngine();
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTCHA LIFECYCLE & RELIABILITY ENGINE (PHASE 2: 100% PARITY WITH EXTENSION)
// ─────────────────────────────────────────────────────────────────────────────

// Universal selector patterns for Captcha inputs & images across all DDA screens
const CAPTCHA_INPUT_SELECTORS = [
  'input[name="captcha"]',
  "input#captcha",
  'input[name="user_captcha"]',
  "input#txtCaptcha",
  'input[placeholder*="captcha" i]',
  'input[name="captcha_code"]',
  "input#captcha_code",
  ".captchblock input",
  ".captcharow input",
  ".captcha input",
  "input.numbersonly",
].join(", ");

const CAPTCHA_IMAGE_SELECTORS = [
  "img#captchaimg",
  "img#captcha_img",
  "img#captcha_image",
  "img#imgCaptcha",
  '.modal.show img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
  '#myModal.show img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
  '#myModal img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
  '.modal img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
  'img[id*="captcha" i]:not([id*="reload" i]):not([id*="refresh" i])',
  'img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
  '.captchblock img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
  '.captcharow img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
  '.captcha img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
].join(", ");

let solveInProgress = false;
let currentCaptchaGen = 0;
let lastSolvedCaptchaSrc = null;
let captchaRetryCount = 0; // Attempt 1 fails -> 1, Attempt 2 fails -> 2, Attempt 3 fails -> Halt (3 total attempts)
const MAX_CAPTCHA_RETRIES = 2; // Allows 2 retries (3 total attempts) on step2_form
let lastAlertHandledAt = 0; // Timestamp debounce for server error alerts
// Login page: new captchas asked from DDA when the image fails, is too slow, or can't be read
const LOGIN_CAPTCHA_MAX_REFRESHES = 3;
// The n-th new captcha comes at least this long after the failing image appeared (1st) or
// after the previous new captcha: DDA's HTTP 500s come in bursts (20 Oct: up to a minute),
// and three refreshes in quick succession all landed inside one burst
const LOGIN_CAPTCHA_REFRESH_GAPS_MS = [5000, 10000, 20000];
let loginCaptchaRefreshes = 0;
let loginCaptchaLastRefreshAt = 0;
let loginCaptchaUnreadableSrc = ""; // a loaded image the solver could not read
let loginCaptchaUnreadableReason = "";
let loginCaptchaGaveUp = false;
let loginCaptchaUserTyped = false;
let loginCaptchaWatch = { src: null, since: 0 }; // the image being waited for, and since when
let loginCaptchaRefreshPendingUntil = 0;
let step2PreSolvedResult = null; // JIT background pre-solve cache: { src, data, base64Image, timestamp }
let step2PreSolveInProgress = false;

function getCaptchaSrc(img) {
  if (!img) return "";
  return (img.currentSrc || img.src || img.getAttribute("src") || "").trim();
}

function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return (rect.width > 0 && rect.height > 0) || el.offsetParent !== null;
}

function isFlatReservationModalOpen() {
  const modal = document.querySelector("#myModal, #flatDetailModal, .modal");
  if (!modal) return false;
  if (typeof window.getComputedStyle === "function") {
    const style = window.getComputedStyle(modal);
    if (style.display === "none" || style.visibility === "hidden") return false;
  } else if (
    modal.style &&
    (modal.style.display === "none" || modal.style.visibility === "hidden")
  ) {
    return false;
  }
  return !!(
    modal.classList.contains("show") ||
    modal.classList.contains("in") ||
    (modal.style && modal.style.display === "block") ||
    (modal.offsetWidth > 0 && modal.offsetHeight > 0)
  );
}

// DDA's login page only. Payment gateways have their own "login" pages
// (SBI: merchantprelogin.htm, merchantpreloginbanking.htm); treating those as
// DDA's login skipped the Fast Payment engine there and ran DDA's credential
// autofill on the bank's page.
function isDdaHost() {
  return (window.location?.hostname || "").toLowerCase() === "eservices.dda.org.in";
}

function isLoginPageUrl() {
  if (!isDdaHost()) return false;
  const url = window.location.href.toLowerCase();
  return (
    url.includes("login") ||
    url.endsWith("/user") ||
    url.endsWith("/user/") ||
    !!document.querySelector("form#userloginform, button#loginbtn")
  );
}

function isStep2FormUrl() {
  return (
    window.location.href.toLowerCase().includes("step2_form") ||
    window.location.pathname.includes("step2_form") ||
    !!document.querySelector(".building, #dda-panel, #dda-auto-hunt-btn")
  );
}

function isUserLoggedIn() {
  if (isLoginPageUrl()) return false;
  return !!(
    document.querySelector(
      "a[href*='logout'], a[href*='signout'], .user-profile, .user-name, #applicantForm, .building, #myModal",
    ) ||
    window.location.href.toLowerCase().includes("schemelist") ||
    window.location.href.toLowerCase().includes("step1_form") ||
    window.location.href.toLowerCase().includes("step2_form") ||
    window.location.href.toLowerCase().includes("applicationform") ||
    window.location.href.toLowerCase().includes("applicationfrom") ||
    window.location.href.toLowerCase().includes("getlayout")
  );
}

function isSessionRunningPopupPresent() {
  const popups = document.querySelectorAll(
    ".swal2-popup.swal2-show, .swal-modal",
  );
  for (const p of popups) {
    const text = (p.textContent || "").toLowerCase();
    if (
      text.includes("your previous session is already running")
    ) {
      return true;
    }
  }
  return false;
}

// DDA's flat-page captcha has always been a 120×36 "NN + N" image that the model reads at ~100%
// (lowest seen on real captchas: 76.6%). One that doesn't fit means DDA changed its captcha and
// the app can't read it: the reservation then goes straight to DDA's popup for the user to type.
const USUAL_CAPTCHA_W = 120;
const USUAL_CAPTCHA_H = 36;
const MIN_CAPTCHA_CONFIDENCE = 0.6;
// Why this captcha looks like a different kind ("" = it looks like DDA's usual one).
// solve: the captcha:solveLocal response, or undefined to check the image only.
function captchaDifference(img, solve) {
  try {
    const w = img?.naturalWidth || 0;
    const h = img?.naturalHeight || 0;
    if (w && h && (w !== USUAL_CAPTCHA_W || h !== USUAL_CAPTCHA_H)) {
      return `the image is ${w}×${h}, DDA's usual captcha is ${USUAL_CAPTCHA_W}×${USUAL_CAPTCHA_H}`;
    }
    if (solve !== undefined) {
      if (!solve?.success || solve?.data?.numericAnswer == null) return "the app could not read it";
      const c = solve.data.confidence;
      if (typeof c === "number" && c < MIN_CAPTCHA_CONFIDENCE) {
        return `the app read it at only ${(c * 100).toFixed(0)}% confidence`;
      }
    }
  } catch (_) {}
  return "";
}

// Remembered for this flat page (window, so the next page load starts fresh); warned once.
function noteCaptchaLooksDifferent(reason) {
  if (!reason || window.__ddaCaptchaLooksDifferent) return;
  window.__ddaCaptchaLooksDifferent = reason;
  const msg = `⚠️ The flat-page captcha looks different from DDA's usual one (${reason}). When a flat is reserved, the app will open DDA's popup for you to type the captcha.`;
  appendRunLog(msg, "WARN");
  try {
    const log = { level: "WARN", page: "Flat Select", msg, pan: currentApplicant?.pan };
    if (typeof ipcRenderer.sendToHost === "function") ipcRenderer.sendToHost("dda:log", log);
  } catch (_) {}
}

/**
 * JIT Background Captcha Pre-Solving (Roadmap 6.12, 5D.11)
 * Solves captcha image in background the moment flat is selected,
 * enabling 0ms perceived latency if captcha image is reused or cached.
 */
async function preSolveStep2Captcha(img) {
  if (!img || step2PreSolveInProgress || solveInProgress) return;
  if (!isCaptchaReadyForSolve(img)) return;
  const src = getCaptchaSrc(img);
  if (!src) return;

  step2PreSolveInProgress = true;
  const ocrStart = Date.now();
  try {
    const { floatArray, base64Image } = await extractCaptchaTensor(img);
    const response = await ipcRenderer.invoke("captcha:solveLocal", {
      floatArray: Array.from(floatArray),
      base64Image,
      pan: currentApplicant?.pan,
    });

    // Early warning: this page's captcha is not the kind the app reads
    noteCaptchaLooksDifferent(captchaDifference(img, response));

    if (response?.success && response?.data) {
      const ocrDuration = Date.now() - ocrStart;
      step2PreSolvedResult = {
        src,
        data: response.data,
        base64Image,
        timestamp: Date.now(),
        durationMs: ocrDuration,
      };
      lastSolvedCaptchaAnswer = response.data.numericAnswer;
      lastSolvedCaptchaSrc = src;
      console.log(
        `⚡ [DDA Pre-Solve] JIT pre-solved result ready: ${response.data.numericAnswer}`,
      );

      // Record pre-solve attempt immediately so telemetry always captures it
      recordCaptchaAttempt({
        base64Image,
        rawText: response.data.rawText || `${response.data.numericAnswer}`,
        answer: String(response.data.answer || response.data.numericAnswer),
        numericAnswer: response.data.numericAnswer,
        durationMs: ocrDuration,
        status: "PRE_SOLVED",
        statusDetail: `Pre-solved locally via native ONNX in ${ocrDuration}ms`,
        model: response.data.model || "native-onnx-node-v1",
        confidence: response.data.confidence ?? null,
      });

      // Dispatch IPC to host and main process
      try {
        const solvedPayload = {
          text: response.data.numericAnswer,
          rawText: response.data.rawText || `${response.data.numericAnswer}`,
          dataUrl: base64Image,
          page: "Step 2 Flats",
          pan: currentApplicant?.pan,
          durationMs: ocrDuration,
        };
        ipcRenderer.send("dda:captcha-solved", solvedPayload);
        if (typeof ipcRenderer.sendToHost === "function") {
          ipcRenderer.sendToHost("dda:captcha-solved", solvedPayload);
        }
      } catch (_) {}

      // If reservation modal is already open and .captchblock revealed, immediately fill
      const captchBlock = document.querySelector(".captchblock");
      if (
        captchBlock &&
        window.getComputedStyle(captchBlock).display !== "none"
      ) {
        fillCaptchaInput(response.data.numericAnswer);
      }
    }
  } catch (err) {
    console.warn("⚠️ [DDA Pre-Solve] Pre-solve notice:", err);
  } finally {
    step2PreSolveInProgress = false;
  }
}

/**
 * Captcha Readiness State Machine (Roadmap 6.7, 6.13)
 * Comprehensive state check ensuring DOM visibility, loaded network bytes,
 * authenticated session, open modal, and absence of race conditions with #submitareabtn.
 */
function isCaptchaReadyForSolve(img) {
  if (!img || solveInProgress) return false;
  if (isSessionRunningPopupPresent()) return false;

  // Session context validation
  if (!isLoginPageUrl() && !isUserLoggedIn()) return false;

  // 🛡️ ZERO-DELAY STEP 2 BACKGROUND CAPTCHA READINESS:
  // 1. Flat reservation modal exists in DOM (background DOM ready).
  // 2. Initial hold button #submitareabtn is not waiting to be triggered.
  // 3. Captcha input #captcha and #captchabutton exist in modal DOM.
  if (isStep2FormUrl()) {
    if (!isFlatReservationModalOpen()) return false;
    const modal = document.querySelector("#myModal, #flatDetailModal, .modal");
    if (!modal) return false;

    // Check if initial hold button is still waiting to be clicked
    const reserveHoldBtn = modal.querySelector(
      '#submitareabtn, .reserve, button[class*="reserve"]:not(#captchabutton)',
    );
    if (
      reserveHoldBtn &&
      !reserveHoldBtn.dataset.ddaAutoClicked &&
      isElementVisible(reserveHoldBtn)
    ) {
      return false; // Waiting for reserve hold click
    }

    // Check if .captchblock row is hidden (DDA reveals this only after clicking .reserve)
    const captchBlock = modal.querySelector(".captchblock");
    if (captchBlock) {
      if (typeof window.getComputedStyle === "function") {
        const blockStyle = window.getComputedStyle(captchBlock);
        if (
          blockStyle.display === "none" ||
          blockStyle.visibility === "hidden"
        ) {
          return false;
        }
      } else if (
        captchBlock.style &&
        (captchBlock.style.display === "none" ||
          captchBlock.style.visibility === "hidden")
      ) {
        return false;
      }
    }

    // Modal must contain the captcha input
    const captchaInput = modal.querySelector(CAPTCHA_INPUT_SELECTORS);
    if (!captchaInput) {
      return false;
    }

    // Modal must contain the actual submission button for the captcha
    const captchaSubmitBtn = modal.querySelector(
      '#captchabutton, button.capreserve, input.capreserve, input#captchabutton, button[type="submit"]',
    );
    if (!captchaSubmitBtn) {
      return false;
    }
  }

  // Ensure image element is loaded with valid dimensions
  if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return false;
  }

  const src = getCaptchaSrc(img);
  if (!src || src.startsWith("data:image/svg") || src.length < 10) return false;

  // 🛡️ ANTI-DUMMY/RELOAD GUARD: Reject refresh/reload button icons by keyword or parent button
  const srcLower = src.toLowerCase();
  const altLower = (img.alt || "").toLowerCase();
  const classLower = (img.className || "").toLowerCase();
  const idLower = (img.id || "").toLowerCase();
  const isInsideReloadBtn = !!(
    img.closest &&
    img.closest(
      'a[onclick*="refresh" i], a[onclick*="reload" i], a[class*="reload" i], a[class*="refresh" i], button, .reload, .refresh',
    )
  );

  if (
    srcLower.includes("reload") ||
    srcLower.includes("refresh") ||
    altLower.includes("reload") ||
    altLower.includes("refresh") ||
    classLower.includes("reload") ||
    classLower.includes("refresh") ||
    idLower.includes("reload") ||
    idLower.includes("refresh") ||
    isInsideReloadBtn
  ) {
    return false;
  }

  // 🛡️ GEOMETRIC ASPECT RATIO GUARD:
  // Real DDA math captchas are wide rectangular formula banners (aspect ratio ~2.5 to 5.0, width >= 60, height >= 18).
  // Reload icons are square/circular (aspect ratio ~1.0, e.g. 20x20, 24x24, 32x32).
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const aspectRatio = width / height;
  if (width < 60 || height < 18 || aspectRatio < 1.8) {
    return false;
  }

  return true;
}

/**
 * Robust Captcha Input Injector
 * Injects solved answer into all matching captcha inputs, applies visual status styling,
 * dispatches DOM events, syncs with jQuery $(...).val(), and re-verifies at 50ms and 150ms.
 */
function fillCaptchaInput(numericAnswer) {
  if (numericAnswer === undefined || numericAnswer === null) return;
  // The flat popup after failed direct tries is for the user to type in.
  if (window.__ddaManualCaptchaFlat && !isLoginPageUrl()) return;
  const strVal = String(numericAnswer).trim();
  const fillToken = ++currentFillToken;

  const applyFill = () => {
    if (fillToken !== currentFillToken || lastSolvedCaptchaAnswer === null)
      return;
    const inputs = document.querySelectorAll(CAPTCHA_INPUT_SELECTORS);
    for (const input of inputs) {
      if (input.type === "text" || input.type === "number" || !input.type) {
        // Native property descriptor setter ensures direct DOM update bypassing any framework interception
        try {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(input, strVal);
          } else {
            input.value = strVal;
          }
        } catch (_) {
          input.value = strVal;
        }

        const currentUrl = (window.location.href || "").toLowerCase();
        const isLogin =
          currentUrl.includes("login") ||
          currentUrl.endsWith("/user") ||
          currentUrl.endsWith("/user/");

        if (!isLogin) {
          input.style.border = "3px solid #10b981";
          input.style.boxShadow = "0 0 12px rgba(16, 185, 129, 0.6)";
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    }

    // Direct jQuery integration if loaded in page context
    try {
      if (typeof window.$ === "function") {
        window
          .$(CAPTCHA_INPUT_SELECTORS)
          .val(strVal)
          .trigger("input")
          .trigger("change");
      } else if (typeof window.jQuery === "function") {
        window
          .jQuery(CAPTCHA_INPUT_SELECTORS)
          .val(strVal)
          .trigger("input")
          .trigger("change");
      }
    } catch (_) {}
  };

  applyFill();
  // Micro-settle re-verifications to defeat DDA's $(document).on('click', '.reserve', () => $('#captcha').val(''))
  setTimeout(applyFill, 30);
  setTimeout(applyFill, 80);
  setTimeout(applyFill, 150);
  setTimeout(applyFill, 300);
  setTimeout(applyFill, 600);
}

/**
 * Extract native 1:1 resolution Base64 image for telemetry & solver
 */
async function captureCaptchaImage(img) {
  const width = img.naturalWidth || img.width || 120;
  const height = img.naturalHeight || img.height || 36;

  const cvs = document.createElement("canvas");
  cvs.width = width;
  cvs.height = height;

  const ctx = cvs.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    ctx.drawImage(img, 0, 0, width, height);
  }

  return {
    base64Image: cvs.toDataURL("image/png"),
    width,
    height,
  };
}

// How long a captcha image may take to arrive. On 20 Oct DDA took 1-30 s per
// image under load, some up to 53 s; giving up after 300 ms ended ~60
// reservation attempts while the image was still on its way, and 15 s still
// dropped images that were about to land.
const CAPTCHA_IMG_WAIT_MS = 30000;
// How long DDA may take to answer GET /user/refresh_captcha (a small HTML snippet; the
// image it names then gets CAPTCHA_IMG_WAIT_MS). A hung answer used to stall the flat
// reservation, which awaits it.
const REFRESH_CAPTCHA_TIMEOUT_MS = 15000;

/**
 * Extract Float32Array tensor directly from HTMLImageElement via 120x36 canvas.
 * Zero Base64 encoding/decoding overhead in fast path (< 2ms execution).
 */
async function extractCaptchaTensor(img) {
  // complete with no size = the image failed: no point waiting for it
  if (!img.complete) {
    await new Promise((resolve) => {
      if (img.complete) return resolve();
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, CAPTCHA_IMG_WAIT_MS);
    });
  }

  if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    throw new Error("Captcha image not loaded or zero dimensions");
  }

  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const aspectRatio = width / height;
  if (width < 60 || height < 18 || aspectRatio < 1.8) {
    throw new Error(
      `Rejected non-captcha icon with invalid dimensions (${width}x${height}, ratio ${aspectRatio.toFixed(2)})`,
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 36;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not acquire 2D canvas context for captcha");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, 120, 36);

  const imgData = ctx.getImageData(0, 0, 120, 36);
  const data = imgData.data;
  const floatArray = new Float32Array(1 * 1 * 36 * 120);

  let nonZeroPixels = 0;
  for (let i = 0; i < 36 * 120; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    if (a > 10 && (r > 10 || g > 10 || b > 10)) {
      nonZeroPixels++;
    }
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    floatArray[i] = (gray / 255.0 - 0.5) / 0.5;
  }

  // 🛡️ ANTI-27 GUARD: If canvas is blank/unrendered (fewer than 50 non-zero pixels), reject
  if (nonZeroPixels < 50) {
    throw new Error(
      `Captcha canvas is blank or unrendered (${nonZeroPixels} non-zero pixels), aborting extraction to prevent false predictions`,
    );
  }

  let base64Image = "";
  try {
    base64Image = canvas.toDataURL("image/png");
  } catch (_) {}

  return { floatArray, base64Image };
}

/**
 * Captcha Attempt Telemetry Recording (Roadmap 6.10)
 */
// ─── Flat-page captcha diagnostics ───
// DDA keeps one valid captcha per session; loading any new captcha image
// replaces it. These read what the page already has (resource timing), never
// load anything, so "Invalid captcha code" on a correct answer can be traced
// to its cause: an old page captcha, a cached image, or a later captcha load.
const STALE_PAGE_CAPTCHA_MS = 45000;
const PAGE_CAPTCHA_SELECTOR =
  'img#captchaimg, img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])';

function describePageCaptcha() {
  const img = document.querySelector(PAGE_CAPTCHA_SELECTOR);
  const src = String(img?.currentSrc || img?.src || "");
  let entry = null;
  let captchaLoads = 0;
  try {
    if (src) entry = performance.getEntriesByName(src).slice(-1)[0] || null;
    captchaLoads = performance
      .getEntriesByType("resource")
      .filter((e) => /\/captcha\//i.test(e.name)).length;
  } catch (_) {}
  // Without a timing entry (still loading / not recorded), age from page start.
  const loadedAt = performance.timeOrigin + (entry ? entry.responseEnd : 0);
  return {
    src: src.replace(/^https?:\/\/[^/]+/, "") || "(none)",
    ageMs: Math.max(0, Math.round(Date.now() - loadedAt)),
    fromCache: entry ? entry.transferSize === 0 && entry.decodedBodySize > 0 : null,
    loaded: !!img?.complete && (img?.naturalWidth || 0) > 0,
    captchaLoads,
  };
}

function traceCaptcha(msg) {
  try {
    ipcRenderer.send("captcha:trace", String(msg).slice(0, 400));
  } catch (_) {}
}

// ", 99.3% confidence" for log lines; "" when the solver gave none.
function formatCaptchaConfidence(c) {
  return typeof c === "number" && isFinite(c) ? `, ${(c * 100).toFixed(1)}% confidence` : "";
}

function recordCaptchaAttempt(data) {
  try {
    let list = [];
    try {
      list = JSON.parse(
        localStorage.getItem("dda_captcha_attempts") ||
          sessionStorage.getItem("dda_captcha_attempts") ||
          "[]",
      );
    } catch (_) {
      list = [];
    }

    const currentPan = (
      data.pan ||
      currentApplicant?.pan ||
      currentApplicant?.personal?.pan ||
      sessionStorage.getItem("dda_authenticated_pan") ||
      localStorage.getItem("dda_authenticated_pan") ||
      sessionStorage.getItem("dda_selected_person") ||
      localStorage.getItem("dda_selected_person") ||
      sessionStorage.getItem("dda_active_applicant_pan") ||
      localStorage.getItem("dda_active_applicant_pan") ||
      (typeof window !== "undefined" && window.__ACTIVE_APPLICANT__?.pan) ||
      ""
    )
      .toUpperCase()
      .trim();

    const now = Date.now();
    const ts = data.timestamp || now;
    const isAnomaly =
      data.status === "ANOMALY" ||
      (data.confidence !== undefined &&
        data.confidence !== null &&
        data.confidence < 0.85);

    const incomingStatus = isAnomaly ? "ANOMALY" : data.status || "SOLVED";

    // Check if the last attempt is the same ongoing captcha session
    // that should be updated in-place rather than duplicated (PRE_SOLVED -> SOLVED -> SUBMITTED)
    let shouldUpdateLast = false;
    if (list.length > 0) {
      const last = list[list.length - 1];
      const isTerminalFailure =
        last.status === "SERVER_REJECTED" || last.status === "FAILED" || last.status === "NO_RESPONSE";

      // If the previous attempt was rejected by server or failed, keep it intact for audit!
      // Only merge if previous attempt is still in progress / unsubmitted.
      if (!isTerminalFailure) {
        const sameImage = !!(
          data.base64Image &&
          last.base64Image &&
          data.base64Image === last.base64Image
        );
        const sameAnswer = !!(
          last.numericAnswer &&
          data.numericAnswer &&
          last.numericAnswer === data.numericAnswer
        );
        const isProgression =
          (last.status === "PRE_SOLVED" &&
            (incomingStatus === "SOLVED" ||
              incomingStatus === "SUBMITTED" ||
              incomingStatus === "ANOMALY")) ||
          (last.status === "SOLVED" &&
            (incomingStatus === "SUBMITTED" ||
              incomingStatus === "ANOMALY")) ||
          (last.status === "PRE_SOLVED" && incomingStatus === "PRE_SOLVED");

        if (sameImage || sameAnswer || isProgression) {
          shouldUpdateLast = true;
        }
      }
    }

    if (shouldUpdateLast) {
      const lastIdx = list.length - 1;
      const prev = list[lastIdx];
      const finalStatus =
        prev.status === "ANOMALY" && incomingStatus !== "RESERVED"
          ? "ANOMALY"
          : incomingStatus;
      const updated = {
        ...prev,
        timestamp: ts,
        timeStr: format12HourTime(ts),
        base64Image: data.base64Image || prev.base64Image || "",
        rawText: data.rawText || prev.rawText || "",
        answer: data.answer !== undefined ? String(data.answer) : prev.answer,
        numericAnswer:
          data.numericAnswer !== undefined
            ? data.numericAnswer
            : prev.numericAnswer,
        durationMs: data.durationMs || prev.durationMs || 0,
        status: finalStatus,
        statusDetail: data.statusDetail || prev.statusDetail || "",
        model: data.model || prev.model || "native-onnx-node-v1",
        confidence:
          data.confidence !== undefined ? data.confidence : prev.confidence,
        serverAlertText: data.serverAlertText || prev.serverAlertText || null,
      };
      list[lastIdx] = updated;

      const jsonStr = JSON.stringify(list);
      localStorage.setItem("dda_captcha_attempts", jsonStr);
      sessionStorage.setItem("dda_captcha_attempts", jsonStr);
      return updated;
    }

    const record = {
      attemptNumber: list.length + 1,
      pan: currentPan,
      timestamp: ts,
      timeStr: format12HourTime(ts),
      base64Image: data.base64Image || "",
      rawText: data.rawText || "",
      answer: data.answer !== undefined ? String(data.answer) : "",
      numericAnswer:
        data.numericAnswer !== undefined ? data.numericAnswer : null,
      durationMs: data.durationMs || 0,
      status: incomingStatus,
      statusDetail:
        data.statusDetail ||
        (isAnomaly
          ? `Anomaly (Confidence ${(data.confidence * 100).toFixed(0)}%)`
          : ""),
      model: data.model || "native-onnx-node-v1",
      confidence: data.confidence !== undefined ? data.confidence : null,
      serverAlertText: data.serverAlertText || null,
    };

    list.push(record);
    if (list.length > 20) list = list.slice(list.length - 20);
    const jsonStr = JSON.stringify(list);
    localStorage.setItem("dda_captcha_attempts", jsonStr);
    sessionStorage.setItem("dda_captcha_attempts", jsonStr);

    return record;
  } catch (e) {
    console.warn("Could not record captcha attempt:", e);
    return null;
  }
}

function updateLastCaptchaAttempt(updates) {
  try {
    let list = [];
    try {
      list = JSON.parse(
        localStorage.getItem("dda_captcha_attempts") ||
          sessionStorage.getItem("dda_captcha_attempts") ||
          "[]",
      );
    } catch (_) {
      list = [];
    }
    if (list.length > 0) {
      if (updates?.status) {
        traceCaptcha(`verdict=${updates.status} ${String(updates.statusDetail || "").slice(0, 160)}`);
      }
      list[list.length - 1] = { ...list[list.length - 1], ...updates };
      const jsonStr = JSON.stringify(list);
      localStorage.setItem("dda_captcha_attempts", jsonStr);
      sessionStorage.setItem("dda_captcha_attempts", jsonStr);
    }
  } catch (_) {}
}

/**
 * Reset captcha session state (Roadmap 6.7)
 */
function resetCaptchaSessionState(reason = "") {
  solveInProgress = false;
  captchaRetryCount = 0;
  lastAlertHandledAt = 0;
  currentCaptchaGen++;
  currentFillToken++;
  lastSolvedCaptchaSrc = null;
  lastSolvedCaptchaAnswer = null;
  step2PreSolvedResult = null;

  try {
    document.querySelectorAll('img[src*="captcha"]').forEach((img) => {
      img.dataset.ocrAttempted = "false";
      img.dataset.lastSeenSrc = "";
    });
  } catch (_) {}

  if (reason) console.log(`🧹 [DDA Captcha] Session state reset: ${reason}`);
}

/**
 * Reload Captcha Image with generation counter & input wipe (Roadmap 6.8)
 */
function reloadCaptcha(img) {
  currentCaptchaGen++;
  currentFillToken++;
  lastSolvedCaptchaAnswer = null;
  step2PreSolvedResult = null;

  // 1. Immediately wipe existing captcha input
  const inputField = document.querySelector(CAPTCHA_INPUT_SELECTORS);
  if (inputField) {
    inputField.value = "";
    inputField.dispatchEvent(new Event("input", { bubbles: true }));
    inputField.dispatchEvent(new Event("change", { bubbles: true }));
    inputField.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // 2. Invalidate previous solve hash
  lastSolvedCaptchaSrc = null;

  // 3. Cache-bust image src directly
  if (img?.src) {
    const cleanSrc = img.src.split(/[?&]t=\d+/)[0];
    const sep = cleanSrc.includes("?") ? "&" : "?";
    img.src = `${cleanSrc}${sep}t=${Date.now()}`;
    return true;
  }

  // 4. Fallback click on refresh button
  const refreshButton = document.querySelector(
    '.btn-refresh, .captchareload a, a[onclick*="captcha" i], #refreshcaptcha, .refresh-captcha',
  );
  if (refreshButton) {
    try {
      refreshButton.click();
      return true;
    } catch (_) {}
  }

  return false;
}

function isLoginCaptchaAutoSolveOn() {
  return (
    currentSettings?.loginCaptchaAutoSolveEnabled !== false &&
    localStorage.getItem("loginCaptchaAutoSolveEnabled") !== "false"
  );
}

// Login page: ask DDA for a new captcha the way its own reload icon does
// (GET /user/refresh_captcha, whose <img> HTML replaces ".captcha span"). DDA
// calls this itself after a failed login and keeps the page's login salt,
// unlike a reload of /user. At most LOGIN_CAPTCHA_MAX_REFRESHES per page;
// false when spent or when the page has neither the icon nor the captcha box.
// DDA's refreshCaptcha() lives in the page's own script world, which this
// preload can't call, and its jQuery handler sits on the icon (img.btn-refresh),
// not the <a> around it: so the icon is clicked, and without it the same
// request is made here.
function refreshLoginCaptcha(reason) {
  if (loginCaptchaRefreshes >= LOGIN_CAPTCHA_MAX_REFRESHES) return false;
  const refreshIcon = document.querySelector(".captchareload .btn-refresh") || document.querySelector("img.btn-refresh, .btn-refresh");
  const captchaBox = document.querySelector(".captcha span");
  if (!refreshIcon && !captchaBox) return false;

  loginCaptchaRefreshes++;
  const msg = `🔄 Login captcha ${reason}. Asking DDA for a new captcha (${loginCaptchaRefreshes} of ${LOGIN_CAPTCHA_MAX_REFRESHES})...`;
  appendRunLog(msg, "WARN");
  ipcRenderer.send("dda:log", { level: "WARN", pan: currentApplicant?.pan, page: "Login", msg });

  const input = document.querySelector(CAPTCHA_INPUT_SELECTORS);
  if (input && input.value) {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  lastSolvedCaptchaSrc = null;
  lastSolvedCaptchaAnswer = null;
  currentCaptchaGen++;
  currentFillToken++;
  solveInProgress = false;

  const now = Date.now();
  loginCaptchaLastRefreshAt = now;
  loginCaptchaWatch = { src: loginCaptchaWatch.src, since: now };
  loginCaptchaRefreshPendingUntil = now + CAPTCHA_IMG_WAIT_MS;
  try {
    if (refreshIcon) {
      refreshIcon.click();
    } else {
      fetch("https://eservices.dda.org.in/user/refresh_captcha", {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(REFRESH_CAPTCHA_TIMEOUT_MS),
      })
        .then((r) => (r.ok ? r.text() : ""))
        .then((html) => {
          if (/<img/i.test(html) && captchaBox.isConnected) captchaBox.innerHTML = html;
        })
        .catch(() => {});
    }
  } catch (_) {}
  return true;
}

// Login page, every second: a captcha image that failed (HTTP 500 under load), has
// not arrived after CAPTCHA_IMG_WAIT_MS, or could not be read is never solved by the
// engine. Ask for a new one, spaced out by LOGIN_CAPTCHA_REFRESH_GAPS_MS; after the
// last, hand over. Never while the user is typing the captcha or one is already filled.
function checkLoginCaptchaHealth() {
  if (!isLoginPageUrl() || !isLoginCaptchaAutoSolveOn()) return;
  if (loginCaptchaUserTyped || loginCaptchaGaveUp || solveInProgress) return;
  const input = document.querySelector(CAPTCHA_INPUT_SELECTORS);
  if (!input || input.value) return;

  const img = document.querySelector(CAPTCHA_IMAGE_SELECTORS);
  const src = img ? getCaptchaSrc(img) : "";
  const now = Date.now();
  if (src !== loginCaptchaWatch.src) {
    // A new image (or none yet): its own full wait starts now
    loginCaptchaWatch = { src, since: now };
    loginCaptchaRefreshPendingUntil = 0;
  }
  const unreadable = !!src && src === loginCaptchaUnreadableSrc;
  if (img && img.complete && img.naturalWidth > 0 && !unreadable) return; // loaded: the engine solves it
  // A refresh is on its way: give the new image its time before judging the old one
  if (now < loginCaptchaRefreshPendingUntil) return;

  const waited = now - loginCaptchaWatch.since;
  const broken = unreadable || (!!img && img.complete && img.naturalWidth === 0 && waited > 1500);
  if (!broken && waited < CAPTCHA_IMG_WAIT_MS) return;

  // Spaced out, so one burst of HTTP 500s doesn't use up all the new captchas
  if (loginCaptchaRefreshes < LOGIN_CAPTCHA_MAX_REFRESHES) {
    const gap = LOGIN_CAPTCHA_REFRESH_GAPS_MS[loginCaptchaRefreshes] || 0;
    const from = loginCaptchaRefreshes === 0 ? loginCaptchaWatch.since : loginCaptchaLastRefreshAt;
    if (now - from < gap) return;
  }

  const reason = unreadable
    ? `could not be read (${loginCaptchaUnreadableReason})`
    : broken
      ? "image failed to load"
      : img
        ? `image not loaded after ${Math.round(waited / 1000)} s`
        : `image missing after ${Math.round(waited / 1000)} s`;
  if (!refreshLoginCaptcha(reason)) giveUpLoginCaptcha(reason);
}

function giveUpLoginCaptcha(reason) {
  if (loginCaptchaGaveUp) return;
  loginCaptchaGaveUp = true;
  const msg = loginCaptchaRefreshes >= LOGIN_CAPTCHA_MAX_REFRESHES
    ? `🛑 Login captcha ${reason}, even after ${LOGIN_CAPTCHA_MAX_REFRESHES} new captchas. Type it yourself (the reload icon next to it gets another).`
    : `🛑 Login captcha ${reason}. Type it yourself (the reload icon next to it gets another).`;
  appendRunLog(msg, "WARN");
  ipcRenderer.send("dda:log", { level: "WARN", pan: currentApplicant?.pan, page: "Login", msg });
}

/**
 * Adaptive Retry Engine with generation counter & max 3 attempts (Roadmap 6.8)
 */
function retryCaptchaSolve(img, reason = "OCR Anomaly") {
  if (!img) {
    solveInProgress = false;
    return;
  }

  // On Login page: a captcha that could not be read gets a new one from DDA through
  // the login captcha watcher (spaced out, up to 3 per page), never a loop. DDA's own
  // "invalid captcha" box is left alone: DDA refreshes the captcha itself after it
  // and clears the password.
  if (isLoginPageUrl()) {
    const serverAlert = /^Server Alert/.test(reason);
    if (!serverAlert && !loginCaptchaUserTyped && !loginCaptchaGaveUp) {
      img.dataset.ocrAttempted = "true";
      loginCaptchaUnreadableSrc = getCaptchaSrc(img);
      loginCaptchaUnreadableReason = reason;
      solveInProgress = false;
      return;
    }
    ipcRenderer.send("dda:log", {
      level: "WARN",
      pan: currentApplicant?.pan,
      page: "Login",
      msg: `🛑 Login Captcha ${reason}. Halting on login page for manual entry.`,
    });
    const inputField = document.querySelector(CAPTCHA_INPUT_SELECTORS);
    if (inputField) {
      inputField.value = "";
      inputField.dispatchEvent(new Event("input", { bubbles: true }));
      inputField.dispatchEvent(new Event("change", { bubbles: true }));
      inputField.dispatchEvent(new Event("blur", { bubbles: true }));
    }
    img.dataset.ocrAttempted = "true";
    solveInProgress = false;
    return;
  }

  // On step2_form (Flat Reservation): Allow up to MAX_CAPTCHA_RETRIES (2 retries = 3 total attempts)
  if (captchaRetryCount >= MAX_CAPTCHA_RETRIES) {
    ipcRenderer.send("dda:log", {
      level: "WARN",
      pan: currentApplicant?.pan,
      page: "Step 2 Modal",
      msg: `🛑 Maximum ${MAX_CAPTCHA_RETRIES} retries exhausted (${reason}). Cleared input field, ready for manual entry.`,
    });

    reloadCaptcha(img);

    const inputField = document.querySelector(CAPTCHA_INPUT_SELECTORS);
    if (inputField) {
      inputField.value = "";
      inputField.dispatchEvent(new Event("input", { bubbles: true }));
      inputField.dispatchEvent(new Event("change", { bubbles: true }));
      inputField.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    img.dataset.ocrAttempted = "true";
    solveInProgress = false;
    return;
  }

  captchaRetryCount++;
  ipcRenderer.send("dda:log", {
    level: "WARN",
    pan: currentApplicant?.pan,
    page: "Step 2 Modal",
    msg: `🔄 ${reason}. Reloading image & retrying (Attempt ${captchaRetryCount + 1} of ${MAX_CAPTCHA_RETRIES + 1})...`,
  });

  const reloaded = reloadCaptcha(img);
  if (!reloaded) {
    solveInProgress = false;
    return;
  }

  solveInProgress = true;
  let solvedOnThisReload = false;
  const onCaptchaLoaded = () => {
    if (solvedOnThisReload) return;
    solvedOnThisReload = true;
    img.dataset.ocrAttempted = "false";
    img.dataset.lastSeenSrc = getCaptchaSrc(img);
    processCaptchaImage(img, true);
    img.removeEventListener("load", onCaptchaLoaded);
  };

  img.addEventListener("load", onCaptchaLoaded, { once: true });
  setTimeout(() => {
    if (!solvedOnThisReload && img.complete && img.naturalWidth > 0) {
      onCaptchaLoaded();
    }
  }, 600);
}

/**
 * Invalid Captcha Alert Detection & Auto-Recovery Loop (Roadmap 6.9)
 */
function checkForInvalidCaptchaAlert() {
  const isLogin = isLoginPageUrl();
  const isAutoSolve = isLogin
    ? currentSettings?.loginCaptchaAutoSolveEnabled !== false &&
      window.localStorage.getItem("loginCaptchaAutoSolveEnabled") !== "false"
    : window.localStorage.getItem("captchaAutoSolveEnabled") !== "false" &&
      !window.__ddaManualCaptchaFlat;
  if (!isAutoSolve) return;
  if (solveInProgress) return;
  if (isStep2FormUrl() && !isFlatReservationModalOpen()) return;
  if (Date.now() - lastAlertHandledAt < 2000) return;

  const alertSelectors = [
    "#err",
    "#err .alert",
    ".captchblock #err",
    ".swal2-popup.swal2-show",
    ".alert-warning",
    ".alert-danger",
    ".swal-overlay .swal-modal",
  ];

  const alerts = document.querySelectorAll(alertSelectors.join(", "));
  for (const alert of alerts) {
    if (!isElementVisible(alert)) continue;
    if (
      alert.classList.contains("modal-content") ||
      alert.classList.contains("modal-dialog") ||
      alert.id === "myModal"
    ) {
      continue;
    }

    const text = (alert.textContent || "").trim().toLowerCase();
    if (!text || text.length < 3) continue;

    // Ignore flat conflicts (handled separately by flat conflict recovery engine)
    if (
      text.includes("this flat is alloted by another applicant") ||
      text.includes("this flat is hold/sold by another applicant") ||
      text.includes("you can not book this flat as it hold/sold")
    ) {
      continue;
    }

    const isInvalidCaptchaAlert =
      text.includes("the captcha field is required") ||
      (text.includes("captcha") && text.includes("invalid"));

    if (isInvalidCaptchaAlert && alert.dataset.captchaRetryHandled !== "true") {
      alert.dataset.captchaRetryHandled = "true";
      lastAlertHandledAt = Date.now();

      ipcRenderer.send("dda:log", {
        level: "WARN",
        pan: currentApplicant?.pan,
        page: "Captcha Alert",
        msg: `⚠️ Captcha error banner detected: "${text}". Auto-dismissing & re-solving...`,
      });

      // 1. Auto-dismiss SweetAlert popup if present
      const swalConfirm = alert.querySelector(
        ".swal2-confirm, .swal-button--confirm, button.confirm",
      );
      if (swalConfirm) {
        try {
          swalConfirm.click();
        } catch (_) {}
      }

      // 2. Dismiss inline bootstrap alert & clear container
      const alertCloseBtn = alert.querySelector(
        'button.close, .close, [data-dismiss="alert"]',
      );
      if (alertCloseBtn) {
        try {
          alertCloseBtn.click();
        } catch (_) {}
      }
      const errContainer = document.getElementById("err");
      if (errContainer) errContainer.innerHTML = "";

      // 3. Clear #captcha input immediately
      const captchaInput = document.querySelector(CAPTCHA_INPUT_SELECTORS);
      if (captchaInput) {
        captchaInput.value = "";
        captchaInput.dispatchEvent(new Event("input", { bubbles: true }));
        captchaInput.dispatchEvent(new Event("change", { bubbles: true }));
        captchaInput.dispatchEvent(new Event("blur", { bubbles: true }));
      }

      // 4. Update telemetry record
      updateLastCaptchaAttempt({
        status: "SERVER_REJECTED",
        serverAlertText: text,
        statusDetail: `Server Rejected: "${text}"`,
      });

      // 5. Trigger retry
      const captchaImg = document.querySelector(
        '.modal.show img[src*="captcha"], #myModal.show img[src*="captcha"], .captchblock img, .captcha img, img[src*="captcha"]',
      );
      if (captchaImg) {
        retryCaptchaSolve(captchaImg, `Server Alert: "${text}"`);
      }
      break;
    }
  }
}

/**
 * Process and auto-solve a detected captcha image (Roadmap 6.7, 6.13)
 */
async function processCaptchaImage(img, isRetry = false) {
  const isLogin = isLoginPageUrl();
  if (!img) return;
  if (!isRetry && !isCaptchaReadyForSolve(img)) return;

  const isAutoSolve = isLogin
    ? currentSettings?.loginCaptchaAutoSolveEnabled !== false &&
      localStorage.getItem("loginCaptchaAutoSolveEnabled") !== "false"
    : currentSettings?.captchaAutoSolveEnabled !== false &&
      localStorage.getItem("captchaAutoSolveEnabled") !== "false" &&
      !window.__ddaManualCaptchaFlat;
  if (!isAutoSolve) return;

  const imgSrc = getCaptchaSrc(img);
  if (!imgSrc) return;

  // Exact URL Hash Guard: Do not solve the same image multiple times unless retrying
  if (
    !isRetry &&
    imgSrc === lastSolvedCaptchaSrc &&
    img.dataset.ocrAttempted === "true"
  ) {
    // 🛡️ RE-FILL GUARD: If input is currently empty (e.g. DDA .reserve wiped it), re-fill immediately!
    const existingInput = document.querySelector(CAPTCHA_INPUT_SELECTORS);
    if (existingInput && !existingInput.value && lastSolvedCaptchaAnswer) {
      fillCaptchaInput(lastSolvedCaptchaAnswer);
    }
    return;
  }

  // 🛡️ CRITICAL GUARD: On step2_form, NEVER solve captcha until modal is genuinely open & visible!
  if (isStep2FormUrl() && !isFlatReservationModalOpen()) {
    return;
  }

  solveInProgress = true;
  const solveGen = ++currentCaptchaGen;
  img.dataset.ocrAttempted = "true";

  const inputField = document.querySelector(CAPTCHA_INPUT_SELECTORS);
  if (inputField && imgSrc !== lastSolvedCaptchaSrc) {
    inputField.value = "";
  }

  const pageLabel = isLogin ? "Login" : "Step 2 Modal";

  console.log(`[DDA Captcha] Solving captcha (Gen ${solveGen})...`);

  try {
    let solveData = null;
    let ocrDuration = 0;
    let usedPreSolve = false;
    let base64Img = "";

    // ⚡ JIT PRE-SOLVE CACHE CHECK (Roadmap 6.12, 5D.11)
    if (
      step2PreSolvedResult &&
      step2PreSolvedResult.src === imgSrc &&
      Date.now() - step2PreSolvedResult.timestamp < 45000
    ) {
      solveData = step2PreSolvedResult.data;
      base64Img = step2PreSolvedResult.base64Image;
      ocrDuration = 0;
      usedPreSolve = true;
      appendRunLog(
        `✅ Captcha Solved: ${solveData.numericAnswer} (0ms)`,
        "OCR",
      );
    } else {
      step2PreSolvedResult = null;
      const ocrStart = Date.now();
      const { floatArray, base64Image } = await extractCaptchaTensor(img);
      base64Img = base64Image;

      // Call Main process native ONNX solver
      const response = await ipcRenderer.invoke("captcha:solveLocal", {
        floatArray: Array.from(floatArray),
        base64Image,
        pan: currentApplicant?.pan,
      });

      if (solveGen !== currentCaptchaGen) {
        console.warn(
          `⚠️ [DDA Captcha] Discarding stale OCR response (Gen ${solveGen} vs current ${currentCaptchaGen})`,
        );
        solveInProgress = false;
        return;
      }

      if (!response || !response.success || !response.data) {
        throw new Error(response?.error || "Captcha solver returned failure");
      }

      solveData = response.data;
      ocrDuration = Date.now() - ocrStart;
    }

    const { numericAnswer, answer, rawText, model, confidence } = solveData;
    lastSolvedCaptchaSrc = imgSrc;

    appendRunLog(
      `✅ Captcha Solved: ${rawText || answer} (${ocrDuration}ms${formatCaptchaConfidence(confidence)})`,
      "OCR",
    );

    // Record Telemetry Attempt (Roadmap 6.10)
    recordCaptchaAttempt({
      base64Image: base64Img,
      rawText: rawText || `${answer}`,
      answer: String(answer),
      numericAnswer,
      durationMs: ocrDuration,
      status: "SOLVED",
      statusDetail: usedPreSolve
        ? "Solved via JIT background pre-solve (0ms perceived latency)"
        : `Solved locally via native ONNX in ${ocrDuration}ms`,
      model: model || "native-onnx-node-v1",
      ...(typeof confidence === "number" ? { confidence } : {}),
    });

    lastSolvedCaptchaAnswer = numericAnswer;
    fillCaptchaInput(numericAnswer);

    const freshInput = document.querySelector(CAPTCHA_INPUT_SELECTORS);
    // Login Page Flow (Credentials and captcha filled, instant IPC notification to React sidebar)
    if (isLogin) {
      if (freshInput) {
        freshInput.focus();
      }
      solveInProgress = false;
      captchaRetryCount = 0;
      loginCaptchaRefreshes = 0;
      loginCaptchaGaveUp = false;

      try {
        ipcRenderer.send("dda:captcha-solved", {
          text: numericAnswer,
          dataUrl: base64Img,
          page: "Login",
        });
      } catch (_) {}

      appendRunLog(
        `🔑 Captcha filled on login page: [${numericAnswer}]. Ready for login submission.`,
        "ACTION",
      );
      return;
    }

    if (freshInput) {
      // Step 2 Flat Reservation Flow: Notify UI of solved captcha
      try {
        const solvedPayload = {
          text: numericAnswer,
          rawText: rawText || `${numericAnswer}`,
          dataUrl: base64Img,
          page: "Step 2 Flats",
          pan: currentApplicant?.pan,
          durationMs: ocrDuration,
        };
        ipcRenderer.send("dda:captcha-solved", solvedPayload);
        if (typeof ipcRenderer.sendToHost === "function") {
          ipcRenderer.sendToHost("dda:captcha-solved", solvedPayload);
        }
      } catch (_) {}

      freshInput.focus();
      // Auto-Submit is permanent default for all users (zero-delay microtask)

      // Auto-Submit with zero-delay microtask to guarantee instant background submission
      setTimeout(() => {
        fillCaptchaInput(numericAnswer);

        const submitBtn = document.querySelector(
          '#captchabutton, button.capreserve, input.capreserve, button[type="submit"], input[type="submit"]',
        );
        if (submitBtn) {
          appendRunLog(
            "🚀 Auto-submitting flat reservation (#captchabutton)",
            "ACTION",
          );
          logAnalyticsStep(
            "step5_captcha_submit",
            `Flat Captcha Submitted: ${rawText || numericAnswer}`,
          );
          updateLastCaptchaAttempt({ status: "SUBMITTED" });
          submitBtn.click();
        }
        solveInProgress = false;
      }, 10);
    } else {
      solveInProgress = false;
    }
  } catch (err) {
    console.error("❌ [DDA Captcha] Execution error:", err);
    solveInProgress = false;
    ipcRenderer.send("dda:log", {
      level: "ERROR",
      pan: currentApplicant?.pan,
      page: "Captcha",
      msg: `❌ Captcha solving error: ${err.message}`,
    });

    retryCaptchaSolve(img, `Execution Error: ${err.message}`);
  }
}

/**
 * Scan DOM for pending captcha images and solve the latest image
 */
function scanAndSolveCaptchas() {
  const isLogin = isLoginPageUrl();
  const isAutoSolve = isLogin
    ? currentSettings?.loginCaptchaAutoSolveEnabled !== false &&
      localStorage.getItem("loginCaptchaAutoSolveEnabled") !== "false"
    : currentSettings?.captchaAutoSolveEnabled !== false &&
      localStorage.getItem("captchaAutoSolveEnabled") !== "false" &&
      !window.__ddaManualCaptchaFlat;
  if (!isAutoSolve || solveInProgress) return;

  if (isStep2FormUrl() && !isFlatReservationModalOpen()) return;

  const images = document.querySelectorAll(CAPTCHA_IMAGE_SELECTORS);
  for (const img of images) {
    const src = getCaptchaSrc(img);
    if (!src) continue;

    // Dynamic reload detection: reset flags if src updated
    if (img.dataset.lastSeenSrc && img.dataset.lastSeenSrc !== src) {
      img.dataset.ocrAttempted = "false";
      lastSolvedCaptchaSrc = null;
      lastSolvedCaptchaAnswer = null;
      step2PreSolvedResult = null;
      currentFillToken++;
      solveInProgress = false;
      const input = document.querySelector(CAPTCHA_INPUT_SELECTORS);
      if (input) {
        input.value = "";
      }
    }
    img.dataset.lastSeenSrc = src;

    // Attach load listener for network refresh
    if (!img._ddaLoadListenerAttached) {
      img._ddaLoadListenerAttached = true;
      img.addEventListener("load", () => {
        const freshSrc = getCaptchaSrc(img);
        if (freshSrc && freshSrc !== lastSolvedCaptchaSrc) {
          img.dataset.ocrAttempted = "false";
          img.dataset.lastSeenSrc = freshSrc;
          lastSolvedCaptchaSrc = null;
          lastSolvedCaptchaAnswer = null;
          step2PreSolvedResult = null;
          currentFillToken++;
          solveInProgress = false;
          const input = document.querySelector(CAPTCHA_INPUT_SELECTORS);
          if (input) {
            input.value = "";
          }
          if (isCaptchaReadyForSolve(img)) {
            processCaptchaImage(img);
          }
        }
      });
    }

    if (src === lastSolvedCaptchaSrc && img.dataset.ocrAttempted === "true") {
      const input = document.querySelector(CAPTCHA_INPUT_SELECTORS);
      if (input && !input.value && lastSolvedCaptchaAnswer) {
        fillCaptchaInput(lastSolvedCaptchaAnswer);
      }
      continue;
    }
    if (img.dataset.ocrAttempted === "true") continue;

    if (!isCaptchaReadyForSolve(img)) continue;

    processCaptchaImage(img);
    break;
  }
}

let captchaEngineStarted = false;

/**
 * Start persistent Captcha Observer, Reload Click Watcher & JIT Poller (Roadmap 6.8, 6.9)
 */
function setupCaptchaEngine() {
  if (captchaEngineStarted) return;
  captchaEngineStarted = true;

  // 1. MutationObserver watching for new images & src attribute updates (reloads)
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes" && m.attributeName === "src") {
        const target = m.target;
        if (
          target &&
          target.tagName === "IMG" &&
          (target.src || "").includes("captcha")
        ) {
          const freshSrc = getCaptchaSrc(target);
          if (freshSrc && freshSrc !== lastSolvedCaptchaSrc) {
            target.dataset.ocrAttempted = "false";
            target.dataset.lastSeenSrc = freshSrc;
            lastSolvedCaptchaSrc = null;
            lastSolvedCaptchaAnswer = null;
            step2PreSolvedResult = null;
            currentFillToken++;
            solveInProgress = false;
            const input = document.querySelector(CAPTCHA_INPUT_SELECTORS);
            if (input) {
              input.value = "";
            }
          }
        }
      }
    }
    scanAndSolveCaptchas();
  });

  const attachObserver = () => {
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"],
      });
      activeObservers.push(observer);
    }
  };

  if (document.body) {
    attachObserver();
  } else {
    document.addEventListener("DOMContentLoaded", attachObserver, {
      once: true,
    });
  }

  // 2. Click Interceptor for Captcha Refresh / Reload buttons or clicking image
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target;
      if (!el) return;

      const isRefreshTrigger =
        el.matches(
          'img[src*="captcha"], #refreshcaptcha, .refresh-captcha, .captcha-refresh, a[onclick*="captcha" i], button[onclick*="captcha" i], a[href*="captcha" i], [title*="refresh" i], [title*="reload" i], i.fa-refresh, i.fa-sync, i.fa-redo',
        ) ||
        el.closest(
          '#refreshcaptcha, .refresh-captcha, .captcha-refresh, a[onclick*="captcha" i], button[onclick*="captcha" i], [title*="refresh" i], [title*="reload" i]',
        );

      if (isRefreshTrigger) {
        ipcRenderer.send("dda:log", {
          level: "INFO",
          pan: currentApplicant?.pan,
          page: "Captcha",
          msg: "🔄 Captcha reload detected. Clearing stale input and awaiting fresh image...",
        });

        lastSolvedCaptchaAnswer = null;
        step2PreSolvedResult = null;
        currentFillToken++;
        lastSolvedCaptchaSrc = null;
        solveInProgress = false;
        currentCaptchaGen++;

        const input = document.querySelector(CAPTCHA_INPUT_SELECTORS);
        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("blur", { bubbles: true }));
        }

        document.querySelectorAll('img[src*="captcha"]').forEach((img) => {
          img.dataset.ocrAttempted = "false";
          img.dataset.lastSeenSrc = "";
        });

        setTimeout(scanAndSolveCaptchas, 50);
        setTimeout(scanAndSolveCaptchas, 150);
        setTimeout(scanAndSolveCaptchas, 400);
        setTimeout(scanAndSolveCaptchas, 800);
        setTimeout(scanAndSolveCaptchas, 1400);
      }
    },
    true,
  );

  // 3. Continuous 150ms check for invalid captcha alerts from server
  setInterval(checkForInvalidCaptchaAlert, 150);

  // 4. Login page: a captcha image that failed or never arrived gets a new one from DDA.
  // Typing in the captcha box yourself switches that off for the page.
  document.addEventListener(
    "input",
    (e) => {
      if (e.isTrusted && isLoginPageUrl() && e.target?.matches?.(CAPTCHA_INPUT_SELECTORS)) {
        loginCaptchaUserTyped = true;
      }
    },
    true,
  );
  setInterval(checkLoginCaptchaHealth, 1000);

  // 4. Instant multi-stage initial scan + fast 80ms continuous poller for fresh captchas
  scanAndSolveCaptchas();
  setTimeout(scanAndSolveCaptchas, 30);
  setTimeout(scanAndSolveCaptchas, 80);
  setTimeout(scanAndSolveCaptchas, 150);
  setInterval(scanAndSolveCaptchas, 80);
}

// Early activation: Start Captcha Engine the moment DOM is ready or immediately if already loaded
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        setupCaptchaEngine();
      },
      { once: true },
    );
  } else {
    setupCaptchaEngine();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LOGIN PAGE HANDLER
// ─────────────────────────────────────────────────────────────────────────────
function handleLoginPage() {
  console.log("🔑 [DDA Extension] Page: Login (Autofill & Guardian Active)");

  const KNOWN_APPLICANT_PASSWORDS = (() => {
    const map = {};
    try {
      const raw =
        localStorage.getItem("dda_user_applicants") ||
        localStorage.getItem("dda_extension_applicants");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((u) => {
            const pan = (u.pan || u.personal?.pan || "").toUpperCase().trim();
            const pass = (u.password || u.personal?.password || "").trim();
            if (pan && pass) map[pan] = pass;
          });
        }
      }
    } catch (_) {}
    return map;
  })();

  runWhenReady(() => {
    // 1. Dynamic Credential Refill Helper (Strictly uses Selected Login Profile on Login Page)
    const refill = (explicitApp) => {
      // Active typing & manual edit guard: NEVER overwrite if user is focused or has manually typed unless explicit action
      const activeEl = document.activeElement;
      const isUserEditing =
        activeEl &&
        typeof activeEl.matches === "function" &&
        activeEl.matches(
          'input[name="user_id"], input#user_id, input[name="username"], input[name="login_id"], input[name="pan"], input#pan, input[placeholder*="User ID" i], input[placeholder*="PAN" i], input[type="password"], input#password, input[name="password"], input[name="user_password"]',
        );
      if (isUserEditing && !explicitApp) return;
      if (window.__ddaUserManuallyEditedLogin && !explicitApp) return;

      let app = explicitApp;
      if (!app || !app.personal) {
        try {
          if (typeof window !== "undefined" && window.__DDA_LOGIN_APPLICANT__) {
            app = window.__DDA_LOGIN_APPLICANT__;
          }
        } catch (_) {}
      }
      if (!app || !app.personal) {
        try {
          const raw = localStorage.getItem("window.__DDA_LOGIN_APPLICANT__");
          if (raw) app = JSON.parse(raw);
        } catch (_) {}
      }
      if (!app || !app.personal) {
        try {
          const rawPan =
            localStorage.getItem("dda_selected_login_pan") ||
            localStorage.getItem("dda_last_selected_login_pan") ||
            localStorage.getItem("dda_last_logged_in_pan");
          const rawData = localStorage.getItem("ddaData");
          if (rawData && rawPan) {
            const parsed = JSON.parse(rawData);
            if (parsed?.applicants && parsed.applicants[rawPan]) {
              app = parsed.applicants[rawPan];
            }
          }
        } catch (_) {}
      }
      if (!app || !app.personal) {
        app = currentApplicant;
      }
      if (app) currentApplicant = app;

      const pan = (app?.pan || app?.personal?.pan || "").trim().toUpperCase();
      let password = (app?.password || app?.personal?.password || "").trim();
      if (!password && pan && KNOWN_APPLICANT_PASSWORDS[pan]) {
        password = KNOWN_APPLICANT_PASSWORDS[pan];
      }

      const setVal = (el, val) => {
        if (!el || !val) return;
        if (el.value !== val) {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          )?.set;
          if (nativeSetter) nativeSetter.call(el, val);
          else el.value = val;
          try {
            if (typeof window.jQuery !== "undefined" && window.jQuery(el).val)
              window.jQuery(el).val(val);
            else if (typeof window.$ !== "undefined" && window.$(el).val)
              window.$(el).val(val);
          } catch (_) {}
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          if (document.activeElement !== el) {
            el.dispatchEvent(new Event("blur", { bubbles: true }));
          }
        }
      };

      const userSelectors = [
        'input[name="user_id"]',
        "input#user_id",
        'input[name="username"]',
        'input[name="login_id"]',
        'input[placeholder*="User ID" i]',
        'input[placeholder*="PAN" i]',
      ];
      const passSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        "input#password",
        'input[name="user_password"]',
      ];

      for (const sel of userSelectors) {
        const u = document.querySelector(sel);
        if (u && pan) {
          setVal(u, pan);
          break;
        }
      }

      for (const sel of passSelectors) {
        const p = document.querySelector(sel);
        if (p && password) {
          const currentVal = (p.value || "").trim();
          const isHexHash = /^[a-f0-9]{64}$/i.test(currentVal);
          if (!window.__ddaIsLoginSubmitting && !isHexHash) {
            setVal(p, password);
          }
          break;
        }
      }
    };

    window.__ddaRefillLoginCredentials = (target) => {
      window.__ddaUserManuallyEditedLogin = false;
      if (target) {
        window.__DDA_LOGIN_APPLICANT__ = target;
        currentApplicant = target;
      }
      refill(target);
    };

    // Listen for cross-context storage and custom events
    window.addEventListener("storage", (e) => {
      if (
        e.key === "window.__DDA_LOGIN_APPLICANT__" ||
        e.key === "dda_selected_login_pan" ||
        e.key === "dda_last_selected_login_pan" ||
        e.key === "ddaData"
      ) {
        refill();
      }
    });
    window.addEventListener("dda:set-login-applicant", (e) => {
      window.__ddaUserManuallyEditedLogin = false;
      if (e.detail) {
        window.__DDA_LOGIN_APPLICANT__ = e.detail;
        currentApplicant = e.detail;
        refill(e.detail);
      }
    });

    // Initial safe fill with delayed retries only if user hasn't edited
    refill();
    setTimeout(() => {
      if (!window.__ddaUserManuallyEditedLogin) refill();
    }, 150);
    setTimeout(() => {
      if (!window.__ddaUserManuallyEditedLogin) refill();
    }, 500);

    // Live typing listeners to allow free editing and capture live credentials
    const handleLoginInput = (e) => {
      const target = e.target;
      if (!target || typeof target.matches !== "function") return;

      const isUserField = target.matches(
        'input[name="user_id"], input#user_id, input[name="username"], input[name="login_id"], input[name="pan"], input#pan, input[placeholder*="User ID" i], input[placeholder*="PAN" i]',
      );
      const isPassField = target.matches(
        'input[type="password"], input#password, input[name="password"], input[name="user_password"]',
      );

      if (isUserField || isPassField) {
        window.__ddaUserManuallyEditedLogin = true;
      }

      if (isUserField) {
        const val = (target.value || "").trim().toUpperCase();
        if (val.length >= 3) {
          localStorage.setItem("dda_selected_login_pan", val);
          sessionStorage.setItem("dda_submitting_pan", val);
        }
        if (val.length === 10 && KNOWN_APPLICANT_PASSWORDS[val]) {
          const passEl = document.querySelector(
            'input[type="password"], input#password, input[name="password"], input[name="user_password"]',
          );
          if (passEl && (!passEl.value || passEl.value.trim() === "")) {
            const nativeSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value",
            )?.set;
            if (nativeSetter)
              nativeSetter.call(passEl, KNOWN_APPLICANT_PASSWORDS[val]);
            else passEl.value = KNOWN_APPLICANT_PASSWORDS[val];
            passEl.dispatchEvent(new Event("input", { bubbles: true }));
            passEl.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }

      if (isPassField) {
        const passVal = (target.value || "").trim();
        if (passVal && !/^[a-f0-9]{64}$/i.test(passVal)) {
          sessionStorage.setItem("dda_submitting_pass", passVal);
        }
      }
    };

    document.addEventListener("input", handleLoginInput, true);
    document.addEventListener("change", handleLoginInput, true);

    // 2. SweetAlert Modal Handling
    const swalObserver = new MutationObserver(() => {
      const swal = document.querySelector(
        ".swal2-popup.swal2-show, .swal-modal",
      );
      if (swal) {
        if (isLoginPageUrl()) {
          // On login page, preserve error alerts so user sees what failed!
          const msg =
            swal
              .querySelector(
                ".swal2-html-container, .swal2-title, .swal-text, .swal-title",
              )
              ?.textContent?.trim() || swal.textContent?.trim();
          if (msg && !swal.dataset.loggedToDda) {
            swal.dataset.loggedToDda = "true";
            ipcRenderer.send("dda:log", {
              level: "ERROR",
              page: "Login",
              msg: `Login Alert: ${msg}`,
            });
            // DDA refused the password: the dashboard marks it wrong on the website
            // when it is the applicant's saved one (Workspace)
            if (/invalid credentials/i.test(msg)) {
              const pan = (sessionStorage.getItem("dda_submitting_pan") || document.querySelector('input[name="user_id"]')?.value || "").toUpperCase().trim();
              const password = sessionStorage.getItem("dda_submitting_pass") || "";
              if (pan && password) {
                try { ipcRenderer.sendToHost("dda:login-invalid-credentials", { pan, password }); } catch (_) {}
              }
            }
          }
          return;
        }
        const btn = swal.querySelector(".swal2-confirm, button.confirm");
        if (btn) btn.click();
      }
    });
    swalObserver.observe(document.body, { childList: true, subtree: true });

    // 3. Capture credentials on form submission & preserve password hash
    const captureLoginCredentials = () => {
      const userEl = document.querySelector(
        'input[name="user_id"], input#user_id, input[name="username"], input[name="login_id"], input[name="pan"], input#pan, input[placeholder*="User ID" i], input[placeholder*="PAN" i]',
      );
      const passEl = document.querySelector(
        'input[type="password"], input#password, input[name="password"], #password',
      );
      let submittedPan = (userEl?.value || "").trim().toUpperCase();
      if (!submittedPan) {
        submittedPan = (
          currentApplicant?.pan ||
          currentApplicant?.personal?.pan ||
          ""
        )
          .trim()
          .toUpperCase();
      }
      const rawPass = (
        passEl?.value ||
        currentApplicant?.password ||
        currentApplicant?.personal?.password ||
        ""
      ).trim();

      if (submittedPan) {
        sessionStorage.setItem("dda_submitting_pan", submittedPan);
        sessionStorage.setItem("dda_authenticated_pan", submittedPan);
        sessionStorage.setItem("dda_just_logged_in", "true");
        localStorage.setItem("dda_last_logged_in_pan", submittedPan);
        localStorage.setItem("dda_selected_login_pan", submittedPan);
        localStorage.setItem("dda_selected_person", submittedPan);
        localStorage.setItem("dda_active_applicant_pan", submittedPan);
        if (rawPass && !/^[a-f0-9]{64}$/i.test(rawPass)) {
          sessionStorage.setItem("dda_submitting_pass", rawPass);
        }
      }
    };

    const attachSubmitting = () => {
      captureLoginCredentials();
      window.__ddaIsLoginSubmitting = true;
      if (window.__ddaLoginSubmittingTimer)
        clearTimeout(window.__ddaLoginSubmittingTimer);
      window.__ddaLoginSubmittingTimer = setTimeout(() => {
        window.__ddaIsLoginSubmitting = false;
      }, 8000);
    };

    // Double-submit guard: DDA's #loginbtn handler replaces the password field
    // with sha256(sha256(pw) + salt) and POSTs. A second click before the field
    // is reset hashes the hash, so the portal gets a wrong password racing the
    // right one and answers "invalid username or password". A real password is
    // at most 30 chars, so a 64-hex value means a submit is already in flight.
    document.addEventListener(
      "click",
      (e) => {
        if (!e.target?.closest?.("#loginbtn")) return;
        const passEl = document.querySelector("#password, input[name='password']");
        if (passEl && /^[a-f0-9]{64}$/i.test((passEl.value || "").trim())) {
          // DDA leaves the hash in place when its AJAX fails at the network
          // level; after 5s treat a click as a genuine retry and restore the
          // plaintext captured at the previous submit.
          const plain = sessionStorage.getItem("dda_submitting_pass");
          const stale = Date.now() - (window.__ddaLoginClickAt || 0) > 5000;
          if (stale && plain) {
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value",
            )?.set;
            if (setter) setter.call(passEl, plain);
            else passEl.value = plain;
          } else {
            e.preventDefault();
            e.stopImmediatePropagation();
            console.warn("[DDA Login] Duplicate login click blocked (submit already in flight)");
            return;
          }
        }
        window.__ddaLoginClickAt = Date.now();
      },
      true,
    );

    // Listen on document level for clicks, form submits, and input changes
    document.addEventListener("submit", attachSubmitting, true);
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(
          '#loginbtn, #btnLogin, button#login_btn, button#btnLogin, button[type="submit"], input[type="submit"], button.btn-login, button.btn-primary, button',
        );
        if (btn) attachSubmitting();
      },
      true,
    );

    // 4. Enter Key for Login (Debounced with 1.5s lock)
    const prevStyle = document.getElementById("__dda_login_captcha_style");
    if (prevStyle) prevStyle.remove();

    let lastEnterTime = 0;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const now = Date.now();
        if (now - lastEnterTime < 1500) {
          e.preventDefault();
          return;
        }
        lastEnterTime = now;
        const loginBtn = document.querySelector(
          '#loginbtn, #btnLogin, button[type="submit"], input[type="submit"]',
        );
        if (loginBtn) {
          e.preventDefault();
          captureLoginCredentials();
          window.__ddaIsLoginSubmitting = true;
          if (window.__ddaLoginSubmittingTimer)
            clearTimeout(window.__ddaLoginSubmittingTimer);
          window.__ddaLoginSubmittingTimer = setTimeout(() => {
            window.__ddaIsLoginSubmitting = false;
          }, 8000);
          loginBtn.click();
        }
      }
    });

    const curPan = (
      currentApplicant?.pan ||
      currentApplicant?.personal?.pan ||
      ""
    )
      .trim()
      .toUpperCase();
    ipcRenderer.send("dda:log", {
      level: "INFO",
      pan: curPan || undefined,
      page: "Login",
      msg: `Autofilled credentials with persistent guardian for PAN: ${curPan || "Ready"}`,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1b. SESSION KEEP-ALIVE HEARTBEAT (RANDOMIZED 45s–75s JITTER ON SCHEMES PAGE ONLY)
// ─────────────────────────────────────────────────────────────────────────────
function isStrictlySchemesPage() {
  if (typeof window === "undefined" || !window.location) return false;
  const href = (window.location.href || "").toLowerCase();
  const path = (window.location.pathname || "").toLowerCase();

  // Must match scheme list path or scheme list URL
  const isSchemePath =
    path.includes("schemelist") ||
    href.includes("schemelist") ||
    (path.includes("scheme") && !path.includes("step"));

  // Strictly exclude non-schemes pages (Login, Step 1, Step 2, Locality, Application Form, Payment)
  const isExcluded =
    href.includes("step") ||
    href.includes("flat") ||
    href.includes("login") ||
    href.includes("user/step1_form") ||
    href.includes("user/step2_form") ||
    href.includes("apply_scheme") ||
    href.includes("userapplicationfrom") ||
    href.includes("applicationform") ||
    href.includes("payment");

  return isSchemePath && !isExcluded;
}

let sessionHeartbeatActive = false;
let sessionHeartbeatTimer = null;
let sessionPingCount = 0;
let heartbeatFailStreak = 0; // session pings in a row that got no answer

function stopSessionHeartbeat(reason = "stopped") {
  if (sessionHeartbeatActive || sessionHeartbeatTimer) {
    console.log(`💓 [Heartbeat] Stopped session heartbeat (${reason})`);
  }
  sessionHeartbeatActive = false;
  if (sessionHeartbeatTimer) {
    clearTimeout(sessionHeartbeatTimer);
    clearInterval(sessionHeartbeatTimer);
    sessionHeartbeatTimer = null;
  }
}

function startSessionHeartbeat() {
  // STRICT RULE: Run strictly on Schemes page and nowhere else
  if (!isStrictlySchemesPage()) {
    stopSessionHeartbeat("Not on Schemes page");
    return;
  }

  // Purge any residual payment flags on Schemes page
  try {
    sessionStorage.removeItem("dda_fast_payment_approved");
    window.__ddaFastPaymentApproved = false;
  } catch (_) {}

  // Mute heartbeat immediately if timed hunting or flat hunting is actively running
  if (
    localStorage.getItem("dda_timed_mode") === "true" ||
    window.__ddaTimedSearchTimer ||
    window.__ddaTimedPoller
  ) {
    stopSessionHeartbeat("Timed hunting active");
    return;
  }

  if (sessionHeartbeatActive) return; // Strictly one active loop
  sessionHeartbeatActive = true;

  const pingSession = async () => {
    if (!sessionHeartbeatActive) return;
    if (!isStrictlySchemesPage()) {
      stopSessionHeartbeat("Navigated away from Schemes page");
      return;
    }
    if (
      localStorage.getItem("dda_timed_mode") === "true" ||
      window.__ddaTimedSearchTimer ||
      window.__ddaTimedPoller
    ) {
      stopSessionHeartbeat("Timed hunting started");
      return;
    }

    sessionPingCount++;
    const tStart = performance.now();
    try {
      const pingUrl =
        typeof window !== "undefined" &&
        window.location.origin.includes("dda.org.in")
          ? "https://eservices.dda.org.in/user/schemeList"
          : (window.location.origin || "https://eservices.dda.org.in") +
            "/user/schemeList";

      // The next ping is only scheduled once this one settles, so a request that never answers
      // (half-open connection, Wi-Fi gone mid-request) would end the heartbeat for the rest of
      // the session and let DDA quietly log us out. Pings are 45-75 s apart and an answer slower
      // than 10 s is worthless, so give up on it and let the next ping go.
      const res = await fetch(pingUrl, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Cache-Control": "no-cache",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      const latency = Math.round(performance.now() - tStart);

      // Verify still on Schemes page after fetch completes
      if (!sessionHeartbeatActive || !isStrictlySchemesPage()) {
        stopSessionHeartbeat("Navigation occurred during fetch");
        return;
      }

      const resText = await res.text().catch(() => "");
      const isRedirectedToLogin =
        res.redirected &&
        (res.url.toLowerCase().includes("/user/login") ||
          res.url.toLowerCase().endsWith("/user"));
      const isLoggedOutHtml =
        resText.includes("userloginform") ||
        resText.includes('id="loginbtn"') ||
        resText.includes("Please Login") ||
        resText.includes("Login to your account");

      // 🚨 Dead-Session Watchdog: detect expired or dead sessions immediately
      if (isRedirectedToLogin || isLoggedOutHtml) {
        stopSessionHeartbeat("DDA session expired");
        ipcRenderer.send("dda:log", {
          level: "ERROR",
          pan: currentApplicant?.pan,
          page: "Heartbeat Watchdog",
          msg: "🚨 DDA Portal session expired or logged out. Auto-redirecting to login for automatic re-authentication...",
        });
        const currentPath = window.location.pathname.toLowerCase();
        if (
          currentPath.includes("scheme") ||
          currentPath.includes("step") ||
          currentPath.includes("application")
        ) {
          window.location.href = "https://eservices.dda.org.in/user";
        }
        return;
      }

      if (heartbeatFailStreak > 0) {
        appendRunLog(`💓 DDA answered the session ping again after ${heartbeatFailStreak} failed one${heartbeatFailStreak === 1 ? "" : "s"}.`, "INFO");
        heartbeatFailStreak = 0;
      }
      ipcRenderer.send("dda:log", {
        level: "INFO",
        pan: currentApplicant?.pan,
        page: "Heartbeat",
        msg: `💓 Ping #${sessionPingCount} OK (${latency}ms) — Schemes page verified & session active`,
      });
    } catch (err) {
      if (!sessionHeartbeatActive || !isStrictlySchemesPage()) return;
      const latency = Math.round(performance.now() - tStart);
      // This used to log "OK" here too, so a bad line read exactly like a healthy one.
      const why = err?.name === "TimeoutError" || err?.name === "AbortError"
        ? "no answer within 10s"
        : err?.message || "connection error";
      heartbeatFailStreak++;
      ipcRenderer.send("dda:log", {
        level: heartbeatFailStreak >= 3 ? "WARN" : "INFO",
        pan: currentApplicant?.pan,
        page: "Heartbeat",
        msg: `💓 Ping #${sessionPingCount} failed after ${latency}ms (${why})${heartbeatFailStreak >= 3 ? ` — ${heartbeatFailStreak} in a row, the DDA session may be lost` : " — trying again at the next ping"}`,
      });
    }
  };

  const scheduleNextHeartbeat = () => {
    if (!sessionHeartbeatActive) return;
    if (!isStrictlySchemesPage()) {
      stopSessionHeartbeat("Navigated away from Schemes page");
      return;
    }
    if (
      localStorage.getItem("dda_timed_mode") === "true" ||
      window.__ddaTimedSearchTimer ||
      window.__ddaTimedPoller
    ) {
      stopSessionHeartbeat("Timed hunting started");
      return;
    }

    // Randomized 45s to 75s interval (with human-like jitter: 45,000ms to 75,000ms)
    const nextJitterDelay = 45000 + Math.floor(Math.random() * 30001);
    sessionHeartbeatTimer = setTimeout(async () => {
      await pingSession();
      scheduleNextHeartbeat();
    }, nextJitterDelay);
  };

  // Immediate verification ping at 250ms, then schedule recurring randomized 45s-75s pings
  sessionHeartbeatTimer = setTimeout(async () => {
    await pingSession();
    scheduleNextHeartbeat();
  }, 250);
}

// Expose on window for direct access by UI automation scripts
window.__ddaStartSessionHeartbeat = startSessionHeartbeat;
window.__ddaStopSessionHeartbeat = stopSessionHeartbeat;
window.isStrictlySchemesPage = isStrictlySchemesPage;

// Register IPC listener for explicit UI-driven heartbeat stops
try {
  ipcRenderer.on("dda:stop-heartbeat", (_event, data) => {
    stopSessionHeartbeat(data?.reason || "IPC request");
  });
} catch (_) {}

// ─────────────────────────────────────────────────────────────────────────────
// THE DDA ACCOUNT DECIDES THE APPLICANT
// The account this tab is logged in to, taken only from what DDA itself shows:
// the PAN typed at login, or the read-only PAN on DDA's application form (never
// from the sidebar's choice). Kept in this tab's own storage, which survives an
// app restart just like DDA's session cookie; cleared on DDA's login page.
// ─────────────────────────────────────────────────────────────────────────────
const DDA_PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
function getDdaAccountPan() {
  try {
    const v = (localStorage.getItem("dda_account_pan") || "").toUpperCase().trim();
    return DDA_PAN_RE.test(v) ? v : "";
  } catch (_) {
    return "";
  }
}
function setDdaAccountPan(pan) {
  const clean = String(pan || "").toUpperCase().trim();
  if (!DDA_PAN_RE.test(clean)) return "";
  try { localStorage.setItem("dda_account_pan", clean); } catch (_) {}
  return clean;
}
function clearDdaAccountPan() {
  try { localStorage.removeItem("dda_account_pan"); } catch (_) {}
}
// Testing switch (off by default): lets a different applicant than the DDA account be used.
function differentApplicantAllowed() {
  return currentSettings?.allowDifferentApplicant === true;
}
function applicantPanOf(app) {
  return String(app?.pan || app?.personal?.pan || "").toUpperCase().trim();
}
// Tells the dashboard which DDA account this tab is on, so the sidebar shows that applicant.
// confirmOnly: just which account it is (the sidebar shows it confirmed), no switch asked
function reportDdaAccount(pan, { confirmOnly = false } = {}) {
  if (!DDA_PAN_RE.test(pan || "")) return;
  try { ipcRenderer.send("dda:user-logged-in", { pan, account: true, confirmOnly }); } catch (_) {}
}
// The applicant form must carry the DDA account's own details. When the sidebar
// applicant is someone else, ask the dashboard to switch to the account's
// applicant and wait for it; false when that applicant isn't in the list.
async function ensureApplicantMatchesAccount(accountPan, where) {
  const sidePan = applicantPanOf(currentApplicant);
  if (!accountPan || sidePan === accountPan) return true;
  if (differentApplicantAllowed()) {
    appendRunLog(
      `🧪 Testing switch on: using ${sidePan || "no applicant"}'s details on DDA account ${accountPan} (${where}).`,
      "WARN",
    );
    return true;
  }
  appendRunLog(
    `🔁 DDA is logged in as ${accountPan}, but the sidebar applicant is ${sidePan || "none"} — switching to ${accountPan}'s details.`,
    "WARN",
  );
  window.__ddaAccountNoMatch = "";
  reportDdaAccount(accountPan);
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (applicantPanOf(currentApplicant) === accountPan) {
      const p = currentApplicant?.personal || {};
      const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || accountPan;
      appendRunLog(`✅ Applicant switched to ${name} (${accountPan}), the DDA account's own applicant.`, "SUCCESS");
      return true;
    }
    if (window.__ddaAccountNoMatch === accountPan) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  appendRunLog(
    `⛔ DDA account ${accountPan} has no applicant in your list, so the app stopped here: it will not put ${sidePan || "another person"}'s details on ${accountPan}'s account. Add ${accountPan} to your applicants, or log in with the right DDA account.`,
    "ERROR",
  );
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SCHEME LIST SELECTION & 10-MINUTE CONTINUOUS HUNTING ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function emitAuthenticatedPanIfPresent() {
  try {
    const pendingPan = sessionStorage.getItem("dda_submitting_pan");
    const isFreshLogin =
      sessionStorage.getItem("dda_just_logged_in") === "true" || !!pendingPan;
    let authPan = sessionStorage.getItem("dda_authenticated_pan") || pendingPan;
    if (pendingPan) {
      setDdaAccountPan(pendingPan);
      authPan = pendingPan;
      sessionStorage.setItem("dda_authenticated_pan", pendingPan);
      sessionStorage.removeItem("dda_submitting_pan");
      try {
        localStorage.setItem("dda_last_logged_in_pan", pendingPan);
      } catch (_) {}
    }
    if (!authPan) {
      const panInput = document.querySelector(
        'input#pan, input[name="pan"], input[name="user_id"], input#user_id',
      );
      if (
        panInput &&
        panInput.value &&
        /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(panInput.value.trim())
      ) {
        authPan = panInput.value.trim().toUpperCase();
        sessionStorage.setItem("dda_authenticated_pan", authPan);
        try {
          localStorage.setItem("dda_last_logged_in_pan", authPan);
        } catch (_) {}
      }
    }


    // Only emit IPC if this is a fresh login transition!
    if (authPan && isFreshLogin) {
      sessionStorage.removeItem("dda_just_logged_in");
      window.__ddaLastEmittedPan = authPan;
      window.__ddaUserLoggedInEmitted = true;
      ipcRenderer.send("dda:user-logged-in", { pan: authPan });
      try {
        ipcRenderer.sendToHost("dda:user-logged-in", { pan: authPan });
      } catch (_) {}
    }
    return authPan;
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HIERARCHICAL SUBTREE CACHE & DIRECT STEP 2 URL PRE-RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

const activeDirectUrlResolutions = {};

// A sector written as a range has several spellings for the same sector:
// "SECTOR G-2 & G-6", "G2 - G6", "G2-G6", "G2 & G6", "G-2 AND G-6",
// "A1 TO A4", "A1-A4". sectorRangeKey turns each into the same key
// ("G2 G6", "A1 A4"): the word SECTOR dropped, every letter joined to its
// number, and "&" / AND / TO / "," / "/" / dashes read as separators. Names
// that aren't such a range (BLOCK A, TOWER B, POCKET 3, SECTOR 11) get no key
// and are matched as before. matchBySectorKey accepts only an option with
// exactly the same key, and only when one option has it.
function sectorRangeKey(text) {
  let s = String(text || "").toUpperCase();
  s = s.replace(/\b(SECTOR|SEC)\b\.?/g, " ").replace(/\b(AND|TO)\b/g, " ").replace(/[&,/]/g, " ");
  s = s.replace(/\b([A-Z])\s*[-–—_.]?\s*(\d+)\b/g, "$1$2");
  const parts = s.replace(/[-–—_.]/g, " ").split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.every((p) => /^[A-Z]\d+$/.test(p)) ? parts.join(" ") : "";
}

function matchBySectorKey(options, targetName, nameOf) {
  const key = sectorRangeKey(targetName);
  if (!key || !options || !options.length) return null;
  const hits = options.filter((o) => sectorRangeKey(nameOf(o)) === key);
  return hits.length === 1 ? hits[0] : null;
}

function normalizePrefText(text) {
  if (typeof text !== "string") return "";
  return text
    .trim()
    .replace(/[-_–—/\\.]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function extractPrefNumber(text) {
  const match = String(text || "").match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function toPrefRoman(num) {
  // 1 to 39: I, V and X only, so a block or tower letter (L, C, D, M)
  // is never read as a number
  if (!Number.isInteger(num) || num < 1 || num > 39) return null;
  let out = "";
  for (const [v, r] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) {
    while (num >= v) { out += r; num -= v; }
  }
  return out;
}

function smartMatchPrefOptions(options, targetName) {
  if (!options || !options.length) return null;
  const target = String(targetName || "").trim();
  if (!target) return null;

  const normTarget = normalizePrefText(target);
  const targetNum = extractPrefNumber(target);
  const romanTarget = targetNum ? toPrefRoman(targetNum) : null;

  // 1. Exact match or Normalized match
  let match = options.find(
    (o) => o.name === target || normalizePrefText(o.name) === normTarget,
  );
  if (match) return match;

  // 1b. Same sector range, however it is written ("G-2 & G-6" = "G2 - G6")
  match = matchBySectorKey(options, target, (o) => o.name);
  if (match) return match;

  // Strict Number Constraint: If target specifies a number (e.g. "Pocket 4"), candidate MUST contain number 4 or Roman IV!
  const candidateOptions =
    targetNum !== null
      ? options.filter((o) => {
          const num = extractPrefNumber(o.name);
          const norm = normalizePrefText(o.name);
          return (
            num === targetNum ||
            (romanTarget && norm.split(/[^A-Z0-9]+/).includes(romanTarget))
          );
        })
      : options;

  if (!candidateOptions.length) return null;

  // 2. Strict clean token match (e.g. "BLOCK B" matches "B", "PKT 4" matches "4")
  const cleanTarget = normTarget
    .replace(/\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\b/g, "")
    .trim();
  if (cleanTarget) {
    match = candidateOptions.find((o) => {
      const normOpt = normalizePrefText(o.name);
      const cleanOpt = normOpt
        .replace(/\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\b/g, "")
        .trim();
      return cleanOpt === cleanTarget;
    });
    if (match) return match;
  }

  // 3. Roman Numeral Match (e.g. "Pocket 4" -> IV)
  if (romanTarget) {
    match = candidateOptions.find((o) => {
      const words = normalizePrefText(o.name).split(/[^A-Z0-9]+/);
      return words.includes(romanTarget);
    });
    if (match) return match;
  }

  // 4. Normalized forward includes match (NEVER reverse substring: target cannot be broader than opt)
  match = candidateOptions.find((o) => {
    const normOpt = normalizePrefText(o.name);
    return normOpt.includes(normTarget) || normOpt.startsWith(normTarget);
  });
  if (match) return match;

  // 4. Exact word boundary match
  if (cleanTarget) {
    match = candidateOptions.find((o) => {
      const normOpt = normalizePrefText(o.name);
      const wordRegex = new RegExp(
        "(^|\\s|[^A-Z0-9])" + cleanTarget + "($|\\s|[^A-Z0-9])",
        "i",
      );
      return wordRegex.test(normOpt);
    });
    if (match) return match;
  }

  return null;
}

function parseSelectOptions(rawInput) {
  if (!rawInput) return [];
  const str =
    typeof rawInput === "object"
      ? rawInput.sector ||
        rawInput.pocket ||
        rawInput.block ||
        rawInput.tower ||
        rawInput.data ||
        rawInput.html ||
        rawInput.raw ||
        ""
      : String(rawInput);
  if (!str) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<select>${str}</select>`, "text/html");
  return Array.from(doc.querySelectorAll("option"))
    .map((o) => ({
      hash: o.value.trim(),
      name: o.textContent.trim().toUpperCase(),
    }))
    .filter((o) => o.hash && o.hash !== "0" && !o.name.includes("SELECT"));
}

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC HASH TREE HELPERS (Parent-Child Hierarchy)
// ─────────────────────────────────────────────────────────────────────────────

function findChildNode(container, targetName) {
  if (!container || typeof container !== "object" || !targetName) return null;
  const cleanTarget = String(targetName).trim();
  if (container[cleanTarget]) return container[cleanTarget];
  const upperTarget = cleanTarget.toUpperCase();
  if (container[upperTarget]) return container[upperTarget];
  const normTarget = normalizePrefText(cleanTarget);
  for (const [key, val] of Object.entries(container)) {
    if (
      key.trim().toUpperCase() === upperTarget ||
      normalizePrefText(key) === normTarget
    ) {
      return val;
    }
  }
  return null;
}

function getMasterHashTree() {
  try {
    const raw = localStorage.getItem("dda_scheme_hash_tree");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function resolveSchemeNodeInTree(masterTree, schemeId, schemeName) {
  if (!masterTree || typeof masterTree !== "object" || !schemeId) return null;

  // 1. Direct match by passed schemeName
  if (schemeName) {
    const cleanName = String(schemeName).trim();
    const matched = findChildNode(masterTree, cleanName);
    if (matched && matched[schemeId]) {
      return matched[schemeId];
    }
  }

  // 2. Match by active/selected scheme name in localStorage or active applicant
  const activeName =
    localStorage.getItem("dda_active_scheme_name") ||
    localStorage.getItem("dda_selected_scheme") ||
    localStorage.getItem("dda_target_scheme") ||
    currentApplicant?.preferences?.scheme ||
    "";
  if (activeName) {
    const matched = findChildNode(masterTree, activeName);
    if (matched && matched[schemeId]) {
      return matched[schemeId];
    }
  }

  // 3. Fallback: Search all scheme entries for one that contains this schemeId
  for (const [sName, sNode] of Object.entries(masterTree)) {
    if (sNode && typeof sNode === "object" && sNode[schemeId]) {
      return sNode[schemeId];
    }
  }

  return null;
}

function getHashTreeBranch(schemeId, userPrefs, schemeName) {
  if (!schemeId || !userPrefs) return null;
  const locMap = {
    1: "NARELA",
    2: "ROHINI",
    3: "TODAPUR",
    4: "LOKNAYAKPURAM",
    5: "DWARKA",
    NARELA: "NARELA",
    ROHINI: "ROHINI",
    TODAPUR: "TODAPUR",
    LOKNAYAKPURAM: "LOKNAYAKPURAM",
    DWARKA: "DWARKA",
  };

  const rawLoc =
    userPrefs.TARGET_LOCALITY ||
    userPrefs.LOCALITY ||
    userPrefs.locality ||
    userPrefs.localityName ||
    "1";
  const targetLoc =
    locMap[String(rawLoc).trim().toUpperCase()] || rawLoc || "NARELA";
  const targetSec =
    userPrefs.TARGET_SECTOR ||
    userPrefs.SECTOR ||
    userPrefs.sector ||
    userPrefs.sectorName ||
    "";
  const targetPoc =
    userPrefs.TARGET_POCKET ||
    userPrefs.POCKET ||
    userPrefs.pocket ||
    userPrefs.pocketName ||
    "";
  const targetBlk =
    userPrefs.TARGET_BLOCK ||
    userPrefs.BLOCK ||
    userPrefs.block ||
    userPrefs.blockName ||
    "";
  const targetTwr =
    userPrefs.TARGET_TOWER ||
    userPrefs.TOWER ||
    userPrefs.tower ||
    userPrefs.towerName ||
    "";

  try {
    const masterTree = getMasterHashTree();
    const schemeNode = resolveSchemeNodeInTree(
      masterTree,
      schemeId,
      schemeName,
    );
    if (!schemeNode || !schemeNode.localities) return null;

    const locNode = findChildNode(schemeNode.localities, targetLoc);
    const locHash = locNode?.slug || locNode?.hash || null;
    if (!locHash || locHash === "0") return null;

    let secHash = null;
    let secNode = null;
    if (targetSec && locNode.sectors) {
      secNode = findChildNode(locNode.sectors, targetSec);
      secHash = secNode?.slug || secNode?.hash || null;
    }

    let pocHash = null;
    let pocNode = null;
    if (secNode && targetPoc && secNode.pockets) {
      pocNode = findChildNode(secNode.pockets, targetPoc);
      pocHash = pocNode?.slug || pocNode?.hash || null;
    }

    let blkHash = null;
    let blkNode = null;
    if (pocNode && targetBlk && pocNode.blocks) {
      blkNode = findChildNode(pocNode.blocks, targetBlk);
      blkHash = blkNode?.slug || blkNode?.hash || null;
    }

    let twrHash = null;
    if (blkNode && blkNode.towers) {
      if (targetTwr) {
        const twrNode =
          findChildNode(blkNode.towers, targetTwr) || blkNode.towers["0"];
        twrHash = twrNode?.slug || twrNode?.hash || "0";
      } else if (blkNode.towers["0"]) {
        twrHash = blkNode.towers["0"]?.slug || blkNode.towers["0"]?.hash || "0";
      } else {
        twrHash = "0";
      }
    }

    return {
      locHash,
      secHash,
      pocHash,
      blkHash,
      twrHash,
      targetLoc,
      targetSec,
      targetPoc,
      targetBlk,
      targetTwr,
    };
  } catch (_) {
    return null;
  }
}
window.getHashTreeBranch = getHashTreeBranch;

function getDirectUrlFromTree(schemeId, userPrefs, schemeName) {
  const branch = getHashTreeBranch(schemeId, userPrefs, schemeName);
  if (!branch) return null;

  // Complete step2_form URLs strictly require Locality, Sector, Pocket, and Block
  if (
    !branch.locHash ||
    branch.locHash === "0" ||
    !branch.secHash ||
    branch.secHash === "0" ||
    !branch.pocHash ||
    branch.pocHash === "0" ||
    !branch.blkHash ||
    branch.blkHash === "0"
  ) {
    return null;
  }

  const twrSlug = branch.twrHash || "0";
  return `https://eservices.dda.org.in/user/step2_form/${schemeId}/${branch.locHash}/${branch.secHash}/${branch.pocHash}/${branch.blkHash}/${twrSlug}`;
}
window.getDirectUrlFromTree = getDirectUrlFromTree;

function saveHashTreeBranch(schemeId, data, schemeName) {
  if (!schemeId || !data) return null;
  // Guard: Never save incomplete or invalid branches into the hash tree!
  if (
    !data.locHash ||
    data.locHash === "0" ||
    !data.secHash ||
    data.secHash === "0" ||
    !data.pocHash ||
    data.pocHash === "0" ||
    !data.blkHash ||
    data.blkHash === "0"
  ) {
    return null;
  }

  const locMap = {
    1: "NARELA",
    2: "ROHINI",
    3: "TODAPUR",
    4: "LOKNAYAKPURAM",
    5: "DWARKA",
    NARELA: "NARELA",
    ROHINI: "ROHINI",
    TODAPUR: "TODAPUR",
    LOKNAYAKPURAM: "LOKNAYAKPURAM",
    DWARKA: "DWARKA",
  };

  const rawLoc = data.locality || data.TARGET_LOCALITY || data.LOCALITY || "1";
  const targetLoc =
    locMap[String(rawLoc).trim().toUpperCase()] || rawLoc || "NARELA";
  const targetSec = String(
    data.sector || data.TARGET_SECTOR || data.SECTOR || "",
  ).trim();
  const targetPoc = String(
    data.pocket || data.TARGET_POCKET || data.POCKET || "",
  ).trim();
  const targetBlk = String(
    data.block || data.TARGET_BLOCK || data.BLOCK || "",
  ).trim();
  const targetTwr = String(
    data.tower || data.TARGET_TOWER || data.TOWER || "",
  ).trim();

  // Resolve target scheme name key
  const cleanSchemeName = String(
    data.schemeName ||
      schemeName ||
      localStorage.getItem("dda_active_scheme_name") ||
      localStorage.getItem("dda_selected_scheme") ||
      localStorage.getItem("dda_target_scheme") ||
      currentApplicant?.preferences?.scheme ||
      "DDA Karmayogi Awaas Yojana 2025",
  ).trim();

  // The shared tree in main (step2Tree.js) learns this path too, so the other
  // windows can skip the levels this page already asked DDA for
  try {
    ipcRenderer.send("step2:learned", {
      schemeId: String(schemeId),
      localityHash: data.locHash,
      sectorHash: data.secHash,
      pocketHash: data.pocHash,
      blockHash: data.blkHash,
      towerHash: data.twrHash || "0",
      localityName: targetLoc,
      sectorName: targetSec,
      pocketName: targetPoc,
      blockName: targetBlk,
      towerName: targetTwr,
    });
  } catch (_) {}

  try {
    const masterTree = getMasterHashTree();

    // 1. Level 1: Scheme Name
    if (
      !masterTree[cleanSchemeName] ||
      typeof masterTree[cleanSchemeName] !== "object"
    ) {
      masterTree[cleanSchemeName] = {};
    }
    const schemeNode = masterTree[cleanSchemeName];

    // 2. Level 2: Scheme ID
    if (!schemeNode[schemeId] || typeof schemeNode[schemeId] !== "object") {
      schemeNode[schemeId] = { localities: {} };
    }
    const schemeIdNode = schemeNode[schemeId];
    if (!schemeIdNode.localities) schemeIdNode.localities = {};

    // 3. Level 3: Locality
    const locKey = targetLoc.toUpperCase().trim();
    if (!schemeIdNode.localities[locKey]) {
      schemeIdNode.localities[locKey] = {
        slug: data.locHash,
        sectors: {},
      };
    } else {
      schemeIdNode.localities[locKey].slug = data.locHash;
      if (!schemeIdNode.localities[locKey].sectors) {
        schemeIdNode.localities[locKey].sectors = {};
      }
    }
    const locNode = schemeIdNode.localities[locKey];

    // 4. Level 4: Sector
    const secKey = targetSec.toUpperCase().trim();
    if (!locNode.sectors[secKey]) {
      locNode.sectors[secKey] = {
        slug: data.secHash,
        pockets: {},
      };
    } else {
      locNode.sectors[secKey].slug = data.secHash;
      if (!locNode.sectors[secKey].pockets) {
        locNode.sectors[secKey].pockets = {};
      }
    }
    const secNode = locNode.sectors[secKey];

    // 5. Level 5: Pocket
    const pocKey = targetPoc.toUpperCase().trim();
    if (!secNode.pockets[pocKey]) {
      secNode.pockets[pocKey] = {
        slug: data.pocHash,
        blocks: {},
      };
    } else {
      secNode.pockets[pocKey].slug = data.pocHash;
      if (!secNode.pockets[pocKey].blocks) {
        secNode.pockets[pocKey].blocks = {};
      }
    }
    const pocNode = secNode.pockets[pocKey];

    // 6. Level 6: Block
    const blkKey = targetBlk.toUpperCase().trim();
    if (!pocNode.blocks[blkKey]) {
      pocNode.blocks[blkKey] = {
        slug: data.blkHash,
        towers: {},
      };
    } else {
      pocNode.blocks[blkKey].slug = data.blkHash;
      if (!pocNode.blocks[blkKey].towers) {
        pocNode.blocks[blkKey].towers = {};
      }
    }
    const blkNode = pocNode.blocks[blkKey];

    // 7. Level 7: Tower
    const twrKey = (targetTwr ? targetTwr.toUpperCase().trim() : "") || "0";
    const twrSlug = data.twrHash || "0";
    if (!blkNode.towers[twrKey]) {
      blkNode.towers[twrKey] = {
        slug: twrSlug,
      };
    } else {
      blkNode.towers[twrKey].slug = twrSlug;
    }

    localStorage.setItem("dda_scheme_hash_tree", JSON.stringify(masterTree));

    const directUrl = `https://eservices.dda.org.in/user/step2_form/${schemeId}/${locNode.slug}/${secNode.slug}/${pocNode.slug}/${blkNode.slug}/${twrSlug}`;
    localStorage.setItem("dda_direct_flat_url", directUrl);
    window.__ddaDirectFlatUrl = directUrl;
    console.log(
      `🌲 [Hash Tree Saved] "${cleanSchemeName}" -> ${schemeId} -> ${locKey} -> ${secKey} -> ${pocKey} -> ${blkKey} -> ${twrKey}: ${directUrl}`,
    );
    return directUrl;
  } catch (e) {
    console.warn("⚠️ Failed to save hash tree branch:", e);
    return null;
  }
}
window.saveHashTreeBranch = saveHashTreeBranch;

// A preference DDA does not list (sector / pocket / block / tower) is
// remembered for a short while, so the locality page does not repeat a lookup
// the application form just ran. Short-lived on purpose: DDA can add a block
// or tower when a drop opens, and the locality page's own lookup always checks
// DDA afresh.
const STEP2_NOMATCH_TTL_MS = 2 * 60 * 1000;
function readStep2NoMatch() {
  try { return JSON.parse(sessionStorage.getItem("dda_step2_nomatch") || "{}") || {}; } catch (_) { return {}; }
}
function markStep2NoMatch(key) {
  try {
    const all = readStep2NoMatch();
    all[key] = Date.now();
    sessionStorage.setItem("dda_step2_nomatch", JSON.stringify(all));
  } catch (_) {}
}
function isStep2NoMatch(key) {
  const at = readStep2NoMatch()[key];
  return Boolean(at) && Date.now() - at < STEP2_NOMATCH_TTL_MS;
}
// Same key as resolveStep2DirectUrl builds (null when it would not run).
function step2NoMatchKnown(schemeId, userPrefs) {
  if (!schemeId) return false;
  const locMap = { 1: "NARELA", 2: "ROHINI", 3: "TODAPUR", 4: "LOKNAYAKPURAM", 5: "DWARKA" };
  const prefs = {
    ...(currentApplicant?.location || {}),
    ...(currentApplicant?.preferences || {}),
    ...(userPrefs || {}),
  };
  const rawLoc = prefs.TARGET_LOCALITY || prefs.LOCALITY || prefs.locality || prefs.localityName || "1";
  const targetLoc = locMap[String(rawLoc).trim().toUpperCase()] || rawLoc || "NARELA";
  const pick = (...v) => v.find((x) => x) || "";
  const parts = [
    targetLoc,
    pick(prefs.TARGET_SECTOR, prefs.SECTOR, prefs.sector, prefs.sectorName),
    pick(prefs.TARGET_POCKET, prefs.POCKET, prefs.pocket, prefs.pocketName),
    pick(prefs.TARGET_BLOCK, prefs.BLOCK, prefs.block, prefs.blockName),
    pick(prefs.TARGET_TOWER, prefs.TOWER, prefs.tower, prefs.towerName),
  ];
  if (!parts[1] || !parts[2] || !parts[3]) return false;
  return isStep2NoMatch(`${schemeId}:${parts.map((x) => normalizePrefText(x)).join("|")}`);
}

function resolveStep2DirectUrl(schemeId, userPrefs, options = {}) {
  if (!schemeId) return Promise.resolve(null);

  const locMap = {
    1: "NARELA",
    2: "ROHINI",
    3: "TODAPUR",
    4: "LOKNAYAKPURAM",
    5: "DWARKA",
    NARELA: "NARELA",
    ROHINI: "ROHINI",
    TODAPUR: "TODAPUR",
    LOKNAYAKPURAM: "LOKNAYAKPURAM",
    DWARKA: "DWARKA",
  };

  const prefs = {
    ...(currentApplicant?.location || {}),
    ...(currentApplicant?.preferences || {}),
    ...(userPrefs || {}),
  };

  const rawLoc =
    prefs.TARGET_LOCALITY ||
    prefs.LOCALITY ||
    prefs.locality ||
    prefs.localityName ||
    "1";
  const targetLoc =
    locMap[String(rawLoc).trim().toUpperCase()] || rawLoc || "NARELA";
  const targetSec =
    prefs.TARGET_SECTOR ||
    prefs.SECTOR ||
    prefs.sector ||
    prefs.sectorName ||
    "";
  const targetPoc =
    prefs.TARGET_POCKET ||
    prefs.POCKET ||
    prefs.pocket ||
    prefs.pocketName ||
    "";
  const targetBlk =
    prefs.TARGET_BLOCK || prefs.BLOCK || prefs.block || prefs.blockName || "";
  const targetTwr =
    prefs.TARGET_TOWER || prefs.TOWER || prefs.tower || prefs.towerName || "";

  // Direct step2_form URLs require at least Sector, Pocket, and Block to be specified
  if (!targetSec || !targetPoc || !targetBlk) {
    return Promise.resolve(null);
  }

  const pathKey = [targetLoc, targetSec, targetPoc, targetBlk, targetTwr]
    .map((s) => normalizePrefText(s))
    .join("|");

  const resolutionKey = `${schemeId}:${pathKey}`;

  // 🌲 0ms Tree Lookup: If complete URL already exists in Hash Tree, return immediately!
  const fromTree = getDirectUrlFromTree(schemeId, prefs);
  if (fromTree) {
    localStorage.setItem("dda_direct_flat_url", fromTree);
    window.__ddaDirectFlatUrl = fromTree;
    return Promise.resolve(fromTree);
  }

  // DDA just said a preference is not in its list: do not ask again yet.
  if (isStep2NoMatch(resolutionKey)) return Promise.resolve(null);

  // In-flight promise deduplication
  if (activeDirectUrlResolutions[resolutionKey]) {
    return activeDirectUrlResolutions[resolutionKey];
  }

  const promise = new Promise(async (resolve) => {
    const startTime = Date.now();
    try {
      const csrfToken = getDdaCsrfToken();

      // A DDA error (500, redirect) is a failed request, not an answer: it never
      // counts as "your preference is not in DDA's list" (20 Oct, BKSPS8624K).
      async function postAjax(endpoint, data) {
        const fd = new FormData();
        if (csrfToken) fd.append("_token", csrfToken);
        for (const [k, v] of Object.entries(data)) fd.append(k, v);

        const res = await fetch(
          `https://eservices.dda.org.in/user/${endpoint}`,
          {
            method: "POST",
            body: fd,
            credentials: "include",
            headers: {
              "X-CSRF-TOKEN": csrfToken,
              "X-Requested-With": "XMLHttpRequest",
            },
          },
        );
        if (!res.ok || res.redirected) {
          throw new Error(`DDA answered ${res.status}${res.redirected ? " (redirected)" : ""} on ${endpoint}`);
        }

        const raw = await res.text();
        try {
          return JSON.parse(raw);
        } catch {
          return { raw };
        }
      }
      // DDA sent a real list without the preference: only then "not in DDA's list"
      const noMatch = (level, target, options) => {
        if (!options.length) {
          appendRunLog(`⏸️ Flat page link not built: DDA sent an empty ${level} list (DDA error?).`, "WARN");
          return resolve(null);
        }
        console.warn(`❌ [Pre-Resolver] "${target}" is not in DDA's ${level} list.`, options);
        markStep2NoMatch(resolutionKey);
        return resolve(null);
      };

      const normTwr = normalizePrefText(targetTwr);

      // No CSRF token means this is not a real DDA page (e.g. DDA's "Database
      // Error" page). A POST without it gets the session logged out, so stop.
      if (!csrfToken) {
        appendRunLog("⏸️ Flat page link not built: this page has no DDA token (error page?).", "WARN");
        return resolve(null);
      }

      // ─── 1. LOCALITY ───
      let loc = null;
      try {
        const step1Res = await fetch(
          `https://eservices.dda.org.in/user/step1_form/${schemeId}`,
          { credentials: "include" },
        );
        // DDA failing (500) or sending us elsewhere: don't fall back to guessed
        // hashes and keep posting, just give up on this build.
        if (!step1Res.ok || step1Res.redirected) {
          appendRunLog(`⏸️ Flat page link not built: DDA's locality page answered ${step1Res.status}${step1Res.redirected ? " (redirected)" : ""}.`, "WARN");
          return resolve(null);
        }
        const step1Html = await step1Res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(step1Html, "text/html");
        const locOptions = Array.from(
          doc.querySelectorAll(
            "#locality option, select[name='locality'] option, select option",
          ),
        )
          .map((o) => ({
            hash: o.value.trim(),
            name: o.textContent.trim().toUpperCase(),
          }))
          .filter(
            (o) => o.hash && o.hash !== "0" && !o.name.includes("SELECT"),
          );

        const matched = smartMatchPrefOptions(locOptions, targetLoc);
        if (matched && matched.hash) {
          loc = { hash: matched.hash, name: targetLoc };
        } else {
          // (no guessed locality code: DDA re-codes them, an old one is wrong)
          return noMatch("locality", targetLoc, locOptions);
        }
      } catch (err) {
        appendRunLog(`⏸️ Flat page link not built: DDA's locality page did not answer (${err?.message || err}).`, "WARN");
        return resolve(null);
      }

      // ─── 2. SECTOR ───
      const secRes = await postAjax("searchSector", {
        locality: loc.hash,
        locality_id: loc.hash,
        scheme_id: schemeId,
      });
      const secOptions = parseSelectOptions(secRes);
      const secMatch = smartMatchPrefOptions(secOptions, targetSec);
      if (!secMatch || !secMatch.hash) return noMatch("sector", targetSec, secOptions);
      const sec = { hash: secMatch.hash, name: targetSec };

      // ─── 3. POCKET ───
      const pocRes = await postAjax("searchpocketbysector", {
        locality_id: loc.hash,
        locality: loc.hash,
        sector_id: sec.hash,
        sector: sec.hash,
        scheme_id: schemeId,
      });
      const pocOptions = parseSelectOptions(pocRes);
      const pocMatch = smartMatchPrefOptions(pocOptions, targetPoc);
      if (!pocMatch || !pocMatch.hash || pocMatch.hash === "0") return noMatch("pocket", targetPoc, pocOptions);
      const poc = { hash: pocMatch.hash, name: targetPoc };

      // ─── 4. BLOCK ───
      const blkRes = await postAjax("blockbypocket", {
        locality_id: loc.hash,
        locality: loc.hash,
        sector_id: sec.hash,
        sector: sec.hash,
        pocket_id: poc.hash,
        pocket: poc.hash,
        scheme_id: schemeId,
      });
      const blkOptions = parseSelectOptions(blkRes);
      const blkMatch = smartMatchPrefOptions(blkOptions, targetBlk);
      if (!blkMatch || !blkMatch.hash || blkMatch.hash === "0") return noMatch("block", targetBlk, blkOptions);
      const blk = { hash: blkMatch.hash, name: targetBlk };

      // ─── 5. TOWER ───
      let twr = null;
      if (normTwr) {
        const twrRes = await postAjax("searchtowerbyblock", {
          scheme_id: schemeId,
          locality_id: loc.hash,
          locality: loc.hash,
          sector_id: sec.hash,
          sector: sec.hash,
          pocket_id: poc.hash,
          pocket: poc.hash,
          block_id: blk.hash,
          block: blk.hash,
        });
        const twrOptions = parseSelectOptions(twrRes);
        const twrMatch = smartMatchPrefOptions(twrOptions, targetTwr);
        if (!twrMatch || !twrMatch.hash || twrMatch.hash === "0") return noMatch("tower", targetTwr, twrOptions);
        twr = { hash: twrMatch.hash, name: targetTwr };
      }

      const locSlug = loc.hash;
      const secSlug = sec.hash;
      const pocSlug = poc.hash;
      const blkSlug = blk.hash;
      const twrSlug = twr?.hash || "0";

      const hashes = {
        schemeId: String(schemeId),
        localityHash: locSlug,
        sectorHash: secSlug,
        pocketHash: pocSlug,
        blockHash: blkSlug,
        towerHash: twrSlug,
        localityName: targetLoc,
        sectorName: targetSec,
        pocketName: targetPoc,
        blockName: targetBlk,
        towerName: targetTwr,
      };
      localStorage.setItem("dda_locality_hashes", JSON.stringify(hashes));

      const directUrl = `https://eservices.dda.org.in/user/step2_form/${schemeId}/${locSlug}/${secSlug}/${pocSlug}/${blkSlug}/${twrSlug}`;
      localStorage.setItem("dda_direct_flat_url", directUrl);
      window.__ddaDirectFlatUrl = directUrl;

      // 🌲 Save branch to Hash Tree
      try {
        saveHashTreeBranch(schemeId, {
          locality: targetLoc,
          sector: targetSec,
          pocket: targetPoc,
          block: targetBlk,
          tower: targetTwr,
          locHash: locSlug,
          secHash: secSlug,
          pocHash: pocSlug,
          blkHash: blkSlug,
          twrHash: twrSlug,
        });
      } catch (_) {}

      const duration = Date.now() - startTime;
      ipcRenderer.send("dda:log", {
        level: "SUCCESS",
        pan: currentApplicant?.pan,
        page: "Hash Resolver",
        msg: `⚡ Step 2 Direct URL Built in ${duration}ms: ${directUrl}`,
      });
      console.log(
        `⚡ [DDA Pre-Resolver] Locality Hashes & Direct URL Ready! (${duration}ms) -> ${directUrl}`,
        hashes,
      );
      resolve(directUrl);
    } catch (e) {
      if (
        !e?.message?.includes("Failed to fetch") &&
        e?.name !== "AbortError"
      ) {
        console.warn("⚠️ [DDA Pre-Resolver Note]:", e?.message || e);
      }
      resolve(null);
    } finally {
      delete activeDirectUrlResolutions[resolutionKey];
    }
  });

  activeDirectUrlResolutions[resolutionKey] = promise;
  return promise;
}
window.resolveStep2DirectUrl = resolveStep2DirectUrl;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN-PROCESS STEP 2 PREFETCH BRIDGE
// The Schemes page navigates away the moment the Apply link is captured, which aborts any
// in-page fetch. So the 5-request URL build runs in the main process (see step2Resolver.js)
// and hands back the same localStorage keys resolveStep2DirectUrl() writes. The in-page
// resolver above stays as the fallback.
// ─────────────────────────────────────────────────────────────────────────────
function extractStep2Targets(userPrefs) {
  const locMap = {
    1: "NARELA",
    2: "ROHINI",
    3: "TODAPUR",
    4: "LOKNAYAKPURAM",
    5: "DWARKA",
    NARELA: "NARELA",
    ROHINI: "ROHINI",
    TODAPUR: "TODAPUR",
    LOKNAYAKPURAM: "LOKNAYAKPURAM",
    DWARKA: "DWARKA",
  };
  const prefs = {
    ...(currentApplicant?.location || {}),
    ...(currentApplicant?.preferences || {}),
    ...(userPrefs || {}),
  };
  const rawLoc =
    prefs.TARGET_LOCALITY ||
    prefs.LOCALITY ||
    prefs.locality ||
    prefs.localityName ||
    "1";
  const loc = locMap[String(rawLoc).trim().toUpperCase()] || rawLoc || "NARELA";
  return {
    loc: String(loc),
    sec: String(
      prefs.TARGET_SECTOR || prefs.SECTOR || prefs.sector || prefs.sectorName || "",
    ),
    poc: String(
      prefs.TARGET_POCKET || prefs.POCKET || prefs.pocket || prefs.pocketName || "",
    ),
    blk: String(
      prefs.TARGET_BLOCK || prefs.BLOCK || prefs.block || prefs.blockName || "",
    ),
    twr: String(
      prefs.TARGET_TOWER || prefs.TOWER || prefs.tower || prefs.towerName || "",
    ),
  };
}

// DDA's CSRF token. DDA keeps one token for the whole login session and issues a
// new one at login. Every real DDA page carries it, but its "Database Error"
// page and the login page do not, and an AJAX POST without it gets the session
// logged out. So the last token seen in this window is kept and used whenever
// the current page has none; it is dropped on the login page.

function readPageCsrfToken() {
  try {
    return (
      document
        .querySelector('meta[name="csrf-token"]')
        ?.getAttribute("content") ||
      document.querySelector('input[name="_token"]')?.value ||
      ""
    );
  } catch (_) {
    return "";
  }
}

function isDdaLoginPage() {
  const path = (window.location.pathname || "/").toLowerCase().replace(/\/+$/, "");
  return path === "" || path === "/user" || path === "/user/login";
}

// DDA's static files: the same for every scheme, unchanged since Apr 2023. Main keeps
// them 30 days (onHeadersReceived); the login page re-checks them here at most once a
// day per window, so a warmed window asks DDA for none of them on booking day. Fonts
// are the woff2 files Chromium actually loads; images are the logo, spinner and the
// flat page's building pictures and legend icons.
const DDA_STATIC_FILES = [
  "public/admin/css/bootstrap.min.css",
  "public/admin/css/delhidevelopmentauthority.css",
  "public/admin/css/font-awesome.min.css",
  "public/admin/css/material.css",
  "public/admin/css/animate.min.css",
  "public/front/css/custom.css",
  "public/front/css/first-come.css",
  "public/front/css/jquery-ui.css",
  "public/admin/js/jquery-3.5.1.min.js",
  "public/admin/js/bootstrap.js",
  "public/admin/js/bootstrap-datepicker.min.js",
  "public/admin/js/popper.min.js",
  "public/admin/js/owl.carousel.min.js",
  "public/admin/js/sweetalert.js",
  "public/admin/js/custom.js",
  "public/admin/js/sha.js",
  "public/front/js/jquery-1.12.4.js",
  "public/front/js/jquery-ui.js",
  "public/front/js/jquery.validate.min.js",
  "public/front/js/custom.js",
  "public/front/js/owl.carousel.min.js",
  "public/front/js/popper.min.js",
  "public/admin/fonts/opensans-regular-webfont.woff2",
  "public/admin/fonts/opensans-semibold-webfont.woff2",
  "public/admin/fonts/lato-regular-webfont.woff2",
  "public/admin/fonts/lato-semibold-webfont.woff2",
  "public/admin/fonts/materialdesignicons-webfont.woff2?v=3.6.95",
  "public/admin/fonts/fa-solid-900.woff2",
  "public/admin/fonts/fa-regular-400.woff2",
  "public/admin/fonts/fa-brands-400.woff2",
  "public/admin/images/logo.png",
  "public/admin/images/banner.jpg",
  "public/ddaspin.gif",
  "public/front/images/f-available.png",
  "public/front/images/f-hold.png",
  "public/front/images/f-reserve.png",
  "public/front/images/f-sold.png",
  "public/front/images/empty.png",
  "public/front/images/tower.png",
  // The flat page's legend icons (the legend is hidden, but its <img>s still load)
  "public/front/images/f-available-icon.png",
  "public/front/images/f-sold-icon.png",
  "public/front/images/f-hold-icon.png",
  "public/front/images/f-reserve-icon.png",
];
const DDA_STATIC_WARM_KEY = "dda_static_warmed_at";
const DDA_STATIC_WARM_EVERY_MS = 24 * 60 * 60 * 1000;

// Fills (or re-checks) this window's cache with DDA_STATIC_FILES from the login page:
// 3 at a time, from the page's load event, stopped if the page navigates (login submit).
// Static files only, never /user (that would re-render the login salt).
async function warmDdaStaticFiles() {
  try {
    if (!isDdaHost() || !isDdaLoginPage() || window.__ddaStaticWarmStarted) return;
    window.__ddaStaticWarmStarted = true;
    const last = Number(localStorage.getItem(DDA_STATIC_WARM_KEY) || 0);
    if (last && Date.now() - last < DDA_STATIC_WARM_EVERY_MS) {
      ipcRenderer.send("assets:trace", `skipped (checked ${Math.round((Date.now() - last) / 60000)} min ago)`);
      return;
    }
    const startedAt = Date.now();
    const ctrl = new AbortController();
    window.addEventListener("pagehide", () => ctrl.abort(), { once: true });
    const queue = DDA_STATIC_FILES.slice();
    let ok = 0, downloaded = 0, failed = 0;
    const worker = async () => {
      while (queue.length && !ctrl.signal.aborted) {
        const url = `${window.location.origin}/${queue.shift()}`;
        try {
          // no-cache: DDA answers "unchanged" (304) for a cached file, or sends the new one
          const r = await fetch(url, { cache: "no-cache", credentials: "same-origin", signal: ctrl.signal });
          await r.arrayBuffer();
          if (!r.ok) { failed++; continue; }
          ok++;
          const t = performance.getEntriesByName(url).pop();
          if (t && t.transferSize > t.encodedBodySize) downloaded++;
        } catch (_) {
          if (!ctrl.signal.aborted) failed++;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const total = DDA_STATIC_FILES.length;
    const ms = Date.now() - startedAt;
    if (ctrl.signal.aborted) {
      // Stopped by the login going through: still counts as checked when nothing failed
      // (a file not reached yet is cached the first time a page uses it), otherwise quick
      // logins would re-check everything on every login page.
      if (!failed) localStorage.setItem(DDA_STATIC_WARM_KEY, String(Date.now()));
      ipcRenderer.send("assets:trace", `stopped by navigation after ${ok}/${total}${failed ? `, ${failed} failed` : ", marked checked"} (${ms} ms)`);
      return;
    }
    // A failed file is tried again on the next login page
    if (!failed) localStorage.setItem(DDA_STATIC_WARM_KEY, String(Date.now()));
    ipcRenderer.send(
      "assets:trace",
      `warmed ${ok}/${total} (${downloaded} downloaded, ${ok - downloaded} unchanged${failed ? `, ${failed} failed` : ""}) in ${ms} ms`,
    );
  } catch (_) {}
}

function syncDdaCsrfToken() {
  try {
    if (isDdaLoginPage()) {
      sessionStorage.removeItem("dda_csrf_token");
      return;
    }
    const t = readPageCsrfToken();
    if (t) sessionStorage.setItem("dda_csrf_token", t);
  } catch (_) {}
}

function getDdaCsrfToken() {
  const t = readPageCsrfToken();
  if (t) return t;
  if (isDdaLoginPage()) return "";
  try {
    return sessionStorage.getItem("dda_csrf_token") || "";
  } catch (_) {
    return "";
  }
}

if (typeof window !== "undefined") {
  window.__ddaGetCsrfToken = getDdaCsrfToken;
  runWhenReady(syncDdaCsrfToken);
}

function getStep2CsrfToken() {
  return getDdaCsrfToken();
}

// Fire-and-forget: start the build in the main process (survives navigation)
function prefetchStep2InMain(schemeId, userPrefs) {
  try {
    if (!schemeId) return false;
    // Started as soon as the target scheme's Apply link shows on the schemes page (24 Oct; was
    // form-only from 18 Oct): on 20 Oct the form came 1-4 minutes after Apply, and the link is
    // ready by then. The build runs in main (survives the page leaving) and is shared by every
    // window with the same preferences; the form page joins it.
    const targets = extractStep2Targets(userPrefs);
    if (!targets.sec || !targets.poc || !targets.blk) return false;
    ipcRenderer.send("step2:prefetch", {
      schemeId: String(schemeId),
      targets,
      csrfToken: getStep2CsrfToken(),
    });
    return true;
  } catch (_) {
    return false;
  }
}
window.__ddaPrefetchStep2 = prefetchStep2InMain;

function applyMainResolvedStep2(res) {
  if (!res || !res.url || !res.hashes || !res.hashes.schemeId) return false;
  try {
    localStorage.setItem("dda_locality_hashes", JSON.stringify(res.hashes));
    localStorage.setItem("dda_direct_flat_url", res.url);
    window.__ddaDirectFlatUrl = res.url;
    return true;
  } catch (_) {
    return false;
  }
}

// Synchronous pull of an already-finished main-process build (sub-millisecond IPC)
function adoptMainResolvedStep2(schemeId) {
  try {
    if (!schemeId) return false;
    return applyMainResolvedStep2(
      ipcRenderer.sendSync("step2:getResolved", String(schemeId)),
    );
  } catch (_) {
    return false;
  }
}

// Preferred resolver for pages: join (or start) the main-process build; if it fails or takes
// longer than ~3s, fall back to the in-page resolver. Resolves to the step2_form URL or null.
// The main-process build is shared by every window with the same preferences and asks
// a failed step again, so while it is still running ("pending") this page waits for it
// (up to STEP2_WAIT_MS) rather than sending the same requests to DDA itself.
const STEP2_WAIT_MS = 90000;
function resolveStep2Preferred(schemeId, prefs) {
  const inPageFallback = () => resolveStep2DirectUrl(schemeId, prefs);
  try {
    const targets = extractStep2Targets(prefs);
    if (!schemeId || !targets.sec || !targets.poc || !targets.blk) return inPageFallback();
    const payload = { schemeId: String(schemeId), targets, csrfToken: getStep2CsrfToken() };
    const settle = (res) => {
      if (applyMainResolvedStep2(res)) return res.url;
      if (res?.pending) {
        return ipcRenderer
          .invoke("step2:wait", payload, STEP2_WAIT_MS)
          .then((r) => (applyMainResolvedStep2(r) ? r.url : r?.pending ? null : inPageFallback()))
          .catch(() => inPageFallback());
      }
      return inPageFallback();
    };
    return ipcRenderer
      .invoke("step2:ensure", payload)
      .then(settle)
      .catch(() => inPageFallback());
  } catch (_) {
    return inPageFallback();
  }
}

// Locality page: the moment the background build lands, leave for step2_form (one-shot guard
// shared with the locality page's own jump paths so navigation never fires twice).
function tryJumpFromLocalityOnArrival(res) {
  try {
    if (window.__ddaStep2Jumped) return false;
    const path = (window.location.pathname || "").toLowerCase();
    if (!path.includes("/step1_form")) return false;
    if (!isAutomationRunning || !isDirectUrlJumpEnabled()) return false;
    const schemeId = window.location.pathname.split("/").filter(Boolean).pop();
    if (!schemeId || !res?.url || !res.url.includes("/step2_form/" + schemeId + "/")) return false;
    window.__ddaStep2Jumped = true;
    logAnalyticsStep("step3_locality", "Locality page skipped: flat page link was ready");
    appendRunLog(`🚀 Background link arrived on the locality page, opening flat page: ${res.url}`, "ROUTE");
    window.location.replace(res.url);
    return true;
  } catch (_) {
    return false;
  }
}

// Push from main when a build finishes while this page is alive
try {
  ipcRenderer.on("dda:step2-url-ready", (_e, res) => {
    if (applyMainResolvedStep2(res)) {
      try {
        ipcRenderer.send("dda:log", {
          level: "SUCCESS",
          pan: currentApplicant?.pan,
          page: "Hash Resolver",
          msg: `⚡ Step 2 Direct URL Built in ${res.durationMs}ms (background): ${res.url}`,
        });
      } catch (_) {}
      tryJumpFromLocalityOnArrival(res);
    }
  });
} catch (_) {}

function handleSchemeListPage() {
  // A bounce while an Apply is being re-tried: this page is left at once (see
  // "Apply retry"), so keep this run's logs and timings and start nothing here.
  if (readApplyPending()) {
    console.log("[DDA Schemes] Apply re-try in progress — leaving this page again.");
    return;
  }
  // 🧹 Auto-clear and reset run logs and analytics upon landing on Schemes page (100% Extension Parity)
  try {
    localStorage.removeItem("dda_run_logs");
    localStorage.removeItem("dda_locality_hashes");
    localStorage.removeItem("dda_direct_flat_url");
    delete window.__ddaDirectFlatUrl;
    sessionStorage.removeItem("dda_session_run_logs");
    sessionStorage.removeItem("dda_report_sent_for_run");
    sessionStorage.removeItem("dda_run_analytics_sent");
    localStorage.removeItem("dda_run_analytics_sent");
    localStorage.removeItem("dda_analytics");
    localStorage.removeItem("dda_run_analytics");
    localStorage.removeItem("dda_captcha_attempts");
    sessionStorage.removeItem("dda_captcha_attempts");
    sessionStorage.removeItem("dda_last_dispatched_sig");
    sessionStorage.removeItem("dda_last_dispatched_ts");
  } catch (_) {}
  hasHandledPaymentTimerPage = false;
  loggedMilestones.clear();
  ipcRenderer.send("dda:reset-run-logs", { page: "Schemes" });
  console.log(
    "🏛️ [DDA Portal] Schemes page loaded. Ready for fresh booking run.",
  );

  // ─── SMART AUTHENTICATED USER DETECTION, PASSWORD SAVE, & NAME SCRAPING ───
  try {
    const authPan = emitAuthenticatedPanIfPresent();

    // Check if plaintext password was saved during login submission -> Prompt save password
    const pendingPass = sessionStorage.getItem("dda_submitting_pass");
    if (authPan && pendingPass) {
      sessionStorage.removeItem("dda_submitting_pass");
      ipcRenderer.send("dda:prompt-save-password", {
        pan: authPan,
        password: pendingPass,
      });
      try {
        ipcRenderer.sendToHost("dda:prompt-save-password", {
          pan: authPan,
          password: pendingPass,
        });
      } catch (_) {}
    }

    // Scrape user full name from navbar (e.g. <a id="profile"><i ...></i> Hi, lalita</a>)
    const profileEl = document.querySelector(
      '#profile, .profile-sec a, a.dropdown-toggle[id="profile"]',
    );
    if (profileEl && authPan) {
      const text = profileEl.textContent || "";
      const scrapedName = text
        .replace(/Hi\s*,\s*/i, "")
        .replace(/[\r\n\t]+/g, " ")
        .trim();
      if (
        scrapedName &&
        scrapedName.length > 1 &&
        !scrapedName.toLowerCase().includes("hi")
      ) {
        ipcRenderer.send("dda:update-profile-name", {
          pan: authPan,
          name: scrapedName,
        });
        try {
          ipcRenderer.sendToHost("dda:update-profile-name", {
            pan: authPan,
            name: scrapedName,
          });
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn("⚠️ [DDA Portal] Smart PAN detection notice:", err);
  }

  const getTargetSchemeName = () => {
    // 1. Direct selected scheme from UI dropdown (Extension single source of truth)
    const selected = localStorage.getItem("dda_selected_scheme");
    if (
      selected &&
      !selected.toLowerCase().includes("admin_bypass") &&
      selected.toLowerCase() !== "admin" &&
      selected !== "__live_active_scheme__" &&
      selected !== "__LIVE__"
    ) {
      return selected.trim();
    }
    const activeName = localStorage.getItem("dda_active_scheme_name");
    if (
      activeName &&
      !activeName.toLowerCase().includes("admin_bypass") &&
      activeName.toLowerCase() !== "admin"
    ) {
      return activeName.trim();
    }
    const stored = localStorage.getItem("dda_target_scheme");
    if (
      stored &&
      !stored.toLowerCase().includes("admin_bypass") &&
      stored.toLowerCase() !== "admin"
    ) {
      return stored.trim();
    }
    const rawTarget =
      currentApplicant?.preferences?.scheme ||
      currentApplicant?.location?.scheme ||
      currentApplicant?.scheme ||
      "";
    if (
      rawTarget &&
      !rawTarget.toLowerCase().includes("admin_bypass") &&
      rawTarget.toLowerCase() !== "admin"
    ) {
      return rawTarget.trim();
    }
    try {
      const ddaData = JSON.parse(localStorage.getItem("ddaData") || "{}");
      if (
        ddaData?.targetScheme &&
        !ddaData.targetScheme.toLowerCase().includes("admin_bypass") &&
        ddaData.targetScheme.toLowerCase() !== "admin"
      ) {
        return ddaData.targetScheme.trim();
      }
    } catch (_) {}
    return "";
  };

  const cleanTarget = getTargetSchemeName();
  const normalize = (s) => (s || "").replace(/\s+/g, " ").trim().toUpperCase();
  const targetScheme = normalize(cleanTarget);

  const targetName =
    cleanTarget || currentApplicant?.preferences?.scheme || "Any";
  console.log(
    "🏛️ [DDA Extension] Page: Scheme List (Target: " + targetName + ")",
    { person: currentApplicant?.pan || "Ready", scheme: targetName },
  );
  // Extract live schemes from DOM table on Scheme List page
  try {
    const extracted = [];
    const rows = document.querySelectorAll("table.customtable tbody tr");
    rows.forEach((row) => {
      const el = row.querySelector("b.bluec");
      if (el) {
        const title = (el.textContent || "").trim();
        if (title && title.length > 3 && !extracted.includes(title)) {
          extracted.push(title);
        }
      }
    });
    if (extracted.length > 0) {
      localStorage.setItem("dda_schemes", JSON.stringify(extracted));
      console.log("🏛️ [DDA Portal] Discovered live schemes:", extracted);
    }
  } catch (_) {}
  startSessionHeartbeat();

  // ⚡ Auto Pre-warm target scheme Direct URL on initial Scheme List load
  let activeSchemeId = "";
  try {
    const initialRows = document.querySelectorAll(
      "table.customtable tbody tr, table tbody tr",
    );
    for (const row of initialRows) {
      const el =
        row.querySelector("b.bluec") || row.querySelector(".scheme-title");
      if (isSchemeMatch(el)) {
        const btn = row.querySelector(
          "a.applyBtn, .applyBtn, a[data-url], button, a.btn",
        );
        if (btn) {
          const rawUrl =
            btn.getAttribute("data-url") || btn.getAttribute("href") || "";
          activeSchemeId = rawUrl.split("/").filter(Boolean).pop() || "";
          if (activeSchemeId && activeSchemeId.length >= 4) {
            console.log(
              `🏛️ [DDA Schemes Pre-Warming] Target scheme detected: "${cleanTarget}" (Scheme ID: ${activeSchemeId})`,
            );
            prefetchStep2InMain(
              activeSchemeId,
              currentApplicant?.preferences,
            );
          }
        }
        break;
      }
    }
  } catch (_) {}

  // Wire applicant switcher on Schemes page to update pre-warmed URL
  window.__ddaOnApplicantUpdated = (newApp) => {
    if (activeSchemeId && newApp) {
      prefetchStep2InMain(activeSchemeId, newApp?.preferences);
    }
  };

  // Auto-dismiss "Scheme Has Not Started" SweetAlerts
  const checkAndDismissPopup = () => {
    const popup = document.querySelector(
      ".swal2-popup, .swal-modal, .sweet-alert",
    );
    if (popup) {
      const text = (popup.textContent || "").toUpperCase();
      if (
        text.includes("NOT STARTED") ||
        text.includes("HAS NOT STARTED") ||
        text.includes("STARTING SOON") ||
        text.includes("SCHEME")
      ) {
        const okBtn = popup.querySelector(
          ".swal2-confirm, button.confirm, .swal-button--confirm, button",
        );
        if (okBtn) {
          okBtn.click();
          return true;
        }
      }
    }
    return false;
  };

  const isSchemeMatch = (el) => {
    if (!el || !targetScheme || targetScheme.length < 3) return false;
    const title = normalize(el.textContent);
    return title.includes(targetScheme);
  };

  const scanAndApply = () => {
    const applicantPan = (
      currentApplicant?.pan ||
      currentApplicant?.personal?.pan ||
      ""
    )
      .trim()
      .toUpperCase();
    if (!applicantPan) {
      console.log(
        "⏸️ [DDA Schemes] Cannot apply without an applicant selected.",
      );
      return false;
    }
    checkAndDismissPopup();
    const rows = document.querySelectorAll(
      "table.customtable tbody tr, table tbody tr",
    );
    for (const row of rows) {
      const el =
        row.querySelector("b.bluec") || row.querySelector(".scheme-title");
      if (isSchemeMatch(el)) {
        const btn = row.querySelector(
          "a.applyBtn, .applyBtn, a[data-url], button, a.btn",
        );
        if (btn) {
          const rawUrl =
            btn.getAttribute("data-url") || btn.getAttribute("href") || "";
          if (
            rawUrl &&
            (rawUrl.includes("userApplicationfrom") ||
              rawUrl.includes("applicationform") ||
              rawUrl.includes("step1_form") ||
              rawUrl.includes("/user/"))
          ) {
            // Pre-warm / kick-off resolution immediately
            const sid = rawUrl.split("/").filter(Boolean).pop();
            if (sid) prefetchStep2InMain(sid, currentApplicant?.preferences);

            // Clean hunting state and prior run analytics before navigating
            localStorage.removeItem("dda_timed_hunting_until");
            localStorage.removeItem("dda_timed_mode");
            localStorage.removeItem("dda_timed_attempt_count");
            localStorage.removeItem("dda_captcha_attempts");
            sessionStorage.removeItem("dda_captcha_attempts");
            sessionStorage.removeItem("dda_run_analytics_sent");
            localStorage.removeItem("dda_run_analytics_sent");
            localStorage.removeItem("dda_analytics");
            localStorage.removeItem("dda_run_analytics");
            sessionStorage.removeItem("dda_session_run_logs");
            try {
              localStorage.removeItem("dda_run_logs");
            } catch (_) {}
            loggedMilestones.clear();
            stopSessionHeartbeat();
            ipcRenderer.send("dda:reset-run-logs", { page: "Schemes" });

            appendRunLog(
              `🎯 Manual Apply Initiated: Target Scheme "${cleanTarget || "Target Scheme"}"`,
              "ROUTE",
            );
            logAnalyticsStep(
              "step1_apply",
              `Scheme Apply: ${cleanTarget || "Target Scheme"} (Manual Direct)`,
            );
            appendRunLog(`🚀 Navigating to ${rawUrl}`, "ROUTE");
            markApplyPending(rawUrl);
            window.location.href = rawUrl;
            return true;
          }

          sessionStorage.removeItem("dda_run_analytics_sent");
          localStorage.removeItem("dda_run_analytics_sent");
          localStorage.removeItem("dda_analytics");
          localStorage.removeItem("dda_run_analytics");
          sessionStorage.removeItem("dda_session_run_logs");
          try {
            localStorage.removeItem("dda_run_logs");
          } catch (_) {}
          ipcRenderer.send("dda:reset-run-logs", { page: "Schemes" });
          appendRunLog(
            `🎯 Manual Apply Initiated: Target Scheme "${cleanTarget || "Target Scheme"}"`,
            "ROUTE",
          );
          logAnalyticsStep(
            "step1_apply",
            `Scheme Apply: ${cleanTarget || "Target Scheme"} (Manual Direct)`,
          );
          stopSessionHeartbeat("Manual Apply button clicked");
          btn.click();
          setTimeout(() => {
            const confirmBtn = document.querySelector(
              ".swal2-confirm, button.confirm",
            );
            if (confirmBtn) confirmBtn.click();
          }, 80);
          return true;
        }
      }
    }
    return false;
  };

  // Check if an applicant is selected before executing hunting loop
  const applicantPan = (
    currentApplicant?.pan ||
    currentApplicant?.personal?.pan ||
    ""
  )
    .trim()
    .toUpperCase();
  if (!applicantPan) {
    console.log(
      "⏸️ [DDA Schemes] No applicant selected. Standing by on Schemes page.",
    );
    localStorage.removeItem("dda_timed_hunting_until");
    localStorage.removeItem("dda_timed_mode");
    localStorage.removeItem("dda_timed_attempt_count");
    startSessionHeartbeat();
    window.__ddaForceApply = scanAndApply;
    return;
  }

  // 1-Hour Continuous Search Loop Watchdog
  const huntingUntil = parseInt(
    localStorage.getItem("dda_timed_search_until") ||
      localStorage.getItem("dda_timed_hunting_until") ||
      "0",
    10,
  );
  const isTimedHuntingActive =
    Date.now() < huntingUntil ||
    localStorage.getItem("dda_timed_mode") === "true";

  if (isTimedHuntingActive) {
    // If search loop is already active in window context, do not spawn a duplicate
    if (window.__ddaTimedSearchTimer) {
      return;
    }

    stopSessionHeartbeat(); // Mute heartbeat during continuous search
    let currentAttempt =
      parseInt(localStorage.getItem("dda_timed_attempt_count") || "0", 10) + 1;
    localStorage.setItem("dda_timed_attempt_count", String(currentAttempt));

    const remainingSec = Math.max(
      0,
      Math.round((huntingUntil - Date.now()) / 1000),
    );
    ipcRenderer.send("dda:log", {
      level: "INFO",
      pan: currentApplicant?.pan,
      page: "Timed Search",
      msg: `⚡ Continuous Scheme Search Armed (${remainingSec > 0 ? Math.floor(remainingSec / 60) + "m " + (remainingSec % 60) + "s window" : "active"})...`,
    });

    // 1. Immediate DOM check
    if (scanAndApply()) return;

    // 2. High-Speed Continuous Search (200-250ms interval, until apply button found or stopped)
    if (window.__ddaTimedSearchTimer) {
      clearTimeout(window.__ddaTimedSearchTimer);
      clearInterval(window.__ddaTimedSearchTimer);
      window.__ddaTimedSearchTimer = null;
    }
    if (window.__ddaTimedPoller) {
      clearTimeout(window.__ddaTimedPoller);
      clearInterval(window.__ddaTimedPoller);
      window.__ddaTimedPoller = null;
    }

    // A tick every 250-300 ms (tiered below) sends a check of the schemes page unless one
    // is already waiting. One hung request used to freeze this search (the next check only
    // went out after it ended): now a backup check goes out when the newest one has had no
    // answer for 4 s, at most 3 wait at once, and a check is given up after 20 s. Whichever
    // answer shows the Apply link first wins; with DDA answering within 4 s this is one
    // check at a time, as before. Same rules as the dashboard's TIMED poller.
    const HEDGE_AFTER_MS = 4000;
    const MAX_IN_FLIGHT = 3;
    const CHECK_TIMEOUT_MS = 20000;
    const inFlight = new Set();
    let searchCount = 0;
    let searchFound = false;
    let failStreak = 0;
    let lastFailWarnAt = 0;

    const stopTimers = () => {
      if (window.__ddaTimedSearchTimer) {
        clearTimeout(window.__ddaTimedSearchTimer);
        clearInterval(window.__ddaTimedSearchTimer);
        window.__ddaTimedSearchTimer = null;
      }
      if (window.__ddaTimedPoller) {
        clearTimeout(window.__ddaTimedPoller);
        clearInterval(window.__ddaTimedPoller);
        window.__ddaTimedPoller = null;
      }
    };

    const abortAllChecks = () => {
      for (const c of inFlight) {
        clearTimeout(c.timer);
        try {
          c.ctrl.abort();
        } catch (_) {}
      }
      inFlight.clear();
    };

    const isStopped = () => localStorage.getItem("dda_timed_mode") !== "true";

    const timedLog = (level, msg) =>
      ipcRenderer.send("dda:log", { level, pan: currentApplicant?.pan, page: "Timed Search", msg });

    // Leaving the page (a reload, or the Apply navigation) cuts the waiting checks off:
    // that is not a failure worth a warning
    let leavingPage = false;
    window.addEventListener(
      "pagehide",
      () => {
        leavingPage = true;
        abortAllChecks();
      },
      { once: true },
    );

    const noteCheckFailed = (reason) => {
      if (leavingPage) return;
      failStreak++;
      const now = Date.now();
      // The first failure, then at most one line every 5 s while it lasts
      if (failStreak === 1 || now - lastFailWarnAt >= 5000) {
        lastFailWarnAt = now;
        timedLog("WARN", `⚠️ Scheme check failed (${reason}) — ${failStreak} in a row; still searching`);
      }
    };

    const noteCheckAnswered = () => {
      if (failStreak >= 3) timedLog("INFO", "✅ Scheme checks are getting answers again");
      failStreak = 0;
    };

    // The Apply link in a fetched schemes page: capture it and navigate (once)
    const captureFromHtml = (html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const rows = doc.querySelectorAll("table.customtable tbody tr, table tbody tr");
      for (const row of rows) {
        const el = row.querySelector("b.bluec") || row.querySelector(".scheme-title");
        if (!isSchemeMatch(el)) continue;
        const btn = row.querySelector("a.applyBtn, .applyBtn, a[data-url], button, a.btn");
        const url = btn && (btn.getAttribute("data-url") || btn.getAttribute("href"));
        if (
          !url ||
          !(
            url.includes("userApplicationfrom") ||
            url.includes("applicationform") ||
            url.includes("step1_form") ||
            url.includes("/user/")
          )
        ) {
          continue;
        }
        searchFound = true;
        const sid = url.split("/").filter(Boolean).pop();
        if (sid) prefetchStep2InMain(sid, currentApplicant?.preferences);
        stopTimers();
        abortAllChecks();
        localStorage.removeItem("dda_timed_search_until");
        localStorage.removeItem("dda_timed_hunting_until");
        localStorage.removeItem("dda_timed_mode");
        localStorage.removeItem("dda_timed_attempt_count");
        stopSessionHeartbeat();
        timedLog("SUCCESS", `⚡ Apply button captured on search attempt #${searchCount}! Navigating...`);
        markApplyPending(url);
        window.location.href = url;
        return true;
      }
      return false;
    };

    const launchCheck = () => {
      searchCount++;
      // Periodic log every 25 checks to confirm continuous search
      if (searchCount % 25 === 0) {
        const remSec = Math.max(0, Math.round((huntingUntil - Date.now()) / 1000));
        timedLog(
          "INFO",
          `Searching for target scheme: ${cleanTarget || "active"} #${searchCount} (${remSec > 0 ? Math.floor(remSec / 60) + "m " + (remSec % 60) + "s remaining" : "active"})...`,
        );
      }
      const check = { startedAt: Date.now(), ctrl: new AbortController(), timer: null };
      check.timer = setTimeout(() => {
        try {
          check.ctrl.abort();
        } catch (_) {}
      }, CHECK_TIMEOUT_MS);
      inFlight.add(check);
      fetch(window.location.href, {
        cache: "no-store",
        credentials: "include",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        signal: check.ctrl.signal,
      })
        .then((response) => response.text().then((html) => ({ status: response.status, html })))
        .then(({ status, html }) => {
          if (searchFound || isStopped()) return;
          if (status >= 400) {
            noteCheckFailed(`HTTP ${status}`);
            return;
          }
          noteCheckAnswered();
          captureFromHtml(html);
        })
        .catch(() => {
          if (searchFound || isStopped()) return;
          noteCheckFailed(
            check.ctrl.signal.aborted ? `no answer within ${Math.round(CHECK_TIMEOUT_MS / 1000)} s` : "network error",
          );
        })
        .finally(() => {
          clearTimeout(check.timer);
          inFlight.delete(check);
        });
    };

    // A new check when none is waiting, or a backup when the newest has had no answer for 4 s
    const maybeLaunchCheck = () => {
      if (inFlight.size === 0) return launchCheck();
      if (inFlight.size >= MAX_IN_FLIGHT) return;
      let newest = 0;
      for (const c of inFlight) newest = Math.max(newest, c.startedAt);
      const waited = Date.now() - newest;
      if (waited < HEDGE_AFTER_MS) return;
      timedLog(
        "WARN",
        `⏳ Scheme check: no answer for ${Math.round(waited / 1000)} s — sending a backup check (${inFlight.size + 1} waiting)`,
      );
      launchCheck();
    };

    const searchTick = () => {
      const tickStartedAt = Date.now();
      // Check if user clicked STOP or timer was disarmed
      if (isStopped()) {
        stopTimers();
        abortAllChecks();
        startSessionHeartbeat();
        return;
      }

      // Check if 60-minute safety window elapsed
      if (huntingUntil > 0 && Date.now() > huntingUntil) {
        stopTimers();
        abortAllChecks();
        localStorage.removeItem("dda_timed_search_until");
        localStorage.removeItem("dda_timed_hunting_until");
        localStorage.removeItem("dda_timed_mode");
        localStorage.removeItem("dda_timed_attempt_count");
        startSessionHeartbeat();
        timedLog("WARN", "⏱️ 60-minute search window reached without scheme release. Stopped.");
        return;
      }

      if (searchFound) {
        stopTimers();
        return;
      }

      checkAndDismissPopup();

      // Check visible DOM first
      if (scanAndApply()) {
        searchFound = true;
        stopTimers();
        abortAllChecks();
        return;
      }

      maybeLaunchCheck();

      // Tiered tick period:
      // until T-2s: ~1s | T-2s to T+5min: 250-300ms | T+5min to T+15min: 400-450ms | after T+15min: ~1s
      const targetEpoch = parseInt(localStorage.getItem("dda_timed_target_epoch") || "0", 10) || 0;
      const nowTs = Date.now();
      let targetPeriod;
      if (targetEpoch && nowTs < targetEpoch - 2000) {
        targetPeriod = 1000 + Math.floor(Math.random() * 51);
      } else if (!targetEpoch || nowTs < targetEpoch + 300000) {
        targetPeriod = 250 + Math.floor(Math.random() * 51);
      } else if (nowTs < targetEpoch + 900000) {
        targetPeriod = 400 + Math.floor(Math.random() * 51);
      } else {
        targetPeriod = 1000 + Math.floor(Math.random() * 51);
      }
      const nextDelay = Math.max(0, targetPeriod - (Date.now() - tickStartedAt));
      window.__ddaTimedSearchTimer = setTimeout(searchTick, nextDelay);
      window.__ddaTimedPoller = window.__ddaTimedSearchTimer;
    };

    const initialDelay = 100;
    window.__ddaTimedSearchTimer = setTimeout(searchTick, initialDelay);
    window.__ddaTimedPoller = window.__ddaTimedSearchTimer;
    return;
  }

  // Expose scanAndApply for manual user action on demand
  window.__ddaForceApply = scanAndApply;

  // When timer is NOT active, do NOT auto-apply on page load!
  // Instead, start the silent 30s keep-alive heartbeat and await user command (Manual or Timed)
  startSessionHeartbeat();
  console.log(
    `🏛️ [DDA Portal] Scheme List loaded. Target: "${cleanTarget || "Any"}"`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. STEP 1 LOCALITY (EXACT EXTENSION 1:1 SELECTLOCALITY ENGINE)
// ─────────────────────────────────────────────────────────────────────────────
function handleLocalityPage() {
  stopSessionHeartbeat("On Locality page");
  const rawPrefs = {
    ...(currentApplicant?.location || {}),
    ...(currentApplicant?.preferences || {}),
    locality:
      currentApplicant?.preferences?.locality ||
      currentApplicant?.location?.locality ||
      currentApplicant?.locality ||
      "NARELA",
    sector:
      currentApplicant?.preferences?.sector ||
      currentApplicant?.location?.sector ||
      currentApplicant?.sector ||
      "",
    pocket:
      currentApplicant?.preferences?.pocket ||
      currentApplicant?.location?.pocket ||
      currentApplicant?.pocket ||
      "",
    block:
      currentApplicant?.preferences?.block ||
      currentApplicant?.location?.block ||
      currentApplicant?.block ||
      "",
    tower:
      currentApplicant?.preferences?.tower ||
      currentApplicant?.location?.tower ||
      currentApplicant?.tower ||
      "",
  };

  const locMap = {
    1: "NARELA",
    2: "ROHINI",
    3: "TODAPUR",
    4: "LOKNAYAKPURAM",
    5: "DWARKA",
    NARELA: "NARELA",
    ROHINI: "ROHINI",
    TODAPUR: "TODAPUR",
    LOKNAYAKPURAM: "LOKNAYAKPURAM",
    DWARKA: "DWARKA",
  };
  const rawLoc = rawPrefs.locality
    ? String(rawPrefs.locality).trim().toUpperCase()
    : "1";

  const CONFIG = {
    LOCALITY: locMap[rawLoc] || rawLoc || "NARELA",
    SECTOR: rawPrefs.sector || "",
    POCKET: rawPrefs.pocket || "",
    BLOCK: rawPrefs.block || "",
    TOWER: rawPrefs.tower || "",
  };

  console.log(
    "📍 [DDA Extension] Page: Step 1 (Locality Selection - 0ms Fast Direct Jump)",
    {
      person: currentApplicant?.pan || "Ready",
      locality: CONFIG.LOCALITY,
      sector: CONFIG.SECTOR,
      pocket: CONFIG.POCKET,
      block: CONFIG.BLOCK,
      tower: CONFIG.TOWER,
    },
  );
  console.log("⚡ [Locality Resolution] Triggering Fast Dropdown Cascade...");

  ipcRenderer.send("dda:log", {
    level: "ACTION",
    pan: currentApplicant?.pan,
    page: "Locality",
    msg: `📍 Looking for: ${CONFIG.LOCALITY} › ${CONFIG.SECTOR || "any sector"} › ${CONFIG.POCKET || "any pocket"} › ${CONFIG.BLOCK || "any block"}${CONFIG.TOWER ? " › " + CONFIG.TOWER : ""}`,
  });

  const currentSchemeId = window.location.pathname
    .split("/")
    .filter(Boolean)
    .pop();

  // ─── TIER 1: Check Pre-Resolved Hash / Cached Direct URL (100% Extension Parity) ───
  const directJumpAllowed = isDirectUrlJumpEnabled();
  let directUrl = null;

  if (directJumpAllowed) {
    // 🌲 1. Check Hash Tree First (0ms, 0 Network Calls)
    try {
      const treeUrl = getDirectUrlFromTree(currentSchemeId, CONFIG);
      if (treeUrl) {
        directUrl = treeUrl;
        console.log(
          `🌲 [Locality Tier 1] Hit Hash Tree! Direct URL: ${directUrl}`,
        );
      }
    } catch (_) {}

    if (!directUrl) {
      adoptMainResolvedStep2(currentSchemeId);
      const hashesRaw = localStorage.getItem("dda_locality_hashes");
      const directUrlCached =
        localStorage.getItem("dda_direct_flat_url") || window.__ddaDirectFlatUrl;

      if (hashesRaw) {
        try {
          const hashes = JSON.parse(hashesRaw);
          if (
            hashes &&
            (!hashes.schemeId ||
              String(hashes.schemeId) === String(currentSchemeId)) &&
            hashes.localityHash &&
            hashes.sectorHash &&
            hashes.pocketHash &&
            hashes.blockHash
          ) {
            directUrl = `https://eservices.dda.org.in/user/step2_form/${currentSchemeId || hashes.schemeId}/${hashes.localityHash}/${hashes.sectorHash}/${hashes.pocketHash}/${hashes.blockHash}/${hashes.towerHash || "0"}`;
          } else if (
            hashes &&
            hashes.schemeId &&
            currentSchemeId &&
            String(hashes.schemeId) !== String(currentSchemeId)
          ) {
            console.warn(
              `⚠️ [Locality Direct Jump] Scheme ID mismatch (Cached: ${hashes.schemeId} vs Current: ${currentSchemeId}). Clearing stale cache...`,
            );
            localStorage.removeItem("dda_locality_hashes");
            localStorage.removeItem("dda_direct_flat_url");
            delete window.__ddaDirectFlatUrl;
          }
        } catch (_) {}
      }

      if (
        !directUrl &&
        directUrlCached &&
        directUrlCached.includes(`/step2_form/${currentSchemeId}/`)
      ) {
        directUrl = directUrlCached;
      }
    }

    if (
      directUrl &&
      (!currentSchemeId || directUrl.includes("/step2_form/" + currentSchemeId))
    ) {
      logAnalyticsStep("step3_locality", "Locality page skipped: flat page link was ready");
      appendRunLog(`🚀 Flat page link was ready, opening it: ${directUrl}`, "ROUTE");
      console.log(
        `%c⚡ [Locality Resolution] 100% SUCCESS via 0ms Instant Direct Jump! -> ${directUrl}`,
        "background:#059669; color:#fff; font-weight:bold; padding:4px 8px; border-radius:4px;",
      );
      window.__ddaStep2Jumped = true;
      window.location.replace(directUrl);
      return;
    }
  } else {
    console.log(
      "📍 [Locality Mode] Direct URL Jump is OFF — Using Cascade Dropdown method.",
    );
    appendRunLog(
      "📍 Direct URL Jump is OFF: the flat page link will come from DDA's dropdown lists",
      "INFO",
    );
  }

  // The cascade below runs again (every LIST_RETRY_MS, LIST_RETRY_MAX times)
  // when it stopped only because DDA did not send a dropdown list (500 / no
  // answer): on 20 Oct the app halted there and Search was then clicked by hand
  // with an empty block, so DDA answered "Please select block" and the window
  // sat idle for an hour.
  const LIST_RETRY_MS = 3000;
  const LIST_RETRY_MAX = 40;
  let cascadeRunning = false;
  // True while the app is still getting the lists from DDA; false once it has
  // stopped and left the choice to the user (then a Search click is theirs).
  let waitingForLists = true;
  // Real entries in a dropdown (not the "SELECT" line): some DDA lists have
  // no "SELECT" line, so the number of lines alone says nothing.
  const realOptionCount = (el) =>
    el ? Array.from(el.options).filter((o) => o.value && o.value !== "0" && !/SELECT/i.test(o.text)).length : 0;
  let cascadeAttempt = 0;
  const runCascadeAgain = (why) => {
    if (window.__ddaStep2Jumped || cascadeRunning) return false;
    if (!/\/step1_form\//i.test(window.location.pathname)) return false;
    if (cascadeAttempt >= LIST_RETRY_MAX) {
      appendRunLog(`⚠️ DDA still isn't sending the dropdown lists after ${LIST_RETRY_MAX} tries. Reload the page or pick them by hand.`, "WARN");
      return false;
    }
    if (cascadeAttempt === 1 || cascadeAttempt % 5 === 0) {
      appendRunLog(`🔁 ${why} — asking DDA again every ${LIST_RETRY_MS / 1000}s (#${cascadeAttempt})`, "WARN");
    }
    setTimeout(() => runCascade(), LIST_RETRY_MS);
    return true;
  };
  // Search clicked (by hand) while a list DDA should have sent is still empty:
  // DDA would only answer "Please select …". Hold the click and fetch the list.
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target?.closest?.("#search, button#search, input#search, .searchBtn");
      if (!btn || window.__ddaLocalityAutoSearch || !waitingForLists) return;
      // The first dropdown still without a value decides: only when DDA hasn't
      // sent its list is the click held (a list the user is choosing from by
      // hand never is).
      const levels = [
        ["sector", CONFIG.SECTOR, "#sector, #sector_id, select[name='sector'], select[name='sector_id']"],
        ["pocket", CONFIG.POCKET, "#pocket, #pocket_id, select[name='pocket'], select[name='pocket_id']"],
        ["block", CONFIG.BLOCK, "#block, #block_id, select[name='block'], select[name='block_id']"],
        ["tower", CONFIG.TOWER, "#tower, #tower_id, select[name='tower'], select[name='tower_id']"],
      ].map(([name, want, sel]) => [name, want, document.querySelector(sel)]);
      const missing = levels.find(([, want, el]) => want && el && (!el.value || el.value === "0"));
      if (!missing || realOptionCount(missing[2]) > 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      appendRunLog(`⏳ The ${missing[0]} dropdown isn't filled yet (DDA hasn't sent the lists), so Search would only get "Please select ${missing[0]}". The app keeps asking DDA and clicks Search once every list is in.`, "WARN");
      runCascadeAgain("DDA hasn't sent all the dropdown lists");
    },
    true,
  );

  const runCascade = async () => {
    if (cascadeRunning || window.__ddaStep2Jumped) return;
    cascadeRunning = true;
    cascadeAttempt++;
    let retryWhy = "";
    try {
      function normalizeText(text) {
        if (typeof text !== "string") return "";
        return text.trim().replace(/\s+/g, " ").toUpperCase();
      }

      function extractNumber(text) {
        const match = text.match(/\d+/);
        return match ? parseInt(match[0], 10) : null;
      }

      function toRoman(num) {
        // 1 to 39: I, V and X only, so a block or tower letter (L, C, D, M)
        // is never read as a number
        if (!Number.isInteger(num) || num < 1 || num > 39) return null;
        let out = "";
        for (const [v, r] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) {
          while (num >= v) { out += r; num -= v; }
        }
        return out;
      }

      function smartMatchOptions(options, targetName) {
        if (!options || !options.length) return null;
        const target = String(targetName || "").trim();
        if (!target) return null;

        const normTarget = normalizeText(target);
        const targetNum = extractNumber(target);
        const romanTarget = targetNum ? toRoman(targetNum) : null;

        let match = options.find(
          (o) => o.name === target || normalizeText(o.name) === normTarget,
        );
        if (match) return match;

        // Same sector range, however it is written ("G-2 & G-6" = "G2 - G6")
        match = matchBySectorKey(options, target, (o) => o.name);
        if (match) return match;

        // Strict Number Constraint: If target specifies a number, candidate must match that number!
        const candidateOptions =
          targetNum !== null
            ? options.filter((o) => {
                const num = extractNumber(o.name);
                const norm = normalizeText(o.name);
                return (
                  num === targetNum ||
                  (romanTarget &&
                    norm.split(/[^A-Z0-9]+/).includes(romanTarget))
                );
              })
            : options;

        if (!candidateOptions.length) return null;

        const cleanTarget = normTarget
          .replace(/\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\b/g, "")
          .trim();
        if (cleanTarget) {
          match = candidateOptions.find((o) => {
            const normOpt = normalizeText(o.name);
            const cleanOpt = normOpt
              .replace(
                /\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\b/g,
                "",
              )
              .trim();
            return cleanOpt === cleanTarget;
          });
          if (match) return match;
        }

        // Roman Numeral Match (e.g. "Pocket 4" -> IV)
        if (romanTarget) {
          match = candidateOptions.find((o) => {
            const words = normalizeText(o.name).split(/[^A-Z0-9]+/);
            return words.includes(romanTarget);
          });
          if (match) return match;
        }

        // Forward includes only (never reverse)
        match = candidateOptions.find((o) => {
          const normOpt = normalizeText(o.name);
          return normOpt.includes(normTarget) || normOpt.startsWith(normTarget);
        });
        if (match) return match;

        if (cleanTarget) {
          match = candidateOptions.find((o) => {
            const normOpt = normalizeText(o.name);
            const wordRegex = new RegExp(
              `(^|\\s|[^A-Z0-9])${cleanTarget}($|\\s|[^A-Z0-9])`,
              "i",
            );
            return wordRegex.test(normOpt);
          });
          if (match) return match;
        }
        return null;
      }

      // ─── PARALLEL RACE ENGINE: Path A (Background Resolver) vs Path B (Tier 2 + Tier 3 Cascade) ───
      // After Tier 1 cache miss, both paths run concurrently. First to resolve a valid URL navigates.
      // The loser's in-flight fetch calls are cancelled via AbortController.
      let raceWon = false;
      const cascadeAbort = new AbortController();
      const raceStartTime = Date.now();

      // Path A: Fire-and-forget background resolver running in parallel with cascade (if Direct URL Jump is enabled)
      const pathA = directJumpAllowed
        ? (async () => {
            try {
              if (!currentSchemeId || !CONFIG.SECTOR || !CONFIG.POCKET || !CONFIG.BLOCK) return;
              if (step2NoMatchKnown(currentSchemeId, CONFIG)) {
                appendRunLog("⏭️ Background link builder not started: one of your preferences was not in DDA's list a moment ago", "INFO");
                return;
              }
              const result = await resolveStep2Preferred(currentSchemeId, CONFIG);
              if (result && !raceWon && (!currentSchemeId || result.includes("/step2_form/" + currentSchemeId))) {
                raceWon = true;
                cascadeAbort.abort();
                const elapsed = Date.now() - raceStartTime;
                logAnalyticsStep("step3_locality", "Locality page skipped: background link builder was first");
                appendRunLog(`🏆 Background link builder was first (${elapsed}ms), opening flat page: ${result}`, "ROUTE");
                console.log(
                  `%c🏆 [Locality Race] Path A WON in ${elapsed}ms — Background resolver beat cascade!`,
                  "background:#059669; color:#fff; font-weight:bold; padding:4px 8px; border-radius:4px;",
                );
                ipcRenderer.send("dda:log", {
                  level: "SUCCESS",
                  pan: currentApplicant?.pan,
                  page: "Locality Race",
                  msg: `🏆 Flat page link built in the background in ${elapsed}ms, opening it: ${result}`,
                });
                if (!window.__ddaStep2Jumped) {
                  window.__ddaStep2Jumped = true;
                  window.location.replace(result);
                }
              }
            } catch (_) {
              // Path A failed silently, Path B continues uninterrupted
            }
          })()
        : null;

      if (directJumpAllowed && currentSchemeId && CONFIG.SECTOR && CONFIG.POCKET && CONFIG.BLOCK) {
        appendRunLog(`🏁 Getting the flat page link two ways at once (background builder and DDA's dropdown lists); the first one is used`, "INFO");
      } else if (!directJumpAllowed) {
        appendRunLog(`⚡ Asking DDA's dropdown lists for the sector, pocket, block and tower codes`, "INFO");
      }

      // Option lists fetched by Tier 2, kept so Tier 3 can show them without
      // asking DDA again. Each list is only valid under the parent it was
      // fetched for.
      const tier2Lists = {};
      const keepTier2List = (level, res, parent) => {
        const html = res && typeof res[level] === "string" ? res[level] : "";
        if (html && parent) tier2Lists[level] = { html, parent: String(parent) };
      };

      // Path B: Cascade (Tier 2 AJAX waterfall → Tier 3 DOM cascade) with race gate
      // ─── TIER 2: Fast In-Page AJAX Waterfall Solver with Tree Reuse (Roadmap 5C.6) ───
      if (currentSchemeId && CONFIG.SECTOR && CONFIG.POCKET && CONFIG.BLOCK) {
        try {
          const csrfToken = getDdaCsrfToken();
          // A POST to DDA without its token gets the session logged out (11 Oct): never send one.
          // DDA's own dropdowns (Tier 3 below) still work, with DDA's own token handling.
          if (!csrfToken) {
            appendRunLog("⏸️ Dropdown codes not asked directly: this page has no DDA token. Using DDA's own dropdowns.", "WARN");
            throw new Error("no DDA token on this page");
          }

          function parseAjaxOptions(rawInput) {
            if (!rawInput) return [];
            const str =
              typeof rawInput === "object"
                ? rawInput.sector ||
                  rawInput.pocket ||
                  rawInput.block ||
                  rawInput.tower ||
                  rawInput.data ||
                  rawInput.html ||
                  rawInput.raw ||
                  ""
                : String(rawInput);
            if (!str) return [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(
              `<select>${str}</select>`,
              "text/html",
            );
            return Array.from(doc.querySelectorAll("option"))
              .map((o) => ({
                hash: o.value.trim(),
                name: o.textContent.trim().toUpperCase(),
              }))
              .filter(
                (o) => o.hash && o.hash !== "0" && !o.name.includes("SELECT"),
              );
          }

          // One list from DDA. A DDA error (500), no answer or an empty list is
          // asked again (3 tries); a redirect stops (session / scheme trouble).
          async function postLocalityAjax(endpoint, data) {
            let lastErr;
            for (let i = 1; i <= 3; i++) {
              if (cascadeAbort.signal.aborted) throw new Error("aborted");
              try {
                const fd = new FormData();
                if (csrfToken) fd.append("_token", csrfToken);
                for (const [k, v] of Object.entries(data)) fd.append(k, v);
                const res = await fetch(
                  `https://eservices.dda.org.in/user/${endpoint}`,
                  {
                    method: "POST",
                    body: fd,
                    credentials: "include",
                    signal: AbortSignal.any([cascadeAbort.signal, AbortSignal.timeout(15000)]),
                    headers: {
                      "X-CSRF-TOKEN": csrfToken,
                      "X-Requested-With": "XMLHttpRequest",
                    },
                  },
                );
                if (res.redirected) throw Object.assign(new Error(`${endpoint} redirected`), { final: true });
                if (!res.ok) throw new Error(`DDA answered ${res.status} on ${endpoint}`);
                const text = await res.text();
                let out;
                try { out = JSON.parse(text); } catch { out = { raw: text }; }
                if (!parseAjaxOptions(out).length) throw new Error(`empty list from ${endpoint}`);
                return out;
              } catch (err) {
                lastErr = err;
                if (err?.final || cascadeAbort.signal.aborted) throw err;
                if (i < 3) await new Promise((r) => setTimeout(r, 1000 * i));
              }
            }
            throw lastErr;
          }

          // 🌲 Check partial branch from Hash Tree for reuse
          const partialBranch = getHashTreeBranch(currentSchemeId, CONFIG);

          // 1. Locality Hash (Hash Tree reuse or DOM extraction)
          let locHash = partialBranch?.locHash;
          if (!locHash || locHash === "0") {
            const localityEl = document.getElementById("locality");
            locHash = localityEl?.value;
            if (!locHash || locHash === "0") {
              const locOptions = Array.from(localityEl?.options || [])
                .map((o) => ({
                  hash: o.value.trim(),
                  name: o.textContent.trim().toUpperCase(),
                }))
                .filter(
                  (o) => o.hash && o.hash !== "0" && !o.name.includes("SELECT"),
                );
              const matched = smartMatchOptions(locOptions, CONFIG.LOCALITY);
              if (matched && matched.hash) {
                locHash = matched.hash;
              }
            }
            // No guessed locality code (DDA re-codes them): DDA's own dropdowns below
            if (!locHash || locHash === "0") throw new Error(`Locality "${CONFIG.LOCALITY}" not on this page`);
          }

          // 2. Sector Hash (Hash Tree reuse or AJAX)
          let secHash = partialBranch?.secHash;
          if (!secHash || secHash === "0") {
            const secRes = await postLocalityAjax("searchSector", {
              locality: locHash,
              scheme_id: currentSchemeId,
            });
            keepTier2List("sector", secRes, locHash);
            const secOpts = parseAjaxOptions(secRes);
            const secMatch = smartMatchOptions(secOpts, CONFIG.SECTOR);
            secHash = secMatch?.hash || "0";
            if (!secHash || secHash === "0") {
              throw new Error(`Sector "${CONFIG.SECTOR}" not matched in AJAX`);
            }
          }

          // 3. Pocket Hash (Hash Tree reuse or AJAX)
          let pocHash = partialBranch?.pocHash;
          if (!pocHash || pocHash === "0") {
            const pocRes = await postLocalityAjax("searchpocketbysector", {
              locality_id: locHash,
              locality: locHash,
              sector_id: secHash,
              sector: secHash,
              scheme_id: currentSchemeId,
            });
            keepTier2List("pocket", pocRes, secHash);
            const pocOpts = parseAjaxOptions(pocRes);
            const pocMatch = smartMatchOptions(pocOpts, CONFIG.POCKET);
            pocHash = pocMatch?.hash || "0";
            if (!pocHash || pocHash === "0") {
              throw new Error(`Pocket "${CONFIG.POCKET}" not matched in AJAX`);
            }
          }

          // 4. Block Hash (Hash Tree reuse or AJAX)
          let blkHash = partialBranch?.blkHash;
          if (!blkHash || blkHash === "0") {
            const blkRes = await postLocalityAjax("blockbypocket", {
              locality_id: locHash,
              locality: locHash,
              sector_id: secHash,
              sector: secHash,
              pocket_id: pocHash,
              pocket: pocHash,
              scheme_id: currentSchemeId,
            });
            keepTier2List("block", blkRes, pocHash);
            const blkOpts = parseAjaxOptions(blkRes);
            const blkMatch = smartMatchOptions(blkOpts, CONFIG.BLOCK);
            blkHash = blkMatch?.hash || "0";
            if (!blkHash || blkHash === "0") {
              throw new Error(`Block "${CONFIG.BLOCK}" not matched in AJAX`);
            }
          }

          // 5. Tower Hash (Hash Tree reuse or AJAX)
          let twrHash = partialBranch?.twrHash || "0";
          if (CONFIG.TOWER && (!twrHash || twrHash === "0")) {
            const twrRes = await postLocalityAjax("searchtowerbyblock", {
              scheme_id: currentSchemeId,
              locality_id: locHash,
              locality: locHash,
              sector_id: secHash,
              sector: secHash,
              pocket_id: pocHash,
              pocket: pocHash,
              block_id: blkHash,
              block: blkHash,
            });
            keepTier2List("tower", twrRes, blkHash);
            const twrOpts = parseAjaxOptions(twrRes);
            const twrMatch = smartMatchOptions(twrOpts, CONFIG.TOWER);
            twrHash = twrMatch?.hash || "0";
            if (!twrHash || twrHash === "0") {
              throw new Error(`Tower "${CONFIG.TOWER}" not matched in AJAX`);
            }
          }

          const directAjaxUrl = `https://eservices.dda.org.in/user/step2_form/${currentSchemeId}/${locHash}/${secHash}/${pocHash}/${blkHash}/${twrHash}`;

          // 🌲 Save verified branch to Hash Tree for future 0ms direct jumps!
          try {
            saveHashTreeBranch(currentSchemeId, {
              locality: CONFIG.LOCALITY,
              sector: CONFIG.SECTOR,
              pocket: CONFIG.POCKET,
              block: CONFIG.BLOCK,
              tower: CONFIG.TOWER,
              locHash: locHash,
              secHash: secHash,
              pocHash: pocHash,
              blkHash: blkHash,
              twrHash: twrHash,
            });
          } catch (_) {}

          // Race gate: check if Path A already won
          if (raceWon) return;
          raceWon = true;

          try {
            localStorage.removeItem("dda_direct_flat_url");
            delete window.__ddaDirectFlatUrl;
          } catch (_) {}

          const t2Elapsed = Date.now() - raceStartTime;
          ipcRenderer.send("dda:log", {
            level: "SUCCESS",
            pan: currentApplicant?.pan,
            page: "Locality Step 1",
            msg: `🏆 Flat page link built from DDA's dropdown lists in ${t2Elapsed}ms: ${directAjaxUrl}`,
          });
          appendRunLog(`🏆 Dropdown lists were first (${t2Elapsed}ms), opening flat page`, "ROUTE");
          logAnalyticsStep("step3_locality", `Locality: flat page link built from dropdown lists (${t2Elapsed}ms)`);
          console.log(
            `%c🏆 [Locality Race] Path B (Tier 2) WON in ${t2Elapsed}ms — Cascade AJAX beat background resolver!`,
            "background:#2563eb; color:#fff; font-weight:bold; padding:4px 8px; border-radius:4px;",
          );
          if (!window.__ddaStep2Jumped) {
            window.__ddaStep2Jumped = true;
            window.location.replace(directAjaxUrl);
          }
          return;
        } catch (ajaxErr) {
          console.warn(
            "Tier 2 AJAX waterfall note, falling back to DOM cascade:",
            ajaxErr.message || ajaxErr,
          );
        }
      }

      // Race gate: if Path A won during Tier 2 execution (AbortError), skip Tier 3 entirely
      if (raceWon) return;

      function smartMatch(selectElement, targetText) {
        if (!selectElement || !targetText) return null;

        const normalizedTarget = normalizeText(targetText);
        if (!normalizedTarget) return null;

        const shortTarget = normalizedTarget
          .replace(/\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\b/g, "")
          .trim();
        const num = extractNumber(normalizedTarget);
        const roman = num ? toRoman(num) : null;

        const validOptions = Array.from(selectElement.options).filter(
          (o) =>
            o.value &&
            o.value !== "0" &&
            !o.text.toUpperCase().includes("SELECT"),
        );
        if (validOptions.length === 0) return null;

        // Same sector range, however it is written ("G-2 & G-6" = "G2 - G6")
        const bySectorKey = matchBySectorKey(validOptions, targetText, (o) => o.text);
        if (bySectorKey) return bySectorKey;

        // Strict Number Constraint: If target specifies a number (e.g. "Pocket 4"), candidate MUST contain number 4 or Roman IV!
        const candidateOptions =
          num !== null
            ? validOptions.filter((opt) => {
                const text = normalizeText(opt.text);
                const optNum = extractNumber(text);
                const words = text.split(/[^A-Z0-9]+/);
                return optNum === num || (roman && words.includes(roman));
              })
            : validOptions;

        if (candidateOptions.length === 0) return null;

        // 1. Strict Exact or Clean Token Match (e.g. "BLOCK A" === "BLOCK A", or "A" === "A", or "4" === "4")
        let match = candidateOptions.find((opt) => {
          const text = normalizeText(opt.text);
          const optClean = text
            .replace(
              /\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\b/g,
              "",
            )
            .trim();
          return (
            text === normalizedTarget ||
            (shortTarget && optClean === shortTarget)
          );
        });
        if (match) return match;

        // 2. Strict Number Match if numbers are present (e.g. "PKT 4" vs "POCKET 4" -> 4 === 4; NEVER match 7!)
        if (num !== null) {
          match = candidateOptions.find((opt) => {
            const text = normalizeText(opt.text);
            const optNum = extractNumber(text);
            return optNum !== null && optNum === num;
          });
          if (match) return match;
        }

        // 3. Roman Numeral Match (e.g. "Pkt 4" -> IV)
        if (roman) {
          match = candidateOptions.find((opt) => {
            const text = normalizeText(opt.text);
            const words = text.split(/[^A-Z0-9]+/);
            return words.includes(roman);
          });
          if (match) return match;
        }

        // 4. Exact Word Boundary Match
        if (shortTarget) {
          match = candidateOptions.find((opt) => {
            const text = normalizeText(opt.text);
            return (
              text.endsWith(" " + shortTarget) ||
              text.startsWith(shortTarget + " ") ||
              text.includes(" " + shortTarget + " ")
            );
          });
          if (match) return match;
        }

        // 5. Normalized prefix/suffix match (safe unidirectional)
        match = candidateOptions.find((opt) => {
          const text = normalizeText(opt.text);
          return (
            text.startsWith(normalizedTarget) || text.includes(normalizedTarget)
          );
        });
        return match || null;
      }

      function waitForOptions(selectEl, timeoutMs = 3500) {
        return new Promise((resolve) => {
          if (!selectEl) return resolve(false);
          if (selectEl.options.length > 1) return resolve(true);

          let timeoutTimer = null;
          const obs = new MutationObserver(() => {
            if (selectEl.options.length > 1) {
              if (timeoutTimer) clearTimeout(timeoutTimer);
              obs.disconnect();
              resolve(true);
            }
          });
          obs.observe(selectEl, { childList: true });

          timeoutTimer = setTimeout(() => {
            obs.disconnect();
            resolve(selectEl.options.length > 1);
          }, timeoutMs);
        });
      }

      function selectLocalityByText(selectEl, text) {
        if (!selectEl) return false;
        const target = normalizeText(text);
        const opt = Array.from(selectEl.options).find(
          (o) =>
            normalizeText(o.text) === target ||
            normalizeText(o.text).includes(target) ||
            target.includes(normalizeText(o.text)),
        );
        if (opt) {
          // No change event: it would run DDA's loader, which loadLevel runs once.
          selectEl.value = opt.value;
          return true;
        }
        return false;
      }

      // Fill a dropdown's list once: from the list Tier 2 already fetched for
      // this same parent (no request), else with DDA's own loader. DDA's
      // loaders are synchronous and freeze the page, so they must never run
      // twice (a change event would run them again).
      function loadLevel(selectEl, level, parentEl, loaderName) {
        if (!selectEl || !parentEl) return;
        const cached = tier2Lists[level];
        if (cached && cached.parent === String(parentEl.value || "")) {
          selectEl.innerHTML = cached.html;
          return;
        }
        const loader = window[loaderName];
        if (typeof loader === "function") {
          try { loader(parentEl, -1); } catch (_) {}
        } else {
          parentEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      async function selectSmartSilent(selectEl, value) {
        if (!selectEl || !value) return false;
        await waitForOptions(selectEl);
        const match = smartMatch(selectEl, value);
        if (match) {
          selectEl.value = match.value;
          return true;
        }
        return false;
      }

      // ─── TIER 3: Live UI Cascade (Exact Extension Engine + Robust Selectors) ───────────────────
      const locality =
        document.getElementById("locality") ||
        document.querySelector("select[name='locality'], select#locality");
      const sector =
        document.getElementById("sector") ||
        document.getElementById("sector_id") ||
        document.querySelector(
          "select[name='sector'], select[name='sector_id']",
        );
      const pocket =
        document.getElementById("pocket") ||
        document.getElementById("pocket_id") ||
        document.querySelector(
          "select[name='pocket'], select[name='pocket_id']",
        );
      const block =
        document.getElementById("block") ||
        document.getElementById("block_id") ||
        document.querySelector("select[name='block'], select[name='block_id']");
      const tower =
        document.getElementById("tower") ||
        document.getElementById("tower_id") ||
        document.querySelector("select[name='tower'], select[name='tower_id']");

      if (locality && locality.options && locality.options.length <= 1) {
        await waitForOptions(locality, 2500);
      }

      console.log("   ↳ Step 1: Selecting Locality ->", CONFIG.LOCALITY);
      const locOk = selectLocalityByText(locality, CONFIG.LOCALITY);
      loadLevel(sector, "sector", locality, "get_sector");

      let secOk = false;
      const targetSec = CONFIG.SECTOR;
      if (targetSec) {
        console.log("   ↳ Step 2: Waiting & Selecting Sector ->", targetSec);
        secOk = await selectSmartSilent(sector, targetSec);
        if (secOk) loadLevel(pocket, "pocket", sector, "getpocket");
      }

      let pocOk = false;
      const targetPoc = CONFIG.POCKET;
      if (secOk && targetPoc) {
        console.log("   ↳ Step 3: Waiting & Selecting Pocket ->", targetPoc);
        pocOk = await selectSmartSilent(pocket, targetPoc);
        if (pocOk) loadLevel(block, "block", pocket, "getblock");
      }

      let blkOk = false;
      const targetBlk = CONFIG.BLOCK;
      if (pocOk && targetBlk) {
        console.log("   ↳ Step 4: Waiting & Selecting Block ->", targetBlk);
        blkOk = await selectSmartSilent(block, targetBlk);
        if (blkOk) loadLevel(tower, "tower", block, "gettower");
      }

      let twrOk = false;
      const targetTwr = CONFIG.TOWER;
      if (blkOk && targetTwr) {
        console.log("   ↳ Step 5: Waiting & Selecting Tower ->", targetTwr);
        twrOk = await selectSmartSilent(tower, targetTwr);
      }

      // Strict validation: Sector MUST have a selected non-zero value before clicking search!
      const sectorValue = sector?.value;
      const isSectorSelected =
        sectorValue && sectorValue !== "0" && sectorValue !== "";
      const isPocketSatisfied =
        !targetPoc || (pocOk && pocket?.value && pocket?.value !== "0");
      const isBlockSatisfied =
        !targetBlk || (blkOk && block?.value && block?.value !== "0");
      const isTowerSatisfied =
        !targetTwr || (twrOk && tower?.value && tower?.value !== "0");

      if (
        locOk &&
        isSectorSelected &&
        isPocketSatisfied &&
        isBlockSatisfied &&
        isTowerSatisfied
      ) {
        ipcRenderer.send("dda:log", {
          level: "SUCCESS",
          pan: currentApplicant?.pan,
          page: "Locality Step 1",
          msg: `✅ All dropdowns filled on screen with your preferences, clicking Search...`,
        });

        // Save successfully verified branch to Hash Tree for future 0ms direct jumps!
        try {
          if (
            currentSchemeId &&
            sector?.value &&
            pocket?.value &&
            block?.value
          ) {
            saveHashTreeBranch(currentSchemeId, {
              locality: CONFIG.LOCALITY,
              sector: CONFIG.SECTOR,
              pocket: CONFIG.POCKET,
              block: CONFIG.BLOCK,
              tower: CONFIG.TOWER,
              locHash: locality?.value || "1LmWKYBo",
              secHash: sector.value,
              pocHash: pocket.value,
              blkHash: block.value,
              twrHash: tower?.value || "0",
            });
          }
        } catch (_) {}

        // Race gate: check if Path A already won before submitting search
        if (raceWon) return;
        raceWon = true;

        const t3Elapsed = Date.now() - raceStartTime;
        appendRunLog(`🏆 Dropdowns filled on screen in ${t3Elapsed}ms, clicking Search`, "ROUTE");
        console.log(
          `%c🏆 [Locality Race] Path B (Tier 3) WON in ${t3Elapsed}ms — DOM cascade beat background resolver!`,
          "background:#7c3aed; color:#fff; font-weight:bold; padding:4px 8px; border-radius:4px;",
        );
        ipcRenderer.send("dda:log", {
          level: "SUCCESS",
          pan: currentApplicant?.pan,
          page: "Locality Race",
          msg: `🏆 Dropdowns filled on screen in ${t3Elapsed}ms, Search clicked`,
        });

        setTimeout(() => {
          if (window.__ddaStep2Jumped) return; // the link arrived meanwhile
          const searchBtn =
            document.getElementById("search") ||
            document.querySelector(
              "button#search, input#search, .searchBtn, button[type='submit']",
            );
          if (searchBtn) {
            logAnalyticsStep("step3_locality", "Locality: Search clicked after filling dropdowns");
            window.__ddaLocalityAutoSearch = true;
            try { searchBtn.click(); } finally { window.__ddaLocalityAutoSearch = false; }
          }
        }, 300);
      } else {
        // The first dropdown that couldn't be filled decides: a list DDA didn't
        // send (empty) is asked for again; a list DDA sent without the
        // preference is left to the user. (The lists after it are empty only
        // because nothing above them could be picked.)
        // (judged by the app's own match: a dropdown can show a value the
        // browser picked by itself when DDA's list has no "SELECT" line)
        const firstStuck = [
          [CONFIG.SECTOR, sector, secOk && isSectorSelected, "sector"],
          [targetPoc, pocket, isPocketSatisfied, "pocket"],
          [targetBlk, block, isBlockSatisfied, "block"],
          [targetTwr, tower, isTowerSatisfied, "tower"],
        ].find(([want, , ok]) => want && !ok);
        if (firstStuck && realOptionCount(firstStuck[1]) === 0) {
          retryWhy = `DDA didn't send the ${firstStuck[3]} list`;
        } else {
          waitingForLists = false;
          ipcRenderer.send("dda:log", {
            level: "WARN",
            pan: currentApplicant?.pan,
            page: "Locality Step 1",
            msg: `⚠️ Dropdown cascade halted: Sector ${isSectorSelected ? "OK" : "Waiting"}, Pocket ${isPocketSatisfied ? "OK" : "Not Found"}, Block ${isBlockSatisfied ? "OK" : "Not Found"}. Halting for manual user selection.`,
          });
        }
      }
    } catch (err) {
      console.error("Locality cascade error:", err);
    } finally {
      cascadeRunning = false;
    }
    if (retryWhy) runCascadeAgain(retryWhy);
  };
  runWhenReady(() => runCascade());
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. STEP 2 FLAT SELECT & RESERVATION (300MS IN-MEMORY POLLER + 0MS DOM SYNC)
// ─────────────────────────────────────────────────────────────────────────────
function handleStep2FlatPage() {
  stopSessionHeartbeat("On Step 2 Flat page");
  console.log("🏠 [DDA Electron] Step 2 Flat Select active");

  // Early warning: look at this page's own captcha once it has loaded (a local check, nothing is
  // sent to DDA). If it isn't DDA's usual kind, the user hears now, and the reservation goes
  // straight to DDA's popup when a flat is found (executeDirectInner reads the flag).
  (() => {
    let checked = false;
    const findImg = () =>
      document.querySelector(
        'img#captchaimg, img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
      );
    const check = async () => {
      if (checked || window.__ddaCaptchaLooksDifferent) return;
      const img = findImg();
      if (!img || !img.complete || !img.naturalWidth) return;
      checked = true;
      const sizeDiff = captchaDifference(img);
      if (sizeDiff) {
        noteCaptchaLooksDifferent(sizeDiff);
        return;
      }
      try {
        const { floatArray } = await extractCaptchaTensor(img);
        const resp = await ipcRenderer.invoke("captcha:solveLocal", {
          floatArray: Array.from(floatArray),
          pan: currentApplicant?.pan,
        });
        noteCaptchaLooksDifferent(captchaDifference(img, resp));
      } catch (_) {}
    };
    runWhenReady(() => {
      check();
      try { findImg()?.addEventListener("load", check, { once: true }); } catch (_) {}
      setTimeout(check, 1500);
    });
  })();

  // 🧹 100% Extension Parity: Wipe locality hashes and direct flat url so state is never stale
  try {
    localStorage.removeItem("dda_locality_hashes");
    localStorage.removeItem("dda_direct_flat_url");
    delete window.__ddaDirectFlatUrl;
  } catch (_) {}

  // Helper to parse target flats (handles arrays, comma-separated strings, single numbers)
  const parseTargetFlats = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw
        .flatMap((f) => String(f).split(","))
        .map((f) => f.trim().toUpperCase())
        .filter(Boolean);
    }
    if (typeof raw === "string") {
      return raw
        .split(",")
        .map((f) => f.trim().toUpperCase())
        .filter(Boolean);
    }
    return [String(raw).trim().toUpperCase()].filter(Boolean);
  };

  const getTargetFlats = () => {
    let raw =
      currentApplicant?.preferences?.flatNo ||
      currentApplicant?.preferences?.flats ||
      currentApplicant?.flatNo ||
      currentApplicant?.flats ||
      [];
    if ((!raw || raw.length === 0) && typeof localStorage !== "undefined") {
      try {
        const rawStored = localStorage.getItem("dda_target_flats");
        if (rawStored) {
          try {
            const parsed = JSON.parse(rawStored);
            if (Array.isArray(parsed) && parsed.length > 0) raw = parsed;
            else if (typeof parsed === "string" && parsed.trim()) raw = parsed;
          } catch (_) {
            raw = rawStored;
          }
        }
      } catch (_) {}
    }
    return parseTargetFlats(raw);
  };

  let targetFlats = getTargetFlats();

  // Fallback is strictly FALSE (OFF) by default, matching the extension
  const fallbackEnabled =
    currentApplicant?.preferences?.fallbackEnabled === true;
  const selectedFloor = currentApplicant?.preferences?.floor || "ALL";
  const selectedParity = currentApplicant?.preferences?.parity || "ALL";

  appendRunLog(
    `🎯 Flat selection page loaded (/user/step2_form/*). Target flats: [${targetFlats.join(", ")}]`,
    "ROUTE",
  );
  logAnalyticsStep("step4_page_load", "Flat Selection Page Loaded");

  runWhenReady(() => {
    // 1. Helper to Parse flat
    const parseFlatElement = (flatEl) => {
      if (!flatEl) return null;
      const span = flatEl.querySelector("span");
      if (!span) return null;
      const rawText = span.innerText || span.textContent || "";
      const flatText = rawText.trim().toUpperCase();
      if (!flatText) return null;
      const cleanDigits = flatText.replace(/\D/g, "");
      const numericFlatNo = cleanDigits ? parseInt(cleanDigits, 10) : NaN;

      let floorNo = NaN;
      const floorBlock = flatEl.closest ? flatEl.closest(".floorblock") : null;
      if (floorBlock) {
        const floorNameEl = floorBlock.querySelector(".floorname");
        if (floorNameEl) {
          const rawFloorText =
            floorNameEl.innerText || floorNameEl.textContent || "";
          const parsed = parseInt(rawFloorText.replace(/\D/g, ""), 10);
          if (!isNaN(parsed)) floorNo = parsed;
        }
      }
      if (isNaN(floorNo) && !isNaN(numericFlatNo)) {
        floorNo = Math.floor(numericFlatNo / 100);
      }

      return {
        el: flatEl,
        flatText,
        numericFlatNo,
        floorNo: isNaN(floorNo) ? 1 : floorNo,
        radio: flatEl.querySelector('input[type="radio"]'),
      };
    };

    // Reset any previous captcha state upon entering step 2 form
    resetCaptchaSessionState("Entering Step 2 Form");

    // Persistent set of flats blacklisted due to hold/sold conflict
    if (!window.__ddaBookedFlatsSet) {
      window.__ddaBookedFlatsSet = new ExpiringFlatSet();
    }
    const bookedFlatsSet = window.__ddaBookedFlatsSet;

    // 🛡️ DDA .reserve Click Interceptor: DDA's $(document).on('click', '.reserve', () => $('#captcha').val(''))
    // wipes the input field on click. We intercept at capture phase and re-fill immediately after!
    document.addEventListener(
      "click",
      (e) => {
        const isDirectMode =
          window.__ddaDirectMode ||
          sessionStorage.getItem("dda_direct_mode") === "true" ||
          localStorage.getItem("dda_direct_mode") === "true";
        if (isDirectMode) return;
        const target = e.target;
        if (
          target &&
          (target.matches(
            '.reserve, #submitareabtn, button[class*="reserve"]',
          ) ||
            target.closest(
              '.reserve, #submitareabtn, button[class*="reserve"]',
            ))
        ) {
          [10, 30, 80, 150, 300, 600].forEach((ms) => {
            setTimeout(() => {
              const curImg = document.querySelector(
                'img#captchaimg, #myModal img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i]), img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
              );
              const curSrc = curImg ? getCaptchaSrc(curImg) : null;
              if (
                lastSolvedCaptchaAnswer &&
                lastSolvedCaptchaSrc &&
                curSrc === lastSolvedCaptchaSrc
              ) {
                fillCaptchaInput(lastSolvedCaptchaAnswer);
              }
              scanAndSolveCaptchas();
            }, ms);
          });
        }
      },
      true,
    );

    // Continuous active watcher on step2_form to guarantee #captcha is NEVER left blank when modal is open
    const step2InputWatcher = setInterval(() => {
      if (!isAutomationRunning) return;
      const isDirectMode =
        window.__ddaDirectMode ||
        sessionStorage.getItem("dda_direct_mode") === "true" ||
        localStorage.getItem("dda_direct_mode") === "true";
      if (isDirectMode) return;
      const modal = document.querySelector(
        "#myModal, #flatDetailModal, .modal",
      );
      if (!modal) return;
      const isVisible =
        modal.classList.contains("show") ||
        modal.classList.contains("in") ||
        (modal.style && modal.style.display === "block") ||
        (modal.offsetWidth > 0 && modal.offsetHeight > 0);
      if (!isVisible) return;

      const isAutoSolve =
        currentSettings?.captchaAutoSolveEnabled !== false &&
        localStorage.getItem("captchaAutoSolveEnabled") !== "false" &&
        !window.__ddaManualCaptchaFlat;
      if (!isAutoSolve) return;
      const captchaInput = modal.querySelector(CAPTCHA_INPUT_SELECTORS);
      const curImg = modal.querySelector(
        'img#captchaimg, img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
      );
      const curSrc = curImg ? getCaptchaSrc(curImg) : null;
      if (
        captchaInput &&
        (!captchaInput.value || captchaInput.value.trim() === "") &&
        lastSolvedCaptchaAnswer !== null &&
        lastSolvedCaptchaSrc &&
        curSrc === lastSolvedCaptchaSrc &&
        !solveInProgress
      ) {
        fillCaptchaInput(lastSolvedCaptchaAnswer);
      }
    }, 150);
    activeIntervals.push(step2InputWatcher);

    // ⚡ Fast-Track Instant Modal Display & Direct Captcha Block Unhide
    const triggerInstantReserveModal = () => {
      const isDirectMode =
        window.__ddaDirectMode ||
        sessionStorage.getItem("dda_direct_mode") === "true" ||
        localStorage.getItem("dda_direct_mode") === "true";
      if (isDirectMode) return;
      try {
        const modal = document.querySelector(
          '#myModal, #flatDetailModal, .modal[id*="Modal"], .modal',
        );
        if (modal) {
          modal.classList.add("show", "in");
          modal.style.display = "block";
          modal.setAttribute("aria-hidden", "false");

          // Directly unhide .captchblock (never click #submitareabtn to prevent Bootstrap data-dismiss)
          const capBlock = modal.querySelector(".captchblock, tr.captchblock");
          if (capBlock) {
            if (capBlock.style.display !== "table-row") capBlock.style.display = "table-row";
            if (capBlock.classList.contains("hide")) capBlock.classList.remove("hide");
            if (!capBlock.classList.contains("show")) capBlock.classList.add("show");
          }
          const reserveHoldBtn = modal.querySelector(
            '#submitareabtn, .reserve, button[class*="reserve"]:not(#captchabutton)',
          );
          if (reserveHoldBtn && reserveHoldBtn.style.display !== "none") {
            reserveHoldBtn.style.display = "none";
          }
        }
      } catch (_) {}
    };

    // Watch reserve modal (unhides captcha block, triggers solver & binds Enter key to #captchabutton)
    let isHandlingModal = false;
    const modalObserver = new MutationObserver(() => {
      if (!isAutomationRunning || isHandlingModal) return;
      const isDirectMode =
        window.__ddaDirectMode ||
        sessionStorage.getItem("dda_direct_mode") === "true" ||
        localStorage.getItem("dda_direct_mode") === "true";
      if (isDirectMode) return;

      const modal = document.querySelector(
        "#myModal, #flatDetailModal, .modal",
      );
      if (!modal) return;

      const isVisible =
        modal.classList.contains("show") ||
        modal.classList.contains("in") ||
        (modal.style && modal.style.display === "block") ||
        (modal.offsetWidth > 0 && modal.offsetHeight > 0);
      if (!isVisible) return;

      // 1. Conflict Alert Check: if another applicant took this flat, auto-recover
      if (checkForConflictAlert()) return;

      isHandlingModal = true;
      try {
        const capBlock = modal.querySelector(".captchblock, tr.captchblock");
        if (capBlock) {
          if (capBlock.style.display !== "table-row") capBlock.style.display = "table-row";
          if (capBlock.classList.contains("hide")) capBlock.classList.remove("hide");
          if (!capBlock.classList.contains("show")) capBlock.classList.add("show");
        }
        const reserveHoldBtn = modal.querySelector(
          '#submitareabtn, .reserve, button[class*="reserve"]:not(#captchabutton)',
        );
        if (reserveHoldBtn && reserveHoldBtn.style.display !== "none") {
          reserveHoldBtn.style.display = "none";
        }

        const reserveBtn = modal.querySelector(
          '#captchabutton, button.capreserve, input.capreserve, button[type="submit"]',
        );

        // Track submit attempt on click
        if (reserveBtn && !reserveBtn.dataset.telemetryBound) {
          reserveBtn.dataset.telemetryBound = "true";
          reserveBtn.addEventListener("click", () => {
            const input = modal.querySelector(CAPTCHA_INPUT_SELECTORS);
            const val = input?.value?.trim() || "";
            logAnalyticsStep(
              "step5_captcha_submit",
              `Flat Captcha Submitted: ${val || "Manual Modal Submit"}`,
            );
            updateLastCaptchaAttempt({ status: "SUBMITTED" });
          });
        }

        // Bind Enter key to submit modal (#captchabutton)
        if (!modal.dataset.enterBound) {
          modal.dataset.enterBound = "true";
          modal.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && reserveBtn) {
              e.preventDefault();
              reserveBtn.click();
            }
          });
        }

        // Trigger Captcha solver in background DOM
        if (!modal.dataset.captchaReadyLogged) {
          modal.dataset.captchaReadyLogged = "true";
          logAnalyticsStep(
            "step5_captcha_ready",
            "Reservation Modal Opened & Captcha Detected",
          );
        }
        const curImg = modal.querySelector(
          'img#captchaimg, img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
        );
        const curSrc = curImg ? getCaptchaSrc(curImg) : null;
        if (
          lastSolvedCaptchaAnswer &&
          lastSolvedCaptchaSrc &&
          curSrc === lastSolvedCaptchaSrc
        ) {
          fillCaptchaInput(lastSolvedCaptchaAnswer);
        }
        scanAndSolveCaptchas();
      } finally {
        isHandlingModal = false;
      }
    });

    const modalTarget = document.querySelector("#myModal, #flatDetailModal, .modal") || document.body;
    modalObserver.observe(modalTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    activeObservers.push(modalObserver);

    // ⚡ DIRECT HEADLESS RESERVATION PIPELINE (Bypasses Modal & Direct POST to /user/getflatlayoutdetails)
    // Directly fetch a brand-new captcha image (one round trip). Loading /captcha/default?<rand> is
    // exactly what the page's own <img> does, and it is what makes the server issue a new captcha.
    // Returns an <img> (kept off the DOM so no other engine reacts to it) or null on any problem.
    const loadFreshCaptchaImageDirect = async () => {
      try {
        const img = new Image();
        const url =
          "https://eservices.dda.org.in/captcha/default?" +
          Math.random().toString(36).slice(2, 10);
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("timeout")), CAPTCHA_IMG_WAIT_MS);
          img.onload = () => {
            clearTimeout(t);
            resolve();
          };
          img.onerror = () => {
            clearTimeout(t);
            reject(new Error("error"));
          };
          img.src = url;
        });
        if (img.naturalWidth >= 60 && img.naturalHeight >= 18 && img.naturalWidth / img.naturalHeight >= 1.8) {
          return img;
        }
      } catch (_) {}
      return null;
    };

    // A reservation chain ended without a hold. Searching is ONLY ever started by the user pressing
    // Search/Manual/Timed, so nothing is restarted here: the engine stays idle, which leaves the user free to
    // change the target flats (e.g. when every preferred flat is gone) and search again.
    const resumeSearchIfActive = (why) => {
      try {
        appendRunLog(
          "⏹️ Reservation ended without a hold (" + why + "). Search is stopped — press Search to look again (you can change the target flats first).",
          "Direct",
        );
      } catch (_) {}
    };

    // After every direct try failed (wrong captcha reads, rejections, no answer),
    // hand the flat to DDA's own popup and let the user type the captcha. The
    // search stops, direct mode is switched off for this page, and
    // window.__ddaManualCaptchaFlat keeps the auto solver away from the popup
    // (it lives on window, so the next page load clears it).
    const openFlatPopupForManualCaptcha = (flatText, differentCaptchaReason) => {
      const flat = String(flatText || "").trim().toUpperCase();
      try {
        window.__ddaFlatHunterActive = false;
        if (window.__ddaFlatHunterTimer) {
          clearTimeout(window.__ddaFlatHunterTimer);
          window.__ddaFlatHunterTimer = null;
        }
        if (window.__ddaFlatHunterTimeout) {
          clearTimeout(window.__ddaFlatHunterTimeout);
          window.__ddaFlatHunterTimeout = null;
        }
        localStorage.removeItem("dda_direct_mode");
        sessionStorage.removeItem("dda_direct_mode");
        window.__ddaDirectMode = false;
      } catch (_) {}

      const building = Array.from(document.querySelectorAll(".building")).find((b) => {
        const sp = b.querySelector("span");
        return sp && ddaFlatKey(sp.innerText || sp.textContent || "") === ddaFlatKey(flat);
      });
      const radio = building?.querySelector('input[type="radio"]');
      const gone = !radio || radio.disabled || building.classList.contains("sold") || building.classList.contains("hold");
      const msg = differentCaptchaReason
        ? (gone
          ? `🔀 The captcha looks different from DDA's usual one (${differentCaptchaReason}), and flat ${flat} is no longer available. Search stopped.`
          : `🔀 The captcha looks different from DDA's usual one (${differentCaptchaReason}). Switched to DDA's popup for flat ${flat}: type the captcha and press Enter.`)
        : (gone
          ? `🛑 Captcha tries failed for flat ${flat}, and it is no longer available. Search stopped.`
          : `🛑 Captcha tries failed for flat ${flat}. Opened DDA's popup: type the captcha and press Enter.`);
      appendRunLog(msg, "Direct");
      try {
        // WARN on page 'Search' also flips the sidebar's search to idle
        const log = { level: "WARN", page: "Search", msg, pan: currentApplicant?.pan };
        if (typeof ipcRenderer.sendToHost === "function") ipcRenderer.sendToHost("dda:log", log);
      } catch (_) {}
      if (gone) return false;

      window.__ddaManualCaptchaFlat = flat;
      window.__ddaReservationInProgress = false;
      window.__ddaActiveReservationTarget = null;
      // With captcha auto-submit on, the page keeps DDA's popups off-screen; show this one
      try { document.body.classList.add("dda-manual-submit-mode"); } catch (_) {}
      try {
        radio.click();
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        if (typeof window.getflatdetails === "function") window.getflatdetails(radio);
      } catch (_) {}
      [0, 5, 20, 50, 100].forEach((ms) => setTimeout(triggerInstantReserveModal, ms));
      // The popup shows the captcha the page loaded with. If a background try already sent it,
      // DDA no longer accepts it: put a fresh one in the popup (DDA's own refresh_captcha).
      if (window.__ddaCaptchaConsumed) {
        (async () => {
          try {
            const refRes = await fetch("https://eservices.dda.org.in/user/refresh_captcha", {
              headers: { "X-Requested-With": "XMLHttpRequest" },
            });
            const refHtml = await refRes.text();
            const holder =
              document.querySelector("#myModal .captcha span") ||
              document.querySelector("#myModal .captchblock td") ||
              document.getElementById("captchaimg")?.parentElement;
            if (holder && /<img/i.test(refHtml) && window.__ddaManualCaptchaFlat === flat) {
              holder.innerHTML = refHtml;
              window.__ddaCaptchaConsumed = false;
            }
          } catch (_) {}
        })();
      }
      // Empty, focused captcha box for the user; Enter submits it with DDA's Reserve button
      [150, 400, 800].forEach((ms) =>
        setTimeout(() => {
          const input = document.getElementById("captcha");
          if (!input || window.__ddaManualCaptchaFlat !== flat) return;
          if (ms === 150) input.value = "";
          if (!input.dataset.manualEnterBound) {
            input.dataset.manualEnterBound = "true";
            input.addEventListener("keydown", (e) => {
              if (e.key !== "Enter") return;
              const btn = document.querySelector(
                '#captchabutton, button.capreserve, input.capreserve, #myModal button[type="submit"]',
              );
              if (!btn) return;
              e.preventDefault();
              e.stopPropagation(); // the popup's own Enter handler would click it a second time
              btn.click();
            });
          }
          try { input.focus(); } catch (_) {}
        }, ms),
      );
      return true;
    };
    window.__ddaOpenFlatPopupForManualCaptcha = openFlatPopupForManualCaptcha;

    const executeDirectInner = async (targetFlatParam, explicitFlatId, isChain = false) => {
      try {
        if (
          !isChain &&
          window.__ddaReservationInProgress &&
          window.__ddaActiveReservationTarget &&
          window.__ddaActiveReservationTarget !== targetFlatParam
        ) {
          console.log(
            `[DIRECT POST] Reservation already in-flight for flat ${window.__ddaActiveReservationTarget}. Skipping redundant invocation for ${targetFlatParam || "target"}.`,
          );
          return { success: false, reason: "MUTEX_LOCKED" };
        }
        window.__ddaReservationInProgress = true;
        window.__ddaActiveReservationTarget = targetFlatParam || "first target";
        flatSelected = true;

        console.log(
          `⚡ [DIRECT POST] Starting headless reservation pipeline for ${targetFlatParam || "first target"}...`,
        );
        appendRunLog(
          `⚡ [DIRECT POST] Initiating headless reservation for ${targetFlatParam || "first target"}...`,
          "Direct",
        );

        // 1. Gather route parameters (Optimized: Direct from URL / Pre-built cache, 0ms DOM overhead)
        const urlParts = window.location.pathname.split("/");
        // Format: /user/step2_form/{scheme_id}/{localityid}/{sector}/{pocket}/{block}/{tower}
        let cachedHashes = null;
        try {
          cachedHashes = JSON.parse(
            localStorage.getItem("dda_locality_hashes") ||
            sessionStorage.getItem("dda_locality_hashes") ||
            "{}"
          );
        } catch (_) {}

        const scheme_id =
          urlParts[3] ||
          cachedHashes?.schemeId ||
          document.querySelector('#scheme_id, input[name="scheme_id"]')?.value ||
          "";
        const localityid =
          urlParts[4] ||
          cachedHashes?.localityHash ||
          document.querySelector('#localityid, input[name="localityid"]')?.value ||
          "";
        const sector =
          urlParts[5] ||
          cachedHashes?.sectorHash ||
          document.querySelector('#sector, input[name="sector"]')?.value ||
          "";
        const pocket =
          urlParts[6] ||
          cachedHashes?.pocketHash ||
          document.querySelector('#pocket, input[name="pocket"]')?.value ||
          "";
        const block =
          urlParts[7] ||
          cachedHashes?.blockHash ||
          document.querySelector('#block, input[name="block"]')?.value ||
          "";
        const tower =
          urlParts[8] ||
          cachedHashes?.towerHash ||
          document.querySelector('#tower, input[name="tower"]')?.value ||
          "0";

        const token = getDdaCsrfToken();

        if (!token) {
          throw new Error("CSRF token not found in DOM");
        }

        // 2. Identify target flat element (Single-Pass Fast Map with Strict Priority Resolution)
        let flat_id = explicitFlatId || null;
        let flatText = "";
        const allRemainingTargets = getTargetFlats()
          .map((t) => String(t).trim().toUpperCase())
          .filter((t) => !bookedFlatsSet.has(t));

        const currentTargets =
          targetFlatParam && !bookedFlatsSet.has(targetFlatParam)
            ? [
                String(targetFlatParam).trim().toUpperCase(),
                ...allRemainingTargets.filter(
                  (t) => ddaFlatKey(t) !== ddaFlatKey(targetFlatParam),
                ),
              ]
            : allRemainingTargets;

        if (explicitFlatId && targetFlatParam) {
          flatText = String(targetFlatParam).trim().toUpperCase();
        } else {
          // Build a map of flat → { flat_id, DDA's label } (one pass through DOM, skipping taken
          // flats), keyed by ddaFlatKey so "1" and "01" are the same flat
          const spanMap = new Map();
          for (const span of document.querySelectorAll(
            ".building:not(.sold):not(.hold) span",
          )) {
            const text = span.textContent?.trim().toUpperCase();
            const key = ddaFlatKey(text);
            if (text && !spanMap.has(key) && !bookedFlatsSet.has(text)) {
              const radio = span
                .closest(".building")
                ?.querySelector('input[type="radio"][data-value]');
              const dataValue = radio?.getAttribute("data-value");
              if (dataValue) {
                spanMap.set(key, { value: dataValue, text });
              }
            }
          }

          // Look up targets in exact order of preference (1st, 2nd, 3rd...)
          for (const target of currentTargets) {
            if (bookedFlatsSet.has(target)) continue;
            const hit = spanMap.get(ddaFlatKey(target));
            if (hit) {
              flat_id = hit.value;
              flatText = hit.text; // DDA's own label
              break;
            }
          }
        }

        // Fallback ONLY IF explicitly enabled by user
        if (!flat_id && fallbackEnabled) {
          const availableBuildings = Array.from(
            document.querySelectorAll(
              ".building.available, .building:not(.sold):not(.hold)",
            ),
          );
          for (const b of availableBuildings) {
            const firstSpan = b.querySelector("span");
            const text = (
              firstSpan?.innerText ||
              firstSpan?.textContent ||
              ""
            ).trim().toUpperCase();
            if (text && !bookedFlatsSet.has(text)) {
              const radio = b.querySelector(
                'input[type="radio"][data-value]',
              );
              const dataValue =
                radio?.getAttribute("data-value") || radio?.dataset?.value;
              if (dataValue) {
                flatText = text;
                flat_id = dataValue;
                break;
              }
            }
          }
        }

        if (!flat_id) {
          appendRunLog(
            `⚠️ Target flats (${currentTargets.join(", ") || "None remaining"}) not available`,
            "Direct",
          );
          window.__ddaReservationInProgress = false;
          window.__ddaActiveReservationTarget = null;
          flatSelected = false;
          resumeSearchIfActive("targets not available");
          return { success: false, reason: "TARGETS_UNAVAILABLE" };
        }

        console.log(
          `🎯 [DIRECT POST] Target Flat ${flatText} (data-value / flat_id: ${flat_id})`,
        );
        appendRunLog(
          `🎯 Target Flat ${flatText} (ID: ${flat_id}) identified. Preparing direct submission...`,
          "Direct",
        );
        try {
          const directSelectPayload = {
            flatNo: flatText,
            reserved: false,
            directSubmission: true,
          };
          ipcRenderer.send("dda:flat-selected", directSelectPayload);
          if (typeof ipcRenderer.sendToHost === "function") {
            ipcRenderer.sendToHost("dda:flat-selected", directSelectPayload);
          }
        } catch (_) {}

        // A captcha that isn't DDA's usual kind can't be read by the app: stop the background
        // reservation and hand this flat to DDA's popup for the user to type, right away.
        const switchToPopupForDifferentCaptcha = (reason) => {
          window.__ddaCaptchaLooksDifferent = window.__ddaCaptchaLooksDifferent || reason;
          window.__ddaReservationInProgress = false;
          window.__ddaActiveReservationTarget = null;
          flatSelected = false;
          try { updateLastCaptchaAttempt({ status: "FAILED", statusDetail: `Different captcha: ${reason}` }); } catch (_) {}
          openFlatPopupForManualCaptcha(flatText, reason);
          return { success: false, reason: "CAPTCHA_DIFFERENT", flatNo: flatText };
        };
        if (window.__ddaCaptchaLooksDifferent) {
          return switchToPopupForDifferentCaptcha(window.__ddaCaptchaLooksDifferent);
        }

        // 3. Captcha Solve & Direct POST Loop (with Self-Healing Auto-Retry)
        // Up to 7 attempts for this flat: every retry uses a brand-new captcha, so a wrong read or an
        // unconfirmed request never ends the chain while the flat may still be obtainable.
        let maxAttempts = 7;
        let ambiguousSent = false; // a POST went out but its outcome is unknown (timeout / network error)
        let preferRefreshEndpoint = false; // direct image fetch rejected twice in a row -> use refresh_captcha
        let directRejections = 0;
        // DDA said "wrong captcha" this many times in a row. "Invalid captcha code" also comes back on
        // correct answers (DDA-side captcha mix-ups), so allow 5 fresh tries before deciding the
        // captcha itself is a kind the app can't read.
        const WRONG_CAPTCHA_SWITCH_AFTER = 5;
        let captchaRejections = 0;
        let status3Blocked = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          let captchaAnswer = null;
          let usedDirectImage = false;
          let currentBase64Image = "";
          let currentRawText = "";
          let currentModel = "native-onnx-node-v1";
          let currentOcrDuration = 0;
          let currentConfidence = null;
          let captchaSource = "page";

          // The flat page's own captcha, as loaded with the page. Older than
          // STALE_PAGE_CAPTCHA_MS (e.g. a long search) it is likely expired or
          // replaced, so fetch a fresh one before the first try.
          const pageCaptcha = attempt === 1 && !window.__ddaCaptchaConsumed ? describePageCaptcha() : null;
          const pageCaptchaStale = !!pageCaptcha && pageCaptcha.loaded && pageCaptcha.ageMs > STALE_PAGE_CAPTCHA_MS;
          if (pageCaptchaStale) {
            appendRunLog(
              `🔄 Flat page captcha is ${Math.round(pageCaptcha.ageMs / 1000)}s old — fetching a fresh one first`,
              "Direct",
            );
          }

          // Check if captcha was already pre-solved on page load or present in memory.
          // Never reuse one after a POST: the server consumes the captcha on every POST.
          if (attempt === 1 && !window.__ddaCaptchaConsumed && !pageCaptchaStale) {
            if (lastSolvedCaptchaAnswer) {
              captchaAnswer = String(lastSolvedCaptchaAnswer).trim();
              captchaSource = "page (pre-solved)";
              if (step2PreSolvedResult) {
                currentBase64Image = step2PreSolvedResult.base64Image || "";
                currentRawText = step2PreSolvedResult.data?.rawText || "";
                currentModel =
                  step2PreSolvedResult.data?.model || "native-onnx-node-v1";
                currentOcrDuration = step2PreSolvedResult.durationMs || 0;
                currentConfidence = step2PreSolvedResult.data?.confidence ?? null;
              }
            } else {
              const existingInput = document.querySelector(CAPTCHA_INPUT_SELECTORS);
              if (existingInput?.value && existingInput.value.trim().length > 0) {
                captchaAnswer = existingInput.value.trim();
              }
            }
          }

          if (!captchaAnswer) {
            let captchaImg = document.querySelector(
              'img#captchaimg, img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i])',
            );

            // Page image still downloading (typical right after page load): wait for it instead of
            // discarding it and fetching a brand-new captcha (refresh_captcha + image = ~2 extra round
            // trips). It is the session's valid captcha as soon as it arrives. Falls through to the
            // refresh below only if it errors or doesn't arrive within 1.5s.
            if (captchaImg && attempt === 1 && !window.__ddaCaptchaConsumed && !pageCaptchaStale && !captchaImg.complete) {
              await new Promise((resolve) => {
                captchaImg.addEventListener("load", resolve, { once: true });
                captchaImg.addEventListener("error", resolve, { once: true });
                setTimeout(resolve, 1500);
              });
            }

            // Retry, or the captcha was already consumed by an earlier POST: get a brand-new one
            const needFreshCaptcha = attempt > 1 || window.__ddaCaptchaConsumed === true || pageCaptchaStale;
            if (needFreshCaptcha && !preferRefreshEndpoint) {
              const directImg = await loadFreshCaptchaImageDirect();
              if (directImg) {
                captchaImg = directImg;
                usedDirectImage = true;
                captchaSource = "fresh (direct image)";
              }
            }

            // If image is missing, 0 dimensions, or a fresh one is needed and the direct load failed
            if (
              !usedDirectImage &&
              (!captchaImg ||
                !captchaImg.complete ||
                captchaImg.naturalWidth === 0 ||
                needFreshCaptcha)
            ) {
              try {
                const refRes = await fetch(
                  "https://eservices.dda.org.in/user/refresh_captcha",
                  {
                    headers: { "X-Requested-With": "XMLHttpRequest" },
                    // No answer in time: the attempt fails like a missing image and the next one
                    // gets a brand-new captcha
                    signal: AbortSignal.timeout(REFRESH_CAPTCHA_TIMEOUT_MS),
                  },
                );
                const refHtml = await refRes.text();
                let container =
                  document.querySelector(".captcha span") ||
                  document.querySelector(".captchblock td");
                if (!container) {
                  container = document.createElement("div");
                  container.className = "captchblock";
                  container.style.display = "none";
                  document.body.appendChild(container);
                }
                container.innerHTML = refHtml;
                await new Promise((r) => setTimeout(r, 60));
                captchaImg = container.querySelector("img");
                // At attempt 1 without needing a fresh one: the page's image did not
                // arrive in time. If it lands later it replaces this one on DDA's side.
                captchaSource = needFreshCaptcha ? "fresh (refresh_captcha)" : "fresh (page image late)";
              } catch (_) {}
            }

            let floatArray, base64Image;
            let ocrStart = Date.now();
            try {
              if (!captchaImg) {
                throw new Error("Failed to acquire captcha image");
              }

              // Still downloading: wait for it (a failed image is complete too)
              if (!captchaImg.complete) {
                await new Promise((resolve) => {
                  captchaImg.addEventListener("load", resolve, { once: true });
                  captchaImg.addEventListener("error", resolve, { once: true });
                  setTimeout(resolve, CAPTCHA_IMG_WAIT_MS);
                });
              }

              // A loaded captcha of another size is not DDA's usual kind
              const sizeDiff = captchaDifference(captchaImg);
              if (sizeDiff) return switchToPopupForDifferentCaptcha(sizeDiff);

              ocrStart = Date.now();
              ({ floatArray, base64Image } = await extractCaptchaTensor(captchaImg));
            } catch (imgErr) {
              // The image never arrived (DDA too slow, or an error): a technical
              // miss, not a lost flat. The next attempt gets a brand-new captcha.
              if (attempt < maxAttempts) {
                appendRunLog(
                  `⚠️ Captcha image did not arrive (${imgErr.message}). Getting a fresh one (${attempt}/${maxAttempts})...`,
                  "Direct",
                );
                continue;
              }
              throw imgErr;
            }

            // Solve via local ONNX in Main process
            const ocrResp = await ipcRenderer.invoke("captcha:solveLocal", {
              floatArray: Array.from(floatArray),
              base64Image,
              pan: currentApplicant?.pan,
            });

            // Unreadable or read with low confidence: not the kind the app knows
            const readDiff = captchaDifference(captchaImg, ocrResp);
            if (readDiff) return switchToPopupForDifferentCaptcha(readDiff);

            currentOcrDuration = Date.now() - ocrStart;
            captchaAnswer = String(ocrResp.data.numericAnswer).trim();
            currentBase64Image = base64Image;
            currentRawText = ocrResp.data.rawText || `${captchaAnswer}`;
            currentModel = ocrResp.data.model || "native-onnx-node-v1";
            currentConfidence = ocrResp.data.confidence ?? null;

            appendRunLog(
              `✅ Captcha Solved: ${currentRawText || captchaAnswer} (${currentOcrDuration}ms${formatCaptchaConfidence(currentConfidence)}, Attempt ${attempt})`,
              "Direct",
            );
          } else {
            appendRunLog(
              `⚡ Captcha Ready: ${captchaAnswer} (Pre-Solved in memory${formatCaptchaConfidence(currentConfidence)})`,
              "Direct",
            );
          }

          // Record / Update Telemetry Attempt for Direct Submission
          recordCaptchaAttempt({
            base64Image: currentBase64Image,
            rawText: currentRawText || `${captchaAnswer}`,
            answer: String(captchaAnswer),
            numericAnswer: Number(captchaAnswer) || null,
            durationMs: currentOcrDuration,
            status: "SUBMITTED",
            statusDetail: `Direct Headless POST submission (Attempt ${attempt})`,
            model: currentModel,
            ...(currentConfidence != null ? { confidence: currentConfidence } : {}),
            captchaSource,
            ...(pageCaptcha ? { pageCaptchaAgeMs: pageCaptcha.ageMs } : {}),
          });
          traceCaptcha(
            `flat=${flatText} attempt=${attempt} source=${captchaSource} answer=${captchaAnswer}` +
              `${formatCaptchaConfidence(currentConfidence)}` +
              (pageCaptcha
                ? ` pageCaptcha=${pageCaptcha.src} age=${pageCaptcha.ageMs}ms`
                : "") +
              ` pageAge=${Math.round(performance.now())}ms`,
          );

          // Log step5_captcha_submit milestone with actual expression/answer
          logAnalyticsStep(
            "step5_captcha_submit",
            `Flat Captcha Submitted: ${currentRawText || captchaAnswer} (Direct Mode)`,
          );

          // Dispatch IPC to notify desktop app and live console
          try {
            const solvedPayload = {
              text: captchaAnswer,
              rawText: currentRawText || `${captchaAnswer}`,
              dataUrl: currentBase64Image,
              page: "Step 2 Flats",
              pan: currentApplicant?.pan,
              durationMs: currentOcrDuration,
            };
            ipcRenderer.send("dda:captcha-solved", solvedPayload);
            if (typeof ipcRenderer.sendToHost === "function") {
              ipcRenderer.sendToHost("dda:captcha-solved", solvedPayload);
            }
          } catch (_) {}

          // 5. Send POST to /user/getflatlayoutdetails
          appendRunLog(
            `🚀 Sending DIRECT POST to /user/getflatlayoutdetails...`,
            "Direct",
          );
          const postBody = new URLSearchParams({
            scheme_id,
            localityid,
            sector,
            pocket,
            block,
            tower,
            captcha: captchaAnswer,
            flat_id: String(flat_id),
          });

          // The captcha is consumed the moment this request is sent, whatever the outcome
          window.__ddaCaptchaConsumed = true;
          let res = {};
          try {
            const postAbort = new AbortController();
            const postTimer = setTimeout(() => postAbort.abort(), 10000);
            let resText = "";
            try {
              const response = await fetch(
                "https://eservices.dda.org.in/user/getflatlayoutdetails",
                {
                  method: "POST",
                  headers: {
                    "Content-Type":
                      "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-CSRF-TOKEN": token,
                    "X-Requested-With": "XMLHttpRequest",
                  },
                  body: postBody,
                  signal: postAbort.signal,
                },
              );
              resText = await response.text();
            } finally {
              clearTimeout(postTimer);
            }
            try {
              res = JSON.parse(resText);
            } catch (e) {
              console.error("Server response is not JSON:", resText.slice(0, 300));
              throw new Error("Server returned non-JSON response");
            }
          } catch (netErr) {
            // Outcome unknown (timeout / network error / bad gateway page): retry with a fresh captcha
            ambiguousSent = true;
            const why = netErr && netErr.name === "AbortError" ? "timed out after 10s" : (netErr && netErr.message) || "network error";
            updateLastCaptchaAttempt({
              status: "NO_RESPONSE",
              statusDetail: "No usable response (" + why + ")",
              serverAlertText: why,
            });
            appendRunLog(
              "⚠️ POST for flat " + flatText + " had no usable response (" + why + "). Retrying with a fresh captcha (" + attempt + "/" + maxAttempts + ")...",
              "Direct",
            );
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }

          console.log("⚡ [DIRECT POST] Server response:", JSON.stringify(res));

          const statusCode = String(res?.status ?? "");

          // Status 0: SUCCESS!
          if (statusCode === "0" || res?.status === 0) {
            updateLastCaptchaAttempt({
              status: "RESERVED",
              statusDetail: `Flat ${flatText} Reserved successfully via Direct POST`,
            });
            // DDA reserved the flat: chime now (reserved: true). The booking
            // record waits for the hold page to confirm (confirmHoldSecured).
            appendRunLog(
              `🎉 Flat ${flatText} reserved by DDA — opening the 15-min hold page...`,
              "Direct",
            );
            logAnalyticsStep("step5_reserved", `Flat ${flatText} reserved by DDA`);
            try {
              localStorage.setItem("dda_last_reserved_flat", flatText);
              sessionStorage.setItem("dda_reserved_flat_no", flatText);
              ipcRenderer.send("dda:flat-selected", {
                flatNo: flatText,
                reserved: true,
              });
              if (typeof ipcRenderer.sendToHost === "function") {
                ipcRenderer.sendToHost("dda:flat-selected", {
                  flatNo: flatText,
                  reserved: true,
                });
              }
            } catch (_) {}

            localStorage.removeItem("dda_direct_mode");
            sessionStorage.removeItem("dda_direct_mode");
            window.__ddaDirectMode = false;
            window.__ddaReservationInProgress = false;
            window.__ddaActiveReservationTarget = null;

            const holdUrl = `https://eservices.dda.org.in/user/getlayout/${scheme_id}/${localityid}/${sector}/${pocket}/${block}/${tower}/${flat_id}`;
            window.location.href = holdUrl;
            return {
              success: true,
              flatNo: flatText,
              flatId: flat_id,
              holdUrl,
            };
          }

          // Status 2 or 4: Flat taken
          if (
            statusCode === "2" ||
            statusCode === "4" ||
            res?.status === 2 ||
            res?.status === 4
          ) {
            updateLastCaptchaAttempt({
              status: "FAILED",
              statusDetail: `Flat ${flatText} is hold/allotted by another applicant (Status ${statusCode})`,
            });
            appendRunLog(
              `⚠️ Flat ${flatText} is hold/allotted by another applicant!`,
              "Direct",
            );
            blacklistFlat(flatText);

            // Mark building node in DOM as taken so future scans skip it
            try {
              const bEl =
                document
                  .querySelector(`.building input[data-value="${flat_id}"]`)
                  ?.closest(".building") ||
                Array.from(document.querySelectorAll(".building")).find(
                  (b) =>
                    ddaFlatKey(b.querySelector("span")?.textContent || "") === ddaFlatKey(flatText),
                );
              if (bEl) {
                bEl.classList.remove("available");
                bEl.classList.add("sold", "hold");
                const r = bEl.querySelector('input[type="radio"]');
                if (r) r.disabled = true;
              }
            } catch (_) {}

            // Invalidate stale captcha so next attempt gets a fresh solve
            resetCaptchaSessionState("Target flat conflict");

            // Look for remaining target preferences
            const remainingTargets = getTargetFlats()
              .map((t) => String(t).trim().toUpperCase())
              .filter((t) => !bookedFlatsSet.has(t));

            // Keep the reservation lock held while switching: this is one continuous chain, so no other
            // trigger can fire a competing attempt between preferences.
            if (remainingTargets.length > 0) {
              appendRunLog(
                `⚡ Target flat ${flatText} taken! Auto-switching to next preference: [${remainingTargets.join(", ")}]. Immediately firing direct reservation...`,
                "Direct",
              );
              window.__ddaActiveReservationTarget = remainingTargets[0];
              return await executeDirectInner(remainingTargets[0], undefined, true);
            } else if (fallbackEnabled) {
              appendRunLog(
                `⚡ Target flat ${flatText} taken and all target preferences exhausted. Auto-switching to best available fallback flat...`,
                "Direct",
              );
              window.__ddaActiveReservationTarget = "fallback";
              return await executeDirectInner(null, undefined, true);
            } else {
              appendRunLog(
                `⚠️ All target preferences (${getTargetFlats().join(", ")}) are taken or unavailable.`,
                "WARN",
              );
              window.__ddaReservationInProgress = false;
              window.__ddaActiveReservationTarget = null;
              flatSelected = false;
              resumeSearchIfActive("all preferences taken");
              return {
                success: false,
                reason: "ALL_TARGETS_TAKEN",
                flatNo: flatText,
              };
            }
          }

          // Status 3: Previous session running
          if (statusCode === "3" || res?.status === 3) {
            if (ambiguousSent) {
              // An earlier POST in this chain had an unknown outcome and the server now says a session is
              // already running: that is most likely OUR hold. Open the hold page to verify it.
              appendRunLog(
                "⚠️ Server reports a running session after an unconfirmed POST — likely our own hold on flat " + flatText + ". Opening the hold page to verify...",
                "Direct",
              );
              window.__ddaReservationInProgress = false;
              window.__ddaActiveReservationTarget = null;
              try {
                localStorage.setItem("dda_last_reserved_flat", flatText);
                sessionStorage.setItem("dda_reserved_flat_no", flatText);
              } catch (_) {}
              const verifyUrl = `https://eservices.dda.org.in/user/getlayout/${scheme_id}/${localityid}/${sector}/${pocket}/${block}/${tower}/${flat_id}`;
              window.location.href = verifyUrl;
              return { success: true, ambiguous: true, flatNo: flatText, flatId: flat_id, holdUrl: verifyUrl };
            }
            status3Blocked = true;
            window.__ddaSessionRunningAt = Date.now(); // read by the app sidebar
            updateLastCaptchaAttempt({
              status: "FAILED",
              statusDetail: `Previous session running (Status 3)`,
            });
            appendRunLog(
              `⚠️ Previous session running. Wait for session termination.`,
              "Direct",
            );
            window.__ddaReservationInProgress = false;
            window.__ddaActiveReservationTarget = null;
            flatSelected = false;
            break;
          }

          // Other server validation errors / Captcha retry
          const errDetail = res?.message
            ? JSON.stringify(res.message)
            : `Status ${res.status}`;
          if (/captcha/i.test(errDetail)) {
            captchaRejections++;
            if (captchaRejections >= WRONG_CAPTCHA_SWITCH_AFTER) {
              updateLastCaptchaAttempt({
                status: "SERVER_REJECTED",
                statusDetail: `Server rejected (${errDetail})`,
                serverAlertText: errDetail,
              });
              return switchToPopupForDifferentCaptcha(`DDA rejected ${WRONG_CAPTCHA_SWITCH_AFTER} answers in a row as a wrong captcha`);
            }
          } else {
            captchaRejections = 0;
          }
          if (usedDirectImage && /captcha/i.test(errDetail)) {
            // One rejection can just be a misread. Two in a row on directly-loaded images means the
            // direct route is not being accepted: fall back to the refresh_captcha route.
            directRejections++;
            if (directRejections >= 2) preferRefreshEndpoint = true;
          } else {
            directRejections = 0;
          }
          updateLastCaptchaAttempt({
            status: "SERVER_REJECTED",
            statusDetail: `Server rejected (${errDetail})`,
            serverAlertText: errDetail,
          });
          appendRunLog(
            `⚠️ Server rejected (${errDetail}). Fast retrying (${attempt}/${maxAttempts})...`,
            "Direct",
          );
          await new Promise((r) => setTimeout(r, 60));
        }

        window.__ddaReservationInProgress = false;
        window.__ddaActiveReservationTarget = null;
        flatSelected = false;
        if (!status3Blocked) openFlatPopupForManualCaptcha(flatText);
        return {
          success: false,
          error: "Direct reservation failed after retries",
        };
      } catch (err) {
        window.__ddaReservationInProgress = false;
        window.__ddaActiveReservationTarget = null;
        flatSelected = false;
        console.error("❌ [DIRECT POST] Error:", err);
        appendRunLog(`❌ Direct Reservation Error: ${err.message}`, "Direct");
        resumeSearchIfActive("error: " + err.message);
        return { success: false, error: err.message };
      }
    };

    // Single-flight entry point: only one reservation chain may run at a time. Duplicate triggers
    // (poller + page-load scan + recovery paths) return immediately instead of racing each other.
    const executeDirectHeadlessReservation = async (targetFlatParam, explicitFlatId) => {
      if (window.__ddaDirectRunning) {
        console.log(
          "[DIRECT POST] A reservation chain is already running; ignoring duplicate trigger for " + (targetFlatParam || "target"),
        );
        return { success: false, reason: "ALREADY_RUNNING" };
      }
      window.__ddaDirectRunning = true;
      try {
        return await executeDirectInner(targetFlatParam, explicitFlatId, false);
      } finally {
        window.__ddaDirectRunning = false;
      }
    };

    window.__ddaDirectSubmit = executeDirectHeadlessReservation;
    ipcRenderer.on("dda:direct-submit", (_e, targetFlat) => {
      executeDirectHeadlessReservation(targetFlat);
    });

    // Live DOM Scan & Polling Engine State
    let flatSelected = false;

    const scanLiveDom = () => {
      if (!isAutomationRunning || window.__ddaReservationInProgress || flatSelected) return false;
      targetFlats = getTargetFlats();
      const buildingEls = Array.from(document.querySelectorAll(".building"));
      const isGridLoaded =
        buildingEls.length > 0 || !!document.querySelector(".floorblock");

      const availableEls = Array.from(
        document.querySelectorAll(".building.available"),
      );

      const parsedAvailable = availableEls
        .map(parseFlatElement)
        .filter(
          (item) => item && item.radio && !bookedFlatsSet.has(item.flatText),
        );

      const availableFlatKeys = parsedAvailable.map((p) => ddaFlatKey(p.flatText));
      const hasAnyTargetMatch = targetFlats.some((target) =>
        availableFlatKeys.includes(ddaFlatKey(target)),
      );
      const noneTargetAvailable = targetFlats.length > 0 && !hasAnyTargetMatch;

      if (isGridLoaded) {
        try {
          const payload = {
            isFlatSelectPage: true,
            isGridLoaded: true,
            totalAvailable: parsedAvailable.length,
            availableFlats: availableFlatTexts,
            noneTargetAvailable,
            targetFlats,
            timestamp: Date.now(),
          };
          ipcRenderer.send("dda:flat-availability", payload);
          if (typeof ipcRenderer.sendToHost === "function") {
            ipcRenderer.sendToHost("dda:flat-availability", payload);
          }
        } catch (_) {}
      }

      if (availableEls.length === 0) return false;

      let matched = null;

      for (const target of targetFlats) {
        matched = parsedAvailable.find(
          (item) => ddaFlatKey(item.flatText) === ddaFlatKey(target),
        );
        if (matched) break;
      }

      if (!matched && fallbackEnabled && parsedAvailable.length > 0) {
        let candidates = [...parsedAvailable];
        if (selectedFloor !== "ALL") {
          const fNum = parseInt(selectedFloor, 10);
          candidates = candidates.filter((item) => item.floorNo === fNum);
        }
        if (selectedParity === "EVEN") {
          candidates = candidates.filter(
            (item) =>
              !isNaN(item.numericFlatNo) && item.numericFlatNo % 2 === 0,
          );
        } else if (selectedParity === "ODD") {
          candidates = candidates.filter(
            (item) =>
              !isNaN(item.numericFlatNo) && item.numericFlatNo % 2 !== 0,
          );
        }
        if (candidates.length > 0) {
          candidates.sort((a, b) =>
            a.floorNo !== b.floorNo
              ? a.floorNo - b.floorNo
              : (a.numericFlatNo || 0) - (b.numericFlatNo || 0),
          );
          matched = candidates[0];
        }
      }

      if (matched && matched.radio) {
        if (window.__ddaReservationInProgress) return false;
        window.__ddaReservationInProgress = true;
        window.__ddaActiveReservationTarget = matched.flatText;
        flatSelected = true;

        window.__ddaLastAttemptedFlat = matched.flatText;
        try {
          ipcRenderer.send("dda:flat-selected", {
            flatNo: matched.flatText,
            reserved: false,
          });
          if (typeof ipcRenderer.sendToHost === "function") {
            ipcRenderer.sendToHost("dda:flat-selected", {
              flatNo: matched.flatText,
              reserved: false,
            });
          }
        } catch (_) {}
        const prefs =
          currentApplicant?.preferences || currentApplicant?.location || {};
        const flatDetailsToCache = {
          flatNo: matched.flatText,
          floor: matched.floorNo
            ? `${matched.floorNo}th Floor`
            : prefs.floor || "",
          locality:
            prefs.locality ||
            document
              .querySelector("select#locality option:checked")
              ?.textContent?.trim() ||
            "NARELA",
          sector:
            prefs.sector ||
            document
              .querySelector("select#sector option:checked")
              ?.textContent?.trim() ||
            "",
          pocket:
            prefs.pocket ||
            document
              .querySelector("select#pocket option:checked")
              ?.textContent?.trim() ||
            "",
          block:
            prefs.block ||
            document
              .querySelector("select#block option:checked")
              ?.textContent?.trim() ||
            "",
          scheme:
            prefs.scheme ||
            localStorage.getItem("dda_active_scheme_name") ||
            "DDA Housing Scheme",
        };
        try {
          localStorage.setItem(
            "dda_last_selected_flat_details",
            JSON.stringify(flatDetailsToCache),
          );
          sessionStorage.setItem(
            "dda_tab_flat_details",
            JSON.stringify(flatDetailsToCache),
          );
        } catch (_) {}

        logAnalyticsStep(
          "step4_flat_select",
          `Flat Selected: ${matched.flatText} (Target Match)`,
        );
        resetCaptchaSessionState("Target flat selected");

        // ⚡ JIT Pre-Solve: Initiate background ONNX pre-solve on radio click
        const activeCaptcha = document.querySelector('img[src*="captcha"]');
        if (activeCaptcha) {
          preSolveStep2Captcha(activeCaptcha);
        }
        // ⚡ Direct Headless Mode (Permanent Default for all users)
        console.log(
          `⚡ [DIRECT POST] Live DOM match: executing direct headless reservation for ${matched.flatText}`,
        );
        const explicitFlatId =
          matched.radio?.getAttribute("data-value") ||
          matched.el?.querySelector('input[type="radio"]')?.getAttribute("data-value");
        executeDirectHeadlessReservation(matched.flatText, explicitFlatId).then((res) => {
          if (res?.success || !isAutomationRunning) return;
          // A duplicate trigger was ignored: the chain that is already running owns the lock
          if (res?.reason === "ALREADY_RUNNING" || res?.reason === "MUTEX_LOCKED") return;
          // The chain already tried every available target and restarts the search itself when one
          // is active. Never re-scan and re-fire immediately on the same (stale) live DOM.
          console.log(
            "⚡ [DIRECT POST] Live DOM reservation chain finished without a hold; the search engine takes over if a search is active.",
          );
        }).catch((err) => {
          console.error("⚡ [DIRECT POST] Error during direct headless reservation, falling back to modal:", err);
          matched.radio.click();
          matched.radio.dispatchEvent(new Event("change", { bubbles: true }));
          if (typeof window.getflatdetails === "function")
            window.getflatdetails(matched.radio);
          triggerInstantReserveModal();
          [5, 20, 50, 100].forEach((ms) =>
            setTimeout(triggerInstantReserveModal, ms),
          );
        });
        return true;
      }
      return false;
    };

    window.__ddaResetFlatSelected = () => {
      flatSelected = false;
      window.__ddaReservationInProgress = false;
      window.__ddaActiveReservationTarget = null;
    };

    window.__ddaScanLiveDom = () => {
      if (!isAutomationRunning || window.__ddaReservationInProgress || flatSelected) return false;
      return scanLiveDom();
    };

    // Listen for search start/stop commands from UI / host
    ipcRenderer.on("dda:start-search", () => {
      console.log("🔍 [DDA Step 2] Search triggered. Scanning live DOM...");
      scanLiveDom();
    });

    ipcRenderer.on("dda:stop-search", () => {
      console.log("🛑 [DDA Step 2] Search stopped.");
    });

    try {
      window.addEventListener("dda:start-search", () => {
        scanLiveDom();
      });

      window.addEventListener("dda:stop-search", () => {});
    } catch (_) {}

    // 100% Extension Parity (August 28): Single 1-shot DOM scan on page load.
    // If a target flat is available right now, reserve it.
    // If NO target flats are available, STAY COMPLETELY IDLE. Do NOT start polling!
    scanLiveDom();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// 5. APPLICATION FORM (100% EXTENSION 1:1 PARITY + SHADOW STEP 2 RESOLVER)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION FORM UNIVERSAL DOM COMPATIBILITY & FORM SUBMISSION GUARD
// Guaranteed to run on every Application Form load, REGARDLESS of automation toggle.
// Resolves DDA portal bugs that silently crash manual and automated submissions:
// 1. Sets valid form.noValidate = true (fixing DDA's invalid <form formnovalidate>).
// 2. Un-requires hidden fields (.jointapp inputs #joint_applicant_first_name_1, pan, photograph, signature)
//    so Chromium native HTML5 validation never halts submission with "An invalid form control is not focusable".
// 3. Dynamically maintains un-requiring of joint applicant inputs on Yes/No radio toggle.
// 4. Catches #frmApply clicks at capture phase to ensure unhindered form submission.
// 5. Ensures jQuery Validate ignore setting is ":hidden".
// ─────────────────────────────────────────────────────────────────────────────
function setupApplicationFormCompatibility() {
  runWhenReady(() => {
    const formEl =
      document.getElementById("applicantForm") ||
      document.querySelector("form.commonform, form");
    if (!formEl) return;

    // 1. Enforce standard HTML5 novalidate on the form
    formEl.noValidate = true;
    try {
      formEl.setAttribute("novalidate", "novalidate");
    } catch (_) {}

    const submitBtns = formEl.querySelectorAll(
      'button[type="submit"], input[type="submit"], #frmApply, button#frmApply',
    );
    submitBtns.forEach((btn) => {
      try {
        btn.setAttribute("formnovalidate", "formnovalidate");
      } catch (_) {}
    });

    // 2. Clean hidden required fields so native validation cannot block submission
    const sanitizeHiddenRequiredFields = () => {
      try {
        const isJointYes = Boolean(
          document.querySelector("input.is_add_joint[value='1']:checked"),
        );
        formEl.querySelectorAll("[required]").forEach((el) => {
          const isHidden =
            el.offsetParent === null ||
            window.getComputedStyle(el).display === "none" ||
            el.closest('[style*="display: none"]') ||
            el.closest('.jointapp[style*="display: none"]') ||
            (!isJointYes &&
              el.closest(
                '.jointapp, .joint_applicant_row, #joint_applicant_1, [id^="joint_applicant_"]',
              ));
          if (isHidden) {
            el.required = false;
            el.removeAttribute("required");
          }
        });
      } catch (_) {}
    };

    sanitizeHiddenRequiredFields();
    [50, 150, 300, 600, 1200].forEach((ms) =>
      setTimeout(sanitizeHiddenRequiredFields, ms),
    );

    // 3. Listen to joint applicant radio toggle (Yes/No)
    document.addEventListener(
      "change",
      (e) => {
        if (
          e.target &&
          (e.target.name === "is_add_joint" ||
            (e.target.classList &&
              e.target.classList.contains("is_add_joint")))
        ) {
          setTimeout(sanitizeHiddenRequiredFields, 30);
          setTimeout(sanitizeHiddenRequiredFields, 150);
        }
      },
      true,
    );

    // 4. Capture-phase click listener on #frmApply / submit buttons
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(
          '#frmApply, button#frmApply, #SubmitApplicantForm, button#SubmitApplicantForm, button[type="submit"]',
        );
        if (!btn) return;

        const currentForm =
          btn.closest("form") || document.getElementById("applicantForm") || formEl;
        if (currentForm) {
          currentForm.noValidate = true;
          try {
            currentForm.setAttribute("novalidate", "novalidate");
          } catch (_) {}
          sanitizeHiddenRequiredFields();
        }

        try {
          if (typeof window.jQuery !== "undefined" && currentForm) {
            const validator = window.jQuery(currentForm).data("validator");
            if (validator && validator.settings) {
              validator.settings.ignore = ":hidden";
            }
          }
        } catch (_) {}
      },
      true,
    );

    // 5. Pre-submit listener on the form itself
    formEl.addEventListener(
      "submit",
      () => {
        formEl.noValidate = true;
        sanitizeHiddenRequiredFields();
      },
      true,
    );
  });
}

// The form is filled only with the DDA account's own applicant (see
// ensureApplicantMatchesAccount); DDA puts the account's PAN, read-only, on the form.
function handleApplicationFormPage() {
  const formPan = () => {
    const v = (document.querySelector('input[name="pan"], input#pan, input#applicant_pan')?.value || "").toUpperCase().trim();
    return DDA_PAN_RE.test(v) ? v : "";
  };
  const isTest = () =>
    window.__ddaTestAutofillMode === true || sessionStorage.getItem("dda_test_autofill_mode") === "true";
  const go = (accountPan) => {
    if (!currentApplicant && window.__ACTIVE_APPLICANT__) currentApplicant = window.__ACTIVE_APPLICANT__;
    const sidePan = applicantPanOf(currentApplicant);
    if (!accountPan) {
      // Without DDA's PAN on the form nobody can say whose form this is: never guess
      if (isTest() || differentApplicantAllowed()) return runFormWhenFilesReady();
      // DDA's error page ("database error") has no form at all: its own retry handles it
      if (!document.querySelector("#applicantForm, form#frmApply, #frmApply, form")) return;
      appendRunLog(
        "⛔ DDA's PAN box isn't on the application form, so the app can't tell whose form this is and won't fill it. Reload the page, or fill it by hand.",
        "ERROR",
      );
      stopSessionHeartbeat("Form stopped: no PAN on DDA's form");
      return;
    }
    if (sidePan === accountPan) {
      reportDdaAccount(accountPan, { confirmOnly: true }); // the form's PAN confirms it
      return runFormWhenFilesReady();
    }
    if (isTest()) {
      appendRunLog(`🧪 Test fill (no submit): ${sidePan || "no applicant"}'s details on DDA account ${accountPan}.`, "WARN");
      return runFormWhenFilesReady();
    }
    ensureApplicantMatchesAccount(accountPan, "application form").then((ok) => {
      if (ok) runFormWhenFilesReady();
      else stopSessionHeartbeat("Form stopped: DDA account has no matching applicant");
    });
  };
  const now = formPan();
  if (now) {
    setDdaAccountPan(now);
    return go(now);
  }
  // DDA's form not drawn yet: wait for its PAN box a moment
  const started = Date.now();
  const timer = setInterval(() => {
    const pan = formPan();
    if (pan || document.readyState !== "loading" || Date.now() - started > 3000) {
      clearInterval(timer);
      if (pan) setDdaAccountPan(pan);
      go(pan);
    }
  }, 50);
}

// Last check, right before filling and again before submitting: DDA's
// read-only PAN on the form must be the PAN whose details are used. True (and
// nothing filled or sent) when it isn't, or when DDA's PAN can't be read.
// Test fills (never submitted) and the admins' testing switch are exempt.
function stopIfFormIsNotFor(pan, step) {
  const isTest =
    window.__ddaTestAutofillMode === true ||
    sessionStorage.getItem("dda_test_autofill_mode") === "true" ||
    localStorage.getItem("dda_test_autofill_mode") === "true" ||
    sessionStorage.getItem("dda_test_skip_submit") === "true";
  if (isTest || differentApplicantAllowed()) return false;
  const formPan = (document.querySelector('input[name="pan"], input#pan, input#applicant_pan')?.value || "").toUpperCase().trim();
  if (DDA_PAN_RE.test(formPan) && formPan === pan) return false;
  const msg = DDA_PAN_RE.test(formPan)
    ? `⛔ Stopped before ${step}: this form is DDA account ${formPan}'s, but the details are ${pan || "nobody"}'s. Nothing was sent.`
    : `⛔ Stopped before ${step}: DDA's PAN can't be read on the form, so the app can't confirm whose form it is. Nothing was sent.`;
  appendRunLog(msg, "ERROR");
  try { ipcRenderer.send("dda:log", { level: "ERROR", pan: formPan || pan, page: "Form", msg }); } catch (_) {}
  stopSessionHeartbeat("Form stopped: details don't match DDA's account");
  return true;
}

// DDA no longer asks applicants for a photo and signature on the application form (25 Oct 2026),
// so the form is filled at once. This used to wait up to 6 s for those files to finish downloading
// (_missingMedia) before filling, which on a slow line only delayed the form and then filled the
// blank placeholders anyway. The files still download in the background (the applicant's documents
// need them), and if DDA ever asks for an upload again fillPhotoAndSignature still attaches a blank
// where DDA itself has nothing on file (ddaWantsUpload) - nothing else has to change here.
function runFormWhenFilesReady() {
  return runApplicationFormPage();
}

function runApplicationFormPage() {
  stopSessionHeartbeat("On Application Form page");
  emitAuthenticatedPanIfPresent();
  console.log(
    "📝 [DDA Extension] Page: Application Form (Fast Auto-Fill & Shadow Step 2 Pre-Resolver)",
  );
  logAnalyticsStep("step2_form", "Application Form Loaded");

  // Dynamically resolve latest active applicant
  if (!currentApplicant || !currentApplicant.personal) {
    try {
      if (typeof window !== "undefined" && window.__ACTIVE_APPLICANT__)
        currentApplicant = window.__ACTIVE_APPLICANT__;
      if (!currentApplicant) {
        const rawApp = sessionStorage.getItem("window.__ACTIVE_APPLICANT__") || localStorage.getItem("window.__ACTIVE_APPLICANT__");
        if (rawApp) currentApplicant = JSON.parse(rawApp);
      }
      if (!currentApplicant) {
        const rawPerson =
          sessionStorage.getItem("dda_authenticated_pan") ||
          sessionStorage.getItem("dda_selected_person") ||
          sessionStorage.getItem("dda_active_applicant_pan") ||
          localStorage.getItem("dda_selected_person") ||
          localStorage.getItem("dda_active_applicant_pan");
        const rawData = localStorage.getItem("ddaData");
        if (rawData && rawPerson) {
          const parsed = JSON.parse(rawData);
          if (parsed?.applicants && parsed.applicants[rawPerson]) {
            currentApplicant = parsed.applicants[rawPerson];
          }
        }
      }
      if (!currentApplicant) {
        const pagePanEl = document.querySelector('input#pan, input[name="pan"], input#applicant_pan');
        const pagePan = (pagePanEl?.value || '').toUpperCase().trim();
        if (pagePan && pagePan.length === 10) {
          const rawData = localStorage.getItem("ddaData");
          if (rawData) {
            const parsed = JSON.parse(rawData);
            if (parsed?.applicants && parsed.applicants[pagePan]) {
              currentApplicant = parsed.applicants[pagePan];
            }
          }
        }
      }
    } catch (_) {}
  }

  const p = currentApplicant?.personal || {};
  const b = currentApplicant?.bank || {};
  const a = currentApplicant?.address || {};
  const j = currentApplicant?.jointApplicant || {};
  const prefs =
    currentApplicant?.preferences || currentApplicant?.location || {};
  const pan = (currentApplicant?.pan || p.pan || "").trim().toUpperCase();

  if (stopIfFormIsNotFor(pan, "filling")) return;

  console.log(
    "📝 [DDA Application Form] Auto-filling for applicant:",
    p.firstName,
    p.lastName,
    pan,
    b,
    a,
  );

  const locMap = {
    1: "NARELA",
    2: "ROHINI",
    3: "TODAPUR",
    4: "LOKNAYAKPURAM",
    5: "DWARKA",
    NARELA: "NARELA",
    ROHINI: "ROHINI",
    TODAPUR: "TODAPUR",
    LOKNAYAKPURAM: "LOKNAYAKPURAM",
    DWARKA: "DWARKA",
  };
  const rawLoc = prefs.locality
    ? String(prefs.locality).trim().toUpperCase()
    : "1";

  const CONFIG = {
    TARGET_LOCALITY: locMap[rawLoc] || rawLoc || "NARELA",
    TARGET_SECTOR: prefs.sector || "",
    TARGET_POCKET: prefs.pocket || "",
    TARGET_BLOCK: prefs.block || "",
    TARGET_TOWER: prefs.tower || "",
    TARGET_DIRECT_URL: "",
  };

  function normalizeText(text) {
    if (typeof text !== "string") return "";
    return text
      .trim()
      .replace(/[-_–—/\\.]+/g, " ")
      .replace(/\s+/g, " ")
      .toUpperCase();
  }

  function extractNumber(text) {
    const match = String(text || "").match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  function toRoman(num) {
    // 1 to 39: I, V and X only, so a block or tower letter (L, C, D, M)
    // is never read as a number
    if (!Number.isInteger(num) || num < 1 || num > 39) return null;
    let out = "";
    for (const [v, r] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) {
      while (num >= v) { out += r; num -= v; }
    }
    return out;
  }

  function smartMatch(options, targetName) {
    if (!options || !options.length) return null;
    const target = String(targetName || "").trim();
    if (!target) return null;

    const normTarget = normalizeText(target);
    const targetNum = extractNumber(target);
    const romanTarget = targetNum ? toRoman(targetNum) : null;

    // 1. Exact match or Normalized match
    let match = options.find(
      (o) => o.name === target || normalizeText(o.name) === normTarget,
    );
    if (match) return match;

    // 1b. Same sector range, however it is written ("G-2 & G-6" = "G2 - G6")
    match = matchBySectorKey(options, target, (o) => o.name);
    if (match) return match;

    // 2. Normalized includes match
    match = options.find((o) => {
      const normOpt = normalizeText(o.name);
      return normOpt.includes(normTarget) || normTarget.includes(normOpt);
    });
    if (match) return match;

    // 3. Clean boundary match
    const cleanTarget = normTarget
      .replace(/\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\b/g, "")
      .trim();
    if (cleanTarget) {
      match = options.find((o) => {
        const normOpt = normalizeText(o.name);
        const cleanOpt = normOpt
          .replace(/\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\b/g, "")
          .trim();
        if (cleanOpt === cleanTarget) return true;
        const wordRegex = new RegExp(
          "(^|\\s|[^A-Z0-9])" + cleanTarget + "($|\\s|[^A-Z0-9])",
          "i",
        );
        if (wordRegex.test(normOpt)) return true;
        if (romanTarget) {
          const romanRegex = new RegExp(
            "(^|\\s|[^A-Z0-9])" + romanTarget + "($|\\s|[^A-Z0-9])",
            "i",
          );
          if (romanRegex.test(normOpt)) return true;
        }
        return false;
      });
      if (match) return match;
    }

    return null;
  }

  // ⚡ 1:1 Background Direct URL Resolution (Fallback if not already triggered on Schemes page)
  let resolveDirectUrlPromise = null;
  function startBackgroundDirectUrlResolution() {
    // DDA's newer form (/user/applicationForm/, 20 Oct): asking for the locality
    // page before this form is submitted ends the DDA session (every fresh login
    // was logged out within a second; the district list then answered 401). Here
    // the link is built after submitting, on DDA's locality page, as before
    // 18 Oct. The /user/userApplicationfrom/ form keeps the early build.
    if (/\/user\/applicationform\//i.test(window.location.pathname)) {
      appendRunLog(
        "ℹ️ This form type: the flat page link is built after the form is submitted (an earlier request ends DDA's session here).",
        "INFO",
      );
      return Promise.resolve(null);
    }
    const schemeId = window.location.pathname.split("/").filter(Boolean).pop();
    if (!schemeId) {
      console.warn(
        "⚠️ [DDA Background Prefetch] Could not determine Scheme ID from URL.",
      );
      return Promise.resolve(null);
    }
    // Pull a build the main process already finished (started when Apply was captured)
    adoptMainResolvedStep2(schemeId);
    const hashesRaw = localStorage.getItem("dda_locality_hashes");
    if (hashesRaw) {
      try {
        const h = JSON.parse(hashesRaw);
        if (
          h &&
          String(h.schemeId) === String(schemeId) &&
          h.localityHash &&
          h.sectorHash &&
          h.pocketHash &&
          h.blockHash
        ) {
          console.log(
            `✅ [DDA AppForm Pre-Resolver] Direct hashes already resolved from Schemes page for Scheme: ${schemeId}`,
          );
          return Promise.resolve(
            localStorage.getItem("dda_direct_flat_url") ||
              window.__ddaDirectFlatUrl,
          );
        }
      } catch (_) {}
    }
    // Join (or start) the main-process build; in-page resolver is the fallback
    return resolveStep2Preferred(schemeId, CONFIG);
  }

  // 🔥 Trigger background prefetch immediately on Application Form page load if needed
  resolveDirectUrlPromise = startBackgroundDirectUrlResolution();

  runWhenReady(async () => {
    // Stubs to prevent ReferenceErrors
    if (typeof window.ToggleCheckbox === "undefined")
      window.ToggleCheckbox = function () {};
    if (typeof window.get_district === "undefined")
      window.get_district = function () {};

    const nativeInputValSet = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    const nativeTextAreaValSet = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;

    const nativeSelectValSet = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )?.set;

    // Fields DDA fills from its own records and locks are never changed:
    // readonly/disabled, a "readonly" class, aria-readonly, or not clickable.
    // A radio counts as locked when any radio in its group is.
    const isLockedOne = (el) => Boolean(
      el.disabled ||
      el.readOnly ||
      el.hasAttribute('disabled') ||
      el.hasAttribute('readonly') ||
      el.classList?.contains('readonly') ||
      el.getAttribute('aria-readonly') === 'true' ||
      (() => { try { return window.getComputedStyle(el).pointerEvents === 'none'; } catch (_) { return false; } })()
    );
    const isFieldDisabledOrReadOnly = (el) => {
      if (!el) return false;
      if (isLockedOne(el)) return true;
      if (el.type === 'radio' && el.name) {
        const group = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
        return Array.from(group).some(isLockedOne);
      }
      return false;
    };

    function fastSetInputValue(el, val) {
      if (!el || val === undefined || val === null || isFieldDisabledOrReadOnly(el)) return;
      const strVal = String(val);
      if (nativeInputValSet && el instanceof HTMLInputElement) {
        nativeInputValSet.call(el, strVal);
      } else if (nativeTextAreaValSet && el instanceof HTMLTextAreaElement) {
        nativeTextAreaValSet.call(el, strVal);
      } else {
        el.value = strVal;
      }
      try {
        if (typeof window.jQuery !== "undefined" && window.jQuery(el).val)
          window.jQuery(el).val(strVal);
        else if (typeof window.$ !== "undefined" && window.$(el).val)
          window.$(el).val(strVal);
      } catch (_) {}
      try {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      } catch (_) {}
    }

    function fastSetSelectValue(el, val) {
      if (!el || val === undefined || val === null || isFieldDisabledOrReadOnly(el)) return;
      const strVal = String(val).trim();
      let opt = Array.from(el.options || []).find(
        (o) =>
          o.value === strVal ||
          String(o.value).trim() === strVal ||
          (strVal && o.text.trim().toUpperCase() === strVal.toUpperCase()),
      );
      if (!opt && strVal) {
        opt = new Option(strVal, strVal, true, true);
        el.appendChild(opt);
      }
      if (nativeSelectValSet && el instanceof HTMLSelectElement) {
        nativeSelectValSet.call(el, strVal);
      } else {
        el.value = strVal;
      }
      try {
        if (typeof window.jQuery !== "undefined" && window.jQuery(el).val)
          window.jQuery(el).val(strVal);
        else if (typeof window.$ !== "undefined" && window.$(el).val)
          window.$(el).val(strVal);
      } catch (_) {}
      try {
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (_) {}
    }

    const fastSetInput = (selectors, val) => {
      const strVal = (val === undefined || val === null) ? "" : String(val);
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          fastSetInputValue(el, strVal);
          return true;
        }
      }
      return false;
    };

    const fastSetSelect = (selectors, val) => {
      if (val === undefined || val === null) return false;
      const strVal = String(val).trim();
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.tagName === "SELECT") {
          fastSetSelectValue(el, strVal);
          return true;
        }
      }
      return false;
    };

    // 🧹 Clean-slate form purge: ensures zero bleed from previously loaded applicants (never clears readonly or disabled fields)
    function purgeApplicantFormFields() {
      // 1. Purge personal, bank, and address optional fields (never touch readonly PAN pre-set by DDA server or disabled fields)
      const textSelectors = [
        '#applicant_middle_name', 'input[name="applicant_middle_name"]',
        '#applicant_last_name', 'input[name="applicant_last_name"]',
        '#father_name', 'input[name="father_name"]',
        '#mother_name', 'input[name="mother_name"]',
        '#std_code', 'input[name="std_code"]',
        '#phone', 'input[name="phone"]',
        '#spouse_name', 'input[name="spouse_name"]',
        '#branch', 'input[name="branch"]',
        '#ifsc_code', 'input[name="ifsc_code"]',
        '#bank_account_number', 'input[name="bank_account_number"]',
        '#correspondence_address_house_no', 'input[name="correspondence_address_house_no"]',
        '#correspondence_address_street', 'input[name="correspondence_address_street"]',
        '#correspondence_address_area', 'input[name="correspondence_address_area"]',
        '#correspondence_address_town', 'input[name="correspondence_address_town"]',
        '#correspondence_address_pin', 'input[name="correspondence_address_pin"]',
        '#joint_applicant_first_name_1', 'input[name="joint_applicant[1][first_name]"]',
        '#joint_applicant_middle_name_1', 'input[name="joint_applicant[1][middle_name]"]',
        '#joint_applicant_last_name_1', 'input[name="joint_applicant[1][last_name]"]',
        '#joint_applicant_father_name_1', 'input[name="joint_applicant[1][father_name]"]',
        '#joint_applicant_mother_name_1', 'input[name="joint_applicant[1][mother_name]"]',
        '#joint_applicant_dob_1', 'input[name="joint_applicant[1][dob]"]',
        '#joint_applicant_pan_1', 'input[name="joint_applicant[1][pan]"]',
        '#joint_applicant_aadhar_1', 'input[name="joint_applicant[1][aadhar]"]',
        '#joint_applicant_email_1', 'input[name="joint_applicant[1][email]"]',
        '#joint_applicant_mobile_1', 'input[name="joint_applicant[1][mobile]"]',
        '#joint_applicant_spouse_name_1', 'input[name="joint_applicant[1][spouse_name]"]',
        '#other_pro_reg_Certificate_issued'
      ];
      for (const sel of textSelectors) {
        const el = document.querySelector(sel);
        if (el && !isFieldDisabledOrReadOnly(el)) fastSetInputValue(el, "");
      }

      // 2. Clear file attachments (including primary applicant photo & signature)
      const fileSelectors = [
        '#image', '#photo', 'input[name="photograph"]', 'input[name="image"]', 'input[type="file"][name*="photo"]', 'input[type="file"][name*="image"]',
        '#signature', 'input[name="signature"]', 'input[type="file"][name*="sign"]',
        '#joint_applicant_photograph_1', 'input[name="joint_applicant[1][photograph]"]',
        '#joint_applicant_signature_1', 'input[name="joint_applicant[1][signature]"]',
        '#emp_id_card_1a', '#emp_certificate_1a', '#salary_slip', '#form_16',
        '#professional_degree_certificate', '#income_tax_return', '#pro_reg_Certificate_issued_doc',
        '#emp_id_card_1b', '#emp_certificate_1b'
      ];
      for (const sel of fileSelectors) {
        const el = document.querySelector(sel);
        if (el && el.type === "file" && !isFieldDisabledOrReadOnly(el)) {
          try { el.value = ""; el.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
        }
      }

      // 3. Reset conditional containers
      const spouseCont = document.getElementById("marital_spouse");
      if (spouseCont) spouseCont.style.display = "none";
      const jSpouseCont = document.getElementById("joint_applicant_marital_spouse_1");
      if (jSpouseCont) jSpouseCont.style.display = "none";
      const otherProReg = document.getElementById("other_pro_reg_section");
      if (otherProReg) otherProReg.style.display = "none";
    }

    function fillDistrict() {
      const districtDropdown =
        document.getElementById("locality") ||
        document.querySelector(
          "select[name='correspondence_address_ref_district_id']",
        );
      const stateSelect =
        document.getElementById("correspondence_address_ref_state_id") ||
        document.querySelector(
          "select[name='correspondence_address_ref_state_id']",
        );

      if (!districtDropdown || !stateSelect) return;
      const targetStateId = String(a.stateId || a.state_id || "").trim();
      const targetDistrictId = String(a.districtId || a.district_id || "").trim();
      const targetDistrictName = String(a.districtName || a.district_name || a.district || "").trim().toUpperCase();

      const applyDistrict = () => {
        if (!districtDropdown || isFieldDisabledOrReadOnly(districtDropdown)) return;
        let matchedVal = null;
        const normTargetName = targetDistrictName.replace(/[^A-Z0-9]/g, "");

        // 1. Search existing options by ID or text match
        for (const opt of districtDropdown.options) {
          if (!opt.value) continue;
          const optVal = String(opt.value).trim();
          const optText = opt.text.trim().toUpperCase();
          const normOptText = optText.replace(/[^A-Z0-9]/g, "");

          if (targetDistrictId && optVal === targetDistrictId) {
            matchedVal = opt.value;
            break;
          }
          if (normTargetName && (normOptText === normTargetName || normOptText.includes(normTargetName) || normTargetName.includes(normOptText))) {
            matchedVal = opt.value;
            break;
          }
        }

        // 2. DDA's list not loaded yet: carry the record's own district id
        //    (never a guessed one; with no id the field stays for the user).
        if (!matchedVal && targetDistrictId && districtDropdown.options.length <= 1) {
          const opt = new Option(targetDistrictName || targetDistrictId, targetDistrictId, true, true);
          districtDropdown.appendChild(opt);
          matchedVal = targetDistrictId;
        }

        if (matchedVal && districtDropdown.value !== matchedVal) {
          fastSetSelectValue(districtDropdown, matchedVal);
        }
      };

      // Watch for DDA's asynchronous /user/ajax/district update
      try {
        const distObserver = new MutationObserver(() => {
          if (districtDropdown.options.length > 1) {
            applyDistrict();
          }
        });
        distObserver.observe(districtDropdown, { childList: true });
        setTimeout(() => distObserver.disconnect(), 5000);
      } catch (_) {}

      // Set state if known and not disabled
      if (targetStateId && !isFieldDisabledOrReadOnly(stateSelect)) {
        if (stateSelect.value !== targetStateId) {
          fastSetSelectValue(stateSelect, targetStateId);
        }
      }

      applyDistrict();
      [50, 150, 300, 600, 1200].forEach((ms) => setTimeout(applyDistrict, ms));

      // Region (1 = Delhi, 2 = Outside). DDA styles these radios unclickable
      // (pointer-events: none) but the user must still pick one, so the lock
      // check is not used here; only a truly disabled radio is left alone.
      // Without a stored region it follows the state (Delhi = 7).
      const applyRegion = () => {
        const stored = String(a.region || "").trim();
        const reg = stored || (targetStateId ? (targetStateId === "7" ? "1" : "2") : "");
        const r = reg && document.querySelector('input[name="region"][value="' + reg + '"]');
        if (!r || r.disabled || r.checked) return;
        r.checked = true;
        r.dispatchEvent(new Event("change", { bubbles: true }));
        try { document.getElementById("region-error")?.remove(); } catch (_) {}
      };
      applyRegion();
      [300, 1200].forEach((ms) => setTimeout(applyRegion, ms));
    }

    function base64ToFile(base64Data, defaultBaseName = "photo") {
      if (!base64Data || typeof base64Data !== "string") return null;
      const match = base64Data.match(
        /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/,
      );
      const mime = match ? match[1] : "image/jpeg";
      const rawBase64 = match ? match[2] : base64Data;
      const ext = mime.includes("png")
        ? "png"
        : mime.includes("pdf")
          ? "pdf"
          : "jpg";
      try {
        const byteChars = atob(rawBase64);
        let byteNums = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteNums[i] = byteChars.charCodeAt(i);
        }
        // Some stored PDFs carry junk before "%PDF" (one was saved inside a
        // Java-serialized HTTP response). PDF readers skip it, but DDA's type
        // check sees the junk, so DDA gets the PDF from "%PDF" on.
        if (ext === "pdf") {
          const head = byteChars.slice(0, 1024).indexOf("%PDF");
          if (head > 0) byteNums = byteNums.subarray(head);
        }
        const blob = new Blob([byteNums], { type: mime });
        return new File([blob], `${defaultBaseName}.${ext}`, { type: mime });
      } catch (_) {
        return null;
      }
    }

    function setFileInput(input, file) {
      if (!input || !file) return false;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      } catch (_) {
        return false;
      }
    }

    let photoFileObj = null;
    let signFileObj = null;
    let jPhotoFileObj = null;
    let jSignFileObj = null;
    let empIdCard1aFile = null;
    let empCert1aFile = null;
    let salarySlipFile = null;
    let form16File = null;
    let profDegreeFile = null;
    let itrFile = null;
    let proRegDocFile = null;
    let empIdCard1bFile = null;
    let empCert1bFile = null;

    const isTestMode =
      sessionStorage.getItem("dda_test_autofill_mode") === "true" ||
      localStorage.getItem("dda_test_autofill_mode") === "true" ||
      sessionStorage.getItem("dda_test_skip_submit") === "true" ||
      window.__ddaTestAutofillMode === true;

    const hasJoint = !!(
      j &&
      (j.firstName || j.pan || j.relation || j.relationship || j.enabled === true || j.enabled === "1")
    );

    // A field is filled only from a value the applicant record really has;
    // nothing is invented, and a value DDA already shows is never blanked.
    const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== "";
    const fillIfKnown = (selectors, val) => (hasVal(val) ? fastSetInput(selectors, val) : false);

    // Karmajeevi: only applicants marked eligible, with a para type chosen.
    const elig = currentApplicant?.eligibility || {};
    const isKarmajeeviEligible =
      elig.enabled !== false && elig.enabled !== "false" && hasVal(elig.paraType);

    function fillPhotoAndSignature() {
      // 📸 Primary Applicant Photo & Signature Auto-Injection
      const photoInput = document.querySelector(
        '#image, #photo, input[name="photograph"], input[name="image"], input[type="file"][name*="photo"], input[type="file"][name*="image"]',
      );
      const signInput = document.querySelector(
        '#signature, input[name="signature"], input[type="file"][name*="sign"]',
      );
      const photoData =
        p.photo ||
        currentApplicant.photo ||
        p.photoUrl ||
        currentApplicant.photoUrl ||
        "";
      const signData =
        p.sign ||
        currentApplicant.sign ||
        p.signature ||
        currentApplicant.signature ||
        "";

      // No photo / signature saved for this applicant, but DDA's form asks for one
      // and has none on file: a blank white JPG goes in its place (to be replaced
      // with the real one through DDA later). Never over a photo DDA already has.
      const isPhotoBox = (el) => !!el && (el.id === "image" || el.name === "photograph");
      const isSignBox = (el) => !!el && (el.id === "signature" || el.name === "signature");
      // Decided once per page: the form is filled more than once, and after the
      // first time the box shows the blank itself, not DDA's default picture.
      if (!photoData && isPhotoBox(photoInput) && ddaWantsUpload(photoInput, "photog", "pic")) window.__ddaBlankPhotoUsed = true;
      if (!signData && isSignBox(signInput) && ddaWantsUpload(signInput, "sign", "sgn")) window.__ddaBlankSignUsed = true;
      const usePhoto = photoData || (window.__ddaBlankPhotoUsed ? BLANK_IMAGES.photo : "");
      const useSign = signData || (window.__ddaBlankSignUsed ? BLANK_IMAGES.signature : "");
      if (!photoData && usePhoto && !window.__ddaBlankPhotoLogged) {
        window.__ddaBlankPhotoLogged = true;
        appendRunLog("📷 No photo saved for this applicant: attached a blank white photo, since DDA's form asks for one. Send the real photo to DDA later.", "WARN");
      }
      if (!signData && useSign && !window.__ddaBlankSignLogged) {
        window.__ddaBlankSignLogged = true;
        appendRunLog("✍️ No signature saved for this applicant: attached a blank white signature, since DDA's form asks for one. Send the real signature to DDA later.", "WARN");
      }

      if (photoInput) {
        if (usePhoto) {
          photoFileObj = base64ToFile(usePhoto, "photo");
          if (photoFileObj) {
            setFileInput(photoInput, photoFileObj);
            const previewImg = document.getElementById("photog");
            if (previewImg && usePhoto.startsWith("data:")) previewImg.src = usePhoto;
            const picHidden = document.getElementById("pic");
            if (picHidden) picHidden.value = photoFileObj.name;
          }
        } else {
          try { photoInput.value = ""; photoInput.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
        }
      }
      if (signInput) {
        if (useSign) {
          signFileObj = base64ToFile(useSign, "signature");
          if (signFileObj) {
            setFileInput(signInput, signFileObj);
            const previewSign = document.getElementById("sign");
            if (previewSign && useSign.startsWith("data:")) previewSign.src = useSign;
            const sgnHidden = document.getElementById("sgn");
            if (sgnHidden) sgnHidden.value = signFileObj.name;
          }
        } else {
          try { signInput.value = ""; signInput.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
        }
      }

      // 👥 Joint Applicant Photo & Signature (if joint applicant attached)
      if (hasJoint) {
        const jPhotoInput = document.querySelector(
          "#joint_applicant_photograph_1, input[name='joint_applicant[1][photograph]']",
        );
        const jSignInput = document.querySelector(
          "#joint_applicant_signature_1, input[name='joint_applicant[1][signature]']",
        );
        // Same rule for the joint applicant: a blank only when DDA asks and has none.
        if (!j.photo && ddaWantsUpload(jPhotoInput, "jphotog1", "hphoto1")) window.__ddaBlankJointPhotoUsed = true;
        if (!(j.sign || j.signature) && ddaWantsUpload(jSignInput, "jsign1", "hsign1")) window.__ddaBlankJointSignUsed = true;
        const jPhotoData = j.photo || (window.__ddaBlankJointPhotoUsed ? BLANK_IMAGES.photo : "");
        const jSignData = j.sign || j.signature || (window.__ddaBlankJointSignUsed ? BLANK_IMAGES.signature : "");
        if ((!j.photo && jPhotoData) || (!(j.sign || j.signature) && jSignData)) {
          if (!window.__ddaBlankJointLogged) {
            window.__ddaBlankJointLogged = true;
            appendRunLog("📷 Joint applicant has no photo or signature saved: attached blank white images where DDA's form asks for them. Send the real ones to DDA later.", "WARN");
          }
        }
        if (jPhotoInput) {
          if (jPhotoData) {
            jPhotoFileObj = base64ToFile(jPhotoData, "joint_photo");
            if (jPhotoFileObj) {
              setFileInput(jPhotoInput, jPhotoFileObj);
              const jPreview = document.getElementById("jphotog1");
              if (jPreview && jPhotoData.startsWith("data:")) jPreview.src = jPhotoData;
              const hphoto = document.getElementById("hphoto1");
              if (hphoto) hphoto.value = jPhotoFileObj.name;
            }
          } else {
            try { jPhotoInput.value = ""; jPhotoInput.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
          }
        }
        if (jSignInput) {
          if (jSignData) {
            jSignFileObj = base64ToFile(jSignData, "joint_sign");
            if (jSignFileObj) {
              setFileInput(jSignInput, jSignFileObj);
              const jPreview = document.getElementById("jsign1");
              if (jPreview && jSignData.startsWith("data:")) jPreview.src = jSignData;
              const hsign = document.getElementById("hsign1");
              if (hsign) hsign.value = jSignFileObj.name;
            }
          } else {
            try { jSignInput.value = ""; jSignInput.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
          }
        }
      }
    }

    function fillKarmajeeviEligibility() {
      // 🎓 Karamjeevi Scheme Eligibility Documents Auto-Injection
      const el = elig;
      const paraSelect =
        document.getElementById("para_type") ||
        document.querySelector("select[name='para_type']");
      if (!paraSelect) return; // Not a Karmajeevi form or section not present

      if (!isKarmajeeviEligible) {
        if (!paraSelect.value) {
          appendRunLog(
            "⚠️ This applicant has no Karmajeevi eligibility details — fill the Para 2.4 section on the form by hand.",
            "WARN",
          );
        }
        return;
      }
      // Skip Form, or a choice DDA has locked: a different saved choice is kept as is.
      if ((effectiveFastPass || isFieldDisabledOrReadOnly(paraSelect)) && paraSelect.value && paraSelect.value !== String(el.paraType).trim()) {
        appendRunLog(
          `ℹ️ Skip Form: keeping DDA's saved Para 2.4 choice (${paraSelect.value}); the applicant record says ${el.paraType}.`,
          "INFO",
        );
        return;
      }

      try {
        const pType = String(el.paraType).trim();
        fastSetSelectValue(paraSelect, pType);

        if (pType === "1a") {
          const sec1a = document.getElementById("documents_1a_section");
          if (sec1a) sec1a.style.display = "flex";
          const sec1b = document.getElementById("documents_1b_section");
          if (sec1b) sec1b.style.display = "none";

          const empCertType = document.getElementById(
            "emp_id_card_certificate_type",
          );
          if (empCertType && hasVal(el.empIdCardCertificateType)) {
            fastSetSelectValue(empCertType, el.empIdCardCertificateType);

            if (String(el.empIdCardCertificateType) === "2") {
              const s2 = document.getElementById(
                "emp_certificate_1a_section",
              );
              if (s2) s2.style.display = "";
              const s1 = document.getElementById("emp_id_card_1a_section");
              if (s1) s1.style.display = "none";
              const f = document.getElementById("emp_certificate_1a");
              if (f && el.empCertificate1a) {
                empCert1aFile = base64ToFile(
                  el.empCertificate1a,
                  "employer_certificate_1a",
                );
                if (empCert1aFile) setFileInput(f, empCert1aFile);
              }
            } else if (String(el.empIdCardCertificateType) === "1") {
              const s1 = document.getElementById("emp_id_card_1a_section");
              if (s1) s1.style.display = "";
              const s2 = document.getElementById(
                "emp_certificate_1a_section",
              );
              if (s2) s2.style.display = "none";
              const f = document.getElementById("emp_id_card_1a");
              if (f && el.empIdCard1a) {
                empIdCard1aFile = base64ToFile(
                  el.empIdCard1a,
                  "emp_id_card_1a",
                );
                if (empIdCard1aFile) setFileInput(f, empIdCard1aFile);
              }
            }
          }

          const salType = document.getElementById("salary_slip_form_16_type");
          if (salType && hasVal(el.salarySlipForm16Type)) {
            fastSetSelectValue(salType, el.salarySlipForm16Type);

            if (String(el.salarySlipForm16Type) === "2") {
              const sf = document.getElementById("form_16_section");
              if (sf) sf.style.display = "";
              const ss = document.getElementById("salary_slip_section");
              if (ss) ss.style.display = "none";
              const f = document.getElementById("form_16");
              if (f && el.form16) {
                form16File = base64ToFile(el.form16, "form_16");
                if (form16File) setFileInput(f, form16File);
              }
            } else if (String(el.salarySlipForm16Type) === "1") {
              const ss = document.getElementById("salary_slip_section");
              if (ss) ss.style.display = "";
              const sf = document.getElementById("form_16_section");
              if (sf) sf.style.display = "none";
              const f = document.getElementById("salary_slip");
              if (f && el.salarySlip) {
                salarySlipFile = base64ToFile(el.salarySlip, "salary_slip");
                if (salarySlipFile) setFileInput(f, salarySlipFile);
              }
            }
          }
        } else if (pType === "1b") {
          const sec1b = document.getElementById("documents_1b_section");
          if (sec1b) sec1b.style.display = "flex";
          const sec1a = document.getElementById("documents_1a_section");
          if (sec1a) sec1a.style.display = "none";

          const degInput = document.getElementById(
            "professional_degree_certificate",
          );
          if (degInput && el.professionalDegreeCertificate) {
            profDegreeFile = base64ToFile(
              el.professionalDegreeCertificate,
              "professional_degree",
            );
            if (profDegreeFile) setFileInput(degInput, profDegreeFile);
          }

          const itrInput = document.getElementById("income_tax_return");
          if (itrInput && el.incomeTaxReturn) {
            itrFile = base64ToFile(el.incomeTaxReturn, "itr");
            if (itrFile) setFileInput(itrInput, itrFile);
          }

          const proBodySelect = document.getElementById(
            "pro_reg_Certificate_issued",
          );
          if (proBodySelect && el.proRegCertificateIssued) {
            fastSetSelectValue(proBodySelect, el.proRegCertificateIssued);
            if (el.proRegCertificateIssued === "other") {
              const otherSec = document.getElementById(
                "other_pro_reg_section",
              );
              if (otherSec) otherSec.style.display = "";
              const otherInput = document.getElementById(
                "other_pro_reg_Certificate_issued",
              );
              if (otherInput && !isFieldDisabledOrReadOnly(otherInput))
                otherInput.value = el.otherProRegCertificateIssued || "";
            }
            const docInput = document.getElementById(
              "pro_reg_Certificate_issued_doc",
            );
            if (docInput && el.proRegCertificateIssuedDoc) {
              proRegDocFile = base64ToFile(
                el.proRegCertificateIssuedDoc,
                "pro_reg_doc",
              );
              if (proRegDocFile) setFileInput(docInput, proRegDocFile);
            }
          }

          const empCert1b = document.getElementById(
            "emp_id_card_certificate_1b",
          );
          if (empCert1b && el.empIdCardCertificate1b) {
            fastSetSelectValue(empCert1b, el.empIdCardCertificate1b);
            empCert1b.dispatchEvent(new Event("change", { bubbles: true }));
            if (String(el.empIdCardCertificate1b) === "1") {
              const sec = document.getElementById("emp_id_card_1b_section");
              if (sec) sec.style.display = "";
              const f = document.getElementById("emp_id_card_1b");
              if (f && el.empIdCard1b) {
                empIdCard1bFile = base64ToFile(
                  el.empIdCard1b,
                  "emp_id_card_1b",
                );
                if (empIdCard1bFile) setFileInput(f, empIdCard1bFile);
              }
            } else if (String(el.empIdCardCertificate1b) === "2") {
              const sec = document.getElementById(
                "emp_certificate_1b_section",
              );
              if (sec) sec.style.display = "";
              const f = document.getElementById("emp_certificate_1b");
              if (f && el.empCertificate1b) {
                empCert1bFile = base64ToFile(
                  el.empCertificate1b,
                  "emp_certificate_1b",
                );
                if (empCert1bFile) setFileInput(f, empCert1bFile);
              }
            }
          }
        }
      } catch (elErr) {
        console.warn(
          "⚠️ [AppForm] Karamjeevi eligibility documents autofill error:",
          elErr,
        );
      }
    }

    // ─── Pillar 1: Universal Joint Applicant Synchronization ───
    function syncJointApplicant(hasJointApplicant, isFastPassMode) {
      const jointYesRadio = document.querySelector(
        "input.is_add_joint[value='1'], #is_add_joint_yes",
      );
      const jointNoRadio = document.querySelector(
        "input.is_add_joint[value='0'], #is_add_joint_no",
      );

      if (hasJointApplicant) {
        if (jointYesRadio && !isFieldDisabledOrReadOnly(jointYesRadio)) {
          jointYesRadio.checked = true;
          if (jointNoRadio) jointNoRadio.checked = false;
          jointYesRadio.dispatchEvent(new Event("change", { bubbles: true }));
          jointYesRadio.dispatchEvent(new Event("click", { bubbles: true }));
        }
        if (!isFastPassMode) {
          fastSetInput(
            [
              "#joint_applicant_first_name_1",
              'input[name="joint_applicant[1][first_name]"]',
            ],
            j.firstName || "",
          );
          fastSetInput(
            [
              "#joint_applicant_middle_name_1",
              'input[name="joint_applicant[1][middle_name]"]',
            ],
            j.middleName || "",
          );
          fastSetInput(
            [
              "#joint_applicant_last_name_1",
              'input[name="joint_applicant[1][last_name]"]',
            ],
            j.lastName || "",
          );
          fastSetInput(
            [
              "#joint_applicant_father_name_1",
              'input[name="joint_applicant[1][father_name]"]',
            ],
            j.fatherName || "",
          );
          fastSetInput(
            [
              "#joint_applicant_mother_name_1",
              'input[name="joint_applicant[1][mother_name]"]',
            ],
            j.motherName || "",
          );
          fastSetInput(
            ["#joint_applicant_dob_1", 'input[name="joint_applicant[1][dob]"]'],
            j.dob || "",
          );
          fastSetInput(
            ["#joint_applicant_pan_1", 'input[name="joint_applicant[1][pan]"]'],
            (j.pan || "").toUpperCase(),
          );
          fastSetInput(
            [
              "#joint_applicant_aadhar_1",
              'input[name="joint_applicant[1][aadhar]"]',
            ],
            j.aadhar || "",
          );
          fastSetInput(
            [
              "#joint_applicant_email_1",
              'input[name="joint_applicant[1][email]"]',
            ],
            j.email || "",
          );
          fastSetInput(
            [
              "#joint_applicant_mobile_1",
              'input[name="joint_applicant[1][mobile]"]',
            ],
            j.mobile || "",
          );

          const relSelect = document.querySelector(
            "#joint_applicant_relation_1, select[name='joint_applicant[1][joint_applicant_relation]']",
          );
          if (relSelect && (j.relation || j.relationship)) {
            fastSetSelectValue(relSelect, j.relation || j.relationship);
          }

          const jGenderSelect = document.querySelector(
            "#joint_applicant_gender_1, select[name='joint_applicant[1][gender]']",
          );
          if (jGenderSelect && j.gender) {
            fastSetSelectValue(jGenderSelect, j.gender);
          }

          const jMaritalSelect = document.querySelector(
            "#joint_applicant_marital_status_1, select[name='joint_applicant[1][marital_status]']",
          );
          const jSpouseContainer = document.getElementById(
            "joint_applicant_marital_spouse_1",
          );
          if (jMaritalSelect && j.maritalStatus) {
            fastSetSelectValue(jMaritalSelect, j.maritalStatus);
            if (String(j.maritalStatus) === "2") {
              if (jSpouseContainer) jSpouseContainer.style.display = "";
              fastSetInput(
                [
                  "#joint_applicant_spouse_name_1",
                  'input[name="joint_applicant[1][spouse_name]"]',
                ],
                j.spouseName || "",
              );
            } else {
              if (jSpouseContainer) jSpouseContainer.style.display = "none";
              fastSetInput(
                [
                  "#joint_applicant_spouse_name_1",
                  'input[name="joint_applicant[1][spouse_name]"]',
                ],
                "",
              );
            }
          } else {
            if (jSpouseContainer) jSpouseContainer.style.display = "none";
            fastSetInput(
              [
                "#joint_applicant_spouse_name_1",
                'input[name="joint_applicant[1][spouse_name]"]',
              ],
              "",
            );
          }

          const jCategorySelect = document.querySelector(
            "#joint_applicant_ref_category_id_1, select[name='joint_applicant[1][ref_category_id]']",
          );
          if (jCategorySelect && (j.categoryId || j.category)) {
            fastSetSelectValue(jCategorySelect, j.categoryId || j.category);
          }
        }
      } else {
        if (jointNoRadio && !isFieldDisabledOrReadOnly(jointNoRadio)) {
          jointNoRadio.checked = true;
          if (jointYesRadio) jointYesRadio.checked = false;
          jointNoRadio.dispatchEvent(new Event("change", { bubbles: true }));
          jointNoRadio.dispatchEvent(new Event("click", { bubbles: true }));
        }
        const jointFieldsToClear = [
          "#joint_applicant_first_name_1", 'input[name="joint_applicant[1][first_name]"]',
          "#joint_applicant_middle_name_1", 'input[name="joint_applicant[1][middle_name]"]',
          "#joint_applicant_last_name_1", 'input[name="joint_applicant[1][last_name]"]',
          "#joint_applicant_father_name_1", 'input[name="joint_applicant[1][father_name]"]',
          "#joint_applicant_mother_name_1", 'input[name="joint_applicant[1][mother_name]"]',
          "#joint_applicant_dob_1", 'input[name="joint_applicant[1][dob]"]',
          "#joint_applicant_pan_1", 'input[name="joint_applicant[1][pan]"]',
          "#joint_applicant_aadhar_1", 'input[name="joint_applicant[1][aadhar]"]',
          "#joint_applicant_email_1", 'input[name="joint_applicant[1][email]"]',
          "#joint_applicant_mobile_1", 'input[name="joint_applicant[1][mobile]"]',
          "#joint_applicant_spouse_name_1", 'input[name="joint_applicant[1][spouse_name]"]',
        ];
        for (const sel of jointFieldsToClear) {
          const el = document.querySelector(sel);
          if (el) fastSetInputValue(el, "");
        }
        // Un-require all joint inputs so hidden fields cannot block HTML5 validation
        document.querySelectorAll(
          'input[name^="joint_applicant"], select[name^="joint_applicant"], textarea[name^="joint_applicant"]'
        ).forEach(el => {
          el.required = false;
          el.removeAttribute("required");
        });

        const jPhotoInput = document.querySelector(
          "#joint_applicant_photograph_1, input[name='joint_applicant[1][photograph]']",
        );
        const jSignInput = document.querySelector(
          "#joint_applicant_signature_1, input[name='joint_applicant[1][signature]']",
        );
        if (jPhotoInput) {
          try { jPhotoInput.value = ""; jPhotoInput.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
        }
        if (jSignInput) {
          try { jSignInput.value = ""; jSignInput.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
        }
        const jSpouseContainer = document.getElementById("joint_applicant_marital_spouse_1");
        if (jSpouseContainer) jSpouseContainer.style.display = "none";
      }
    }

    // Skip Form: the app's setting (from main, kept current via
    // session:settingsUpdated) decides; the page's own localStorage copy only
    // when that setting never arrived.
    const fastPassSetting = currentSettings?.prefilledFastPass;
    const isFastPass = !isTestMode && (
      typeof fastPassSetting === "boolean"
        ? fastPassSetting
        : localStorage.getItem("dda_prefilled_fastpass") === "true"
    );

    // ─── Pillar 2: Pre-Filled Detection & Safety Fallback in Skip Form Mode ───
    let effectiveFastPass = isFastPass;
    if (isFastPass) {
      const prefilledName = (
        document.querySelector('#applicant_first_name, input[name="applicant_first_name"], input[name="first_name"]')?.value || ""
      ).trim();
      const prefilledFather = (
        document.querySelector('#father_name, input[name="father_name"]')?.value || ""
      ).trim();
      const prefilledMobile = (
        document.querySelector('#mobile, input[name="mobile"]')?.value || ""
      ).trim();

      if (!prefilledName && !prefilledFather && !prefilledMobile) {
        console.warn(
          "⚠️ [AppForm] Fast-Pass Active but DDA form fields are completely blank! Falling back to full form autofill...",
        );
        appendRunLog(
          "⚠️ Fast-Pass Active but DDA form is blank! Auto-filling full application...",
          "WARN",
        );
        effectiveFastPass = false;
      } else {
        // DDA's saved copy can hold another person's details (an earlier wrong
        // submit on this account). Names differ -> fill the whole form from the record.
        const norm = (v) => String(v || "").toUpperCase().replace(/[^A-Z]/g, "");
        const differs = (onForm, inRecord) => !!norm(inRecord) && norm(onForm) !== norm(inRecord);
        const badFirst = differs(prefilledName, p.firstName);
        const badFather = differs(prefilledFather, p.fatherName);
        if (badFirst || badFather) {
          const what = [
            badFirst && `first name "${prefilledName || "(blank)"}" instead of "${p.firstName}"`,
            badFather && `father's name "${prefilledFather || "(blank)"}" instead of "${p.fatherName}"`,
          ].filter(Boolean).join(" and ");
          const msg = `⚠️ Skip Form: DDA's saved form on this account has ${what} — filling the whole form with ${pan}'s details instead.`;
          appendRunLog(msg, "WARN");
          ipcRenderer.send("dda:log", { level: "WARN", pan, page: "Form", msg });
          effectiveFastPass = false;
        }
      }
    }

    if (effectiveFastPass) {
      console.log(
        "⚡ [AppForm] Fast-Pass Mode active! Skipping 25+ DOM field injections for pre-saved application...",
      );
      appendRunLog(
        "⚡ Fast-Pass Active: Skipping 25+ DOM field inputs for prefilled form",
        "ROUTE",
      );

      const ackBox = document.querySelector(
        '#acknowledge, input[name="acknowledge"]',
      );
      if (ackBox && !isFieldDisabledOrReadOnly(ackBox)) {
        ackBox.checked = true;
        ackBox.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Check & upload Photo & Signature (if present on the page)
      fillPhotoAndSignature();

      // Check & upload Karamjeevi 2.4 Eligibility Documents (if present on the page)
      fillKarmajeeviEligibility();

      // ─── Pillar 1: Universal Joint Applicant Synchronization in Fast-Pass ───
      syncJointApplicant(hasJoint, true);
      // DDA shows the joint applicant's section only once "joint applicant" is
      // chosen (just above): fill its photo / signature now that it is visible.
      if (hasJoint) fillPhotoAndSignature();
    } else {
      // Standard Fresh Mode: Fill all 25+ Personal, Bank, Address, Joint, and Eligibility fields
      purgeApplicantFormFields();

      // 1. Personal Details (PAN is read-only and pre-set by DDA server for active session; never overwrite)
      fillIfKnown(
        ["#applicant_first_name", 'input[name="applicant_first_name"]'],
        p.firstName,
      );
      fillIfKnown(
        ["#applicant_middle_name", 'input[name="applicant_middle_name"]'],
        p.middleName,
      );
      fillIfKnown(
        ["#applicant_last_name", 'input[name="applicant_last_name"]'],
        p.lastName,
      );
      fillIfKnown(
        ["#father_name", 'input[name="father_name"]'],
        p.fatherName,
      );
      fillIfKnown(
        ["#mother_name", 'input[name="mother_name"]'],
        p.motherName,
      );
      fillIfKnown(["#dob", 'input[name="dob"]'], p.dob);
      fillIfKnown(["#aadhar", 'input[name="aadhar"]'], p.aadhar);
      fillIfKnown(["#mobile", 'input[name="mobile"]'], p.mobile);
      fillIfKnown(["#email_id", 'input[name="email_id"]'], p.email);
      fillIfKnown(["#std_code", 'input[name="std_code"]'], p.stdCode);
      fillIfKnown(["#phone", 'input[name="phone"]'], p.phone);

      // Gender
      if (hasVal(p.gender)) {
        const g = String(p.gender).trim().toUpperCase();
        const genderVal = g.startsWith("F") ? "F" : g.startsWith("T") ? "T" : "M";
        const genderRadio = document.querySelector(
          `input[name="gender"][value="${genderVal}"]`,
        );
        if (genderRadio && !isFieldDisabledOrReadOnly(genderRadio)) {
          genderRadio.checked = true;
          genderRadio.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      // Nationality
      if (hasVal(p.nationality)) {
        const natVal = String(p.nationality).trim();
        const natRadio = document.querySelector(
          `input[name="nationality"][value="${natVal}"]`,
        ) || (natVal === "1" ? document.getElementById("nationality_1") : null);
        if (natRadio && !isFieldDisabledOrReadOnly(natRadio)) {
          natRadio.checked = true;
          natRadio.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      // Marital Status
      if (hasVal(p.maritalStatus)) {
        const maritalVal =
          String(p.maritalStatus).toUpperCase().includes("MARR") ||
          String(p.maritalStatus).trim() === "2"
            ? "2"
            : "1";
        const maritalSelect = document.querySelector(
          'select#marital_status, select[name="marital_status"]',
        );
        if (maritalSelect) {
          fastSetSelectValue(maritalSelect, maritalVal);
        }
        const spouseCont = document.getElementById("marital_spouse");
        if (maritalVal === "2") {
          if (spouseCont) spouseCont.style.display = "";
          fillIfKnown(["#spouse_name", 'input[name="spouse_name"]'], p.spouseName);
        } else {
          if (spouseCont) spouseCont.style.display = "none";
          fastSetInput(
            ["#spouse_name", 'input[name="spouse_name"]'],
            "",
          );
        }
      }

      // Category
      const catSelect = document.querySelector(
        'select#ref_category_id, select[name="ref_category_id"]',
      );
      if (catSelect && hasVal(p.categoryId)) {
        fastSetSelectValue(catSelect, p.categoryId);
      }

      // Physically handicapped + percentage: DDA shows them only for the PwD
      // category (8); any other category sends DDA's defaults (No).
      const isPwdCategory = String(catSelect?.value || p.categoryId || "").trim() === "8";
      const phYes = isPwdCategory && (p.isPhysicallyDisabled === true || String(p.isPhysicallyDisabled) === "1");
      const checkPhRadio = (name, value) => {
        const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
        if (r && !isFieldDisabledOrReadOnly(r) && !r.checked) {
          r.checked = true;
          r.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };
      checkPhRadio("is_physically_disabled", phYes ? "1" : "0");
      const phSection = document.getElementById("physically_handicapped_full_section");
      if (phSection && isPwdCategory) phSection.style.display = "";
      if (phYes) {
        const pctSection = document.getElementById("percentage_section");
        if (pctSection) pctSection.style.display = "";
        const pct = String(p.physicallyDisabledPercentage || "").trim();
        if (pct === "1" || pct === "2") checkPhRadio("percentage_of_physically_disabled", pct);
        else appendRunLog("♿ Physically handicapped: Yes, but above / below 40% isn't saved for this applicant, so DDA's default (Below 40%) is sent. Change it on the form if that's wrong.", "WARN");
      }

      // Bank Details (by DDA's bank id first, then by name)
      const bankSelect = document.querySelector('select[name="bank_id"]');
      const bankId = String(b.bankId || "").trim();
      const bankName = String(b.bankName || "").trim().toUpperCase();
      if (bankSelect && (bankId || bankName)) {
        const opts = Array.from(bankSelect.options).filter((o) => o.value);
        const opt =
          (bankId && opts.find((o) => String(o.value).trim() === bankId)) ||
          (bankName && opts.find((o) => o.text.trim().toUpperCase() === bankName)) ||
          (bankName && opts.find((o) => o.text.toUpperCase().includes(bankName)));
        if (opt) fastSetSelectValue(bankSelect, opt.value);
      }
      fillIfKnown(["#branch", 'input[name="branch"]'], b.branchName);
      fillIfKnown(
        ["#ifsc_code", 'input[name="ifsc_code"]'],
        String(b.ifsc || b.ifscCode || "").toUpperCase(),
      );
      fillIfKnown(
        ["#bank_account_number", 'input[name="bank_account_number"]'],
        b.accountNo || b.accountNumber,
      );

      // Address Details
      fillIfKnown(
        [
          "#correspondence_address_house_no",
          'input[name="correspondence_address_house_no"]',
        ],
        a.houseNo || a.address || p.address,
      );
      fillIfKnown(
        [
          "#correspondence_address_street",
          'input[name="correspondence_address_street"]',
        ],
        a.street || a.addressLine2,
      );
      fillIfKnown(
        [
          "#correspondence_address_area",
          'input[name="correspondence_address_area"]',
        ],
        a.area || a.city,
      );
      fillIfKnown(
        [
          "#correspondence_address_town",
          'input[name="correspondence_address_town"]',
        ],
        a.town,
      );
      fillIfKnown(
        [
          "#correspondence_address_pin",
          'input[name="correspondence_address_pin"]',
        ],
        a.pinCode || a.pincode || a.pin,
      );

      // State & District
      fillDistrict();

      // Declaration Checkbox
      const ackBox = document.querySelector(
        '#acknowledge, input[name="acknowledge"]',
      );
      if (ackBox && !isFieldDisabledOrReadOnly(ackBox)) {
        ackBox.checked = true;
        ackBox.dispatchEvent(new Event("change", { bubbles: true }));
      }


      // ─── Pillar 1: Universal Joint Applicant Synchronization in Fresh Mode ───
      syncJointApplicant(hasJoint, false);

      // Check & upload Photo & Signature (if present on the page)
      fillPhotoAndSignature();

      // Check & upload Karamjeevi 2.4 Eligibility Documents (if present on the page)
      fillKarmajeeviEligibility();
    }

    // 🧪 Test Application Form Mode: Halt after filling all DOM fields & files, strictly bypassing submission
    if (isTestMode) {
      sessionStorage.removeItem("dda_test_autofill_mode");
      localStorage.removeItem("dda_test_autofill_mode");
      sessionStorage.removeItem("dda_test_skip_submit");
      delete window.__ddaTestAutofillMode;

      console.log(
        "🧪 [DDA Application Form] Test Autofill COMPLETE: All personal, bank, address, joint, and eligibility fields/documents populated. Auto-submission bypassed for user inspection.",
      );
      appendRunLog(
        `🧪 [Test Mode] Application form autofilled successfully for ${p.firstName || "Applicant"} (${pan || ""}). Auto-submit bypassed for visual inspection.`,
        "SUCCESS",
      );
      ipcRenderer.send("dda:log", {
        level: "SUCCESS",
        pan: pan,
        page: "Form Test",
        msg: `🧪 [Test Mode] Application form autofilled with ${p.firstName || "Applicant"}'s details. Form NOT submitted. Ready for inspection.`,
      });
      return;
    }

    if (stopIfFormIsNotFor(pan, "submitting")) return;

    // Direct Fast-Pass AJAX Store Dispatch
    const formEl =
      document.getElementById("applicantForm") ||
      document.querySelector("form");
    const csrfToken = getDdaCsrfToken();

    if (formEl && csrfToken) {
      try {
        const formData = new FormData(formEl);
        formData.set("_token", csrfToken);
        if (!formData.get("acknowledge")) formData.set("acknowledge", "yes");
        formData.set("is_add_joint", hasJoint ? "1" : "0");
        // District list may still be loading: send the record's own id.
        const recordDistrictId = String(a.districtId || a.district_id || "").trim();
        if (!formData.get("correspondence_address_ref_district_id") && recordDistrictId)
          formData.set("correspondence_address_ref_district_id", recordDistrictId);
        if (photoFileObj) {
          formData.set("photograph", photoFileObj);
          formData.set("image", photoFileObj);
        }
        if (signFileObj) {
          formData.set("signature", signFileObj);
        }
        if (jPhotoFileObj) {
          formData.set("joint_applicant[1][photograph]", jPhotoFileObj);
        }
        if (jSignFileObj) {
          formData.set("joint_applicant[1][signature]", jSignFileObj);
        }
        if (empIdCard1aFile) formData.set("emp_id_card_1a", empIdCard1aFile);
        if (empCert1aFile) formData.set("emp_certificate_1a", empCert1aFile);
        if (salarySlipFile) formData.set("salary_slip", salarySlipFile);
        if (form16File) formData.set("form_16", form16File);
        if (profDegreeFile)
          formData.set("professional_degree_certificate", profDegreeFile);
        if (itrFile) formData.set("income_tax_return", itrFile);
        if (proRegDocFile)
          formData.set("pro_reg_Certificate_issued_doc", proRegDocFile);
        if (empIdCard1bFile) formData.set("emp_id_card_1b", empIdCard1bFile);
        if (empCert1bFile) formData.set("emp_certificate_1b", empCert1bFile);

        // Karmajeevi values: what the form shows, else the record (eligible
        // applicants only); never a default.
        const el = isKarmajeeviEligible ? elig : {};
        const paraSelectVal = document.getElementById("para_type")?.value || el.paraType;
        if (paraSelectVal) {
          formData.set("para_type", paraSelectVal);
          if (paraSelectVal === "1a") {
            const empType = document.getElementById("emp_id_card_certificate_type")?.value || el.empIdCardCertificateType;
            if (empType) formData.set("emp_id_card_certificate_type", empType);
            const salType = document.getElementById("salary_slip_form_16_type")?.value || el.salarySlipForm16Type;
            if (salType) formData.set("salary_slip_form_16_type", salType);
          } else if (paraSelectVal === "1b") {
            const proBody = document.getElementById("pro_reg_Certificate_issued")?.value || el.proRegCertificateIssued || "";
            if (proBody) formData.set("pro_reg_Certificate_issued", proBody);
            const otherBody = document.getElementById("other_pro_reg_Certificate_issued")?.value || el.otherProRegCertificateIssued || "";
            if (otherBody) formData.set("other_pro_reg_Certificate_issued", otherBody);
            const empType1b = document.getElementById("emp_id_card_certificate_1b")?.value || el.empIdCardCertificate1b;
            if (empType1b) formData.set("emp_id_card_certificate_1b", empType1b);
          }
        }

        // Missing fields: don't send the quick save. Hand the form to DDA's
        // own Submit button instead, whose checks mark each problem in red.
        const missing = findMissingAppFormFields(formEl, formData);
        if (missing.length) {
          const msg = `⚠️ Missing: ${missing.join(", ")}. Handing the form to DDA's own Submit so it marks them in red.`;
          appendRunLog(msg, "WARN");
          ipcRenderer.send("dda:log", { level: "WARN", pan, page: "Form", msg });
          throw new Error("missing required fields");
        }

        const res = await fetch(
          "https://eservices.dda.org.in/user/fcfsuserapplicantstore",
          {
            method: "POST",
            body: formData,
            headers: {
              "X-CSRF-TOKEN": csrfToken,
              "X-Requested-With": "XMLHttpRequest",
            },
          },
        );
        const json = await res.json();
        const urlSegments = window.location.pathname.split("/").filter(Boolean);
        const schemeId = urlSegments[urlSegments.length - 1] || "";

        if (
          json.status === "success" ||
          json.status === "already" ||
          json.status === true ||
          json.msg === "Application Saved"
        ) {
          logAnalyticsStep("step2_form", "Application Form Submitted");

          // If direct URL is ready for this scheme AND Direct URL Jump is enabled, jump to step2_form directly!
          if (isDirectUrlJumpEnabled()) {
            const readDirectUrl = () => {
              adoptMainResolvedStep2(schemeId);
              let url =
                localStorage.getItem("dda_direct_flat_url") ||
                window.__ddaDirectFlatUrl;
              const hashesRaw = localStorage.getItem("dda_locality_hashes");
              if (hashesRaw) {
                try {
                  const h = JSON.parse(hashesRaw);
                  if (
                    h &&
                    String(h.schemeId) === String(schemeId) &&
                    h.localityHash &&
                    h.sectorHash &&
                    h.pocketHash &&
                    h.blockHash
                  ) {
                    url = `https://eservices.dda.org.in/user/step2_form/${schemeId}/${h.localityHash}/${h.sectorHash}/${h.pocketHash}/${h.blockHash}/${h.towerHash || "0"}`;
                  } else {
                    url = null;
                  }
                } catch (_) {
                  url = null;
                }
              }
              return url;
            };

            let directUrl = readDirectUrl();

            // Build still running? Waiting a short moment beats loading the locality page first
            // (that detour costs ~0.3s). Capped so a stalled build can never hold the form page.
            if (!directUrl && resolveDirectUrlPromise) {
              const waitStart = Date.now();
              await Promise.race([
                resolveDirectUrlPromise.catch(() => null),
                new Promise((resolve) => setTimeout(resolve, 400)),
              ]);
              directUrl = readDirectUrl();
              if (directUrl) {
                appendRunLog(
                  `⚡ Step 2 URL became ready after ${Date.now() - waitStart}ms wait on the form page`,
                  "ROUTE",
                );
              }
            }

            if (
              directUrl &&
              (!schemeId || directUrl.includes(`/step2_form/${schemeId}/`))
            ) {
              logAnalyticsStep(
                "step3_locality",
                "Locality page skipped: flat page link was ready",
              );
              appendRunLog(`🚀 Flat page link was ready, opening it: ${directUrl}`, "ROUTE");
              window.location.href = directUrl;
              return;
            }
          }

          appendRunLog(
            "🚀 Submitting Application Form (#frmApply)...",
            "ROUTE",
          );
          window.location.href = schemeId
            ? `https://eservices.dda.org.in/user/step1_form/${schemeId}`
            : "https://eservices.dda.org.in/user/schemeList";
          return;
        }

        // DDA answered but did not save: log its reason, then submit once
        // through DDA's own button so DDA marks the problem fields in red.
        const reason = describeAppFormRejection(json, res.status);
        const msg = `❌ DDA did not accept the application form: ${reason}. Handing it to DDA's own Submit so the problem fields show in red.`;
        appendRunLog(msg, "ERROR");
        ipcRenderer.send("dda:log", { level: "ERROR", pan, page: "Form", msg });
        throw new Error("rejected by DDA");
      } catch (err) {
        console.warn("Fast pass direct dispatch error:", err);
        appendRunLog(
          `⚠️ Direct form save failed (${err?.message || err}) — submitting through DDA's own button`,
          "WARN",
        );
      }
    }

    // Fallback click on #frmApply
    const applyBtn =
      document.getElementById("frmApply") ||
      document.querySelector('button#frmApply, button[type="submit"]');
    if (applyBtn) {
      // ─── Pillar 3: HTML5 Constraint Validation Crash Guard ───
      if (formEl) {
        formEl.noValidate = true;
        try {
          formEl.querySelectorAll("[required]").forEach(el => {
            if (el.offsetParent === null || window.getComputedStyle(el).display === "none" || el.closest('[style*="display: none"]')) {
              el.required = false;
              el.removeAttribute("required");
            }
          });
        } catch (_) {}
      }
      appendRunLog("🚀 Submitting Application Form (#frmApply)...", "ROUTE");
      logAnalyticsStep("step2_form", "Application Form Submitted");
      applyBtn.click();
      // Confirm DDA's own "submit?" popup only; an error popup stays open
      // and its text goes to the log.
      [30, 120, 300].forEach((ms) => setTimeout(confirmAppFormPopup, ms));
    }
  });
}

// DDA's mandatory application-form fields, checked against what is about to be
// sent. Hidden sections (joint applicant, the unused Para 2.4 option, spouse)
// are skipped, and so are fields this form does not have. File uploads are
// left to DDA's own check (a Skip Form application already has them saved).
const APP_FORM_REQUIRED = [
  ["applicant_first_name", "First Name"],
  ["father_name", "Father's Name"],
  ["dob", "Date of Birth"],
  ["gender", "Gender"],
  ["marital_status", "Marital Status"],
  ["ref_category_id", "Category"],
  ["mobile", "Mobile Number"],
  ["bank_id", "Bank Name"],
  ["branch", "Branch Name"],
  ["ifsc_code", "IFSC Code"],
  ["bank_account_number", "Account Number"],
  ["correspondence_address_house_no", "House / Flat No"],
  ["correspondence_address_pin", "PIN Code"],
  ["correspondence_address_ref_state_id", "State"],
  ["correspondence_address_ref_district_id", "District"],
  ["para_type", "Para 2.4 type (Karmajeevi)"],
];

function findMissingAppFormFields(formEl, formData) {
  const isHidden = (el) =>
    !el ||
    el.disabled ||
    el.type === "hidden" ||
    !!el.parentElement?.closest(
      '[style*="display: none"], [style*="display:none"], .d-none, .hide, .hidden',
    );
  const filled = (name) => {
    const v = formData.getAll(name).filter((x) => typeof x === "string");
    return v.some((x) => x.trim() !== "");
  };
  const labelFor = (el) => {
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const text = (byFor || el.closest(".form-group")?.querySelector("label"))?.textContent || "";
    return text.replace(/[*:]/g, "").replace(/\s+/g, " ").trim() || el.name;
  };

  const missing = [];
  const checked = new Set();
  for (const [name, label] of APP_FORM_REQUIRED) {
    const el = formEl.querySelector(`[name="${name}"]`) || document.getElementById(name);
    if (!el || isHidden(el)) continue;
    checked.add(el.name || name);
    if (!filled(el.name || name)) missing.push(label);
  }
  // Anything else DDA itself marks required (files excepted, see above).
  formEl.querySelectorAll("[required]").forEach((el) => {
    if (!el.name || el.type === "file" || checked.has(el.name) || isHidden(el)) return;
    checked.add(el.name);
    if (!filled(el.name)) missing.push(labelFor(el));
  });
  return missing;
}

// DDA's reason for not saving the form, from its JSON reply (Laravel
// validation errors or a plain message).
function describeAppFormRejection(json, httpStatus) {
  try {
    if (json?.errors && typeof json.errors === "object") {
      const list = Object.values(json.errors).flat().map(String).filter(Boolean);
      if (list.length) return list.slice(0, 5).map((t) => t.replace(/\.\s*$/, "")).join(" | ");
    }
    const text = json?.msg || json?.message || json?.error;
    if (text) return String(text).replace(/\.\s*$/, "");
  } catch (_) {}
  return `unexpected reply (HTTP ${httpStatus}): ${JSON.stringify(json).slice(0, 160)}`;
}

function confirmAppFormPopup() {
  const popup = document.querySelector(".swal2-popup.swal2-show, .swal-modal, .sweet-alert.visible");
  if (!popup || popup.dataset.appFormSeen === "true") return;
  const text = (popup.textContent || "").replace(/\s+/g, " ").trim();
  const isError =
    !!popup.querySelector(".swal2-icon-error.swal2-icon-show, .swal2-error, .sa-error, .swal-icon--error") ||
    /invalid|required|error|failed|not valid|must be|please (select|enter|upload|fill)/i.test(text);
  popup.dataset.appFormSeen = "true";
  if (isError) {
    appendRunLog(`❌ DDA form error: ${text.slice(0, 200)}`, "ERROR");
    return;
  }
  popup.querySelector(".swal2-confirm, button.confirm, .swal-button--confirm")?.click();
}

// Shared with the Workspace's own form-fill script (manual Autofill button).
window.__ddaAppFormCheck = {
  findMissing: findMissingAppFormFields,
  describeRejection: describeAppFormRejection,
  confirmPopup: confirmAppFormPopup,
};

window.__ddaRunTestAutofill = function (explicitApplicant) {
  if (explicitApplicant) {
    currentApplicant = explicitApplicant;
    window.__ACTIVE_APPLICANT__ = explicitApplicant;
  }
  sessionStorage.setItem("dda_test_autofill_mode", "true");
  localStorage.setItem("dda_test_autofill_mode", "true");
  sessionStorage.setItem("dda_test_skip_submit", "true");
  window.__ddaTestAutofillMode = true;
  handleApplicationFormPage();
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. FLAT CONFLICT RECOVERY & GLOBAL SWEETALERT SAFETY WATCHER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 4: Flat Conflict Recovery Engine
 * Detects SweetAlert2 or DOM alerts indicating flat is already booked/on hold by another applicant.
 * Auto-dismisses the alert, closes modal/backdrop, adds flat to blacklist, and triggers next candidate scan in <200ms.
 */
function checkForConflictAlert() {
  // A direct-mode chain never opens the modal, so any popup visible while one is running is stale.
  // Acting on it would clear __ddaReservationInProgress underneath the chain that owns it and let a
  // competing trigger fire mid-reservation. The chain handles its own Status 2/4 conflicts.
  if (window.__ddaDirectRunning) return false;

  const popups = document.querySelectorAll(
    ".swal2-popup.swal2-show, .swal-modal, .swal2-container, #myModal.show, .modal.show",
  );
  if (!popups || popups.length === 0) return false;

  for (const popup of popups) {
    const text = (popup.textContent || "").toLowerCase();
    const isConflict =
      text.includes("this flat is alloted by another applicant") ||
      text.includes("this flat is hold/sold by another applicant") ||
      text.includes("you can not book this flat as it hold/sold");

    if (isConflict) {
      // Prefer the flat we actually acted on. After a navigation (e.g. the hold page bouncing us back)
      // the window variable is gone, so fall back to the flat reserved a moment ago. Never guess from the
      // alert wording: "this flat as it hold/sold" used to be parsed as flat "AS".
      let conflictedFlat =
        window.__ddaLastAttemptedFlat ||
        window.__ddaActiveReservationTarget ||
        (function () {
          try {
            return sessionStorage.getItem("dda_reserved_flat_no") || localStorage.getItem("dda_last_reserved_flat") || "";
          } catch (_) {
            return "";
          }
        })();
      if (conflictedFlat === "first target" || conflictedFlat === "fallback") conflictedFlat = "";
      if (!conflictedFlat) {
        const match = text.match(/\bflat\s+(?:no\.?\s*)?(\d{2,5}[a-z]?)\b/i);
        if (match) conflictedFlat = match[1];
      }

      if (conflictedFlat) {
        blacklistFlat(conflictedFlat);
      }

      // Mark building node in live DOM as taken so future scans skip it
      if (conflictedFlat) {
        try {
          const bEl = Array.from(document.querySelectorAll(".building")).find(
            (b) =>
              b.querySelector("span")?.textContent?.trim().toUpperCase() ===
              String(conflictedFlat).trim().toUpperCase(),
          );
          if (bEl) {
            bEl.classList.remove("available");
            bEl.classList.add("sold", "hold");
            const r = bEl.querySelector('input[type="radio"]');
            if (r) r.disabled = true;
          }
        } catch (_) {}
      }

      ipcRenderer.send("dda:log", {
        level: "WARN",
        pan: currentApplicant?.pan,
        page: "Step 2 Flats",
        msg: `⚠️ Flat ${conflictedFlat || "target"} is already hold/sold by another applicant! Auto-dismissing alert and selecting next available flat...`,
      });

      // 1. Auto-dismiss SweetAlert / popup button
      const confirmBtn = popup.querySelector(
        '.swal2-confirm, button.confirm, .swal-button--confirm, button.close, [data-dismiss="modal"]',
      );
      if (confirmBtn) {
        confirmBtn.click();
      }

      // 2. Hide modal and clear backdrop if present
      const modal = document.querySelector("#myModal, .modal.show");
      if (modal) {
        modal.classList.remove("show");
        modal.style.display = "none";
        const backdrop = document.querySelector(".modal-backdrop");
        if (backdrop) backdrop.remove();
        document.body.classList.remove("modal-open");
        document.body.style.removeProperty("padding-right");
      }

      // 3. Reset hold button auto-click state so next flat modal can proceed
      const holdBtn = document.querySelector(
        '#submitareabtn, .reserve, button[class*="reserve"]:not(#captchabutton)',
      );
      if (holdBtn) {
        delete holdBtn.dataset.ddaAutoClicked;
      }

      // 4. Notify UI of conflict reset
      resetCaptchaSessionState("Flat conflict recovery");
      window.__ddaReservationInProgress = false;
      window.__ddaActiveReservationTarget = null;
      if (typeof window.__ddaResetFlatSelected === "function") {
        window.__ddaResetFlatSelected();
      }
      window.postMessage(
        { type: "DDA_FLAT_CONFLICT_RESET", flat: conflictedFlat },
        "*",
      );
      window.__ddaLastAttemptedFlat = null;

      // 5. Instantly trigger live scan for next candidate flat (<80ms)
      setTimeout(() => {
        if (typeof window.__ddaScanLiveDom === "function") {
          window.__ddaScanLiveDom();
        }
      }, 80);

      return true;
    }
  }
  return false;
}

function stopAutomationMidFlight() {
  isAutomationRunning = false;
  activeObservers.forEach((obs) => {
    try {
      obs.disconnect();
    } catch (_) {}
  });
  activeObservers.length = 0;

  window.__ddaReservationInProgress = false;
  window.__ddaActiveReservationTarget = null;
  flatSelected = false;
  // Session heartbeat remains active on Schemes page irrespective of automation mode toggles
  solveInProgress = false;
  step2PreSolveInProgress = false;

  ipcRenderer.send("dda:log", {
    level: "WARN",
    pan: currentApplicant?.pan,
    page: "Engine",
    msg: "⏸️ Automation paused mid-flight: all observers disconnected, polling halted, locks released.",
  });
}

function resumeAutomationMidFlight() {
  if (isAutomationRunning) return;
  isAutomationRunning = true;
  ipcRenderer.send("dda:log", {
    level: "INFO",
    pan: currentApplicant?.pan,
    page: "Engine",
    msg: "▶️ Automation resumed mid-flight: restarting page automations.",
  });
  startAutomation();
}

// Window event listeners for mid-flight toggle & cross-platform instant focus sync
if (typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    if (event.data?.type === "DDA_AUTOMATION_TOGGLED") {
      if (event.data.enabled === false) {
        stopAutomationMidFlight();
      } else {
        resumeAutomationMidFlight();
      }
    }
  });

  window.addEventListener("focus", async () => {
    const now = Date.now();
    if (now - lastFocusSyncTime > 5000) {
      lastFocusSyncTime = now;
      try {
        const freshContext = await ipcRenderer
          .invoke("session:getWebviewContext")
          .catch(() => null);
        const freshSettings = freshContext?.settings;
        if (freshSettings && typeof freshSettings === "object") {
          currentSettings = { ...currentSettings, ...freshSettings };
        }
        const freshApplicant = freshContext?.applicant;
        if (freshApplicant && freshApplicant.personal) {
          currentApplicant = freshApplicant;
        }
      } catch (_) {}
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: ANALYTICS PIPELINE & PAYMENT TIMER ENGINE (100% EXTENSION PARITY)
// ─────────────────────────────────────────────────────────────────────────────

function isLoginPage() {
  if (typeof window === "undefined") return false;
  if (!isDdaHost()) return false;
  const url = window.location.href.toLowerCase();
  return (
    url.includes("login") ||
    window.location.pathname.endsWith("/user") ||
    window.location.pathname.endsWith("/user/") ||
    !!document.querySelector(
      "form#userloginform, button#loginbtn, #txtloginid, #txtpassword",
    )
  );
}

if (typeof window !== "undefined") {
  window.isUserLoggedIn = isUserLoggedIn;
  window.isLoginPage = isLoginPage;
  window.isElementVisible = isElementVisible;
}

function appendRunLog(msg, level = "INFO", extra = null) {
  try {
    if (isLoginPage()) {
      return; // Do NOT generate or store run logs for login page
    }

    const now = Date.now();
    const d = new Date(now);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    const ap = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    const timeStr = `${h12}:${m}:${s}.${ms} ${ap}`;

    const url = window.location.href.toLowerCase();
    let pageName = "DDA";
    if (url.includes("schemelist")) pageName = "Schemes";
    else if (
      url.includes("applicationform") ||
      url.includes("userapplicationfrom")
    )
      pageName = "Application Form";
    else if (url.includes("step1_form")) pageName = "Locality";
    else if (url.includes("getlayout") || url.includes("payment"))
      pageName = "Payment Timer";
    else if (url.includes("step2_form")) {
      const modal = document.querySelector(
        '#myModal.show, #myModal[style*="display: block"], .modal.show',
      );
      pageName = modal ? "Captcha" : "Flat Select";
    }

    const entry = {
      time: timeStr,
      timestamp: now,
      ts: now,
      level: String(level).toUpperCase(),
      page: pageName,
      pan: currentApplicant?.pan || "",
      msg: typeof msg === "object" ? JSON.stringify(msg) : String(msg),
      extra: extra || null,
      _stored: true,
    };

    let logs = [];
    try {
      logs = JSON.parse(
        sessionStorage.getItem("dda_session_run_logs") ||
          localStorage.getItem("dda_run_logs") ||
          "[]",
      );
    } catch (_) {
      logs = [];
    }
    logs.push(entry);
    if (logs.length > 300) logs.shift();

    sessionStorage.setItem("dda_session_run_logs", JSON.stringify(logs));
    try {
      localStorage.setItem("dda_run_logs", JSON.stringify(logs));
    } catch (_) {}
    try {
      window.postMessage({ type: "DDA_LOG_ADDED", log: entry }, "*");
    } catch (_) {}

    ipcRenderer.send("dda:log", entry);
  } catch (_) {}
}

if (typeof window !== "undefined") {
  window.appendRunLog = appendRunLog;

  // ─── USER IN-WEBVIEW DOM INTERACTION FORENSIC TRACKER ────────────────────
  if (window === window.top) {
    // Capture manual user clicks on interactive portal elements
    window.addEventListener(
      "click",
      (e) => {
        try {
          if (!e.isTrusted) return; // Ignore synthetic automation clicks
          const target = e.target;
          if (!target) return;

          // 1. Manual Flat Radio Button / Row Click
          const flatRadio = target.closest('input[type="radio"], tr, td, .flatcircle');
          if (flatRadio) {
            const row = target.closest("tr");
            const flatNo =
              row?.querySelector("td:first-child")?.textContent?.trim() ||
              flatRadio.getAttribute("data-flat") ||
              flatRadio.value;
            if (flatNo) {
              appendRunLog(
                `User manually clicked Flat #${flatNo} radio in flat matrix`,
                "USER_DOM"
              );
              return;
            }
          }

          // 2. Manual Reservation Modal Submit Button Click
          const submitBtn = target.closest(
            "#captchabutton, #submitareabtn, button[type='submit'], .submitbtn"
          );
          if (submitBtn) {
            const btnText = (submitBtn.innerText || submitBtn.value || "Submit").trim();
            appendRunLog(
              `User manually clicked modal button: "${btnText}"`,
              "USER_DOM"
            );
            return;
          }

          // 3. Manual Captcha Reload / Refresh Icon Click
          const refreshBtn = target.closest(
            ".refreshbtn, img[src*='refresh'], a[onclick*='captcha'], button[onclick*='captcha']"
          );
          if (refreshBtn) {
            appendRunLog(
              "User manually clicked captcha refresh/reload icon in portal",
              "USER_DOM"
            );
            return;
          }

          // 4. Manual Scheme Apply Button Click
          const applyBtn = target.closest(
            "a.btn, button.btn, a[href*='apply'], a[onclick*='apply']"
          );
          if (applyBtn && window.location.href.includes("schemeList")) {
            const row = applyBtn.closest("tr");
            const schemeTitle =
              row?.querySelector("b.bluec")?.textContent?.trim() ||
              applyBtn.innerText?.trim();
            appendRunLog(
              `User manually clicked Apply button for scheme: "${schemeTitle || 'Selected Scheme'}"`,
              "USER_DOM"
            );
            return;
          }
        } catch (_) {}
      },
      true
    );

    // Capture manual typing into captcha input field
    window.addEventListener(
      "input",
      (e) => {
        try {
          if (!e.isTrusted) return; // Ignore synthetic script values
          const target = e.target;
          if (!target) return;
          const isCaptchaInput =
            target.id === "txtCaptcha" ||
            target.id === "user_captcha" ||
            target.name === "txtCaptcha" ||
            target.name === "captcha_code";
          if (isCaptchaInput && target.value) {
            appendRunLog(
              `User manually typed in captcha input: "${target.value}"`,
              "USER_DOM"
            );
          }
        } catch (_) {}
      },
      true
    );
  }
}

function logAnalyticsStep(stepName, stepMessage) {
  if (typeof window !== "undefined" && window !== window.top) return;

  const milestoneKey = `${stepName}:${stepMessage}`;
  if (loggedMilestones.has(milestoneKey)) return;
  if (
    [
      "step1_apply",
      "step4_page_load",
      "step4_reserve_clicked",
      "step5_captcha_ready",
    ].includes(stepName) &&
    loggedMilestones.has(stepName)
  ) {
    return;
  }
  loggedMilestones.add(milestoneKey);
  loggedMilestones.add(stepName);

  appendRunLog(`📍 Milestone [${stepName}]: ${stepMessage}`, "ROUTE");

  try {
    let analytics = JSON.parse(localStorage.getItem("dda_analytics") || "{}");
    const now = Date.now();
    const timeStr = format12HourTime(now);
    analytics[stepName] = {
      timestamp: now,
      time: timeStr,
      message: stepMessage,
    };
    localStorage.setItem("dda_analytics", JSON.stringify(analytics));
    localStorage.setItem("dda_run_analytics", JSON.stringify(analytics));
  } catch (e) {
    console.warn("Analytics milestone error:", e);
  }
}

if (typeof window !== "undefined") {
  window.logAnalyticsStep = logAnalyticsStep;
}

// ─── Apply retry ──────────────────────────────────────────────────────────────
// DDA can show the Apply link before it accepts applications: opening the form then
// gets a redirect back to the schemes page ("Bookings for this scheme have not started
// yet"). A busy DDA answers the form with a 500 "Database Error" instead. Whoever opens
// the form (Timed, Manual) marks it pending for this window; while pending, every landing
// on the schemes page opens the form again, before that page finishes loading, and a
// "Database Error" on the form reloads the form (see the error check below). Cleared
// when the form loads, on Stop, on the login page, or after 15 minutes.
const APPLY_PENDING_KEY = "dda_apply_pending";
const APPLY_PENDING_MAX_MS = 15 * 60 * 1000;
const APPLY_RETRY_MIN_GAP_MS = 250;

function readApplyPending() {
  try {
    const p = JSON.parse(sessionStorage.getItem(APPLY_PENDING_KEY) || "null");
    if (!p || !p.url) return null;
    if (Date.now() - (p.startedAt || 0) > APPLY_PENDING_MAX_MS) {
      sessionStorage.removeItem(APPLY_PENDING_KEY);
      appendRunLog("⏹️ Stopped re-trying Apply: 15 minutes passed without DDA opening the form.", "WARN");
      return null;
    }
    return p;
  } catch (_) {
    return null;
  }
}

function writeApplyPending(p) {
  try {
    sessionStorage.setItem(APPLY_PENDING_KEY, JSON.stringify(p));
  } catch (_) {}
}

function markApplyPending(url) {
  try {
    if (!url || !/\/user\/(userapplicationfrom|applicationform)\//i.test(url)) return;
    const abs = new URL(url, window.location.href).href;
    const prev = readApplyPending();
    if (prev && prev.url === abs) {
      prev.lastTryAt = Date.now();
      writeApplyPending(prev);
      return;
    }
    writeApplyPending({ url: abs, startedAt: Date.now(), lastTryAt: Date.now(), tries: 0 });
  } catch (_) {}
}

// Each re-try is a fresh Apply: move the run's "Scheme Apply" time to it, so the
// booking timings are measured from the try that got through (as a manual press did).
function noteApplyRetry(tries) {
  try {
    const analytics = JSON.parse(localStorage.getItem("dda_analytics") || "{}");
    const now = Date.now();
    analytics.step1_apply = {
      timestamp: now,
      time: format12HourTime(now),
      message: `Scheme Apply: re-try #${tries}`,
    };
    localStorage.setItem("dda_analytics", JSON.stringify(analytics));
    localStorage.setItem("dda_run_analytics", JSON.stringify(analytics));
  } catch (_) {}
}

// HTTP status of the page itself (Chromium's navigation timing; 0 if unknown)
function ddaNavStatus() {
  try {
    return performance.getEntriesByType("navigation")[0]?.responseStatus || 0;
  } catch (_) {
    return 0;
  }
}

// Stop pressed after this apply began? The Stop time is kept in main (the dashboard
// cannot reach a page that never finishes loading). Asked before every re-try; an
// older main without the handler just rejects, so it never blocks or freezes.
async function applyRetryStopped(p) {
  try {
    const stoppedAt = Number(await ipcRenderer.invoke("apply:stoppedAt")) || 0;
    return stoppedAt > 0 && (p.startedAt || 0) <= stoppedAt;
  } catch (_) {
    return false;
  }
}

// Both re-try paths go through here: check Stop, note the Apply time, open the form.
async function openPendingForm(expectedUrl) {
  const cur = readApplyPending();
  if (!cur || cur.url !== expectedUrl) return; // stopped meanwhile
  if (await applyRetryStopped(cur)) {
    clearApplyPending("stopped");
    appendRunLog("🛑 Apply re-try stopped by user.", "ACTION");
    if (/\/user\/schemelist/i.test(window.location.pathname)) {
      try { startSessionHeartbeat(); } catch (_) {}
    }
    return;
  }
  if (!readApplyPending()) return; // stopped while asking
  cur.lastTryAt = Date.now();
  writeApplyPending(cur);
  noteApplyRetry(cur.tries);
  window.location.replace(cur.url);
}

function clearApplyPending(why) {
  try {
    if (window.__ddaApplyRetryTimer) {
      clearTimeout(window.__ddaApplyRetryTimer);
      window.__ddaApplyRetryTimer = null;
    }
    if (why === "user") {
      try {
        ipcRenderer.send("apply:stop");
      } catch (_) {}
    }
    if (!sessionStorage.getItem(APPLY_PENDING_KEY)) return;
    sessionStorage.removeItem(APPLY_PENDING_KEY);
    if (why === "user") appendRunLog("🛑 Apply re-try stopped by user.", "ACTION");
  } catch (_) {}
}

if (typeof window !== "undefined") {
  window.__ddaMarkApplyPending = markApplyPending;
  window.__ddaStopApplyRetry = clearApplyPending;

  // Runs as the page starts loading, so a bounce back to the schemes page is turned
  // around without waiting for the rest of that page or DDA's popup.
  try {
    if (window === window.top && window.location.hostname === "eservices.dda.org.in") {
      const path = window.location.pathname.toLowerCase().replace(/\/+$/, "");
      const pending = readApplyPending();
      if (pending) {
        const onForm = /\/user\/(userapplicationfrom|applicationform)\//.test(path + "/");
        if (path === "" || path === "/user" || path.includes("/user/login")) {
          clearApplyPending("login");
        } else if (onForm) {
          // The form answered normally: done. (Unknown status: the error check
          // after parsing decides.)
          const st = ddaNavStatus();
          if (st >= 200 && st < 300) clearApplyPending("form opened");
        } else if (!path.includes("/user/schemelist")) {
          clearApplyPending("moved on"); // flat page, hold page, payment, ...
        } else {
          pending.tries = (pending.tries || 0) + 1;
          writeApplyPending(pending);
          if (pending.tries <= 5 || pending.tries % 10 === 0) {
            appendRunLog(`⏳ DDA sent the form back (booking not open yet) — trying again (#${pending.tries})`, "ROUTE");
          }
          // Leave at once (DDA's message is not waited for: leaving stops this page
          // from loading, and the message is often missing anyway).
          const wait = Math.max(0, APPLY_RETRY_MIN_GAP_MS - (Date.now() - (pending.lastTryAt || 0)));
          window.__ddaApplyRetryTimer = setTimeout(() => {
            window.__ddaApplyRetryTimer = null;
            openPendingForm(pending.url);
          }, wait);
        }
      }
    }
  } catch (_) {}
}

// ─── DDA logout recovery ─────────────────────────────────────────────────────
// When DDA ends the session itself, the next page lands on DDA's home page ("/") or
// on /admin through a redirect (11 Oct: windows sat there 6-50s until someone went to
// the login page). A logout the user asked for goes through /user/logout and ends on
// the login page instead; main remembers those (dda:manualLogoutAt) so they are never
// taken for DDA ending the session. On DDA's logout: open the login page, and once
// the locked applicant's ID, password and a solved captcha are in, press Login (at
// most 3 tries, never on a wrong password, never after Stop). Normal logins are untouched.
const RELOGIN_KEY = "dda_relogin";
const RELOGIN_HISTORY_KEY = "dda_relogin_history";
const RELOGIN_MAX_AGE_MS = 2 * 60 * 1000;
const RELOGIN_MAX_TRIES = 3;

function reloginLog(msg, level = "WARN") {
  // appendRunLog skips the login page; send a stored entry the same way (dashboard + run trace)
  try {
    const now = Date.now();
    ipcRenderer.send("dda:log", {
      time: format12HourTime(now),
      timestamp: now,
      ts: now,
      level: String(level).toUpperCase(),
      page: "Login",
      pan: currentApplicant?.pan || currentApplicant?.personal?.pan || "",
      msg,
      extra: null,
      _stored: true,
    });
  } catch (_) {}
}

function readRelogin() {
  try {
    const r = JSON.parse(sessionStorage.getItem(RELOGIN_KEY) || "null");
    if (!r || !r.at) return null;
    if (Date.now() - r.at > RELOGIN_MAX_AGE_MS) {
      sessionStorage.removeItem(RELOGIN_KEY);
      return null;
    }
    return r;
  } catch (_) {
    return null;
  }
}

async function handleDdaSessionEnded(where) {
  try {
    // Main decides: not within a minute of a /user/logout, at most 3 in 10 minutes per window
    let allowed = null;
    try {
      allowed = await ipcRenderer.invoke("dda:noteRelogin");
    } catch (_) {}
    if (allowed === null || allowed === undefined) {
      // older main without the handler: same rules here
      let manualAt = 0;
      try {
        manualAt = Number(await ipcRenderer.invoke("dda:manualLogoutAt")) || 0;
      } catch (_) {}
      if (manualAt && Date.now() - manualAt < 60 * 1000) return; // the user logged out
      let history = [];
      try {
        history = JSON.parse(sessionStorage.getItem(RELOGIN_HISTORY_KEY) || "[]");
      } catch (_) {}
      history = (Array.isArray(history) ? history : []).filter((t) => Date.now() - t < 10 * 60 * 1000);
      allowed = history.length < 3;
      if (allowed) {
        history.push(Date.now());
        sessionStorage.setItem(RELOGIN_HISTORY_KEY, JSON.stringify(history));
      }
    }
    if (!allowed) {
      reloginLog("⚠️ DDA ended the session — not logging back in automatically (logged out by hand, or already 3 times in 10 minutes); log in by hand.");
      return;
    }
    sessionStorage.setItem(RELOGIN_KEY, JSON.stringify({ at: Date.now(), where, tries: 0 }));
    reloginLog(`⚠️ DDA ended the session (sent to ${where}) — opening the login page to log back in`);
    window.location.replace("https://eservices.dda.org.in/user");
  } catch (_) {}
}

// Login page after DDA ended the session: press Login for the locked applicant.
async function startReloginAutoSubmit() {
  if (!readRelogin()) {
    // main caught DDA's redirect to "/" or /admin and opened this page directly
    let r = null;
    try {
      r = await ipcRenderer.invoke("dda:takeRelogin");
    } catch (_) {}
    if (!r || !r.at) return;
    sessionStorage.setItem(RELOGIN_KEY, JSON.stringify({ at: r.at, where: r.where || "/", tries: 0 }));
    reloginLog(`⚠️ DDA ended the session (sent to ${r.where || "/"}) — logging back in`);
  }
  const startedAt = Date.now();
  let busy = false;
  const stop = (msg, level) => {
    clearInterval(timer);
    sessionStorage.removeItem(RELOGIN_KEY);
    if (msg) reloginLog(msg, level);
  };
  const timer = setInterval(async () => {
    if (busy) return;
    const cur = readRelogin();
    if (!cur) return clearInterval(timer);
    if (Date.now() - startedAt > 30 * 1000) {
      return stop("⏸️ Could not log back in automatically within 30s — log in by hand.");
    }
    // DDA rejected the ID/password: never try again with the same details
    const errText = Array.from(document.querySelectorAll("#err, .swal2-popup, .alert-danger, .alert-warning"))
      .map((el) => el.textContent || "")
      .join(" ")
      .toLowerCase();
    if (errText.includes("password") || errText.includes("invalid user")) {
      return stop("⏸️ DDA says the user ID or password is wrong — log in by hand.");
    }
    const lockedPan = String(
      window.__DDA_LOCKED_LOGIN_PAN__ || localStorage.getItem("dda_page_locked_login_pan") || "",
    ).toUpperCase().trim();
    if (!lockedPan) {
      // only a window locked to an applicant logs in by itself
      if (Date.now() - startedAt > 5000) stop("⏸️ This window is not locked to an applicant — log in by hand.");
      return;
    }
    const userEl = document.querySelector('input[name="user_id"]');
    const passEl = document.querySelector('#password, input[name="password"]');
    const capEl = document.querySelector('input[name="captcha"]');
    const capImg = document.querySelector('img[src*="/captcha/"]');
    const btn = document.querySelector("#loginbtn");
    if (!userEl || !passEl || !capEl || !capImg || !btn) return;
    if ((userEl.value || "").toUpperCase().trim() !== lockedPan) return;
    const capSrc = getCaptchaSrc(capImg);
    // DDA answered our last try (it shows a new captcha) even if the page still marks a login in flight
    const answered = Boolean(cur.lastCaptchaSrc && capSrc && capSrc !== cur.lastCaptchaSrc);
    if (window.__ddaIsLoginSubmitting && !answered) return;
    let pw = (passEl.value || "").trim();
    if (/^[a-f0-9]{64}$/i.test(pw) && answered) {
      // DDA left its hashed value in the field: put the plain password back (as the double-submit guard does)
      const plain = sessionStorage.getItem("dda_submitting_pass");
      if (plain) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(passEl, plain);
        else passEl.value = plain;
        pw = plain;
      }
    }
    if (!pw || /^[a-f0-9]{64}$/i.test(pw)) return;
    const cap = (capEl.value || "").trim();
    if (!cap || !lastSolvedCaptchaAnswer || cap !== String(lastSolvedCaptchaAnswer)) return;
    if (!capSrc || capSrc !== lastSolvedCaptchaSrc) return; // answer is for this image
    if (cur.lastCaptchaSrc === capSrc) return; // a failed try: wait for a fresh captcha
    busy = true;
    try {
      if (await applyRetryStopped({ startedAt: cur.at })) {
        return stop("🛑 Automatic login stopped by user.", "ACTION");
      }
      const now = readRelogin();
      if (!now) return clearInterval(timer);
      now.tries = (now.tries || 0) + 1;
      if (now.tries > RELOGIN_MAX_TRIES) {
        return stop("⏸️ 3 automatic login tries did not get in — log in by hand.");
      }
      now.lastCaptchaSrc = capSrc;
      sessionStorage.setItem(RELOGIN_KEY, JSON.stringify(now));
      reloginLog(`🔑 Logging back in as ${lockedPan} after DDA ended the session (try ${now.tries}/${RELOGIN_MAX_TRIES})`, "ACTION");
      btn.click();
    } finally {
      busy = false;
    }
  }, 50);
}

// DDA's login answered with a server error (HTTP 500 under load: 15 times on 20 Oct;
// also 429 or no answer). DDA's own script then shows nothing: its error handler
// reads an error list a 500 doesn't have. The password field is left holding its
// hash and the captcha on screen was most likely used up by that try. So, as DDA
// does after a refused login: put the password back, get a new captcha (solved by
// the engine) and press Login again, 2 s / 5 s / 10 s after each failure, at most
// 3 times; then hand over. A captcha typed by hand is never pressed for the user,
// and during an automatic re-login (startReloginAutoSubmit) that loop presses Login.
const LOGIN_SERVER_ERROR_GAPS_MS = [2000, 5000, 10000];
let loginServerErrors = 0;
let loginServerErrorTimer = null;

function loginErrorNote(text, kind = "warning") {
  try {
    const box = document.querySelector("#err");
    if (box) box.innerHTML = `<div class="alert alert-${kind} mt-2" data-dda-app-note="1">${text}</div>`;
  } catch (_) {}
}

function restorePlainLoginPassword() {
  const passEl = document.querySelector('#password, input[name="password"]');
  if (!passEl || !/^[a-f0-9]{64}$/i.test((passEl.value || "").trim())) return;
  const plain = sessionStorage.getItem("dda_submitting_pass");
  if (!plain) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(passEl, plain);
  else passEl.value = plain;
  passEl.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressLoginWhenCaptchaSolved(failedSrc) {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (!isLoginPageUrl()) return clearInterval(timer);
    if (loginCaptchaUserTyped) {
      clearInterval(timer);
      loginErrorNote("DDA's server had an error with the last login. Press <b>Login</b> when the captcha is filled.");
      return;
    }
    if (Date.now() - startedAt > 30000) {
      clearInterval(timer);
      const msg = "⏸️ No new login captcha within 30 s after DDA's server error — log in by hand.";
      reloginLog(msg);
      loginErrorNote("DDA's server had an error with the last login and no new captcha arrived. Type the captcha and press <b>Login</b>.");
      return;
    }
    if (window.__ddaIsLoginSubmitting) return;
    const userEl = document.querySelector('input[name="user_id"]');
    const passEl = document.querySelector('#password, input[name="password"]');
    const capEl = document.querySelector('input[name="captcha"]');
    const capImg = document.querySelector('img[src*="/captcha/"]');
    const btn = document.querySelector("#loginbtn");
    if (!userEl || !passEl || !capEl || !capImg || !btn) return;
    if (!(userEl.value || "").trim()) return;
    restorePlainLoginPassword();
    const pw = (passEl.value || "").trim();
    if (!pw || /^[a-f0-9]{64}$/i.test(pw)) return;
    const capSrc = getCaptchaSrc(capImg);
    if (!capSrc || capSrc === failedSrc || capSrc !== lastSolvedCaptchaSrc) return; // the new captcha, solved
    const cap = (capEl.value || "").trim();
    if (!cap || lastSolvedCaptchaAnswer == null || cap !== String(lastSolvedCaptchaAnswer)) return;
    clearInterval(timer);
    reloginLog(`🔑 Pressing Login again after DDA's server error (try ${loginServerErrors + 1} of ${LOGIN_SERVER_ERROR_GAPS_MS.length + 1})`, "ACTION");
    loginErrorNote(`Logging in again after DDA's server error (try ${loginServerErrors + 1})...`, "info");
    btn.click();
  }, 100);
}

function onLoginServerError(status) {
  loginServerErrors++;
  // DDA answered: this login is no longer in flight (the press marks it for 8 s)
  window.__ddaIsLoginSubmitting = false;
  if (window.__ddaLoginSubmittingTimer) clearTimeout(window.__ddaLoginSubmittingTimer);
  const what = status === 429 ? "is too busy (HTTP 429)" : status ? `had an error (HTTP ${status})` : "did not answer";
  const failedSrc = getCaptchaSrc(document.querySelector('img[src*="/captcha/"]'));
  restorePlainLoginPassword(); // a press by hand works at once
  if (loginServerErrors > LOGIN_SERVER_ERROR_GAPS_MS.length) {
    const msg = `⏸️ DDA's server failed the login ${loginServerErrors} times in a row (${what}) — log in by hand when DDA recovers.`;
    reloginLog(msg);
    loginErrorNote(`DDA's server ${what} on ${loginServerErrors} logins in a row. Get a new captcha (reload icon) and press <b>Login</b> when DDA recovers.`, "danger");
    return;
  }
  const gap = LOGIN_SERVER_ERROR_GAPS_MS[loginServerErrors - 1];
  reloginLog(`⚠️ DDA's server ${what} on the login — new captcha and Login again in ${gap / 1000}s (${loginServerErrors} of ${LOGIN_SERVER_ERROR_GAPS_MS.length})`);
  loginErrorNote(`DDA's server ${what} on this login. The app gets a new captcha and logs in again in ${gap / 1000} s (${loginServerErrors} of ${LOGIN_SERVER_ERROR_GAPS_MS.length})...`);
  clearTimeout(loginServerErrorTimer);
  loginServerErrorTimer = setTimeout(() => {
    if (!isLoginPageUrl()) return;
    // The captcha budget spent on failed images: a fresh login page brings a new one
    if (!refreshLoginCaptcha("was used by the login DDA failed")) {
      window.location.reload();
      return;
    }
    if (readRelogin()) return; // the re-login loop presses Login once the new captcha is solved
    pressLoginWhenCaptchaSolved(failedSrc);
  }, gap);
}

function installLoginServerErrorRetry() {
  if (!isLoginPageUrl() || window.__ddaLoginErrorRetry) return;
  const hook = () => {
    const jq = window.jQuery;
    if (!jq || typeof jq !== "function" || typeof jq.ajaxPrefilter !== "function") return false;
    window.__ddaLoginErrorRetry = true;
    // A prefilter runs before $.ajax attaches DDA's own success/error handlers, so these
    // run first: DDA's error handler throws on a 500, which stops jQuery before its
    // ajaxError / ajaxComplete events ever fire.
    jq.ajaxPrefilter((options, _orig, jqXHR) => {
      const url = String(options?.url || "");
      const method = String(options?.type || options?.method || "GET").toUpperCase();
      if (method !== "POST" || !/\/user\/login(\?|$)/i.test(url)) return;
      jqXHR.fail((xhr, textStatus) => {
        if (textStatus === "abort") return;
        const status = xhr?.status || 0;
        if (status >= 500 || status === 429 || status === 0) onLoginServerError(status);
      });
      jqXHR.done(() => {
        if (loginServerErrors) reloginLog(`✅ DDA answered the login after ${loginServerErrors} server error${loginServerErrors === 1 ? "" : "s"}`, "SUCCESS");
        loginServerErrors = 0;
      });
    });
    return true;
  };
  if (hook()) return;
  const t = setInterval(() => { if (hook() || !isLoginPageUrl()) clearInterval(t); }, 200);
  setTimeout(() => clearInterval(t), 20000);
}

if (typeof window !== "undefined") {
  try {
    if (window === window.top && window.location.hostname === "eservices.dda.org.in") {
      const path = window.location.pathname.toLowerCase().replace(/\/+$/, "");
      const nav = performance.getEntriesByType("navigation")[0];
      const redirected = (nav?.redirectCount || 0) > 0;
      if (redirected && (path === "" || path === "/admin" || path.startsWith("/admin/"))) {
        handleDdaSessionEnded(path || "/");
      } else if (path !== "" && path !== "/user" && !path.includes("/user/login") && !path.startsWith("/admin")) {
        // Any signed-in page: the automatic login (if any) worked
        const r = readRelogin();
        if (r) {
          sessionStorage.removeItem(RELOGIN_KEY);
          appendRunLog(`✅ Logged back in ${((Date.now() - r.at) / 1000).toFixed(1)}s after DDA ended the session`, "SUCCESS");
        }
      }
    }
  } catch (_) {}
}

// 🌐 Universal Page Analytics Event Listeners (100% Chrome Extension Parity)
// Catches both automated and manual user interactions across every DDA portal page
if (typeof window !== "undefined") {
  runWhenReady(() => {
    // 🛡️ Error Auto-Recovery: Detect 502/504 Bad Gateway, Gateway Timeout, or Database Error pages
    try {
      const text = (document.body?.innerText || "").toLowerCase();
      const title = (document.title || "").toLowerCase();
      const onDda = window.location.hostname === "eservices.dda.org.in";
      const onApplyForm =
        onDda && /\/user\/(userapplicationfrom|applicationform)\//i.test(window.location.pathname);
      const isError =
        title.includes("502 bad gateway") ||
        title.includes("504 gateway") ||
        title.includes("database error") ||
        text.includes("502 bad gateway") ||
        text.includes("504 gateway time-out") ||
        text.includes("database connection error") ||
        text.includes("error establishing a database connection") ||
        text.includes("an error occurred while processing your request");
      // DDA's own 500 page: title "Server Error", body "Database Error"
      const isDdaDbError =
        onDda &&
        (ddaNavStatus() >= 500 ||
          title.includes("server error") ||
          (text.length < 500 && text.includes("database error")));

      // DDA's "Too Many Requests" (429): it refuses until its Retry-After is over
      const isTooMany =
        onDda && (ddaNavStatus() === 429 || title.includes("too many requests"));

      if (onApplyForm && !isError && !isDdaDbError && !isTooMany) {
        clearApplyPending("form opened");
      }

      if (onApplyForm && isTooMany) {
        // Wait out DDA's Retry-After (main saw the header), then open the form again. Same stop
        // rules as the apply retry; without a Retry-After, 5 s.
        markApplyPending(window.location.href);
        const pending = readApplyPending();
        if (pending) {
          pending.tries = (pending.tries || 0) + 1;
          writeApplyPending(pending);
          const formUrl = pending.url;
          (async () => {
            let waitMs = 5000;
            try {
              const ms = await ipcRenderer.invoke("dda:retryAfterMs");
              if (typeof ms === "number" && ms >= 0) waitMs = Math.min(Math.max(ms, 500), 65000);
            } catch (_) {}
            appendRunLog(`⏳ DDA refused the form: too many requests — opening it again in ${Math.ceil(waitMs / 1000)}s (#${pending.tries})`, "WARN");
            window.__ddaApplyRetryTimer = setTimeout(() => {
              window.__ddaApplyRetryTimer = null;
              openPendingForm(formUrl);
            }, waitMs);
          })();
        }
      } else if (onApplyForm && (isError || isDdaDbError)) {
        // DDA's server is failing on the form: reload the form itself every
        // 400-500ms (a "not started" bounce lands on the schemes page, where the
        // pending apply opens the form again). Same stop rules as the apply retry.
        markApplyPending(window.location.href);
        const pending = readApplyPending();
        if (pending) {
          pending.tries = (pending.tries || 0) + 1;
          writeApplyPending(pending);
          appendRunLog(`🔁 DDA database error on the form — reloading (#${pending.tries})`, "WARN");
          const formUrl = pending.url;
          window.__ddaApplyRetryTimer = setTimeout(() => {
            window.__ddaApplyRetryTimer = null;
            openPendingForm(formUrl);
          }, 400 + Math.floor(Math.random() * 101));
        }
      } else if (onDda && /\/user\/makepayment/i.test(window.location.pathname) && (isError || isDdaDbError || isTooMany)) {
        retryMakePaymentPage(isTooMany);
      } else if (isError && !/\/user\/step2_form\//i.test(window.location.pathname)) {
        // (on the flat page Multi-Reload owns recovery, so two reloaders never fight)
        appendRunLog(
          "⚠️ Server error screen detected (502/504/Database Error). Auto-recovering in 1.5s...",
          "WARN",
        );
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (_) {}

    // 1. Scheme Apply (Manual or Automated Click on apply buttons)
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(
          ".applyBtn, a[data-url], button.applyBtn, a.btn",
        );
        if (btn && window.location.href.toLowerCase().includes("schemelist")) {
          const row = btn.closest("tr");
          const schemeTitle =
            row
              ?.querySelector("b.bluec, b, td, .scheme-title, h4, h5")
              ?.textContent?.trim() || "Scheme";
          sessionStorage.removeItem("dda_run_analytics_sent");
          localStorage.removeItem("dda_run_analytics_sent");
          localStorage.removeItem("dda_analytics");
          localStorage.removeItem("dda_run_analytics");
          sessionStorage.removeItem("dda_session_run_logs");
          try {
            localStorage.removeItem("dda_run_logs");
          } catch (_) {}
          loggedMilestones.clear();
          ipcRenderer.send("dda:reset-run-logs", { page: "Schemes" });
          appendRunLog(
            `🎯 Manual Apply Initiated: Target Scheme "${schemeTitle}"`,
            "ROUTE",
          );
          logAnalyticsStep(
            "step1_apply",
            `Scheme Apply: ${schemeTitle} (Manual Direct)`,
          );
        }
      },
      true,
    );

    // 2. Application Form Submit (Manual Click or Form Submit)
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(
          '#SubmitApplicantForm, button#SubmitApplicantForm, #frmApply, button#frmApply, button[type="submit"]',
        );
        if (
          btn &&
          (window.location.href.toLowerCase().includes("applicationform") ||
            window.location.href
              .toLowerCase()
              .includes("userapplicationfrom") ||
            window.location.href.toLowerCase().includes("step1_form"))
        ) {
          logAnalyticsStep("step2_form", "Application Form Submitted");
        }
      },
      true,
    );

    document.addEventListener(
      "submit",
      (e) => {
        const url = window.location.href.toLowerCase();
        if (
          url.includes("applicationform") ||
          url.includes("userapplicationfrom")
        ) {
          logAnalyticsStep("step2_form", "Application Form Submitted");
        } else if (url.includes("step1_form")) {
          logAnalyticsStep("step3_locality", "Locality Search Submitted");
        }
      },
      true,
    );

    // 3. Locality Search Submit (Manual or Automated Click on search button)
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(
          "#search, button#search, input#search, .searchBtn",
        );
        if (btn && window.location.href.toLowerCase().includes("step1_form")) {
          logAnalyticsStep("step3_locality", "Locality Search Submitted");
        }
      },
      true,
    );

    // 4. Flat Radio Select (Manual or Automated Selection of any flat radio)
    document.addEventListener(
      "change",
      (e) => {
        if (
          e.target &&
          e.target.type === "radio" &&
          (e.target.name?.includes("flat") || e.target.closest(".building"))
        ) {
          resetCaptchaSessionState("Manual flat radio selected");
          const lbl = e.target.closest("label") || e.target.parentElement;
          const flatTxt = (lbl?.textContent || "")
            .replace(/[^0-9]/g, "")
            .trim();
          if (flatTxt) {
            logAnalyticsStep(
              "step4_flat_select",
              `Flat Selected: ${flatTxt} (Manual Selection)`,
            );
            try {
              const prefs =
                currentApplicant?.preferences ||
                currentApplicant?.location ||
                {};
              const flatInfo = {
                flatNo: flatTxt,
                locality: prefs.locality || "NARELA",
                sector: prefs.sector || "",
                pocket: prefs.pocket || "",
                block: prefs.block || "",
                floor: prefs.floor || "",
              };
              localStorage.setItem(
                "dda_last_selected_flat_details",
                JSON.stringify(flatInfo),
              );
              sessionStorage.setItem(
                "dda_tab_flat_details",
                JSON.stringify(flatInfo),
              );
            } catch (_) {}
          }
        }
      },
      true,
    );

    // 5. Reserve Button Click (Manual or Automated Click on reserve modal trigger)
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(
          '#submitareabtn, .reserve, button[class*="reserve"]:not(#captchabutton)',
        );
        if (btn && window.location.href.toLowerCase().includes("step2_form")) {
          logAnalyticsStep(
            "step4_reserve_clicked",
            `Reserve Button Clicked for Flat ${window.__ddaLastAttemptedFlat || "target"}`,
          );
        }
      },
      true,
    );

    // 6. Captcha Submit Button Click & Enter Key
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(
          '#captchabutton, button.capreserve, input.capreserve, button[type="submit"]',
        );
        if (
          btn &&
          document.querySelector(
            '#myModal.show, #myModal[style*="display: block"], .modal.show, #captcha',
          )
        ) {
          const captchaVal = document
            .querySelector(CAPTCHA_INPUT_SELECTORS)
            ?.value?.trim();
          logAnalyticsStep(
            "step5_captcha_submit",
            `Flat Captcha Submitted: ${captchaVal || "Submit Clicked"}`,
          );
        }
      },
      true,
    );

    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter" && e.target?.id === "captcha") {
          const captchaVal = e.target.value?.trim();
          if (captchaVal) {
            logAnalyticsStep(
              "step5_captcha_submit",
              `Flat Captcha Submitted: ${captchaVal}`,
            );
          }
        }
      },
      true,
    );

    // 7. Payment Timer SweetAlert OK Click
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(
          ".swal2-confirm, button.confirm, .swal-button--confirm",
        );
        if (btn) {
          const modalText = (
            document.querySelector(".swal2-popup, .swal-modal")?.textContent ||
            ""
          ).toLowerCase();
          if (modalText.includes("your 15 minutes timer has been started")) {
            confirmHoldSecured("DDA started the 15-minute timer");
            logAnalyticsStep(
              "step6_payment_timer_ok",
              "Payment Timer OK Clicked",
            );
          }
        }
      },
      true,
    );
  });
}

function extractBookedFlatDetails() {
  const details = {};

  const cleanFieldValue = (raw) => {
    if (!raw || typeof raw !== "string") return "";
    const cleaned = raw
      .replace(/^[-:–—\s]+/, "")
      .replace(/[-:–—\s]+$/, "")
      .trim();
    return cleaned === "-" ||
      cleaned === "--" ||
      cleaned === "N/A" ||
      cleaned === "null"
      ? ""
      : cleaned;
  };

  const isValidFlatNo = (f) => {
    if (!f || typeof f !== "string") return false;
    const s = f.trim();
    if (s.length === 0 || s === "—" || s === "N/A" || s === "null") return false;
    if (/^(mutation|details|select|property|scheme|allotment|reserved|flat)$/i.test(s)) return false;
    return /^[A-Z0-9\-\/]+$/i.test(s) && /\d/.test(s);
  };

  const cleanMoney = (raw) => {
    if (!raw || typeof raw !== "string") return "";
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num >= 100) {
      return String(num);
    }
    return "";
  };

  try {
    // The flat number comes from the page's "Flat No" field (below), else from the
    // number saved at reservation. Never from the address or input#flat_id: both are
    // DDA's internal codes (…/getlayout/…/<tower>/<flat code>, flat_id="YvEQk"); a
    // reload of the shortened hold address (a 404) once recorded "Y8EbJ" as the flat.
    const flatNoBox = document.querySelector("input#flat_no, input[name='flat_no']");
    if (flatNoBox && isValidFlatNo(flatNoBox.value) && /^\d/.test(flatNoBox.value.trim())) {
      details.flatNo = flatNoBox.value.trim();
    }

    // 1. Direct Scheme Name Extraction from .notification banner at the top of layout page
    const notifEl = document.querySelector(".notification");
    if (notifEl) {
      const clone = notifEl.cloneNode(true);
      clone.querySelectorAll("a, button, i, svg").forEach((el) => el.remove());
      const schemeText = clone.textContent.replace(/\s+/g, " ").trim();
      if (
        schemeText &&
        !schemeText.toLowerCase().includes("application form") &&
        !schemeText.toLowerCase().includes("आवेदन")
      ) {
        details.schemeName = schemeText;
        details.scheme = schemeText;
        localStorage.setItem("dda_active_scheme_name", schemeText);
      }
    }

    const isMoneyLabel = (lbl) => {
      if (!lbl || typeof lbl !== "string") return false;
      const l = lbl.toLowerCase();
      const hasKeyword =
        l.includes("money") ||
        l.includes("amount") ||
        l.includes("fee") ||
        l.includes("payable") ||
        l.includes("charge");
      const isExcluded =
        l.includes("father") ||
        l.includes("mother") ||
        l.includes("mobile") ||
        l.includes("phone") ||
        l.includes("pan") ||
        l.includes("aadhar") ||
        l.includes("dob") ||
        l.includes("area") ||
        l.includes("flat") ||
        l.includes("floor") ||
        l.includes("scheme") ||
        l.includes("block") ||
        l.includes("sector") ||
        l.includes("pocket");
      return hasKeyword && !isExcluded;
    };

    // 2. Preexisting Property Details (Locality, Sector, Pocket, Block, Flat No, Floor, Application Money)
    const fieldsets = document.querySelectorAll(
      "fieldset.formfieldset, fieldset",
    );
    for (const fs of fieldsets) {
      const legend = fs.querySelector("legend");
      const legendText = (legend?.textContent || "").toLowerCase();
      // Skip personal details fieldset when extracting property/fee details
      if (legendText.includes("personal") || legendText.includes("applicant")) continue;

      const formGroups = fs.querySelectorAll(".form-group");
      formGroups.forEach((fg) => {
        const labelEl = fg.querySelector("label");
        if (!labelEl) return;
        const labelText = labelEl.textContent
          .replace(/[-:–—.]/g, "")
          .trim()
          .toLowerCase();

        // Check both input value AND text content
        const inputEl = fg.querySelector("input, select, textarea");
        const inputVal = inputEl?.value?.trim() || "";

        const clone = fg.cloneNode(true);
        clone.querySelectorAll("label").forEach((l) => l.remove());
        const textVal = clone.textContent.trim();

        const rawVal = inputVal || textVal;
        const val = cleanFieldValue(rawVal);
        if (!val) return;

        if (labelText === "locality" || labelText.startsWith("locality")) {
          details.locality = val;
        } else if (labelText === "sector" || labelText.startsWith("sector")) {
          details.sector = val;
        } else if (labelText === "pocket" || labelText.startsWith("pocket")) {
          details.pocket = val;
        } else if (labelText === "block" || labelText.startsWith("block")) {
          details.block = val;
        } else if (
          (labelText === "flat no" ||
            labelText === "flat number" ||
            labelText.includes("flat no") ||
            labelText === "flat") &&
          isValidFlatNo(val)
        ) {
          details.flatNo = val;
        } else if (
          labelText === "floor no" ||
          labelText === "floor number" ||
          labelText.includes("floor no") ||
          labelText === "floor"
        ) {
          details.floor = val;
        } else if (
          labelText.includes("application money") ||
          labelText.includes("application fee") ||
          labelText.includes("registration money") ||
          labelText.includes("registration fee") ||
          labelText.includes("registration amount") ||
          labelText.includes("booking amount") ||
          isMoneyLabel(labelText)
        ) {
          const m = cleanMoney(rawVal);
          if (m) {
            details.applicationMoney = m;
            try {
              sessionStorage.setItem("dda_reserved_app_money", m);
              localStorage.setItem("dda_reserved_app_money", m);
            } catch (_) {}
          }
        }
      });
    }

    // 3. Table Extraction (if rendered as HTML table)
    const tables = document.querySelectorAll(
      "table.table, table.customtable, table",
    );
    for (const tbl of tables) {
      const rows = tbl.querySelectorAll("tr");
      for (const row of rows) {
        const ths = Array.from(row.querySelectorAll("th"));
        const tds = Array.from(row.querySelectorAll("td"));
        ths.forEach((th, idx) => {
          const hText = th.textContent.replace(/[-:–—.]/g, "").trim().toLowerCase();
          const tdInput = tds[idx]?.querySelector("input, select, textarea")?.value?.trim();
          const tdText = tds[idx]?.textContent?.trim() || "";
          const val = cleanFieldValue(tdInput || tdText);
          if (!val) return;
          if ((hText === "flat no" || hText === "flat number" || hText === "flat") && isValidFlatNo(val)) {
            details.flatNo = val;
          }
          if (hText.includes("locality") && !details.locality) details.locality = val;
          if (hText.includes("sector") && !details.sector) details.sector = val;
          if (hText.includes("pocket") && !details.pocket) details.pocket = val;
          if (hText.includes("block") && !details.block) details.block = val;
          if (hText.includes("floor") && !details.floor) details.floor = val;
          if (isMoneyLabel(hText) && !details.applicationMoney) {
            const m = cleanMoney(val);
            if (m) details.applicationMoney = m;
          }
        });

        // Alternating td/td pairs in table rows
        for (let i = 0; i < tds.length - 1; i += 2) {
          const labelCell = tds[i].textContent.replace(/[-:–—.]/g, "").trim().toLowerCase();
          const valInput = tds[i + 1]?.querySelector("input, select, textarea")?.value?.trim();
          const valText = tds[i + 1]?.textContent?.trim() || "";
          const val = cleanFieldValue(valInput || valText);
          if (!val) continue;

          if ((labelCell === "flat no" || labelCell === "flat number" || labelCell === "flat") && isValidFlatNo(val)) {
            details.flatNo = val;
          }
          if (labelCell.includes("locality") && !details.locality) details.locality = val;
          if (labelCell.includes("sector") && !details.sector) details.sector = val;
          if (labelCell.includes("pocket") && !details.pocket) details.pocket = val;
          if (labelCell.includes("block") && !details.block) details.block = val;
          if (labelCell.includes("floor") && !details.floor) details.floor = val;
          if (isMoneyLabel(labelCell) && !details.applicationMoney) {
            const m = cleanMoney(val);
            if (m) details.applicationMoney = m;
          }
        }
      }
    }

    // 3.5 Scoped Money Inputs & Elements
    if (!details.applicationMoney) {
      const candidates = document.querySelectorAll(
        "input[name*='amount' i], input[id*='amount' i], input[name*='money' i], input[id*='money' i], input[name*='fee' i], input[id*='fee' i], #amount, #application_money, .amount, .application-money, [id*='app_money' i], [id*='reg_amount' i]"
      );
      for (const el of candidates) {
        const v = cleanMoney(el.value || el.textContent);
        if (v) {
          details.applicationMoney = v;
          break;
        }
      }
    }

    // 3.6 Scoped Fee/Payment Details Container Regex
    if (!details.applicationMoney) {
      for (const fs of document.querySelectorAll("fieldset, .card, .panel, .box, table")) {
        const txt = fs.innerText || "";
        if (/amount|fee|money/i.test(txt)) {
          const m = txt.match(/(?:application\s*(?:money|fee|amount)|registration\s*(?:money|fee|amount)|amount\s*(?:payable|to\s*be\s*paid)?|total\s*amount)(?:\s*\([^)]*\))?[:\s]+(?:(?:Rs\.?|₹|INR)\s*)?([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{2})?|[0-9]{3,8})/i);
          if (m && m[1]) {
            const v = cleanMoney(m[1]);
            if (v) {
              details.applicationMoney = v;
              break;
            }
          }
        }
      }
    }

    // 4. Fallback to cached flat details and applicant preferences
    let cached = {};
    try {
      cached = JSON.parse(
        localStorage.getItem("dda_last_selected_flat_details") ||
          sessionStorage.getItem("dda_tab_flat_details") ||
          "{}",
      );
    } catch (_) {}

    const prefs =
      currentApplicant?.preferences || currentApplicant?.location || {};

    if (!isValidFlatNo(details.flatNo)) {
      const sessFlat =
        sessionStorage.getItem("dda_reserved_flat_no") ||
        localStorage.getItem("dda_last_reserved_flat") ||
        cached.flatNo;
      if (isValidFlatNo(sessFlat)) {
        details.flatNo = sessFlat.trim();
      } else {
        const rawFlats = prefs.flatNo || prefs.flats;
        const candidate = Array.isArray(rawFlats) ? rawFlats[0] : (typeof rawFlats === "string" ? rawFlats.split(",")[0] : "");
        if (isValidFlatNo(candidate)) {
          details.flatNo = String(candidate).trim();
        }
      }
    }
    if (!details.locality)
      details.locality =
        cleanFieldValue(cached.locality) || prefs.locality || "NARELA";
    if (!details.sector)
      details.sector = cleanFieldValue(cached.sector) || prefs.sector || "";
    if (!details.pocket)
      details.pocket = cleanFieldValue(cached.pocket) || prefs.pocket || "";
    if (!details.block)
      details.block = cleanFieldValue(cached.block) || prefs.block || "";
    if (!details.floor)
      details.floor = cleanFieldValue(cached.floor) || prefs.floor || "";
    if (!details.scheme && !details.schemeName) {
      details.scheme =
        cached.scheme ||
        prefs.scheme ||
        localStorage.getItem("dda_active_scheme_name") ||
        "DDA Housing Scheme";
      details.schemeName = details.scheme;
    }
  } catch (e) {
    console.warn("⚠️ [DDA Analytics] Error extracting booked flat details:", e);
  }

  return details;
}

function extractPersonalDetails() {
  const details = {};

  try {
    // 1. Fieldset extraction (form groups inside Personal Details)
    const fieldsets = document.querySelectorAll(
      "fieldset.formfieldset, fieldset",
    );
    for (const fs of fieldsets) {
      const legend = fs.querySelector("legend");
      if (
        legend &&
        /personal|applicant|user|profile|applied|allotment|general/i.test(
          legend.textContent,
        )
      ) {
        const formGroups = fs.querySelectorAll(".form-group");
        formGroups.forEach((fg) => {
          const labelEl = fg.querySelector("label");
          if (!labelEl) return;
          const labelText = labelEl.textContent
            .replace(/[-:–—.]/g, "")
            .trim()
            .toLowerCase();

          const clone = fg.cloneNode(true);
          const childLbl = clone.querySelector("label");
          if (childLbl) childLbl.remove();
          const val = clone.textContent.trim();
          if (!val) return;

          if (
            labelText.includes("father") ||
            labelText.includes("husband") ||
            labelText.includes("spouse") ||
            labelText.includes("guardian")
          ) {
            details.fatherName = val;
          } else if (
            labelText.includes("applicant name") ||
            labelText.includes("name of applicant") ||
            labelText.includes("first name") ||
            (labelText.includes("name") &&
              !labelText.includes("father") &&
              !labelText.includes("husband") &&
              !labelText.includes("mother") &&
              !labelText.includes("spouse") &&
              !labelText.includes("guardian"))
          ) {
            details.applicantName = val;
          } else if (
            labelText.includes("pan no") ||
            labelText.includes("pan number") ||
            labelText === "pan"
          ) {
            details.applicantPan = val;
          } else if (
            labelText.includes("mobile no") ||
            labelText.includes("mobile")
          ) {
            details.mobileNo = val;
          } else if (labelText.includes("email")) {
            details.email = val;
          }
        });
      }
    }

    // 2. Table extraction (summary tables rendered on /user/getlayout/*)
    const tables = document.querySelectorAll(
      "table.table, table.customtable, table",
    );
    for (const tbl of tables) {
      const rows = tbl.querySelectorAll("tr");
      for (const row of rows) {
        const ths = Array.from(row.querySelectorAll("th"));
        const tds = Array.from(row.querySelectorAll("td"));
        ths.forEach((th, idx) => {
          const hText = th.textContent
            .replace(/[-:–—.]/g, "")
            .trim()
            .toLowerCase();
          const rawVal = tds[idx]?.textContent?.trim() || "";
          if (!rawVal) return;

          if (
            hText.includes("father") ||
            hText.includes("husband") ||
            hText.includes("spouse") ||
            hText.includes("guardian")
          ) {
            details.fatherName = rawVal;
          } else if (
            hText.includes("applicant name") ||
            hText.includes("name of applicant") ||
            hText.includes("first name") ||
            (hText.includes("name") &&
              !hText.includes("father") &&
              !hText.includes("husband") &&
              !hText.includes("mother") &&
              !hText.includes("spouse") &&
              !hText.includes("guardian") &&
              !hText.includes("scheme"))
          ) {
            if (!details.applicantName) details.applicantName = rawVal;
          } else if (hText.includes("pan")) {
            details.applicantPan = rawVal;
          }
        });

        // Alternating td/td pairs in table
        for (let i = 0; i < tds.length - 1; i += 2) {
          const labelCell = tds[i].textContent.replace(/[-:–—.]/g, "").trim().toLowerCase();
          const valCell = tds[i + 1]?.textContent?.trim() || "";
          if (!valCell) continue;
          if (
            labelCell.includes("applicant name") ||
            labelCell.includes("name of applicant") ||
            (labelCell.includes("name") &&
              !labelCell.includes("father") &&
              !labelCell.includes("husband") &&
              !labelCell.includes("mother") &&
              !labelCell.includes("spouse") &&
              !labelCell.includes("guardian") &&
              !labelCell.includes("scheme"))
          ) {
            if (!details.applicantName) details.applicantName = valCell;
          }
        }
      }
    }

    // 3. Fallback to profile header only if no applicantName was found from Personal Details section
    if (!details.applicantName) {
      const profileEl = document.querySelector(".user-profile, .user-name");
      if (profileEl) {
        const text = profileEl.textContent.replace(/logout/i, "").trim();
        if (text && text.length >= 2 && !/^(logout|user|profile)$/i.test(text)) {
          details.applicantName = text;
        }
      }
    }

    // 4. Regex fallback on page text
    if (!details.applicantName) {
      const bodyText = document.body.innerText || "";
      const nameMatch = bodyText.match(/(?:Name\s*of\s*Applicant|Applicant\s*Name)[:\s]*([A-Za-z\s.]+?)(?:\n|\r|Father|Mother|Spouse|PAN|Mobile|Gender|DOB|$)/i);
      if (nameMatch && nameMatch[1].trim()) {
        details.applicantName = nameMatch[1].trim();
      }
    }

    // Safety guard: if applicantName ended up identical to fatherName, clear applicantName so profile name is used
    if (
      details.fatherName &&
      details.applicantName &&
      details.applicantName.toLowerCase() === details.fatherName.toLowerCase()
    ) {
      delete details.applicantName;
    }
  } catch (e) {
    console.warn("⚠️ [DDA Analytics] Error extracting personal details:", e);
  }

  return details;
}

function getExactHoldExpirationTime(callback) {
  let attempts = 0;
  const maxAttempts = 25; // Poll up to 5 seconds (every 200ms)

  const check = () => {
    attempts++;

    // 1. PRIMARY: Read the live ticking countdown directly from the visible screen element!
    const timerElements = document.querySelectorAll(
      "#time, span.timer, #timer, .timer, [id*='time'], [class*='timer']",
    );
    for (const el of timerElements) {
      if (!isElementVisible(el)) continue;
      const text = el.textContent?.trim() || "";
      const match = text.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const totalRemainingSec = minutes * 60 + seconds;
        if (totalRemainingSec > 0 && totalRemainingSec <= 910) {
          const exactCountDown = Date.now() + totalRemainingSec * 1000;
          callback(exactCountDown);
          return;
        }
      }
    }

    // 2. SECONDARY: Look for script-based countdown variables (var fiveMinutes = "...")
    try {
      const html = document.documentElement.innerHTML;
      const scriptMatch = html.match(
        /(?:var\s+)?fiveMinutes\s*=\s*["']([^"']+)["']/i,
      );
      if (scriptMatch && scriptMatch[1]) {
        const timeStr = scriptMatch[1].trim();
        const ddaStartTime = new Date(timeStr.replace(/-/g, "/")).getTime();
        if (!isNaN(ddaStartTime) && ddaStartTime > 0) {
          const countDownDate = ddaStartTime + 900000;
          const diffSec = Math.round((countDownDate - Date.now()) / 1000);
          if (diffSec > 0 && diffSec <= 910) {
            callback(countDownDate);
            return;
          }
        }
      }
    } catch (_) {}

    if (attempts < maxAttempts) {
      setTimeout(check, 200);
    } else {
      callback(Date.now() + 15 * 60 * 1000);
    }
  };

  check();
}

let hasHandledPaymentTimerPage = false;
let lastDispatchedRunSignature = "";
let lastDispatchedTimestamp = 0;

function isAnalyticsAlreadySubmitted(signature) {
  if (!signature) return false;
  const now = Date.now();
  try {
    const savedSig = sessionStorage.getItem("dda_last_dispatched_sig");
    const savedTs = parseInt(
      sessionStorage.getItem("dda_last_dispatched_ts") || "0",
      10,
    );
    if (savedSig === signature && now - savedTs < 60000) {
      return true;
    }
  } catch (_) {}
  if (
    signature === lastDispatchedRunSignature &&
    now - lastDispatchedTimestamp < 60000
  ) {
    return true;
  }
  return false;
}

function markAnalyticsSubmitted(signature) {
  lastDispatchedRunSignature = signature;
  lastDispatchedTimestamp = Date.now();
  try {
    sessionStorage.setItem("dda_last_dispatched_sig", signature);
    sessionStorage.setItem(
      "dda_last_dispatched_ts",
      String(lastDispatchedTimestamp),
    );
  } catch (_) {}
}

function sendAnalyticsPayloadOnce(
  bookedFlat = {},
  holdExpiresAt = null,
  personalDetails = {},
) {
  try {
    // 1. Gather raw run logs and captcha attempts FIRST to avoid TDZ ReferenceErrors
    let rawRunLogs = [];
    try {
      rawRunLogs = JSON.parse(
        sessionStorage.getItem("dda_session_run_logs") ||
          localStorage.getItem("dda_run_logs") ||
          "[]",
      );
    } catch (_) {
      rawRunLogs = [];
    }

    let rawCaptchaAttempts = [];
    try {
      rawCaptchaAttempts = JSON.parse(
        localStorage.getItem("dda_captcha_attempts") ||
          sessionStorage.getItem("dda_captcha_attempts") ||
          "[]",
      );
    } catch (_) {
      rawCaptchaAttempts = [];
    }

    const raw =
      localStorage.getItem("dda_run_analytics") ||
      localStorage.getItem("dda_analytics");
    const analytics = raw
      ? JSON.parse(raw)
      : {
          step6_payment_timer_ok: {
            timestamp: Date.now(),
            time: format12HourTime(Date.now()),
            message: "Payment Timer OK",
          },
        };

    // Ensure active applicant profile is fully loaded
    let effectiveApp = currentApplicant;
    if (!effectiveApp || !effectiveApp.personal) {
      try {
        if (typeof window !== "undefined" && window.__ACTIVE_APPLICANT__) {
          effectiveApp = window.__ACTIVE_APPLICANT__;
        }
      } catch (_) {}
    }
    if (!effectiveApp || !effectiveApp.personal) {
      try {
        const saved = localStorage.getItem("window.__ACTIVE_APPLICANT__");
        if (saved) effectiveApp = JSON.parse(saved);
      } catch (_) {}
    }
    if (!effectiveApp || !effectiveApp.personal) {
      try {
        const rawPerson =
          localStorage.getItem("dda_selected_person") ||
          localStorage.getItem("dda_active_applicant_pan");
        const rawData = localStorage.getItem("ddaData");
        if (rawData) {
          const parsed = JSON.parse(rawData);
          if (parsed?.applicants) {
            effectiveApp =
              rawPerson && parsed.applicants[rawPerson]
                ? parsed.applicants[rawPerson]
                : Object.values(parsed.applicants)[0];
          }
        }
      } catch (_) {}
    }

    // Who booked: DDA's hold page shows the logged-in account's PAN; the
    // sidebar applicant is only what was selected. If they differ, the record
    // follows DDA's account and never mixes in the other person's details.
    const pagePan = String(personalDetails.applicantPan || "").toUpperCase().trim();
    const selectedPan = String(effectiveApp?.personal?.pan || effectiveApp?.pan || "").toUpperCase().trim();
    const applicantMismatch = !!(pagePan && selectedPan && pagePan !== selectedPan);
    const personal = applicantMismatch ? {} : effectiveApp?.personal || {};
    const prefs = effectiveApp?.preferences || effectiveApp?.location || {};
    const cached = JSON.parse(
      localStorage.getItem("dda_last_selected_flat_details") || "{}",
    );

    const finalFlatNo =
      bookedFlat.flatNo ||
      cached.flatNo ||
      prefs.flatNo ||
      prefs.flats ||
      "N/A";
    const finalApplicantPan = (
      personalDetails.applicantPan ||
      personal.pan ||
      effectiveApp?.pan ||
      "UNKNOWN_PAN"
    )
      .toUpperCase()
      .trim();

    // Configured applicant profile is primary truth for applicant name to prevent father's name swapping
    const configuredFullName =
      [personal.firstName, personal.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      personal.name ||
      "";
    let finalApplicantName =
      configuredFullName || personalDetails.applicantName || "Applicant";
    let finalFatherName =
      personal.fatherName ||
      personal.father_name ||
      personalDetails.fatherName ||
      "";

    // Anti-swap guard: If applicant name matches father's name, restore from configured firstName
    if (
      finalFatherName &&
      finalApplicantName.toLowerCase() === finalFatherName.toLowerCase()
    ) {
      if (personal.firstName) {
        finalApplicantName = [personal.firstName, personal.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();
      }
    }

    const targetScheme =
      bookedFlat.schemeName ||
      bookedFlat.scheme ||
      prefs.scheme ||
      localStorage.getItem("dda_active_scheme_name") ||
      "DDA Housing Scheme";

    // Timings: recorded milestones only, nothing estimated. The run is
    // measured from its first recorded step (normally Scheme Apply) to DDA
    // reserving the flat (status 0).
    const stepTs = (k) => analytics[k]?.timestamp || null;
    const endStep =
      analytics.step5_reserved ||
      analytics.step5_captcha_submit ||
      analytics.step6_payment_timer_ok ||
      analytics.step4_reserve_clicked ||
      analytics.step4_flat_select;
    const endTs = endStep?.timestamp || Date.now();
    const START_STEPS = {
      step1_apply: "Scheme Apply",
      step2_form: "the Application Form",
      step3_locality: "the Locality step",
      step4_page_load: "the Flat Selection page",
      step4_flat_select: "flat selection",
    };
    const startKey =
      Object.keys(START_STEPS).find((k) => stepTs(k) && stepTs(k) < endTs) || null;
    const startTs = startKey ? stepTs(startKey) : null;
    const measuredMs = startTs ? endTs - startTs : null;
    const totalTimeMs = measuredMs ?? 0;
    const totalTimeSec = parseFloat((totalTimeMs / 1000).toFixed(2));
    const holdExpiresIso = holdExpiresAt
      ? new Date(holdExpiresAt).toISOString()
      : new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const runSignature = `${finalApplicantPan}_${finalFlatNo}_${endStep?.timestamp || ""}`;
    if (isAnalyticsAlreadySubmitted(runSignature)) {
      console.log(
        "🛑 [DDA Analytics] Duplicate submission ignored for signature:",
        runSignature,
      );
      return;
    }
    markAnalyticsSubmitted(runSignature);

    const runId = `${finalApplicantPan}_${startTs || Date.now()}`;

    // This booking's attempts: everything recorded since its first step
    // (normally Scheme Apply). Without a recorded start, the last 60 s.
    const anchorTs = endStep?.timestamp || Date.now();
    const attemptsFrom = startTs || anchorTs - 60_000;
    const bookingAttempts = rawCaptchaAttempts.filter((att) => {
      if (!att.timestamp) return false;
      if (att.timestamp < attemptsFrom) return false;
      if (att.pan && finalApplicantPan && att.pan !== finalApplicantPan && att.pan !== selectedPan)
        return false;
      return true;
    });

    // Clean up attempts: if any attempt was submitted, reserved, or rejected, filter out orphan unsubmitted PRE_SOLVED entries
    const hasSubmitted = bookingAttempts.some(
      (a) =>
        a.status === "RESERVED" ||
        a.status === "SUBMITTED" ||
        a.status === "SERVER_REJECTED" ||
        a.status === "NO_RESPONSE" ||
        a.status === "FAILED",
    );
    const validBookingAttempts = hasSubmitted
      ? bookingAttempts.filter((a) => a.status !== "PRE_SOLVED")
      : bookingAttempts;

    // Deduplicate by base64Image keeping the most advanced/latest status for each image
    const dedupedAttempts = [];
    const seenImages = new Set();
    for (let i = validBookingAttempts.length - 1; i >= 0; i--) {
      const att = validBookingAttempts[i];
      const imgKey = att.base64Image
        ? att.base64Image.slice(-60)
        : `${att.timestamp}_${att.answer}`;
      if (!seenImages.has(imgKey)) {
        seenImages.add(imgKey);
        dedupedAttempts.unshift(att);
      }
    }

    dedupedAttempts.forEach((att, idx) => {
      att.attemptNumber = idx + 1;
    });

    const finalCaptchaAttempts =
      dedupedAttempts.length > 0
        ? dedupedAttempts
        : rawCaptchaAttempts.length > 0
          ? [rawCaptchaAttempts[rawCaptchaAttempts.length - 1]]
          : [];

    // Fallback: If attempts array is empty, synthesize attempt from in-memory pre-solve/answer
    if (
      finalCaptchaAttempts.length === 0 &&
      (lastSolvedCaptchaAnswer || step2PreSolvedResult)
    ) {
      finalCaptchaAttempts.push({
        attemptNumber: 1,
        pan: finalApplicantPan,
        timestamp: endStep?.timestamp || Date.now(),
        timeStr: format12HourTime(endStep?.timestamp || Date.now()),
        base64Image: step2PreSolvedResult?.base64Image || "",
        rawText:
          step2PreSolvedResult?.data?.rawText ||
          String(lastSolvedCaptchaAnswer || ""),
        answer: String(lastSolvedCaptchaAnswer || ""),
        numericAnswer: Number(lastSolvedCaptchaAnswer) || null,
        durationMs: step2PreSolvedResult?.durationMs || 0,
        status: "RESERVED",
        statusDetail: "Direct reservation verified via in-memory state",
        model: step2PreSolvedResult?.data?.model || "native-onnx-node-v1",
        serverAlertText: null,
      });
    }

    const appHeaderLog = {
      time: format12HourTime(startTs || Date.now()),
      timestamp: (startTs || Date.now()) - 1,
      ts: (startTs || Date.now()) - 1,
      level: "INFO",
      page: "System",
      msg: "🖥️ Logs sent from the Electron Desktop App",
      pan: finalApplicantPan,
      _stored: true,
    };

    let cleanedRunLogs = rawRunLogs.filter((log) => {
      const msg = String(log.msg || log.message || "");
      if (
        log.page === "Session Init" ||
        msg.includes("Isolated session active") ||
        /Ping #\d+ OK/.test(msg)
      )
        return false;
      return true;
    });

    if (
      !cleanedRunLogs.some((l) =>
        String(l.msg || "").includes("Logs sent from the Electron Desktop App"),
      )
    ) {
      cleanedRunLogs.unshift(appHeaderLog);
    }

    if (applicantMismatch) {
      appendRunLog(
        `⚠️ DDA account on the hold page is ${pagePan}, but the sidebar applicant is ${selectedPan} — the booking record uses ${pagePan}.`,
        "WARN",
      );
    }
    appendRunLog(
      measuredMs != null
        ? `🚀 Booking Run Completed: flat ${finalFlatNo} reserved ${totalTimeSec}s after ${START_STEPS[startKey]} (${measuredMs}ms)`
        : `🚀 Booking Run Completed: flat ${finalFlatNo} reserved (run start not recorded, so no time measured)`,
      "SUCCESS",
    );
    appendRunLog(
      `📤 Dispatching analytics, captcha images & event logs (${cleanedRunLogs.length + 2} events) to Firestore...`,
      "ROUTE",
    );

    // Extract real logged in app user credentials from storage or IPC
    let resolvedUserEmail =
      localStorage.getItem("dda_auth_email") ||
      sessionStorage.getItem("dda_auth_email") ||
      currentSettings?.userEmail ||
      effectiveApp?.ownerEmail ||
      effectiveApp?.userEmail ||
      "";

    let resolvedUserId =
      localStorage.getItem("dda_auth_uid") ||
      sessionStorage.getItem("dda_auth_uid") ||
      currentSettings?.userId ||
      effectiveApp?.userId ||
      "user";

    let resolvedIdToken =
      localStorage.getItem("dda_id_token") ||
      sessionStorage.getItem("dda_id_token") ||
      "";

    // Synchronous fallback from main process or dda_auth_user to guarantee genuine email
    if (!resolvedUserEmail || resolvedUserEmail === "extension@dda.local") {
      try {
        const rawAuth = localStorage.getItem("dda_auth_user");
        if (rawAuth) {
          const parsedAuth = JSON.parse(rawAuth);
          if (parsedAuth?.email && parsedAuth.email !== "extension@dda.local") {
            resolvedUserEmail = parsedAuth.email;
            if (parsedAuth.uid) resolvedUserId = parsedAuth.uid;
            if (parsedAuth.idToken) resolvedIdToken = parsedAuth.idToken;
          }
        }
      } catch (_) {}
    }

    if (!resolvedUserEmail || resolvedUserEmail === "extension@dda.local") {
      try {
        const mainUser = ipcRenderer.sendSync("session:getActiveUserSync");
        if (mainUser?.email && mainUser.email !== "extension@dda.local") {
          resolvedUserEmail = mainUser.email;
          if (mainUser.uid) resolvedUserId = mainUser.uid;
          if (mainUser.idToken) resolvedIdToken = mainUser.idToken;
        }
      } catch (_) {}
    }

    // Steps exactly as recorded (time + what happened); a step that did not
    // happen in this run is left out rather than estimated.
    const finalSteps = {};
    for (const k of [
      "step1_apply", "step2_form", "step3_locality", "step4_page_load",
      "step4_flat_select", "step5_captcha_submit", "step5_reserved",
      "step6_payment_timer_ok", "step7_hold_confirmed",
    ]) {
      const st = analytics[k];
      if (!st?.timestamp) continue;
      finalSteps[k] = {
        timestamp: st.timestamp,
        time: st.time || format12HourTime(st.timestamp),
        message: st.message || k,
      };
    }

    const payload = {
      runId: runId,
      id: runId,
      mode: (currentSettings?.mode || "LIVE").toUpperCase(),
      bookingKey:
        currentSettings?.bookingKey ||
        localStorage.getItem("dda_booking_key") ||
        "",
      userEmail: resolvedUserEmail,
      userId: resolvedUserId,
      applicantName: finalApplicantName,
      applicantPan: finalApplicantPan,
      fatherName: finalFatherName,
      scheme: targetScheme,
      schemeName: targetScheme,
      totalDurationMs: totalTimeMs,
      totalDurationSec: totalTimeSec,
      // false: no start milestone in this run, so totalDuration is 0, not a time.
      durationMeasured: measuredMs != null,
      durationFrom: startKey,
      reservedAt: stepTs("step5_reserved") ? new Date(stepTs("step5_reserved")).toISOString() : null,
      holdConfirmedAt: stepTs("step7_hold_confirmed") ? new Date(stepTs("step7_hold_confirmed")).toISOString() : null,
      selectedApplicantPan: selectedPan || null,
      applicantMismatch,
      holdExpiresAt: holdExpiresIso,
      applicant: {
        firstName:
          personal.firstName || finalApplicantName.split(" ")[0] || "Applicant",
        lastName:
          personal.lastName ||
          finalApplicantName.split(" ").slice(1).join(" ") ||
          "",
        pan: finalApplicantPan,
        mobile: personal.mobile || "",
        email: personal.email || "",
      },
      bookedFlat: {
        scheme: targetScheme,
        locality:
          bookedFlat.locality || cached.locality || prefs.locality || "NARELA",
        sector: bookedFlat.sector || cached.sector || prefs.sector || "",
        pocket: bookedFlat.pocket || cached.pocket || prefs.pocket || "",
        block: bookedFlat.block || cached.block || prefs.block || "",
        tower: bookedFlat.tower || "N/A",
        flatNo: finalFlatNo,
        floor: bookedFlat.floor || cached.floor || prefs.floor || "",
        holdExpiresAt: holdExpiresIso,
      },
      steps: finalSteps,
      captchaAttempts: finalCaptchaAttempts,
      lastCaptcha:
        finalCaptchaAttempts.length > 0
          ? finalCaptchaAttempts[finalCaptchaAttempts.length - 1]
          : null,
      runLogs: cleanedRunLogs,
      logs: cleanedRunLogs,
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      client: "DDA-Desktop-Electron",
    };

    // Persist reserved flat details to storage for instant sidebar display on PAYMENT_HOLD
    try {
      if (finalFlatNo && finalFlatNo !== "N/A") {
        localStorage.setItem("dda_last_reserved_flat", String(finalFlatNo));
        sessionStorage.setItem("dda_reserved_flat_no", String(finalFlatNo));
      }
      if (holdExpiresIso) {
        sessionStorage.setItem("dda_hold_expires_at", holdExpiresIso);
      }
      localStorage.setItem("dda_run_analytics", JSON.stringify(payload));
    } catch (_) {}

    try {
      ipcRenderer.send("dda:analytics-dispatched", payload);
    } catch (_) {}

    // The dashboard (Workspace → api.sendBookingTelemetry) is the single
    // sender: Firestore, the worker, the local DB and the run log file.
    // Sending from here as well wrote every booking several times.
  } catch (err) {
    console.warn("Could not construct/send analytics:", err);
  }
}

function checkForPaymentTimerPage() {
  if (!isUserLoggedIn()) return;

  const url = window.location.href.toLowerCase();
  const isGetLayoutUrl = url.includes("getlayout");

  const timerEl = document.querySelector("#time, span.timer");
  const btnContinue = document.querySelector("#btnContinue");
  const flatIdInput = document.querySelector("input#flat_id");
  const propertyLegend = Array.from(document.querySelectorAll("legend")).some(
    (l) =>
      /property details|flat details|allotment details/i.test(l.textContent),
  );

  // A getlayout address alone is not the hold page: reopening the shortened hold
  // address gives DDA's 404 page there (11 and 20 Oct), which was then recorded as
  // a booking with the tower code as its flat. The real page has the flat's hidden
  // input, the timer, Continue or the property details.
  const isPaymentTimerPage =
    (isGetLayoutUrl && !!(flatIdInput || timerEl || btnContinue || propertyLegend)) ||
    (timerEl && (btnContinue || propertyLegend || flatIdInput));

  if (!isPaymentTimerPage) return;
  if (hasHandledPaymentTimerPage) return;
  hasHandledPaymentTimerPage = true;

  appendRunLog("🎯 Landed on Payment Timer page (/user/getlayout/*)", "ROUTE");
  logAnalyticsStep("step6_payment_timer_ok", "Payment Timer Page Reached");

  pendingHoldRecord = {
    bookedFlat: extractBookedFlatDetails(),
    personalDetails: extractPersonalDetails(),
  };
  startHoldTimerSync();
  watchHoldConfirmation();
  window.addEventListener("pagehide", recordHoldOnEarlyLeave, { once: true });
  setTimeout(checkHoldPageScripts, HOLD_SCRIPTS_CHECK_MS);
  runWhenReady(installHoldStepRetry);
}

// ─── Payment steps that fail during the hold ───
// DDA's hold page runs its payment steps as background requests: Continue
// asks for the bank choice (flat_payment_method), the bank asks for the
// payment form (flat_payment_form). When DDA answers with an error, its page
// does nothing at all, no message. On 20 Oct flat 305 got 95 errors over 10
// minutes this way and was paid with 3:46 left. A failed step is repeated
// every 2 s for as long as the hold lasts.
const HOLD_EXPIRY_KEY = "dda_hold_expiry_ms";
const HOLD_STEP_RETRY_MS = 2000;
const HOLD_STEPS = {
  flat_payment_method: { fn: "paymentMethod", label: "bank choice (Continue)" },
  flat_payment_form: { fn: "paymentForm", label: "payment form" },
};

// Time left on this tab's hold, in ms; null when unknown
function holdTimeLeftMs() {
  const sec = readDdaHoldRemainingSec();
  if (sec != null) return sec * 1000;
  const expiry = readDdaHoldExpiryFromScript() || Number(sessionStorage.getItem(HOLD_EXPIRY_KEY) || 0);
  return expiry ? expiry - Date.now() : null;
}

function installHoldStepRetry() {
  const jq = window.jQuery;
  if (!jq || window.__ddaHoldStepRetry) return;
  window.__ddaHoldStepRetry = true;
  const tries = {};
  const timers = {};
  jq(document).ajaxComplete((_e, xhr, settings) => {
    const url = String(settings?.url || "");
    const step = Object.keys(HOLD_STEPS).find((k) => url.includes("/user/" + k));
    if (!step) return;
    const { fn, label } = HOLD_STEPS[step];
    const status = xhr?.status || 0;
    if (xhr?.statusText === "abort") return;
    if (status > 0 && status < 400) {
      if (tries[step]) appendRunLog(`✅ DDA answered the ${label} step after ${tries[step]} retr${tries[step] === 1 ? "y" : "ies"}.`, "SUCCESS");
      tries[step] = 0;
      return;
    }
    if (timers[step]) return;
    const left = holdTimeLeftMs();
    if (left != null && left < 5000) {
      appendRunLog(`⚠️ DDA is still failing the ${label} step and the hold time is over.`, "WARN");
      return;
    }
    tries[step] = (tries[step] || 0) + 1;
    if (tries[step] === 1 || tries[step] % 5 === 0) {
      appendRunLog(`🔁 DDA error on the ${label} step (${status ? "status " + status : "no answer"}) — trying again every ${HOLD_STEP_RETRY_MS / 1000}s (#${tries[step]})`, "WARN");
    }
    timers[step] = setTimeout(() => {
      timers[step] = null;
      try {
        if (typeof window[fn] === "function") window[fn]();
      } catch (_) {}
    }, HOLD_STEP_RETRY_MS);
  });
}

// DDA's Make Payment page (/user/makepayment…) answering with an error: the
// flat stays held for the rest of DDA's 15 minutes, but the tab only shows the
// error (flat 34 was lost this way on 20 Oct). Open it again every 2 s (after
// DDA's Retry-After on a 429) until it works or the hold runs out.
const MAKE_PAYMENT_RETRY_MS = 2000;
const MAKE_PAYMENT_RETRY_KEY = "dda_make_payment_retry";
async function retryMakePaymentPage(tooMany) {
  let st = {};
  try { st = JSON.parse(sessionStorage.getItem(MAKE_PAYMENT_RETRY_KEY) || "{}"); } catch (_) {}
  if (st.url !== location.href) st = { url: location.href, tries: 0, since: Date.now() };
  st.tries++;
  const expiry = Number(sessionStorage.getItem(HOLD_EXPIRY_KEY) || 0);
  const left = expiry ? expiry - Date.now() : 15 * 60000 - (Date.now() - st.since);
  if (left < 5000) {
    try { sessionStorage.removeItem(MAKE_PAYMENT_RETRY_KEY); } catch (_) {}
    appendRunLog("⚠️ DDA's Make Payment page is still failing and the hold time is over. Check this application on DDA.", "WARN");
    return;
  }
  try { sessionStorage.setItem(MAKE_PAYMENT_RETRY_KEY, JSON.stringify(st)); } catch (_) {}
  let waitMs = MAKE_PAYMENT_RETRY_MS;
  if (tooMany) {
    try {
      const ms = await ipcRenderer.invoke("dda:retryAfterMs");
      if (typeof ms === "number" && ms >= 0) waitMs = Math.min(Math.max(ms, 500), 65000);
    } catch (_) {}
  }
  if (st.tries === 1 || st.tries % 5 === 0) {
    appendRunLog(`🔁 DDA error on the Make Payment page — opening it again in ${Math.ceil(waitMs / 1000)}s (#${st.tries}, about ${Math.max(1, Math.round(left / 60000))} min of hold left)`, "WARN");
  }
  setTimeout(() => location.reload(), waitMs);
}

// DDA once sent a hold page with its scripts left out (18 Oct): no countdown
// and no CheckTermCondition, so "Click to Pay" fails ("CheckTermCondition is
// not defined") and Fast Payment can't go on. Such a page is reloaded once;
// a second bad page is left for the user, with a warning.
const HOLD_SCRIPTS_CHECK_MS = 2000;
function checkHoldPageScripts() {
  try {
    if (!/getlayout/i.test(location.pathname)) return;
    if (document.readyState !== "complete") {
      window.addEventListener("load", () => setTimeout(checkHoldPageScripts, 300), { once: true });
      return;
    }
    // Kept per tab with the time set (not per address: a good hold page
    // rewrites its own address while it loads)
    const resumeKey = "dda_hold_scripts_resume";
    const recent = (k) => { try { return Date.now() - Number(sessionStorage.getItem(k) || 0) < 60000; } catch (_) { return false; } };
    // Past the first step (gateway choice / payment form already shown): fine
    if (document.querySelector(".payment_method select, #payment_gateway, .payment_form #makePaymentButton")) {
      try { sessionStorage.removeItem(resumeKey); } catch (_) {}
      return;
    }
    if (!document.querySelector("#btnContinue")) return;
    const hasTermsScript = typeof window.CheckTermCondition === "function";
    const hasTimer = !!readHoldTimerText() || !!readDdaHoldExpiryFromScript();
    if (hasTermsScript || hasTimer) {
      // Reloaded because of a bad page while this payment was already
      // approved (FAST PAY pressed): carry on with its first step here.
      let resume = false;
      resume = recent(resumeKey);
      try { sessionStorage.removeItem(resumeKey); } catch (_) {}
      const approved = window.__ddaFastPaymentApproved === true || sessionStorage.getItem("dda_fast_payment_approved") === "true";
      if (resume && approved && hasTermsScript) {
        const tandc = document.getElementById("tandc") || document.querySelector('input[name="tandc"]');
        if (tandc) {
          tandc.checked = true;
          tandc.dispatchEvent(new Event("change", { bubbles: true }));
          try { if (window.$ && window.$.fn) window.$("#tandc").prop("checked", true).trigger("change"); } catch (_) {}
        }
        appendRunLog("⚡ [Fast Payment] Hold page reloaded fine — continuing the payment (Click to Pay).", "ROUTE");
        window.CheckTermCondition();
      }
      return;
    }

    const key = "dda_hold_scripts_reload";
    const reloadedBefore = recent(key);
    if (reloadedBefore) {
      appendRunLog("⚠️ DDA's hold page came without its scripts again after a reload (no timer, no Click to Pay). Reload the page yourself.", "WARN");
      return;
    }
    try {
      sessionStorage.setItem(key, String(Date.now()));
      const approved = window.__ddaFastPaymentApproved === true || sessionStorage.getItem("dda_fast_payment_approved") === "true";
      if (approved) sessionStorage.setItem(resumeKey, String(Date.now()));
    } catch (_) {}
    appendRunLog("⚠️ DDA's hold page came without its scripts (no timer, no Click to Pay) — reloading it once.", "WARN");
    location.reload();
  } catch (_) {}
}

// Leaving the hold page (SCHEMES, logout, ...) before the checks above have
// finished (~2 s) would lose the booking record. DDA already reserved the flat
// (status 0) and showed no error here, so record it now; the IPC send still
// goes out while the page unloads.
function recordHoldOnEarlyLeave() {
  if (holdConfirmed || holdRefused || !pendingHoldRecord) return;
  let reservedThisRun = false;
  try {
    const a = JSON.parse(localStorage.getItem("dda_run_analytics") || localStorage.getItem("dda_analytics") || "{}");
    reservedThisRun = !!a.step5_reserved?.timestamp;
  } catch (_) {}
  if (!reservedThisRun) return;
  const sec = readDdaHoldRemainingSec();
  const expiry = sec ? Date.now() + sec * 1000 : readDdaHoldExpiryFromScript();
  confirmHoldSecured("DDA reserved the flat; hold page left before the payment form showed", expiry);
}

// ─── Sidebar hold timer = DDA's own countdown ───
// DDA's hold does not always start at 15:00 (it can be 10–12 minutes), so the
// sidebar never assumes a length: it mirrors the countdown on the hold page,
// re-read every second, and is updated whenever the two drift apart.
let holdTimerSyncStarted = false;

function readDdaHoldRemainingSec() {
  const els = document.querySelectorAll("#time, span.timer, #timer, .timer, [id*='time'], [class*='timer']");
  for (const el of els) {
    if (!isElementVisible(el)) continue;
    const m = String(el.textContent || "").trim().match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) continue;
    const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if (sec >= 0 && sec <= 910) return sec;
  }
  return null;
}

// DDA's hold start time from the page's countdown script ("fiveMinutes"),
// as an expiry timestamp; null if the page does not carry it.
function readDdaHoldExpiryFromScript() {
  try {
    const m = document.documentElement.innerHTML.match(/(?:var\s+)?fiveMinutes\s*=\s*["']([^"']+)["']/i);
    if (!m) return null;
    const start = new Date(m[1].trim().replace(/-/g, "/")).getTime();
    const expiry = start + 900000;
    const left = expiry - Date.now();
    return !isNaN(start) && left > -5000 && left <= 910000 ? expiry : null;
  } catch (_) {
    return null;
  }
}

function startHoldTimerSync() {
  if (holdTimerSyncStarted) return;
  holdTimerSyncStarted = true;
  let lastSentExpiry = 0;
  // The on-page text may be a static placeholder (e.g. "15:00") until DDA's
  // script starts it, so it is only trusted once it has changed.
  let firstText = null;
  let textIsLive = false;
  const tick = () => {
    let expiry = null;
    const sec = readDdaHoldRemainingSec();
    if (sec != null) {
      if (firstText === null) firstText = sec;
      else if (sec !== firstText) textIsLive = true;
    }
    if (textIsLive) expiry = Date.now() + sec * 1000;
    else if (!lastSentExpiry) expiry = readDdaHoldExpiryFromScript();
    if (expiry == null) return;
    // The page shows whole seconds; ignore sub-second jitter.
    if (Math.abs(expiry - lastSentExpiry) < 1500) return;
    lastSentExpiry = expiry;
    // Kept for the next pages of this tab (Make Payment retries)
    try { sessionStorage.setItem(HOLD_EXPIRY_KEY, String(expiry)); } catch (_) {}
    const info = { holdExpiresAt: new Date(expiry).toISOString() };
    try {
      ipcRenderer.send("dda:payment-hold-info", info);
      if (typeof ipcRenderer.sendToHost === "function") ipcRenderer.sendToHost("dda:payment-hold-info", info);
    } catch (_) {}
  };
  tick();
  setInterval(tick, 500);
}

// ─── Hold confirmation ───
// Landing on the hold URL is not proof of a hold. It counts as confirmed when
// DDA's hold page shows its payment form (#tandc / #btnContinue, which Fast
// Payment's first step uses) with no error popup for HOLD_FORM_STABLE_MS, or
// shows the "your 15 minutes timer has been started" popup, or its countdown
// is seen running. Only then: the reservation chime and the booking record.
const HOLD_CONFIRM_TIMEOUT_MS = 15000;
const HOLD_TIMER_RUNNING_AFTER_MS = 2500;
const HOLD_FORM_STABLE_MS = 1500;
let pendingHoldRecord = null;
let holdConfirmed = false;
let holdRefused = false;
// Set when the timer popup shows before the landing code has run.
let earlyHoldConfirmation = "";
let holdWatchTimer = null;

function readHoldTimerText() {
  const el = document.querySelector("#time, span.timer");
  const t = String(el?.textContent || "").trim();
  return /\d{1,2}\s*:\s*\d{2}/.test(t) && !/^0{1,2}\s*:\s*00$/.test(t) ? t : "";
}

// leaveExpiry: set (number or null) only when the page is unloading; then the
// record is sent at once instead of after polling for DDA's countdown.
function confirmHoldSecured(how, leaveExpiry) {
  if (holdConfirmed) return;
  if (!pendingHoldRecord) {
    earlyHoldConfirmation = how;
    return;
  }
  holdConfirmed = true;
  if (holdWatchTimer) clearInterval(holdWatchTimer);
  const record = pendingHoldRecord;
  const flatNo = String(
    record.bookedFlat?.flatNo ||
      sessionStorage.getItem("dda_reserved_flat_no") ||
      localStorage.getItem("dda_last_reserved_flat") ||
      "",
  );
  appendRunLog(`✅ Hold confirmed${flatNo ? ` for flat ${flatNo}` : ""} — ${how}.`, "SUCCESS");
  logAnalyticsStep("step7_hold_confirmed", `Hold confirmed: ${how}`);
  try {
    // holdConfirmed (not reserved): the chime already played when DDA
    // reserved the flat; this only releases Workspace's telemetry fallback.
    const msg = { flatNo, holdConfirmed: true };
    ipcRenderer.send("dda:flat-selected", msg);
    if (typeof ipcRenderer.sendToHost === "function") ipcRenderer.sendToHost("dda:flat-selected", msg);
  } catch (_) {}
  if (leaveExpiry !== undefined) {
    sendAnalyticsPayloadOnce(record.bookedFlat, leaveExpiry, record.personalDetails);
    return;
  }
  getExactHoldExpirationTime((holdExpiresAt) => {
    sendAnalyticsPayloadOnce(record.bookedFlat, holdExpiresAt, record.personalDetails);
  });
}

function watchHoldConfirmation() {
  if (holdWatchTimer || holdConfirmed) return;
  if (earlyHoldConfirmation) {
    confirmHoldSecured(earlyHoldConfirmation);
    return;
  }
  const startedAt = Date.now();
  const firstTimerText = readHoldTimerText();
  holdWatchTimer = setInterval(() => {
    if (holdConfirmed) {
      clearInterval(holdWatchTimer);
      return;
    }
    const elapsed = Date.now() - startedAt;
    // DDA refused the hold on this page (taken / expired / error popup).
    const popupText = String(document.querySelector(".swal2-popup.swal2-show, .swal-modal")?.textContent || "").toLowerCase();
    if (popupText && !popupText.includes("timer has been started") &&
        /already|not available|sold|expired|error|invalid/.test(popupText)) {
      holdRefused = true;
      clearInterval(holdWatchTimer);
      appendRunLog("⚠️ DDA did not confirm the hold on this page — no booking recorded. Check the page.", "WARN");
      return;
    }
    // DDA rendered the hold page's payment form and no error came with it.
    if (elapsed >= HOLD_FORM_STABLE_MS && document.querySelector("#tandc, #btnContinue")) {
      confirmHoldSecured("DDA's hold page is showing the payment form");
      return;
    }
    // No popup (e.g. the hold page was reloaded) but the countdown is running.
    const now = readHoldTimerText();
    if (elapsed >= HOLD_TIMER_RUNNING_AFTER_MS && now && firstTimerText && now !== firstTimerText) {
      confirmHoldSecured("DDA's 15-minute countdown is running");
      return;
    }
    if (elapsed > HOLD_CONFIRM_TIMEOUT_MS) {
      clearInterval(holdWatchTimer);
      appendRunLog("⚠️ Could not confirm the hold within 15 s (no timer popup, countdown not running) — no booking recorded. Check the page.", "WARN");
    }
  }, 500);
}

let isFastPaymentExecuting = false;
let lastFastPaymentStep = "";
let hasAnnouncedOtpScreen = false;
let hasAnnouncedGatewayScreen = false;

// Gateway flow state (per page load). The plan (card, or bank for net
// banking) is fetched from main only on the gateway, only while main has this
// payment armed, and kept in this closure — never on window or in web storage.
//
// User-in-control rules on BillDesk (card and net banking alike):
//  - fields are filled until each one verifies (BillDesk may render expiry and
//    CVV only after the card number is typed, so late fields are picked up),
//    with a small per-field retry cap, never fighting the user;
//  - the moment the user types in, pastes into, or clicks anything on the
//    BillDesk form, automation stops for this payment and never clicks Pay;
//  - Pay is clicked at most once, and only if the fields still hold exactly
//    the saved card; otherwise it hands over with a log line.
let gatewayPlan = null;
let gatewayPlanRequested = false;
let gatewayPlanLoaded = false;
let gatewayPlanMissingAnnounced = false;
let gatewayCard = null;
let cardTabClickedAt = 0;
let cardFillStartedAt = 0;
let cardFilledAt = 0;
const cardFieldFillCounts = new WeakMap(); // element -> times we wrote it
const CARD_FIELD_MAX_WRITES = 3;
const CARD_FIELD_SETTLE_MS = 400;
let lastCardFieldWriteAt = 0;
let cardFilledLogged = false;
const CARD_FILL_TIMEOUT_MS = 10000;
const CARD_PAY_ENABLE_TIMEOUT_MS = 10000;
const watchedPaymentDocs = new WeakSet();

// Terminal steps: the gateway flow is done for this payment and steps aside.
const GATEWAY_DONE_STEPS = [
  "card_pay_submitted", "card_user_took_over", "card_handed_over",
  "nb_pay_submitted", "nb_user_took_over", "nb_handed_over",
  "gateway_already_submitted",
];

function isBillDeskDocument(doc) {
  try {
    const h = (doc.location?.hostname || "").toLowerCase();
    return h === "billdesk.com" || h.endsWith(".billdesk.com");
  } catch (_) {
    return false;
  }
}

function payLog(msg, level = "ROUTE") {
  appendRunLog(msg, level);
  try {
    ipcRenderer.send("dda:log", {
      level: level === "ROUTE" ? "INFO" : level,
      page: "Payment",
      pan: currentApplicant?.pan || "",
      msg,
    });
  } catch (_) {}
}

// Stop the gateway flow for this payment and disarm it in main, so neither
// this page nor a reload will fill, pick a bank or click Pay again.
function endGatewayFlow(step, msg, level = "WARN") {
  if (GATEWAY_DONE_STEPS.includes(lastFastPaymentStep)) return;
  lastFastPaymentStep = step;
  gatewayCard = null;
  gatewayPlan = null;
  try { ipcRenderer.send("payment:submitted"); } catch (_) {}
  if (msg) payLog(msg, level);
}

// ─── Shadow DOM reach ───
// BillDesk Embedded SDK v2 (billdesksdk.esm.js) renders web components, so
// card fields can sit inside (open) shadow roots that document.querySelector
// never sees. Every lookup below runs over the document plus all open shadow
// roots under it.
function collectSearchRoots(doc) {
  const roots = [doc];
  for (let i = 0; i < roots.length; i++) {
    let all;
    try { all = roots[i].querySelectorAll("*"); } catch (_) { continue; }
    for (const el of all) if (el.shadowRoot) roots.push(el.shadowRoot);
  }
  return roots;
}

// BillDesk documents, including frames that sit inside shadow roots.
function getBillDeskDocs() {
  const docs = getAllPaymentDocuments();
  for (let i = 0; i < docs.length; i++) {
    for (const root of collectSearchRoots(docs[i]).slice(1)) {
      for (const ifr of root.querySelectorAll("iframe, frame")) {
        try {
          const d = ifr.contentDocument;
          if (d && !docs.includes(d)) docs.push(d);
        } catch (_) {}
      }
    }
  }
  return docs.filter(isBillDeskDocument);
}

function deepQueryAll(roots, sel) {
  const out = [];
  for (const r of roots) {
    try { r.querySelectorAll(sel).forEach((e) => out.push(e)); } catch (_) {}
  }
  return out;
}

// Any real (trusted) user edit or click on the BillDesk page hands control to
// the user. Our own fills dispatch untrusted events and are ignored.
function watchForUserTakeover(doc) {
  if (watchedPaymentDocs.has(doc)) return;
  watchedPaymentDocs.add(doc);
  const onUser = (e) => {
    if (!e.isTrusted || !gatewayPlan) return;
    // Events from inside shadow roots are retargeted to the host element;
    // composedPath()[0] is the real input/button.
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    const isField = !!t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || "");
    // Bank tiles and the payment-method list are often plain divs/labels.
    const isControl = !!t?.closest?.(
      "button, input, select, textarea, a, label, li, [tabindex], [role='button'], [role='tab'], [role='radio'], [role='option'], [role='navigation']",
    );
    if (e.type === "mousedown" ? !isControl : !isField) return;
    if (gatewayPlan.method === "netbanking") {
      endGatewayFlow(
        "nb_user_took_over",
        "✋ [Fast Payment] You're using the BillDesk page — automation stopped for this payment. Pick your bank and click Pay yourself.",
      );
      return;
    }
    endGatewayFlow(
      "card_user_took_over",
      "✋ [Fast Payment] You're using the BillDesk form — automation stopped for this payment. Check the card details and click Pay yourself.",
    );
  };
  for (const type of ["keydown", "paste", "mousedown"]) {
    doc.addEventListener(type, onUser, true);
  }
}

function findCardTab(roots) {
  const candidates = deepQueryAll(
    roots,
    // BillDesk SDK v2 uses <div role="navigation"> for "Credit / Debit Cards"
    'button, a, li, [role="tab"], [role="button"], [role="navigation"], label',
  );
  for (const el of candidates) {
    if (!isShown(el)) continue;
    const t = String(el.textContent || "").trim().toLowerCase();
    if (!t || t.length > 40) continue;
    if (t.includes("net banking") || t.includes("netbanking") || t.includes("upi") || t.includes("wallet")) continue;
    if (/\b(debit|credit)\b/.test(t) || /\bcards?\b/.test(t)) return el;
  }
  return null;
}

// Rendered on screen (hidden tab panels and display:none ancestors fail).
function isShown(el) {
  return !!el && el.getClientRects().length > 0;
}

function findCardPayButton(cardInput, roots) {
  const form = cardInput?.closest("form");
  const btns = deepQueryAll(form ? [form] : roots, 'button, input[type="submit"], [role="button"]');
  for (const b of btns) {
    const t = String(b.textContent || b.value || "").trim().toLowerCase();
    if (!t || t.length > 40) continue;
    if (/cancel|back|change/.test(t)) continue;
    if (/\bpay\b|make payment|proceed|submit/.test(t) && isShown(b)) return b;
  }
  return null;
}

// First visible match across all BillDesk documents and their shadow roots
// (fields may sit in different frames or components). Selector order wins.
function findShownField(roots, selectors) {
  for (const sel of selectors) {
    for (const el of deepQueryAll(roots, sel)) {
      const input = /^(INPUT|SELECT)$/.test(el.tagName)
        ? el
        : el.querySelector('input:not([type="hidden"]), select');
      if (input && input.type !== "hidden" && isShown(input)) return input;
    }
  }
  return null;
}

// Fallback when selectors miss: the next visible text-like inputs after the
// card number in on-screen reading order (expiry first, then CVV), within the
// following three inputs only. Screen order works across shadow roots, where
// DOM order does not.
function guessExpiryAndCvv(cardNum, nameInput, have, roots) {
  const inputs = deepQueryAll(roots, "input")
    .filter((i) => isShown(i) && !/^(hidden|checkbox|radio|submit|button)$/i.test(i.type) && i !== nameInput)
    .filter((i) => i.ownerDocument === cardNum.ownerDocument)
    .map((i) => ({ i, r: i.getBoundingClientRect() }))
    .sort((a, b) => (Math.abs(a.r.top - b.r.top) > 8 ? a.r.top - b.r.top : a.r.left - b.r.left))
    .map((x) => x.i);
  const at = inputs.indexOf(cardNum);
  const after = at < 0 ? [] : inputs.slice(at + 1, at + 4);
  let expiry = have.expiry;
  let cvv = have.cvv;
  for (const i of after) {
    if (i === expiry || i === cvv) continue;
    const ml = i.maxLength > 0 ? i.maxLength : 0;
    if (!cvv && (i.type === "password" || (ml >= 3 && ml <= 4 && expiry))) { cvv = i; continue; }
    if (!expiry && i.type !== "password" && (!ml || (ml >= 4 && ml <= 9))) { expiry = i; continue; }
  }
  return { expiry, cvv };
}

function getCardFields(roots) {
  const cardNum = findShownField(roots, PAYMENT_CARD_NUM_SELECTORS);
  if (!cardNum) return { cardNum: null };
  const f = {
    cardNum,
    expiry: findShownField(roots, PAYMENT_EXPIRY_SELECTORS),
    expMonth: findShownField(roots, PAYMENT_EXP_MONTH_SELECTORS),
    expYear: findShownField(roots, PAYMENT_EXP_YEAR_SELECTORS),
    cvv: findShownField(roots, PAYMENT_CVV_SELECTORS),
    name: findShownField(roots, PAYMENT_NAME_SELECTORS),
  };
  // Never treat the card number box as expiry/CVV.
  for (const k of ["expiry", "expMonth", "expYear", "cvv", "name"]) if (f[k] === cardNum) f[k] = null;
  if (f.expMonth && f.expYear) f.expiry = null;
  if ((!f.expiry && !(f.expMonth && f.expYear)) || !f.cvv) {
    const g = guessExpiryAndCvv(cardNum, f.name, { expiry: f.expMonth && f.expYear ? f.expMonth : f.expiry, cvv: f.cvv }, roots);
    if (!(f.expMonth && f.expYear)) f.expiry = g.expiry;
    f.cvv = g.cvv;
    if (f.cvv === f.expiry) f.cvv = null;
  }
  return f;
}

// Expiry text shaped to what the box accepts. maxlength wins over the
// placeholder: BillDesk shows "MM / YY" but caps the field at 5 characters.
function expiryTextFor(el, card) {
  const mm = card.expMonth;
  const yy = card.expYear;
  const ph = String(el.placeholder || "");
  const ml = el.maxLength > 0 ? el.maxLength : 0;
  if (ml === 4) return `${mm}${yy}`;
  if (ml === 5) return `${mm}/${yy}`;
  if (/yyyy/i.test(ph)) return ph.includes(" / ") && (!ml || ml >= 9) ? `${mm} / 20${yy}` : `${mm}/20${yy}`;
  if (ph.includes(" / ") && (!ml || ml >= 7)) return `${mm} / ${yy}`;
  return `${mm}/${yy}`;
}

// Type like a person: one character at a time with key + input events, so
// per-keystroke formatters (card spacing, MM/YY slash) run as they would for
// a user. Our events are untrusted, so they never trip the takeover watcher.
function typeIntoField(el, text, { blur = true } = {}) {
  if (el.tagName === "SELECT") {
    setSelectDropdown(el, text);
    return;
  }
  const win = el.ownerDocument?.defaultView || window;
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")?.set;
  const setVal = (v) => {
    if (setter) setter.call(el, v);
    else el.value = v;
  };
  const max = el.maxLength > 0 ? el.maxLength : Infinity;
  try { el.focus(); } catch (_) {}
  setVal("");
  el.dispatchEvent(new win.InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  for (const ch of String(text)) {
    el.dispatchEvent(new win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: ch }));
    el.dispatchEvent(new win.KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: ch, charCode: ch.charCodeAt(0) }));
    const cur = String(el.value || "");
    if (cur.length >= max) break;
    setVal(cur + ch);
    el.dispatchEvent(new win.InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
    el.dispatchEvent(new win.KeyboardEvent("keyup", { bubbles: true, key: ch }));
  }
  el.dispatchEvent(new win.Event("change", { bubbles: true }));
  if (blur) {
    try { el.blur(); } catch (_) {}
  }
}

// Expiry: type the digits and let the page's mask add the separator; if no
// mask did (or the result is wrong), type the formatted text instead.
function typeExpiry(el, card) {
  typeIntoField(el, `${card.expMonth}${card.expYear}`);
  const v = String(el.value || "");
  const ml = el.maxLength > 0 ? el.maxLength : 0;
  if (!expiryMatches(el, card) || (!/\D/.test(v) && ml !== 4)) {
    typeIntoField(el, expiryTextFor(el, card));
  }
}

function expiryMatches(el, card) {
  const d = String(el?.value || "").replace(/\D/g, "");
  return d === `${card.expMonth}${card.expYear}` || d === `${card.expMonth}20${card.expYear}`;
}

const cardFieldChecks = {
  cardNum: (el, c) => String(el.value || "").replace(/\D/g, "") === c.cardNumber,
  expiry: (el, c) => expiryMatches(el, c),
  expMonth: (el, c) => Number(String(el.value || "").replace(/\D/g, "")) === Number(c.expMonth),
  expYear: (el, c) => String(el.value || "").replace(/\D/g, "").slice(-2) === c.expYear,
  cvv: (el, c) => String(el.value || "").trim() === c.cvv,
  name: (el, c) => String(el.value || "").trim().toUpperCase() === c.cardHolderName.toUpperCase(),
};

function cardFieldValue(key, el, c) {
  if (key === "cardNum") return c.cardNumber;
  if (key === "expiry") return expiryTextFor(el, c);
  if (key === "expMonth") return c.expMonth;
  if (key === "expYear") return el.tagName === "SELECT" || /yyyy/i.test(el.placeholder || "") ? "20" + c.expYear : c.expYear;
  if (key === "cvv") return c.cvv;
  return c.cardHolderName;
}

// One field per call, in form order, with a pause between fields so the page
// can react (BillDesk resets expiry/CVV when the card number changes, so
// writing everything in the same instant lost them). A field that does not
// hold the right value is (re)typed, at most a few times per element.
function fillCardFields(f, card) {
  if (Date.now() - lastCardFieldWriteAt < CARD_FIELD_SETTLE_MS) return;
  for (const key of ["cardNum", "expiry", "expMonth", "expYear", "cvv", "name"]) {
    const el = f[key];
    if (key === "cvv" && !card.cvv) continue; // the applicant's card: the CVV is typed by the user
    if (!el || cardFieldChecks[key](el, card)) continue;
    const n = cardFieldFillCounts.get(el) || 0;
    if (n >= CARD_FIELD_MAX_WRITES) continue;
    cardFieldFillCounts.set(el, n + 1);
    if (key === "expiry") typeExpiry(el, card);
    else typeIntoField(el, cardFieldValue(key, el, card));
    lastCardFieldWriteAt = Date.now();
    return;
  }
}

// Number, expiry and CVV must be present and correct; the name too whenever
// the form has a name box (BillDesk keeps Pay disabled without it).
function cardFieldsComplete(f, card) {
  if (!f.cardNum || !cardFieldChecks.cardNum(f.cardNum, card)) return false;
  const expOk = f.expMonth && f.expYear
    ? cardFieldChecks.expMonth(f.expMonth, card) && cardFieldChecks.expYear(f.expYear, card)
    : !!f.expiry && cardFieldChecks.expiry(f.expiry, card);
  const nameOk = !f.name || cardFieldChecks.name(f.name, card);
  const cvvOk = !card.cvv || (!!f.cvv && cardFieldChecks.cvv(f.cvv, card));
  return expOk && cvvOk && nameOk;
}

// Field shapes only (never values) so the selectors can be fixed from a log.
function describeCardForm(docs, f) {
  const parts = [];
  for (const d of docs) {
    const roots = collectSearchRoots(d);
    if (roots.length > 1) parts.push(`shadowRoots=${roots.length - 1}`);
    for (const el of deepQueryAll(roots, "input, select")) {
      if (el.type === "hidden" || !isShown(el)) continue;
      const a = (k, v) => (v ? `${k}=${String(v).slice(0, 24)}` : "");
      parts.push(
        [el.tagName.toLowerCase(), a("type", el.type), a("name", el.name), a("id", el.id),
          a("ph", el.placeholder), a("ml", el.maxLength > 0 ? el.maxLength : ""),
          a("ac", el.autocomplete), a("aria", el.getAttribute("aria-label"))]
          .filter(Boolean).join(" "),
      );
    }
    for (const ifr of d.querySelectorAll("iframe")) {
      let host = "";
      try { host = new URL(ifr.src, d.location.href).hostname; } catch (_) {}
      parts.push(`iframe ${host || "(inline)"}`);
    }
  }
  const found = ["expiry", "expMonth", "expYear", "cvv", "name"].filter((k) => f[k]).join(",") || "none";
  return `found=[${found}] fields: ${parts.slice(0, 20).join(" | ")}`;
}

// ─── Gateway dispatcher ───
// One plan per page load, from main, only while this payment is armed. The
// page decides the flow from where it is:
//   SBI-hosted page → net banking always (SBI's gateway has nothing else):
//                     SBI's chooser (SBI Net Banking / Other Bank Net Banking),
//                     then BillDesk inside SBI's page (runBillDeskNetBankingFlow)
//   CBI's BillDesk  → the sidebar's method: card (runBillDeskCardFlow) or
//                     net banking (runBillDeskNetBankingFlow)
// Returns true while it owns the page; false lets the OTP / gateway checks run.
function runGatewayAutomation() {
  if (GATEWAY_DONE_STEPS.includes(lastFastPaymentStep)) return false;

  const onSbiChooser = isSbiChooserPage();
  const docs = onSbiChooser ? [] : getBillDeskDocs();
  if (!onSbiChooser && !docs.length) return false;

  if (!gatewayPlanRequested) {
    gatewayPlanRequested = true;
    ipcRenderer
      .invoke("payment:getGatewayPlan")
      .then((plan) => {
        if (plan?.submitted) {
          // This payment was already handed over; never fill/submit again.
          lastFastPaymentStep = "gateway_already_submitted";
          payLog("🏦 [Fast Payment] This payment was already handed over on the gateway — nothing more to automate.", "WARN");
        } else {
          gatewayPlan = plan || null;
          if (gatewayPlan && /sbi/i.test(window.location.hostname || "")) {
            gatewayPlan.method = "netbanking";
          }
          gatewayCard = gatewayPlan?.method === "card" && plan.card?.cardNumber ? plan.card : null;
          if (gatewayPlan) {
            const what = gatewayPlan.method === "card"
              ? `card${gatewayCard ? ` ending ${gatewayCard.cardNumber.slice(-4)}` : " (none saved)"}`
              : `net banking — ${gatewayPlan.bank?.name || "no bank chosen"}`;
            payLog(`🏦 [Fast Payment] Gateway page (${window.location.hostname}): ${what}.`);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        gatewayPlanLoaded = true;
      });
  }
  if (!gatewayPlanLoaded) return true;
  if (GATEWAY_DONE_STEPS.includes(lastFastPaymentStep)) return false;

  if (!gatewayPlan || (gatewayPlan.method === "card" && !gatewayCard)) {
    if (!gatewayPlanMissingAnnounced) {
      gatewayPlanMissingAnnounced = true;
      if (isFastPaymentEnabled()) {
        payLog(
          gatewayPlan
            ? (gatewayPlan.cardNote
              ? `💳 [Fast Payment] No card filled (${gatewayPlan.cardNote}) — enter the card on BillDesk yourself, or fix the card in the sidebar's Fast Payment for the next payment.`
              : "💳 [Fast Payment] No saved card — complete the payment manually.")
            : "💳 [Fast Payment] This payment was not armed (FAST PAY did not leave DDA for this gateway, or it was more than 20 min ago) — complete it manually.",
          "WARN",
        );
      }
    }
    gatewayPlan = null;
    return false;
  }

  if (onSbiChooser) return runSbiChooserFlow();
  if (gatewayPlan.method === "netbanking") return runBillDeskNetBankingFlow(docs);
  return runBillDeskCardFlow(docs);
}

// ─── SBI gateway: SBI's own "SBI Net Banking / Other Bank Net Banking" page ───
// (merchant.onlinesbi.sbi, form frmFeeParams). SBI → SBI's net-banking login,
// where the user logs in; any other bank → BillDesk's net-banking page.
function isSbiChooserPage() {
  if (!/sbi/i.test(window.location.hostname || "")) return false;
  return !!(
    document.querySelector('form[name="frmFeeParams"]') &&
    document.querySelector("[onclick*=\"paySubmit('SBINet')\"], [onclick*=\"paySubmit('OTHERINB')\"]")
  );
}

let sbiChooserSeenAt = 0;
let sbiChoiceClicked = false;
function runSbiChooserFlow() {
  // Chosen on this page load: SBI is navigating away; hold the page till then.
  if (sbiChoiceClicked) return true;
  const bank = gatewayPlan.bank;
  if (!bank) {
    endGatewayFlow("nb_handed_over", "🏦 [Fast Payment] No net-banking bank chosen in Fast Payment — pick SBI or Other Bank Net Banking yourself.");
    return false;
  }
  // A reload / Back onto this page after we already chose for THIS armed
  // payment: leave it alone. (The flag lives as long as the tab, so it is
  // keyed to the arm; a new FAST PAY run chooses again.)
  const choiceKey = `${gatewayPlan.armedAt || ""}`;
  try {
    if (choiceKey && sessionStorage.getItem("dda_fp_sbi_choice") === choiceKey) {
      endGatewayFlow("nb_handed_over", "🏦 [Fast Payment] Already chose on SBI's page for this payment — continue on the page yourself.");
      return false;
    }
  } catch (_) {}

  const wantSbi = bank.id === "statebankofindia";
  const code = wantSbi ? "SBINet" : "OTHERINB";
  const link =
    document.querySelector(`a[aria-label="${wantSbi ? "SBI Net Banking" : "Other Bank Net Banking"}"]`) ||
    document.querySelector(`[onclick*="paySubmit('${code}')"]`);
  if (!sbiChooserSeenAt) sbiChooserSeenAt = Date.now();
  if (!link) {
    if (Date.now() - sbiChooserSeenAt > 8000) {
      endGatewayFlow("nb_handed_over", "🏦 [Fast Payment] Could not find the net-banking option on SBI's page — choose it yourself.");
      return false;
    }
    return true;
  }

  try { sessionStorage.setItem("dda_fp_sbi_choice", choiceKey); } catch (_) {}
  sbiChoiceClicked = true;
  if (wantSbi) {
    endGatewayFlow(
      "nb_pay_submitted",
      "🏦 [Fast Payment] Opening SBI Net Banking — log in on SBI's page to authorise the payment.",
      "SUCCESS",
    );
  } else {
    lastFastPaymentStep = "sbi_other_bank_chosen";
    payLog(`🏦 [Fast Payment] SBI gateway: choosing Other Bank Net Banking for ${bank.name}...`);
  }
  link.click();
  return true;
}

// ─── BillDesk Net Banking ───
// Opens the Net Banking tab, picks the chosen bank (logo id, name, the bank
// list's search box or a <select>), then clicks Pay once — but only when the
// pick visibly took (tile marked selected, or Pay became enabled by it).
// Otherwise it leaves the bank picked and hands Pay to the user.
let nbStartedAt = 0;
let nbTabClicks = 0;
let nbTabClickedAt = 0;
let nbSearchTyped = false;
let nbAllBanksOpenedAt = 0;
let nbBankEl = null;
let nbBankClickedAt = 0;
let nbPayWasReady = false;
const NB_FIND_TIMEOUT_MS = 12000;
const NB_PAY_ENABLE_TIMEOUT_MS = 5000;
// Bank labels are compared exactly (BillDesk's own names, e.g. "Axis Bank
// [Retail]" vs "Axis Bank [Corporate]"), only case and spacing are ignored.
function normBankLabel(t) {
  return String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// The bank's name as shown on a row/tile: BillDesk puts it in a <p>, with an
// optional "Unavailable at the moment" note beside it.
function bankLabelOf(el) {
  const p = el.querySelector?.("p");
  const raw = p ? p.textContent : el.textContent || el.getAttribute?.("aria-label") || el.getAttribute?.("title") || "";
  return normBankLabel(String(raw).replace(/unavailable at the moment/i, ""));
}

function isNbExcluded(el) {
  return !!el.closest?.('form[name="cardpayment"], [role="navigation"], nav, header, footer');
}

function clickableFor(el) {
  const c = el.closest?.('button, [role="button"], [role="radio"], [role="option"], label, li, a, [tabindex]');
  if (c && String(c.textContent || "").trim().length <= 90) return c;
  let p = el;
  for (let i = 0; i < 5 && p; i++) {
    if (/cursor-pointer/.test(String(p.className?.baseVal ?? p.className ?? ""))) return p;
    p = p.parentElement;
  }
  return el.parentElement || el;
}

function findNetBankingTab(roots) {
  const candidates = deepQueryAll(roots, 'button, a, li, [role="tab"], [role="button"], [role="navigation"], label');
  for (const el of candidates) {
    if (!isShown(el)) continue;
    const t = String(el.textContent || "").trim().toLowerCase();
    if (t && t.length <= 40 && /net\s?banking/.test(t)) return el;
  }
  return null;
}

// { el, viaSelect } for the chosen bank on screen, or null. Matches, in
// order: BillDesk's row name attribute, its logo id, the exact label.
function findBankOption(roots, bank) {
  const usable = (el) => el && isShown(el) && !isNbExcluded(el);
  const want = normBankLabel(bank.name);
  // 1. All-banks rows carry name="<bank id>" (e.g. name="centralbankofindia").
  for (const el of deepQueryAll(roots, `button[name="${bank.id}"], [role="button"][name="${bank.id}"], li[name="${bank.id}"]`)) {
    if (usable(el)) return { el };
  }
  // 2. Logo: <use xlink:href="#bankid-SBI">, unique per retail/corporate entry.
  if (bank.code) {
    for (const u of deepQueryAll(roots, "use")) {
      const href = u.getAttribute("href") || u.getAttribute("xlink:href") || "";
      if (href !== `#bankid-${bank.code}`) continue;
      const el = clickableFor(u);
      if (usable(el)) return { el };
    }
  }
  // 3. A <select> of banks.
  for (const sel of deepQueryAll(roots, "select")) {
    if (!usable(sel)) continue;
    for (const opt of sel.options || []) {
      if (normBankLabel(opt.text) === want) return { el: sel, viaSelect: opt };
    }
  }
  // 4. A tile / row / radio label with exactly the bank's name.
  const candidates = deepQueryAll(
    roots,
    'button, [role="button"], [role="radio"], [role="option"], label, li, a, [tabindex], [class*="cursor-pointer"]',
  );
  for (const el of candidates) {
    if (usable(el) && bankLabelOf(el) === want) return { el };
  }
  return null;
}

// A net-banking bank list is on screen (any bank logo / row / labelled tile).
function isNetBankingListShown(roots) {
  if (deepQueryAll(roots, '[name="netbankingpage"]').some(isShown)) return true;
  for (const u of deepQueryAll(roots, "use")) {
    const href = u.getAttribute("href") || u.getAttribute("xlink:href") || "";
    if (href.startsWith("#bankid-") && isShown(u.closest("svg") || u)) return true;
  }
  return deepQueryAll(roots, "label, button, [role='radio'], p").some(
    (el) => isShown(el) && /\[(retail|corporate)\]\s*$/i.test(String(el.textContent || "").trim()),
  );
}

function findBankSearch(roots) {
  for (const el of deepQueryAll(roots, 'input[type="text"], input[type="search"], input:not([type])')) {
    if (!isShown(el) || isNbExcluded(el)) continue;
    const hint = `${el.placeholder || ""} ${el.getAttribute("aria-label") || ""} ${el.id || ""} ${el.name || ""}`;
    if (/search|bank/i.test(hint)) return el;
  }
  return null;
}

// Compact layouts show only the top banks plus a control that opens the rest.
function findAllBanksTrigger(roots) {
  for (const el of deepQueryAll(roots, 'button, a, [role="button"], [role="combobox"], [tabindex], label')) {
    if (!isShown(el) || isNbExcluded(el)) continue;
    const t = String(el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim();
    if (!t || t.length > 40) continue;
    if (/(all|other|more)\s+banks?|view\s+all|see\s+all|show\s+all|(select|choose)\s+(your\s+|a\s+|other\s+)?bank/i.test(t)) return el;
  }
  return null;
}

function findNetBankingPayButton(roots) {
  for (const b of deepQueryAll(roots, 'button, input[type="submit"], [role="button"]')) {
    if (!isShown(b) || b.closest?.('form[name="cardpayment"], [role="navigation"]')) continue;
    const t = String(b.textContent || b.value || "").trim().toLowerCase();
    if (!t || t.length > 40 || /cancel|back|change/.test(t)) continue;
    if (/\bpay\b|make payment|proceed/.test(t)) return b;
  }
  return null;
}

function isButtonReady(b) {
  return !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true";
}

function bankLooksSelected(el) {
  if (!el) return false;
  if (el.tagName === "SELECT") return true;
  if (el.querySelector?.('input[type="radio"]:checked, input[type="checkbox"]:checked')) return true;
  // <label for="radio-id"> rows: the radio sits elsewhere.
  const forId = el.getAttribute?.("for");
  if (forId && el.ownerDocument?.getElementById(forId)?.checked) return true;
  for (let p = el, i = 0; p && i < 3; p = p.parentElement, i++) {
    for (const a of ["aria-checked", "aria-selected", "aria-pressed"]) {
      if (p.getAttribute?.(a) === "true") return true;
    }
    if (p.getAttribute?.("data-state") === "checked") return true;
    if (/(^|\s)(selected|active|checked|is-selected|is-active)(\s|$)/.test(String(p.className?.baseVal ?? p.className ?? ""))) return true;
  }
  return false;
}

function describeNetBankingPage(roots) {
  const parts = [];
  for (const el of deepQueryAll(roots, 'button, [role="button"], [role="radio"], [role="option"], label, li, [tabindex], select, input:not([type="hidden"])')) {
    if (!isShown(el) || isNbExcluded(el)) continue;
    const t = String(el.textContent || el.placeholder || el.name || "").trim().replace(/\s+/g, " ").slice(0, 30);
    parts.push(`${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""}:${t}`);
    if (parts.length >= 25) break;
  }
  const uses = [...new Set(deepQueryAll(roots, "use").map((u) => u.getAttribute("href") || u.getAttribute("xlink:href") || "").filter((h) => h.startsWith("#bankid-")))];
  return `elements: ${parts.join(" | ") || "none"}; bank logos: ${uses.slice(0, 15).join(",") || "none"}`;
}

function runBillDeskNetBankingFlow(docs) {
  const bank = gatewayPlan.bank;
  if (!bank) {
    endGatewayFlow("nb_handed_over", "🏦 [Fast Payment] No net-banking bank chosen in Fast Payment — pick your bank on BillDesk and click Pay.");
    return false;
  }
  docs.forEach(watchForUserTakeover);
  const roots = docs.flatMap(collectSearchRoots);
  const now = Date.now();
  if (!nbStartedAt) nbStartedAt = now;

  // Step 1: find and pick the bank.
  if (!nbBankClickedAt) {
    const option = findBankOption(roots, bank);
    if (!option) {
      // Open Net Banking only while no bank list is on screen: in the compact
      // layout the header toggles, so clicking it again would close the list.
      if (!isNetBankingListShown(roots)) {
        const tab = findNetBankingTab(roots);
        if (tab && nbTabClicks < 3 && now - nbTabClickedAt > 2500) {
          nbTabClicks++;
          nbTabClickedAt = now;
          payLog("🏦 [Fast Payment] Opening BillDesk Net Banking...");
          tab.click();
          return true;
        }
      } else if (now - nbTabClickedAt > 600 && now - nbAllBanksOpenedAt > 800) {
        // The list shows only some banks: search it, or open "all banks".
        const search = findBankSearch(roots);
        if (search && !nbSearchTyped) {
          nbSearchTyped = true;
          const query = bank.name.replace(/\s*\[[^\]]*\]\s*$/, "");
          payLog(`🏦 [Fast Payment] Searching BillDesk for ${query}...`);
          typeIntoField(search, query, { blur: false });
          return true;
        }
        const allBanks = !nbAllBanksOpenedAt && findAllBanksTrigger(roots);
        if (allBanks) {
          nbAllBanksOpenedAt = now;
          payLog(`🏦 [Fast Payment] Opening BillDesk's full bank list ("${String(allBanks.textContent || "").trim().slice(0, 30)}")...`);
          allBanks.click();
          return true;
        }
      }
      if (now - nbStartedAt > NB_FIND_TIMEOUT_MS) {
        payLog(`🏦 [Fast Payment] Net banking layout: ${describeNetBankingPage(roots)}`, "WARN");
        endGatewayFlow("nb_handed_over", `🏦 [Fast Payment] Could not find ${bank.name} on BillDesk — pick your bank and click Pay yourself.`);
        return false;
      }
      return true;
    }

    if (/unavailable/i.test(option.el.textContent || "")) {
      endGatewayFlow("nb_handed_over", `🏦 [Fast Payment] BillDesk shows ${bank.name} as unavailable right now — pick another bank or payment method yourself.`);
      return false;
    }
    const payBefore = findNetBankingPayButton(roots);
    nbPayWasReady = isButtonReady(payBefore);
    nbBankEl = option.el;
    nbBankClickedAt = now;
    payLog(`🏦 [Fast Payment] Selecting ${bank.name}...`);
    if (option.viaSelect) {
      setSelectDropdown(option.el, option.viaSelect.value || option.viaSelect.text);
      return true;
    }
    if (!payBefore) {
      // No Pay button on the panel: on such layouts the bank tile itself
      // continues to the bank. That is the one submit for this payment.
      endGatewayFlow(
        "nb_pay_submitted",
        `🏦 [Fast Payment] Chose ${bank.name} — BillDesk is opening its net-banking login. Log in there to authorise.`,
        "SUCCESS",
      );
      notePaySubmitted(null, docs);
    }
    option.el.click();
    const radio = option.el.querySelector?.('input[type="radio"]');
    if (radio && !radio.checked) radio.click();
    return true;
  }

  // Step 2: Pay, once, only when the pick visibly took.
  if (now - nbBankClickedAt < 600) return true;
  const pay = findNetBankingPayButton(roots);
  const ready = isButtonReady(pay);
  const picked = bankLooksSelected(nbBankEl) || (ready && !nbPayWasReady);
  if (ready && picked) {
    endGatewayFlow(
      "nb_pay_submitted",
      `🏦 [Fast Payment] Paying with ${bank.name} net banking — log in on your bank's page to authorise.`,
      "SUCCESS",
    );
    notePaySubmitted(pay, docs);
    pay.click();
    return true;
  }
  if (now - nbBankClickedAt > NB_PAY_ENABLE_TIMEOUT_MS) {
    payLog(`🏦 [Fast Payment] Net banking layout: ${describeNetBankingPage(roots)}`, "WARN");
    endGatewayFlow("nb_handed_over", `🏦 [Fast Payment] Picked ${bank.name} on BillDesk — check it's selected and click Pay yourself.`);
    return false;
  }
  return true;
}

// BillDesk card form. Returns true while it owns the page.
function runBillDeskCardFlow(docs) {
  const card = gatewayCard;
  docs.forEach(watchForUserTakeover);
  const roots = docs.flatMap(collectSearchRoots);
  const f = getCardFields(roots);

  // Switch to the card tab; give it time to render before retrying.
  if (!f.cardNum) {
    if (Date.now() - cardTabClickedAt > 1500) {
      const tab = findCardTab(roots);
      if (tab) {
        cardTabClickedAt = Date.now();
        payLog("💳 [Fast Payment] Opening BillDesk card tab...");
        tab.click();
      }
    }
    return true;
  }

  // Phase 1: fill until number + expiry + CVV all verify. Expiry/CVV may only
  // appear after the number is entered, so keep looking until the timeout.
  if (!cardFilledAt) {
    if (!cardFillStartedAt) cardFillStartedAt = Date.now();
    fillCardFields(f, card);
    if (cardFieldsComplete(f, card) && !card.cvv) {
      // No CVV is ever saved for the applicant's card: everything else is
      // filled, the user types the CVV and clicks Pay
      try { f.cvv?.focus(); } catch (_) {}
      endGatewayFlow(
        "card_handed_over",
        `💳 [Fast Payment] Card ending ${card.cardNumber.slice(-4)} filled (number, expiry, name) — type the CVV and click Pay.`,
        "SUCCESS",
      );
      return false;
    }
    if (cardFieldsComplete(f, card)) {
      cardFilledAt = Date.now();
      if (!cardFilledLogged) {
        cardFilledLogged = true;
        payLog(`💳 [Fast Payment] Card details filled — number, expiry, CVV (card ending ${card.cardNumber.slice(-4)}).`, "SUCCESS");
      }
    } else if (Date.now() - cardFillStartedAt > CARD_FILL_TIMEOUT_MS) {
      payLog(`💳 [Fast Payment] Card form layout: ${describeCardForm(docs, f)}`, "WARN");
      endGatewayFlow(
        "card_handed_over",
        "💳 [Fast Payment] Could not fill every card field on BillDesk — complete the missing details and click Pay yourself.",
      );
      return false;
    }
    return true; // let the form validate before looking for Pay
  }

  // Phase 2: no more writes; click Pay once if it enables and the fields
  // still hold exactly the saved card. Wait out the page's own reaction to
  // the last field (e.g. a card-number reset of expiry/CVV) before judging.
  if (Date.now() - cardFilledAt < 800) return true;
  if (!cardFieldsComplete(f, card)) {
    // The page cleared/changed a field on its own (user edits end the flow
    // in watchForUserTakeover before this). Go back to filling; the per-field
    // write cap and CARD_FILL_TIMEOUT_MS bound it.
    cardFilledAt = 0;
    return true;
  }
  const payBtn = findCardPayButton(f.cardNum, roots);
  const payReady = payBtn && !payBtn.disabled && payBtn.getAttribute("aria-disabled") !== "true";
  if (!payReady) {
    if (Date.now() - cardFilledAt > CARD_PAY_ENABLE_TIMEOUT_MS) {
      payLog(`💳 [Fast Payment] Card form layout: ${describeCardForm(docs, f)}`, "WARN");
      endGatewayFlow(
        "card_handed_over",
        "💳 [Fast Payment] BillDesk did not accept the card details (Pay stayed disabled) — correct them on the page and click Pay yourself.",
      );
      return false;
    }
    return true;
  }

  // One click per armed payment: latch and disarm in main before clicking,
  // so neither a re-tick nor a page reload can submit twice.
  endGatewayFlow(
    "card_pay_submitted",
    "💳 [Fast Payment] Submitting card payment — the bank will send the OTP. Enter it to authorise. If BillDesk rejects the card, correct the details and click Pay yourself.",
    "SUCCESS",
  );
  notePaySubmitted(payBtn, docs);
  payBtn.click();
  return true;
}

// ─── BillDesk "Convenience Fee" confirmation ───
// After our Pay click BillDesk shows a sheet with the transaction amount, the
// convenience fee + GST and a second "Pay ₹<total>" button
// (button[name="proceedBtn"]; Cancel is name="cancelBtn").
// Card payments stop here: the card fee is large (1.5% + GST), so the user
// confirms it. For net banking Fast Payment
// clicks it once, only within FEE_CONFIRM_WINDOW_MS of its own Pay click,
// only if the user has not touched the page since, and only if the sheet's
// transaction amount equals the amount on the Pay button it clicked.
const FEE_CONFIRM_WINDOW_MS = 20000;
let paySubmittedAt = 0;
let paySubmittedAmount = null;
let feeConfirmDone = false;
let userActedAfterPay = false;

function parseRupees(text) {
  const m = String(text || "").replace(/,/g, "").match(/₹\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function notePaySubmitted(payBtn, docs) {
  paySubmittedAt = Date.now();
  paySubmittedAmount = parseRupees(payBtn?.textContent || payBtn?.value);
  const onUser = (e) => {
    if (e.isTrusted) userActedAfterPay = true;
  };
  for (const d of docs || []) {
    for (const type of ["keydown", "mousedown", "paste"]) {
      try { d.addEventListener(type, onUser, true); } catch (_) {}
    }
  }
}

// true while it owns the page (dialog handled this tick); false otherwise so
// the OTP / gateway checks still run.
function runFeeConfirmation() {
  if (!paySubmittedAt || feeConfirmDone) return false;
  if (lastFastPaymentStep !== "card_pay_submitted" && lastFastPaymentStep !== "nb_pay_submitted") return false;
  if (userActedAfterPay || Date.now() - paySubmittedAt > FEE_CONFIRM_WINDOW_MS) {
    feeConfirmDone = true;
    return false;
  }
  const docs = getBillDeskDocs();
  if (!docs.length) return false;
  const roots = docs.flatMap(collectSearchRoots);
  const btn = deepQueryAll(roots, 'button[name="proceedBtn"]')
    .find((b) => isShown(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");
  if (!btn) return false;

  feeConfirmDone = true;
  const sheet = btn.closest(".bottom-sheet-container") || btn.closest('[class*="z-["]') || btn.parentElement?.parentElement?.parentElement;
  const text = String(sheet?.textContent || "");
  if (!/convenience fee/i.test(text)) {
    payLog("🧾 [Fast Payment] BillDesk asked for a confirmation Fast Payment does not recognise — check it and continue yourself.", "WARN");
    return false;
  }
  const row = [...(sheet?.querySelectorAll("div, span") || [])]
    .find((el) => /^\s*Transaction amount/i.test(el.textContent || "") && /₹/.test(el.textContent || ""));
  const txnAmount = parseRupees(row?.textContent);
  if (paySubmittedAmount != null && txnAmount != null && Math.abs(txnAmount - paySubmittedAmount) > 0.005) {
    payLog(`🧾 [Fast Payment] BillDesk's fee sheet shows ₹${txnAmount}, not the ₹${paySubmittedAmount} Fast Payment paid — check it and continue yourself.`, "WARN");
    return false;
  }
  const total = parseRupees(btn.textContent);
  if (lastFastPaymentStep === "card_pay_submitted") {
    payLog(
      `🧾 [Fast Payment] BillDesk's convenience fee for the card${total != null ? ` — total ₹${total.toFixed(2)}` : ""}. Check it and click Pay on the sheet to continue to the OTP.`,
      "WARN",
    );
    return false;
  }
  payLog(
    `🧾 [Fast Payment] Accepting BillDesk's convenience fee${total != null ? ` — total ₹${total.toFixed(2)}` : ""}. Next: your bank's OTP / login.`,
    "SUCCESS",
  );
  btn.click();
  return true;
}

function isFastPaymentEnabled() {
  if (currentSettings?.automationEnabled === false) return false;
  if (localStorage.getItem("automationEnabled") === "false") return false;
  if (currentSettings?.fastPaymentEnabled === false) return false;
  if (localStorage.getItem("dda_fast_payment_enabled") === "false") return false;
  return true;
}

// The applicant's own Fast Payment (web form, preferences.fastPayment) comes
// first; without one (or for a part it leaves open, such as the bank) the
// sidebar's setting is used. SBI's gateway is net banking only.
// The applicant's Fast Payment: the website's choice, or the one set in the
// sidebar (the app hands it over already merged). No PC-wide fallback: with
// none set, gateway is "" and the gateway step is left to the user.
function getStoredPaymentConfig() {
  const own = currentApplicant?.preferences?.fastPayment || {};
  const gateway = own.gateway === "sbi" || own.gateway === "cbi" ? own.gateway : "";
  if (!gateway) return { gateway: "", method: "", bank: "", cardSource: "", fromApplicant: false };
  const method = gateway === "sbi" || own.method === "netbanking" ? "netbanking" : "card";
  const bank = method === "netbanking"
    ? String(own.bank || "") || (gateway === "sbi" ? "statebankofindia" : "centralbankofindia")
    : "";
  // 'pc': the card ticked on this PC instead of the applicant's website card
  const cardSource = method === "card" && own.cardSource === "pc" ? "pc" : "";
  return { gateway, method, bank, cardSource, fromApplicant: true };
}

// ─── BillDesk card-form helpers (restored from d9fc9c9; frames are reachable
// because the webview runs with webSecurity=no) ───
function getAllPaymentDocuments() {
  const docs = [];
  try {
    if (document) docs.push(document);
  } catch (_) {}

  const scan = (doc) => {
    try {
      const iframes = doc.querySelectorAll("iframe, frame");
      for (const ifr of iframes) {
        try {
          const subDoc = ifr.contentDocument || ifr.contentWindow?.document;
          if (subDoc && !docs.includes(subDoc)) {
            docs.push(subDoc);
            scan(subDoc);
          }
        } catch (_) {}
      }
    } catch (_) {}
  };

  try {
    if (document) scan(document);
  } catch (_) {}
  return docs;
}

function findInputElement(root, selectors) {
  if (!root) return null;
  for (const sel of selectors) {
    try {
      const els = root.querySelectorAll(sel);
      for (const el of els) {
        if (!el) continue;
        if (el.tagName === "INPUT" || el.tagName === "SELECT") {
          if (el.type !== "hidden" && el.style.display !== "none") {
            return el;
          }
        }
        const inner = el.querySelector('input:not([type="hidden"]), select');
        if (inner && inner.style.display !== "none") {
          return inner;
        }
      }
    } catch (_) {}
  }
  return null;
}

function setSelectDropdown(el, val) {
  if (!el || !val) return;
  const targetVal = String(val).trim();
  const targetNum = parseInt(targetVal, 10);
  let matched = false;
  for (let i = 0; i < el.options.length; i++) {
    const opt = el.options[i];
    const optVal = String(opt.value || "").trim();
    const optText = String(opt.text || "").trim();
    if (
      optVal === targetVal ||
      optText === targetVal ||
      (!isNaN(targetNum) && parseInt(optVal, 10) === targetNum) ||
      (!isNaN(targetNum) && parseInt(optText, 10) === targetNum)
    ) {
      el.selectedIndex = i;
      matched = true;
      break;
    }
  }
  if (!matched && el.options.length > 0) {
    el.value = targetVal;
  }
  const win = el.ownerDocument?.defaultView || window;
  try {
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  } catch (_) {
    try {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {}
  }
}

function setVueReactiveInput(el, val) {
  if (!el || val === undefined || val === null) return;
  const targetStr = String(val);

  if (el.tagName === "SELECT") {
    setSelectDropdown(el, targetStr);
    return;
  }

  const currentVal = String(el.value || "");
  const cleanCurrent = currentVal.replace(/\s+/g, "");
  const cleanTarget = targetStr.replace(/\s+/g, "");
  if (cleanCurrent === cleanTarget && cleanTarget.length > 0) {
    return;
  }

  try {
    el.focus();
    const win = el.ownerDocument?.defaultView || window;
    const proto = win.HTMLInputElement?.prototype || window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(el, targetStr);
    } else {
      el.value = targetStr;
    }

    const tracker = el._valueTracker;
    if (tracker) {
      tracker.setValue(currentVal);
    }

    el.dispatchEvent(new win.Event("input", { bubbles: true }));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
    el.dispatchEvent(new win.KeyboardEvent("keydown", { bubbles: true, key: " " }));
    el.dispatchEvent(new win.KeyboardEvent("keyup", { bubbles: true, key: " " }));
    el.dispatchEvent(new win.Event("blur", { bubbles: true }));
  } catch (_) {
    try {
      el.value = targetStr;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {}
  }
}

// Universal Selector Lists for Payment Gateways (BillDesk Neo/Ace/Classic, CBI, SBI, etc.)
const PAYMENT_CARD_NUM_SELECTORS = [
  'input#cardNumber',
  'input[name="cardNumber"]',
  'input[name="card_number"]',
  'input[name="cardnumber"]',
  'input[name="cardno"]',
  'input[name="card_num"]',
  'input[name="cno"]',
  '#cardNumber input',
  '#card-number input',
  '.card-number input',
  'input[autocomplete="cc-number"]',
  'input[data-testid*="card-number" i]',
  'input[placeholder*="card number" i]',
  'input[placeholder*="card no" i]',
  'input[placeholder*="16-digit" i]',
  'input[placeholder*="16 digit" i]',
  'input[placeholder*="xxxx" i]',
  'input[id*="card" i][id*="num" i]',
  'input[name*="card" i][name*="num" i]'
];

const PAYMENT_EXPIRY_SELECTORS = [
  'input#expiryDate',
  'input[name="expiryDate"]',
  'input[name="expiry_date"]',
  'input[name="expMonthYear"]',
  'input[name="exp_month_year"]',
  'input[name="expDate"]',
  'input[name="exp_date"]',
  '#expiryDate input',
  '#expiry-date input',
  '.expiry-date input',
  'input[autocomplete="cc-exp"]',
  'input[placeholder*="MM" i][placeholder*="YY" i]',
  'input[placeholder*="MM / YY" i]',
  'input[placeholder*="MM/YY" i]',
  'input[placeholder*="MM/YYYY" i]',
  'input[id*="exp" i][id*="date" i]',
  'input[name*="exp" i][name*="date" i]',
  // Plain "expiry" / "Valid thru" spellings (missing before, so a field named
  // just "expiry" was never found)
  'input[name*="expir" i]:not([name*="month" i]):not([name*="year" i])',
  'input[id*="expir" i]:not([id*="month" i]):not([id*="year" i])',
  'input[placeholder*="expir" i]',
  'input[aria-label*="expir" i]',
  'input[data-testid*="expir" i]',
  'input[placeholder*="valid thru" i]',
  'input[aria-label*="valid thru" i]'
];

const PAYMENT_EXP_MONTH_SELECTORS = [
  'select[name="expMonth"]',
  'select[name="exp_month"]',
  'select[name="card_exp_month"]',
  'select#expMonth',
  'select#expiryMonth',
  'select[autocomplete="cc-exp-month"]',
  'input[name="expMonth"]',
  'input[name="exp_month"]',
  'input#expMonth',
  'input[placeholder="MM"]',
  'select[name*="month" i]'
];

const PAYMENT_EXP_YEAR_SELECTORS = [
  'select[name="expYear"]',
  'select[name="exp_year"]',
  'select[name="card_exp_year"]',
  'select#expYear',
  'select#expiryYear',
  'select[autocomplete="cc-exp-year"]',
  'input[name="expYear"]',
  'input[name="exp_year"]',
  'input#expYear',
  'input[placeholder="YY"]',
  'input[placeholder="YYYY"]',
  'select[name*="year" i]'
];

const PAYMENT_CVV_SELECTORS = [
  'input#cvv',
  'input#cvv2',
  'input[name="cvv"]',
  'input[name="cvv2"]',
  'input[name="cvv_number"]',
  'input[name="card_cvv"]',
  'input[name="securityCode"]',
  'input[name="security_code"]',
  '#cvv input',
  '#cvv2 input',
  '.cvv input',
  'input[autocomplete="cc-csc"]',
  'input[placeholder*="CVV" i]',
  'input[placeholder*="CVC" i]',
  'input[placeholder*="security code" i]',
  'input[placeholder*="3 digits" i]',
  'input[placeholder*="3-digit" i]',
  'input[id*="cvv" i]',
  'input[name*="cvv" i]',
  'input[name*="cvc" i]',
  'input[id*="cvc" i]',
  'input[aria-label*="cvv" i]',
  'input[aria-label*="cvc" i]',
  'input[aria-label*="security code" i]',
  'input[data-testid*="cvv" i]'
];

const PAYMENT_NAME_SELECTORS = [
  'input#card-holder-name',
  'input#cardHolderName',
  'input[name="card-holder-name"]',
  'input[name="cardHolderName"]',
  'input[name="card_holder_name"]',
  'input[name="cname"]',
  'input[name="card_name"]',
  'input[name="cardName"]',
  '#card-holder-name input',
  '#cardHolderName input',
  '.card-holder-name input',
  'input[autocomplete="cc-name"]',
  'input[placeholder*="name on card" i]',
  'input[placeholder*="cardholder" i]',
  'input[placeholder*="card holder" i]',
  'input[placeholder*="holder name" i]',
  'input[id*="holder" i][id*="name" i]',
  'input[name*="holder" i][name*="name" i]'
];

// Arm the gateway step in main, then run `action` (the click that leaves
// DDA). Main accepts the arm only while this frame is still on DDA, so the
// click waits for its answer (at most 1.5 s). The plan uses the gateway
// actually selected on the DDA page, and the applicant's (or the sidebar's) method / bank.
function armThenRun(action) {
  const gwVal = (document.getElementById("payment_gateway") || document.querySelector('select[name="payment_gateway"]'))?.value;
  const cfg = getStoredPaymentConfig();
  const plan = {
    gateway: gwVal === "10" ? "sbi" : gwVal === "9" ? "cbi" : cfg.gateway,
    method: cfg.method,
    bank: cfg.bank,
    cardSource: cfg.cardSource,
    // The DDA account: main uses its applicant's own card / bank login, if any
    pan: getDdaAccountPan() || applicantPanOf(currentApplicant),
    cardId: currentSettings?.fastPaymentCardId || localStorage.getItem("dda_fast_payment_card_id") || "",
  };
  let ran = false;
  const runOnce = () => {
    if (ran) return;
    ran = true;
    action();
  };
  Promise.race([
    ipcRenderer.invoke("payment:arm", plan),
    new Promise((r) => setTimeout(() => r("timeout"), 1500)),
  ])
    .then((ok) => {
      if (ok === true) {
        const via = plan.gateway === "sbi" || plan.method === "netbanking" ? "net banking" : "card";
        payLog(`🔐 [Fast Payment] Payment armed — ${plan.gateway.toUpperCase()} via ${via}.`);
      } else {
        payLog(`⚠️ [Fast Payment] Could not arm the gateway step (${ok === false ? "rejected by app" : ok}) — finish on the gateway yourself.`, "WARN");
      }
    })
    .catch((err) => payLog(`⚠️ [Fast Payment] Could not arm the gateway step (${err?.message || err}) — finish on the gateway yourself.`, "WARN"))
    .finally(runOnce);
}

function handleFastPaymentEngine() {
  if (isFastPaymentExecuting) return;

  const url = window.location.href.toLowerCase();
  // Runs from the 250ms watcher on every page; stay off DDA pages that are not
  // part of payment (notably step2 during a drop).
  const onDdaPortal = url.includes("eservices.dda.org.in");
  if (onDdaPortal && !/getlayout|payment|challan/.test(url)) return;

  // ─── STAGE 4: GATEWAY (SBI chooser page, BillDesk card / net banking) ───
  // Gated by main, not by page flags: main hands over the plan only while this
  // payment is armed (Make Payment dispatched by Fast Payment), once. Fills the
  // card or picks the bank, clicks Pay once, then hands over at the bank OTP /
  // net-banking login. Not armed → steps aside and the gateway is left to the user.
  if (runGatewayAutomation()) return;
  if (runFeeConfirmation()) return;

  // ─── STAGE 5: BANK 3D-SECURE SMS OTP SCREEN DETECTION ───
  const isOtpPage = 
    url.includes("otp") || url.includes("/acs/") || url.includes("authentication") ||
    url.includes("securecode") || url.includes("verifiedbyvisa") || url.includes("rupay") ||
    !!document.querySelector('input[name*="otp" i], input[id*="otp" i], input[placeholder*="otp" i], input[autocomplete="one-time-code"]');

  if (isOtpPage) {
    try {
      sessionStorage.removeItem("dda_fast_payment_approved");
      window.__ddaFastPaymentApproved = false;
    } catch (_) {}
    if (!hasAnnouncedOtpScreen) {
      hasAnnouncedOtpScreen = true;
      appendRunLog("🔔 [Fast Payment] Reached Bank 3D-Secure SMS OTP screen! Automation paused for manual user authorization.", "SUCCESS");
      try {
        ipcRenderer.send("dda:otp-reached");
        if (typeof ipcRenderer.sendToHost === "function") ipcRenderer.sendToHost("dda:otp-reached");
      } catch (_) {}
      try {
        ipcRenderer.send("dda:log", {
          level: "SUCCESS",
          page: "Payment OTP",
          pan: currentApplicant?.pan || "",
          msg: "🔔 Bank 3D-Secure SMS OTP screen reached! Standing by for manual user approval."
        });
      } catch (_) {}
    }
    return;
  }

  // An explicit sidebar FAST PAY click approves this one payment even when the
  // toggle is off; auto-start from the hold page still needs the toggle.
  const toggleOn = isFastPaymentEnabled();
  const approvedNow =
    window.__ddaFastPaymentApproved === true ||
    sessionStorage.getItem("dda_fast_payment_approved") === "true";
  if (!toggleOn && !approvedNow) return;

  // ─── OTHER GATEWAYS (SBI ePay, bank pages): NO AUTOMATION ───
  // Zero script injection, zero simulated clicks on non-BillDesk gateways, to
  // avoid duplicate bank requests and transaction cancellations.
  const isGatewayUrl =
    !url.includes("eservices.dda.org.in") &&
    (url.includes("billdesk") || url.includes("pay.sbi") || url.includes("onlinesbi") || url.includes("securepay") || url.includes("payment") || url.includes("paygate") || url.includes("cbi") || url.includes("sbi") || url.includes("checkout") || url.includes("gateway"));

  if (isGatewayUrl) {
    try {
      sessionStorage.removeItem("dda_fast_payment_approved");
      window.__ddaFastPaymentApproved = false;
    } catch (_) {}
    if (!hasAnnouncedGatewayScreen) {
      hasAnnouncedGatewayScreen = true;
      appendRunLog("🚀 [Fast Payment] On the payment gateway — nothing left to automate here; continue manually if needed.", "SUCCESS");
      try {
        ipcRenderer.send("dda:log", {
          level: "SUCCESS",
          page: "Payment Gateway",
          pan: currentApplicant?.pan || "",
          msg: "🚀 On the payment gateway — nothing left to automate here; continue manually if needed."
        });
      } catch (_) {}
    }
    return;
  }

  const { gateway } = getStoredPaymentConfig();

  // ─── STAGE 1: DDA 15-MINUTE HOLD INITIAL SCREEN (/user/getlayout) ───
  const tandc = document.getElementById("tandc") || document.querySelector('input[name="tandc"]');
  const hasPaymentMethodLoaded = !!document.querySelector(".payment_method select, #payment_gateway");

  if (tandc && !hasPaymentMethodLoaded) {
    // Always stop here: the user checks the reserved flat on the hold page and
    // starts payment with the sidebar FAST PAY button (which runs Stage 1).
    // Never auto-click #btnContinue.
    return;
  }

  const isPaymentApproved =
    window.__ddaFastPaymentApproved === true ||
    sessionStorage.getItem("dda_fast_payment_approved") === "true";
  if (!isPaymentApproved) return;

  // ─── STAGE 2: DDA PAYMENT GATEWAY SELECTION (CBI "9" vs SBI "10") ───
  const gwSelect = document.getElementById("payment_gateway") || document.querySelector('select[name="payment_gateway"]');
  const hasPaymentFormLoaded = !!document.querySelector(".payment_form #makePaymentButton, .payment_form input[name=\"termsCondCheckBox\"]");

  if (gwSelect && !hasPaymentFormLoaded && !gateway) {
    // Nothing set for this applicant: leave the gateway choice to the user
    if (lastFastPaymentStep !== "gateway_not_set") {
      lastFastPaymentStep = "gateway_not_set";
      const msg = "⚠️ Fast Payment is not set for this applicant — choose the gateway on this page yourself, or set it with the pencil under Fast Payment in the sidebar.";
      appendRunLog(msg, "WARN");
      try {
        ipcRenderer.send("dda:log", { level: "WARN", page: "Payment", pan: currentApplicant?.pan || "", msg });
      } catch (_) {}
    }
    return;
  }

  if (gwSelect && !hasPaymentFormLoaded) {
    const targetGwVal = gateway === "sbi" ? "10" : "9";
    if (gwSelect.value !== targetGwVal) {
      gwSelect.value = targetGwVal;
      gwSelect.dispatchEvent(new Event("change", { bubbles: true }));
      appendRunLog(`⚡ [Fast Payment] Selected Gateway: ${gateway === "sbi" ? "State Bank of India (SBI)" : "Central Bank of India (CBI)"} (this applicant's choice)`, "ROUTE");
    }
    const clickToChallan = document.getElementById("clicktochallan") || document.querySelector('button[onclick*="paymentForm"]');
    if (clickToChallan && lastFastPaymentStep !== "gateway_continue_clicked") {
      lastFastPaymentStep = "gateway_continue_clicked";
      // Some gateways (SBI) leave DDA straight from here, with no Make
      // Payment step, so arm now as well.
      armThenRun(() => {
        appendRunLog("⚡ [Fast Payment] Clicking Gateway Continue (#clicktochallan)...", "ROUTE");
        if (typeof window.paymentForm === "function") {
          window.paymentForm();
        } else {
          clickToChallan.click();
        }
      });
      return;
    }
  }

  // ─── STAGE 3: CHARGEBACK POLICY & MAKE PAYMENT BUTTON ───
  const termsBox = document.getElementById("termsCondCheckBox") || document.querySelector('input[name="termsCondCheckBox"]');
  const makePayBtn = document.getElementById("makePaymentButton") || document.querySelector(".makePaymentButton");

  if (termsBox || makePayBtn) {
    if (termsBox && !termsBox.checked) {
      termsBox.checked = true;
      termsBox.dispatchEvent(new Event("change", { bubbles: true }));
      appendRunLog("⚡ [Fast Payment] Accepted DDA Chargeback/Refund Policy checkbox", "ROUTE");
    }

    // Dismiss intrusive #myModal policy modal
    try {
      if (window.$ && $("#myModal").length) $("#myModal").modal("hide");
    } catch (_) {}
    const closeBtn = document.querySelector(".closePaymentModal, #myModal button.close, #myModal button");
    if (closeBtn) closeBtn.click();
    const backdrop = document.querySelector(".modal-backdrop");
    if (backdrop) backdrop.remove();

    if (makePayBtn && lastFastPaymentStep !== "make_payment_dispatched") {
      makePayBtn.classList.remove("disabled");
      lastFastPaymentStep = "make_payment_dispatched";
      armThenRun(() => {
        appendRunLog("🚀 [Fast Payment] Dispatched 'Make Payment' to launch payment gateway!", "ROUTE");
        if (makePayBtn.href && makePayBtn.href.startsWith("http")) {
          window.location.href = makePayBtn.href;
        } else {
          makePayBtn.click();
        }
      });
      return;
    }
  }
}

function setupGlobalSafetyAndTimerWatcher() {
  if (window.location?.hostname === "eservices.dda.org.in") {
    window.alert = function () {};
    window.confirm = function () {
      return true;
    };
  }

  let lastSentHoldTimer = "";
  let lastSentHoldFlat = "";
  let lastSentHoldApplicant = "";
  let lastSentHoldMoney = "";

  const checkTimerAlert = () => {
    // Check for payment timer page on each cycle
    checkForPaymentTimerPage();

    // Broadcast live payment hold info (reserved flat & live timer from page) to sidebar
    const currentUrl = (window.location.href || "").toLowerCase();
    const timerEl = document.querySelector("#time, span.timer");
    const isHoldPage =
      currentUrl.includes("getlayout") ||
      !!(timerEl && document.querySelector("#btnContinue, input#flat_id"));

    if (isHoldPage) {
      const timerText = timerEl ? (timerEl.textContent || "").trim() : "";
      const flatDetails = extractBookedFlatDetails() || {};
      const personalDetails = extractPersonalDetails() || {};
      const flatNo =
        flatDetails.flatNo ||
        localStorage.getItem("dda_last_reserved_flat") ||
        sessionStorage.getItem("dda_reserved_flat_no") ||
        "";
      const applicantName =
        personalDetails.applicantName ||
        currentApplicant?.name ||
        currentApplicant?.personal?.fullName ||
        "";
      const applicationMoney =
        flatDetails.applicationMoney ||
        sessionStorage.getItem("dda_reserved_app_money") ||
        localStorage.getItem("dda_reserved_app_money") ||
        "";

      if (
        (timerText && timerText !== lastSentHoldTimer) ||
        (flatNo && flatNo !== lastSentHoldFlat) ||
        (applicantName && applicantName !== lastSentHoldApplicant) ||
        (applicationMoney && applicationMoney !== lastSentHoldMoney)
      ) {
        lastSentHoldTimer = timerText;
        lastSentHoldFlat = flatNo;
        lastSentHoldApplicant = applicantName;
        lastSentHoldMoney = applicationMoney;
        try {
          if (applicantName) {
            sessionStorage.setItem("dda_reserved_applicant_name", applicantName);
            localStorage.setItem("dda_reserved_applicant_name", applicantName);
          }
          if (applicationMoney) {
            sessionStorage.setItem("dda_reserved_app_money", applicationMoney);
            localStorage.setItem("dda_reserved_app_money", applicationMoney);
          }
          const payload = {
            flatNo,
            timerText,
            applicantName,
            applicationMoney,
            locality: flatDetails.locality || "",
            sector: flatDetails.sector || "",
            pocket: flatDetails.pocket || "",
            block: flatDetails.block || "",
            floor: flatDetails.floor || "",
            scheme: flatDetails.schemeName || "",
          };
          ipcRenderer.send("dda:payment-hold-info", payload);
          if (typeof ipcRenderer.sendToHost === "function") {
            ipcRenderer.sendToHost("dda:payment-hold-info", payload);
          }
        } catch (_) {}
      }
    }

    // Fast Payment Automation Execution
    handleFastPaymentEngine();

    const popup = document.querySelector(
      ".swal2-popup.swal2-show, .swal-modal",
    );
    if (!popup) return;
    if (popup.dataset.autoConfirmed === "true") return;
    const text = (popup.textContent || "").toLowerCase();

    if (
      text.includes("your 15 minutes timer has been started")
    ) {
      const confirmBtn = popup.querySelector(
        ".swal2-confirm, button.confirm, .swal-button--confirm",
      );
      confirmHoldSecured("DDA started the 15-minute timer");
      if (confirmBtn) {
        popup.dataset.autoConfirmed = "true";
        logAnalyticsStep("step6_payment_timer_ok", "Payment Timer OK Clicked");
        confirmBtn.click();
      }
    }

    // "Kindly check Terms and Conditions" SweetAlert Recovery
    // Fired by CheckTermCondition() if jQuery didn't see checkbox as checked.
    // Auto-dismiss, re-check via jQuery, and reset step for retry.
    if (
      text.includes("kindly check terms and conditions")
    ) {
      if (popup.dataset.tandcAlertHandled !== "true") {
        popup.dataset.tandcAlertHandled = "true";
        try { if (window.Swal) window.Swal.close(); } catch (_) {}
        const confirmBtn = popup.querySelector(
          ".swal2-confirm, button.confirm, .swal-button--confirm, .swal2-actions button",
        );
        if (confirmBtn) confirmBtn.click();
        // Re-check the checkbox via jQuery and reset step
        try {
          const cb = document.getElementById("tandc");
          if (cb) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); }
          if (window.$ && window.$.fn) window.$("#tandc").prop("checked", true).trigger("change");
        } catch (_) {}
        lastFastPaymentStep = "";
        window.__ddaContinueClickedAt = 0;
        appendRunLog("🔄 [Fast Payment] Dismissed 'Kindly check T&C' alert — retrying continue...", "WARN");
      }
    }

    // Server Invalid Captcha Alert Recovery
    if (
      text.includes("the captcha field is required") ||
      (text.includes("captcha") && text.includes("invalid"))
    ) {
      if (popup.dataset.captchaAlertHandled !== "true") {
        popup.dataset.captchaAlertHandled = "true";
        checkForInvalidCaptchaAlert();
      }
    }

    // Flat Reservation Conflict Alert Recovery
    checkForConflictAlert();

    // 15-Minute Booking Window Expiration Watchdog (Strictly 1-shot log + auto-confirm)
    if (
      text.includes("your time has been expired")
    ) {
      if (popup.dataset.expiredLogged !== "true") {
        popup.dataset.expiredLogged = "true";
        ipcRenderer.send("dda:log", {
          level: "ERROR",
          pan: currentApplicant?.pan,
          page: "Timer Watchdog",
          msg: "⏰ Booking window or payment session has expired on DDA portal.",
        });
        const confirmBtn = popup.querySelector(
          ".swal2-confirm, button.confirm, .swal-button--confirm, button.close, [data-dismiss='modal']",
        );
        if (confirmBtn) {
          confirmBtn.click();
        }
      }
    }
  };

  setInterval(checkTimerAlert, 250);
}

// ─── Saved net-banking logins (Chrome-style "Save password?") ───
// Bank login pages only (any https page that is not DDA or BillDesk). When the
// user logs in by hand, the ID + password go to main, which asks in the app
// whether to save them (encrypted with the OS keystore). Next time main hands
// them back only to a page on the exact same host, and they are typed in;
// the captcha and the Login click stay with the user.
const BANK_LOGIN_EXCLUDED_HOST = /(^|\.)(dda\.org\.in|billdesk\.com)$/i;
const BANK_LOGIN_SKIP_FIELD = /captcha|otp|security|answer|search|amount/i;
const BANK_LOGIN_FILL_WINDOW_MS = 60000;
// Card 3-D Secure pages (the bank's OTP screen after a card payment) are never
// logins: their password-type box holds the OTP (ICICI secureicici-cr1…/v1/acs/…,
// HDFC securehdfc-acs2ui-…). Same rule in main.js (isCardAuthUrl).
const CARD_AUTH_HOST = /(^|[.-])acs\d*([.-]|ui|$)|3ds|securecode|verifiedbyvisa|wibmo|^secure[a-z]+-cr\d+\./i;
const CARD_AUTH_PATH = /\/acs\/|\/3ds|\/creq(\/|$)|\/challenge(\/|$)/i;

function isBankLoginCandidatePage() {
  return location.protocol === "https:" && !BANK_LOGIN_EXCLUDED_HOST.test(location.hostname || "") &&
    !CARD_AUTH_HOST.test(location.hostname || "") && !CARD_AUTH_PATH.test(location.pathname || "");
}

// A password-type box that is really an OTP / one-time code
const isOtpBox = (el) => el?.autocomplete === "one-time-code" ||
  /otp|one.?time/i.test(`${el?.name} ${el?.id} ${el?.placeholder} ${el?.getAttribute?.("aria-label") || ""}`);

function bankLoginPasswordField() {
  return [...document.querySelectorAll('input[type="password"]')].find((el) => isShown(el) && !isOtpBox(el)) || null;
}

// The login ID box: the last visible text-like input before the password box
// (in its form if it has one), skipping captcha / OTP boxes.
function bankLoginUsernameField(pw) {
  const scope = pw?.form || document;
  const inputs = [...scope.querySelectorAll('input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="number"]')]
    .filter((el) => isShown(el) && !BANK_LOGIN_SKIP_FIELD.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute("aria-label") || ""}`));
  if (!pw) return inputs.length === 1 ? inputs[0] : null;
  const before = inputs.filter((el) => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
  return before[before.length - 1] || null;
}

function bankLoginCaptchaField() {
  return [...document.querySelectorAll("input")]
    .find((el) => isShown(el) && /captcha/i.test(`${el.name} ${el.id} ${el.placeholder}`)) || null;
}

// Two-step logins (ID on one page, password on the next): remember the ID
// typed on the first page for this tab and host.
const bankLoginIdKey = () => `dda_bl_id_${location.hostname}`;

// A Login click and the form submit it causes both land here; send once.
let lastBankLoginCapture = { key: "", at: 0 };

function captureBankLogin() {
  try {
    const pw = bankLoginPasswordField();
    if (!pw) {
      const idBox = bankLoginUsernameField(null);
      const id = String(idBox?.value || "").trim();
      if (id) sessionStorage.setItem(bankLoginIdKey(), id);
      return;
    }
    const password = String(pw.value || "");
    if (!password) return;
    const idBox = bankLoginUsernameField(pw);
    const username = String(idBox?.value || "").trim() || sessionStorage.getItem(bankLoginIdKey()) || "";
    const key = JSON.stringify([username, password]);
    if (key === lastBankLoginCapture.key && Date.now() - lastBankLoginCapture.at < 1000) return;
    lastBankLoginCapture = { key, at: Date.now() };
    ipcRenderer.send("banklogin:captured", { username, password });
  } catch (_) {}
}

let bankLoginAssistStarted = false;
function setupBankLoginAssist() {
  if (bankLoginAssistStarted || !isBankLoginCandidatePage()) return;
  bankLoginAssistStarted = true;

  // Capture only what the user did (trusted events): Login clicks, Enter in a
  // login box, and form submits.
  document.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    const b = e.target?.closest?.('button, input[type="submit"], input[type="button"], input[type="image"], a, [role="button"]');
    if (!b) return;
    const t = String(b.textContent || b.value || b.getAttribute("aria-label") || b.alt || "").trim().toLowerCase();
    if (b.type === "submit" || /log\s*-?\s*in|sign\s*-?\s*in|submit|continue|proceed|next/.test(t)) captureBankLogin();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.isTrusted && e.key === "Enter" && e.target?.tagName === "INPUT") captureBankLogin();
  }, true);
  document.addEventListener("submit", (e) => {
    if (e.isTrusted !== false) captureBankLogin();
  }, true);

  // Fill: once per page, when a login form shows up and the user has not
  // started typing in it.
  const startedAt = Date.now();
  let asked = false;
  let userTyped = false;
  document.addEventListener("input", (e) => { if (e.isTrusted) userTyped = true; }, true);
  const timer = setInterval(() => {
    if (asked || userTyped || Date.now() - startedAt > BANK_LOGIN_FILL_WINDOW_MS) {
      clearInterval(timer);
      return;
    }
    const pw = bankLoginPasswordField();
    const idBox = bankLoginUsernameField(pw);
    if (!pw && !idBox) return;
    if (pw && !idBox && !pw.form && document.querySelectorAll('input[type="password"]').length > 1) return;
    asked = true;
    clearInterval(timer);
    ipcRenderer.invoke("banklogin:getForPage").then((login) => {
      if (!login || userTyped) return;
      const pwNow = bankLoginPasswordField();
      const idNow = bankLoginUsernameField(pwNow);
      let filled = false;
      if (idNow && login.username && !idNow.value) { typeIntoField(idNow, login.username); filled = true; }
      if (pwNow && login.password && !pwNow.value) { typeIntoField(pwNow, login.password); filled = true; }
      if (!filled) return;
      const cap = bankLoginCaptchaField();
      try { (cap || pwNow || idNow).focus(); } catch (_) {}
      appendRunLog(
        `🔑 Filled your saved login for ${location.hostname}${cap ? " — type the captcha and log in" : " — check it and log in"}.`,
        "SUCCESS",
      );
    }).catch(() => {});
  }, 400);
}

// Kick off
initSessionData();
runWhenReady(setupBankLoginAssist);

// ─── DDA's "View Uploaded Document" links ───
// DDA points them at an in-memory copy of the attached file (blob:, opened in
// a new window). Site isolation is off for Fast Payment, and with it off
// Chromium's PDF viewer shows that window blank, so a PDF is handed to main,
// which shows it with pdf.js. Images still open the normal way.
(function setupDdaPdfLinks() {
  if (location.hostname !== "eservices.dda.org.in") return;
  const blobFiles = new Map(); // blob URL -> { type, name }
  try {
    const nativeCreate = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      const url = nativeCreate.apply(URL, arguments);
      try {
        if (obj && typeof obj.type === "string") blobFiles.set(url, { type: obj.type, name: obj.name || "" });
      } catch (_) {}
      return url;
    };
  } catch (_) {}

  const looksPdf = (href) => {
    if (/^data:application\/pdf/i.test(href)) return true;
    const info = blobFiles.get(href);
    return !!info && (info.type === "application/pdf" || /\.pdf$/i.test(info.name));
  };

  const nativeOpen = window.open;
  const isInMemoryPdf = (href) => /^(blob:|data:application\/pdf)/i.test(href) && looksPdf(href);
  // Hand the PDF to the viewer; if main can't show it, open it the old way.
  const showInViewer = (href, title) => {
    fetch(href)
      .then((r) => r.arrayBuffer())
      .then((buf) => ipcRenderer.invoke("doc:openPdf", { bytes: new Uint8Array(buf), title }))
      .then((shown) => { if (!shown) nativeOpen.call(window, href, "_blank"); })
      .catch(() => nativeOpen.call(window, href, "_blank"));
  };

  document.addEventListener("click", (e) => {
    const a = e.target?.closest?.("a[href]");
    if (!a || a.hasAttribute("download")) return;
    const href = a.href || "";
    if (!isInMemoryPdf(href)) return;
    e.preventDefault();
    showInViewer(href, blobFiles.get(href)?.name || (a.textContent || "").trim() || "Document");
  }, true);

  // The same for PDFs the page opens from script (window.open(blobUrl)).
  // PDFs DDA serves from its server are caught in main (onHeadersReceived).
  window.open = function (url) {
    const href = String(url || "");
    if (!isInMemoryPdf(href)) return nativeOpen.apply(window, arguments);
    showInViewer(href, blobFiles.get(href)?.name || "Document");
    return null;
  };
})();

// Login page: warm this window's cache of DDA's static files (warmDdaStaticFiles)
if (typeof window !== "undefined") {
  try {
    if (isDdaHost() && isDdaLoginPage()) {
      window.addEventListener("load", () => warmDdaStaticFiles(), { once: true });
    }
  } catch (_) {}
}

// DDA's payment result page (/user/getPaymentResult/<id>, after the bank sends the
// user back): read its table (Status, Amount, Transaction Id, Reference No.,
// Transaction Date, Payment Gateway, Application No.) and the popup, once per
// result, and hand it over: main records it on this PC's booking run, the
// dashboard on the server's (Workspace → api.recordPaymentResult). Read as soon as
// the table is there, before anything leaves the page.
function readDdaPaymentResult() {
  const fields = {};
  for (const tr of document.querySelectorAll("table tr")) {
    const cells = tr.querySelectorAll("td, th");
    if (cells.length !== 2) continue;
    const label = (cells[0].innerText || cells[0].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const value = (cells[1].innerText || cells[1].textContent || "").replace(/\s+/g, " ").trim();
    if (label) fields[label] = value.slice(0, 120);
  }
  const pick = (re) => { const k = Object.keys(fields).find((l) => re.test(l)); return k ? fields[k] : ""; };
  const popup = (document.querySelector(".swal2-popup.swal2-show .swal2-html-container, .swal2-popup.swal2-show .swal2-title, .swal-modal .swal-text, .sweet-alert p")?.textContent || "").trim().slice(0, 160);
  const ddaStatus = pick(/^status$/);
  const said = `${ddaStatus} ${popup}`;
  const status = /success|done/i.test(said) ? "PAID" : /fail|declin|cancel|reject/i.test(said) ? "FAILED" : "UNCONFIRMED";
  return {
    status,
    ddaStatus,
    message: popup,
    amount: pick(/^amount/),
    transactionId: pick(/transaction id|txn/),
    referenceNo: pick(/reference/),
    transactionDate: pick(/transaction date|date/),
    gateway: pick(/gateway/),
    applicationNo: pick(/application no/),
    hasTable: Object.keys(fields).length > 0,
  };
}

function watchDdaPaymentResult() {
  const key = `dda_payment_result_sent_${location.pathname}`;
  try { if (sessionStorage.getItem(key)) return; } catch (_) {}
  const startedAt = Date.now();
  const send = (r) => {
    try { sessionStorage.setItem(key, "1"); } catch (_) {}
    let run = {};
    try { run = JSON.parse(localStorage.getItem("dda_run_analytics") || "{}") || {}; } catch (_) {}
    const pan = getDdaAccountPan() || run.applicantPan || currentApplicant?.pan || "";
    const payment = {
      ...r,
      recordedAt: new Date().toISOString(),
      resultPage: location.pathname,
    };
    delete payment.hasTable;
    const info = {
      pan,
      runId: run.runId && (!pan || run.applicantPan === pan) ? run.runId : "",
      flatNo: run.bookedFlat?.flatNo || sessionStorage.getItem("dda_reserved_flat_no") || "",
      payment,
    };
    const label = r.status === "PAID" ? "✅ Payment done" : r.status === "FAILED" ? "❌ Payment failed" : "⚠️ Payment result unclear";
    appendRunLog(`${label} — DDA says "${r.ddaStatus || r.message || "no status"}"${r.amount ? `, ${r.amount}` : ""}${r.transactionId ? `, transaction ${r.transactionId}` : ""}`, r.status === "PAID" ? "SUCCESS" : "WARN");
    try { ipcRenderer.send("payment:result", info); } catch (_) {}
    try { ipcRenderer.sendToHost("dda:payment-result", info); } catch (_) {}
  };
  const timer = setInterval(() => {
    const r = readDdaPaymentResult();
    // The table, plus the popup when it shows within 1.5 s; after 10 s whatever is there
    const waited = Date.now() - startedAt;
    if ((r.hasTable && (r.message || waited > 1500)) || waited > 10000) {
      clearInterval(timer);
      send(r);
    }
  }, 150);
}

if (typeof window !== "undefined") {
  try {
    if (isDdaHost() && /^\/user\/getpaymentresult\//i.test(window.location.pathname)) {
      runWhenReady(watchDdaPaymentResult);
    }
  } catch (_) {}
}
