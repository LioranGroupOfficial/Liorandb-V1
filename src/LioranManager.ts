import path from "path";
import fs from "fs";
import process from "process";
import { LioranDB } from "./core/database.js";
import { setEncryptionKey } from "./utils/encryption.js";
import { getDefaultRootPath } from "./utils/rootpath.js";
import { dbQueue } from "./ipc/queue.js";
import { IPCServer } from "./ipc/server.js";

/* ---------------- PROCESS MODE ---------------- */

enum ProcessMode {
  PRIMARY = "primary",
  CLIENT = "client",
  READONLY = "readonly"
}

/* ---------------- OPTIONS ---------------- */

export interface LioranManagerOptions {
  rootPath?: string;
  encryptionKey?: string | Buffer;
  ipc?: "primary" | "client" | "readonly";
}

/* ---------------- MANAGER ---------------- */

export class LioranManager {
  rootPath: string;
  openDBs: Map<string, LioranDB>;
  private closed = false;
  private mode: ProcessMode;
  private lockFd?: number;
  private ipcServer?: IPCServer;

  constructor(options: LioranManagerOptions = {}) {
    const { rootPath, encryptionKey, ipc } = options;

    this.rootPath = rootPath || getDefaultRootPath();

    if (!fs.existsSync(this.rootPath)) {
      fs.mkdirSync(this.rootPath, { recursive: true });
    }

    if (encryptionKey) {
      setEncryptionKey(encryptionKey);
    }

    this.openDBs = new Map();

    /* ---------------- MODE RESOLUTION ---------------- */

    if (ipc === "readonly") {
      this.mode = ProcessMode.READONLY;
    } else if (ipc === "client") {
      this.mode = ProcessMode.CLIENT;
    } else if (ipc === "primary") {
      this.mode = ProcessMode.PRIMARY;
    } else {
      // default auto-detect (backward compatible)
      this.mode = this.tryAcquireLock()
        ? ProcessMode.PRIMARY
        : ProcessMode.CLIENT;
    }

    if (this.mode === ProcessMode.PRIMARY) {
      this.ipcServer = new IPCServer(this, this.rootPath);
      this.ipcServer.start();
      this._registerShutdownHooks();
    }
  }

  /* ---------------- MODE HELPERS ---------------- */

  isPrimary() {
    return this.mode === ProcessMode.PRIMARY;
  }

  isClient() {
    return this.mode === ProcessMode.CLIENT;
  }

  isReadOnly() {
    return this.mode === ProcessMode.READONLY;
  }

  /* ---------------- LOCK MANAGEMENT ---------------- */

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

  /* ---------------- DB OPEN ---------------- */

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

  /* ---------------- SNAPSHOT ---------------- */

  async snapshot(snapshotPath: string) {
    if (this.mode === ProcessMode.CLIENT) {
      return dbQueue.exec("snapshot", { path: snapshotPath });
    }

    if (this.mode === ProcessMode.READONLY) {
      throw new Error("Snapshot not allowed in readonly mode");
    }

    for (const db of this.openDBs.values()) {
      for (const col of db.collections.values()) {
        try { await col.db.close(); } catch {}
      }
    }

    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });

    const tar = await import("tar");

    await tar.c({
      gzip: true,
      file: snapshotPath,
      cwd: this.rootPath,
      portable: true
    }, ["./"]);

    return true;
  }

  /* ---------------- RESTORE ---------------- */

  async restore(snapshotPath: string) {
    if (this.mode === ProcessMode.CLIENT) {
      return dbQueue.exec("restore", { path: snapshotPath });
    }

    if (this.mode === ProcessMode.READONLY) {
      throw new Error("Restore not allowed in readonly mode");
    }

    await this.closeAll();

    fs.rmSync(this.rootPath, { recursive: true, force: true });
    fs.mkdirSync(this.rootPath, { recursive: true });

    const tar = await import("tar");

    await tar.x({
      file: snapshotPath,
      cwd: this.rootPath
    });

    console.log("Restore completed. Restart required.");
    process.exit(0);
  }

  /* ---------------- SHUTDOWN ---------------- */

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

    // Only primary owns lock + IPC
    if (this.mode === ProcessMode.PRIMARY) {
      try {
        if (this.lockFd) fs.closeSync(this.lockFd);
        fs.unlinkSync(path.join(this.rootPath, ".lioran.lock"));
      } catch {}

      await this.ipcServer?.close();
    }
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