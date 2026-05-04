import path from "path";
import fs from "fs";
import { Collection } from "./collection.js";
import { Index, TextIndex, IndexOptions, type TextIndexOptions } from "./index.js";
import { MigrationEngine } from "./migration.js";
import type { LioranManager } from "../LioranManager.js";
import type { ZodSchema } from "zod";
import {
  decryptData,
  deriveEncryptionKey,
  getEncryptionKey,
  setEncryptionKey
} from "../utils/encryption.js";

import { WALManager, type WALDurabilityOptions } from "./wal.js";
import { CheckpointManager } from "./checkpoint.js";
import { DedicatedWriter, type WriterQueueOptions } from "./writer.js";
import { LiorandbError, asLiorandbError, withLiorandbErrorSync } from "../utils/errors.js";
import type { WALRecord } from "./wal.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { TieredStorageOptions } from "./blobstore.js";
import { ShardedCollection } from "../sharding/shardedCollection.js";
import { shardForId } from "../sharding/hash.js";
import { withLatencyBudget } from "../utils/latency.js";

/* ----------------------------- TYPES ----------------------------- */

type TXOp = { tx: number; col: string; op: string; args: any[] };

type IndexMeta = {
  field: string;
  options: IndexOptions;
  type?: "btree" | "text";
  textOptions?: TextIndexOptions;
};

type DBMeta = {
  version: number;
  indexes: Record<string, IndexMeta[]>;
  schemaVersion: string;
};

const META_FILE = "__db_meta.json";
const META_VERSION = 2;
const DEFAULT_SCHEMA_VERSION = "v1";
const COLLECTION_META_KEY_PREFIX = "\u0000__meta__:";
const DB_META_COL = "\u0000__db__";

export type LioranDBRuntimeOptions = {
  writeQueue?: Omit<WriterQueueOptions, "memoryPressure"> & {
    memoryPressure?: WriterQueueOptions["memoryPressure"];
  };
  durability?: {
    level?: "journaled" | "wal" | "async" | "none";
    wal?: WALDurabilityOptions;
  };
  batch?: {
    chunkSize?: number;
  };
  recovery?: {
    untilTimeMs?: number;
  };
  storage?: {
    /**
     * classic-level ships with a Bloom filter enabled by default (10 bits/key).
     * This option is reserved for future tuning without native rebuilds.
     */
    bloomFilterBits?: number;
    /**
     * Reserved for future: platform-specific mmap tuning for underlying storage.
     */
    mmapReads?: boolean;
    leveldb?: {
      writeBufferSize?: number;
      cacheSize?: number;
      blockSize?: number;
      maxOpenFiles?: number;
      compression?: boolean;
    };
    adaptiveCompaction?: {
      enabled?: boolean;
      /**
       * If writes per minute exceeds this threshold, run aggressive compaction on next tick.
       */
      writeOpsPerMin?: number;
      /**
       * If avg scanned/returned exceeds this threshold, run aggressive compaction on next tick.
       */
      readAmplificationThreshold?: number;
      /**
       * Minimum time between adaptive aggressive runs.
       */
      minAggressiveIntervalMs?: number;
    };
  };
  latency?: {
    enabled?: boolean;
    readBudgetMs?: number;
    writeBudgetMs?: number;
    walAppendBudgetMs?: number;
    onViolation?: import("../utils/latency.js").LatencyViolationMode;
  };
  background?: {
    enabled?: boolean;
  };
  sharding?: {
    enabled?: boolean;
    shards: number;
    /**
     * Optional physical collection name prefix/suffix marker.
     * Defaults to `__shard__`.
     */
    marker?: string;
  };
};

/* ---------------------- TRANSACTION CONTEXT ---------------------- */

class DBTransactionContext {
  private ops: TXOp[] = [];
  private aborted = false;

  constructor(
    private db: LioranDB,
    public readonly txId: number
  ) {}

  collection(name: string) {
    const col = this.db.collection(name);
    const readMethods = new Set(["find", "findOne", "aggregate", "explain", "countDocuments", "count"]);

    const marker = (this.db as any).runtimeOptions?.sharding?.marker ?? "__shard__";
    const shardCount = (this.db as any).runtimeOptions?.sharding?.enabled === false
      ? 1
      : Math.max(1, Math.trunc((this.db as any).runtimeOptions?.sharding?.shards ?? 1));

    return new Proxy(col as any, {
      get: (target, prop: string) => {
        if (typeof target[prop] !== "function") return target[prop];

        if (readMethods.has(prop)) {
          return (...args: any[]) => (target as any)[prop](...args);
        }

        return (...args: any[]) => {
          const pushOp = (colName: string, opName: string, opArgs: any[]) => {
            this.ops.push({ tx: this.txId, col: colName, op: opName, args: opArgs });
          };

          if (shardCount > 1 && !name.includes(marker)) {
            // Best-effort shard routing for transactional writes.
            const opName = String(prop);
            if (opName === "insertOne") {
              const doc = args[0];
              const sid = shardForId(doc?._id, shardCount);
              pushOp(`${name}${marker}${sid}`, opName, args);
              return;
            }
            if (opName === "insertMany") {
              const docs = Array.isArray(args[0]) ? args[0] : [];
              const buckets = new Map<number, any[]>();
              for (const d of docs) {
                const sid = shardForId(d?._id, shardCount);
                const arr = buckets.get(sid) ?? [];
                arr.push(d);
                buckets.set(sid, arr);
              }
              for (const [sid, chunk] of buckets.entries()) {
                pushOp(`${name}${marker}${sid}`, opName, [chunk, ...args.slice(1)]);
              }
              return;
            }
            if (opName === "updateOne" || opName === "replaceOne" || opName === "deleteOne") {
              const filter = args[0];
              const sid = shardForId(filter?._id, shardCount);
              pushOp(`${name}${marker}${sid}`, opName, args);
              return;
            }

            // Fallback: force shard-0 for unrecognized writes so apply path always targets a physical collection.
            pushOp(`${name}${marker}0`, opName, args);
            return;
          }

          pushOp(name, String(prop), args);
        };
      }
    });
  }

