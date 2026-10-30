// Real Firebase Auth & Cloudflare Worker Bridge for DDA Electron Automation Suite
// Exactly matching dda-extension / dda-application-main backend architecture

import { auth, db } from "../firebase/config";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { collection, addDoc, doc, setDoc, getDoc, getDocs } from "firebase/firestore";
import OFFLINE_STORE from "../../dda_db/dda_offline_store.json";
import { wsGet, wsSet, getWinSession } from "../utils/storageHelper";

const FIREBASE_API_KEY =
  import.meta.env.VITE_FIREBASE_API_KEY ||
  "AIzaSyCCa91TCGNpAUkPT1Q0ORWMFWWue0VBvow";
export const WORKER_BASE_URL =
  import.meta.env.VITE_WORKER_URL ||
  "https://dda-engine.asmrahul17.workers.dev";

export function isJwtExpired(token) {
  if (!token || typeof token !== "string") return true;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return true;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (!payload.exp) return false;
    // Expired if exp timestamp is in the past (with a 30-second buffer)
    return payload.exp * 1000 <= Date.now() + 30000;
  } catch (_) {
    return true;
  }
}

export async function getFirebaseIdToken(forceRefresh = false) {
  let currentUser = auth.currentUser;

  if (!currentUser) {
    currentUser = await new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 1500);

      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          unsubscribe();
          resolve(user);
        }
      });
    });
  }

  const storedToken = localStorage.getItem("dda_id_token");
  const needsRefresh = forceRefresh || isJwtExpired(storedToken);

  if (currentUser) {
    try {
      // getIdToken goes to the network when the token needs refreshing and takes no abort
      // signal, so it is raced instead: a hang here would stall every caller behind it.
      const token = await Promise.race([
        currentUser.getIdToken(needsRefresh),
        new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (token) {
        localStorage.setItem("dda_id_token", token);
        return token;
      }
    } catch (error) {
      console.warn("Could not refresh token from currentUser:", error);
    }
  }

  if (storedToken && !isJwtExpired(storedToken)) {
    return storedToken;
  }
  return null;
}

// localStorage writes that must not break a fetch: big applicant lists (with
// photos and documents) can exceed the browser's storage quota.
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`[Storage] Could not cache ${key}:`, err?.name || err);
  }
}

// The Worker's { PAN: applicant } object as the app's applicant list. The
// DDA password comes as ddaPassword (decrypted by the Worker).
function mapCloudApplicants(rawApps) {
  if (Array.isArray(rawApps)) return rawApps;
  if (!rawApps || typeof rawApps !== "object") return [];
  return Object.entries(rawApps).map(([panKey, app]) => {
    const personal = app.personal || {};
    const pan = (app.pan || personal.pan || app.id || panKey || "").trim().toUpperCase();
    const password = (app.ddaPassword || app.password || personal.password || "").trim();
    return {
      ...app,
      pan,
      id: pan,
      password,
      personal: { ...personal, pan, password },
      preferences: app.preferences || {},
      bank: app.bank || OFFLINE_STORE?.applicants?.[pan]?.bank || {},
      address: app.address || OFFLINE_STORE?.applicants?.[pan]?.address || {},
      jointApplicant: app.jointApplicant || {},
    };
  });
}

// A light cloud record (files left out, paths in _omitted) with those files
// taken from this computer's copy, where it has them.
function withLocalFiles(light, local) {
  if (!local || !Array.isArray(light?._omitted) || !light._omitted.length) return light;
  const rec = { ...light };
  for (const path of light._omitted) {
    const keys = String(path).split('.');
    let src = local;
    for (const k of keys) src = src && typeof src === 'object' ? src[k] : undefined;
    if (typeof src !== 'string' || !src) continue;
    let dst = rec;
    for (const k of keys.slice(0, -1)) {
      dst[k] = { ...(dst[k] && typeof dst[k] === 'object' ? dst[k] : {}) };
      dst = dst[k];
    }
    dst[keys[keys.length - 1]] = src;
  }
  return rec;
}

// Applicants removed on this computer, never brought back from the cloud
function filterDeletedPans(list) {
  let deletedPans = [];
  try { deletedPans = JSON.parse(localStorage.getItem('dda_deleted_pans') || '[]'); } catch (_) {}
  return list.filter((a) => {
    const p = (a.pan || a.personal?.pan || a.id || '').toUpperCase().trim();
    return p && !deletedPans.includes(p) && p !== 'ABCDEF2343' && p !== 'ABCXX2343X';
  });
}

// The DDA login (PAN, name, password) of each applicant in a cloud list. The
// password is the one saved on the server (ddaPassword, "" when none), not
// one the app filled in from this computer.
export function loginsFromApplicants(list) {
  return (Array.isArray(list) ? list : []).map((a) => {
    const p = a.personal || {};
    const pan = (a.pan || p.pan || '').toUpperCase().trim();
    const name = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ').trim() || a.name || pan;
    const password = typeof a.ddaPassword === 'string' ? a.ddaPassword : (a.password || p.password || '');
    return { pan, name, password: password.trim() };
  }).filter((l) => l.pan);
}

