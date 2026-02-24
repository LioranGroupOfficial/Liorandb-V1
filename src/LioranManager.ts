import path from "path";
import fs from "fs";
import process from "process";
import { LioranDB } from "./core/database.js";
import { setEncryptionKey } from "./utils/encryption.js";
import { getDefaultRootPath } from "./utils/rootpath.js";
import { dbQueue } from "./ipc/queue.js";
import { IPCServer } from "./ipc/server.js";

enum ProcessMode {
  PRIMARY = "primary",
  CLIENT = "client"
}

export interface LioranManagerOptions {
  rootPath?: string;
  encryptionKey?: string | Buffer;
}

export class LioranManager {
  rootPath: string;
  openDBs: Map<string, LioranDB>;
  private closed = false;
  private mode: ProcessMode;
  private lockFd?: number;
  private ipcServer?: IPCServer;

  constructor(options: LioranManagerOptions = {}) {
    const { rootPath, encryptionKey } = options;

    this.rootPath = rootPath || getDefaultRootPath();

    if (!fs.existsSync(this.rootPath)) {
      fs.mkdirSync(this.rootPath, { recursive: true });
    }

    if (encryptionKey) {
      setEncryptionKey(encryptionKey);
    }

    this.openDBs = new Map();

    this.mode = this.tryAcquireLock()
      ? ProcessMode.PRIMARY
      : ProcessMode.CLIENT;

    if (this.mode === ProcessMode.PRIMARY) {
      this.ipcServer = new IPCServer(this, this.rootPath);
      this.ipcServer.start();
      this._registerShutdownHooks();
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private tryAcquireLock(): boolean {
    const lockPath = path.join(this.rootPath, ".lioran.lock");

    try {
      this.lockFd = fs.openSync(lockPath, "wx");
      fs.writeSync(this.lockFd, String(process.pid));
      return true;
    } catch {
      // Possible stale lock → validate PID
      try {
        const pid = Number(fs.readFileSync(lockPath, "utf8"));
        if (!this.isProcessAlive(pid)) {
          fs.unlinkSync(lockPath);
          this.lockFd = fs.openSync(lockPath, "wx");
          fs.writeSync(this.lockFd, String(process.pid));
          return true;
        }
      } catch {}

      return false;
    }
  }

  async db(name: string): Promise<LioranDB> {
    if (this.mode === ProcessMode.CLIENT) {
      await dbQueue.exec("db", { db: name });
      return new IPCDatabase(name) as any;
    }

    return this.openDatabase(name);
  }

  async openDatabase(name: string): Promise<LioranDB> {
    this._assertOpen();

    if (this.openDBs.has(name)) {
      return this.openDBs.get(name)!;
    }

    const dbPath = path.join(this.rootPath, name);
    await fs.promises.mkdir(dbPath, { recursive: true });

    const db = new LioranDB(dbPath, name, this);
    this.openDBs.set(name, db);
    return db;
  }

  async closeAll(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.mode === ProcessMode.CLIENT) {
      await dbQueue.shutdown();
      return;
    }

    for (const db of this.openDBs.values()) {
      try { await db.close(); } catch {}
    }

    this.openDBs.clear();

    try {
      if (this.lockFd) fs.closeSync(this.lockFd);
      fs.unlinkSync(path.join(this.rootPath, ".lioran.lock"));
    } catch {}

    await this.ipcServer?.close();
  }

  async close(): Promise<void> {
    return this.closeAll();
  }

  private _registerShutdownHooks() {
    const shutdown = async () => {
      await this.closeAll();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("exit", shutdown);
  }

  private _assertOpen() {
    if (this.closed) {
      throw new Error("LioranManager is closed");
    }
  }
}

/* ---------------- IPC PROXY DB ---------------- */

class IPCDatabase {
  constructor(private name: string) {}

  collection(name: string) {
    return new IPCCollection(this.name, name);
  }
}

class IPCCollection {
  constructor(
    private db: string,
    private col: string
  ) {}

  private call(method: string, params: any[]) {
    return dbQueue.exec("op", {
      db: this.db,
      col: this.col,
      method,
      params
    });
  }

  insertOne = (doc: any) => this.call("insertOne", [doc]);
  insertMany = (docs: any[]) => this.call("insertMany", [docs]);
  find = (query?: any) => this.call("find", [query]);
  findOne = (query?: any) => this.call("findOne", [query]);
  updateOne = (filter: any, update: any, options?: any) =>
    this.call("updateOne", [filter, update, options]);
  updateMany = (filter: any, update: any) =>
    this.call("updateMany", [filter, update]);
  deleteOne = (filter: any) => this.call("deleteOne", [filter]);
  deleteMany = (filter: any) => this.call("deleteMany", [filter]);
  countDocuments = (filter?: any) =>
    this.call("countDocuments", [filter]);
}