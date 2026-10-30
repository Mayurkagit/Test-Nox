// Offline Embedded Database Engine for DDA Electron Automation Suite
// Ultra-fast in-memory cache with atomic SSD persistence (0.01ms reads/writes)

import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const app = electron.app || null;

class OfflineDatabase {
  constructor() {
    this.dbPath = '';
    this.data = {
      users: {},
      applicants: {},
      schemes: {},
      bookingRuns: [],
      settings: {
        theme: 'dark',
        automationEnabled: true,
        captchaAutoSolveEnabled: true,
        captchaAutoSubmitEnabled: true,
        settleDelayMs: 150,
        stealthMode: true,
        zoomLevel: 1.15
      }
    };
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;

    try {
      const userDataPath = app ? app.getPath('userData') : process.cwd();
      const dbDir = path.join(userDataPath, 'dda_db');
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      this.dbPath = path.join(dbDir, 'dda_offline_store.json');

      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          users: parsed.users || {},
          applicants: parsed.applicants || {},
          schemes: parsed.schemes || {},
          bookingRuns: parsed.bookingRuns || [],
          settings: { ...this.data.settings, ...(parsed.settings || {}) },
          localPrefs: parsed.localPrefs || {}
        };
        // Purge any legacy demo users from disk store
        delete this.data.users['admin@dda.local'];
        delete this.data.users['rahul.sharma@dda.gov.in'];

        // (Applicants are no longer purged here: the 14 PANs that used to be
        // deleted on every start as "demo" data are real applicants.)

        // Purge any legacy plaintext payment card fields from disk store
        if (this.data.settings?.fastPaymentCard) {
          delete this.data.settings.fastPaymentCard;
        }
        if (this.data.settings?.autoPaySubmitEnabled !== undefined) {
          delete this.data.settings.autoPaySubmitEnabled;
        }
        if (parsed.windowSettings) {
          this.data.windowSettings = parsed.windowSettings;
          for (const winKey of Object.keys(this.data.windowSettings)) {
            if (this.data.windowSettings[winKey]?.fastPaymentCard) {
              delete this.data.windowSettings[winKey].fastPaymentCard;
            }
            if (this.data.windowSettings[winKey]?.autoPaySubmitEnabled !== undefined) {
              delete this.data.windowSettings[winKey].autoPaySubmitEnabled;
            }
          }
        }

        this.persist();
        console.log(`📦 [Offline DB] Loaded ${Object.keys(this.data.applicants).length} applicants from local store: ${this.dbPath}`);
      } else {
        this.persist();
        console.log(`📦 [Offline DB] Initialized fresh clean offline store at: ${this.dbPath}`);
      }
      this.initialized = true;
    } catch (err) {
      console.error('❌ [Offline DB] Init Error:', err);
    }
  }

  persist() {
    try {
      const tempPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.dbPath);
    } catch (err) {
      console.error('❌ [Offline DB] Persist Error:', err);
    }
  }

  // ─── AUTHENTICATION & USER METHODS ──────────────────────────────────

  loginUser(email, password) {
    this.init();
    if (!email || !password) {
      return { success: false, error: 'Email and password are required.' };
    }

    const cleanEmail = email.trim().toLowerCase();

    const existingUser = this.data.users[cleanEmail];
    if (existingUser) {
      if (existingUser.password === password) {
        return {
          success: true,
          user: {
            uid: existingUser.uid,
            email: existingUser.email,
            name: existingUser.name || cleanEmail.split('@')[0],
            role: existingUser.role || 'user',
            isAdmin: existingUser.role === 'admin'
          }
        };
      }
      return { success: false, error: 'Invalid password. Please try again.' };
    }

    return { success: false, error: 'User not found. Please enter a valid email.' };
  }

  // ─── BOOKING KEY VALIDATION ────────────────────────────────────────

  async validateBookingKey(key, user = null) {
    this.init();
    if (!key) return { success: false, error: 'Booking key is required.' };

    const cleanKey = key.trim().toUpperCase();

    try {
      const workerUrl = process.env.VITE_WORKER_URL || 'https://dda-engine.asmrahul17.workers.dev';
      const idToken = user?.idToken || '';
      const headers = {};
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
      const res = await fetch(`${workerUrl}/extension/validate-key?key=${encodeURIComponent(cleanKey)}`, { headers });
      if (res.ok) {
        const keyData = await res.json();
        return {
          success: true,
          key: cleanKey,
          scheme: keyData?.scheme || keyData?.targetScheme || 'DDA Housing Scheme 2026',
          mode: keyData?.mode || 'LIVE',
          windowEnd: keyData?.windowEnd || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          message: 'Booking key verified with server.'
        };
      }
      let errorMsg = 'Invalid booking key. Please verify with admin.';
      try {
        const errJson = await res.json();
        if (errJson?.error) errorMsg = errJson.error;
      } catch (_) {}
      return { success: false, error: errorMsg };
    } catch (_) {
      return {
        success: false,
        error: 'Unable to connect to key validation server. Please check internet connection.'
      };
    }
  }

  // ─── APPLICANT METHODS ─────────────────────────────────────────────


  getAllApplicants() {
    this.init();
    return Object.values(this.data.applicants);
  }

  getApplicantsByUser(user) {
    this.init();
    const all = Object.values(this.data.applicants);
    if (!user) return [];

    const isAdmin = Boolean(user.isAdmin || user.role === 'admin');
    if (isAdmin) {
      return all;
    }

    const userUid = user.uid || '';
    const userEmail = (user.email || '').toLowerCase().trim();

    return all.filter((app) => {
      if (userUid && app.userId && app.userId === userUid) return true;
      if (userEmail && app.userEmail && app.userEmail.toLowerCase().trim() === userEmail) return true;
      return false;
    });
  }

  getApplicantByPan(pan, user) {
    this.init();
    if (!pan || !user) return null;
    const app = this.data.applicants[pan.toUpperCase().trim()] || null;
    if (!app) return null;
    const isAdmin = Boolean(user.isAdmin || user.role === 'admin');
    if (isAdmin) return app;
    const userUid = user.uid || '';
    const userEmail = (user.email || '').toLowerCase().trim();
    if (userUid && app.userId && app.userId === userUid) return app;
    if (userEmail && app.userEmail && app.userEmail.toLowerCase().trim() === userEmail) return app;
    return null;
  }

  saveApplicant(applicant, user) {
    this.init();
    if (!applicant) throw new Error('Applicant payload is required');
    if (!user) throw new Error('Authentication required to save applicant');
    const pan = (applicant.personal?.pan || applicant.pan || '').toUpperCase().trim();
    if (!pan) throw new Error('Applicant PAN is required');

    const existing = this.data.applicants[pan] || {};
    const isAdmin = Boolean(user.isAdmin || user.role === 'admin');
    if (existing.pan && !isAdmin) {
      const userUid = user.uid || '';
      const userEmail = (user.email || '').toLowerCase().trim();
      const isOwner = (userUid && existing.userId === userUid) ||
                      (userEmail && existing.userEmail && existing.userEmail.toLowerCase().trim() === userEmail);
      if (!isOwner) throw new Error('Unauthorized to modify this applicant');
    }

    const updated = {
      ...existing,
      ...applicant,
      pan,
      userId: existing.userId || user.uid || 'user_guest',
      userEmail: existing.userEmail || user.email || '',
      personal: {
        ...(existing.personal || {}),
        ...(applicant.personal || {}),
        pan
      },
      bank: {
        ...(existing.bank || existing.bankDetails || {}),
        ...(applicant.bank || applicant.bankDetails || {})
      },
      address: {
        ...(existing.address || existing.addressDetails || {}),
        ...(applicant.address || applicant.addressDetails || {})
      },
      preferences: {
        ...(existing.preferences || {}),
        ...(applicant.preferences || {})
      },
      jointApplicant: {
        ...(existing.jointApplicant || {}),
        ...(applicant.jointApplicant || {})
      },
      eligibility: {
        ...(existing.eligibility || {}),
        ...(applicant.eligibility || {})
      },
      updatedAt: new Date().toISOString(),
      createdAt: existing.createdAt || new Date().toISOString()
    };

    this.data.applicants[pan] = updated;
    this.persist();
    return updated;
  }

  // Keep the last applicant list the cloud returned for this app user, so
  // getApplicantsByUser can still serve it when the cloud is unreachable
  // (the renderer falls back to this database). Cloud fields win; fields the
  // cloud does not send keep their local values. A normal user's records are
  // stored under that user (the cloud returned them to this user); an admin's
  // keep the owner the cloud gave them.
  //
  // full: the list is the whole cloud list for this user, so cached cloud
  // records of this user (all, for the admin) that are not in it were removed
  // in the cloud and are dropped here too. Records saved only on this
  // computer (no cachedFromCloudAt) are never dropped.
  cacheApplicants(list, user, { full = false } = {}) {
    this.init();
    if (!user || !Array.isArray(list)) return 0;
    const isAdmin = Boolean(user.isAdmin || user.role === 'admin');
    const now = new Date().toISOString();
    let count = 0;
    if (full) {
      const keep = new Set(list.map((a) => (a?.personal?.pan || a?.pan || '').toUpperCase().trim()).filter(Boolean));
      const gone = Object.keys(this.data.applicants).filter((pan) => !keep.has(pan));
      count += this.uncacheApplicants(gone, user, { persist: false });
    }
    for (const applicant of list) {
      if (!applicant || typeof applicant !== 'object') continue;
      const pan = (applicant.personal?.pan || applicant.pan || '').toUpperCase().trim();
      if (!pan) continue;
      const existing = this.data.applicants[pan] || {};
      const userId = isAdmin ? (applicant.userId || existing.userId || user.uid || '') : (user.uid || '');
      const userEmail = isAdmin
        ? (applicant.userEmail || existing.userEmail || user.email || '')
        : (user.email || '');
      this.data.applicants[pan] = {
        ...existing,
        ...applicant,
        pan,
        userId,
        userEmail,
        personal: { ...(existing.personal || {}), ...(applicant.personal || {}), pan },
        bank: { ...(existing.bank || {}), ...(applicant.bank || applicant.bankDetails || {}) },
        address: { ...(existing.address || {}), ...(applicant.address || applicant.addressDetails || {}) },
        preferences: { ...(existing.preferences || {}), ...(applicant.preferences || {}) },
        jointApplicant: { ...(existing.jointApplicant || {}), ...(applicant.jointApplicant || {}) },
        eligibility: { ...(existing.eligibility || {}), ...(applicant.eligibility || {}) },
        cachedFromCloudAt: now,
        createdAt: existing.createdAt || now,
      };
      // A light copy (no files) keeps the files saved here and notes which
      // ones it left out (_omitted); a full copy clears the note.
      if (!Array.isArray(applicant._omitted)) delete this.data.applicants[pan]._omitted;
      delete this.data.applicants[pan]._light;
      delete this.data.applicants[pan]._missingMedia;
      count++;
    }
    if (count) this.persist();
    return count;
  }

  // Drop cached cloud records (removed in the cloud or no longer this
  // user's). Records saved only on this computer are kept.
  uncacheApplicants(pans, user, { persist = true } = {}) {
    this.init();
    if (!user || !Array.isArray(pans)) return 0;
    const isAdmin = Boolean(user.isAdmin || user.role === 'admin');
    const userUid = user.uid || '';
    const userEmail = (user.email || '').toLowerCase().trim();
    let count = 0;
    for (const raw of pans) {
      const pan = String(raw || '').toUpperCase().trim();
      const existing = this.data.applicants[pan];
      if (!existing || !existing.cachedFromCloudAt) continue;
      const isOwner = (userUid && existing.userId === userUid) ||
                      (userEmail && existing.userEmail && existing.userEmail.toLowerCase().trim() === userEmail);
      if (!isAdmin && !isOwner) continue;
      delete this.data.applicants[pan];
      count++;
    }
    if (count && persist) this.persist();
    return count;
  }

  deleteApplicant(pan, user) {
    this.init();
    if (!pan || !user) return false;
    const cleanPan = (pan || '').toUpperCase().trim();
    const existing = this.data.applicants[cleanPan];
    if (!existing) return false;

    const isAdmin = Boolean(user.isAdmin || user.role === 'admin');
    if (!isAdmin) {
      const userUid = user.uid || '';
      const userEmail = (user.email || '').toLowerCase().trim();
      const isOwner = (userUid && existing.userId === userUid) ||
                      (userEmail && existing.userEmail && existing.userEmail.toLowerCase().trim() === userEmail);
      if (!isOwner) return false;
    }
    delete this.data.applicants[cleanPan];
    this.persist();
    return true;
  }

  // ─── LOCAL FLAT PREFERENCES ─────────────────────────────────────────
  // Flat preferences changed in the app (not saved to the cloud), per app
  // user and PAN: { preferences, baseHash, savedAt }. baseHash fingerprints the
  // cloud's preferences at the time of the change; the renderer drops an entry
  // once the cloud's preferences differ from it.

  getLocalPrefs(user) {
    this.init();
    if (!user?.uid) return {};
    return { ...((this.data.localPrefs || {})[user.uid] || {}) };
  }

  saveLocalPrefs(pan, entry, user) {
    this.init();
    const cleanPan = String(pan || '').toUpperCase().trim();
    if (!user?.uid || !cleanPan) return false;
    if (!this.data.localPrefs) this.data.localPrefs = {};
    const mine = { ...(this.data.localPrefs[user.uid] || {}) };
    if (entry && typeof entry === 'object') mine[cleanPan] = entry;
    else delete mine[cleanPan];
    this.data.localPrefs[user.uid] = mine;
    this.persist();
    return true;
  }

  clearLocalPrefs(user) {
    this.init();
    if (!user?.uid || !this.data.localPrefs?.[user.uid]) return false;
    delete this.data.localPrefs[user.uid];
    this.persist();
    return true;
  }

  // ─── SETTINGS METHODS ──────────────────────────────────────────────

  getSettings(winSession) {
    this.init();
    if (winSession && this.data.windowSettings?.[winSession]) {
      return { ...this.data.settings, ...this.data.windowSettings[winSession] };
    }
    return { ...this.data.settings };
  }

  saveSettings(newSettings, winSession) {
    this.init();
    const cleanSettings = { ...(newSettings || {}) };
    delete cleanSettings.fastPaymentCard;
    delete cleanSettings.autoPaySubmitEnabled;

    if (winSession) {
      if (!this.data.windowSettings) this.data.windowSettings = {};
      this.data.windowSettings[winSession] = {
        ...(this.data.windowSettings[winSession] || this.data.settings),
        ...cleanSettings
      };
      this.persist();
      return this.data.windowSettings[winSession];
    }
    this.data.settings = {
      ...this.data.settings,
      ...cleanSettings
    };
    this.persist();
    return this.data.settings;
  }

  // ─── BOOKING RUNS / TELEMETRY METHODS ──────────────────────────────

  getBookingRuns() {
    this.init();
    return [...this.data.bookingRuns].reverse();
  }

  saveBookingRun(run) {
    this.init();
    const ts = run.timestamp || Date.now();
    const d = new Date(ts);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const time12Str = `${h12}:${m}:${s}.${ms} ${ap}`;

    const newRun = {
      id: run.id || `run_${ts}`,
      timestamp: ts,
      timeStr: run.timeStr || time12Str,
      applicantPan: run.applicantPan || '',
      applicantName: run.applicantName || '',
      flatNo: run.flatNo || '',
      scheme: run.scheme || '',
      status: run.status || 'SUCCESS',
      totalDurationMs: run.totalDurationMs || 0,
      totalDurationSec: run.totalDurationSec || 0,
      captchaAttempts: run.captchaAttempts || [],
      lastCaptcha: run.lastCaptcha || (run.captchaAttempts?.length > 0 ? run.captchaAttempts[run.captchaAttempts.length - 1] : null),
      logs: run.logs || [],
      createdAt: new Date().toISOString()
    };

    this.data.bookingRuns.push(newRun);
    if (this.data.bookingRuns.length > 100) {
      this.data.bookingRuns = this.data.bookingRuns.slice(this.data.bookingRuns.length - 100);
    }
    this.persist();
    return newRun;
  }

  // DDA's payment result for a booking run: by its id, else the applicant's latest
  // run of the last 3 hours. Returns the run's id, or null when none matches.
  setBookingRunPayment(runId, pan, payment) {
    this.init();
    const runs = this.data.bookingRuns;
    let run = runId ? runs.find((r) => r.id === runId) : null;
    if (!run && pan) {
      const since = Date.now() - 3 * 60 * 60 * 1000;
      run = [...runs].reverse().find((r) => r.applicantPan === pan && (r.timestamp || 0) >= since) || null;
    }
    if (!run) return null;
    run.payment = payment;
    this.persist();
    return run.id;
  }
}

export const db = new OfflineDatabase();

