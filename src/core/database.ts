import path from "path";
import fs from "fs";
import { Collection } from "./collection.js";
import { Index, IndexOptions } from "./index.js";
import { MigrationEngine } from "./migration.js";
import type { LioranManager } from "../LioranManager.js";
import type { ZodSchema } from "zod";
import { decryptData } from "../utils/encryption.js";

import { WALManager } from "./wal.js";
import { CheckpointManager } from "./checkpoint.js";

/* ----------------------------- TYPES ----------------------------- */

type TXOp = { tx: number; col: string; op: string; args: any[] };
type TXCommit = { tx: number; commit: true };
type TXApplied = { tx: number; applied: true };
type WALEntry = TXOp | TXCommit | TXApplied;

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

/* ---------------------- TRANSACTION CONTEXT ---------------------- */

class DBTransactionContext {
  private ops: TXOp[] = [];

  constructor(
    private db: LioranDB,
    public readonly txId: number
  ) {}

  collection(name: string) {
    return new Proxy({}, {
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
    });
  }

  async commit() {
    for (const op of this.ops) {
      const recordOp: any = {
        tx: this.txId,
        type: "op",
        payload: op
      };
      await this.db.wal.append(recordOp);
    }

    const commitRecord: any = {
      tx: this.txId,
      type: "commit"
    };
    await this.db.wal.append(commitRecord);

    await this.db.applyTransaction(this.ops);

    const appliedRecord: any = {
      tx: this.txId,
      type: "applied"
    };
    await this.db.wal.append(appliedRecord);

    await this.db.postCommitMaintenance();
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

  public wal: WALManager;
  private checkpoint: CheckpointManager;

  constructor(basePath: string, dbName: string, manager: LioranManager) {
    this.basePath = basePath;
    this.dbName = dbName;
    this.manager = manager;
    this.collections = new Map();

    this.metaPath = path.join(basePath, META_FILE);

    fs.mkdirSync(basePath, { recursive: true });

    this.loadMeta();

    this.wal = new WALManager(basePath);
    this.checkpoint = new CheckpointManager(basePath);

    this.migrator = new MigrationEngine(this);

    this.initialize().catch(console.error);
  }

  /* ------------------------- INIT & RECOVERY ------------------------- */

  private async initialize() {
    await this.recoverFromWAL();
  }

  private async recoverFromWAL() {
    const checkpointData = this.checkpoint.get();
    const fromLSN = checkpointData.lsn;

    const committed = new Set<number>();
    const applied = new Set<number>();
    const ops = new Map<number, TXOp[]>();

    await this.wal.replay(fromLSN, async (record) => {
      if (record.type === "commit") {
        committed.add(record.tx);
      } else if (record.type === "applied") {
        applied.add(record.tx);
      } else if (record.type === "op") {
        if (!ops.has(record.tx)) ops.set(record.tx, []);
        ops.get(record.tx)!.push(record.payload);
      }
    });

    for (const tx of committed) {
      if (applied.has(tx)) continue;

      const txOps = ops.get(tx);
      if (txOps) {
        await this.applyTransaction(txOps);
      }
    }
  }

  /* ------------------------- META ------------------------- */

  private loadMeta() {
    if (!fs.existsSync(this.metaPath)) {
      this.meta = {
        version: META_VERSION,
        indexes: {},
        schemaVersion: DEFAULT_SCHEMA_VERSION
      };
      this.saveMeta();
      return;
    }

    this.meta = JSON.parse(fs.readFileSync(this.metaPath, "utf8"));

    if (!this.meta.schemaVersion) {
      this.meta.schemaVersion = DEFAULT_SCHEMA_VERSION;
      this.saveMeta();
    }
  }

  private saveMeta() {
    fs.writeFileSync(this.metaPath, JSON.stringify(this.meta, null, 2));
  }

  getSchemaVersion(): string {
    return this.meta.schemaVersion;
  }

  setSchemaVersion(v: string) {
    this.meta.schemaVersion = v;
    this.saveMeta();
  }

  /* ------------------------- DB MIGRATIONS ------------------------- */

  migrate(from: string, to: string, fn: (db: LioranDB) => Promise<void>) {
    this.migrator.register(from, to, async db => {
      await fn(db);
      db.setSchemaVersion(to);
    });
  }

  async applyMigrations(targetVersion: string) {
    await this.migrator.upgradeToLatest();
  }

  /* ------------------------- TX APPLY ------------------------- */

  async applyTransaction(ops: TXOp[]) {
    for (const { col, op, args } of ops) {
      const collection = this.collection(col);
      await (collection as any)._exec(op, args);
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
    fs.mkdirSync(colPath, { recursive: true });

    const col = new Collection<T>(
      colPath,
      schema,
      schemaVersion ?? 1
    );

    const metas = this.meta.indexes[name] ?? [];
    for (const m of metas) {
      col.registerIndex(new Index(colPath, m.field, m.options));
    }

    this.collections.set(name, col);
    return col;
  }

  /* ------------------------- INDEX API ------------------------- */

  async createIndex(
    collection: string,
    field: string,
    options: IndexOptions = {}
  ) {
    const col = this.collection(collection);

    const existing = this.meta.indexes[collection]?.find(i => i.field === field);
    if (existing) return;

    const index = new Index(col.dir, field, options);

    for await (const [key, enc] of col.db.iterator()) {
      if (!enc) continue;
      try {
        const doc = decryptData(enc);
        await index.insert(doc);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Index build skipped doc ${key}: ${msg}`);
      }
    }

    col.registerIndex(index);

    if (!this.meta.indexes[collection]) {
      this.meta.indexes[collection] = [];
    }

    this.meta.indexes[collection].push({ field, options });
    this.saveMeta();
  }

  /* ------------------------- COMPACTION ------------------------- */

  async compactCollection(name: string) {
    const col = this.collection(name);
    await col.compact();
  }

  async compactAll() {
    for (const name of this.collections.keys()) {
      await this.compactCollection(name);
    }
  }

  /* ------------------------- TX API ------------------------- */

  async transaction<T>(fn: (tx: DBTransactionContext) => Promise<T>): Promise<T> {
    const txId = ++LioranDB.TX_SEQ;
    const tx = new DBTransactionContext(this, txId);
    const result = await fn(tx);
    await tx.commit();
    return result;
  }

  /* ------------------------- POST COMMIT ------------------------- */

  public async postCommitMaintenance() {
    // Custom maintenance can be added here
  }

  /* ------------------------- SHUTDOWN ------------------------- */

  async close(): Promise<void> {
    for (const col of this.collections.values()) {
      try { await col.close(); } catch {}
    }

    this.collections.clear();
  }
}