import type net from "net";

type LatencyKind = "read" | "write" | "wal";
type CacheKind = "query" | "doc";

type Ring = { buf: number[]; cap: number; idx: number; size: number };

function ring(cap: number): Ring {
  return { buf: new Array<number>(cap), cap, idx: 0, size: 0 };
}

function ringPush(r: Ring, v: number) {
  r.buf[r.idx] = v;
  r.idx = (r.idx + 1) % r.cap;
  r.size = Math.min(r.cap, r.size + 1);
}

function ringValues(r: Ring): number[] {
  const out: number[] = [];
  for (let i = 0; i < r.size; i++) {
    const j = (r.idx - r.size + i + r.cap) % r.cap;
    const v = r.buf[j];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function pct(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

type DbMetrics = {
  latency: Record<LatencyKind, Ring>;
  cache: Record<CacheKind, { hits: number; misses: number }>;
  replication: {
    // leader-side view (from WALStream acks)
    lastLeaderLSN: number;
    ackedLSNBySocket: Map<net.Socket, number>;
    commitTimeByLSN: Map<number, number>;
    commitTimeQueue: number[]; // insertion order for eviction
    maxCommitTimes: number;
    lastAckDelayMs: number;
    lastWalLag: number;
  };
};

export class MetricsCollector {
  private byDb = new Map<string, DbMetrics>();
  private latencyWindow = 10_000;

  constructor(options?: { latencyWindow?: number }) {
    if (options?.latencyWindow) {
      this.latencyWindow = Math.max(100, Math.trunc(options.latencyWindow));
    }
  }

  private db(dbName: string): DbMetrics {
    const existing = this.byDb.get(dbName);
    if (existing) return existing;
    const created: DbMetrics = {
      latency: {
        read: ring(this.latencyWindow),
        write: ring(this.latencyWindow),
        wal: ring(this.latencyWindow)
      },
      cache: {
        query: { hits: 0, misses: 0 },
        doc: { hits: 0, misses: 0 }
      },
      replication: {
        lastLeaderLSN: 0,
        ackedLSNBySocket: new Map(),
        commitTimeByLSN: new Map(),
        commitTimeQueue: [],
        maxCommitTimes: 50_000,
        lastAckDelayMs: 0,
        lastWalLag: 0
      }
    };
    this.byDb.set(dbName, created);
    return created;
  }

  observeLatency(dbName: string, kind: LatencyKind, ms: number) {
    const m = this.db(dbName);
    ringPush(m.latency[kind], Math.max(0, ms));
  }

  observeCache(dbName: string, kind: CacheKind, hit: boolean) {
    const m = this.db(dbName);
    if (hit) m.cache[kind].hits++;
    else m.cache[kind].misses++;
  }

  observeLeaderLSN(dbName: string, lsn: number) {
    const m = this.db(dbName);
    m.replication.lastLeaderLSN = Math.max(m.replication.lastLeaderLSN, Math.trunc(lsn));
  }

  observeCommitTime(dbName: string, lsn: number, timeMs: number) {
    const m = this.db(dbName);
    const l = Math.trunc(lsn);
    const t = Math.trunc(timeMs);
    if (!Number.isFinite(l) || l <= 0) return;
    if (!Number.isFinite(t) || t <= 0) return;
    if (m.replication.commitTimeByLSN.has(l)) return;
    m.replication.commitTimeByLSN.set(l, t);
    m.replication.commitTimeQueue.push(l);
    if (m.replication.commitTimeQueue.length > m.replication.maxCommitTimes) {
      const evict = m.replication.commitTimeQueue.splice(0, Math.trunc(m.replication.maxCommitTimes * 0.1));
      for (const key of evict) m.replication.commitTimeByLSN.delete(key);
    }
  }

  observeReplicaAck(dbName: string, socket: net.Socket, ackedLSN: number, nowMs = Date.now()) {
    const m = this.db(dbName);
    const lsn = Math.trunc(ackedLSN);
    const prev = m.replication.ackedLSNBySocket.get(socket) ?? 0;
    const next = Math.max(prev, lsn);
    m.replication.ackedLSNBySocket.set(socket, next);

    const leader = m.replication.lastLeaderLSN;
    m.replication.lastWalLag = Math.max(0, leader - next);

    const commitTime = m.replication.commitTimeByLSN.get(next);
    if (commitTime) {
      m.replication.lastAckDelayMs = Math.max(0, nowMs - commitTime);
    }
  }

  snapshot(dbName: string) {
    const m = this.db(dbName);
    const read = ringValues(m.latency.read);
    const write = ringValues(m.latency.write);
    const wal = ringValues(m.latency.wal);
    const query = m.cache.query;
    const doc = m.cache.doc;

    const rate = (c: { hits: number; misses: number }) => {
      const total = c.hits + c.misses;
      return total === 0 ? 0 : c.hits / total;
    };

    return {
      latencyMs: {
        read: { p50: pct(read, 0.5), p95: pct(read, 0.95), p99: pct(read, 0.99), samples: read.length },
        write: { p50: pct(write, 0.5), p95: pct(write, 0.95), p99: pct(write, 0.99), samples: write.length },
        wal: { p50: pct(wal, 0.5), p95: pct(wal, 0.95), p99: pct(wal, 0.99), samples: wal.length }
      },
      cache: {
        query: { hits: query.hits, misses: query.misses, hitRate: rate(query) },
        doc: { hits: doc.hits, misses: doc.misses, hitRate: rate(doc) }
      },
      replication: {
        leaderLSN: m.replication.lastLeaderLSN,
        walLag: m.replication.lastWalLag,
        replicationDelayMs: m.replication.lastAckDelayMs
      }
    };
  }
}

