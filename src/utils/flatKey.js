// One rule for "is this the same flat?": DDA and the applicant's preferences may write a
// ground-floor flat as "1" or "01". A label that is only digits is compared without its
// leading zeros; any other label as written (case and spaces ignored).
// Same rule as ddaFlatKey() in preload-dda.js and flatKey in the injected search poller.
export function flatKey(f) {
  const s = String(f == null ? '' : f).trim().toUpperCase().replace(/\s+/g, '');
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}
