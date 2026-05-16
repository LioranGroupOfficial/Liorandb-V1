export type LioranRole = "super_admin" | "admin" | "user";
// Server uses `authType: "connection"` for x-liorandb-connection-string auth.
// Keep `connection_string` for backward compatibility with older clients/docs.
export type LioranAuthType = "jwt" | "connection" | "connection_string";

export interface LioranUser {
  userId: string;
  username: string;
  role: LioranRole;
  authType: LioranAuthType;
  databaseName?: string;
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
  /**
   * Convenience alternative to `sort` for single-field sorts.
   * If `sort` is provided, it takes precedence.
   */
  sortBy?: string;
  /**
   * Direction for `sortBy`. Defaults to ascending.
   * Accepts: "asc" | "desc" | 1 | -1 (and stringified numbers).
   */
  sortDir?: "asc" | "desc" | 1 | -1 | "1" | "-1";
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
  type: "btree" | "text";
  unique: boolean;
  persisted: boolean;
  textOptions?: Record<string, any>;
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
  type: "btree" | "text";
  unique?: boolean;
  options?: Record<string, any>;
}

export interface LioranDropIndexResponse {
  ok: true;
  collection: string;
  field: string;
  type?: "btree" | "text";
}

export interface LioranRebuildAllIndexesResponse {
  ok: true;
  collection: string;
  rebuilt: number;
}

export type LioranCollectionDateOption = boolean | "yes" | Record<string, any> | undefined;

export interface LioranCollectionOptions {
  date?: LioranCollectionDateOption;
}

export interface LioranCollectionOptionsResponse {
  ok: true;
  collection: string;
  options: LioranCollectionOptions;
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

export interface LioranMaintenanceStopResponse {
  ok: true;
  shuttingDown: true;
}

export interface LioranMaintenancePauseResponse {
  ok: true;
  paused: boolean;
  already?: boolean;
}

export interface LioranMaintenanceResumeResponse {
  ok: true;
  paused: boolean;
  already?: boolean;
}

export interface LioranMaintenanceRestoreResponse {
  ok: true;
  restoring: true;
  snapshotPath: string;
}

export interface LioranCoreStatusResponse {
  ok: true;
  paused: boolean;
  paths: {
    baseFolder: string | null;
    rootPath: string | null;
  };
  ipc: {
    primary: boolean | null;
    client: boolean | null;
    readonly: boolean | null;
  };
  cluster: {
    nodeCount: number | null;
    managers: number | null;
    enabled: boolean;
    leader: { host: string; clientPort: number } | null;
  };
  advanced: {
    replicationEnabled: boolean;
    consistency: unknown | null;
    tenancy: unknown | null;
    security: unknown | null;
  };
}

export interface LioranCoreIpcResponse {
  ok: true;
  mode: {
    primary: boolean | null;
    client: boolean | null;
    readonly: boolean | null;
  };
}

export interface LioranCoreManagersResponse {
  ok: true;
  managers: Array<{
    index: number;
    primary: boolean | null;
    client: boolean | null;
    readonly: boolean | null;
  }>;
}

export interface LioranCoreDatabasesResponse {
  ok: true;
  databases: string[];
}

export interface LioranCoreDatabaseStatusResponse {
  ok: true;
  db: string;
  schemaVersion: string | null;
  meta: unknown | null;
}

export interface LioranDbSchemaVersionResponse {
  ok: true;
  db: string;
  schemaVersion: string | null;
}

export type LioranDbMigrationAction =
  | {
      type: "createIndex";
      collection: string;
      field: string;
      options?: { unique?: boolean };
    }
  | {
      type: "createTextIndex";
      collection: string;
      field: string;
      options?: Record<string, any>;
    }
  | { type: "compactCollection"; collection: string }
  | { type: "compactAll" }
  | { type: "renameCollection"; from: string; to: string };

export interface LioranDbMigrationStep {
  from: string;
  to: string;
  actions: LioranDbMigrationAction[];
}

export interface LioranApplyDbMigrationsResponse {
  ok: true;
  db: string;
  schemaVersion: string | null;
}

export interface LioranRotateEncryptionKeyResponse {
  ok: true;
  db: string;
}

export type LioranInsertManyStreamResponse<T extends DocumentData = DocumentData> =
  | { ok: true; result: number }
  | { ok: true; docs: Array<T & { _id: string }> };

export interface LioranCollectionDocMigrationStep {
  from: number;
  to: number;
  steps: Array<Record<string, any>>;
}

export interface LioranCollectionDocMigrationsConfig {
  enabled: boolean;
  currentVersion: number;
  writeBackOnRead: boolean;
  migrations: LioranCollectionDocMigrationStep[];
}

export interface LioranGetCollectionMigrationsResponse {
  ok: true;
  db: string;
  collection: string;
  config: LioranCollectionDocMigrationsConfig | null;
}

export interface LioranPutCollectionMigrationsResponse {
  ok: true;
  db: string;
  collection: string;
  config: LioranCollectionDocMigrationsConfig | null;
}

export interface LioranTestCollectionMigrationResponse {
  ok: true;
  db: string;
  collection: string;
  doc: any;
  migrated?: boolean;
  fromVersion?: number;
  toVersion?: number;
}
