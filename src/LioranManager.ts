import path from "path";
import fs from "fs";
import process from "process";
import { LioranDB } from "./core/database.js";
import { setEncryptionKey } from "./utils/encryption.js";
import { getDefaultRootPath } from "./utils/rootpath.js";
import { LifecycleManager } from "./utils/lifecycle.js";

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
  writeQueue?: {
    maxSize?: number;
    mode?: "wait" | "reject";
    timeoutMs?: number;
    memoryPressure?: {
      enabled?: boolean;
      pollMs?: number;
      highWaterMark?: number;
      lowWaterMark?: number;
    };
  };
  batch?: {
    chunkSize?: number;
  };
}

/* ---------------- MANAGER ---------------- */

export class LioranManager {
  rootPath: string;
  openDBs: Map<string, LioranDB>;
  private closed = false;
  private mode: ProcessMode;
  private lockFd?: number;
  private lifecycle = new LifecycleManager();
  private options: LioranManagerOptions;
  private shutdownHookCleanup?: () => void;

  constructor(options: LioranManagerOptions = {}) {
    const { rootPath, encryptionKey, ipc } = options;
    this.options = options;

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
      this.tryAcquireLock();
    } else {
      // auto-detect (default behavior)
      this.mode = this.tryAcquireLock()
        ? ProcessMode.PRIMARY
        : ProcessMode.CLIENT;
    }

    if (this.mode === ProcessMode.PRIMARY) {
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

  /* ---------------- QUEUE HELPER ---------------- */

  private async getQueue() {
    const { dbQueue } = await import("./ipc/queue.js");
    return dbQueue;
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
      this.lifecycle.register(() => {
        try {
          if (this.lockFd) fs.closeSync(this.lockFd);
        } catch {}
        try {
          fs.unlinkSync(lockPath);
        } catch {}
      });
      return true;
    } catch {
      try {
        const pid = Number(fs.readFileSync(lockPath, "utf8"));
        if (!this.isProcessAlive(pid)) {
          fs.unlinkSync(lockPath);
          this.lockFd = fs.openSync(lockPath, "wx");
          fs.writeSync(this.lockFd, String(process.pid));
          this.lifecycle.register(() => {
            try {
              if (this.lockFd) fs.closeSync(this.lockFd);
            } catch {}
            try {
              fs.unlinkSync(lockPath);
            } catch {}
          });
          return true;
        }
      } catch {}
      return false;
    }
  }

  /* ---------------- DB OPEN ---------------- */

  async db(name: string): Promise<LioranDB> {
    if (this.mode === ProcessMode.CLIENT) {
      const queue = await this.getQueue();
      await queue.exec("db", { db: name });
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

    const db = new LioranDB(dbPath, name, this, {
      writeQueue: this.options.writeQueue,
      batch: this.options.batch
    });
    await db.ready;
    this.openDBs.set(name, db);
    return db;
  }

  /* ---------------- SNAPSHOT ---------------- */

  async snapshot(snapshotPath: string) {
    if (this.mode === ProcessMode.CLIENT) {
      const queue = await this.getQueue();
      return queue.exec("snapshot", { path: snapshotPath });
    }

    if (this.mode === ProcessMode.READONLY) {
      throw new Error("Snapshot not allowed in readonly mode");
    }

    for (const db of this.openDBs.values()) {
      try {
        await db.close();
      } catch {}
    }

    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });

    const tar = await import("tar");

    await tar.c(
      {
        gzip: true,
        file: snapshotPath,
        cwd: this.rootPath,
        portable: true
      },
      ["./"]
    );

    return true;
  }

  /* ---------------- RESTORE ---------------- */

  async restore(snapshotPath: string) {
    if (this.mode === ProcessMode.CLIENT) {
      const queue = await this.getQueue();
      return queue.exec("restore", { path: snapshotPath });
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
      const queue = await this.getQueue();
      await queue.shutdown();
      return;
    }

    for (const db of this.openDBs.values()) {
      try {
        await db.close();
      } catch {}
    }

    this.openDBs.clear();

    try {
      await this.lifecycle.close();
    } catch {}
  }

  async close(): Promise<void> {
    return this.closeAll();
  }

  private _registerShutdownHooks() {
    const shutdown = async () => {
      await this.closeAll();
    };

    const onSigint = () => void shutdown();
    const onSigterm = () => void shutdown();
    const onBeforeExit = () => void shutdown();

    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.once("beforeExit", onBeforeExit);

    this.shutdownHookCleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      process.off("beforeExit", onBeforeExit);
    };

    this.lifecycle.register(() => {
      try {
        this.shutdownHookCleanup?.();
      } catch {}
    });
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

  private async getQueue() {
    const { dbQueue } = await import("./ipc/queue.js");
    return dbQueue;
  }

  private async call(method: string, params: any[]) {
    const queue = await this.getQueue();
    return queue.exec("db:meta", {
      db: this.name,
      method,
      params
    });
  }

  explain = (collection: string, query?: any, options?: any) =>
    this.call("explain", [collection, query, options]);
  rotateEncryptionKey = (newKey: string | Buffer) =>
    this.call("rotateEncryptionKey", [newKey]);
}

class IPCCollection {
  constructor(
    private db: string,
    private col: string
  ) {}

  private async getQueue() {
    const { dbQueue } = await import("./ipc/queue.js");
    return dbQueue;
  }

  private async call(method: string, params: any[]) {
    const queue = await this.getQueue();
    return queue.exec("op", {
      db: this.db,
      col: this.col,
      method,
      params
    });
  }

  insertOne = (doc: any) => this.call("insertOne", [doc]);
  insertMany = (docs: any[]) => this.call("insertMany", [docs]);
  find = (query?: any, options?: any) => this.call("find", [query, options]);
  findOne = (query?: any, options?: any) => this.call("findOne", [query, options]);
  aggregate = (pipeline: any[]) => this.call("aggregate", [pipeline]);
  explain = (query?: any, options?: any) => this.call("explain", [query, options]);
  updateOne = (filter: any, update: any, options?: any) =>
    this.call("updateOne", [filter, update, options]);
  updateMany = (filter: any, update: any) =>
    this.call("updateMany", [filter, update]);
  deleteOne = (filter: any) => this.call("deleteOne", [filter]);
  deleteMany = (filter: any) => this.call("deleteMany", [filter]);
  countDocuments = (filter?: any) =>
    this.call("countDocuments", [filter]);
  count = () => this.call("count", []);
}
