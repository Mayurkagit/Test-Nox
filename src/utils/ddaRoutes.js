// DDA Portal Route & Stage Definitions for Context-Aware Sidebar & Automation

export function isLoginUrl(url = '') {
  if (!url) return true;
  try {
    const parsed = new URL(url, 'https://eservices.dda.org.in');
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    return path === '/user' || path === '/user/login' || path === '/login' || path === '';
  } catch (_) {
    const clean = url.split('?')[0].split('#')[0].toLowerCase().replace(/\/+$/, '');
    return clean.endsWith('/user') || clean.endsWith('/user/login') || clean.endsWith('/login');
  }
}

export const DDA_STAGES = [
  {
    id: 'LOGIN',
    num: 1,
    label: 'Login',
    fullTitle: 'Login & Verification',
    badge: 'Auth Portal',
    color: 'indigo',
    match: (url = '') => isLoginUrl(url),
    defaultUrl: 'https://eservices.dda.org.in/user'
  },
  {
    id: 'SCHEME',
    num: 2,
    label: 'Scheme',
    fullTitle: 'Scheme Selection',
    badge: 'Scheme Catalog',
    color: 'indigo',
    match: (url = '') => {
      const u = url.toLowerCase();
      return u.includes('schemelist') || (u.includes('scheme') && !u.includes('step') && !u.includes('application'));
    },
    defaultUrl: 'https://eservices.dda.org.in/user/schemeList'
  },
  {
    id: 'APPLICATION_FORM',
    num: 3,
    label: 'Form',
    fullTitle: 'Application Form',
    badge: 'Applicant Data',
    color: 'cyan',
    match: (url = '') => {
      const u = url.toLowerCase();
      return (
        !u.includes('myapplication') &&
        (u.includes('applicationform') ||
          u.includes('applicationfrom') ||
          u.includes('userapplication') ||
          u.includes('fcfsuserapplicantstore') ||
          (u.includes('apply') && !u.includes('schemelist')) ||
          u.includes('applicantdetails'))
      );
    },
    defaultUrl: 'https://eservices.dda.org.in/user/applicationfrom'
  },
  {
    id: 'LOCALITY',
    num: 4,
    label: 'Locality',
    fullTitle: 'Locality & Sector',
    badge: 'Step 1 Form',
    color: 'emerald',
    match: (url = '') => {
      const u = url.toLowerCase();
      return u.includes('step1_form') || u.includes('step1') || u.includes('locality') || u.includes('searchsector') || u.includes('sector');
    },
    defaultUrl: 'https://eservices.dda.org.in/user/step1_form'
  },
  {
    id: 'FLAT_SELECT',
    num: 5,
    label: 'Flat Select',
    fullTitle: 'Flat Booking & Drop',
    badge: 'Live Drop Window',
    color: 'amber',
    match: (url = '') => {
      const u = url.toLowerCase();
      return u.includes('step2_form') || u.includes('step2') || u.includes('flat') || u.includes('getflat') || u.includes('reserve');
    },
    defaultUrl: 'https://eservices.dda.org.in/user/step2_form'
  },
  {
    id: 'PAYMENT_HOLD',
    num: 6,
    label: 'Payment',
    fullTitle: '15-Min Hold & Payment',
    badge: 'Hold Active',
    color: 'rose',
    match: (url = '') => {
      const u = url.toLowerCase();
      return u.includes('getlayout') || u.includes('payment') || u.includes('challan') || u.includes('hold') || u.includes('billdesk');
    },
    defaultUrl: 'https://eservices.dda.org.in/user/getlayout'
  }
];

export function detectDdaStage(url = '') {
  if (!url) return DDA_STAGES.find(s => s.id === 'LOGIN') || DDA_STAGES[0];
  const u = url.toLowerCase();

  // 1. Check if strictly on the login page URL (/user, /user/login)
  const loginStage = DDA_STAGES.find(s => s.id === 'LOGIN');
  if (loginStage && loginStage.match(u)) {
    return loginStage;
  }

  // 2. Check specific post-login stages (SCHEME, APPLICATION_FORM, LOCALITY, FLAT_SELECT, PAYMENT_HOLD)
  for (const stage of DDA_STAGES) {
    if (stage.id !== 'LOGIN' && stage.match(u)) {
      return stage;
    }
  }

  // 3. Fallback for other post-login pages (e.g. /user/profile, /user/dashboard) -> SCHEME stage
  const schemeStage = DDA_STAGES.find(s => s.id === 'SCHEME');
  return schemeStage || DDA_STAGES[1] || DDA_STAGES[0];
}

// How long after landing on the hold page the gateway / bank pages still count
// as part of that payment (DDA's hold is 15 minutes).
export const PAYMENT_FLOW_TTL_MS = 20 * 60 * 1000;

export function isPaymentFlowActive(since) {
  return Boolean(since) && Date.now() - since < PAYMENT_FLOW_TTL_MS;
}

// Which sidebar to show for a page:
//   'login'      DDA login page
//   'scheme'     DDA schemes page
//   'appform'    DDA application form
//   'flatselect' DDA flat select (step2_form)
//   'payment'    DDA hold / payment pages, and any non-DDA page (BillDesk,
//                SBI, the bank) while a payment that started on the hold page
//                is in progress
//   'other'      everything else (locality, other DDA pages, Google, ...)
// Only DDA's own address counts as a DDA page; detectDdaStage's loose
// keyword matching is not used for other sites.
export function getSidebarMode(url = '', paymentFlowSince = 0) {
  let host = '';
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch (_) {}
  if (!url) return 'login';
  if (host !== 'eservices.dda.org.in') {
    return isPaymentFlowActive(paymentFlowSince) ? 'payment' : 'other';
  }
  if (isLoginUrl(url)) return 'login';
  if (path.includes('/user/schemelist')) return 'scheme';
  if (path.includes('step2_form')) return 'flatselect';
  if (/getlayout|makepayment|challan/.test(path) || (path.includes('payment') && !path.includes('getpaymentresult'))) {
    return 'payment';
  }
  if (detectDdaStage(url).id === 'APPLICATION_FORM') return 'appform';
  return 'other';
}

// The DDA pages that start / continue a payment (hold page and DDA's own
// payment redirects). Landing on any other DDA page ends the payment flow.
export function isDdaPaymentPage(url = '') {
  return getSidebarMode(url, 0) === 'payment';
}
