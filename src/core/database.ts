import path from "path";
import fs from "fs";
import { Collection } from "./collection.js";
import { Index, IndexOptions } from "./index.js";
import { MigrationEngine } from "./migration.js";
import type { LioranManager } from "../LioranManager.js";
import type { ZodSchema } from "zod";
import {
  decryptData,
  deriveEncryptionKey,
  getEncryptionKey,
  setEncryptionKey
} from "../utils/encryption.js";

import { WALManager } from "./wal.js";
import { CheckpointManager } from "./checkpoint.js";
import { DedicatedWriter, type WriterQueueOptions } from "./writer.js";
import { LiorandbError, asLiorandbError, withLiorandbErrorSync } from "../utils/errors.js";

/* ----------------------------- TYPES ----------------------------- */

type TXOp = { tx: number; col: string; op: string; args: any[] };

type IndexMeta = {
  field: string;
  options: IndexOptions;
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
  batch?: {
    chunkSize?: number;
  };
};

/* ---------------------- TRANSACTION CONTEXT ---------------------- */

class DBTransactionContext {
  private ops: TXOp[] = [];

  constructor(
    private db: LioranDB,
    public readonly txId: number
  ) {}

  collection(name: string) {
    return new Proxy(
      {},
      {
        get: (_, prop: string) => {
          return (...args: any[]) => {
            this.ops.push({
              tx: this.txId,
              col: name,
              op: prop,
              args
            });
          };
        }
      }
    );
  }

  async commit() {
    if (this.db.isReadonly()) {
      throw new LiorandbError("READONLY_MODE", "Cannot commit transaction in readonly mode");
    }

    await this.db._commitTransaction(this.txId, this.ops);
  }
}

/* ----------------------------- DATABASE ----------------------------- */

export class LioranDB {
  basePath: string;
  dbName: string;
  manager: LioranManager;
  collections: Map<string, Collection>;

  private metaPath: string;
  private meta!: DBMeta;

  private migrator: MigrationEngine;
  private static TX_SEQ = 0;

  public wal!: WALManager;
  private checkpoint!: CheckpointManager;
  private writer!: DedicatedWriter;
  private runtimeOptions: LioranDBRuntimeOptions;
  private lastBackpressureLogAt = 0;

  private readonly readonlyMode: boolean;
  public readonly ready: Promise<void>;

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

    this.readonlyMode = (manager as any)?.isReadonly?.() ?? false;

    this.metaPath = path.join(basePath, META_FILE);

