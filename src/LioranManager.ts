import path from "path";
import fs from "fs";
import process from "process";
import { LioranDB } from "./core/database.js";
import type { LioranDBRuntimeOptions } from "./core/database.js";
import { setEncryptionKey } from "./utils/encryption.js";
import { getDefaultRootPath } from "./utils/rootpath.js";
import { LifecycleManager } from "./utils/lifecycle.js";
import { LiorandbError, asLiorandbError } from "./utils/errors.js";
import {
  createIncrementalBackupArchive,
  filterWALForPITR,
  readIncrementalBackupArchive,
  type CreateIncrementalBackupOptions,
  type IncrementalBackupManifest,
  type ApplyIncrementalBackupOptions
} from "./backup/incremental.js";

/* ---------------- PROCESS MODE ---------------- */

enum ProcessMode {
  PRIMARY = "primary",
  CLIENT = "client",
  READONLY = "readonly",
  REPLICA = "replica"
}

/* ---------------- OPTIONS ---------------- */

export interface LioranManagerOptions {
  rootPath?: string;
  encryptionKey?: string | Buffer;
  ipc?: "primary" | "client" | "readonly" | "replica";
  writeQueue?: {
    maxSize?: number;
    mode?: "wait" | "reject";
    timeoutMs?: number;
    memoryPressure?: {
      enabled?: boolean;
      pollMs?: number;
      mode?: "heap_ratio" | "rss_mb";
      highWaterMark?: number;
      lowWaterMark?: number;
      rssMaxMB?: number;
      rssResumeMB?: number;
    };
  };
  batch?: {
    chunkSize?: number;
  };
  durability?: LioranDBRuntimeOptions["durability"];
  replication?: {
    leaderRootPath?: string;
    pollMs?: number;
    batchLimit?: number;
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
  private ipcServer?: import("./ipc/pipe.js").IPCServer;
  private ipcClient?: import("./ipc/pipe.js").IPCClient;
  private replicaReplicator?: import("./replication/replicator.js").ReplicaReplicator;

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
    } else if (ipc === "replica") {
      this.mode = ProcessMode.REPLICA;
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
      void this._ensureIpcServer();
    }

    if (this.mode === ProcessMode.REPLICA) {
      void this._ensureReplicaReplicator();
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

  isReplica() {
    return this.mode === ProcessMode.REPLICA;
  }

  /* ---------------- QUEUE HELPER ---------------- */

  private async getQueue() {
    const leaderRootPath = this.options.replication?.leaderRootPath ?? this.rootPath;
    if (!this.ipcClient) {
      const { IPCClient } = await import("./ipc/pipe.js");
      this.ipcClient = new IPCClient(leaderRootPath);
      this.lifecycle.register(() => this.ipcClient?.close());
    }
    return this.ipcClient;
  }

  async _ipcExec(action: import("./ipc/queue.js").IPCAction, args: any) {
    const q = await this.getQueue();
    return q.exec(action, args);
  }

  private async _ensureIpcServer() {
    if (this.ipcServer) return;
    const { IPCServer } = await import("./ipc/pipe.js");
    this.ipcServer = new IPCServer(this, this.rootPath);
    await this.ipcServer.start();
    this.lifecycle.register(() => this.ipcServer?.close());
  }

  private async _ensureReplicaReplicator() {
    if (this.replicaReplicator) return;
    const { ReplicaReplicator } = await import("./replication/replicator.js");
    const leaderRootPath = this.options.replication?.leaderRootPath ?? this.rootPath;
    this.replicaReplicator = new ReplicaReplicator(this, {
      leaderRootPath,
      pollMs: Math.max(10, Math.trunc(this.options.replication?.pollMs ?? 50)),
      batchLimit: Math.max(1, Math.trunc(this.options.replication?.batchLimit ?? 10_000))
    });
    this.lifecycle.register(() => this.replicaReplicator?.stop());
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
      return new IPCDatabase(name, (action, args) => queue.exec(action, args)) as any;
    }

    return this.openDatabase(name);
  }

