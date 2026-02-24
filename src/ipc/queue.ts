import { IPCClient } from "./client.js";
import { getDefaultRootPath } from "../utils/rootpath.js";

/* -------------------------------- ACTION TYPES -------------------------------- */

export type IPCAction =
  | "db"
  | "op"
  | "index"
  | "compact:collection"
  | "compact:db"
  | "compact:all"
  | "shutdown";

/* -------------------------------- DB QUEUE -------------------------------- */

export class DBQueue {
  private client: IPCClient;

  constructor(rootPath = getDefaultRootPath()) {
    this.client = new IPCClient(rootPath);
  }

  exec(action: IPCAction, args: any) {
    return this.client.exec(action, args);
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

  /* ------------------------------ SHUTDOWN ------------------------------ */

  async shutdown() {
    try {
      await this.exec("shutdown", {});
    } catch {}
    this.client.close();
  }
}

/* -------------------------------- SINGLETON -------------------------------- */

export const dbQueue = new DBQueue();