import { create } from 'zustand';
import { Database, Collection, Document, QueryResult, StoreState } from '@/types';

interface AppStore extends StoreState {
  // Auth actions
  setLoggedIn: (loggedIn: boolean, token?: string, uri?: string) => void;
  setToken: (token: string | null) => void;
  setConnectionUri: (uri: string | null) => void;
  logout: () => void;
  
  // Navigation actions
  setCurrentDatabase: (db: string | null) => void;
  setSelectedCollection: (col: string | null) => void;
  
  // Data actions
  setDatabases: (databases: Database[]) => void;
  setCollections: (dbName: string, collections: Collection[]) => void;
  setDocuments: (documents: Document[]) => void;
  setQueryResults: (results: QueryResult | null) => void;
  
  // UI actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSuccessMessage: (message: string | null) => void;
  
  // Storage
  loadFromStorage: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  // Auth
  isLoggedIn: false,
  token: null,
  connectionUri: null,
  
  // Navigation
  currentDatabase: null,
  selectedCollection: null,
  
  // Data
  databases: [],
  collections: {},
  documents: [],
  queryResults: null,
  
  // UI State
  isLoading: false,
  error: null,
  successMessage: null,

  // Auth actions
  setLoggedIn: (loggedIn, token, uri) => {
    set({ isLoggedIn: loggedIn, token, connectionUri: uri });
    if (loggedIn && token && uri && typeof window !== 'undefined') {
      localStorage.setItem('liorandb_token', token);
      localStorage.setItem('liorandb_uri', uri);
    }
  },

  setToken: (token) => set({ token }),

  setConnectionUri: (uri) => set({ connectionUri: uri }),

  logout: () => {
    set({
      isLoggedIn: false,
      token: null,
      connectionUri: null,
      databases: [],
      collections: {},
      documents: [],
      queryResults: null,
      currentDatabase: null,
      selectedCollection: null,
    });
    if (typeof window !== 'undefined') {
      localStorage.removeItem('liorandb_token');
      localStorage.removeItem('liorandb_uri');
    }
  },
  
  // Navigation actions
  setCurrentDatabase: (db) => set({ currentDatabase: db, selectedCollection: null }),
  
  setSelectedCollection: (col) => set({ selectedCollection: col }),
  
  // Data actions
  setDatabases: (databases) => set({ databases }),
  
  setCollections: (dbName, collections) => {
    set((state) => ({
      collections: {
        ...state.collections,
        [dbName]: collections,
      },
    }));
  },
  
  setDocuments: (documents) => set({ documents }),
  
  setQueryResults: (results) => set({ queryResults: results }),
  
  // UI actions
  setLoading: (loading) => set({ isLoading: loading }),
  
  setError: (error) => set({ error }),
  
  setSuccessMessage: (message) => set({ successMessage: message }),
  
  // Storage
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
