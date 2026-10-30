import React, { useState, useRef, useEffect } from 'react';
import SidebarAutoTimed from './SidebarAutoTimed';
import { 
  Clock, 
  X, 
  RefreshCw, 
  ChevronUp, 
  ChevronDown, 
  Square, 
  Play, 
  CircleSlash, 
  LayoutGrid, 
  RotateCw,
  PlayCircle,
  Compass,
  Settings,
  Search,
  Zap,
  Loader2,
  FileCheck
} from 'lucide-react';
import { useAutomationStore } from '../../store/useAutomationStore';
import { serverNow, timedTrace } from '../../utils/serverClock';
import { useApplicantStore } from '../../store/useApplicantStore';

export default function SidebarControls({
  activeApplicant: propActiveApplicant,
  activeStage,
  isTwoButtonStage,
  isTimedActive,
  targetTime,
  setTargetTime,
  remainingSec,
  setRemainingSec,
  onTimedAction,
  onStop,
  onManual,
  onDirect,
  onAutofillForm,
  onTestApplicationForm,
  onProceedPayment,
  onNavigateTo,
  onReload,
  onMultiReload,
  storeSetTimedActive,
  isCompact,
  isStickyDeck = false,
  isAutofill = true
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const popoverRef = useRef(null);
  const hourInputRef = useRef(null);
  const minuteInputRef = useRef(null);
  const secondInputRef = useRef(null);
  const timerRef = useRef(null);
  const searchTimerRef = useRef(null);

  const isSearching = useAutomationStore((s) => s.isSearching);
  const setIsSearching = useAutomationStore((s) => s.setIsSearching);
  const isMultiReloading = useAutomationStore((s) => s.isMultiReloading);
  const multiReloadAttempt = useAutomationStore((s) => s.multiReloadAttempt);
  const huntSeconds = useAutomationStore((s) => s.huntSeconds);
  const setHuntSeconds = useAutomationStore((s) => s.setHuntSeconds);
  const searchRemainingSec = useAutomationStore((s) => s.searchRemainingSec);
  const setSearchRemainingSec = useAutomationStore((s) => s.setSearchRemainingSec);
  const setIsConsoleMinimized = useAutomationStore((s) => s.setIsConsoleMinimized);
  const addLog = useAutomationStore((s) => s.addLog);

  const storeActiveApplicant = useApplicantStore((s) => s.activeApplicant);
  const activeApplicant = propActiveApplicant !== undefined ? propActiveApplicant : storeActiveApplicant;
  const activePan = (activeApplicant?.pan || activeApplicant?.personal?.pan || '').toUpperCase();
  const applicantPrefs = activeApplicant?.preferences || activeApplicant?.location || {};
  const rawTargetFlats = applicantPrefs.flatNo || applicantPrefs.flats || activeApplicant?.flatNo || activeApplicant?.flats || [];
  const targetFlatsList = Array.isArray(rawTargetFlats)
    ? rawTargetFlats.map(f => String(f).trim()).filter(Boolean)
    : (typeof rawTargetFlats === 'string'
        ? rawTargetFlats.split(',').map(f => f.trim()).filter(Boolean)
        : (rawTargetFlats ? [String(rawTargetFlats)].filter(Boolean) : []));
  const hasTargetFlats = targetFlatsList.length > 0;

  // Close popover on outside click, webview click, or window blur
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsPopoverOpen(false);
      }
    };
    const handleCloseAll = () => setIsPopoverOpen(false);

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('blur', handleCloseAll);
    window.addEventListener('dda-close-popovers', handleCloseAll);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('blur', handleCloseAll);
      window.removeEventListener('dda-close-popovers', handleCloseAll);
    };
  }, []);

  // Countdown timer logic
  useEffect(() => {
    if (!isTimedActive) {
      setRemainingSec?.(null);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    // TIMED counts in server time (the Worker's clock), like Auto TIMED, so a
    // PC clock that is a few seconds off neither shifts the time shown nor the start
    const checkCountdown = () => {
      const now = new Date(serverNow());
      const [h, m, s] = (targetTime || '00:00:00').split(':').map(Number);
      const target = new Date(now.getTime());
      target.setHours(h, m, s, 0);

      if (target.getTime() <= now.getTime() - 1000) {
        target.setDate(target.getDate() + 1);
      }

      const diffMs = target.getTime() - now.getTime();

      // Trigger at T-2s so a slightly slow PC clock cannot delay the start of continuous pre-search
      if (diffMs <= 2000) {
        if (timerRef.current) clearInterval(timerRef.current);
        setRemainingSec?.(0);
        storeSetTimedActive?.(false);
        console.log('[Timed Search] ⚡ T-2s Early Wakeup reached! Initiating continuous scheme search...');
        timedTrace(`T-2s wake for target ${targetTime} (${diffMs}ms before it, server time)`);
        addLog?.('ACTION', 'Timed Search', '⚡ T-2s Early Wakeup reached! Initiating continuous scheme search...', activeApplicant?.pan);
        onTimedAction?.();
      } else {
        setRemainingSec?.(Math.ceil(diffMs / 1000));
      }
    };

    checkCountdown();
    timerRef.current = setInterval(checkCountdown, 250);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimedActive, targetTime, onTimedAction, setRemainingSec, storeSetTimedActive]);

  // Search countdown timer logic for live button indicator (strictly on FLAT_SELECT stage)
  useEffect(() => {
    if (!isSearching || activeStage?.id !== 'FLAT_SELECT') {
      setSearchRemainingSec(null);
      if (searchTimerRef.current) clearInterval(searchTimerRef.current);
      return;
    }

    // Continuous Search Mode: no countdown timer
    if (huntSeconds === 0) {
      setSearchRemainingSec(null);
      if (searchTimerRef.current) clearInterval(searchTimerRef.current);
      return;
    }

    const duration = huntSeconds || 30;
    const expiresAt = Date.now() + duration * 1000;
    setSearchRemainingSec(duration);

    searchTimerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSearchRemainingSec(remaining);

      if (remaining <= 0) {
        setIsSearching(false);
        setSearchRemainingSec(null);
        if (searchTimerRef.current) clearInterval(searchTimerRef.current);
      }
    }, 250);

    return () => {
      if (searchTimerRef.current) clearInterval(searchTimerRef.current);
    };
  }, [isSearching, huntSeconds, activeStage?.id, setIsSearching, setSearchRemainingSec]);

  // Convert 24h targetTime (HH:MM:SS) to 12h representation
  const get12HourComponents = () => {
    let [h24, m, s] = (targetTime || '00:00:00').split(':').map(Number);
    h24 = isNaN(h24) ? 0 : h24;
    const period = h24 >= 12 ? 'PM' : 'AM';
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return {
      h12: String(h12).padStart(2, '0'),
      m: String(m || 0).padStart(2, '0'),
      s: String(s || 0).padStart(2, '0'),
      period
    };
  };

  const { h12: targetH12, m: targetM, s: targetS, period: targetPeriod } = get12HourComponents();

  const formatCountdown = (sec) => {
    if (sec === null || sec === undefined) return '--';
    if (sec <= 0) return '0s';
    const hrs = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (hrs >= 1) return `${hrs}h`;
    if (m >= 1) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const updateTargetTime12 = (newH12, newM, newS, newPeriod) => {
    let h = newH12 === '' ? 12 : parseInt(newH12, 10);
    if (isNaN(h) || h < 1) h = 12;
    if (h > 12) h = 12;

    let h24 = h;
    if (newPeriod === 'PM') {
      if (h < 12) h24 = h + 12;
      else h24 = 12;
    } else {
      if (h === 12) h24 = 0;
      else h24 = h;
    }

    const m = newM === '' ? 0 : Math.min(59, Math.max(0, parseInt(newM, 10) || 0));
    const s = newS === '' ? 0 : Math.min(59, Math.max(0, parseInt(newS, 10) || 0));

    setTargetTime?.(`${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
  };

  const handleTogglePopover = () => {
    if (!activeApplicant) {
      addLog?.('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
      try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
      return;
    }
    if (!isPopoverOpen) {
      if (!isTimedActive) {
        const d = new Date();
        setTargetTime?.(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`);
      }
      setIsPopoverOpen(true);
      setTimeout(() => {
        hourInputRef.current?.focus();
        hourInputRef.current?.select();
      }, 80);
    } else {
      setIsPopoverOpen(false);
    }
  };

  const handleArmTimer = () => {
    if (!activeApplicant) {
      addLog?.('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
      try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
      setIsPopoverOpen(false);
      return;
    }
    const now = new Date(serverNow());
    const [h, m, s] = (targetTime || '00:00:00').split(':').map(Number);
    const target = new Date(now.getTime());
    target.setHours(h, m, s, 0);
    if (target.getTime() <= now.getTime() - 2000) {
      target.setDate(target.getDate() + 1);
    }
    const diffMs = target.getTime() - now.getTime();
    const remainingSeconds = Math.max(1, Math.ceil(diffMs / 1000));
    setRemainingSec?.(remainingSeconds);
    storeSetTimedActive?.(true);
    setIsPopoverOpen(false);
    timedTrace(`TIMED armed by hand for ${targetTime} (${remainingSeconds}s to go, server time)`);
    addLog?.('USER_ACTION', 'Controls', `User armed TIMED booking for ${targetH12 || h}:${targetM || m}:${targetS || s} ${targetPeriod || ''} (Countdown: ${remainingSeconds}s remaining)`, activePan);
  };

  const handleDisarmTimer = () => {
    addLog?.('USER_ACTION', 'Controls', `User disarmed/cancelled TIMED countdown`, activePan);
    storeSetTimedActive?.(false);
    setRemainingSec?.(null);
  };

  const handleStartSearch = () => {
    if (!activeApplicant) {
      addLog?.('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
      try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
      return;
    }
    if (isTimedActive) return;
    addLog?.('USER_ACTION', 'Controls', `User clicked SEARCH button (Target flats: [${targetFlatsList.join(', ')}], Duration: ${huntSeconds === 0 ? 'Continuous' : huntSeconds + 's'})`, activePan);
    setIsSearching(true);
    setSearchRemainingSec(huntSeconds === 0 ? null : (huntSeconds || 30));
    setIsConsoleMinimized(false);
    onManual?.(null, huntSeconds);
  };

  // "Save & Search" from the flat page's Add-more-flats modal: the user's own press, so the
  // search starts (or, if one is running, stops and starts again with the new flats)
  const saveAndSearchRef = useRef(null);
  saveAndSearchRef.current = () => {
    if (activeStage?.id !== 'FLAT_SELECT') return;
    if (isTimedActive || !isAutofill) {
      addLog?.('WARN', 'Controls', `Flats saved, search not started: ${isTimedActive ? 'Timed countdown is active' : 'Autofill is OFF'}`, activePan);
      return;
    }
    if (isSearching) {
      handleStopAll();
      setTimeout(() => saveAndSearchRef.current?.(), 400);
      return;
    }
    handleStartSearch();
  };
  useEffect(() => {
    const onSaveAndSearch = (e) => {
      // Several SidebarControls can be mounted: only the first one handles each request
      const at = e.detail?.at;
      if (at && window.__ddaSaveAndSearchHandled === at) return;
      window.__ddaSaveAndSearchHandled = at;
      saveAndSearchRef.current?.();
    };
    window.addEventListener('dda:save-and-search', onSaveAndSearch);
    return () => window.removeEventListener('dda:save-and-search', onSaveAndSearch);
  }, []);

  const handleStopAll = () => {
    addLog?.('USER_ACTION', 'Controls', `User clicked STOP button (Stage: ${activeStage?.id || 'Active'}, Searching was: ${isSearching ? 'ACTIVE' : 'IDLE'}, Timed was: ${isTimedActive ? 'ACTIVE' : 'IDLE'})`, activePan);
    setIsSearching(false);
    setSearchRemainingSec(null);
    setIsConsoleMinimized(true);
    handleDisarmTimer();
    setIsPopoverOpen(false);
    onStop?.();
  };

  const setOffsetSeconds = (sec) => {
    const d = new Date(Date.now() + sec * 1000);
    setTargetTime?.(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`);
  };

  const adjust12Hour = (amount) => {
    let curH = parseInt(targetH12, 10) || 12;
    let nextH = curH + amount;
    if (nextH > 12) nextH = 1;
    if (nextH < 1) nextH = 12;
    updateTargetTime12(nextH, targetM, targetS, targetPeriod);
  };

  const adjustSegment = (type, amount) => {
    if (type === 'h') {
      adjust12Hour(amount);
      return;
    }
    let [h, m, s] = (targetTime || '00:00:00').split(':').map(Number);
    if (type === 'm') {
      m = (m + amount + 60) % 60;
    } else if (type === 's') {
      s = (s + amount + 60) % 60;
    }
    setTargetTime?.(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
  };

  const handleHourInput = (val) => {
    const clean = String(val || '').replace(/\D/g, '');
    if (!clean) {
      updateTargetTime12('', targetM, targetS, targetPeriod);
      return;
    }
    const num = parseInt(clean, 10);
    if (num > 12) {
      const lastDigit = parseInt(clean.slice(-1), 10);
      const valid = lastDigit === 0 ? 10 : Math.min(12, lastDigit);
      updateTargetTime12(valid, targetM, targetS, targetPeriod);
      minuteInputRef.current?.focus();
      minuteInputRef.current?.select();
      return;
    }
    updateTargetTime12(num, targetM, targetS, targetPeriod);
    if (clean.length >= 2 || (num >= 2 && num <= 9)) {
      minuteInputRef.current?.focus();
      minuteInputRef.current?.select();
    }
  };

  const handleMinuteInput = (val) => {
    const clean = String(val || '').replace(/\D/g, '');
    if (!clean) {
      updateTargetTime12(targetH12, '', targetS, targetPeriod);
      return;
    }
    const num = parseInt(clean, 10);
    if (num > 59) {
      const lastDigit = parseInt(clean.slice(-1), 10);
      updateTargetTime12(targetH12, lastDigit, targetS, targetPeriod);
      secondInputRef.current?.focus();
      secondInputRef.current?.select();
      return;
    }
    updateTargetTime12(targetH12, num, targetS, targetPeriod);
    if (clean.length >= 2 || (num >= 6 && num <= 9)) {
      secondInputRef.current?.focus();
      secondInputRef.current?.select();
    }
  };

  const handleSecondInput = (val) => {
    const clean = String(val || '').replace(/\D/g, '');
    if (!clean) {
      updateTargetTime12(targetH12, targetM, '', targetPeriod);
      return;
    }
    let num = parseInt(clean, 10);
    if (num > 59) {
      num = parseInt(clean.slice(-1), 10);
    }
    updateTargetTime12(targetH12, targetM, num, targetPeriod);
  };

  const handleTogglePeriod = (newPeriod) => {
    updateTargetTime12(targetH12, targetM, targetS, newPeriod);
  };

  const handleKeyDown = (e, type) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      adjustSegment(type, 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      adjustSegment(type, -1);
    } else if (e.key === 'ArrowRight') {
      if (type === 'h') {
        minuteInputRef.current?.focus();
        minuteInputRef.current?.select();
      } else if (type === 'm') {
        secondInputRef.current?.focus();
        secondInputRef.current?.select();
      }
    } else if (e.key === 'ArrowLeft') {
      if (type === 's') {
        minuteInputRef.current?.focus();
        minuteInputRef.current?.select();
      } else if (type === 'm') {
        hourInputRef.current?.focus();
        hourInputRef.current?.select();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleArmTimer();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsPopoverOpen(false);
    }
  };

  const isPaymentHoldStage = activeStage?.id === 'PAYMENT_HOLD';
  const isAppFormStage = activeStage?.id === 'APPLICATION_FORM';
  if (isTwoButtonStage || isPaymentHoldStage) {
    return (
      <div className={`${isStickyDeck ? 'space-y-1.5' : 'p-2.5 space-y-2 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs'} relative select-none animate-fade-in transition-all z-10`}>
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-[#4b2c83]" />
            <span>Quick Navigation</span>
          </span>
        </div>

        <div className="space-y-1.5 pt-0.5 animate-fade-in">
          {/* Test Application Form button if on Application Form stage */}
          {isAppFormStage && onTestApplicationForm && (
            <button
              type="button"
              onClick={onTestApplicationForm}
              title="Autofill application form with selected applicant details without submitting"
              className="w-full h-9.5 flex items-center justify-center gap-2 text-[11px] font-black tracking-wider uppercase rounded-lg bg-linear-to-r from-[#4b2c83]/15 via-[#63207c]/15 to-[#4b2c83]/15 hover:from-[#4b2c83]/25 hover:to-[#63207c]/25 text-[#4b2c83] border border-[#4b2c83]/40 shadow-xs transition-all active:scale-98 cursor-pointer group"
            >
              <FileCheck className="w-4 h-4 text-[#4b2c83] group-hover:scale-110 transition-transform shrink-0" />
              <span>TEST APPLICATION FORM</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onNavigateTo?.('https://eservices.dda.org.in/user/schemeList')}
            title="Open Schemes Page"
            className="w-full h-9.5 flex items-center justify-center gap-2 text-[11.5px] font-extrabold tracking-wider rounded-lg bg-[#faf5ff] hover:bg-[#f3e8ff] border border-[#e9d5ff] text-[#4b2c83] shadow-xs transition-all active:scale-98 cursor-pointer"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-[#4b2c83]" />
            <span>SCHEMES</span>
          </button>

          <button
            type="button"
            onClick={onReload}
            title="Reload Current Portal Page"
            className="w-full h-9 flex items-center justify-center gap-2 text-[11px] font-extrabold tracking-wider rounded-lg bg-white hover:bg-slate-50 border border-slate-200/90 text-slate-700 shadow-xs transition-all active:scale-98 cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5 text-slate-600" />
            <span>RELOAD</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${isStickyDeck ? 'space-y-1.5' : 'p-2.5 space-y-2 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs'} relative select-none transition-all ${
      isPopoverOpen ? 'z-50 ring-2 ring-[#4b2c83]/40 shadow-md rounded-2xl' : 'z-10'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-0.5 min-w-0">
        <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 shrink-0">
          <Settings className="w-3.5 h-3.5 text-[#4b2c83] shrink-0" />
          <span>Controls</span>
        </span>
        {/* Auto TIMED (admin's runtime config): one small line after the label, schemes page only */}
        {activeStage?.id === 'SCHEME' && <SidebarAutoTimed />}
      </div>

      <div className="space-y-1.5 pt-0.5 animate-fade-in">
        <style>{`
          @keyframes ddaTimedGlowFade {
            0%, 100% {
              border-color: rgba(252, 211, 77, 0.25);
              box-shadow: 0 0 0 0 rgba(252, 211, 77, 0);
            }
            50% {
              border-color: rgba(252, 211, 77, 1);
              box-shadow: 0 0 14px 2px rgba(252, 211, 77, 0.8), 0 0 4px 1px rgba(252, 211, 77, 0.9);
            }
          }
        `}</style>

      {/* Popover container */}
      <div className="relative" ref={popoverRef}>
        {isPopoverOpen && (
          <div className="absolute bottom-full mb-3.5 left-0 right-0 w-full bg-white border border-slate-200/90 rounded-2xl p-3.5 shadow-xl ring-4 ring-[#4b2c83]/10 z-50 animate-fade-in text-slate-800 select-none backdrop-blur-xl">
            <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div 
                  style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }}
                  className="flex items-center justify-center w-6 h-6 rounded-lg text-white shadow-sm shadow-[#4b2c83]/30"
                >
                  <Clock className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">Select Time</span>
              </div>
              <button
                onClick={() => setIsPopoverOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  Target Time (12-Hour)
                </span>
                <button
                  type="button"
                  onClick={() => setOffsetSeconds(0)}
                  title="Reset to Current Time"
                  className="text-[10px] font-extrabold text-[#4b2c83] hover:text-[#381e64] flex items-center gap-0.5 cursor-pointer"
                >
                  <RefreshCw className="w-2.5 h-2.5" /> Now
                </button>
              </div>

              <div className={`flex items-center justify-center ${isCompact ? 'p-1.5 gap-0' : 'p-2 gap-0.5'} bg-slate-50/90 border border-[#e9d5ff] rounded-xl shadow-inner`}>
                {/* HR */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => adjust12Hour(1)}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <input
                    ref={hourInputRef}
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={targetH12}
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.target.select()}
                    onChange={(e) => handleHourInput(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, 'h')}
                    className={`${isCompact ? 'w-7.5 h-6 text-xs' : 'w-8.5 h-6.5 text-sm'} text-center font-mono font-extrabold text-slate-900 bg-white border border-slate-300 rounded-md shadow-sm outline-none focus:ring-2 focus:ring-[#4b2c83]/20 focus:border-[#4b2c83] select-all cursor-text`}
                  />
                  <button
                    type="button"
                    onClick={() => adjust12Hour(-1)}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  <span className="text-[8px] font-bold uppercase text-slate-400 mt-0.5">HR</span>
                </div>

                <span className={`font-mono font-extrabold text-slate-400 -mt-3.5 ${isCompact ? 'px-0 text-xs' : 'px-0.5 text-sm'}`}>:</span>

                {/* MIN */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => adjustSegment('m', 1)}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <input
                    ref={minuteInputRef}
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={targetM}
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.target.select()}
                    onChange={(e) => handleMinuteInput(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, 'm')}
                    className={`${isCompact ? 'w-7.5 h-6 text-xs' : 'w-8.5 h-6.5 text-sm'} text-center font-mono font-extrabold text-slate-900 bg-white border border-slate-300 rounded-md shadow-sm outline-none focus:ring-2 focus:ring-[#4b2c83]/20 focus:border-[#4b2c83] select-all cursor-text`}
                  />
                  <button
                    type="button"
                    onClick={() => adjustSegment('m', -1)}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  <span className="text-[8px] font-bold uppercase text-slate-400 mt-0.5">MIN</span>
                </div>

                <span className={`font-mono font-extrabold text-slate-400 -mt-3.5 ${isCompact ? 'px-0 text-xs' : 'px-0.5 text-sm'}`}>:</span>

                {/* SEC */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => adjustSegment('s', 1)}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <input
                    ref={secondInputRef}
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={targetS}
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.target.select()}
                    onChange={(e) => handleSecondInput(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, 's')}
                    className={`${isCompact ? 'w-7.5 h-6 text-xs' : 'w-8.5 h-6.5 text-sm'} text-center font-mono font-extrabold text-[#4b2c83] bg-white border border-[#e9d5ff] rounded-md shadow-sm outline-none focus:ring-2 focus:ring-[#4b2c83]/20 focus:border-[#4b2c83] select-all cursor-text`}
                  />
                  <button
                    type="button"
                    onClick={() => adjustSegment('s', -1)}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  <span className="text-[8px] font-bold uppercase text-slate-400 mt-0.5">SEC</span>
                </div>

                <div className={`w-px bg-slate-200 shrink-0 -mt-1.5 ${isCompact ? 'h-7 mx-0.5' : 'h-8 mx-1'}`} />

                {/* AM/PM */}
                <div className="flex flex-col gap-1.5 shrink-0 -mt-1">
                  <button
                    type="button"
                    onClick={() => handleTogglePeriod('AM')}
                    className={`px-1.5 py-0.5 text-[9.5px] font-extrabold rounded-md transition-all cursor-pointer ${
                      targetPeriod === 'AM' 
                        ? 'bg-[#4b2c83] text-white shadow-xs' 
                        : 'bg-slate-200/80 text-slate-600 hover:bg-slate-300'
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTogglePeriod('PM')}
                    className={`px-1.5 py-0.5 text-[9.5px] font-extrabold rounded-md transition-all cursor-pointer ${
                      targetPeriod === 'PM' 
                        ? 'bg-[#4b2c83] text-white shadow-xs' 
                        : 'bg-slate-200/80 text-slate-600 hover:bg-slate-300'
                    }`}
                  >
                    PM
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Offset Buttons */}
            <div className="grid grid-cols-4 gap-1 mb-3">
              <button
                type="button"
                onClick={() => setOffsetSeconds(15)}
                className="py-1 px-0.5 text-[10px] font-extrabold rounded-lg bg-[#faf5ff] hover:bg-[#f3e8ff] text-[#4b2c83] border border-[#e9d5ff] transition-all cursor-pointer text-center"
              >
                +15s
              </button>
              <button
                type="button"
                onClick={() => setOffsetSeconds(30)}
                className="py-1 px-0.5 text-[10px] font-extrabold rounded-lg bg-[#faf5ff] hover:bg-[#f3e8ff] text-[#4b2c83] border border-[#e9d5ff] transition-all cursor-pointer text-center"
              >
                +30s
              </button>
              <button
                type="button"
                onClick={() => setOffsetSeconds(60)}
                className="py-1 px-0.5 text-[10px] font-extrabold rounded-lg bg-[#faf5ff] hover:bg-[#f3e8ff] text-[#4b2c83] border border-[#e9d5ff] transition-all cursor-pointer text-center"
              >
                +1m
              </button>
              <button
                type="button"
                onClick={() => setTargetTime?.('12:00:00')}
                title="Set to 12:00:00 PM (Official DDA Drop)"
                className={`py-1 px-0.5 text-[10px] font-extrabold rounded-lg transition-all cursor-pointer text-center ${
                  targetTime === '12:00:00'
                    ? 'bg-[#4b2c83] text-white border border-[#4b2c83] shadow-xs'
                    : 'bg-[#faf5ff] hover:bg-[#f3e8ff] text-[#4b2c83] border border-[#e9d5ff]'
                }`}
              >
                12:00 PM
              </button>
            </div>

            {/* Start / Stop Timer Button inside Popover */}
            {isTimedActive ? (
              <button
                type="button"
                onClick={() => {
                  handleDisarmTimer();
                  onStop?.();
                }}
                className="w-full h-9 flex items-center justify-center gap-1.5 text-xs font-extrabold tracking-wider text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-all shadow-sm cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" /> STOP TIMER
              </button>
            ) : (
              <button
                type="button"
                onClick={handleArmTimer}
                style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }}
                className="w-full h-9 flex items-center justify-center gap-1.5 text-xs font-extrabold tracking-wider text-white hover:opacity-95 rounded-xl transition-all shadow-md shadow-[#4b2c83]/30 active:scale-98 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> START TIMER
              </button>
            )}

            <div className="absolute top-full left-[25%] -translate-x-1/2 -mt-1.75 w-3.5 h-3.5 bg-white border-r border-b border-slate-200/90 transform rotate-45" />
          </div>
        )}
      </div>

        {/* Search Duration Setting Dropdown */}
        {activeStage?.id === 'FLAT_SELECT' && (
          <div className={`flex flex-col @[250px]:flex-row @[250px]:items-center @[250px]:justify-between gap-1.5 px-2.5 py-1.5 bg-slate-50/90 border border-slate-200/80 rounded-lg mb-1 shadow-2xs transition-all ${
            !isAutofill ? 'opacity-40 grayscale-40 select-none' : ''
          }`}>
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 min-w-0 pr-1 shrink-0 whitespace-nowrap">
              <Clock className="w-3 h-3 text-[#4b2c83] shrink-0" />
              <span>Search Duration</span>
            </span>
            <div className="flex items-center w-full @[250px]:w-auto shrink-0">
              <select
                value={huntSeconds}
                onChange={(e) => setHuntSeconds(parseInt(e.target.value, 10))}
                disabled={!isAutofill || isSearching || isTimedActive}
                title={!isAutofill ? "Autofill is OFF (Enable Autofill to change search duration)" : undefined}
                className="w-full @[250px]:w-auto h-7 px-2 font-mono text-[10.5px] font-bold text-slate-800 bg-white border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-[#4b2c83] focus:border-[#4b2c83] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-2xs"
              >
                <option value={30}>0.5 min (30s)</option>
                <option value={60}>1 min (60s)</option>
                <option value={90}>1.5 min (90s)</option>
                <option value={120}>2 min (120s)</option>
                <option value={180}>3 min (180s)</option>
                <option value={300}>5 min (300s)</option>
                <option value={600}>10 min (600s)</option>
                <option value={0}>Continuous</option>
              </select>
            </div>
          </div>
        )}

        {activeStage?.id === 'FLAT_SELECT' ? (
          <>
            {/* 4 Action Buttons Grid for FLAT_SELECT */}
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              {/* Button 1: SEARCH */}
              <button
                onClick={
                  isTimedActive || (!isSearching && !isAutofill) || (!isSearching && !hasTargetFlats)
                    ? undefined
                    : isSearching
                      ? handleStopAll
                      : handleStartSearch
                }
                disabled={isTimedActive || (!isSearching && !isAutofill) || (!isSearching && !hasTargetFlats)}
                title={
                  !isAutofill && !isSearching
                    ? "Autofill is OFF (Enable Autofill to start search)"
                    : isTimedActive
                      ? "Disabled while Timed countdown is active"
                      : isSearching
                        ? huntSeconds === 0
                          ? "Searching continuously (Click STOP to abort)"
                          : `Searching... ${searchRemainingSec ?? huntSeconds}s remaining (Click to stop)`
                        : !hasTargetFlats
                          ? "Add at least one target flat to start search"
                          : "Search & Reserve Target Flat"
                }
                className={`h-10 flex flex-col items-center justify-center text-[11px] font-extrabold tracking-wider rounded-lg transition-all ${
                  isTimedActive || (!isSearching && !isAutofill) || (!isSearching && !hasTargetFlats)
                    ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed select-none shadow-none'
                    : isSearching
                      ? 'bg-[#047857] text-white shadow-md shadow-emerald-700/30 ring-2 ring-emerald-400/40 active:scale-95 cursor-pointer py-1'
                      : 'bg-[#059669] hover:bg-[#047857] text-white hover:opacity-95 shadow-xs active:scale-95 cursor-pointer'
                }`}
              >
                {isSearching ? (
                  <div className="flex items-center justify-center gap-1.5 w-full px-1 min-w-0">
                    <Loader2 className="w-3.5 h-3.5 text-white animate-spin shrink-0" />
                    <div className="flex flex-col items-center justify-center text-center leading-none min-w-0 truncate">
                      <span className="text-[9.5px] font-black tracking-wider uppercase text-white animate-pulse truncate">
                        SEARCHING
                      </span>
                      <span className="text-[11px] font-mono font-black text-amber-300 tracking-wider leading-none mt-0.5 drop-shadow-xs truncate">
                        {huntSeconds === 0 ? 'CONT' : `${searchRemainingSec ?? huntSeconds}s`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1.5 leading-none">
                    <Search className={`w-3.5 h-3.5 stroke-[2.5] ${isTimedActive || (!isSearching && !isAutofill) || (!isSearching && !hasTargetFlats) ? 'text-slate-400' : 'text-white'}`} />
                    <span>SEARCH</span>
                  </div>
                )}
              </button>

              {/* Button 2: STOP (Disabled by default; only active while Search is running) */}
              <button
                onClick={isSearching && isAutofill ? handleStopAll : undefined}
                disabled={!isSearching || !isAutofill}
                title={!isAutofill ? "Autofill is OFF" : isSearching ? "Stop Flat Search" : "Search is idle"}
                className={`h-10 flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wider rounded-lg transition-all select-none ${
                  isSearching && isAutofill
                    ? 'bg-[#dc2626] hover:bg-[#b91c1c] text-white shadow-xs border border-rose-600 hover:opacity-95 active:scale-95 cursor-pointer'
                    : !isAutofill
                      ? 'bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                      : 'bg-rose-50 border border-rose-200 text-rose-700 shadow-xs cursor-not-allowed'
                }`}
              >
                <CircleSlash className={`w-3.5 h-3.5 stroke-[2.5] ${isSearching && isAutofill ? 'text-white' : !isAutofill ? 'text-rose-400' : 'text-rose-600'}`} />
                <span>STOP</span>
              </button>

              {/* Button 3: MULTI RELOAD (Loops repeatedly until HTTP 200 OK) */}
              <button
                onClick={isTimedActive ? undefined : () => {
                  addLog?.('USER_ACTION', 'Recovery', `User manually clicked MULTI RELOAD button`, activePan);
                  onMultiReload?.();
                }}
                disabled={isTimedActive}
                title={
                  isTimedActive
                    ? "Disabled while Timed countdown is active"
                    : isMultiReloading
                      ? `Multi-Reloading repeatedly until 200 OK (Attempt #${multiReloadAttempt}). Click to stop.`
                      : "Multi-Reload: Rapidly reloads repeatedly until DDA returns HTTP 200 OK"
                }
                className={`h-10 flex items-center justify-center gap-1.5 text-[10.5px] font-extrabold tracking-wider rounded-lg transition-all ${
                  isTimedActive
                    ? 'bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed select-none shadow-none'
                    : isMultiReloading
                      ? 'bg-[#d97706] text-white border border-amber-500 shadow-md shadow-amber-600/30 active:scale-95 cursor-pointer ring-2 ring-amber-400/50'
                      : 'bg-white border border-slate-200/90 text-slate-700 hover:bg-slate-50 hover:text-[#4b2c83] hover:border-[#4b2c83]/40 shadow-xs active:scale-95 cursor-pointer'
                }`}
              >
                {isMultiReloading ? (
                  <div className="flex items-center justify-center gap-1.5 leading-none min-w-0 px-1">
                    <Loader2 className="w-3.5 h-3.5 text-white animate-spin stroke-[2.5] shrink-0" />
                    <span className="font-mono font-black text-[10px] truncate">RETRYING ({multiReloadAttempt})</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1.5 leading-none min-w-0 px-1">
                    <RefreshCw className={`w-3.5 h-3.5 stroke-[2.5] shrink-0 ${isTimedActive ? 'text-slate-400' : ''}`} />
                    <span className="truncate"><span className="hidden @[230px]:inline">MULTI </span>RELOAD</span>
                  </div>
                )}
              </button>

              {/* Button 4: SCHEMES */}
              <button
                onClick={isTimedActive ? undefined : () => {
                  addLog?.('USER_ACTION', 'Navigation', `User clicked SCHEMES navigation button`, activePan);
                  onNavigateTo?.('https://eservices.dda.org.in/user/schemeList');
                }}
                disabled={isTimedActive}
                title={isTimedActive ? "Disabled while Timed countdown is active" : "Open Schemes Page"}
                className={`h-10 flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wider rounded-lg transition-all ${
                  isTimedActive
                    ? 'bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed select-none shadow-none'
                    : 'bg-[#faf5ff] border border-[#e9d5ff] text-[#4b2c83] hover:bg-[#f3e8ff] shadow-xs active:scale-95 cursor-pointer'
                }`}
              >
                <LayoutGrid className={`w-3.5 h-3.5 stroke-[2.5] shrink-0 ${isTimedActive ? 'text-slate-400' : 'text-[#4b2c83]'}`} />
                <span className="truncate">SCHEMES</span>
              </button>
            </div>

          {/* Horizontal divider line & Refresh Button */}
          <div className="w-full h-px bg-slate-200/80 my-1.5" />

          <button
            onClick={isTimedActive ? undefined : () => {
              addLog?.('USER_ACTION', 'Navigation', `User clicked sidebar REFRESH button`, activePan);
              onReload?.();
            }}
            disabled={isTimedActive}
            title={isTimedActive ? "Disabled while active" : "Refresh Current Portal Page"}
            className={`w-full h-8.5 flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wider rounded-lg bg-white border border-slate-200/90 text-slate-700 transition-all ${
              isTimedActive
                ? 'opacity-40 cursor-not-allowed grayscale-50 shadow-none select-none'
                : 'hover:bg-slate-50 hover:text-[#4b2c83] hover:border-[#4b2c83]/40 shadow-xs active:scale-95 cursor-pointer'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>REFRESH</span>
          </button>
        </>
      ) : (
        <>
          {/* 2x2 Controls Deck for SCHEMES Stage */}
          <div className="grid grid-cols-2 gap-1.5 @[240px]:gap-2 pt-0.5">
            {/* Button 1 (Top-Left): TIMED */}
            <button
              type="button"
              onClick={isTimedActive ? undefined : (isSearching || !isAutofill ? undefined : handleTogglePopover)}
              disabled={isTimedActive || isSearching || !isAutofill}
              title={
                !isAutofill && !isTimedActive && !isSearching
                  ? "Autofill is OFF (Enable Autofill to use Timed Drop)"
                  : isTimedActive 
                    ? `Timer active for ${targetH12}:${targetM}:${targetS} ${targetPeriod} (${formatCountdown(remainingSec)}). Click STOP to cancel.` 
                    : isSearching
                      ? "Timer reached — applying for the scheme as soon as the Apply link appears (Click STOP to abort)"
                      : "Set Timed Drop Auto-Run"
              }
              className={`h-[50px] flex items-center justify-center text-xs font-extrabold tracking-wider rounded-xl transition-all ${
                isTimedActive
                  ? 'bg-[#4b2c83] text-white shadow-xs opacity-90 cursor-not-allowed select-none border-2 border-[rgba(252,211,77,0.25)]'
                  : isSearching
                    ? 'bg-[#4b2c83] text-white shadow-md shadow-purple-700/30 ring-2 ring-purple-400/40 active:scale-98 cursor-pointer border-2 border-transparent'
                    : !isAutofill
                      ? 'bg-slate-100 text-slate-400 border-2 border-slate-200 cursor-not-allowed select-none shadow-none'
                      : 'bg-[#4b2c83] hover:bg-[#3c2269] text-white shadow-xs hover:opacity-95 active:scale-98 cursor-pointer border-2 border-transparent'
              }`}
              style={isTimedActive ? { animation: 'ddaTimedGlowFade 2.4s ease-in-out infinite' } : undefined}
            >
              {isTimedActive ? (
                <div className="flex items-center justify-center gap-1.5 w-full px-1 min-w-0">
                  <Loader2 className="w-4 h-4 text-amber-300 animate-spin shrink-0" />
                  <div className="flex flex-col items-center justify-center text-center leading-tight select-none min-w-0 truncate">
                    <span className="block w-full text-center text-[10px] font-black uppercase text-white leading-tight truncate">
                      Applying in
                    </span>
                    <span className="block w-full text-center text-[11px] font-black text-amber-300 normal-case leading-tight mt-0.5 tabular-nums truncate">
                      {formatCountdown(remainingSec)}
                    </span>
                    <span
                      title="The apply time set for TIMED"
                      className="block w-full text-center text-[9px] font-bold text-white/80 normal-case leading-none mt-0.5 tabular-nums truncate"
                    >
                      at {targetH12}:{targetM}:{targetS} {targetPeriod}
                    </span>
                  </div>
                </div>
              ) : isSearching ? (
                /* The countdown has fired and the engine is hunting the Apply link. On this stage
                   `isSearching` is only ever set by handleTimedSchemeApply, so this is always the
                   timed run continuing — "Applying..." rather than "Searching", which read as if
                   the timer had been abandoned for something else. */
                <div className="flex items-center justify-center gap-1.5 w-full px-1 min-w-0">
                  <Loader2 className="w-4 h-4 text-amber-300 animate-spin shrink-0" />
                  <div className="flex flex-col items-center justify-center text-center leading-tight select-none min-w-0 truncate">
                    <span className="block w-full text-center text-[10px] font-black uppercase text-white leading-tight truncate animate-pulse">
                      Applying...
                    </span>
                    <span className="block w-full text-center text-[9.5px] font-bold text-amber-300 normal-case leading-none mt-0.5 truncate">
                      click stop
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1.5">
                  <Clock className={`w-4 h-4 stroke-[2.5] shrink-0 ${!isAutofill ? 'text-slate-400' : 'text-white'}`} />
                  <span className="text-[12px] font-black">TIMED</span>
                </div>
              )}
            </button>

            {/* Button 2 (Top-Right): STOP (Right side of Timed) */}
            <button
              type="button"
              onClick={isTimedActive || isSearching ? handleStopAll : undefined}
              disabled={!isTimedActive && !isSearching}
              title={
                isTimedActive
                  ? "Stop Timed Apply Countdown"
                  : isSearching
                    ? "Stop Applying"
                    : "Stop is idle"
              }
              className={`h-[50px] flex items-center justify-center gap-1.5 text-[12px] font-black tracking-wider rounded-xl transition-all select-none ${
                isTimedActive || isSearching
                  ? 'bg-[#dc2626] hover:bg-[#b91c1c] text-white shadow-md shadow-rose-600/30 border border-rose-600 active:scale-98 cursor-pointer ring-2 ring-rose-400/40'
                  : 'bg-rose-50/80 border border-rose-200/80 text-rose-500 opacity-60 cursor-not-allowed shadow-none'
              }`}
            >
              <CircleSlash className={`w-4 h-4 stroke-[2.5] shrink-0 ${isTimedActive || isSearching ? 'text-white' : 'text-rose-400'}`} />
              <span>STOP</span>
            </button>

            {/* Button 3 (Bottom-Left): RELOAD (Under Timed) */}
            <button
              type="button"
              onClick={isTimedActive || isSearching ? undefined : () => {
                addLog?.('USER_ACTION', 'Navigation', `User clicked sidebar RELOAD button`, activePan);
                onReload?.();
              }}
              disabled={isTimedActive || isSearching}
              title={
                isTimedActive
                  ? "Disabled while Timed countdown is active"
                  : isSearching
                    ? "Disabled while Search is active"
                    : "Reload Current Portal Page"
              }
              className={`h-[50px] flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wider rounded-xl bg-white border border-slate-200/90 text-slate-700 transition-all ${
                isTimedActive
                  ? 'opacity-70 cursor-not-allowed select-none shadow-none'
                  : isSearching
                    ? 'opacity-40 cursor-not-allowed select-none shadow-none'
                    : 'hover:bg-slate-50 hover:text-[#4b2c83] hover:border-[#4b2c83]/40 shadow-xs active:scale-98 cursor-pointer'
              }`}
            >
              <RotateCw className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">RELOAD</span>
            </button>

            {/* Button 4 (Bottom-Right): MANUAL (Under Stop) */}
            <button
              type="button"
              onClick={isTimedActive || isSearching || !isAutofill ? undefined : () => {
                if (!activeApplicant) {
                  addLog?.('WARN', 'Controls', '⚠️ Please select an applicant first to use automation controls.');
                  try { alert('Please select an applicant first to use automation controls.'); } catch (_) {}
                  return;
                }
                addLog?.('USER_ACTION', 'Controls', `User clicked MANUAL button on Schemes stage`, activePan);
                onManual?.();
              }}
              disabled={isTimedActive || isSearching || !isAutofill}
              title={
                !isAutofill
                  ? "Autofill is OFF (Enable Autofill to trigger Manual Booking)"
                  : isTimedActive
                    ? "Disabled while Timed countdown is active"
                    : isSearching
                      ? "Disabled while Search is active"
                      : "Trigger Immediate Manual Booking Run"
              }
              className={`h-[50px] flex items-center justify-center gap-1.5 text-[12px] font-black tracking-wider rounded-xl transition-all ${
                isTimedActive
                  ? 'bg-[#059669] text-white opacity-70 cursor-not-allowed select-none shadow-none'
                  : isSearching || !isAutofill
                    ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed select-none shadow-none'
                    : 'bg-[#059669] hover:bg-[#047857] text-white hover:opacity-95 shadow-xs active:scale-98 cursor-pointer'
              }`}
            >
              <Zap className={`w-4 h-4 stroke-[2.5] shrink-0 ${!isAutofill || isSearching ? 'text-slate-400' : 'text-white'}`} />
              <span>MANUAL</span>
            </button>
          </div>

        </>
      )}
    </div>
  </div>
  );
}
