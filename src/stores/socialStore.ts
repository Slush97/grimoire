import { create } from 'zustand';
import {
  getSocialSessionStatus,
  socialCancelLogin,
  socialDeleteAccount,
  socialLogin,
  socialLogout,
  socialOnSessionChanged,
  type SocialSessionStatus,
} from '../lib/api';

interface SocialStore {
  status: SocialSessionStatus;
  loading: boolean;
  error: string | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  login: () => Promise<void>;
  cancelLogin: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
}

const INITIAL_STATUS: SocialSessionStatus = {
  signedIn: false,
  user: null,
  persistenceMode: 'session-only',
  expiresAt: null,
};

export const useSocialStore = create<SocialStore>((set, get) => ({
  status: INITIAL_STATUS,
  loading: false,
  error: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const status = await getSocialSessionStatus();
      set({ status, hydrated: true });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        hydrated: true,
      });
    }
  },

  login: async () => {
    set({ loading: true, error: null });
    try {
      const status = await socialLogin();
      set({ status, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
      throw err;
    }
  },

  cancelLogin: async () => {
    // Main resolves the in-flight login promise with a rejection, which lands
    // in the login() catch above and clears `loading` for us. Errors from the
    // IPC call itself are harmless (no login in flight) — swallow.
    try {
      await socialCancelLogin();
    } catch {
      /* no-op */
    }
  },

  logout: async () => {
    set({ loading: true, error: null });
    try {
      const status = await socialLogout();
      set({ status, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  deleteAccount: async () => {
    set({ loading: true, error: null });
    try {
      const status = await socialDeleteAccount();
      set({ status, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));

// Subscribe once at module load to keep the store in sync when the main
// process broadcasts session changes (server-side invalidation, OS-protocol
// callbacks, account deletion). Idempotent: the preload bridge returns an
// unsubscribe but we deliberately never call it.
socialOnSessionChanged((status) => {
  useSocialStore.setState({ status });
});
