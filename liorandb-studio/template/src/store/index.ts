import { create } from 'zustand';
import { Collection, Database, Document, LioranUser, QueryResult, StoreState } from '@/types';

interface AppStore extends StoreState {
  setLoggedIn: (payload: {
    loggedIn: boolean;
    token?: string | null;
    connectionString?: string | null;
    uri?: string | null;
    user?: LioranUser | null;
  }) => void;
  setToken: (token: string | null) => void;
  setConnectionString: (connectionString: string | null) => void;
  setConnectionUri: (uri: string | null) => void;
  setUser: (user: LioranUser | null) => void;
  logout: () => void;
  setCurrentDatabase: (db: string | null) => void;
  setSelectedCollection: (col: string | null) => void;
  setDatabases: (databases: Database[]) => void;
  setCollections: (dbName: string, collections: Collection[]) => void;
  setDocuments: (documents: Document[]) => void;
  setQueryResults: (results: QueryResult | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSuccessMessage: (message: string | null) => void;
  loadFromStorage: () => void;
}

const STORAGE_KEYS = {
  token: 'liorandb_token',
  connectionString: 'liorandb_connection_string',
  uri: 'liorandb_uri',
  user: 'liorandb_user',
};

export const useAppStore = create<AppStore>((set) => ({
  isLoggedIn: false,
  token: null,
  connectionString: null,
  connectionUri: null,
  user: null,
  currentDatabase: null,
  selectedCollection: null,
  databases: [],
  collections: {},
  documents: [],
  queryResults: null,
  isLoading: false,
  error: null,
  successMessage: null,

  setLoggedIn: ({ loggedIn, token = null, connectionString = null, uri = null, user = null }) => {
    set({ isLoggedIn: loggedIn, token, connectionString, connectionUri: uri, user });

    if (typeof window !== 'undefined') {
      if (loggedIn && uri && (token || connectionString)) {
        localStorage.setItem(STORAGE_KEYS.uri, uri);

        if (token) {
          localStorage.setItem(STORAGE_KEYS.token, token);
          localStorage.removeItem(STORAGE_KEYS.connectionString);
        } else if (connectionString) {
          localStorage.setItem(STORAGE_KEYS.connectionString, connectionString);
          localStorage.removeItem(STORAGE_KEYS.token);
        }

        if (user) {
          localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
        }
      } else {
        localStorage.removeItem(STORAGE_KEYS.token);
        localStorage.removeItem(STORAGE_KEYS.connectionString);
        localStorage.removeItem(STORAGE_KEYS.uri);
        localStorage.removeItem(STORAGE_KEYS.user);
      }
    }
  },

  setToken: (token) => set({ token }),
  setConnectionString: (connectionString) => set({ connectionString }),
  setConnectionUri: (uri) => set({ connectionUri: uri }),
  setUser: (user) => set({ user }),

  logout: () => {
    set({
      isLoggedIn: false,
      token: null,
      connectionString: null,
      connectionUri: null,
      user: null,
      databases: [],
      collections: {},
      documents: [],
      queryResults: null,
      currentDatabase: null,
      selectedCollection: null,
    });

    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEYS.token);
      localStorage.removeItem(STORAGE_KEYS.connectionString);
      localStorage.removeItem(STORAGE_KEYS.uri);
      localStorage.removeItem(STORAGE_KEYS.user);
    }
  },

  setCurrentDatabase: (db) => set({ currentDatabase: db, selectedCollection: null, documents: [] }),
  setSelectedCollection: (col) => set({ selectedCollection: col, queryResults: null }),
  setDatabases: (databases) => set({ databases }),
  setCollections: (dbName, collections) =>
    set((state) => ({
      collections: {
        ...state.collections,
        [dbName]: collections,
      },
    })),
  setDocuments: (documents) => set({ documents }),
  setQueryResults: (results) => set({ queryResults: results }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setSuccessMessage: (message) => set({ successMessage: message }),

  loadFromStorage: () => {
    if (typeof window === 'undefined') return;

    const token = localStorage.getItem(STORAGE_KEYS.token);
    const connectionString = localStorage.getItem(STORAGE_KEYS.connectionString);
    const uri = localStorage.getItem(STORAGE_KEYS.uri);
    const user = localStorage.getItem(STORAGE_KEYS.user);

    if (uri && (token || connectionString)) {
      set({
        isLoggedIn: true,
        token,
        connectionString,
        connectionUri: uri,
        user: user ? (JSON.parse(user) as LioranUser) : null,
      });
    }
  },
}));