    try {
      fs.mkdirSync(basePath, { recursive: true });

      this.loadMeta();

      if (!this.readonlyMode) {
        this.wal = new WALManager(basePath);
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
  }

  /* ------------------------- MODE ------------------------- */

  public isReadonly(): boolean {
    return this.readonlyMode;
  }

  private assertWritable() {
    if (this.readonlyMode) {
      throw new LiorandbError("READONLY_MODE", "Database is in readonly replica mode");
    }
  }

  /* ------------------------- INIT & RECOVERY ------------------------- */

  private async initialize() {
    try {
      if (!this.readonlyMode) {
        await this.recoverFromWAL();
      }
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Database initialization failed",
        details: { dbName: this.dbName, basePath: this.basePath }
      });
    }
  }

  private async recoverFromWAL() {
    try {
      const checkpointData = this.checkpoint.get();
      const fromLSN = checkpointData.lsn;

    const committed = new Set<number>();
    const applied = new Set<number>();
    const ops = new Map<number, TXOp[]>();
    const commitLSNByTx = new Map<number, number>();
    let maxSeenLSN = fromLSN;

      await this.wal.replay(fromLSN, async (record) => {
      maxSeenLSN = Math.max(maxSeenLSN, record.lsn);
      if (record.type === "commit") {
        committed.add(record.tx);
        commitLSNByTx.set(record.tx, record.lsn);
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

  /* ------------------------- CHECKPOINT ADVANCE ------------------------- */

  public advanceCheckpoint(lsn: number) {
    if (this.readonlyMode) return;

    const current = this.checkpoint.get();

    if (lsn > current.lsn) {
      this.checkpoint.save(lsn, this.wal.getCurrentGen());
      this.wal.cleanup(this.wal.getCurrentGen() - 1).catch(() => {});
    }
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
    schemaVersion?: number
  ): Collection<T> {
    if (this.collections.has(name)) {
      const col = this.collections.get(name)!;
      if (schema && schemaVersion !== undefined) {
        col.setSchema(schema, schemaVersion);
      }
      return col as Collection<T>;
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
          scheduler: this.readonlyMode
            ? undefined
            : {
                write: (op: string, args: any[]) =>
                  this._scheduleWrite(name, op, args),
                maintenance: <R>(task: () => Promise<R>) =>
                  this._scheduleMaintenance(task),
                getChunkSize: () =>
                  Math.max(1, Math.trunc(this.runtimeOptions.batch?.chunkSize ?? 500))
              }
        }
      );

      const metas = this.meta.indexes[name] ?? [];
      for (const m of metas) {
        col.registerIndex(new Index(colPath, m.field, m.options));
      }

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
      for (const name of this.collections.keys()) {
        await this.compactCollection(name);
      }
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

  async transaction<T>(fn: (tx: DBTransactionContext) => Promise<T>): Promise<T> {
    try {
      this.assertWritable();
      const txId = ++LioranDB.TX_SEQ;
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

  public async postCommitMaintenance() {}

  /* ------------------------- SHUTDOWN ------------------------- */

  async close(): Promise<void> {
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

  /* ------------------------- WRITER + WAL ------------------------- */

  private async _scheduleWrite(col: string, op: string, args: any[]) {
    this.assertWritable();

    const txId = ++LioranDB.TX_SEQ;
    const txOps: TXOp[] = [{ tx: txId, col, op, args }];

    const results = await this._commitTransaction(txId, txOps);
    return results[0];
  }

  private async _scheduleMaintenance<R>(task: () => Promise<R>): Promise<R> {
    this.assertWritable();
    return this.writer.run(task);
  }

  async _commitTransaction(
    txId: number,
    ops: TXOp[],
    options: { wal?: boolean } = {}
  ): Promise<any[]> {
    this.assertWritable();

    const useWAL = options.wal ?? true;

    return this.writer.run(async () => {
      return this._commitTransactionInternal(txId, ops, useWAL);
    });
  }

  private async _commitTransactionInternal(
    txId: number,
    ops: TXOp[],
    useWAL: boolean
  ): Promise<any[]> {
    try {
      if (useWAL) {
        for (const op of ops) {
          await this.wal.append({
            tx: txId,
            type: "op",
            payload: op
          } as any);
        }

        await this.wal.append({
          tx: txId,
          type: "commit"
        } as any);
      }

      const results = await this._applyOps(ops);

      if (useWAL) {
        const appliedLSN = await this.wal.append({
          tx: txId,
          type: "applied"
        } as any);

        this.advanceCheckpoint(appliedLSN);
      }

      await this.postCommitMaintenance();
      return results;
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
    options: IndexOptions = {}
  ) {
    const col = this.collection(collection);

    const existing = this.meta.indexes[collection]?.find(i => i.field === field);
    if (existing) return true;

    const index = new Index(col.dir, field, options);
    const docs: any[] = [];
    const flush = async () => {
      if (docs.length === 0) return;
      await index.bulkInsert(docs);
      docs.length = 0;
    };

    for await (const [key, enc] of col.db.iterator()) {
      if (key.startsWith(COLLECTION_META_KEY_PREFIX) || !enc) continue;
      try {
        const doc = decryptData(enc);
        docs.push(doc);
        if (docs.length >= 5000) {
          await flush();
        }
      } catch {}
    }

    await flush();

    col.registerIndex(index);

    if (!this.meta.indexes[collection]) {
      this.meta.indexes[collection] = [];
    }

    this.meta.indexes[collection].push({ field, options });
    this.saveMeta();
    return true;
  }

  private async _compactCollectionInternal(name: string) {
    const col = this.collection(name);
    await (col as any)._compactInternal?.();
    return true;
  }
}
