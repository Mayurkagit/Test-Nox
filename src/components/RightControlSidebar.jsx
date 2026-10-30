import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Lock, Target, FlaskConical } from 'lucide-react';
import { 
  useApplicantStore, 
  useAuthStore, 
  useSettingsStore, 
  useAutomationStore,
  activeLoginUsers
} from '../store';
import { detectDdaStage, getSidebarMode, DDA_STAGES } from '../utils/ddaRoutes';
import { wsGet, wsSet } from '../utils/storageHelper';
import { findLockedLogin, useLockedLoginPan } from '../utils/loginLock';

// Subcomponents
import SidebarHeader from './sidebar/SidebarHeader';
import SidebarApplicantSelector from './sidebar/SidebarApplicantSelector';
import SidebarPreferencesPanel from './sidebar/SidebarPreferencesPanel';
import SidebarLoginPanel from './sidebar/SidebarLoginPanel';
import SidebarSchemePanel from './sidebar/SidebarSchemePanel';
import SidebarAutomationModes from './sidebar/SidebarAutomationModes';
import SidebarControls from './sidebar/SidebarControls';
import SidebarLogsConsole from './sidebar/SidebarLogsConsole';
import { signOutAllWindows } from '../hooks/useBookingWindowExpiry';

// Applied to the scheme / applicant / preferences cards while Autofill is OFF.
// Previously `opacity-40 grayscale-40`, which made your own locality and target flats unreadable
// at the moment you most want to check them. Inert, not illegible: interaction is still blocked.
const INERT_CARD = 'pointer-events-none select-none opacity-90 saturate-50';

