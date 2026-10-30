// Preload script for DDA Electron Automation Suite Dashboard UI
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

const ddaPreloadUrl = 'file:///' + path.join(__dirname, 'preload-dda.js').replace(/\\/g, '/').replace(/^file:\/\/\/?/, '');

contextBridge.exposeInMainWorld('ddaElectronAPI', {
  // Synchronous Preload URL for Webview
  ddaPreloadUrl: 'file:///' + path.join(__dirname, 'preload-dda.js').replace(/\\/g, '/').replace(/^file:\/\/\/?/, ''),

  // Authentication & Users
  login: (email, password) => ipcRenderer.invoke('auth:login', email, password),
  validateBookingKey: (key, user) => ipcRenderer.invoke('auth:validateBookingKey', key, user),
  authenticateToken: (token) => ipcRenderer.invoke('session:authenticateToken', token),
  clearActiveUser: () => ipcRenderer.invoke('session:clearActiveUser'),
  setActiveUser: (user) => ipcRenderer.invoke('session:setActiveUser', user),
  getActiveUser: () => ipcRenderer.invoke('session:getActiveUser'),

  // Fast Payment card (encrypted in main; only a masked summary comes back)
  savePaymentCard: (card) => ipcRenderer.invoke('payment:saveCard', card),
  listPaymentCards: () => ipcRenderer.invoke('payment:listCards'),
  removePaymentCard: (id) => ipcRenderer.invoke('payment:removeCard', id),
  // The applicant's website card edited on this PC (masked summaries only)
  listApplicantCardEdits: () => ipcRenderer.invoke('payment:listApplicantCardEdits'),
  saveApplicantCardEdit: (edit) => ipcRenderer.invoke('payment:saveApplicantCardEdit', edit),
  removeApplicantCardEdit: (pan) => ipcRenderer.invoke('payment:removeApplicantCardEdit', pan),
  // Saved net-banking logins: the dashboard only sees hosts and masked IDs.
  listBankLogins: () => ipcRenderer.invoke('banklogin:list'),
  deleteBankLogin: (host) => ipcRenderer.invoke('banklogin:delete', host),
  addBankLogin: (login) => ipcRenderer.invoke('banklogin:add', login),
  exportBankLogins: () => ipcRenderer.invoke('banklogin:export'),
  importBankLogins: () => ipcRenderer.invoke('banklogin:import'),
  respondBankLoginOffer: (id, action) => ipcRenderer.invoke('banklogin:respond', { id, action }),
  onBankLoginOffer: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('banklogin:offer', listener);
    return () => ipcRenderer.removeListener('banklogin:offer', listener);
  },
  onBankLoginsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('banklogin:changed', listener);
    return () => ipcRenderer.removeListener('banklogin:changed', listener);
  },

  // One TIMED line in the run trace (arm / wake / start, server and PC times)
  timedTrace: (msg) => ipcRenderer.send('timed:trace', String(msg || '')),

  // Booking window expiry (main process decides for all windows)
  setBookingWindowEnd: (iso) => ipcRenderer.send('auth:setBookingWindowEnd', iso || null),
  reportBookingBusy: (busy, what) => ipcRenderer.send('auth:reportBookingBusy', { busy: Boolean(busy), what: String(what || '') }),
  // App sign-out covers every window: who is mid-booking, then tell the others
  getBusyWindows: () => ipcRenderer.invoke('auth:getBusyWindows'),
  signedOutAll: () => ipcRenderer.send('auth:signedOutAll'),
  onSignedOut: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('auth:signed-out', listener);
    return () => ipcRenderer.removeListener('auth:signed-out', listener);
  },
  onBookingWindowExpired: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('auth:booking-window-expired', listener);
    return () => ipcRenderer.removeListener('auth:booking-window-expired', listener);
  },

  // Applicants CRUD (Offline Local DB)
  getApplicants: (user) => ipcRenderer.invoke('db:getApplicants', user),
  getApplicantsByUser: (user) => ipcRenderer.invoke('db:getApplicantsByUser', user),
  getApplicantByPan: (pan, user) => ipcRenderer.invoke('db:getApplicantByPan', pan, user),
  saveApplicant: (applicant, user) => ipcRenderer.invoke('db:saveApplicant', applicant, user),
  cacheApplicants: (list, opts) => ipcRenderer.invoke('db:cacheApplicants', list, opts),
  uncacheApplicants: (pans) => ipcRenderer.invoke('db:uncacheApplicants', pans),
  getLocalPrefs: () => ipcRenderer.invoke('db:getLocalPrefs'),
  saveLocalPrefs: (pan, entry) => ipcRenderer.invoke('db:saveLocalPrefs', pan, entry),
  clearLocalPrefs: () => ipcRenderer.invoke('db:clearLocalPrefs'),
  deleteApplicant: (pan, user) => ipcRenderer.invoke('db:deleteApplicant', pan, user),
  setActiveApplicant: (applicant, sessionId) => ipcRenderer.invoke('session:setActiveApplicant', applicant, sessionId),
  // The window's own logged-in applicant's card / net-banking login (memory only; null clears)
  setPaymentDetails: (details) => ipcRenderer.invoke('payment:setApplicantDetails', details),
  getActiveApplicant: () => ipcRenderer.invoke('session:getApplicantData'),
  loadLoginUsers: () => ipcRenderer.invoke('db:loadLoginUsers'),
  saveLoginUsers: (users) => ipcRenderer.invoke('db:saveLoginUsers', users),

  // Settings
  getSettings: (winSession) => ipcRenderer.invoke('db:getSettings', winSession),
  saveSettings: (settings, winSession) => ipcRenderer.invoke('db:saveSettings', settings, winSession),

  // Historical Runs & Telemetry
  getBookingRuns: () => ipcRenderer.invoke('db:getBookingRuns'),
  saveBookingRun: (run) => ipcRenderer.invoke('db:saveBookingRun', run),
  saveAnalytics: (payload) => ipcRenderer.invoke('analytics:save', payload),
  openLogFile: (filePath) => ipcRenderer.invoke('logs:openFile', filePath),
  openLogsFolder: (folderPath) => ipcRenderer.invoke('logs:openFolder', folderPath),

  // Multi-Session Launcher
  createDashboardWindow: () => ipcRenderer.invoke('window:createDashboard'),
  setWindowTitle: (title) => ipcRenderer.invoke('window:setTitle', title).catch(() => {}),
  getDisplayIndex: () => ipcRenderer.invoke('window:getDisplayIndex').catch(() => 1),
  listOpenWindowSessions: () => ipcRenderer.invoke('window:listOpenSessions').catch(() => []),
  takeLockStartupPlan: () => ipcRenderer.invoke('window:takeLockStartupPlan').catch(() => null),
  clearOwnDdaLogin: () => ipcRenderer.invoke('window:clearOwnDdaLogin').catch(() => false),
  onDisplayIndexUpdated: (callback) => {
    const listener = (_event, idx) => callback(idx);
    ipcRenderer.on('window:display-index-updated', listener);
    return () => ipcRenderer.removeListener('window:display-index-updated', listener);
  },
  launchDdaSession: (pan) => ipcRenderer.invoke('session:launch', pan),
  closeDdaSession: (pan) => ipcRenderer.invoke('session:close', pan),
  getActiveSessions: () => ipcRenderer.invoke('session:getActive'),
  clearDdaSession: () => ipcRenderer.invoke('session:clearDdaSession'),
  // The app's login, kept encrypted for signing in to the web portal window (deleted on sign-out)
  saveAppLogin: (login) => ipcRenderer.invoke('applogin:save', login),
  clearAppLogin: () => ipcRenderer.invoke('applogin:clear'),
  openWebPortal: () => ipcRenderer.invoke('portal:open'),
  clearHashes: () => ipcRenderer.invoke('session:clearHashes'),
  // Stop an Apply re-try in this window's DDA webview (see main.js "Apply re-try Stop")
  stopApplyRetry: (webContentsId) => ipcRenderer.send('apply:stopFor', webContentsId),
  flatPageWait: (webContentsId) => ipcRenderer.invoke('dda:flatPageWaitFor', webContentsId),

  // Live IPC Log Listener
  onSessionLog: (callback) => {
    const listener = (_event, log) => callback(log);
    ipcRenderer.on('dda:session-log', listener);
    return () => ipcRenderer.removeListener('dda:session-log', listener);
  },

  // Reset Run Logs Listener (Schemes page reset)
  onResetRunLogs: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('dda:reset-run-logs', listener);
    return () => ipcRenderer.removeListener('dda:reset-run-logs', listener);
  },

  // Analytics Dispatched Listener
  onAnalyticsDispatched: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('dda:analytics-dispatched', listener);
    return () => ipcRenderer.removeListener('dda:analytics-dispatched', listener);
  },

  // Flat Availability Listener (Step 2 Flat Select)
  onFlatAvailability: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('dda:flat-availability', listener);
    return () => ipcRenderer.removeListener('dda:flat-availability', listener);
  },

  // Flat Selected Audio / Reservation Listener
  onFlatSelected: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('dda:flat-selected', listener);
    return () => ipcRenderer.removeListener('dda:flat-selected', listener);
  },

  // Payment Hold Info Listener
  onPaymentHoldInfo: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('dda:payment-hold-info', listener);
    return () => ipcRenderer.removeListener('dda:payment-hold-info', listener);
  },

  // Applicant Logout Listener (DDA Portal Logout)
  onApplicantLogout: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('dda:applicant-logout', listener);
    return () => ipcRenderer.removeListener('dda:applicant-logout', listener);
  },

  // Authenticated Portal User Login Listener
  onUserLoggedIn: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('dda:user-logged-in', listener);
    return () => ipcRenderer.removeListener('dda:user-logged-in', listener);
  },

  // Save Password Prompt Listener
  onPromptSavePassword: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('dda:prompt-save-password', listener);
    return () => ipcRenderer.removeListener('dda:prompt-save-password', listener);
  },

  // Update Profile Name Listener
  onUpdateProfileName: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('dda:update-profile-name', listener);
    return () => ipcRenderer.removeListener('dda:update-profile-name', listener);
  },

  // Native ONNX & Cloud Captcha Engine
  solveCaptchaLocal: (payload) => ipcRenderer.invoke('captcha:solveLocal', payload),
  warmupCaptcha: () => ipcRenderer.invoke('captcha:warmup'),

  // Network Optimization (TCP Pre-Connect & DNS Resolver)
  preconnect: (url, partitionKey) => {
    try {
      return ipcRenderer.invoke('session:preconnect', url, partitionKey).catch((err) => ({ success: false, error: err?.message }));
    } catch (err) {
      return Promise.resolve({ success: false, error: err?.message });
    }
  }
});

