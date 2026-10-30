import React, { useState, useRef, useEffect } from 'react';
import { useApplicantStore } from '../store';
import { X, UserPlus, KeyRound, Lock, Eye, EyeOff, User, Check, Loader2 } from 'lucide-react';

export default function AddUserModal({ onAutofillLogin, onSelectApplicant, onLog }) {
  const isOpen = useApplicantStore((state) => state.isAddUserModalOpen);
  const closeModal = useApplicantStore((state) => state.closeAddUserModal);
  const addUserProfile = useApplicantStore((state) => state.addUserProfile);
  const prefill = useApplicantStore((state) => state.addUserPrefill);

  const [name, setName] = useState('');
  const [pan, setPan] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const panInputRef = useRef(null);

  // Reset & focus on modal open
  useEffect(() => {
    if (isOpen) {
      setName(prefill?.name || '');
      setPan(prefill?.pan || '');
      setPassword('');
      setShowPassword(false);
      setError('');
      setIsSubmitting(false);
      setIsSuccess(false);
      setSuccessMessage('');
      setTimeout(() => panInputRef.current?.focus(), 100);
    }
  }, [isOpen, prefill]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeModal]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    const cleanPan = pan.trim().toUpperCase();
    const cleanPass = password.trim();
    const cleanName = name.trim();

    if (!cleanPan) {
      setError('Please enter a User ID or PAN.');
      panInputRef.current?.focus();
      return;
    }

    if (cleanPan.length < 4) {
      setError('User ID / PAN must be at least 4 characters.');
      panInputRef.current?.focus();
      return;
    }

    if (!cleanPass) {
      setError('Please enter a password.');
      return;
    }

    setError('');

    // Saving takes a millisecond; save and close straight away.
    const newProfile = addUserProfile({
      name: cleanName || cleanPan,
      pan: cleanPan,
      password: cleanPass,
      archived: false
    });

    if (newProfile) {
      // Inform React parent & trigger autofill if on login page
      onAutofillLogin?.(newProfile, true);
      onSelectApplicant?.(cleanPan);
      onLog?.('SUCCESS', 'Profile', `Added & selected profile: ${newProfile.name} (${cleanPan})`, cleanPan);
      closeModal();
    } else {
      setError('Failed to add profile. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/55 animate-fade-in select-none">
      <div 
        className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden transform transition-all font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-linear-to-br from-[#371b69] to-[#63207c] text-white flex items-center justify-center shadow-lg shadow-[#4b2c83]/25 shrink-0">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 tracking-tight leading-snug">
                Add User Profile
              </h3>
              <p className="text-xs text-slate-500 font-medium leading-tight mt-0.5">
                Save credentials for instant portal auto-fill & login
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1.5 rounded-full cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200/80 rounded-xl text-xs font-semibold text-red-600 flex items-center gap-2 animate-fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success / Added Notification */}
          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200/90 rounded-2xl text-xs font-bold text-emerald-800 flex items-center gap-2.5 animate-fade-in shadow-3xs">
              <div className="w-5 h-5 rounded-lg bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <span>{successMessage}</span>
            </div>
          )}

          {/* User ID / PAN Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[#4b2c83]" />
              <span>User ID / PAN <span className="text-red-500">*</span></span>
            </label>
            <div className="relative flex items-center">
              <input
                ref={panInputRef}
                type="text"
                value={pan}
                onChange={(e) => {
                  setPan(e.target.value.toUpperCase());
                  if (error) setError('');
                }}
                placeholder="e.g. ABCDE1234F"
                maxLength={13}
                spellCheck="false"
                autoComplete="off"
                className="w-full h-10 px-3.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#4b2c83] focus:ring-3 focus:ring-[#4b2c83]/15 text-slate-900 font-mono font-bold text-xs rounded-xl outline-none transition-all placeholder:text-slate-400 uppercase"
              />
            </div>
          </div>

          {/* Password Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#4b2c83]" />
              <span>Password <span className="text-red-500">*</span></span>
            </label>
            <div className="relative flex items-center">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder="Enter portal password"
                spellCheck="false"
                autoComplete="new-password"
                className="w-full h-10 pl-3.5 pr-10 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#4b2c83] focus:ring-3 focus:ring-[#4b2c83]/15 text-slate-900 font-medium text-xs rounded-xl outline-none transition-all placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-1 cursor-pointer transition-colors"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Profile Name (Optional) */}
          <div className="space-y-1.5">
            <label className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[#4b2c83]" />
              <span>Profile Name <span className="text-slate-400 text-[10.5px] font-normal normal-case">(Optional)</span></span>
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                spellCheck="false"
                autoComplete="off"
                className="w-full h-10 px-3.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#4b2c83] focus:ring-3 focus:ring-[#4b2c83]/15 text-slate-900 font-semibold text-xs rounded-xl outline-none transition-all placeholder:text-slate-400 capitalize"
              />
            </div>
          </div>

          {/* Action Footer Buttons */}
          <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isSuccess}
              className="px-5 py-2.5 text-xs font-extrabold text-white bg-[#4b2c83] hover:bg-[#3c2269] shadow-md shadow-[#4b2c83]/25 active:scale-95 rounded-xl transition-all flex items-center gap-1.5 enabled:cursor-pointer disabled:opacity-80 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-purple-200" />
                  <span>Adding Profile...</span>
                </>
              ) : isSuccess ? (
                <>
                  <Check className="w-4 h-4 text-emerald-300" />
                  <span>Profile Added!</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Save & Use Profile</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
