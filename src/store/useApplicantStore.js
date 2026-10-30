import { create } from "zustand";
import { api, loginsFromApplicants } from "../services/api.js";
import { useAutomationStore } from "./useAutomationStore.js";
import { wsGet, wsSet, wsRemove } from "../utils/storageHelper.js";
import OFFLINE_STORE from "../../dda_db/dda_offline_store.json";
import { applyLocalPrefs, prefsHash, reconcileLocalPrefs, fastPaymentKey } from "../utils/localPrefs.js";
import { detectDdaStage } from "../utils/ddaRoutes.js";

export const KNOWN_APPLICANT_PASSWORDS = {};

// The app user (uid) whose server logins this computer's login list holds;
// kept through an app sign-out (useAuthStore.logout).
export const LOGINS_OWNER_KEY = "dda_login_users_owner";

// DDA logins come from the server (each applicant's saved password) into this
// computer's login_profiles.json; no passwords are bundled with the app.

const isAppAdmin = () => {
  try {
    return localStorage.getItem('dda_is_admin') === 'true' || localStorage.getItem('dda_user_role') === 'admin';
  } catch (_) {
    return false;
  }
};

export const normalizeLoginProfile = (u) => {
  if (!u) return null;
  const pan = (
    u.pan ||
    u.PAN ||
    u.username ||
    u.userName ||
    u.userId ||
    u.user ||
    u.personal?.pan ||
    ''
  ).toUpperCase().trim();
  if (!pan) return null;

  const password = (
    u.password ||
    u.Password ||
    u.pass ||
    u.pwd ||
    u.personal?.password ||
    KNOWN_APPLICANT_PASSWORDS[pan] ||
    ''
  ).trim();

  const name = (
    [u.personal?.firstName, u.personal?.lastName].filter(Boolean).join(' ') ||
    u.name ||
    u.Name ||
    u.fullName ||
    u.displayName ||
    pan
  ).trim();

  // Archived logins are kept for testing but left out of the login dropdown.
  // localEdit: changed on this computer and kept until "Sync from server".
  return {
    name,
    pan,
    password,
    ...(u.archived ? { archived: true } : {}),
    ...(u.localEdit ? { localEdit: true } : {}),
  };
};

// Logins offered for booking (archived ones left out).
export const activeLoginUsers = (list) => (Array.isArray(list) ? list.filter((u) => u && !u.archived) : []);

export const normalizeLoginProfilesList = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(normalizeLoginProfile).filter(Boolean);
  }
  if (typeof raw === 'object' && raw !== null) {
    if (Array.isArray(raw.users)) return raw.users.map(normalizeLoginProfile).filter(Boolean);
    if (Array.isArray(raw.profiles)) return raw.profiles.map(normalizeLoginProfile).filter(Boolean);
    if (Array.isArray(raw.accounts)) return raw.accounts.map(normalizeLoginProfile).filter(Boolean);
    return Object.entries(raw).map(([key, val]) => {
      if (typeof val === 'string') {
        return normalizeLoginProfile({ pan: key, password: val });
      }
      return normalizeLoginProfile({ ...(val || {}), pan: val?.pan || key });
    }).filter(Boolean);
  }
  return [];
};

const getDeletedPans = () => {
  try {
    const stored = JSON.parse(localStorage.getItem('dda_deleted_pans') || '[]');
    return Array.isArray(stored) ? stored.map(p => String(p).toUpperCase().trim()) : [];
  } catch (_) {
    return [];
  }
};

const panOf = (a) => String(a?.pan || a?.personal?.pan || '').toUpperCase().trim();

// Flat preferences changed in the app live in main's local database (per app
// user). Outside Electron they fall back to localStorage.
const readLocalPrefs = async () => {
  try {
    if (window.ddaElectronAPI?.getLocalPrefs) return (await window.ddaElectronAPI.getLocalPrefs()) || {};
    return JSON.parse(localStorage.getItem('dda_local_prefs') || '{}');
  } catch (_) {
    return {};
  }
};
const writeLocalPref = (pan, entry) => {
  try {
    if (window.ddaElectronAPI?.saveLocalPrefs) {
      window.ddaElectronAPI.saveLocalPrefs(pan, entry || null)?.catch?.(() => {});
    } else {
      const all = JSON.parse(localStorage.getItem('dda_local_prefs') || '{}');
      if (entry) all[pan] = entry; else delete all[pan];
      localStorage.setItem('dda_local_prefs', JSON.stringify(all));
    }
  } catch (_) {}
};

