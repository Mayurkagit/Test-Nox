import React, { useEffect, useState } from 'react';
import { KeyRound, X } from 'lucide-react';

// Chrome-style "Save login?" bar over the webview. Main sends an offer after
// the user logs in to a bank page by hand; the bar shows only the host and a
// masked login ID, and answers with the offer id (main holds the password).
export default function BankLoginSaveBar({ webviewRef }) {
  const api = typeof window !== 'undefined' ? window.ddaElectronAPI : null;
  const [offer, setOffer] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub = api?.onBankLoginOffer?.((data) => {
      let myId = null;
      try { myId = webviewRef.current?.getWebContentsId?.(); } catch (_) {}
      if (!data || (myId != null && data.wcId !== myId)) return;
      setError('');
      setOffer(data);
    });
    return () => unsub?.();
  }, []);

  if (!offer) return null;

  const respond = async (action) => {
    try {
      const res = await api?.respondBankLoginOffer?.(offer.id, action);
      if (action === 'save' && !res?.success) {
        setError(res?.error || 'Could not save — log in again to get a new offer.');
        return;
      }
    } catch (err) {
      setError(err?.message || 'Could not save.');
      return;
    }
    setOffer(null);
  };

  return (
    <div className="absolute top-3 right-3 z-50 w-80 rounded-xl border border-slate-200 bg-white shadow-xl p-3 text-slate-800">
      <div className="flex items-start gap-2">
        <KeyRound className="w-4 h-4 mt-0.5 text-[#4b2c83] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">{offer.update ? 'Update saved login?' : 'Save net-banking login?'}</div>
          <div className="text-[11px] text-slate-500 truncate">{offer.host}</div>
          {offer.usernameMasked && (
            <div className="text-[11px] text-slate-600 mt-1">Login ID: <span className="font-mono">{offer.usernameMasked}</span> · Password: ••••••</div>
          )}
          <div className="text-[10px] text-slate-400 mt-1">Encrypted with your Windows account. Filled only on this site.</div>
          {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
        </div>
        <button type="button" onClick={() => respond('dismiss')} className="p-0.5 text-slate-400 hover:text-slate-700" title="Not now">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex justify-end gap-2 mt-2.5">
        <button type="button" onClick={() => respond('never')} className="px-2.5 py-1 text-[11px] rounded-md border border-slate-200 hover:bg-slate-50">
          Never for this site
        </button>
        <button type="button" onClick={() => respond('save')} className="px-3 py-1 text-[11px] rounded-md bg-[#4b2c83] text-white font-semibold hover:bg-[#3d2369]">
          {offer.update ? 'Update' : 'Save'}
        </button>
      </div>
    </div>
  );
}
