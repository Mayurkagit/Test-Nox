import React, { useEffect, useRef, useState } from 'react';
import { LogOut, ChevronDown, Plus, PanelLeft, PanelRight, Globe } from 'lucide-react';
import PortalClock from '../PortalClock';
import { useSidebarSide, setSidebarSide } from '../../utils/sidebarSide';

// Sidebar header: the clock on the left, the signed-in app user in the
// right corner. Clicking the user opens a small menu with Sign out, so it is
// no longer a bare button that gets pressed by mistake. The menu also moves the sidebar to the
// other side of this window (each window keeps its own side), and opens the
// web portal in a Northdesk window, signed in with the same account.
export default function SidebarHeader({
  user,
  onLogout
}) {
  const userEmail = user?.email || 'user@dda.gov.in';
  const displayName = user?.displayName || userEmail.split('@')[0];
  const initial = (displayName || '?').trim().charAt(0).toUpperCase();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const sidebarSide = useSidebarSide();
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setIsMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setIsMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [isMenuOpen]);

  const handleNewSession = async () => {
    try {
      if (window.ddaElectronAPI?.createDashboardWindow) {
        await window.ddaElectronAPI.createDashboardWindow();
      } else {
        window.open(window.location.href, '_blank');
      }
    } catch (err) {
      console.error('Failed to open new session window:', err);
    }
  };

  const handleMoveSidebar = () => {
    setIsMenuOpen(false);
    setSidebarSide(sidebarSide === 'left' ? 'right' : 'left');
  };

  const handleOpenPortal = () => {
    setIsMenuOpen(false);
    window.ddaElectronAPI?.openWebPortal?.()?.catch?.(() => {});
  };

  const handleSignOut = () => {
    setIsMenuOpen(false);
    onLogout?.();
  };

  return (
    <div
      style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }}
      className="h-13 px-2 @[220px]:px-3 flex items-center justify-between gap-2 shadow-xs border-b border-purple-900/30 shrink-0 select-none text-white relative z-40"
    >
      <PortalClock onDark />

      <div className="flex items-center gap-1.5 min-w-0">
      <button
        type="button"
        onClick={handleNewSession}
        title="Open a new window"
        className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 border border-white/20 text-white/90 hover:text-white shadow-xs transition-all cursor-pointer active:scale-95 shrink-0"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      <div className="relative min-w-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => setIsMenuOpen((v) => !v)}
          title={userEmail}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          className={`h-8 flex items-center gap-1.5 max-w-full pl-1 pr-2.5 rounded-full border shadow-xs transition-all cursor-pointer active:scale-95 ${
            isMenuOpen ? 'bg-white/20 border-white/40' : 'bg-white/10 hover:bg-white/20 border-white/20'
          }`}
        >
          <span className="w-6 h-6 rounded-full bg-white text-[#4b2c83] text-[11px] font-black flex items-center justify-center shrink-0">
            {initial}
          </span>
          <span className="hidden @[240px]:inline text-xs font-bold text-white truncate min-w-0 max-w-[120px]">
            {displayName}
          </span>
          <ChevronDown className={`w-3 h-3 text-white/70 shrink-0 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
        </button>

        {isMenuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 w-44 bg-white text-slate-800 rounded-xl shadow-xl border border-slate-200/90 overflow-hidden animate-fade-in z-50"
          >
            <div className="px-3 py-3 border-b border-slate-100 flex flex-col items-center text-center gap-1.5">
              <span className="w-8 h-8 rounded-full bg-[#4b2c83] text-white text-[13px] font-black flex items-center justify-center shadow-xs shrink-0">
                {initial}
              </span>
              <div className="min-w-0 w-full">
                <div className="text-xs font-extrabold text-slate-900 truncate">{displayName}</div>
                <div className="text-[10.5px] text-slate-500 truncate" title={userEmail}>{userEmail}</div>
              </div>
            </div>

            <div className="py-1 border-b border-slate-100">
              <button
                type="button"
                role="menuitem"
                onClick={handleOpenPortal}
                title="Opens the web portal (applicants and documents) in a new window, signed in with this account"
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-[#4b2c83] transition-colors cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                Open web portal
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleMoveSidebar}
                title="Moves the sidebar to the other side of this window"
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-[#4b2c83] transition-colors cursor-pointer"
              >
                {sidebarSide === 'left'
                  ? <PanelRight className="w-3.5 h-3.5 shrink-0" />
                  : <PanelLeft className="w-3.5 h-3.5 shrink-0" />}
                {sidebarSide === 'left' ? 'Move sidebar to right' : 'Move sidebar to left'}
              </button>
            </div>

            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
