import { create } from "zustand";
import { api } from "../services/api";
import { wsSet, wsRemove } from "../utils/storageHelper";

const DEFAULT_SETTINGS = {
  theme: "light",
  automationEnabled: true,
  captchaAutoSolveEnabled: true,
  loginCaptchaAutoSolveEnabled: true,
  captchaAutoSubmitEnabled: true,
  prefilledFastPass: false,
  // Testing only: lets the sidebar applicant differ from the DDA account.
  // Off by default and switched off again every time the app starts.
  allowDifferentApplicant: false,
  directUrlJumpEnabled: true,
  fullAuto: true,
  halfAuto: false,
  fastPaymentEnabled: true,
  fastPaymentGateway: "cbi",
  fastPaymentMethod: "card",
  fastPaymentBank: "centralbankofindia",
};

export const useSettingsStore = create((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoading: false,

  // Load persistent settings from SQLite / JSON offline database
  loadSettings: async () => {
    set({ isLoading: true });
    try {
      // Purge any plaintext payment card remnants from web storage
      try {
        if (typeof window !== "undefined") {
          localStorage.removeItem("dda_fast_payment_card");
          sessionStorage.removeItem("dda_fast_payment_card");
        }
      } catch (_) {}

      const saved = await api.getSettings();
      if (saved && typeof saved === "object") {
        delete saved.fastPaymentCard;
        delete saved.autoPaySubmitEnabled;
        const carriedTestingSwitch = saved.allowDifferentApplicant === true;
        saved.allowDifferentApplicant = false;
        set((state) => ({
          settings: { ...state.settings, ...saved },
          isLoading: false,
        }));
        if (carriedTestingSwitch) {
          try { await api.saveSettings(get().settings); } catch (_) {}
        }
      } else {
        set({ isLoading: false });
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
      set({ isLoading: false });
    }
  },

  // Update settings and save to DB
  updateSettings: async (partialSettings) => {
    const current = get()?.settings || DEFAULT_SETTINGS;
    const sanitized = { ...(partialSettings || {}) };
    delete sanitized.fastPaymentCard;
    delete sanitized.autoPaySubmitEnabled;
    const updated = { ...current, ...sanitized };
    delete updated.fastPaymentCard;
    delete updated.autoPaySubmitEnabled;
    set({ settings: updated });
    try {
      await api.saveSettings(updated);
    } catch (err) {
      console.error("Failed to persist settings:", err);
    }
  },

  // Automation Mode Helpers
  toggleFullAuto: async () => {
    const current = get()?.settings || DEFAULT_SETTINGS;
    const nextFull = !(
      current.fullAuto !== false && current.automationEnabled !== false
    );
    const updated = {
      ...current,
      fullAuto: nextFull,
      halfAuto: nextFull ? false : current.halfAuto,
      automationEnabled: nextFull || current.halfAuto,
    };
    set({ settings: updated });
    await api.saveSettings(updated);
  },

  toggleHalfAuto: async () => {
    const current = get()?.settings || DEFAULT_SETTINGS;
    const nextHalf = !current.halfAuto;
    const updated = {
      ...current,
      halfAuto: nextHalf,
      fullAuto: nextHalf ? false : current.fullAuto,
      automationEnabled: nextHalf || current.fullAuto,
    };
    set({ settings: updated });
    await api.saveSettings(updated);
  },

  toggleCaptchaAutoSolve: async () => {
    const current = get()?.settings || DEFAULT_SETTINGS;
    const nextCaptcha = !(current.captchaAutoSolveEnabled !== false);
    const updated = {
      ...current,
      captchaAutoSolveEnabled: nextCaptcha,
    };
    set({ settings: updated });
    await api.saveSettings(updated);
  },

  togglePrefilledFastPass: async () => {
    const current = get()?.settings || DEFAULT_SETTINGS;
    const nextFastPass = !current.prefilledFastPass;
    const updated = {
      ...current,
      prefilledFastPass: nextFastPass,
    };
    set({ settings: updated });
    try {
      wsSet("dda_prefilled_fastpass", nextFastPass ? "true" : "false");
    } catch (_) {}
    await api.saveSettings(updated);
  },

  toggleFastPayment: async () => {
    const current = get()?.settings || DEFAULT_SETTINGS;
    const nextFastPayment = !(current.fastPaymentEnabled !== false);
    const updated = {
      ...current,
      fastPaymentEnabled: nextFastPayment,
    };
    set({ settings: updated });
    try {
      wsSet("dda_fast_payment_enabled", nextFastPayment ? "true" : "false");
    } catch (_) {}
    await api.saveSettings(updated);
  },

  updateFastPaymentConfig: async (paymentConfig) => {
    const current = get()?.settings || DEFAULT_SETTINGS;
    const sanitizedConfig = { ...(paymentConfig || {}) };
    delete sanitizedConfig.fastPaymentCard;
    delete sanitizedConfig.autoPaySubmitEnabled;

    const updated = {
      ...current,
      ...sanitizedConfig,
    };
    delete updated.fastPaymentCard;
    delete updated.autoPaySubmitEnabled;

    set({ settings: updated });
    try {
      wsRemove("dda_fast_payment_card");
      if (updated.fastPaymentGateway) {
        wsSet("dda_fast_payment_gateway", updated.fastPaymentGateway);
      }
      if (updated.fastPaymentMethod) {
        wsSet("dda_fast_payment_method", updated.fastPaymentMethod);
      }
      if (updated.fastPaymentBank) {
        wsSet("dda_fast_payment_bank", updated.fastPaymentBank);
      }
    } catch (_) {}
    await api.saveSettings(updated);
  },
}));
