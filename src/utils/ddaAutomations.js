// Full-Parity In-Page DOM Injection Scripts for DDA Portal Automation Actions
// Ported directly from high-speed DDA Extension with 0ms in-memory DOM sync,
// AJAX cascading locality solver, fast-pass application store, and OCR integration.

export const KNOWN_APPLICANT_PASSWORDS = {};

// Same as sectorRangeKey / matchBySectorKey in preload-dda.js and
// step2Resolver.js (keep in sync): one sector range, many spellings
// ("SECTOR G-2 & G-6" = "G2 - G6" = "G2 & G6" = "G-2 AND G-6"). Pasted into
// the injected scripts below, which can't reach the page engine's functions.
const SECTOR_KEY_CODE = String.raw`
          function sectorRangeKey(text) {
            let s = String(text || "").toUpperCase();
            s = s.replace(/\b(SECTOR|SEC)\b\.?/g, " ").replace(/\b(AND|TO)\b/g, " ").replace(/[&,/]/g, " ");
            s = s.replace(/\b([A-Z])\s*[-–—_.]?\s*(\d+)\b/g, "$1$2");
            const parts = s.replace(/[-–—_.]/g, " ").split(/\s+/).filter(Boolean);
            return parts.length >= 2 && parts.every((p) => /^[A-Z]\d+$/.test(p)) ? parts.join(" ") : "";
          }
          function matchBySectorKey(options, targetName, nameOf) {
            const key = sectorRangeKey(targetName);
            if (!key || !options || !options.length) return null;
            const hits = options.filter((o) => sectorRangeKey(nameOf(o)) === key);
            return hits.length === 1 ? hits[0] : null;
          }
`;

