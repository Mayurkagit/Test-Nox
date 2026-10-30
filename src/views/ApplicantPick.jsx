import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Unlock, ArrowRight, Loader2, UserRound, KeyRound, RefreshCw, AlertTriangle, Search, X } from 'lucide-react';
import { useAuthStore, useApplicantStore, activeLoginUsers } from '../store';
import { getLockedLoginPan, setLockedLoginPan } from '../utils/loginLock';
import { getWinSession, wsGet, wsSet } from '../utils/storageHelper';
import AddUserModal from '../components/AddUserModal';

const LOCK_KEY = 'dda_locked_login_pan';
const cleanPan = (p) => (p || '').toUpperCase().trim();

// Choose which applicant this window logs in as. Shown after every app
// sign-in and when a window is opened with "+". The choice is locked for the
// window (the padlock on the login page), so a DDA logout, an app sign-out or
// a restart can't switch it; only Unlock, or locking someone else, changes it.
// An applicant locked in another open window can't be picked here: two
// windows on one DDA login log each other out.
export default function ApplicantPick({ onDone }) {
  const user = useAuthStore((s) => s.user);
  const loginUsers = useApplicantStore((s) => s.loginUsers);
  const loadLoginUsers = useApplicantStore((s) => s.loadLoginUsers);
  const loadApplicants = useApplicantStore((s) => s.loadApplicants);
  const openAddUserModal = useApplicantStore((s) => s.openAddUserModal);
  // idle | syncing | done | offline: the sign-in download, or the Sync button
  const syncState = useApplicantStore((s) => s.serverSync);

  const winSession = getWinSession();
  const [loading, setLoading] = useState(true);
  const [openSessions, setOpenSessions] = useState([]);
  const [storageTick, setStorageTick] = useState(0);
  const [myLock, setMyLock] = useState(() => getLockedLoginPan());
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const defaultChosenRef = useRef(false);

  // This computer's logins. Nothing is downloaded here: the list came from
  // the server at app sign-in, and the Sync button downloads it again.
  useEffect(() => {
    let alive = true;
    (async () => {
      try { await loadLoginUsers?.(); } catch (_) {}
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [loadLoginUsers]);

  // Which windows are open, and their locks (another window's lock change
  // arrives as a storage event; window open/close is polled)
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      window.ddaElectronAPI?.listOpenWindowSessions?.()
        .then((list) => { if (alive && Array.isArray(list)) setOpenSessions(list); })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    const onStorage = (e) => {
      if (!e.key || e.key.endsWith(LOCK_KEY)) setStorageTick((t) => t + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const myIndex = openSessions.find((s) => s.sessionId === winSession)?.displayIndex;

  // PAN -> window number, for applicants locked in another open window
  const inUseByPan = useMemo(() => {
    const map = new Map();
    for (const s of openSessions) {
      if (!s?.sessionId || s.sessionId === winSession) continue;
      let pan = '';
      try { pan = cleanPan(localStorage.getItem(`${s.sessionId}::${LOCK_KEY}`)); } catch (_) {}
      if (pan && !map.has(pan)) map.set(pan, s.displayIndex);
    }
    return map;
    // storageTick: re-read when another window locks or unlocks
  }, [openSessions, winSession, storageTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const allLogins = Array.isArray(loginUsers) ? loginUsers : [];
  const lockedEntry = myLock ? allLogins.find((u) => cleanPan(u.pan) === myLock) : null;
  const list = useMemo(() => {
    const active = activeLoginUsers(allLogins);
    // An archived applicant still shows here when it is this window's lock
    if (lockedEntry && !active.some((u) => cleanPan(u.pan) === myLock)) return [lockedEntry, ...active];
    return active;
  }, [allLogins, lockedEntry, myLock]);

  const isAvailable = (pan) => !!pan && list.some((u) => cleanPan(u.pan) === pan) && !inUseByPan.has(pan);
  const lockMissing = !!myLock && !loading && syncState !== 'syncing' && !lockedEntry;
  const missingPasswordCount = list.filter((u) => !u.password).length;
  const hasLocalEdits = allLogins.some((u) => u.localEdit);

  // Default choice, once the list is known: this window's lock, else the last
  // one picked in this window, else nothing (never the first in the list)
  useEffect(() => {
    if (defaultChosenRef.current || loading || list.length === 0) return;
    defaultChosenRef.current = true;
    const last = cleanPan(sessionStorage.getItem('dda_last_selected_login_pan') || wsGet('dda_last_selected_login_pan'));
    if (isAvailable(myLock)) setSelected(myLock);
    else if (isAvailable(last)) setSelected(last);
  }, [loading, list]); // eslint-disable-line react-hooks/exhaustive-deps

  // Someone else locked the selected applicant meanwhile: clear the choice
  useEffect(() => {
    if (selected && inUseByPan.has(selected)) setSelected('');
  }, [inUseByPan, selected]);

  const finish = () => {
    try { sessionStorage.setItem('dda_pick_done', '1'); } catch (_) {}
    onDone?.();
  };

  const lockAndContinue = () => {
    if (!isAvailable(selected)) return;
    setLockedLoginPan(selected);
    try {
      sessionStorage.setItem('dda_last_selected_login_pan', selected);
      wsSet('dda_last_selected_login_pan', selected);
    } catch (_) {}
    finish();
  };

  // Skip keeps a lock that still points to an applicant; a lock to a removed
  // applicant is cleared so the window starts with nobody chosen.
  const skip = () => {
    if (myLock && !lockedEntry) setLockedLoginPan('');
    finish();
  };

  const unlock = () => {
    setLockedLoginPan('');
    setMyLock('');
    setSelected('');
  };

  // Applicants and logins from the server, in one download; the logins
  // replace this computer's (local edits too)
  const reloadFromServer = async () => {
    if (syncState === 'syncing' || !user) return;
    if (hasLocalEdits && !window.confirm('Replace this computer\'s logins with the ones saved on the server? Local edits will be lost.')) return;
    await loadApplicants?.(user, { fromServer: true, replaceLogins: true }).catch(() => null);
  };

  const selectedEntry = list.find((u) => cleanPan(u.pan) === selected);

  // Search by name or PAN; it only narrows what is shown, the choice stays
  // A to Z by name (PAN when there is no name), like the sidebar's list.
  const q = query.trim().toUpperCase();
  const sortName = (u) => String(u.name || u.pan || '').trim().toUpperCase();
  const shown = (q
    ? list.filter((u) => cleanPan(u.pan).includes(q) || String(u.name || '').toUpperCase().includes(q))
    : [...list]
  ).sort((a, b) => sortName(a).localeCompare(sortName(b), 'en', { numeric: true }));

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-screen p-6 bg-[#f8fafc] text-slate-900 font-sans">
      <div className="w-full max-w-lg p-7 bg-white border border-slate-200/90 rounded-3xl shadow-[0_20px_60px_-15px_rgba(15,23,42,0.1)] space-y-4 relative overflow-hidden animate-fade-in">
        <div style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }} className="h-1.5 w-full absolute top-0 left-0" />

        <div className="text-center pt-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 h-6 rounded-full bg-purple-50 border border-purple-200 text-[11px] font-black text-[#4b2c83] uppercase tracking-wider">
            Window {myIndex || winSession.replace('session_', '')}
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight mt-2">Choose applicant</h2>
          <p className="text-xs text-slate-500 mt-1">
            This window logs in as the applicant you lock here, and stays on them until you unlock.
          </p>
        </div>

        {lockMissing && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span>The locked applicant ({myLock}) is no longer in your saved logins. Pick someone else, or skip.</span>
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
          <span>
            {list.length} applicant{list.length === 1 ? '' : 's'}
            {missingPasswordCount > 0 && <span className="text-amber-700"> · {missingPasswordCount} without a password</span>}
          </span>
          <button
            type="button"
            onClick={reloadFromServer}
            disabled={syncState === 'syncing'}
            className="inline-flex items-center gap-1 text-[#4b2c83] hover:underline disabled:opacity-50 cursor-pointer"
            title="Download the applicants and their logins from the server (replaces this computer's logins)"
          >
            <RefreshCw className={`w-3 h-3 ${syncState === 'syncing' ? 'animate-spin' : ''}`} />
            {syncState === 'syncing' ? 'Syncing…' : 'Sync from server'}
          </button>
        </div>
        {syncState === 'offline' && (
          <div className="text-[11px] font-semibold text-red-600 -mt-2">Could not reach the server: showing the logins saved on this computer.</div>
        )}

        {loading ? (
          <div className="flex justify-center py-8 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : list.length === 0 ? (
          <p className="text-xs text-center text-slate-500 py-6">
            {syncState === 'syncing' ? 'Loading applicants…' : 'No applicants on this computer yet. Add them in the web app, then press Sync from server.'}
          </p>
        ) : (
          <>
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or PAN"
              autoFocus
              className="w-full h-10 pl-9 pr-8 bg-white border border-slate-200 focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 text-sm rounded-xl outline-none placeholder:text-slate-400"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                title="Clear search"
                className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {shown.length === 0 && (
            <p className="text-xs text-center text-slate-500 py-4">No applicant matches "{query.trim()}".</p>
          )}
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {shown.map((u) => {
              const pan = cleanPan(u.pan);
              const usedIn = inUseByPan.get(pan);
              const on = pan === selected;
              const isMine = pan === myLock;
              return (
                <div
                  key={pan}
                  role="button"
                  tabIndex={usedIn ? -1 : 0}
                  aria-disabled={!!usedIn}
                  onClick={() => !usedIn && setSelected(pan)}
                  onKeyDown={(e) => { if (!usedIn && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelected(pan); } }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                    usedIn
                      ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                      : on
                        ? 'bg-purple-50 border-[#4b2c83] cursor-pointer'
                        : 'bg-white border-slate-200 hover:border-[#4b2c83]/50 cursor-pointer'
                  }`}
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${on ? 'bg-[#4b2c83] text-white' : 'bg-slate-100 text-slate-500'}`}>
                    <UserRound className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-800 truncate">{u.name || pan}</span>
                    <span className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className="text-[11px] font-mono text-slate-500">{pan}</span>
                      {usedIn && (
                        <span className="text-[10px] font-bold px-1.5 rounded-full bg-slate-200 text-slate-700">In use in Window {usedIn}</span>
                      )}
                      {!u.password && (
                        <span className="text-[10px] font-bold px-1.5 rounded-full bg-amber-100 text-amber-800">No password</span>
                      )}
                      {u.localEdit && (
                        <span className="text-[10px] font-bold px-1.5 rounded-full bg-slate-100 text-slate-600" title="Changed on this computer; Sync from server replaces it">Local edit</span>
                      )}
                      {u.archived && (
                        <span className="text-[10px] font-bold px-1.5 rounded-full bg-slate-100 text-slate-500">Archived</span>
                      )}
                    </span>
                  </span>
                  {!u.password && !usedIn && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openAddUserModal({ name: u.name, pan }); }}
                      className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 cursor-pointer"
                    >
                      <KeyRound className="w-3 h-3" /> Add password
                    </button>
                  )}
                  {isMine && !usedIn && <Lock className="w-4 h-4 text-[#4b2c83] shrink-0" title="Locked in this window" />}
                </div>
              );
            })}
          </div>
          </>
        )}

        {selectedEntry && !selectedEntry.password && (
          <div className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No saved password for {selectedEntry.name || selected}: you'll type it on DDA's login page, or add it now.
          </div>
        )}

        <button
          type="button"
          disabled={!isAvailable(selected)}
          onClick={lockAndContinue}
          style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }}
          className="w-full h-11 flex items-center justify-center gap-2 text-sm font-extrabold text-white rounded-xl shadow-lg shadow-[#4b2c83]/30 disabled:opacity-40 cursor-pointer active:scale-[0.98] transition-all"
        >
          <Lock className="w-4 h-4" /> Lock and continue <ArrowRight className="w-4 h-4" />
        </button>
        <div className="flex items-center justify-center gap-4">
          {myLock && (
            <button type="button" onClick={unlock} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-600 cursor-pointer">
              <Unlock className="w-3.5 h-3.5" /> Unlock {myLock}
            </button>
          )}
          <button type="button" onClick={skip} className="text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer">
            {myLock && lockedEntry ? 'Skip, keep the lock' : 'Skip, choose later'}
          </button>
        </div>
      </div>

      <AddUserModal />
    </div>
  );
}