export const api = {
  // True when the last getApplicantsByUser answer came from the cloud (not a
  // local fallback), so it can be trusted to reconcile local changes.
  lastApplicantsFromCloud: false,

  // ─── 1. FIREBASE AUTHENTICATION ──────────────────────────────────────
  loginUser: async (email, password) => {
    if (!email || !password) {
      return { success: false, error: "Please enter both email and password." };
    }

    const cleanEmail = email.trim().toLowerCase();

    // Helper: Determine admin status & sync role to Firebase Firestore
    const resolveAndSyncUserRole = async (uid, token, userCredential = null) => {
      // Check Firebase ID Token custom claims
      let tokenClaimsIsAdmin = false;
      if (userCredential?.user) {
        try {
          const tokenResult = await userCredential.user.getIdTokenResult();
          tokenClaimsIsAdmin = Boolean(tokenResult?.claims?.admin === true || tokenResult?.claims?.role === "admin");
        } catch (_) {}
      }

      // Check Cloudflare Worker /me
      let workerIsAdmin = false;
      if (token) {
        try {
          const meRes = await fetch(`${WORKER_BASE_URL}/me`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (meRes.ok) {
            const meData = await meRes.json();
            const verifiedUser = meData?.data?.user || meData?.data || meData?.user || meData || {};
            workerIsAdmin = Boolean(
              verifiedUser.isAdmin === true ||
              verifiedUser.admin === true ||
              verifiedUser.role === "admin"
            );
          }
        } catch (_) {}
      }

      // Role fields in the client-writable Firestore profile are not an authority.
      const isAdmin = Boolean(tokenClaimsIsAdmin || workerIsAdmin);
      const resolvedRole = isAdmin ? "admin" : "user";

      // Sync non-sensitive metadata only (role and isAdmin are server-managed)
      try {
        await setDoc(
          doc(db, "users", uid),
          {
            email: cleanEmail,
            lastLoginAt: new Date().toISOString()
          },
          { merge: true }
        );
      } catch (setErr) {
        console.warn("Could not set user lastLoginAt in Firestore:", setErr);
      }

      return { isAdmin, role: resolvedRole };
    };

    // 1. Try real Firebase Web SDK signInWithEmailAndPassword
    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        cleanEmail,
        password,
      );
      const token = await userCredential.user.getIdToken();
      const uid = userCredential.user.uid;

      const { isAdmin, role } = await resolveAndSyncUserRole(uid, token, userCredential);

      const userObj = {
        uid: uid,
        email: userCredential.user.email,
        name:
          userCredential.user.displayName ||
          cleanEmail.split("@")[0].toUpperCase(),
        idToken: token,
        role: role,
        isAdmin: isAdmin,
      };

      localStorage.setItem("dda_auth_user", JSON.stringify(userObj));
      localStorage.setItem("dda_id_token", token);
      sessionStorage.setItem("dda_id_token", token);
      localStorage.setItem("dda_is_admin", isAdmin ? "true" : "false");
      localStorage.setItem("dda_user_role", role);

      if (window.ddaElectronAPI?.authenticateToken) {
        try {
          await window.ddaElectronAPI.authenticateToken(token);
        } catch (e) {
          console.warn("Main process token authentication failed:", e);
        }
      }

      return { success: true, user: userObj, token };
    } catch (firebaseErr) {
      console.warn(
        "Firebase SDK sign-in error:",
        firebaseErr.code,
        firebaseErr.message,
      );

      // 2. Fallback to Firebase REST API
      try {
        const response = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: cleanEmail,
              password,
              returnSecureToken: true,
            }),
          },
        );

        const data = await response.json();

        if (response.ok && data.idToken) {
          const uid = data.localId;
          const { isAdmin, role } = await resolveAndSyncUserRole(uid, data.idToken);

          const userObj = {
            uid: uid,
            email: data.email,
            name: data.displayName || cleanEmail.split("@")[0].toUpperCase(),
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            role: role,
            isAdmin: isAdmin,
          };

          localStorage.setItem("dda_auth_user", JSON.stringify(userObj));
          localStorage.setItem("dda_id_token", data.idToken);
          sessionStorage.setItem("dda_id_token", data.idToken);
          localStorage.setItem("dda_is_admin", isAdmin ? "true" : "false");
          localStorage.setItem("dda_user_role", role);

          if (window.ddaElectronAPI?.authenticateToken) {
            try {
              await window.ddaElectronAPI.authenticateToken(data.idToken);
            } catch (e) {
              console.warn("Main process token authentication failed:", e);
            }
          }

          return { success: true, user: userObj, token: data.idToken };
        }
      } catch (_) {}

      // Handle friendly error message
      let errorMessage = "Login failed. Please enter correct credentials";
      if (firebaseErr.code) {
        switch (firebaseErr.code) {
          case "auth/invalid-credential":
          case "auth/user-not-found":
          case "auth/wrong-password":
          case "auth/invalid-login-credentials":
            errorMessage = "Login failed. Please enter correct credentials";
            break;
          case "auth/invalid-email":
            errorMessage = "Please enter a valid email address.";
            break;
          case "auth/too-many-requests":
            errorMessage =
              "Too many failed login attempts. Please try again later.";
            break;
          case "auth/network-request-failed":
            errorMessage =
              "Network error. Please check your internet connection.";
            break;
          default:
            errorMessage = firebaseErr.message;
        }
      }

      return { success: false, error: errorMessage };
    }
  },

  login: async (email, password) => {
    return await api.loginUser(email, password);
  },

  logout: async () => {
    try {
      await signOut(auth);
    } catch (_) {}
    if (window.ddaElectronAPI?.clearActiveUser) {
      try {
        await window.ddaElectronAPI.clearActiveUser();
      } catch (_) {}
    }
    localStorage.removeItem("dda_auth_user");
    localStorage.removeItem("dda_auth_email");
    localStorage.removeItem("dda_auth_uid");
    localStorage.removeItem("dda_id_token");
    sessionStorage.removeItem("dda_id_token");
    localStorage.removeItem("dda_booking_key");
    return { success: true };
  },

  // ─── 2. CLOUDFLARE WORKER VALIDATE KEY & FETCH APPLICANTS ────────────
  validateBookingKey: async (bookingKey, user) => {
    const cleanKey = (bookingKey || "").trim().toUpperCase();
    if (!cleanKey) {
      return { success: false, error: "Please enter a booking key." };
    }

    let idToken = user?.idToken || (await getFirebaseIdToken());
    if (!idToken) {
      idToken = localStorage.getItem("dda_id_token") || "";
    }

    try {
      // Step A: Validate Booking Key with Cloudflare Worker
      let res = await fetch(
        `${WORKER_BASE_URL}/extension/validate-key?key=${encodeURIComponent(cleanKey)}`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        },
      );

      // If token expired (401), force refresh and retry once
      if (res.status === 401) {
        idToken = await getFirebaseIdToken(true);
        if (idToken) {
          res = await fetch(
            `${WORKER_BASE_URL}/extension/validate-key?key=${encodeURIComponent(cleanKey)}`,
            {
              headers: {
                Authorization: `Bearer ${idToken}`,
              },
            },
          );
        }
      }

      let keyData = {};
      if (res.ok) {
        keyData = await res.json();
      }

      // Step B: Fetch remote applicants belonging to this user/session from Worker
      let applicantsList = [];
      try {
        let appRes = await fetch(`${WORKER_BASE_URL}/extension/applicants`, {
          headers: {
            Authorization: `Bearer ${idToken}`,
            "X-Booking-Key": cleanKey,
          },
        });

        if (appRes.status === 401) {
          idToken = await getFirebaseIdToken(true);
          if (idToken) {
            appRes = await fetch(`${WORKER_BASE_URL}/extension/applicants`, {
              headers: {
                Authorization: `Bearer ${idToken}`,
                "X-Booking-Key": cleanKey,
              },
            });
          }
        }

        if (appRes.ok) {
          const appPayload = await appRes.json();
          const rawApps =
            appPayload?.data?.applicants || appPayload?.applicants || {};

          // Normalize applicants list
          if (Array.isArray(rawApps)) {
            applicantsList = rawApps;
          } else if (typeof rawApps === "object" && rawApps !== null) {
            applicantsList = Object.entries(rawApps).map(([panKey, app]) => {
              const personal = app.personal || {};
              const pan = app.pan || personal.pan || panKey;
              return {
                pan,
                password: app.password || personal.password || "",
                personal: {
                  ...personal,
                  pan,
                  firstName: personal.firstName || personal.first_name || "",
                  lastName: personal.lastName || personal.last_name || "",
                  fatherName: personal.fatherName || personal.father_name || "",
                  mobile: personal.mobile || personal.mobile_no || "",
                  email: personal.email || personal.email_id || "",
                },
                preferences: app.preferences || {},
                bank: app.bank || {},
                address: app.address || {},
                jointApplicant: app.jointApplicant || {},
              };
            });
          }
        }
      } catch (appErr) {
        console.warn("Worker applicants fetch error:", appErr);
      }

      // Extract backend schemes & active scheme from Worker keyData
      const rawSchemes = keyData?.schemes || keyData?.data?.schemes || [];
      let parsedSchemesList = [];
      if (Array.isArray(rawSchemes)) {
        parsedSchemesList = rawSchemes.filter(Boolean);
      } else if (typeof rawSchemes === "object" && rawSchemes !== null) {
        parsedSchemesList = Object.values(rawSchemes).filter(Boolean);
      }

      parsedSchemesList = parsedSchemesList.filter(s => s && !s.toLowerCase().includes('admin_bypass') && s.toLowerCase() !== 'admin');

      const existingSelected = wsGet('dda_selected_scheme');
      const rawTargetScheme = keyData?.scheme || keyData?.targetScheme;
      const isLiveValidScheme = rawTargetScheme && !rawTargetScheme.toLowerCase().includes('admin_bypass') && rawTargetScheme.toLowerCase() !== 'admin';

      const targetScheme = isLiveValidScheme
        ? rawTargetScheme
        : (existingSelected && !existingSelected.toLowerCase().includes('admin_bypass') ? existingSelected : (parsedSchemesList[0] || ''));
      const targetMode = keyData?.mode || 'LIVE';

      if (parsedSchemesList.length > 0) {
        localStorage.setItem('dda_schemes', JSON.stringify(parsedSchemesList));
      }
      if (targetScheme) {
        wsSet('dda_selected_scheme', targetScheme);
        wsSet('dda_target_scheme', targetScheme);
        wsSet('dda_active_scheme_name', targetScheme);
      }
      localStorage.setItem('dda_mode', targetMode);

      // Store in extension-compatible localStorage keys
      if (applicantsList.length > 0) {
        localStorage.setItem(
          'dda_extension_applicants',
          JSON.stringify(applicantsList),
        );
        localStorage.setItem(
          'ddaData',
          JSON.stringify({
            applicants: applicantsList.reduce((acc, a) => {
              acc[a.pan] = a;
              return acc;
            }, {}),
            targetScheme: targetScheme,
            schemes: parsedSchemesList,
            mode: targetMode,
          }),
        );
      }

      if (res.ok) {
        return {
          success: true,
          key: cleanKey,
          scheme: targetScheme,
          schemes:
            parsedSchemesList.length > 0
              ? parsedSchemesList
              : keyData?.schemes || {},
          mode: targetMode,
          windowEnd: keyData?.windowEnd || null,
          applicants: applicantsList,
        };
      }

      let errorMsg = "Invalid booking key. Please verify with admin.";
      try {
        const errJson = await res.json();
        if (errJson?.error) errorMsg = errJson.error;
      } catch (_) {}

      return {
        success: false,
        error: errorMsg,
      };
    } catch (e) {
      console.warn("Worker validation network error:", e);
      return {
        success: false,
        error:
          "Unable to connect to key validation server. Please check internet connection.",
      };
    }
  },

  // ─── 3. GET APPLICANTS (CLOUD WORKER + LOCAL MERGE) ──────────────────
  // Save an applicant's DDA password on the server (admin edits from the app)
  saveServerPassword: async (pan, password) => {
    try {
      const idToken = await getFirebaseIdToken(true);
      if (!idToken) return { success: false, error: "Not signed in" };
      const res = await fetch(`${WORKER_BASE_URL}/applicants/${encodeURIComponent(pan)}/password`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: password || "" }),
      });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { success: true } : { success: false, error: body?.error || `HTTP ${res.status}` };
    } catch (e) {
      return { success: false, error: e?.message || "Network error" };
    }
  },

  // What DDA said to the applicant's saved DDA password (wrong: "Invalid
  // Credentials"; false: a login with it went in). Shown on the website.
  reportDdaPasswordCheck: async (pan, wrong) => {
    try {
      const idToken = await getFirebaseIdToken();
      if (!idToken) return { success: false, error: "Not signed in" };
      const res = await fetch(`${WORKER_BASE_URL}/applicants/${encodeURIComponent(pan)}/password-check`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ wrong: !!wrong }),
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { success: true } : { success: false, error: body?.error || `HTTP ${res.status}` };
    } catch (e) {
      return { success: false, error: e?.message || "Network error" };
    }
  },

  // DDA's payment result (read on its result page) onto the booking run on the
  // server: only the payment fields change. { success, status } or { success: false, error }.
  recordPaymentResult: async (runId, payment) => {
    try {
      const idToken = await getFirebaseIdToken();
      if (!idToken) return { success: false, error: "Not signed in" };
      const res = await fetch(`${WORKER_BASE_URL}/extension/analytics/payment`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ runId, payment }),
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { success: true, status: body?.status } : { success: false, error: body?.error || `HTTP ${res.status}` };
    } catch (e) {
      return { success: false, error: e?.message || "Network error" };
    }
  },

  // The applicant's own card / net-banking login for Fast Payment (decrypted
  // by the Worker; owner or admin only). Fetched for the window's logged-in
  // DDA account when it reaches the hold page, and handed to main in memory.
  // { card, netbanking } (each may be null), or null when not reachable.
  getPaymentDetails: async (pan) => {
    try {
      const idToken = await getFirebaseIdToken();
      if (!idToken) return null;
      const res = await fetch(`${WORKER_BASE_URL}/applicants/${encodeURIComponent(pan)}/payment`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return null;
      const body = await res.json().catch(() => ({}));
      return { card: body?.card || null, netbanking: body?.netbanking || null };
    } catch (_) {
      return null;
    }
  },

  // Only the given applicants, from the cloud (patching the ones that
  // changed). { applicants, missing } or null when the cloud was not
  // reachable; missing = removed, or no longer this user's.
  getApplicantsByPans: async (user, pans) => {
    const clean = [...new Set((pans || []).map((p) => String(p || '').toUpperCase().trim()).filter(Boolean))];
    if (!clean.length) return { applicants: [], missing: [] };
    try {
      let idToken = user?.idToken;
      if (!idToken || isJwtExpired(idToken)) idToken = await getFirebaseIdToken(true);
      if (!idToken || isJwtExpired(idToken)) return null;
      const res = await fetch(`${WORKER_BASE_URL}/extension/applicants?pans=${encodeURIComponent(clean.join(','))}`, {
        headers: {
          Authorization: `Bearer ${idToken}`,
          "X-Booking-Key": localStorage.getItem("dda_booking_key") || "",
        },
      });
      if (!res.ok) return null;
      const body = await res.json();
      if (!body?.applicants || !Array.isArray(body.missing)) return null;
      const applicants = filterDeletedPans(mapCloudApplicants(body.applicants)).map((a) => ({
        ...a,
        userId: a.userId || user?.uid || 'user',
        userEmail: a.userEmail || user?.email || '',
        isUserOwned: true,
      }));
      return { applicants, missing: body.missing.map((p) => String(p).toUpperCase().trim()) };
    } catch (e) {
      console.warn("[Worker API] /extension/applicants?pans error:", e?.message || e);
      return null;
    }
  },

  getApplicantsByUser: async (user) => {
    api.lastApplicantsFromCloud = false;

    // 1. Try real-time fetch from Cloudflare Worker first
    try {
      let idToken = user?.idToken;
      if (!idToken || isJwtExpired(idToken)) {
        idToken = await getFirebaseIdToken(true);
      }
      const bookingKey =
        localStorage.getItem("dda_booking_key") || "";

      if (idToken && !isJwtExpired(idToken)) {
        // The admin gets every applicant, a user their own; both with the
        // DDA password (the logins come from this same list). light=1: without
        // the files (photo, signature, documents); see below.
        const endpoint = `${WORKER_BASE_URL}/extension/applicants?light=1`;

        let appRes = null;
        try {
          appRes = await fetch(endpoint, {
            headers: {
              Authorization: `Bearer ${idToken}`,
              "X-Booking-Key": bookingKey,
            },
          });

          if (appRes.status === 401 || appRes.status === 500) {
            idToken = await getFirebaseIdToken(true);
            if (idToken && !isJwtExpired(idToken)) {
              appRes = await fetch(endpoint, {
                headers: {
                  Authorization: `Bearer ${idToken}`,
                  "X-Booking-Key": bookingKey,
                },
              });
            }
          }
        } catch (fetchErr) {
          console.warn("[Worker API] /applicants fetch error:", fetchErr?.message || fetchErr);
        }

        if (appRes.ok) {
          const appPayload = await appRes.json();
          const rawApps =
            appPayload?.data?.applicants || appPayload?.applicants || {};
          // Filter out deleted profiles so they never resurrect from cloud Firestore
          const list = filterDeletedPans(mapCloudApplicants(rawApps));

          // Extract backend schemes & target scheme
          const rawSchemes =
            appPayload?.data?.schemes || appPayload?.schemes || [];
          let fetchedSchemes = [];
          if (Array.isArray(rawSchemes))
            fetchedSchemes = rawSchemes.filter(Boolean);
          else if (typeof rawSchemes === "object" && rawSchemes !== null)
            fetchedSchemes = Object.values(rawSchemes).filter(Boolean);

          fetchedSchemes = fetchedSchemes.filter(s => s && !s.toLowerCase().includes('admin_bypass') && s.toLowerCase() !== 'admin');

          const rawTargetScheme =
            appPayload?.data?.targetScheme ||
            appPayload?.targetScheme ||
            appPayload?.data?.scheme ||
            appPayload?.scheme;
          const existingSelected = wsGet('dda_selected_scheme');
          const isLiveValid = rawTargetScheme && !rawTargetScheme.toLowerCase().includes('admin_bypass') && rawTargetScheme.toLowerCase() !== 'admin';
          const targetScheme = isLiveValid
            ? rawTargetScheme
            : (existingSelected && !existingSelected.toLowerCase().includes('admin_bypass') ? existingSelected : (fetchedSchemes[0] || ''));
          const targetMode = appPayload?.data?.mode || appPayload?.mode;

          if (fetchedSchemes.length > 0) {
            localStorage.setItem('dda_schemes', JSON.stringify(fetchedSchemes));
          }
          if (targetScheme) {
            wsSet('dda_selected_scheme', targetScheme);
            wsSet('dda_target_scheme', targetScheme);
            wsSet('dda_active_scheme_name', targetScheme);
          }
          if (targetMode) {
            localStorage.setItem('dda_mode', targetMode);
          }

          {
            const taggedList = list.map((a) => ({
              ...a,
              userId: a.userId || user?.uid || 'user',
              userEmail: a.userEmail || user?.email || '',
              isUserOwned: true,
            }));
            safeSetItem('dda_extension_applicants', JSON.stringify(taggedList));
            safeSetItem('dda_user_applicants', JSON.stringify(taggedList));
            safeSetItem(
              'ddaData',
              JSON.stringify({
                applicants: taggedList.reduce((acc, a) => {
                  acc[a.pan] = a;
                  return acc;
                }, {}),
                targetScheme: targetScheme || '',
                schemes:
                  fetchedSchemes.length > 0
                    ? fetchedSchemes
                    : JSON.parse(localStorage.getItem('dda_schemes') || '[]'),
                mode: targetMode || localStorage.getItem('dda_mode') || 'LIVE',
              }),
            );
            // Keep this list in the local database: it is the fallback below
            // when the cloud cannot be reached (e.g. worker down at a drop),
            // and what a new window or a reload shows without downloading.
            api.lastApplicantsFromCloud = true;
            const isLight = taggedList.some((a) => Array.isArray(a._omitted));
            if (!isLight) {
              window.ddaElectronAPI?.cacheApplicants?.(taggedList, { full: true })?.catch?.(() => {});
              return taggedList;
            }
            // A light list: the database keeps the files it already has, so
            // the records come back from it with those files (the cloud's
            // text wins). A file that is still missing is downloaded with
            // the full record (useApplicantStore.ensureFullRecord).
            try {
              await window.ddaElectronAPI?.cacheApplicants?.(taggedList, { full: true });
              const local = await window.ddaElectronAPI?.getApplicantsByUser?.(user);
              if (Array.isArray(local)) {
                const byPan = new Map(local.map((a) => [String(a.pan || a.personal?.pan || '').toUpperCase().trim(), a]));
                return taggedList.map((a) => withLocalFiles(a, byPan.get(a.pan)));
              }
            } catch (_) {}
            return taggedList;
          }
        }
      }
    } catch (e) {
      console.warn("Real-time worker applicants fetch error:", e);
    }

    // 2. In Electron, the main process is the local database authority. An
    // authorized empty result must stay empty; do not revive stale renderer cache.
    if (window.ddaElectronAPI?.getApplicantsByUser) {
      try {
        const res = await window.ddaElectronAPI.getApplicantsByUser(user);
        if (Array.isArray(res)) return res;
      } catch (_) {}
    }

    // 3. Browser-only offline fallback. Restrict cached records to the current
    // account; client-side admin flags never widen this fallback.
    try {
      const cached = localStorage.getItem("dda_extension_applicants");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const uid = String(user?.uid || "");
          const email = String(user?.email || "").trim().toLowerCase();
          return parsed.filter((app) => {
            const ownerUid = String(app?.userId || "");
            const ownerEmail = String(app?.userEmail || "").trim().toLowerCase();
            return (uid && ownerUid === uid) || (email && ownerEmail === email);
          });
        }
      }
    } catch (_) {}

    return [];
  },

  // The last list kept on this computer, for showing instantly at start-up
  // while the cloud list loads.
  getCachedApplicants: async (user) => {
    if (window.ddaElectronAPI?.getApplicantsByUser) {
      try {
        const res = await window.ddaElectronAPI.getApplicantsByUser(user);
        if (Array.isArray(res) && res.length) return res;
      } catch (_) {}
    }
    try {
      const parsed = JSON.parse(localStorage.getItem('dda_user_applicants') || '[]');
      const uid = String(user?.uid || '');
      const email = String(user?.email || '').trim().toLowerCase();
      return Array.isArray(parsed)
        ? parsed.filter((app) =>
            (uid && String(app?.userId || '') === uid) ||
            (email && String(app?.userEmail || '').trim().toLowerCase() === email))
        : [];
    } catch (_) {
      return [];
    }
  },

  getApplicantByPan: async (pan, user) => {
    if (window.ddaElectronAPI?.getApplicantByPan) {
      return await window.ddaElectronAPI.getApplicantByPan(pan, user);
    }
    const apps = await api.getApplicantsByUser(user);
    return apps.find((a) => (a.pan || a.personal?.pan) === pan) || null;
  },

  saveApplicant: async (applicantData, user) => {
    if (window.ddaElectronAPI?.saveApplicant) {
      return await window.ddaElectronAPI.saveApplicant(applicantData, user);
    }
    // Update local cache
    try {
      let apps = JSON.parse(
        localStorage.getItem("dda_extension_applicants") || "[]",
      );
      const idx = apps.findIndex(
        (a) => (a.pan || a.personal?.pan) === applicantData.pan,
      );
      if (idx >= 0) apps[idx] = applicantData;
      else apps.push(applicantData);
      localStorage.setItem("dda_extension_applicants", JSON.stringify(apps));
    } catch (_) {}
    return { success: true, pan: applicantData.pan };
  },

  deleteApplicant: async (pan, user) => {
    if (window.ddaElectronAPI?.deleteApplicant) {
      return await window.ddaElectronAPI.deleteApplicant(pan, user);
    }
    try {
      let apps = JSON.parse(
        localStorage.getItem("dda_extension_applicants") || "[]",
      );
      apps = apps.filter((a) => (a.pan || a.personal?.pan) !== pan);
      localStorage.setItem("dda_extension_applicants", JSON.stringify(apps));
    } catch (_) {}
    return { success: true, pan };
  },

  // ─── 4. SETTINGS PERSISTENCE ─────────────────────────────────────────
  getSettings: async (customSession) => {
    const session = customSession || getWinSession();
    if (window.ddaElectronAPI?.getSettings) {
      return await window.ddaElectronAPI.getSettings(session);
    }
    return {
      theme: "dark",
      automationEnabled: true,
      captchaAutoSolveEnabled: true,
      loginCaptchaAutoSolveEnabled: true,
      captchaAutoSubmitEnabled: true,
      settleDelayMs: 150,
      stealthMode: true,
      zoomLevel: 1.15,
    };
  },

  saveSettings: async (settings, customSession) => {
    const session = customSession || getWinSession();
    const sanitized = { ...(settings || {}) };
    delete sanitized.fastPaymentCard;
    delete sanitized.autoPaySubmitEnabled;
    if (window.ddaElectronAPI?.saveSettings) {
      return await window.ddaElectronAPI.saveSettings(sanitized, session);
    }
    return { success: true };
  },

  // ─── 5. CAPTCHA SOLVER (LOCAL ONNX MODEL ONLY) ───
  solveCaptcha: async (imageBase64) => {
    if (!imageBase64) return { success: false, text: "" };

    // 1. FASTEST PATH: Native C++ ONNX Local Inference (< 2ms)
    if (window.ddaElectronAPI?.solveCaptchaLocal) {
      try {
        const localRes = await window.ddaElectronAPI.solveCaptchaLocal({ base64Image: imageBase64 });
        if (localRes?.success && localRes.data) {
          const ans = String(localRes.data.numericAnswer || localRes.data.answer || "");
          if (ans) {
            return {
              success: true,
              text: ans,
              numericAnswer: localRes.data.numericAnswer,
              confidence: localRes.data.confidence || 0.99,
              engine: `Native ONNX (${localRes.data.durationMs || 2}ms)`,
              rawText: localRes.data.rawText
            };
          }
        }
      } catch (onnxErr) {
        console.warn("Native ONNX solve error:", onnxErr);
      }
    }

    return {
      success: false,
      text: "",
      error: "Captcha solver unavailable",
    };
  },

  // ─── 6. REALTIME FLEET TELEMETRY & BOOKING WINS (EXTENSION PARITY) ───
  sendBookingTelemetry: async (runData, user) => {
    if (!runData) return { success: false };

    const mode = runData.mode || localStorage.getItem("dda_mode") || "LIVE";
    const bookingKey =
      localStorage.getItem("dda_booking_key") || "";
    let userEmail =
      user?.email ||
      localStorage.getItem("dda_auth_email") ||
      sessionStorage.getItem("dda_auth_email") ||
      runData.userEmail ||
      "";
    if (!userEmail || userEmail === "extension@dda.local") {
      try {
        const storedUser = JSON.parse(localStorage.getItem("dda_auth_user") || "{}");
        if (storedUser?.email && storedUser.email !== "extension@dda.local") {
          userEmail = storedUser.email;
        }
      } catch (_) {}
    }

    const userId = user?.uid || runData.userId || "user";
    const applicantPan = (runData.applicantPan || runData.applicant?.pan || "RUN").toUpperCase().trim();
    const timestamp = runData.timestamp || Date.now();
    const rawDocId = runData.runId || runData.id || `${applicantPan}_${timestamp}`;
    const docId = String(rawDocId).replace(/[\/\s\.]/g, "_");

    // Gather granular event logs (runData > sessionStorage > localStorage)
    let rawRunLogs = Array.isArray(runData.runLogs) && runData.runLogs.length > 0
      ? runData.runLogs
      : (Array.isArray(runData.logs) && runData.logs.length > 0 ? runData.logs : []);
    if (rawRunLogs.length === 0) {
      try {
        rawRunLogs = JSON.parse(
          sessionStorage.getItem("dda_session_run_logs") ||
          localStorage.getItem("dda_run_logs") ||
          "[]"
        );
      } catch (_) {}
    }

    // Format timestamp to 12-hour AM/PM format (Extension Parity)
    function format12HourTime(ts = Date.now()) {
      const d = new Date(ts);
      const h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, "0");
      const s = String(d.getSeconds()).padStart(2, "0");
      const ms = String(d.getMilliseconds()).padStart(3, "0");
      const ap = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      return `${h12}:${m}:${s}.${ms} ${ap}`;
    }

    // Format all logs into structured objects for <RunLogsViewer /> in Admin Dashboard
    const formattedLogs = rawRunLogs
      .filter((l) => {
        const msg = typeof l === "string" ? l : (l.msg || l.message || "");
        return !msg.includes("Isolated session active");
      })
      .map((l) => {
        if (typeof l === "string") {
          return {
            time: format12HourTime(timestamp),
            level: l.includes("SUCCESS") ? "SUCCESS" : (l.includes("ERROR") ? "ERROR" : (l.includes("WARN") ? "WARN" : "INFO")),
            page: "DDA",
            msg: l,
            pan: applicantPan,
          };
        }
        let time = l.time || l.timeStr;
        if (!time || (!time.includes("AM") && !time.includes("PM"))) {
          time = format12HourTime(l.timestamp || l.ts || timestamp);
        }
        return {
          time,
          level: (l.level || "INFO").toUpperCase(),
          page: l.page || "DDA",
          msg: l.msg || l.message || "",
          pan: l.pan || applicantPan,
        };
      });

    // Ensure the very first line of Detailed Execution Logs indicates Electron Desktop App origin
    if (!formattedLogs.some((l) => l.msg?.includes("Logs sent from the Electron Desktop App"))) {
      formattedLogs.unshift({
        time: formattedLogs[0]?.time || format12HourTime(timestamp - 3000),
        level: "INFO",
        page: "System",
        msg: "🖥️ Logs sent from the Electron Desktop App",
        pan: applicantPan,
      });
    }

    // The page script already picked this booking's attempts; use them as-is.
    const attemptsFromPage = Array.isArray(runData.captchaAttempts) && runData.captchaAttempts.length > 0;
    let rawCaptchaAttempts = attemptsFromPage ? runData.captchaAttempts : [];
    if (rawCaptchaAttempts.length === 0) {
      try {
        rawCaptchaAttempts = JSON.parse(
          localStorage.getItem("dda_captcha_attempts") ||
            sessionStorage.getItem("dda_captcha_attempts") ||
            "[]",
        );
      } catch (_) {}
    }

    // Read from storage instead: keep what was recorded since the run's first
    // step (normally Scheme Apply); without a recorded start, the last 60 s.
    const anchorTs = runData.completedAt ? new Date(runData.completedAt).getTime() : Date.now();
    const firstStepTs = Object.values(runData.steps || {})
      .map((st) => st?.timestamp)
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    const attemptsFrom = firstStepTs || anchorTs - 60_000;
    const filteredCaptchaAttempts = attemptsFromPage
      ? rawCaptchaAttempts
      : rawCaptchaAttempts.filter((att) => {
          if (!att.timestamp) return false;
          if (att.timestamp < attemptsFrom) return false;
          if (att.pan && applicantPan && applicantPan !== 'RUN' && att.pan !== applicantPan) return false;
          return true;
        });

    const hasSubmitted = filteredCaptchaAttempts.some(
      (a) =>
        a.status === "RESERVED" ||
        a.status === "SUBMITTED" ||
        a.status === "SERVER_REJECTED" ||
        a.status === "NO_RESPONSE" ||
        a.status === "FAILED",
    );
    const validAttempts = hasSubmitted
      ? filteredCaptchaAttempts.filter((a) => a.status !== "PRE_SOLVED")
      : filteredCaptchaAttempts;

    const dedupedAttempts = [];
    const seenImages = new Set();
    for (let i = validAttempts.length - 1; i >= 0; i--) {
      const att = validAttempts[i];
      const imgKey = att.base64Image
        ? att.base64Image.slice(-60)
        : `${att.timestamp}_${att.answer}`;
      if (!seenImages.has(imgKey)) {
        seenImages.add(imgKey);
        dedupedAttempts.unshift(att);
      }
    }

    dedupedAttempts.forEach((att, idx) => {
      att.attemptNumber = idx + 1;
    });

    let finalCaptchaAttempts =
      dedupedAttempts.length > 0
        ? dedupedAttempts
        : (rawCaptchaAttempts.length > 0 ? [rawCaptchaAttempts[rawCaptchaAttempts.length - 1]] : []);
    if (finalCaptchaAttempts.length === 0 && runData.lastCaptcha) {
      finalCaptchaAttempts = [runData.lastCaptcha];
    }

    const holdExpiresAt = runData.holdExpiresAt || (Date.now() + 15 * 60 * 1000);
    const holdExpiresIso = typeof holdExpiresAt === "number"
      ? new Date(holdExpiresAt).toISOString()
      : String(holdExpiresAt);

    const totalDurationMs = runData.totalDurationMs || 0;
    const totalDurationSec =
      runData.totalDurationSec !== undefined
        ? runData.totalDurationSec
        : parseFloat(((totalDurationMs) / 1000).toFixed(2));

    const finalFatherName = runData.fatherName || runData.personal?.fatherName || runData.personal?.father_name || "";
    let finalApplicantName = runData.applicantName || "Applicant";
    if (finalFatherName && finalApplicantName.toLowerCase() === finalFatherName.toLowerCase()) {
      const realName = [runData.personal?.firstName, runData.personal?.lastName].filter(Boolean).join(" ");
      if (realName) finalApplicantName = realName;
    }

    const analyticsPayload = {
      id: docId,
      runId: docId,
      timestamp,
      applicantName: finalApplicantName,
      applicantPan: applicantPan,
      fatherName: finalFatherName,
      mode: mode.toUpperCase(),
      userEmail,
      userId,
      bookingKey,
      totalDurationMs,
      totalDurationSec,
      steps: runData.steps || {},
      // Target flats the search used, and whether they were this computer's edit or the server's
      targetFlats: Array.isArray(runData.targetFlats) ? runData.targetFlats : [],
      targetFlatsSource: runData.targetFlatsSource || "",
      bookedFlat: runData.bookedFlat || {
        flatNo: runData.flatNo || "",
        locality: runData.locality || "",
        sector: runData.sector || "",
        pocket: runData.pocket || "",
        block: runData.block || "",
        floor: runData.floor || "",
        holdExpiresAt: holdExpiresIso,
      },
      captchaAttempts: finalCaptchaAttempts,
      lastCaptcha: finalCaptchaAttempts.length > 0 ? finalCaptchaAttempts[finalCaptchaAttempts.length - 1] : null,
      runLogs: formattedLogs,
      logs: formattedLogs,
      holdExpiresAt: holdExpiresIso,
      createdAt: runData.createdAt || new Date().toISOString(),
      completedAt: runData.completedAt || new Date().toISOString(),
      client: "DDA-Desktop-Electron",
    };

    let directSaved = false;
    let workerSaved = false;

    // 1. Direct Firestore Instant Write to collection 'bookingRuns' (Only if user has an active Firebase SDK Auth session)
    const currentAuthUser = auth?.currentUser;
    if (db && currentAuthUser && !currentAuthUser.isAnonymous) {
      try {
        await setDoc(doc(db, "bookingRuns", docId), analyticsPayload);
        console.log("✅ [Direct Firestore] Successfully saved booking run to bookingRuns collection:", docId);
        directSaved = true;
      } catch (_) {
        // Direct write couldn't complete; Cloudflare Worker Service Account handles it seamlessly
      }
    }

    // 2. Cloudflare Worker REST API write to guarantee service account cloud persistence
    try {
      const idToken =
        (await getFirebaseIdToken()) || localStorage.getItem("dda_id_token");
      const res = await fetch(`${WORKER_BASE_URL}/extension/analytics`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          "X-Booking-Key": bookingKey,
          ...(userEmail ? { "X-User-Email": userEmail } : {}),
          ...(userId ? { "X-User-Id": userId } : {}),
        },
        body: JSON.stringify(analyticsPayload),
      });
      if (res.ok) {
        console.log("✅ [Cloud Telemetry] Successfully synced booking run to Firebase (Worker Service Account):", docId);
        workerSaved = true;
      } else {
        const errData = await res.json().catch(() => ({}));
        console.warn("⚠️ [Cloud Telemetry] Worker rejected save:", res.status, errData);
      }
    } catch (err) {
      console.warn("⚠️ [Cloud Telemetry] Cloudflare Worker relay notice:", err.message);
    }

    // 3. Save locally via Electron Main Process (SQLite / offline store + forensic disk log)
    let electronSaveResult = null;
    if (typeof window !== "undefined" && window.ddaElectronAPI?.saveAnalytics) {
      try {
        // cloudSynced: the worker already has it; main then only saves locally
        // (and retries the worker itself when this renderer's post failed).
        electronSaveResult = await window.ddaElectronAPI.saveAnalytics({ ...analyticsPayload, cloudSynced: workerSaved });
      } catch (_) {}
    }

    // 4. Persist into local offline storage fallback
    try {
      let localRuns = JSON.parse(
        localStorage.getItem("dda_booking_runs") || "[]",
      );
      localRuns = localRuns.filter((r) => r.id !== docId);
      localRuns.unshift(analyticsPayload);
      if (localRuns.length > 50) localRuns = localRuns.slice(0, 50);
      localStorage.setItem("dda_booking_runs", JSON.stringify(localRuns));
    } catch (_) {}

    return {
      success: directSaved || workerSaved || Boolean(electronSaveResult?.success),
      directFirestore: directSaved,
      worker: workerSaved,
      payload: analyticsPayload,
      logFilePath: electronSaveResult?.logFilePath,
      logFileName: electronSaveResult?.logFileName,
    };
  },

  // ─── 7. PERIODIC 1-MINUTE WORKER CONFIG SYNC ─────────────────────────
  syncRealtimeConfig: async (bookingKey, user) => {
    const cleanKey = (
      bookingKey ||
      localStorage.getItem("dda_booking_key") ||
      ""
    ).trim();
    if (!cleanKey) return null;


    // Suppress continuous repeated 403 console warnings if key was marked expired on worker
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(`dda_key_expired_${cleanKey}`) === "true") {
      return { expired: true };
    }

    try {
      let idToken =
        user?.idToken ||
        (await getFirebaseIdToken()) ||
        localStorage.getItem("dda_id_token");

      if (!idToken) return null;

      let res = await fetch(
        `${WORKER_BASE_URL}/extension/validate-key?key=${encodeURIComponent(cleanKey)}`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        },
      );

      // If token expired (401), force refresh and retry once
      if (res.status === 401) {
        idToken = await getFirebaseIdToken(true);
        if (idToken) {
          res = await fetch(
            `${WORKER_BASE_URL}/extension/validate-key?key=${encodeURIComponent(cleanKey)}`,
            {
              headers: {
                Authorization: `Bearer ${idToken}`,
              },
            },
          );
        }
      }

      if (res.ok) {
        const keyData = await res.json();
        const rawSchemes = keyData?.schemes || keyData?.data?.schemes || [];
        let parsedSchemesList = [];
        if (Array.isArray(rawSchemes))
          parsedSchemesList = rawSchemes.filter(Boolean);
        else if (typeof rawSchemes === "object" && rawSchemes !== null)
          parsedSchemesList = Object.values(rawSchemes).filter(Boolean);

        parsedSchemesList = parsedSchemesList.filter(s => s && !s.toLowerCase().includes('admin_bypass') && s.toLowerCase() !== 'admin');

        const existingSelected = wsGet('dda_selected_scheme');
        const rawTargetScheme = keyData?.scheme || keyData?.targetScheme || keyData?.data?.targetScheme || '';
        const isLiveValid = rawTargetScheme && !rawTargetScheme.toLowerCase().includes('admin_bypass') && rawTargetScheme.toLowerCase() !== 'admin';
        const targetScheme = isLiveValid
          ? rawTargetScheme
          : (existingSelected && !existingSelected.toLowerCase().includes('admin_bypass') ? existingSelected : (parsedSchemesList[0] || null));
        const mode = keyData?.mode;

        if (parsedSchemesList.length > 0)
          localStorage.setItem(
            'dda_schemes',
            JSON.stringify(parsedSchemesList),
          );
        if (targetScheme) {
          wsSet('dda_selected_scheme', targetScheme);
          wsSet('dda_target_scheme', targetScheme);
          wsSet('dda_active_scheme_name', targetScheme);
        }
        if (mode) localStorage.setItem('dda_mode', mode);

        return {
          schemes: parsedSchemesList,
          targetScheme,
          mode,
          windowEnd: keyData?.windowEnd,
        };
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = String(errData?.error || "");
        // Worker access refusals all start "Booking window expired." (ended, key
        // rotated/invalid, not LIVE, user removed). "Not started yet" is not an
        // expiry, and other 403s (e.g. a bad Firebase token) must not log out.
        if (
          res.status === 403 &&
          errMsg.startsWith("Booking window expired.") &&
          !errMsg.includes("has not started yet")
        ) {
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(`dda_key_expired_${cleanKey}`, "true");
          }
          console.warn(`[Worker Sync] Key notice (403): ${errMsg}`);
          return { expired: true, reason: errMsg };
        }
        if (res.status === 403) {
          console.warn(`[Worker Sync] Key notice (403): ${errMsg || 'access refused'}`);
        }
      }
    } catch (_) {}

    return null;
  },

  // ─── 8. REAL-TIME SCHEMES FETCHER ────────────────────────────────────
  getSchemes: async (user) => {
    let result = [];

    // 1. Direct Firestore schemes collection
    try {
      const snap = await getDocs(collection(db, "schemes"));
      if (!snap.empty) {
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          const val = d?.value || d?.name || docSnap.id;
          if (val && typeof val === "string") {
            const clean = val.trim();
            if (clean && !clean.toLowerCase().includes("admin_bypass") && clean.toLowerCase() !== "admin") {
              result.push(clean);
            }
          }
        });
      }
    } catch (err) {
      console.warn("Could not read schemes collection from Firestore:", err?.message || err);
    }

    // 2. Cloudflare Worker /schemes endpoint (with Bearer idToken)
    try {
      let idToken = user?.idToken;
      if (!idToken || isJwtExpired(idToken)) {
        idToken = await getFirebaseIdToken();
      }
      if (idToken && isJwtExpired(idToken)) {
        idToken = await getFirebaseIdToken(true);
      }
      if (idToken && !isJwtExpired(idToken)) {
        const res = await fetch(`${WORKER_BASE_URL}/schemes`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          const list = data?.schemes || data?.data?.schemes || data?.data || [];
          if (Array.isArray(list)) {
            list.forEach((item) => {
              const val = typeof item === "string" ? item : (item?.value || item?.name);
              if (val && typeof val === "string") {
                const clean = val.trim();
                if (clean && !clean.toLowerCase().includes("admin_bypass") && clean.toLowerCase() !== "admin") {
                  result.push(clean);
                }
              }
            });
          }
        }
      }
    } catch (_) {}

    // 3. Check the public booking config in Firestore (runtimeConfig/current
    // with the booking key is admin-only)
    try {
      const runtimeSnap = await getDoc(doc(db, "runtimeConfig", "public"));
      if (runtimeSnap.exists()) {
        const rData = runtimeSnap.data();
        if (rData?.schemes) {
          let list = [];
          if (Array.isArray(rData.schemes)) list = rData.schemes;
          else if (typeof rData.schemes === "object") list = Object.values(rData.schemes);
          list.forEach((s) => {
            if (typeof s === "string") {
              const clean = s.trim();
              if (clean && !clean.toLowerCase().includes("admin_bypass") && clean.toLowerCase() !== "admin") {
                result.push(clean);
              }
            }
          });
        }
      }
    } catch (_) {}

    // 4. Fallback to cached localStorage
    if (result.length === 0) {
      try {
        const cached = JSON.parse(localStorage.getItem("dda_schemes") || "[]");
        if (Array.isArray(cached)) result = cached;
      } catch (_) {}
    }

    const unique = Array.from(new Set(result)).sort((a, b) => a.localeCompare(b));
    return unique;
  },
};
