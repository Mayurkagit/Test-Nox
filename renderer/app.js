// Full-Width Workspace & Embedded DDA Browser Controller for Electron Suite

// Resilient API Wrapper (Guarantees methods are never undefined even during live reload)
const api = {
  login: async (email, password) => {
    if (window.ddaElectronAPI?.login) {
      return await window.ddaElectronAPI.login(email, password);
    }
    return {
      success: false,
      error:
        "Invalid credentials. Please restart Electron or check email/password.",
    };
  },

  validateBookingKey: async (key, user) => {
    if (window.ddaElectronAPI?.validateBookingKey) {
      return await window.ddaElectronAPI.validateBookingKey(key, user);
    }
    const cleanKey = (key || "").trim().toUpperCase();
    if (!cleanKey) return { success: false, error: "Booking key is required." };

    try {
      const workerUrl = "https://dda-engine.asmrahul17.workers.dev";
      const idToken = user?.idToken || localStorage.getItem("dda_id_token") || "";
      const headers = {};
      if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      const res = await fetch(`${workerUrl}/extension/validate-key?key=${encodeURIComponent(cleanKey)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        return {
          success: true,
          key: cleanKey,
          scheme: data?.scheme || data?.targetScheme || "DDA Housing Scheme 2026",
          mode: data?.mode || "LIVE",
        };
      }
      let errorMsg = "Invalid booking key. Please verify with admin.";
      try {
        const errJson = await res.json();
        if (errJson?.error) errorMsg = errJson.error;
      } catch (_) {}
      return { success: false, error: errorMsg };
    } catch (_) {
      return {
        success: false,
        error: "Unable to connect to key validation server. Please check internet connection.",
      };
    }
  },

  getApplicantsByUser: async (user) => {
    if (window.ddaElectronAPI?.getApplicantsByUser) {
      return await window.ddaElectronAPI.getApplicantsByUser(user);
    }
    if (window.ddaElectronAPI?.getApplicants) {
      return await window.ddaElectronAPI.getApplicants();
    }
    return [];
  },

  saveApplicant: async (app, user) => {
    if (window.ddaElectronAPI?.saveApplicant) {
      return await window.ddaElectronAPI.saveApplicant(app, user);
    }
    return app;
  },

  getSettings: async () => {
    if (window.ddaElectronAPI?.getSettings) {
      return await window.ddaElectronAPI.getSettings();
    }
    return {
      theme: "dark",
      automationEnabled: true,
      captchaAutoSolveEnabled: true,
      captchaAutoSubmitEnabled: true,
      aiModel: "gemini-3.5-flash-lite",
      settleDelayMs: 150,
    };
  },

  saveSettings: async (settings) => {
    if (window.ddaElectronAPI?.saveSettings) {
      return await window.ddaElectronAPI.saveSettings(settings);
    }
  },

  onSessionLog: (callback) => {
    if (window.ddaElectronAPI?.onSessionLog) {
      return window.ddaElectronAPI.onSessionLog(callback);
    }
    return () => {};
  },
};

let applicants = [];
let activeApplicant = null;
let settings = {};
let editingPan = null;
let currentUser = null;
let activeBookingKey = null;
let currentTheme = "dark";
let logCount = 0;

// ─── DOM ELEMENTS ──────────────────────────────────────────────────────

// 1. Views
const viewAuthWelcome = document.getElementById("view-auth-welcome");
const viewKeyVerification = document.getElementById("view-key-verification");
const viewMainWorkspace = document.getElementById("view-main-workspace");

// 2. Theme Toggles
const btnThemeToggleAuth = document.getElementById("btn-theme-toggle-auth");
const btnThemeToggleKey = document.getElementById("btn-theme-toggle-key");
const btnThemeToggleWorkspace = document.getElementById(
  "btn-theme-toggle-workspace",
);

// 3. Stage 1: Welcome Login Elements
const welcomeLoginForm = document.getElementById("welcome-login-form");
const loginEmailInput = document.getElementById("login-email");
const loginPasswordInput = document.getElementById("login-password");
const loginErrorAlert = document.getElementById("login-error-alert");
const btnLoginSubmit = document.getElementById("btn-login-submit");

// 4. Stage 2: Key Verification Elements
const keyVerificationForm = document.getElementById("key-verification-form");
const inputBookingKey = document.getElementById("input-booking-key");
const keyErrorAlert = document.getElementById("key-error-alert");
const btnVerifyKey = document.getElementById("btn-verify-key");
const btnKeyLogout = document.getElementById("btn-key-logout");
const keyUserInitials = document.getElementById("key-user-initials");
const keyUserName = document.getElementById("key-user-name");
const keyUserEmail = document.getElementById("key-user-email");
const keyUserRole = document.getElementById("key-user-role");

// 5. Stage 3: Workspace Top Bar & Controls
const webview = document.getElementById("dda-webview");
const selectActiveApplicant = document.getElementById(
  "select-active-applicant",
);
const targetFlatsContainer = document.getElementById("target-flats-container");
const dbLatencyEl = document.getElementById("db-latency");
const activePartitionLabel = document.getElementById("active-partition-label");
const browserCurrentUrl = document.getElementById("browser-current-url");
const workspaceKeyLabel = document.getElementById("workspace-key-label");
const workspaceUserInitials = document.getElementById(
  "workspace-user-initials",
);
const workspaceUserName = document.getElementById("workspace-user-name");
const btnWorkspaceLogout = document.getElementById("btn-workspace-logout");
const btnEditActiveApp = document.getElementById("btn-edit-active-app");
const btnAddApplicant = document.getElementById("btn-add-applicant");

// Engine Settings Elements
const toggleAutoSubmit = document.getElementById("toggle-auto-submit");
const toggleCaptchaSolver = document.getElementById("toggle-captcha-solver");
const selectAiModel = document.getElementById("select-ai-model");
const inputSettleDelay = document.getElementById("input-settle-delay");

// Browser Sub-Toolbar Buttons
const btnBrowserBack = document.getElementById("btn-browser-back");
const btnBrowserForward = document.getElementById("btn-browser-forward");
const btnBrowserReload = document.getElementById("btn-browser-reload");
const btnNavLogin = document.getElementById("btn-nav-login");
const btnNavSchemes = document.getElementById("btn-nav-schemes");
const btnNavStep2 = document.getElementById("btn-nav-step2");

// Telemetry & Modals
const btnOpenTelemetry = document.getElementById("btn-open-telemetry");
const telemetryModal = document.getElementById("telemetry-modal");
const btnCloseTelemetry = document.getElementById("btn-close-telemetry");
const btnClearLogs = document.getElementById("btn-clear-logs");
const terminalLogs = document.getElementById("terminal-logs");
const telemetryLogCount = document.getElementById("telemetry-log-count");

const applicantModal = document.getElementById("applicant-modal");
const applicantForm = document.getElementById("applicant-form");
const modalTitle = document.getElementById("modal-title");
const btnCloseModal = document.getElementById("btn-close-modal");
const btnCancelModal = document.getElementById("btn-cancel-modal");
const chkJointApplicant = document.getElementById("chk-joint-applicant");
const jointFields = document.getElementById("joint-applicant-fields");

// ─── INITIALIZATION ────────────────────────────────────────────────────

async function init() {
  await loadSettings();
  initTheme();
  setupBrowserControls();
  setupEventListeners();
  subscribeToLogs();
  restoreSessionLifecycle();
}

// ─── 3-STAGE LIFECYCLE ROUTING ─────────────────────────────────────────

function switchView(viewName) {
  viewAuthWelcome.style.display = "none";
  viewKeyVerification.style.display = "none";
  viewMainWorkspace.style.display = "none";

  if (viewName === "LOGIN") {
    viewAuthWelcome.style.display = "flex";
  } else if (viewName === "KEY") {
    updateKeyUserBadge();
    viewKeyVerification.style.display = "flex";
    inputBookingKey.focus();
  } else if (viewName === "WORKSPACE") {
    viewMainWorkspace.style.display = "flex";
    updateWorkspaceHeader();
    loadApplicants();
  }
}

function restoreSessionLifecycle() {
  try {
    const savedUser = localStorage.getItem("dda_auth_user");
    const savedKey = localStorage.getItem("dda_booking_key");

    if (savedUser) {
      currentUser = JSON.parse(savedUser);
      if (savedKey) {
        activeBookingKey = savedKey;
        switchView("WORKSPACE");
        appendLog(
          "INFO",
          "Session",
          `Restored session for ${currentUser.email} with key ${activeBookingKey}`,
        );
        return;
      }
      switchView("KEY");
      return;
    }
  } catch (err) {
    console.error("Session restore error:", err);
  }
  switchView("LOGIN");
}

// ─── THEME CONTROLLER ──────────────────────────────────────────────────

function initTheme() {
  const savedTheme =
    localStorage.getItem("dda_app_theme") || settings.theme || "dark";
  applyTheme(savedTheme, false);
}

function applyTheme(theme, shouldPersist = true) {
  currentTheme = theme === "light" ? "light-theme" : "dark-theme";
  const cleanThemeName = theme === "light" ? "light" : "dark";

  document.body.className = currentTheme;
  const titleText = `Theme: ${cleanThemeName.toUpperCase()} Mode (Click to switch)`;
  [btnThemeToggleAuth, btnThemeToggleKey, btnThemeToggleWorkspace].forEach(
    (btn) => {
      if (btn) btn.setAttribute("title", titleText);
    },
  );

  if (shouldPersist) {
    localStorage.setItem("dda_app_theme", cleanThemeName);
    api.saveSettings({ theme: cleanThemeName }).catch(() => {});
    appendLog(
      "INFO",
      "Theme",
      `Switched theme to ${cleanThemeName.toUpperCase()} Mode`,
    );
  }
}

function toggleTheme() {
  const nextTheme = currentTheme === "dark-theme" ? "light" : "dark";
  applyTheme(nextTheme, true);
}

// ─── STAGE 1: AUTHENTICATION ───────────────────────────────────────────

async function handleLogin(email, password) {
  loginErrorAlert.style.display = "none";
  btnLoginSubmit.disabled = true;
  btnLoginSubmit.innerHTML = "<span>Authenticating...</span>";

  try {
    const res = await api.login(email, password);
    if (res.success && res.user) {
      currentUser = res.user;
      localStorage.setItem("dda_auth_user", JSON.stringify(currentUser));
      appendLog(
        "SUCCESS",
        "Auth",
        `Logged in as ${currentUser.name} (${currentUser.email})`,
      );
      welcomeLoginForm.reset();
      switchView("KEY");
    } else {
      loginErrorAlert.textContent =
        res.error || "Authentication failed. Please check credentials.";
      loginErrorAlert.style.display = "block";
    }
  } catch (err) {
    loginErrorAlert.textContent = `Sign in error: ${err.message}`;
    loginErrorAlert.style.display = "block";
  } finally {
    btnLoginSubmit.disabled = false;
    btnLoginSubmit.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
      Sign In to Continue
    `;
  }
}

function updateKeyUserBadge() {
  if (!currentUser) return;
  const name = currentUser.name || currentUser.email.split("@")[0];
  const initials = name.slice(0, 2).toUpperCase();
  keyUserInitials.textContent = initials;
  keyUserName.textContent = name;
  keyUserEmail.textContent = currentUser.email;

  const isAdmin = currentUser.isAdmin || currentUser.role === "admin";
  keyUserRole.textContent = isAdmin ? "ADMIN" : "USER";
  keyUserRole.style.color = isAdmin ? "var(--warning)" : "var(--primary)";
  keyUserRole.style.borderColor = isAdmin
    ? "rgba(245, 158, 11, 0.4)"
    : "rgba(99, 102, 241, 0.3)";
}

// ─── STAGE 2: BOOKING KEY VERIFICATION ─────────────────────────────────

async function handleVerifyKey(key) {
  keyErrorAlert.style.display = "none";
  btnVerifyKey.disabled = true;
  btnVerifyKey.innerHTML = "<span>Verifying Key...</span>";

  try {
    const res = await api.validateBookingKey(key, currentUser);
    if (res.success) {
      activeBookingKey = res.key;
      localStorage.setItem("dda_booking_key", activeBookingKey);
      appendLog(
        "SUCCESS",
        "Key",
        `Key ${activeBookingKey} verified. Scheme: ${res.scheme}`,
      );
      switchView("WORKSPACE");
    } else {
      keyErrorAlert.textContent =
        res.error || "Invalid booking key. Please check again.";
      keyErrorAlert.style.display = "block";
    }
  } catch (err) {
    keyErrorAlert.textContent = `Verification error: ${err.message}`;
    keyErrorAlert.style.display = "block";
  } finally {
    btnVerifyKey.disabled = false;
    btnVerifyKey.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
      Verify Key and Continue
    `;
  }
}

function handleLogout() {
  if (currentUser) {
    appendLog("INFO", "Auth", `User ${currentUser.email} logged out.`);
  }
  currentUser = null;
  activeBookingKey = null;
  localStorage.removeItem("dda_auth_user");
  localStorage.removeItem("dda_booking_key");
  switchView("LOGIN");
}

// ─── STAGE 3: WORKSPACE & TOP BAR MANAGEMENT ───────────────────────────

function updateWorkspaceHeader() {
  if (!currentUser) return;
  const name = currentUser.name || currentUser.email.split("@")[0];
  workspaceUserName.textContent = name;
  workspaceUserInitials.textContent = name.slice(0, 2).toUpperCase();
  workspaceKeyLabel.textContent = activeBookingKey || "ACTIVE";
}

async function loadSettings() {
  try {
    settings = await api.getSettings();
    toggleAutoSubmit.checked =
      settings.automationEnabled !== false &&
      settings.captchaAutoSubmitEnabled !== false;
    toggleCaptchaSolver.checked = settings.captchaAutoSolveEnabled !== false;
    selectAiModel.value = settings.aiModel || "gemini-3.5-flash-lite";
    inputSettleDelay.value = settings.settleDelayMs || 150;
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}

async function loadApplicants() {
  if (!currentUser) return;

  const start = performance.now();
  try {
    applicants = await api.getApplicantsByUser(currentUser);
    const durationMs = (performance.now() - start).toFixed(2);
    dbLatencyEl.textContent = `${durationMs}ms`;

    populateApplicantDropdown();
  } catch (err) {
    console.error("Failed to load applicants:", err);
  }
}

function populateApplicantDropdown() {
  selectActiveApplicant.innerHTML = "";

  if (applicants.length === 0) {
    selectActiveApplicant.innerHTML =
      '<option value="">No profiles found</option>';
    targetFlatsContainer.innerHTML =
      '<span style="color: var(--text-muted); font-size: 0.70rem;">No targets</span>';
    activeApplicant = null;
    return;
  }

  applicants.forEach((app) => {
    const pan = app.pan || app.personal?.pan;
    const name =
      `${app.personal?.firstName || "Applicant"} ${app.personal?.lastName || ""}`.trim();
    const opt = document.createElement("option");
    opt.value = pan;
    opt.textContent = `${name} (${pan})`;
    selectActiveApplicant.appendChild(opt);
  });

  const targetPan = activeApplicant ? activeApplicant.pan : applicants[0].pan;
  selectApplicant(targetPan);
}

function selectApplicant(pan) {
  activeApplicant =
    applicants.find((a) => (a.pan || a.personal?.pan) === pan) || applicants[0];
  if (!activeApplicant) return;

  selectActiveApplicant.value = activeApplicant.pan;

  // 1. Update Target Flats Queue in Top Bar
  const rawFlats = activeApplicant.preferences?.flatNo;
  const flats = Array.isArray(rawFlats) ? rawFlats : [rawFlats].filter(Boolean);

  if (flats.length > 0) {
    targetFlatsContainer.innerHTML = flats
      .map((f) => `<span class="flat-pill">🎯 ${f}</span>`)
      .join("");
  } else {
    targetFlatsContainer.innerHTML =
      '<span style="color: var(--text-muted); font-size: 0.70rem;">No flats</span>';
  }

  // 2. Update Partition Badges
  activePartitionLabel.textContent = `Partition: ${activeApplicant.pan}`;

  // 3. Update Webview Partition
  const cleanPartition = `persist:applicant_${activeApplicant.pan.toLowerCase()}`;
  if (webview.getAttribute("partition") !== cleanPartition) {
    webview.setAttribute("partition", cleanPartition);
  }

  appendLog(
    "INFO",
    "Applicant",
    `Active profile: ${activeApplicant.personal?.firstName || "User"} (${activeApplicant.pan})`,
  );
}

// ─── BROWSER VIEWPORT CONTROLS ─────────────────────────────────────────

function setupBrowserControls() {
  btnBrowserBack.addEventListener("click", () => {
    if (webview.canGoBack()) webview.goBack();
  });
  btnBrowserForward.addEventListener("click", () => {
    if (webview.canGoForward()) webview.goForward();
  });
  btnBrowserReload.addEventListener("click", () => webview.reload());

  if (btnNavLogin) {
    btnNavLogin.addEventListener("click", () =>
      webview.loadURL("https://eservices.dda.org.in/user"),
    );
  }
  if (btnNavSchemes) {
    btnNavSchemes.addEventListener("click", () =>
      webview.loadURL("https://eservices.dda.org.in/user/schemeList"),
    );
  }
  if (btnNavStep2) {
    btnNavStep2.addEventListener("click", () =>
      webview.loadURL("https://eservices.dda.org.in/user/step2_form"),
    );
  }

  webview.addEventListener("did-navigate", (e) => {
    browserCurrentUrl.textContent = e.url;
    appendLog("INFO", "Nav", `Navigated to ${e.url}`);
    injectPageAutomations();
  });

  webview.addEventListener("did-navigate-in-page", (e) => {
    browserCurrentUrl.textContent = e.url;
  });

  webview.addEventListener("dom-ready", () => {
    injectPageAutomations();
  });
}

// ─── DIRECT IN-BROWSER AUTOMATION ───────────────────────────────────────

function injectPageAutomations() {
  if (!currentUser || !activeApplicant) return;

  const pan = activeApplicant.pan;

  const injectionCode = `
    (() => {
      // 1. Autofill User ID on Login
      const userId = document.querySelector('input[name="user_id"]');
      if (userId && !userId.value) {
        userId.value = "${pan}";
        userId.dispatchEvent(new Event('input', { bubbles: true }));
        userId.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 2. Set comfortable zoom
      if (document.body && document.body.style.zoom !== '1.15') {
        document.body.style.zoom = '1.15';
      }
    })();
  `;

  webview.executeJavaScript(injectionCode).catch(() => {});
}

// ─── EVENT LISTENERS ───────────────────────────────────────────────────

function setupEventListeners() {
  // Theme Switchers
  [btnThemeToggleAuth, btnThemeToggleKey, btnThemeToggleWorkspace].forEach(
    (btn) => {
      if (btn) btn.addEventListener("click", toggleTheme);
    },
  );

  // Stage 1: Welcome Login
  welcomeLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;
    await handleLogin(email, password);
  });

  // Stage 2: Key Verification
  keyVerificationForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = inputBookingKey.value.trim();
    await handleVerifyKey(key);
  });


  btnKeyLogout.addEventListener("click", () => {
    currentUser = null;
    localStorage.removeItem("dda_auth_user");
    switchView("LOGIN");
  });

  // Stage 3: Workspace Actions
  btnWorkspaceLogout.addEventListener("click", handleLogout);

  selectActiveApplicant.addEventListener("change", (e) => {
    selectApplicant(e.target.value);
  });

  btnAddApplicant.addEventListener("click", openAddModal);
  btnEditActiveApp.addEventListener("click", () => {
    if (activeApplicant) openEditModal(activeApplicant.pan);
  });

  // Telemetry Modal
  btnOpenTelemetry.addEventListener("click", () => {
    telemetryModal.style.display = "flex";
  });
  btnCloseTelemetry.addEventListener("click", () => {
    telemetryModal.style.display = "none";
  });
  btnClearLogs.addEventListener("click", () => {
    terminalLogs.innerHTML = "";
    logCount = 0;
    telemetryLogCount.textContent = "0";
  });

  // Applicant Modal Controls
  btnCloseModal.addEventListener("click", closeModal);
  btnCancelModal.addEventListener("click", closeModal);
  chkJointApplicant.addEventListener("change", (e) => {
    jointFields.style.display = e.target.checked ? "block" : "none";
  });

  applicantForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleSaveApplicant();
  });

  // Top Bar Settings Handlers
  const saveCurrentSettings = async () => {
    if (!currentUser) return;
    const payload = {
      automationEnabled: toggleAutoSubmit.checked,
      captchaAutoSolveEnabled: toggleCaptchaSolver.checked,
      captchaAutoSubmitEnabled: toggleAutoSubmit.checked,
      aiModel: selectAiModel.value,
      settleDelayMs: parseInt(inputSettleDelay.value, 10) || 150,
    };
    await api.saveSettings(payload);
    appendLog(
      "INFO",
      "Config",
      `Settings saved: AI=${payload.aiModel}, Settle=${payload.settleDelayMs}ms`,
    );
  };

  toggleAutoSubmit.addEventListener("change", saveCurrentSettings);
  toggleCaptchaSolver.addEventListener("change", saveCurrentSettings);
  selectAiModel.addEventListener("change", saveCurrentSettings);
  inputSettleDelay.addEventListener("change", saveCurrentSettings);
}

// ─── MODAL LOGIC ───────────────────────────────────────────────────────

function openAddModal() {
  if (!currentUser) return;
  editingPan = null;
  modalTitle.textContent = "Add New Applicant";
  applicantForm.reset();
  document.getElementById("inp-pan").removeAttribute("disabled");
  jointFields.style.display = "none";
  applicantModal.style.display = "flex";
}

function openEditModal(pan) {
  if (!currentUser) return;
  const app = applicants.find((a) => (a.pan || a.personal?.pan) === pan);
  if (!app) return;

  editingPan = pan;
  modalTitle.textContent = `Edit Applicant (${pan})`;

  document.getElementById("inp-first-name").value =
    app.personal?.firstName || "";
  document.getElementById("inp-last-name").value = app.personal?.lastName || "";
  const panInput = document.getElementById("inp-pan");
  panInput.value = pan;
  panInput.setAttribute("disabled", "true");
  document.getElementById("inp-mobile").value = app.personal?.mobile || "";
  document.getElementById("inp-email").value = app.personal?.email || "";

  document.getElementById("inp-scheme").value =
    app.preferences?.scheme || "DDA HOUSING SCHEME 2026";
  document.getElementById("inp-locality").value =
    app.preferences?.locality || "";
  const rawFlats = app.preferences?.flatNo;
  document.getElementById("inp-flats").value = Array.isArray(rawFlats)
    ? rawFlats.join(", ")
    : rawFlats || "";

  const hasJoint = app.jointApplicant?.enabled;
  chkJointApplicant.checked = !!hasJoint;
  jointFields.style.display = hasJoint ? "block" : "none";
  document.getElementById("inp-joint-first-name").value =
    app.jointApplicant?.firstName || "";
  document.getElementById("inp-joint-pan").value =
    app.jointApplicant?.pan || "";

  applicantModal.style.display = "flex";
}

function closeModal() {
  applicantModal.style.display = "none";
}

async function handleSaveApplicant() {
  if (!currentUser) return;
  const pan =
    editingPan || document.getElementById("inp-pan").value.toUpperCase().trim();
  const rawFlats = document.getElementById("inp-flats").value;
  const flatsArray = rawFlats
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const payload = {
    pan,
    userId: currentUser.uid,
    userEmail: currentUser.email,
    personal: {
      firstName: document.getElementById("inp-first-name").value.trim(),
      lastName: document.getElementById("inp-last-name").value.trim(),
      pan,
      mobile: document.getElementById("inp-mobile").value.trim(),
      email: document.getElementById("inp-email").value.trim(),
    },
    preferences: {
      scheme: document.getElementById("inp-scheme").value.trim(),
      locality: document.getElementById("inp-locality").value.trim(),
      flatNo: flatsArray,
    },
    jointApplicant: {
      enabled: chkJointApplicant.checked,
      firstName: document.getElementById("inp-joint-first-name").value.trim(),
      pan: document.getElementById("inp-joint-pan").value.toUpperCase().trim(),
    },
  };

  await api.saveApplicant(payload, currentUser);
  appendLog(
    "SUCCESS",
    "DB",
    `Saved profile for ${payload.personal.firstName} (${pan})`,
  );
  closeModal();
  await loadApplicants();
  selectApplicant(pan);
}

// ─── LOG STREAMING ─────────────────────────────────────────────────────

function subscribeToLogs() {
  api.onSessionLog((log) => {
    appendLog(log.level || "INFO", log.page || "Session", log.msg);
  });
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

function appendLog(level, tag, msg) {
  logCount++;
  if (telemetryLogCount) telemetryLogCount.textContent = logCount;

  const entry = document.createElement("div");
  entry.className = `log-row ${(level || "info").toLowerCase()}`;
  const timeStr = format12HourTime();
  entry.innerHTML = `
    <span class="time">[${timeStr}]</span>
    <span class="msg">[${tag}] ${msg}</span>
  `;
  terminalLogs.appendChild(entry);
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

// Kick off
init();
