import React, { useState, useRef, useEffect } from 'react';
import { Home, Rocket, Clock, CreditCard, ChevronDown, CheckCircle2, ShieldCheck, Play, Layers, FileText, Folder, Zap } from 'lucide-react';
import { useAutomationStore } from '../../store';
import { wsGet, wsSet } from '../../utils/storageHelper';

export default function SidebarSchemePanel({
  activeStage,
  activeApplicant,
  user,
  schemes = [],
  activeScheme,
  onSelectScheme,
  onManual,
  onProceedPayment,
  // false on the gateway / bank pages: FAST PAY starts from DDA's hold page.
  showFastPayButton = true,
  // 'section': the target scheme drawn inside the sidebar's Booking target card
  variant = 'card'
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [localScheme, setLocalScheme] = useState(null);
  const dropdownRef = useRef(null);

  // Hoisted to top-level to avoid Rules of Hooks violation (was previously called inside conditional JSX)
  const lastRunLogFileName = useAutomationStore((s) => s.lastRunLogFileName);
  const lastRunLogPath = useAutomationStore((s) => s.lastRunLogPath);
  const reservedFlatDetails = useAutomationStore((s) => s.reservedFlatDetails);

  // Live 1-second ticker for real-time countdown from holdExpiresAt
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Sync state when applicant changes
  useEffect(() => {
    setLocalScheme(null);
  }, [activeApplicant?.pan]);

  // Close dropdown on outside click, webview click, or window blur
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    const handleCloseAll = () => setIsDropdownOpen(false);

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('blur', handleCloseAll);
    window.addEventListener('dda-close-popovers', handleCloseAll);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('blur', handleCloseAll);
      window.removeEventListener('dda-close-popovers', handleCloseAll);
    };
  }, []);

  const isAdmin = Boolean(
    user?.role === 'admin' ||
    user?.isAdmin === true ||
    user?.admin === true ||
    (typeof window !== 'undefined' && (
      localStorage.getItem('dda_is_admin') === 'true' ||
      localStorage.getItem('dda_user_role') === 'admin'
    ))
  );

  const prefs = activeApplicant?.preferences || activeApplicant?.location || {};
  
  // Resolved list of all available schemes (strictly from backend / props / storage)
  const availableSchemes = (() => {
    let list = [];
    if (Array.isArray(schemes) && schemes.length > 0) {
      list.push(...schemes);
    }
    try {
      const stored = JSON.parse(localStorage.getItem('dda_schemes') || '[]');
      if (Array.isArray(stored) && stored.length > 0) list.push(...stored);
    } catch (_) {}
    try {
      const ddaData = JSON.parse(localStorage.getItem('ddaData') || '{}');
      if (Array.isArray(ddaData?.schemes) && ddaData.schemes.length > 0) list.push(...ddaData.schemes);
    } catch (_) {}

    const cleanList = list
      .filter(Boolean)
      .map(s => String(s).trim())
      .filter(s => !s.toLowerCase().includes('admin_bypass') && s.toLowerCase() !== 'admin');

    return Array.from(new Set(cleanList));
  })();

  // Backend active live scheme detection from Worker sent data
  const workerActiveScheme = (() => {
    try {
      const ddaData = JSON.parse(localStorage.getItem('ddaData') || '{}');
      if (ddaData?.targetScheme && !ddaData.targetScheme.toLowerCase().includes('admin_bypass') && ddaData.targetScheme.toLowerCase() !== 'admin') {
        return ddaData.targetScheme.trim();
      }
    } catch (_) {}
    const activeName = wsGet('dda_active_scheme_name');
    if (activeName && !activeName.toLowerCase().includes('admin_bypass') && activeName.toLowerCase() !== 'admin') {
      return activeName.trim();
    }
    const stored = wsGet('dda_target_scheme');
    if (stored && !stored.toLowerCase().includes('admin_bypass') && stored.toLowerCase() !== 'admin') {
      return stored.trim();
    }
    if (activeScheme && !activeScheme.toLowerCase().includes('admin_bypass') && activeScheme.toLowerCase() !== 'admin') {
      return activeScheme.trim();
    }
    if (availableSchemes.length > 0) {
      return availableSchemes[0].trim();
    }
    return '';
  })();

  // Retrieve explicitly chosen stored scheme from localStorage (Admins only)
  const storedChosenScheme = (() => {
    try {
      const s = wsGet('dda_selected_scheme') || wsGet('dda_active_scheme_name') || wsGet('dda_target_scheme');
      if (s && !s.toLowerCase().includes('admin_bypass') && s.toLowerCase() !== 'admin' && s !== '__live_active_scheme__' && s !== '__LIVE__') {
        return s.trim();
      }
    } catch (_) {}
    return null;
  })();

  // Target scheme is strictly locked to worker sent active scheme for normal users
  // Only admins can test and switch schemes
  const currentSchemeName = isAdmin
    ? (localScheme || storedChosenScheme || workerActiveScheme || 'SELECT SCHEME')
    : (workerActiveScheme || 'SELECT SCHEME');

  const rawFlats = prefs.flatNo || prefs.flats || activeApplicant?.flatNo || activeApplicant?.flats || [];
  const flats = Array.isArray(rawFlats) 
    ? rawFlats.map(f => String(f).trim()).filter(Boolean) 
    : (typeof rawFlats === 'string' 
        ? rawFlats.split(',').map(f => f.trim()).filter(Boolean) 
        : (rawFlats ? [String(rawFlats)].filter(Boolean) : []));

  const handleSchemePick = (scheme) => {
    if (!scheme) return;
    setLocalScheme(scheme);
    try {
      wsSet('dda_target_scheme', scheme);
      wsSet('dda_selected_scheme', scheme);
      wsSet('dda_active_scheme_name', scheme);
    } catch (_) {}
    onSelectScheme?.(scheme);
    setIsDropdownOpen(false);
  };

  const [isCollapsed, setIsCollapsed] = useState(false);
  const isSchemeStage = activeStage?.id === 'SCHEME';
  const isFlatSelectStage = activeStage?.id === 'FLAT_SELECT';
  const isPaymentHoldStage = activeStage?.id === 'PAYMENT_HOLD';

  // Do not render on step2_form (FLAT_SELECT)
  if (isFlatSelectStage) {
    return null;
  }

  // Admins pick the scheme to test with
  const schemeDropdown = (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsDropdownOpen((prev) => !prev)}
        className="w-full h-8 flex items-center justify-between px-2.5 bg-slate-50/70 hover:bg-slate-100/80 border border-slate-200/90 hover:border-[#4b2c83]/50 focus:border-[#4b2c83] rounded-lg shadow-2xs cursor-pointer transition-all gap-1.5 text-left"
      >
        <span className={`text-[11px] truncate min-w-0 uppercase ${
          currentSchemeName === 'SELECT SCHEME' ? 'text-slate-400 font-semibold' : 'text-slate-800 font-semibold'
        }`}>
          {currentSchemeName}
        </span>
        <ChevronDown className={`w-3 h-3 text-slate-400 hover:text-[#4b2c83] transition-transform duration-200 shrink-0 ${
          isDropdownOpen ? 'rotate-180 text-[#4b2c83]' : ''
        }`} />
      </button>

      {isDropdownOpen && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200/90 rounded-xl shadow-xl z-50 animate-fade-in max-h-60 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-100 py-0.5 max-h-52">
            {availableSchemes.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-slate-400 font-medium">
                NO SCHEMES CONFIGURED
              </div>
            ) : (
              availableSchemes.map((scheme) => {
                const isSelected = scheme === currentSchemeName;
                return (
                  <button
                    key={scheme}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSchemePick(scheme);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSchemePick(scheme);
                    }}
                    className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors cursor-pointer gap-2 ${
                      isSelected
                        ? 'bg-[#faf5ff] text-[#4b2c83] font-medium'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span className={`text-[12px] truncate min-w-0 uppercase ${isSelected ? 'font-semibold text-slate-900' : 'text-slate-700 font-normal'}`}>
                      {scheme}
                    </span>
                    {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-[#4b2c83] shrink-0 ml-auto" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );

  // Inside the Booking target card, under the applicant's PAN: just the scheme name
  if (variant === 'name' && !isPaymentHoldStage) {
    return (
      <div
        title={currentSchemeName}
        className={`mt-1 px-1.5 py-0.5 rounded-md border text-[10px] font-extrabold uppercase leading-tight tracking-wide line-clamp-2 break-words w-fit max-w-full ${
          currentSchemeName === 'SELECT SCHEME'
            ? 'bg-slate-50 border-slate-200 text-slate-400'
            : 'bg-[#faf5ff] border-[#4b2c83]/30 text-[#4b2c83]'
        }`}
      >
        {currentSchemeName}
      </div>
    );
  }

  // Inside the Booking target card, admins only: the picker to test with another scheme
  if (variant === 'section' && !isPaymentHoldStage) {
    return isAdmin ? <div className="select-none">{schemeDropdown}</div> : null;
  }

  return (
    <div className="w-full space-y-2 pt-0 animate-fade-in select-none">
      {/* ─── 1. TARGET SCHEME CARD (HIDDEN ON STEP2_FORM / FLAT_SELECT AND PAYMENT_HOLD) ─── */}
      {!isPaymentHoldStage && (
        !isAdmin ? (
          <div className="p-2 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs flex items-center justify-between animate-fade-in select-none transition-all">
            <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 shrink-0">
              <Home className="w-3.5 h-3.5 text-[#4b2c83]" />
              <span className="hidden @[210px]:inline">TARGET </span><span>SCHEME</span>
            </span>
            <span 
              title={currentSchemeName}
              className="text-[9.5px] font-mono font-extrabold text-[#4b2c83] bg-[#faf5ff] px-1.5 @[220px]:px-2 py-0.5 rounded-full border border-[#e9d5ff] uppercase tracking-wider truncate max-w-[50%] @[220px]:max-w-[60%]"
            >
              {currentSchemeName}
            </span>
          </div>
        ) : (
          <div className={`p-2 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs space-y-1.5 animate-fade-in relative transition-all ${
            isDropdownOpen ? 'z-50 ring-2 ring-[#4b2c83]/40 shadow-md' : 'z-20'
          }`}>
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 shrink-0">
                <Home className="w-3.5 h-3.5 text-[#4b2c83]" />
                <span className="hidden @[210px]:inline">TARGET </span><span>SCHEME</span>
              </span>
              <span className="text-[9px] font-mono font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-[#faf5ff] text-[#4b2c83] border border-[#e9d5ff] shrink-0 tracking-wider">
                ADMIN
              </span>
            </div>

            {schemeDropdown}
          </div>
        )
      )}

      {/* ─── 2. STAGE: PAYMENT HOLD (FLASHY RESERVED FLAT HERO, LIVE TIMER & FAST PAYMENT) ─── */}
      {isPaymentHoldStage && (() => {
        // 1. Resolve flat number with strict validation (reject English words like 'Mutation')
        const isValidFlatNo = (f) => {
          if (!f || typeof f !== 'string') return false;
          const s = f.trim();
          if (s.length === 0 || s === '—' || s === 'N/A' || s === 'null' || s === 'undefined') return false;
          if (/^(mutation|details|select|property|scheme|allotment|reserved|flat)$/i.test(s)) return false;
          return /^[A-Z0-9\-\/]+$/i.test(s) && /\d/.test(s);
        };

        let displayFlatNo = '';
        if (isValidFlatNo(reservedFlatDetails?.flatNo)) {
          displayFlatNo = reservedFlatDetails.flatNo;
        } else if (isValidFlatNo(sessionStorage.getItem('dda_reserved_flat_no'))) {
          displayFlatNo = sessionStorage.getItem('dda_reserved_flat_no');
        } else if (isValidFlatNo(localStorage.getItem('dda_last_reserved_flat'))) {
          displayFlatNo = localStorage.getItem('dda_last_reserved_flat');
        }

        if (!displayFlatNo) {
          try {
            const cached = JSON.parse(localStorage.getItem('dda_last_selected_flat_details') || '{}');
            if (isValidFlatNo(cached?.flatNo)) displayFlatNo = cached.flatNo;
          } catch (_) {}
        }
        if (!displayFlatNo) {
          const rawFlats = activeApplicant?.preferences?.flatNo || activeApplicant?.preferences?.flats || activeApplicant?.flatNo || [];
          const flatArr = Array.isArray(rawFlats) ? rawFlats : (typeof rawFlats === 'string' ? rawFlats.split(',') : []);
          const candidate = flatArr.map(f => String(f).trim()).find(isValidFlatNo);
          if (candidate) displayFlatNo = candidate;
        }

        // 2. Resolve Applicant Name from getlayout Personal Details section
        let displayApplicantName = reservedFlatDetails?.applicantName || 
          sessionStorage.getItem('dda_reserved_applicant_name') || 
          localStorage.getItem('dda_reserved_applicant_name') || '';
        if (!displayApplicantName) {
          displayApplicantName = activeApplicant?.name || activeApplicant?.personal?.fullName || '';
        }

        // 3. Resolve Property Details in exact order: Block → Pocket → Sector → Locality
        const LOC_LABELS = { '1': 'NARELA', '2': 'ROHINI', '3': 'TODAPUR', '4': 'LOKNAYAKPURAM', '5': 'DWARKA' };
        const resolveLocLabel = (v) => {
          if (!v) return '';
          const s = String(v).trim();
          return LOC_LABELS[s] || s;
        };

        const formatBlock = (b) => {
          if (!b) return '';
          const s = String(b).trim();
          return /^block\b/i.test(s) ? s.toUpperCase() : `BLOCK ${s.toUpperCase()}`;
        };
        const formatPocket = (p) => {
          if (!p) return '';
          const s = String(p).trim();
          return /^pocket\b/i.test(s) ? s.toUpperCase() : `POCKET ${s.toUpperCase()}`;
        };
        const formatSector = (s) => {
          if (!s) return '';
          const str = String(s).trim();
          return /^sector\b/i.test(str) ? str.toUpperCase() : `SECTOR ${str.toUpperCase()}`;
        };

        let locBlock = reservedFlatDetails?.block || activeApplicant?.preferences?.block || '';
        let locPocket = reservedFlatDetails?.pocket || activeApplicant?.preferences?.pocket || '';
        let locSector = reservedFlatDetails?.sector || activeApplicant?.preferences?.sector || '';
        let locLocality = resolveLocLabel(reservedFlatDetails?.locality) || resolveLocLabel(activeApplicant?.preferences?.locality || activeApplicant?.location?.locality) || '';

        const localityParts = [
          formatBlock(locBlock),
          formatPocket(locPocket),
          formatSector(locSector),
          locLocality
        ].filter(Boolean);
        const locationLine = localityParts.join(' • ');

        // 4. Resolve Application Money (value only) from getlayout Property Details
        const formatMoneyValue = (val) => {
          if (!val) return '';
          const s = String(val).trim();
          const numClean = s.replace(/[^0-9.]/g, '');
          if (numClean && !isNaN(Number(numClean)) && Number(numClean) >= 100) {
            const num = Math.round(Number(numClean));
            return '₹' + num.toLocaleString('en-IN');
          }
          return '';
        };

        const rawAppMoney = reservedFlatDetails?.applicationMoney || 
          sessionStorage.getItem('dda_reserved_app_money') || 
          localStorage.getItem('dda_reserved_app_money') || '';
        const appMoneyFormatted = formatMoneyValue(rawAppMoney);

        // 5. Compute live countdown from holdExpiresAt
        // Only DDA's own countdown (sent from the hold page every second when
        // it drifts); stored values may belong to an earlier booking.
        const holdExpiry = reservedFlatDetails?.holdExpiresAt || null;

        let displayTimer = '--:--';
        let timerSec = null;
        if (holdExpiry) {
          const expiryMs = new Date(holdExpiry).getTime();
          if (!isNaN(expiryMs)) {
            const diffSec = Math.max(0, Math.floor((expiryMs - now) / 1000));
            timerSec = diffSec;
            const mins = Math.floor(diffSec / 60);
            const secs = diffSec % 60;
            displayTimer = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
          }
        }

        const isUrgent = timerSec != null && timerSec <= 120;

        return (
          <div className="rounded-2xl relative overflow-hidden select-none animate-fade-in" style={{
            background: 'linear-gradient(135deg, #1e0a3c 0%, #2d1563 30%, #4b2c83 60%, #6b3fa0 100%)',
            boxShadow: '0 8px 32px rgba(75, 44, 131, 0.4), 0 2px 8px rgba(0,0,0,0.2)'
          }}>
            {/* Subtle shimmer overlay */}
            <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
              background: 'linear-gradient(110deg, transparent 25%, rgba(255,255,255,0.15) 50%, transparent 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 3s ease-in-out infinite'
            }} />

            <div className="relative p-3 space-y-2.5">
              {/* Header: Title & Live Countdown */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Clock className="w-3.5 h-3.5 text-amber-300 stroke-[2.5] animate-pulse shrink-0" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-200/90 truncate">Hold Active</span>
                </div>
                <div className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg font-mono font-black text-[12px] tracking-wider whitespace-nowrap ${
                  isUrgent
                    ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/40'
                    : 'bg-white/15 text-white backdrop-blur-sm'
                }`} style={{ minWidth: '58px', textAlign: 'center', justifyContent: 'center' }}>
                  <span className="text-[10px]">⏱</span>
                  <span>{displayTimer}</span>
                </div>
              </div>

              {/* Reserved Flat Number Hero */}
              <div className="p-3 rounded-xl text-center space-y-1.5" style={{
                background: 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.15)'
              }}>
                <span className="text-[8.5px] font-black uppercase tracking-[0.2em] text-amber-300/80 block">
                  Reserved Flat
                </span>
                
                {/* Flat Number */}
                <div className="text-4xl font-black text-white tracking-wide leading-none font-mono drop-shadow-lg" style={{
                  textShadow: '0 0 20px rgba(255,255,255,0.3), 0 2px 4px rgba(0,0,0,0.3)'
                }}>
                  {displayFlatNo || '—'}
                </div>

                {/* for Applicant Name */}
                {displayApplicantName && (
                  <div className="text-[10.5px] font-bold text-amber-200/90 tracking-wide uppercase truncate px-1">
                    for <span className="text-white font-extrabold">{displayApplicantName}</span>
                  </div>
                )}

                {/* Locality Details (Block • Pocket • Sector • Locality) */}
                {locationLine && (
                  <p className="text-[9px] font-medium text-white/60 uppercase leading-relaxed text-center break-words px-1 pt-0.5">
                    {locationLine}
                  </p>
                )}

                {/* Application Money (Value only) */}
                {appMoneyFormatted && (
                  <div className="pt-1">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-black font-mono tracking-wider text-emerald-300 bg-emerald-500/15 border border-emerald-400/25 shadow-sm">
                      {appMoneyFormatted}
                    </span>
                  </div>
                )}
              </div>

              {/* Fast Payment Button */}
              {showFastPayButton && (
              <button
                type="button"
                onClick={onProceedPayment}
                title="Auto-advance through DDA Terms & BillDesk to bank OTP"
                className="w-full h-9 flex items-center justify-center gap-1.5 text-[10px] font-black tracking-wider uppercase rounded-xl text-white shadow-lg active:scale-[0.97] transition-all duration-200 cursor-pointer group hover:brightness-110 hover:shadow-xl hover:scale-[1.02]"
                style={{
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
                  boxShadow: '0 4px 16px rgba(245, 158, 11, 0.4), inset 0 1px 0 rgba(255,255,255,0.2)'
                }}
              >
                <Zap className="w-3.5 h-3.5 text-white fill-white group-hover:scale-115 transition-transform shrink-0 drop-shadow-sm" />
                <span>Fast Payment</span>
              </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
