import React, { useState, useRef, useEffect } from 'react';
import { KeyRound, RotateCw, Loader2, LogIn, ShieldCheck, Eraser, Check, UserCog } from 'lucide-react';
import { setLockedLoginPan, useLockedLoginPan } from '../../utils/loginLock';
import SidebarApplicantSelector from './SidebarApplicantSelector';
import { useApplicantStore } from '../../store';

export default function SidebarLoginPanel({
  applicants,
  activeApplicant,
  onSelectApplicant,
  onEditApplicant,
  onAutofillLogin,
  captchaDataUrl,
  captchaInputVal,
  onSyncCaptchaInput,
  onRefreshCaptcha,
  onSubmitLogin,
  onReload
}) {
  const [isRefreshingCaptcha, setIsRefreshingCaptcha] = useState(false);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const sidebarCaptchaInputRef = useRef(null);
  const lockedPan = useLockedLoginPan();
  const openAddUserModal = useApplicantStore((s) => s.openAddUserModal);
  const openEditUsersModal = useApplicantStore((s) => s.openEditUsersModal);
  const activePan = (activeApplicant?.pan || '').toUpperCase().trim();
  const isLocked = Boolean(lockedPan);

  const handleToggleLock = () => {
    if (isLocked) {
      setLockedLoginPan('');
    } else if (activePan) {
      setLockedLoginPan(activePan);
      onAutofillLogin?.(activeApplicant, true);
    }
  };
  // Picking an applicant here locks the window to them at once (the lock is
  // set first, so the login fill that follows the pick uses the same applicant)
  const handleSelectAndLock = (pan) => {
    const clean = (pan || '').toUpperCase().trim();
    if (clean) setLockedLoginPan(clean);
    onSelectApplicant?.(pan);
  };
  const [hashClear, setHashClear] = useState('idle'); // idle | busy | done | failed

  const handleClearHashes = async () => {
    setHashClear('busy');
    try {
      const res = await window.ddaElectronAPI?.clearHashes?.();
      setHashClear(res?.success ? 'done' : 'failed');
    } catch (_) {
      setHashClear('failed');
    }
    setTimeout(() => setHashClear('idle'), 2500);
  };

  // Auto-focus sidebar captcha input cleanly on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (sidebarCaptchaInputRef.current && document.activeElement !== sidebarCaptchaInputRef.current) {
        sidebarCaptchaInputRef.current.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleTriggerRefreshCaptcha = () => {
    setIsRefreshingCaptcha(true);
    onRefreshCaptcha?.();
    setTimeout(() => setIsRefreshingCaptcha(false), 900);
  };

  const handleTriggerLoginSubmit = () => {
    setIsSubmittingLogin(true);
    onSubmitLogin?.(activeApplicant);
    setTimeout(() => setIsSubmittingLogin(false), 2000);
  };

  return (
    <div className="w-full space-y-2 animate-fade-in select-none">
      {/* Elevated Modern Login Card */}
      <div className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs space-y-3 relative z-30">
        {/* Header with Key Icon */}
        <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-[#4b2c83] text-white flex items-center justify-center shadow-xs shrink-0">
            <KeyRound className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-[13px] font-extrabold text-slate-900 tracking-tight leading-tight">
              Applicant Sign In
            </h4>
            <p className="text-[10.5px] text-slate-500 font-medium leading-tight mt-0.5">
              Fast 0-Click Portal Login
            </p>
          </div>
        </div>

        {/* Target Profile Dropdown Selector, with the lock beside it */}
        <div className="space-y-1">
          <SidebarApplicantSelector
            applicants={applicants}
            activeApplicant={activeApplicant}
            onSelectApplicant={handleSelectAndLock}
            onEditApplicant={onEditApplicant}
            onAutofillLogin={onAutofillLogin}
            isEmbeddedInCard={true}
            showEyeButton={false}
            isLocked={isLocked}
            onToggleLock={handleToggleLock}
            canLock={Boolean(activePan)}
          />
          {isLocked && (
            <p className="px-0.5 text-[9.5px] leading-snug font-medium text-slate-500">
              {activePan === lockedPan
                ? 'Locked in this window: stays selected through DDA logouts.'
                : `Locked ${lockedPan} is not in the login list. Unlock to choose another.`}
            </p>
          )}
          {!activePan && (
            <p className="px-0.5 text-[9.5px] leading-snug font-semibold text-slate-500">
              No applicant chosen for this window. Pick one above.
            </p>
          )}
          {activePan && !activeApplicant?.password && (
            <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 space-y-1.5">
              <p className="text-[10px] leading-snug font-semibold text-amber-900">
                No saved password for {activeApplicant?.name || activePan}. Add it now, or type it on DDA's page.
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openAddUserModal({ name: activeApplicant?.name || activePan, pan: activePan })}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-bold text-white bg-[#4b2c83] hover:bg-[#3c2269] cursor-pointer"
                >
                  <KeyRound className="w-3 h-3" /> Add password
                </button>
                <button
                  type="button"
                  onClick={() => openEditUsersModal()}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-bold text-amber-900 bg-white border border-amber-200 hover:bg-amber-100 cursor-pointer"
                >
                  <UserCog className="w-3 h-3" /> Edit users
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Live Captcha Stream & Input Controls */}
        <div className="space-y-2 pt-1 border-t border-slate-100">
          <div className="px-0.5">
            <label className="text-[10.5px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#4b2c83]" />
              <span>CAPTCHA</span>
            </label>
          </div>

          {/* Captcha Image Display */}
          <div className="h-11 w-full flex items-center justify-center overflow-hidden bg-slate-50/70 rounded-lg border border-slate-200/80 py-1">
            {captchaDataUrl ? (
              <img
                src={captchaDataUrl}
                alt="Portal Captcha"
                className="h-full object-contain filter contrast-125 select-none"
              />
            ) : (
              <div className="flex items-center gap-2 text-xs text-slate-400 font-medium animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4b2c83]" />
                <span>Loading portal captcha...</span>
              </div>
            )}
          </div>

          {/* Editable Captcha Textfield + Refresh Button */}
          <div className="flex items-center gap-2">
            <input
              ref={sidebarCaptchaInputRef}
              type="text"
              value={captchaInputVal || ''}
              onChange={(e) => onSyncCaptchaInput?.(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleTriggerLoginSubmit();
                }
              }}
              placeholder="Enter captcha text"
              maxLength={10}
              autoComplete="off"
              spellCheck="false"
              className="flex-1 h-9 px-3 bg-slate-50/90 border border-slate-200/90 focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 text-slate-900 font-bold text-xs rounded-lg shadow-2xs outline-none transition-all placeholder:text-slate-400 cursor-text caret-[#4b2c83] tracking-wider"
            />

            <button
              type="button"
              onClick={handleTriggerRefreshCaptcha}
              title="Reload Captcha on Portal"
              className="h-9 w-9 flex items-center justify-center rounded-lg bg-white hover:bg-slate-50 border border-slate-200/90 hover:border-[#4b2c83] text-slate-600 hover:text-[#4b2c83] shadow-2xs transition-all cursor-pointer shrink-0 active:scale-95"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isRefreshingCaptcha ? 'animate-spin text-[#4b2c83]' : ''}`} />
            </button>
          </div>

          {/* Login Submit Button */}
          <button
            type="button"
            onClick={handleTriggerLoginSubmit}
            disabled={!activeApplicant || isSubmittingLogin}
            className="w-full h-9.5 px-3 flex items-center justify-center gap-2 rounded-lg text-xs font-extrabold tracking-wider text-white bg-[#4b2c83] hover:bg-[#3d236b] shadow-xs hover:shadow transition-all cursor-pointer active:scale-98 disabled:opacity-50"
          >
            {isSubmittingLogin ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>LOGGING IN...</span>
              </>
            ) : (
              <>
                <LogIn className="w-3.5 h-3.5" />
                <span>LOGIN</span>
              </>
            )}
          </button>
        </div>

      </div>

      {/* Reload Login Page Button */}
      <button
        onClick={onReload}
        title="Reload Current Portal Page"
        className="w-full h-8.5 flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wider uppercase rounded-lg bg-white hover:bg-slate-50 border border-slate-200/90 text-slate-700 hover:text-[#4b2c83] hover:border-[#4b2c83]/40 shadow-2xs transition-all active:scale-95 cursor-pointer"
      >
        <RotateCw className="w-3.5 h-3.5 text-slate-500" />
        <span>Reload</span>
      </button>

      {/* Clear saved step2 hashes, so the next run builds the flat page link fresh */}
      <button
        onClick={handleClearHashes}
        disabled={hashClear === 'busy'}
        title="Clear the saved flat page hashes in every open DDA window"
        className="w-full h-8.5 flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wider uppercase rounded-lg bg-white hover:bg-slate-50 border border-slate-200/90 text-slate-700 hover:text-[#4b2c83] hover:border-[#4b2c83]/40 shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-60"
      >
        {hashClear === 'busy' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
          : hashClear === 'done' ? <Check className="w-3.5 h-3.5 text-emerald-600" />
          : <Eraser className="w-3.5 h-3.5 text-slate-500" />}
        <span>{hashClear === 'done' ? 'Hashes cleared' : hashClear === 'failed' ? 'Could not clear' : 'Clear hashes'}</span>
      </button>
    </div>
  );
}
