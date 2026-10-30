// Flat preferences changed in the app are kept on this computer, per app
// account (not saved to the cloud), across DDA and app logouts, until the
// cloud's own preferences for that applicant change or the user resets them.
// Entry per PAN: { preferences, baseHash, savedAt }, where baseHash
// fingerprints the cloud preferences the change was made on top of.

const panOf = (applicant) =>
  String(applicant?.pan || applicant?.personal?.pan || '').toUpperCase().trim();

// Same value for the same preferences regardless of key order.
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

// The fields the cloud stores (the app adds `scheme` to the active applicant).
const CLOUD_PREF_KEYS = ['locality', 'sector', 'pocket', 'block', 'tower', 'flatNo'];

export function prefsHash(preferences) {
  const picked = {};
  for (const key of CLOUD_PREF_KEYS) {
    let value = preferences?.[key];
    if (key === 'flatNo') {
      const list = Array.isArray(value) ? value : String(value ?? '').split(',');
      value = list.map((f) => String(f).trim().toUpperCase()).filter(Boolean);
    } else if (value !== undefined && value !== null) {
      value = String(value).trim();
    }
    picked[key] = value ?? '';
  }
  const text = stable(picked);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

// Fast Payment set in the app's sidebar is kept beside the flat preferences in
// the same entry: { fastPayment, fastPaymentBase }, where fastPaymentBase is
// the cloud's choice (web form) it was made on top of.
export function fastPaymentKey(fp) {
  const gateway = fp?.gateway === 'sbi' || fp?.gateway === 'cbi' ? fp.gateway : '';
  if (!gateway) return '';
  const method = gateway === 'sbi' || fp?.method === 'netbanking' ? 'netbanking' : 'card';
  return stable({ gateway, method, bank: method === 'netbanking' ? String(fp?.bank || '') : '' });
}

// The applicant with its local flat preferences and Fast Payment on top
// (unchanged if none).
export function applyLocalPrefs(applicant, localPrefs = {}) {
  if (!applicant) return applicant;
  const entry = localPrefs[panOf(applicant)];
  if (!entry?.preferences && !entry?.fastPayment) return applicant;
  const override = entry.preferences || {};
  return {
    ...applicant,
    preferences: {
      ...(applicant.preferences || {}),
      ...override,
      flatNo: override.flatNo !== undefined ? override.flatNo : (applicant.preferences?.flatNo || []),
      // The sidebar's Fast Payment, else the web form's
      fastPayment: entry.fastPayment || applicant.preferences?.fastPayment,
    },
  };
}

// True when the applicant's flats/locality differ from the cloud's.
export function hasLocalPrefs(applicant, localPrefs = {}) {
  return Boolean(localPrefs[panOf(applicant)]?.preferences);
}

// Drops entries whose applicant is gone, and the flat part or Fast Payment
// part of an entry whose cloud copy changed since the local change.
// `cloudApplicants` must be a fresh cloud list. An entry with a part dropped
// but another kept is listed in `trimmed` (to be saved again).
export function reconcileLocalPrefs(localPrefs = {}, cloudApplicants = []) {
  const byPan = new Map(cloudApplicants.map((a) => [panOf(a), a]));
  const kept = {};
  const dropped = [];
  const trimmed = [];
  for (const [pan, entry] of Object.entries(localPrefs)) {
    const cloud = byPan.get(pan);
    if (!cloud) {
      dropped.push({ pan, reason: 'removed' });
      continue;
    }
    const name = cloud.personal?.firstName || pan;
    const next = { ...entry };
    const notes = [];
    if (next.preferences && next.baseHash && next.baseHash !== prefsHash(cloud.preferences)) {
      delete next.preferences;
      delete next.baseHash;
      notes.push('changed');
    }
    if (next.fastPayment && (next.fastPaymentBase || '') !== fastPaymentKey(cloud.preferences?.fastPayment)) {
      delete next.fastPayment;
      delete next.fastPaymentBase;
      notes.push('paymentChanged');
    }
    if (!next.preferences && !next.fastPayment) {
      dropped.push({ pan, reason: notes[0] || 'changed', reasons: notes, name });
    } else {
      kept[pan] = next;
      if (notes.length) trimmed.push({ pan, reasons: notes, name, entry: next });
    }
  }
  return { kept, dropped, trimmed };
}
