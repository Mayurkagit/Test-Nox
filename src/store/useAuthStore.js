import { create } from 'zustand';
import { api, getFirebaseIdToken, isJwtExpired } from '../services/api';
import { useApplicantStore, LOGINS_OWNER_KEY } from './useApplicantStore';
import { useAutomationStore } from './useAutomationStore';

export const useAuthStore = create((set, get) => ({
  user: null,
  activeKey: null,
  // 'RESTORING' | 'LOGIN' | 'KEY' | 'PICK_APPLICANT' | 'WORKSPACE'
  // RESTORING: a saved sign-in is being restored (a new window, a reload, the
  // app reopening), shown as a short loading screen rather than the login.
  currentView: (() => {
    try {
      return localStorage.getItem('dda_auth_user') ? 'RESTORING' : 'LOGIN';
    } catch (_) {
      return 'LOGIN';
    }
  })(),
  isLoading: false,
  error: null,

  // Restore authenticated session from localStorage on startup
  restoreSession: async () => {
    try {
      const savedUser = localStorage.getItem('dda_auth_user');
      const savedKey = localStorage.getItem('dda_booking_key');

      if (savedUser) {
        const parsedUser = JSON.parse(savedUser);
        // The saved ID token expires after 1h; refresh it before handing it to
        // main, or main's verification fails and it has no user (telemetry then
        // goes out without an email).
        if (parsedUser.idToken && isJwtExpired(parsedUser.idToken)) {
          // Another window may have refreshed it already (shared storage)
          let shared = '';
          try { shared = localStorage.getItem('dda_id_token') || ''; } catch (_) {}
          try {
            const fresh = shared && !isJwtExpired(shared) ? shared : await getFirebaseIdToken(true);
            if (fresh) {
              parsedUser.idToken = fresh;
              localStorage.setItem('dda_auth_user', JSON.stringify(parsedUser));
            }
          } catch (_) {}
        }
        const isAdmin = Boolean(
          parsedUser?.isAdmin === true ||
          parsedUser?.role === 'admin' ||
          localStorage.getItem('dda_is_admin') === 'true' ||
          localStorage.getItem('dda_user_role') === 'admin'
        );

        set({ user: parsedUser });
        try {
          if (parsedUser.email) localStorage.setItem('dda_auth_email', parsedUser.email);
          if (parsedUser.uid) localStorage.setItem('dda_auth_uid', parsedUser.uid);
          if (parsedUser.idToken) {
            localStorage.setItem('dda_id_token', parsedUser.idToken);
            sessionStorage.setItem('dda_id_token', parsedUser.idToken);
          }
          if (parsedUser.idToken) {
            await window.ddaElectronAPI?.authenticateToken?.(parsedUser.idToken);
          } else {
            await window.ddaElectronAPI?.setActiveUser?.(parsedUser);
          }
        } catch (_) {}
        // Restored without typing the password: a login remembered on the
        // sign-in screen ("Remember me") is what the web portal window uses
        try {
          const remembered = JSON.parse(localStorage.getItem('dda_remembered_credentials') || 'null');
          const same = String(remembered?.email || '').trim().toLowerCase() === String(parsedUser.email || '').trim().toLowerCase();
          if (same && remembered?.password) {
            window.ddaElectronAPI?.saveAppLogin?.({ email: remembered.email, password: remembered.password })?.catch?.(() => {});
          }
        } catch (_) {}

        // Still signed in (app reopened, a reload, a new window): this
        // computer's applicant list; the server is asked only at sign-in, on
        // refresh, or when there is no list here yet.
        // Admin skips booking key verification directly into Workspace
        if (isAdmin) {
          set({ activeKey: savedKey || null, currentView: 'WORKSPACE' });
          await useApplicantStore.getState().loadApplicants(parsedUser, { fromServer: false });
          return;
        }

        // Normal users: if key already saved, enter workspace; otherwise require key
        if (savedKey) {
          set({ activeKey: savedKey, currentView: 'WORKSPACE' });
          await useApplicantStore.getState().loadApplicants(parsedUser, { fromServer: false });
          return;
        }

        set({ currentView: 'KEY' });
        return;
      }
      set({ currentView: 'LOGIN' });
    } catch (err) {
      console.error('Session restore error:', err);
      set({ currentView: 'LOGIN' });
    }
  },

  // Stage 1: Email/Password Login
  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.login(email, password);
      if (res.success && res.user) {
        const isAdmin = Boolean(
          res.user.isAdmin === true ||
          res.user.role === 'admin' ||
          localStorage.getItem('dda_is_admin') === 'true' ||
          localStorage.getItem('dda_user_role') === 'admin'
        );

        localStorage.setItem('dda_auth_user', JSON.stringify(res.user));
        try {
          if (res.user.email) localStorage.setItem('dda_auth_email', res.user.email);
          if (res.user.uid) localStorage.setItem('dda_auth_uid', res.user.uid);
          if (res.user.idToken) {
            localStorage.setItem('dda_id_token', res.user.idToken);
            sessionStorage.setItem('dda_id_token', res.user.idToken);
          }
          window.ddaElectronAPI?.setActiveUser?.(res.user);
        } catch (_) {}
        // Kept encrypted on this PC so the web portal window signs in with the
        // same account (deleted on sign-out)
        try { window.ddaElectronAPI?.saveAppLogin?.({ email, password })?.catch?.(() => {}); } catch (_) {}

        const savedKey = localStorage.getItem('dda_booking_key');

        if (isAdmin) {
          // Admin skips booking key verification; the applicant picker comes first
          set({
            user: res.user,
            activeKey: savedKey || null,
            currentView: 'PICK_APPLICANT',
            isLoading: false,
            error: null
          });
          await useApplicantStore.getState().loadApplicants(res.user);
        } else if (savedKey) {
          set({
            user: res.user,
            activeKey: savedKey,
            currentView: 'PICK_APPLICANT',
            isLoading: false,
            error: null
          });
          await useApplicantStore.getState().loadApplicants(res.user);
        } else {
          // Normal users must complete booking key verification
          set({
            user: res.user,
            activeKey: null,
            currentView: 'KEY',
            isLoading: false,
            error: null
          });
        }
        return { success: true, user: res.user };
      } else {
        set({ error: res.error || 'Invalid credentials.', isLoading: false });
        return { success: false, error: res.error || 'Invalid credentials.' };
      }
    } catch (err) {
      const errorMsg = err.message || 'Login failed.';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  // Stage 2: Booking Key Verification
  verifyKey: async (key) => {
    const { user } = get();
    set({ isLoading: true, error: null });
    try {
      const res = await api.validateBookingKey(key, user);
      if (res.success) {
        set({
          activeKey: res.key,
          currentView: 'PICK_APPLICANT',
          isLoading: false,
          error: null
        });
        localStorage.setItem('dda_booking_key', res.key);
        if (res.windowEnd) localStorage.setItem('dda_window_end', res.windowEnd);
        try {
          if (user?.email) localStorage.setItem('dda_auth_email', user.email);
          if (user?.uid) localStorage.setItem('dda_auth_uid', user.uid);
          if (user?.idToken) {
            localStorage.setItem('dda_id_token', user.idToken);
            sessionStorage.setItem('dda_id_token', user.idToken);
          }
          window.ddaElectronAPI?.setActiveUser?.(user);
        } catch (_) {}
        await useApplicantStore.getState().loadApplicants(user);
        return { success: true, key: res.key };
      } else {
        set({ error: res.error || 'Invalid booking key.', isLoading: false });
        return { success: false, error: res.error || 'Invalid booking key.' };
      }
    } catch (err) {
      const errorMsg = err.message || 'Key verification failed.';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  // Stage 3: App User Logout (Desktop App Sign Out)
  // `reason` is shown on the login screen (e.g. booking window ended).
  logout: async (reason = null) => {
    // 1. Preserve saved login credentials vault (users.json) & remember-me credentials
    const loginUsersVault = localStorage.getItem('dda_login_users');
    const loginUsersOwner = localStorage.getItem(LOGINS_OWNER_KEY);
    const rememberMeFlag = localStorage.getItem('dda_remember_me');
    const rememberedCreds = localStorage.getItem('dda_remembered_credentials');
    // Login applicant locks (one per window, "<session>::dda_locked_login_pan"):
    // a lock is only removed by unlocking it, so it survives an app sign-out.
    const loginLocks = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /(^|::)dda_locked_login_pan$/.test(k)) loginLocks.push([k, localStorage.getItem(k)]);
      }
    } catch (_) {}

    // 2. Wipe all local storage & session storage clean
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {}

    // 3. Restore the login credentials vault & remember-me credentials
    if (loginUsersVault) {
      try {
        localStorage.setItem('dda_login_users', loginUsersVault);
        if (loginUsersOwner) localStorage.setItem(LOGINS_OWNER_KEY, loginUsersOwner);
      } catch (_) {}
    }
    if (rememberMeFlag) {
      try {
        localStorage.setItem('dda_remember_me', rememberMeFlag);
        if (rememberedCreds) localStorage.setItem('dda_remembered_credentials', rememberedCreds);
      } catch (_) {}
    }

    for (const [k, v] of loginLocks) {
      try { if (v) localStorage.setItem(k, v); } catch (_) {}
    }

    // 4. Reset Electron process active state & clear DDA portal session / cookies
    try { window.ddaElectronAPI?.setActiveUser?.(null); } catch (_) {}
    try { window.ddaElectronAPI?.setBookingWindowEnd?.(null); } catch (_) {}
    try { window.ddaElectronAPI?.setActiveApplicant?.(null); } catch (_) {}
    try { await window.ddaElectronAPI?.clearDdaSession?.(); } catch (_) {}
    // The web portal window's login goes too (and the portal is signed out)
    try { await window.ddaElectronAPI?.clearAppLogin?.(); } catch (_) {}
    try { api.logout?.().catch?.(() => {}); } catch (_) {}

    // 5. Reset applicant store and reload login users vault from users.json
    try {
      useApplicantStore.getState().reset();
      useApplicantStore.getState().loadLoginUsers();
    } catch (_) {}

    // 6. Reset automation store logs and timers
    try {
      useAutomationStore.getState().clearLogs?.();
      useAutomationStore.getState().setTimedActive(false);
      useAutomationStore.getState().setIsSearching(false);
    } catch (_) {}

    set({
      user: null,
      activeKey: null,
      currentView: 'LOGIN',
      error: typeof reason === 'string' ? reason : null,
      isLoading: false
    });
  },

  // Another window signed out: only this window's own state goes. The shared
  // storage, the main process's user and the DDA logins were already cleared
  // there, and must not be touched here (that window may be signed in again).
  resetSignedOutWindow: () => {
    try { sessionStorage.removeItem('dda_id_token'); } catch (_) {}
    try {
      useApplicantStore.getState().reset();
      useApplicantStore.getState().loadLoginUsers();
    } catch (_) {}
    try {
      useAutomationStore.getState().clearLogs?.();
      useAutomationStore.getState().setTimedActive(false);
      useAutomationStore.getState().setIsSearching(false);
    } catch (_) {}
    set({
      user: null,
      activeKey: null,
      currentView: 'LOGIN',
      error: 'You were signed out in another window.',
      isLoading: false
    });
  },

  setCurrentView: (view) => set({ currentView: view }),
  setError: (error) => set({ error })
}));
