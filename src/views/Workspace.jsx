import React, { useState, useEffect, useRef } from 'react';
import { useApplicantStore, useAutomationStore, useAuthStore, useSettingsStore, KNOWN_APPLICANT_PASSWORDS, activeLoginUsers } from '../store';
import { createMultiReloadEngine } from '../utils/multiReload';
import { flatKey } from '../utils/flatKey';
import RightControlSidebar from '../components/RightControlSidebar';
import DdaWebview from '../components/DdaWebview';
import ApplicantModal from '../components/ApplicantModal';
import ApplicantDetailsModal from '../components/ApplicantDetailsModal';
import AddUserModal from '../components/AddUserModal';
import EditUsersModal from '../components/EditUsersModal';
import { api } from '../services/api';
import { initRealtimeSync } from '../services/realtimeSync.js';
import { ddaAutomations } from '../utils/ddaAutomations';
import { serverNow, getServerOffsetMs, timedTrace } from '../utils/serverClock';
import { detectDdaStage, getSidebarMode, isDdaPaymentPage } from '../utils/ddaRoutes';
import StageRail from '../components/StageRail';
import RunStatusChip from '../components/RunStatusChip';
import { wsGet, wsSet, wsRemove } from '../utils/storageHelper';
import { describeFastPayment } from '../utils/paymentBanks';
import { findLockedLogin, getLockedLoginPan, useLockedLoginPan } from '../utils/loginLock';
import { useBookingWindowExpiry, applyBookingWindowEnd, markBookingWindowExpired } from '../hooks/useBookingWindowExpiry';
import { useAutoTimed, markAutoTimedStopped } from '../hooks/useAutoTimed';
import { LogOut, ChevronLeft, ChevronRight, KeyRound, X, LogIn } from 'lucide-react';
import { useSidebarSide } from '../utils/sidebarSide';
import { useDdaSidebarHidden } from '../utils/ddaSidebar';

// For the booking record: the target flats of this window's selected applicant (what Search
// used) and whether they are this computer's own edit ("local") or the server's list.
function targetFlatsForRecord() {
  try {
    const st = useApplicantStore.getState();
    const app = st.activeApplicant;
    const pan = String(app?.pan || app?.personal?.pan || '').toUpperCase().trim();
    const raw = app?.preferences?.flatNo ?? app?.preferences?.flats ?? [];
    const targetFlats = (Array.isArray(raw) ? raw : String(raw).split(','))
      .map((f) => String(f).trim().toUpperCase())
      .filter(Boolean);
    const localPrefs = pan ? st.localPrefs?.[pan]?.preferences : null;
    const isLocal = !!localPrefs && (Object.prototype.hasOwnProperty.call(localPrefs, 'flatNo') || Object.prototype.hasOwnProperty.call(localPrefs, 'flats'));
    return { targetFlats, targetFlatsSource: isLocal ? 'local' : 'server' };
  } catch (_) {
    return { targetFlats: [], targetFlatsSource: '' };
  }
}

