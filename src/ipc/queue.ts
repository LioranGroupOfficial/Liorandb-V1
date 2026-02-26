import { LioranManager } from "../LioranManager.js";
import { getDefaultRootPath } from "../utils/rootpath.js";
import { IPCWorkerPool } from "./pool.js";

/* -------------------------------- ACTION TYPES -------------------------------- */

export type IPCAction =
  | "db"
  | "op"
  | "index"
  | "compact:collection"
  | "compact:db"
  | "compact:all"
  | "shutdown"
  | "restore"
  | "snapshot";

/* -------------------------------- DB QUEUE -------------------------------- */

export class DBQueue {
  private manager: LioranManager;
  private pool: IPCWorkerPool;
  private destroyed = false;

  constructor(private rootPath = getDefaultRootPath()) {
    // Single shared DB instance
    this.manager = new LioranManager({ rootPath });

    // Worker threads (for future compute-heavy tasks)
    this.pool = new IPCWorkerPool();
    this.pool.start();
  }

  /* -------------------------------- EXEC -------------------------------- */

  async exec(action: IPCAction, args: any) {
    if (this.destroyed) {
      throw new Error("DBQueue already shutdown");
    }

    switch (action) {
      /* ---------------- DB ---------------- */

      case "db":
        await this.manager.db(args.db);
        return true;

      /* ---------------- CRUD OPS ---------------- */

      case "op": {
        const { db, col, method, params } = args;
        const collection = (await this.manager.db(db)).collection(col);
        return await (collection as any)[method](...params);
      }

      /* ---------------- INDEX OPS ---------------- */

      case "index": {
        const { db, col, method, params } = args;
        const collection = (await this.manager.db(db)).collection(col);
        return await (collection as any)[method](...params);
      }

      /* ---------------- COMPACTION ---------------- */

      case "compact:collection": {
        const { db, col } = args;
        const collection = (await this.manager.db(db)).collection(col);
        await collection.compact();
        return true;
      }

      case "compact:db": {
        const { db } = args;
        const database = await this.manager.db(db);
        await database.compactAll();
        return true;
      }

      case "compact:all": {
        for (const db of this.manager.openDBs.values()) {
          await db.compactAll();
        }
        return true;
      }

      /* ---------------- SNAPSHOT ---------------- */

      case "snapshot":
        await this.manager.snapshot(args.path);
        return true;

      case "restore":
        await this.manager.restore(args.path);
        return true;

      /* ---------------- CONTROL ---------------- */

      case "shutdown":
        await this.shutdown();
        return true;

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /* ------------------------------ SHUTDOWN ------------------------------ */

  async shutdown() {
    if (this.destroyed) return;
    this.destroyed = true;

    // Close DBs
    await this.manager.closeAll();

    // Shutdown worker threads
    await this.pool.shutdown();
  }
}

/* -------------------------------- SINGLETON -------------------------------- */

export const dbQueue = new DBQueue();