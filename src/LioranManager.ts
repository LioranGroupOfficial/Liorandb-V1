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
import { MetricsCollector } from "./metrics/collector.js";
import { BackgroundScheduler, type BackgroundSchedulerOptions } from "./background/scheduler.js";
import { AdmissionController, type AdmissionConfig } from "./utils/admission.js";
import { IPCWorkerPool } from "./ipc/pool.js";
import { resolveTenantLimits, type TenantLimits, type TenancyConfig } from "./utils/tenancy.js";
import { SecurityContextManager, type Principal } from "./security/context.js";
import { defaultAuthorize, type AuthorizeHook, type SecurityAction } from "./security/authorize.js";
import { AuditSink } from "./audit/sink.js";
import { ClusterRPCClient } from "./cluster/clientRpc.js";
import { isMainThread } from "worker_threads";
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
  background?: BackgroundSchedulerOptions;
  sharding?: LioranDBRuntimeOptions["sharding"];
  replication?: {
    leaderRootPath?: string;
    pollMs?: number;
    batchLimit?: number;
    walStream?: { host: string; port: number };
  };
  slo?: {
    maxTenants?: number;
    read?: AdmissionConfig;
    write?: AdmissionConfig;
    maintenance?: AdmissionConfig;
    perTenant?: {
      enabled?: boolean;
      read?: AdmissionConfig;
      write?: AdmissionConfig;
      maintenance?: AdmissionConfig;
    };
  };
  compute?: {
    enabled?: boolean;
  };
  consistency?: {
    reads?: {
      /**
       * - stale_ok: always serve reads from local node.
       * - bounded_stale: serve from replicas only if lag is within bounds.
       * - leader_only: replicas reject reads (client must talk to leader).
       */
      mode?: "stale_ok" | "bounded_stale" | "leader_only";
      maxLagLSN?: number;
      maxLagMs?: number;
      /**
       * If true, bounded_stale will fall back to stale_ok instead of throwing.
       */
      autoDegradeToStaleOk?: boolean;
    };
  };
  tenancy?: TenancyConfig;
  security?: {
    enabled?: boolean;
    authorize?: AuthorizeHook;
    audit?: {
      enabled?: boolean;
      dir?: string;
      flushDelayMs?: number;
      redact?: import("./audit/sink.js").AuditSinkOptions["redact"];
    };
  };
}

/* ---------------- MANAGER ---------------- */

export class LioranManager {
  rootPath: string;
  openDBs: Map<string, LioranDB>;
  public readonly cache: GlobalCacheEngine;
  public readonly metrics: MetricsCollector;
  public readonly admission: AdmissionController;
  private computePool?: IPCWorkerPool;
  private tenantLimitsCache = new Map<string, TenantLimits>();
  private securityCtx = new SecurityContextManager();
  private authorizeHook: AuthorizeHook;
  private auditSink?: AuditSink;
  private auditUnsubByDb = new Map<string, () => void>();
  private backgroundScheduler?: BackgroundScheduler;
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
  private clusterLeader: { id: string; host: string; walStreamPort: number; clientPort: number } | null = null;
  private clusterRpcClient?: ClusterRPCClient;

  constructor(options: LioranManagerOptions = {}) {
    const { rootPath, encryptionKey, ipc } = options;
    this.options = options;
    this.cache = new GlobalCacheEngine(options.cache);
    this.metrics = new MetricsCollector();
    this.admission = new AdmissionController({
      maxTenants: options.slo?.maxTenants,
      read: options.slo?.read,
      write: options.slo?.write,
      maintenance: options.slo?.maintenance
    });

    this.rootPath = rootPath || getDefaultRootPath();

    if (!fs.existsSync(this.rootPath)) {
      fs.mkdirSync(this.rootPath, { recursive: true });
    }

    if (encryptionKey) {
      setEncryptionKey(encryptionKey);
    }

    this.openDBs = new Map();

    this.authorizeHook = options.security?.authorize ?? defaultAuthorize;
    if (options.security?.audit?.enabled) {
      const dir = options.security.audit.dir ?? path.join(this.rootPath, "__audit");
      this.auditSink = new AuditSink({
        dir,
        flushDelayMs: options.security.audit.flushDelayMs,
        redact: options.security.audit.redact
      });
      this.lifecycle.register(() => this.auditSink?.close());
    }

    /* ---------------- MODE RESOLUTION ---------------- */

    if (options.cluster?.enabled) {
      // Cluster mode: role is controlled by Raft (see ClusterController).
      // Start as follower/replica until a leader is elected.
      this.mode = ProcessMode.REPLICA;
      this._registerShutdownHooks();
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
      this._ensureBackgroundScheduler();
      this._ensureComputePool();
    }

    if (this.mode === ProcessMode.REPLICA) {
      void this._ensureReplicaReplicator();
    }
  }