// Session-only flat overrides from older versions (sessionStorage), moved into
// the local store once.
const takeLegacySessionOverrides = () => {
  try {
    const raw = sessionStorage.getItem('dda_session_overrides') || wsGet('dda_session_overrides');
    sessionStorage.removeItem('dda_session_overrides');
    wsRemove('dda_session_overrides');
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
};

// Hands the merged active applicant to the booking side (main + DDA preload)
// and the renderer caches. Skips the hand-off when nothing changed.
const pushActive = (active, previous) => {
  if (typeof window === 'undefined') return;
  try {
    window.__ACTIVE_APPLICANT__ = active || undefined;
    if (active) {
      let ddaData = {};
      try { ddaData = JSON.parse(localStorage.getItem('ddaData') || '{}'); } catch (_) {}
      if (!ddaData.applicants) ddaData.applicants = {};
      ddaData.applicants[panOf(active)] = active;
      try { localStorage.setItem('ddaData', JSON.stringify(ddaData)); } catch (_) {}
      if (active.preferences?.flatNo) wsSet('dda_target_flats', JSON.stringify(active.preferences.flatNo));
    }
    if (JSON.stringify(active || null) !== JSON.stringify(previous || null)) {
      window.ddaElectronAPI?.setActiveApplicant?.(active || null);
    }
  } catch (_) {}
};

// Cloud/cached list → app shape: drops deleted and empty shell records, and
// fills the login password and bank/address the app keeps locally.
const normalizeApplicants = (list) => {
  const deletedPans = getDeletedPans();
  return (Array.isArray(list) ? list : [])
    .filter((a) => {
      const p = (a.pan || a.personal?.pan || a.id || '').toUpperCase().trim();
      return p && !deletedPans.includes(p) && p !== 'ABCDEF2343' && p !== 'ABCXX2343X';
    })
    .filter((a) => {
      // Purge any legacy ad-hoc shell applicants without personal KYC
      const id = String(a.id || '');
      const hasKyc = Boolean(
        a.personal?.firstName ||
        a.bank?.accountNo ||
        a.address?.line1 ||
        OFFLINE_STORE?.applicants?.[(a.pan || '').toUpperCase()]
      );
      return !((id.startsWith('user_') || id.startsWith('saved_')) && !hasKyc);
    })
    .map((app) => {
      const pan = (app.pan || app.personal?.pan || app.id || "").trim().toUpperCase();
      const resolvedPassword = (
        app.password ||
        app.personal?.password ||
        KNOWN_APPLICANT_PASSWORDS[pan] ||
        ""
      ).trim();
      if (resolvedPassword) {
        KNOWN_APPLICANT_PASSWORDS[pan] = resolvedPassword;
      }
      return {
        ...app,
        pan: pan || app.pan,
        password: resolvedPassword,
        personal: {
          ...(app.personal || {}),
          pan: pan || app.personal?.pan || "",
          password: resolvedPassword,
        },
        bank: {
          ...(app.bank || app.bankDetails || OFFLINE_STORE?.applicants?.[pan]?.bank || {}),
        },
        address: {
          ...(app.address || app.addressDetails || OFFLINE_STORE?.applicants?.[pan]?.address || {}),
        },
        ...lightFlags(app),
      };
    });
};

// A record from the light list (files left out, paths in _omitted): _light
// until its full record is downloaded; _missingMedia while a file it left out
// is not on this computer either (the form waits for the full record then).
const lightFlags = (app) => {
  const omitted = Array.isArray(app._omitted) ? app._omitted : [];
  if (!omitted.length) return { _light: false, _missingMedia: false };
  const missing = omitted.some((path) => {
    let v = app;
    for (const k of String(path).split('.')) v = v && typeof v === 'object' ? v[k] : undefined;
    return typeof v !== 'string' || !v;
  });
  return { _light: true, _missingMedia: missing };
};

// Full-record downloads in progress, by PAN
const FULL_PENDING = new Map();
let backfillRunning = false;

export const useApplicantStore = create((set, get) => ({
  applicants: [],
  masterApplicants: [],
  // Flat preferences changed in the app: { [PAN]: { preferences, baseHash, savedAt } }
  localPrefs: {},
  localPrefsLoaded: false,
  userOwnedApplicants: [],
  activeApplicant: null,
  schemes: [],
  activeScheme:
    (typeof window !== "undefined"
      ? wsGet("dda_selected_scheme") ||
        wsGet("dda_target_scheme") ||
        wsGet("dda_active_scheme")
      : "") || "",
  loginUsers: (() => {
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem('dda_login_users');
        if (raw) {
          const parsed = JSON.parse(raw);
          const normalized = normalizeLoginProfilesList(parsed);
          if (normalized.length > 0) return normalized;
        }
      }
    } catch (_) {}
    return [];
  })(),
  isLoading: false,
  isModalOpen: false,
  modalSaveAndSearch: false,
  isAddUserModalOpen: false,
  addUserPrefill: null,
  isEditUsersModalOpen: false,
  isDetailsModalOpen: false,
  editingApplicant: null,
  viewingApplicant: null,
  lastSyncTime: null,
  isSyncing: false,
  // Last download of the applicant list: idle | syncing | done | offline
  serverSync: 'idle',

  // Dedicated loader for this machine's local DDA login-profile vault
  loadLoginUsers: async () => {
    let diskUsers = [];
    let hasLocalProfileFile = false;
    // Read straight from the profile file: nothing to write back.
    let readFromFile = false;

    // 1. Electron IPC: read the machine-local profile file
    try {
      if (typeof window !== 'undefined' && window.ddaElectronAPI?.loadLoginUsers) {
        const res = await window.ddaElectronAPI.loadLoginUsers();
        if (Array.isArray(res)) {
          diskUsers = normalizeLoginProfilesList(res);
          hasLocalProfileFile = true;
          readFromFile = true;
        }
      }
    } catch (_) {}

    // 2. Preserve browser-local edits when Electron's local file is unavailable.
    if (!hasLocalProfileFile && typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('dda_login_users');
        if (raw) {
          diskUsers = normalizeLoginProfilesList(JSON.parse(raw));
          hasLocalProfileFile = true;
        }
      } catch (_) {}
    }


    // Seed passwords into lookup table
    diskUsers.forEach((u) => {
      const p = (u.pan || '').toUpperCase().trim();
      const pass = (u.password || '').trim();
      if (p && pass) KNOWN_APPLICANT_PASSWORDS[p] = pass;
    });

    if (hasLocalProfileFile || diskUsers.length > 0) {
      set({ loginUsers: diskUsers });
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('dda_login_users', JSON.stringify(diskUsers));
          // Only profiles from a fallback (browser storage / first-run seed)
          // are saved to the file; rewriting what was just read is pointless.
          if (!readFromFile) window.ddaElectronAPI?.saveLoginUsers?.(diskUsers)?.catch?.(() => {});
        }
      } catch (_) {}
    }

    return diskUsers;
  },

  // Local flat preferences, read once per sign-in. Session-only overrides
  // from older versions are moved in, based on the given list.
  ensureLocalPrefs: async (applicants) => {
    if (get().localPrefsLoaded) return get().localPrefs || {};
    const stored = await readLocalPrefs();
    const legacy = takeLegacySessionOverrides();
    const prefs = { ...stored };
    for (const [pan, legacyPrefs] of Object.entries(legacy || {})) {
      const base = applicants.find((a) => panOf(a) === pan);
      if (prefs[pan] || !base || !legacyPrefs) continue;
      prefs[pan] = { preferences: legacyPrefs, baseHash: prefsHash(base.preferences), savedAt: new Date().toISOString() };
      writeLocalPref(pan, prefs[pan]);
    }
    set({ localPrefs: prefs, localPrefsLoaded: true });
    return prefs;
  },

  // Drops local flat preferences whose cloud preferences changed (the cloud
  // wins) or whose applicant is gone. Only for a fresh cloud list.
  reconcileLocalPrefs: (applicants, prefs) => {
    const { kept, dropped, trimmed } = reconcileLocalPrefs(prefs, applicants);
    const note = (item) => {
      const reasons = item.reasons || [item.reason];
      try {
        if (reasons.includes('changed')) {
          useAutomationStore.getState().addLog(
            'INFO',
            'Applicants',
            `Preferences for ${item.name} were updated from the server; your local flat list was replaced.`,
            item.pan,
          );
        }
        if (reasons.includes('paymentChanged')) {
          useAutomationStore.getState().addLog(
            'INFO',
            'Applicants',
            `Fast Payment for ${item.name} was changed on the website; the one set in this app was replaced.`,
            item.pan,
          );
        }
      } catch (_) {}
    };
    for (const item of dropped) {
      writeLocalPref(item.pan, null);
      note(item);
    }
    for (const item of trimmed) {
      writeLocalPref(item.pan, item.entry);
      note(item);
    }
    if (dropped.length || trimmed.length) set({ localPrefs: kept });
    return kept;
  },

  // Puts a (pristine) list in the store with local flat preferences on top,
  // keeps the selected applicant and hands it to the booking side.
  applyApplicantList: (applicants, prefs, { restoreSelection = true } = {}) => {
    const merged = applicants.map((a) => applyLocalPrefs(a, prefs));
    const previous = get().activeApplicant;
    let activePan = panOf(previous);
    if (!activePan && restoreSelection) {
      // Fresh load/reload: restore the last selection for this window
      try {
        activePan = (wsGet('dda_active_applicant_pan') || wsGet('dda_selected_person') || '').toUpperCase().trim();
      } catch (_) {}
    }
    const found = activePan ? merged.find((a) => panOf(a) === activePan) || null : null;
    // Keep the scheme the app put on the selected applicant
    const nextActive = found && previous?.preferences?.scheme
      ? { ...found, preferences: { ...found.preferences, scheme: previous.preferences.scheme } }
      : found;
    set({
      masterApplicants: applicants,
      applicants: merged,
      // The sidebar shows this list for non-admin users: it must carry the
      // local flat edits too (masterApplicants keeps the server's copy).
      userOwnedApplicants: merged,
      activeApplicant: nextActive,
    });
    pushActive(nextActive, previous);
    return nextActive;
  },

  // Load applicants for the signed-in user: the list kept on this computer
  // first (instant), then, with fromServer, the cloud list, which also brings
  // the DDA logins (one download for both).
  // The cloud list is downloaded only at app sign-in and when the user asks
  // (refresh next to the lock, sync on the picker); a new window, a reload or
  // the app reopening while signed in uses this computer's copy, and
  // downloads only when there is no copy yet. Changes made later arrive one
  // applicant at a time (patchApplicantsFromServer).
  // replaceLogins: the logins become exactly the server's (local edits too).
  // Returns { fromCloud, count }, or null without a user.
  loadApplicants: async (user, { fromServer = true, replaceLogins = false } = {}) => {
    if (!user) return null;
    const hadList = (get().masterApplicants || []).length > 0;
    if (!hadList) set({ isLoading: true });
    try {
      // 0. This computer's DDA logins
      await get().loadLoginUsers();

      let cachedCount = 0;
      if (!hadList) {
        const cached = normalizeApplicants(await api.getCachedApplicants(user));
        cachedCount = cached.length;
        if (cached.length) {
          get().applyApplicantList(cached, await get().ensureLocalPrefs(cached));
          set({ isLoading: false });
        }
      }

      const useServer = fromServer || (!hadList && cachedCount === 0);
      if (!useServer && hadList) {
        set({ isLoading: false });
        return { fromCloud: false, count: (get().masterApplicants || []).length };
      }

      // 1. Fetch real booking applicants from backend (or keep the copy above)
      let nextActive = get().activeApplicant;
      let fromCloud = false;
      if (useServer) {
        set({ serverSync: 'syncing' });
        const applicants = normalizeApplicants(await api.getApplicantsByUser(user));
        fromCloud = api.lastApplicantsFromCloud;
        let prefs = await get().ensureLocalPrefs(applicants);
        if (fromCloud) prefs = get().reconcileLocalPrefs(applicants, prefs);
        nextActive = get().applyApplicantList(applicants, prefs);
        // The DDA logins come with the list (local edits kept, unless replaceLogins).
        // This computer's logins are one list for whoever signs in, so when a
        // different app user signs in they become exactly that user's.
        if (fromCloud) {
          const uid = String(user.uid || user.email || '').trim();
          let owner = '';
          try { owner = localStorage.getItem(LOGINS_OWNER_KEY) || ''; } catch (_) {}
          const otherUser = !!owner && !!uid && owner !== uid;
          await get().applyServerLogins(loginsFromApplicants(applicants), { replaceAll: replaceLogins || otherUser });
          try { if (uid) localStorage.setItem(LOGINS_OWNER_KEY, uid); } catch (_) {}
        }
        set({ serverSync: fromCloud ? 'done' : 'offline' });
        // Light list: files this computer doesn't have come down afterwards
        if (fromCloud && applicants.some((a) => a._missingMedia)) {
          setTimeout(() => get().backfillMissingFiles(user), 3000);
        }
      }

      // Check for backend active scheme in ddaData / localStorage
      let backendScheme = "";
      let backendSchemesList = [];

      try {
        const storedSchemes = JSON.parse(
          localStorage.getItem("dda_schemes") || "[]",
        );
        if (Array.isArray(storedSchemes) && storedSchemes.length > 0) {
          backendSchemesList = storedSchemes.filter(
            (s) =>
              s &&
              !s.toLowerCase().includes("admin_bypass") &&
              s.toLowerCase() !== "admin",
          );
        }
      } catch (_) {}

      try {
        const rawDdaData = localStorage.getItem("ddaData");
        if (rawDdaData) {
          const parsed = JSON.parse(rawDdaData);
          if (
            parsed?.targetScheme &&
            !parsed.targetScheme.toLowerCase().includes("admin_bypass")
          ) {
            backendScheme = parsed.targetScheme;
          }
          if (
            parsed?.schemes &&
            Array.isArray(parsed.schemes) &&
            parsed.schemes.length > 0
          ) {
            const cleanParsed = parsed.schemes.filter(
              (s) =>
                s &&
                !s.toLowerCase().includes("admin_bypass") &&
                s.toLowerCase() !== "admin",
            );
            backendSchemesList = Array.from(
              new Set([...backendSchemesList, ...cleanParsed]),
            ).filter(Boolean);
          }
        }
      } catch (_) {}

      // Fetch live schemes from Firestore / Worker (with a download only;
      // the live schemes listener keeps them current otherwise)
      if (useServer) {
        try {
          const liveSchemes = await api.getSchemes(user);
          if (Array.isArray(liveSchemes) && liveSchemes.length > 0) {
            backendSchemesList = Array.from(
              new Set([...backendSchemesList, ...liveSchemes]),
            ).filter(Boolean);
          }
        } catch (_) {}
      }

      // Prioritize user's selected scheme, then backend active scheme, or previously selected valid scheme from localStorage
      const userSelected = wsGet("dda_selected_scheme");
      const storedSaved =
        (userSelected && !userSelected.toLowerCase().includes("admin_bypass") ? userSelected : null) ||
        wsGet("dda_target_scheme") ||
        wsGet("dda_active_scheme");
      const validStored =
        storedSaved && !storedSaved.toLowerCase().includes("admin_bypass")
          ? storedSaved
          : null;
      const activeSchemeName =
        validStored ||
        backendScheme ||
        nextActive?.preferences?.scheme ||
        backendSchemesList[0] ||
        "";

      set({
        schemes: backendSchemesList,
        activeScheme: activeSchemeName,
        isLoading: false,
        ...(useServer ? { lastSyncTime: Date.now() } : {}),
      });
      return { fromCloud, count: (get().masterApplicants || []).length };
    } catch (err) {
      console.error("Failed to load applicants:", err);
      if (get().serverSync === 'syncing') set({ serverSync: 'offline' });
      // Keep what is already shown (e.g. the cached list) rather than blanking it
      if ((get().masterApplicants || []).length) {
        set({ isLoading: false });
        return { fromCloud: false, count: (get().masterApplicants || []).length };
      }
      set({
        masterApplicants: [],
        applicants: [],
        userOwnedApplicants: [],
        activeApplicant: null,
        schemes: [],
        activeScheme:
          wsGet("dda_selected_scheme") ||
          wsGet("dda_target_scheme") ||
          "",
        isLoading: false,
      });
      return { fromCloud: false, count: 0 };
    }
  },

  // Applicants that changed in the cloud (the "changed" note): download just
  // those and put them in the list; a PAN reported missing (removed, or no
  // longer this user's) leaves the list. Their logins are updated the same
  // way (local edits kept). Returns false when the cloud was not reachable.
  // onlyKnown: only update applicants still in the list (full-record
  // downloads; nothing comes back after a sign-out emptied the list).
  patchApplicantsFromServer: async (user, pans, { onlyKnown = false } = {}) => {
    if (!user || !Array.isArray(pans) || pans.length === 0) return true;
    const res = await api.getApplicantsByPans(user, pans);
    if (!res) return false;
    if (onlyKnown) {
      const known = new Set((get().masterApplicants || []).map(panOf));
      res.applicants = (res.applicants || []).filter((a) => known.has(panOf(a)));
      res.missing = (res.missing || []).filter((p) => known.has(p));
      if (!res.applicants.length && !res.missing.length) return true;
    }

    const fresh = normalizeApplicants(res.applicants);
    const byPan = new Map(fresh.map((a) => [panOf(a), a]));
    const missing = new Set(res.missing);
    const current = get().masterApplicants || [];
    const next = [];
    const seen = new Set();
    for (const a of current) {
      const pan = panOf(a);
      if (missing.has(pan)) continue;
      if (byPan.has(pan)) {
        next.push(byPan.get(pan));
        seen.add(pan);
      } else {
        next.push(a);
      }
    }
    for (const [pan, a] of byPan) if (!seen.has(pan)) next.push(a);

    // This computer's copy follows (what new windows and reloads show)
    try {
      if (fresh.length) window.ddaElectronAPI?.cacheApplicants?.(fresh)?.catch?.(() => {});
      if (missing.size) window.ddaElectronAPI?.uncacheApplicants?.([...missing])?.catch?.(() => {});
      localStorage.setItem('dda_extension_applicants', JSON.stringify(next));
      localStorage.setItem('dda_user_applicants', JSON.stringify(next));
    } catch (_) {}

    // Local flat preferences: the cloud wins where it changed
    const prefs = get().reconcileLocalPrefs(next, get().localPrefs || {});
    get().applyApplicantList(next, prefs, { restoreSelection: false });
    set({ lastSyncTime: Date.now() });

    await get().applyServerLogins(loginsFromApplicants(fresh), { onlyPans: [...byPan.keys(), ...missing] });
    return true;
  },

  // The full record (with photo, signature and documents) of an applicant
  // that came in the light list; once per applicant, the first time it is
  // the window's applicant. When the cloud can't be reached, the copy on
  // this computer is used as it is (blank placeholders for missing files).
  ensureFullRecord: (user, pan) => {
    const p = String(pan || '').toUpperCase().trim();
    if (!user || !p) return Promise.resolve(false);
    const rec = (get().masterApplicants || []).find((a) => panOf(a) === p);
    if (!rec?._light) return Promise.resolve(true);
    if (FULL_PENDING.has(p)) return FULL_PENDING.get(p);
    const job = (async () => {
      let ok = false;
      try { ok = await get().patchApplicantsFromServer(user, [p], { onlyKnown: true }); } catch (_) {}
      if (!ok) get().markFilesSettled(p);
      return ok;
    })().finally(() => FULL_PENDING.delete(p));
    FULL_PENDING.set(p, job);
    return job;
  },

  // The full record could not be downloaded: stop waiting for its files
  // (a later lock tries again, since the record stays light)
  markFilesSettled: (pan) => {
    const settle = (a) => (panOf(a) === pan && a._missingMedia ? { ...a, _missingMedia: false } : a);
    const { masterApplicants, applicants, userOwnedApplicants, activeApplicant } = get();
    const nextActive = activeApplicant ? settle(activeApplicant) : activeApplicant;
    set({
      masterApplicants: (masterApplicants || []).map(settle),
      applicants: (applicants || []).map(settle),
      userOwnedApplicants: (userOwnedApplicants || []).map(settle),
      activeApplicant: nextActive,
    });
    pushActive(nextActive, activeApplicant);
  },

  // In the background after a light list: the full records of applicants
  // whose files this computer doesn't have yet, 10 at a time, pausing while
  // this window is on the flat or hold page.
  backfillMissingFiles: async (user) => {
    if (!user || backfillRunning) return;
    backfillRunning = true;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const busy = () => {
      try {
        const id = detectDdaStage(useAutomationStore.getState().currentUrl || '').id;
        return id === 'FLAT_SELECT' || id === 'PAYMENT_HOLD';
      } catch (_) { return false; }
    };
    try {
      const tried = new Set();
      for (let round = 0; round < 100; round++) {
        const pans = (get().masterApplicants || [])
          .filter((a) => a._missingMedia && !tried.has(panOf(a)) && !FULL_PENDING.has(panOf(a)))
          .map(panOf)
          .slice(0, 10);
        if (!pans.length) break;
        while (busy()) await wait(5000);
        pans.forEach((p) => tried.add(p));
        const ok = await get().patchApplicantsFromServer(user, pans, { onlyKnown: true }).catch(() => false);
        if (!ok) break;
        await wait(1000);
      }
    } finally {
      backfillRunning = false;
    }
  },

  // ─── REAL-TIME LIVE SYNC ENGINE (ZERO STATE DISRUPTION) ─────────────────
  syncRealtimeApplicants: (rawApplicants, backendMeta = {}) => {
    if (!Array.isArray(rawApplicants) || rawApplicants.length === 0) return;

    const deletedPans = getDeletedPans();
    const currentApplicants = get().applicants || [];

    // Filter out deleted profiles so they never resurrect from cloud Firestore
    const filtered = rawApplicants.filter(a => {
      const p = (a.pan || a.personal?.pan || a.id || '').toUpperCase().trim();
      return p && !deletedPans.includes(p) && p !== 'ABCDEF2343' && p !== 'ABCXX2343X';
    });

    // 1. Format raw applicants and STRICTLY PRESERVE existing passwords, bank, and address
    const formatted = filtered.map((app) => {
      const pan = (app.pan || app.personal?.pan || app.id || "").trim().toUpperCase();
      const existing = currentApplicants.find(a => (a.pan || a.personal?.pan || '').toUpperCase().trim() === pan);
      const existingPass = existing?.password || existing?.personal?.password || KNOWN_APPLICANT_PASSWORDS[pan] || '';
      const resolvedPassword = (app.password || app.personal?.password || '').trim() || existingPass;

      if (resolvedPassword) {
        KNOWN_APPLICANT_PASSWORDS[pan] = resolvedPassword;
      }

      return {
        ...app,
        pan: pan || app.pan,
        password: resolvedPassword,
        personal: {
          ...(app.personal || {}),
          pan: pan || app.personal?.pan || "",
          password: resolvedPassword,
        },
        bank: {
          ...(app.bank || app.bankDetails || existing?.bank || OFFLINE_STORE?.applicants?.[pan]?.bank || {}),
        },
        address: {
          ...(app.address || app.addressDetails || existing?.address || OFFLINE_STORE?.applicants?.[pan]?.address || {}),
        },
        eligibility: {
          ...(existing?.eligibility || OFFLINE_STORE?.applicants?.[pan]?.eligibility || {}),
          ...(app.eligibility || app.karmajeevi || {}),
        },
        jointApplicant: {
          ...(existing?.jointApplicant || OFFLINE_STORE?.applicants?.[pan]?.jointApplicant || {}),
          ...(app.jointApplicant || {}),
        },
      };
    });

    // 2. Local flat preferences on top (the cloud wins where it changed)
    let prefs = get().localPrefs || {};
    if (api.lastApplicantsFromCloud) prefs = get().reconcileLocalPrefs(formatted, prefs);

    // 3. Update schemes list without overriding the user's selected activeScheme
    let newSchemes = get().schemes || [];
    if (backendMeta.schemes && Array.isArray(backendMeta.schemes) && backendMeta.schemes.length > 0) {
      const cleanSchemes = backendMeta.schemes.filter(
        (s) => s && !s.toLowerCase().includes('admin_bypass') && s.toLowerCase() !== 'admin'
      );
      if (cleanSchemes.length > 0) {
        newSchemes = Array.from(new Set([...newSchemes, ...cleanSchemes]));
      }
    }

    // 4. Cache the cloud copy (never the locally changed one)
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('dda_extension_applicants', JSON.stringify(formatted));
        localStorage.setItem('dda_user_applicants', JSON.stringify(formatted));
      }
    } catch (_) {}
    try {
      if (typeof window !== 'undefined' && newSchemes.length > 0) {
        localStorage.setItem('dda_schemes', JSON.stringify(newSchemes));
      }
    } catch (_) {}

    // 5. Zero disruption: same selection (never auto-selects one), merged
    // data handed to the booking side; activeScheme and isLoading untouched.
    get().applyApplicantList(formatted, prefs, { restoreSelection: false });
    set({ schemes: newSchemes, lastSyncTime: Date.now(), isSyncing: false });
  },

  // Flat preferences changed in the app (target flats, locality, sector...).
  // Kept on this computer (per app account), not saved to the cloud, until the
  // cloud's preferences for that applicant change or the user resets them.
  setSessionPreferences: (pan, partialPreferences) => {
    const cleanPan = (pan || '').toUpperCase().trim();
    if (!cleanPan) return;
    const master = (get().masterApplicants || []).find((a) => panOf(a) === cleanPan);
    const current = get().localPrefs || {};
    const existing = current[cleanPan];
    const preferences = { ...(existing?.preferences || {}), ...partialPreferences };
    const cloudHash = prefsHash(master?.preferences);
    // The sidebar's Fast Payment (if any) stays with the entry
    const paymentPart = existing?.fastPayment
      ? { fastPayment: existing.fastPayment, fastPaymentBase: existing.fastPaymentBase || '' }
      : null;
    const next = { ...current };
    if (master && prefsHash({ ...(master.preferences || {}), ...preferences }) === cloudHash) {
      // Same as the cloud again: no local flats to keep
      if (paymentPart) {
        next[cleanPan] = { ...paymentPart, savedAt: new Date().toISOString() };
        writeLocalPref(cleanPan, next[cleanPan]);
      } else {
        delete next[cleanPan];
        writeLocalPref(cleanPan, null);
      }
    } else {
      next[cleanPan] = {
        preferences,
        baseHash: existing?.baseHash || cloudHash,
        ...(paymentPart || {}),
        savedAt: new Date().toISOString(),
      };
      writeLocalPref(cleanPan, next[cleanPan]);
    }
    set({ localPrefs: next, isModalOpen: false, editingApplicant: null });
    get().applyApplicantList(get().masterApplicants || [], next, { restoreSelection: false });
  },

  // Fast Payment set in the sidebar for one applicant, kept on this computer
  // until the website's choice for it changes. null (or the website's own
  // choice) goes back to the website's.
  setLocalFastPayment: (pan, fastPayment) => {
    const cleanPan = (pan || '').toUpperCase().trim();
    if (!cleanPan) return;
    const master = (get().masterApplicants || []).find((a) => panOf(a) === cleanPan);
    const cloudKey = fastPaymentKey(master?.preferences?.fastPayment);
    const wantKey = fastPaymentKey(fastPayment);
    const current = get().localPrefs || {};
    const entry = { ...(current[cleanPan] || {}) };
    delete entry.fastPayment;
    delete entry.fastPaymentBase;
    if (wantKey && wantKey !== cloudKey) {
      const gateway = fastPayment.gateway;
      const method = gateway === 'sbi' || fastPayment.method === 'netbanking' ? 'netbanking' : 'card';
      entry.fastPayment = { gateway, method, bank: method === 'netbanking' ? String(fastPayment.bank || '') : '' };
      entry.fastPaymentBase = cloudKey;
    }
    const next = { ...current };
    if (entry.preferences || entry.fastPayment) {
      next[cleanPan] = { ...entry, savedAt: new Date().toISOString() };
      writeLocalPref(cleanPan, next[cleanPan]);
    } else {
      delete next[cleanPan];
      writeLocalPref(cleanPan, null);
    }
    set({ localPrefs: next });
    get().applyApplicantList(get().masterApplicants || [], next, { restoreSelection: false });
  },

  // Back to the cloud's flat preferences for one applicant (or all). One
  // applicant's sidebar Fast Payment stays (it has its own reset).
  clearSessionOverrides: (pan) => {
    const cleanPan = pan ? String(pan).toUpperCase().trim() : '';
    let next = { ...(get().localPrefs || {}) };
    if (cleanPan) {
      const existing = next[cleanPan];
      if (existing?.fastPayment) {
        next[cleanPan] = { fastPayment: existing.fastPayment, fastPaymentBase: existing.fastPaymentBase || '', savedAt: new Date().toISOString() };
        writeLocalPref(cleanPan, next[cleanPan]);
      } else {
        delete next[cleanPan];
        writeLocalPref(cleanPan, null);
      }
    } else {
      next = {};
      try { window.ddaElectronAPI?.clearLocalPrefs?.()?.catch?.(() => {}); } catch (_) {}
      try { localStorage.removeItem('dda_local_prefs'); } catch (_) {}
    }
    set({ localPrefs: next });
    get().applyApplicantList(get().masterApplicants || [], next, { restoreSelection: false });
  },

  // Direct alias for applicant logout from DDA website
  resetApplicantPreferences: (pan) => get().clearSessionOverrides(pan),

  // Set active target scheme (Admin scheme bypass & test switcher)
  setActiveScheme: (scheme) => {
    if (!scheme || scheme.toLowerCase().includes('admin_bypass') || scheme.toLowerCase() === 'admin') return;
    try {
      wsSet('dda_selected_scheme', scheme);
      wsSet('dda_target_scheme', scheme);
      wsSet('dda_active_scheme', scheme);
      wsSet('dda_active_scheme_name', scheme);
      const rawDdaData = localStorage.getItem('ddaData');
      if (rawDdaData) {
        const parsed = JSON.parse(rawDdaData);
        parsed.targetScheme = scheme;
        localStorage.setItem('ddaData', JSON.stringify(parsed));
      }
    } catch (_) {}

    // Synchronize active applicant's scheme preference
    const activeApp = get().activeApplicant;
    if (activeApp) {
      const updated = {
        ...activeApp,
        preferences: {
          ...(activeApp.preferences || {}),
          scheme
        }
      };
      set({ activeScheme: scheme, activeApplicant: updated });
    } else {
      set({ activeScheme: scheme });
    }
  },

  setSchemes: (schemes) => {
    const clean = Array.isArray(schemes) 
      ? schemes.map(s => String(s).trim()).filter(s => s && !s.toLowerCase().includes('admin_bypass') && s.toLowerCase() !== 'admin')
      : [];
    const unique = Array.from(new Set(clean)).sort((a, b) => a.localeCompare(b));
    try {
      if (typeof window !== 'undefined' && unique.length > 0) {
        localStorage.setItem('dda_schemes', JSON.stringify(unique));
        let ddaData = {};
        try { ddaData = JSON.parse(localStorage.getItem('ddaData') || '{}'); } catch (_) {}
        ddaData.schemes = unique;
        localStorage.setItem('ddaData', JSON.stringify(ddaData));
      }
    } catch (_) {}
    set({ schemes: unique });
  },

    // Select active applicant by PAN
  selectApplicant: (pan) => {
    if (!pan) {
      set({ activeApplicant: null });
      try {
        wsRemove('dda_active_applicant_pan');
        wsRemove('dda_selected_person');
      } catch (_) {}
      return;
    }
    const cleanPan = (pan || '').toUpperCase().trim();
    const { applicants, activeScheme, schemes } = get();
    const found = applicants.find((a) => (a.pan || a.personal?.pan || '').toUpperCase().trim() === cleanPan);
    if (found) {
      const resolvedPassword = (found.password || found.personal?.password || KNOWN_APPLICANT_PASSWORDS[cleanPan] || '').trim();
      
      let ddaData = {};
      try { ddaData = JSON.parse(localStorage.getItem('ddaData') || '{}'); } catch (_) {}
      const existingInDdaData = ddaData.applicants?.[cleanPan] || {};

      const offlineApp = OFFLINE_STORE?.applicants?.[cleanPan] || {};

      const enrichedFound = {
        ...offlineApp,
        ...existingInDdaData,
        ...found,
        pan: cleanPan,
        password: resolvedPassword,
        personal: {
          ...(offlineApp.personal || {}),
          ...(existingInDdaData.personal || {}),
          ...(found.personal || {}),
          pan: cleanPan,
          password: resolvedPassword,
        },
        bank: {
          ...(offlineApp.bank || offlineApp.bankDetails || {}),
          ...(existingInDdaData.bank || existingInDdaData.bankDetails || {}),
          ...(found.bank || found.bankDetails || {}),
        },
        address: {
          ...(offlineApp.address || offlineApp.addressDetails || {}),
          ...(existingInDdaData.address || existingInDdaData.addressDetails || {}),
          ...(found.address || found.addressDetails || {}),
        },
        eligibility: {
          ...(offlineApp.eligibility || offlineApp.karmajeevi || {}),
          ...(existingInDdaData.eligibility || existingInDdaData.karmajeevi || {}),
          ...(found.eligibility || found.karmajeevi || {}),
        },
        jointApplicant: {
          ...(offlineApp.jointApplicant || {}),
          ...(existingInDdaData.jointApplicant || {}),
          ...(found.jointApplicant || {}),
        },
      };

      const selectedScheme = wsGet('dda_selected_scheme');
      const validSelected = (selectedScheme && !selectedScheme.toLowerCase().includes('admin_bypass') && selectedScheme.toLowerCase() !== 'admin' && selectedScheme !== '__live_active_scheme__' && selectedScheme !== '__LIVE__') ? selectedScheme : null;
      const validActive = (activeScheme && !activeScheme.toLowerCase().includes('admin_bypass') && activeScheme.toLowerCase() !== 'admin') ? activeScheme : null;
      const stored = wsGet('dda_active_scheme_name') || wsGet('dda_target_scheme') || wsGet('dda_active_scheme');
      const validStored = (stored && !stored.toLowerCase().includes('admin_bypass') && stored.toLowerCase() !== 'admin') ? stored : null;
      const validFound = (enrichedFound.preferences?.scheme && !enrichedFound.preferences.scheme.toLowerCase().includes('admin_bypass') && enrichedFound.preferences.scheme.toLowerCase() !== 'admin') ? enrichedFound.preferences.scheme : null;
      
      const currentScheme = validSelected || validActive || validStored || validFound || (schemes && schemes[0]) || '';
      
      const updatedFound = {
        ...enrichedFound,
        preferences: {
          ...(enrichedFound.preferences || {}),
          scheme: currentScheme
        }
      };

      try {
        wsSet('dda_active_applicant_pan', cleanPan);
        wsSet('dda_selected_person', cleanPan);
        
        if (!ddaData.applicants) ddaData.applicants = {};
        ddaData.applicants[cleanPan] = updatedFound;
        localStorage.setItem('ddaData', JSON.stringify(ddaData));

        if (typeof window !== 'undefined') {
          window.__ACTIVE_APPLICANT__ = updatedFound;
          sessionStorage.setItem('window.__ACTIVE_APPLICANT__', JSON.stringify(updatedFound));
          localStorage.setItem('window.__ACTIVE_APPLICANT__', JSON.stringify(updatedFound));
          try {
            window.ddaElectronAPI?.setActiveApplicant?.(updatedFound);
          } catch (_) {}
        }
      } catch (_) {}

      set({ 
        activeApplicant: updatedFound,
        activeScheme: currentScheme
      });
    } else {
      set({ activeApplicant: null });
      try {
        wsRemove('dda_active_applicant_pan');
        wsRemove('dda_selected_person');
      } catch (_) {}
    }
  },

  // Save (Create or Update) applicant
  saveApplicant: async (appData, user) => {
    set({ isLoading: true });
    try {
      await api.saveApplicant(appData, user);
      await get().loadApplicants(user);
      set({
        activeApplicant: appData,
        isModalOpen: false,
        editingApplicant: null,
        isLoading: false,
      });
    } catch (err) {
      console.error("Failed to save applicant:", err);
      set({ isLoading: false });
    }
  },

  // Delete applicant by PAN
  deleteApplicant: async (pan, user) => {
    set({ isLoading: true });
    try {
      const cleanPan = (pan || '').toUpperCase().trim();
      if (cleanPan) {
        let deletedPans = getDeletedPans();
        if (!deletedPans.includes(cleanPan)) {
          deletedPans.push(cleanPan);
          localStorage.setItem('dda_deleted_pans', JSON.stringify(deletedPans));
        }
      }
      await api.deleteApplicant(pan, user);
      await get().loadApplicants(user);
      set({ isLoading: false });
    } catch (err) {
      console.error("Failed to delete applicant:", err);
      set({ isLoading: false });
    }
  },

  // Modal controls
  openAddModal: () => set({ isModalOpen: true, editingApplicant: null, modalSaveAndSearch: false }),
  // saveAndSearch: the flat page's "Add more flats" — the modal saves, then starts the search
  openEditModal: (applicant, options = {}) =>
    set({ isModalOpen: true, editingApplicant: applicant, modalSaveAndSearch: Boolean(options.saveAndSearch) }),
  closeModal: () => set({ isModalOpen: false, editingApplicant: null }),
  // prefill: { name, pan } to add the password for a known applicant
  openAddUserModal: (prefill = null) => set({ isAddUserModalOpen: true, addUserPrefill: prefill && prefill.pan ? prefill : null }),
  closeAddUserModal: () => set({ isAddUserModalOpen: false, addUserPrefill: null }),
  openEditUsersModal: () => set({ isEditUsersModalOpen: true }),
  closeEditUsersModal: () => set({ isEditUsersModalOpen: false }),
  openDetailsModal: (applicant) =>
    set({ isDetailsModalOpen: true, viewingApplicant: applicant || get().activeApplicant }),
  closeDetailsModal: () => set({ isDetailsModalOpen: false, viewingApplicant: null }),

  // Bring the logins saved on the server (from the applicant list) into this
  // computer's list.
  //  - normal sync: a login edited on this computer (localEdit) is kept as it
  //    is; every other login takes the server's name and password; logins
  //    that exist only here are kept and marked as local.
  //  - replaceAll ("Sync from server"): the list becomes exactly the
  //    server's, local edits included. Archived marks are kept either way.
  //  - onlyPans: just these logins changed (a patch); the others stay as
  //    they are. A PAN in onlyPans without a server login was removed there.
  // The file is read again first, so a change saved by another window is not
  // overwritten.
  applyServerLogins: async (serverLogins, { replaceAll = false, onlyPans = null } = {}) => {
    if (!Array.isArray(serverLogins)) return;
    await get().loadLoginUsers();
    const current = get().loginUsers || [];

    if (onlyPans) {
      const touched = new Set(onlyPans.map((p) => String(p || '').toUpperCase().trim()));
      const fromServer = new Map(serverLogins.map((l) => [(l.pan || '').toUpperCase().trim(), l]));
      const next = current.map((u) => {
        const pan = (u.pan || '').toUpperCase().trim();
        if (!touched.has(pan) || u.localEdit) return u;
        const srv = fromServer.get(pan);
        // Removed on the server: kept here as a local login
        if (!srv) return { ...u, localEdit: true };
        return {
          name: (srv.name || pan).trim(),
          pan,
          password: (srv.password || '').trim(),
          ...(u.archived ? { archived: true } : {}),
        };
      });
      for (const [pan, srv] of fromServer) {
        if (pan && !current.some((u) => (u.pan || '').toUpperCase().trim() === pan)) {
          next.push({ name: (srv.name || pan).trim(), pan, password: (srv.password || '').trim() });
        }
      }
      const list = normalizeLoginProfilesList(next);
      list.forEach((u) => {
        if (!touched.has(u.pan)) return;
        if (u.pan && u.password) KNOWN_APPLICANT_PASSWORDS[u.pan] = u.password;
        else if (u.pan) delete KNOWN_APPLICANT_PASSWORDS[u.pan];
      });
      try {
        localStorage.setItem('dda_login_users', JSON.stringify(list));
        window.ddaElectronAPI?.saveLoginUsers?.(list)?.catch?.(() => {});
      } catch (_) {}
      set({ loginUsers: list });
      return;
    }

    const byPan = new Map(current.map((u) => [(u.pan || '').toUpperCase().trim(), u]));
    const seen = new Set();
    const next = [];
    for (const s of serverLogins) {
      const pan = (s.pan || '').toUpperCase().trim();
      if (!pan || seen.has(pan)) continue;
      seen.add(pan);
      const local = byPan.get(pan);
      if (local?.localEdit && !replaceAll) {
        next.push(local);
        continue;
      }
      next.push({
        name: (s.name || pan).trim(),
        pan,
        password: (s.password || '').trim(),
        ...(local?.archived ? { archived: true } : {}),
      });
    }
    if (!replaceAll) {
      for (const u of current) {
        const pan = (u.pan || '').toUpperCase().trim();
        if (pan && !seen.has(pan)) next.push({ ...u, localEdit: true });
      }
    }

    const list = normalizeLoginProfilesList(next);
    list.forEach((u) => {
      if (u.pan && u.password) KNOWN_APPLICANT_PASSWORDS[u.pan] = u.password;
      else if (u.pan) delete KNOWN_APPLICANT_PASSWORDS[u.pan];
    });
    try {
      localStorage.setItem('dda_login_users', JSON.stringify(list));
      window.ddaElectronAPI?.saveLoginUsers?.(list)?.catch?.(() => {});
    } catch (_) {}
    set({ loginUsers: list });
  },

  // Updates the local login-profile vault
  updateAllUserProfiles: (updatedList) => {
    if (!Array.isArray(updatedList)) return [];

    const before = new Map((get().loginUsers || []).map((u) => [u.pan, u]));
    const isAdmin = isAppAdmin();
    const diskUsers = normalizeLoginProfilesList(updatedList).map((u) => {
      const old = before.get(u.pan);
      const changed = !old || old.password !== u.password || old.name !== u.name;
      if (!changed) return u;
      if (isAdmin && old?.password !== u.password) {
        api.saveServerPassword(u.pan, u.password).then((r) => {
          if (!r.success) console.warn(`[Logins] Server did not save the password for ${u.pan}: ${r.error}`);
        });
      }
      return isAdmin ? u : { ...u, localEdit: true };
    });

    diskUsers.forEach((u) => {
      if (u.pan && u.password) {
        KNOWN_APPLICANT_PASSWORDS[u.pan] = u.password;
      }
    });

    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('dda_login_users', JSON.stringify(diskUsers));
        try {
          window.ddaElectronAPI?.saveLoginUsers?.(diskUsers);
        } catch (_) {}
      }
    } catch (_) {}

    set({
      loginUsers: diskUsers,
      isEditUsersModalOpen: false,
    });

    return diskUsers;
  },

  // Adds a profile to the local login-profile vault
  addUserProfile: ({ name, pan, password, archived }) => {
    const cleanPan = (pan || '').trim().toUpperCase();
    const cleanPass = (password || '').trim();
    const cleanName = (name || '').trim() || cleanPan;
    if (!cleanPan) return null;

    if (cleanPass) {
      KNOWN_APPLICANT_PASSWORDS[cleanPan] = cleanPass;
    }

    const currentLoginUsers = get().loginUsers || [];
    const existingIndex = currentLoginUsers.findIndex(
      (u) => (u.pan || '').toUpperCase().trim() === cleanPan
    );

    // Archived state: as given (the Add form makes a login active), else kept.
    const isArchived = archived !== undefined
      ? Boolean(archived)
      : Boolean(existingIndex >= 0 && currentLoginUsers[existingIndex]?.archived);
    // The admin's change also goes to the server; a user's stays on this
    // computer (marked local, kept until "Sync from server").
    const isAdmin = isAppAdmin();
    if (isAdmin && cleanPass) {
      api.saveServerPassword(cleanPan, cleanPass).then((r) => {
        if (!r.success) console.warn(`[Logins] Server did not save the password for ${cleanPan}: ${r.error}`);
      });
    }
    const newProfile = {
      name: cleanName,
      pan: cleanPan,
      password: cleanPass,
      ...(isArchived ? { archived: true } : {}),
      ...(isAdmin ? {} : { localEdit: true }),
    };

    const updatedLoginUsers = existingIndex >= 0
      ? currentLoginUsers.map((u, i) => (i === existingIndex ? newProfile : u))
      : [...currentLoginUsers, newProfile];

    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('dda_login_users', JSON.stringify(updatedLoginUsers));
        wsSet('dda_last_selected_login_pan', cleanPan);
        wsSet('dda_selected_login_pan', cleanPan);

        try {
          window.ddaElectronAPI?.saveLoginUsers?.(updatedLoginUsers);
        } catch (_) {}
      }
    } catch (_) {}

    set({
      loginUsers: updatedLoginUsers,
      isAddUserModalOpen: false,
    });

    return newProfile;
  },

  // Full reset (e.g. on logout)
  reset: () => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('dda_session_overrides');
        wsRemove('dda_session_overrides');
        wsRemove('dda_active_applicant_pan');
        wsRemove('dda_selected_person');
        localStorage.removeItem('ddaData');
        localStorage.removeItem('dda_extension_applicants');
        localStorage.removeItem('dda_user_applicants');
        localStorage.removeItem('window.__ACTIVE_APPLICANT__');
        wsRemove('dda_target_scheme');
        wsRemove('dda_active_scheme');
        wsRemove('dda_selected_scheme');
        wsRemove('dda_active_scheme_name');
        localStorage.removeItem('dda_schemes');
        delete window.__ACTIVE_APPLICANT__;
        try { window.ddaElectronAPI?.setActiveApplicant?.(null); } catch (_) {}
      }
    } catch (_) {}
    try {
      useAutomationStore.getState().setFlatAvailability({
        isFlatSelectPage: false,
        isGridLoaded: false,
        totalAvailable: 0,
        availableFlats: [],
        noneTargetAvailable: false,
        checkedAt: null
      });
    } catch (_) {}
    set({
      applicants: [],
      masterApplicants: [],
      userOwnedApplicants: [],
      localPrefs: {},
      localPrefsLoaded: false,
      activeApplicant: null,
      activeScheme: '',
      schemes: [],
      isLoading: false,
      isModalOpen: false,
      editingApplicant: null,
    });
  },
}));
