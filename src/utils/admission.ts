import { AsyncLocalStorage } from "node:async_hooks";
import { LiorandbError } from "./errors.js";

export type AdmissionMode = "wait" | "reject";
export type AdmissionKind = "read" | "write" | "maintenance";

export type AdmissionConfig = {
  enabled?: boolean;
  mode?: AdmissionMode;
  maxInFlight?: number;
  maxQueue?: number;
  timeoutMs?: number;
};

type ReleaseFn = () => void;

class AsyncSemaphore {
  private permits: number;
  private waiters: Array<(release: ReleaseFn) => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(0, Math.trunc(permits));
  }

  get waiting() {
    return this.waiters.length;
  }

  tryAcquire(): ReleaseFn | null {
    if (this.permits <= 0) return null;
    this.permits--;
    return () => this.release();
  }

  async acquire(opts: { timeoutMs?: number; maxQueue?: number }): Promise<ReleaseFn> {
    const immediate = this.tryAcquire();
    if (immediate) return immediate;

    const maxQueue = opts.maxQueue === undefined ? undefined : Math.max(0, Math.trunc(opts.maxQueue));
    if (maxQueue !== undefined && this.waiters.length >= maxQueue) {
      throw new LiorandbError("BACKPRESSURE", "Overload: admission queue full", {
        details: { maxQueue, waiting: this.waiters.length }
      });
    }

    let timeout: NodeJS.Timeout | null = null;
    let done = false;

    const p = new Promise<ReleaseFn>((resolve, reject) => {
      const waiter = (release: ReleaseFn) => {
        if (done) return;
        done = true;
        if (timeout) clearTimeout(timeout);
        resolve(release);
      };

      this.waiters.push(waiter);

      if (opts.timeoutMs !== undefined) {
        const ms = Math.max(0, Math.trunc(opts.timeoutMs));
        timeout = setTimeout(() => {
          if (done) return;
          done = true;
          this.waiters = this.waiters.filter(w => w !== waiter);
          reject(new LiorandbError("BACKPRESSURE", "Overload: admission timeout", {
            details: { timeoutMs: ms }
          }));
        }, ms);
        timeout.unref?.();
      }
    });

    return p;
  }

  private release() {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(() => this.release());
      return;
    }
    this.permits++;
  }
}

type TenantBucket = {
  sem: AsyncSemaphore;
  lastUsedAt: number;
};

export type TenantContext = { tenantId: string };

export class AdmissionController {
  private readonly tenantALS = new AsyncLocalStorage<TenantContext>();
  private readonly global = new Map<AdmissionKind, AsyncSemaphore>();
  private readonly perTenant = new Map<string, Map<AdmissionKind, TenantBucket>>();
  private readonly maxTenants: number;
  private readonly configByKind: Record<AdmissionKind, Required<AdmissionConfig>>;

  constructor(options?: {
    maxTenants?: number;
    read?: AdmissionConfig;
    write?: AdmissionConfig;
    maintenance?: AdmissionConfig;
  }) {
    this.maxTenants = Math.max(1, Math.trunc(options?.maxTenants ?? 10_000));

    const normalize = (c: AdmissionConfig | undefined, defaults: Required<AdmissionConfig>): Required<AdmissionConfig> => ({
      enabled: c?.enabled ?? defaults.enabled,
      mode: c?.mode ?? defaults.mode,
      maxInFlight: Math.max(1, Math.trunc(c?.maxInFlight ?? defaults.maxInFlight)),
      maxQueue: Math.max(0, Math.trunc(c?.maxQueue ?? defaults.maxQueue)),
      timeoutMs: c?.timeoutMs ?? defaults.timeoutMs
    });

    this.configByKind = {
      read: normalize(options?.read, { enabled: true, mode: "reject", maxInFlight: 1024, maxQueue: 0, timeoutMs: 0 }),
      write: normalize(options?.write, { enabled: true, mode: "wait", maxInFlight: 256, maxQueue: 10_000, timeoutMs: 30_000 }),
      maintenance: normalize(options?.maintenance, { enabled: true, mode: "reject", maxInFlight: 8, maxQueue: 0, timeoutMs: 0 })
    };

    for (const kind of ["read", "write", "maintenance"] as const) {
      const cfg = this.configByKind[kind];
      (this.global as Map<AdmissionKind, any>).set(kind, new AsyncSemaphore(cfg.maxInFlight));
    }
  }