  withPrincipal<T>(principal: Principal, task: () => Promise<T>): Promise<T> {
    return this.securityCtx.withPrincipal(principal, task);
  }

  _authorize(action: SecurityAction, resource: { db?: string; collection?: string; op?: string }, okIfDisabled = true) {
    const enabled = this.options.security?.enabled ?? false;
    if (!enabled) {
      if (!okIfDisabled) {
        throw new LiorandbError("VALIDATION_FAILED", "Security is disabled");
      }
      return;
    }
    const principal = this.securityCtx.currentPrincipal();
    try {
      this.authorizeHook(principal, action, resource);
      this._auditSecurity(action, { db: resource.db, collection: resource.collection, ok: true });
    } catch (err: any) {
      this._auditSecurity(action, { db: resource.db, collection: resource.collection, ok: false, reason: err?.message ? String(err.message) : undefined });
      throw err;
    }
  }

  _auditSecurity(action: string, info: { db?: string; collection?: string; ok: boolean; reason?: string }) {
    const principal = this.securityCtx.currentPrincipal();
    this.auditSink?.append({
      t: Date.now(),
      kind: "security",
      action,
      db: info.db,
      collection: info.collection,
      principalId: principal?.id,
      ok: info.ok,
      reason: info.reason
    });
  }

  _getTenantLimits(tenantId?: string): TenantLimits {
    const tid = String(tenantId ?? this.admission.currentTenantId() ?? "default");
    const cached = this.tenantLimitsCache.get(tid);
    if (cached) return cached;
    const resolved = resolveTenantLimits(this.options.tenancy, tid);
    this.tenantLimitsCache.set(tid, resolved);
    // Keep cache bounded (best-effort)
    if (this.tenantLimitsCache.size > 10_000) {
      const first = this.tenantLimitsCache.keys().next().value as string | undefined;
      if (first) this.tenantLimitsCache.delete(first);
    }
    return resolved;
  }

  private _ensureComputePool() {
    if (this.computePool) return;
    if (this.options.compute?.enabled === false) return;
    this.computePool = new IPCWorkerPool(this.options.cores);
    this.computePool.start();
    this.lifecycle.register(() => this.computePool?.shutdown());
  }

  withTenant<T>(tenantId: string, task: () => Promise<T>): Promise<T> {
    return this.admission.withTenant(tenantId, task);
  }

  _admit<T>(kind: import("./utils/admission.js").AdmissionKind, task: () => Promise<T>, ctx?: { dbName?: string }): Promise<T> {
    const perTenant = this.options.slo?.perTenant;
    const perTenantCfg: AdmissionConfig | undefined =
      kind === "read"
        ? perTenant?.read
        : kind === "write"
          ? perTenant?.write
          : perTenant?.maintenance;

    return this.admission.run(kind, () => {
      if (kind === "read") {
        return this._guardRead(task as any, ctx?.dbName) as any;
      }
      return task();
    }, {
      perTenant: perTenant?.enabled ? { ...(perTenantCfg ?? {}), enabled: true } : undefined
    });
  }