export const ddaAutomations = {
  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 1: LOGIN & FAST CAPTCHA AUTOMATION
  // ───────────────────────────────────────────────────────────────────────────

  // 1a. Stage: Login Autofill (User ID / PAN, Password, Golden Glow, Enter Key, 2-Digit Auto-Submit)
  getLoginAutofillCode: (applicant, isExplicit = false) => {
    const pan = (applicant?.pan || applicant?.personal?.pan || '').trim().toUpperCase();
    let password = (applicant?.password || applicant?.personal?.password || '').trim();
    if (!password && pan && KNOWN_APPLICANT_PASSWORDS[pan]) {
      password = KNOWN_APPLICANT_PASSWORDS[pan];
    }

    return `
      (() => {
        try {
          if (typeof window.validatePanNo === 'undefined') window.validatePanNo = function () {};
          const knownPasswords = ${JSON.stringify(KNOWN_APPLICANT_PASSWORDS)};
          const targetPan = ${JSON.stringify(pan)};
          let targetPassword = ${JSON.stringify(password)};
          if (!targetPassword && targetPan && knownPasswords[targetPan]) {
            targetPassword = knownPasswords[targetPan];
          }
          const targetApp = ${JSON.stringify(applicant || {})};

          if (targetApp && Object.keys(targetApp).length > 0) {
            window.__ACTIVE_APPLICANT__ = targetApp;
            try {
              localStorage.setItem('window.__ACTIVE_APPLICANT__', JSON.stringify(targetApp));
              if (targetPan) {
                localStorage.setItem('dda_selected_person', targetPan);
                localStorage.setItem('dda_active_applicant_pan', targetPan);
              }
            } catch (_) {}
            try {
              window.dispatchEvent(new CustomEvent('dda:set-applicant', { detail: targetApp }));
            } catch (_) {}
          }

          const setFieldValue = (el, val) => {
            if (!el || val === undefined || val === null) return;
            if (el.value !== val) {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (setter) setter.call(el, val);
              else el.value = val;
              try {
                if (typeof window.jQuery !== 'undefined' && window.jQuery(el).val) window.jQuery(el).val(val);
                else if (typeof window.$ !== 'undefined' && window.$(el).val) window.$(el).val(val);
              } catch (_) {}
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              if (document.activeElement !== el) {
                el.dispatchEvent(new Event('blur', { bubbles: true }));
              }
            }
          };

          // 1. Initial Fill & Refill Helper
          const refillCredentials = (force = false) => {
            const activeEl = document.activeElement;
            const isUserEditing = activeEl && (
              typeof activeEl.matches === 'function' && activeEl.matches('input[name="user_id"], input#user_id, input[name="username"], input[name="login_id"], input[name="pan"], input#pan, input[placeholder*="User ID" i], input[placeholder*="PAN" i], input[type="password"], input#password, input[name="password"], input[name="user_password"]')
            );
            if (isUserEditing && !force) return;
            if (window.__ddaUserManuallyEditedLogin && !force) return;

            const userSelectors = [
              'input[name="user_id"]',
              'input#user_id',
              'input[name="username"]',
              'input[name="login_id"]',
              'input[placeholder*="User ID" i]',
              'input[placeholder*="PAN" i]'
            ];
            for (const sel of userSelectors) {
              const el = document.querySelector(sel);
              if (el && targetPan) {
                setFieldValue(el, targetPan);
                break;
              }
            }

            const passSelectors = [
              'input[type="password"]',
              'input[name="password"]',
              'input#password',
              'input[name="user_password"]'
            ];
            for (const sel of passSelectors) {
              const el = document.querySelector(sel);
              if (el && targetPassword) {
                const currentVal = (el.value || '').trim();
                const isHexHash = /^[a-f0-9]{64}$/i.test(currentVal);
                if (!window.__ddaIsLoginSubmitting && !isHexHash) {
                  setFieldValue(el, targetPassword);
                }
                break;
              }
            }
          };

          const isExplicitAction = ${isExplicit === true ? 'true' : 'false'};
          if (isExplicitAction) {
            window.__ddaUserManuallyEditedLogin = false;
          }
          refillCredentials(isExplicitAction);

          // 2. Watch for SweetAlert Invalid Captcha Modal & Refill on Confirm
          if (!window.__ddaLoginErrorObserver) {
            const observer = new MutationObserver(() => {
              const swal = document.querySelector('.swal2-popup, .swal-modal, .sweet-alert');
              if (swal) {
                const text = (swal.textContent || '').toLowerCase();
                if (text.includes('captcha') || text.includes('invalid') || text.includes('error') || text.includes('wrong')) {
                  const confirmBtn = swal.querySelector('.swal2-confirm, button.confirm, .swal-button--confirm, button.btn-primary');
                  if (confirmBtn && !confirmBtn.dataset.ddaRefillBound) {
                    confirmBtn.dataset.ddaRefillBound = 'true';
                    confirmBtn.addEventListener('click', () => {
                      setTimeout(() => { if (!window.__ddaUserManuallyEditedLogin) refillCredentials(); }, 50);
                      setTimeout(() => { if (!window.__ddaUserManuallyEditedLogin) refillCredentials(); }, 150);
                      setTimeout(() => { if (!window.__ddaUserManuallyEditedLogin) refillCredentials(); }, 300);
                      setTimeout(() => { if (!window.__ddaUserManuallyEditedLogin) refillCredentials(); }, 600);
                    });
                  }
                }
              }
            });

            if (document.body) {
              observer.observe(document.body, { childList: true, subtree: true });
              window.__ddaLoginErrorObserver = observer;
            }
          }

          // 3. Clear any legacy persistent credential guardians to avoid overwriting user keystrokes
          if (window.__ddaPasswordGuardian) {
            clearInterval(window.__ddaPasswordGuardian);
            window.__ddaPasswordGuardian = null;
          }

          // Live typing listeners to preserve user input and update credentials
          if (!window.__ddaLoginInputListenersAttached) {
            window.__ddaLoginInputListenersAttached = true;
            const handleTyping = (e) => {
              const target = e.target;
              if (!target || typeof target.matches !== 'function') return;
              const isUser = target.matches('input[name="user_id"], input#user_id, input[name="username"], input[name="login_id"], input[name="pan"], input#pan, input[placeholder*="User ID" i], input[placeholder*="PAN" i]');
              const isPass = target.matches('input[type="password"], input#password, input[name="password"], input[name="user_password"]');
              if (isUser || isPass) {
                window.__ddaUserManuallyEditedLogin = true;
              }
              if (isUser) {
                const val = (target.value || '').trim().toUpperCase();
                if (val.length >= 3) {
                  sessionStorage.setItem('dda_submitting_pan', val);
                  localStorage.setItem('dda_selected_login_pan', val);
                }
              }
              if (isPass) {
                const pVal = (target.value || '').trim();
                if (pVal && !/^[a-f0-9]{64}$/i.test(pVal)) {
                  sessionStorage.setItem('dda_submitting_pass', pVal);
                }
              }
            };
            document.addEventListener('input', handleTyping, true);
            document.addEventListener('change', handleTyping, true);
          }

          // 4. Capture credentials on form submission & preserve password hash
          const captureOnSubmit = () => {
            const userEl = document.querySelector('input[name="user_id"], input#user_id, input[name="username"], input[name="login_id"], input[name="pan"], input#pan, input[placeholder*="User ID" i], input[placeholder*="PAN" i]');
            const passEl = document.querySelector('input[type="password"], input[name="password"], input#password');
            const submittedPan = (userEl?.value || targetPan || '').trim().toUpperCase();
            const rawPass = (passEl?.value || targetPassword || '').trim();
            if (submittedPan) {
              sessionStorage.setItem('dda_submitting_pan', submittedPan);
              sessionStorage.setItem('dda_authenticated_pan', submittedPan);
              sessionStorage.setItem('dda_just_logged_in', 'true');
              localStorage.setItem('dda_last_logged_in_pan', submittedPan);
              localStorage.setItem('dda_selected_login_pan', submittedPan);
              if (rawPass && !/^[a-f0-9]{64}$/i.test(rawPass)) {
                sessionStorage.setItem('dda_submitting_pass', rawPass);
              }
            }
          };

          const loginBtns = document.querySelectorAll('#loginbtn, #btnLogin, button[type="submit"], input[type="submit"], .btn-login');
          loginBtns.forEach(btn => {
            if (!btn.dataset.ddaSubmitBound) {
              btn.dataset.ddaSubmitBound = 'true';
              btn.addEventListener('click', () => {
                captureOnSubmit();
                window.__ddaIsLoginSubmitting = true;
                if (window.__ddaLoginSubmittingTimer) clearTimeout(window.__ddaLoginSubmittingTimer);
                window.__ddaLoginSubmittingTimer = setTimeout(() => { window.__ddaIsLoginSubmitting = false; }, 8000);
              }, true);
            }
          });

          // 5. Enter-to-login is handled once by preload-dda.js (handleLoginPage).
          // A second Enter handler here clicked #loginbtn twice per keypress, and
          // DDA hashed the already-hashed password on the second click.
          const prevStyle = document.getElementById('__dda_login_captcha_style');
          if (prevStyle) prevStyle.remove();

          return { success: true, pan: targetPan, filledUser: true, filledPass: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      })();
    `;
  },

  // 1b. Captcha Extract Data URL (Canvas + FileReader Blob Extraction)
  getCaptchaExtractCode: () => `
    (async () => {
      try {
        const img = document.querySelector('img#captchaimg, img[src*="captcha" i]:not([src*="reload" i]):not([src*="refresh" i]), #captcha_image, img.captcha:not([class*="reload" i]):not([class*="refresh" i]), #imgCaptcha, img[id*="captcha" i]');
        if (!img) return { success: false, error: 'Captcha image element not found' };

        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w > 0 && h > 0 && (w < 60 || h < 18 || (w / h) < 1.8)) {
          return { success: false, error: 'Rejected reload icon dimensions' };
        }

        // 1. Direct base64 data URL if available
        if (img.src && img.src.startsWith('data:image')) {
          return { success: true, dataUrl: img.src };
        }

        // 2. Canvas extraction
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 150;
          canvas.height = img.naturalHeight || img.height || 50;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          if (dataUrl && dataUrl.length > 100 && !dataUrl.includes('data:,')) {
            return { success: true, dataUrl };
          }
        } catch (canvasErr) {}

        // 3. In-page Fetch to Blob + Base64 conversion (preserves session cookies)
        if (img.src && img.src.startsWith('http')) {
          try {
            const res = await fetch(img.src, { cache: 'no-cache' });
            const blob = await res.blob();
            const reader = new FileReader();
            const base64Data = await new Promise((resolve, reject) => {
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            if (base64Data && base64Data.length > 100) {
              return { success: true, dataUrl: base64Data };
            }
          } catch (fetchErr) {}
        }

        return { success: true, dataUrl: img.src || null };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })();
  `,

  // 1c. Sync Captcha Input Text Live to DDA DOM
  getCaptchaInputSyncCode: (val = '') => `
    (() => {
      try {
        const selectors = [
          'input[name="captcha"]',
          'input#captcha',
          'input[name="user_captcha"]',
          'input#txtCaptcha',
          'input[placeholder*="captcha" i]',
          'input[name="captcha_code"]',
          'input#captcha_code',
          '.captchblock input',
          '.captcharow input',
          '.captcha input',
          'input.numbersonly'
        ];
        const inputs = document.querySelectorAll(selectors.join(', '));
        if (inputs && inputs.length > 0) {
          for (const captchaInput of inputs) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(captchaInput, "${val}");
            else captchaInput.value = "${val}";
            try {
              if (typeof window.jQuery !== 'undefined' && window.jQuery(captchaInput).val) window.jQuery(captchaInput).val("${val}");
              else if (typeof window.$ !== 'undefined' && window.$(captchaInput).val) window.$(captchaInput).val("${val}");
            } catch (_) {}
            captchaInput.dispatchEvent(new Event('input', { bubbles: true }));
            captchaInput.dispatchEvent(new Event('change', { bubbles: true }));
            captchaInput.dispatchEvent(new Event('blur', { bubbles: true }));
          }
          return { success: true, count: inputs.length };
        }
        return { success: false, error: 'Captcha input not found' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })();
  `,

  // 1d. Refresh Captcha Image on Webview DOM
  getRefreshCaptchaCode: () => `
    (() => {
      try {
        if (typeof window.refreshCaptcha === 'function') {
          window.refreshCaptcha();
          return { success: true, method: 'refreshCaptcha()' };
        }
        if (typeof window.reloadCaptcha === 'function') {
          window.reloadCaptcha();
          return { success: true, method: 'reloadCaptcha()' };
        }
        if (typeof window.getCaptcha === 'function') {
          window.getCaptcha();
          return { success: true, method: 'getCaptcha()' };
        }

        const refreshEl = document.querySelector(
          'a[onclick*="captcha" i], button[onclick*="captcha" i], ' +
          'a[href*="captcha" i], .refresh-captcha, #refreshCaptcha, ' +
          '.captcha-refresh, a#btnReload, i.fa-refresh, i.fa-sync, ' +
          '.fa-redo, button.refresh, [title*="refresh" i], [title*="reload" i]'
        );
        if (refreshEl) {
          refreshEl.click();
          if (refreshEl.parentElement && refreshEl.parentElement.tagName === 'A') {
            refreshEl.parentElement.click();
          }
          return { success: true, method: 'clicked refresh element' };
        }

        const img = document.querySelector('img#captchaimg, img[src*="captcha" i], #captcha_image, img.captcha, img[alt*="captcha" i], #imgCaptcha');
        if (img) {
          const cleanSrc = img.src.split('?')[0];
          img.src = cleanSrc + '?t=' + Date.now();
          img.click();
          return { success: true, method: 'img cache-buster' };
        }

        return { success: false, error: 'No captcha reload element found' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })();
  `,

  // 1e. Trigger Login Submit on Webview DOM
  getLoginSubmitCode: (applicant, captchaVal = '') => {
    const pan = (applicant?.pan || applicant?.personal?.pan || '').trim().toUpperCase();
    let password = (applicant?.password || applicant?.personal?.password || '').trim();
    if (!password && pan && KNOWN_APPLICANT_PASSWORDS[pan]) {
      password = KNOWN_APPLICANT_PASSWORDS[pan];
    }
    const captcha = (captchaVal || '').trim().toUpperCase();

    return `
      (() => {
        try {
          const targetPan = ${JSON.stringify(pan)};
          const targetPassword = ${JSON.stringify(password)};
          const targetCaptcha = ${JSON.stringify(captcha)};

          if (targetPan) {
            try {
              sessionStorage.setItem('dda_submitting_pan', targetPan);
              sessionStorage.setItem('dda_authenticated_pan', targetPan);
              sessionStorage.setItem('dda_just_logged_in', 'true');
              localStorage.setItem('dda_last_logged_in_pan', targetPan);
              localStorage.setItem('dda_selected_login_pan', targetPan);
              localStorage.setItem('dda_selected_person', targetPan);
              localStorage.setItem('dda_active_applicant_pan', targetPan);
              if (targetPassword && !/^[a-f0-9]{64}$/i.test(targetPassword)) {
                sessionStorage.setItem('dda_submitting_pass', targetPassword);
              }
            } catch (_) {}
          }

          const setVal = (el, val) => {
            if (!el || !val) return;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(el, val);
            else el.value = val;
            try {
              if (typeof window.jQuery !== 'undefined' && window.jQuery(el).val) window.jQuery(el).val(val);
              else if (typeof window.$ !== 'undefined' && window.$(el).val) window.$(el).val(val);
            } catch (_) {}
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          };

          const userSelectors = ['input[name="user_id"]', 'input#user_id', 'input[name="username"]', 'input[name="login_id"]'];
          for (const sel of userSelectors) {
            const el = document.querySelector(sel);
            if (el && targetPan) {
              setVal(el, targetPan);
              break;
            }
          }

          const passSelectors = ['input[type="password"]', 'input[name="password"]', 'input#password'];
          for (const sel of passSelectors) {
            const el = document.querySelector(sel);
            if (el && targetPassword) {
              setVal(el, targetPassword);
              break;
            }
          }

          const captchaSelectors = [
            'input[name="captcha"]',
            'input#captcha',
            'input[name="user_captcha"]',
            'input#txtCaptcha',
            'input[placeholder*="captcha" i]',
            'input[name="captcha_code"]',
            'input#captcha_code',
            '.captchblock input',
            '.captcharow input',
            '.captcha input',
            'input.numbersonly'
          ];
          for (const sel of captchaSelectors) {
            const el = document.querySelector(sel);
            if (el && targetCaptcha) {
              setVal(el, targetCaptcha);
              break;
            }
          }

          const submitSelectors = [
            '#loginbtn',
            '#btnLogin',
            'button#login_btn',
            'button#btnLogin',
            'button[type="submit"]',
            'input[type="submit"]',
            'button.btn-login',
            'button.btn-primary'
          ];
          for (const sel of submitSelectors) {
            const btn = document.querySelector(sel);
            if (btn) {
              btn.click();
              return { success: true, method: 'clicked: ' + sel };
            }
          }

          const form = document.querySelector('form#loginForm, form#login_form, form');
          if (form) {
            if (typeof form.requestSubmit === 'function') {
              form.requestSubmit();
            } else {
              form.submit();
            }
            return { success: true, method: 'form.requestSubmit()' };
          }

          return { success: false, error: 'No login button found' };
        } catch (err) {
          return { success: false, error: err.message };
        }
      })();
    `;
  },

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 2: SCHEME SELECTION & STEP 2 PREFETCH
  // ───────────────────────────────────────────────────────────────────────────

  getSchemeSelectCode: (targetScheme = 'DDA HOUSING SCHEME 2026') => {
    const cleanScheme = (targetScheme || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (!cleanScheme || cleanScheme.length < 3) {
      return `
        (() => {
          return { success: false, error: 'Target scheme not selected or invalid. Please select a valid scheme.' };
        })();
      `;
    }
    return `
      (() => {
        try {
          const normalize = (s) => (s || '').replace(/\\s+/g, ' ').trim().toUpperCase();
          const targetNorm = "${cleanScheme}";

          // Auto-dismiss SweetAlert popups
          const popup = document.querySelector('.swal2-popup, .swal-modal, .sweet-alert');
          if (popup) {
            const okBtn = popup.querySelector('.swal2-confirm, button.confirm, .swal-button--confirm, button');
            if (okBtn) okBtn.click();
          }

          // Exact Chrome extension logic: inspect only b.bluec in customtable
          const tableBody = document.querySelector('table.customtable tbody, table tbody');
          if (!tableBody) {
            return { success: false, error: 'Scheme table not found in DOM' };
          }

          const rows = tableBody.querySelectorAll('tr');
          for (const row of rows) {
            const el = row.querySelector('b.bluec') || row.querySelector('.scheme-title');
            if (!el) continue;

            const title = normalize(el.textContent);
            if (targetNorm && targetNorm.length >= 3 && title.includes(targetNorm)) {
              const btn = row.querySelector('a.applyBtn, .applyBtn, a[data-url], button, a.btn');
              if (btn) {
                const rawUrl = btn.getAttribute('data-url') || btn.getAttribute('href') || '';
                const sid = rawUrl.split('/').filter(Boolean).pop();
                if (sid && typeof window.resolveStep2DirectUrl === 'function') {
                  try { (window.__ddaPrefetchStep2 || window.resolveStep2DirectUrl)(sid); } catch (_) {}
                }
                if (window.logAnalyticsStep) {
                  window.logAnalyticsStep('step1_apply', 'Scheme Apply: ' + targetNorm + ' (Manual Direct)');
                }
                if (typeof window.__ddaStopSessionHeartbeat === 'function') {
                  window.__ddaStopSessionHeartbeat('Manual Direct Apply');
                }
                if (rawUrl && (rawUrl.includes('userApplicationfrom') || rawUrl.includes('applicationform') || rawUrl.includes('step1_form') || rawUrl.includes('/user/'))) {
                  try { if (typeof window.__ddaMarkApplyPending === 'function') window.__ddaMarkApplyPending(rawUrl); } catch (_) {}
                  window.location.href = rawUrl;
                  return { success: true, method: 'navigated data-url: ' + rawUrl, scheme: "${cleanScheme}" };
                }
                btn.click();
                setTimeout(() => {
                  const confirmBtn = document.querySelector('.swal2-confirm, button.confirm');
                  if (confirmBtn) confirmBtn.click();
                }, 80);
                return { success: true, method: 'clicked apply button in row', scheme: "${cleanScheme}" };
              }
            }
          }

          return { success: false, error: 'Target scheme "' + targetNorm + '" not found on page' };
        } catch (err) {
          return { success: false, error: err.message };
        }
      })();
    `;
  },

  getTimedSchemePollerCode: (targetScheme = 'DDA HOUSING SCHEME 2026', preferences = {}, applicantPan = '', targetEpochMs = 0) => {
    const cleanScheme = (targetScheme || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (!cleanScheme || cleanScheme.length < 3) {
      return `
        (() => {
          console.warn('[Timed Search] Target scheme not selected or invalid.');
          return { success: false, error: 'Target scheme not selected or invalid.' };
        })();
      `;
    }
    const prefsJson = JSON.stringify(preferences || {});
    const pan = applicantPan || preferences?.pan || '';
    const targetEpoch = Number(targetEpochMs) > 0 ? Math.floor(Number(targetEpochMs)) : 0;
    return `
      (() => {
        try {
          const normalize = (s) => (s || '').replace(/\\s+/g, ' ').trim().toUpperCase();
          const targetNorm = "${cleanScheme}";
          const TARGET_EPOCH = ${targetEpoch};
          const PREFS = ${prefsJson};
          const APPLICANT_PAN = "${pan}";

          // Dual-channel unified logger: webview console + Live Console via IPC
          const sendLog = (level, msg) => {
            try {
              console.log('[Timed Search] ' + msg);
            } catch (_) {}
            try {
              console.log('__DDA_LOG__:' + JSON.stringify({ level: level || 'INFO', page: 'Timed Search', msg: String(msg), pan: APPLICANT_PAN }));
            } catch (_) {}
            try {
              if (typeof window.ipcRenderer?.sendToHost === 'function') {
                window.ipcRenderer.sendToHost('dda:log', { level: level || 'INFO', page: 'Timed Search', msg: String(msg), pan: APPLICANT_PAN });
              }
            } catch (_) {}
          };

          // 1. Arm 60-Minute Continuous Search Window
          const searchWindowEnd = Date.now() + (60 * 60 * 1000);
          localStorage.setItem('dda_timed_search_until', String(searchWindowEnd));
          localStorage.setItem('dda_timed_hunting_until', String(searchWindowEnd)); // backward compat
          localStorage.setItem('dda_timed_target_epoch', String(TARGET_EPOCH));
          localStorage.setItem('dda_timed_mode', 'true');
          localStorage.setItem('dda_timed_attempt_count', '1');

          // Mute session heartbeat immediately when continuous search arms
          if (typeof window.__ddaStopSessionHeartbeat === 'function') {
            window.__ddaStopSessionHeartbeat('Continuous search armed');
          }

          // 2. Clear any existing search timers
          if (window.__ddaTimedSearchTimer) {
            clearTimeout(window.__ddaTimedSearchTimer);
            clearInterval(window.__ddaTimedSearchTimer);
            window.__ddaTimedSearchTimer = null;
          }
          if (window.__ddaTimedPoller) {
            clearTimeout(window.__ddaTimedPoller);
            clearInterval(window.__ddaTimedPoller);
            window.__ddaTimedPoller = null;
          }

          // 3. Auto-dismiss SweetAlert popups
          const checkAndDismissPopup = () => {
            const popup = document.querySelector('.swal2-popup, .swal-modal, .sweet-alert');
            if (popup) {
              const text = (popup.textContent || '').toUpperCase();
              if (text.includes('NOT STARTED') || text.includes('HAS NOT STARTED') || text.includes('STARTING SOON') || text.includes('SCHEME')) {
                const okBtn = popup.querySelector('.swal2-confirm, button.confirm, .swal-button--confirm, button');
                if (okBtn) okBtn.click();
                return true;
              }
            }
            return false;
          };

          const isSchemeMatch = (el) => {
            if (!el || !targetNorm || targetNorm.length < 3) return false;
            const title = normalize(el.textContent);
            return title.includes(targetNorm);
          };

          // 4. Immediate DOM check (Strict b.bluec inspection matching Chrome Extension)
          // If the Apply link is ALREADY visible when Timed is armed (testing, or an early publish),
          // hold the capture until T-1s instead of firing at the T-2s wake-up. On a real drop the link
          // is absent at arm time, so this never engages and the first appearance is captured at once.
          const EARLY_GUARD_UNTIL = TARGET_EPOCH ? TARGET_EPOCH - 1000 : 0;
          let holdUntilTarget = false;
          const isHeld = () => holdUntilTarget && Date.now() < EARLY_GUARD_UNTIL;

          const checkDomForApply = (probeOnly) => {
            if (!probeOnly) checkAndDismissPopup();
            const rows = document.querySelectorAll('table.customtable tbody tr, table tbody tr');
            for (const row of rows) {
              const el = row.querySelector('b.bluec') || row.querySelector('.scheme-title');
              if (isSchemeMatch(el)) {
                const btn = row.querySelector('a.applyBtn, .applyBtn, a[data-url], a[href*="step1_form"], a[href*="userApplicationfrom"], button, a.btn');
                if (btn) {
                  if (probeOnly) return true;
                  if (isHeld()) return false;
                  const url = btn.getAttribute('data-url') || btn.getAttribute('href');
                  const sid = (url || '').split('/').filter(Boolean).pop();
                  if (sid && typeof window.resolveStep2DirectUrl === 'function') {
                    try { (window.__ddaPrefetchStep2 || window.resolveStep2DirectUrl)(sid); } catch (_) {}
                  }
                  if (window.logAnalyticsStep) {
                    window.logAnalyticsStep('step1_apply', 'Scheme Apply: ' + targetNorm + ' (Timed Mode)');
                  }
                  if (typeof window.__ddaStopSessionHeartbeat === 'function') {
                    window.__ddaStopSessionHeartbeat('Apply button captured');
                  }
                  if (url && (url.includes('userApplicationfrom') || url.includes('applicationform') || url.includes('step1_form') || url.includes('/user/'))) {
                    localStorage.removeItem('dda_timed_search_until');
                    localStorage.removeItem('dda_timed_hunting_until');
                    localStorage.removeItem('dda_timed_mode');
                    localStorage.removeItem('dda_timed_attempt_count');
                    sendLog('SUCCESS', '⚡ Apply button captured! Navigating to application form...');
                    try { if (typeof window.__ddaMarkApplyPending === 'function') window.__ddaMarkApplyPending(url); } catch (_) {}
                    window.location.href = url;
                    return url;
                  }
                  sendLog('SUCCESS', '⚡ Apply button clicked! Navigating...');
                  btn.click();
                  return true;
                }
              }
            }
            return false;
          };

          holdUntilTarget = !!(TARGET_EPOCH && Date.now() < EARLY_GUARD_UNTIL && checkDomForApply(true));
          if (holdUntilTarget) {
            sendLog('INFO', '⏳ Apply link is already visible (test / early publish) — holding capture until T-1s');
          }
          if (checkDomForApply()) return { success: true, instant: true };

          // 5. Continuous Search Engine: a tick every 250-300 ms (tiered below) until Apply or Stop.
          // Each tick sends a check of the schemes page unless one is already waiting. Under load
          // DDA can leave a request hanging; one hung request used to freeze the whole search (the
          // next check only went out after it ended), so the Apply link was never seen. Now:
          //  - a backup check goes out when the newest one has had no answer for 4 s,
          //  - at most 3 checks wait at once,
          //  - a check is given up after 20 s, which frees its slot.
          // Whichever answer shows the Apply link first wins. With DDA answering within 4 s this is
          // one check at a time, as before.
          const HEDGE_AFTER_MS = 4000;
          const MAX_IN_FLIGHT = 3;
          const CHECK_TIMEOUT_MS = 20000;
          const inFlight = new Set();
          let attempts = 0;
          let searchFound = false;
          let failStreak = 0;
          let lastFailWarnAt = 0;

          const stopTimers = () => {
            if (window.__ddaTimedSearchTimer) {
              clearTimeout(window.__ddaTimedSearchTimer);
              clearInterval(window.__ddaTimedSearchTimer);
              window.__ddaTimedSearchTimer = null;
            }
            if (window.__ddaTimedPoller) {
              clearTimeout(window.__ddaTimedPoller);
              clearInterval(window.__ddaTimedPoller);
              window.__ddaTimedPoller = null;
            }
          };

          const abortAllChecks = () => {
            for (const c of inFlight) {
              clearTimeout(c.timer);
              try { c.ctrl.abort(); } catch (_) {}
            }
            inFlight.clear();
          };

          const isStopped = () => localStorage.getItem('dda_timed_mode') !== 'true';

          // Leaving the page (a reload, or the Apply navigation) cuts the waiting checks off:
          // that is not a failure worth a warning
          let leavingPage = false;
          window.addEventListener('pagehide', () => { leavingPage = true; abortAllChecks(); }, { once: true });

          const noteCheckFailed = (reason) => {
            if (leavingPage) return;
            failStreak++;
            const now = Date.now();
            // The first failure, then at most one line every 5 s while it lasts
            if (failStreak === 1 || now - lastFailWarnAt >= 5000) {
              lastFailWarnAt = now;
              sendLog('WARN', '⚠️ Scheme check failed (' + reason + ') — ' + failStreak + ' in a row; still searching');
            }
          };

          const noteCheckAnswered = () => {
            if (failStreak >= 3) sendLog('INFO', '✅ Scheme checks are getting answers again');
            failStreak = 0;
          };

          // The Apply link in a fetched schemes page: capture it and navigate (once)
          const captureFromHtml = (html) => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('table.customtable tbody tr, table tbody tr');
            for (const row of rows) {
              const el = row.querySelector('b.bluec') || row.querySelector('.scheme-title');
              if (!isSchemeMatch(el)) continue;
              const btn = row.querySelector('a.applyBtn, .applyBtn, a[data-url], a[href*="step1_form"], a[href*="userApplicationfrom"]');
              const url = btn && (btn.getAttribute('data-url') || btn.getAttribute('href'));
              if (!url || isHeld()) continue;
              try {
                const sidFetched = url.split('/').filter(Boolean).pop();
                if (sidFetched && typeof window.__ddaPrefetchStep2 === 'function') window.__ddaPrefetchStep2(sidFetched);
              } catch (_) {}
              searchFound = true;
              stopTimers();
              abortAllChecks();
              if (typeof window.__ddaStopSessionHeartbeat === 'function') {
                window.__ddaStopSessionHeartbeat('Apply button captured');
              }
              localStorage.removeItem('dda_timed_search_until');
              localStorage.removeItem('dda_timed_hunting_until');
              localStorage.removeItem('dda_timed_mode');
              localStorage.removeItem('dda_timed_attempt_count');
              sendLog('SUCCESS', '⚡ Apply button captured on search attempt #' + attempts + '! Navigating...');
              try { if (typeof window.__ddaMarkApplyPending === 'function') window.__ddaMarkApplyPending(url); } catch (_) {}
              window.location.href = url;
              return true;
            }
            return false;
          };

          const launchCheck = () => {
            attempts++;
            // Emit searching log on initial checks and every 5 checks thereafter
            if (attempts <= 5 || attempts % 5 === 0) {
              sendLog('INFO', 'Searching for target scheme: ' + targetNorm + ' #' + attempts);
            }
            const check = { startedAt: Date.now(), ctrl: new AbortController(), timer: null };
            check.timer = setTimeout(() => { try { check.ctrl.abort(); } catch (_) {} }, CHECK_TIMEOUT_MS);
            inFlight.add(check);
            fetch(window.location.href, {
              cache: 'no-store',
              credentials: 'include',
              headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
              signal: check.ctrl.signal,
            })
              .then((response) => response.text().then((html) => ({ status: response.status, html })))
              .then(({ status, html }) => {
                if (searchFound || isStopped()) return;
                if (status >= 400) {
                  noteCheckFailed('HTTP ' + status);
                  return;
                }
                noteCheckAnswered();
                captureFromHtml(html);
              })
              .catch(() => {
                if (searchFound || isStopped()) return;
                noteCheckFailed(check.ctrl.signal.aborted ? 'no answer within ' + Math.round(CHECK_TIMEOUT_MS / 1000) + ' s' : 'network error');
              })
              .finally(() => {
                clearTimeout(check.timer);
                inFlight.delete(check);
              });
          };

          // A new check when none is waiting, or a backup when the newest has had no answer for 4 s
          const maybeLaunchCheck = () => {
            if (inFlight.size === 0) return launchCheck();
            if (inFlight.size >= MAX_IN_FLIGHT) return;
            let newest = 0;
            for (const c of inFlight) newest = Math.max(newest, c.startedAt);
            const waited = Date.now() - newest;
            if (waited < HEDGE_AFTER_MS) return;
            sendLog('WARN', '⏳ Scheme check: no answer for ' + Math.round(waited / 1000) + ' s — sending a backup check (' + (inFlight.size + 1) + ' waiting)');
            launchCheck();
          };

          const searchTick = () => {
            const tickStartedAt = Date.now();
            // Check if user clicked STOP or timer was disarmed
            if (isStopped()) {
              stopTimers();
              abortAllChecks();
              sendLog('INFO', '🛑 Continuous scheme search stopped.');
              return;
            }

            // Check if 60-minute safety window elapsed
            const until = parseInt(localStorage.getItem('dda_timed_search_until') || localStorage.getItem('dda_timed_hunting_until') || '0', 10);
            if (until && Date.now() > until) {
              stopTimers();
              abortAllChecks();
              localStorage.removeItem('dda_timed_search_until');
              localStorage.removeItem('dda_timed_hunting_until');
              localStorage.removeItem('dda_timed_mode');
              localStorage.removeItem('dda_timed_attempt_count');
              sendLog('WARN', '⏱️ 60-minute search window reached without scheme release. Stopped.');
              if (typeof window.__ddaStartSessionHeartbeat === 'function') {
                try { window.__ddaStartSessionHeartbeat(); } catch (_) {}
              }
              return;
            }

            if (searchFound) {
              stopTimers();
              return;
            }

            checkAndDismissPopup();

            // Check visible DOM first
            if (checkDomForApply()) {
              searchFound = true;
              stopTimers();
              abortAllChecks();
              return;
            }

            maybeLaunchCheck();

            // Tiered tick period:
            //  until T-2s: ~1s | T-2s to T+5min: 250-300ms | T+5min to T+15min: 400-450ms | after T+15min: ~1s
            const nowTs = Date.now();
            let targetPeriod;
            if (TARGET_EPOCH && nowTs < TARGET_EPOCH - 2000) {
              targetPeriod = 1000 + Math.floor(Math.random() * 51);
            } else if (!TARGET_EPOCH || nowTs < TARGET_EPOCH + 300000) {
              targetPeriod = 250 + Math.floor(Math.random() * 51);
            } else if (nowTs < TARGET_EPOCH + 900000) {
              targetPeriod = 400 + Math.floor(Math.random() * 51);
            } else {
              targetPeriod = 1000 + Math.floor(Math.random() * 51);
            }
            const nextDelay = Math.max(0, targetPeriod - (Date.now() - tickStartedAt));
            window.__ddaTimedSearchTimer = setTimeout(searchTick, nextDelay);
            window.__ddaTimedPoller = window.__ddaTimedSearchTimer; // backward compat
          };

          const initialDelay = 100;
          window.__ddaTimedSearchTimer = setTimeout(searchTick, initialDelay);
          window.__ddaTimedPoller = window.__ddaTimedSearchTimer; // backward compat

          return { success: true, searchArmed: true, windowMinutes: 60 };
        } catch (err) {
          return { success: false, error: err.message };
        }
      })();
    `;
  },

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 3: STEP 1 LOCALITY (HIGH-SPEED AJAX HASH SOLVER + METHOD 2/3)
  // ───────────────────────────────────────────────────────────────────────────

        getLocalitySelectCode: (preferences = {}) => {
    const locMap = {
      "1": "NARELA", "2": "ROHINI", "3": "TODAPUR", "4": "LOKNAYAKPURAM", "5": "DWARKA",
      "NARELA": "NARELA", "ROHINI": "ROHINI", "TODAPUR": "TODAPUR", "LOKNAYAKPURAM": "LOKNAYAKPURAM", "DWARKA": "DWARKA"
    };
    const rawLoc = preferences.locality ? String(preferences.locality).trim().toUpperCase() : "1";
    const targetLoc = locMap[rawLoc] || rawLoc || "NARELA";
    const targetSec = preferences.sector || "";
    const targetPoc = preferences.pocket || "";
    const targetBlk = preferences.block || "";
    const targetTwr = preferences.tower || "";

    return `
      (async () => {
        try {
          const currentSchemeId = window.location.pathname.split('/').filter(Boolean).pop();

          // ─── TIER 1: Check Pre-Resolved Hashes / Direct URL (100% Extension Parity) ───────────
          try {
            const hashesRaw = localStorage.getItem('dda_locality_hashes');
            const directUrlCached = localStorage.getItem('dda_direct_flat_url') || window.__ddaDirectFlatUrl;
            if (hashesRaw) {
              const h = JSON.parse(hashesRaw);
              if (
                h &&
                (!h.schemeId || String(h.schemeId) === String(currentSchemeId)) &&
                h.localityHash &&
                h.sectorHash &&
                h.pocketHash &&
                h.blockHash
              ) {
                const directUrl = 'https://eservices.dda.org.in/user/step2_form/' + (currentSchemeId || h.schemeId) + '/' + h.localityHash + '/' + h.sectorHash + '/' + h.pocketHash + '/' + h.blockHash + '/' + (h.towerHash || '0');
                console.log('__DDA_LOG__:' + JSON.stringify({ level: 'SUCCESS', page: 'Locality', msg: '⚡ 0ms Direct URL Jump to Flat Drop' }));
                window.location.replace(directUrl);
                return { success: true, method: 'Tier 1: 0ms Direct URL Jump: ' + directUrl };
              } else if (h && h.schemeId && currentSchemeId && String(h.schemeId) !== String(currentSchemeId)) {
                localStorage.removeItem('dda_locality_hashes');
                localStorage.removeItem('dda_direct_flat_url');
              }
            }
            if (directUrlCached && directUrlCached.includes('/step2_form/' + currentSchemeId + '/')) {
              console.log('__DDA_LOG__:' + JSON.stringify({ level: 'SUCCESS', page: 'Locality', msg: '⚡ Preset Direct URL Jump to Flat Drop' }));
              window.location.replace(directUrlCached);
              return { success: true, method: 'Tier 1: Preset Direct URL Jump: ' + directUrlCached };
            }
          } catch (_) {}


          function normalizeText(text) {
            if (typeof text !== 'string') return '';
            return text.trim().replace(/\\s+/g, ' ').toUpperCase();
          }

          function extractNumber(text) {
            const match = text.match(/\\d+/);
            return match ? parseInt(match[0], 10) : null;
          }

          function toRoman(num) {
            // 1 to 39: I, V and X only, so a block or tower letter (L, C, D, M)
            // is never read as a number
            if (!Number.isInteger(num) || num < 1 || num > 39) return null;
            let out = "";
            for (const [v, r] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) {
              while (num >= v) { out += r; num -= v; }
            }
            return out;
          }

${SECTOR_KEY_CODE}
          function smartMatch(selectElement, targetText) {
            if (!selectElement || !targetText) return null;

            const normalizedTarget = normalizeText(targetText);
            if (!normalizedTarget) return null;

            const shortTarget = normalizedTarget.replace(/\\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\\b/g, '').trim();
            const num = extractNumber(normalizedTarget);
            const roman = num ? toRoman(num) : null;

            const validOptions = Array.from(selectElement.options).filter(
              o => o.value && o.value !== '0' && !o.text.toUpperCase().includes('SELECT')
            );
            if (validOptions.length === 0) return null;

            // Same sector range, however it is written ("G-2 & G-6" = "G2 - G6")
            const bySectorKey = matchBySectorKey(validOptions, targetText, (o) => o.text);
            if (bySectorKey) return bySectorKey;

            // Same rules as the page engine's locality dropdowns (preload-dda.js):
            // a number in the target must be the option's number ("POCKET 11"
            // never takes "POCKET 1"), and an option is never taken because the
            // target merely contains it.
            const CLEAN = /\\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\\b/g;
            const candidateOptions = num !== null
              ? validOptions.filter(opt => {
                  const text = normalizeText(opt.text);
                  const words = text.split(/[^A-Z0-9]+/);
                  return extractNumber(text) === num || (roman && words.includes(roman));
                })
              : validOptions;
            if (candidateOptions.length === 0) return null;

            // 1. Exact name, or the same name without the BLOCK / POCKET / ... word
            let match = candidateOptions.find(opt => {
              const text = normalizeText(opt.text);
              return text === normalizedTarget || (shortTarget && text.replace(CLEAN, '').trim() === shortTarget);
            });
            if (match) return match;
            // 2. Same number ("PKT 4" = "POCKET 4")
            if (num !== null) {
              match = candidateOptions.find(opt => extractNumber(normalizeText(opt.text)) === num);
              if (match) return match;
            }
            // 3. Same number as a Roman numeral ("POCKET 3" = "POCKET III")
            if (roman) {
              match = candidateOptions.find(opt => normalizeText(opt.text).split(/[^A-Z0-9]+/).includes(roman));
              if (match) return match;
            }
            // 4. The short name as a whole word
            if (shortTarget) {
              match = candidateOptions.find(opt => {
                const text = normalizeText(opt.text);
                return text.endsWith(' ' + shortTarget) || text.startsWith(shortTarget + ' ') || text.includes(' ' + shortTarget + ' ');
              });
              if (match) return match;
            }
            // 5. The option starts with or contains the whole target (one way only)
            match = candidateOptions.find(opt => {
              const text = normalizeText(opt.text);
              return text.startsWith(normalizedTarget) || text.includes(normalizedTarget);
            });
            return match || null;
          }

          function waitForOptions(selectEl, timeoutMs = 3500) {
            return new Promise(resolve => {
              if (!selectEl) return resolve(false);
              if (selectEl.options.length > 1) return resolve(true);

              let timeoutTimer = null;
              const obs = new MutationObserver(() => {
                if (selectEl.options.length > 1) {
                  if (timeoutTimer) clearTimeout(timeoutTimer);
                  obs.disconnect();
                  resolve(true);
                }
              });
              obs.observe(selectEl, { childList: true });

              timeoutTimer = setTimeout(() => {
                obs.disconnect();
                resolve(selectEl.options.length > 1);
              }, timeoutMs);
            });
          }

          function selectLocalityByText(selectEl, text) {
            if (!selectEl) return false;
            const target = normalizeText(text);
            const opt = Array.from(selectEl.options).find(
              o => normalizeText(o.text) === target || normalizeText(o.text).includes(target) || target.includes(normalizeText(o.text))
            );
            if (opt) {
              selectEl.value = opt.value;
              selectEl.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          }

          async function selectSmartSilent(selectEl, value) {
            if (!selectEl || !value) return false;
            await waitForOptions(selectEl);
            const match = smartMatch(selectEl, value);
            if (match) {
              selectEl.value = match.value;
              selectEl.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          }

          // ─── TIER 2: Live DOM Cascade (Exact Extension Engine) ─────────────
          const locality = document.getElementById('locality');
          const sector   = document.getElementById('sector_id');
          const pocket   = document.getElementById('pocket_id');
          const block    = document.getElementById('block_id');
          const tower    = document.getElementById('tower_id');

          const locOk = selectLocalityByText(locality, "${targetLoc}");
          if (locOk) {
            console.log('__DDA_LOG__:' + JSON.stringify({ level: 'INFO', page: 'Locality', msg: 'Selected Locality: ${targetLoc}' }));
          }
          if (typeof window.get_sector === 'function') {
            window.get_sector(locality);
          }

          let secOk = false;
          if ("${targetSec}") {
            secOk = await selectSmartSilent(sector, "${targetSec}");
            if (secOk) {
              console.log('__DDA_LOG__:' + JSON.stringify({ level: 'INFO', page: 'Locality', msg: 'Selected Sector: ${targetSec}' }));
              if (typeof window.getpocket === 'function') {
                window.getpocket(sector);
              }
            }
          }

          let pocOk = false;
          if (secOk && "${targetPoc}") {
            pocOk = await selectSmartSilent(pocket, "${targetPoc}");
            if (pocOk) {
              console.log('__DDA_LOG__:' + JSON.stringify({ level: 'INFO', page: 'Locality', msg: 'Selected Pocket: ${targetPoc}' }));
              if (typeof window.getblock === 'function') {
                window.getblock(pocket);
              }
            }
          }

          let blkOk = false;
          if (pocOk && "${targetBlk}") {
            blkOk = await selectSmartSilent(block, "${targetBlk}");
            if (blkOk) {
              console.log('__DDA_LOG__:' + JSON.stringify({ level: 'INFO', page: 'Locality', msg: 'Selected Block: ${targetBlk}' }));
              if (typeof window.gettower === 'function') {
                window.gettower(block);
              }
            }
          }

          let twrOk = false;
          if (blkOk && "${targetTwr}") {
            twrOk = await selectSmartSilent(tower, "${targetTwr}");
            if (twrOk) {
              console.log('__DDA_LOG__:' + JSON.stringify({ level: 'INFO', page: 'Locality', msg: 'Selected Tower: ${targetTwr}' }));
            }
          }

          const allSpecifiedMatched = (!"${targetSec}" || secOk) &&
                                      (!"${targetPoc}" || pocOk) &&
                                      (!"${targetBlk}" || blkOk) &&
                                      (!"${targetTwr}" || twrOk);

          if (locOk && allSpecifiedMatched) {
            console.log('__DDA_LOG__:' + JSON.stringify({ level: 'ACTION', page: 'Locality', msg: 'Submitting Locality search...' }));
            setTimeout(() => {
              const searchBtn = document.getElementById('search') ||
                                document.querySelector('button#search, input#search, .searchBtn, button[type="submit"]');
              if (searchBtn) {
                searchBtn.click();
              }
            }, 300);
            return { success: true, method: 'Tier 2 DOM Cascade Complete' };
          }

          return { success: true, method: 'Cascade filled matching dropdowns and stopped at first missing' };
        } catch (err) {
          return { success: false, error: err.message };
        }
      })();
    `;
  },

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 4: STEP 2 FLAT SELECT
  // ───────────────────────────────────────────────────────────────────────────
  getFlatHunterCode: (preferences = {}, huntSec = 30, fallbackEnabled = false, selectedFloor = 'ALL', selectedParity = 'ALL') => {
    const parseFlats = (raw) => {
      if (!raw) return [];
      if (Array.isArray(raw)) {
        return raw.flatMap(f => String(f).split(',')).map(f => f.trim().toUpperCase()).filter(Boolean);
      }
      if (typeof raw === 'string') {
        return raw.split(',').map(f => f.trim().toUpperCase()).filter(Boolean);
      }
      return [String(raw).trim().toUpperCase()].filter(Boolean);
    };
    const rawFlats = preferences.flatNo || preferences.flats || [];
    const targetFlats = parseFlats(rawFlats);
    const parsedHuntSec = parseInt(huntSec, 10);
    const resolvedHuntSec = !isNaN(parsedHuntSec) ? parsedHuntSec : 30;
    const isContinuousMode = resolvedHuntSec === 0;

    return `
      (() => {
        try {
          // ⚡ Zero-Latency CSS Animation & Modal Transition Neutralizer
          try {
            if (!document.getElementById('__dda_instant_ui_style')) {
              const style = document.createElement('style');
              style.id = '__dda_instant_ui_style';
              style.textContent = '*, *::before, *::after { transition-duration: 0.001ms !important; transition-delay: 0s !important; animation-duration: 0.001ms !important; animation-delay: 0s !important; } .fade { opacity: 1 !important; transition: none !important; } .modal.fade .modal-dialog { transform: none !important; transition: none !important; } .modal-backdrop.fade { opacity: 0.5 !important; transition: none !important; } .swal2-popup, .swal-modal, .sweet-alert { animation: none !important; transform: none !important; transition: none !important; }';
              (document.head || document.documentElement).appendChild(style);
            }
          } catch (_) {}

          const TARGET_FLATS = ${JSON.stringify(targetFlats)};
          // Same flat rule as preload-dda.js ddaFlatKey ("1" and "01" are the same flat)
          const flatKey = window.__ddaFlatKey || ((f) => {
            const s = String(f == null ? '' : f).trim().toUpperCase().replace(/\\s+/g, '');
            return /^\\d+$/.test(s) ? String(parseInt(s, 10)) : s;
          });
          const APPLICANT_PAN = ${JSON.stringify(preferences.pan || '')};
          const fallbackEnabled = ${fallbackEnabled ? 'true' : 'false'};
          const selectedFloor = "${selectedFloor || 'ALL'}";
          const selectedParity = "${selectedParity || 'ALL'}";
          let huntDurationSec = ${resolvedHuntSec};
          const isContinuous = ${isContinuousMode ? 'true' : 'false'};

          // Generation token: a new Search press bumps the counter, so every closure left over from an
          // earlier press sees that it has been superseded and dies on its next tick. The window flags
          // alone are not enough — a fresh injection sets them back to "running" and would otherwise
          // revive the previous poller, leaving two chains polling DDA at once.
          const MY_GEN = (window.__ddaHunterGen = (window.__ddaHunterGen || 0) + 1);
          const isStale = () => window.__ddaHunterGen !== MY_GEN;

          // Tear down the previous press's interval / observer before installing this press's own.
          try {
            if (window.__ddaHunterInterval) clearInterval(window.__ddaHunterInterval);
            window.__ddaHunterInterval = null;
          } catch (_) {}
          try {
            if (window.__ddaHunterObserver) window.__ddaHunterObserver.disconnect();
            window.__ddaHunterObserver = null;
          } catch (_) {}
          try {
            if (window.__ddaFlatHunterTimer) clearTimeout(window.__ddaFlatHunterTimer);
            window.__ddaFlatHunterTimer = null;
            if (window.__ddaFlatHunterTimeout) clearTimeout(window.__ddaFlatHunterTimeout);
            window.__ddaFlatHunterTimeout = null;
          } catch (_) {}

          // Helper: Parse Flat Item
          const parseFlatElement = (flatEl) => {
            if (!flatEl) return null;
            const span = flatEl.querySelector('span');
            if (!span) return null;
            const rawText = span.innerText || span.textContent || '';
            const flatText = rawText.trim().toUpperCase();
            if (!flatText) return null;
            const cleanDigits = flatText.replace(/\\D/g, '');
            const numericFlatNo = cleanDigits ? parseInt(cleanDigits, 10) : NaN;

            let floorNo = NaN;
            const floorBlock = flatEl.closest ? flatEl.closest('.floorblock') : null;
            if (floorBlock) {
              const floorNameEl = floorBlock.querySelector('.floorname');
              if (floorNameEl) {
                const rawFloorText = floorNameEl.innerText || floorNameEl.textContent || '';
                const parsed = parseInt(rawFloorText.replace(/\\D/g, ''), 10);
                if (!isNaN(parsed)) floorNo = parsed;
              }
            }
            if (isNaN(floorNo) && !isNaN(numericFlatNo)) {
              floorNo = Math.floor(numericFlatNo / 100);
            }

            return {
              el: flatEl,
              flatText,
              numericFlatNo,
              floorNo: isNaN(floorNo) ? 1 : floorNo,
              radio: flatEl.querySelector('input[type="radio"]')
            };
          };

          // Watch & auto-unhide reserve modal captcha block + bind Enter key to #captchabutton
          const watchReserveModal = () => {
            const modalObserver = new MutationObserver(() => {
              if (isStale()) { try { modalObserver.disconnect(); } catch (_) {} return; }
              const modal = document.querySelector('#myModal, #flatDetailModal, .modal');
              if (modal) {
                const capBlock = modal.querySelector('.captchblock, tr.captchblock');
                if (capBlock) {
                  capBlock.style.display = 'table-row';
                  capBlock.classList.remove('hide');
                  capBlock.classList.add('show');
                }
                const initialReserveBtn = modal.querySelector('#submitareabtn');
                if (initialReserveBtn) {
                  initialReserveBtn.style.display = 'none';
                }

                const submitBtn = modal.querySelector('#captchabutton, button.capreserve, input.capreserve, button[type="submit"]');

                if (!modal.dataset.enterBound) {
                  modal.dataset.enterBound = "true";
                  modal.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" && submitBtn) {
                      e.preventDefault();
                      submitBtn.click();
                    }
                  });
                }
              }
            });
            if (document.body) modalObserver.observe(document.body, { childList: true, subtree: true });
            window.__ddaHunterObserver = modalObserver;
          };
          watchReserveModal();

          // ⚡ Fast-Track Instant Modal Display & Direct Captcha Block Unhide
          const triggerInstantReserveModal = () => {
            try {
              const modal = document.querySelector('#myModal, #flatDetailModal, .modal');
              if (modal) {
                modal.classList.add('show', 'in');
                modal.style.display = 'block';
                modal.setAttribute('aria-hidden', 'false');

                const capBlock = modal.querySelector('.captchblock, tr.captchblock');
                if (capBlock) {
                  capBlock.style.display = 'table-row';
                  capBlock.classList.remove('hide');
                  capBlock.classList.add('show');
                }
                const initialReserveBtn = modal.querySelector('#submitareabtn');
                if (initialReserveBtn) {
                  initialReserveBtn.style.display = 'none';
                }
              }
            } catch (_) {}
          };

          // NOTE: the "your 15 minutes timer has been started" SweetAlert is auto-confirmed by the
          // preload's own watcher (250ms, 1-shot dataset guard, logs step6_payment_timer_ok). An
          // interval was duplicated here on every Search press, was never cleared, and had no 1-shot
          // guard, so it re-clicked the same button 10x a second. Removed — the preload covers it.

          const sendLog = (level, msg) => {
            try {
              console.log('__DDA_LOG__:' + JSON.stringify({ level: level || 'INFO', page: 'Search', msg: String(msg), pan: APPLICANT_PAN }));
            } catch (_) {}
            try {
              if (typeof window.ipcRenderer?.sendToHost === 'function') {
                window.ipcRenderer.sendToHost('dda:log', { level: level || 'INFO', page: 'Search', msg: String(msg), pan: APPLICANT_PAN });
              }
            } catch (_) {}
          };

          // The hunter claims the reservation flags before firing __ddaDirectSubmit, but the single-flight
          // wrapper can refuse the call outright (ALREADY_RUNNING) — in which case executeDirectInner never
          // runs and never resets what we just set. Restore the previous owner's state and say so in the
          // log, otherwise this search looks alive in the sidebar while it is actually finished.
          const handleDirectSubmitResult = (maybePromise, flatText, prevTarget, prevInProgress) => {
            try {
              if (!maybePromise || typeof maybePromise.then !== 'function') return;
              maybePromise.then((res) => {
                const reason = res && res.reason;
                if (reason !== 'ALREADY_RUNNING' && reason !== 'MUTEX_LOCKED') return;
                // Another chain owns the lock; hand its bookkeeping back untouched.
                window.__ddaReservationInProgress = prevInProgress;
                window.__ddaActiveReservationTarget = prevTarget;
                sendLog('WARN', 'A reservation is already in progress - this search stopped without attempting flat ' + flatText + '.');
              }).catch(() => {});
            } catch (_) {}
          };

          // 1. Immediate scan of current live DOM
          const scanLiveDom = () => {
            if (window.__ddaReservationInProgress) return false;
            const availableEls = Array.from(document.querySelectorAll('.building.available'));
            if (availableEls.length === 0) return false;

            const bookedSet = window.__ddaBookedFlatsSet || new Set();
            const parsedAvailable = availableEls.map(parseFlatElement).filter(item => item && item.radio && !bookedSet.has(item.flatText));
            let matched = null;

            // Priority 1: Target Flats
            const candidateTargets = TARGET_FLATS.filter(t => !bookedSet.has(t));
            for (const target of candidateTargets) {
              matched = parsedAvailable.find(item => flatKey(item.flatText) === flatKey(target));
              if (matched) break;
            }

            // Priority 2: Fallback Filters (Bottom-to-Top Floor, Parity, Numeric Ascending)
            if (!matched && fallbackEnabled && parsedAvailable.length > 0) {
              let candidates = [...parsedAvailable];
              if (selectedFloor !== 'ALL') {
                const fNum = parseInt(selectedFloor, 10);
                candidates = candidates.filter(item => item.floorNo === fNum);
              }
              if (selectedParity === 'EVEN') {
                candidates = candidates.filter(item => !isNaN(item.numericFlatNo) && item.numericFlatNo % 2 === 0);
              } else if (selectedParity === 'ODD') {
                candidates = candidates.filter(item => !isNaN(item.numericFlatNo) && item.numericFlatNo % 2 !== 0);
              }
              if (candidates.length > 0) {
                candidates.sort((a, b) => (a.floorNo !== b.floorNo) ? (a.floorNo - b.floorNo) : ((a.numericFlatNo || 0) - (b.numericFlatNo || 0)));
                matched = candidates[0];
              }
            }

            if (matched && matched.radio) {
              if (window.__ddaReservationInProgress) return false;
              const prevInProgress = window.__ddaReservationInProgress;
              const prevTarget = window.__ddaActiveReservationTarget;
              window.__ddaReservationInProgress = true;
              window.__ddaActiveReservationTarget = matched.flatText;
              sendLog('SUCCESS', '🎯 Flat ' + matched.flatText + ' available! Reserving...');
              try {
                if (typeof window.ipcRenderer?.sendToHost === 'function') {
                  window.ipcRenderer.sendToHost('dda:flat-selected', { flatNo: matched.flatText });
                }
              } catch (_) {}
              if (window.logAnalyticsStep) {
                window.logAnalyticsStep('step4_flat_select', 'Flat Selected: ' + matched.flatText + ' (Target Match)');
              }

              // ⚡ Direct Headless Mode (Permanent Default for all users)
              if (typeof window.__ddaDirectSubmit === 'function') {
                console.log('⚡ [DIRECT POST] Live DOM match: executing direct headless reservation for ' + matched.flatText);
                const explicitFlatId = matched.radio?.getAttribute('data-value') || matched.radio?.dataset?.value;
                handleDirectSubmitResult(window.__ddaDirectSubmit(matched.flatText, explicitFlatId), matched.flatText, prevTarget, prevInProgress);
                return true;
              }

              matched.radio.click();
              try {
                matched.radio.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                matched.radio.dispatchEvent(new Event('change', { bubbles: true }));
                if (typeof window.getflatdetails === 'function') window.getflatdetails(matched.radio);
              } catch (_) {}
              triggerInstantReserveModal();
              [5, 20, 50, 100].forEach((ms) => setTimeout(triggerInstantReserveModal, ms));
              return true;
            }
            return false;
          };

          const targetsLabel = (Array.isArray(TARGET_FLATS) && TARGET_FLATS.length > 0)
            ? ' (' + TARGET_FLATS.join(', ') + ')'
            : '';

          if (scanLiveDom()) {
            return { success: true, method: 'Live DOM Immediate Match' };
          }

          // 2. High-Speed Background Fetch Polling Engine with 0ms Surgical In-Memory DOM Sync
          let attempts = 0;
          let noAnswerStreak = 0; // checks in a row that got no usable answer (slow DDA / dropped line / HTTP error)
          // Read by the app's flat check (Workspace inspectFlats): this page script can't message
          // the app itself (window.ipcRenderer only exists in the preload's scope)
          window.__ddaPollStalled = null;
          let flatClicked = false;
          let isHalted = false;
          window.__ddaFlatHunterActive = true;
          // Any poller left over from an earlier Search press is retired by the generation token
          // above (isStale), not by a stop call. A search is only ever started by the user; nothing
          // restarts it automatically after a failed reservation.

          // Stop the whole search (used when the session is gone). WARN on page 'Search' also flips the sidebar to idle.
          const stopSearch = (msg) => {
            isHalted = true;
            window.__ddaFlatHunterActive = false;
            if (window.__ddaFlatHunterTimer) {
              clearTimeout(window.__ddaFlatHunterTimer);
              window.__ddaFlatHunterTimer = null;
            }
            if (window.__ddaFlatHunterTimeout) {
              clearTimeout(window.__ddaFlatHunterTimeout);
              window.__ddaFlatHunterTimeout = null;
            }
            sendLog('WARN', msg);
          };

          // How long one flat-page check may take before it is given up on. 10s, not the 3s this
          // used to be: under booking load DDA itself took 1-9s a step (20 Oct), so a 3s cap aborted
          // every check on a slow line and the search saw no flats at all while looking busy.
          const POLL_TIMEOUT_MS = 10000;

          // Next poll 250-300ms after the START of this poll (not after its response); extraMs forces a longer pause (backoff)
          const nextPollDelay = (startedAt, extraMs) => {
            const period = 250 + Math.floor(Math.random() * 51);
            return Math.max(extraMs || 0, period - (Date.now() - startedAt));
          };

          const pollTick = async () => {
            if (isStale() || flatClicked || isHalted || window.__ddaFlatHunterActive === false || window.__ddaReservationInProgress) return;

            // DDA refuses a login's 61st flat-page request in a minute (HTTP 429): wait our turn
            // (main spreads the minute's requests evenly; 0 when DDA sends no limit)
            let rateWaitMs = 0;
            try {
              if (typeof window.__ddaFlatPageWaitMs === 'function') {
                rateWaitMs = Number(await Promise.race([window.__ddaFlatPageWaitMs(), new Promise((r) => setTimeout(() => r(0), 300))])) || 0;
              }
            } catch (_) {}
            if (isStale() || flatClicked || isHalted || window.__ddaFlatHunterActive === false || window.__ddaReservationInProgress) return;
            if (rateWaitMs > 0) {
              rateWaitMs = Math.min(rateWaitMs, 70000);
              if (rateWaitMs >= 2000) sendLog('INFO', 'DDA allows 60 flat-page checks a minute - next check in ' + Math.ceil(rateWaitMs / 1000) + 's');
              window.__ddaFlatHunterTimer = setTimeout(pollTick, rateWaitMs);
              return;
            }

            const tickStartedAt = Date.now();
            let backoffMs = 0;
            attempts++;

            sendLog('INFO', 'Searching for target flats' + targetsLabel + ' #' + attempts);

            try {
              // Cap on each poll so one stalled request can never freeze the search (POLL_TIMEOUT_MS)
              const pollAbort = new AbortController();
              const pollTimer = setTimeout(() => pollAbort.abort(), POLL_TIMEOUT_MS);
              let res;
              let html = '';
              try {
                res = await fetch(window.location.href, { cache: 'no-store', signal: pollAbort.signal });
                html = await res.text();
              } finally {
                clearTimeout(pollTimer);
              }

              // Session gone (redirected to / served the login page): nothing can be found anymore, stop the search
              const landedOnLogin =
                (res.redirected && !/step2_form/i.test(res.url || '')) ||
                html.includes('userloginform') ||
                html.includes('id="loginbtn"');
              if (landedOnLogin) {
                stopSearch('Search stopped: the DDA session has expired (login page returned). Log in again and press Search.');
                return;
              }

              // Blocked by the WAF / not authorised: the body is an interstitial, not the flat grid.
              // Without this branch it parsed as "no flats available" and we kept hitting the block
              // page 4x a second, which is exactly how a soft block becomes a hard one mid-drop.
              if (res.status === 403 || res.status === 401) {
                backoffMs = 3000;
                sendLog('WARN', 'DDA returned HTTP ' + res.status + ' (blocked/forbidden) - backing off 3s. If this keeps repeating, press Stop and reload the page.');
                throw new Error('http-' + res.status);
              }

              // Rate limited / server error: skip this response, pause a little longer, keep searching
              if (res.status === 429 || res.status >= 500) {
                backoffMs = res.status === 429 ? 2000 : 1000;
                sendLog('INFO', 'DDA server busy (HTTP ' + res.status + ') - pausing ' + (backoffMs / 1000) + 's before the next check');
                throw new Error('http-' + res.status);
              }

              // Any other non-OK status: do not silently treat the body as an empty grid.
              if (!res.ok) {
                backoffMs = 1000;
                sendLog('WARN', 'Unexpected response from DDA (HTTP ' + res.status + ') - pausing 1s before the next check');
                throw new Error('http-' + res.status);
              }

              // A usable answer: say so if the last ones did not arrive
              if (noAnswerStreak > 0) {
                sendLog('INFO', 'DDA answered again after ' + noAnswerStreak + ' check' + (noAnswerStreak === 1 ? '' : 's') + ' without a usable answer.');
                noAnswerStreak = 0;
                window.__ddaPollStalled = null;
              }

              const parser = new DOMParser();
              const doc = parser.parseFromString(html, 'text/html');

              const availableEls = Array.from(doc.querySelectorAll('.building.available'));

              // Publish what this poll actually saw, and PUSH it to the app. The live DOM is only
              // patched for the one flat we reserve, so it can be minutes stale. Pushing here means
              // the sidebar gets fresher data than its own grid check ever had, and that check can
              // skip its executeJavaScript round trip entirely while a search is running.
              try {
                const seenFlats = availableEls.map((el) => {
                  const s = el.querySelector('span');
                  return s ? (s.innerText || s.textContent || '').trim().toUpperCase() : '';
                }).filter(Boolean);
                const gridLoaded = availableEls.length > 0 || !!doc.querySelector('.floorblock, .building');

                window.__ddaLastPolledFlats = { flats: seenFlats, gridLoaded, at: Date.now() };

                const bookedNow = window.__ddaBookedFlatsSet || new Set();
                const liveTargets = TARGET_FLATS.filter((t) => !bookedNow.has(t));
                const payload = {
                  isFlatSelectPage: true,
                  isGridLoaded: gridLoaded,
                  totalAvailable: seenFlats.length,
                  availableFlats: seenFlats,
                  noneTargetAvailable: liveTargets.length > 0 && !liveTargets.some((t) => seenFlats.some((f) => flatKey(f) === flatKey(t))),
                  targetFlats: TARGET_FLATS,
                  pollStalled: false,
                  source: 'poll',
                  timestamp: Date.now()
                };
                if (typeof window.ipcRenderer?.sendToHost === 'function') {
                  window.ipcRenderer.sendToHost('dda:flat-availability', payload);
                }
              } catch (_) {}

              if (availableEls.length > 0) {
                const bookedSet = window.__ddaBookedFlatsSet || new Set();
                const parsedAvailable = availableEls.map(parseFlatElement).filter(item => item && !bookedSet.has(item.flatText));
                let matchedTarget = null;

                const candidateTargets = TARGET_FLATS.filter(t => !bookedSet.has(t));
                for (const target of candidateTargets) {
                  matchedTarget = parsedAvailable.find(item => flatKey(item.flatText) === flatKey(target));
                  if (matchedTarget) break;
                }

                if (!matchedTarget && fallbackEnabled) {
                  let candidates = [...parsedAvailable];
                  if (selectedFloor !== 'ALL') {
                    const fNum = parseInt(selectedFloor, 10);
                    candidates = candidates.filter(item => item.floorNo === fNum);
                  }
                  if (selectedParity === 'EVEN') {
                    candidates = candidates.filter(item => !isNaN(item.numericFlatNo) && item.numericFlatNo % 2 === 0);
                  } else if (selectedParity === 'ODD') {
                    candidates = candidates.filter(item => !isNaN(item.numericFlatNo) && item.numericFlatNo % 2 !== 0);
                  }
                  if (candidates.length > 0) {
                    candidates.sort((a, b) => (a.floorNo !== b.floorNo) ? (a.floorNo - b.floorNo) : ((a.numericFlatNo || 0) - (b.numericFlatNo || 0)));
                    matchedTarget = candidates[0];
                  }
                }

                if (matchedTarget) {
                  if (window.__ddaReservationInProgress) return;
                  const prevInProgress = window.__ddaReservationInProgress;
                  const prevTarget = window.__ddaActiveReservationTarget;
                  window.__ddaReservationInProgress = true;
                  window.__ddaActiveReservationTarget = matchedTarget.flatText;
                  flatClicked = true;
                  window.__ddaFlatHunterActive = false;
                  if (window.__ddaFlatHunterTimer) {
                    clearTimeout(window.__ddaFlatHunterTimer);
                    window.__ddaFlatHunterTimer = null;
                  }

                  // ⚡ Direct Headless Mode FIRST (Permanent Default): Bypasses DOM surgery completely!
                  if (typeof window.__ddaDirectSubmit === 'function') {
                    sendLog('SUCCESS', '🎯 Flat ' + matchedTarget.flatText + ' available! Executing direct headless reservation...');
                    console.log('⚡ [DIRECT POST] Polled target match: executing pure direct headless reservation for ' + matchedTarget.flatText);
                    const explicitFlatId = matchedTarget.radio?.getAttribute('data-value') || matchedTarget.el?.querySelector('input[type="radio"]')?.getAttribute('data-value');

                    try {
                      const allLiveBuildings = Array.from(document.querySelectorAll('.building'));
                      const liveTargetEl = allLiveBuildings.find(b => {
                        const s = b.querySelector('span');
                        return s && (s.innerText || s.textContent || '').trim().toUpperCase() === matchedTarget.flatText;
                      });
                      if (liveTargetEl && matchedTarget.el) {
                        const freshNode = document.importNode(matchedTarget.el, true);
                        liveTargetEl.replaceWith(freshNode);
                      }
                    } catch (_) {}

                    handleDirectSubmitResult(window.__ddaDirectSubmit(matchedTarget.flatText, explicitFlatId), matchedTarget.flatText, prevTarget, prevInProgress);
                    return;
                  }

                  sendLog('SUCCESS', '🎯 Flat ' + matchedTarget.flatText + ' available! Reserving via modal...');

                  // 0ms Surgical In-Memory DOM Patching (Modal Mode only)
                  let liveTargetEl = null;
                  const allLiveBuildings = Array.from(document.querySelectorAll('.building'));
                  liveTargetEl = allLiveBuildings.find(b => {
                    const s = b.querySelector('span');
                    return s && (s.innerText || s.textContent || '').trim().toUpperCase() === matchedTarget.flatText;
                  });

                  if (liveTargetEl && matchedTarget.el) {
                    try {
                      const freshNode = document.importNode(matchedTarget.el, true);
                      liveTargetEl.replaceWith(freshNode);
                      const freshRadio = freshNode.querySelector('input[type="radio"]');
                      if (freshRadio) {
                        try {
                          if (typeof window.ipcRenderer?.sendToHost === 'function') {
                            window.ipcRenderer.sendToHost('dda:flat-selected', { flatNo: matchedTarget.flatText });
                          }
                        } catch (_) {}
                        if (window.logAnalyticsStep) {
                          window.logAnalyticsStep('step4_flat_select', 'Flat Selected: ' + matchedTarget.flatText + ' (Target Match)');
                        }

                        freshRadio.click();
                        freshRadio.dispatchEvent(new Event('change', { bubbles: true }));
                        if (typeof window.getflatdetails === 'function') window.getflatdetails(freshRadio);
                        triggerInstantReserveModal();
                        [5, 20, 50, 100].forEach((ms) => setTimeout(triggerInstantReserveModal, ms));
                        return;
                      }
                    } catch (_) {}
                  }

                  // Non-destructive fallback: NEVER reload page!
                  console.warn('[DOM Sync] Patch bypassed for Flat ' + matchedTarget.flatText + '. Resuming hunter loop.');
                  window.__ddaReservationInProgress = false;
                  window.__ddaActiveReservationTarget = null;
                  flatClicked = false;
                  window.__ddaFlatHunterActive = true;
                  window.__ddaFlatHunterTimer = setTimeout(pollTick, nextPollDelay(tickStartedAt, 0));
                  return;
                }
              }
            } catch (err) {
              // No usable answer: aborted after POLL_TIMEOUT_MS, the line dropped, or DDA answered
              // with an error (the HTTP branches above threw after logging and setting their own
              // backoff). This must never be silent - a search that cannot see flats looks exactly
              // like a search that finds none, and the sidebar would say "unavailable" either way.
              // HTTP errors count too: on 20 Oct 87-99% of flat checks got HTTP 500.
              const msg = (err && err.message) || '';
              noAnswerStreak++;
              if (!/^http-/.test(msg)) {
                const why = (err && err.name) === 'AbortError'
                  ? 'no answer within ' + Math.round(POLL_TIMEOUT_MS / 1000) + 's'
                  : (msg || 'connection error');
                if (noAnswerStreak === 1 || noAnswerStreak % 5 === 0) {
                  sendLog('WARN', 'Flat check #' + attempts + ': ' + why + ' (' + noAnswerStreak + ' in a row). Still checking - but no flat can be seen while this lasts.');
                }
              }
              // Three in a row: the app's flat check picks this up, so the sidebar says "Checks not
              // getting through" instead of claiming the target flats are taken
              if (noAnswerStreak >= 3) {
                window.__ddaPollStalled = { streak: noAnswerStreak, at: Date.now() };
              }
            }

            if (!isStale() && !flatClicked && !isHalted && window.__ddaFlatHunterActive !== false) {
              window.__ddaFlatHunterTimer = setTimeout(pollTick, nextPollDelay(tickStartedAt, backoffMs));
            }
          };

          window.__ddaFlatHunterTimer = setTimeout(pollTick, 50);

          // Auto-stop after huntDurationSec (skipped in continuous mode)
          if (!isContinuous && huntDurationSec > 0) {
            window.__ddaFlatHunterTimeout = setTimeout(() => {
              // A newer Search press owns the engine now — expiring this run must not stop it.
              if (isStale()) return;
              isHalted = true;
              window.__ddaFlatHunterActive = false;
              sendLog('WARN', 'Search window expired. Target flats not found.');
            }, huntDurationSec * 1000);
          }

          return { success: true, searching: true, durationSec: isContinuous ? 'continuous' : huntDurationSec };
        } catch (err) {
          return { success: false, error: err.message };
        }
      })();
    `;
  },

  getFlatReserveCode: (flatNo = '') => {
    const cleanFlat = String(flatNo || '').trim().toUpperCase();
    return `
      (() => {
        try {
          const targetFlat = "${cleanFlat}";

          if (targetFlat) {
            const exactInputs = document.querySelectorAll('input[type="checkbox"], input[type="radio"]');
            for (const inp of exactInputs) {
              const val = (inp.value || inp.id || '').toUpperCase().trim();
              const label = inp.closest('label, tr, td, .flat_box, .flat-box, div, .building')?.textContent?.toUpperCase() || '';
              if (val === targetFlat || val.endsWith(targetFlat) || label.includes(targetFlat)) {
                if (!inp.checked) {
                  inp.checked = true;
                  try {
                    if (typeof window.ipcRenderer?.sendToHost === 'function') {
                      window.ipcRenderer.sendToHost('dda:flat-selected', { flatNo: targetFlat });
                    }
                  } catch (_) {}
                  inp.click();
                  inp.dispatchEvent(new Event('change', { bubbles: true }));
                  if (typeof window.getflatdetails === 'function') window.getflatdetails(inp);
                }
                break;
              }
            }
          }

          // Fast-track modal open and unhide captcha block directly
          try {
            const modal = document.querySelector('#myModal, #flatDetailModal, .modal');
            if (modal) {
              modal.classList.add('show', 'in');
              modal.style.display = 'block';
              modal.setAttribute('aria-hidden', 'false');

              const capBlock = modal.querySelector('.captchblock, tr.captchblock');
              if (capBlock) {
                capBlock.style.display = 'table-row';
                capBlock.classList.remove('hide');
                capBlock.classList.add('show');
              }
              const initBtn = modal.querySelector('#submitareabtn');
              if (initBtn) initBtn.style.display = 'none';
            }
          } catch (_) {}

          return { success: true, flatNo: targetFlat, method: 'flat radio triggered & captcha block revealed' };
        } catch (err) {
          return { success: false, error: err.message };
        }
      })();
    `;
  },

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 5: APPLICATION FORM AUTOFILL & 0-CLICK SUBMIT (MATCHING APPLICATIONFORM.JS)
  // ───────────────────────────────────────────────────────────────────────────

  getFormAutofillCode: (applicant = {}, isFastPass = false, isTestOnly = false, allowDifferentApplicant = false) => {
    const p = applicant?.personal || {};
    const b = applicant?.bank || {};
    const a = applicant?.address || {};
    const j = applicant?.jointApplicant || {};
    const el = applicant?.eligibility || {};
    const pan = (applicant?.pan || p.pan || '').trim().toUpperCase();
    let serializedApplicant = '';
    try {
      const jsonStr = JSON.stringify(applicant || {});
      if (typeof Buffer !== 'undefined') {
        serializedApplicant = Buffer.from(jsonStr, 'utf-8').toString('base64');
      } else if (typeof btoa !== 'undefined') {
        const bytes = new TextEncoder().encode(jsonStr);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        serializedApplicant = btoa(binary);
      }
    } catch (_) {}

    return `
      (async () => {
        try {
          // 0. The form carries the DDA account's own applicant: DDA puts the
          // account's PAN, read-only, on the form. Another person's details are
          // never filled in (the testing switch and a no-submit test allow it).
          {
            const formPan = (document.querySelector('input[name="pan"], input#pan, input#applicant_pan')?.value || '').toUpperCase().trim();
            if (${!isTestOnly && !allowDifferentApplicant} && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(formPan)) {
              console.log('__DDA_LOG__:' + JSON.stringify({ level: 'ERROR', page: 'Form', msg: "⛔ Autofill stopped: DDA's PAN can't be read on the form, so the app can't confirm whose form it is. Reload the page, or fill it by hand." }));
              return;
            }
            if (${!isTestOnly && !allowDifferentApplicant} && formPan !== ${JSON.stringify(pan)}) {
              console.log('__DDA_LOG__:' + JSON.stringify({ level: 'ERROR', page: 'Form', msg: '⛔ Autofill stopped: DDA is logged in as ' + formPan + ', but the applicant is ' + ${JSON.stringify(pan || 'none')} + '. Choose ' + formPan + "'s applicant (or log in with the right DDA account)." }));
              return;
            }
          }
          // 1. Safety Stubs to Prevent ReferenceErrors
          // DDA's alerts (validation messages) go to the log instead of a
          // blocking dialog; they are never silently dropped.
          window.alert = function(m) {
            console.log('__DDA_LOG__:' + JSON.stringify({ level: 'ERROR', page: 'Form', msg: 'DDA: ' + String(m || '') }));
          };
          window.confirm = function() { return true; };
          if (typeof window.ToggleCheckbox === 'undefined') window.ToggleCheckbox = function() {};
          if (typeof window.get_district === 'undefined') window.get_district = function() {};

          // 2. jQuery Validate Patch
          if (window.jQuery && window.jQuery.validator && !window.jQuery.validator._ddaPatched) {
            window.jQuery.validator._ddaPatched = true;
            const origRules = window.jQuery.fn.rules;
            if (typeof origRules === 'function') {
              window.jQuery.fn.rules = function(command, argument) {
                try {
                  const form = this[0]?.form;
                  if (form && !window.jQuery.data(form, 'validator')) window.jQuery(form).validate();
                  return origRules.apply(this, arguments);
                } catch (_) { return {}; }
              };
            }
          }

          const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          const nativeSelectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;

          // Fields DDA fills from its own records and locks are never changed:
          // readonly/disabled, a "readonly" class, aria-readonly, or not clickable.
          // A radio counts as locked when any radio in its group is.
          const isLockedOne = (el) => Boolean(
            el.disabled ||
            el.readOnly ||
            el.hasAttribute('disabled') ||
            el.hasAttribute('readonly') ||
            el.classList?.contains('readonly') ||
            el.getAttribute('aria-readonly') === 'true' ||
            (() => { try { return window.getComputedStyle(el).pointerEvents === 'none'; } catch (_) { return false; } })()
          );
          const isFieldDisabledOrReadOnly = (el) => {
            if (!el) return false;
            if (isLockedOne(el)) return true;
            if (el.type === 'radio' && el.name) {
              const group = document.querySelectorAll('input[type="radio"][name="' + CSS.escape(el.name) + '"]');
              return Array.from(group).some(isLockedOne);
            }
            return false;
          };

          const fastSetInput = (selectors, val) => {
            const strVal = (val === undefined || val === null) ? '' : String(val);
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                if (isFieldDisabledOrReadOnly(el)) return false;
                if (nativeInputSetter) nativeInputSetter.call(el, strVal);
                else el.value = strVal;
                try {
                  if (typeof window.jQuery !== 'undefined' && window.jQuery(el).val) window.jQuery(el).val(strVal);
                  else if (typeof window.$ !== 'undefined' && window.$(el).val) window.$(el).val(strVal);
                } catch (_) {}
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
                return true;
              }
            }
            return false;
          };

          const fastSetSelect = (selectors, val) => {
            if (!val) return false;
            const normVal = String(val).toUpperCase().trim();
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.tagName === 'SELECT') {
                if (isFieldDisabledOrReadOnly(el)) return false;
                for (const opt of el.options) {
                  if (opt.value.toUpperCase() === normVal || opt.text.toUpperCase().includes(normVal)) {
                    if (nativeSelectSetter) nativeSelectSetter.call(el, opt.value);
                    else el.value = opt.value;
                    try {
                      if (typeof window.jQuery !== 'undefined' && window.jQuery(el).val) window.jQuery(el).val(opt.value);
                      else if (typeof window.$ !== 'undefined' && window.$(el).val) window.$(el).val(opt.value);
                    } catch (_) {}
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                  }
                }
              }
            }
            return false;
          };

          function base64ToFile(base64Data, defaultBaseName = 'photo') {
            if (!base64Data || typeof base64Data !== 'string') return null;
            const match = base64Data.match(/^data:([a-zA-Z0-9]+\\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
            const mime = match ? match[1] : 'image/jpeg';
            const rawBase64 = match ? match[2] : base64Data;
            const ext = mime.includes('png') ? 'png' : (mime.includes('pdf') ? 'pdf' : 'jpg');
            try {
              const byteChars = atob(rawBase64);
              let byteNums = new Uint8Array(byteChars.length);
              for (let i = 0; i < byteChars.length; i++) {
                byteNums[i] = byteChars.charCodeAt(i);
              }
              // Some stored PDFs carry junk before "%PDF" (one was saved inside a
              // Java-serialized HTTP response). PDF readers skip it, but DDA's type
              // check sees the junk, so DDA gets the PDF from "%PDF" on.
              if (ext === 'pdf') {
                const head = byteChars.slice(0, 1024).indexOf('%PDF');
                if (head > 0) byteNums = byteNums.subarray(head);
              }
              const blob = new Blob([byteNums], { type: mime });
              return new File([blob], defaultBaseName + '.' + ext, { type: mime });
            } catch (_) {
              return null;
            }
          }

          function setFileInput(input, file) {
            if (!input || !file) return false;
            try {
              const dt = new DataTransfer();
              dt.items.add(file);
              input.files = dt.files;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            } catch (_) {
              return false;
            }
          }

          let photoFileObj = null;
          let signFileObj = null;
          let jPhotoFileObj = null;
          let jSignFileObj = null;
          let empIdCard1aFile = null;
          let empCert1aFile = null;
          let salarySlipFile = null;
          let form16File = null;
          let profDegreeFile = null;
          let itrFile = null;
          let proRegDocFile = null;
          let empIdCard1bFile = null;
          let empCert1bFile = null;

          let appObj = {};
          try {
            appObj = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("${serializedApplicant}"), c => c.charCodeAt(0))));
          } catch (_) {}

          let curApp = appObj;
          try {
            const rawActive = sessionStorage.getItem('window.__ACTIVE_APPLICANT__') || localStorage.getItem('dda_active_applicant');
            if (rawActive) {
              const parsedActive = JSON.parse(rawActive);
              if (parsedActive) curApp = { ...parsedActive, ...appObj };
            }
          } catch (_) {}

          const pData = curApp?.personal || {};
          const jData = curApp?.jointApplicant || {};
          const el = curApp?.eligibility || {};

          const photoData = pData.photo || curApp.photo || pData.photoUrl || curApp.photoUrl || '';
          const signData = pData.sign || curApp.sign || pData.signature || curApp.signature || '';

          const hasJoint = !!(
            jData &&
            (jData.firstName || jData.pan || jData.relation || jData.relationship || jData.enabled === true || jData.enabled === '1')
          );

          // A field is filled only from a value the applicant record really
          // has; nothing is invented, and a value DDA shows is never blanked.
          const pRec = curApp?.personal || {};
          const bRec = curApp?.bank || {};
          const aRec = curApp?.address || {};
          const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';
          const fillIfKnown = (selectors, val) => (hasVal(val) ? fastSetInput(selectors, val) : false);
          // Karmajeevi: only applicants marked eligible, with a para type chosen.
          const isKarmajeeviEligible = el.enabled !== false && el.enabled !== 'false' && hasVal(el.paraType);
          const appLog = (level, msg) => console.log('__DDA_LOG__:' + JSON.stringify({ level, page: 'Form', msg }));

          function fillPhotoAndSignature() {
            const photoInput = document.querySelector(
              '#image, #photo, input[name="photograph"], input[name="image"], input[type="file"][name*="photo"], input[type="file"][name*="image"]'
            );
            const signInput = document.querySelector(
              '#signature, input[name="signature"], input[type="file"][name*="sign"]'
            );

            // Same rule as preload-dda.js: no photo / signature saved, but DDA's form
            // shows the box and has none on file -> a blank white JPG goes in.
            const blank = window.__ddaBlankImages || {};
            const ddaWantsUpload = (input, previewId, hiddenId) => {
              if (!input || input.disabled) return false;
              if (input.closest('[style*="display: none"], [style*="display:none"], .d-none, .hide, .hidden')) return false;
              const src = String(document.getElementById(previewId)?.getAttribute('src') || '');
              const ddaDefault = !src || /\\/images\\/(userimage|signature)\\.png(\\?|$)/i.test(src);
              return ddaDefault && !String(document.getElementById(hiddenId)?.value || '').trim();
            };
            // Decided once per page (shared with the page engine): after the first
            // fill the box shows the blank itself, not DDA's default picture.
            if (!photoData && photoInput && (photoInput.id === 'image' || photoInput.name === 'photograph') && ddaWantsUpload(photoInput, 'photog', 'pic')) window.__ddaBlankPhotoUsed = true;
            if (!signData && signInput && (signInput.id === 'signature' || signInput.name === 'signature') && ddaWantsUpload(signInput, 'sign', 'sgn')) window.__ddaBlankSignUsed = true;
            const usePhoto = photoData || (window.__ddaBlankPhotoUsed ? (blank.photo || '') : '');
            const useSign = signData || (window.__ddaBlankSignUsed ? (blank.signature || '') : '');
            if (!photoData && usePhoto) appLog('WARN', '📷 No photo saved for this applicant: attached a blank white photo, since DDA\\'s form asks for one. Send the real photo to DDA later.');
            if (!signData && useSign) appLog('WARN', '✍️ No signature saved for this applicant: attached a blank white signature, since DDA\\'s form asks for one. Send the real signature to DDA later.');

            if (photoInput) {
              if (usePhoto) {
                photoFileObj = base64ToFile(usePhoto, 'photo');
                if (photoFileObj) {
                  setFileInput(photoInput, photoFileObj);
                  const previewImg = document.getElementById('photog');
                  if (previewImg && usePhoto.startsWith('data:')) previewImg.src = usePhoto;
                  const picHidden = document.getElementById('pic');
                  if (picHidden) picHidden.value = photoFileObj.name;
                }
              } else {
                try { photoInput.value = ''; photoInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
              }
            }
            if (signInput) {
              if (useSign) {
                signFileObj = base64ToFile(useSign, 'signature');
                if (signFileObj) {
                  setFileInput(signInput, signFileObj);
                  const previewSign = document.getElementById('sign');
                  if (previewSign && useSign.startsWith('data:')) previewSign.src = useSign;
                  const sgnHidden = document.getElementById('sgn');
                  if (sgnHidden) sgnHidden.value = signFileObj.name;
                }
              } else {
                try { signInput.value = ''; signInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
              }
            }

            // 👥 Joint Applicant Photo & Signature (if joint applicant attached)
            if (hasJoint) {
              const jPhotoInput = document.querySelector(
                '#joint_applicant_photograph_1, input[name="joint_applicant[1][photograph]"], input.jphotograph'
              );
              const jSignInput = document.querySelector(
                '#joint_applicant_signature_1, input[name="joint_applicant[1][signature]"], input.jsignature'
              );
              if (jPhotoInput) {
                if (jData.photo) {
                  jPhotoFileObj = base64ToFile(jData.photo, 'joint_photo');
                  if (jPhotoFileObj) {
                    setFileInput(jPhotoInput, jPhotoFileObj);
                    const jPreview = document.getElementById('jphotog1');
                    if (jPreview && jData.photo.startsWith('data:')) jPreview.src = jData.photo;
                    const hphoto = document.getElementById('hphoto1');
                    if (hphoto) hphoto.value = jPhotoFileObj.name;
                  }
                } else {
                  try { jPhotoInput.value = ''; jPhotoInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
                }
              }
              if (jSignInput) {
                if (jData.sign || jData.signature) {
                  jSignFileObj = base64ToFile(jData.sign || jData.signature, 'joint_sign');
                  if (jSignFileObj) {
                    setFileInput(jSignInput, jSignFileObj);
                    const jPreview = document.getElementById('jsign1');
                    if (jPreview && (jData.sign || jData.signature).startsWith('data:')) jPreview.src = jData.sign || jData.signature;
                    const hsign = document.getElementById('hsign1');
                    if (hsign) hsign.value = jSignFileObj.name;
                  }
                } else {
                  try { jSignInput.value = ''; jSignInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
                }
              }
            }
          }

          function fillKarmajeeviEligibility() {
            const paraSelect = document.getElementById('para_type') || document.querySelector("select[name='para_type']");
            if (!paraSelect) return;

            if (!isKarmajeeviEligible) {
              if (!paraSelect.value) appLog('WARN', '⚠️ This applicant has no Karmajeevi eligibility details — fill the Para 2.4 section on the form by hand.');
              return;
            }
            // Skip Form, or a choice DDA has locked: a different saved choice is kept as is.
            if ((effectiveFastPass || isFieldDisabledOrReadOnly(paraSelect)) && paraSelect.value && paraSelect.value !== String(el.paraType).trim()) {
              appLog('INFO', "ℹ️ Skip Form: keeping DDA's saved Para 2.4 choice (" + paraSelect.value + '); the applicant record says ' + el.paraType + '.');
              return;
            }

            try {
              const pType = String(el.paraType).trim();
              fastSetSelect(['#para_type', 'select[name="para_type"]'], pType);

              if (pType === '1a') {
                const sec1a = document.getElementById('documents_1a_section');
                if (sec1a) sec1a.style.display = 'flex';
                const sec1b = document.getElementById('documents_1b_section');
                if (sec1b) sec1b.style.display = 'none';

                const empCertType = document.getElementById('emp_id_card_certificate_type');
                if (empCertType && hasVal(el.empIdCardCertificateType)) {
                  fastSetSelect(['#emp_id_card_certificate_type', 'select[name="emp_id_card_certificate_type"]'], el.empIdCardCertificateType);
                  if (String(el.empIdCardCertificateType) === '2') {
                    const s2 = document.getElementById('emp_certificate_1a_section');
                    if (s2) s2.style.display = '';
                    const s1 = document.getElementById('emp_id_card_1a_section');
                    if (s1) s1.style.display = 'none';
                    const f = document.getElementById('emp_certificate_1a');
                    if (f && el.empCertificate1a) {
                      empCert1aFile = base64ToFile(el.empCertificate1a, 'employer_certificate_1a');
                      if (empCert1aFile) setFileInput(f, empCert1aFile);
                    }
                  } else if (String(el.empIdCardCertificateType) === '1') {
                    const s1 = document.getElementById('emp_id_card_1a_section');
                    if (s1) s1.style.display = '';
                    const s2 = document.getElementById('emp_certificate_1a_section');
                    if (s2) s2.style.display = 'none';
                    const f = document.getElementById('emp_id_card_1a');
                    if (f && el.empIdCard1a) {
                      empIdCard1aFile = base64ToFile(el.empIdCard1a, 'emp_id_card_1a');
                      if (empIdCard1aFile) setFileInput(f, empIdCard1aFile);
                    }
                  }
                }

                const salType = document.getElementById('salary_slip_form_16_type');
                if (salType && hasVal(el.salarySlipForm16Type)) {
                  fastSetSelect(['#salary_slip_form_16_type', 'select[name="salary_slip_form_16_type"]'], el.salarySlipForm16Type);
                  if (String(el.salarySlipForm16Type) === '2') {
                    const sf = document.getElementById('form_16_section');
                    if (sf) sf.style.display = '';
                    const ss = document.getElementById('salary_slip_section');
                    if (ss) ss.style.display = 'none';
                    const f = document.getElementById('form_16');
                    if (f && el.form16) {
                      form16File = base64ToFile(el.form16, 'form_16');
                      if (form16File) setFileInput(f, form16File);
                    }
                  } else if (String(el.salarySlipForm16Type) === '1') {
                    const ss = document.getElementById('salary_slip_section');
                    if (ss) ss.style.display = '';
                    const sf = document.getElementById('form_16_section');
                    if (sf) sf.style.display = 'none';
                    const f = document.getElementById('salary_slip');
                    if (f && el.salarySlip) {
                      salarySlipFile = base64ToFile(el.salarySlip, 'salary_slip');
                      if (salarySlipFile) setFileInput(f, salarySlipFile);
                    }
                  }
                }
              } else if (pType === '1b') {
                const sec1b = document.getElementById('documents_1b_section');
                if (sec1b) sec1b.style.display = 'flex';
                const sec1a = document.getElementById('documents_1a_section');
                if (sec1a) sec1a.style.display = 'none';

                const degInput = document.getElementById('professional_degree_certificate');
                if (degInput && el.professionalDegreeCertificate) {
                  profDegreeFile = base64ToFile(el.professionalDegreeCertificate, 'professional_degree');
                  if (profDegreeFile) setFileInput(degInput, profDegreeFile);
                }

                const itrInput = document.getElementById('income_tax_return');
                if (itrInput && el.incomeTaxReturn) {
                  itrFile = base64ToFile(el.incomeTaxReturn, 'itr');
                  if (itrFile) setFileInput(itrInput, itrFile);
                }

                const proBodySelect = document.getElementById('pro_reg_Certificate_issued');
                if (proBodySelect && el.proRegCertificateIssued) {
                  fastSetSelect(['#pro_reg_Certificate_issued', 'select[name="pro_reg_Certificate_issued"]'], el.proRegCertificateIssued);
                  if (el.proRegCertificateIssued === 'other') {
                    const otherSec = document.getElementById('other_pro_reg_section');
                    if (otherSec) otherSec.style.display = '';
                    const otherInput = document.getElementById('other_pro_reg_Certificate_issued');
                    if (otherInput && !isFieldDisabledOrReadOnly(otherInput)) otherInput.value = el.otherProRegCertificateIssued || '';
                  }
                  const docInput = document.getElementById('pro_reg_Certificate_issued_doc');
                  if (docInput && el.proRegCertificateIssuedDoc) {
                    proRegDocFile = base64ToFile(el.proRegCertificateIssuedDoc, 'pro_reg_doc');
                    if (proRegDocFile) setFileInput(docInput, proRegDocFile);
                  }
                }

                const empCert1b = document.getElementById('emp_id_card_certificate_1b');
                if (empCert1b && el.empIdCardCertificate1b) {
                  fastSetSelect(['#emp_id_card_certificate_1b', 'select[name="emp_id_card_certificate_1b"]'], el.empIdCardCertificate1b);
                  empCert1b.dispatchEvent(new Event('change', { bubbles: true }));
                  if (String(el.empIdCardCertificate1b) === '1') {
                    const sec = document.getElementById('emp_id_card_1b_section');
                    if (sec) sec.style.display = '';
                    const f = document.getElementById('emp_id_card_1b');
                    if (f && el.empIdCard1b) {
                      empIdCard1bFile = base64ToFile(el.empIdCard1b, 'emp_id_card_1b');
                      if (empIdCard1bFile) setFileInput(f, empIdCard1bFile);
                    }
                  } else if (String(el.empIdCardCertificate1b) === '2') {
                    const sec = document.getElementById('emp_certificate_1b_section');
                    if (sec) sec.style.display = '';
                    const f = document.getElementById('emp_certificate_1b');
                    if (f && el.empCertificate1b) {
                      empCert1bFile = base64ToFile(el.empCertificate1b, 'emp_certificate_1b');
                      if (empCert1bFile) setFileInput(f, empCert1bFile);
                    }
                  }
                }
              }
            } catch (elErr) {
              console.warn('⚠️ [AppForm] Karamjeevi eligibility documents autofill error:', elErr);
            }
          }

          // 🧹 Clean-slate form purge: ensures zero bleed from previously loaded applicants (never clears readonly or disabled fields)
          function purgeApplicantFormFields() {
            // 1. Purge personal, bank, and address optional fields (never touch readonly PAN pre-set by DDA server or disabled fields)
            const textSelectors = [
              '#applicant_middle_name', 'input[name="applicant_middle_name"]',
              '#applicant_last_name', 'input[name="applicant_last_name"]',
              '#father_name', 'input[name="father_name"]',
              '#mother_name', 'input[name="mother_name"]',
              '#std_code', 'input[name="std_code"]',
              '#phone', 'input[name="phone"]',
              '#spouse_name', 'input[name="spouse_name"]',
              '#branch', 'input[name="branch"]',
              '#ifsc_code', 'input[name="ifsc_code"]',
              '#bank_account_number', 'input[name="bank_account_number"]',
              '#correspondence_address_house_no', 'input[name="correspondence_address_house_no"]',
              '#correspondence_address_street', 'input[name="correspondence_address_street"]',
              '#correspondence_address_area', 'input[name="correspondence_address_area"]',
              '#correspondence_address_town', 'input[name="correspondence_address_town"]',
              '#correspondence_address_pin', 'input[name="correspondence_address_pin"]',
              '#joint_applicant_first_name_1', 'input[name="joint_applicant[1][first_name]"]',
              '#joint_applicant_middle_name_1', 'input[name="joint_applicant[1][middle_name]"]',
              '#joint_applicant_last_name_1', 'input[name="joint_applicant[1][last_name]"]',
              '#joint_applicant_father_name_1', 'input[name="joint_applicant[1][father_name]"]',
              '#joint_applicant_mother_name_1', 'input[name="joint_applicant[1][mother_name]"]',
              '#joint_applicant_dob_1', 'input[name="joint_applicant[1][dob]"]',
              '#joint_applicant_pan_1', 'input[name="joint_applicant[1][pan]"]',
              '#joint_applicant_aadhar_1', 'input[name="joint_applicant[1][aadhar]"]',
              '#joint_applicant_email_1', 'input[name="joint_applicant[1][email]"]',
              '#joint_applicant_mobile_1', 'input[name="joint_applicant[1][mobile]"]',
              '#joint_applicant_spouse_name_1', 'input[name="joint_applicant[1][spouse_name]"]',
              '#other_pro_reg_Certificate_issued'
            ];
            for (const sel of textSelectors) {
              const el = document.querySelector(sel);
              if (el && !isFieldDisabledOrReadOnly(el)) {
                fastSetInput([sel], '');
              }
            }

            // 2. Clear file attachments (including primary applicant photo & signature)
            const fileSelectors = [
              '#image', '#photo', 'input[name="photograph"]', 'input[name="image"]', 'input[type="file"][name*="photo"]', 'input[type="file"][name*="image"]',
              '#signature', 'input[name="signature"]', 'input[type="file"][name*="sign"]',
              '#joint_applicant_photograph_1', 'input[name="joint_applicant[1][photograph]"]',
              '#joint_applicant_signature_1', 'input[name="joint_applicant[1][signature]"]',
              '#emp_id_card_1a', '#emp_certificate_1a', '#salary_slip', '#form_16',
              '#professional_degree_certificate', '#income_tax_return', '#pro_reg_Certificate_issued_doc',
              '#emp_id_card_1b', '#emp_certificate_1b'
            ];
            for (const sel of fileSelectors) {
              const el = document.querySelector(sel);
              if (el && el.type === 'file' && !isFieldDisabledOrReadOnly(el)) {
                try { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
              }
            }

            // 3. Reset conditional containers
            const spouseCont = document.getElementById('marital_spouse');
            if (spouseCont) spouseCont.style.display = 'none';
            const jSpouseCont = document.getElementById('joint_applicant_marital_spouse_1');
            if (jSpouseCont) jSpouseCont.style.display = 'none';
            const otherProReg = document.getElementById('other_pro_reg_section');
            if (otherProReg) otherProReg.style.display = 'none';
          }

          // Declaration Checkbox (Mandatory in both Fast-Pass and Standard modes)
          const ackBox = document.querySelector('#acknowledge, input[name="acknowledge"]');
          if (ackBox && !isFieldDisabledOrReadOnly(ackBox)) {
            ackBox.checked = true;
            ackBox.dispatchEvent(new Event('change', { bubbles: true }));
          }

          // ─── Pillar 1: Universal Joint Applicant Synchronization ───
          function syncJointApplicant(hasJointApplicant, isFastPassMode) {
            const jointYes = document.querySelector('input.is_add_joint[value="1"]');
            const jointNo = document.querySelector('input.is_add_joint[value="0"]');

            if (hasJointApplicant) {
              if (jointYes && !isFieldDisabledOrReadOnly(jointYes)) {
                jointYes.checked = true;
                if (jointNo) jointNo.checked = false;
                jointYes.dispatchEvent(new Event('change', { bubbles: true }));
                jointYes.dispatchEvent(new Event('click', { bubbles: true }));
              }
              if (!isFastPassMode) {
                fastSetInput(['#joint_applicant_first_name_1', 'input[name="joint_applicant[1][first_name]"]'], "${j.firstName || ''}");
                fastSetInput(['#joint_applicant_middle_name_1', 'input[name="joint_applicant[1][middle_name]"]'], "${j.middleName || ''}");
                fastSetInput(['#joint_applicant_last_name_1', 'input[name="joint_applicant[1][last_name]"]'], "${j.lastName || ''}");
                fastSetInput(['#joint_applicant_father_name_1', 'input[name="joint_applicant[1][father_name]"]'], "${j.fatherName || ''}");
                fastSetInput(['#joint_applicant_mother_name_1', 'input[name="joint_applicant[1][mother_name]"]'], "${j.motherName || ''}");
                fastSetInput(['#joint_applicant_dob_1', 'input[name="joint_applicant[1][dob]"]'], "${j.dob || ''}");
                fastSetInput(['#joint_applicant_pan_1', 'input[name="joint_applicant[1][pan]"]'], "${(j.pan || '').toUpperCase()}");
                fastSetInput(['#joint_applicant_aadhar_1', 'input[name="joint_applicant[1][aadhar]"]'], "${j.aadhar || ''}");
                fastSetInput(['#joint_applicant_email_1', 'input[name="joint_applicant[1][email]"]'], "${j.email || ''}");
                fastSetInput(['#joint_applicant_mobile_1', 'input[name="joint_applicant[1][mobile]"]'], "${j.mobile || ''}");
                if ("${j.maritalStatus || '1'}" === '2') {
                  const jSpouseCont = document.getElementById('joint_applicant_marital_spouse_1');
                  if (jSpouseCont) jSpouseCont.style.display = '';
                  fastSetInput(['#joint_applicant_spouse_name_1', 'input[name="joint_applicant[1][spouse_name]"]'], "${j.spouseName || ''}");
                } else {
                  const jSpouseCont = document.getElementById('joint_applicant_marital_spouse_1');
                  if (jSpouseCont) jSpouseCont.style.display = 'none';
                  fastSetInput(['#joint_applicant_spouse_name_1', 'input[name="joint_applicant[1][spouse_name]"]'], '');
                }
              }
            } else {
              if (jointNo && !isFieldDisabledOrReadOnly(jointNo)) {
                jointNo.checked = true;
                if (jointYes) jointYes.checked = false;
                jointNo.dispatchEvent(new Event('change', { bubbles: true }));
                jointNo.dispatchEvent(new Event('click', { bubbles: true }));
              }
              const jointFieldsToClear = [
                '#joint_applicant_first_name_1', 'input[name="joint_applicant[1][first_name]"]',
                '#joint_applicant_middle_name_1', 'input[name="joint_applicant[1][middle_name]"]',
                '#joint_applicant_last_name_1', 'input[name="joint_applicant[1][last_name]"]',
                '#joint_applicant_father_name_1', 'input[name="joint_applicant[1][father_name]"]',
                '#joint_applicant_mother_name_1', 'input[name="joint_applicant[1][mother_name]"]',
                '#joint_applicant_dob_1', 'input[name="joint_applicant[1][dob]"]',
                '#joint_applicant_pan_1', 'input[name="joint_applicant[1][pan]"]',
                '#joint_applicant_aadhar_1', 'input[name="joint_applicant[1][aadhar]"]',
                '#joint_applicant_email_1', 'input[name="joint_applicant[1][email]"]',
                '#joint_applicant_mobile_1', 'input[name="joint_applicant[1][mobile]"]',
                '#joint_applicant_spouse_name_1', 'input[name="joint_applicant[1][spouse_name]"]'
              ];
              for (const sel of jointFieldsToClear) {
                fastSetInput([sel], '');
              }
              document.querySelectorAll(
                'input[name^="joint_applicant"], select[name^="joint_applicant"], textarea[name^="joint_applicant"]'
              ).forEach(el => {
                el.required = false;
                el.removeAttribute('required');
              });

              const jPhotoInput = document.querySelector(
                '#joint_applicant_photograph_1, input[name="joint_applicant[1][photograph]"], input.jphotograph'
              );
              const jSignInput = document.querySelector(
                '#joint_applicant_signature_1, input[name="joint_applicant[1][signature]"], input.jsignature'
              );
              if (jPhotoInput) {
                try { jPhotoInput.value = ''; jPhotoInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
              }
              if (jSignInput) {
                try { jSignInput.value = ''; jSignInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
              }
              const jSpouseCont = document.getElementById('joint_applicant_marital_spouse_1');
              if (jSpouseCont) jSpouseCont.style.display = 'none';
            }
          }

          // ─── Pillar 2: Pre-Filled Detection & Safety Fallback in Skip Form Mode ───
          let effectiveFastPass = ${isFastPass ? 'true' : 'false'};
          if (effectiveFastPass) {
            const prefilledName = (
              document.querySelector('#applicant_first_name, input[name="applicant_first_name"], input[name="first_name"]')?.value || ''
            ).trim();
            const prefilledFather = (
              document.querySelector('#father_name, input[name="father_name"]')?.value || ''
            ).trim();
            const prefilledMobile = (
              document.querySelector('#mobile, input[name="mobile"]')?.value || ''
            ).trim();

            if (!prefilledName && !prefilledFather && !prefilledMobile) {
              console.warn('⚠️ [AppForm] Fast-Pass Active but DDA form fields are completely blank! Falling back to full form autofill...');
              effectiveFastPass = false;
            }
          }

          if (effectiveFastPass) {
            // Check & upload Photo & Signature (if present on the page)
            fillPhotoAndSignature();

            // Check & upload Karamjeevi 2.4 Eligibility Documents (if present on the page)
            fillKarmajeeviEligibility();

            // ─── Pillar 1: Universal Joint Applicant Synchronization in Fast-Pass ───
            syncJointApplicant(hasJoint, true);
            // DDA shows the joint applicant's section only once "joint applicant" is
            // chosen (just above): fill its photo / signature now that it is visible.
            if (hasJoint) fillPhotoAndSignature();
          } else {
            // Clean-slate purge before filling new applicant's details
            purgeApplicantFormFields();

            // 1. Personal Details (PAN is read-only and pre-set by DDA server for active session; never overwrite)
            fillIfKnown(['#applicant_first_name', 'input[name="applicant_first_name"]', 'input[name="first_name"]'], pRec.firstName);
            fillIfKnown(['#applicant_middle_name', 'input[name="applicant_middle_name"]'], pRec.middleName);
            fillIfKnown(['#applicant_last_name', 'input[name="applicant_last_name"]'], pRec.lastName);
            fillIfKnown(['#father_name', 'input[name="father_name"]'], pRec.fatherName);
            fillIfKnown(['#mother_name', 'input[name="mother_name"]'], pRec.motherName);
            fillIfKnown(['#dob', 'input[name="dob"]'], pRec.dob);
            fillIfKnown(['#aadhar', 'input[name="aadhar"]'], pRec.aadhar);
            fillIfKnown(['#mobile', 'input[name="mobile"]'], pRec.mobile);
            fillIfKnown(['#email_id', 'input[name="email_id"]'], pRec.email);
            fillIfKnown(['#std_code', 'input[name="std_code"]'], pRec.stdCode);
            fillIfKnown(['#phone', 'input[name="phone"]'], pRec.phone);

            const checkRadio = (selector) => {
              const r = document.querySelector(selector);
              if (r && !isFieldDisabledOrReadOnly(r)) {
                r.checked = true;
                r.dispatchEvent(new Event('change', { bubbles: true }));
              }
            };

            // Gender Radio (M / F / T)
            if (hasVal(pRec.gender)) {
              const g = String(pRec.gender).trim().toUpperCase();
              checkRadio('input[name="gender"][value="' + (g.startsWith('F') ? 'F' : g.startsWith('T') ? 'T' : 'M') + '"]');
            }

            // Nationality
            if (hasVal(pRec.nationality)) {
              const nat = String(pRec.nationality).trim();
              checkRadio('input[name="nationality"][value="' + nat + '"]' + (nat === '1' ? ', #nationality_1' : ''));
            }

            // Marital Status (1 = Single, 2 = Married)
            if (hasVal(pRec.maritalStatus)) {
              const maritalVal = (String(pRec.maritalStatus).toUpperCase().includes('MARR') || String(pRec.maritalStatus).trim() === '2') ? '2' : '1';
              const maritalSelect = document.querySelector('select#marital_status, select[name="marital_status"]');
              if (maritalSelect && !isFieldDisabledOrReadOnly(maritalSelect)) {
                maritalSelect.value = maritalVal;
                maritalSelect.dispatchEvent(new Event('change', { bubbles: true }));
              }
              const spouseCont = document.getElementById('marital_spouse');
              if (maritalVal === '2') {
                if (spouseCont) spouseCont.style.display = '';
                fillIfKnown(['#spouse_name', 'input[name="spouse_name"]'], pRec.spouseName);
              } else {
                if (spouseCont) spouseCont.style.display = 'none';
                fastSetInput(['#spouse_name', 'input[name="spouse_name"]'], '');
              }
            }

            // Category & PwD
            if (hasVal(pRec.categoryId)) {
              fastSetSelect(['select#ref_category_id', 'select[name="ref_category_id"]'], pRec.categoryId);
            }
            // DDA shows the handicapped questions only for the PwD category (8); others send No.
            const catNow = document.querySelector('select#ref_category_id, select[name="ref_category_id"]');
            const isPwdCategory = String(catNow?.value || pRec.categoryId || '').trim() === '8';
            const phYes = isPwdCategory && (pRec.isPhysicallyDisabled === true || String(pRec.isPhysicallyDisabled) === '1');
            checkRadio(phYes
              ? 'input[name="is_physically_disabled"][value="1"]'
              : 'input[name="is_physically_disabled"][value="0"]');
            const phSection = document.getElementById('physically_handicapped_full_section');
            if (phSection && isPwdCategory) phSection.style.display = '';
            if (phYes) {
              const pctSection = document.getElementById('percentage_section');
              if (pctSection) pctSection.style.display = '';
              const pct = String(pRec.physicallyDisabledPercentage || '').trim();
              if (pct === '1' || pct === '2') checkRadio('input[name="percentage_of_physically_disabled"][value="' + pct + '"]');
            }

            // 2. Bank Details (by DDA's bank id first, then by name)
            const bankSelect = document.querySelector('select[name="bank_id"]');
            const bankId = String(bRec.bankId || '').trim();
            const bankName = String(bRec.bankName || '').trim().toUpperCase();
            if (bankSelect && !isFieldDisabledOrReadOnly(bankSelect) && (bankId || bankName)) {
              const opts = Array.from(bankSelect.options).filter(o => o.value);
              const opt = (bankId && opts.find(o => String(o.value).trim() === bankId)) ||
                (bankName && opts.find(o => o.text.trim().toUpperCase() === bankName)) ||
                (bankName && opts.find(o => o.text.toUpperCase().includes(bankName)));
              if (opt) {
                bankSelect.value = opt.value;
                bankSelect.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            fillIfKnown(['#branch', 'input[name="branch"]'], bRec.branchName);
            fillIfKnown(['#ifsc_code', 'input[name="ifsc_code"]'], String(bRec.ifsc || bRec.ifscCode || '').toUpperCase());
            fillIfKnown(['#bank_account_number', 'input[name="bank_account_number"]'], bRec.accountNo || bRec.accountNumber);

            // 3. Address Details
            fillIfKnown(['#correspondence_address_house_no', 'input[name="correspondence_address_house_no"]'], aRec.houseNo || aRec.address || pRec.address);
            fillIfKnown(['#correspondence_address_street', 'input[name="correspondence_address_street"]'], aRec.street || aRec.addressLine2);
            fillIfKnown(['#correspondence_address_area', 'input[name="correspondence_address_area"]'], aRec.area || aRec.city);
            fillIfKnown(['#correspondence_address_town', 'input[name="correspondence_address_town"]'], aRec.town);
            fillIfKnown(['#correspondence_address_pin', 'input[name="correspondence_address_pin"]'], aRec.pinCode || aRec.pincode || aRec.pin);

            // State & District Resolution (Matching by applicant details & handling DDA AJAX overwrite)
            const targetState = String(aRec.stateId || aRec.state_id || '').trim();
            const targetDistId = String(aRec.districtId || aRec.district_id || '').trim();
            const targetDistName = String(aRec.districtName || aRec.district_name || aRec.district || '').toUpperCase().trim();

            const stateSelect = document.querySelector('select#correspondence_address_ref_state_id, select[name="correspondence_address_ref_state_id"]');
            const districtSelect = document.querySelector('select#locality, select[name="correspondence_address_ref_district_id"]');

            const applyDistrict = () => {
              if (!districtSelect || isFieldDisabledOrReadOnly(districtSelect)) return;
              let matchedVal = null;
              const normTargetName = targetDistName.replace(/[^A-Z0-9]/g, '');

              // 1. Search existing options by ID or text match
              for (const opt of districtSelect.options) {
                if (!opt.value) continue;
                const optVal = String(opt.value).trim();
                const optText = opt.text.trim().toUpperCase();
                const normOptText = optText.replace(/[^A-Z0-9]/g, '');

                if (targetDistId && optVal === targetDistId) {
                  matchedVal = opt.value;
                  break;
                }
                if (normTargetName && (normOptText === normTargetName || normOptText.includes(normTargetName) || normTargetName.includes(normOptText))) {
                  matchedVal = opt.value;
                  break;
                }
              }

              // 2. DDA's list not loaded yet: carry the record's own district id
              //    (never a guessed one; with no id the field stays for the user).
              if (!matchedVal && targetDistId && districtSelect.options.length <= 1) {
                districtSelect.appendChild(new Option(targetDistName || targetDistId, targetDistId, true, true));
                matchedVal = targetDistId;
              }

              if (matchedVal && districtSelect.value !== matchedVal) {
                if (nativeSelectSetter) nativeSelectSetter.call(districtSelect, matchedVal);
                else districtSelect.value = matchedVal;
                try {
                  if (typeof window.jQuery !== 'undefined' && window.jQuery(districtSelect).val) window.jQuery(districtSelect).val(matchedVal);
                  else if (typeof window.$ !== 'undefined' && window.$(districtSelect).val) window.$(districtSelect).val(matchedVal);
                } catch (_) {}
                districtSelect.dispatchEvent(new Event('change', { bubbles: true }));
              }
            };

            // Watch for DDA's asynchronous /user/ajax/district update
            if (districtSelect) {
              try {
                const distObserver = new MutationObserver(() => {
                  if (districtSelect.options.length > 1) {
                    applyDistrict();
                  }
                });
                distObserver.observe(districtSelect, { childList: true });
                setTimeout(() => distObserver.disconnect(), 5000);
              } catch (_) {}
            }

            // Set state if known (triggers DDA get_district AJAX if state changed)
            if (targetState && stateSelect && !isFieldDisabledOrReadOnly(stateSelect)) {
              if (stateSelect.value !== targetState) {
                if (nativeSelectSetter) nativeSelectSetter.call(stateSelect, targetState);
                else stateSelect.value = targetState;
                try {
                  if (typeof window.jQuery !== 'undefined' && window.jQuery(stateSelect).val) window.jQuery(stateSelect).val(targetState);
                  else if (typeof window.$ !== 'undefined' && window.$(stateSelect).val) window.$(stateSelect).val(targetState);
                } catch (_) {}
                stateSelect.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }

            // Apply immediately and on retry ticks
            applyDistrict();
            [50, 150, 300, 600, 1200].forEach(ms => setTimeout(applyDistrict, ms));

            // Region (1 = Delhi, 2 = Outside). DDA styles these radios
            // unclickable (pointer-events: none) but the user must still pick
            // one, so the lock check is not used here; only a truly disabled
            // radio is left alone. Without a stored region it follows the
            // state (Delhi = 7).
            const applyRegion = () => {
              const reg = hasVal(aRec.region)
                ? String(aRec.region).trim()
                : (targetState ? (targetState === '7' ? '1' : '2') : '');
              const r = reg && document.querySelector('input[name="region"][value="' + reg + '"]');
              if (!r || r.disabled || r.checked) return;
              r.checked = true;
              r.dispatchEvent(new Event('change', { bubbles: true }));
              try { document.getElementById('region-error')?.remove(); } catch (_) {}
            };
            applyRegion();
            [300, 1200].forEach(ms => setTimeout(applyRegion, ms));

            // ─── Pillar 1: Universal Joint Applicant Synchronization in Fresh Mode ───
            syncJointApplicant(hasJoint, false);

            // Check & upload Photo & Signature (if present on the page)
            fillPhotoAndSignature();

            // Check & upload Karamjeevi 2.4 Eligibility Documents (if present on the page)
            fillKarmajeeviEligibility();
          }

          console.log('__DDA_LOG__:' + JSON.stringify({ level: 'INFO', page: 'Form', msg: 'Autofilled Personal, Bank, Address & Eligibility fields' }));

          // Confirm DDA's own "submit?" popup only; an error popup stays open
          // and its text goes to the log.
          const formCheck = window.__ddaAppFormCheck || null;
          if (formCheck) {
            const autoSwal = setInterval(formCheck.confirmPopup, 50);
            setTimeout(() => clearInterval(autoSwal), 3000);
          }

          // 🧪 Test Application Form Mode: Halt after filling all DOM fields & files, strictly bypassing submission
          if (${isTestOnly ? 'true' : 'false'}) {
            console.log('__DDA_LOG__:' + JSON.stringify({ level: 'SUCCESS', page: 'Form Test', msg: '🧪 [Test Mode] Application form autofilled successfully. Form submission bypassed.' }));
            return { success: true, testMode: true, pan: "${pan}" };
          }

          // AUTO-SUBMIT / DISPATCH: Direct AJAX POST to fcfsuserapplicantstore
          const formEl = document.getElementById('applicantForm') || document.querySelector('form');
          const csrfToken = (window.__ddaGetCsrfToken && window.__ddaGetCsrfToken()) ||
            document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
            document.querySelector('input[name="_token"]')?.value || '';

          // directSave: quick save; on a missing field or a rejection, break out to
          // DDA's own Submit below, whose checks mark the problem fields in red.
          if (formEl && csrfToken) directSave: {
            const formData = new FormData(formEl);
            formData.set('_token', csrfToken);
            if (!formData.get('acknowledge')) formData.set('acknowledge', 'yes');
            formData.set('is_add_joint', hasJoint ? '1' : '0');
            // District list may still be loading: send the record's own id.
            const recordDistrictId = String(aRec.districtId || aRec.district_id || '').trim();
            if (!formData.get('correspondence_address_ref_district_id') && recordDistrictId) formData.set('correspondence_address_ref_district_id', recordDistrictId);
            if (photoFileObj) {
              formData.set('photograph', photoFileObj);
              formData.set('image', photoFileObj);
            }
            if (signFileObj) {
              formData.set('signature', signFileObj);
            }
            if (jPhotoFileObj) {
              formData.set('joint_applicant[1][photograph]', jPhotoFileObj);
            }
            if (jSignFileObj) {
              formData.set('joint_applicant[1][signature]', jSignFileObj);
            }
            if (empIdCard1aFile) formData.set('emp_id_card_1a', empIdCard1aFile);
            if (empCert1aFile) formData.set('emp_certificate_1a', empCert1aFile);
            if (salarySlipFile) formData.set('salary_slip', salarySlipFile);
            if (form16File) formData.set('form_16', form16File);
            if (profDegreeFile) formData.set('professional_degree_certificate', profDegreeFile);
            if (itrFile) formData.set('income_tax_return', itrFile);
            if (proRegDocFile) formData.set('pro_reg_Certificate_issued_doc', proRegDocFile);
            if (empIdCard1bFile) formData.set('emp_id_card_1b', empIdCard1bFile);
            if (empCert1bFile) formData.set('emp_certificate_1b', empCert1bFile);

            // Karmajeevi values: what the form shows, else the record (eligible
            // applicants only); never a default.
            const elRec = isKarmajeeviEligible ? el : {};
            const paraSelectVal = document.getElementById('para_type')?.value || elRec.paraType;
            if (paraSelectVal) {
              formData.set('para_type', paraSelectVal);
              if (paraSelectVal === '1a') {
                const empType = document.getElementById('emp_id_card_certificate_type')?.value || elRec.empIdCardCertificateType;
                if (empType) formData.set('emp_id_card_certificate_type', empType);
                const salType = document.getElementById('salary_slip_form_16_type')?.value || elRec.salarySlipForm16Type;
                if (salType) formData.set('salary_slip_form_16_type', salType);
              } else if (paraSelectVal === '1b') {
                const proBody = document.getElementById('pro_reg_Certificate_issued')?.value || elRec.proRegCertificateIssued || '';
                if (proBody) formData.set('pro_reg_Certificate_issued', proBody);
                const otherBody = document.getElementById('other_pro_reg_Certificate_issued')?.value || elRec.otherProRegCertificateIssued || '';
                if (otherBody) formData.set('other_pro_reg_Certificate_issued', otherBody);
                const empType1b = document.getElementById('emp_id_card_certificate_1b')?.value || elRec.empIdCardCertificate1b;
                if (empType1b) formData.set('emp_id_card_certificate_1b', empType1b);
              }
            }

            const missing = formCheck ? formCheck.findMissing(formEl, formData) : [];
            if (missing.length) {
              appLog('WARN', '⚠️ Missing: ' + missing.join(', ') + ". Handing the form to DDA's own Submit so it marks them in red.");
              break directSave;
            }

            // Last check before sending: DDA's PAN on the form is still this applicant's
            const sendPan = (document.querySelector('input[name="pan"], input#pan, input#applicant_pan')?.value || '').toUpperCase().trim();
            if (${!allowDifferentApplicant} && sendPan !== ${JSON.stringify(pan)}) {
              appLog('ERROR', '⛔ Stopped before submitting: this form is DDA account ' + (sendPan || 'unknown') + "'s, but the details are " + ${JSON.stringify(pan || 'nobody')} + "'s. Nothing was sent.");
              return { success: false, reason: 'pan-mismatch' };
            }

            const res = await fetch('https://eservices.dda.org.in/user/fcfsuserapplicantstore', {
              method: 'POST',
              body: formData,
              headers: {
                'X-CSRF-TOKEN': csrfToken,
                'X-Requested-With': 'XMLHttpRequest'
              }
            });
            const json = await res.json();
            const urlSegments = window.location.pathname.split('/').filter(Boolean);
            const schemeId = urlSegments[urlSegments.length - 1] || '';
            if (json.status === 'success' || json.status === 'already' || json.status === true || json.msg === 'Application Saved') {
              console.log('__DDA_LOG__:' + JSON.stringify({ level: 'SUCCESS', page: 'Form', msg: 'Application form saved. Navigating to Flat Drop...' }));
              if (window.logAnalyticsStep) {
                window.logAnalyticsStep('step2_form', 'Application Form Submitted');
              }

              // If the direct URL is ready for this scheme, jump to step2_form directly (Direct URL Jump is always on).
              const isDirectEnabled = true;
              if (isDirectEnabled) {
                let directUrl = localStorage.getItem('dda_direct_flat_url') || window.__ddaDirectFlatUrl;
                const hashesRaw = localStorage.getItem('dda_locality_hashes');
                if (hashesRaw) {
                  try {
                    const h = JSON.parse(hashesRaw);
                    if (h && String(h.schemeId) === String(schemeId) && h.localityHash && h.sectorHash && h.pocketHash && h.blockHash) {
                      directUrl = 'https://eservices.dda.org.in/user/step2_form/' + schemeId + '/' + h.localityHash + '/' + h.sectorHash + '/' + h.pocketHash + '/' + h.blockHash + '/' + (h.towerHash || '0');
                    } else {
                      directUrl = null;
                    }
                  } catch (_) { directUrl = null; }
                }
                if (directUrl && (!schemeId || directUrl.includes('/step2_form/' + schemeId + '/'))) {
                  window.location.href = directUrl;
                  return { success: true, fastPass: true, directJump: true };
                }
              }

              window.location.href = schemeId ? ('https://eservices.dda.org.in/user/step1_form/' + schemeId) : 'https://eservices.dda.org.in/user/schemeList';
              return { success: true, fastPass: true, response: json };
            }

            // DDA answered but did not save: log its reason, then submit once
            // through DDA's own button so DDA marks the problem fields in red.
            const reason = formCheck ? formCheck.describeRejection(json, res.status) : (json?.msg || json?.message || ('HTTP ' + res.status));
            appLog('ERROR', '❌ DDA did not accept the application form: ' + reason + ". Handing it to DDA's own Submit so the problem fields show in red.");
            break directSave;
          }

          // Fallback submit button click
          const applyBtn = document.getElementById('frmApply') || document.querySelector('button#frmApply, button[type="submit"]');
          if (applyBtn) {
            // ─── Pillar 3: HTML5 Constraint Validation Crash Guard ───
            if (formEl) {
              formEl.noValidate = true;
              try {
                formEl.querySelectorAll('[required]').forEach(el => {
                  if (el.offsetParent === null || window.getComputedStyle(el).display === 'none' || el.closest('[style*="display: none"]')) {
                    el.required = false;
                    el.removeAttribute('required');
                  }
                });
              } catch (_) {}
            }
            console.log('__DDA_LOG__:' + JSON.stringify({ level: 'ACTION', page: 'Form', msg: 'Application form submitting...' }));
            if (window.logAnalyticsStep) {
              window.logAnalyticsStep('step2_form', 'Application Form Submitted');
            }
            applyBtn.click();
          }

          return { success: true, pan: "${pan}" };
        } catch (err) {
          return { success: false, error: err.message };
        }
      })();
    `;
  },

  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 7: 15-MINUTE HOLD ANALYTICS & FLAT DETAILS EXTRACTION ENGINE
  // ───────────────────────────────────────────────────────────────────────────

  getHoldAnalyticsExtractionCode: () => `
    (() => {
      try {
        // 1. Live Hold Expiration & Timer Synchronization
        let remainingSeconds = 15 * 60;
        const timerSelectors = ['#time', 'span.timer', 'span#time', 'span.countdown', '.timer-display'];
        for (const sel of timerSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const txt = (el.innerText || el.textContent || '').trim();
            const match = txt.match(/^(\\d{1,2})\\s*:\\s*(\\d{2})$/);
            if (match) {
              const mins = parseInt(match[1], 10);
              const secs = parseInt(match[2], 10);
              remainingSeconds = mins * 60 + secs;
              break;
            }
          }
        }
        const holdExpiresAt = Date.now() + (remainingSeconds * 1000);

        // 2. 3-Tier Booked Flat Metadata Extraction Engine
        let bookedFlat = {
          flatNo: '',
          locality: '',
          sector: '',
          pocket: '',
          block: '',
          floor: '',
          applicationMoney: ''
        };

        // Tier 1: Fieldset Property Details Extraction
        const fieldsets = Array.from(document.querySelectorAll('fieldset, table, .property-details, .allotment-details'));
        for (const fs of fieldsets) {
          const text = fs.innerText || '';
          if (text.includes('Property Details') || text.includes('Flat No') || text.includes('Locality') || text.includes('Allotment')) {
            const rows = fs.querySelectorAll('tr, .row, p, div');
            for (const r of rows) {
              const rowText = r.innerText || '';
              if (/Flat\s*No/i.test(rowText)) bookedFlat.flatNo = rowText.split(/Flat\s*No[:\s\-]*/i)[1]?.trim().split('\n')[0] || '';
              if (/Locality/i.test(rowText)) bookedFlat.locality = rowText.split(/Locality[:\s\-]*/i)[1]?.trim().split('\n')[0] || '';
              if (/Sector/i.test(rowText)) bookedFlat.sector = rowText.split(/Sector[:\s\-]*/i)[1]?.trim().split('\n')[0] || '';
              if (/Pocket/i.test(rowText)) bookedFlat.pocket = rowText.split(/Pocket[:\s\-]*/i)[1]?.trim().split('\n')[0] || '';
              if (/Block/i.test(rowText)) bookedFlat.block = rowText.split(/Block[:\s\-]*/i)[1]?.trim().split('\n')[0] || '';
              if (/Floor/i.test(rowText)) bookedFlat.floor = rowText.split(/Floor[:\s\-]*/i)[1]?.trim().split('\n')[0] || '';
              if (/Application\s*Money/i.test(rowText)) {
                const rawMoney = rowText.split(/Application\s*Money[^0-9]*/i)[1]?.trim().split('\n')[0] || '';
                const clean = rawMoney.replace(/[^0-9.]/g, '');
                if (clean && !isNaN(Number(clean)) && Number(clean) >= 100) {
                  bookedFlat.applicationMoney = clean;
                }
              }
            }
          }
        }

        // Tier 2: Regex scanning on innerText if fields are empty
        const bodyText = document.body.innerText || '';
        if (!bookedFlat.flatNo) {
          const flatMatch = bodyText.match(/Flat\\s*(?:No\\.?|Number)[:\\s]*([A-Z0-9\\-]+)/i);
          if (flatMatch) bookedFlat.flatNo = flatMatch[1].trim();
        }
        if (!bookedFlat.locality) {
          const locMatch = bodyText.match(/Locality[:\\s]*([A-Za-z0-9\\s\\-]+?)(?:\\n|Sector|Pocket|$)/i);
          if (locMatch) bookedFlat.locality = locMatch[1].trim();
        }

        return {
          success: true,
          holdExpiresAt,
          remainingSeconds,
          bookedFlat
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })();
  `
,

  // ───────────────────────────────────────────────────────────────────────────
    // ───────────────────────────────────────────────────────────────────────────
  // BENCHMARK: WEBVIEW IN-PAGE FAST SOLVER
  // ───────────────────────────────────────────────────────────────────────────
  getBenchmarkWebviewSolverCode: (targetSchemeName, preferences = {}) => {
    const locMap = { "1": "NARELA", "2": "ROHINI", "3": "TODAPUR", "4": "LOKNAYAKPURAM", "5": "DWARKA", "NARELA": "kVK2W", "kVK2W": "kVK2W" };
    const rawLoc = (preferences.locality || 'NARELA').toString().trim().toUpperCase();
    const locHash = locMap[rawLoc] || 'kVK2W';
    const targetSec = preferences.sector || 'SECTOR A1 TO A4';
    const targetPoc = preferences.pocket || 'POCKET 1';
    const targetBlk = preferences.block || 'BLOCK A';
    const targetTwr = preferences.tower || 'TOWER A';

    return `
      (async () => {
        const tStart = performance.now();
        try {
          const csrfToken = (window.__ddaGetCsrfToken && window.__ddaGetCsrfToken()) ||
                            document.querySelector('input[name="_token"]')?.value ||
                            document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
          
          // 1. Auto-resolve real scheme_id from URL or Scheme List table row
          let resolvedSchemeId = "${targetSchemeName}";
          const urlSchemeId = window.location.pathname.split('/').filter(Boolean).pop();
          if (urlSchemeId && !isNaN(parseInt(urlSchemeId, 10))) {
            resolvedSchemeId = urlSchemeId;
          } else {
            const rows = document.querySelectorAll('table.customtable tbody tr, tr');
            for (const r of rows) {
              const txt = (r.textContent || '').toUpperCase();
              if (txt.includes("${targetSchemeName}".toUpperCase()) || "${targetSchemeName}".toUpperCase().includes('NAGRIK') && txt.includes('NAGRIK')) {
                const btn = r.querySelector('a.applyBtn') || r.querySelector('a[href*="application"]') || r.querySelector('a[data-url]');
                const url = btn?.getAttribute('data-url') || btn?.href || '';
                const sid = url.split('/').filter(Boolean).pop();
                if (sid && sid !== 'schemeList') {
                  resolvedSchemeId = sid;
                  break;
                }
              }
            }
          }

          if (!resolvedSchemeId || resolvedSchemeId === "${targetSchemeName}") {
            // Fallback: search any valid apply button ID on page
            const anyBtn = document.querySelector('a.applyBtn, a[href*="userApplicationfrom"]');
            const sid = (anyBtn?.getAttribute('data-url') || anyBtn?.href || '').split('/').filter(Boolean).pop();
            if (sid) resolvedSchemeId = sid;
          }

          const postAjax = async (endpoint, postData) => {
            // A POST to DDA without its token gets the session logged out (11 Oct): never send one
            if (!csrfToken) throw new Error('No DDA token on this page; nothing sent.');
            const tStepStart = performance.now();
            const fd = new FormData();
            fd.append('_token', csrfToken);
            for (const [k, v] of Object.entries(postData)) fd.append(k, v);
            const res = await fetch('https://eservices.dda.org.in/user/' + endpoint, {
              method: 'POST', body: fd, credentials: 'include',
              headers: { 'X-CSRF-TOKEN': csrfToken, 'X-Requested-With': 'XMLHttpRequest' }
            });
            const rawText = await res.text();
            const tStepEnd = performance.now();
            let json;
            try { json = JSON.parse(rawText); } catch { json = { raw: rawText }; }
            return { json, stepTime: (tStepEnd - tStepStart).toFixed(1) };
          };

          const parseOptions = (raw) => {
            if (!raw) return [];
            const str = (typeof raw === 'object') ? (raw.sector || raw.pocket || raw.block || raw.tower || raw.data || raw.html || raw.raw || '') : String(raw);
            const parser = new DOMParser();
            const doc = parser.parseFromString('<select>' + str + '</select>', 'text/html');
            return Array.from(doc.querySelectorAll('option'))
              .map(o => ({ hash: (o.value || '').trim(), name: (o.textContent || o.text || '').trim().toUpperCase() }))
              .filter(o => o.hash && o.hash !== '0' && !o.name.includes('SELECT'));
          };

${SECTOR_KEY_CODE}
          const smartMatch = (options, target) => {
            if (!options || options.length === 0 || !target) return null;
            // Same sector range, however it is written ("G-2 & G-6" = "G2 - G6")
            const bySectorKey = matchBySectorKey(options, target, (o) => o.name);
            if (bySectorKey) return bySectorKey;
            const normTarget = target.trim().replace(/\\s+/g, ' ').toUpperCase();
            const shortTarget = normTarget.replace(/\\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\\b/g, '').trim();
            const num = normTarget.match(/\\d+/) ? parseInt(normTarget.match(/\\d+/)[0], 10) : null;
            return options.find(opt => {
              const text = opt.name.trim().replace(/\\s+/g, ' ').toUpperCase();
              const optNum = text.match(/\\d+/) ? parseInt(text.match(/\\d+/)[0], 10) : null;
              const cleanOpt = text.replace(/\\b(BLOCK|TOWER|POCKET|PKT|SECTOR|SEC|LOCALITY|LOC)\\b/g, '').trim();
              return (
                text === normTarget ||
                text.includes(normTarget) ||
                normTarget.includes(text) ||
                (shortTarget && cleanOpt === shortTarget) ||
                (num !== null && optNum !== null && num === optNum) ||
                (shortTarget && text.endsWith(' ' + shortTarget))
              );
            }) || null;
          };

          const breakdown = {};
          const hashes = { locality: "${locHash}" };

          // 1. Sector
          const { json: secRes, stepTime: t1 } = await postAjax('searchSector', { locality: "${locHash}", scheme_id: resolvedSchemeId });
          breakdown.sector = parseFloat(t1);
          const secOpts = parseOptions(secRes);
          const secMatch = smartMatch(secOpts, "${targetSec}");
          if (!secMatch) {
            return { success: false, method: 'Webview In-Page', schemeId: resolvedSchemeId, totalTime: (performance.now() - tStart).toFixed(1), error: 'Sector not found for Scheme ID: ' + resolvedSchemeId, options: secOpts.map(o => o.name) };
          }
          hashes.sector = secMatch.hash;

          // 2. Pocket
          const { json: pocRes, stepTime: t2 } = await postAjax('searchpocketbysector', { locality_id: "${locHash}", locality: "${locHash}", sector_id: secMatch.hash, sector: secMatch.hash, scheme_id: resolvedSchemeId });
          breakdown.pocket = parseFloat(t2);
          const pocOpts = parseOptions(pocRes);
          const pocMatch = smartMatch(pocOpts, "${targetPoc}");
          if (!pocMatch) {
            return { success: false, method: 'Webview In-Page', schemeId: resolvedSchemeId, totalTime: (performance.now() - tStart).toFixed(1), error: 'Pocket not found for Sector: ' + secMatch.name, options: pocOpts.map(o => o.name) };
          }
          hashes.pocket = pocMatch.hash;

          // 3. Block
          const { json: blkRes, stepTime: t3 } = await postAjax('blockbypocket', { locality_id: "${locHash}", locality: "${locHash}", sector_id: secMatch.hash, sector: secMatch.hash, pocket_id: pocMatch.hash, pocket: pocMatch.hash, scheme_id: resolvedSchemeId });
          breakdown.block = parseFloat(t3);
          const blkOpts = parseOptions(blkRes);
          const blkMatch = smartMatch(blkOpts, "${targetBlk}");
          if (!blkMatch) {
            return { success: false, method: 'Webview In-Page', schemeId: resolvedSchemeId, totalTime: (performance.now() - tStart).toFixed(1), error: 'Block not found for Pocket: ' + pocMatch.name, options: blkOpts.map(o => o.name) };
          }
          hashes.block = blkMatch.hash;

          // 4. Tower
          let twrHash = "0";
          if ("${targetTwr}") {
            const { json: twrRes, stepTime: t4 } = await postAjax('searchtowerbyblock', { scheme_id: resolvedSchemeId, locality_id: "${locHash}", locality: "${locHash}", sector_id: secMatch.hash, sector: secMatch.hash, pocket_id: pocMatch.hash, pocket: pocMatch.hash, block_id: blkMatch.hash, block: blkMatch.hash });
            breakdown.tower = parseFloat(t4);
            const twrOpts = parseOptions(twrRes);
            const twrMatch = smartMatch(twrOpts, "${targetTwr}");
            if (!twrMatch) {
              return { success: false, method: 'Webview In-Page', schemeId: resolvedSchemeId, totalTime: (performance.now() - tStart).toFixed(1), error: 'Tower not found for Block: ' + blkMatch.name, options: twrOpts.map(o => o.name) };
            }
            twrHash = twrMatch.hash;
          }
          hashes.tower = twrHash;

          const totalTime = (performance.now() - tStart).toFixed(1);
          const directUrl = 'https://eservices.dda.org.in/user/step2_form/' + resolvedSchemeId + '/' + "${locHash}" + '/' + secMatch.hash + '/' + pocMatch.hash + '/' + blkMatch.hash + '/' + twrHash;

          return {
            success: true,
            method: 'Webview In-Page',
            schemeId: resolvedSchemeId,
            totalTime,
            breakdown,
            directUrl,
            hashes
          };
        } catch (err) {
          return { success: false, method: 'Webview In-Page', totalTime: (performance.now() - tStart).toFixed(1), error: err.message };
        }
      })();
    `;
  },

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 6: FAST PAYMENT AUTOMATION (DDA HOLD -> CBI/SBI GATEWAY DISPATCH)
  // Auto-advances through DDA 15-min hold, terms, gateway selection & dispatches
  // to the payment gateway. Stops at the gateway for safe, manual user payment.
  // ───────────────────────────────────────────────────────────────────────────
  getPaymentProceedCode: (settings = {}) => {
    const gateway = settings?.fastPaymentGateway || 'cbi';

    return `
      (async () => {
        try {
          const targetGateway = ${JSON.stringify(gateway)};
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));

          // ─── STAGE 1: DDA 15-MINUTE HOLD (T&C + Click to Pay) ───
          window.__ddaFastPaymentApproved = true;
          try { sessionStorage.setItem('dda_fast_payment_approved', 'true'); } catch (_) {}

          const tandc = document.getElementById('tandc') || document.querySelector('input[name="tandc"]');
          if (tandc) {
            tandc.checked = true;
            tandc.dispatchEvent(new Event('change', { bubbles: true }));
            try { if (window.$ && window.$.fn) window.$('#tandc').prop('checked', true).trigger('change'); } catch (_) {}
          }

          const btnContinue = document.getElementById('btnContinue') || document.querySelector('input#btnContinue, button[onclick*="CheckTermCondition"]');
          if (btnContinue && !document.querySelector('.payment_method select, #payment_gateway')) {
            if (typeof window.CheckTermCondition === 'function') {
              window.CheckTermCondition();
            } else {
              btnContinue.click();
            }
          }

          // Stages 2-3 (gateway select, chargeback T&C, Make Payment) are run once by
          // the preload engine (handleFastPaymentEngine) now that approval is set.
          // Running them here too dispatched Make Payment twice.
          return { success: true, stage: 'payment_dispatch_checked' };
        } catch (err) {
          console.warn('Payment proceed error:', err);
          return { success: false, error: err.message };
        }
      })();
    `;
  }
};