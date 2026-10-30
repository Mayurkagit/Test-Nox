import paymentBanks from '../../payment_banks.json';

// Each gateway's BillDesk net-banking list, names exactly as BillDesk shows
// them. SBI's gateway reaches SBI itself through "SBI Net Banking" on SBI's
// own page, so there State Bank of India gets its own group.
export const PAYMENT_BANKS = paymentBanks.banks;
export const SBI_ID = 'statebankofindia';
export const DEFAULT_BANK = { cbi: 'centralbankofindia', sbi: SBI_ID };
export const banksFor = (gw) => PAYMENT_BANKS.filter((b) => (b.gateways || []).includes(gw));
const byId = (a, b) => a.id.localeCompare(b.id);
export const BANK_GROUPS = {
  cbi: [
    ['Top banks', banksFor('cbi').filter((b) => b.top)],
    ['All other banks', banksFor('cbi').filter((b) => !b.top).sort(byId)],
  ],
  sbi: [
    ["SBI's own net banking", banksFor('sbi').filter((b) => b.id === SBI_ID)],
    ['Other banks · Top banks', banksFor('sbi').filter((b) => b.top && b.id !== SBI_ID)],
    ['Other banks · All other banks', banksFor('sbi').filter((b) => !b.top).sort(byId)],
  ],
};
const bankOnGateway = (id, gw) => banksFor(gw).some((b) => b.id === id);

// Older settings used short ids ("cbi", "pnb"); map them to BillDesk's, and
// fall back to the gateway's default when the bank isn't on that gateway.
export const resolveBankId = (v, gw) => {
  const w = String(v || '').toLowerCase();
  const id = paymentBanks.legacy?.[w] || w;
  return bankOnGateway(id, gw) ? id : DEFAULT_BANK[gw] || DEFAULT_BANK.cbi;
};

// { gateway, method, bank } with SBI always net banking; gateway '' = not set.
export const normalizeFastPayment = (fp) => {
  const gateway = fp?.gateway === 'sbi' || fp?.gateway === 'cbi' ? fp.gateway : '';
  if (!gateway) return { gateway: '', method: '', bank: '' };
  const method = gateway === 'sbi' || fp?.method === 'netbanking' ? 'netbanking' : 'card';
  const out = { gateway, method, bank: method === 'netbanking' ? resolveBankId(fp?.bank, gateway) : '' };
  // 'pc': pay with the card ticked on this PC even when the applicant has a card on the website
  if (method === 'card' && fp?.cardSource === 'pc') out.cardSource = 'pc';
  return out;
};

// The website card mask ends "(MM/YY)": true when that month has passed
export const maskedCardExpired = (mask, now = new Date()) => {
  const m = /\((\d{2})\/(\d{2})\)\s*$/.exec(String(mask || ''));
  if (!m) return false;
  const yy = now.getFullYear() % 100;
  const y = Number(m[2]);
  return y < yy || (y === yy && Number(m[1]) < now.getMonth() + 1);
};

// "CBI · Card", "SBI · Net banking · HDFC Bank", '' when not set
export const describeFastPayment = (fp) => {
  const f = normalizeFastPayment(fp);
  if (!f.gateway) return '';
  const gw = f.gateway.toUpperCase();
  if (f.method === 'card') return `${gw} · Card${f.cardSource === 'pc' ? " · this PC's card" : ''}`;
  const bank = PAYMENT_BANKS.find((b) => b.id === f.bank);
  return `${gw} · Net banking${bank ? ` · ${bank.name}` : ''}`;
};
