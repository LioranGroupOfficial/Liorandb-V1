export type LioranRole = "super_admin" | "admin" | "user";
export type LioranAuthType = "jwt" | "connection_string";

export interface LioranUser {
  userId: string;
  username: string;
  role: LioranRole;
  authType: LioranAuthType;
  externalUserId?: string | null;
}

export interface LioranManagedUser extends LioranUser {
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  passwordEnabled?: boolean;
}

export interface LioranAuthResponse {
  user: LioranUser;
  token: string | null;
  secretBacked?: boolean;
}

export interface LioranMeResponse {
  user: LioranUser;
}

export interface LioranUsersResponse {
  users: LioranManagedUser[];
}

export interface LioranIssueUserTokenResponse {
  user: LioranManagedUser;
  token: string;
}

export interface LioranCorsUpdateResponse {
  ok: true;
  userId: string;
  corsOrigins: string[];
}

export interface LioranHealthResponse {
  ok: true;
  time: string;
}

export interface LioranHostInfoResponse {
  name: string;
  role: string;
  status: string;
}

export interface LioranManagedDatabase {
  ownerUserId?: string;
  ownerRole?: LioranRole;
  requestedName?: string;
  databaseName: string;
  createdAt?: string;
  updatedAt?: string;
  credentialsConfigured?: boolean;
  dbUsername?: string | null;
  connectionString?: string | null;
}

export interface LioranDatabaseListResponse {
  databases: LioranManagedDatabase[];
}

export interface LioranDatabaseCountResponse {
  userId?: string;
  count: number;
}

export interface LioranDatabaseUserListResponse {
  userId: string;
  count: number;
  databases: LioranManagedDatabase[];
}

export interface LioranDatabaseMutationResponse {
  ok: boolean;
  database: LioranManagedDatabase;
}

export interface LioranDeleteResponse {
  ok: boolean;
}

export interface LioranRenameResponse {
  ok: true;
  old: string;
  new: string;
}

export interface LioranDatabaseStats {
  name: string;
  collections: number;
  documents: number;
}

export interface LioranDatabaseCredentials {
  databaseName: string;
  ownerUserId?: string;
  username: string;
  password: string;
  connectionString: string;
}

export interface LioranDatabaseCredentialsResponse extends LioranDatabaseCredentials {}

export interface LioranDatabaseCredentialsMutationResponse {
  ok: true;
  credentials: LioranDatabaseCredentials;
}

export interface LioranDatabaseConnectionStringResponse {
  databaseName: string;
  connectionString: string;
}

export interface LioranCollectionListResponse {
  collections: string[];
}

export interface LioranCollectionMutationResponse {
  ok: boolean;
  collection: string;
}

export interface LioranCollectionStats {
  name: string;
  documents: number;
}

export interface LioranInsertOneResponse<T extends DocumentData> {
  ok: true;
  doc: T & { _id: string };
}

export interface LioranInsertManyResponse<T extends DocumentData> {
  ok: true;
  docs: Array<T & { _id: string }>;
}

export interface LioranFindOptions {
  limit?: number;
  offset?: number;
  projection?: string[];
  sort?: Record<string, 1 | -1>;
}

export interface LioranFindResponse<T extends DocumentData> {
  results: Array<T & { _id?: string }>;
}

export interface LioranFindOneResponse<T extends DocumentData> {
  doc: (T & { _id?: string }) | null;
}

export interface LioranAggregateResponse<R = unknown> {
  results: R[];
}

export interface LioranExplainPlan {
  indexUsed: string | null;
  [key: string]: unknown;
}

export interface LioranExplainResponse {
  explain: LioranExplainPlan;
}

export interface LioranUpdateOneOptions {
  upsert?: boolean;
}

export interface LioranUpdateOneResponse<T extends DocumentData = DocumentData> {
  ok: true;
  doc: (T & { _id?: string }) | null;
}

export interface LioranUpdateManyResponse<T extends DocumentData = DocumentData> {
  updated: number;
  docs: Array<T & { _id?: string }>;
}

export interface LioranDeleteOneResponse<T extends DocumentData = DocumentData> {
  ok: true;
  doc: (T & { _id?: string }) | null;
}

export interface LioranDeleteManyResponse {
  deleted: number;
}

export interface LioranCountResponse {
  count: number;
}

export interface DocumentData {
  _id?: string;
  [key: string]: any;
}

export type Filter = Record<string, any>;

export type UpdateQuery = {
  $set?: Record<string, any>;
  $inc?: Record<string, number>;
  $unset?: Record<string, boolean>;
  [key: string]: any;
};

export interface LioranIndexEntry {
  field: string;
  unique: boolean;
  persisted: boolean;
}

export interface LioranListIndexesResponse {
  ok: true;
  collection: string;
  indexes: LioranIndexEntry[];
}

export interface LioranCreateIndexResponse {
  ok: true;
  collection: string;
  field: string;
  unique: boolean;
}

export interface LioranDropIndexResponse {
  ok: true;
  collection: string;
  field: string;
}

export interface LioranRebuildAllIndexesResponse {
  ok: true;
  collection: string;
  rebuilt: number;
}

export interface LioranCompactCollectionResponse {
  ok: true;
  db: string;
  collection: string;
}

export interface LioranCompactDatabaseResponse {
  ok: true;
  db: string;
}

export interface LioranTransactionResponse<R = any> {
  ok: true;
  result: R;
}

export interface LioranMaintenanceCompactAllResponse {
  ok: true;
  databases: number;
}

export interface LioranDocsIndexEntry {
  id: string;
  title: string;
}

export interface LioranDocsListResponse {
  ok: true;
  docs: LioranDocsIndexEntry[];
}

export interface LioranDocResponse {
  ok: true;
  id: string;
  title: string;
  content: string;
}

export interface LioranSnapshotFile {
  name: string;
  path: string;
  mtimeMs: number;
  size: number;
}

export interface LioranMaintenanceStatusResponse {
  ok: true;
  snapshots: {
    enabled: boolean;
    intervalMs: number;
    dir: string;
    retentionHours: number;
    running: boolean;
  };
}

export interface LioranMaintenanceSnapshotsResponse {
  ok: true;
  snapshots: LioranSnapshotFile[];
}

export interface LioranMaintenanceCreateSnapshotResponse {
  ok: true;
  snapshot: {
    ok: true;
    path: string;
    reason: string;
  };
}
