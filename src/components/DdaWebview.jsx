import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useApplicantStore, useAutomationStore } from '../store';
import { BEEP_OGG_BASE64 } from '../utils/beepData';
import BankLoginSaveBar from './BankLoginSaveBar';

let lastBeepTimestamp = 0;
function playFlatSelectBeep() {
  const now = Date.now();
  if (now - lastBeepTimestamp < 500) return; // Prevent double trigger
  lastBeepTimestamp = now;
  try {
    const audio = new Audio(BEEP_OGG_BASE64);
    audio.play().catch(() => {
      try {
        const audioFallback = new Audio('./beep_short.ogg');
        audioFallback.play().catch(() => {});
      } catch (_) {}
    });
  } catch (_) {
    try {
      const audioFallback = new Audio('./beep_short.ogg');
      audioFallback.play().catch(() => {});
    } catch (_) {}
  }
}

const DDA_GLOBAL_FOOTER_CSS = `
  /* Universal DDA Footer Removal across all pages */
  footer,
  .footerarea,
  .footarea,
  .footer-area,
  .footer-bottom,
  .footer-section,
  .copyright,
  .copyrights,
  .footbg,
  body > footer,
  #footer,
  .footer:not(.modal-footer),
  p.copyright,
  .row:has(> .copyright),
  .col-12:has(> .copyright),
  div:has(> p.copyright) {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    overflow: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
`;