  async commit() {
    if (this.db.isReadonly()) {
      throw new LiorandbError("READONLY_MODE", "Cannot commit transaction in readonly mode");
    }

    if (this.aborted) {
      throw new LiorandbError("TRANSACTION_ABORTED", "Transaction aborted");
    }

    await this.db._commitTransaction(this.txId, this.ops);
  }

  abort() {
    this.aborted = true;
    this.ops.length = 0;
    throw new LiorandbError("TRANSACTION_ABORTED", "Transaction aborted");
  }
}

/* ----------------------------- DATABASE ----------------------------- */

export class LioranDB {
  basePath: string;
  dbName: string;
  manager: LioranManager;
  collections: Map<string, any>;

  private metaPath: string;
  private meta!: DBMeta;

  private migrator: MigrationEngine;
  private static TX_SEQ = 0;

  public wal!: WALManager;
  private checkpoint!: CheckpointManager;
  private writer!: DedicatedWriter;
  private writerContext = new AsyncLocalStorage<boolean>();
  private runtimeOptions: LioranDBRuntimeOptions;
  private lastBackpressureLogAt = 0;
  private idIndexEnsureScheduled = new Set<string>();
  private pendingIdIndexEnsure = new Set<string>();

  private maintenanceInterval?: NodeJS.Timeout;
  private maintenanceRunning = false;
  private lastFullCompactionAt = 0;
  private lastAdaptiveAggressiveAt = 0;
  private writesSinceMaintenance = 0;
  private maintenanceWindowStartedAt = Date.now();
  private readAmpSum = 0;
  private readAmpCount = 0;
  private maintenanceStats = {
    lightCompactions: 0,
    fullCompactions: 0,
    lastDurationMs: 0,
    lastErrorAt: 0
  };
  private closed = false;

  private readonly readonlyMode: boolean;
  private readonly replicaMode: boolean;
  public readonly ready: Promise<void>;

  private async _runInWriter<R>(task: () => Promise<R>): Promise<R> {
    if (this.writerContext.getStore()) {
      return task();
    }

    return this.writer.run(() => this.writerContext.run(true, task));
  }

