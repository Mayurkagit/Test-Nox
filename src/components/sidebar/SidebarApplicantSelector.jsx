import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, CheckCircle2, X, User, UserPlus, UserCog, Eye, RotateCw, Lock, LockOpen, ShieldCheck, AlertCircle } from 'lucide-react';
import { useConnectionState } from '../../utils/connection';
import { useApplicantStore, useAutomationStore, useAuthStore } from '../../store';
import { detectDdaStage } from '../../utils/ddaRoutes';

export default function SidebarApplicantSelector({
  applicants = [],
  activeApplicant,
  onSelectApplicant,
  onAutofillLogin,
  isEmbeddedInCard = false,
  isOpen: propIsOpen,
  onOpenChange: propOnOpenChange,
  showEyeButton,
  // Login page lock (optional): the dropdown can't be changed while locked
  isLocked = false,
  onToggleLock,
  canLock = false,
  // After login: the DDA account's PAN. The card shows that account's
  // applicant, locked; only an admin's testing switch brings the list back.
  accountPan = '',
  allowDifferentApplicant = false,
  onToggleAllowDifferent,
  isAdmin = false,
  // 'section': drawn inside the sidebar's Booking target card (no card header of its own)
  variant = 'card',
  // 'section', locked: a line under the PAN / DDA account line (the scheme name)
  subline = null,
}) {
  const openAddUserModal = useApplicantStore((state) => state.openAddUserModal);
  const openEditUsersModal = useApplicantStore((state) => state.openEditUsersModal);
  const openDetailsModal = useApplicantStore((state) => state.openDetailsModal);
  const currentUrl = useAutomationStore((state) => state.currentUrl);
  const addLog = useAutomationStore((state) => state.addLog);
  const isSearching = useAutomationStore((state) => state.isSearching);
  const loadApplicants = useApplicantStore((state) => state.loadApplicants);
  const localPrefs = useApplicantStore((state) => state.localPrefs);
  const user = useAuthStore((state) => state.user);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const offline = useConnectionState() === 'offline';
  const refreshBlocked = isRefreshing || isSearching || !user || offline;
  const refreshTitle = offline
    ? 'No internet connection'
    : isSearching ? 'Locked while search is active' : 'Reload applicants from the server';

  // Applicants load once and update when they change in the cloud; this is
  // for pulling the latest on demand.
  const handleRefresh = async (e) => {
    e.stopPropagation();
    if (refreshBlocked) return;
    setIsRefreshing(true);
    addLog?.('USER_ACTION', 'Applicants', 'Refreshing applicants from the server');
    try {
      await loadApplicants(user);
    } finally {
      setIsRefreshing(false);
    }
  };

  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = propIsOpen !== undefined ? propIsOpen : internalIsOpen;
  const setIsOpen = (val) => {
    const nextVal = typeof val === 'function' ? val(isOpen) : val;
    if (propOnOpenChange) propOnOpenChange(nextVal);
    else setInternalIsOpen(nextVal);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  // Close on outside click, webview click, or window blur
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleCloseAll = () => setIsOpen(false);

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('blur', handleCloseAll);
    window.addEventListener('dda-close-popovers', handleCloseAll);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('blur', handleCloseAll);
      window.removeEventListener('dda-close-popovers', handleCloseAll);
    };
  }, []);

  // Auto-focus search input when opening
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setTimeout(() => searchInputRef.current?.focus(), 60);
    }
  }, [isOpen]);

  // After login the applicant is locked to the DDA account; the list shows
  // only for an admin with the testing switch on
  const isLockedView = !isEmbeddedInCard && !(isAdmin && allowDifferentApplicant);
  const panOf = (app) => (app?.pan || app?.personal?.pan || '').toUpperCase().trim();
  const nameOf = (app) => [app?.personal?.firstName, app?.personal?.lastName].filter(Boolean).join(' ') || app?.name || '';
  const accountApplicant = accountPan ? applicants.find((a) => panOf(a) === accountPan) || null : null;
  // Only the logged-in DDA account's own record is shown, never a guess
  const lockedApplicant = accountApplicant;
  const lockedPan = accountPan;
  // The list still loading (app start) is not "missing": say so, don't alarm
  const listLoading = useApplicantStore((state) => state.isLoading);
  const lockedStatus = accountPan
    ? (accountApplicant
      ? { tone: 'ok', text: 'Locked to the DDA account logged in here' }
      : listLoading
        ? { tone: 'wait', text: `DDA is logged in as ${accountPan}. Loading your applicants…` }
        : { tone: 'bad', text: `DDA is logged in as ${accountPan}, which isn't in your applicant list. The app won't fill the form.` })
    : { tone: 'wait', text: "This window's DDA account isn't known yet. It's set at the DDA login, or from DDA's PAN on the application form, before anything is filled." };

  const handleSelect = (app) => {
    if (isLockedView) return;
    const name = [app.personal?.firstName, app.personal?.lastName].filter(Boolean).join(' ') || app.name || app.pan;
    addLog?.('USER_ACTION', 'Applicant', `User selected applicant from dropdown: ${name} (${app.pan})`, app.pan);
    onSelectApplicant?.(app.pan);
    setIsOpen(false);
    onAutofillLogin?.(app);
  };

  const filteredApplicants = applicants.filter((app) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const pan = (app.pan || app.personal?.pan || '').toLowerCase();
    const name = ([app.personal?.firstName, app.personal?.lastName].filter(Boolean).join(' ') || app.name || '').toLowerCase();
    return pan.includes(q) || name.includes(q);
  });
  // A to Z by the name shown in the list (PAN when there is no name).
  const sortName = (app) =>
    ([app.personal?.firstName, app.personal?.lastName].filter(Boolean).join(' ') || app.name || app.pan || '').trim().toUpperCase();
  filteredApplicants.sort((a, b) => sortName(a).localeCompare(sortName(b), 'en', { numeric: true }));

  const activeName = activeApplicant 
    ? ([activeApplicant.personal?.firstName, activeApplicant.personal?.lastName].filter(Boolean).join(' ') || activeApplicant.name || activeApplicant.pan || 'Applicant')
    : 'Select Applicant';

  const activeStage = detectDdaStage(currentUrl);
  const isSchemesStage = !isEmbeddedInCard && (activeStage?.id === 'SCHEME' || (currentUrl && currentUrl.toLowerCase().includes('schemelist')));
  const canShowEyeButton = showEyeButton !== undefined ? Boolean(showEyeButton) : isSchemesStage;

  // A purple border around the applicant for 2.5 s when the login lands on the schemes page
  // (or the account becomes known there), so the operator sees who the window is for
  const [flashApplicant, setFlashApplicant] = useState(false);
  const onSchemesPage = activeStage?.id === 'SCHEME';
  useEffect(() => {
    if (!onSchemesPage || !lockedPan) return undefined;
    setFlashApplicant(true);
    const t = setTimeout(() => setFlashApplicant(false), 2500);
    return () => clearTimeout(t);
  }, [onSchemesPage, lockedPan]);

  // Inside the Booking target card, locked: who the window books for, at a glance
  if (variant === 'section' && isLockedView) {
    const shownName = lockedApplicant ? (nameOf(lockedApplicant) || lockedPan) : (accountPan ? (listLoading ? 'Loading applicants…' : 'Not in your applicant list') : 'No applicant yet');
    const initials = lockedApplicant
      ? (shownName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase()
      : '!';
    const tone = lockedStatus.tone;
    const iconBtn = 'w-7 h-7 rounded-lg border flex items-center justify-center transition-all shrink-0';
    return (
      <div className="space-y-1.5 select-none">
        <div className={`flex items-center gap-2.5 min-w-0 rounded-lg border p-1 -m-1 transition-colors duration-300 ${
          flashApplicant ? 'border-[#4b2c83] bg-[#faf5ff] ring-2 ring-[#4b2c83]/25' : 'border-transparent'
        }`}>
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[12px] font-black tracking-wide shadow-2xs ${
              tone === 'bad' ? 'bg-red-100 text-red-700 border border-red-300'
                : tone === 'wait' ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-[#4b2c83] text-white'
            }`}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1" title={lockedStatus.text}>
            <div className={`text-[12.5px] font-extrabold uppercase truncate leading-tight ${tone === 'bad' ? 'text-red-700' : 'text-slate-900'}`}>
              {shownName}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              {lockedPan && (
                <span className="text-[10px] font-mono font-bold text-[#4b2c83] tracking-wide shrink-0">{lockedPan}</span>
              )}
              {tone === 'ok' && (
                <span className="flex items-center gap-0.5 text-[9.5px] font-bold text-emerald-700 truncate">
                  <ShieldCheck className="w-3 h-3 shrink-0" />
                  DDA account
                </span>
              )}
            </div>
            {subline && <div className="mt-0.5 min-w-0">{subline}</div>}
          </div>
          <button
            type="button"
            disabled={refreshBlocked}
            onClick={handleRefresh}
            title={refreshTitle}
            className={`${iconBtn} ${
              refreshBlocked
                ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                : 'bg-white hover:bg-[#faf5ff] border-slate-200/90 hover:border-[#4b2c83]/50 text-[#4b2c83] cursor-pointer active:scale-95'
            }`}
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          {canShowEyeButton && (
            <button
              type="button"
              disabled={!lockedApplicant}
              onClick={(e) => { e.stopPropagation(); if (lockedApplicant) openDetailsModal(lockedApplicant); }}
              title={lockedApplicant ? `View full details of ${shownName}` : 'No applicant to show'}
              className={`${iconBtn} ${
                lockedApplicant
                  ? 'bg-white hover:bg-[#faf5ff] border-slate-200/90 hover:border-[#4b2c83]/50 text-[#4b2c83] cursor-pointer active:scale-95'
                  : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {tone !== 'ok' && (
          <div className={`flex items-start gap-1 text-[9.5px] font-semibold leading-snug ${tone === 'bad' ? 'text-red-700' : 'text-amber-700'}`}>
            <AlertCircle className="w-3 h-3 shrink-0 mt-px" />
            <span>{lockedStatus.text}</span>
          </div>
        )}
        {isAdmin && onToggleAllowDifferent && (
          <label
            className="flex items-center gap-1.5 text-[9.5px] font-bold text-amber-800 uppercase cursor-pointer w-fit"
            title="Testing only (admins): lets you choose a different applicant than the DDA account. Switches off when the app restarts."
          >
            <input
              type="checkbox"
              checked={allowDifferentApplicant}
              onChange={onToggleAllowDifferent}
              className="w-3 h-3 accent-amber-600 cursor-pointer"
            />
            Testing: allow other applicants
          </label>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 relative ${isOpen ? 'z-50' : 'z-30'} select-none transition-all`}>
      <div className="flex items-center justify-between px-0.5">
        <label className={variant === 'section'
          ? 'text-[9.5px] font-black uppercase tracking-[0.12em] text-slate-500 flex items-center gap-1 min-w-0'
          : 'text-[10.5px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 min-w-0'}>
          <User className={`${variant === 'section' ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-[#4b2c83] shrink-0`} />
          <span className="truncate">{isEmbeddedInCard ? 'Target Profile' : 'Applicant'}</span>
        </label>
        {(isLockedView ? lockedPan : activeApplicant?.pan) && (
          <span className="text-[9px] font-mono font-extrabold text-[#4b2c83] bg-[#faf5ff] px-2 py-0.5 rounded-full border border-[#e9d5ff] uppercase tracking-wider shrink-0">
            {isLockedView ? lockedPan : activeApplicant.pan}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className={`relative ${isOpen ? 'z-50' : 'z-20'}`} ref={dropdownRef}>
          <div className="flex items-center gap-1.5 w-full">
            {isLockedView ? (
              <div
                title={lockedStatus.text}
                className={`flex-1 min-w-0 h-8 flex items-center justify-between px-2.5 border rounded-lg shadow-2xs gap-1.5 cursor-default ${
                  lockedStatus.tone === 'bad' ? 'bg-red-50 border-red-300' : 'bg-[#faf5ff] border-[#4b2c83]/30'
                }`}
              >
                <span className={`text-[11px] font-semibold truncate min-w-0 text-left uppercase ${lockedStatus.tone === 'bad' ? 'text-red-700' : 'text-[#4b2c83]'}`}>
                  {lockedApplicant ? (nameOf(lockedApplicant) || lockedPan) : (accountPan ? (listLoading ? 'Loading applicants…' : 'Not in your applicant list') : 'No applicant')}
                </span>
                <Lock className={`w-3 h-3 shrink-0 ml-auto ${lockedStatus.tone === 'bad' ? 'text-red-600' : 'text-[#4b2c83]'}`} />
              </div>
            ) : (
            <button
              type="button"
              onClick={() => { if (!isLocked) setIsOpen((prev) => !prev); }}
              disabled={isLocked}
              title={isLocked ? 'Locked: unlock to choose another applicant' : undefined}
              className={`flex-1 min-w-0 h-8 flex items-center justify-between px-2.5 border rounded-lg shadow-2xs transition-all gap-1.5 ${
                isLocked
                  ? 'bg-[#faf5ff] border-[#4b2c83]/30 cursor-default'
                  : 'bg-slate-50/70 hover:bg-slate-100/80 border-slate-200/90 hover:border-[#4b2c83]/50 focus:border-[#4b2c83] cursor-pointer'
              }`}
            >
              <span className={`text-[11px] font-semibold truncate min-w-0 text-left uppercase ${isLocked ? 'text-[#4b2c83]' : 'text-slate-800'}`}>
                {activeName}
              </span>
              {isLocked ? (
                <Lock className="w-3 h-3 text-[#4b2c83] shrink-0 ml-auto" />
              ) : (
                <ChevronDown className={`w-3 h-3 text-slate-400 hover:text-[#4b2c83] transition-transform duration-200 shrink-0 ml-auto ${
                  isOpen ? 'rotate-180 text-[#4b2c83]' : ''
                }`} />
              )}
            </button>
            )}

            {onToggleLock && (
              <button
                type="button"
                onClick={onToggleLock}
                disabled={!isLocked && !canLock}
                title={isLocked
                  ? 'Unlock to choose another applicant'
                  : 'Lock this applicant: it stays selected through DDA logouts until you unlock it'}
                className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all shadow-2xs shrink-0 ${
                  isLocked
                    ? 'bg-[#4b2c83] border-[#4b2c83] text-white hover:bg-[#3d236b] cursor-pointer active:scale-95'
                    : canLock
                      ? 'bg-white hover:bg-[#faf5ff] border-slate-200/90 hover:border-[#4b2c83]/50 text-slate-500 hover:text-[#4b2c83] cursor-pointer active:scale-95'
                      : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                }`}
              >
                {isLocked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
              </button>
            )}

            {!isEmbeddedInCard && (
              <button
                type="button"
                disabled={refreshBlocked}
                onClick={handleRefresh}
                title={refreshTitle}
                className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all shadow-2xs shrink-0 ${
                  refreshBlocked
                    ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                    : 'bg-white hover:bg-[#faf5ff] border-slate-200/90 hover:border-[#4b2c83]/50 text-[#4b2c83] cursor-pointer active:scale-95'
                }`}
              >
                <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            )}

            {canShowEyeButton && (
              <button
                type="button"
                disabled={!(isLockedView ? lockedApplicant : activeApplicant)}
                onClick={(e) => {
                  e.stopPropagation();
                  const shown = isLockedView ? lockedApplicant : activeApplicant;
                  if (shown) {
                    openDetailsModal(shown);
                  }
                }}
                title={activeApplicant ? `View full details of ${activeName}` : "Select an applicant to view details"}
                className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all shadow-2xs shrink-0 ${
                  activeApplicant
                    ? 'bg-white hover:bg-[#faf5ff] border-slate-200/90 hover:border-[#4b2c83]/50 text-[#4b2c83] cursor-pointer active:scale-95 group'
                    : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed opacity-50'
                }`}
              >
                <Eye className="w-3.5 h-3.5 transition-transform group-hover:scale-110" />
              </button>
            )}
          </div>

          {/* Dropdown Menu List */}
          {isOpen && !isLockedView && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200/90 rounded-xl shadow-xl z-50 animate-fade-in max-h-64 overflow-hidden flex flex-col">
              {/* Search Bar Header */}
              <div className="p-2 border-b border-slate-100 bg-slate-50/90 shrink-0 space-y-1.5">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="SEARCH USER ID (PAN) OR NAME..."
                    className="w-full h-8 pl-8 pr-7 bg-white border border-slate-200 focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 text-slate-800 text-xs rounded-lg outline-none placeholder:text-slate-400 font-medium uppercase"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      className="absolute right-2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {!isEmbeddedInCard && accountPan && (
                  <div className="px-0.5 text-[9.5px] font-bold text-amber-800 uppercase truncate" title="The DDA account this tab is logged in to">
                    Testing: DDA account is <span className="font-mono">{accountPan}</span>
                  </div>
                )}
              </div>

              {/* Scrollable Profiles List */}
              <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-100 py-0.5 max-h-52">
                {filteredApplicants.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-slate-400 text-center space-y-1">
                    <div className="italic uppercase">No profiles found matching "{searchQuery}"</div>
                  </div>
                ) : (
                  filteredApplicants.map((app) => {
                    const isSelected = (app.pan || app.personal?.pan) === (activeApplicant?.pan || activeApplicant?.personal?.pan);
                    const name = [app.personal?.firstName, app.personal?.lastName].filter(Boolean).join(' ') || app.name || 'Unnamed';
                    return (
                      <button
                        key={app.pan || app.id}
                        type="button"
                        onClick={() => handleSelect(app)}
                        className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors cursor-pointer gap-2 ${
                          isSelected
                            ? 'bg-[#faf5ff] text-[#4b2c83] font-medium'
                            : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        <span className={`text-[12px] truncate min-w-0 uppercase ${isSelected ? 'font-semibold text-slate-900' : 'text-slate-700 font-normal'}`}>
                          {name}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                          {localPrefs?.[(app.pan || '').toUpperCase()]?.preferences && (
                            <span
                              title="Flat preferences changed on this computer"
                              className="text-[8.5px] font-extrabold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-300 uppercase"
                            >
                              Local
                            </span>
                          )}
                          <span className="text-[9px] font-mono font-extrabold text-[#4b2c83] bg-[#faf5ff] px-2 py-0.5 rounded-full border border-[#e9d5ff] uppercase tracking-wider">
                            {app.pan}
                          </span>
                          {isSelected && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#4b2c83] shrink-0" />
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* After login: why the applicant is what it is, and (admins) the testing switch */}
        {!isEmbeddedInCard && (
          <div className="space-y-1 px-0.5">
            {isLockedView && (
              <div className={`text-[9.5px] font-semibold leading-snug ${
                lockedStatus.tone === 'ok' ? 'text-slate-500' : lockedStatus.tone === 'bad' ? 'text-red-700' : 'text-amber-700'
              }`}>
                {lockedStatus.text}
              </div>
            )}
            {isAdmin && onToggleAllowDifferent && (
              <label
                className="flex items-center gap-1.5 text-[9.5px] font-bold text-amber-800 uppercase cursor-pointer w-fit"
                title="Testing only (admins): lets you choose a different applicant than the DDA account. Switches off when the app restarts."
              >
                <input
                  type="checkbox"
                  checked={allowDifferentApplicant}
                  onChange={onToggleAllowDifferent}
                  className="w-3 h-3 accent-amber-600 cursor-pointer"
                />
                Testing: allow other applicants
              </label>
            )}
          </div>
        )}

        {/* 50/50 Action Buttons Row: Add User & Edit Users (Strictly for Login Page) */}
        {isEmbeddedInCard && (
          <div className="grid grid-cols-1 @[210px]:grid-cols-2 gap-1.5 w-full">
            <button
              type="button"
              onClick={() => openAddUserModal()}
              title="Add New User Profile"
              className="w-full h-8 px-2 rounded-lg bg-white hover:bg-purple-50/80 border border-slate-200/90 hover:border-[#4b2c83]/50 text-[#4b2c83] text-[11px] font-extrabold flex items-center justify-center gap-1.5 transition-all shadow-3xs cursor-pointer active:scale-95 group"
            >
              <UserPlus className="w-3.5 h-3.5 text-[#4b2c83] group-hover:scale-110 transition-transform shrink-0" />
              <span className="truncate">Add User</span>
            </button>
            <button
              type="button"
              onClick={() => openEditUsersModal()}
              title="Edit & Manage User Profiles"
              className="w-full h-8 px-2 rounded-lg bg-white hover:bg-purple-50/80 border border-slate-200/90 hover:border-[#4b2c83]/50 text-[#4b2c83] text-[11px] font-extrabold flex items-center justify-center gap-1.5 transition-all shadow-3xs cursor-pointer active:scale-95 group"
            >
              <UserCog className="w-3.5 h-3.5 text-[#4b2c83] group-hover:scale-110 transition-transform shrink-0" />
              <span className="truncate">Edit Users</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
