export interface ConnectionConfig {
  uri: string;
  username: string;
  host: string;
  port: number;
}

export interface AuthState {
  isLoggedIn: boolean;
  token: string | null;
  connectionUri: string | null;
  error: string | null;
  isLoading: boolean;
}

export interface Database {
  name: string;
  sizeOnDisk?: number;
  empty?: boolean;
}

export interface Collection {
  name: string;
  type?: string;
  count?: number;
}

export interface Document {
  _id?: string | Record<string, any>;
  [key: string]: any;
}

export interface StoredDocument extends Document {
  _id: string | Record<string, any>;
}

export interface QueryResult {
  data: Document[];
  count: number;
  executionTime: number;
}

export interface StoreState {
  // Auth
  isLoggedIn: boolean;
  token: string | null;
  connectionUri: string | null;
  
  // Navigation
  currentDatabase: string | null;
  selectedCollection: string | null;
  
  // Data
  databases: Database[];
  collections: Record<string, Collection[]>;
  documents: Document[];
  queryResults: QueryResult | null;
  
  // UI State
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;
}
