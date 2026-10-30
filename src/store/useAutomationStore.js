import { create } from 'zustand';
import { wsGet, wsSet } from '../utils/storageHelper';
import { serverNow } from '../utils/serverClock';

export const useAutomationStore = create((set, get) => ({
  isTimedActive: false,
  targetTime: (() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  })(),
  remainingSec: null,
  isSearching: false,
  huntSeconds: (() => {
    try {
      const stored = wsGet('dda_hunt_seconds');
      if (stored !== null && stored !== undefined) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) return parsed;
      }
      return 0; // Continuous by default
    } catch (_) {
      return 0;
    }
  })(),
  searchSeconds: 0, // Alias for huntSeconds (0 = Continuous)
  searchRemainingSec: null,
  isConsoleMinimized: true,
  isAutomationModesCollapsed: (() => {
    try {
      return wsGet('dda_automation_modes_collapsed') === 'true';
    } catch (_) {
      return false;
    }
  })(),
  isStep2SidebarCollapsed: (() => {
    try {
      return wsGet('dda_step2_sidebar_collapsed') === 'true';
    } catch (_) {
      return false;
    }
  })(),
  currentUrl: 'https://eservices.dda.org.in/user',
  isPageLoading: false,
  captchaDataUrl: null,
  captchaInputVal: '',
  lastSolvedCaptchaDataUrl: null,
  flatAvailability: {
    isFlatSelectPage: false,
    isGridLoaded: false,
    totalAvailable: 0,
    availableFlats: [],
    noneTargetAvailable: false,
    checkedAt: null
  },
  reservedFlatDetails: {
    flatNo: '',
    timerText: '',
    holdExpiresAt: null,
    applicantName: '',
    applicationMoney: '',
    locality: '',
    sector: '',
    pocket: '',
    block: '',
    floor: '',
    scheme: ''
  },
  logs: [],
  ddaAccountPan: '',
  // Auto TIMED: the admin's { startAt, dropAt } (runtime config), this
  // window's own off switch, and what this window is doing about it
  autoTimedConfig: null,
  autoTimedWindowOff: wsGet('dda_auto_timed_off') === 'true',
  autoTimedStatus: null, // { state, startMs, dropMs, pcClock }
  isMultiReloading: false,
  multiReloadAttempt: 0,
  // Latest navigation facts from the webview (read by the multi-reload engine)
  lastNavInfo: null, // { url, code } on did-navigate, or { failed:true, errorCode, errorDescription } on a failed load
  lastStopInfo: null, // { ts } on did-stop-loading
  lastRunLogPath: null,
  lastRunLogFileName: null,
  // Set on the hold page; while recent, gateway / bank pages show the payment sidebar.
  paymentFlowSince: 0,

  setReservedFlatDetails: (details) => set((state) => {
    const nextDetails = typeof details === 'function' ? details(state.reservedFlatDetails) : details;
    const merged = { ...state.reservedFlatDetails };
    for (const [k, v] of Object.entries(nextDetails || {})) {
      if (v !== undefined && v !== null && v !== '') {
        merged[k] = v;
      } else if (merged[k] === undefined || merged[k] === null) {
        merged[k] = v;
      }
    }
    return { reservedFlatDetails: merged };
  }),

  setPaymentFlowSince: (paymentFlowSince) => set({ paymentFlowSince }),
  setLastNavInfo: (lastNavInfo) => set({ lastNavInfo }),
  setLastStopInfo: (lastStopInfo) => set({ lastStopInfo }),
  setIsMultiReloading: (isMultiReloading) => set({ isMultiReloading }),
  // PAN of the DDA account this window's tab is logged in to ('' when unknown or logged out)
  setDdaAccountPan: (ddaAccountPan) => set({ ddaAccountPan: ddaAccountPan || '' }),
  setAutoTimedConfig: (cfg) => set({
    autoTimedConfig: cfg && cfg.startAt && cfg.dropAt ? { startAt: cfg.startAt, dropAt: cfg.dropAt } : null,
  }),
  setAutoTimedWindowOff: (off) => {
    try { wsSet('dda_auto_timed_off', off ? 'true' : 'false'); } catch (_) {}
    set({ autoTimedWindowOff: !!off });
  },
  setAutoTimedStatus: (autoTimedStatus) => set({ autoTimedStatus }),
  setMultiReloadAttempt: (multiReloadAttempt) => set({ multiReloadAttempt }),
  setLastRunLog: (path, name) => set({ lastRunLogPath: path, lastRunLogFileName: name }),

  setCaptchaDataUrl: (captchaDataUrl) => set({ captchaDataUrl }),
  setCaptchaInputVal: (captchaInputVal) => set({ captchaInputVal }),
  setLastSolvedCaptchaDataUrl: (lastSolvedCaptchaDataUrl) => set({ lastSolvedCaptchaDataUrl }),
  setFlatAvailability: (flatAvailability) => set({
    flatAvailability: typeof flatAvailability === 'function' 
      ? flatAvailability(get().flatAvailability) 
      : { ...get().flatAvailability, ...flatAvailability }
  }),

  setTimedActive: (isActive) => {
    const nextVal = typeof isActive === 'function' ? isActive(get().isTimedActive) : (typeof isActive === 'boolean' ? isActive : !get().isTimedActive);
    set({ isTimedActive: nextVal });
  },

  setTargetTime: (targetTime) => set({ targetTime }),

  setRemainingSec: (remainingSec) => set({ remainingSec }),

  setIsSearching: (isSearching) => {
    const nextVal = typeof isSearching === 'function' ? isSearching(get().isSearching) : (typeof isSearching === 'boolean' ? isSearching : !get().isSearching);
    set({ isSearching: nextVal });
  },

  setHuntSeconds: (huntSeconds) => {
    const parsed = parseInt(huntSeconds, 10);
    const val = !isNaN(parsed) ? parsed : 0;
    try {
      wsSet('dda_hunt_seconds', String(val));
    } catch (_) {}
    set({ huntSeconds: val, searchSeconds: val });
  },
  setSearchSeconds: (sec) => {
    const parsed = parseInt(sec, 10);
    const val = !isNaN(parsed) ? parsed : 0;
    try {
      wsSet('dda_hunt_seconds', String(val));
    } catch (_) {}
    set({ huntSeconds: val, searchSeconds: val });
  },

  setSearchRemainingSec: (searchRemainingSec) => set({ searchRemainingSec }),

  setIsConsoleMinimized: (isConsoleMinimized) => {
    const nextVal = typeof isConsoleMinimized === 'function' 
      ? isConsoleMinimized(get().isConsoleMinimized) 
      : (typeof isConsoleMinimized === 'boolean' ? isConsoleMinimized : !get().isConsoleMinimized);
    set({ isConsoleMinimized: nextVal });
  },

  setIsAutomationModesCollapsed: (isAutomationModesCollapsed) => {
    const nextVal = typeof isAutomationModesCollapsed === 'function' 
      ? isAutomationModesCollapsed(get().isAutomationModesCollapsed) 
      : (typeof isAutomationModesCollapsed === 'boolean' ? isAutomationModesCollapsed : !get().isAutomationModesCollapsed);
    try {
      wsSet('dda_automation_modes_collapsed', String(nextVal));
    } catch (_) {}
    set({ isAutomationModesCollapsed: nextVal });
  },

  setIsStep2SidebarCollapsed: (isStep2SidebarCollapsed) => {
    const nextVal = typeof isStep2SidebarCollapsed === 'function' 
      ? isStep2SidebarCollapsed(get().isStep2SidebarCollapsed) 
      : (typeof isStep2SidebarCollapsed === 'boolean' ? isStep2SidebarCollapsed : !get().isStep2SidebarCollapsed);
    try {
      wsSet('dda_step2_sidebar_collapsed', String(nextVal));
    } catch (_) {}
    set({ isStep2SidebarCollapsed: nextVal });
  },

  setCurrentUrl: (currentUrl) => set({ currentUrl }),

  setPageLoading: (isPageLoading) => set({ isPageLoading }),

  addLog: (type, source, message, pan) => {
    // Server time (the Worker's clock), like TIMED: a PC clock a few seconds off
    // would otherwise make the console look early or late against the admin's time
    const now = serverNow();
    const d = new Date(now);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const timeStr = `${h12}:${m}:${s}.${ms} ${ap}`;
    const formattedMsg = typeof message === 'object' ? JSON.stringify(message) : String(message || '');
    const logType = (type || 'INFO').toUpperCase();
    const logSource = source || 'System';

    // Deduplication guard: drop identical messages arriving within 1500ms
    const last = get().lastLoggedEvent;
    if (last && last.message === formattedMsg && (now - last.time) < 1500) {
      return;
    }
    set({ lastLoggedEvent: { message: formattedMsg, time: now } });

    // ⚡ Real-Time DevTools Browser Console Output
    // Only the main parts (ERROR, WARN, SUCCESS, MILESTONE, OCR) have colorful badges.
    // Routine logs (INFO, ACTION, system traces, heartbeats) remain clean and uncolored.
    const isMilestone = formattedMsg.includes('Milestone') || formattedMsg.includes('📍');
    const isOcr = logType === 'OCR' || formattedMsg.includes('Captcha Solved');

    if (logType === 'ERROR') {
      console.error(
        `%c[ERROR]%c [${timeStr}] [${logSource}]${pan ? ' (' + pan + ')' : ''} ${formattedMsg}`,
        'color: #ef4444; font-weight: bold;',
        'color: inherit; font-weight: normal;'
      );
    } else if (logType === 'WARN') {
      console.warn(
        `%c[WARN]%c [${timeStr}] [${logSource}]${pan ? ' (' + pan + ')' : ''} ${formattedMsg}`,
        'color: #f59e0b; font-weight: bold;',
        'color: inherit; font-weight: normal;'
      );
    } else if (logType === 'SUCCESS') {
      console.log(
        `%c[SUCCESS]%c [${timeStr}] [${logSource}]${pan ? ' (' + pan + ')' : ''} ${formattedMsg}`,
        'color: #10b981; font-weight: bold;',
        'color: inherit; font-weight: normal;'
      );
    } else if (isMilestone) {
      console.log(
        `%c[MILESTONE]%c [${timeStr}] [${logSource}]${pan ? ' (' + pan + ')' : ''} ${formattedMsg}`,
        'color: #8b5cf6; font-weight: bold;',
        'color: inherit; font-weight: normal;'
      );
    } else if (isOcr) {
      console.log(
        `%c[OCR]%c [${timeStr}] [${logSource}]${pan ? ' (' + pan + ')' : ''} ${formattedMsg}`,
        'color: #06b6d4; font-weight: bold;',
        'color: inherit; font-weight: normal;'
      );
    } else {
      // Standard uncolored log for routine events (INFO, search, heartbeats, actions)
      console.log(`[${timeStr}] [${logType}] [${logSource}]${pan ? ' (' + pan + ')' : ''} ${formattedMsg}`);
    }

    const newEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: timeStr,
      type: logType,
      source: logSource,
      message: formattedMsg,
      pan: pan || null
    };

    // Keep the latest 500. When full, drop the oldest flat-search check line
    // ("Searching for target flats ... #N") first, so a long search can't push
    // out the useful lines (Apply, form, locality, captcha, reservation).
    set((state) => {
      const logs = [...state.logs, newEntry];
      if (logs.length > 500) {
        const i = logs.findIndex((l) => l.message.startsWith('Searching for target flats'));
        logs.splice(i >= 0 && i < logs.length - 1 ? i : 0, 1);
      }
      return { logs };
    });
  },

  clearLogs: () => set({ logs: [] })
}));
