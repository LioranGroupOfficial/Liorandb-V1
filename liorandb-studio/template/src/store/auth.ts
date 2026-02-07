import { create } from 'zustand';
import { AuthState } from '@/types';

interface AuthStore extends AuthState {
  setLoggedIn: (loggedIn: boolean, token?: string, uri?: string) => void;
  setToken: (token: string | null) => void;
  setConnectionUri: (uri: string | null) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
  loadFromStorage: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  isLoggedIn: false,
  token: null,
  connectionUri: null,
  error: null,
  isLoading: false,

  setLoggedIn: (loggedIn, token, uri) => {
    set({ isLoggedIn: loggedIn, token, connectionUri: uri });
    if (loggedIn && token && uri) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('liorandb_token', token);
        localStorage.setItem('liorandb_uri', uri);
      }
    }
  },

  setToken: (token) => set({ token }),

  setConnectionUri: (uri) => set({ connectionUri: uri }),

  setError: (error) => set({ error }),

  setLoading: (loading) => set({ isLoading: loading }),

  logout: () => {
    set({
      isLoggedIn: false,
      token: null,
      connectionUri: null,
      error: null,
    });
    if (typeof window !== 'undefined') {
      localStorage.removeItem('liorandb_token');
      localStorage.removeItem('liorandb_uri');
    }
  },

  loadFromStorage: () => {
    if (typeof window === 'undefined') return;
    
    const token = localStorage.getItem('liorandb_token');
    const uri = localStorage.getItem('liorandb_uri');
    
    if (token && uri) {
      set({
        isLoggedIn: true,
        token,
        connectionUri: uri,
      });
    }
  },
}));
