/* ============================= MANAGER OPTIONS ============================= */

export interface LioranManagerOptions {
  rootPath?: string;
  encryptionKey?: string | Buffer;
  ipc?: boolean;
  /**
   * Optional override for how many CPU cores to use for worker-thread pools.
   */
  cores?: number;

  /**
   * Global cache configuration (defaults to enabled, 512MB max RAM).
   */
  cache?: {
    enabled?: boolean;
    maxRAMMB?: number;
    decay?: {
      intervalMs?: number;
      multiplier?: number;
    };
    partitions?: {
      query?: number;  // default 0.7
      docs?: number;   // default 0.2
      index?: number;  // default 0.1
    };
  };

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

export interface FindOptions {
  limit?: number;
  offset?: number;
  /**
   * Cursor for pagination. Semantics depend on query shape:
   * - `find({})`: cursor is the last seen `_id` (primary key).
   * - `find({_id: {$gt|$gte|$lt|$lte: ...}})`: cursor can also be expressed via the query itself.
   */
  cursor?: string;
  projection?: string[];
}

export type AggregationStage =
  | { $match: Query<any> }
  | { $group: Record<string, any> }
  | { $project: string[] | Record<string, any> }
  | { $limit: number }
  | { $skip: number };

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
  usedFullScan?: boolean;
  candidateDocuments?: number;
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
  find(query?: Query<T>, options?: FindOptions): Promise<T[]>;
  findOne(query?: Query<T>, options?: FindOptions): Promise<T | null>;
  aggregate(pipeline: AggregationStage[]): Promise<any[]>;
  explain(query?: Query<T>, options?: FindOptions): Promise<QueryExplainPlan>;
}

/* =============================== DATABASE ================================= */

export interface DatabaseIndexAPI {
  rebuildAllIndexes(): Promise<void>;
}

export interface DatabaseQueryAPI {
  explain(
    collection: string,
    query?: Query<any>,
    options?: FindOptions
  ): Promise<QueryExplainPlan>;
}

export interface DatabaseSecurityAPI {
  rotateEncryptionKey(newKey: string | Buffer): Promise<void>;
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
