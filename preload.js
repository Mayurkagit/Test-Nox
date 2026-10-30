// Preload script for DDA Electron Automation Suite Dashboard UI (ESM)
import { contextBridge, ipcRenderer } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ddaPreloadUrl = 'file:///' + path.join(__dirname, 'preload-dda.js').replace(/\\/g, '/').replace(/^file:\/\/\/?/, '');

contextBridge.exposeInMainWorld('ddaElectronAPI', {
  // Synchronous Preload URL for Webview
  ddaPreloadUrl: ddaPreloadUrl,

  // Authentication & Users
  login: (email, password) => ipcRenderer.invoke('auth:login', email, password),
  validateBookingKey: (key, user) => ipcRenderer.invoke('auth:validateBookingKey', key, user),
  authenticateToken: (token) => ipcRenderer.invoke('session:authenticateToken', token),
  clearActiveUser: () => ipcRenderer.invoke('session:clearActiveUser'),
  setActiveUser: (user) => ipcRenderer.invoke('session:setActiveUser', user),
  getActiveUser: () => ipcRenderer.invoke('session:getActiveUser'),

  // Applicants CRUD (Offline Local DB)
  getApplicants: (user) => ipcRenderer.invoke('db:getApplicants', user),
  getApplicantsByUser: (user) => ipcRenderer.invoke('db:getApplicantsByUser', user),
  getApplicantByPan: (pan, user) => ipcRenderer.invoke('db:getApplicantByPan', pan, user),
  saveApplicant: (applicant, user) => ipcRenderer.invoke('db:saveApplicant', applicant, user),
  deleteApplicant: (pan, user) => ipcRenderer.invoke('db:deleteApplicant', pan, user),
  setActiveApplicant: (applicant, sessionId) => ipcRenderer.invoke('session:setActiveApplicant', applicant, sessionId),
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
  clearHashes: () => ipcRenderer.invoke('session:clearHashes'),

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
  warmupCaptcha: () => ipcRenderer.invoke('captcha:warmup')
});
