import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, Edit3, RotateCcw, X, Save, Building2, ChevronDown, AlertTriangle } from 'lucide-react';
import { useApplicantStore, useAutomationStore, useSettingsStore } from '../../store';
import { BANK_GROUPS, DEFAULT_BANK, normalizeFastPayment, describeFastPayment, resolveBankId, maskedCardExpired } from '../../utils/paymentBanks';
import SidebarPaymentCard from './SidebarPaymentCard';
import SidebarBankLogins from './SidebarBankLogins';

const panOf = (a) => String(a?.pan || a?.personal?.pan || '').toUpperCase().trim();

// This PC's edit of the applicant's website card (like the local flat list).
// An edit made against a website card that has since changed is dropped.
function useApplicantCardEdit(pan, websiteMask) {
  const [edit, setEdit] = useState(null);
  const reload = useCallback(async () => {
    const api = window.ddaElectronAPI;
    if (!pan || !api?.listApplicantCardEdits) { setEdit(null); return; }
    try {
      const e = (await api.listApplicantCardEdits())?.[pan] || null;
      if (e && websiteMask && e.baseMask !== websiteMask) {
        await api.removeApplicantCardEdit?.(pan);
        setEdit(null);
        return;
      }
      setEdit(e);
    } catch (_) {
      setEdit(null);
    }
  }, [pan, websiteMask]);
  useEffect(() => { reload(); }, [reload]);
  return { edit, reload };
}

// "•••• 1234 (MM/YY)" for the edited card; the last 4 come from the website card when the number was kept
const editedCardMask = (edit, websiteMask) => {
  const last4 = edit.last4 || /(\d{4})/.exec(websiteMask || '')?.[1] || '????';
  return `•••• ${last4} (${edit.expiry})`;
};

