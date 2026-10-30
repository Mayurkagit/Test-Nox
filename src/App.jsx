import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { carryLockAfterRestart } from './utils/loginLock';
import { getWinSession } from './utils/storageHelper';
import { useAuthStore, useSettingsStore } from './store';
import WelcomeLogin from './views/WelcomeLogin';
import KeyVerification from './views/KeyVerification';
import ApplicantPick from './views/ApplicantPick';
import Workspace from './views/Workspace';
import ConnectionBanner from './components/ConnectionBanner';

// Every view, with the internet connection banner over it
export default function App() {
  return (
    <>
      <AppView />
      <ConnectionBanner />
    </>
  );
}

function AppView() {
  const currentView = useAuthStore((state) => state.currentView);
  const user = useAuthStore((state) => state.user);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const setCurrentView = useAuthStore((state) => state.setCurrentView);
  // A window opened with "+" (pick=1) starts on the applicant picker once;
  // reloading that window later goes straight to the workspace.
  const [pickForNewWindow, setPickForNewWindow] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('pick') === '1' && !sessionStorage.getItem('dda_pick_done');
    } catch (_) {
      return false;
    }
  });
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  // Another window signed out (the app has one user for all windows): go to
  // the login screen too. That window already cleared the shared sign-in and
  // every DDA login, and may be signed in again, so this one only resets itself.
  useEffect(() => {
    const unsub = window.ddaElectronAPI?.onSignedOut?.(() => {
      if (useAuthStore.getState().user) useAuthStore.getState().resetSignedOutWindow();
    });
    return () => unsub?.();
  }, []);

  // ─── INITIALIZATION & SESSION RESTORATION ────────────────────────────
  useEffect(() => {
    // Set base theme
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    document.body.classList.remove('dark');
    document.body.classList.add('light');

    // Set initial window title
    try {
      const sp = new URLSearchParams(window.location.search);
      const s = sp.get('winSession') || sessionStorage.getItem('dda_win_session') || 'session_1';
      const num = s.replace('session_', '') || '1';
      const initialTitle = `Northdesk - Window ${num}`;
      document.title = initialTitle;
      window.ddaElectronAPI?.setWindowTitle?.(initialTitle)?.catch?.(() => {});
    } catch (_) {}

    // 1. Load persistent settings from database
    loadSettings();

    // 2. First window of a run: carry the one lock that outlived the last
    // run to this window (and log its DDA view out if the lock came from
    // another window), then restore the active session
    (async () => {
      try {
        const plan = await window.ddaElectronAPI?.takeLockStartupPlan?.();
        if (plan) {
          const mine = getWinSession();
          const from = carryLockAfterRestart(plan.previousOrder, mine);
          if (from && from !== mine) await window.ddaElectronAPI?.clearOwnDdaLogin?.();
        }
      } catch (_) {}
      restoreSession();
    })();
  }, [loadSettings, restoreSession]);

  // ─── VIEW ROUTER ─────────────────────────────────────────────────────
  // Restoring a saved sign-in: a short loading screen, not the login form
  if (currentView === 'RESTORING') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen w-screen gap-3 bg-[#f8fafc] text-slate-500 font-sans select-none">
        <Loader2 className="w-6 h-6 animate-spin text-[#4b2c83]" />
        <span className="text-xs font-semibold">Opening window…</span>
      </div>
    );
  }

  if (currentView === 'LOGIN') {
    return <WelcomeLogin />;
  }
  const isAdmin = Boolean(
    user?.isAdmin === true ||
    user?.role === 'admin' ||
    (typeof window !== 'undefined' && (
      localStorage.getItem('dda_is_admin') === 'true' ||
      localStorage.getItem('dda_user_role') === 'admin'
    ))
  );

  if (currentView === 'KEY' && !isAdmin) {
    return <KeyVerification />;
  }

  if (currentView === 'PICK_APPLICANT') {
    return <ApplicantPick onDone={() => { setPickForNewWindow(false); setCurrentView('WORKSPACE'); }} />;
  }

  if (currentView === 'WORKSPACE' && pickForNewWindow) {
    return <ApplicantPick onDone={() => setPickForNewWindow(false)} />;
  }

  return <Workspace />;
}
