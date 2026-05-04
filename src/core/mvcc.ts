/**
 * MVCC (Multi-Version Concurrency Control) Layer
 * Enables concurrent reads without blocking writes
 * Each write creates new version, reads use snapshot timestamp
 */

export interface VersionedDocument<T = any> {
  _id: string;
  data: T;
  version: number;
  createdAt: number; // timestamp when version created
  deletedAt?: number; // timestamp if document deleted
}

export interface VersionSnapshot {
  timestamp: number;
  readVersion: number;
  transactionId?: string;
}

export type IsolationLevel = "serializable" | "snapshot" | "read-committed";

/**
 * MVCC Transaction Context
 * Provides consistent view of data at specific point in time
 */
export class MVCCSnapshot {
  readonly timestamp: number;
  readonly readVersion: number;
  readonly txnId: string;
  private committed = false;
  private dirtyReads = new Map<string, any>();

  constructor(timestamp: number, readVersion: number, txnId: string) {
    this.timestamp = timestamp;
    this.readVersion = readVersion;
    this.txnId = txnId;
  }

  /**
   * Mark transaction as committed
   */
  commit(): void {
    if (this.committed) {
      throw new Error("Transaction already committed");
    }
    this.committed = true;
  }

  /**
   * Check if transaction is still valid
   */
  isValid(): boolean {
    return !this.committed;
  }

  /**
   * Store dirty read during transaction
   */
  setDirtyRead(documentId: string, value: any): void {
    if (!this.isValid()) {
      throw new Error("Cannot write to committed transaction");
    }
    this.dirtyReads.set(documentId, value);
  }

  /**
   * Get dirty read if exists
   */
  getDirtyRead(documentId: string): any {
    return this.dirtyReads.get(documentId);
  }

  /**
   * Check if document was modified in this transaction
   */
  hasDirtyRead(documentId: string): boolean {
    return this.dirtyReads.has(documentId);
  }

  /**
   * Get all dirty writes
   */
  getDirtyWrites(): Map<string, any> {
    return new Map(this.dirtyReads);
  }
}

/**
 * Version Manager
 * Maintains version chains for each document
 */
export class MVCCVersionManager {
  private versions = new Map<string, VersionedDocument[]>();
  private readVersionCounter = 0;
  private writeVersionCounter = 0;
  private minActiveVersion = 0;
  private maxVersionsPerDoc = 10; // Keep recent versions only

  constructor(maxVersionsPerDoc = 10) {
    this.maxVersionsPerDoc = maxVersionsPerDoc;
  }

  /**
   * Get current read version number
   */
  getCurrentReadVersion(): number {
    return this.readVersionCounter;
  }

  /**
   * Get next write version number
   */
  getNextWriteVersion(): number {
    return ++this.writeVersionCounter;
  }

  /**
   * Store new version of document
   */
  storeVersion<T>(documentId: string, data: T, version: number, deletedAt?: number): void {
    if (!this.versions.has(documentId)) {
      this.versions.set(documentId, []);
    }

    const chain = this.versions.get(documentId)!;
    chain.push({
      _id: documentId,
      data,
      version,
      createdAt: Date.now(),
      deletedAt
    });

    // Keep only recent versions
    if (chain.length > this.maxVersionsPerDoc) {
      chain.shift();
    }
  }

  /**
   * Get version of document visible at given read version
   */
  getVersion<T>(documentId: string, readVersion: number): VersionedDocument<T> | null {
    const chain = this.versions.get(documentId);
    if (!chain) return null;

    // Find the latest version <= readVersion
    for (let i = chain.length - 1; i >= 0; i--) {
      const doc = chain[i];
      if (doc.version <= readVersion && (!doc.deletedAt || doc.deletedAt > readVersion)) {
        return doc;
      }
    }

    return null;
  }

  /**
   * Get all versions of document
   */
  getVersionChain(documentId: string): VersionedDocument[] {
    return this.versions.get(documentId) ?? [];
  }