// The applicant's Fast Payment (gateway, method, bank): the website's choice
// (application form), or one set here with the pencil, kept on this computer
// like the local flat preferences. The pencil opens the editor modal.
// variant 'line': one short line with a pencil, under the Fast Payment toggle.
// hidden: render only the editor (opened by openSignal while the toggle is off).
// openSignal: a number that opens the editor each time it goes up.
// onEditorClosed(saved): the editor closed, with or without a saved choice.
export default function SidebarFastPayment({ applicant, variant = 'card', hidden = false, openSignal = 0, onEditorClosed }) {
  const localPrefs = useApplicantStore((s) => s.localPrefs);
  const masterApplicants = useApplicantStore((s) => s.masterApplicants);
  const setLocalFastPayment = useApplicantStore((s) => s.setLocalFastPayment);
  const isSearching = useAutomationStore((s) => s.isSearching);
  const addLog = useAutomationStore((s) => s.addLog);
  const [open, setOpen] = useState(false);
  const pan = panOf(applicant);
  const websiteMask = applicant?.paymentSaved?.card || '';
  const { edit: cardEdit, reload: reloadCardEdit } = useApplicantCardEdit(pan, websiteMask);
  // Opens only when the signal goes up while mounted: re-mounting (folding and unfolding
  // Automation Modes) must not reopen it for an old signal
  const seenSignalRef = useRef(openSignal);
  useEffect(() => {
    if (openSignal > seenSignalRef.current) setOpen(true);
    seenSignalRef.current = openSignal;
  }, [openSignal]);

  if (!applicant) return null;
  const cardMask = cardEdit ? editedCardMask(cardEdit, websiteMask) : websiteMask;
  const cloud = (masterApplicants || []).find((a) => panOf(a) === pan);
  const websiteText = describeFastPayment(cloud?.preferences?.fastPayment);
  const isLocal = Boolean(localPrefs?.[pan]?.fastPayment);
  const current = normalizeFastPayment(applicant?.preferences?.fastPayment);
  const text = describeFastPayment(current);

  const iconBtn = 'w-6 h-6 rounded-lg border flex items-center justify-center transition-all shrink-0';
  const offBtn = 'text-slate-400 bg-slate-50 border-slate-200 opacity-40 cursor-not-allowed select-none';
  const lockedTitle = isSearching ? 'Locked while search is active' : undefined;

  const modal = open && (
    <FastPaymentModal
      applicant={applicant}
      current={current}
      websiteText={websiteText}
      cardEdit={cardEdit}
      onCardEditChanged={reloadCardEdit}
      onClose={() => { setOpen(false); onEditorClosed?.(false); }}
      onSave={(fp) => {
        addLog?.('USER_ACTION', 'Fast Payment', `User set Fast Payment: ${describeFastPayment(fp)}`, pan);
        setLocalFastPayment(pan, fp);
        setOpen(false);
        onEditorClosed?.(true);
      }}
    />
  );

  const showCard = Boolean(current.method === 'card' && current.cardSource !== 'pc' && cardMask);
  const cardExpired = showCard && maskedCardExpired(cardMask);

  if (variant === 'line') {
    if (hidden) return modal || null;
    // "CBI · Card · •••• 1234" (the card's expiry is in the tooltip)
    const lineText = text
      ? text + (showCard && !cardExpired ? ` · ${cardMask.replace(/\s*\(.*\)\s*$/, '')}` : '')
      : 'Not set: choose how to pay';
    return (
      <div className="space-y-1 select-none">
        <div className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            disabled={isSearching}
            onClick={isSearching ? undefined : () => setOpen(true)}
            title={lockedTitle || (text ? `${text}${showCard ? ` · ${cardMask}` : ''}${cardEdit ? ' (card edited on this computer)' : ''}. Click to change` : 'Choose how Fast Payment pays')}
            className={`flex-1 min-w-0 px-2 py-1 rounded-md border text-left text-[10.5px] font-bold truncate transition-colors ${
              text ? 'bg-white border-slate-200/90 text-slate-800 hover:border-[#4b2c83]/50' : 'bg-amber-50 border-amber-300 text-amber-800'
            } ${isSearching ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {lineText}
          </button>
          {isLocal && (
            <button
              type="button"
              disabled={isSearching}
              onClick={isSearching ? undefined : () => {
                addLog?.('USER_ACTION', 'Fast Payment', "User reset Fast Payment to the website's choice", pan);
                setLocalFastPayment(pan, null);
              }}
              title={lockedTitle || (websiteText ? `Set on this computer. Click to go back to the website's choice (${websiteText})` : 'Set on this computer. Click to remove it')}
              className={`h-6 px-1.5 rounded-lg border flex items-center gap-0.5 text-[8.5px] font-extrabold uppercase shrink-0 transition-all ${
                isSearching ? offBtn : 'text-amber-800 bg-amber-50 border-amber-300 hover:bg-amber-100 cursor-pointer active:scale-95'
              }`}
            >
              Local <RotateCcw className="w-2.5 h-2.5" />
            </button>
          )}
          <button
            type="button"
            disabled={isSearching}
            onClick={isSearching ? undefined : () => setOpen(true)}
            title={lockedTitle || 'Edit Fast Payment'}
            className={`${iconBtn} ${isSearching ? offBtn : 'text-[#4b2c83] bg-white hover:bg-[#faf5ff] border-slate-200/90 hover:border-[#4b2c83]/50 cursor-pointer active:scale-95'}`}
          >
            <Edit3 className="w-3 h-3" />
          </button>
        </div>
        {cardExpired && (
          <p className="text-[10px] font-bold text-red-700 leading-snug px-0.5">
            Applicant's card {cardMask} has expired: this PC's ticked card is used instead.
          </p>
        )}
        {modal}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 select-none">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9.5px] font-black uppercase tracking-[0.12em] text-slate-500 flex items-center gap-1">
          <CreditCard className="w-3 h-3 text-[#4b2c83]" />
          Fast Payment
        </span>
        <div className="flex items-center gap-1">
          {isLocal && (
            <>
              <span
                title="Set on this computer, not saved to the website. Replaced automatically if the website's choice changes."
                className="text-[8.5px] font-extrabold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-300 uppercase"
              >
                Local
              </span>
              <button
                type="button"
                disabled={isSearching}
                onClick={isSearching ? undefined : () => {
                  addLog?.('USER_ACTION', 'Fast Payment', "User reset Fast Payment to the website's choice", pan);
                  setLocalFastPayment(pan, null);
                }}
                title={lockedTitle || (websiteText ? `Back to the website's choice (${websiteText})` : 'Remove the choice set here')}
                className={`${iconBtn} ${isSearching ? offBtn : 'text-amber-700 hover:bg-amber-50 border-slate-200/90 hover:border-amber-300 cursor-pointer active:scale-95'}`}
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </>
          )}
          <button
            type="button"
            disabled={isSearching}
            onClick={isSearching ? undefined : () => setOpen(true)}
            title={lockedTitle || 'Edit Fast Payment'}
            className={`${iconBtn} ${isSearching ? offBtn : 'text-[#4b2c83] hover:bg-[#faf5ff] border-slate-200/90 hover:border-[#4b2c83]/50 cursor-pointer active:scale-95'}`}
          >
            <Edit3 className="w-3 h-3" />
          </button>
        </div>
      </div>
      {text ? (
        <div className="px-2 py-1 rounded-md bg-slate-50 border border-slate-200/80 text-[11px] font-bold text-slate-800 truncate" title={text}>
          {text}
        </div>
      ) : (
        <button
          type="button"
          onClick={isSearching ? undefined : () => setOpen(true)}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-300 text-[10.5px] font-bold text-amber-800 text-left cursor-pointer"
        >
          <AlertTriangle className="w-3 h-3 shrink-0" />
          Not set: press the pencil to choose
        </button>
      )}
      {current.method === 'card' && current.cardSource !== 'pc' && cardMask && (
        maskedCardExpired(cardMask) ? (
          <p className="text-[10px] font-bold text-red-700 leading-snug px-0.5">
            Applicant's card {cardMask} has expired: this PC's ticked card is used instead.
          </p>
        ) : (
          <p className="text-[10px] font-semibold text-slate-500 leading-snug px-0.5 flex items-center gap-1">
            Card {cardMask}
            {cardEdit && (
              <span title="Edited on this computer, not saved to the website" className="text-[8px] font-extrabold text-amber-800 bg-amber-50 px-1 rounded-full border border-amber-300 uppercase">
                Local
              </span>
            )}
          </p>
        )
      )}
      {modal}
    </div>
  );
}

