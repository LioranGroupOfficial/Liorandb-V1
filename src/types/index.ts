/* ----------------------------- MANAGER OPTIONS ----------------------------- */

export interface LioranManagerOptions {
  rootPath?: string
  encryptionKey?: string | Buffer
  ipc?: boolean
}

/* ----------------------------- UPDATE OPTIONS ----------------------------- */

export interface UpdateOptions {
  upsert?: boolean
}

/* --------------------------------- QUERY --------------------------------- */

export type Query<T = any> = Partial<T> & {
  [key: string]: any
}

/* --------------------------------- INDEX --------------------------------- */

export type IndexType = "hash" | "btree"

export interface IndexDefinition<T = any> {
  field: keyof T | string
  unique?: boolean
  sparse?: boolean
  type?: IndexType
}

export interface IndexMetadata {
  field: string
  unique: boolean
  sparse: boolean
  type: IndexType
  createdAt: number
}

/* ----------------------------- QUERY PLANNER ------------------------------ */

export interface QueryExplainPlan {
  indexUsed?: string
  indexType?: IndexType
  scannedDocuments: number
  returnedDocuments: number
  executionTimeMs: number
}

/* ------------------------------ COLLECTION -------------------------------- */

export interface CollectionIndexAPI<T = any> {
  createIndex(def: IndexDefinition<T>): Promise<void>
  dropIndex(field: keyof T | string): Promise<void>
  listIndexes(): Promise<IndexMetadata[]>
  rebuildIndexes(): Promise<void>
}

/* ------------------------------- DATABASE --------------------------------- */

export interface DatabaseIndexAPI {
  rebuildAllIndexes(): Promise<void>
}