  private _guardRead<T>(task: () => Promise<T>, dbName?: string): Promise<T> {
    // Only meaningful in replica mode (followers).
    if (!this.isReplica()) return task();

    const mode = this.options.consistency?.reads?.mode ?? "stale_ok";
    if (mode === "stale_ok") return task();

    const leader = this.clusterLeader;
    if (mode === "leader_only") {
      throw new LiorandbError("NOT_LEADER", "Reads must be sent to leader", {
        details: { leader }
      });
    }

    // bounded_stale
    const maxLagLSN = Math.max(0, Math.trunc(this.options.consistency?.reads?.maxLagLSN ?? 0));
    const maxLagMs = Math.max(0, Math.trunc(this.options.consistency?.reads?.maxLagMs ?? 0));
    const autoDegrade = !!this.options.consistency?.reads?.autoDegradeToStaleOk;

    if (!dbName) {
      return autoDegrade ? task() : Promise.reject(new LiorandbError("INTERNAL", "bounded_stale requires dbName context"));
    }

    const snap = this.metrics.snapshot(dbName)?.replication ?? {};
    const lagLSN = Math.max(0, Math.trunc((snap as any).replicaWalLag ?? 0));
    const lagMs = Math.max(0, Math.trunc((snap as any).replicaDelayMs ?? 0));

    const tooFarLSN = maxLagLSN > 0 && lagLSN > maxLagLSN;
    const tooFarMs = maxLagMs > 0 && lagMs > maxLagMs;

    if (tooFarLSN || tooFarMs) {
      if (autoDegrade) return task();
      throw new LiorandbError("STALE_READ", "Replica is too far behind leader", {
        details: { leader, db: dbName, lagLSN, lagMs, maxLagLSN, maxLagMs }
      });
    }

    return task();
  }

  private _ensureBackgroundScheduler() {
    if (this.backgroundScheduler) return;
    this.backgroundScheduler = new BackgroundScheduler(this, this.options.background ?? {});
    this.backgroundScheduler.start();
    this.lifecycle.register(() => this.backgroundScheduler?.close());
  }

