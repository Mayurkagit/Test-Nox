import React, { useEffect, useState } from 'react';
import { KeyRound, Lock, Trash2, Plus, Upload, Download, Pencil } from 'lucide-react';

// Saved net-banking logins: offered after the user logs in to a bank page by hand, or added
// here by hand (bank login page link + ID + password). Export / Import carry them to the
// user's other computers. Main keeps them encrypted; the renderer only gets hosts and masked
// login IDs, and can remove a login or un-block a "Never" site.
export default function SidebarBankLogins({ addLog }) {
  const api = typeof window !== 'undefined' ? window.ddaElectronAPI : null;
  const [data, setData] = useState({ logins: [], never: [] });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // the saved login being edited ({ host, usernameMasked })
  const [form, setForm] = useState({ address: '', username: '', password: '' });
  const [note, setNote] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    api?.listBankLogins?.().then((d) => setData(d || { logins: [], never: [] })).catch(() => {});
  };

  useEffect(() => {
    refresh();
    const unsub = api?.onBankLoginsChanged?.(refresh);
    return () => unsub?.();
  }, []);

  const remove = async (host, wasNever) => {
    try { await api?.deleteBankLogin?.(host); } catch (_) {}
    refresh();
    addLog?.('USER_ACTION', 'Modes', wasNever ? `Allowed saving logins on ${host} again` : `Removed saved net-banking login for ${host}`);
  };

  const saveAdded = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    try {
      const res = await api?.addBankLogin?.(form);
      if (res?.success) {
        setNote({ ok: true, text: `${res.updated ? 'Updated' : 'Saved'} the login for ${res.host}.` });
        addLog?.('USER_ACTION', 'Modes', `${res.updated ? 'Updated' : 'Added'} a net-banking login by hand for ${res.host}`);
        setForm({ address: '', username: '', password: '' });
        setAdding(false);
        setEditing(null);
        refresh();
      } else {
        setNote({ ok: false, text: res?.error || 'Could not save the login.' });
      }
    } catch (_) {
      setNote({ ok: false, text: 'Could not save the login.' });
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api?.exportBankLogins?.();
      if (res?.success) {
        setNote({ ok: true, text: `Exported ${res.count} login${res.count === 1 ? '' : 's'}. Copy the file to your other computer, import it there, then delete it.` });
        addLog?.('USER_ACTION', 'Modes', `Exported ${res.count} saved net-banking login(s) to a file`);
      } else if (!res?.canceled) {
        setNote({ ok: false, text: res?.error || 'Export failed.' });
      }
    } catch (_) {
      setNote({ ok: false, text: 'Export failed.' });
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api?.importBankLogins?.();
      if (res?.success) {
        const total = (res.added || 0) + (res.replaced || 0);
        setNote({ ok: true, text: total ? `Imported ${total} login${total === 1 ? '' : 's'} (${res.added} new, ${res.replaced} replaced). You can delete the file now.` : 'The file had no logins to import.' });
        addLog?.('USER_ACTION', 'Modes', `Imported net-banking logins from a file (${res.added} new, ${res.replaced} replaced)`);
        refresh();
      } else if (!res?.canceled) {
        setNote({ ok: false, text: res?.error || 'Import failed.' });
      }
    } catch (_) {
      setNote({ ok: false, text: 'Import failed.' });
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full h-7 px-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-800 focus:outline-none focus:border-[#4b2c83]';
  const smallBtn = 'flex-1 flex items-center justify-center gap-1 py-1 px-1.5 rounded-md text-[10px] font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-[#4b2c83] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10.5px] font-bold text-slate-700">
        <span className="flex items-center gap-1">
          <KeyRound className="w-3 h-3 text-[#4b2c83]" />
          <span>Saved bank logins</span>
        </span>
        <span className="flex items-center gap-0.5 text-[9px] font-semibold text-slate-500">
          <Lock className="w-2.5 h-2.5" /> Encrypted
        </span>
      </div>

      {data.logins.length === 0 ? (
        <div className="text-[10px] text-slate-500 leading-snug">
          Add a login below, or log in to your bank once in the app and save it. It is filled next time; you type the captcha and OTP.
        </div>
      ) : (
        data.logins.map((l) => (
          <div key={l.host} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white border border-slate-200">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-800 truncate">{l.host}</div>
              <div className="text-[10px] text-slate-500 font-mono truncate">{l.usernameMasked || '(no login ID)'} · ••••••</div>
            </div>
            <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => {
                setNote(null);
                setEditing(l);
                setForm({ address: l.host, username: '', password: '' });
                setAdding(true);
              }}
              title="Change the saved login ID or password"
              className="p-1 rounded text-slate-400 hover:text-[#4b2c83] hover:bg-purple-50 transition-colors cursor-pointer shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => remove(l.host, false)}
              title="Remove saved login"
              className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            </div>
          </div>
        ))
      )}

      {adding ? (
        <form onSubmit={saveAdded} className="space-y-1.5 p-2 rounded-lg bg-white border border-slate-200">
          {editing ? (
            <div className="text-[10.5px] font-semibold text-slate-700 truncate">Edit login for {editing.host}</div>
          ) : (
            <input
              className={inputCls}
              placeholder="Bank login page link or address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              autoFocus
            />
          )}
          <input
            className={inputCls}
            placeholder={editing ? `Login ID (empty = keep ${editing.usernameMasked || 'saved'})` : 'Login ID (or phone number)'}
            autoFocus={!!editing}
            autoComplete="off"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
          />
          <input
            className={inputCls}
            type="password"
            placeholder={editing ? 'New password' : 'Password'}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
          <div className="flex gap-1.5">
            <button type="submit" disabled={busy} className="flex-1 py-1 rounded-md text-[10.5px] font-bold bg-[#4b2c83] text-white hover:bg-[#3d2369] cursor-pointer disabled:opacity-50">
              Save
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setEditing(null); setForm({ address: '', username: '', password: '' }); }}
              className="flex-1 py-1 rounded-md text-[10.5px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex gap-1.5">
          <button type="button" onClick={() => { setNote(null); setEditing(null); setForm({ address: '', username: '', password: '' }); setAdding(true); }} disabled={busy} className={smallBtn} title="Save a bank login without making a payment">
            <Plus className="w-3 h-3" /> Add
          </button>
          <button type="button" onClick={doExport} disabled={busy || data.logins.length === 0} className={smallBtn} title="Save all bank logins to a file for your other computers">
            <Upload className="w-3 h-3" /> Export
          </button>
          <button type="button" onClick={doImport} disabled={busy} className={smallBtn} title="Load bank logins from an exported file">
            <Download className="w-3 h-3" /> Import
          </button>
        </div>
      )}

      {note && (
        <div className={`text-[10px] leading-snug ${note.ok ? 'text-emerald-700' : 'text-red-600'}`}>{note.text}</div>
      )}

      {data.never.length > 0 && (
        <div className="text-[10px] text-slate-500">
          Never saved for:{' '}
          {data.never.map((h, i) => (
            <span key={h}>
              {i > 0 && ', '}
              <button type="button" onClick={() => remove(h, true)} title="Allow saving on this site again" className="underline hover:text-[#4b2c83] cursor-pointer">
                {h}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