  /**
   * Mark a version as minimum active (cleanup older versions)
   */
  setMinActiveVersion(version: number): void {
    this.minActiveVersion = Math.max(this.minActiveVersion, version);
    this.pruneOldVersions();
  }

  /**
   * Clean up versions older than minimum active
   */
  private pruneOldVersions(): void {
    for (const [docId, chain] of this.versions) {
      const filtered = chain.filter(v => v.version >= this.minActiveVersion);
      if (filtered.length === 0) {
        this.versions.delete(docId);
      } else {
        this.versions.set(docId, filtered);
      }
    }
  }

  /**
   * Clear all versions (careful - only for tests/reset)
   */
  clear(): void {
    this.versions.clear();
    this.readVersionCounter = 0;
    this.writeVersionCounter = 0;
    this.minActiveVersion = 0;
  }

  /**
   * Get memory usage estimate
   */
  getMemoryStats(): { documentCount: number; versionCount: number } {
    let versionCount = 0;
    for (const chain of this.versions.values()) {
      versionCount += chain.length;
    }
    return {
      documentCount: this.versions.size,
      versionCount
    };
  }
}

/**
 * MVCC Transaction Manager
 * Manages snapshots and transaction visibility
 */
export class MVCCTransactionManager {
  private versionManager: MVCCVersionManager;
  private activeTransactions = new Map<string, MVCCSnapshot>();
  private transactionCounter = 0;
  private isolationLevel: IsolationLevel = "snapshot";

  constructor(versionManager: MVCCVersionManager, isolationLevel: IsolationLevel = "snapshot") {
    this.versionManager = versionManager;
    this.isolationLevel = isolationLevel;
  }

  /**
   * Start new transaction
   */
  beginTransaction(isolationLevel?: IsolationLevel): MVCCSnapshot {
    const txnId = `txn-${++this.transactionCounter}-${Date.now()}`;
    const timestamp = Date.now();
    const readVersion = this.versionManager.getCurrentReadVersion();

    const snapshot = new MVCCSnapshot(timestamp, readVersion, txnId);
    this.activeTransactions.set(txnId, snapshot);

    return snapshot;
  }

  /**
   * Commit transaction
   */
  commitTransaction(snapshot: MVCCSnapshot): void {
    if (!this.activeTransactions.has(snapshot.txnId)) {
      throw new Error("Transaction not found");
    }

    snapshot.commit();
    this.activeTransactions.delete(snapshot.txnId);

    // Cleanup old versions when safe
    const minVersion = Math.min(
      ...Array.from(this.activeTransactions.values()).map(s => s.readVersion)
    );
    if (minVersion > 0) {
      this.versionManager.setMinActiveVersion(minVersion);
    }
  }

  /**
   * Abort transaction
   */
  abortTransaction(snapshot: MVCCSnapshot): void {
    this.activeTransactions.delete(snapshot.txnId);
  }

  /**
   * Get all active transactions
   */
  getActiveTransactions(): MVCCSnapshot[] {
    return Array.from(this.activeTransactions.values());
  }

  /**
   * Check if snapshot is still valid
   */
  isSnapshotValid(snapshot: MVCCSnapshot): boolean {
    return this.activeTransactions.has(snapshot.txnId) && snapshot.isValid();
  }
}

/**
 * MVCC Helper for document reading at specific version
 */
export interface MVCCReadContext {
  snapshot: MVCCSnapshot;
  versionManager: MVCCVersionManager;
}

export function readDocumentAtVersion<T>(
  context: MVCCReadContext,
  documentId: string
): T | null {
  const versioned = context.versionManager.getVersion<T>(
    documentId,
    context.snapshot.readVersion
  );

  if (!versioned) return null;
  if (versioned.deletedAt) return null; // Document was deleted

  return versioned.data;
}

export function getAllDocumentsAtVersion<T>(
  context: MVCCReadContext,
  documentIds: string[]
): T[] {
  const results: T[] = [];
  for (const docId of documentIds) {
    const doc = readDocumentAtVersion<T>(context, docId);
    if (doc !== null) {
      results.push(doc);
    }
  }
  return results;
}
