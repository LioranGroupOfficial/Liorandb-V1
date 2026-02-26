import { IPCClient } from "./client.js";
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

/* -------------------------------- WRITE DETECTION -------------------------------- */

/**
 * Determines whether a request is a write operation.
 * Writes are pinned to worker 0 for consistency.
 */
function isWriteOperation(action: IPCAction, args: any): boolean {
  if (action !== "op") {
    // All non-read operations treated as write/control
    return true;
  }

  const writeMethods = new Set([
    "insertOne",
    "insertMany",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany"
  ]);

  return writeMethods.has(args?.method);
}

/* -------------------------------- DB QUEUE -------------------------------- */

export class DBQueue {
  private clients: IPCClient[] = [];
  private rrIndex = 0;
  private pool: IPCWorkerPool;
  private destroyed = false;

  constructor(private rootPath = getDefaultRootPath()) {
    // Start worker pool
    this.pool = new IPCWorkerPool(this.rootPath);
    this.pool.start();

    // Create IPC clients for each worker
    for (let i = 0; i < this.pool.size; i++) {
      this.clients.push(new IPCClient(this.rootPath, i));
    }
  }

  /* -------------------------------- LOAD BALANCING -------------------------------- */

  private nextReadClient(): IPCClient {
    const client = this.clients[this.rrIndex];
    this.rrIndex = (this.rrIndex + 1) % this.clients.length;
    return client;
  }

  /* -------------------------------- EXEC -------------------------------- */

  exec(action: IPCAction, args: any) {
    if (this.destroyed) {
      throw new Error("DBQueue already shutdown");
    }

    // Writes pinned to primary worker (0)
    if (isWriteOperation(action, args)) {
      return this.clients[0].exec(action, args);
    }

    // Reads load-balanced
    return this.nextReadClient().exec(action, args);
  }

  /* ----------------------------- COMPACTION API ----------------------------- */

  compactCollection(db: string, col: string) {
    return this.exec("compact:collection", { db, col });
  }

  compactDB(db: string) {
    return this.exec("compact:db", { db });
  }

  compactAll() {
    return this.exec("compact:all", {});
  }

  /* ----------------------------- SNAPSHOT API ----------------------------- */

  snapshot(path: string) {
    return this.exec("snapshot", { path });
  }

  restore(path: string) {
    return this.exec("restore", { path });
  }

  /* ------------------------------ SHUTDOWN ------------------------------ */

  async shutdown() {
    if (this.destroyed) return;
    this.destroyed = true;

    try {
      // Shutdown primary worker gracefully
      await this.clients[0].exec("shutdown", {});
    } catch {
      // ignore
    }

    // Close all IPC clients
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // ignore
      }
    }

    // Shutdown worker pool
    await this.pool.shutdown();
  }
}

/* -------------------------------- SINGLETON -------------------------------- */

export const dbQueue = new DBQueue();