// Booking window expiry for normal users.
// The main process owns the timer (logout clears DDA cookies for every window),
// so each dashboard window only: hands it the window end, reports whether it is
// mid-booking, and logs itself out when main broadcasts the expiry.

import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { detectDdaStage } from '../utils/ddaRoutes';

export const BOOKING_WINDOW_EXPIRED_MSG =
  'Your booking window has ended. You have been logged out.';

// After a flat is picked on step2, the reservation POST + captcha + redirect to
// the hold page normally completes well inside this.
const RESERVATION_GRACE_MS = 90 * 1000;
const BUSY_REPORT_MS = 5000;

export function applyBookingWindowEnd(iso) {
  if (!iso) return;
  try { localStorage.setItem('dda_window_end', iso); } catch (_) {}
  try { window.ddaElectronAPI?.setBookingWindowEnd?.(iso); } catch (_) {}
}

export function markBookingWindowExpired() {
  applyBookingWindowEnd(new Date().toISOString());
}

// Payment gateway / bank OTP pages live off the DDA host.
function isOffPortal(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return !u.hostname.endsWith('dda.org.in');
  } catch (_) {
    return false;
  }
}

// What this window is doing mid-booking ('' when it isn't), for the sign-out warning
function midBookingWhat(url, lastFlatSelectedAt) {
  const stage = detectDdaStage(url || '').id;
  if (stage === 'PAYMENT_HOLD') return 'on the 15-minute hold page';
  if (isOffPortal(url || '')) return 'on the payment / bank page';
  if (stage === 'FLAT_SELECT' && Date.now() - lastFlatSelectedAt < RESERVATION_GRACE_MS) return 'reserving a flat';
  return '';
}

const reportBusy = (url, lastFlatSelectedAt) => {
  const what = midBookingWhat(url, lastFlatSelectedAt);
  try { window.ddaElectronAPI?.reportBookingBusy?.(Boolean(what), what); } catch (_) {}
};

// The app has one user for all windows: signing out in one window signs them
// all out. Asks first when any window is mid-booking; false when cancelled.
export async function signOutAllWindows() {
  const st = useAuthStore.getState();
  let busy = [];
  try { busy = (await window.ddaElectronAPI?.getBusyWindows?.()) || []; } catch (_) {}
  if (busy.length) {
    const lines = busy.map((b) => `• Window ${b.window || '?'}${b.self ? ' (this one)' : ''}: ${b.what || 'mid-booking'}`);
    const ok = window.confirm(
      `A booking is in progress:\n${lines.join('\n')}\n\nSigning out signs out every window and ends its DDA login, which can lose that booking.\n\nSign out anyway?`,
    );
    if (!ok) return false;
  }
  // The other windows first, so their searches stop before the DDA logins go
  try { window.ddaElectronAPI?.signedOutAll?.(); } catch (_) {}
  await st.logout();
  return true;
}

export function useBookingWindowExpiry({ user, isAdmin, currentUrl }) {
  const urlRef = useRef(currentUrl);
  urlRef.current = currentUrl;
  const lastFlatSelectedAtRef = useRef(0);
  const enabled = Boolean(user) && !isAdmin;
  // Busy reports are for every signed-in user (admins too): the sign-out warning uses them
  const reporting = Boolean(user);

  // Hand the stored window end to main (covers app restart with a saved key).
  useEffect(() => {
    if (!enabled) return;
    let end = null;
    try { end = localStorage.getItem('dda_window_end'); } catch (_) {}
    if (end) {
      try { window.ddaElectronAPI?.setBookingWindowEnd?.(end); } catch (_) {}
    }
  }, [enabled]);

  // Report whether this window is mid-booking, so main defers the logout
  // and a sign-out in any window warns about it.
  useEffect(() => {
    const api = window.ddaElectronAPI;
    if (!reporting || !api?.reportBookingBusy) return;

    const report = () => reportBusy(urlRef.current, lastFlatSelectedAtRef.current);
    const onFlatSelected = () => {
      lastFlatSelectedAtRef.current = Date.now();
      report();
    };

    report();
    window.addEventListener('dda-step2-flat-selected', onFlatSelected);
    const interval = setInterval(report, BUSY_REPORT_MS);
    return () => {
      window.removeEventListener('dda-step2-flat-selected', onFlatSelected);
      clearInterval(interval);
      try { api.reportBookingBusy(false, ''); } catch (_) {}
    };
  }, [reporting]);

  // Report immediately on navigation rather than waiting for the next tick.
  useEffect(() => {
    if (!reporting) return;
    reportBusy(currentUrl, lastFlatSelectedAtRef.current);
  }, [reporting, currentUrl]);

  // Main says the window has ended and nothing is mid-booking: log out.
  useEffect(() => {
    if (!enabled) return;
    const unsub = window.ddaElectronAPI?.onBookingWindowExpired?.(() => {
      const st = useAuthStore.getState();
      if (!st.user) return;
      st.logout(BOOKING_WINDOW_EXPIRED_MSG);
    });
    return () => unsub?.();
  }, [enabled]);
}
