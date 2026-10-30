// Auto TIMED for one window (see utils/autoTimed.js). Every second it asks
// decideAutoTimed what to do; when the answer is "arm" it does what the
// operator would: sets the target time and starts the TIMED countdown, which
// the schemes sidebar then runs as usual (wake at T-2s, poll for Apply).

import { useEffect, useRef } from 'react';
import { useAutomationStore } from '../store/useAutomationStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { detectDdaStage } from '../utils/ddaRoutes';
import { wsGet, wsSet } from '../utils/storageHelper';
import { parseSchedule, decideAutoTimed, localTargetTime } from '../utils/autoTimed';
import { syncServerClock, getServerOffsetMs, serverNow, timedTrace } from '../utils/serverClock';

const STOPPED_KEY = 'dda_auto_timed_stopped';

// STOP was pressed in this window: Auto TIMED leaves this schedule alone
export function markAutoTimedStopped() {
  const sched = parseSchedule(useAutomationStore.getState().autoTimedConfig);
  if (sched) {
    try { wsSet(STOPPED_KEY, sched.key); } catch (_) {}
  }
}

export function useAutoTimed({ hasApplicant }) {
  const armedKeyRef = useRef('');
  const applicantRef = useRef(hasApplicant);
  applicantRef.current = hasApplicant;

  // The PC's offset from the Worker's clock: now, then every minute
  useEffect(() => {
    syncServerClock();
    const id = setInterval(() => syncServerClock(), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const tick = () => {
      const st = useAutomationStore.getState();
      const schedule = parseSchedule(st.autoTimedConfig);
      const offset = getServerOffsetMs();
      const ctx = {
        windowOff: st.autoTimedWindowOff,
        stoppedKey: wsGet(STOPPED_KEY) || '',
        armedKey: armedKeyRef.current,
        onScheme: detectDdaStage(st.currentUrl).id === 'SCHEME',
        hasLogin: Boolean(st.ddaAccountPan),
        hasApplicant: Boolean(applicantRef.current),
        autofill: useSettingsStore.getState().settings?.automationEnabled !== false,
        timedActive: st.isTimedActive,
        searching: st.isSearching,
      };
      const verdict = decideAutoTimed({ nowMs: serverNow(), schedule, ctx });

      if (verdict.action === 'arm') {
        // TIMED counts in server time too, so its target is the admin's drop time as set
        const target = localTargetTime(schedule.dropMs, 0);
        armedKeyRef.current = schedule.key;
        st.setTargetTime(target);
        st.setTimedActive(true);
        timedTrace(`Auto TIMED armed: start ${new Date(schedule.startMs).toLocaleTimeString('en-GB')} apply ${new Date(schedule.dropMs).toLocaleTimeString('en-GB')} (admin, server time); TIMED target ${target}`);
        st.addLog(
          'ACTION',
          'Auto TIMED',
          `⏱️ Auto TIMED started: applying at ${new Date(schedule.dropMs).toLocaleTimeString('en-IN')} (${offset == null ? 'this PC\'s clock' : 'server time'}); TIMED target set to ${target}`,
          '',
        );
      }

      // What the sidebar chip shows; only written when it changes
      const next = schedule
        ? { state: verdict.action === 'arm' ? 'armed' : verdict.state, startMs: schedule.startMs, dropMs: schedule.dropMs, pcClock: offset == null }
        : null;
      const prev = st.autoTimedStatus;
      if (JSON.stringify(prev) !== JSON.stringify(next)) st.setAutoTimedStatus(next);
    };
    tick();
    const id = setInterval(tick, 1000);
    // A new time from the admin is acted on at once, not at the next second
    const keyOf = (cfg) => (cfg ? `${cfg.startAt}|${cfg.dropAt}` : '');
    const unsub = useAutomationStore.subscribe((s, prev) => {
      if (keyOf(s.autoTimedConfig) !== keyOf(prev.autoTimedConfig)) tick();
    });
    return () => { clearInterval(id); unsub(); };
  }, []);
}