const DdaWebview = forwardRef(({ 
  partition: propPartition, 
  activeApplicant: propActiveApplicant, 
  onUrlChange: propOnUrlChange, 
  onLoadingChange: propOnLoadingChange, 
  onLog: propOnLog 
}, ref) => {
  const storeActiveApplicant = useApplicantStore((s) => s.activeApplicant);
  const storeSetCurrentUrl = useAutomationStore((s) => s.setCurrentUrl);
  const storeSetPageLoading = useAutomationStore((s) => s.setPageLoading);
  const storeAddLog = useAutomationStore((s) => s.addLog);

  const activeApplicant = propActiveApplicant !== undefined ? propActiveApplicant : storeActiveApplicant;
  const onUrlChange = propOnUrlChange || storeSetCurrentUrl;
  const onLoadingChange = propOnLoadingChange || storeSetPageLoading;
  const onLog = propOnLog || storeAddLog;

  const cleanPartition = propPartition 
    ? (propPartition.startsWith('persist:') ? propPartition : `persist:dda_${propPartition.toLowerCase().replace(/[^a-z0-9_]/g, '')}`)
    : (() => {
        try {
          const sp = new URLSearchParams(window.location.search);
          const s = sp.get('winSession');
          if (s) return `persist:dda_${s.toLowerCase().replace(/[^a-z0-9_]/g, '')}`;
          const stored = sessionStorage.getItem('dda_win_session');
          if (stored) return `persist:dda_${stored.toLowerCase().replace(/[^a-z0-9_]/g, '')}`;
        } catch (_) {}
        return 'persist:dda_session_1';
      })();

  const webviewRef = useRef(null);
  const autoRetryTimerRef = useRef(null);
  const loadingWatchdogRef = useRef(null);

  const activeApplicantRef = useRef(activeApplicant);
  activeApplicantRef.current = activeApplicant;

  const onUrlChangeRef = useRef(onUrlChange);
  onUrlChangeRef.current = onUrlChange;

  const onLoadingChangeRef = useRef(onLoadingChange);
  onLoadingChangeRef.current = onLoadingChange;

  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  const preloadUrl = window.ddaElectronAPI?.ddaPreloadUrl || '';

  // ─── PAYMENT GATEWAY ARRIVAL WATCHER ─────────────────────────────────────
  // Detects when the webview arrives at BillDesk/CBI/SBI payment gateway.
  // The renderer never injects into the gateway; the only gateway automation is
  // the preload's BillDesk card flow, which main gates to one Pay click.
  const GATEWAY_URL_PATTERNS = [
    'billdesk', 'pgi.billdesk.com', 'pguat.billdesk.com',
    'pay.sbi', 'onlinesbi', 'securepay', 'paynow',
    'centralbank', 'cbi', 'sbi', 'gateway'
  ];

  const isPaymentGatewayUrl = (url) => {
    if (!url) return false;
    const u = url.toLowerCase();
    // Must NOT be on the DDA portal itself (those are handled by the hold page logic)
    if (u.includes('eservices.dda.org.in')) return false;
    return GATEWAY_URL_PATTERNS.some(p => u.includes(p));
  };

  const hasAnnouncedGatewayArrivalRef = useRef(false);

  const handlePaymentGatewayArrival = (url) => {
    if (!isPaymentGatewayUrl(url)) {
      if (url && url.toLowerCase().includes('eservices.dda.org.in')) {
        hasAnnouncedGatewayArrivalRef.current = false;
      }
      return;
    }

    // Immediately clear fast payment approval tokens
    try {
      window.__ddaFastPaymentApproved = false;
      sessionStorage.removeItem('dda_fast_payment_approved');
    } catch (_) {}

    if (!hasAnnouncedGatewayArrivalRef.current) {
      hasAnnouncedGatewayArrivalRef.current = true;
      const log = onLogRef.current || useAutomationStore.getState().addLog;
      log('SUCCESS', 'Payment', '🚀 Landed on Payment Gateway.');
    }
  };

  useImperativeHandle(ref, () => ({
    goBack: () => {
      if (webviewRef.current?.canGoBack()) webviewRef.current.goBack();
    },
    goForward: () => {
      if (webviewRef.current?.canGoForward()) webviewRef.current.goForward();
    },
    reload: () => {
      try {
        if (webviewRef.current?.reload) {
          webviewRef.current.reload();
        } else if (webviewRef.current?.src) {
          webviewRef.current.src = webviewRef.current.src;
        }
      } catch (err) {
        console.error('Reload error:', err);
      }
    },
    reloadIgnoringCache: () => {
      try {
        if (webviewRef.current?.reloadIgnoringCache) {
          webviewRef.current.reloadIgnoringCache();
        } else if (webviewRef.current?.reload) {
          webviewRef.current.reload();
        }
      } catch (err) {
        console.error('reloadIgnoringCache error:', err);
      }
    },
    stop: () => {
      try {
        webviewRef.current?.stop?.();
      } catch (_) {}
    },
    loadURL: (url) => {
      try {
        webviewRef.current?.loadURL(url);
      } catch (_) {}
    },
    executeJavaScript: async (code) => {
      try {
        if (!webviewRef.current) return null;
        return await webviewRef.current.executeJavaScript(code);
      } catch (_) {
        return null;
      }
    }
  }));

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    window.__openWebviewDevTools = () => {
      try {
        if (typeof webview.openDevTools === 'function') {
          webview.openDevTools({ mode: 'detach' });
          return;
        }
      } catch (_) {}
      window.ddaElectronAPI?.openWebviewDevTools?.();
    };

    // 🌐 Prime warm TLS sockets and DNS resolution for DDA portal
    window.ddaElectronAPI?.preconnect?.('https://eservices.dda.org.in', cleanPartition)?.catch?.(() => {});

    // Ensure webview initiates load if Chromium custom element didn't auto-navigate from src attribute
    const ensureLoadTimer = setTimeout(() => {
      try {
        if (webview && !webview.isLoading?.() && (!webview.getURL || !webview.getURL())) {
          console.log('🔄 [DdaWebview] Initiating loadURL fallback to https://eservices.dda.org.in/user');
          webview.loadURL?.('https://eservices.dda.org.in/user');
        }
      } catch (_) {}
    }, 600);

    const handleDidNavigate = (e) => {
      try {
        useAutomationStore.getState().setLastNavInfo({ url: e.url, code: e.httpResponseCode, ts: Date.now() });
      } catch (_) {}
      onUrlChangeRef.current?.(e.url);
      const url = (e.url || '').toLowerCase();
      try {
        webview.insertCSS?.(DDA_GLOBAL_FOOTER_CSS);
      } catch (_) {}
      const isFlatPage = url.includes('step2_form') || url.includes('step2') || url.includes('flat') || url.includes('getflat');
      if (isFlatPage) {
        try {
          webview.insertCSS?.(`
            .sidebar-nav, .banner, .flatcircle, .bluebg-title, .flat-searc-wraper,
            .boxshadowcontainer > .row:has(.flatcircle), .boxshadowcontainer > .row:has(.bluebg-title) {
              display: none !important;
            }
            .midarea .col-md-10, .col-12.col-sm-12.col-md-10, .col-md-10 {
              flex: 0 0 100% !important;
              max-width: 100% !important;
              width: 100% !important;
            }
            .boxshadowcontainer {
              padding-top: 2px !important;
              padding-bottom: 2px !important;
              margin-top: 0 !important;
              border-top: none !important;
              box-shadow: none !important;
            }
            .boxshadowcontainer.borderbottom {
              border-bottom: none !important;
            }
            .notification {
              display: flex !important;
              align-items: center !important;
              justify-content: space-between !important;
              flex-wrap: wrap !important;
              gap: 8px !important;
              padding: 6px 14px !important;
              margin-top: 2px !important;
              margin-bottom: 2px !important;
              min-height: 32px !important;
            }
            /* Stealth Background Modal: Hide from screen during auto-submit */
            body:not(.dda-manual-submit-mode) #myModal,
            body:not(.dda-manual-submit-mode) #flatDetailModal,
            body:not(.dda-manual-submit-mode) .modal[id*="Modal"],
            body:not(.dda-manual-submit-mode) .modal {
              opacity: 0 !important;
              pointer-events: none !important;
              position: fixed !important;
              top: -9999px !important;
              left: -9999px !important;
              z-index: -9999 !important;
              transform: scale(0.001) !important;
            }
            body:not(.dda-manual-submit-mode) .modal-backdrop {
              display: none !important;
              opacity: 0 !important;
              pointer-events: none !important;
              z-index: -9999 !important;
            }
          `);
        } catch (_) {}
      } else {
        useAutomationStore.getState().setFlatAvailability({
          isFlatSelectPage: false,
          isGridLoaded: false,
          totalAvailable: 0,
          availableFlats: [],
          noneTargetAvailable: false,
          checkedAt: Date.now()
        });
      }

      if (url.includes('/logout') || url.includes('/signout')) {
        const currentActive = useApplicantStore.getState().activeApplicant;
        const pan = currentActive?.pan || currentActive?.personal?.pan || activeApplicantRef.current?.pan;
        console.log('🚪 [DdaWebview] DDA Logout URL navigated for PAN:', pan);
        useAutomationStore.getState().clearLogs();
        useAutomationStore.getState().addLog('INFO', 'DDA Portal', `Applicant (${pan || 'Active'}) logged out of DDA website.`, pan);
      }

      // 💳 Payment Gateway Arrival: Detect arrival at external gateway and halt automation
      handlePaymentGatewayArrival(e.url);
    };

    const handleInPageNavigate = (e) => {
      onUrlChangeRef.current?.(e.url);
      const url = (e.url || '').toLowerCase();
      try {
        webview.insertCSS?.(DDA_GLOBAL_FOOTER_CSS);
      } catch (_) {}
      const isFlatPage = url.includes('step2_form') || url.includes('step2') || url.includes('flat') || url.includes('getflat');
      if (isFlatPage) {
        try {
          webview.insertCSS?.(`
            .sidebar-nav, .banner, .flatcircle, .bluebg-title, .flat-searc-wraper,
            .boxshadowcontainer > .row:has(.flatcircle), .boxshadowcontainer > .row:has(.bluebg-title) {
              display: none !important;
            }
            .midarea .col-md-10, .col-12.col-sm-12.col-md-10, .col-md-10 {
              flex: 0 0 100% !important;
              max-width: 100% !important;
              width: 100% !important;
            }
            .boxshadowcontainer {
              padding-top: 2px !important;
              padding-bottom: 2px !important;
              margin-top: 0 !important;
              border-top: none !important;
              box-shadow: none !important;
            }
            .boxshadowcontainer.borderbottom {
              border-bottom: none !important;
            }
            .notification {
              display: flex !important;
              align-items: center !important;
              justify-content: space-between !important;
              flex-wrap: wrap !important;
              gap: 8px !important;
              padding: 6px 14px !important;
              margin-top: 2px !important;
              margin-bottom: 2px !important;
              min-height: 32px !important;
            }
            /* Stealth Background Modal: Hide from screen during auto-submit */
            body:not(.dda-manual-submit-mode) #myModal,
            body:not(.dda-manual-submit-mode) #flatDetailModal,
            body:not(.dda-manual-submit-mode) .modal[id*="Modal"],
            body:not(.dda-manual-submit-mode) .modal {
              opacity: 0 !important;
              pointer-events: none !important;
              position: fixed !important;
              top: -9999px !important;
              left: -9999px !important;
              z-index: -9999 !important;
              transform: scale(0.001) !important;
            }
            body:not(.dda-manual-submit-mode) .modal-backdrop {
              display: none !important;
              opacity: 0 !important;
              pointer-events: none !important;
              z-index: -9999 !important;
            }
          `);
        } catch (_) {}
      } else {
        useAutomationStore.getState().setFlatAvailability({
          isFlatSelectPage: false,
          isGridLoaded: false,
          totalAvailable: 0,
          availableFlats: [],
          noneTargetAvailable: false,
          checkedAt: Date.now()
        });
      }

      if (url.includes('getlayout') || url.includes('payment') || url.includes('challan') || url.includes('hold')) {
        useAutomationStore.getState().setIsConsoleMinimized(true);
      }

      if (url.includes('/logout') || url.includes('/signout')) {
        const currentActive = useApplicantStore.getState().activeApplicant;
        const pan = currentActive?.pan || currentActive?.personal?.pan || activeApplicantRef.current?.pan;
        console.log('🚪 [DdaWebview] DDA Logout URL navigated for PAN:', pan);
        useAutomationStore.getState().clearLogs();
        useAutomationStore.getState().addLog('INFO', 'DDA Portal', `Applicant (${pan || 'Active'}) logged out of DDA website.`, pan);
      }

      // 💳 Payment Gateway Arrival on in-page navigation
      handlePaymentGatewayArrival(e.url);
    };

    const handleDomReady = () => {
      if (loadingWatchdogRef.current) clearTimeout(loadingWatchdogRef.current);
      onLoadingChangeRef.current?.(false);
      const rawUrl = webview?.getURL?.() || '';
      if (rawUrl) onUrlChangeRef.current?.(rawUrl);
      const url = rawUrl.toLowerCase();
      try {
        webview.insertCSS?.(DDA_GLOBAL_FOOTER_CSS);
      } catch (_) {}
      if (url.includes('step2_form') || url.includes('step2') || url.includes('flat') || url.includes('getflat')) {
        try {
          webview.insertCSS?.(`
            .sidebar-nav, .banner, .flatcircle, .bluebg-title, .flat-searc-wraper,
            .boxshadowcontainer > .row:has(.flatcircle), .boxshadowcontainer > .row:has(.bluebg-title) {
              display: none !important;
            }
            .midarea .col-md-10, .col-12.col-sm-12.col-md-10, .col-md-10 {
              flex: 0 0 100% !important;
              max-width: 100% !important;
              width: 100% !important;
            }
            .boxshadowcontainer {
              padding-top: 2px !important;
              padding-bottom: 2px !important;
              margin-top: 0 !important;
              border-top: none !important;
              box-shadow: none !important;
            }
            .boxshadowcontainer.borderbottom {
              border-bottom: none !important;
            }
            .notification {
              display: flex !important;
              align-items: center !important;
              justify-content: space-between !important;
              flex-wrap: wrap !important;
              gap: 8px !important;
              padding: 6px 14px !important;
              margin-top: 2px !important;
              margin-bottom: 2px !important;
              min-height: 32px !important;
            }
          `);
        } catch (_) {}
      }

      // 🛡️ Error Auto-Recovery: Detect 502/504 Bad Gateway, Gateway Timeout, or Database Error pages
      try {
        webview.executeJavaScript(`
          (() => {
            const text = (document.body?.innerText || '').toLowerCase();
            const title = (document.title || '').toLowerCase();
            return (
              title.includes('502 bad gateway') ||
              title.includes('504 gateway') ||
              title.includes('database error') ||
              text.includes('502 bad gateway') ||
              text.includes('504 gateway time-out') ||
              text.includes('database connection error') ||
              text.includes('error establishing a database connection') ||
              text.includes('an error occurred while processing your request')
            );
          })()
        `).then((isError) => {
          if (isError) {
            useAutomationStore.getState().addLog(
              'WARN',
              'Recovery',
              '⚠️ Server error page detected (502/504/Database Error). Auto-recovering in 1.5s...'
            );
            if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
            autoRetryTimerRef.current = setTimeout(() => {
              // The Multi-Reload loop owns reloading while it runs
              if (useAutomationStore.getState().isMultiReloading) return;
              try {
                if (webview.reloadIgnoringCache) webview.reloadIgnoringCache();
                else webview.reload?.();
              } catch (_) {}
            }, 1500);
          }
        }).catch(() => {});
      } catch (_) {}

      // 💳 Payment Gateway Arrival on dom-ready
      handlePaymentGatewayArrival(rawUrl);
    };

    const handleStartLoading = () => {
      onLoadingChangeRef.current?.(true);
      if (loadingWatchdogRef.current) clearTimeout(loadingWatchdogRef.current);
      loadingWatchdogRef.current = setTimeout(() => {
        onLoadingChangeRef.current?.(false);
      }, 4000);
    };

    const handleStopLoading = () => {
      if (loadingWatchdogRef.current) clearTimeout(loadingWatchdogRef.current);
      try {
        useAutomationStore.getState().setLastStopInfo({ ts: Date.now() });
      } catch (_) {}
      onLoadingChangeRef.current?.(false);
    };

    const handleFailLoad = (e) => {
      if (loadingWatchdogRef.current) clearTimeout(loadingWatchdogRef.current);
      onLoadingChangeRef.current?.(false);
      if (e?.isMainFrame && e?.errorCode !== -3 /* ABORTED (our own stop()) */) {
        try {
          useAutomationStore.getState().setLastNavInfo({
            failed: true,
            errorCode: e.errorCode,
            errorDescription: e.errorDescription,
            url: e.validatedURL,
            ts: Date.now(),
          });
        } catch (_) {}
      }
      // The Multi-Reload loop owns reloading while it runs
      if (useAutomationStore.getState().isMultiReloading) return;
      // Auto-retry on network connection drops or timeouts
      if (e?.isMainFrame && e?.errorCode !== -3 /* ABORTED */) {
        useAutomationStore.getState().addLog(
          'WARN',
          'Recovery',
          `⚠️ Page load failed (${e.errorDescription || 'Connection error'}). Auto-retrying in 2s...`
        );
        if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
        autoRetryTimerRef.current = setTimeout(() => {
          if (useAutomationStore.getState().isMultiReloading) return;
          try {
            if (webview.reloadIgnoringCache) webview.reloadIgnoringCache();
            else webview.reload?.();
          } catch (_) {}
        }, 2000);
      }
    };

    const handleConsoleMessage = (e) => {
      const msg = e.message || '';
      if (msg.includes("Bootstrap's JavaScript requires at least jQuery")) {
        return; // Suppress Bootstrap/jQuery error noise
      }
      if (msg.includes('__DDA_WEBVIEW_CLICKED__')) {
        window.dispatchEvent(new CustomEvent('dda-close-popovers'));
      }

      // Parse injected automation logs from webview
      if (msg.startsWith('__DDA_LOG__:')) {
        try {
          const log = JSON.parse(msg.slice('__DDA_LOG__:'.length));
          const targetPan = log.pan || activeApplicantRef.current?.pan || useApplicantStore.getState().activeApplicant?.pan;
          (onLogRef.current || useAutomationStore.getState().addLog)(
            log.level || 'INFO',
            log.page || 'Search',
            log.msg || '',
            targetPan
          );
          if ((log.level === 'SUCCESS' || log.level === 'WARN') && (log.page === 'Search' || log.page === 'Timed Search')) {
            useAutomationStore.getState().setIsSearching(false);
            useAutomationStore.getState().setSearchRemainingSec(null);
            if (log.level === 'SUCCESS' && log.page === 'Search') {
              useAutomationStore.getState().setIsStep2SidebarCollapsed(true);
            }
          }
        } catch (_) {}
      }

      if (e.level >= 3) {
        console.error(
          `%c[Webview]%c ${msg}`,
          'background: #000000; color: #f87171; font-weight: bold; padding: 1px 5px; border-radius: 3px;',
          'color: inherit;'
        );
      } else {
        console.log(
          `%c[Webview]%c ${msg}`,
          'background: #000000; color: #ffffff; font-weight: bold; padding: 1px 5px; border-radius: 3px;',
          'color: inherit;'
        );
      }
    };

    const handleIpcMessage = (e) => {
      if (e.channel === 'dda:log') {
        const log = e.args?.[0] || {};
        // Gateway and bank pages aren't given the applicant, so a PAN they
        // send is whatever that site's storage last held (an earlier
        // payment's applicant): their lines take this window's applicant.
        let fromDda = true;
        try { fromDda = new URL(e.target?.getURL?.() || '').hostname === 'eservices.dda.org.in'; } catch (_) {}
        const targetPan = (fromDda ? log.pan : '') || activeApplicantRef.current?.pan || useApplicantStore.getState().activeApplicant?.pan;
        const page = log.page || 'Search';
        const msg = log.msg || log.message || '';
        (onLogRef.current || useAutomationStore.getState().addLog)(
          log.level || 'INFO',
          page,
          msg,
          targetPan
        );
        if ((log.level === 'SUCCESS' || log.level === 'WARN') && (page === 'Search' || page === 'Timed Search')) {
          useAutomationStore.getState().setIsSearching(false);
          useAutomationStore.getState().setSearchRemainingSec(null);
          if (log.level === 'SUCCESS' && page === 'Search') {
            useAutomationStore.getState().setIsStep2SidebarCollapsed(true);
          }
        }
      } else if (e.channel === 'dda:flat-selected') {
        const data = e.args?.[0] || {};
        // Hold confirmed on the hold page: only record it (telemetry fallback).
        // The sidebar stays open there: it shows the held flat, the countdown
        // and FAST PAY.
        if (data.holdConfirmed === true) {
          window.__ddaHoldConfirmedAt = Date.now();
          return;
        }
        if (data.flatNo) {
          try { sessionStorage.setItem('dda_reserved_flat_no', String(data.flatNo)); } catch (_) {}
          useAutomationStore.getState().setReservedFlatDetails({ flatNo: String(data.flatNo) });
        }
        if (data.reserved === true) {
          playFlatSelectBeep();
          // Drop any expiry left from an earlier booking; the hold page then
          // reports DDA's exact countdown (not always a full 15 minutes).
          useAutomationStore.setState((st) => ({
            reservedFlatDetails: { ...st.reservedFlatDetails, holdExpiresAt: null },
          }));
        }
        useAutomationStore.getState().setIsSearching(false);
        useAutomationStore.getState().setSearchRemainingSec(null);
        useAutomationStore.getState().setIsStep2SidebarCollapsed(true);
        useAutomationStore.getState().setIsConsoleMinimized(true);
        window.dispatchEvent(new CustomEvent('dda-step2-flat-selected'));
      } else if (e.channel === 'dda:payment-hold-info') {
        const data = e.args?.[0] || {};
        if (data.flatNo) {
          try { sessionStorage.setItem('dda_reserved_flat_no', String(data.flatNo)); } catch (_) {}
        }
        useAutomationStore.getState().setReservedFlatDetails(data);
      } else if (e.channel === 'dda:reset-run-logs') {
        useAutomationStore.setState((state) => ({
          logs: state.logs.filter((l) => l.source === 'Heartbeat' || (l.message || '').includes('💓 Ping'))
        }));
      } else if (e.channel === 'dda:flat-availability') {
        const data = e.args?.[0] || {};
        useAutomationStore.getState().setFlatAvailability(data);
      } else if (e.channel === 'dda:applicant-logout') {
        const data = e.args?.[0] || {};
        const currentActive = useApplicantStore.getState().activeApplicant;
        const pan = data.pan || currentActive?.pan || currentActive?.personal?.pan || activeApplicantRef.current?.pan;
        console.log('🚪 [DdaWebview] Applicant logout detected for PAN:', pan);
        useAutomationStore.getState().clearLogs();
        useAutomationStore.getState().addLog('INFO', 'DDA Portal', `Applicant (${pan || 'Active'}) logged out of DDA website.`, pan);
      } else if (e.channel === 'dda:user-logged-in') {
        const data = e.args?.[0] || {};
        window.dispatchEvent(new CustomEvent('dda:user-logged-in', { detail: data }));
      } else if (e.channel === 'dda:prompt-save-password') {
        const data = e.args?.[0] || {};
        window.dispatchEvent(new CustomEvent('dda:prompt-save-password', { detail: data }));
      } else if (e.channel === 'dda:login-invalid-credentials') {
        const data = e.args?.[0] || {};
        window.dispatchEvent(new CustomEvent('dda:login-invalid-credentials', { detail: data }));
      } else if (e.channel === 'dda:payment-result') {
        const data = e.args?.[0] || {};
        window.dispatchEvent(new CustomEvent('dda:payment-result', { detail: data }));
      } else if (e.channel === 'dda:update-profile-name') {
        const data = e.args?.[0] || {};
        window.dispatchEvent(new CustomEvent('dda:update-profile-name', { detail: data }));
      } else if (e.channel === 'dda:captcha-solved') {
        const data = e.args?.[0] || {};
        if (data.text) {
          useAutomationStore.getState().setCaptchaInputVal(String(data.text));
        }
        if (data.dataUrl) {
          useAutomationStore.getState().setCaptchaDataUrl(data.dataUrl);
          useAutomationStore.getState().setLastSolvedCaptchaDataUrl(data.dataUrl);
        }
      } else if (e.channel === 'dda:otp-reached' || e.channel === 'dda:play-chime') {
        playFlatSelectBeep();
      }
    };

    const handleFocus = () => {
      window.dispatchEvent(new CustomEvent('dda-close-popovers'));
    };

    webview.addEventListener('did-navigate', handleDidNavigate);
    webview.addEventListener('did-navigate-in-page', handleInPageNavigate);
    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('did-fail-load', handleFailLoad);
    webview.addEventListener('console-message', handleConsoleMessage);
    webview.addEventListener('ipc-message', handleIpcMessage);
    webview.addEventListener('focus', handleFocus);

    const unsubFlatSelected = window.ddaElectronAPI?.onFlatSelected?.((data) => {
      // reserved: DDA reserved the flat (status 0) → chime at once.
      // holdConfirmed: the hold page confirmed it; Workspace's telemetry
      // fallback waits for this.
      if (data?.reserved === true) playFlatSelectBeep();
      if (data?.holdConfirmed === true) window.__ddaHoldConfirmedAt = Date.now();
      if (data?.flatNo) {
        try { sessionStorage.setItem('dda_reserved_flat_no', String(data.flatNo)); } catch (_) {}
        useAutomationStore.getState().setReservedFlatDetails({ flatNo: String(data.flatNo) });
      }
      useAutomationStore.getState().setIsConsoleMinimized(true);
    });

    const unsubPaymentHold = window.ddaElectronAPI?.onPaymentHoldInfo?.((data) => {
      if (data?.flatNo) {
        try { sessionStorage.setItem('dda_reserved_flat_no', String(data.flatNo)); } catch (_) {}
      }
      useAutomationStore.getState().setReservedFlatDetails(data);
    });

    return () => {
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleInPageNavigate);
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('did-fail-load', handleFailLoad);
      webview.removeEventListener('console-message', handleConsoleMessage);
      webview.removeEventListener('ipc-message', handleIpcMessage);
      webview.removeEventListener('focus', handleFocus);
      unsubFlatSelected?.();
      unsubPaymentHold?.();
      if (ensureLoadTimer) clearTimeout(ensureLoadTimer);
      if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
      if (loadingWatchdogRef.current) clearTimeout(loadingWatchdogRef.current);
    };
  }, [cleanPartition]);

  return (
    <div className="flex-1 w-full h-full relative bg-white">
      <webview
        ref={webviewRef}
        src="https://eservices.dda.org.in/user"
        preload={preloadUrl}
        partition={cleanPartition}
        allowpopups="true"
        webpreferences="webSecurity=no, contextIsolation=no"
        className="w-full h-full border-0"
      />
      <BankLoginSaveBar webviewRef={webviewRef} />
    </div>
  );
});

export default DdaWebview;
