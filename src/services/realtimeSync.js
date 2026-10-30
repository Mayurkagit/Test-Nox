// Live sync for the DDA desktop app. The applicant list is downloaded at app
// sign-in (and on refresh); after that, the database's "applicants changed"
// note (meta/sync) says which applicants changed, and only those are
// downloaded. Schemes and the public booking config have their own
// listeners. A light 5-minute check keeps the booking key / window state
// current.
// Zero state disruption: no deselecting the active applicant, no scheme
// overrides, no page reloads.

import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config.js';
import { api } from './api.js';
import { useApplicantStore } from '../store/useApplicantStore.js';
import { useAutomationStore } from '../store/useAutomationStore.js';

/**
 * Initializes the Real-Time Sync Engine for the active user.
 * @param {Object} user Authenticated Firebase user object
 * @returns {Function} Cleanup function to unsubscribe listeners
 */
export function initRealtimeSync(user) {
  if (!user) return () => {};

  let isClosed = false;
  let firestoreDebounceTimer = null;
  let schemesDebounceTimer = null;
  let runtimeDebounceTimer = null;
  let unsubFirestore = null;
  let unsubSchemes = null;
  let unsubRuntime = null;
  let configPollInterval = null;

  // ─── 1. CHANGED APPLICANTS (meta/sync onSnapshot) ──────────────────────
  try {
    // The "applicants changed" note, not the applicants themselves: the
    // database only lets each user read their own, and applicants come
    // through the Worker anyway. changed.{PAN} = { at, owner } is updated for
    // every applicant saved, deleted or restored.
    const syncDocRef = doc(db, 'meta', 'sync');
    const isAdmin = Boolean(
      user?.role === 'admin' ||
      user?.isAdmin === true ||
      localStorage.getItem('dda_is_admin') === 'true' ||
      localStorage.getItem('dda_user_role') === 'admin'
    );
    const myUid = String(user?.uid || '');
    const stampOf = (v) => (v && typeof v === 'object' ? String(v.at ?? '') : String(v ?? ''));
    const ownerOf = (v) => (v && typeof v === 'object' ? String(v.owner || '') : '');
    const inMyList = (pan) => (useApplicantStore.getState().masterApplicants || [])
      .some((a) => String(a?.pan || a?.personal?.pan || '').toUpperCase().trim() === pan);
    // A normal user's window only cares about its own applicants (and one
    // that leaves its list); the admin's about all of them.
    const concernsMe = (pan, value) => {
      if (isAdmin) return true;
      const owner = ownerOf(value);
      return !owner || owner === myUid || inMyList(pan);
    };

    // The note's entries this computer's list is up to date with, kept per app
    // user across restarts: at start the note is compared with them, so
    // applicants added or edited while the app was closed are downloaded too.
    // Without a saved copy (first start), the note as it is now counts as seen.
    const SEEN_KEY = `dda_sync_seen_${myUid || 'user'}`;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); } catch (_) {}
    let seen = null;
    let lastUpdatedSeen = null;
    // Stamps that count as seen once their download has worked
    const staged = new Map();
    const pending = new Set();
    let fullReload = false;
    let stagedLastUpdated = null;

    const saveSeen = () => {
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify({
          changed: Object.fromEntries(seen || []),
          lastUpdated: lastUpdatedSeen,
        }));
      } catch (_) {}
    };

    const flush = async () => {
      firestoreDebounceTimer = null;
      if (isClosed) return;
      // At start the list saved on this computer loads first; a catch-up
      // applied before it would be overwritten by it
      for (let i = 0; i < 50 && useApplicantStore.getState().isLoading; i++) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (isClosed) return;
      const pans = [...pending];
      const full = fullReload;
      const done = new Map(staged);
      const doneLastUpdated = stagedLastUpdated;
      pending.clear();
      staged.clear();
      fullReload = false;
      let ok = false;
      try {
        // Many at once (an import, a user's applicants archived): one full download
        if (full || pans.length > 25) {
          const res = await useApplicantStore.getState().loadApplicants(user, { fromServer: true });
          ok = Boolean(res?.fromCloud);
          console.log(`📡 [Realtime Sync] ${ok ? 'Applicant list downloaded again.' : 'Could not download the applicant list.'}`);
        } else if (pans.length) {
          ok = await useApplicantStore.getState().patchApplicantsFromServer(user, pans);
          console.log(`📡 [Realtime Sync] ${ok ? 'Updated' : 'Could not update'} ${pans.length} changed applicant(s): ${pans.join(', ')}`);
        } else {
          ok = true;
        }
      } catch (err) {
        console.warn('[Realtime Sync] Error updating changed applicants:', err);
      }
      if (ok && !isClosed) {
        for (const [pan, stamp] of done) seen.set(pan, stamp);
        if (doneLastUpdated != null) lastUpdatedSeen = doneLastUpdated;
        saveSeen();
      }
      // A failed download stays unseen: the next note, or the next start, tries again
    };

    unsubFirestore = onSnapshot(
      syncDocRef,
      (snapshot) => {
        if (isClosed) return;
        const data = snapshot.exists() ? snapshot.data() || {} : {};
        const changed = data.changed && typeof data.changed === 'object' ? data.changed : {};
        if (seen === null) {
          if (saved && saved.changed && typeof saved.changed === 'object') {
            seen = new Map(Object.entries(saved.changed).map(([pan, v]) => [pan, String(v)]));
            lastUpdatedSeen = saved.lastUpdated ?? null;
          } else {
            seen = new Map(Object.entries(changed).map(([pan, v]) => [pan, stampOf(v)]));
            lastUpdatedSeen = data.lastUpdated ?? null;
            saveSeen();
            return;
          }
        }
        let found = false;
        for (const [rawPan, value] of Object.entries(changed)) {
          const stamp = stampOf(value);
          if (seen.get(rawPan) === stamp || staged.get(rawPan) === stamp) continue;
          staged.set(rawPan, stamp);
          found = true;
          const pan = rawPan.toUpperCase().trim();
          if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) && concernsMe(pan, value)) pending.add(pan);
        }
        // Changed without saying which (a writer that does not list PANs):
        // the whole list once
        if (!found && data.lastUpdated != null && data.lastUpdated !== lastUpdatedSeen) fullReload = true;
        if (data.lastUpdated != null && data.lastUpdated !== lastUpdatedSeen) stagedLastUpdated = data.lastUpdated;

        // Only other people's applicants changed: nothing to download, but
        // they count as seen
        if (found && !pending.size && !fullReload && !firestoreDebounceTimer) {
          for (const [pan, stamp] of staged) seen.set(pan, stamp);
          staged.clear();
          if (stagedLastUpdated != null) lastUpdatedSeen = stagedLastUpdated;
          saveSeen();
          return;
        }
        if (!pending.size && !fullReload && !staged.size) return;
        // Several saves close together go in one request
        if (firestoreDebounceTimer) clearTimeout(firestoreDebounceTimer);
        firestoreDebounceTimer = setTimeout(flush, 1500);
      },
      (error) => {
        console.warn('📡 [Realtime Sync] Firestore onSnapshot warning (offline/fallback mode active):', error?.message || error);
      }
    );
  } catch (err) {
    console.warn('📡 [Realtime Sync] Firestore listener initialization warning:', err);
  }

  // ─── 2. FIRESTORE REAL-TIME SCHEMES LISTENER (onSnapshot) ───────────────
  try {
    const schemesColRef = collection(db, 'schemes');
    unsubSchemes = onSnapshot(
      schemesColRef,
      (snapshot) => {
        if (isClosed) return;
        if (schemesDebounceTimer) clearTimeout(schemesDebounceTimer);
        schemesDebounceTimer = setTimeout(() => {
          if (isClosed) return;
          const schemeList = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const val = data?.value || data?.name || docSnap.id;
            if (val && typeof val === 'string') {
              const clean = val.trim();
              if (clean && !clean.toLowerCase().includes('admin_bypass') && clean.toLowerCase() !== 'admin') {
                schemeList.push(clean);
              }
            }
          });
          if (schemeList.length > 0) {
            const uniqueSchemes = Array.from(new Set(schemeList)).sort((a, b) => a.localeCompare(b));
            useApplicantStore.getState().setSchemes(uniqueSchemes);
            console.log(`📡 [Realtime Sync] In-place synced ${uniqueSchemes.length} schemes via Firestore snapshot.`);
          }
        }, 500);
      },
      (error) => {
        console.warn('📡 [Realtime Sync] Schemes onSnapshot warning:', error?.message || error);
      }
    );
  } catch (err) {
    console.warn('📡 [Realtime Sync] Schemes listener initialization warning:', err);
  }

  // ─── 3. FIRESTORE REAL-TIME RUNTIMECONFIG LISTENER (onSnapshot) ──────────
  try {
    // The public part of the booking config (scheme, mode, window); the
    // booking key and allowed users stay admin-only in runtimeConfig/current.
    const runtimeDocRef = doc(db, 'runtimeConfig', 'public');
    unsubRuntime = onSnapshot(
      runtimeDocRef,
      (docSnap) => {
        if (isClosed || !docSnap.exists()) return;
        // Auto TIMED (admin's runtime config): when to start TIMED and apply.
        // Taken at once, not after the debounce below: it is one small field.
        try { useAutomationStore.getState().setAutoTimedConfig(docSnap.data()?.autoTimed || null); } catch (_) {}
        if (runtimeDebounceTimer) clearTimeout(runtimeDebounceTimer);
        runtimeDebounceTimer = setTimeout(() => {
          if (isClosed) return;
          const data = docSnap.data() || {};

          // Sync any schemes listed in runtime config
          if (data.schemes) {
            let list = [];
            if (Array.isArray(data.schemes)) list = data.schemes;
            else if (typeof data.schemes === 'object') list = Object.values(data.schemes);
            const clean = list.map(s => String(s).trim()).filter(s => s && !s.toLowerCase().includes('admin_bypass') && s.toLowerCase() !== 'admin');
            if (clean.length > 0) {
              const current = useApplicantStore.getState().schemes || [];
              const merged = Array.from(new Set([...current, ...clean])).sort((a, b) => a.localeCompare(b));
              useApplicantStore.getState().setSchemes(merged);
            }
          }

          // Sync targetScheme
          const targetScheme = (data.activeScheme || data.targetScheme || '').trim();
          if (targetScheme && !targetScheme.toLowerCase().includes('admin_bypass') && targetScheme.toLowerCase() !== 'admin') {
            const isAdmin = Boolean(
              user?.role === 'admin' ||
              user?.isAdmin === true ||
              user?.admin === true ||
              (typeof window !== 'undefined' && (
                localStorage.getItem('dda_is_admin') === 'true' ||
                localStorage.getItem('dda_user_role') === 'admin'
              ))
            );
            if (!isAdmin) {
              useApplicantStore.getState().setActiveScheme(targetScheme);
              try {
                localStorage.setItem('dda_target_scheme', targetScheme);
                localStorage.setItem('dda_selected_scheme', targetScheme);
                localStorage.setItem('dda_active_scheme_name', targetScheme);
              } catch (_) {}
            } else {
              const currentChosen = localStorage.getItem('dda_selected_scheme') || useApplicantStore.getState().activeScheme;
              if (!currentChosen) {
                useApplicantStore.getState().setActiveScheme(targetScheme);
              }
            }
          }

          if (data.mode) {
            try {
              localStorage.setItem('dda_mode', data.mode);
            } catch (_) {}
          }
        }, 500);
      },
      (error) => {
        console.warn('📡 [Realtime Sync] RuntimeConfig onSnapshot warning:', error?.message || error);
      }
    );
  } catch (err) {
    console.warn('📡 [Realtime Sync] Runtime listener initialization warning:', err);
  }

  // ─── 4. BOOKING KEY / WINDOW CHECK (every 5 minutes) ─────────────────────
  // Applicants are not reloaded here (meta/sync above does that on change).
  configPollInterval = setInterval(async () => {
    if (isClosed) return;
    try {
      const bookingKey = localStorage.getItem('dda_booking_key') || '';
      await api.syncRealtimeConfig(bookingKey, user);
    } catch (err) {
      console.warn('[Realtime Sync] Booking config check error:', err);
    }
  }, 5 * 60 * 1000);

  // ─── CLEANUP FUNCTION ───────────────────────────────────────────────────
  return () => {
    isClosed = true;
    if (firestoreDebounceTimer) clearTimeout(firestoreDebounceTimer);
    if (schemesDebounceTimer) clearTimeout(schemesDebounceTimer);
    if (runtimeDebounceTimer) clearTimeout(runtimeDebounceTimer);
    if (configPollInterval) clearInterval(configPollInterval);
    if (unsubFirestore) {
      try { unsubFirestore(); } catch (_) {}
      unsubFirestore = null;
    }
    if (unsubSchemes) {
      try { unsubSchemes(); } catch (_) {}
      unsubSchemes = null;
    }
    if (unsubRuntime) {
      try { unsubRuntime(); } catch (_) {}
      unsubRuntime = null;
    }
  };
}