  withTenant<T>(tenantId: string, task: () => Promise<T>): Promise<T> {
    const id = String(tenantId || "default");
    return this.tenantALS.run({ tenantId: id }, task);
  }

  currentTenantId(): string {
    return this.tenantALS.getStore()?.tenantId ?? "default";
  }

  async run<T>(
    kind: AdmissionKind,
    task: () => Promise<T>,
    options?: { tenantId?: string; perTenant?: AdmissionConfig }
  ): Promise<T> {
    const cfg = this.configByKind[kind];
    if (!cfg.enabled) return task();

    const tenantId = String(options?.tenantId ?? this.currentTenantId() ?? "default");
    const perTenantCfg = options?.perTenant;

    const releases: ReleaseFn[] = [];
    try {
      releases.push(await this.acquireGlobal(kind, cfg));

      if (perTenantCfg?.enabled) {
        const normalized: Required<AdmissionConfig> = {
          enabled: true,
          mode: perTenantCfg.mode ?? cfg.mode,
          maxInFlight: Math.max(1, Math.trunc(perTenantCfg.maxInFlight ?? cfg.maxInFlight)),
          maxQueue: Math.max(0, Math.trunc(perTenantCfg.maxQueue ?? cfg.maxQueue)),
          timeoutMs: perTenantCfg.timeoutMs ?? cfg.timeoutMs
        };
        releases.push(await this.acquireTenant(kind, tenantId, normalized));
      }

      return await task();
    } finally {
      for (let i = releases.length - 1; i >= 0; i--) {
        try { releases[i](); } catch {}
      }
    }
  }

  private async acquireGlobal(kind: AdmissionKind, cfg: Required<AdmissionConfig>): Promise<ReleaseFn> {
    const sem = this.global.get(kind)!;
    if (cfg.mode === "reject") {
      const release = sem.tryAcquire();
      if (!release) {
        throw new LiorandbError("BACKPRESSURE", "Overload: global in-flight limit reached", {
          details: { kind, maxInFlight: cfg.maxInFlight, waiting: sem.waiting }
        });
      }
      return release;
    }
    return sem.acquire({ timeoutMs: cfg.timeoutMs, maxQueue: cfg.maxQueue });
  }

  private async acquireTenant(kind: AdmissionKind, tenantId: string, cfg: Required<AdmissionConfig>): Promise<ReleaseFn> {
    const bucket = this.getTenantBucket(tenantId, kind, cfg.maxInFlight);
    if (cfg.mode === "reject") {
      const release = bucket.sem.tryAcquire();
      if (!release) {
        throw new LiorandbError("BACKPRESSURE", "Overload: tenant in-flight limit reached", {
          details: { kind, tenantId, maxInFlight: cfg.maxInFlight, waiting: bucket.sem.waiting }
        });
      }
      return release;
    }
    return bucket.sem.acquire({ timeoutMs: cfg.timeoutMs, maxQueue: cfg.maxQueue });
  }

  private getTenantBucket(tenantId: string, kind: AdmissionKind, permits: number): TenantBucket {
    const now = Date.now();

    let kindMap = this.perTenant.get(tenantId);
    if (!kindMap) {
      kindMap = new Map();
      this.perTenant.set(tenantId, kindMap);
      if (this.perTenant.size > this.maxTenants) {
        this.evictOldestTenant();
      }
    }

    const existing = kindMap.get(kind);
    if (existing) {
      existing.lastUsedAt = now;
      return existing;
    }

    const sem = new AsyncSemaphore(permits);
    const bucket: TenantBucket = { sem, lastUsedAt: now };
    kindMap.set(kind, bucket);
    return bucket;
  }

  private evictOldestTenant() {
    let oldestId: string | null = null;
    let oldestAt = Infinity;
    for (const [tenantId, kindMap] of this.perTenant) {
      let last = 0;
      for (const b of kindMap.values()) last = Math.max(last, b.lastUsedAt);
      if (last < oldestAt) {
        oldestAt = last;
        oldestId = tenantId;
      }
    }
    if (oldestId) this.perTenant.delete(oldestId);
  }
}