  private async _stopPrimaryServices(): Promise<void> {
    // In cluster mode, leadership can change; ensure only the current leader runs primary-only services.
    try {
      await this.backgroundScheduler?.close();
    } catch {}
    this.backgroundScheduler = undefined;

    try {
      await this.computePool?.shutdown();
    } catch {}
    this.computePool = undefined;

    try {
      await this.ipcServer?.close();
    } catch {}
    this.ipcServer = undefined;
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

  _setClusterLeader(leader: { id: string; host: string; walStreamPort: number; clientPort: number } | null) {
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
      clientPort: (c as any).clientPort,
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
    await this._closeDatabasesOnly();

    this._registerShutdownHooks();
    await this._ensureIpcServer();
    this._ensureBackgroundScheduler();
    this._ensureComputePool();
  }

  async _becomeClusterFollower(leaderHost: string, walStreamPort: number) {
    if (this.mode === ProcessMode.PRIMARY) {
      await this._stopPrimaryServices();
    }
    this.mode = ProcessMode.REPLICA;

    this.options.replication = {
      ...(this.options.replication ?? {}),
      walStream: { host: leaderHost, port: walStreamPort }
    };

    // Reset and restart replicator against the new leader.
    try { this.replicaReplicator?.stop(); } catch {}
    this.replicaReplicator = undefined;
    await this._ensureReplicaReplicator();

    // Ensure already-open DBs subscribe to the new leader stream.
    const r: any = this.replicaReplicator as any;
    for (const [name, db] of this.openDBs.entries()) {
      try { r?.ensure?.(name, db as any); } catch {}
    }
  }

  private async _closeDatabasesOnly(): Promise<void> {
    // Used for cluster role changes; must NOT close lifecycle/cache or mark manager closed.
    for (const db of this.openDBs.values()) {
      try { await db.close(); } catch {}
    }
    this.openDBs.clear();
    for (const unsub of this.auditUnsubByDb.values()) {
      try { unsub(); } catch {}
    }
    this.auditUnsubByDb.clear();
  }

  async _compute<T>(task: any): Promise<T> {
    if (!this.computePool) {
      this._ensureComputePool();
    }
    if (!this.computePool) {
      return task as T;
    }
    return await this.computePool.exec(task);
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

    // Cluster follower: serve reads locally but auto-route writes/meta to leader.
    if (this.mode === ProcessMode.REPLICA && this.options.cluster?.enabled) {
      const local = await this.openDatabase(name);
      return new ClusterDatabase(
        name,
        local as any,
        (action, args) => this._clusterExec(action, args),
        () => this._shouldReadFromLeader(name)
      ) as any;
    }

    return this.openDatabase(name);
  }

  private _shouldReadFromLeader(dbName: string): boolean {
    const mode = this.options.consistency?.reads?.mode ?? "stale_ok";
    if (mode === "leader_only") return true;
    if (mode !== "bounded_stale") return false;

    const maxLagLSN = Math.max(0, Math.trunc(this.options.consistency?.reads?.maxLagLSN ?? 0));
    const maxLagMs = Math.max(0, Math.trunc(this.options.consistency?.reads?.maxLagMs ?? 0));
    const autoDegrade = !!this.options.consistency?.reads?.autoDegradeToStaleOk;
    if (autoDegrade) return false;

    const snap = this.metrics.snapshot(dbName)?.replication ?? {};
    const lagLSN = Math.max(0, Math.trunc((snap as any).replicaWalLag ?? 0));
    const lagMs = Math.max(0, Math.trunc((snap as any).replicaDelayMs ?? 0));
    const tooFarLSN = maxLagLSN > 0 && lagLSN > maxLagLSN;
    const tooFarMs = maxLagMs > 0 && lagMs > maxLagMs;
    return tooFarLSN || tooFarMs;
  }

  private async _clusterExec(action: string, args: any) {
    const leader = this.clusterLeader;
    if (!leader) {
      throw new LiorandbError("NOT_LEADER", "Cluster leader is unknown", { details: { leader: null } });
    }
    if (!this.clusterRpcClient) {
      const clientCfg: any = (this.options.cluster as any)?.client ?? {};
      this.clusterRpcClient = new ClusterRPCClient({
        host: leader.host,
        port: leader.clientPort,
        timeoutMs: 2000,
        token: clientCfg?.auth?.token ? String(clientCfg.auth.token) : undefined,
        maxMessageBytes: clientCfg?.maxMessageBytes,
        tls: clientCfg?.tls ? {
          caPath: clientCfg.tls.caPath,
          servername: clientCfg.tls.servername,
          rejectUnauthorized: clientCfg.tls.rejectUnauthorized
        } : undefined
      });
      this.lifecycle.register(() => this.clusterRpcClient?.close());
    }
    return this.clusterRpcClient.exec(action, args, { host: leader.host, port: leader.clientPort });
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

      // Audit WAL stream (leader only): best-effort, non-blocking.
      try {
        if (this.auditSink && this.isPrimary() && !this.auditUnsubByDb.has(name)) {
          const unsub = (db as any).wal?.onAppend?.((r: any) => {
            this.auditSink?.append({
              t: Date.now(),
              kind: "wal",
              db: name,
              lsn: Math.trunc(r?.lsn ?? 0),
              tx: Math.trunc(r?.tx ?? 0),
              type: String(r?.type ?? ""),
              time: typeof r?.time === "number" ? Math.trunc(r.time) : undefined,
              payload: r?.type === "op" ? r?.payload : undefined
            });
          });
          if (typeof unsub === "function") this.auditUnsubByDb.set(name, unsub);
        }
      } catch {}

      if (this.mode === ProcessMode.REPLICA) {
        // In cluster mode we should only replicate once we know the leader WAL stream endpoint.
        const hasWalStream = !!this.options.replication?.walStream;
        const clusterEnabled = this.options.cluster?.enabled === true;
        if (!clusterEnabled || hasWalStream) {
          await this._ensureReplicaReplicator();
          this.replicaReplicator?.ensure(name, db);
        }
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

    this._authorize("db:backup", { op: "snapshot" }, true);

    return await this.opsMutex.runExclusive(async () => {
      for (const db of this.openDBs.values()) {
        try {
          await db.wal?.flush?.();
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

    this._authorize("db:restore", { op: "restore" }, true);

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

      this._authorize("db:backup", { op: "incrementalBackup" }, true);

      return await this.opsMutex.runExclusive(async () => {
        for (const db of this.openDBs.values()) {
          try {
            await db.wal?.flush?.();
          } catch {}
        }
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

      this._authorize("db:restore", { op: "applyIncrementalBackup" }, true);

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
    for (const unsub of this.auditUnsubByDb.values()) {
      try { unsub(); } catch {}
    }
    this.auditUnsubByDb.clear();

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

    // In worker threads, `beforeExit` can fire while async cluster startup is still in-flight,
    // which can race-close the manager and crash role transitions. Only bind process hooks
    // on the main thread.
    if (isMainThread) {
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
    }

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

/* ---------------- CLUSTER PROXY DB (Follower auto-routing) ---------------- */

class ClusterDatabase {
  constructor(
    private name: string,
    private local: any,
    private exec: (action: string, args: any) => Promise<any>,
    private readFromLeader: () => boolean
  ) {}

  collection(name: string) {
    return new ClusterCollection(this.name, name, this.local.collection(name), this.exec, this.readFromLeader);
  }

  private async callLocalOrRemote(method: string, params: any[]) {
    if (this.readFromLeader()) {
      return this.exec("db:meta", { db: this.name, method, params });
    }
    return (this.local as any)[method](...(params ?? []));
  }

  explain = (collection: string, query?: any, options?: any) =>
    this.callLocalOrRemote("explain", [collection, query, options]);

  maintenance = (options?: { aggressive?: boolean }) =>
    this.exec("db:meta", { db: this.name, method: "maintenance", params: [options ?? {}] });

  rotateEncryptionKey = (newKey: string | Buffer) =>
    this.exec("db:meta", { db: this.name, method: "rotateEncryptionKey", params: [newKey] });
}

class ClusterCollection {
  constructor(
    private db: string,
    private col: string,
    private local: any,
    private exec: (action: string, args: any) => Promise<any>,
    private readFromLeader: () => boolean
  ) {}

  private callRemote(method: string, params: any[]) {
    return this.exec("op", { db: this.db, col: this.col, method, params });
  }

  private callLocal(method: string, params: any[]) {
    return (this.local as any)[method](...(params ?? []));
  }

  insertOne = (doc: any) => this.callRemote("insertOne", [doc]);
  insertMany = (docs: any[], options?: any) => this.callRemote("insertMany", [docs, options]);
  updateOne = (filter: any, update: any, options?: any) => this.callRemote("updateOne", [filter, update, options]);
  updateMany = (filter: any, update: any) => this.callRemote("updateMany", [filter, update]);
  deleteOne = (filter: any) => this.callRemote("deleteOne", [filter]);
  deleteMany = (filter: any) => this.callRemote("deleteMany", [filter]);

  find = (query?: any, options?: any) =>
    this.readFromLeader() ? this.callRemote("find", [query, options]) : this.callLocal("find", [query, options]);

  findOne = (query?: any, options?: any) =>
    this.readFromLeader() ? this.callRemote("findOne", [query, options]) : this.callLocal("findOne", [query, options]);

  aggregate = (pipeline: any[]) =>
    this.readFromLeader() ? this.callRemote("aggregate", [pipeline]) : this.callLocal("aggregate", [pipeline]);

  explain = (query?: any, options?: any) =>
    this.readFromLeader() ? this.callRemote("explain", [query, options]) : this.callLocal("explain", [query, options]);

  countDocuments = (filter?: any) =>
    this.readFromLeader() ? this.callRemote("countDocuments", [filter]) : this.callLocal("countDocuments", [filter]);

  count = () =>
    this.readFromLeader() ? this.callRemote("count", []) : this.callLocal("count", []);
}
