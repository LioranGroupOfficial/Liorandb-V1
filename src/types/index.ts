/* ============================= MANAGER OPTIONS ============================= */

export interface LioranManagerOptions {
  rootPath?: string;
  encryptionKey?: string | Buffer;
  ipc?: boolean;

  /**
   * If true, database auto-applies pending migrations on startup.
   */
  autoMigrate?: boolean;
}

/* ============================= UPDATE OPTIONS ============================= */

export interface UpdateOptions {
  upsert?: boolean;

  /**
   * If true, returns the modified document instead of the original.
   */
  returnNew?: boolean;
}

/* ================================ QUERY =================================== */

export type Query<T = any> =
  | Partial<T>
  | {
      [K in keyof T]?: any;
    } & {
      [key: string]: any;
    };

/* ================================ INDEX =================================== */

export type IndexType = "hash" | "btree";

export interface IndexDefinition<T = any> {
  field: keyof T | string;
  unique?: boolean;
  sparse?: boolean;
  type?: IndexType;
}

export interface IndexMetadata {
  field: string;
  unique: boolean;
  sparse: boolean;
  type: IndexType;
  createdAt: number;
}

/* =========================== QUERY PLANNER ================================ */

export interface QueryExplainPlan {
  indexUsed?: string;
  indexType?: IndexType;
  scannedDocuments: number;
  returnedDocuments: number;
  executionTimeMs: number;
}

/* ========================== SCHEMA VERSIONING ============================= */

/**
 * Per-collection document schema version
 */
export type SchemaVersion = number;

/**
 * Collection-level migration definition
 */
export interface CollectionMigration<T = any> {
  from: SchemaVersion;
  to: SchemaVersion;
  migrate: (doc: any) => T;
}

/**
 * Database-level migration definition
 */
export interface DatabaseMigration {
  from: string;
  to: string;
  migrate: () => Promise<void>;
}

/* ============================== COLLECTION ================================ */

export interface CollectionOptions<T = any> {
  /**
   * Zod schema used for validation
   */
  schema?: any;

  /**
   * Current document schema version
   */
  schemaVersion?: SchemaVersion;

  /**
   * Optional migrations for automatic document upgrading
   */
  migrations?: CollectionMigration<T>[];
}

export interface CollectionIndexAPI<T = any> {
  createIndex(def: IndexDefinition<T>): Promise<void>;
  dropIndex(field: keyof T | string): Promise<void>;
  listIndexes(): Promise<IndexMetadata[]>;
  rebuildIndexes(): Promise<void>;
}

export interface CollectionQueryAPI<T = any> {
  count(): Promise<number>;
  countDocuments(filter?: Query<T>): Promise<number>;
}

/* =============================== DATABASE ================================= */

export interface DatabaseIndexAPI {
  rebuildAllIndexes(): Promise<void>;
}

/**
 * Database migration coordination API
 */
export interface DatabaseMigrationAPI {
  migrate(
    from: string,
    to: string,
    fn: () => Promise<void>
  ): void;

  applyMigrations(targetVersion: string): Promise<void>;

  getSchemaVersion(): string;

  setSchemaVersion(version: string): void;
}