export default function Workspace() {
  const activeApplicant = useApplicantStore((s) => s.activeApplicant);
  const activeScheme = useApplicantStore((s) => s.activeScheme);
  const setActiveScheme = useApplicantStore((s) => s.setActiveScheme);
  const setSchemes = useApplicantStore((s) => s.setSchemes);
  const loadApplicants = useApplicantStore((s) => s.loadApplicants);
  const user = useAuthStore((s) => s.user);
  const activeKey = useAuthStore((s) => s.activeKey);
  const currentUrl = useAutomationStore((s) => s.currentUrl);
  const isPageLoading = useAutomationStore((s) => s.isPageLoading);
  const setTimedActive = useAutomationStore((s) => s.setTimedActive);
  const setIsSearching = useAutomationStore((s) => s.setIsSearching);
  const setSearchRemainingSec = useAutomationStore((s) => s.setSearchRemainingSec);
  const addLog = useAutomationStore((s) => s.addLog);
  const isStep2SidebarCollapsed = useAutomationStore((s) => s.isStep2SidebarCollapsed);
  const paymentFlowSince = useAutomationStore((s) => s.paymentFlowSince);
  const setIsStep2SidebarCollapsed = useAutomationStore((s) => s.setIsStep2SidebarCollapsed);
  const isMultiReloading = useAutomationStore((s) => s.isMultiReloading);
  const multiReloadAttempt = useAutomationStore((s) => s.multiReloadAttempt);
  const settings = useSettingsStore((s) => s.settings);

  // Normal users are logged out when the booking window ends (admins never)
  const isAdminSession = Boolean(
    user?.isAdmin === true ||
    user?.role === 'admin' ||
    localStorage.getItem('dda_is_admin') === 'true' ||
    localStorage.getItem('dda_user_role') === 'admin'
  );
  useBookingWindowExpiry({ user, isAdmin: isAdminSession, currentUrl });
  // The admin's Auto TIMED: starts TIMED by itself at the set time (see hooks/useAutoTimed.js)
  useAutoTimed({ hasApplicant: Boolean(activeApplicant) });

  // Floating Save Password Modal State (Chrome-style credential prompt)
  const [savePasswordPrompt, setSavePasswordPrompt] = useState({
    open: false,
    pan: '',
    password: ''
  });

  const loginUsers = useApplicantStore((s) => s.loginUsers);

  // Window-scoped Session Identifier (Window 1 = session_1, Window 2 = session_2, etc.)
  const winSession = React.useMemo(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const s = sp.get('winSession');
      if (s) {
        sessionStorage.setItem('dda_win_session', s);
        return s;
      }
      return sessionStorage.getItem('dda_win_session') || 'session_1';
    } catch (_) {
      return 'session_1';
    }
  }, []);

  const sessionNum = winSession?.replace('session_', '') || '1';
  const [displayIndex, setDisplayIndex] = useState(() => {
    return parseInt(sessionNum, 10) || 1;
  });

  useEffect(() => {
    window.ddaElectronAPI?.getDisplayIndex?.().then((idx) => {
      if (typeof idx === 'number' && idx > 0) setDisplayIndex(idx);
    }).catch(() => {});

    const unsubscribe = window.ddaElectronAPI?.onDisplayIndexUpdated?.((idx) => {
      if (typeof idx === 'number' && idx > 0) {
        setDisplayIndex(idx);
      }
    });
    return () => unsubscribe?.();
  }, []);

  // ─── DYNAMIC TITLE BAR (WINDOW NUMBER & LOGGED-IN APPLICANT NAME) ─────
  useEffect(() => {
    const isLogin = detectDdaStage(currentUrl).id === 'LOGIN';
    const applicantName = (!isLogin && activeApplicant)
      ? ([activeApplicant.personal?.firstName, activeApplicant.personal?.lastName].filter(Boolean).join(' ') || activeApplicant.name || activeApplicant.pan || '')
      : '';
    const titleText = applicantName
      ? `Northdesk - Window ${displayIndex} - ${applicantName}`
      : `Northdesk - Window ${displayIndex}`;

    document.title = titleText;
    try {
      window.ddaElectronAPI?.setWindowTitle?.(titleText)?.catch?.(() => {});
    } catch (_) {}
  }, [winSession, activeApplicant, currentUrl, displayIndex]);

  // Dedicated Independent Login Applicant State (Scoped per-window in sessionStorage)
  // Archived logins are never picked for the login form.
  const [selectedLoginApplicant, setSelectedLoginApplicant] = useState(() => {
    const locked = findLockedLogin(useApplicantStore.getState().loginUsers);
    if (locked) return locked;
    const list = activeLoginUsers(useApplicantStore.getState().loginUsers);
    const lastPan = (
      sessionStorage.getItem('dda_last_selected_login_pan') ||
      ''
    ).toUpperCase().trim();
    if (lastPan) {
      const found = list.find(a => (a.pan || '').toUpperCase().trim() === lastPan);
      if (found) return found;
    }
    return null; // nothing chosen: never silently the first in the list
  });

  // Keep selectedLoginApplicant in sync with loginUsers per-window
  const lockedLoginPan = useLockedLoginPan();
  useEffect(() => {
    const locked = findLockedLogin(loginUsers);
    if (locked) {
      setSelectedLoginApplicant(locked);
      return;
    }
    const active = activeLoginUsers(loginUsers);
    if (active.length === 0) return;
    setSelectedLoginApplicant((prev) => {
      const cleanPrevPan = (prev?.pan || '').toUpperCase().trim();
      if (cleanPrevPan && active.some(u => (u.pan || '').toUpperCase().trim() === cleanPrevPan)) {
        return prev;
      }
      const lastPan = (
        sessionStorage.getItem('dda_last_selected_login_pan') ||
        ''
      ).toUpperCase().trim();
      if (lastPan) {
        const found = active.find(u => (u.pan || '').toUpperCase().trim() === lastPan);
        if (found) return found;
      }
      return null;
    });
  }, [loginUsers, lockedLoginPan]);

  const webviewRef = useRef(null);
  const hasMatchedLoginRef = useRef(false);
  const lastHandledAuthPanRef = useRef(null);
  const lastSyncedPanRef = useRef(null);
  const lastAutoTransitionRef = useRef({
    hadNoTargets: null,
    wasNoneAvailable: null,
    wasModalOpen: null,
    enteredStage: null
  });
  const prevStageRef = useRef(null);

  const isSearching = useAutomationStore((s) => s.isSearching);
  useEffect(() => {
    if (isSearching) {
      // Re-arm unavailable detection when a new search starts
      lastAutoTransitionRef.current.wasNoneAvailable = false;
    }
  }, [isSearching]);

  // Sync pre-filled fast-pass setting to webview localStorage
  useEffect(() => {
    const isFastPass = (typeof settings?.prefilledFastPass === 'boolean' ? settings.prefilledFastPass : wsGet('dda_prefilled_fastpass') === 'true');
    try {
      webviewRef.current?.executeJavaScript?.(`localStorage.setItem('dda_prefilled_fastpass', ${isFastPass ? '"true"' : '"false"'});`);
    } catch (_) {}
  }, [settings?.prefilledFastPass]);

  // Load applicants & login users vault on mount (this computer's copy: the
  // server is asked at sign-in and on refresh)
  useEffect(() => {
    useApplicantStore.getState().loadLoginUsers?.();
    if (user) {
      loadApplicants(user, { fromServer: false });
    }
  }, [user, loadApplicants]);

  // The light list has no files: the window's applicant gets its full record
  // (photo, signature, documents) first thing
  const activePan = activeApplicant?.pan || '';
  const activeIsLight = Boolean(activeApplicant?._light);
  useEffect(() => {
    if (user && activePan && activeIsLight) useApplicantStore.getState().ensureFullRecord(user, activePan);
  }, [user, activePan, activeIsLight]);

  // The applicant to fill a form with. DDA no longer asks for a photo and signature (25 Oct 2026),
  // so this no longer waits up to 6 s for those files: the form fills straight away. The download
  // still runs in the background (the ensureFullRecord effect above and the store's
  // backfillMissingFiles), because the applicant's documents need those files.
  const withFullRecord = async (applicant) => applicant;

  // Real-Time Live Sync Engine (Firestore onSnapshot + Cloudflare Worker SSE Push + Fallback)
  useEffect(() => {
    if (!user) return;
    const cleanup = initRealtimeSync(user);
    return () => cleanup?.();
  }, [user]);

  // Periodic 1-minute Cloudflare Worker config sync (active schemes, mode, window expiry)
  useEffect(() => {
    const syncWorker = async () => {
      try {
        const config = await api.syncRealtimeConfig(activeKey, user);
        if (config?.expired) {
          // Worker refused the key (window ended early, key rotated, user removed)
          markBookingWindowExpired();
          return;
        }
        if (config) {
          if (config.windowEnd) applyBookingWindowEnd(config.windowEnd);
          if (config.schemes && config.schemes.length > 0) {
            const cleanSchemes = config.schemes.filter(s => s && !s.toLowerCase().includes('admin_bypass') && s.toLowerCase() !== 'admin');
            if (cleanSchemes.length > 0) {
              setSchemes(cleanSchemes);
            }
          }
          const isAdminUser = Boolean(
            user?.role === 'admin' ||
            user?.isAdmin === true ||
            user?.admin === true ||
            (typeof window !== 'undefined' && (
              localStorage.getItem('dda_is_admin') === 'true' ||
              localStorage.getItem('dda_user_role') === 'admin'
            ))
          );

          // Target scheme is strictly locked to worker sent active scheme for normal users
          if (config.targetScheme && !config.targetScheme.toLowerCase().includes('admin_bypass') && config.targetScheme.toLowerCase() !== 'admin') {
            if (!isAdminUser) {
              setActiveScheme(config.targetScheme);
              wsSet('dda_target_scheme', config.targetScheme);
              wsSet('dda_selected_scheme', config.targetScheme);
              wsSet('dda_active_scheme_name', config.targetScheme);
            } else {
              const current = wsGet('dda_selected_scheme') || useApplicantStore.getState().activeScheme || wsGet('dda_target_scheme');
              if (!current) {
                setActiveScheme(config.targetScheme);
                wsSet('dda_target_scheme', config.targetScheme);
                wsSet('dda_selected_scheme', config.targetScheme);
                wsSet('dda_active_scheme_name', config.targetScheme);
              }
            }
          }
          if (config.mode) {
            useSettingsStore.getState().updateSettings({ isTestingMode: config.mode === 'TESTING' });
          }
        }
      } catch (err) {
        console.warn('Worker sync error:', err);
      }
    };

    syncWorker();
    const interval = setInterval(syncWorker, 60000);
    return () => clearInterval(interval);
  }, [activeKey, user, setSchemes, setActiveScheme]);

  // Listen to IPC logs from isolated partition session windows
  useEffect(() => {
    if (window.ddaElectronAPI?.onSessionLog) {
      const unsubscribe = window.ddaElectronAPI.onSessionLog((log) => {
        addLog(log.level || 'INFO', log.page || 'Session', log.msg || log.message || JSON.stringify(log), log.pan || log.userId || null);
      });
      return () => unsubscribe?.();
    }
  }, [addLog]);

  // Listen to Schemes page reset event from Electron main process
  useEffect(() => {
    if (window.ddaElectronAPI?.onResetRunLogs) {
      const unsub = window.ddaElectronAPI.onResetRunLogs(() => {
        // Retain heartbeat keep-alive messages across resets so they remain visible
        useAutomationStore.setState((state) => ({
          logs: state.logs.filter((l) => l.source === 'Heartbeat' || (l.message || '').includes('💓 Ping'))
        }));
        const reportKey = `dda_reported_${activeApplicant?.pan || 'app'}`;
        try { sessionStorage.removeItem(reportKey); } catch (_) {}
        window.__ddaAnalyticsDispatched = false;
      });
      return () => unsub?.();
    }
  }, [activeApplicant]);

  // Listen to analytics dispatched event from webview engine
  useEffect(() => {
    if (window.ddaElectronAPI?.onAnalyticsDispatched) {
      const unsub = window.ddaElectronAPI.onAnalyticsDispatched(async (payload) => {
        window.__ddaAnalyticsDispatched = true;
        const reportKey = `dda_reported_${activeApplicant?.pan || 'app'}`;
        try { sessionStorage.setItem(reportKey, 'true'); } catch (_) {}
        // Automatically save to Direct Firestore (and Cloudflare Worker) without needing any manual button clicks!
        if (payload) {
          // Enforce authentic logged-in app user credentials and profile name
          if (user?.email) payload.userEmail = user.email;
          if (user?.uid) payload.userId = user.uid;
          // Sidebar profile names only when it is the same person DDA holds
          // the flat for; on a mismatch the record keeps the hold page's names.
          if (!payload.applicantMismatch) {
            const profileFullName = [activeApplicant?.personal?.firstName, activeApplicant?.personal?.lastName].filter(Boolean).join(' ').trim() || activeApplicant?.name;
            if (profileFullName) payload.applicantName = profileFullName;
            if (activeApplicant?.personal?.fatherName || activeApplicant?.personal?.father_name) {
              payload.fatherName = activeApplicant.personal.fatherName || activeApplicant.personal.father_name;
            }
          }

          Object.assign(payload, targetFlatsForRecord());

          try {
            const sendRes = await api.sendBookingTelemetry(payload, user);
            if (sendRes?.logFilePath) {
              useAutomationStore.getState().setLastRunLog(sendRes.logFilePath, sendRes.logFileName);
              try {
                wsSet('dda_last_log_path', sendRes.logFilePath);
                wsSet('dda_last_log_name', sendRes.logFileName || '');
              } catch (_) {}
              addLog('SUCCESS', 'Forensics', `📄 Forensic run audit log exported to disk: ${sendRes.logFileName || sendRes.logFilePath}`, activeApplicant?.pan);
            }
          } catch (_) {}

          // Extract reserved flat number & hold expiration from telemetry for sidebar display
          try {
            const telemetryFlatNo = payload.bookedFlat?.flatNo || payload.flatNo || '';
            const telemetryHoldExpiry = payload.holdExpiresAt || payload.bookedFlat?.holdExpiresAt || null;
            if (telemetryFlatNo) {
              useAutomationStore.getState().setReservedFlatDetails({
                flatNo: String(telemetryFlatNo),
                holdExpiresAt: telemetryHoldExpiry || null
              });
              try {
                sessionStorage.setItem('dda_reserved_flat_no', String(telemetryFlatNo));
                localStorage.setItem('dda_last_reserved_flat', String(telemetryFlatNo));
                if (telemetryHoldExpiry) sessionStorage.setItem('dda_hold_expires_at', String(telemetryHoldExpiry));
                localStorage.setItem('dda_run_analytics', JSON.stringify(payload));
              } catch (_) {}
            }
          } catch (_) {}
        }
      });
      return () => unsub?.();
    }
  }, [activeApplicant, user, addLog]);

  // Listen to flat availability broadcast from webview
  useEffect(() => {
    if (window.ddaElectronAPI?.onFlatAvailability) {
      const unsub = window.ddaElectronAPI.onFlatAvailability((data) => {
        useAutomationStore.getState().setFlatAvailability(data);
      });
      return () => unsub?.();
    }
  }, []);

  // Listen to applicant logout broadcast from Electron main process
  useEffect(() => {
    if (window.ddaElectronAPI?.onApplicantLogout) {
      const unsub = window.ddaElectronAPI.onApplicantLogout((data) => {
        const currentActive = useApplicantStore.getState().activeApplicant;
        const pan = data?.pan || currentActive?.pan || currentActive?.personal?.pan;
        console.log('🚪 [Workspace] Applicant logout received via IPC:', pan);
        useAutomationStore.getState().clearLogs();
        addLog('INFO', 'DDA Portal', `Applicant (${pan || 'Active'}) logged out of DDA portal.`, pan);
      });
      return () => unsub?.();
    }
  }, [addLog]);

  // Direct evaluator for flat availability when on FLAT_SELECT stage
  useEffect(() => {
    const stage = detectDdaStage(currentUrl);
    if (stage.id !== 'FLAT_SELECT') {
      lastAutoTransitionRef.current = {
        hadNoTargets: null,
        wasNoneAvailable: null,
        wasModalOpen: null,
        enteredStage: null
      };
      useAutomationStore.getState().setFlatAvailability({
        isFlatSelectPage: false,
        isGridLoaded: false,
        totalAvailable: 0,
        availableFlats: [],
        noneTargetAvailable: false,
        source: 'dom',
        timestamp: 0,
        checkedAt: Date.now()
      });
      return;
    }

    // Auto-open sidepanel on step 2 transition if target flats are empty or unconfigured (edge-triggered)
    const initialFlats = activeApplicant?.preferences?.flatNo || activeApplicant?.preferences?.flats || [];
    const initialTargetList = (Array.isArray(initialFlats) ? initialFlats : [initialFlats]).map((f) => String(f).trim().toUpperCase()).filter(Boolean);
    const initialHasNoTargets = initialTargetList.length === 0;

    if (lastAutoTransitionRef.current.enteredStage !== 'FLAT_SELECT') {
      lastAutoTransitionRef.current.enteredStage = 'FLAT_SELECT';
      lastAutoTransitionRef.current.hadNoTargets = initialHasNoTargets;
      if (initialHasNoTargets) {
        setIsStep2SidebarCollapsed(false);
      }
    } else if (!lastAutoTransitionRef.current.hadNoTargets && initialHasNoTargets) {
      // Transition from having targets to empty targets (user cleared targets on step 2)
      setIsStep2SidebarCollapsed(false);
      lastAutoTransitionRef.current.hadNoTargets = true;
    } else if (lastAutoTransitionRef.current.hadNoTargets && !initialHasNoTargets) {
      lastAutoTransitionRef.current.hadNoTargets = false;
    }

    const inspectFlats = async () => {
      if (!webviewRef.current) return;

      // While a search is running the hunter pushes its freshly-fetched availability over
      // dda:flat-availability on every poll (250-300ms), which is both newer and cheaper than
      // this check. Skip the executeJavaScript round trip entirely while those are arriving —
      // doing an IPC hop into the webview every 800ms during a live drop is pure contention.
      const pushed = useAutomationStore.getState().flatAvailability;
      if (pushed?.source === 'poll' && pushed.timestamp && Date.now() - pushed.timestamp < 2500) {
        return;
      }

      try {
        const res = await webviewRef.current.executeJavaScript(`
          (() => {
            const buildingEls = Array.from(document.querySelectorAll('.building'));
            let isGridLoaded = buildingEls.length > 0 || !!document.querySelector('.floorblock');
            const isModalOpen = !!document.querySelector('#myModal.show, #myModal[style*="display: block"], .modal.show');
            const availableEls = Array.from(document.querySelectorAll('.building.available'));
            let availableFlats = availableEls.map((el) => {
              const span = el.querySelector('span');
              return span ? (span.innerText || span.textContent || '').trim().toUpperCase() : '';
            }).filter(Boolean);

            // While a search is running the live DOM is NOT the source of truth: the hunter polls fresh
            // HTML and only patches in the single flat it reserves. Prefer its last poll when recent,
            // so the sidebar can't say "none available" while a match is being reserved.
            let source = 'dom';
            try {
              const polled = window.__ddaLastPolledFlats;
              // While the hunter runs a check may legitimately take up to 10s, so its last answer
              // stays the truth for longer than the 3s that applies once it has stopped.
              const pollFresh = window.__ddaFlatHunterActive ? 12000 : 3000;
              if (polled && Array.isArray(polled.flats) && (Date.now() - polled.at) < pollFresh) {
                availableFlats = polled.flats;
                isGridLoaded = isGridLoaded || polled.gridLoaded === true;
                source = 'poll';
              }
            } catch (_) {}

            // The search's own checks got no usable answer 3+ times in a row (no answer, dropped
            // line, or HTTP errors): availability is unknown, not "unavailable"
            let pollStalled = false;
            try {
              const st = window.__ddaPollStalled;
              pollStalled = !!(window.__ddaFlatHunterActive && st && st.streak >= 3);
            } catch (_) {}

            // DDA refused the hold because a previous session is still running (Status 3 on the
            // direct POST, or DDA's own popup in modal mode). Shown for a minute.
            const runningAt = window.__ddaSessionRunningAt || 0;
            const sessionRunning = (Date.now() - runningAt) < 60000 ||
              Array.from(document.querySelectorAll('.swal2-popup.swal2-show, .swal-modal'))
                .some((p) => /previous session is already running/i.test(p.textContent || ''));

            return {
              sessionRunning,
              pollStalled,
              isGridLoaded,
              isModalOpen,
              totalAvailable: availableFlats.length,
              availableFlats,
              source
            };
          })()
        `);
        if (res) {
          const sessionRunning = res.sessionRunning === true;
          if (useAutomationStore.getState().flatAvailability?.sessionRunning !== sessionRunning) {
            useAutomationStore.getState().setFlatAvailability({ sessionRunning });
          }
          const pollStalled = res.pollStalled === true;
          if (Boolean(useAutomationStore.getState().flatAvailability?.pollStalled) !== pollStalled) {
            useAutomationStore.getState().setFlatAvailability({ pollStalled });
          }
          // Edge-triggered auto-reopen on a running-session refusal, like "none available"
          if (sessionRunning) {
            if (!lastAutoTransitionRef.current.wasSessionRunning) {
              setIsStep2SidebarCollapsed(false);
              lastAutoTransitionRef.current.wasSessionRunning = true;
            }
          } else {
            lastAutoTransitionRef.current.wasSessionRunning = false;
          }
        }
        if (res && res.isGridLoaded) {
          const rawFlats = activeApplicant?.preferences?.flatNo || activeApplicant?.preferences?.flats || [];
          const targetList = (Array.isArray(rawFlats) ? rawFlats : [rawFlats]).map((f) => String(f).trim().toUpperCase()).filter(Boolean);
          const availableKeys = (res.availableFlats || []).map(flatKey);
          const hasMatch = targetList.some((t) => availableKeys.includes(flatKey(t)));
          const noneTargetAvailable = targetList.length > 0 && !hasMatch;

          useAutomationStore.getState().setFlatAvailability({
            isFlatSelectPage: true,
            isGridLoaded: true,
            totalAvailable: res.totalAvailable,
            availableFlats: res.availableFlats,
            noneTargetAvailable,
            targetFlats: targetList,
            source: 'dom',
            timestamp: 0,
            checkedAt: Date.now()
          });

          // Edge-triggered auto-tuck on modal: only on transition (false -> true)
          if (res.isModalOpen) {
            if (!lastAutoTransitionRef.current.wasModalOpen) {
              setIsStep2SidebarCollapsed(true);
              lastAutoTransitionRef.current.wasModalOpen = true;
            }
          } else {
            lastAutoTransitionRef.current.wasModalOpen = false;
          }

          // Edge-triggered auto-reopen when none available: only on transition (false -> true)
          if (noneTargetAvailable) {
            if (!lastAutoTransitionRef.current.wasNoneAvailable) {
              setIsStep2SidebarCollapsed(false);
              lastAutoTransitionRef.current.wasNoneAvailable = true;
            }
          } else {
            lastAutoTransitionRef.current.wasNoneAvailable = false;
          }
        }
      } catch (_) {}
    };

    // At most one check waiting at a time: while DDA's page loads, executeJavaScript waits for
    // it, and without this the 800ms timer piled checks up behind a slow page (MaxListeners).
    let inspectBusy = false;
    const inspectOnce = async () => {
      if (inspectBusy) return;
      inspectBusy = true;
      try { await inspectFlats(); } finally { inspectBusy = false; }
    };
    inspectOnce();
    const interval = setInterval(inspectOnce, 800);
    return () => clearInterval(interval);
  }, [currentUrl, activeApplicant]);

  // ⚡ 0ms Sidepanel Collapse on Flat Radio Click
  useEffect(() => {
    const handleFlatSelected = () => {
      setIsStep2SidebarCollapsed(true);
      lastAutoTransitionRef.current.wasModalOpen = true;
    };
    window.addEventListener('dda-step2-flat-selected', handleFlatSelected);
    return () => {
      window.removeEventListener('dda-step2-flat-selected', handleFlatSelected);
    };
  }, [setIsStep2SidebarCollapsed]);

  // Ensure Payment page sidepanel is hidden by default upon entering PAYMENT_HOLD
  const lastPaymentStageRef = useRef(false);
  const lastStageIdRef = useRef(null);
  // Payment flow: starts on DDA's hold / payment pages, continues through the
  // gateway and bank pages, ends on any other DDA page (or after 20 min).
  useEffect(() => {
    if (!currentUrl) return;
    let onDda = false;
    try { onDda = new URL(currentUrl).hostname.toLowerCase() === 'eservices.dda.org.in'; } catch (_) {}
    if (!onDda) return;
    const st = useAutomationStore.getState();
    if (isDdaPaymentPage(currentUrl)) {
      if (!st.paymentFlowSince) st.setPaymentFlowSince(Date.now());
    } else if (st.paymentFlowSince) {
      st.setPaymentFlowSince(0);
    }
  }, [currentUrl]);

  useEffect(() => {
    const stage = detectDdaStage(currentUrl);
    const isPayment = stage.id === 'PAYMENT_HOLD';
    if (isPayment && !lastPaymentStageRef.current) {
      // Sidebar expanded (visible) on PAYMENT_HOLD so user can see reserved flat & fast payment button
      setIsStep2SidebarCollapsed(false);
      lastPaymentStageRef.current = true;
    } else if (!isPayment) {
      lastPaymentStageRef.current = false;
    }

    // Reset searching state when transitioning between different stages (e.g. FLAT_SELECT -> SCHEME)
    if (lastStageIdRef.current && lastStageIdRef.current !== stage.id) {
      if (useAutomationStore.getState().isSearching) {
        setIsSearching(false);
        useAutomationStore.getState().setSearchRemainingSec(null);
      }
    }
    lastStageIdRef.current = stage.id;
  }, [currentUrl, setIsStep2SidebarCollapsed, setIsSearching]);


  // Initial workspace load log
  useEffect(() => {
    addLog('INFO', 'System', '⚡ Northdesk loaded. Ready for booking.', activeApplicant?.pan);
  }, []);

  const format12HourTime = (ts = Date.now()) => {
    const d = new Date(ts);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m}:${s}.${ms} ${ap}`;
  };

  // Helper to compile full run logs and dispatch to Firebase Firestore & Cloudflare Worker
  const dispatchRunTelemetry = async (status = 'SUCCESS') => {
    try {
      const applicantName = [activeApplicant?.personal?.firstName, activeApplicant?.personal?.lastName].filter(Boolean).join(' ') || activeApplicant?.name || 'Applicant';
      const cleanPan = (activeApplicant?.pan || activeApplicant?.personal?.pan || 'RUN').toUpperCase().trim();

      // Collect real analytics milestones from webview or localStorage
      let realAnalytics = {};
      try {
        const rawWebviewAnalytics = await webviewRef.current?.executeJavaScript?.(
          'localStorage.getItem("dda_run_analytics") || localStorage.getItem("dda_analytics")'
        );
        if (rawWebviewAnalytics) {
          realAnalytics = JSON.parse(rawWebviewAnalytics);
        }
      } catch (_) {}

      if (!realAnalytics || Object.keys(realAnalytics).length === 0) {
        try {
          realAnalytics = JSON.parse(wsGet('dda_run_analytics') || wsGet('dda_analytics') || '{}');
        } catch (_) {}
      }

      // Ensure step6 milestone is present if on hold page
      if (!realAnalytics.step6_payment_timer_ok) {
        realAnalytics.step6_payment_timer_ok = {
          timestamp: Date.now(),
          time: format12HourTime(),
          message: 'Payment Timer / Hold Page Reached'
        };
      }

      // Collect ONLY clean app run logs (store logs are now strictly app logs)
      const storeLogs = useAutomationStore.getState().logs || [];
      let sessionLogs = [];
      try {
        const rawLogs = await webviewRef.current?.executeJavaScript?.(
          'sessionStorage.getItem("dda_session_run_logs") || localStorage.getItem("dda_run_logs")'
        );
        if (rawLogs) sessionLogs = JSON.parse(rawLogs);
      } catch (_) {
        try {
          sessionLogs = JSON.parse(sessionStorage.getItem('dda_session_run_logs') || wsGet('dda_run_logs') || '[]');
        } catch (_) {}
      }

      // Timings: recorded milestones only, nothing estimated (same rules as
      // the preload's record): first recorded step → DDA reserving the flat.
      const endStep =
        realAnalytics.step5_reserved ||
        realAnalytics.step5_captcha_submit ||
        realAnalytics.step6_payment_timer_ok ||
        realAnalytics.step4_flat_select;
      const endTs = endStep?.timestamp || Date.now();
      const startKey = ['step1_apply', 'step2_form', 'step3_locality', 'step4_page_load', 'step4_flat_select']
        .find((k) => realAnalytics[k]?.timestamp && realAnalytics[k].timestamp < endTs) || null;
      const effectiveStartTs = startKey ? realAnalytics[startKey].timestamp : null;
      const measuredMs = effectiveStartTs ? endTs - effectiveStartTs : null;
      const totalTimeMs = measuredMs ?? 0;
      const totalTimeSec = parseFloat((totalTimeMs / 1000).toFixed(2));

      const combined = [];
      const searchChecks = [];
      const isSearchCheckLine = (m) => /^Searching for target flats.*#\d+\s*$/.test(String(m || ''));
      const seenMsgKeys = new Set();
      for (const sl of [...sessionLogs, ...storeLogs.map(l => ({
        time: l.timestamp || format12HourTime(),
        level: (l.type || 'INFO').toUpperCase(),
        page: l.source || 'DDA',
        msg: l.message || '',
        pan: l.pan || cleanPan
      }))]) {
        const key = `${sl.time}_${sl.msg}`;
        if (!seenMsgKeys.has(key) && !sl.msg?.includes('Isolated session active')) {
          seenMsgKeys.add(key);
          // One line per flat-search check is noise; they are summed up in flatSearch below.
          if (isSearchCheckLine(sl.msg)) {
            searchChecks.push(sl);
            continue;
          }
          combined.push(sl);
        }
      }
      const lastCheckNo = (l) => Number((String(l?.msg || '').match(/#(\d+)\s*$/) || [])[1]) || 0;
      const flatSearch = searchChecks.length
        ? {
            checks: Math.max(searchChecks.length, ...searchChecks.map(lastCheckNo)),
            firstCheckAt: searchChecks[0].time,
            lastCheckAt: searchChecks[searchChecks.length - 1].time,
          }
        : null;
      if (flatSearch) {
        combined.push({
          time: flatSearch.lastCheckAt,
          level: 'INFO',
          page: 'Flat Select',
          msg: `🔎 Flat search: ${flatSearch.checks} checks, ${flatSearch.firstCheckAt} → ${flatSearch.lastCheckAt}`,
          pan: cleanPan,
        });
      }

      // Ensure the very first line of Detailed Execution Logs indicates Electron Desktop App origin
      if (!combined.some((l) => l.msg?.includes("Logs sent from the Electron Desktop App"))) {
        combined.unshift({
          time: combined[0]?.time || format12HourTime((effectiveStartTs || Date.now()) - 3000),
          level: "INFO",
          page: "System",
          msg: "🖥️ Logs sent from the Electron Desktop App",
          pan: cleanPan,
        });
      }

      let rawCaptchas = [];
      try {
        const rawFromWebview = await webviewRef.current?.executeJavaScript?.(
          'localStorage.getItem("dda_captcha_attempts") || sessionStorage.getItem("dda_captcha_attempts")'
        );
        if (rawFromWebview) rawCaptchas = JSON.parse(rawFromWebview);
      } catch (_) {
        try {
          rawCaptchas = JSON.parse(
            wsGet('dda_captcha_attempts') ||
            sessionStorage.getItem('dda_captcha_attempts') ||
            '[]'
          );
        } catch (_) {}
      }

      // This booking's attempts: since its first recorded step (normally
      // Scheme Apply); without a recorded start, the last 60 s.
      const anchorTs = endStep?.timestamp || Date.now();
      const attemptsFrom = effectiveStartTs || anchorTs - 60_000;
      const bookingAttempts = rawCaptchas.filter((att) => {
        if (!att.timestamp) return false;
        if (att.timestamp < attemptsFrom) return false;
        if (att.pan && cleanPan && cleanPan !== 'RUN' && att.pan !== cleanPan) return false;
        return true;
      });
      const hasSubmitted = bookingAttempts.some(
        (a) =>
          a.status === "RESERVED" ||
          a.status === "SUBMITTED" ||
          a.status === "SERVER_REJECTED" ||
          a.status === "NO_RESPONSE" ||
          a.status === "FAILED",
      );
      const validAttempts = hasSubmitted
        ? bookingAttempts.filter((a) => a.status !== "PRE_SOLVED")
        : bookingAttempts;

      const dedupedAttempts = [];
      const seenImages = new Set();
      for (let i = validAttempts.length - 1; i >= 0; i--) {
        const att = validAttempts[i];
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

      const captchaAttempts =
        dedupedAttempts.length > 0
          ? dedupedAttempts
          : (rawCaptchas.length > 0 ? [rawCaptchas[rawCaptchas.length - 1]] : []);

      // Secondary fallback from automation store state if attempts array is still empty
      if (captchaAttempts.length === 0) {
        const storeState = useAutomationStore.getState();
        const fallbackAnswer = storeState.captchaInputVal || '';
        const fallbackImg = storeState.lastSolvedCaptchaDataUrl || storeState.captchaDataUrl || '';
        if (fallbackAnswer || fallbackImg) {
          captchaAttempts.push({
            attemptNumber: 1,
            pan: cleanPan !== 'RUN' ? cleanPan : '',
            timestamp: endStep?.timestamp || Date.now(),
            timeStr: format12HourTime(endStep?.timestamp || Date.now()),
            base64Image: fallbackImg,
            rawText: fallbackAnswer,
            answer: fallbackAnswer,
            numericAnswer: Number(fallbackAnswer) || null,
            durationMs: 0,
            status: 'RESERVED',
            statusDetail: 'Recovered from automation store state',
            model: 'native-onnx-node-v1',
            serverAlertText: null,
          });
        }
      }

      const cached = JSON.parse(wsGet('dda_last_selected_flat_details') || '{}');
      const prefs = activeApplicant?.preferences || {};
      const targetFlatNo = cached.flatNo || prefs.flatNo?.[0] || prefs.flats || '';
      
      let resolvedUserEmail =
        user?.email ||
        localStorage.getItem('dda_auth_email') ||
        sessionStorage.getItem('dda_auth_email') ||
        '';
      if (!resolvedUserEmail || resolvedUserEmail === 'extension@dda.local') {
        try {
          const authObj = JSON.parse(localStorage.getItem('dda_auth_user') || '{}');
          if (authObj?.email && authObj.email !== 'extension@dda.local') {
            resolvedUserEmail = authObj.email;
          }
        } catch (_) {}
      }

      const resolvedUserId = user?.uid || localStorage.getItem('dda_auth_uid') || 'user';
      const fatherName = activeApplicant?.personal?.fatherName || activeApplicant?.personal?.father_name || '';

      // Steps exactly as recorded; a step that did not happen is left out.
      const finalSteps = {};
      for (const k of [
        'step1_apply', 'step2_form', 'step3_locality', 'step4_page_load',
        'step4_flat_select', 'step5_captcha_submit', 'step5_reserved',
        'step6_payment_timer_ok', 'step7_hold_confirmed',
      ]) {
        const st = realAnalytics[k];
        if (!st?.timestamp) continue;
        finalSteps[k] = { timestamp: st.timestamp, time: st.time || format12HourTime(st.timestamp), message: st.message || k };
      }

      const runData = {
        runId,
        id: runId,
        applicantPan: cleanPan,
        applicantName: applicantName,
        fatherName: fatherName,
        userEmail: resolvedUserEmail,
        userId: resolvedUserId,
        flatNo: targetFlatNo,
        locality: cached.locality || prefs.locality || 'NARELA',
        sector: cached.sector || prefs.sector || '',
        pocket: cached.pocket || prefs.pocket || '',
        block: cached.block || prefs.block || '',
        floor: cached.floor || prefs.floor || '',
        status,
        totalDurationMs: totalTimeMs,
        totalDurationSec: totalTimeSec,
        durationMeasured: measuredMs != null,
        durationFrom: startKey,
        steps: finalSteps,
        captchaAttempts,
        lastCaptcha: captchaAttempts.length > 0 ? captchaAttempts[captchaAttempts.length - 1] : null,
        runLogs: combined,
        logs: combined,
        flatSearch,
        ...targetFlatsForRecord(),
        completedAt: new Date().toISOString()
      };

      addLog('ACTION', 'Telemetry', `📤 Dispatching ${combined.length} event logs to Firebase bookingRuns (${totalTimeSec}s)...`, cleanPan);
      const res = await api.sendBookingTelemetry(runData, user);
      if (res?.success) {
        addLog('SUCCESS', 'Telemetry', `✅ Firebase booking run updated with ${combined.length} diagnostic logs!`, cleanPan);
        if (res?.logFilePath) {
          useAutomationStore.getState().setLastRunLog(res.logFilePath, res.logFileName);
          try {
            wsSet('dda_last_log_path', res.logFilePath);
            wsSet('dda_last_log_name', res.logFileName || '');
          } catch (_) {}
          addLog('SUCCESS', 'Forensics', `📄 Forensic run audit log exported to disk: ${res.logFileName || res.logFilePath}`, cleanPan);
        }
      }
      return res;
    } catch (err) {
      console.warn('dispatchRunTelemetry error:', err);
      addLog('WARN', 'Telemetry', `Telemetry dispatch notice: ${err.message}`, activeApplicant?.pan);
    }
  };

  // Expose global telemetry sync helper for sidebar console and DevTools
  useEffect(() => {
    window.syncRunLogsToFirebase = (status = 'SUCCESS') => dispatchRunTelemetry(status);
  }, [activeApplicant, user]);

  // Stage Automation watcher (handles UI notifications on hold page)
  useEffect(() => {
    if (isPageLoading || !currentUrl) return;
    const stage = detectDdaStage(currentUrl);

    if (stage.id === 'PAYMENT_HOLD') {
      // Sidebar collapse on Payment entry is handled by the edge-triggered hook (lines 396-404).
      // Do NOT force-collapse here — it overrides the user manually expanding the sidepanel.
      const reportKey = `dda_reported_${activeApplicant?.pan || 'app'}`;
      if (!sessionStorage.getItem(reportKey)) {
        sessionStorage.setItem(reportKey, 'true');
        const applicantName = [activeApplicant?.personal?.firstName, activeApplicant?.personal?.lastName].filter(Boolean).join(' ') || activeApplicant?.name || 'Applicant';
        addLog('SUCCESS', 'Stage', `🎯 Landed on Payment Timer / Hold page for ${applicantName}. Full microsecond telemetry dispatched by DDA Preload Engine.`, activeApplicant?.pan);
        
        // The preload sends the booking record once DDA confirms the hold
        // (usually within a few seconds). Fallback only if the hold was
        // confirmed but the record never arrived: never for an unconfirmed hold.
        setTimeout(() => {
          const confirmedAt = window.__ddaHoldConfirmedAt || 0;
          if (!window.__ddaAnalyticsDispatched && confirmedAt && Date.now() - confirmedAt < 60000) {
            dispatchRunTelemetry('SUCCESS');
          }
        }, 20000);
      }

      // Immediately resolve reserved flat details from storage for sidebar display at 0ms
      const currentDetails = useAutomationStore.getState().reservedFlatDetails;
      if (!currentDetails?.flatNo) {
        let resolvedFlatNo = sessionStorage.getItem('dda_reserved_flat_no') || localStorage.getItem('dda_last_reserved_flat') || '';
        let resolvedHoldExpiry = sessionStorage.getItem('dda_hold_expires_at') || null;
        if (!resolvedFlatNo || !resolvedHoldExpiry) {
          try {
            const analytics = JSON.parse(localStorage.getItem('dda_run_analytics') || '{}');
            if (!resolvedFlatNo) resolvedFlatNo = analytics?.bookedFlat?.flatNo || analytics?.flatNo || '';
            if (!resolvedHoldExpiry) resolvedHoldExpiry = analytics?.holdExpiresAt || analytics?.bookedFlat?.holdExpiresAt || null;
          } catch (_) {}
        }
        if (!resolvedFlatNo) {
          try {
            const cached = JSON.parse(localStorage.getItem('dda_last_selected_flat_details') || '{}');
            resolvedFlatNo = cached?.flatNo || '';
          } catch (_) {}
        }
        if (resolvedFlatNo) {
          // Flat number only: the expiry comes from DDA's own countdown on
          // the hold page; a stored one may belong to an earlier booking.
          useAutomationStore.getState().setReservedFlatDetails({
            flatNo: String(resolvedFlatNo)
          });
        }
      }

      // Direct Webview DOM Inspection for Property Details (Flat No, Applicant Name, Locality, Application Money)
      const scrapeWebviewHoldDetails = () => {
        if (!webviewRef.current?.executeJavaScript) return;
        webviewRef.current.executeJavaScript(`
          (() => {
            try {
              const res = {};
              const fieldsets = document.querySelectorAll('fieldset.formfieldset, fieldset');
              for (const fs of fieldsets) {
                const legend = fs.querySelector('legend');
                const legText = (legend?.textContent || '').toLowerCase();
                
                const fgs = fs.querySelectorAll('.form-group');
                fgs.forEach(fg => {
                  const labelEl = fg.querySelector('label');
                  if (!labelEl) return;
                  const lbl = labelEl.textContent.trim().toLowerCase();
                  const clone = fg.cloneNode(true);
                  clone.querySelectorAll('label').forEach(l => l.remove());
                  const v = clone.textContent.replace(/^[-:–—\\s]+/, '').replace(/[-:–—\\s]+$/, '').trim();
                  if (!v || v === '-' || v === '--' || v === 'N/A') return;

                  if (legText.includes('personal') || legText.includes('applicant')) {
                    if (lbl.includes('name') && !lbl.includes('father') && !lbl.includes('mother') && !lbl.includes('spouse') && !lbl.includes('guardian') && !lbl.includes('scheme')) {
                      res.applicantName = v;
                    }
                  } else {
                    if (lbl.includes('application money') || lbl.includes('application fee') || lbl.includes('registration money') || lbl.includes('booking amount')) {
                      const numClean = v.replace(/[^0-9.]/g, '');
                      if (numClean && !isNaN(Number(numClean)) && Number(numClean) >= 100) {
                        res.applicationMoney = numClean;
                      }
                    } else if (lbl.includes('locality')) {
                      res.locality = v;
                    } else if (lbl.includes('sector')) {
                      res.sector = v;
                    } else if (lbl.includes('pocket')) {
                      res.pocket = v;
                    } else if (lbl.includes('block')) {
                      res.block = v;
                    } else if (lbl.includes('flat no') || lbl.includes('flat number') || lbl === 'flat') {
                      if (/\\d/.test(v)) res.flatNo = v;
                    } else if (lbl.includes('floor no') || lbl.includes('floor number')) {
                      res.floor = v;
                    }
                  }
                });
              }
              return res;
            } catch (_) {
              return {};
            }
          })()
        `).then((details) => {
          if (details && typeof details === 'object' && Object.keys(details).length > 0) {
            useAutomationStore.getState().setReservedFlatDetails(details);
            if (details.applicationMoney) {
              try {
                sessionStorage.setItem('dda_reserved_app_money', details.applicationMoney);
                localStorage.setItem('dda_reserved_app_money', details.applicationMoney);
              } catch (_) {}
            }
            if (details.applicantName) {
              try {
                sessionStorage.setItem('dda_reserved_applicant_name', details.applicantName);
                localStorage.setItem('dda_reserved_applicant_name', details.applicantName);
              } catch (_) {}
            }
            if (details.flatNo) {
              try {
                sessionStorage.setItem('dda_reserved_flat_no', details.flatNo);
                localStorage.setItem('dda_last_reserved_flat', details.flatNo);
              } catch (_) {}
            }
          }
        }).catch(() => {});
      };

      scrapeWebviewHoldDetails();
      const holdScrapeTimer = setTimeout(scrapeWebviewHoldDetails, 1000);
      const holdScrapeTimer2 = setTimeout(scrapeWebviewHoldDetails, 2500);
      return () => {
        clearTimeout(holdScrapeTimer);
        clearTimeout(holdScrapeTimer2);
      };
    }
  }, [currentUrl, isPageLoading, activeApplicant, addLog]);

  // ─── CLEAR LOGS & PAYMENT STATE ON ENTERING SCHEMES PAGE ──────────────
  useEffect(() => {
    if (!currentUrl) return;
    // Only DDA's real schemes page counts. detectDdaStage files every unknown
    // address (the bank's OTP page, BillDesk, ...) under SCHEME, which used to
    // wipe the hold countdown mid-payment.
    const isSchemes = getSidebarMode(currentUrl, 0) === 'scheme';
    const prevStage = prevStageRef.current;
    prevStageRef.current = isSchemes ? 'SCHEME' : 'OTHER';

    // 🧹 Automatically clear previous logs and residual payment state upon switching to Schemes page.
    if (isSchemes && prevStage !== 'SCHEME') {
      useAutomationStore.getState().clearLogs();
      try {
        sessionStorage.removeItem('dda_fast_payment_approved');
        sessionStorage.removeItem('dda_reserved_flat_no');
        sessionStorage.removeItem('dda_reserved_app_money');
        sessionStorage.removeItem('dda_reserved_applicant_name');
        sessionStorage.removeItem('dda_hold_expires_at');
        localStorage.removeItem('dda_reserved_app_money');
        localStorage.removeItem('dda_reserved_applicant_name');
      } catch (_) {}
      useAutomationStore.setState((st) => ({
        reservedFlatDetails: { ...st.reservedFlatDetails, holdExpiresAt: null },
      }));
      useAutomationStore.getState().setReservedFlatDetails({
        flatNo: '',
        holdExpiresAt: null,
        applicantName: '',
        applicationMoney: '',
        locality: '',
        sector: '',
        pocket: '',
        block: '',
        floor: '',
        scheme: ''
      });
      webviewRef.current?.executeJavaScript?.(`
        try {
          sessionStorage.removeItem('dda_fast_payment_approved');
          window.__ddaFastPaymentApproved = false;
        } catch (_) {}
      `);
    }
  }, [currentUrl]);

  // ─── STAGE-SPECIFIC ACTION HANDLERS & WEBVIEW INJECTIONS ─────────────

  // Live Captcha Sync & Native ONNX / Worker Extractor
  // At most one timed captcha read waiting at a time (a slow login page made them pile up);
  // a forced read (after a refresh) always goes.
  const captchaReadBusyRef = useRef(false);
  const handleExtractCaptcha = async (force = false) => {
    if (force !== true) {
      if (captchaReadBusyRef.current) return;
      captchaReadBusyRef.current = true;
      try { return await extractCaptchaNow(false); } finally { captchaReadBusyRef.current = false; }
    }
    return extractCaptchaNow(true);
  };
  const extractCaptchaNow = async (force = false) => {
    const code = ddaAutomations.getCaptchaExtractCode();
    try {
      const res = await webviewRef.current?.executeJavaScript?.(code);
      if (res?.success && res.dataUrl) {
        useAutomationStore.getState().setCaptchaDataUrl(res.dataUrl);

        // Auto-solve: Login page is ON by default and independent of schemes page auto captcha toggle
        const settings = useSettingsStore.getState()?.settings || {};
        const stage = detectDdaStage(currentUrl);
        const isLogin = stage?.id === 'LOGIN';
        const isAutoSolve = isLogin
          ? (settings?.loginCaptchaAutoSolveEnabled !== false)
          : (settings?.captchaAutoSolveEnabled !== false);

        if (isAutoSolve) {
          const lastSolved = useAutomationStore.getState().lastSolvedCaptchaDataUrl;
          if (force || res.dataUrl !== lastSolved) {
            useAutomationStore.getState().setLastSolvedCaptchaDataUrl(res.dataUrl);
            const solveRes = await api.solveCaptcha(res.dataUrl);
            if (solveRes?.success && solveRes.text) {
              handleSyncCaptchaInput(solveRes.text);
              addLog('SUCCESS', 'OCR Solver', `Auto-solved captcha via ${solveRes.engine}: [${solveRes.text}]`, activeApplicant?.pan);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Captcha extract warning:', err);
    }
  };

  const handleSyncCaptchaInput = (val) => {
    useAutomationStore.getState().setCaptchaInputVal(val);
    const code = ddaAutomations.getCaptchaInputSyncCode(val);
    webviewRef.current?.executeJavaScript?.(code);
  };

  const handleRefreshCaptcha = async () => {
    try {
      useAutomationStore.getState().setCaptchaInputVal('');
      useAutomationStore.getState().setLastSolvedCaptchaDataUrl(null);
      const code = ddaAutomations.getRefreshCaptchaCode();
      await webviewRef.current?.executeJavaScript?.(code);
      
      // Staggered polling to capture newly rendered image
      setTimeout(() => handleExtractCaptcha(true), 250);
      setTimeout(() => handleExtractCaptcha(true), 600);
      setTimeout(() => handleExtractCaptcha(true), 1200);
    } catch (err) {
      console.warn('Captcha refresh error:', err);
    }
  };

  const handleSubmitLogin = async (explicitApplicant) => {
    // A locked login applicant is always the one signed in
    let applicant = findLockedLogin(useApplicantStore.getState().loginUsers) || explicitApplicant || selectedLoginApplicant;
    if (!applicant) {
      const usersList = activeLoginUsers(useApplicantStore.getState().loginUsers);
      const lastPan = (
        sessionStorage.getItem('dda_last_selected_login_pan') ||
        wsGet('dda_last_selected_login_pan') ||
        ''
      ).toUpperCase().trim();
      if (lastPan) {
        applicant = usersList.find(a => (a.pan || '').toUpperCase().trim() === lastPan);
      }
    }
    if (!applicant) return;

    const cleanPan = (applicant.pan || applicant.personal?.pan || '').toUpperCase().trim();
    const resolvedPassword = (applicant.password || applicant.personal?.password || KNOWN_APPLICANT_PASSWORDS?.[cleanPan] || '').trim();
    const fullApplicant = {
      ...applicant,
      pan: cleanPan,
      password: resolvedPassword,
      personal: {
        ...(applicant.personal || {}),
        pan: cleanPan,
        password: resolvedPassword
      }
    };

    try {
      sessionStorage.setItem('dda_last_selected_login_pan', cleanPan);
      sessionStorage.setItem('dda_selected_login_pan', cleanPan);
      wsSet('dda_last_selected_login_pan', cleanPan);
      wsSet('dda_selected_login_pan', cleanPan);
      wsSet('dda_last_logged_in_pan', cleanPan);
      wsSet('dda_selected_person', cleanPan);
      wsSet('dda_active_applicant_pan', cleanPan);
    } catch (_) {}

    // Lock active applicant for this window immediately upon login submit
    handleSelectApplicant(cleanPan);

    const captchaVal = useAutomationStore.getState().captchaInputVal;
    const code = ddaAutomations.getLoginSubmitCode(fullApplicant, captchaVal);
    try {
      const res = await webviewRef.current?.executeJavaScript?.(code);
      addLog('ACTION', 'Login', `Submitted DDA Login form for ${fullApplicant.personal?.firstName || cleanPan || 'Applicant'} (${cleanPan}) (${res?.method || res?.error || 'Triggered'})`, cleanPan);
    } catch (err) {
      console.warn('Login submit error:', err);
    }
  };

  // Poll / Watch for Captcha image only when strictly on LOGIN page (<50ms initial check, fast staggered)
  useEffect(() => {
    const stage = detectDdaStage(currentUrl);
    if (stage?.id !== 'LOGIN') return;
    
    // Immediate extraction + fast staggered attempts without waiting for full network load
    handleExtractCaptcha();
    const t0 = setTimeout(() => handleExtractCaptcha(), 80);
    const t1 = setTimeout(() => handleExtractCaptcha(), 250);
    const t2 = setTimeout(() => handleExtractCaptcha(), 600);
    const interval = setInterval(() => handleExtractCaptcha(), 1800);
    
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(interval);
    };
  }, [currentUrl]);

  // Leaving the hold page with the app's buttons while the hold still runs
  // (flat 917 on 20 Oct was left 47 s after the hold): ask first
  const confirmLeaveHold = (action) => {
    const st = useAutomationStore.getState();
    if (detectDdaStage(st.currentUrl || currentUrl).id !== 'PAYMENT_HOLD') return true;
    const hold = st.reservedFlatDetails || {};
    const expiry = Date.parse(hold.holdExpiresAt || '') || 0;
    const left = expiry ? Math.round((expiry - Date.now()) / 1000) : null;
    if (left !== null && left <= 0) return true;
    const flat = hold.flatNo ? `Flat ${hold.flatNo}` : 'A flat';
    const time = left !== null ? ` with ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : '';
    const ok = window.confirm(`${flat} is on hold${time}.\n\n${action} leaves the hold page, and the flat may not be payable after that.\n\nLeave the hold page?`);
    addLog(ok ? 'WARN' : 'INFO', 'Payment Timer', ok ? `⚠️ Hold page left by choice (${action}).` : `Stayed on the hold page (${action} cancelled).`, activeApplicant?.pan);
    return ok;
  };

  // Direct URL Navigation / Stage Jump
  const handleNavigateTo = (url) => {
    if (!url) return;
    if (!confirmLeaveHold('Going to another DDA page')) return;
    multiReloadEngineRef.current?.stop('navigate');
    setIsSearching(false);
    useAutomationStore.getState().setSearchRemainingSec(null);
    try {
      webviewRef.current?.stop?.();
    } catch (_) {}
    webviewRef.current?.loadURL(url)?.catch?.((err) => console.warn('[Navigation] loadURL rejected:', err?.message));
    addLog('ACTION', 'Navigation', `Navigating to ${url}`, activeApplicant?.pan);
  };

  // Rapid Page Reload & Error Recovery
  const handleReload = () => {
    addLog('ACTION', 'Recovery', '🔄 Rapid page reload triggered...', activeApplicant?.pan);
    try {
      webviewRef.current?.stop?.();
    } catch (_) {}
    try {
      // one reload command only (the first returns nothing, so a() || b() used to run both)
      if (webviewRef.current?.reloadIgnoringCache) webviewRef.current.reloadIgnoringCache();
      else webviewRef.current?.reload?.();
    } catch (_) {
      webviewRef.current?.reload?.();
    }
  };

  // ─── MULTI-RELOAD ENGINE (hard-reloads until the page really loads; logic lives in utils/multiReload.js) ──────
  const lastDdaUrlRef = useRef('');
  useEffect(() => {
    if (currentUrl && /eservices\.dda\.org\.in/i.test(currentUrl)) lastDdaUrlRef.current = currentUrl;
  }, [currentUrl]);

  const multiReloadEngineRef = useRef(null);
  if (!multiReloadEngineRef.current) {
    multiReloadEngineRef.current = createMultiReloadEngine({
      store: useAutomationStore,
      getWebview: () => webviewRef.current,
      addLog: (type, source, msg) =>
        useAutomationStore.getState().addLog(type, source, msg, useApplicantStore.getState().activeApplicant?.pan),
      // DDA's 60-flat-page-loads-a-minute limit, tracked per window in main
      getRateWaitMs: () => window.ddaElectronAPI?.flatPageWait?.(webviewRef.current?.getWebContentsId?.()) ?? 0,
      // When reloading a step2_form page keeps failing, rebuild its link via the
      // locality cascade and load the fresh one (returns the new URL, or null).
      onCascadeFallback: async (currentUrl, isAlive) => {
        const wv = webviewRef.current;
        if (!wv?.executeJavaScript) return null;
        const m = /\/step2_form\/([^/]+)\//i.exec(String(currentUrl || ''));
        if (!m) return null;
        const schemeId = m[1];
        let fresh = null;
        try {
          fresh = await wv.executeJavaScript(
            `(window.resolveStep2DirectUrl ? window.resolveStep2DirectUrl(${JSON.stringify(schemeId)}, {}) : null)`,
          );
        } catch (_) {
          return null;
        }
        if (!fresh || typeof fresh !== 'string' || !/\/step2_form\//i.test(fresh)) return null;
        if (typeof isAlive === 'function' && !isAlive()) return null; // stopped while the link was being rebuilt
        try { wv.stop?.(); } catch (_) {}
        try { await wv.loadURL(fresh); } catch (_) {}
        return fresh;
      },
    });
  }

  const stopMultiReloadLoop = (reason = 'user') => multiReloadEngineRef.current?.stop(reason);

  // Flat page arriving as DDA's server-error page (HTTP 500+, e.g. "Database Error") or its
  // "Too Many Requests" page (HTTP 429, Multi-Reload then waits out the minute): start
  // Multi-Reload by itself (at most 10 minutes). Not while it already runs, not during a
  // reservation, and not after Stop until the next Search / Timed / Manual / Multi-Reload press.
  const autoMultiReloadBlockedRef = useRef(false);
  const allowAutoMultiReload = () => { autoMultiReloadBlockedRef.current = false; };
  const lastNavInfo = useAutomationStore((s) => s.lastNavInfo);
  useEffect(() => {
    const nav = lastNavInfo;
    if (!nav || nav.failed || !nav.url || !(Number(nav.code) >= 500 || Number(nav.code) === 429)) return undefined;
    let u;
    try { u = new URL(nav.url); } catch (_) { return undefined; }
    if (u.hostname !== 'eservices.dda.org.in' || !/\/user\/step2_form\//i.test(u.pathname)) return undefined;
    const engine = multiReloadEngineRef.current;
    if (!engine || engine.isRunning() || autoMultiReloadBlockedRef.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const busy = await Promise.race([
          webviewRef.current?.executeJavaScript?.('window.__ddaDirectRunning === true'),
          new Promise((resolve) => setTimeout(() => resolve(false), 600)),
        ]);
        if (busy === true) {
          addLog('WARN', 'Recovery', '⏸️ Flat page gave a server error, but a reservation is in progress - not reloading.', activeApplicant?.pan);
          return;
        }
      } catch (_) {}
      if (cancelled || engine.isRunning() || autoMultiReloadBlockedRef.current) return;
      const why = Number(nav.code) === 429 ? 'was refused: too many requests this minute (HTTP 429)' : `gave a server error (HTTP ${nav.code})`;
      addLog('WARN', 'Recovery', `🔁 Flat page ${why} - Multi-Reload started automatically`, activeApplicant?.pan);
      setIsSearching(false);
      useAutomationStore.getState().setSearchRemainingSec(null);
      engine.start(nav.url, { maxDurationMs: 10 * 60 * 1000 });
    })();
    return () => { cancelled = true; };
  }, [lastNavInfo]);

  const handleMultiReload = async () => {
    const engine = multiReloadEngineRef.current;
    if (engine.isRunning()) {
      // pressed to stop: same as Stop, so the reload still in flight can't start it again by itself
      autoMultiReloadBlockedRef.current = true;
      engine.stop('user');
      return;
    }
    allowAutoMultiReload();

    // Never interrupt a reservation that is in flight: a reload would cancel its POST and leave the outcome unknown
    try {
      const busy = await Promise.race([
        webviewRef.current?.executeJavaScript?.('window.__ddaDirectRunning === true'),
        new Promise((resolve) => setTimeout(() => resolve(false), 600)),
      ]);
      if (busy === true) {
        addLog('WARN', 'Recovery', '⏸️ A flat reservation is in progress - not reloading now. Try again in a moment.', activeApplicant?.pan);
        return;
      }
    } catch (_) {}

    // Stop active search state (the page-side search dies with the reload anyway)
    setIsSearching(false);
    useAutomationStore.getState().setSearchRemainingSec(null);

    const liveUrl = currentUrl && !/^chrome-error:/i.test(currentUrl) ? currentUrl : '';
    engine.start(liveUrl || lastDdaUrlRef.current || '');
  };

  const handleWebviewLoadingChange = (isLoading) => {
    useAutomationStore.getState().setPageLoading(isLoading);
    if (!isLoading) handLoginApplicantToPage();
  };

  // The store starts on DDA's login URL, so the first login fill is sent before
  // the page exists and is lost; the page then has only its own storage (empty
  // on a window's first use, or an older choice). Once the login page has
  // really loaded, it gets this window's applicant again.
  const handLoginApplicantToPage = () => {
    // dom-ready reports the page's URL just before it reports the end of loading
    const url = useAutomationStore.getState().currentUrl || '';
    if (!/^https:\/\/eservices\.dda\.org\.in\/user\/?(?:[?#]|$)/i.test(url)) return;
    const applicant = findLockedLogin(useApplicantStore.getState().loginUsers) || selectedLoginApplicant;
    if (!applicant) return;
    try { handleAutofillLogin(applicant, false); } catch (_) {}
  };


  // Expose window helper & global shortcut for DDA Portal DevTools
  useEffect(() => {
    window.openDdaDevTools = () => {
      window.ddaElectronAPI?.openWebviewDevTools?.();
    };

    const handleKeyDown = (e) => {
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') || e.key === 'F10') {
        e.preventDefault();
        window.ddaElectronAPI?.openWebviewDevTools?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fast Payment: the logged-in DDA account's own card / net-banking login
  // (saved encrypted from the web form). Downloaded once per account when the
  // window reaches the flat or hold page, handed to main in memory for this
  // window only, and cleared at the DDA login page.
  const ddaAccountPanForPay = useAutomationStore((s) => s.ddaAccountPan);
  const paymentDetailsPanRef = useRef('');
  useEffect(() => {
    const stageId = detectDdaStage(currentUrl).id;
    if (stageId === 'LOGIN') {
      if (paymentDetailsPanRef.current) {
        paymentDetailsPanRef.current = '';
        window.ddaElectronAPI?.setPaymentDetails?.(null);
      }
      return;
    }
    if (stageId !== 'FLAT_SELECT' && stageId !== 'PAYMENT_HOLD') return;
    const pan = (ddaAccountPanForPay || '').toUpperCase().trim();
    if (!pan || paymentDetailsPanRef.current === pan) return;
    paymentDetailsPanRef.current = pan;
    api.getPaymentDetails(pan).then((d) => {
      if (paymentDetailsPanRef.current !== pan) return;
      if (!d) {
        paymentDetailsPanRef.current = ''; // try again on the next page
        return;
      }
      window.ddaElectronAPI?.setPaymentDetails?.({ pan, card: d.card, netbanking: d.netbanking });
      const parts = [d.card && `card ••••${String(d.card.cardNumber || '').slice(-4)}`, d.netbanking && 'net banking login'].filter(Boolean);
      if (parts.length) addLog('INFO', 'Payment', `Fast Payment: ${pan}'s own ${parts.join(' and ')} ready for the payment.`, pan);
    });
  }, [currentUrl, ddaAccountPanForPay]);

  // Stage Handler: Applicant Selection Switcher & Webview Synchronization
  // Keep active applicant permanently synchronized across Main process & Webview localStorage
  // Only re-syncs when the applicant PAN actually changes (NOT on every URL redirect)
  useEffect(() => {
    if (!activeApplicant) return;
    const cleanPan = (activeApplicant.pan || activeApplicant.personal?.pan || '').toUpperCase().trim();
    
    // Ref guard: skip if we already synced this exact PAN
    if (lastSyncedPanRef.current === cleanPan) return;
    lastSyncedPanRef.current = cleanPan;

    // 1. Update Main process active applicant for this specific window session
    window.ddaElectronAPI?.setActiveApplicant?.(activeApplicant, winSession);

    // 2. Push active applicant into Webview partition context
    const syncCode = `
      (() => {
        try {
          const app = ${JSON.stringify(activeApplicant)};
          window.__ACTIVE_APPLICANT__ = app;
          sessionStorage.setItem('window.__ACTIVE_APPLICANT__', JSON.stringify(app));
          localStorage.setItem('window.__ACTIVE_APPLICANT__', JSON.stringify(app));
          sessionStorage.setItem('dda_selected_person', "${cleanPan}");
          localStorage.setItem('dda_selected_person', "${cleanPan}");
          sessionStorage.setItem('dda_active_applicant_pan', "${cleanPan}");
          localStorage.setItem('dda_active_applicant_pan', "${cleanPan}");
          localStorage.setItem('dda_auth_email', "${user?.email || ''}");
          sessionStorage.setItem('dda_auth_email', "${user?.email || ''}");
          localStorage.setItem('dda_auth_uid', "${user?.uid || ''}");
          sessionStorage.setItem('dda_auth_uid', "${user?.uid || ''}");
          localStorage.setItem('dda_id_token', "${user?.idToken || ''}");
          sessionStorage.setItem('dda_id_token', "${user?.idToken || ''}");
          
          let ddaData = {};
          try { ddaData = JSON.parse(localStorage.getItem('ddaData') || '{}'); } catch (_) {}
          if (!ddaData.applicants) ddaData.applicants = {};
          ddaData.applicants["${cleanPan}"] = app;
          ddaData.mode = ddaData.mode || 'live';
          localStorage.setItem('ddaData', JSON.stringify(ddaData));
          try { window.dispatchEvent(new CustomEvent('dda:set-applicant', { detail: app })); } catch (_) {}
          console.log('⚡ [DDA Sync Hook] Synchronized active applicant to webview for Window [${winSession}]:', "${cleanPan}");
        } catch (e) {
          console.error('Error syncing applicant to webview:', e);
        }
      })();
    `;
    webviewRef.current?.executeJavaScript?.(syncCode);
  }, [activeApplicant, user, winSession]);

  // Stage 1: Login Autofill (User ID & Password) - Only runs on LOGIN page
  const handleAutofillLogin = (targetApplicant, isExplicit = false) => {
    const stage = detectDdaStage(currentUrl);
    if (stage.id !== 'LOGIN') return; // Do not execute login scripts on schemes or post-login stages
    
    // A locked login applicant is always the one filled in
    let candidate = findLockedLogin(useApplicantStore.getState().loginUsers) || targetApplicant || selectedLoginApplicant;
    if (!candidate) {
      const usersList = activeLoginUsers(useApplicantStore.getState().loginUsers);
      const lastPan = (
        sessionStorage.getItem('dda_last_selected_login_pan') ||
        wsGet('dda_last_selected_login_pan') ||
        ''
      ).toUpperCase().trim();
      if (lastPan) {
        candidate = usersList.find(
          a => (a.pan || '').toUpperCase().trim() === lastPan
        );
      }
    }
    if (!candidate) return;

    setSelectedLoginApplicant(candidate);
    const cleanPan = (candidate.pan || candidate.personal?.pan || '').toUpperCase().trim();
    try {
      if (cleanPan) {
        sessionStorage.setItem('dda_last_selected_login_pan', cleanPan);
        sessionStorage.setItem('dda_selected_login_pan', cleanPan);
        wsSet('dda_last_selected_login_pan', cleanPan);
        wsSet('dda_selected_login_pan', cleanPan);
      }
    } catch (_) {}

    const resolvedPassword = (candidate.password || candidate.personal?.password || KNOWN_APPLICANT_PASSWORDS?.[cleanPan] || '').trim();
    const applicant = {
      ...candidate,
      pan: cleanPan,
      password: resolvedPassword,
      personal: {
        ...(candidate.personal || {}),
        pan: cleanPan,
        password: resolvedPassword,
      }
    };

    // 1. Sync candidate into webview storage so preload-dda.js refill strictly uses THIS selected applicant.
    // The window's locked PAN goes too: only a locked window logs back in by itself after DDA ends the session.
    const lockedPan = getLockedLoginPan();
    const syncCode = `
      (() => {
        try {
          const target = ${JSON.stringify(applicant)};
          window.__DDA_LOCKED_LOGIN_PAN__ = ${JSON.stringify(lockedPan)};
          if (${JSON.stringify(lockedPan)}) localStorage.setItem('dda_page_locked_login_pan', ${JSON.stringify(lockedPan)});
          else localStorage.removeItem('dda_page_locked_login_pan');
          window.__DDA_LOGIN_APPLICANT__ = target;
          localStorage.setItem('dda_selected_login_pan', "${cleanPan}");
          localStorage.setItem('window.__DDA_LOGIN_APPLICANT__', JSON.stringify(target));
          ${isExplicit ? 'window.__ddaUserManuallyEditedLogin = false;' : ''}
          try {
            window.dispatchEvent(new CustomEvent('dda:set-login-applicant', { detail: target }));
          } catch (_) {}
          if (typeof window.__ddaRefillLoginCredentials === 'function') {
            window.__ddaRefillLoginCredentials(target);
          }
        } catch (_) {}
      })();
    `;
    webviewRef.current?.executeJavaScript?.(syncCode);

    // 2. Direct DOM injection
    const code = ddaAutomations.getLoginAutofillCode(applicant, isExplicit);
    webviewRef.current?.executeJavaScript?.(code);
    addLog('ACTION', 'Login', `Autofilled credentials for: ${applicant.personal?.firstName || 'Applicant'} (${applicant.pan})`, applicant.pan);
    setTimeout(handleExtractCaptcha, 50);
  };

  const handleSelectApplicant = (pan) => {
    const cleanPan = (pan || '').toUpperCase().trim();
    // After login the window's applicant is the DDA account's own: no control
    // can move it to someone else (only the admins' testing switch allows it)
    const accountPan = useAutomationStore.getState().ddaAccountPan;
    if (
      accountPan && cleanPan && cleanPan !== accountPan &&
      useSettingsStore.getState().settings?.allowDifferentApplicant !== true &&
      detectDdaStage(useAutomationStore.getState().currentUrl).id !== 'LOGIN'
    ) {
      addLog('WARN', 'Applicant', `Applicant stays ${accountPan}: DDA is logged in as ${accountPan}, so ${cleanPan} can't be chosen here.`, accountPan);
      return;
    }
    lastHandledAuthPanRef.current = cleanPan;
    const appList = useApplicantStore.getState().applicants || [];
    let found = appList.find(a => (a.pan || a.personal?.pan || '').toUpperCase().trim() === cleanPan);
    if (!found) return;

    const resolvedPassword = (found.password || found.personal?.password || KNOWN_APPLICANT_PASSWORDS?.[cleanPan] || '').trim();
    found = {
      ...found,
      pan: cleanPan,
      password: resolvedPassword,
      personal: {
        ...(found.personal || {}),
        pan: cleanPan,
        password: resolvedPassword,
      }
    };

    // 1. Update React / Zustand store
    useApplicantStore.getState().selectApplicant(cleanPan);
    try {
      wsSet('dda_last_logged_in_pan', cleanPan);
      wsSet('dda_selected_login_pan', cleanPan);
      wsSet('dda_selected_person', cleanPan);
      wsSet('dda_active_applicant_pan', cleanPan);
      wsRemove('dda_direct_flat_url');
      wsRemove('dda_locality_hashes');
      if (found.preferences?.flatNo) {
        wsSet('dda_target_flats', JSON.stringify(found.preferences.flatNo));
      }
    } catch (_) {}

    // 2. Immediately update Main process active applicant and broadcast
    window.ddaElectronAPI?.setActiveApplicant?.(found, winSession);

    // 3. Push active applicant into Webview's localStorage & window context
    const syncCode = `
      (() => {
        try {
          const app = ${JSON.stringify(found)};
          window.__ACTIVE_APPLICANT__ = app;
          delete window.__ddaDirectFlatUrl;
          localStorage.removeItem('dda_direct_flat_url');
          localStorage.removeItem('dda_locality_hashes');
          localStorage.setItem('dda_selected_person', "${cleanPan}");
          localStorage.setItem('dda_active_applicant_pan', "${cleanPan}");
          localStorage.setItem('dda_prefilled_fastpass', ${(typeof settings?.prefilledFastPass === 'boolean' ? settings.prefilledFastPass : localStorage.getItem('dda_prefilled_fastpass') === 'true') ? '"true"' : '"false"'});
          
          let ddaData = {};
          try { ddaData = JSON.parse(localStorage.getItem('ddaData') || '{}'); } catch (_) {}
          if (!ddaData.applicants) ddaData.applicants = {};
          ddaData.applicants["${cleanPan}"] = app;
          ddaData.mode = ddaData.mode || 'live';
          localStorage.setItem('ddaData', JSON.stringify(ddaData));
          try { window.dispatchEvent(new CustomEvent('dda:set-applicant', { detail: app })); } catch (_) {}
          console.log('⚡ [DDA Sync] Switched active applicant to:', "${cleanPan}");
        } catch (e) {
          console.error('Error syncing applicant to webview:', e);
        }
      })();
    `;
    webviewRef.current?.executeJavaScript?.(syncCode);

    const name = [found.personal?.firstName, found.personal?.lastName].filter(Boolean).join(' ') || found.name || 'Applicant';
    addLog('ACTION', 'Applicant', `Switched active applicant to: ${name} (${cleanPan})`, cleanPan);

    // 4. If on LOGIN page, immediately autofill new credentials
    const stage = detectDdaStage(currentUrl);
    if (stage.id === 'LOGIN') {
      setTimeout(() => handleAutofillLogin(found, true), 50);
    }
  };

  // Inject active applicant & user into Webview context on login page transitions & auto-select post-login applicant
  useEffect(() => {
    const stage = detectDdaStage(currentUrl);
    if (stage.id === 'LOGIN') {
      hasMatchedLoginRef.current = false;
      lastHandledAuthPanRef.current = null;
      useAutomationStore.getState().setDdaAccountPan('');
      handleAutofillLogin(selectedLoginApplicant, false);
      return; // Do NOT push post-login activeApplicant into webview on the LOGIN page!
    }

    // ─── POST-LOGIN CHECK ───
    if (!hasMatchedLoginRef.current) {
      hasMatchedLoginRef.current = true;
      // loadApplicants now restores the last active applicant from localStorage.
      // No need to force selectApplicant(null) here — it causes visible dropdown flicker.
    }
  }, [currentUrl, activeApplicant, user]);

  // ─── SMART AUTHENTICATED USER DETECTION & PROFILE MATCHING (TODO 2) ─
  // A login, or a DDA page reporting which account the tab is on (account:
  // true). The DDA account decides the applicant: the sidebar follows it,
  // unless the testing switch allows a different applicant.
  const handleUserLoggedIn = React.useCallback(({ pan, account, confirmOnly }) => {
    const cleanPan = (pan || '').toUpperCase().trim();
    if (!cleanPan) return;
    const isPan = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleanPan);
    if (isPan) useAutomationStore.getState().setDdaAccountPan(cleanPan);
    // A DDA page saying which account it is on (the card shows it confirmed)
    if (account && confirmOnly) return;

    if (account) {
      if (!isPan || useSettingsStore.getState().settings?.allowDifferentApplicant === true) return;
      const active = useApplicantStore.getState().activeApplicant;
      if ((active?.pan || active?.personal?.pan || '').toUpperCase().trim() === cleanPan) {
        // Already showing it: hand it to the page again (it asked because its copy
        // differs). Main never forwards an applicant to the page, so it goes in
        // as the page's own dda:set-applicant event.
        hasMatchedLoginRef.current = true;
        lastHandledAuthPanRef.current = cleanPan;
        window.ddaElectronAPI?.setActiveApplicant?.(active, winSession);
        webviewRef.current?.executeJavaScript?.(
          `(() => { try { const app = ${JSON.stringify(active)}; window.__ACTIVE_APPLICANT__ = app; window.dispatchEvent(new CustomEvent('dda:set-applicant', { detail: app })); } catch (_) {} })(); true`
        );
        return;
      }
      const exists = (useApplicantStore.getState().applicants || []).some(
        a => (a.pan || a.personal?.pan || '').toUpperCase().trim() === cleanPan
      );
      if (!exists) {
        webviewRef.current?.executeJavaScript?.(`window.__ddaAccountNoMatch = ${JSON.stringify(cleanPan)}; true`);
        if (lastHandledAuthPanRef.current !== cleanPan || active) {
          lastHandledAuthPanRef.current = cleanPan;
          useApplicantStore.getState().selectApplicant(null);
          addLog('ERROR', 'Applicant', `DDA is logged in as ${cleanPan}, which isn't in your applicant list. The app won't fill another person's details on this account.`, cleanPan);
        }
        return;
      }
      addLog('WARN', 'Applicant', `DDA is logged in as ${cleanPan}: the sidebar applicant now follows the DDA account.`, cleanPan);
      hasMatchedLoginRef.current = false; // let the match below run
    }

    if (hasMatchedLoginRef.current && lastHandledAuthPanRef.current === cleanPan) {
      return;
    }
    hasMatchedLoginRef.current = true;
    lastHandledAuthPanRef.current = cleanPan;

    try {
      wsSet('dda_last_logged_in_pan', cleanPan);
      sessionStorage.setItem('dda_last_logged_in_pan', cleanPan);
    } catch (_) {}

    const appList = useApplicantStore.getState().applicants || [];
    const matched = appList.find(
      a => (a.pan || a.personal?.pan || '').toUpperCase().trim() === cleanPan
    );

    if (matched) {
      handleSelectApplicant(cleanPan);
      const name = [matched.personal?.firstName, matched.personal?.lastName].filter(Boolean).join(' ') || matched.name || cleanPan;
      addLog('SUCCESS', 'Auth', `Authenticated portal user matched applicant: ${name} (${cleanPan})`, cleanPan);
    } else {
      useApplicantStore.getState().selectApplicant(null);
      addLog('INFO', 'Auth', `Portal account (${cleanPan}) has no matching applicant in local database. Showing Select Applicant.`, cleanPan);
    }
  }, [handleSelectApplicant, addLog]);

  // The account's applicant stays selected until DDA logs out. The page tells
  // the account once per page load; when the list wasn't loaded yet (app
  // start: DDA kept the tab logged in), or a list update dropped or changed
  // the selection, it is picked again here as soon as the list has it.
  const ddaAccountPanNow = useAutomationStore((s) => s.ddaAccountPan);
  const applicantList = useApplicantStore((s) => s.applicants);
  const allowDifferentNow = settings?.allowDifferentApplicant === true;
  useEffect(() => {
    const accountPan = (ddaAccountPanNow || '').toUpperCase().trim();
    if (!accountPan || allowDifferentNow) return;
    if (detectDdaStage(currentUrl).id === 'LOGIN') return;
    const activePan = (activeApplicant?.pan || activeApplicant?.personal?.pan || '').toUpperCase().trim();
    if (activePan === accountPan) return;
    const inList = (applicantList || []).some(
      (a) => (a.pan || a.personal?.pan || '').toUpperCase().trim() === accountPan
    );
    if (!inList) return;
    addLog('INFO', 'Applicant', `Applicant set to ${accountPan}, the DDA account logged in here.`, accountPan);
    hasMatchedLoginRef.current = true;
    handleSelectApplicant(accountPan);
  }, [ddaAccountPanNow, applicantList, activeApplicant, currentUrl, allowDifferentNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── SELF-LEARNING "SAVE PASSWORD" ENGINE (TODO 3) ───────────────────
  const handlePromptSavePassword = React.useCallback(({ pan, password }) => {
    const cleanPan = (pan || '').toUpperCase().trim();
    const cleanPass = (password || '').trim();
    if (!cleanPan || !cleanPass) return;

    const known = KNOWN_APPLICANT_PASSWORDS?.[cleanPan];
    const appList = useApplicantStore.getState().applicants || [];
    const existing = appList.find(
      a => (a.pan || a.personal?.pan || '').toUpperCase().trim() === cleanPan
    );
    const existingPass = (existing?.password || existing?.personal?.password || '').trim();

    if (known === cleanPass || existingPass === cleanPass) {
      return; // Already saved with exact matching password
    }

    setSavePasswordPrompt({
      open: true,
      pan: cleanPan,
      password: cleanPass
    });
  }, []);

  const handleSavePasswordConfirm = React.useCallback(() => {
    const { pan, password } = savePasswordPrompt;
    if (!pan || !password) return;

    KNOWN_APPLICANT_PASSWORDS[pan] = password;

    // 1. Strictly save to login credentials vault (users.json)
    useApplicantStore.getState().addUserProfile({
      name: pan,
      pan,
      password
    });

    // 2. If this PAN already exists in genuine booking applicants, sync password without touching roster
    const store = useApplicantStore.getState();
    const appList = store.applicants || [];
    const existingIndex = appList.findIndex(
      a => (a.pan || a.personal?.pan || '').toUpperCase().trim() === pan
    );

    if (existingIndex >= 0) {
      const updated = {
        ...appList[existingIndex],
        password,
        personal: {
          ...(appList[existingIndex].personal || {}),
          password
        }
      };
      const updatedApplicants = [...appList];
      updatedApplicants[existingIndex] = updated;
      useApplicantStore.setState({ applicants: updatedApplicants });
    }

    addLog('SUCCESS', 'Credentials', `Saved login credentials for PAN ${pan}`, pan);
    setSavePasswordPrompt({ open: false, pan: '', password: '' });
  }, [savePasswordPrompt, addLog]);

  // Handle Profile Name Update scraped from portal navbar (TODO 3)
  const handleUpdateProfileName = React.useCallback(({ pan, name }) => {
    const cleanPan = (pan || '').toUpperCase().trim();
    const cleanName = (name || '').trim();
    if (!cleanPan || !cleanName || cleanName.toLowerCase().includes('hi')) return;

    const store = useApplicantStore.getState();
    const appList = store.applicants || [];
    const userOwned = store.userOwnedApplicants || [];

    const target = appList.find(
      a => (a.pan || a.personal?.pan || '').toUpperCase().trim() === cleanPan
    );

    const currentName = target?.name || target?.personal?.firstName || '';
    if (target && (currentName === cleanPan || !target.personal?.lastName || currentName === 'Applicant')) {
      const parts = cleanName.split(/\s+/);
      const firstName = parts[0] || cleanName;
      const lastName = parts.slice(1).join(' ') || '';

      const updated = {
        ...target,
        name: cleanName,
        personal: {
          ...(target.personal || {}),
          firstName,
          lastName
        }
      };

      const updatedApplicants = appList.map(a =>
        (a.pan || a.personal?.pan || '').toUpperCase().trim() === cleanPan ? updated : a
      );
      const updatedUserOwned = userOwned.map(a =>
        (a.pan || a.personal?.pan || '').toUpperCase().trim() === cleanPan ? updated : a
      );

      useApplicantStore.setState({
        applicants: updatedApplicants,
        masterApplicants: updatedApplicants,
        userOwnedApplicants: updatedUserOwned
      });

      if (store.activeApplicant && (store.activeApplicant.pan || store.activeApplicant.personal?.pan || '').toUpperCase().trim() === cleanPan) {
        useApplicantStore.setState({ activeApplicant: updated });
      }

      try {
        localStorage.setItem('dda_user_applicants', JSON.stringify(updatedUserOwned));
      } catch (_) {}

      addLog('SUCCESS', 'Profile', `Auto-upgraded profile name for PAN ${cleanPan} to: ${cleanName}`, cleanPan);
    }

    // Also update name in loginUsers vault if present
    const loginUsers = store.loginUsers || [];
    const loginIdx = loginUsers.findIndex(u => (u.pan || '').toUpperCase().trim() === cleanPan);
    if (loginIdx >= 0 && (!loginUsers[loginIdx].name || loginUsers[loginIdx].name === cleanPan)) {
      const updatedLogin = [...loginUsers];
      updatedLogin[loginIdx] = { ...updatedLogin[loginIdx], name: cleanName };
      useApplicantStore.setState({ loginUsers: updatedLogin });
      try {
        localStorage.setItem('dda_login_users', JSON.stringify(updatedLogin));
        window.ddaElectronAPI?.saveLoginUsers?.(updatedLogin);
      } catch (_) {}
    }
  }, [addLog]);

  // Wire Smart Authentication, Save Password, & Profile Name listeners
  useEffect(() => {
    const unsubLoggedIn = window.ddaElectronAPI?.onUserLoggedIn?.(handleUserLoggedIn);
    const unsubPromptPass = window.ddaElectronAPI?.onPromptSavePassword?.(handlePromptSavePassword);
    const unsubUpdateName = window.ddaElectronAPI?.onUpdateProfileName?.(handleUpdateProfileName);

    const onCustomLoggedIn = (e) => handleUserLoggedIn(e.detail || {});
    const onCustomPromptPass = (e) => handlePromptSavePassword(e.detail || {});
    const onCustomUpdateName = (e) => handleUpdateProfileName(e.detail || {});

    window.addEventListener('dda:user-logged-in', onCustomLoggedIn);
    window.addEventListener('dda:prompt-save-password', onCustomPromptPass);
    window.addEventListener('dda:update-profile-name', onCustomUpdateName);

    return () => {
      unsubLoggedIn?.();
      unsubPromptPass?.();
      unsubUpdateName?.();
      window.removeEventListener('dda:user-logged-in', onCustomLoggedIn);
      window.removeEventListener('dda:prompt-save-password', onCustomPromptPass);
      window.removeEventListener('dda:update-profile-name', onCustomUpdateName);
    };
  }, [handleUserLoggedIn, handlePromptSavePassword, handleUpdateProfileName]);

  // What DDA said to the applicant's saved DDA password, marked on the website: "Invalid
  // Credentials" marks it wrong, a login that went in clears the mark. Only when the
  // password tried is the one saved on the server (a password typed by hand says
  // nothing about it), and only when the mark changes.
  const passwordCheckBusy = useRef(new Set());
  useEffect(() => {
    const report = async ({ pan, password }, wrong) => {
      const cleanPan = String(pan || '').toUpperCase().trim();
      if (!cleanPan || !password) return;
      const app = (useApplicantStore.getState().masterApplicants || [])
        .find((a) => String(a.pan || a.personal?.pan || '').toUpperCase().trim() === cleanPan);
      const saved = typeof app?.ddaPassword === 'string' ? app.ddaPassword.trim() : '';
      if (!app || !saved) return;
      if (String(password).trim() !== saved) {
        if (wrong) addLog('INFO', 'Login', `DDA refused the password for ${cleanPan}, but it isn't the saved one: the website's password is not marked`, cleanPan);
        return;
      }
      if (Boolean(app.ddaPasswordCheck?.wrong) === wrong) return;
      const key = `${cleanPan}:${wrong}`;
      if (passwordCheckBusy.current.has(key)) return;
      passwordCheckBusy.current.add(key);
      try {
        const res = await api.reportDdaPasswordCheck(cleanPan, wrong);
        if (res.success) {
          addLog(wrong ? 'WARN' : 'SUCCESS', 'Login', wrong
            ? `DDA says the saved DDA password for ${cleanPan} is wrong ("Invalid Credentials"): marked on the website — fix it there in Edit → Personal`
            : `The saved DDA password for ${cleanPan} works again: the website's "wrong password" mark is cleared`, cleanPan);
        } else {
          addLog('WARN', 'Login', `Could not mark the DDA password for ${cleanPan} on the website: ${res.error}`, cleanPan);
        }
      } finally {
        passwordCheckBusy.current.delete(key);
      }
    };
    const onWrong = (e) => report(e.detail || {}, true);
    const onWorked = (e) => report(e.detail || {}, false);
    window.addEventListener('dda:login-invalid-credentials', onWrong);
    window.addEventListener('dda:prompt-save-password', onWorked);
    return () => {
      window.removeEventListener('dda:login-invalid-credentials', onWrong);
      window.removeEventListener('dda:prompt-save-password', onWorked);
    };
  }, [addLog]);

  // DDA's payment result page: the verdict onto the booking run on the server (main
  // keeps it on this PC's copy). Tried 3 times, 3 s apart, if the server is slow.
  useEffect(() => {
    const onResult = async (e) => {
      const { pan, runId, flatNo, payment } = e.detail || {};
      if (!payment) return;
      const word = payment.status === 'PAID' ? 'Paid' : payment.status === 'FAILED' ? 'Payment failed' : 'Payment result unclear';
      addLog(payment.status === 'PAID' ? 'SUCCESS' : 'WARN', 'Payment',
        `💳 ${word}${flatNo ? ` for flat ${flatNo}` : ''} — DDA: "${payment.ddaStatus || payment.message || 'no status'}"${payment.transactionId ? `, transaction ${payment.transactionId}` : ''}`, pan);
      if (!runId) {
        addLog('WARN', 'Payment', 'Payment result not sent to the website: this window has no booking run for it (hold not recorded here)', pan);
        return;
      }
      for (let i = 0; i < 3; i++) {
        const res = await api.recordPaymentResult(runId, payment);
        if (res.success) {
          addLog('SUCCESS', 'Payment', `Payment result saved on the website's booking record (${res.status})`, pan);
          return;
        }
        if (/not found|Unauthorized|HTTP 4\d\d/i.test(res.error || '')) {
          addLog('WARN', 'Payment', `Payment result not saved on the website: ${res.error}`, pan);
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      addLog('WARN', 'Payment', 'Payment result not saved on the website (server not reachable); it is kept on this PC', pan);
    };
    window.addEventListener('dda:payment-result', onResult);
    return () => window.removeEventListener('dda:payment-result', onResult);
  }, [addLog]);

  const getCleanTargetScheme = () => {
    // 1. Explicitly selected / active scheme in UI (Extension single source of truth)
    const selected = wsGet('dda_selected_scheme');
    if (selected && !selected.toLowerCase().includes('admin_bypass') && selected.toLowerCase() !== 'admin' && selected !== '__live_active_scheme__' && selected !== '__LIVE__') {
      return selected.trim();
    }
    const chosen = activeScheme || wsGet('dda_active_scheme_name');
    if (chosen && !chosen.toLowerCase().includes('admin_bypass') && chosen.toLowerCase() !== 'admin') {
      return chosen.trim();
    }

    const stored = wsGet('dda_target_scheme');
    if (stored && !stored.toLowerCase().includes('admin_bypass') && stored.toLowerCase() !== 'admin') {
      return stored.trim();
    }

    // 2. Active applicant preferences
    const prefScheme = activeApplicant?.preferences?.scheme || activeApplicant?.location?.scheme;
    if (prefScheme && !prefScheme.toLowerCase().includes('admin_bypass') && prefScheme.toLowerCase() !== 'admin') {
      return prefScheme.trim();
    }

    // 3. Worker payload
    try {
      const ddaData = JSON.parse(localStorage.getItem('ddaData') || '{}');
      if (ddaData?.targetScheme && !ddaData.targetScheme.toLowerCase().includes('admin_bypass') && ddaData.targetScheme.toLowerCase() !== 'admin') {
        return ddaData.targetScheme.trim();
      }
    } catch (_) {}

    const storeSchemes = useApplicantStore.getState().schemes || [];
    return storeSchemes.find(s => s && !s.toLowerCase().includes('admin_bypass')) || '';
  };

            
  // Stage Handler: Target Scheme Dropdown Switcher
  const handleSchemeChange = (scheme) => {
    if (!scheme) return;
    setActiveScheme(scheme);
    wsSet('dda_target_scheme', scheme);
    wsSet('dda_selected_scheme', scheme);
    wsSet('dda_active_scheme_name', scheme);
    try {
      webviewRef.current?.executeJavaScript?.(
        `localStorage.setItem('dda_target_scheme', ${JSON.stringify(scheme)});
        localStorage.setItem('dda_selected_scheme', ${JSON.stringify(scheme)});
        localStorage.setItem('dda_active_scheme_name', ${JSON.stringify(scheme)});
        window.__ddaTargetScheme = ${JSON.stringify(scheme)};`
      );
    } catch (_) {}
    addLog('ACTION', 'Scheme List', `Switched target scheme to: ${scheme}`, activeApplicant?.pan);
  };

  // Stage 2: Target Scheme Select (Manual Apply)
  const handleSelectScheme = async () => {
    allowAutoMultiReload();
    if (!activeApplicant) {
      addLog('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
      try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
      return;
    }
    const targetScheme = getCleanTargetScheme();
    const code = ddaAutomations.getSchemeSelectCode(targetScheme);
    try {
      const res = await webviewRef.current?.executeJavaScript?.(code);
      addLog('ACTION', 'Scheme', `Applying target scheme: ${targetScheme} (${res?.method || res?.error || 'Triggered'})`, activeApplicant?.pan);
    } catch (err) {
      console.warn('Scheme select error:', err);
    }
  };

  // TIMED only works inside DDA's schemes page. At T-2s the window can be showing Chromium's
  // error page (the load failed; it is retried every 2 s) or DDA's login page: a poller
  // started there can't keep its state (another origin) or never sees the Apply link, and
  // nothing would search while the button says "Applying". So TIMED waits and starts as
  // soon as the schemes page has loaded. (executeJavaScript waits for a loading page, as
  // the injection itself always did.)
  const timedPendingRef = useRef(false);
  const timedPendingTimerRef = useRef(null);
  const timedStartRef = useRef(null);
  const isSchemesPageShowing = async () => {
    try {
      const href = await webviewRef.current?.executeJavaScript?.('location.href');
      return /^https:\/\/eservices\.dda\.org\.in\/user\/schemelist/i.test(String(href || ''));
    } catch (_) {
      return false;
    }
  };
  const stopTimedPending = () => {
    timedPendingRef.current = false;
    if (timedPendingTimerRef.current) clearTimeout(timedPendingTimerRef.current);
    timedPendingTimerRef.current = null;
  };
  const startTimedWhenSchemesPageShows = () => {
    if (timedPendingRef.current) return;
    timedPendingRef.current = true;
    addLog('WARN', 'Timed Search', "⏳ The schemes page isn't showing (it failed to load, or DDA logged out) — TIMED starts as soon as it is back", activeApplicant?.pan);
    const tick = async () => {
      if (!timedPendingRef.current) return;
      if (await isSchemesPageShowing()) {
        if (!timedPendingRef.current) return;
        stopTimedPending();
        addLog('INFO', 'Timed Search', '✅ Schemes page is back — starting TIMED', activeApplicant?.pan);
        timedStartRef.current?.();
        return;
      }
      timedPendingTimerRef.current = setTimeout(tick, 1000);
    };
    timedPendingTimerRef.current = setTimeout(tick, 1000);
  };
  useEffect(() => () => stopTimedPending(), []);

  // Stage 2b: Timed Scheme Drop (60-minute tiered continuous search engine)
  const handleTimedSchemeApply = async () => {
    allowAutoMultiReload();
    if (!activeApplicant) {
      addLog('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
      try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
      return;
    }
    setIsSearching(true);
    if (!(await isSchemesPageShowing())) {
      startTimedWhenSchemesPageShows();
      return;
    }
    // Stop session heartbeat immediately when high-speed timed hunting begins
    try {
      webviewRef.current?.executeJavaScript?.(`
        if (typeof window.__ddaStopSessionHeartbeat === 'function') {
          window.__ddaStopSessionHeartbeat('Timed hunting triggered');
        }
      `);
    } catch (_) {}
    const targetScheme = getCleanTargetScheme();
    // Resolve today's drop time (HH:MM:SS from the timer) so the poller can tier its speed around it.
    // The timer is in server time; the poller runs on this PC's clock, so the epoch is given in PC time.
    let targetEpochMs = 0;
    try {
      const [th, tm, ts] = String(useAutomationStore.getState().targetTime || '').split(':').map(Number);
      if (![th, tm, ts].some((n) => Number.isNaN(n))) {
        const t = new Date(serverNow());
        t.setHours(th, tm, ts, 0);
        targetEpochMs = t.getTime() - (getServerOffsetMs() || 0);
        timedTrace(`scheme search started for target ${useAutomationStore.getState().targetTime} (server); poller's target on the PC clock ${new Date(targetEpochMs).toLocaleTimeString('en-GB')}.${String(targetEpochMs % 1000).padStart(3, '0')}`);
      }
    } catch (_) {}
    const code = ddaAutomations.getTimedSchemePollerCode(targetScheme, activeApplicant?.preferences, activeApplicant?.pan, targetEpochMs);
    try {
      const res = await webviewRef.current?.executeJavaScript?.(code);
      if (res && res.success === false) {
        if (/scheme not selected/i.test(String(res.error || ''))) {
          addLog('WARN', 'Timed Search', `⚠️ TIMED did not start: ${res.error}`, activeApplicant?.pan);
          setIsSearching(false);
        } else {
          // The page changed under the injection (e.g. it failed to load just then)
          startTimedWhenSchemesPageShows();
        }
        return;
      }
      console.log(`[Timed Search] ⚡ Started 60-minute Continuous Search Loop for: ${targetScheme} (~1s until T-2s, 250-300ms until T+5min, then 400ms until T+15min, then 1s, until Apply)`);
      addLog('ACTION', 'Timed Search', `⚡ Started 60-minute Continuous Search Loop for: ${targetScheme} (~1s until T-2s, then fast, until Apply)`, activeApplicant?.pan);
    } catch (err) {
      console.warn('Timed scheme error:', err);
      setIsSearching(false);
    }
  };
  timedStartRef.current = handleTimedSchemeApply;

  // Stage 3: Locality & Sector Select
  const handleSelectLocality = () => {
    if (!activeApplicant) {
      addLog('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
      try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
      return;
    }
    const prefs = {
      ...(activeApplicant?.location || {}),
      ...(activeApplicant?.preferences || {}),
      locality: activeApplicant?.preferences?.locality || activeApplicant?.location?.locality || activeApplicant?.locality,
      sector: activeApplicant?.preferences?.sector || activeApplicant?.location?.sector || activeApplicant?.sector,
      pocket: activeApplicant?.preferences?.pocket || activeApplicant?.location?.pocket || activeApplicant?.pocket,
      block: activeApplicant?.preferences?.block || activeApplicant?.location?.block || activeApplicant?.block,
      tower: activeApplicant?.preferences?.tower || activeApplicant?.location?.tower || activeApplicant?.tower,
      directUrl: activeApplicant?.preferences?.directUrl || activeApplicant?.location?.directUrl || activeApplicant?.directUrl
    };
    const code = ddaAutomations.getLocalitySelectCode(prefs);
    webviewRef.current?.executeJavaScript?.(code);
    addLog('ACTION', 'Locality', `Autofilling locality: ${prefs.locality || 'Default'} (${prefs.sector || ''} ${prefs.pocket || ''} ${prefs.block || ''} ${prefs.tower || ''})`, activeApplicant?.pan);
  };

  // Stage 4: Flat Select & Reserve (Target Queue + Fallback Search + 0ms DOM Sync)
  const handleReserveFlat = (customFlat, customHuntSec) => {
    allowAutoMultiReload();
    if (!activeApplicant) {
      addLog('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
      try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
      return;
    }
    const prefs = activeApplicant?.preferences || {};
    const parseFlats = (raw) => {
      if (!raw) return [];
      if (Array.isArray(raw)) {
        return raw.flatMap(f => String(f).split(',')).map(f => f.trim().toUpperCase()).filter(Boolean);
      }
      if (typeof raw === 'string') {
        return raw.split(',').map(f => f.trim().toUpperCase()).filter(Boolean);
      }
      return [String(raw).trim().toUpperCase()].filter(Boolean);
    };
    const fallbackEnabled = prefs.fallbackEnabled === true; // Default strictly FALSE (OFF)
    const selectedFloor = prefs.floor || 'ALL';
    const selectedParity = prefs.parity || 'ALL';
    const rawTargets = customFlat ? [customFlat] : (prefs.flatNo || prefs.flats || activeApplicant?.flatNo || activeApplicant?.flats || []);
    const targets = parseFlats(rawTargets);
    const storedSec = parseInt(wsGet('dda_hunt_seconds'), 10);
    const huntSec = typeof customHuntSec === 'number'
      ? customHuntSec
      : (!isNaN(storedSec) ? storedSec : 0);

    const isContinuous = huntSec === 0;
    const flatDisplay = targets.length > 0 ? targets.join(', ') : 'All Available Flats';
    setIsSearching(true);
    setSearchRemainingSec(isContinuous ? null : huntSec);

    // Ensure Direct Mode is enabled for flat reservation
    wsSet('dda_direct_mode', 'true');
    sessionStorage.setItem('dda_direct_mode', 'true');
    try {
      webviewRef.current?.executeJavaScript?.(`
        localStorage.setItem('dda_direct_mode', 'true');
        sessionStorage.setItem('dda_direct_mode', 'true');
        window.__ddaDirectMode = true;
      `);
    } catch (_) {}

    const code = ddaAutomations.getFlatHunterCode({ ...prefs, flatNo: targets, pan: activeApplicant?.pan }, huntSec, fallbackEnabled, selectedFloor, selectedParity);
    webviewRef.current?.executeJavaScript?.(code);
    const windowLabel = isContinuous ? 'continuous mode' : `${huntSec}s window`;
    console.log(`[Flat Select] Searching for flat(s): [${flatDisplay}] (${windowLabel})...`);
    addLog('ACTION', 'Flat Select', `Searching for flat(s): [${flatDisplay}] (${windowLabel})...`, activeApplicant?.pan);
  };

  // Stage 5: Application Form Autofill & 0-Click Store
  const handleAutofillForm = async (customFastPass) => {
    if (!activeApplicant) {
      addLog('WARN', 'Controls', '⚠️ Please select an applicant first to autofill application form.');
      try { alert('Please select an applicant first to autofill application form.'); } catch (_) {}
      return;
    }
    const isFastPass = typeof customFastPass === 'boolean'
      ? customFastPass
      : (typeof settings?.prefilledFastPass === 'boolean' ? settings.prefilledFastPass : localStorage.getItem('dda_prefilled_fastpass') === 'true');
    const applicant = await withFullRecord(activeApplicant);
    const code = ddaAutomations.getFormAutofillCode(applicant, isFastPass, false, settings?.allowDifferentApplicant === true);
    webviewRef.current?.executeJavaScript?.(code);
    addLog('ACTION', 'Form', `Autofilling & saving application form for ${applicant.personal?.firstName || 'Applicant'} (${isFastPass ? 'Fast-Pass Mode' : 'Standard Mode'})`, applicant.pan);
  };

  // Stage 5b: Test Application Form Autofill (Strictly No Submit)
  const handleTestApplicationForm = async () => {
    if (!isAdminSession) return; // admin-only tool
    let applicant = activeApplicant || useApplicantStore.getState().activeApplicant;
    if (!applicant) {
      addLog('WARN', 'Controls', '⚠️ Please select an applicant first to test application form autofill.');
      try { alert('Please select an applicant first to test application form autofill.'); } catch (_) {}
      return;
    }
    applicant = await withFullRecord(applicant);

    const stage = detectDdaStage(currentUrl);
    const applicantPan = (applicant.pan || applicant.personal?.pan || '').trim().toUpperCase();
    const applicantName = applicant.personal?.firstName || applicant.name || 'Applicant';

    // 1. Sync applicant into session & local storage
    try {
      const appJson = JSON.stringify(applicant);
      sessionStorage.setItem('window.__ACTIVE_APPLICANT__', appJson);
      localStorage.setItem('window.__ACTIVE_APPLICANT__', appJson);
      sessionStorage.setItem('dda_test_autofill_mode', 'true');
      localStorage.setItem('dda_test_autofill_mode', 'true');
      sessionStorage.setItem('dda_test_skip_submit', 'true');
      if (applicantPan) {
        sessionStorage.setItem('dda_authenticated_pan', applicantPan);
        sessionStorage.setItem('dda_selected_person', applicantPan);
        sessionStorage.setItem('dda_active_applicant_pan', applicantPan);
        localStorage.setItem('dda_selected_person', applicantPan);
        localStorage.setItem('dda_active_applicant_pan', applicantPan);
      }
    } catch (_) {}

    addLog('ACTION', 'Form Test', `🧪 Preparing test autofill for ${applicantName} (${applicantPan})...`, applicantPan);

    // 2. If user is currently on Schemes page: Click Apply button to navigate to form in Test Mode
    if (stage.id === 'SCHEME' || (currentUrl && currentUrl.toLowerCase().includes('schemelist'))) {
      const targetScheme = getCleanTargetScheme();
      addLog('ACTION', 'Scheme', `🧪 [Test Mode] Clicking Apply button for "${targetScheme || 'Scheme'}" to open application form...`, applicantPan);

      const script = `
        (async () => {
          try {
            sessionStorage.setItem('dda_test_autofill_mode', 'true');
            localStorage.setItem('dda_test_autofill_mode', 'true');
            sessionStorage.setItem('dda_test_skip_submit', 'true');
            window.__ddaTestAutofillMode = true;

            const targetApp = ${JSON.stringify(applicant)};
            window.__ACTIVE_APPLICANT__ = targetApp;
            try {
              sessionStorage.setItem('window.__ACTIVE_APPLICANT__', JSON.stringify(targetApp));
              localStorage.setItem('window.__ACTIVE_APPLICANT__', JSON.stringify(targetApp));
            } catch (_) {}

            // Auto-dismiss any popups
            const popup = document.querySelector('.swal2-popup, .swal-modal, .sweet-alert');
            if (popup) {
              const okBtn = popup.querySelector('.swal2-confirm, button.confirm, button');
              if (okBtn) okBtn.click();
            }

            // Find matching row in table
            const normalize = (s) => (s || '').replace(/\\s+/g, ' ').trim().toUpperCase();
            const targetNorm = "${(getCleanTargetScheme() || '').replace(/\s+/g, ' ').trim().toUpperCase()}";
            const rows = document.querySelectorAll('table.customtable tbody tr, table tbody tr');
            for (const row of rows) {
              const el = row.querySelector('b.bluec') || row.querySelector('.scheme-title');
              if (el) {
                const title = normalize(el.textContent);
                if (!targetNorm || title.includes(targetNorm)) {
                  const btn = row.querySelector('a.applyBtn, .applyBtn, a[data-url], button, a.btn');
                  if (btn) {
                    const rawUrl = btn.getAttribute('data-url') || btn.getAttribute('href') || '';
                    if (rawUrl && (rawUrl.includes('userApplicationfrom') || rawUrl.includes('applicationform') || rawUrl.includes('/user/'))) {
                      window.location.href = rawUrl;
                      return { success: true, method: 'navigated ' + rawUrl };
                    }
                    btn.click();
                    return { success: true, method: 'clicked apply button' };
                  }
                }
              }
            }

            // Fallback to first apply button on page if specific target not matched
            const anyApplyBtn = document.querySelector('a.applyBtn, .applyBtn, a[data-url], button.applyBtn');
            if (anyApplyBtn) {
              anyApplyBtn.click();
              return { success: true, method: 'clicked first apply button' };
            }

            return { success: false, error: 'Apply button not found on Schemes page' };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })();
      `;
      try {
        const res = await webviewRef.current?.executeJavaScript(script);
        if (res?.success) {
          addLog('INFO', 'Form Test', `Apply button triggered (${res.method}). Opening form in Test Autofill mode...`, applicantPan);
        } else {
          addLog('WARN', 'Form Test', `Could not click Apply button: ${res?.error || 'Unknown error'}`, applicantPan);
        }
      } catch (err) {
        console.warn('Error clicking apply in test mode:', err);
        addLog('ERROR', 'Form Test', `Error clicking Apply: ${err.message}`, applicantPan);
      }
      return;
    }

    // 3. If user is already on Application Form page: Directly trigger autofill without submission!
    if (stage.id === 'APPLICATION_FORM' || (currentUrl && (currentUrl.toLowerCase().includes('applicationform') || currentUrl.toLowerCase().includes('applicationfrom') || currentUrl.toLowerCase().includes('userapplication')))) {
      addLog('ACTION', 'Form Test', `🧪 [Test Mode] Autofilling application form directly for ${applicantName}...`, applicantPan);

      const script = `
        (async () => {
          try {
            sessionStorage.setItem('dda_test_autofill_mode', 'true');
            localStorage.setItem('dda_test_autofill_mode', 'true');
            sessionStorage.setItem('dda_test_skip_submit', 'true');
            window.__ddaTestAutofillMode = true;

            const targetApp = ${JSON.stringify(applicant)};
            window.__ACTIVE_APPLICANT__ = targetApp;
            try {
              sessionStorage.setItem('window.__ACTIVE_APPLICANT__', JSON.stringify(targetApp));
              localStorage.setItem('window.__ACTIVE_APPLICANT__', JSON.stringify(targetApp));
            } catch (_) {}

            if (typeof window.__ddaRunTestAutofill === 'function') {
              window.__ddaRunTestAutofill(targetApp);
              return { success: true, method: '__ddaRunTestAutofill' };
            }

            return { success: false, method: 'fallback_to_code' };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })();
      `;
      try {
        const res = await webviewRef.current?.executeJavaScript(script);
        if (res && res.method === 'fallback_to_code') {
          const code = ddaAutomations.getFormAutofillCode(applicant, false, true);
          await webviewRef.current?.executeJavaScript(code);
        }
        addLog('SUCCESS', 'Form Test', `🧪 Form autofilled with ${applicantName}'s details. Ready for inspection.`, applicantPan);
      } catch (err) {
        console.warn('Error running test autofill directly on form:', err);
        addLog('ERROR', 'Form Test', `Autofill error: ${err.message}`, applicantPan);
      }
      return;
    }

    // 4. If on another page (Login, Locality, Flat Select, Payment):
    addLog('WARN', 'Form Test', '⚠️ Please open the Schemes page or Application Form page to test form autofill.', applicantPan);
    try {
      alert('Please navigate to the Schemes page or Application Form page to test form autofill.');
    } catch (_) {}
  };

  // Stage 6: Proceed to Payment
  const handleProceedPayment = () => {
    window.__ddaFastPaymentApproved = true;
    try { sessionStorage.setItem('dda_fast_payment_approved', 'true'); } catch (_) {}
    const currentSettings = useSettingsStore.getState().settings || settings;
    const code = ddaAutomations.getPaymentProceedCode(currentSettings);
    webviewRef.current?.executeJavaScript?.(`
      window.__ddaFastPaymentApproved = true;
      try { sessionStorage.setItem('dda_fast_payment_approved', 'true'); } catch (_) {}
      ${code}
    `);
    addLog('ACTION', 'Payment', 'Triggered Fast Payment sequence', activeApplicant?.pan);
  };

  // Dynamic Context-Aware Manual Action (Handles Schemes, Flat Select, Locality, Form)
  const handleManualAction = (customFlat, customHuntSec) => {
    allowAutoMultiReload();
    if (!activeApplicant) {
      addLog('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
      try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
      return;
    }

    // Enable Direct Mode for instant headless reservation on flat select
    wsSet('dda_direct_mode', 'true');
    sessionStorage.setItem('dda_direct_mode', 'true');
    try {
      webviewRef.current?.executeJavaScript?.(`
        localStorage.setItem('dda_direct_mode', 'true');
        sessionStorage.setItem('dda_direct_mode', 'true');
        window.__ddaDirectMode = true;
        try {
          sessionStorage.removeItem('dda_fast_payment_approved');
          window.__ddaFastPaymentApproved = false;
        } catch (_) {}
        if (typeof window.__ddaStopSessionHeartbeat === 'function') {
          window.__ddaStopSessionHeartbeat('Manual action triggered');
        }
      `);
    } catch (_) {}

    const stage = detectDdaStage(currentUrl);
    if (stage.id === 'SCHEME') {
      handleSelectScheme();
    } else if (stage.id === 'LOCALITY') {
      handleSelectLocality();
    } else if (stage.id === 'APPLICATION_FORM') {
      const isFastPass = (typeof settings?.prefilledFastPass === 'boolean' ? settings.prefilledFastPass : wsGet('dda_prefilled_fastpass') === 'true');
      handleAutofillForm(isFastPass);
    } else if (stage.id === 'FLAT_SELECT') {
      handleReserveFlat(customFlat, customHuntSec);
    } else {
      handleSelectScheme();
    }
  };

  // Stage 2c: Direct Headless Action (Scheme Apply -> Direct POST on step2_form)
  const handleDirectAction = async () => {
    allowAutoMultiReload();
    if (!activeApplicant) {
      addLog('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
      try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
      return;
    }

    // Set Direct Submission Mode flag in storage & webview
    wsSet('dda_direct_mode', 'true');
    sessionStorage.setItem('dda_direct_mode', 'true');
    try {
      webviewRef.current?.executeJavaScript?.(`
        localStorage.setItem('dda_direct_mode', 'true');
        sessionStorage.setItem('dda_direct_mode', 'true');
        window.__ddaDirectMode = true;
      `);
    } catch (_) {}

    addLog('ACTION', 'Direct Mode', '⚡ DIRECT Headless Submission Mode activated! (Instant POST bypass)', activeApplicant?.pan);

    const stage = detectDdaStage(currentUrl);
    if (stage.id === 'FLAT_SELECT') {
      // If already on step2_form, execute direct headless submission immediately!
      try {
        await webviewRef.current?.executeJavaScript?.(`
          if (typeof window.__ddaDirectSubmit === 'function') {
            window.__ddaDirectSubmit();
          } else {
            console.warn('[DIRECT] window.__ddaDirectSubmit not yet available in webview');
          }
        `);
        addLog('ACTION', 'Direct Submit', 'Direct submission triggered on flat select page', activeApplicant?.pan);
      } catch (err) {
        console.error('Direct submit error:', err);
      }
    } else {
      // On Schemes page, apply target scheme
      handleSelectScheme();
    }
  };

  // Dynamic Context-Aware Timed Drop Execution
  const handleTimedAction = () => {
    allowAutoMultiReload();
    if (!activeApplicant) {
      addLog('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
      try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
      return;
    }

    // Enable Direct Mode for instant headless reservation on flat select
    wsSet('dda_direct_mode', 'true');
    sessionStorage.setItem('dda_direct_mode', 'true');
    try {
      webviewRef.current?.executeJavaScript?.(`
        localStorage.setItem('dda_direct_mode', 'true');
        sessionStorage.setItem('dda_direct_mode', 'true');
        window.__ddaDirectMode = true;
      `);
    } catch (_) {}

    const stage = detectDdaStage(currentUrl);
    if (stage.id === 'SCHEME') {
      handleTimedSchemeApply();
    } else {
      handleReserveFlat();
    }
  };

  const handleStop = async () => {
    markAutoTimedStopped(); // Auto TIMED does not start again in this window
    stopTimedPending(); // a TIMED waiting for the schemes page does not start later
    autoMultiReloadBlockedRef.current = true; // no automatic Multi-Reload until the next Search / Timed / Manual / Multi-Reload
    stopMultiReloadLoop('user');
    setTimedActive(false);
    setIsSearching(false);
    setSearchRemainingSec(null);
    useAutomationStore.getState().setIsConsoleMinimized(true);
    console.log('[Automation] 🛑 Searching stopped by user.');
    wsRemove('dda_direct_mode');
    sessionStorage.removeItem('dda_direct_mode');
    window.__ddaFastPaymentApproved = false;
    try { sessionStorage.removeItem('dda_fast_payment_approved'); } catch (_) {}
    addLog('ACTION', 'Automation', '🛑 Searching stopped by user.', activeApplicant?.pan);
    // An Apply re-try never lets its page finish loading, so stop it through main (the script below may wait)
    try { window.ddaElectronAPI?.stopApplyRetry?.(webviewRef.current?.getWebContentsId?.()); } catch (_) {}
    const stopCode = `
      (() => {
        localStorage.removeItem('dda_direct_mode');
        sessionStorage.removeItem('dda_direct_mode');
        window.__ddaDirectMode = false;
        localStorage.removeItem('dda_timed_search_until');
        localStorage.removeItem('dda_timed_hunting_until');
        localStorage.removeItem('dda_timed_mode');
        localStorage.removeItem('dda_timed_attempt_count');
        if (typeof window.__ddaStopApplyRetry === 'function') window.__ddaStopApplyRetry('user');
        else sessionStorage.removeItem('dda_apply_pending');
        sessionStorage.removeItem('dda_relogin');
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
        if (window.ddaTimedTimeout) {
          clearTimeout(window.ddaTimedTimeout);
          window.ddaTimedTimeout = null;
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
        if (typeof window.__ddaResetFlatSelected === 'function') {
          window.__ddaResetFlatSelected();
        }
        if (typeof window.__ddaStartSessionHeartbeat === 'function') {
          window.__ddaStartSessionHeartbeat();
        }
        try { window.dispatchEvent(new CustomEvent('dda:stop-search')); } catch (_) {}
        return { stopped: true };
      })();
    `;
    try {
      await webviewRef.current?.executeJavaScript?.(stopCode);
    } catch (_) {}
  };

  // Dedicated user-action settings updater with instant in-memory webview kill/re-arm switch
  const handleUpdateSettings = async (partialSettings) => {
    // 1. Persist to settings store & DB
    useSettingsStore.getState().updateSettings(partialSettings);
    const fullSettings = { ...useSettingsStore.getState().settings, ...partialSettings };

    // 2. Direct in-memory webview dispatch (Zero-latency runtime kill or re-arm, no localStorage poisoning)
    if (partialSettings?.automationEnabled === false) {
      setIsSearching(false);
      setSearchRemainingSec(null);
      setTimedActive(false);
      try {
        await webviewRef.current?.executeJavaScript?.(`
          (() => {
            if (typeof window.__ddaStopAllAutomation === 'function') {
              window.__ddaStopAllAutomation();
            } else {
              window.__ddaFlatHunterActive = false;
              if (window.__ddaFlatHunterTimer) {
                clearTimeout(window.__ddaFlatHunterTimer);
                window.__ddaFlatHunterTimer = null;
              }
              if (window.__ddaFlatHunterTimeout) {
                clearTimeout(window.__ddaFlatHunterTimeout);
                window.__ddaFlatHunterTimeout = null;
              }
            }
            window.dispatchEvent(new CustomEvent('dda:stop-automation'));
            window.postMessage({ type: 'DDA_AUTOMATION_TOGGLED', enabled: false }, '*');
          })()
        `);
      } catch (_) {}
    } else {
      try {
        const sanitizedFullSettings = { ...(fullSettings || {}) };
        delete sanitizedFullSettings.fastPaymentCard;
        delete sanitizedFullSettings.autoPaySubmitEnabled;
        await webviewRef.current?.executeJavaScript?.(`
          (() => {
            const s = ${JSON.stringify(sanitizedFullSettings)};
            try {
              localStorage.setItem('dda_settings', JSON.stringify(s));
              if (s.fastPaymentEnabled !== undefined) {
                localStorage.setItem('dda_fast_payment_enabled', String(s.fastPaymentEnabled));
              }
              if (s.fastPaymentGateway) {
                localStorage.setItem('dda_fast_payment_gateway', s.fastPaymentGateway);
              }
              if (s.fastPaymentMethod) {
                localStorage.setItem('dda_fast_payment_method', s.fastPaymentMethod);
              }
              localStorage.removeItem('dda_fast_payment_card');
              if (s.fastPaymentBank) {
                localStorage.setItem('dda_fast_payment_bank', s.fastPaymentBank);
              }
              if (s.fastPaymentCardId !== undefined) {
                localStorage.setItem('dda_fast_payment_card_id', s.fastPaymentCardId || '');
              }
            } catch (_) {}
            window.postMessage({ type: 'DDA_AUTOMATION_TOGGLED', enabled: true }, '*');
            window.dispatchEvent(new CustomEvent('dda:settings-updated', { detail: s }));
          })()
        `);
      } catch (_) {}
    }
  };

  // Fast Payment follows the window's applicant: ON only when a Fast Payment is set for them
  // (the website's choice, or one set on this PC with the sidebar pencil), OFF otherwise.
  // Applied when the applicant or that answer changes, so a manual toggle in between stays.
  const fastPayPan = (activeApplicant?.pan || activeApplicant?.personal?.pan || '').toUpperCase().trim();
  const fastPayConfigured = Boolean(describeFastPayment(activeApplicant?.preferences?.fastPayment));
  const fastPayAppliedRef = useRef('');
  useEffect(() => {
    if (!fastPayPan) return;
    const key = fastPayPan + '|' + fastPayConfigured;
    if (fastPayAppliedRef.current === key) return;
    fastPayAppliedRef.current = key;
    // What Autofill restores when it is switched back on
    try {
      const saved = JSON.parse(wsGet('dda_autofill_saved_sub_toggles') || '{}');
      wsSet('dda_autofill_saved_sub_toggles', JSON.stringify({ prefilledFastPass: false, directUrlJumpEnabled: true, ...saved, fastPaymentEnabled: fastPayConfigured }));
    } catch (_) {}
    const autofillOn = useSettingsStore.getState().settings?.automationEnabled !== false;
    if (!autofillOn) return;
    const isOn = useSettingsStore.getState().settings?.fastPaymentEnabled !== false && wsGet('dda_fast_payment_enabled') !== 'false';
    if (isOn === fastPayConfigured) return;
    try { wsSet('dda_fast_payment_enabled', String(fastPayConfigured)); } catch (_) {}
    handleUpdateSettings({ fastPaymentEnabled: fastPayConfigured });
    addLog('INFO', 'Modes', fastPayConfigured
      ? 'Fast Payment switched ON: a Fast Payment is set for this applicant'
      : 'Fast Payment switched OFF: no Fast Payment is set for this applicant (set one with the pencil to use it)', fastPayPan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fastPayPan, fastPayConfigured]);

  // The top-bar clock shows this PC's time only. It used to compare against DDA's
  // server time, but DDA's servers disagree with each other by 20-30s, so that
  // comparison was unreliable. Keep the PC synced with Windows' internet time.

  // NOTE: there is no Back/Forward control any more. DDA's own page script signs the applicant
  // out when it sees a history navigation on the locality, flat-select and hold pages, so rather
  // than guarding the buttons the buttons were removed.

  // Trigger DDA portal logout for the applicant (flat preferences changed in
  // the app are kept; they are cleared on app logout or with Reset)
  const handleDdaLogout = () => {
    if (!confirmLeaveHold('Logging out of DDA')) return;
    const currentActive = useApplicantStore.getState().activeApplicant;
    const pan = currentActive?.pan || currentActive?.personal?.pan || activeApplicant?.pan;
    useAutomationStore.getState().clearLogs();
    addLog('ACTION', 'DDA Portal', `🚪 DDA Portal logout requested for ${pan || 'Applicant'}.`, pan);
    webviewRef.current?.loadURL('https://eservices.dda.org.in/user/logout');
  };

  // DDA login page shortcut and the way back, since there is no Back button.
  // Login and logout take turns: Login shows only while the logout button
  // (signed in on the portal) is hidden.
  const onDdaPortal = !currentUrl || /eservices\.dda\.org\.in/i.test(currentUrl);
  const currentStageId = detectDdaStage(currentUrl).id;
  const canOpenDdaLogin = !(onDdaPortal && currentStageId !== 'LOGIN');
  const handleOpenDdaLogin = () => handleNavigateTo('https://eservices.dda.org.in/user');
  const handleBackToDda = () => handleNavigateTo('https://eservices.dda.org.in/user/schemeList');

  // Control sidebar on the right (default) or the left; chosen in the sidebar's user menu
  const sidebarSide = useSidebarSide();
  const sidebarLeft = sidebarSide === 'left';

  // DDA's own left menu, hidden or shown per window (Automation Modes). The page applies it on every
  // load from its own copy; this keeps that copy in step when the toggle or the page changes.
  const ddaSidebarHidden = useDdaSidebarHidden();
  useEffect(() => {
    if (!onDdaPortal || !currentUrl) return;
    try {
      webviewRef.current
        ?.executeJavaScript?.(`window.__ddaSetDdaSidebarHidden && window.__ddaSetDdaSidebarHidden(${ddaSidebarHidden ? 'true' : 'false'})`)
        ?.catch?.(() => {});
    } catch (_) {}
  }, [ddaSidebarHidden, currentStageId]);

  return (
    <div className={`flex ${sidebarLeft ? 'flex-row-reverse' : ''} h-screen w-screen overflow-hidden bg-slate-100 text-slate-900 select-none font-sans`}>
      
      {/* ════════════════════════════════════════════════════════════════ */}
      {/* ─── LEFT: SLIM BROWSER NAV + LIVE DDA WEBVIEW ─────────────────── */}
      {/* ════════════════════════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden bg-slate-100/60 font-sans">
        
        {/* Slim Top Browser Navigation Strip.
            Deliberately minimal: the stage rail, the clock and the DDA logout button, nothing
            else. Back/Forward are gone for good — the DDA portal signs the applicant out on a
            history navigation on the locality, flat-select and hold pages, so the safest version
            of those buttons is no buttons. Reload and Multi-Reload live in the sidebar controls
            deck, the window number is in the sidebar header, and run status (searching / held)
            is the sidebar's job.

            Responsive ladder, narrow -> wide:
            < md  clock + logout icon only
            >= md stage rail appears, taking the free space on the left
            >= lg "DDA Logout" regains its text label and spacing opens up */}
        <div className="h-13 px-2 sm:px-3 lg:px-3.5 bg-slate-100/95 border-b border-slate-200 flex items-center shrink-0 z-10 backdrop-blur-md gap-2">

          {/* Stage Rail: which of the six booking stages the portal is on right now.
              It sizes itself to the space left beside the buttons (see StageRail), down to
              just the current step on a narrow window. */}
          <div className="flex items-center flex-1 min-w-0 overflow-hidden" title={currentUrl}>
            <StageRail activeStage={detectDdaStage(currentUrl)} />
          </div>

          {/* Manual target-flat search readout. Only renders on the Flat Select stage, where the
              sidebar auto-collapses on a match and would otherwise take the run state with it. */}
          <RunStatusChip />

          {/* Right: DDA Login / Logout (the clock is in the sidebar header). Never shrinks — the rail's
              flex-1 slot absorbs the pressure instead. */}
          <div className="flex items-center gap-1.5 lg:gap-2 shrink-0">
            {/* Divider between the stage rail and the DDA buttons */}
            <div className="w-px h-6 bg-slate-300 mx-0.5 lg:mx-1 shrink-0" aria-hidden="true" />

            {canOpenDdaLogin && (
              <button
                onClick={handleOpenDdaLogin}
                title="Open the DDA login page"
                className="flex items-center gap-1.5 h-8 px-2.5 xl:px-3 rounded-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-[#4b2c83] transition-all font-bold text-xs cursor-pointer shadow-xs shrink-0"
              >
                <LogIn className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline whitespace-nowrap">DDA Login</span>
              </button>
            )}

            {!onDdaPortal && (
              <button
                onClick={handleBackToDda}
                title="Return to the DDA portal (schemes page)"
                className="flex items-center gap-1.5 h-8 px-2.5 xl:px-3 rounded-full bg-[#4b2c83] hover:bg-[#3d2369] text-white transition-all font-bold text-xs cursor-pointer shadow-xs shrink-0"
              >
                <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">Back to DDA</span>
              </button>
            )}

            {onDdaPortal && detectDdaStage(currentUrl).id !== 'LOGIN' && (
              <button
                onClick={handleDdaLogout}
                title="Log out applicant from DDA Portal & reset session preferences to original"
                className="flex items-center gap-1.5 h-8 px-2.5 xl:px-3 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200/80 text-rose-700 hover:text-rose-800 transition-all font-bold text-xs cursor-pointer shadow-xs shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline whitespace-nowrap">DDA Logout</span>
              </button>
            )}
          </div>

        </div>

        {/* Live DDA Webview - Flush Edge to Edge with Window-Scoped Isolated Partition */}
        <div className="flex-1 w-full h-full relative overflow-hidden bg-white">
          <DdaWebview 
            ref={webviewRef} 
            partition={winSession} 
            onLog={addLog} 
            onLoadingChange={handleWebviewLoadingChange}
          />

          {/* Floating Expand Sidebar Button (Step 2 when Collapsed; the payment sidebar never collapses) */}
          {getSidebarMode(currentUrl, paymentFlowSince) === 'flatselect' && isStep2SidebarCollapsed && (
            <button
              type="button"
              onClick={() => setIsStep2SidebarCollapsed(false)}
              title="Expand Control Sidepanel"
              className={`absolute ${sidebarLeft ? 'left-0 bg-linear-to-r rounded-r-xl border-r' : 'right-0 bg-linear-to-l rounded-l-xl border-l'} top-1/2 -translate-y-1/2 z-40 from-[#371b69] to-[#4b2c83] text-white flex flex-col items-center justify-center gap-1.5 py-3 px-2 shadow-lg shadow-[#4b2c83]/25 border-y border-purple-400/30 hover:px-2.5 hover:shadow-xl transition-all cursor-pointer font-extrabold text-xs tracking-wider group active:scale-95 animate-fade-in`}
            >
              {sidebarLeft
                ? <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                : <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />}
              <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-black uppercase tracking-widest my-1">CONTROLS</span>
            </button>
          )}

          {/* ─── CHROME-STYLE FLOATING SAVE PASSWORD PROMPT (TODO 3) ─────── */}
          {savePasswordPrompt.open && (
            <div className="absolute top-4 right-4 z-50 animate-fade-in bg-white border border-slate-200/90 rounded-2xl shadow-2xl p-4 w-80 text-slate-800 space-y-3 font-sans">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-50 border border-purple-200/60 text-[#4b2c83] flex items-center justify-center shrink-0 shadow-xs">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-black uppercase tracking-tight text-slate-900 leading-tight">
                    Save Password?
                  </h4>
                  <p className="text-[11.5px] text-slate-500 font-medium leading-tight mt-1">
                    Save password for PAN <span className="font-mono font-bold text-[#4b2c83] bg-purple-50 px-1 py-0.5 rounded border border-purple-100">{savePasswordPrompt.pan}</span>?
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSavePasswordPrompt({ open: false, pan: '', password: '' })}
                  className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSavePasswordPrompt({ open: false, pan: '', password: '' })}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
                >
                  Not Now
                </button>
                <button
                  type="button"
                  onClick={handleSavePasswordConfirm}
                  className="px-4 py-1.5 rounded-xl text-xs font-extrabold text-white bg-[#4b2c83] hover:bg-[#3c2269] shadow-xs shadow-[#4b2c83]/25 transition-all cursor-pointer active:scale-95"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>

      </main>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* ─── RIGHT (or LEFT): DYNAMIC STAGE-AWARE CONTROL SIDEBAR ──────── */}
      {/* ════════════════════════════════════════════════════════════════ */}
      <RightControlSidebar
        side={sidebarSide}
        user={user}
        activeApplicant={activeApplicant}
        onReload={handleReload}
        onMultiReload={handleMultiReload}
        onBack={() => webviewRef.current?.goBack()}
        onForward={() => webviewRef.current?.goForward()}
        onNavigateTo={handleNavigateTo}
        onSelectApplicant={handleSelectApplicant}
        onAutofillLogin={handleAutofillLogin}
        onSelectScheme={handleSchemeChange}
        onSelectLocality={handleSelectLocality}
        onManual={handleManualAction}
        onDirect={handleDirectAction}
        onTimed={handleTimedAction}
        onAutofillForm={handleAutofillForm}
        onTestApplicationForm={isAdminSession ? handleTestApplicationForm : undefined}
        onProceedPayment={handleProceedPayment}
        onSyncCaptchaInput={handleSyncCaptchaInput}
        onRefreshCaptcha={handleRefreshCaptcha}
        onSubmitLogin={handleSubmitLogin}
        onStop={handleStop}
        onUpdateSettings={handleUpdateSettings}
      />

      {/* ─── APPLICANT ADD/EDIT/VIEW MODALS ─────────────────────────── */}
      <ApplicantModal />
      <ApplicantDetailsModal />
      <AddUserModal 
        onAutofillLogin={handleAutofillLogin} 
        onSelectApplicant={handleSelectApplicant} 
        onLog={addLog} 
      />
      <EditUsersModal
        onAutofillLogin={handleAutofillLogin} 
        onSelectApplicant={handleSelectApplicant} 
        onLog={addLog} 
      />

    </div>
  );
}
