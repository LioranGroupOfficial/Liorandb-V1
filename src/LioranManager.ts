import path from "path";
import fs from "fs";
import process from "process";
import { LioranDB } from "./core/database.js";
import type { LioranDBRuntimeOptions } from "./core/database.js";
import { setEncryptionKey } from "./utils/encryption.js";
import { getDefaultRootPath } from "./utils/rootpath.js";
import { LifecycleManager } from "./utils/lifecycle.js";
import { LiorandbError, asLiorandbError } from "./utils/errors.js";
import { Mutex } from "./utils/mutex.js";
import { GlobalCacheEngine, type GlobalCacheConfig } from "./core/cacheEngine.js";
import { ClusterController, type ClusterNodeConfig } from "./cluster/controller.js";
import type { ReplicationCoordinator } from "./replication/coordinator.js";
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
  cluster?: Omit<ClusterNodeConfig, "enabled"> & { enabled?: boolean };
  cache?: Partial<GlobalCacheConfig> & { maxRAMMB?: number };
  /**
   * Optional override for how many CPU cores to use for worker-thread pools.
   * Defaults to `os.cpus().length` (minimum 2).
   */
  cores?: number;
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
  storage?: LioranDBRuntimeOptions["storage"];
  latency?: LioranDBRuntimeOptions["latency"];
  sharding?: LioranDBRuntimeOptions["sharding"];
  replication?: {
    leaderRootPath?: string;
    pollMs?: number;
    batchLimit?: number;
    walStream?: { host: string; port: number };
  };
}

/* ---------------- MANAGER ---------------- */

export class LioranManager {
  rootPath: string;
  openDBs: Map<string, LioranDB>;
  public readonly cache: GlobalCacheEngine;
  private closed = false;
  private mode: ProcessMode;
  private lockFd?: number;
  private lifecycle = new LifecycleManager();
  private options: LioranManagerOptions;
  private opsMutex = new Mutex();
  private shutdownHookCleanup?: () => void;
  private ipcServer?: import("./ipc/pipe.js").IPCServer;
  private ipcClient?: import("./ipc/pipe.js").IPCClient;
  private replicaReplicator?: import("./replication/replicator.js").ReplicaReplicator;
  private clusterController?: ClusterController;
  private replicationCoordinator?: ReplicationCoordinator;
  private clusterLeader: { id: string; host: string; walStreamPort: number } | null = null;

  constructor(options: LioranManagerOptions = {}) {
    const { rootPath, encryptionKey, ipc } = options;
    this.options = options;
    this.cache = new GlobalCacheEngine(options.cache);

    this.rootPath = rootPath || getDefaultRootPath();

    if (!fs.existsSync(this.rootPath)) {
      fs.mkdirSync(this.rootPath, { recursive: true });
    }

    if (encryptionKey) {
      setEncryptionKey(encryptionKey);
    }

    this.openDBs = new Map();

    /* ---------------- MODE RESOLUTION ---------------- */

    if (options.cluster?.enabled) {
      // Cluster mode: role is controlled by Raft (see ClusterController).
      // Start as follower/replica until a leader is elected.
      this.mode = ProcessMode.REPLICA;
      this._registerShutdownHooks();
      void this._ensureIpcServer();
      void this._ensureReplicaReplicator();
      void this._ensureClusterController();
      return;
    }

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

  _setReplicationCoordinator(coord: ReplicationCoordinator) {
    this.replicationCoordinator = coord;
  }

  async _awaitReplicationMajority(dbName: string, lsn: number): Promise<void> {
    await this.replicationCoordinator?.awaitMajority(dbName, lsn);
  }

  _setClusterLeader(leader: { id: string; host: string; walStreamPort: number } | null) {
    this.clusterLeader = leader;
  }

  private async _ensureClusterController() {
    if (this.clusterController) return;
    const c = this.options.cluster;
    if (!c?.enabled) return;

    this.clusterController = new ClusterController(this, {
      enabled: true,
      nodeId: c.nodeId,
      host: c.host,
      raftPort: c.raftPort,
      walStreamPort: c.walStreamPort,
      peers: c.peers ?? [],
      heartbeatMs: c.heartbeatMs,
      electionTimeoutMs: c.electionTimeoutMs,
      waitForMajority: c.waitForMajority,
      waitTimeoutMs: c.waitTimeoutMs
    });

    await this.clusterController.start();
    this.lifecycle.register(() => this.clusterController?.close());
  }

  async _becomeClusterLeader() {
    if (this.mode === ProcessMode.PRIMARY) return;
    this.mode = ProcessMode.PRIMARY;

    try { this.replicaReplicator?.stop(); } catch {}
    this.replicaReplicator = undefined;

    // Reopen DBs in primary mode (constructor captures role).
    await this.closeAll();

    this._registerShutdownHooks();
    await this._ensureIpcServer();
  }

  async _becomeClusterFollower(leaderHost: string, walStreamPort: number) {
    this.mode = ProcessMode.REPLICA;

    this.options.replication = {
      ...(this.options.replication ?? {}),
      walStream: { host: leaderHost, port: walStreamPort }
    };

    // Reopen DBs in replica mode (constructor captures role).
    await this.closeAll();

    // Reset and restart replicator against the new leader.
    try { this.replicaReplicator?.stop(); } catch {}
    this.replicaReplicator = undefined;
    await this._ensureReplicaReplicator();
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
      batchLimit: Math.max(1, Math.trunc(this.options.replication?.batchLimit ?? 10_000)),
      walStream: this.options.replication?.walStream
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
        durability: this.options.durability,
        storage: this.options.storage,
        latency: this.options.latency,
        sharding: this.options.sharding
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

    return await this.opsMutex.runExclusive(async () => {
      for (const db of this.openDBs.values()) {
        try {
          await db.wal?.flush?.();
        } catch {}
        try {
          await db.close();
        } catch {}
      }
      this.openDBs.clear();

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
    });
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

    await this.opsMutex.runExclusive(async () => {
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
    });
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

      return await this.opsMutex.runExclusive(async () => {
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
      });
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

      return await this.opsMutex.runExclusive(async () => {
        const { recordsByDb } = await readIncrementalBackupArchive(backupPath);
        const appliedCheckpointByDb: Record<string, number> = {};

        for (const [dbName, records] of Object.entries(recordsByDb)) {
          const db = await this.openDatabase(dbName);
          const filtered = filterWALForPITR(records, options.untilTimeMs);
          await db.applyReplicatedWAL(filtered);
          appliedCheckpointByDb[dbName] = db.getCheckpointLSN();
        }

        return appliedCheckpointByDb;
      });
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Apply incremental backup failed",
        details: { backupPath }
      });
    }
  }

  async _withOpsLock<R>(task: () => Promise<R>): Promise<R> {
    return this.opsMutex.runExclusive(task);
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

    try {
      this.cache.close();
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
  maintenance = (options?: { aggressive?: boolean }) =>
    this.call("maintenance", [options ?? {}]);
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
