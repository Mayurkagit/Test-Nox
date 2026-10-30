import React, { useState } from 'react';
import { useAuthStore } from '../store';
import { signOutAllWindows } from '../hooks/useBookingWindowExpiry';
import { ShieldCheck, ArrowLeft, AlertCircle, Loader2, Key } from 'lucide-react';

export default function KeyVerification({ 
  user: propUser, 
  onVerifyKey: propOnVerifyKey, 
  onLogout: propOnLogout 
}) {
  const storeUser = useAuthStore((state) => state.user);
  const storeVerifyKey = useAuthStore((state) => state.verifyKey);

  const user = propUser || storeUser;
  const verifyKey = propOnVerifyKey || storeVerifyKey;
  // Signs every window out (one app user), warning first if one is mid-booking
  const logout = propOnLogout || (() => { signOutAllWindows(); });

  const [key, setKey] = useState(() => {
    try {
      const saved = localStorage.getItem('dda_booking_key');
      return saved && saved !== 'ADMIN_BYPASS' ? saved : '';
    } catch (_) {
      return '';
    }
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const userName = user?.name || user?.email?.split('@')[0] || 'User';
  const userInitials = userName.slice(0, 2).toUpperCase();
  const isAdmin = Boolean(
    user?.isAdmin ||
    user?.role === 'admin' ||
    (typeof window !== 'undefined' && (
      localStorage.getItem('dda_is_admin') === 'true' ||
      localStorage.getItem('dda_user_role') === 'admin'
    ))
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await verifyKey(key.trim());
      if (!res?.success) {
        setError(res?.error || 'Invalid booking key. Please check again.');
      }
    } catch (err) {
      setError(`Verification error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen w-screen p-6 bg-[#f8fafc] text-slate-900 selection:bg-[#4b2c83] selection:text-white overflow-hidden font-sans">
      
      {/* ─── AMBIENT BACKGROUND GLOW MESH ─────────────────────────────── */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#4b2c83]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-[#63207c]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-150 h-150 bg-[#4b2c83]/5 rounded-full blur-3xl pointer-events-none" />

      {/* ─── ELEVATED VERIFICATION CARD ───────────────────────────────── */}
      <div className="w-full max-w-md p-8 bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-3xl shadow-[0_20px_60px_-15px_rgba(15,23,42,0.1)] space-y-6 relative overflow-hidden animate-fade-in z-10">
        
        {/* Top Accent Gradient Line */}
        <div 
          style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }} 
          className="h-1.5 w-full absolute top-0 left-0" 
        />

        {/* Brand Header */}
        <div className="text-center space-y-2.5 pt-1">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full shadow-xl shadow-[#4b2c83]/30 overflow-hidden">
            <img 
              src="./icon.png" 
              alt="Northdesk Icon" 
              className="w-full h-full object-cover rounded-full hover:scale-105 transition-transform duration-300"
            />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Booking Key Verification</h2>
            <p className="text-xs text-slate-500 mt-0.5">Enter the booking key shared by Admin below</p>
          </div>
        </div>

        {/* Authenticated User Banner */}
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50/90 border border-slate-200 shadow-xs">
          <div 
            style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }} 
            className="flex items-center justify-center w-9 h-9 rounded-full text-white font-extrabold text-xs shrink-0 shadow-sm"
          >
            {userInitials}
          </div>
          <div className="flex-1 min-w-0">
            <span className="block text-xs font-bold text-slate-800 truncate">{userName}</span>
            <span className="block text-[11px] text-slate-500 truncate">{user?.email}</span>
          </div>
          <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded-md border shrink-0 ${
            isAdmin 
              ? 'text-amber-700 bg-amber-50 border-amber-300 shadow-xs' 
              : 'text-[#4b2c83] bg-[#faf5ff] border-[#e9d5ff] shadow-xs'
          }`}>
            {isAdmin ? 'ADMIN' : 'USER'}
          </span>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold leading-relaxed animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Key Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600 mb-1.5">
              Live Booking Session Key
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3.5 text-slate-400 pointer-events-none flex items-center justify-center">
                <Key className="w-4 h-4" />
              </div>
              <input
                type="text"
                required
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="e.g. BOOK_BFAC8C96"
                autoComplete="off"
                className="w-full pl-10 pr-3.5 py-2.5 text-center font-mono text-sm font-extrabold uppercase tracking-wider bg-slate-50/80 border border-slate-300 rounded-xl text-[#4b2c83] outline-none focus:ring-2 focus:ring-[#4b2c83]/20 focus:border-[#4b2c83] transition-all shadow-xs"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }}
            className="w-full h-11 flex items-center justify-center gap-2 text-sm font-extrabold tracking-wide text-white rounded-xl hover:opacity-95 shadow-lg shadow-[#4b2c83]/30 hover:shadow-[#4b2c83]/40 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying Key...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>Verify and Continue</span>
              </>
            )}
          </button>
        </form>

        {/* Logout / Switch Account option */}
        <div className="pt-4 border-t border-slate-200/80 text-center">
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Sign in with a different account</span>
          </button>
        </div>

      </div>

    </div>
  );
}
