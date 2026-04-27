export interface ConnectionConfig {
  uri: string;
  username?: string;
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'lioran' | 'liorandb';
  databaseName?: string;
}

export type LioranRole = 'super_admin' | 'admin' | 'user';
export type LioranAuthType = 'jwt' | 'connection_string';

export interface LioranUser {
  userId: string;
  username: string;
  role: LioranRole;
  authType: LioranAuthType;
  externalUserId?: string | null;
}

export interface AuthState {
  isLoggedIn: boolean;
  token: string | null;
  connectionString: string | null;
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
  mode: 'find' | 'aggregate';
  data: Document[];
  count: number;
  executionTime: number;
  query: Record<string, unknown> | unknown[];
}

export interface StoreState {
  isLoggedIn: boolean;
  token: string | null;
  connectionString: string | null;
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