  async openDatabase(name: string): Promise<LioranDB> {
    try {
      this._assertOpen();

      if (this.openDBs.has(name)) {
        return this.openDBs.get(name)!;
      }

      const dbPath = path.join(this.rootPath, name);
      await fs.promises.mkdir(dbPath, { recursive: true });

      const db = new LioranDB(dbPath, name, this, {
        writeQueue: this.options.writeQueue,
        batch: this.options.batch,
        durability: this.options.durability
      });
      await db.ready;
      this.openDBs.set(name, db);

      if (this.mode === ProcessMode.REPLICA) {
        await this._ensureReplicaReplicator();
        this.replicaReplicator?.ensure(name, db);
      }
      return db;
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to open database",
        details: { db: name, rootPath: this.rootPath }
      });
    }
  }

  /* ---------------- SNAPSHOT ---------------- */

  async snapshot(snapshotPath: string) {
    try {
    if (this.mode === ProcessMode.CLIENT) {
      const queue = await this.getQueue();
      return queue.exec("snapshot", { path: snapshotPath });
    }

    if (this.mode === ProcessMode.READONLY) {
      throw new LiorandbError("READONLY_MODE", "Snapshot not allowed in readonly mode");
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
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Snapshot failed",
        details: { snapshotPath }
      });
    }
  }

  /* ---------------- RESTORE ---------------- */

  async restore(snapshotPath: string) {
    try {
    if (this.mode === ProcessMode.CLIENT) {
      const queue = await this.getQueue();
      return queue.exec("restore", { path: snapshotPath });
    }

    if (this.mode === ProcessMode.READONLY) {
      throw new LiorandbError("READONLY_MODE", "Restore not allowed in readonly mode");
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
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Restore failed",
        details: { snapshotPath }
      });
    }
  }

  /* ---------------- INCREMENTAL BACKUP ---------------- */

  async incrementalBackup(
    backupPath: string,
    options: CreateIncrementalBackupOptions = {}
  ): Promise<IncrementalBackupManifest> {
    try {
      if (this.mode === ProcessMode.CLIENT) {
        const queue = await this.getQueue();
        return queue.exec("backup:incremental", { path: backupPath, options });
      }

      if (this.mode === ProcessMode.READONLY) {
        throw new LiorandbError("READONLY_MODE", "Incremental backup not allowed in readonly mode");
      }

      for (const db of this.openDBs.values()) {
        try {
          await db.wal?.flush?.();
        } catch {}
        try {
          await db.close();
        } catch {}
      }
      this.openDBs.clear();

      return await createIncrementalBackupArchive(this.rootPath, backupPath, options);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Incremental backup failed",
        details: { backupPath }
      });
    }
  }

  async applyIncrementalBackup(
    backupPath: string,
    options: ApplyIncrementalBackupOptions = {}
  ): Promise<Record<string, number>> {
    try {
      if (this.mode === ProcessMode.CLIENT) {
        const queue = await this.getQueue();
        return queue.exec("backup:apply", { path: backupPath, options });
      }

      if (this.mode === ProcessMode.READONLY) {
        throw new LiorandbError("READONLY_MODE", "Applying backups not allowed in readonly mode");
      }

      const { recordsByDb } = await readIncrementalBackupArchive(backupPath);
      const appliedCheckpointByDb: Record<string, number> = {};

      for (const [dbName, records] of Object.entries(recordsByDb)) {
        const db = await this.openDatabase(dbName);
        const filtered = filterWALForPITR(records, options.untilTimeMs);
        await db.applyReplicatedWAL(filtered);
        appliedCheckpointByDb[dbName] = db.getCheckpointLSN();
      }

      return appliedCheckpointByDb;
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Apply incremental backup failed",
        details: { backupPath }
      });
    }
  }

  /* ---------------- SHUTDOWN ---------------- */

  async closeAll(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.mode === ProcessMode.CLIENT) {
      try {
        await this.ipcClient?.close();
      } catch {}
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
      throw new LiorandbError("CLOSED", "LioranManager is closed");
    }
  }
}

/* ---------------- IPC PROXY DB ---------------- */

class IPCDatabase {
  constructor(
    private name: string,
    private exec: (action: import("./ipc/queue.js").IPCAction, args: any) => Promise<any>
  ) {}

  collection(name: string) {
    return new IPCCollection(this.name, name, this.exec);
  }

  private async call(method: string, params: any[]) {
    return this.exec("db:meta", {
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
    private col: string,
    private exec: (action: import("./ipc/queue.js").IPCAction, args: any) => Promise<any>
  ) {}

  private async call(method: string, params: any[]) {
    return this.exec("op", {
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
