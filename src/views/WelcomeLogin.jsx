import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store';
import { LogIn, AlertCircle, Mail, Lock, Eye, EyeOff, ShieldCheck, Loader2, Check } from 'lucide-react';

export default function WelcomeLogin({ onLogin: propOnLogin }) {
  const storeLogin = useAuthStore((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    try {
      return localStorage.getItem('dda_remember_me') === 'true';
    } catch (_) { return false; }
  });
  // Seeded from the store so a forced logout (e.g. booking window ended) explains itself
  const [error, setError] = useState(() => useAuthStore.getState().error || '');
  const [loading, setLoading] = useState(false);

  const performLogin = propOnLogin || storeLogin;

  // Load saved credentials if Remember Me was previously enabled
  useEffect(() => {
    try {
      const saved = localStorage.getItem('dda_remembered_credentials');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.email) setEmail(parsed.email);
        if (parsed.password) setPassword(parsed.password);
      }
    } catch (_) {}
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Save credentials BEFORE login call (component unmounts on success)
      if (rememberMe) {
        localStorage.setItem('dda_remember_me', 'true');
        localStorage.setItem('dda_remembered_credentials', JSON.stringify({ email: email.trim(), password }));
      }

      const res = await performLogin(email.trim(), password);
      if (!res?.success) {
        setError(res?.error || 'Invalid credentials. Please try again.');
        // Login failed — remove credentials if they were just saved
        if (rememberMe) {
          try {
            localStorage.removeItem('dda_remember_me');
            localStorage.removeItem('dda_remembered_credentials');
          } catch (_) {}
        }
      } else if (!rememberMe) {
        // Login succeeded but remember me is unchecked — clear any stale credentials
        try {
          localStorage.removeItem('dda_remember_me');
          localStorage.removeItem('dda_remembered_credentials');
        } catch (_) {}
      }
    } catch (err) {
      setError(`Authentication error: ${err.message}`);
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

      {/* ─── ELEVATED LOGIN CARD ──────────────────────────────────────── */}
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
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Welcome Back</h2>
            <p className="text-xs text-slate-500 mt-0.5">Sign in with the credentials provided by Admin</p>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold leading-relaxed animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Email / Username Input with Leading Icon */}
          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600 mb-1.5">
              Email / Username
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3.5 text-slate-400 pointer-events-none flex items-center justify-center">
                <Mail className="w-4 h-4" />
              </div>
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="username"
                className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50/80 border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#4b2c83]/20 focus:border-[#4b2c83] transition-all shadow-xs"
              />
            </div>
          </div>

          {/* Password Input with Leading Lock & Trailing Eye Toggle */}
          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600 mb-1.5">
              Password
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3.5 text-slate-400 pointer-events-none flex items-center justify-center">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50/80 border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#4b2c83]/20 focus:border-[#4b2c83] transition-all shadow-xs"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer p-0.5"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember Me / Save Password Checkbox */}
          <div className="flex items-center justify-between py-0.5">
            <label className="flex items-center gap-2 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                rememberMe 
                  ? 'bg-[#4b2c83] border-[#4b2c83] text-white shadow-xs' 
                  : 'border-slate-300 bg-white group-hover:border-[#4b2c83]/60'
              }`}>
                {rememberMe && <Check className="w-3 h-3 stroke-3" />}
              </div>
              <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 transition-colors">
                Remember me
              </span>
            </label>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }}
            className="w-full h-11 flex items-center justify-center gap-2 text-sm font-extrabold tracking-wide text-white rounded-xl hover:opacity-95 shadow-lg shadow-[#4b2c83]/30 hover:shadow-[#4b2c83]/40 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Sign In to Continue</span>
              </>
            )}
          </button>
        </form>

        {/* Trust & Security Badge */}
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 pt-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Encrypted Session · Desktop Engine</span>
        </div>

      </div>

    </div>
  );
}