  constructor(
    basePath: string,
    dbName: string,
    manager: LioranManager,
    options: LioranDBRuntimeOptions = {}
  ) {
    this.basePath = basePath;
    this.dbName = dbName;
    this.manager = manager;
    this.collections = new Map();
    this.runtimeOptions = options;

    // Ensure metrics bucket exists (no-op if metrics not present).
    try { (this.manager as any)?.metrics?.snapshot?.(this.dbName); } catch {}

    this.readonlyMode = (manager as any)?.isReadonly?.() ?? false;
    this.replicaMode = (manager as any)?.isReplica?.() ?? false;

    this.metaPath = path.join(basePath, META_FILE);

    try {
      fs.mkdirSync(basePath, { recursive: true });

      this.loadMeta();

      if (!this.readonlyMode) {
        this.wal = new WALManager(basePath, {
          durability: {
            ...(options.durability?.wal ?? {}),
            flushStrategy: options.durability?.wal?.flushStrategy ?? "batch"
          }
        });
        this.checkpoint = new CheckpointManager(basePath);
        const userPressure = options.writeQueue?.memoryPressure;
        this.writer = new DedicatedWriter({
          ...(options.writeQueue ?? {}),
          memoryPressure: {
            ...(options.writeQueue?.memoryPressure ?? {}),
            onPressureStart: info => {
              userPressure?.onPressureStart?.(info);
              console.warn(
                `[LioranDB] Memory pressure start: rssMB=${info.rssMB.toFixed(1)} ratio=${info.ratio.toFixed(3)} db=${this.dbName}`
              );
            },
            onPressureEnd: info => {
              userPressure?.onPressureEnd?.(info);
              console.warn(
                `[LioranDB] Memory pressure end: rssMB=${info.rssMB.toFixed(1)} ratio=${info.ratio.toFixed(3)} db=${this.dbName}`
              );
            }
          },
          onBackpressure: info => {
            const now = Date.now();
            if (now - this.lastBackpressureLogAt < 1000) return;
            this.lastBackpressureLogAt = now;

            console.warn(
              `[LioranDB] Backpressure: pending=${info.pending} max=${info.maxSize} db=${this.dbName}`
            );
          }
        });
      }
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to construct database",
        details: { dbName: this.dbName, basePath: this.basePath }
      });
    }

    this.migrator = new MigrationEngine(this);

    this.ready = this.initialize();
    this.startMaintenanceScheduler();
  }

  stats() {
    return (this.manager as any)?.metrics?.snapshot?.(this.dbName) ?? {};
  }

  /* ------------------------- MODE ------------------------- */

  public isReadonly(): boolean {
    return this.readonlyMode;
  }

  private assertWritable(allowReplicaWrites = false) {
    if (this.readonlyMode) {
      throw new LiorandbError("READONLY_MODE", "Database is in readonly replica mode");
    }
    if (this.replicaMode && !allowReplicaWrites) {
      throw new LiorandbError("READONLY_MODE", "Database is in read-replica mode");
    }
  }

  /* ------------------------- INIT & RECOVERY ------------------------- */

  private async initialize() {
    try {
      if (!this.readonlyMode) {
        await this.recoverFromWAL({ untilTimeMs: this.runtimeOptions.recovery?.untilTimeMs });
        await this.ensureIdIndexesAtStartup();
      }
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Database initialization failed",
        details: { dbName: this.dbName, basePath: this.basePath }
      });
    }
  }

  private startMaintenanceScheduler() {
    if (this.readonlyMode || this.replicaMode) return;
    // If manager runs a central background scheduler, disable per-DB timer to avoid duplicate work.
    if ((this.manager as any)?.options?.background?.enabled !== false) {
      // background scheduler is manager-scoped and starts in primary mode; treat as enabled by default.
      return;
    }

    const timer = setInterval(() => {
      void this.runMaintenance().catch(() => {});
    }, 60_000);
    timer.unref?.();
    this.maintenanceInterval = timer;
  }

  /**
   * Background tick for auto index build + auto compaction.
   * Called by manager background scheduler (primary nodes only).
   */
  async backgroundTick() {
    if (this.readonlyMode || this.replicaMode) return;
    await this.ready;
    await this.ensureIndexesInBackground();
    await this.runMaintenance();
    try { (this.manager as any)?.cache?.query?.decay?.(0.95); } catch {}
    try { (this.manager as any)?.cache?.docs?.decay?.(0.95); } catch {}
    try { (this.manager as any)?.cache?.index?.decay?.(0.95); } catch {}
  }

  private async ensureIndexesInBackground() {
    if (this.readonlyMode || this.replicaMode) return;

    // Build missing index files based on metadata (best-effort).
    const collectionNames = this.getAllCollectionNames();
    const marker = this.runtimeOptions.sharding?.marker ?? "__shard__";
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shardRe = new RegExp(`${escapeRe(marker)}(\\d+)$`);

    for (const colName of collectionNames) {
      const logical = shardRe.test(colName) ? colName.replace(shardRe, "") : colName;
      const metas = this.meta.indexes[logical] ?? [];
      for (const meta of metas) {
        const type = meta.type ?? "btree";
        try {
          if (type === "text") {
            const idxDir = path.join(this.basePath, colName, "__indexes", meta.field + ".textidx");
            const hasFiles = fs.existsSync(idxDir) && fs.readdirSync(idxDir, { withFileTypes: true }).some(d => d.isFile());
            if (!hasFiles) {
              await this._createTextIndexInternal(colName, meta.field, meta.textOptions ?? {}, false);
            }
          } else {
            const idxDir = path.join(this.basePath, colName, "__indexes", meta.field + ".idx");
            const hasFiles = fs.existsSync(idxDir) && fs.readdirSync(idxDir, { withFileTypes: true }).some(d => d.isFile());
            if (!hasFiles) {
              await this._createIndexInternal(colName, meta.field, meta.options ?? {}, false);
            }
          }
        } catch {}
      }
    }
  }

  private async runMaintenance() {
    if (this.closed || this.maintenanceRunning) return;
    if (this.readonlyMode || this.replicaMode) return;

    await this.ready;

    this.maintenanceRunning = true;
    const started = Date.now();
    const isFullDue = (Date.now() - this.lastFullCompactionAt) >= 10 * 60 * 1000;

    const adaptive = this.runtimeOptions.storage?.adaptiveCompaction;
    const adaptiveEnabled = adaptive?.enabled ?? true;
    const minAggressiveIntervalMs = Math.max(5_000, Math.trunc(adaptive?.minAggressiveIntervalMs ?? 60_000));

    const windowMs = Math.max(1, Date.now() - this.maintenanceWindowStartedAt);
    const writesPerMin = (this.writesSinceMaintenance / windowMs) * 60_000;
    const writeOpsPerMin = Math.max(1, Math.trunc(adaptive?.writeOpsPerMin ?? 50_000));

    const readAmpAvg = this.readAmpCount > 0 ? this.readAmpSum / this.readAmpCount : 1;
    const readAmpThreshold = Math.max(1, Number(adaptive?.readAmplificationThreshold ?? 25));

    const adaptiveAggressiveWanted =
      adaptiveEnabled &&
      (
        writesPerMin >= writeOpsPerMin ||
        readAmpAvg >= readAmpThreshold
      ) &&
      (Date.now() - this.lastAdaptiveAggressiveAt) >= minAggressiveIntervalMs;

    const aggressive = isFullDue || adaptiveAggressiveWanted;

    try {
      await this._runInWriter(async () => {
        if (this.closed) return;

        const collectionNames = this.getAllCollectionNames();

        for (const name of collectionNames) {
          try {
            const col = this.collection(name);
            await col.compact({ aggressive } as any);
          } catch (e) {
            console.warn(`[Maintenance] Failed for collection ${name}`, e);
          }
        }

        if (aggressive && !isFullDue) this.lastAdaptiveAggressiveAt = Date.now();
        if (isFullDue) this.lastFullCompactionAt = Date.now();
      });

      const duration = Date.now() - started;
      this.maintenanceStats.lastDurationMs = duration;

      if (aggressive) this.maintenanceStats.fullCompactions++;
      else this.maintenanceStats.lightCompactions++;

      // Reset rolling window after successful maintenance.
      this.writesSinceMaintenance = 0;
      this.readAmpSum = 0;
      this.readAmpCount = 0;
      this.maintenanceWindowStartedAt = Date.now();
    } catch (err) {
      console.error("[Maintenance] Error:", err);
      this.maintenanceStats.lastErrorAt = Date.now();
    } finally {
      this.maintenanceRunning = false;
    }
  }

  private async ensureIdIndexesAtStartup(): Promise<void> {
    if (this.readonlyMode) return;

    // Ensure `_id` index is fully materialized even if no future writes occur.
    // This avoids silent uniqueness holes after a crash/restart.
    const collectionNames = this.getAllCollectionNames();

    await this._runInWriter(async () => {
      for (const name of collectionNames) {
        const colPath = path.join(this.basePath, name);
        const indexDir = path.join(colPath, "__indexes", "_id.idx");

        const hasMeta = !!this.meta.indexes[name]?.some(i => i.field === "_id" && (i.type ?? "btree") === "btree");
        const hasFiles = fs.existsSync(indexDir) && fs.readdirSync(indexDir, { withFileTypes: true }).some(d => d.isFile());

        if (!hasMeta || !hasFiles) {
          try {
            await this._createIndexInternal(name, "_id", { unique: true });
          } catch {}
        }
      }
    });
  }

  private async recoverFromWAL(options: { untilTimeMs?: number } = {}) {
    try {
      const checkpointData = this.checkpoint.get();
      const fromLSN = checkpointData.lsn;
      const untilTimeMs = options.untilTimeMs;

    const committed = new Set<number>();
    const applied = new Set<number>();
    const ops = new Map<number, TXOp[]>();
    const commitLSNByTx = new Map<number, number>();
    const commitTimeByTx = new Map<number, number>();
    let maxSeenLSN = fromLSN;

      await this.wal.replay(fromLSN, async (record) => {
      maxSeenLSN = Math.max(maxSeenLSN, record.lsn);
      if (record.type === "commit") {
        committed.add(record.tx);
        commitLSNByTx.set(record.tx, record.lsn);
        if (typeof (record as any).time === "number") {
          commitTimeByTx.set(record.tx, (record as any).time);
        }
      } else if (record.type === "applied") {
        applied.add(record.tx);
      } else if (record.type === "op") {
        if (!ops.has(record.tx)) ops.set(record.tx, []);
        ops.get(record.tx)!.push(record.payload as TXOp);
      }
      });

    let highestAppliedLSN = fromLSN;

    const txsToApply = Array.from(committed)
      .filter(tx => !applied.has(tx))
      .filter(tx => {
        if (untilTimeMs == null) return true;
        const t = commitTimeByTx.get(tx);
        // For legacy WAL (no timestamps), treat as always-applicable.
        if (t == null) return true;
        return t <= untilTimeMs;
      })
      .sort((a, b) => (commitLSNByTx.get(a) ?? 0) - (commitLSNByTx.get(b) ?? 0));

    for (const tx of txsToApply) {
      if (applied.has(tx)) continue;

      const txOps = ops.get(tx);
      if (txOps) {
        await this._applyOps(txOps);
        highestAppliedLSN = Math.max(highestAppliedLSN, maxSeenLSN);
      }
    }

      this.advanceCheckpoint(highestAppliedLSN);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "WAL recovery failed",
        details: { dbName: this.dbName, basePath: this.basePath }
      });
    }
  }

  public async replayToTimestamp(untilTimeMs: number): Promise<number> {
    if (this.readonlyMode) return this.getCheckpointLSN();

    return this._runInWriter(async () => {
      // Re-run recovery logic from current checkpoint, but stop applying commits beyond `untilTimeMs`.
      // This is intended for restored snapshots before normal startup traffic resumes.
      await this.recoverFromWAL({ untilTimeMs });
      return this.getCheckpointLSN();
    });
  }

  /* ------------------------- CHECKPOINT ADVANCE ------------------------- */

  public advanceCheckpoint(lsn: number) {
    if (this.readonlyMode) return;

    const current = this.checkpoint.get();

    if (lsn > current.lsn) {
      this.checkpoint.save(lsn, this.wal.getCurrentGen());
      this.wal.cleanup(this.wal.getCurrentGen() - 1).catch(() => {});
    }
  }

  public getCheckpointLSN(): number {
    if (this.readonlyMode) return 0;
    return this.checkpoint.get().lsn;
  }

  public async exportWAL(fromLSN: number, limit = 10_000): Promise<{ records: WALRecord[]; lastLSN: number }> {
    if (this.readonlyMode) {
      return { records: [], lastLSN: fromLSN };
    }
    return this.wal.read(fromLSN, limit);
  }

  public async applyReplicatedWAL(records: WALRecord[]): Promise<number> {
    // Replica-only: apply committed txs in WAL order, without writing local WAL.
    this.assertWritable(true);

    if (!records.length) return this.getCheckpointLSN();

    const startLSN = this.getCheckpointLSN();
    const opsByTx = new Map<number, TXOp[]>();
    let lastApplied = startLSN;

    await this._runInWriter(async () => {
      for (const record of records) {
        if (record.lsn <= startLSN) continue;

        if (record.type === "op") {
          const payload = record.payload as TXOp;
          if (!opsByTx.has(record.tx)) opsByTx.set(record.tx, []);
          opsByTx.get(record.tx)!.push(payload);
        } else if (record.type === "commit") {
          const txOps = opsByTx.get(record.tx);
          if (txOps?.length) {
            await this._applyOps(txOps);
          }
          lastApplied = Math.max(lastApplied, record.lsn);
          this.advanceCheckpoint(lastApplied);
          opsByTx.delete(record.tx);
        }
      }
    });

    return lastApplied;
  }

  /* ------------------------- META ------------------------- */

  private loadMeta() {
    this.meta = withLiorandbErrorSync(
      {
        code: "IO_ERROR",
        message: "Failed to load database metadata",
        details: { metaPath: this.metaPath }
      },
      () => {
        if (!fs.existsSync(this.metaPath)) {
          const next: DBMeta = {
            version: META_VERSION,
            indexes: {},
            schemaVersion: DEFAULT_SCHEMA_VERSION
          };
          this.meta = next;
          this.saveMeta();
          return next;
        }

        const parsed = JSON.parse(fs.readFileSync(this.metaPath, "utf8")) as DBMeta;

        if (!parsed.schemaVersion) {
          parsed.schemaVersion = DEFAULT_SCHEMA_VERSION;
          this.meta = parsed;
          this.saveMeta();
        }

        return parsed;
      }
    );
  }

  private saveMeta() {
    if (this.readonlyMode) return;
    try {
      fs.writeFileSync(this.metaPath, JSON.stringify(this.meta, null, 2));
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to save database metadata",
        details: { metaPath: this.metaPath }
      });
    }
  }

  getSchemaVersion(): string {
    return this.meta.schemaVersion;
  }

  setSchemaVersion(v: string) {
    this.assertWritable();
    this.meta.schemaVersion = v;
    this.saveMeta();
  }

  /* ------------------------- DB MIGRATIONS ------------------------- */

  migrate(from: string, to: string, fn: (db: LioranDB) => Promise<void>) {
    this.assertWritable();
    this.migrator.register(from, to, async db => {
      await fn(db);
      db.setSchemaVersion(to);
    });
  }

  async applyMigrations(targetVersion: string) {
    this.assertWritable();
    await this.migrator.upgradeToLatest();
  }

  /* ------------------------- TX APPLY ------------------------- */

  async applyTransaction(ops: TXOp[]) {
    await this._applyOps(ops);
  }

  private async _applyOps(ops: TXOp[]): Promise<any[]> {
    const results: any[] = [];

    for (const { col, op, args } of ops) {
      if (col === DB_META_COL) {
        results.push(await this._execDBMeta(op, args));
        continue;
      }

      const collection = this.collection(col);
      results.push(await (collection as any)._exec(op, args));
    }

    return results;
  }

  private async _execDBMeta(op: string, args: any[]) {
    switch (op) {
      case "createIndex":
        return this._createIndexInternal(args[0], args[1], args[2]);
      case "createTextIndex":
        return this._createTextIndexInternal(args[0], args[1], args[2]);
      case "compactCollection":
        return this._compactCollectionInternal(args[0]);
      default:
        throw new LiorandbError("UNKNOWN_OPERATION", `Unknown db meta operation: ${op}`, {
          details: { op }
        });
    }
  }

  /* ------------------------- COLLECTION ------------------------- */

  collection<T = any>(
    name: string,
    schema?: ZodSchema<T>,
    schemaVersion?: number,
    options?: { tieredStorage?: TieredStorageOptions }
  ): Collection<T> {
    const marker = this.runtimeOptions.sharding?.marker ?? "__shard__";
    const shardCount = this.runtimeOptions.sharding?.enabled === false
      ? 1
      : Math.max(1, Math.trunc(this.runtimeOptions.sharding?.shards ?? 1));
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shardRe = new RegExp(`${escapeRe(marker)}(\\d+)$`);
    const isPhysical = shardRe.test(name);
    const logicalNameForMeta = isPhysical ? name.replace(shardRe, "") : name;

    if (this.collections.has(name)) {
      const col = this.collections.get(name)!;
      if (schema && schemaVersion !== undefined && typeof col?.setSchema === "function") {
        col.setSchema(schema, schemaVersion);
      }
      if (typeof col?.registerIndex === "function") {
        this._ensureIdIndex(name, col, path.join(this.basePath, name));
      }
      return col as Collection<T>;
    }

    if (!isPhysical && shardCount > 1) {
      const logicalName = name;
      const wrapper = new ShardedCollection<T>(
        (sid: number) => {
          const physicalName = `${logicalName}${marker}${sid}`;
          return this.collection<T>(physicalName, schema, schemaVersion, options);
        },
        shardCount
      ) as any;

      this.collections.set(name, wrapper);
      return wrapper as any;
    }

    const colPath = path.join(this.basePath, name);
    try {
      fs.mkdirSync(colPath, { recursive: true });
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to create/open collection directory",
        details: { collection: name, colPath }
      });
    }

    try {
      const col = new Collection<T>(
        colPath,
        schema,
        schemaVersion ?? 1,
        {
          readonly: this.readonlyMode,
          batchChunkSize: this.runtimeOptions.batch?.chunkSize,
          tieredStorage: options?.tieredStorage,
          cacheEngine: (this.manager as any)?.cache,
          leveldb: this.runtimeOptions.storage?.leveldb,
          metrics: (this.manager as any)?.metrics,
          dbName: this.dbName,
          onExplain: (explain) => {
            // Adaptive compaction: track read amplification (scanned/returned).
            try {
              const denom = Math.max(1, Math.trunc(explain.returnedDocuments ?? 0));
              const scanned = Math.max(0, Math.trunc(explain.scannedDocuments ?? 0));
              const amp = scanned / denom;
              this.readAmpSum += amp;
              this.readAmpCount += 1;
            } catch {}
          },
          latency: {
            enabled: this.runtimeOptions.latency?.enabled,
            readBudgetMs: this.runtimeOptions.latency?.readBudgetMs ?? 100,
            onViolation: this.runtimeOptions.latency?.onViolation
          },
          resolveCollection: (otherName: string) => this.collection(otherName),
          scheduler: this.readonlyMode
            ? undefined
            : {
                write: (op: string, args: any[]) =>
                  this._scheduleWrite(name, op, args),
                maintenance: <R>(task: () => Promise<R>) =>
                  this._scheduleMaintenance(task),
                getChunkSize: () =>
                  Math.max(1, Math.trunc(this.runtimeOptions.batch?.chunkSize ?? 500)),
                createIndex: (field: string, options: IndexOptions = {}) =>
                  this._scheduleWrite(DB_META_COL, "createIndex", [name, field, options]),
                createTextIndex: (field: string, options: TextIndexOptions = {}) =>
                  this._scheduleWrite(DB_META_COL, "createTextIndex", [name, field, options])
              }
        }
      );

      const metas = this.meta.indexes[logicalNameForMeta] ?? [];
      for (const m of metas) {
        const type = m.type ?? "btree";
        if (type === "text") {
          (col as any).registerTextIndex?.(new TextIndex(colPath, m.field, m.textOptions ?? {}, this.runtimeOptions.storage?.leveldb));
        } else {
          col.registerIndex(new Index(colPath, m.field, m.options, this.runtimeOptions.storage?.leveldb));
        }
      }

      this._ensureIdIndex(name, col, colPath);
      this.collections.set(name, col);
      return col;
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to create/open collection",
        details: { collection: name, colPath }
      });
    }
  }

  private getAllCollectionNames() {
    if (!fs.existsSync(this.basePath)) return [];

    return fs.readdirSync(this.basePath, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory() &&
        entry.name !== "__wal"
      )
      .map(entry => entry.name);
  }

  /* ------------------------- INDEX API ------------------------- */

  async createIndex(
    collection: string,
    field: string,
    options: IndexOptions = {}
  ) {
    try {
      this.assertWritable();

      await this._commitTransaction(++LioranDB.TX_SEQ, [
        {
          tx: LioranDB.TX_SEQ,
          col: DB_META_COL,
          op: "createIndex",
          args: [collection, field, options]
        }
      ]);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to create index",
        details: { collection, field }
      });
    }
  }

  /* ------------------------- COMPACTION ------------------------- */

  async compactCollection(name: string) {
    try {
      this.assertWritable();

      await this._commitTransaction(++LioranDB.TX_SEQ, [
        {
          tx: LioranDB.TX_SEQ,
          col: DB_META_COL,
          op: "compactCollection",
          args: [name]
        }
      ], { wal: false });
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to compact collection",
        details: { collection: name }
      });
    }
  }

  async compactAll() {
    try {
      this.assertWritable();
      await this._runInWriter(async () => {
        const collectionNames = this.getAllCollectionNames();
        for (const name of collectionNames) {
          const col = this.collection(name);
          await col.compact({ aggressive: true } as any);
        }
      });
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to compact database",
        details: { dbName: this.dbName }
      });
    }
  }

  async explain(collection: string, query: any = {}, options?: any) {
    try {
      const col = this.collection(collection);
      return await (col as any).explain(query, options);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "INTERNAL",
        message: "Explain failed",
        details: { collection }
      });
    }
  }

  async rotateEncryptionKey(newKey: string | Buffer) {
    try {
      this.assertWritable();

      const oldKey = getEncryptionKey();
      const nextKey = deriveEncryptionKey(newKey);
      const collectionNames = this.getAllCollectionNames();

      for (const name of collectionNames) {
        const col = this.collection(name);
        await col.reencryptAll(oldKey, nextKey);
      }

      await this.wal.rotateEncryptionKey(oldKey, nextKey);
      setEncryptionKey(nextKey);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "ENCRYPTION_ERROR",
        message: "Failed to rotate encryption key",
        details: { dbName: this.dbName }
      });
    }
  }

  /* ------------------------- TX API ------------------------- */

  async transaction<T>(
    fn: (tx: DBTransactionContext) => Promise<T>,
    options: { isolation?: "read_committed" | "snapshot" } = {}
  ): Promise<T> {
    try {
      this.assertWritable();

      const isolation = options.isolation ?? "read_committed";
      const txId = ++LioranDB.TX_SEQ;

      if (isolation === "snapshot") {
        return await this._runInWriter(async () => {
          const tx = new DBTransactionContext(this, txId);
          const result = await fn(tx);
          await tx.commit();
          return result;
        });
      }

      const tx = new DBTransactionContext(this, txId);
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Transaction failed",
        details: { dbName: this.dbName }
      });
    }
  }

  /* ------------------------- POST COMMIT ------------------------- */

  public async postCommitMaintenance() {
    if (this.pendingIdIndexEnsure.size === 0) return;

    const next = this.pendingIdIndexEnsure.values().next().value as string | undefined;
    if (!next) return;
    this.pendingIdIndexEnsure.delete(next);

    // Best-effort: never fail the original write because a background index ensure failed.
    try {
      await this._createIndexInternal(next, "_id", { unique: true });
    } catch {}
  }

  /* ------------------------- SHUTDOWN ------------------------- */

  async close(): Promise<void> {
    this.closed = true;
    if (this.maintenanceInterval) {
      try { clearInterval(this.maintenanceInterval); } catch {}
      this.maintenanceInterval = undefined;
    }
    if (!this.readonlyMode) {
      try {
        await this.writer.close();
      } catch {}
      try {
        await this.wal.close?.();
      } catch {}
    }

    for (const col of this.collections.values()) {
      try { await col.close(); } catch {}
    }
    this.collections.clear();
  }

  async maintenance(options: { aggressive?: boolean } = {}) {
    this.assertWritable();
    const aggressive = options.aggressive ?? true;

    await this._runInWriter(async () => {
      const collectionNames = this.getAllCollectionNames();
      for (const name of collectionNames) {
        const col = this.collection(name);
        await col.compact({ aggressive } as any);
      }
    });
  }

  /* ------------------------- WRITER + WAL ------------------------- */

  private async _scheduleWrite(col: string, op: string, args: any[]) {
    this.assertWritable();

    const txId = ++LioranDB.TX_SEQ;
    const txOps: TXOp[] = [{ tx: txId, col, op, args }];

    const results = await this._commitTransaction(txId, txOps);
    return results[0];
  }

  private async _scheduleMaintenance<R>(task: () => Promise<R>): Promise<R> {
    // Reads and internal maintenance must be allowed on read-replicas.
    if (this.readonlyMode) {
      throw new LiorandbError("READONLY_MODE", "Database is in readonly replica mode");
    }
    return this._runInWriter(task);
  }

  async createTextIndex(
    collection: string,
    field: string,
    options: TextIndexOptions = {}
  ) {
    try {
      this.assertWritable();

      await this._commitTransaction(++LioranDB.TX_SEQ, [
        {
          tx: LioranDB.TX_SEQ,
          col: DB_META_COL,
          op: "createTextIndex",
          args: [collection, field, options]
        }
      ]);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to create text index",
        details: { collection, field }
      });
    }
  }

  async _commitTransaction(
    txId: number,
    ops: TXOp[],
    options: { wal?: boolean } = {}
  ): Promise<any[]> {
    this.assertWritable();

    const useWAL = options.wal ?? true;

    return this._runInWriter(async () => {
      return this._commitTransactionInternal(txId, ops, useWAL);
    });
  }

  private async _commitTransactionInternal(
    txId: number,
    ops: TXOp[],
    useWAL: boolean
  ): Promise<any[]> {
    try {
      const latencyEnabled = this.runtimeOptions.latency?.enabled ?? true;
      const onViolation = this.runtimeOptions.latency?.onViolation;
      const writeBudgetMs = latencyEnabled ? this.runtimeOptions.latency?.writeBudgetMs ?? 100 : undefined;
      const walBudgetMs = latencyEnabled ? this.runtimeOptions.latency?.walAppendBudgetMs ?? 5 : undefined;

      const durabilityLevel = this.runtimeOptions.durability?.level ?? "journaled";
      const effectiveUseWAL = useWAL && durabilityLevel !== "none";
      const txTime = Date.now();

      const flushModeForCommit =
        durabilityLevel === "journaled"
          ? ("await" as const)
          : durabilityLevel === "async"
            ? ("request" as const)
            : ("none" as const);

      return await withLatencyBudget(
        `write:${this.dbName}:tx:${txId}`,
        writeBudgetMs,
        onViolation,
        async () => {
          const writeStartedAt = Date.now();
          if (effectiveUseWAL) {
            await withLatencyBudget(
              `wal:${this.dbName}:tx:${txId}`,
              walBudgetMs,
              onViolation,
              async () => {
                const walStartedAt = Date.now();
                for (const op of ops) {
                  await this.wal.append({
                    tx: txId,
                    time: txTime,
                    type: "op",
                    payload: op
                  } as any, { flush: "none" });
                }

                await this.wal.append({
                  tx: txId,
                  time: txTime,
                  type: "commit"
                } as any, { flush: flushModeForCommit });
                try { (this.manager as any)?.metrics?.observeLatency?.(this.dbName, "wal", Date.now() - walStartedAt); } catch {}
              }
            );
          }

          const results = await this._applyOps(ops);

          // Track write load for adaptive compaction (primary only).
          this.writesSinceMaintenance += ops.length;

          if (effectiveUseWAL) {
            const appliedLSN = await this.wal.append({
              tx: txId,
              time: txTime,
              type: "applied"
            } as any, { flush: flushModeForCommit });

            this.advanceCheckpoint(appliedLSN);
            try {
              (this.manager as any)?.metrics?.observeLeaderLSN?.(this.dbName, appliedLSN);
              (this.manager as any)?.metrics?.observeCommitTime?.(this.dbName, appliedLSN, txTime);
            } catch {}

            // Cluster strong-consistency option: wait for majority replication acks.
            await (this.manager as any)._awaitReplicationMajority?.(this.dbName, appliedLSN);
          }

          await this.postCommitMaintenance();
          try { (this.manager as any)?.metrics?.observeLatency?.(this.dbName, "write", Date.now() - writeStartedAt); } catch {}
          return results;
        }
      );
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Commit transaction failed",
        details: { txId, useWAL }
      });
    }
  }

  private async _createIndexInternal(
    collection: string,
    field: string,
    options: IndexOptions = {},
    persistMeta = true
  ) {
    const marker = this.runtimeOptions.sharding?.marker ?? "__shard__";
    const shardCount = this.runtimeOptions.sharding?.enabled === false
      ? 1
      : Math.max(1, Math.trunc(this.runtimeOptions.sharding?.shards ?? 1));
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shardRe = new RegExp(`${escapeRe(marker)}(\\d+)$`);
    const isPhysical = shardRe.test(collection);
    const logicalNameForMeta = isPhysical ? collection.replace(shardRe, "") : collection;

    if (!isPhysical && shardCount > 1) {
      // Persist meta once (logical), then build the same index on each shard physical collection.
      if (persistMeta) {
        const normalizedOptions: IndexOptions = { unique: !!options.unique };
        const existingMeta = this.meta.indexes[logicalNameForMeta]?.find(i => i.field === field && (i.type ?? "btree") === "btree");
        if (!existingMeta) {
          if (!this.meta.indexes[logicalNameForMeta]) this.meta.indexes[logicalNameForMeta] = [];
          this.meta.indexes[logicalNameForMeta].push({ field, options: normalizedOptions, type: "btree" });
          this.saveMeta();
        }
      }
      for (let sid = 0; sid < shardCount; sid++) {
        await this._createIndexInternal(`${collection}${marker}${sid}`, field, options, false);
      }
      return true;
    }

    const col = this.collection(collection);

    const normalizedOptions: IndexOptions = { unique: !!options.unique };

    const existingMeta = this.meta.indexes[logicalNameForMeta]?.find(i => i.field === field && (i.type ?? "btree") === "btree");
    if (existingMeta) {
      const existingUnique = !!existingMeta.options?.unique;
      if (existingUnique !== !!normalizedOptions.unique) {
        throw new LiorandbError(
          "INDEX_ALREADY_EXISTS",
          `Index "${collection}.${field}" already exists with different options`,
          { details: { collection, field, existingOptions: existingMeta.options, requestedOptions: normalizedOptions } }
        );
      }
    }

    const indexAlreadyRegistered = !!(col as any).getIndex?.(field);
    const index = (col as any).getIndex?.(field) ?? new Index(col.dir, field, normalizedOptions, this.runtimeOptions.storage?.leveldb);
    const docs: any[] = [];
    const flush = async () => {
      if (docs.length === 0) return;
      await index.bulkInsert(docs);
      docs.length = 0;
    };

    for await (const [key, enc] of col.db.iterator()) {
      if (key.startsWith(COLLECTION_META_KEY_PREFIX) || !enc) continue;

      let doc: any;
      try {
        doc = decryptData(enc);
      } catch {
        continue;
      }

      if (existingMeta || indexAlreadyRegistered) {
        const ok = await index.isIndexed(doc);
        if (ok) continue;
      }

      docs.push(doc);
      if (docs.length >= 5000) {
        await flush();
      }
    }

    await flush();

    if (!indexAlreadyRegistered) {
      col.registerIndex(index);
    }

    if (!this.meta.indexes[logicalNameForMeta]) {
      this.meta.indexes[logicalNameForMeta] = [];
    }

    if (!existingMeta && persistMeta) {
      this.meta.indexes[logicalNameForMeta].push({ field, options: normalizedOptions, type: "btree" });
      this.saveMeta();
    }
    return true;
  }

  private async _createTextIndexInternal(
    collection: string,
    field: string,
    options: TextIndexOptions = {},
    persistMeta = true
  ) {
    const marker = this.runtimeOptions.sharding?.marker ?? "__shard__";
    const shardCount = this.runtimeOptions.sharding?.enabled === false
      ? 1
      : Math.max(1, Math.trunc(this.runtimeOptions.sharding?.shards ?? 1));
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shardRe = new RegExp(`${escapeRe(marker)}(\\d+)$`);
    const isPhysical = shardRe.test(collection);
    const logicalNameForMeta = isPhysical ? collection.replace(shardRe, "") : collection;

    if (!isPhysical && shardCount > 1) {
      if (persistMeta) {
        const existingMeta = this.meta.indexes[logicalNameForMeta]?.find(i => i.field === field && (i.type ?? "btree") === "text");
        if (!existingMeta) {
          if (!this.meta.indexes[logicalNameForMeta]) this.meta.indexes[logicalNameForMeta] = [];
          this.meta.indexes[logicalNameForMeta].push({ field, options: {}, type: "text", textOptions: options });
          this.saveMeta();
        }
      }
      for (let sid = 0; sid < shardCount; sid++) {
        await this._createTextIndexInternal(`${collection}${marker}${sid}`, field, options, false);
      }
      return true;
    }

    const col = this.collection(collection);

    const existingMeta = this.meta.indexes[logicalNameForMeta]?.find(i => i.field === field && (i.type ?? "btree") === "text");
    if (existingMeta) return true;

    const indexAlreadyRegistered = !!(col as any).getTextIndex?.(field);
    const index = (col as any).getTextIndex?.(field) ?? new TextIndex(col.dir, field, options, this.runtimeOptions.storage?.leveldb);

    const docs: any[] = [];
    const flush = async () => {
      if (docs.length === 0) return;
      await index.bulkInsert(docs);
      docs.length = 0;
    };

    for await (const [key, enc] of col.db.iterator()) {
      if (key.startsWith(COLLECTION_META_KEY_PREFIX) || !enc) continue;

      try {
        docs.push(decryptData(enc));
      } catch {
        continue;
      }

      if (docs.length >= 5000) {
        await flush();
      }
    }

    await flush();

    if (!indexAlreadyRegistered) {
      (col as any).registerTextIndex?.(index);
    }

    if (!this.meta.indexes[logicalNameForMeta]) {
      this.meta.indexes[logicalNameForMeta] = [];
    }

    if (persistMeta) {
      this.meta.indexes[logicalNameForMeta].push({ field, options: {}, type: "text", textOptions: options });
      this.saveMeta();
    }
    return true;
  }

  private async _compactCollectionInternal(name: string) {
    const marker = this.runtimeOptions.sharding?.marker ?? "__shard__";
    const shardCount = this.runtimeOptions.sharding?.enabled === false
      ? 1
      : Math.max(1, Math.trunc(this.runtimeOptions.sharding?.shards ?? 1));
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shardRe = new RegExp(`${escapeRe(marker)}(\\d+)$`);

    if (!shardRe.test(name) && shardCount > 1) {
      for (let sid = 0; sid < shardCount; sid++) {
        const col = this.collection(`${name}${marker}${sid}`);
        await (col as any)._compactInternal?.();
      }
      return true;
    }

    const col = this.collection(name);
    await (col as any)._compactInternal?.();
    return true;
  }

  private _ensureIdIndex(name: string, col: Collection, colPath: string) {
    // Always ensure there is an in-memory `_id` index, so future writes keep it updated immediately.
    // Backfill + persistence is handled opportunistically in `postCommitMaintenance()` to avoid
    // stealing write-queue capacity (important in backpressure reject mode).
    if (!col.getIndex("_id")) {
      col.registerIndex(new Index(colPath, "_id", { unique: true }, this.runtimeOptions.storage?.leveldb));
    }

    if (this.readonlyMode) return;
    if (this.idIndexEnsureScheduled.has(name)) return;

    const marker = this.runtimeOptions.sharding?.marker ?? "__shard__";
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shardRe = new RegExp(`${escapeRe(marker)}(\\d+)$`);
    const logicalNameForMeta = shardRe.test(name) ? name.replace(shardRe, "") : name;

    const alreadyInMeta = !!this.meta.indexes[logicalNameForMeta]?.some(i => i.field === "_id");
    this.idIndexEnsureScheduled.add(name);

    if (!alreadyInMeta) {
      this.pendingIdIndexEnsure.add(logicalNameForMeta);
    }
  }
}
