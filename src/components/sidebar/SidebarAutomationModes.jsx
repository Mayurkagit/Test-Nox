import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  ChevronDown, 
  Joystick, 
  FileText, 
  Navigation, 
  CreditCard, 
  PanelLeftClose
} from 'lucide-react';
import { useAutomationStore } from '../../store/useAutomationStore';
import { useAuthStore } from '../../store/useAuthStore';
import { detectDdaStage } from '../../utils/ddaRoutes';
import { wsGet, wsSet, wsRemove } from '../../utils/storageHelper';
import { useDdaSidebarHidden, setDdaSidebarHidden } from '../../utils/ddaSidebar';
import SidebarFastPayment from './SidebarFastPayment';
import { describeFastPayment } from '../../utils/paymentBanks';

// The page the fold was last set for (shared by every mounted copy of this section)
let lastFoldStage = null;

export default function SidebarAutomationModes({
  settings,
  onUpdateSettings,
  onTestApplicationForm,
  isAdmin: propIsAdmin,
  activeStage: propActiveStage,
  // Payment sidebar: only the Fast Payment settings (no Autofill / Skip Form).
  paymentOnly = false,
  // The window's applicant: its own Fast Payment (web form) is used before these settings
  activeApplicant = null
}) {
  const storeUser = useAuthStore((s) => s.user);
  const currentUrl = useAutomationStore((s) => s.currentUrl);
  const activeStage = propActiveStage || detectDdaStage(currentUrl);

  const isAdmin = Boolean(
    propIsAdmin !== undefined
      ? propIsAdmin
      : (
        storeUser?.role === 'admin' ||
        storeUser?.isAdmin === true ||
        storeUser?.admin === true ||
        (typeof window !== 'undefined' && (
          localStorage.getItem('dda_is_admin') === 'true' ||
          localStorage.getItem('dda_user_role') === 'admin'
        ))
      )
  );

  const isSchemesPage = activeStage?.id === 'SCHEME' || (currentUrl && currentUrl.toLowerCase().includes('schemelist'));
  const isPaymentHold = activeStage?.id === 'PAYMENT_HOLD' || (currentUrl && (currentUrl.toLowerCase().includes('getlayout') || currentUrl.toLowerCase().includes('payment') || currentUrl.toLowerCase().includes('hold')));

  const isCollapsed = useAutomationStore((s) => s.isAutomationModesCollapsed);
  const setIsCollapsed = useAutomationStore((s) => s.setIsAutomationModesCollapsed);
  const addLog = useAutomationStore((s) => s.addLog);

  // Open on the schemes page, folded on the flat page. Only when the page changes, so the
  // user's own open/close on a page stays.
  const stageId = activeStage?.id || '';
  useEffect(() => {
    if (paymentOnly) return;
    if (lastFoldStage === stageId) return;
    lastFoldStage = stageId;
    if (stageId === 'SCHEME') setIsCollapsed(false);
    else if (stageId === 'FLAT_SELECT') setIsCollapsed(true);
  }, [stageId, paymentOnly, setIsCollapsed]);

  // Hide DDA's own left menu in this window's DDA page (per window, not an app-wide setting)
  const isDdaSidebarHidden = useDdaSidebarHidden();
  const handleToggleDdaSidebar = () => {
    const next = !isDdaSidebarHidden;
    addLog?.('USER_ACTION', 'Modes', `User toggled Hide DDA Sidebar (this window): ${next ? 'ON' : 'OFF'}`);
    setDdaSidebarHidden(next);
  };

  // 1. Autofill: Master toggle for any/all automation across the website
  const isAutofill = settings?.automationEnabled !== false;

  // 2. Pre-Filled (Fast-Pass): Skips 25+ DOM field injections for pre-saved applications
  const isFastPass = isAutofill && (typeof settings?.prefilledFastPass === 'boolean'
    ? settings.prefilledFastPass
    : wsGet('dda_prefilled_fastpass') === 'true');

  // 3. Fast Payment: Auto-advance DDA hold & dispatches to external payment gateway
  const isFastPayment = isAutofill && (settings?.fastPaymentEnabled !== false && wsGet('dda_fast_payment_enabled') !== 'false');

  // A Fast Payment is set for this applicant (website choice or set on this PC)
  const fastPayConfigured = Boolean(describeFastPayment(activeApplicant?.preferences?.fastPayment));
  // Goes up to open the Fast Payment editor (switching on with nothing set)
  const [fastPayEditorSignal, setFastPayEditorSignal] = useState(0);

  const updateSavedSubToggle = (key, val) => {
    try {
      let saved = {
        prefilledFastPass: false,
        directUrlJumpEnabled: true,
        fastPaymentEnabled: true
      };
      const raw = wsGet('dda_autofill_saved_sub_toggles');
      if (raw) {
        saved = { ...saved, ...JSON.parse(raw) };
      }
      saved[key] = val;
      wsSet('dda_autofill_saved_sub_toggles', JSON.stringify(saved));
    } catch (_) {}
  };

  const handleToggleAutofill = () => {
    const next = !isAutofill;
    addLog?.('USER_ACTION', 'Modes', `User toggled Master Autofill: ${next ? 'ENABLED' : 'DISABLED'}`);
    if (!next) {
      // ─── TURNING AUTOFILL OFF ───
      const currentSubStates = {
        prefilledFastPass: settings?.prefilledFastPass === true || wsGet('dda_prefilled_fastpass') === 'true',
        directUrlJumpEnabled: settings?.directUrlJumpEnabled !== false && wsGet('directUrlJumpEnabled') !== 'false' && wsGet('dda_direct_url_jump_enabled') !== 'false',
        fastPaymentEnabled: settings?.fastPaymentEnabled !== false && wsGet('dda_fast_payment_enabled') !== 'false'
      };
      try {
        wsSet('dda_autofill_saved_sub_toggles', JSON.stringify(currentSubStates));
      } catch (_) {}

      // Stop active search if running
      try {
        useAutomationStore.getState().setIsSearching(false);
        useAutomationStore.getState().setSearchRemainingSec(null);
      } catch (_) {}

      // Turn off master and all sub-toggles
      onUpdateSettings?.({
        automationEnabled: false,
        captchaAutoSubmitEnabled: false,
        captchaAutoSolveEnabled: false,
        prefilledFastPass: false,
        directUrlJumpEnabled: false,
        fastPaymentEnabled: false
      });
      try {
        wsRemove('automationEnabled');
        wsSet('captchaAutoSubmitEnabled', 'false');
        wsSet('captchaAutoSolveEnabled', 'false');
        wsSet('dda_prefilled_fastpass', 'false');
        wsSet('directUrlJumpEnabled', 'false');
        wsSet('dda_direct_url_jump_enabled', 'false');
        wsSet('dda_fast_payment_enabled', 'false');
      } catch (_) {}
    } else {
      // ─── TURNING AUTOFILL BACK ON ───
      let restored = {
        prefilledFastPass: false,
        directUrlJumpEnabled: true,
        fastPaymentEnabled: true
      };
      try {
        const raw = wsGet('dda_autofill_saved_sub_toggles');
        if (raw) {
          const parsed = JSON.parse(raw);
          restored = {
            prefilledFastPass: Boolean(parsed.prefilledFastPass),
            directUrlJumpEnabled: parsed.directUrlJumpEnabled !== false,
            fastPaymentEnabled: parsed.fastPaymentEnabled !== false
          };
        }
      } catch (_) {}

      onUpdateSettings?.({
        automationEnabled: true,
        captchaAutoSubmitEnabled: true,
        captchaAutoSolveEnabled: true,
        prefilledFastPass: restored.prefilledFastPass,
        directUrlJumpEnabled: restored.directUrlJumpEnabled,
        fastPaymentEnabled: restored.fastPaymentEnabled
      });
      try {
        wsRemove('automationEnabled');
        wsSet('captchaAutoSubmitEnabled', 'true');
        wsSet('captchaAutoSolveEnabled', 'true');
        wsSet('dda_prefilled_fastpass', String(restored.prefilledFastPass));
        wsSet('directUrlJumpEnabled', String(restored.directUrlJumpEnabled));
        wsSet('dda_direct_url_jump_enabled', String(restored.directUrlJumpEnabled));
        wsSet('dda_fast_payment_enabled', String(restored.fastPaymentEnabled));
      } catch (_) {}
    }
  };

  const handleToggleFastPass = () => {
    if (!isAutofill) return;
    const next = !isFastPass;
    addLog?.('USER_ACTION', 'Modes', `User toggled Pre-Filled (Fast-Pass): ${next ? 'ENABLED' : 'DISABLED'}`);
    onUpdateSettings?.({
      prefilledFastPass: next
    });
    try {
      wsSet('dda_prefilled_fastpass', String(next));
    } catch (_) {}
    updateSavedSubToggle('prefilledFastPass', next);
  };

  const handleToggleFastPayment = () => {
    if (!isAutofill) return;
    const next = !isFastPayment;
    // Nothing set yet: open the editor instead. Saving a choice switches it on (Workspace);
    // closing without one leaves it off.
    if (next && !fastPayConfigured) {
      addLog?.('USER_ACTION', 'Modes', 'User switched Fast Payment on with nothing set: opening the Fast Payment editor');
      setFastPayEditorSignal((n) => n + 1);
      return;
    }
    addLog?.('USER_ACTION', 'Modes', `User toggled Fast Payment: ${next ? 'ENABLED' : 'DISABLED'}`);
    onUpdateSettings?.({
      fastPaymentEnabled: next
    });
    try {
      wsSet('dda_fast_payment_enabled', String(next));
    } catch (_) {}
    updateSavedSubToggle('fastPaymentEnabled', next);
  };

  const getBadgeText = () => {
    if (!isAutofill) return 'Automation OFF';
    return 'ACTIVE';
  };

  return (
    <div className="p-2 @[220px]:p-2.5 space-y-2 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs relative select-none transition-all">
      {/* Accordion Header */}
      <div 
        onClick={() => setIsCollapsed((prev) => !prev)}
        className="flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity"
      >
        <span className="text-[10px] @[220px]:text-[10.5px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 min-w-0">
          <Joystick className="w-3.5 h-3.5 text-[#4b2c83] shrink-0" />
          {paymentOnly
            ? <span className="truncate">Fast Payment</span>
            : <span className="truncate"><span className="hidden @[200px]:inline">Automation </span>Modes</span>}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {isCollapsed && (
            <span className={`text-[9px] font-mono font-extrabold px-1.5 @[200px]:px-2 py-0.5 rounded-full border uppercase tracking-wider truncate max-w-[50px] @[220px]:max-w-none ${
              !isAutofill 
                ? 'text-slate-500 bg-slate-100 border-slate-200' 
                : 'text-[#4b2c83] bg-[#faf5ff] border-[#e9d5ff]'
            }`}>
              {getBadgeText()}
            </span>
          )}
          <button
            type="button"
            className="p-0.5 rounded text-slate-400 hover:text-[#4b2c83] transition-colors"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="rounded-lg border border-slate-200/80 bg-slate-50/40 overflow-hidden divide-y divide-slate-100 animate-fade-in">
          
          {/* Payment sidebar: Autofill is not offered here; say so if it is off. */}
          {paymentOnly && !isAutofill && (
            <div className="p-2 text-[10px] font-semibold text-slate-600 leading-snug">
              Autofill is off, so Fast Payment won't run. Turn Autofill on from the schemes page.
            </div>
          )}

          {/* Toggle 1: Autofill (Master Switch) */}
          {!paymentOnly && (
          <label className="flex items-center justify-between p-1.5 @[220px]:p-2 px-2 @[220px]:px-2.5 hover:bg-slate-100/50 cursor-pointer transition-colors">
            <span className="text-[11.5px] font-bold text-slate-800 flex items-center gap-2 min-w-0 pr-2">
              <Zap className="w-3.5 h-3.5 text-[#4b2c83] shrink-0" />
              <span className="truncate">Autofill</span>
            </span>
            <input
              type="checkbox"
              checked={isAutofill}
              onChange={handleToggleAutofill}
              className="sr-only"
            />
            <div 
              className={`w-8 h-4.5 rounded-full transition-colors relative flex items-center px-0.5 shrink-0 ${
                isAutofill ? 'bg-[#4b2c83]' : 'bg-slate-300'
              }`}
            >
              <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform shadow-xs ${
                isAutofill ? 'translate-x-3.5' : 'translate-x-0'
              }`} />
            </div>
          </label>

          )}

          {/* Toggle 2: Skip Form */}
          {!paymentOnly && (
          <label 
            className={`flex items-center justify-between p-1.5 @[220px]:p-2 px-2 @[220px]:px-2.5 transition-colors ${
              !isAutofill 
                ? 'opacity-40 cursor-not-allowed select-none bg-slate-50/50' 
                : 'hover:bg-slate-100/50 cursor-pointer'
            }`}
            title={!isAutofill ? "Enable Autofill to configure Skip Form" : "Skip injecting 25+ form fields if application is already pre-saved in DDA portal"}
          >
            <span className="text-[11.5px] font-bold text-slate-800 flex items-center gap-2 min-w-0 pr-2">
              <FileText className={`w-3.5 h-3.5 shrink-0 ${!isAutofill ? 'text-slate-400' : 'text-[#4b2c83]'}`} />
              <span className="truncate">Skip Form</span>
            </span>
            <input
              type="checkbox"
              checked={isFastPass}
              onChange={handleToggleFastPass}
              disabled={!isAutofill}
              className="sr-only"
            />
            <div 
              className={`w-8 h-4.5 rounded-full transition-colors relative flex items-center px-0.5 shrink-0 ${
                isFastPass ? 'bg-[#4b2c83]' : 'bg-slate-300'
              }`}
            >
              <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform shadow-xs ${
                isFastPass ? 'translate-x-3.5' : 'translate-x-0'
              }`} />
            </div>
          </label>

          )}

          {/* Toggle: Hide DDA Sidebar (this window only; works with Autofill on or off) */}
          {!paymentOnly && (
          <label
            className="flex items-center justify-between p-1.5 @[220px]:p-2 px-2 @[220px]:px-2.5 hover:bg-slate-100/50 cursor-pointer transition-colors"
            title="On: hides the DDA page's own left menu in this window. Off: shows it again."
          >
            <span className="text-[11.5px] font-bold text-slate-800 flex items-center gap-2 min-w-0 pr-2">
              <PanelLeftClose className="w-3.5 h-3.5 text-[#4b2c83] shrink-0" />
              <span className="truncate">Hide DDA Sidebar</span>
            </span>
            <input
              type="checkbox"
              checked={isDdaSidebarHidden}
              onChange={handleToggleDdaSidebar}
              className="sr-only"
            />
            <div
              className={`w-8 h-4.5 rounded-full transition-colors relative flex items-center px-0.5 shrink-0 ${
                isDdaSidebarHidden ? 'bg-[#4b2c83]' : 'bg-slate-300'
              }`}
            >
              <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform shadow-xs ${
                isDdaSidebarHidden ? 'translate-x-3.5' : 'translate-x-0'
              }`} />
            </div>
          </label>
          )}

          {/* Toggle 3: Fast Payment (hidden on the hold page in the normal
              sidebar; the payment sidebar shows only this) */}
          {(paymentOnly || !isPaymentHold) && (
          <div className="flex flex-col">
            <div 
              className={`flex items-center justify-between p-1.5 @[220px]:p-2 px-2 @[220px]:px-2.5 transition-colors ${
                !isAutofill 
                  ? 'opacity-40 cursor-not-allowed select-none bg-slate-50/50' 
                  : 'hover:bg-slate-100/50'
              }`}
            >
              <div
                className="flex items-center gap-2 min-w-0 pr-2"
                title={fastPayConfigured ? 'Pays from the hold page with the choice shown below' : 'Not set for this applicant: switching it on asks how to pay'}
              >
                <CreditCard className={`w-3.5 h-3.5 shrink-0 ${!isAutofill ? 'text-slate-400' : 'text-[#4b2c83]'}`} />
                <span className="text-[11.5px] font-bold text-slate-800 truncate">Fast Payment</span>
              </div>

              <label className="cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={isFastPayment}
                  onChange={handleToggleFastPayment}
                  disabled={!isAutofill}
                  className="sr-only"
                />
                <div 
                  className={`w-8 h-4.5 rounded-full transition-colors relative flex items-center px-0.5 shrink-0 ${
                    isFastPayment ? 'bg-[#4b2c83]' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform shadow-xs ${
                    isFastPayment ? 'translate-x-3.5' : 'translate-x-0'
                  }`} />
                </div>
              </label>
            </div>

            {/* This applicant's Fast Payment as one line with a pencil, while the toggle is
                on. Off, only the editor is kept (it opens when switching on with nothing set). */}
            {/* One instance either way, so the editor isn't re-mounted (and re-opened) on toggle */}
            {isAutofill && activeApplicant && (
              <div className={isFastPayment ? 'px-2 pb-2 @[220px]:px-2.5 animate-fade-in' : 'contents'}>
                <SidebarFastPayment applicant={activeApplicant} variant="line" hidden={!isFastPayment} openSignal={fastPayEditorSignal} />
              </div>
            )}
          </div>
          )}

        </div>
      )}
    </div>
  );
}
