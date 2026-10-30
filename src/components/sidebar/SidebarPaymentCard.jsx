import React, { useEffect, useState } from 'react';
import { CreditCard, Lock, Pencil, Trash2, Plus, Check } from 'lucide-react';
import { wsGet, wsSet } from '../../utils/storageHelper';

// Saved cards for Fast Payment (BillDesk card flow, stops at the bank OTP).
// Cards go straight to main, which keeps them in one file encrypted with the
// OS keystore; the renderer only ever gets back masked summaries and keeps no
// card state. Each window picks the card it pays with (fastPaymentCardId).
// Editing pre-fills label, expiry and name; a blank card number / CVV keeps
// the saved ones (main merges them), since the renderer never sees them.
const EMPTY_FORM = { label: '', cardNumber: '', expiry: '', cvv: '', cardHolderName: '' };

export default function SidebarPaymentCard({ addLog, settings, onUpdateSettings }) {
  const api = typeof window !== 'undefined' ? window.ddaElectronAPI : null;
  const [cards, setCards] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // null = list view, 'new' = adding, otherwise the id of the card being edited
  const [editingId, setEditingId] = useState(null);

  const reload = () => api?.listPaymentCards?.()
    .then((list) => { setCards(Array.isArray(list) ? list.filter(Boolean) : []); setLoaded(true); })
    .catch(() => setLoaded(true));

  useEffect(() => {
    reload();
    // Cards are shared by every window; pick up changes made in another one.
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // This window's card: its pick; with no pick, the only saved card (main does the same).
  const pickedId = settings?.fastPaymentCardId ?? wsGet('dda_fast_payment_card_id') ?? '';
  const activeCard = pickedId
    ? cards.find((c) => c.id === pickedId) || null
    : (cards.length === 1 ? cards[0] : null);

  const pickCard = (card) => {
    onUpdateSettings?.({ fastPaymentCardId: card.id });
    try { wsSet('dda_fast_payment_card_id', card.id); } catch (_) {}
    addLog?.('USER_ACTION', 'Modes', `Fast Payment card for this window: ${card.label || 'card'} ending ${card.last4}`);
  };

  const update = (key, raw) => {
    let v = raw;
    if (key === 'cardNumber') v = raw.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
    if (key === 'expiry') {
      const d = raw.replace(/\D/g, '').slice(0, 4);
      v = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    }
    if (key === 'cvv') v = raw.replace(/\D/g, '').slice(0, 4);
    if (key === 'cardHolderName') v = raw.toUpperCase().slice(0, 40);
    if (key === 'label') v = raw.slice(0, 30);
    setForm((f) => ({ ...f, [key]: v }));
    setError('');
  };

  const handleSave = async () => {
    if (!api?.savePaymentCard) return;
    const isEdit = editingId && editingId !== 'new';
    setSaving(true);
    try {
      const res = await api.savePaymentCard({ ...form, ...(isEdit ? { id: editingId } : {}) });
      if (res?.success) {
        await reload();
        // A new card becomes this window's card straight away.
        if (!isEdit) pickCard(res.card);
        setForm(EMPTY_FORM);
        setEditingId(null);
        addLog?.('USER_ACTION', 'Modes', `${isEdit ? 'Updated' : 'Saved'} Fast Payment card ${res.card.label || ''} ending ${res.card.last4}`);
      } else {
        setError(res?.error || 'Could not save card.');
      }
    } catch (err) {
      setError(err?.message || 'Could not save card.');
    } finally {
      setSaving(false);
    }
  };

  const startAdd = () => {
    setForm(EMPTY_FORM);
    setError('');
    setEditingId('new');
  };

  const startEdit = (card) => {
    setForm({ label: card.label || '', cardNumber: '', expiry: card.expiry || '', cvv: '', cardHolderName: card.cardHolderName || '' });
    setError('');
    setEditingId(card.id);
  };

  const cancelEdit = () => {
    setForm(EMPTY_FORM);
    setError('');
    setEditingId(null);
  };

  const handleRemove = async (card) => {
    if (!window.confirm(`Remove card ${card.label || ''} ending ${card.last4}? Every window using it will have no card.`)) return;
    try { await api?.removePaymentCard?.(card.id); } catch (_) {}
    await reload();
    addLog?.('USER_ACTION', 'Modes', `Removed Fast Payment card ${card.label || ''} ending ${card.last4}`);
  };

  if (!loaded) return null;

  const inputCls = 'w-full h-7 px-2 rounded-md border border-slate-200 bg-white text-[11px] font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#4b2c83] select-text';
  const editingCard = editingId && editingId !== 'new' ? cards.find((c) => c.id === editingId) : null;
  const showForm = editingId !== null || cards.length === 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10.5px] font-bold text-slate-700">
        <span className="flex items-center gap-1">
          <CreditCard className="w-3 h-3 text-[#4b2c83]" />
          <span>Cards (auto-pay to OTP)</span>
        </span>
        <span className="flex items-center gap-0.5 text-[9px] font-semibold text-slate-500">
          <Lock className="w-2.5 h-2.5" /> Encrypted
        </span>
      </div>

      {!showForm && (
        <>
          <div className="text-[9.5px] font-semibold text-slate-500">Tap a card to use it in this window:</div>
          <div className="space-y-1">
            {cards.map((card) => {
              const isActive = activeCard?.id === card.id;
              return (
                <div
                  key={card.id}
                  onClick={() => !isActive && pickCard(card)}
                  title={isActive ? 'This window pays with this card' : 'Use this card in this window'}
                  className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-colors cursor-pointer ${
                    isActive ? 'bg-purple-50 border-[#4b2c83]' : 'bg-white border-slate-200 hover:border-[#4b2c83]/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`flex items-center justify-center w-3.5 h-3.5 rounded-full border shrink-0 ${
                      isActive ? 'bg-[#4b2c83] border-[#4b2c83]' : 'border-slate-300'
                    }`}>
                      {isActive && <Check className="w-2.5 h-2.5 text-white stroke-[4]" />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono font-bold text-slate-800 truncate">
                        {card.label ? <span className="font-sans">{card.label} </span> : null}
                        •••• {card.last4} <span className="text-slate-500 font-semibold">{card.expiry}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">{card.cardHolderName}</div>
                    </div>
                  </div>
                  <div className="flex items-center shrink-0">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); startEdit(card); }}
                      title="Edit card"
                      className="p-1 rounded text-slate-400 hover:text-[#4b2c83] hover:bg-purple-100 transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRemove(card); }}
                      title="Remove card"
                      className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {!activeCard && (
            <div className="text-[10px] font-bold text-red-600">No card chosen for this window: Fast Payment won't fill a card. Tap one above.</div>
          )}
          <button
            type="button"
            onClick={startAdd}
            className="w-full h-7 flex items-center justify-center gap-1 rounded-lg text-[10.5px] font-black uppercase tracking-wider bg-white text-[#4b2c83] border border-[#4b2c83]/40 hover:bg-purple-50 cursor-pointer transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> Add card
          </button>
        </>
      )}

      {showForm && (
        <div className="space-y-1.5">
          <input
            className={`${inputCls} font-sans`}
            placeholder="Label (e.g. Rahul HDFC)"
            autoComplete="off"
            value={form.label}
            onChange={(e) => update('label', e.target.value)}
          />
          <input
            className={inputCls}
            placeholder={editingCard ? `•••• ${editingCard.last4} — blank keeps it` : 'Card number'}
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
              placeholder={editingCard ? 'CVV (blank keeps)' : 'CVV'}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={form.cvv}
              onChange={(e) => update('cvv', e.target.value)}
            />
          </div>
          <input
            className={inputCls}
            placeholder="Name on card"
            autoComplete="off"
            value={form.cardHolderName}
            onChange={(e) => update('cardHolderName', e.target.value)}
          />
          {error && <div className="text-[10px] font-semibold text-red-600">{error}</div>}
          <div className="flex gap-1.5">
            {cards.length > 0 && (
              <button
                type="button"
                onClick={cancelEdit}
                className="flex-1 h-7 rounded-lg text-[10.5px] font-black uppercase tracking-wider bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 cursor-pointer transition-all"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 h-7 rounded-lg text-[10.5px] font-black uppercase tracking-wider bg-[#4b2c83] text-white hover:brightness-110 disabled:opacity-50 cursor-pointer transition-all"
            >
              {saving ? 'Saving…' : editingCard ? 'Update card' : 'Save card'}
            </button>
          </div>
        </div>
      )}

      <p className="text-[9.5px] leading-snug text-slate-500">
        Cards are shared by all windows; each window pays with the card ticked here. On the 15-min hold page, check the flat, then press FAST PAY: it runs through BillDesk, fills this window's card, clicks Pay once and stops at the bank OTP. Typing on the BillDesk form hands control back to you.
      </p>
    </div>
  );
}