// Gateway, method, bank and the saved card / bank logins, in the same style as
// the Target Location & Flats modal.
function FastPaymentModal({ applicant, current, websiteText, cardEdit, onCardEditChanged, onClose, onSave }) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const addLog = useAutomationStore((s) => s.addLog);
  const [draft, setDraft] = useState(() => (current.gateway ? current : { gateway: '', method: '', bank: '' }));

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickGateway = (gateway) => {
    const method = gateway === 'sbi' ? 'netbanking' : (draft.method || 'card');
    setDraft({
      gateway,
      method,
      bank: method === 'netbanking' ? resolveBankId(draft.bank, gateway) : '',
      ...(method === 'card' && draft.cardSource ? { cardSource: draft.cardSource } : {}),
    });
  };
  const pickMethod = (method) => {
    setDraft((d) => ({ ...d, method, bank: method === 'netbanking' ? resolveBankId(d.bank || DEFAULT_BANK[d.gateway], d.gateway) : '' }));
  };

  const name = [applicant?.personal?.firstName, applicant?.personal?.lastName].filter(Boolean).join(' ') || applicant?.name || 'Applicant';
  const pan = panOf(applicant) || 'NO-PAN';
  const saved = applicant?.paymentSaved || {};
  // The applicant's card as it will be used: the website card, or this PC's edit of it
  const applicantCard = cardEdit ? editedCardMask(cardEdit, saved.card) : (saved.card || '');
  const websiteCardExpired = maskedCardExpired(applicantCard);
  const usePcCard = draft.cardSource === 'pc' || websiteCardExpired;
  const btn = (on) => `py-2 px-2 rounded-xl text-xs font-extrabold transition-all text-center border cursor-pointer ${
    on ? 'bg-[#4b2c83] text-white border-[#4b2c83] shadow-xs' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
  }`;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in font-sans select-none">
      <div className="w-full max-w-xl overflow-hidden bg-white border border-slate-200/90 rounded-3xl shadow-[0_25px_70px_rgba(15,23,42,0.2)] text-slate-900 relative">
        <div
          style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)', boxShadow: '0 2px 10px rgba(75, 44, 131, 0.2)' }}
          className="flex items-center justify-between px-6 py-4 text-white"
        >
          <div className="flex items-center gap-3">
            <div
              style={{ background: 'rgba(255, 255, 255, 0.2)', border: '1px solid rgba(255, 255, 255, 0.3)' }}
              className="flex items-center justify-center w-10 h-10 rounded-xl text-white shadow-xs shrink-0"
            >
              <CreditCard className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold tracking-tight text-white leading-tight">Fast Payment</h3>
                <span
                  style={{ background: 'rgba(255, 255, 255, 0.2)', border: '1px solid rgba(255, 255, 255, 0.35)' }}
                  className="text-[10.5px] font-mono font-extrabold text-white px-2 py-0.5 rounded-md tracking-wider"
                >
                  {pan}
                </span>
              </div>
              <p className="text-[11.5px] text-purple-100/90 font-medium mt-0.5">
                How FAST PAYMENT pays for <strong className="text-white font-bold">{name}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'rgba(255, 255, 255, 0.18)', border: '1px solid rgba(255, 255, 255, 0.25)' }}
            className="w-8 h-8 rounded-lg text-white hover:bg-white/30 flex items-center justify-center transition-all cursor-pointer shadow-xs active:scale-95"
            title="Close"
          >
            <X className="w-4.5 h-4.5 text-white" />
          </button>
        </div>

        {/* Not a <form>: the card and bank-login panels below have buttons and a form of their own */}
        <div>
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <p className={`text-[11px] leading-snug font-semibold rounded-xl px-3 py-2 border ${websiteText ? 'text-[#4b2c83] bg-purple-50 border-purple-200/70' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
              {websiteText
                ? <>Website choice: <span className="font-extrabold">{websiteText}</span>. A change here is kept on this computer only.</>
                : <>Not set on the website. The choice made here is kept on this computer.</>}
            </p>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1 text-[11px] font-bold text-slate-700">
                <Building2 className="w-3.5 h-3.5 text-[#4b2c83]" /> Payment gateway *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => pickGateway('cbi')} className={btn(draft.gateway === 'cbi')}>Central Bank (CBI)</button>
                <button type="button" onClick={() => pickGateway('sbi')} className={btn(draft.gateway === 'sbi')}>State Bank (SBI)</button>
              </div>
            </div>

            {draft.gateway === 'cbi' && (
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-700">Method *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => pickMethod('card')} className={btn(draft.method === 'card')}>Debit / Credit card</button>
                  <button type="button" onClick={() => pickMethod('netbanking')} className={btn(draft.method === 'netbanking')}>Net banking</button>
                </div>
              </div>
            )}
            {draft.gateway === 'sbi' && (
              <p className="text-[10.5px] text-slate-500">SBI's gateway takes net banking only.</p>
            )}

            {draft.method === 'netbanking' && (
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-700">Net banking bank *</label>
                <div className="relative">
                  <select
                    value={draft.bank}
                    onChange={(e) => setDraft((d) => ({ ...d, bank: e.target.value }))}
                    className="w-full px-3 py-2 text-xs font-semibold bg-slate-50/90 border border-slate-300 hover:border-[#4b2c83]/50 focus:border-[#4b2c83] rounded-xl text-slate-900 outline-none focus:ring-2 focus:ring-[#4b2c83]/20 transition-all shadow-xs appearance-none cursor-pointer pr-7"
                  >
                    {(BANK_GROUPS[draft.gateway] || BANK_GROUPS.cbi).map(([label, banks]) => (
                      <optgroup key={label} label={label}>
                        {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <p className="text-[10.5px] leading-snug text-slate-500">
                  {draft.gateway === 'sbi'
                    ? (draft.bank === 'statebankofindia'
                      ? "FAST PAYMENT picks SBI Net Banking on SBI's page and stops at SBI's login: you log in."
                      : "FAST PAYMENT picks Other Bank Net Banking on SBI's page, selects this bank on BillDesk, clicks Pay once and stops at the bank's login.")
                    : "FAST PAYMENT opens Net Banking on BillDesk, selects this bank, clicks Pay once and stops at the bank's login."}
                  {' '}Clicking anything on the gateway page hands control back to you.
                </p>
              </div>
            )}

            {draft.gateway === 'cbi' && draft.method === 'card' && (
              <div className="pt-3 border-t border-slate-200/80 space-y-2">
                <p className="text-[11px] font-bold text-slate-700">Card</p>
                {applicantCard ? (
                  <>
                    {/* The applicant's card wins unless this PC's card is chosen; an expired one is never used */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={websiteCardExpired}
                        onClick={() => setDraft((d) => { const { cardSource, ...rest } = d; return rest; })}
                        className={`${btn(!usePcCard)} disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        {cardEdit ? "Applicant's card" : 'Website card'} {applicantCard}
                        {cardEdit && <span className="block text-[10px] font-black text-amber-600">Edited on this PC</span>}
                        {websiteCardExpired && <span className="block text-[10px] font-black text-red-600">Expired</span>}
                      </button>
                      <button type="button" onClick={() => setDraft((d) => ({ ...d, cardSource: 'pc' }))} className={btn(usePcCard)}>
                        Card saved on this PC
                      </button>
                    </div>
                    <p className={`text-[10.5px] font-semibold ${websiteCardExpired ? 'text-red-700' : usePcCard ? 'text-slate-500' : 'text-emerald-700'}`}>
                      {websiteCardExpired
                        ? `The applicant's card ${applicantCard} has expired, so the card ticked below (saved on this PC) is used. Edit the applicant's card here to fix it.`
                        : usePcCard
                          ? 'The card ticked below (saved on this PC) is used for this applicant.'
                          : cardEdit?.hasCvv
                            ? "This applicant's own card is used, with the CVV typed here: FAST PAYMENT fills it and clicks Pay."
                            : "This applicant's own card is used. You type the CVV on BillDesk."}
                    </p>
                    <ApplicantCardEditor
                      pan={pan}
                      websiteMask={saved.card || ''}
                      cardEdit={cardEdit}
                      onChanged={onCardEditChanged}
                      addLog={addLog}
                    />
                  </>
                ) : (
                  <p className="text-[10.5px] text-slate-500">No card saved on the website for this applicant: the card ticked below (saved on this PC) is used.</p>
                )}
                <SidebarPaymentCard addLog={addLog} settings={settings} onUpdateSettings={updateSettings} />
              </div>
            )}
            {draft.method === 'netbanking' && (
              <div className="pt-3 border-t border-slate-200/80 space-y-2">
                <p className="text-[11px] font-bold text-slate-700">Net banking login</p>
                {saved.netbanking
                  ? <p className="text-[10.5px] text-emerald-700 font-semibold">This applicant's own login from the website is used: {saved.netbanking}. You solve the bank's captcha.</p>
                  : <p className="text-[10.5px] text-slate-500">No login saved on the website for this applicant: a login saved below (on this PC) is filled.</p>}
                <SidebarBankLogins addLog={addLog} />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-slate-200 bg-slate-50/90">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-extrabold tracking-wider uppercase rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/80 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { if (draft.gateway) onSave(normalizeFastPayment(draft)); }}
              disabled={!draft.gateway}
              style={{ background: 'linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)' }}
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold tracking-wider uppercase text-white rounded-xl hover:opacity-95 shadow-md shadow-[#4b2c83]/30 transition-all active:scale-[0.98] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" /> Save Fast Payment
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Edit the applicant's website card on this PC: expiry, name and (optionally) the
// number. A blank number keeps the website's. Kept encrypted on this PC only;
// "Use website card" removes the edit. No CVV: it is typed on BillDesk.
function ApplicantCardEditor({ pan, websiteMask, cardEdit, onChanged, addLog }) {
  const api = typeof window !== 'undefined' ? window.ddaElectronAPI : null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ cardNumber: '', expiry: '', cardHolderName: '', cvv: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const shownExpiry = cardEdit?.expiry || /\((\d{2}\/\d{2})\)/.exec(websiteMask)?.[1] || '';
  const websiteLast4 = /(\d{4})/.exec(websiteMask)?.[1] || '';
  const keepLast4 = cardEdit?.last4 || websiteLast4;

  const start = () => {
    setForm({ cardNumber: '', expiry: shownExpiry, cardHolderName: cardEdit?.cardHolderName || '', cvv: '' });
    setError('');
    setEditing(true);
  };

  const update = (key, raw) => {
    let v = raw;
    if (key === 'cardNumber') v = raw.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
    if (key === 'expiry') {
      const d = raw.replace(/\D/g, '').slice(0, 4);
      v = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    }
    if (key === 'cardHolderName') v = raw.toUpperCase().slice(0, 60);
    if (key === 'cvv') v = raw.replace(/\D/g, '').slice(0, 4);
    setForm((f) => ({ ...f, [key]: v }));
    setError('');
  };

  const save = async () => {
    if (!api?.saveApplicantCardEdit) return;
    setSaving(true);
    try {
      const res = await api.saveApplicantCardEdit({ pan, baseMask: websiteMask, ...form });
      if (res?.success) {
        addLog?.('USER_ACTION', 'Fast Payment', `User edited the applicant's card on this PC: ending ${res.last4 || keepLast4}, expiry ${res.expiry}${res.hasCvv ? ', CVV set for this run' : ''}`, pan);
        setEditing(false);
        await onChanged?.();
      } else {
        setError(res?.error || 'Could not save the card.');
      }
    } catch (err) {
      setError(err?.message || 'Could not save the card.');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    try { await api?.removeApplicantCardEdit?.(pan); } catch (_) {}
    addLog?.('USER_ACTION', 'Fast Payment', "User reset the applicant's card to the website's", pan);
    setEditing(false);
    await onChanged?.();
  };

  const inputCls = 'w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#4b2c83] select-text';

  if (!editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={start}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-extrabold text-[#4b2c83] bg-white border border-[#4b2c83]/40 hover:bg-purple-50 cursor-pointer"
        >
          <Edit3 className="w-3 h-3" /> Edit applicant's card on this PC
        </button>
        {cardEdit && (
          <>
            <span
              title="Edited on this computer, not saved to the website. Replaced automatically if the website's card changes."
              className="text-[8.5px] font-extrabold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-300 uppercase"
            >
              Local
            </span>
            <span
              title={cardEdit.hasCvv ? 'CVV typed for this run (memory only)' : 'No CVV: you type it on BillDesk'}
              className={`text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-full border uppercase ${
                cardEdit.hasCvv ? 'text-emerald-800 bg-emerald-50 border-emerald-300' : 'text-slate-500 bg-slate-50 border-slate-200'
              }`}
            >
              {cardEdit.hasCvv ? 'CVV set' : 'No CVV'}
            </span>
            {websiteMask && (
              <button
                type="button"
                onClick={reset}
                title={`Back to the website card ${websiteMask}`}
                className="flex items-center gap-1 text-[10.5px] font-bold text-amber-700 hover:underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" /> Use website card
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 p-2.5 rounded-xl border border-amber-200 bg-amber-50/40">
      <p className="text-[10.5px] font-bold text-slate-700">Applicant's card on this PC (not saved to the website)</p>
      <input
        className={inputCls}
        placeholder={keepLast4 ? `•••• ${keepLast4} — blank keeps it` : 'Card number'}
        inputMode="numeric"
        autoComplete="off"
        value={form.cardNumber}
        onChange={(e) => update('cardNumber', e.target.value)}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <input
          className={inputCls}
          placeholder="MM/YY"
          inputMode="numeric"
          autoComplete="off"
          value={form.expiry}
          onChange={(e) => update('expiry', e.target.value)}
        />
        <input
          className={inputCls}
          placeholder={cardEdit?.hasCvv ? 'CVV (blank keeps it)' : 'CVV'}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={form.cvv}
          onChange={(e) => update('cvv', e.target.value)}
        />
      </div>
      <input
        className={`${inputCls} font-sans`}
        placeholder="Name on card"
        autoComplete="off"
        value={form.cardHolderName}
        onChange={(e) => update('cardHolderName', e.target.value)}
      />
      <p className="text-[10px] text-slate-500 leading-snug">
        The CVV is kept only in memory until the app closes: never saved to disk or the website. With it, FAST PAYMENT fills
        the CVV and clicks Pay; without it, you type it on BillDesk.
      </p>
      {error && <div className="text-[10.5px] font-semibold text-red-600">{error}</div>}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => { setEditing(false); setError(''); }}
          className="flex-1 h-8 rounded-lg text-[10.5px] font-black uppercase tracking-wider bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex-1 h-8 rounded-lg text-[10.5px] font-black uppercase tracking-wider bg-[#4b2c83] text-white hover:brightness-110 disabled:opacity-50 cursor-pointer"
        >
          {saving ? 'Saving…' : 'Save on this PC'}
        </button>
      </div>
    </div>
  );
}
