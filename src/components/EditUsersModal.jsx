import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useApplicantStore } from '../store';
import { X, UserCog, KeyRound, Lock, Eye, EyeOff, User, Trash2, Plus, Check, Search, AlertCircle, Loader2, Archive, ArchiveRestore } from 'lucide-react';

export default function EditUsersModal({ onAutofillLogin, onSelectApplicant, onLog }) {
  const isOpen = useApplicantStore((state) => state.isEditUsersModalOpen);
  const closeModal = useApplicantStore((state) => state.closeEditUsersModal);
  const updateAllUserProfiles = useApplicantStore((state) => state.updateAllUserProfiles);

  const [profiles, setProfiles] = useState([]);
  const [showPasswords, setShowPasswords] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  // Copy the saved logins once when the modal opens. Background updates to the
  // saved list while it is open must not wipe what is being typed.
  useEffect(() => {
    if (isOpen) {
      const loginUsers = useApplicantStore.getState().loginUsers;
      const list = Array.isArray(loginUsers) ? loginUsers : [];
      const cloned = list.map((u, idx) => ({
        id: u.id || `profile_${idx}_${Date.now()}`,
        name: u.name || u.pan || '',
        pan: (u.pan || '').toUpperCase().trim(),
        password: (u.password || '').trim(),
        archived: Boolean(u.archived),
      }));
      setProfiles(cloned);
      setShowPasswords({});
      setSearchQuery('');
      setError('');
      setIsSaving(false);
      setIsSaved(false);
      setSuccessMessage('');
    }
  }, [isOpen]);

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

  // Stable handlers so a key press redraws only the row being typed in.
  const handleFieldChange = useCallback((index, field, value) => {
    setProfiles((prev) => {
      const copy = [...prev];
      if (copy[index]) {
        copy[index] = {
          ...copy[index],
          [field]: field === 'pan' ? value.toUpperCase() : value
        };
      }
      return copy;
    });
    setError('');
  }, []);

  const handleTogglePassword = useCallback((index) => {
    setShowPasswords((prev) => ({
      ...prev,
      [index]: !prev[index]
    }));
  }, []);

  const handleRemoveProfile = useCallback((index) => {
    const removedPan = profilesRef.current[index]?.pan || `#${index + 1}`;
    setProfiles((prev) => prev.filter((_, i) => i !== index));
    setError('');
    setSuccessMessage(`Profile ${removedPan} removed.`);
  }, []);

  // Archived logins stay saved (for testing) but are left out of the login
  // dropdown at booking time.
  const handleToggleArchive = useCallback((index) => {
    const p = profilesRef.current[index];
    if (!p) return;
    setProfiles((prev) => prev.map((x, i) => (i === index ? { ...x, archived: !x.archived } : x)));
    setError('');
    setSuccessMessage(`${p.name || p.pan || 'Profile'} ${p.archived ? 'restored to the login list' : 'archived'}. Click "Save All Changes" to keep it.`);
  }, []);

  if (!isOpen) return null;

  const handleAddNewRow = () => {
    const nextNum = profiles.length + 1;
    setProfiles((prev) => [
      ...prev,
      {
        id: `new_${Date.now()}_${nextNum}`,
        name: '',
        pan: '',
        password: '',
      }
    ]);
    setSuccessMessage(`Profile #${nextNum} row added. Fill in credentials and click "Save All Changes".`);
  };

  const handleSave = (e) => {
    e?.preventDefault?.();

    // 1. Validation
    const seenPans = new Set();
    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i];
      const cleanPan = (p.pan || '').trim().toUpperCase();
      const cleanPass = (p.password || '').trim();

      if (!cleanPan) {
        setError(`Profile #${i + 1} is missing a User ID / PAN.`);
        return;
      }
      if (cleanPan.length < 4) {
        setError(`Profile #${i + 1} User ID / PAN "${cleanPan}" must be at least 4 characters.`);
        return;
      }
      if (!cleanPass) {
        setError(`Profile #${i + 1} (${cleanPan}) is missing a password.`);
        return;
      }
      if (seenPans.has(cleanPan)) {
        setError(`Duplicate User ID / PAN "${cleanPan}" found at Profile #${i + 1}. Each profile must have a unique User ID.`);
        return;
      }
      seenPans.add(cleanPan);
    }

    setError('');

    // 2. Format simple login credentials array: [{ name, pan, password }]
    const formatted = profiles.map((p) => ({
      name: p.name.trim() || p.pan.trim().toUpperCase(),
      pan: p.pan.trim().toUpperCase(),
      password: p.password.trim(),
      ...(p.archived ? { archived: true } : {}),
    }));

    // Saving takes a millisecond; save and close straight away.
    const updatedList = updateAllUserProfiles(formatted);

    // 3. If currently selected login profile was updated, sync its credentials
    const lastLoginPan = (localStorage.getItem('dda_last_selected_login_pan') || '').toUpperCase().trim();
    const activeList = updatedList.filter(a => !a.archived);
    const updatedActive = activeList.find(a => (a.pan || '').toUpperCase() === lastLoginPan) || activeList[0];
    if (updatedActive) {
      onAutofillLogin?.(updatedActive, true);
      onSelectApplicant?.(updatedActive.pan);
    }

    onLog?.('SUCCESS', 'Profiles', `Updated & saved ${formatted.length} user profiles`, updatedActive?.pan);
    closeModal();
  };

  const filteredIndices = profiles
    .map((p, idx) => ({ ...p, originalIndex: idx }))
    .filter((p) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        p.name.toLowerCase().includes(q) ||
        p.pan.toLowerCase().includes(q)
      );
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/55 animate-fade-in select-none">
      <div 
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col max-h-[85vh] transform transition-all font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-linear-to-br from-[#371b69] to-[#63207c] text-white flex items-center justify-center shadow-lg shadow-[#4b2c83]/25 shrink-0">
              <UserCog className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900 tracking-tight leading-snug">
                  Edit User Profiles
                </h3>
                <span className="text-[10.5px] font-mono font-black text-[#4b2c83] bg-purple-100/70 px-2 py-0.5 rounded-full border border-purple-200">
                  {profiles.length} Users
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium leading-tight mt-0.5">
                Edit Usernames, Passwords, and Names. Changes auto-sync immediately upon saving.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 p-1.5 rounded-full cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter / Search Row & Add Row Action */}
        <div className="px-6 py-2.5 bg-white border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name or User ID / PAN..."
              className="w-full h-8.5 pl-8.5 pr-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#4b2c83] focus:ring-2 focus:ring-[#4b2c83]/15 text-slate-800 text-xs rounded-xl outline-none font-medium placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleAddNewRow}
            className="h-8.5 px-3 rounded-xl bg-purple-50 hover:bg-purple-100/90 text-[#4b2c83] border border-purple-200/80 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 shadow-3xs active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add User</span>
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200/80 rounded-xl text-xs font-semibold text-red-600 flex items-center gap-2 animate-fade-in shrink-0">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Success / Added Notification */}
        {successMessage && (
          <div className="mx-6 mt-3 p-3 bg-emerald-50 border border-emerald-200/90 rounded-2xl text-xs font-bold text-emerald-800 flex items-center gap-2.5 animate-fade-in shadow-3xs shrink-0">
            <div className="w-5 h-5 rounded-lg bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Scrollable Profiles List with Numbering */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-2.5 overscroll-contain">
          {filteredIndices.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 italic space-y-2">
              <div>No user profiles matching "{searchQuery}"</div>
              <button
                type="button"
                onClick={handleAddNewRow}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-[#4b2c83] rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add a new profile now</span>
              </button>
            </div>
          ) : (
            <>
              {filteredIndices.filter((item) => !item.archived).map((item) => (
                <ProfileRow
                  key={item.id || item.originalIndex}
                  item={profiles[item.originalIndex]}
                  idx={item.originalIndex}
                  isPasswordVisible={!!showPasswords[item.originalIndex]}
                  onFieldChange={handleFieldChange}
                  onTogglePassword={handleTogglePassword}
                  onRemove={handleRemoveProfile}
                  onToggleArchive={handleToggleArchive}
                />
              ))}
              {filteredIndices.some((item) => item.archived) && (
                <div className="pt-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <Archive className="w-3.5 h-3.5" />
                  <span>Archived ({filteredIndices.filter((item) => item.archived).length})</span>
                  <span className="normal-case font-medium tracking-normal text-slate-400">not shown in the login list</span>
                </div>
              )}
              {filteredIndices.filter((item) => item.archived).map((item) => (
                <ProfileRow
                  key={item.id || item.originalIndex}
                  item={profiles[item.originalIndex]}
                  idx={item.originalIndex}
                  isPasswordVisible={!!showPasswords[item.originalIndex]}
                  onFieldChange={handleFieldChange}
                  onTogglePassword={handleTogglePassword}
                  onRemove={handleRemoveProfile}
                  onToggleArchive={handleToggleArchive}
                />
              ))}
            </>
          )}

          {/* Quick Add Row Button at bottom */}
          {filteredIndices.length > 0 && (
            <button
              type="button"
              onClick={handleAddNewRow}
              className="w-full py-2 px-3 border border-dashed border-slate-300 hover:border-[#4b2c83]/60 hover:bg-purple-50/50 rounded-2xl text-xs font-bold text-slate-600 hover:text-[#4b2c83] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Another Profile (#{profiles.length + 1})</span>
            </button>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="text-[11.5px] text-slate-500 font-medium">
            <span className="font-bold text-slate-800">{profiles.filter((p) => !p.archived).length}</span> in login list
            {profiles.some((p) => p.archived) && (
              <> · <span className="font-bold text-slate-800">{profiles.filter((p) => p.archived).length}</span> archived</>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isSaved}
              className="px-5 py-2 text-xs font-extrabold text-white bg-[#4b2c83] hover:bg-[#3c2269] shadow-md shadow-[#4b2c83]/25 active:scale-95 rounded-xl transition-all flex items-center gap-1.5 enabled:cursor-pointer disabled:opacity-80 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-200" />
                  <span>Saving Changes...</span>
                </>
              ) : isSaved ? (
                <>
                  <Check className="w-4 h-4 text-emerald-300" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Save All Changes</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// One login row. Redrawn only when its own values change.
const ProfileRow = memo(function ProfileRow({ item, idx, isPasswordVisible, onFieldChange, onTogglePassword, onRemove, onToggleArchive }) {
  return (
    <div
      className={`p-3 rounded-2xl border shadow-xs hover:border-[#4b2c83]/35 transition-all flex flex-col sm:flex-row sm:items-center gap-2.5 relative group ${item.archived ? 'bg-slate-50 border-slate-200/70 opacity-75' : 'bg-white border-slate-200/80'}`}
    >
      {/* Number Badge (1-indexed sequence e.g. #1, #2, #3...) */}
      <div className="flex items-center justify-between sm:justify-start gap-2 shrink-0">
        <div className="w-7 h-7 rounded-xl bg-purple-50 border border-purple-200/80 text-[#4b2c83] font-mono font-black text-xs flex items-center justify-center shrink-0 shadow-3xs">
          #{idx + 1}
        </div>
        <span className="sm:hidden text-xs font-bold text-slate-500">
          Profile #{idx + 1}
        </span>
        <button
          type="button"
          onClick={() => onToggleArchive(idx)}
          title={item.archived ? 'Restore to the login list' : 'Archive (hide from the login list)'}
          className="sm:hidden flex items-center justify-center w-7 h-7 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-800 shadow-3xs transition-all cursor-pointer ml-auto active:scale-90"
        >
          {item.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onRemove(idx)}
          title={`Delete profile #${idx + 1} (${item.pan || 'unnamed'})`}
          className="sm:hidden flex items-center justify-center w-7 h-7 rounded-xl bg-rose-50 hover:bg-rose-100 active:bg-rose-200/80 border border-rose-200/80 text-rose-600 hover:text-rose-700 shadow-3xs transition-all cursor-pointer active:scale-90"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 3 Input Columns: Name, User ID / PAN, Password */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 flex-1 items-center">
        {/* Column 1: Profile Name (4 cols) */}
        <div className="sm:col-span-4 relative flex items-center">
          <User className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={item.name}
            onChange={(e) => onFieldChange(idx, 'name', e.target.value)}
            placeholder="Profile Name"
            className="w-full h-8.5 pl-8 pr-2.5 bg-slate-50/70 border border-slate-200 focus:bg-white focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 text-slate-900 text-xs rounded-xl outline-none font-semibold transition-all placeholder:text-slate-400 capitalize"
          />
        </div>

        {/* Column 2: User ID / PAN (4 cols) */}
        <div className="sm:col-span-4 relative flex items-center">
          <KeyRound className="w-3.5 h-3.5 text-[#4b2c83] absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={item.pan}
            onChange={(e) => onFieldChange(idx, 'pan', e.target.value)}
            placeholder="User ID / PAN *"
            maxLength={13}
            className="w-full h-8.5 pl-8 pr-2.5 bg-slate-50/70 border border-slate-200 focus:bg-white focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 text-slate-900 text-xs rounded-xl outline-none font-mono font-bold uppercase transition-all placeholder:text-slate-400"
          />
        </div>

        {/* Column 3: Password with Eye Toggle (4 cols) */}
        <div className="sm:col-span-4 relative flex items-center">
          <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
          <input
            type={isPasswordVisible ? 'text' : 'password'}
            value={item.password}
            onChange={(e) => onFieldChange(idx, 'password', e.target.value)}
            placeholder="Password *"
            className="w-full h-8.5 pl-8 pr-8 bg-slate-50/70 border border-slate-200 focus:bg-white focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 text-slate-900 text-xs rounded-xl outline-none font-medium transition-all placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={() => onTogglePassword(idx)}
            className="absolute right-2 text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer transition-colors"
            title={isPasswordVisible ? 'Hide password' : 'Show password'}
          >
            {isPasswordVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Desktop Archive / Restore Button */}
      <button
        type="button"
        onClick={() => onToggleArchive(idx)}
        title={item.archived ? 'Restore to the login list' : 'Archive (hide from the login list)'}
        className="hidden sm:flex items-center justify-center w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-800 shadow-3xs transition-all cursor-pointer shrink-0 active:scale-90"
      >
        {item.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
      </button>

      {/* Desktop Delete Action Button */}
      <button
        type="button"
        onClick={() => onRemove(idx)}
        title={`Delete profile #${idx + 1} (${item.pan || 'unnamed'})`}
        className="hidden sm:flex items-center justify-center w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 active:bg-rose-200/80 border border-rose-200/80 text-rose-600 hover:text-rose-700 shadow-3xs transition-all cursor-pointer shrink-0 active:scale-90 group/del"
      >
        <Trash2 className="w-4 h-4 transition-transform group-hover/del:scale-110" />
      </button>
    </div>
  );
});
