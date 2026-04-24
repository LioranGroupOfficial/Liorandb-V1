export interface ConnectionConfig {
  uri: string;
  username?: string;
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'lioran' | 'liorandb';
}

export interface LioranUser {
  id: string;
  username: string;
}

export interface AuthState {
  isLoggedIn: boolean;
  token: string | null;
  connectionUri: string | null;
  user: LioranUser | null;
  error: string | null;
  isLoading: boolean;
}

export interface Database {
  name: string;
  collections?: number;
  documents?: number;
}

export interface Collection {
  name: string;
  count?: number;
}

export interface Document {
  _id?: string;
  [key: string]: unknown;
}

export interface StoredDocument extends Document {
  _id: string;
}

export interface QueryResult {
  data: Document[];
  count: number;
  executionTime: number;
  filter: Record<string, unknown>;
}

export interface StoreState {
  isLoggedIn: boolean;
  token: string | null;
  connectionUri: string | null;
  user: LioranUser | null;
  currentDatabase: string | null;
  selectedCollection: string | null;
  databases: Database[];
  collections: Record<string, Collection[]>;
  documents: Document[];
  queryResults: QueryResult | null;
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;
}
