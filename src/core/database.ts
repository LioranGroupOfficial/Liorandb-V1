import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { Collection } from "./collection.js";
import { Index, IndexOptions } from "./index.js";
import { MigrationEngine } from "./migration.js";
import type { LioranManager } from "../LioranManager.js";
import type { ZodSchema } from "zod";

const exec = promisify(execFile);

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
const META_VERSION = 1;
const DEFAULT_SCHEMA_VERSION = "v1";

/* ---------------------- TRANSACTION CONTEXT ---------------------- */

class DBTransactionContext {
  private ops: TXOp[] = [];

  constructor(
    private db: LioranDB,
    public readonly txId: number
  ) { }

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
    await this.db.writeWAL(this.ops);
    await this.db.writeWAL([{ tx: this.txId, commit: true }]);
    await this.db.applyTransaction(this.ops);
    await this.db.writeWAL([{ tx: this.txId, applied: true }]);
    await this.db.clearWAL();
  }
}

/* ----------------------------- DATABASE ----------------------------- */

export class LioranDB {
  basePath: string;
  dbName: string;
  manager: LioranManager;
  collections: Map<string, Collection>;

  private walPath: string;
  private metaPath: string;
  private meta!: DBMeta;

  private migrator: MigrationEngine;

  private static TX_SEQ = 0;

  constructor(basePath: string, dbName: string, manager: LioranManager) {
    this.basePath = basePath;
    this.dbName = dbName;
    this.manager = manager;
    this.collections = new Map();

    this.walPath = path.join(basePath, "__tx_wal.log");
    this.metaPath = path.join(basePath, META_FILE);

    fs.mkdirSync(basePath, { recursive: true });

    this.loadMeta();
    this.migrator = new MigrationEngine(this);

    this.recoverFromWAL().catch(console.error);
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

  /* ------------------------- MIGRATION API ------------------------- */

  migrate(from: string, to: string, fn: (db: LioranDB) => Promise<void>) {
    this.migrator.register(from, to, async db => {
      await fn(db);
      db.setSchemaVersion(to);
    });
  }

  async applyMigrations(targetVersion: string) {
    await this.migrator.upgradeToLatest();
  }

  /* ------------------------- WAL ------------------------- */

  async writeWAL(entries: WALEntry[]) {
    const fd = await fs.promises.open(this.walPath, "a");
    for (const e of entries) {
      await fd.write(JSON.stringify(e) + "\n");
    }
    await fd.sync();
    await fd.close();
  }

  async clearWAL() {
    try { await fs.promises.unlink(this.walPath); } catch { }
  }

  private async recoverFromWAL() {
    if (!fs.existsSync(this.walPath)) return;

    const raw = await fs.promises.readFile(this.walPath, "utf8");

    const committed = new Set<number>();
    const applied = new Set<number>();
    const ops = new Map<number, TXOp[]>();

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;

      const entry: WALEntry = JSON.parse(line);

      if ("commit" in entry) committed.add(entry.tx);
      else if ("applied" in entry) applied.add(entry.tx);
      else {
        if (!ops.has(entry.tx)) ops.set(entry.tx, []);
        ops.get(entry.tx)!.push(entry);
      }
    }

    for (const tx of committed) {
      if (applied.has(tx)) continue;
      const txOps = ops.get(tx);
      if (txOps) await this.applyTransaction(txOps);
    }

    await this.clearWAL();
  }

  async applyTransaction(ops: TXOp[]) {
    for (const { col, op, args } of ops) {
      const collection = this.collection(col);
      await (collection as any)._exec(op, args);
    }
  }

  /* ------------------------- COLLECTION ------------------------- */

  collection<T = any>(name: string, schema?: ZodSchema<T>): Collection<T> {
    if (this.collections.has(name)) {
      const col = this.collections.get(name)!;
      if (schema) col.setSchema(schema);
      return col as Collection<T>;
    }

    const colPath = path.join(this.basePath, name);
    fs.mkdirSync(colPath, { recursive: true });

    const col = new Collection<T>(colPath, schema);

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

    // for await (const [, enc] of col.db.iterator()) {
    //   // const doc = JSON.parse(
    //   //   Buffer.from(enc, "base64").subarray(32).toString("utf8")
    //   // );
    //   const payload = Buffer.from(enc, "utf8").subarray(32);
    //   const doc = JSON.parse(payload.toString("utf8"));
    //   await index.insert(doc);
    // }

    for await (const [key, enc] of col.db.iterator()) {
      if (!enc) continue;

      try {
        const doc = decryptData(enc);           // ← this does base64 → AES-GCM → JSON
        await index.insert(doc);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.warn(`Could not decrypt document ${key} during index build: ${errorMessage}`);
        // You can continue, or collect bad keys for later inspection
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
    await this.clearWAL();
    const col = this.collection(name);
    await col.compact();
  }

  async compactAll() {
    await this.clearWAL();
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

  /* ------------------------- SHUTDOWN ------------------------- */

  async close(): Promise<void> {
    for (const col of this.collections.values()) {
      try { await col.close(); } catch { }
    }
    this.collections.clear();
  }
}

function decryptData(enc: string) {
  throw new Error("Function not implemented.");
}
