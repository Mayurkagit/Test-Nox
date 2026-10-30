import React, { useState } from 'react';
import { flatKey } from '../../utils/flatKey';
import { SlidersHorizontal, Edit3, Plus, X, RotateCcw, MapPin, Hash } from 'lucide-react';
import { useApplicantStore, useAutomationStore } from '../../store';
import { detectDdaStage } from '../../utils/ddaRoutes';

export default function SidebarPreferencesPanel({
  activeApplicant,
  onEditApplicant,
  onSaveFlats,
  // 'section': location and target flats drawn inside the sidebar's Booking target card
  variant = 'card',
}) {
  const setSessionPreferences = useApplicantStore((state) => state.setSessionPreferences);
  const clearSessionOverrides = useApplicantStore((state) => state.clearSessionOverrides);
  const localPrefs = useApplicantStore((state) => state.localPrefs);
  const currentUrl = useAutomationStore((state) => state.currentUrl);
  const flatAvailability = useAutomationStore((state) => state.flatAvailability);
  const isSearching = useAutomationStore((state) => state.isSearching);
  const addLog = useAutomationStore((state) => state.addLog);

  const [flatInput, setFlatInput] = useState('');

  if (!activeApplicant) return null;
  const pan = (activeApplicant?.pan || activeApplicant?.personal?.pan || '').toUpperCase();
  // Flats/locality changed on this computer (not saved to the server)
  const isLocal = Boolean(localPrefs?.[pan]?.preferences);

  const prefs = activeApplicant?.preferences || activeApplicant?.location || {};
  const locMap = {
    "1": "NARELA", "2": "ROHINI", "3": "TODAPUR", "4": "LOKNAYAKPURAM", "5": "DWARKA",
    "NARELA": "NARELA", "ROHINI": "ROHINI", "TODAPUR": "TODAPUR", "LOKNAYAKPURAM": "LOKNAYAKPURAM", "DWARKA": "DWARKA"
  };
  const rawLoc = prefs.locality ? String(prefs.locality).trim().toUpperCase() : "";
  const displayLocality = locMap[rawLoc] || rawLoc || activeApplicant?.locality || 'NARELA';
  const displaySector = prefs.sector || activeApplicant?.sector || '—';
  const displayPocket = prefs.pocket || activeApplicant?.pocket || '—';
  const displayBlock = prefs.block || activeApplicant?.block || '—';
  const displayTower = prefs.tower || activeApplicant?.tower || '—';

  const rawFlats = prefs.flatNo || prefs.flats || activeApplicant?.flatNo || activeApplicant?.flats || [];
  const flats = Array.isArray(rawFlats) 
    ? rawFlats.map(f => String(f).trim()).filter(Boolean)
    : (typeof rawFlats === 'string' 
        ? rawFlats.split(',').map(f => f.trim()).filter(Boolean) 
        : (rawFlats ? [String(rawFlats)].filter(Boolean) : []));

  const activeStage = detectDdaStage(currentUrl);
  const isFlatSelectStage = activeStage?.id === 'FLAT_SELECT' || flatAvailability?.isFlatSelectPage === true;

  const normalizedTargetFlats = flats.map((f) => String(f).trim().toUpperCase()).filter(Boolean);
  const availableFlatsList = (flatAvailability?.availableFlats || []).map((f) => String(f).trim().toUpperCase());
  const availableFlatKeys = availableFlatsList.map(flatKey);
  const hasTargetMatch = normalizedTargetFlats.some((t) => availableFlatKeys.includes(flatKey(t)));

  // The search's own checks are not getting answers (slow line / overloaded DDA). Nothing can be
  // known about availability while that lasts, so say that instead of "unavailable".
  const isPollStalled = Boolean(isFlatSelectStage && isSearching && flatAvailability?.pollStalled);

  const isNoneTargetAvailable = Boolean(
    isFlatSelectStage &&
    normalizedTargetFlats.length > 0 &&
    flatAvailability?.isGridLoaded &&
    !hasTargetMatch &&
    !isPollStalled
  );

  const isSessionRunning = Boolean(isFlatSelectStage && flatAvailability?.sessionRunning);

  const handleUpdateFlats = (updatedFlats) => {
    if (!activeApplicant) return;
    if (onSaveFlats) {
      onSaveFlats(updatedFlats);
    } else {
      setSessionPreferences(pan, { flatNo: updatedFlats });
    }
  };

  const handleRemoveFlat = async (flatToRemove) => {
    addLog?.('USER_ACTION', 'Preferences', `User removed flat #${flatToRemove} from target list`, pan);
    const updatedFlats = flats.filter(f => f !== flatToRemove);
    await handleUpdateFlats(updatedFlats);
  };

  const handleAddFlat = () => {
    const raw = flatInput.trim();
    if (!raw || !activeApplicant) return;

    const items = raw
      .split(/[, ]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    if (items.length === 0) return;

    const currentFlats = [...flats];
    items.forEach((item) => {
      if (!currentFlats.includes(item)) {
        currentFlats.push(item);
      }
    });

    addLog?.('USER_ACTION', 'Preferences', `User added flat(s) [${items.join(', ')}] to target list`, pan);
    handleUpdateFlats(currentFlats);
    setFlatInput('');
  };

  const handleClearFlats = () => {
    setFlatInput('');
    if (flats.length > 0) {
      addLog?.('USER_ACTION', 'Preferences', `User cleared all target flats (previously: [${flats.join(', ')}])`, pan);
      handleUpdateFlats([]);
    }
  };

  // Flat page: a search still running, or none of the target flats on offer
  const alerts = (
    <>
      {/* Punchy & High-Impact Target Flat(s) Unavailable Alert Banner */}
      {isSessionRunning && (
        <div className="relative overflow-hidden px-2.5 py-2 mt-1 rounded-xl bg-linear-to-r from-red-600 via-rose-600 to-rose-700 text-white shadow-md shadow-rose-900/25 border border-rose-400/50 ring-2 ring-rose-500/20 flex items-center gap-2.5 animate-fade-in select-none">
          <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full bg-white/10 blur-md pointer-events-none" />
          <div className="shrink-0 flex items-center pl-0.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-85" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white shadow-[0_0_8px_#ffffff]" />
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] @[220px]:text-[11.5px] font-black uppercase tracking-wider text-white drop-shadow-xs leading-tight truncate">
              Previous session running
            </p>
            <p className="text-[9.5px] @[220px]:text-[10px] text-rose-100 font-medium leading-tight mt-0.5 truncate">
              Wait for session termination
            </p>
          </div>
        </div>
      )}

      {isPollStalled && (
        <div className="relative overflow-hidden px-2.5 py-2 mt-1 rounded-xl bg-linear-to-r from-amber-500 via-amber-600 to-orange-600 text-white shadow-md shadow-amber-900/25 border border-amber-300/50 ring-2 ring-amber-400/20 flex items-center gap-2.5 animate-fade-in select-none">
          <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full bg-white/10 blur-md pointer-events-none" />
          <div className="shrink-0 flex items-center pl-0.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-85" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white shadow-[0_0_8px_#ffffff]" />
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] @[220px]:text-[11.5px] font-black uppercase tracking-wider text-white drop-shadow-xs leading-tight truncate">
              Checks not getting through
            </p>
            <p className="text-[9.5px] @[220px]:text-[10px] text-amber-100 font-medium leading-tight mt-0.5 truncate">
              Still searching - availability unknown
            </p>
          </div>
        </div>
      )}

      {isNoneTargetAvailable && (
        // A calm note, not an alarm: the search carries on
        <div className="px-2.5 py-2 mt-1 rounded-xl bg-rose-100 border border-rose-300 border-l-4 border-l-rose-600 shadow-xs flex items-center gap-2.5 animate-fade-in select-none">
          <span className="shrink-0 h-2.5 w-2.5 rounded-full bg-rose-600" style={{ animation: 'ddaHeartbeat 1.6s ease-in-out infinite' }} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] @[220px]:text-[11.5px] font-black uppercase tracking-wider text-rose-700 leading-tight truncate">
              Target flat(s) unavailable
            </p>
            <button
              type="button"
              disabled={!activeApplicant}
              onClick={() => {
                addLog?.('USER_ACTION', 'Preferences', 'User opened "Add more flats" from the unavailable-flats note', pan);
                onEditApplicant?.(activeApplicant, { saveAndSearch: true });
              }}
              title="Opens the flat number generator; Save & Search saves the flats and starts the search"
              className="mt-0.5 max-w-full text-left text-[9.5px] @[220px]:text-[10px] text-rose-800 font-bold leading-tight truncate underline underline-offset-2 decoration-rose-400 hover:text-rose-950 hover:decoration-rose-700 cursor-pointer"
            >
              Click here to add more flats →
            </button>
          </div>
        </div>
      )}
    </>
  );

  const lockedTitle = isSearching ? 'Locked while search is active' : undefined;
  const iconBtn = 'w-6 h-6 rounded-lg border flex items-center justify-center transition-all shrink-0';
  const offBtn = 'text-slate-400 bg-slate-50 border-slate-200 opacity-40 cursor-not-allowed select-none';

  // Inside the Booking target card: location as labelled cells, then the target flats
  if (variant === 'section') {
    const cells = [
      ['Locality', displayLocality],
      ['Sector', displaySector],
      ['Pocket', displayPocket],
      ['Block', displayBlock],
      ...(displayTower !== '—' ? [['Tower', displayTower]] : []),
    ];
    const extra = [prefs.flatType || activeApplicant?.flatType, prefs.category || activeApplicant?.category].filter(Boolean).join(' • ');
    // Flat chips: 20px rows, 3px apart; column width from the longest flat number
    const FLAT_CHIP_H = 20;
    const FLAT_CHIP_GAP = 3;
    const flatChipChars = Math.min(10, Math.max(2, ...flats.map((f) => String(f).length)));
    return (
      <div className="space-y-2 select-none">
        {/* Location */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9.5px] font-black uppercase tracking-[0.12em] text-slate-500 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-[#4b2c83]" />
              Location
            </span>
            <div className="flex items-center gap-1">
              {isLocal && (
                <>
                  <span
                    title="Changed on this computer, not saved to the server. Replaced automatically if the server's preferences change."
                    className="text-[8.5px] font-extrabold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-300 uppercase"
                  >
                    Local
                  </span>
                  <button
                    type="button"
                    disabled={isSearching}
                    onClick={isSearching ? undefined : () => {
                      addLog?.('USER_ACTION', 'Preferences', 'User reset flat preferences to the server values', pan);
                      clearSessionOverrides(pan);
                    }}
                    title={lockedTitle || "Back to the server's preferences"}
                    className={`${iconBtn} ${isSearching ? offBtn : 'text-amber-700 hover:bg-amber-50 border-slate-200/90 hover:border-amber-300 cursor-pointer active:scale-95'}`}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={isSearching}
                onClick={isSearching ? undefined : () => onEditApplicant?.(activeApplicant)}
                title={lockedTitle || 'Edit locality preferences'}
                className={`${iconBtn} ${isSearching ? offBtn : 'text-[#4b2c83] hover:bg-[#faf5ff] border-slate-200/90 hover:border-[#4b2c83]/50 cursor-pointer active:scale-95'}`}
              >
                <Edit3 className="w-3 h-3" />
              </button>
            </div>
          </div>
          {/* One compact box: locality on top, the rest inline and wrapping; unset parts are left out */}
          <div className="px-2 py-1 rounded-md bg-slate-50 border border-slate-200/80 min-w-0">
            <div title={String(displayLocality)} className="text-[11px] font-black uppercase truncate leading-tight text-slate-800">
              {displayLocality}
            </div>
            {cells.slice(1).filter(([, value]) => value !== '—').length > 0 && (
              <div className="flex flex-wrap gap-x-2 gap-y-0 mt-0.5 leading-tight">
                {cells.slice(1).filter(([, value]) => value !== '—').map(([label, value]) => (
                  <span key={label} title={`${label}: ${value}`} className="text-[10.5px] font-bold uppercase text-slate-700 min-w-0 truncate">
                    {value}
                  </span>
                ))}
              </div>
            )}
            {extra && <p className="text-[9px] text-slate-500 font-medium truncate leading-tight mt-0.5">{extra}</p>}
          </div>
        </div>

        {/* Target flats */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9.5px] font-black uppercase tracking-[0.12em] text-slate-500 flex items-center gap-1">
              <Hash className="w-3 h-3 text-[#4b2c83]" />
              Target flats
            </span>
            <span className="text-[9px] font-mono font-extrabold text-[#4b2c83] bg-[#faf5ff] px-1.5 py-0.5 rounded-full border border-[#e9d5ff]">
              {flats.length} {flats.length === 1 ? 'flat' : 'flats'}
            </span>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); if (!isSearching) handleAddFlat(); }}
            className="flex items-center gap-1"
          >
            <input
              type="text"
              value={flatInput}
              onChange={(e) => setFlatInput(e.target.value)}
              disabled={isSearching}
              placeholder={isSearching ? 'Search running (locked)' : 'Add flat # (e.g. 1804)'}
              className={`flex-1 min-w-0 h-8 px-2.5 border rounded-lg text-xs font-mono font-bold outline-none transition-all ${
                isSearching
                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-slate-50/90 border-slate-200/90 hover:border-slate-300 focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 text-slate-800 placeholder:text-slate-400'
              }`}
            />
            <button
              type="submit"
              disabled={isSearching || !flatInput.trim()}
              title={lockedTitle || 'Add to the target flats'}
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                isSearching || !flatInput.trim()
                  ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                  : 'bg-[#4b2c83] hover:bg-[#3d236b] text-white border border-[#4b2c83] shadow-xs cursor-pointer active:scale-95'
              }`}
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={isSearching ? undefined : handleClearFlats}
              disabled={isSearching || (!flatInput && flats.length === 0)}
              title={lockedTitle || 'Clear the input and all target flats'}
              className={`h-8 px-2 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border shrink-0 transition-all ${
                isSearching || (!flatInput && flats.length === 0)
                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                  : 'text-slate-600 hover:text-rose-600 bg-white hover:bg-rose-50 border-slate-200/90 hover:border-rose-200 cursor-pointer active:scale-95'
              }`}
            >
              Clear
            </button>
          </form>
          {flats.length === 0 ? (
            <span className="block text-[11px] text-slate-400 italic px-0.5">No target flats added</span>
          ) : (
            // A grid of small chips: columns just wide enough for the longest flat
            // number, as many per row as the sidebar's width allows; past about
            // 4½ rows it scrolls (the half row shows there is more)
            <div
              className="grid font-mono text-[10.5px] overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(calc(${flatChipChars}ch + 22px), 1fr))`,
                gridAutoRows: FLAT_CHIP_H,
                gap: FLAT_CHIP_GAP,
                maxHeight: FLAT_CHIP_H * 4.5 + FLAT_CHIP_GAP * 4,
              }}
            >
              {flats.map((flat, idx) => (
                <span
                  key={idx}
                  title={String(flat)}
                  className={`flex items-center justify-between min-w-0 pl-1.5 pr-0.5 font-bold border rounded transition-colors ${
                    isSearching ? 'text-[#4b2c83]/70 bg-slate-100/80 border-slate-200' : 'text-[#4b2c83] bg-purple-50/80 hover:bg-purple-100/80 border-purple-200/80'
                  }`}
                >
                  <span className="truncate">{flat}</span>
                  <button
                    type="button"
                    disabled={isSearching}
                    onClick={(e) => { e.stopPropagation(); if (!isSearching) handleRemoveFlat(flat); }}
                    title={lockedTitle || `Remove flat ${flat}`}
                    className={`w-3 h-3 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      isSearching ? 'text-slate-400 opacity-30 cursor-not-allowed' : 'text-[#7c3aed] hover:text-rose-600 hover:bg-rose-100/80 cursor-pointer'
                    }`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {alerts}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 select-none transition-all">
      {/* Preferences Header Row: Preferences text + Flat Count Badge on left, Edit Pen on right */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
          <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 min-w-0 truncate">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#4b2c83] shrink-0" />
            <span className="truncate">Preferences</span>
          </span>
          {flats.length > 0 && (
            <span className="text-[9px] font-mono font-extrabold text-[#4b2c83] bg-[#faf5ff] px-1.5 @[200px]:px-2 py-0.5 rounded-full border border-[#e9d5ff] shrink-0">
              {flats.length}<span className="hidden @[210px]:inline"> {flats.length === 1 ? 'Flat' : 'Flats'}</span>
            </span>
          )}
          {isLocal && (
            <span
              title="Changed on this computer, not saved to the server. Replaced automatically if the server's preferences change."
              className="text-[8.5px] font-extrabold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-300 uppercase shrink-0"
            >
              Local
            </span>
          )}
        </div>
        {isLocal && (
          <button
            type="button"
            disabled={isSearching}
            onClick={isSearching ? undefined : () => {
              addLog?.('USER_ACTION', 'Preferences', 'User reset flat preferences to the server values', pan);
              clearSessionOverrides(pan);
            }}
            title={isSearching ? "Locked while search is active" : "Back to the server's preferences"}
            className={`w-6 h-6 mr-1 rounded-lg border flex items-center justify-center transition-all shrink-0 ${
              isSearching
                ? 'text-slate-400 bg-slate-50 border-slate-200 opacity-40 cursor-not-allowed select-none'
                : 'text-amber-700 hover:bg-amber-50 border-slate-200/90 hover:border-amber-300 cursor-pointer shadow-3xs active:scale-95'
            }`}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          disabled={isSearching}
          onClick={isSearching ? undefined : () => onEditApplicant?.(activeApplicant)}
          title={isSearching ? "Locked while search is active" : "Edit Locality Preferences"}
          className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-all shrink-0 ${
            isSearching
              ? 'text-slate-400 bg-slate-50 border-slate-200 opacity-40 cursor-not-allowed select-none'
              : 'text-[#4b2c83] hover:text-[#381e64] hover:bg-[#faf5ff] border-slate-200/90 hover:border-[#4b2c83]/50 cursor-pointer shadow-3xs active:scale-95 group'
          }`}
        >
          <Edit3 className="w-3 h-3 transition-transform group-hover:scale-110" />
        </button>
      </div>

      {/* Locality & Full Address details line under Preferences */}
      <div className="p-2 rounded-lg bg-slate-50/90 border border-slate-200/80 space-y-0.5">
        <p className="font-bold text-slate-800 text-[11px] @[220px]:text-xs leading-snug break-words">
          {[
            displayLocality,
            displaySector !== '—' ? displaySector : null,
            displayPocket !== '—' ? displayPocket : null,
            displayBlock !== '—' ? displayBlock : null,
            displayTower !== '—' ? displayTower : null,
          ].filter(Boolean).join(', ') || 'No Locality/Sector specified'}
        </p>
        {(prefs.category || prefs.flatType || activeApplicant?.category || activeApplicant?.flatType) && (
          <p className="text-[9px] @[220px]:text-[10px] text-slate-500 font-medium truncate">
            {[prefs.flatType || activeApplicant?.flatType, prefs.category || activeApplicant?.category].filter(Boolean).join(' • ')}
          </p>
        )}
      </div>

      {/* Inline Flat Number Quick-Add Bar: Full Width Input with Half-Half Buttons Underneath */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isSearching) handleAddFlat();
        }}
        className="flex flex-col gap-1.5 pt-0.5"
      >
        <div className="relative w-full">
          <input
            type="text"
            value={flatInput}
            onChange={(e) => setFlatInput(e.target.value)}
            disabled={isSearching}
            placeholder={isSearching ? "Search in progress (locked)..." : "Add flat # (e.g. 1804)"}
            className={`w-full h-8.5 px-3 border rounded-lg text-xs font-mono font-bold outline-none transition-all shadow-2xs ${
              isSearching
                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed select-none'
                : 'bg-slate-50/90 border-slate-200/90 hover:border-slate-300 focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 text-slate-800 placeholder:text-slate-400'
            }`}
          />
        </div>

        <div className="grid grid-cols-2 gap-1.5 w-full">
          <button
            type="submit"
            disabled={isSearching || !flatInput.trim()}
            title={isSearching ? "Locked while search is active" : "Add Flat to Queue"}
            className={`w-full h-8 flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-extrabold uppercase tracking-wider transition-all ${
              isSearching || !flatInput.trim()
                ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed select-none shadow-none'
                : 'bg-[#4b2c83] hover:bg-[#3d236b] text-white border border-[#4b2c83] shadow-xs cursor-pointer active:scale-95'
            }`}
          >
            <Plus className={`w-3.5 h-3.5 stroke-2 ${isSearching || !flatInput.trim() ? 'text-slate-400' : 'text-white'}`} />
            <span>Add</span>
          </button>

          <button
            type="button"
            onClick={isSearching ? undefined : handleClearFlats}
            disabled={isSearching || (!flatInput && flats.length === 0)}
            title={isSearching ? "Locked while search is active" : "Clear input and all target flat badges"}
            className={`w-full h-8 flex items-center justify-center rounded-lg text-[11px] font-extrabold uppercase tracking-wider border transition-all ${
              isSearching || (!flatInput && flats.length === 0)
                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed select-none shadow-none'
                : 'text-slate-600 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border-slate-200/90 hover:border-rose-200 shadow-2xs cursor-pointer active:scale-95'
            }`}
          >
            <span className="truncate">Clear<span className="hidden @[200px]:inline"> All</span></span>
          </button>
        </div>
      </form>

      {/* Interactive Priority Flat Chips */}
      <div className="flex flex-wrap content-start gap-1 pt-0.5 max-h-[132px] overflow-y-auto overscroll-contain pr-0.5">
        {flats.length === 0 ? (
          <span className="text-[11px] text-slate-400 italic">No target flats added</span>
        ) : (
          flats.map((flat, idx) => (
            <span
              key={idx}
              className={`group inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 text-[11px] font-mono font-bold border rounded-md shadow-3xs transition-all shrink-0 ${
                isSearching
                  ? 'text-[#4b2c83]/70 bg-slate-100/80 border-slate-200'
                  : 'text-[#4b2c83] bg-purple-50/80 hover:bg-purple-100/80 border-purple-200/80'
              }`}
            >
              <span>{flat}</span>
              <button
                type="button"
                disabled={isSearching}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isSearching) handleRemoveFlat(flat);
                }}
                title={isSearching ? "Locked while search is active" : `Remove Flat ${flat}`}
                className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-colors ${
                  isSearching
                    ? 'text-slate-400 opacity-30 cursor-not-allowed select-none'
                    : 'text-[#7c3aed] hover:text-rose-600 hover:bg-rose-100/80 cursor-pointer'
                }`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))
        )}
      </div>

      {alerts}
    </div>
  );
}
