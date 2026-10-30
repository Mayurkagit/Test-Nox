import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApplicantStore, useAuthStore } from '../store';
import { X, Save, Building, MapPin, Hash, ChevronDown, Sparkles, Plus, Trash2 } from 'lucide-react';

const LOCALITY_OPTIONS = [
  { value: "1", label: "NARELA" },
  { value: "2", label: "ROHINI" },
  { value: "3", label: "TODAPUR" },
  { value: "4", label: "LOKNAYAKPURAM" },
  { value: "5", label: "DWARKA" },
];

const POCKET_OPTIONS = Array.from({ length: 15 }, (_, i) => `POCKET ${i + 1}`);
const BLOCK_OPTIONS = Array.from({ length: 26 }, (_, i) => `BLOCK ${String.fromCharCode(65 + i)}`);
const TOWER_OPTIONS = Array.from({ length: 26 }, (_, i) => `TOWER ${String.fromCharCode(65 + i)}`);

const getSectorOptions = (locality) => {
  const locStr = String(locality || "").trim();
  if (locStr === "1" || locStr.toUpperCase() === "NARELA") {
    return [
      { value: "SECTOR A1 TO A4", label: "SECTOR A1 TO A4" },
      { value: "SECTOR G-7 & G-8", label: "SECTOR G-7 & G-8" },
      { value: "SECTOR G-2 & G-6", label: "SECTOR G-2 & G-6" },
    ];
  }
  return [
    { value: "SECTOR A1 TO A4", label: "SECTOR A1 TO A4" },
    { value: "SECTOR B1 TO B4", label: "SECTOR B1 TO B4" },
    { value: "SECTOR C1 TO C4", label: "SECTOR C1 TO C4" },
  ];
};

