import path from "path";
import fs from "fs";
import { Collection } from "./collection.js";
import type { LioranManager } from "../LioranManager.js";
import type { ZodSchema } from "zod";

type TXOp = { tx: number; col: string; op: string; args: any[] };
type TXCommit = { tx: number; commit: true };
type TXApplied = { tx: number; applied: true };
type WALEntry = TXOp | TXCommit | TXApplied;

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
    await this.db.writeWAL(this.ops);
    await this.db.writeWAL([{ tx: this.txId, commit: true }]);
    await this.db.applyTransaction(this.ops);
    await this.db.writeWAL([{ tx: this.txId, applied: true }]);
    await this.db.clearWAL();
  }
}

export class LioranDB {
  basePath: string;
  dbName: string;
  manager: LioranManager;
  collections: Map<string, Collection>;
  private walPath: string;

  private static TX_SEQ = 0;

  constructor(basePath: string, dbName: string, manager: LioranManager) {
    this.basePath = basePath;
    this.dbName = dbName;
    this.manager = manager;
    this.collections = new Map();
    this.walPath = path.join(basePath, "__tx_wal.log");

    fs.mkdirSync(basePath, { recursive: true });

    this.recoverFromWAL().catch(console.error);
  }

  async writeWAL(entries: WALEntry[]) {
    const fd = await fs.promises.open(this.walPath, "a");
    for (const e of entries) {
      await fd.write(JSON.stringify(e) + "\n");
    }
    await fd.sync();
    await fd.close();
  }

  async clearWAL() {
    try { await fs.promises.unlink(this.walPath); } catch {}
  }

  private async recoverFromWAL() {
    if (!fs.existsSync(this.walPath)) return;

    const raw = await fs.promises.readFile(this.walPath, "utf8");

    const committed = new Set<number>();
    const applied = new Set<number>();
    const ops = new Map<number, TXOp[]>();

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;

      try {
        const entry: WALEntry = JSON.parse(line);

        if ("commit" in entry) committed.add(entry.tx);
        else if ("applied" in entry) applied.add(entry.tx);
        else {
          if (!ops.has(entry.tx)) ops.set(entry.tx, []);
          ops.get(entry.tx)!.push(entry);
        }
      } catch {
        // Ignore corrupted WAL tail
        break;
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

  collection<T = any>(name: string, schema?: ZodSchema<T>): Collection<T> {
    if (this.collections.has(name)) {
      const col = this.collections.get(name)!;
      if (schema) col.setSchema(schema);
      return col as Collection<T>;
    }

    const colPath = path.join(this.basePath, name);
    fs.mkdirSync(colPath, { recursive: true });

    const col = new Collection<T>(colPath, schema);
    this.collections.set(name, col);
    return col;
  }

  async transaction<T>(fn: (tx: DBTransactionContext) => Promise<T>): Promise<T> {
    const txId = ++LioranDB.TX_SEQ;
    const tx = new DBTransactionContext(this, txId);

    const result = await fn(tx);
    await tx.commit();

    return result;
  }

  async close(): Promise<void> {
    for (const col of this.collections.values()) {
      try { await col.close(); } catch {}
    }
    this.collections.clear();
  }
}