export default function RightControlSidebar({
  activeApplicant: propActiveApplicant,
  applicants: propApplicants,
  onSelectApplicant: propOnSelectApplicant,
  onEditApplicant: propOnEditApplicant,
  user: propUser,
  settings: propSettings,
  onUpdateSettings: propOnUpdateSettings,
  onLogout: propOnLogout,
  onReload,
  onMultiReload,
  onBack,
  onForward,
  onNavigateTo,
  onAutofillLogin,
  onSelectScheme,
  onSelectLocality,
  onManual,
  onDirect,
  onAutofillForm,
  onTestApplicationForm,
  onProceedPayment,
  onSyncCaptchaInput,
  onRefreshCaptcha,
  onSubmitLogin,
  onTimed: propOnTimed,
  onStop: propOnStop,
  isTimedActive: propIsTimedActive,
  side = 'right'
}) {
  const onLeft = side === 'left'; // sidebar on the window's left edge (user menu choice)
  // ─── ZUSTAND STORE HOOKS (WITH FALLBACK TO PROPS) ────────────────────
  const storeUser = useAuthStore((s) => s.user);

  const storeApplicants = useApplicantStore((s) => s.applicants);
  const storeUserOwnedApplicants = useApplicantStore((s) => s.userOwnedApplicants);
  const storeActiveApplicant = useApplicantStore((s) => s.activeApplicant);
  const storeSelectApplicant = useApplicantStore((s) => s.selectApplicant);
  const storeOpenEditModal = useApplicantStore((s) => s.openEditModal);
  const storeSchemes = useApplicantStore((s) => s.schemes);
  const storeActiveScheme = useApplicantStore((s) => s.activeScheme);
  const storeSetActiveScheme = useApplicantStore((s) => s.setActiveScheme);

  const storeSettings = useSettingsStore((s) => s.settings);
  const ddaAccountPan = useAutomationStore((s) => s.ddaAccountPan);
  const storeUpdateSettings = useSettingsStore((s) => s.updateSettings);
  const storeToggleFullAuto = useSettingsStore((s) => s.toggleFullAuto);
  const storeToggleHalfAuto = useSettingsStore((s) => s.toggleHalfAuto);
  const storeToggleCaptchaAutoSolve = useSettingsStore((s) => s.toggleCaptchaAutoSolve);

  const currentUrl = useAutomationStore((s) => s.currentUrl);
  const storeIsTimedActive = useAutomationStore((s) => s.isTimedActive);
  const storeSetTimedActive = useAutomationStore((s) => s.setTimedActive);
  const storeTargetTime = useAutomationStore((s) => s.targetTime);
  const storeSetTargetTime = useAutomationStore((s) => s.setTargetTime);
  const storeRemainingSec = useAutomationStore((s) => s.remainingSec);
  const storeSetRemainingSec = useAutomationStore((s) => s.setRemainingSec);
  const captchaDataUrl = useAutomationStore((s) => s.captchaDataUrl);
  const captchaInputVal = useAutomationStore((s) => s.captchaInputVal);
  const logs = useAutomationStore((s) => s.logs);
  const clearLogs = useAutomationStore((s) => s.clearLogs);
  const isStep2SidebarCollapsed = useAutomationStore((s) => s.isStep2SidebarCollapsed);
  const setIsStep2SidebarCollapsed = useAutomationStore((s) => s.setIsStep2SidebarCollapsed);
  const paymentFlowSince = useAutomationStore((s) => s.paymentFlowSince);

  // Resolved Values
  const user = propUser || storeUser;
  // Signs every window out (one app user), warning first if one is mid-booking
  const onLogout = propOnLogout || (() => { signOutAllWindows(); });

  const applicants = propApplicants || storeApplicants;
  const activeApplicant = propActiveApplicant !== undefined ? propActiveApplicant : storeActiveApplicant;
  const onSelectApplicant = propOnSelectApplicant || storeSelectApplicant;
  const onEditApplicant = propOnEditApplicant || storeOpenEditModal;

  const settings = propSettings || storeSettings;
  const onUpdateSettings = propOnUpdateSettings || storeUpdateSettings;

  const isTimedActive = propIsTimedActive !== undefined ? propIsTimedActive : storeIsTimedActive;
  const onTimedAction = propOnTimed;
  const onStop = propOnStop;
  const targetTime = storeTargetTime;
  const setTargetTime = storeSetTargetTime;
  const remainingSec = storeRemainingSec;
  const setRemainingSec = storeSetRemainingSec;
  const [isApplicantOpen, setIsApplicantOpen] = useState(false);

  // Active DDA Stage Detection & Master Autofill State
  const activeStage = detectDdaStage(currentUrl);
  const isStep2 = activeStage.id === 'FLAT_SELECT';
  const isPaymentHold = activeStage.id === 'PAYMENT_HOLD';
  const isGetLayoutPage = isPaymentHold || Boolean(
    currentUrl?.toLowerCase().includes('getlayout') ||
    currentUrl?.toLowerCase().includes('payment') ||
    currentUrl?.toLowerCase().includes('challan') ||
    currentUrl?.toLowerCase().includes('hold')
  );
  // One sidebar per page (see getSidebarMode): login, schemes, application
  // form and flat select keep their own; the hold page and the gateway / bank
  // pages of that payment share the payment sidebar; anything else gets only
  // Schemes + Reload.
  const sidebarMode = getSidebarMode(currentUrl, paymentFlowSince);
  const isPaymentSidebar = sidebarMode === 'payment';
  const isMinimalSidebar = sidebarMode === 'other';
  const PAYMENT_STAGE = DDA_STAGES.find((s) => s.id === 'PAYMENT_HOLD');
  const isDdaHoldPage = isPaymentSidebar && /eservices\.dda\.org\.in\/user\/getlayout/i.test(currentUrl || '');
  // Only the flat page's sidebar can collapse. The payment sidebar (hold page,
  // gateway and bank pages) always stays open: it holds the timer and FAST PAY.
  const isCollapsible = sidebarMode === 'flatselect';
  const isCollapsed = isCollapsible && isStep2SidebarCollapsed;
  const isAutofill = settings?.automationEnabled !== false;
  const isLoginPage = sidebarMode === 'login';
  const isTwoButtonStage = activeStage.id === 'LOCALITY' || activeStage.id === 'APPLICATION_FORM' || isPaymentHold;

  const isAdmin = Boolean(
    user?.role === 'admin' ||
    user?.isAdmin === true ||
    user?.admin === true ||
    (typeof window !== 'undefined' && (
      localStorage.getItem('dda_is_admin') === 'true' ||
      localStorage.getItem('dda_user_role') === 'admin'
    ))
  );

  // On Login page: Full access to all profiles saved in the app
  // On Pages after login: Normal user sees ALL their own backend-added applicants; Admin sees all
  const postLoginApplicants = React.useMemo(() => {
    if (isAdmin) return applicants;

    // 1. Direct user-owned applicants from store
    if (Array.isArray(storeUserOwnedApplicants) && storeUserOwnedApplicants.length > 0) {
      return storeUserOwnedApplicants;
    }

    // 2. Check local storage for dda_user_applicants or dda_extension_applicants
    try {
      const stored = JSON.parse(localStorage.getItem('dda_user_applicants') || localStorage.getItem('dda_extension_applicants') || '[]');
      if (Array.isArray(stored) && stored.length > 0) return stored;
    } catch (_) {}

    // 3. Filter applicants tagged as user owned
    const userOwned = applicants.filter(a => 
      a.isUserOwned === true || 
      (user?.uid && (a.userId === user.uid || a.createdBy === user.uid || a.assignedTo === user.uid)) ||
      (user?.email && a.userEmail === user.email)
    );
    if (userOwned.length > 0) return userOwned;

    return applicants;
  }, [isAdmin, applicants, storeUserOwnedApplicants, user]);

  const displayedApplicants = isLoginPage ? applicants : postLoginApplicants;
  // After login the applicant follows the DDA account; only an admin's testing switch unlocks it
  const applicantTesting = isAdmin && settings?.allowDifferentApplicant === true;

  const storeLoginUsers = useApplicantStore((s) => s.loginUsers);
  // Archived logins are kept for testing but not offered here.
  const loginProfiles = React.useMemo(() => {
    return Array.isArray(storeLoginUsers) ? activeLoginUsers(storeLoginUsers) : [];
  }, [storeLoginUsers]);

  const [selectedLoginPan, setSelectedLoginPan] = useState(() => {
    return (
      sessionStorage.getItem('dda_last_selected_login_pan') ||
      wsGet('dda_last_selected_login_pan') ||
      ''
    );
  });

  const lockedLoginPan = useLockedLoginPan();
  const loginApplicant = React.useMemo(() => {
    // A locked applicant always wins (archived included)
    if (lockedLoginPan) {
      const locked = findLockedLogin(storeLoginUsers);
      if (locked) return locked;
    }
    if (!loginProfiles || loginProfiles.length === 0) return null;
    const cleanPan = (selectedLoginPan || '').toUpperCase().trim();
    if (cleanPan) {
      const match = loginProfiles.find(
        u => (u.pan || '').toUpperCase().trim() === cleanPan
      );
      if (match) return match;
    }
    // Nothing chosen: no applicant (never silently the first in the list)
    return null;
  }, [loginProfiles, selectedLoginPan, lockedLoginPan, storeLoginUsers]);

  const handleSelectLoginApplicant = (pan) => {
    if (lockedLoginPan) return; // locked: unlock first
    const cleanPan = (pan || '').toUpperCase().trim();
    setSelectedLoginPan(cleanPan);
    try {
      wsSet('dda_last_selected_login_pan', cleanPan);
      wsSet('dda_selected_login_pan', cleanPan);
    } catch (_) {}
    const target = loginProfiles.find(
      u => (u.pan || '').toUpperCase().trim() === cleanPan
    );
    if (target) {
      onAutofillLogin?.(target, true);
    }
  };

  // Ensure initial login profile is autofilled into portal on entering login page
  useEffect(() => {
    if (isLoginPage && loginApplicant) {
      onAutofillLogin?.(loginApplicant, false);
    }
  }, [isLoginPage, loginApplicant?.pan]);

  // Post-login active applicant resolver:
  // Strictly matches authenticated / selected applicant. Zero fallback to dummy profiles.
  const effectiveApplicant = React.useMemo(() => {
    if (isLoginPage) return null;
    if (!activeApplicant || !displayedApplicants || displayedApplicants.length === 0) {
      return null;
    }
    const cleanActivePan = (activeApplicant.pan || activeApplicant.personal?.pan || '').toUpperCase().trim();
    if (!cleanActivePan) return null;

    const found = displayedApplicants.find(
      a => (a.pan || a.personal?.pan || '').toUpperCase().trim() === cleanActivePan
    );
    return found || null;
  }, [isLoginPage, activeApplicant, displayedApplicants]);

  // Alt+M / Alt+T / Alt+S / Alt+G global hotkeys were removed: the control deck is the only
  // way to start or stop a run, so a stray keypress can no longer fire one.

  return (
    <aside 
      className={`h-screen bg-[#f8fafc] flex flex-col shrink-0 z-30 shadow-lg select-none transition-all duration-300 ease-in-out relative font-sans @container ${
        isCollapsed 
          ? `w-0 ${onLeft ? 'border-r-0' : 'border-l-0'} opacity-0 pointer-events-none overflow-hidden`
          : `w-[306px] min-w-[306px] max-w-[306px] ${onLeft ? 'border-r' : 'border-l'} border-slate-200/90 opacity-100 overflow-visible`
      }`}
    >
      {/* Edge Collapse Button for Step 2 & Payment (Enlarged for Easy 1-Click Toggling) */}
      {isCollapsible && !isCollapsed && (
        <button
          type="button"
          onClick={() => setIsStep2SidebarCollapsed(true)}
          title="Collapse Sidebar for Full View"
          className={`absolute ${onLeft ? '-right-4' : '-left-4'} top-18 z-40 w-8.5 h-8.5 rounded-full bg-white border border-slate-200/90 shadow-sm hover:shadow-md text-slate-600 hover:text-[#4b2c83] hover:border-[#4b2c83]/50 flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 group`}
        >
          {onLeft
            ? <ChevronLeft className="w-4.5 h-4.5 text-slate-600 group-hover:text-[#4b2c83] transition-colors" />
            : <ChevronRight className="w-4.5 h-4.5 text-slate-600 group-hover:text-[#4b2c83] transition-colors" />}
        </button>
      )}

      <div className="w-full min-w-0 h-full flex flex-col overflow-hidden">
        {/* 1. TOP HEADER */}
        <SidebarHeader
          user={user}
          onLogout={onLogout}
        />

      {/* 2. SCROLLABLE CONTROL BODY */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1.5 @[220px]:px-2 py-2 space-y-2">
        {isLoginPage ? (
          /* [A] LOGIN PAGE VIEW (Automation modes hidden on login) */
          <div className="w-full space-y-2 pt-0 animate-fade-in">
            <div className="w-full transition-all">
              <SidebarLoginPanel
                applicants={loginProfiles}
                activeApplicant={loginApplicant}
                onSelectApplicant={handleSelectLoginApplicant}
                onEditApplicant={onEditApplicant}
                onAutofillLogin={onAutofillLogin}
                captchaDataUrl={captchaDataUrl}
                captchaInputVal={captchaInputVal}
                onSyncCaptchaInput={onSyncCaptchaInput}
                onRefreshCaptcha={onRefreshCaptcha}
                onSubmitLogin={(app) => onSubmitLogin?.(app || loginApplicant)}
                onReload={onReload}
              />
            </div>
          </div>
        ) : isPaymentSidebar ? (
          /* [P] PAYMENT: Fast Payment settings, held flat + countdown, Schemes + Reload */
          <div className="w-full space-y-2 pt-0 animate-fade-in">
            <SidebarAutomationModes
              settings={settings}
              onUpdateSettings={onUpdateSettings}
              onTestApplicationForm={onTestApplicationForm}
              isAdmin={isAdmin}
              activeApplicant={effectiveApplicant}
              activeStage={PAYMENT_STAGE}
              paymentOnly
            />
            <SidebarSchemePanel
              activeStage={PAYMENT_STAGE}
              activeApplicant={effectiveApplicant}
              user={user}
              schemes={storeSchemes}
              activeScheme={storeActiveScheme}
              onSelectScheme={onSelectScheme || storeSetActiveScheme}
              onManual={onManual}
              onProceedPayment={onProceedPayment}
              showFastPayButton={isDdaHoldPage}
            />
            <SidebarControls
              activeApplicant={effectiveApplicant}
              activeStage={PAYMENT_STAGE}
              isTwoButtonStage={true}
              onNavigateTo={onNavigateTo}
              onReload={onReload}
              isCompact={true}
              isStickyDeck={false}
              isAutofill={isAutofill}
            />
          </div>
        ) : isMinimalSidebar ? (
          /* [O] ANY OTHER PAGE: Schemes + Reload only, placed just above the
             middle (nothing else on this sidebar to sit under) */
          <div className="w-full space-y-2 pt-[30vh] animate-fade-in">
            <SidebarControls
              activeApplicant={effectiveApplicant}
              activeStage={{ id: 'OTHER' }}
              isTwoButtonStage={true}
              onNavigateTo={onNavigateTo}
              onReload={onReload}
              isCompact={true}
              isStickyDeck={false}
              isAutofill={isAutofill}
            />
          </div>
        ) : (
          /* [B] STANDARD STAGES VIEW (schemes, application form, flat select) */
          <div className="w-full space-y-2 pt-0 animate-fade-in">
            {/* Automation Modes Switches */}
            <SidebarAutomationModes
              settings={settings}
              onUpdateSettings={onUpdateSettings}
              onTestApplicationForm={onTestApplicationForm}
              isAdmin={isAdmin}
              activeApplicant={effectiveApplicant}
              activeStage={activeStage}
            />

            {/* Autofill OFF notice. The cards below stay readable and are only made inert — you
                still need to see which scheme, locality and target flats are configured while
                deciding whether to turn Autofill back on. */}
            {!isAutofill && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-200/70 border border-slate-300/80 text-slate-600 select-none">
                <Lock className="w-3 h-3 shrink-0" />
                <span className="text-[10px] font-bold leading-tight">
                  Autofill is OFF — settings below are read-only
                </span>
              </div>
            )}

            {/* Booking target: who this window books for, the scheme and the
                location / target flats, in one card (read-only when Autofill is
                OFF; the scheme row is hidden on the flat page) */}
            {!isGetLayoutPage && (
              <div className={`rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs relative transition-all ${
                isApplicantOpen ? 'z-50 ring-2 ring-[#4b2c83]/40 shadow-md' : 'z-20'
              } ${!isAutofill ? INERT_CARD : ''}`}>
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-t-xl border-b border-slate-100 bg-linear-to-r from-[#faf5ff] to-white">
                  <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-[#4b2c83]" />
                    Booking target
                  </span>
                  {applicantTesting ? (
                    <span className="text-[8.5px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300 flex items-center gap-1">
                      <FlaskConical className="w-2.5 h-2.5" />
                      Testing
                    </span>
                  ) : (
                    <span
                      title="The applicant is the DDA account logged in in this window"
                      className="text-[8.5px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white text-[#4b2c83] border border-[#e9d5ff] flex items-center gap-1"
                    >
                      <Lock className="w-2.5 h-2.5" />
                      Locked
                    </span>
                  )}
                </div>
                <div className="divide-y divide-slate-100">
                  <div className="px-2.5 py-2">
                    <SidebarApplicantSelector
                      variant="section"
                      applicants={displayedApplicants}
                      activeApplicant={effectiveApplicant}
                      onSelectApplicant={onSelectApplicant}
                      onEditApplicant={onEditApplicant}
                      onAutofillLogin={onAutofillLogin}
                      isEmbeddedInCard={false}
                      isOpen={isApplicantOpen}
                      onOpenChange={setIsApplicantOpen}
                      showEyeButton={activeStage?.id === 'SCHEME'}
                      accountPan={ddaAccountPan}
                      isAdmin={isAdmin}
                      allowDifferentApplicant={settings?.allowDifferentApplicant === true}
                      onToggleAllowDifferent={() => storeUpdateSettings({ allowDifferentApplicant: settings?.allowDifferentApplicant !== true })}
                      subline={activeStage?.id !== 'FLAT_SELECT' ? (
                        <SidebarSchemePanel
                          variant="name"
                          activeStage={activeStage}
                          activeApplicant={effectiveApplicant}
                          user={user}
                          schemes={storeSchemes}
                          activeScheme={storeActiveScheme}
                        />
                      ) : null}
                    />
                  </div>
                  {isAdmin && activeStage?.id !== 'FLAT_SELECT' && (
                    <div className="px-2.5 py-2">
                      <SidebarSchemePanel
                        variant="section"
                        activeStage={activeStage}
                        activeApplicant={effectiveApplicant}
                        user={user}
                        schemes={storeSchemes}
                        activeScheme={storeActiveScheme}
                        onSelectScheme={onSelectScheme || storeSetActiveScheme}
                        onManual={onManual}
                        onProceedPayment={onProceedPayment}
                      />
                    </div>
                  )}
                  {effectiveApplicant && (
                    <div className="px-2.5 py-2">
                      <SidebarPreferencesPanel
                        variant="section"
                        activeApplicant={effectiveApplicant}
                        onEditApplicant={onEditApplicant}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action Controls (Immediately below Target Flats for instant 1-click execution) */}
            <div className="transition-all">
              <SidebarControls
                activeApplicant={effectiveApplicant}
                activeStage={activeStage}
                isTwoButtonStage={isTwoButtonStage}
                isTimedActive={isTimedActive}
                targetTime={targetTime}
                setTargetTime={setTargetTime}
                remainingSec={remainingSec}
                setRemainingSec={setRemainingSec}
                onTimedAction={onTimedAction}
                onStop={onStop}
                onManual={onManual}
                onDirect={onDirect}
                onAutofillForm={onAutofillForm}
                onTestApplicationForm={onTestApplicationForm}
                onProceedPayment={onProceedPayment}
                onNavigateTo={onNavigateTo}
                onReload={onReload}
                onMultiReload={onMultiReload}
                storeSetTimedActive={storeSetTimedActive}
                isCompact={true}
                isStickyDeck={false}
                isAutofill={isAutofill}
              />
            </div>
          </div>
        )}
      </div>

      {/* 3. PINNED BOTTOM BLACK TERMINAL / LOGS CONSOLE (HIDDEN ON PAYMENT HOLD) */}
      {!isPaymentHold && !isGetLayoutPage && !isPaymentSidebar && !isMinimalSidebar && (
        <SidebarLogsConsole
          logs={logs}
          activeApplicant={effectiveApplicant}
          clearLogs={clearLogs}
        />
      )}
      </div>
    </aside>
  );
}