export default function ApplicantModal({ 
  isOpen: propIsOpen, 
  applicant: propApplicant, 
  onClose: propOnClose, 
  onSave: propOnSave 
}) {
  const storeIsOpen = useApplicantStore((state) => state.isModalOpen);
  const storeApplicant = useApplicantStore((state) => state.editingApplicant || state.activeApplicant);
  const storeCloseModal = useApplicantStore((state) => state.closeModal);
  const storeSetSessionPreferences = useApplicantStore((state) => state.setSessionPreferences);
  const storeUser = useAuthStore((state) => state.user);
  // Opened from the flat page's "Add more flats": save, then start the search
  const storeSaveAndSearch = useApplicantStore((state) => state.modalSaveAndSearch);
  const saveAndSearch = propIsOpen === undefined && storeSaveAndSearch;
  const generatorRef = useRef(null);

  const isOpen = propIsOpen !== undefined ? propIsOpen : storeIsOpen;
  const applicant = propApplicant !== undefined ? propApplicant : storeApplicant;
  const onClose = propOnClose || storeCloseModal;
  const onSave = propOnSave || ((data) => storeSetSessionPreferences(data.pan || data.personal?.pan, data.preferences));

  const [formData, setFormData] = useState({
    locality: "1",
    sector: "SECTOR A1 TO A4",
    pocket: "POCKET 1",
    block: "BLOCK A",
    tower: "TOWER A",
    flats: ""
  });

  // Flat Number Generator Controls & State
  const [genMode, setGenMode] = useState('tower'); // 'tower' | 'vertical'
  
  // Tower Matrix Mode States
  const [genFloorFrom, setGenFloorFrom] = useState(1);
  const [genFloorTo, setGenFloorTo] = useState(12);
  const [genUnitsPerFloor, setGenUnitsPerFloor] = useState(50);
  const [genParity, setGenParity] = useState('ALL'); // 'ALL' | 'ODD' | 'EVEN'

  // Vertical Stack Mode States
  const [genVertBaseFlat, setGenVertBaseFlat] = useState('102');
  const [genVertFloorFrom, setGenVertFloorFrom] = useState(1);
  const [genVertFloorTo, setGenVertFloorTo] = useState(18);

  const flatInputRef = useRef(null);

  const handleInputFocus = (e) => {
    const input = e.target;
    const len = input.value.length;
    requestAnimationFrame(() => {
      input.setSelectionRange(len, len);
      input.scrollLeft = input.scrollWidth;
    });
  };

  const handleInputClick = (e) => {
    const input = e.target;
    if (input.selectionStart === input.selectionEnd) {
      const len = input.value.length;
      requestAnimationFrame(() => {
        input.setSelectionRange(len, len);
        input.scrollLeft = input.scrollWidth;
      });
    }
  };

  const previewCount = useMemo(() => {
    let count = 0;
    if (genMode === 'tower') {
      const fromFloor = Math.max(0, parseInt(genFloorFrom, 10) || 0);
      const toFloor = Math.max(fromFloor, parseInt(genFloorTo, 10) || 0);
      const units = Math.max(1, parseInt(genUnitsPerFloor, 10) || 1);
      for (let f = fromFloor; f <= toFloor; f++) {
        for (let u = 1; u <= units; u++) {
          if (genParity === 'ODD' && u % 2 === 0) continue;
          if (genParity === 'EVEN' && u % 2 !== 0) continue;
          count++;
        }
      }
    } else {
      // Vertical Stack Mode
      const fromFloor = Math.max(0, parseInt(genVertFloorFrom, 10) || 0);
      const toFloor = Math.max(fromFloor, parseInt(genVertFloorTo, 10) || 0);
      const rawUnits = String(genVertBaseFlat || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const n = parseInt(s, 10);
          if (isNaN(n) || n < 0) return null;
          return n >= 100 ? (n % 100) : n;
        })
        .filter((u) => u !== null);

      const uniqueUnits = Array.from(new Set(rawUnits));
      if (uniqueUnits.length === 0) return 0;
      count = (toFloor - fromFloor + 1) * uniqueUnits.length;
    }
    return count;
  }, [genMode, genFloorFrom, genFloorTo, genUnitsPerFloor, genParity, genVertBaseFlat, genVertFloorFrom, genVertFloorTo]);

  const handleGenerateFlats = (action = 'append') => {
    let generated = [];
    if (genMode === 'tower') {
      const fromFloor = Math.max(0, parseInt(genFloorFrom, 10) || 0);
      const toFloor = Math.max(fromFloor, parseInt(genFloorTo, 10) || 0);
      const units = Math.max(1, parseInt(genUnitsPerFloor, 10) || 1);
      for (let f = fromFloor; f <= toFloor; f++) {
        for (let u = 1; u <= units; u++) {
          if (genParity === 'ODD' && u % 2 === 0) continue;
          if (genParity === 'EVEN' && u % 2 !== 0) continue;
          const flatNum = f * 100 + u;
          generated.push(String(flatNum));
        }
      }
    } else {
      // Vertical Stack Mode
      const fromFloor = Math.max(0, parseInt(genVertFloorFrom, 10) || 0);
      const toFloor = Math.max(fromFloor, parseInt(genVertFloorTo, 10) || 0);
      const rawUnits = String(genVertBaseFlat || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const n = parseInt(s, 10);
          if (isNaN(n) || n < 0) return null;
          return n >= 100 ? (n % 100) : n;
        })
        .filter((u) => u !== null);

      const uniqueUnits = Array.from(new Set(rawUnits));
      if (uniqueUnits.length === 0) return;

      for (let f = fromFloor; f <= toFloor; f++) {
        for (const u of uniqueUnits) {
          const flatNum = f === 0 ? String(u).padStart(2, '0') : String(f * 100 + u);
          generated.push(flatNum);
        }
      }
    }

    if (generated.length === 0) return;

    if (action === 'append') {
      const currentList = formData.flats
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const merged = [...currentList];
      generated.forEach((item) => {
        if (!merged.includes(item)) merged.push(item);
      });
      setFormData((prev) => ({ ...prev, flats: merged.join(', ') }));
    } else {
      setFormData((prev) => ({ ...prev, flats: generated.join(', ') }));
    }
  };

  useEffect(() => {
    if (applicant) {
      const prefs = applicant.preferences || applicant.location || {};
      const rawFlats = prefs.flatNo || prefs.flats || applicant.flatNo || applicant.flats || [];
      const flatsStr = Array.isArray(rawFlats) ? rawFlats.join(', ') : (rawFlats || '');
      
      // Match locality value ("1", "2", "3", "4", "5" or text)
      let matchedLoc = String(prefs.locality || "1").trim();
      const foundByLabel = LOCALITY_OPTIONS.find(l => l.label.toUpperCase() === matchedLoc.toUpperCase());
      if (foundByLabel) matchedLoc = foundByLabel.value;

      const sectorOpts = getSectorOptions(matchedLoc);
      const defaultSector = sectorOpts[0]?.value || "SECTOR A1 TO A4";

      setFormData({
        locality: matchedLoc || "1",
        sector: prefs.sector || defaultSector,
        pocket: prefs.pocket || "POCKET 1",
        block: prefs.block || "BLOCK A",
        tower: prefs.tower || "TOWER A",
        flats: flatsStr
      });
    }
  }, [applicant, isOpen]);

  // "Add more flats" opens straight onto the generator
  useEffect(() => {
    if (!isOpen || !saveAndSearch) return undefined;
    const t = setTimeout(() => generatorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
    return () => clearTimeout(t);
  }, [isOpen, saveAndSearch]);

  const currentSectorOptions = useMemo(() => {
    return getSectorOptions(formData.locality);
  }, [formData.locality]);

  if (!isOpen || !applicant) return null;

  const parsedFlats = formData.flats
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const handleLocalityChange = (newLoc) => {
    const newSectors = getSectorOptions(newLoc);
    setFormData((prev) => ({
      ...prev,
      locality: newLoc,
      sector: newSectors[0]?.value || "SECTOR A1 TO A4"
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const selectedLocObj = LOCALITY_OPTIONS.find(l => l.value === formData.locality);
    const locLabel = selectedLocObj ? selectedLocObj.label : formData.locality;

    const updatedPreferences = {
      ...(applicant.preferences || {}),
      locality: formData.locality, // stored as ID/value matching backend
      localityName: locLabel,
      sector: formData.sector,
      pocket: formData.pocket,
      block: formData.block,
      tower: formData.tower,
      flatNo: parsedFlats
    };

    const updatedApplicant = {
      ...applicant,
      preferences: updatedPreferences
    };

    onSave(updatedApplicant);
    onClose();
    // After the sidebar has the new flats: SidebarControls starts (or restarts) the search
    if (saveAndSearch) {
      setTimeout(() => window.dispatchEvent(new CustomEvent('dda:save-and-search', { detail: { pan: applicantPan, at: Date.now() } })), 150);
    }
  };

  const applicantName = [applicant?.personal?.firstName, applicant?.personal?.lastName].filter(Boolean).join(' ') || applicant?.name || 'Applicant';
  const applicantPan = applicant?.pan || applicant?.personal?.pan || 'NO-PAN';
  const currentLocObj = LOCALITY_OPTIONS.find(l => l.value === formData.locality);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in font-sans select-none">
      <div className="w-full max-w-xl overflow-hidden bg-white backdrop-blur-xl border border-slate-200/90 rounded-3xl shadow-[0_25px_70px_rgba(15,23,42,0.2)] text-slate-900 transition-colors duration-200 relative">
        
        {/* Header Ribbon */}
        <div 
          style={{ 
            background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)',
            boxShadow: '0 2px 10px rgba(75, 44, 131, 0.2)'
          }}
          className="flex items-center justify-between px-6 py-4 text-white"
        >
          <div className="flex items-center gap-3">
            <div 
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.3)'
              }}
              className="flex items-center justify-center w-10 h-10 rounded-xl text-white shadow-xs shrink-0"
            >
              <Building className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold tracking-tight text-white leading-tight">
                  Target Location & Flats
                </h3>
                <span 
                  style={{
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.35)',
                  }}
                  className="text-[10.5px] font-mono font-extrabold text-white px-2 py-0.5 rounded-md tracking-wider"
                >
                  {applicantPan}
                </span>
              </div>
              <p className="text-[11.5px] text-purple-100/90 font-medium mt-0.5">
                Configure dropdown preferences for <strong className="text-white font-bold">{applicantName}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.18)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
            }}
            className="w-8 h-8 rounded-lg text-white hover:bg-white/30 flex items-center justify-center transition-all cursor-pointer shadow-xs active:scale-95"
            title="Close"
          >
            <X className="w-4.5 h-4.5 text-white" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-3.5 max-h-[75vh] overflow-y-auto">
            
            {/* ROW 1: Locality, Sector, Pocket (3 Columns in same row) */}
            <div className="grid grid-cols-3 gap-2.5">
              {/* Locality */}
              <div>
                <label className="flex items-center gap-1 text-[11px] font-bold text-slate-700 mb-1">
                  <MapPin className="w-3.5 h-3.5 text-[#4b2c83] shrink-0" />
                  <span className="truncate">Locality *</span>
                </label>
                <div className="relative">
                  <select
                    required
                    value={formData.locality}
                    onChange={(e) => handleLocalityChange(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-bold bg-slate-50/90 border border-slate-300 hover:border-[#4b2c83]/50 focus:border-[#4b2c83] rounded-xl text-slate-900 outline-none focus:ring-2 focus:ring-[#4b2c83]/20 transition-all shadow-xs appearance-none cursor-pointer pr-7"
                  >
                    {LOCALITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="font-bold py-1">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Sector */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 truncate">Sector *</label>
                <div className="relative">
                  <select
                    value={formData.sector}
                    onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                    className="w-full px-2.5 py-2 text-xs font-semibold bg-slate-50/90 border border-slate-300 hover:border-[#4b2c83]/50 focus:border-[#4b2c83] rounded-xl text-slate-900 outline-none focus:ring-2 focus:ring-[#4b2c83]/20 transition-all shadow-xs appearance-none cursor-pointer pr-7"
                  >
                    {currentSectorOptions.map((sec) => (
                      <option key={sec.value} value={sec.value}>
                        {sec.label}
                      </option>
                    ))}
                    {!currentSectorOptions.some(s => s.value === formData.sector) && formData.sector && (
                      <option value={formData.sector}>{formData.sector}</option>
                    )}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Pocket */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 truncate">Pocket *</label>
                <div className="relative">
                  <select
                    value={formData.pocket}
                    onChange={(e) => setFormData({ ...formData, pocket: e.target.value })}
                    className="w-full px-2.5 py-2 text-xs font-semibold bg-slate-50/90 border border-slate-300 hover:border-[#4b2c83]/50 focus:border-[#4b2c83] rounded-xl text-slate-900 outline-none focus:ring-2 focus:ring-[#4b2c83]/20 transition-all shadow-xs appearance-none cursor-pointer pr-7"
                  >
                    {POCKET_OPTIONS.map((pkt) => (
                      <option key={pkt} value={pkt}>
                        {pkt}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* ROW 2: Block & Tower (2 Columns in same row) */}
            <div className="grid grid-cols-2 gap-3 pt-0.5">
              {/* Block */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Block *</label>
                <div className="relative">
                  <select
                    value={formData.block}
                    onChange={(e) => setFormData({ ...formData, block: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-semibold bg-slate-50/90 border border-slate-300 hover:border-[#4b2c83]/50 focus:border-[#4b2c83] rounded-xl text-slate-900 outline-none focus:ring-2 focus:ring-[#4b2c83]/20 transition-all shadow-xs appearance-none cursor-pointer pr-7"
                  >
                    {BLOCK_OPTIONS.map((blk) => (
                      <option key={blk} value={blk}>
                        {blk}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Tower */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Tower *</label>
                <div className="relative">
                  <select
                    value={formData.tower}
                    onChange={(e) => setFormData({ ...formData, tower: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-semibold bg-slate-50/90 border border-slate-300 hover:border-[#4b2c83]/50 focus:border-[#4b2c83] rounded-xl text-slate-900 outline-none focus:ring-2 focus:ring-[#4b2c83]/20 transition-all shadow-xs appearance-none cursor-pointer pr-7"
                  >
                    {TOWER_OPTIONS.map((twr) => (
                      <option key={twr} value={twr}>
                        {twr}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* ROW 3: Dedicated Flat Number Generator Section */}
            <div ref={generatorRef} className="scroll-mt-2 p-3.5 rounded-2xl bg-gradient-to-br from-purple-50/70 via-slate-50 to-purple-50/30 border border-purple-200/80 space-y-2.5 shadow-2xs">
              {/* Generator Header & Mode Toggle */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#4b2c83]">
                  <Sparkles className="w-3.5 h-3.5 text-[#4b2c83]" />
                  <span>Flat Number Generator</span>
                </span>
                <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setGenMode('tower')}
                    className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md transition-all cursor-pointer ${
                      genMode === 'tower'
                        ? 'bg-white text-[#4b2c83] shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tower Matrix
                  </button>
                  <button
                    type="button"
                    onClick={() => setGenMode('vertical')}
                    className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md transition-all cursor-pointer ${
                      genMode === 'vertical'
                        ? 'bg-white text-[#4b2c83] shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Vertical Stack
                  </button>
                </div>
              </div>

              {/* Mode Parameters */}
              {genMode === 'tower' ? (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-600 mb-0.5">FROM FLOOR</label>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={genFloorFrom}
                      onChange={(e) => setGenFloorFrom(e.target.value)}
                      className="w-full h-8 px-2.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-600 mb-0.5">TO FLOOR</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={genFloorTo}
                      onChange={(e) => setGenFloorTo(e.target.value)}
                      className="w-full h-8 px-2.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-600 mb-0.5">UNITS / FLOOR</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={genUnitsPerFloor}
                      onChange={(e) => setGenUnitsPerFloor(e.target.value)}
                      className="w-full h-8 px-2.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 shadow-xs"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-600 mb-0.5">FROM FLOOR</label>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={genVertFloorFrom}
                      onChange={(e) => setGenVertFloorFrom(e.target.value)}
                      className="w-full h-8 px-2.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-600 mb-0.5">TO FLOOR</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={genVertFloorTo}
                      onChange={(e) => setGenVertFloorTo(e.target.value)}
                      className="w-full h-8 px-2.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-600 mb-0.5">FLAT NO.</label>
                    <input
                      type="text"
                      value={genVertBaseFlat}
                      onChange={(e) => setGenVertBaseFlat(e.target.value)}
                      placeholder="e.g. 102 or 16"
                      className="w-full h-8 px-2.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-[#4b2c83] focus:ring-1 focus:ring-[#4b2c83]/20 shadow-xs"
                    />
                  </div>
                </div>
              )}

              {/* Selector Status & Generator Actions */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-purple-200/50">
                {genMode === 'tower' ? (
                  /* Parity Pills for Tower Matrix */
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-slate-500 mr-0.5">Parity:</span>
                    {[
                      { id: 'ALL', label: 'ALL' },
                      { id: 'ODD', label: 'ODD' },
                      { id: 'EVEN', label: 'EVEN' }
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setGenParity(p.id)}
                        className={`w-11 py-1 text-[10.5px] font-mono font-extrabold rounded-md text-center transition-all cursor-pointer ${
                          genParity === p.id
                            ? 'bg-[#4b2c83] text-white border border-[#4b2c83] shadow-xs'
                            : 'bg-white text-slate-600 border border-slate-200/90 hover:bg-slate-100'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                    <span className="text-[10px] font-bold text-purple-700 ml-1 font-mono tabular-nums inline-block min-w-[65px]">
                      ({previewCount} flats)
                    </span>
                  </div>
                ) : (
                  /* Series Indicator for Vertical Stack */
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-slate-500">Series:</span>
                    <span className="px-2 py-0.5 text-[10.5px] font-mono font-extrabold text-[#4b2c83] bg-purple-100/70 border border-purple-300 rounded-md">
                      {String(genVertBaseFlat || '').trim() 
                        ? `Unit #${String(genVertBaseFlat)
                            .split(',')
                            .map((s) => {
                              const n = parseInt(s.trim(), 10);
                              return isNaN(n) ? '' : (n >= 100 ? (n % 100) : n);
                            })
                            .filter(Boolean)
                            .join(', ')}`
                        : 'Enter flat #'
                      }
                    </span>
                    <span className="text-[10px] font-bold text-purple-700 ml-1 font-mono tabular-nums inline-block min-w-[65px]">
                      ({previewCount} flats)
                    </span>
                  </div>
                )}

                {/* Generate Actions */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleGenerateFlats('append')}
                    disabled={previewCount === 0}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-extrabold rounded-lg bg-[#4b2c83] hover:bg-[#3b2069] text-white shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Append</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGenerateFlats('replace')}
                    disabled={previewCount === 0}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-extrabold rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span>Replace All</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 3. Priority Flat Numbers */}
            <div className="pt-2 border-t border-slate-200/80">
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Hash className="w-3.5 h-3.5 text-emerald-600" /> Priority Flat Numbers
                </span>
                <div className="flex items-center gap-2">
                  {parsedFlats.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, flats: '' }))}
                      className="flex items-center gap-1 text-[10.5px] font-extrabold text-red-600 hover:text-red-700 hover:bg-red-50/80 px-2 py-0.5 rounded-lg border border-red-200/80 transition-all cursor-pointer shadow-3xs active:scale-95"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                  <span className="text-[10px] text-slate-400 font-normal">Comma-separated</span>
                </div>
              </div>

              <input
                ref={flatInputRef}
                type="text"
                value={formData.flats}
                onChange={(e) => setFormData({ ...formData, flats: e.target.value })}
                onFocus={handleInputFocus}
                onClick={handleInputClick}
                placeholder="1801, 1803, 1804, 1805"
                className="w-full px-3.5 py-2.5 text-sm font-mono font-extrabold bg-slate-50/80 border border-slate-300 rounded-xl text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-500 transition-all shadow-xs"
              />
              <p className="text-[10.5px] text-slate-500 mt-1">
                Automation attempts booking in exact left-to-right priority order.
              </p>

              {/* Priority Chips Preview */}
              {parsedFlats.length > 0 && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center justify-between mb-1.5 px-0.5">
                    <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                      Queue ({parsedFlats.length} {parsedFlats.length === 1 ? 'flat' : 'flats'}):
                    </span>
                    {parsedFlats.length > 15 && (
                      <span className="text-[9.5px] font-semibold text-slate-400">
                        Scrollable (max 5 rows)
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap content-start items-center gap-1.5 max-h-[150px] overflow-y-auto pr-1">
                    {parsedFlats.map((flat, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 text-xs font-mono font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded-lg shadow-3xs flex items-center gap-1 shrink-0"
                      >
                        <span className="text-[9px] text-emerald-500 font-bold">#{idx + 1}</span>
                        <span>{flat}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-slate-200 bg-slate-50/90">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-extrabold tracking-wider uppercase rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/80 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }}
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold tracking-wider uppercase text-white rounded-xl hover:opacity-95 shadow-md shadow-[#4b2c83]/30 transition-all active:scale-[0.98] cursor-pointer"
            >
              <Save className="w-4 h-4" /> {saveAndSearch ? 'Save & Search' : 'Save Target Flats'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
