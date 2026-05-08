import { asLiorandbError } from "../utils/errors.js";
import type { LioranManager } from "../LioranManager.js";
import type { LioranDB } from "../core/database.js";
import { WALStreamClient } from "./walStream.js";

export type ReplicationOptions = {
  leaderRootPath: string;
  pollMs: number;
  batchLimit: number;
  walStream?: { host: string; port: number };
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ReplicaReplicator {
  private stopped = false;
  private running = new Map<string, Promise<void>>();
  private streamClient: WALStreamClient | null = null;
  private streamStarted = false;

  constructor(
    private manager: LioranManager,
    private opts: ReplicationOptions
  ) {}

  stop() {
    this.stopped = true;
    void this.streamClient?.stop();
  }

  ensure(dbName: string, db: LioranDB) {
    if (this.running.has(dbName)) return;

    const p = this.opts.walStream
      ? this.runStream(dbName, db)
      : this.runLoop(dbName, db);
    this.running.set(dbName, p);
  }

  private async runStream(dbName: string, db: LioranDB) {
    const host = this.opts.walStream!.host;
    const port = this.opts.walStream!.port;

    while (!this.stopped) {
      try {
        if (!this.streamClient) {
          this.streamClient = new WALStreamClient({ host, port });
        }

        if (!this.streamStarted) {
          this.streamStarted = true;
          await this.streamClient.start();
          this.streamClient.bindReplica(async name => {
            // Ensure we bind to the *local* DB instance (replicas must apply WAL locally).
            // In cluster follower mode, `manager.db()` returns a routing proxy, so bypass it.
            const local = (this.manager as any).openDatabase
              ? await (this.manager as any).openDatabase(name)
              : await this.manager.db(name);
            return local as any;
          }, {
            onProgress: (info) => {
              try {
                (this.manager as any)?.metrics?.observeReplicaProgress?.(info.db, {
                  leaderLSN: info.leaderLSN,
                  appliedLSN: info.appliedLSN,
                  commitTimeMs: info.commitTimeMs
                });
              } catch {}
            }
          });
        }

        // Subscribe from current checkpoint and rely on push replication.
        const fromLSN = db.getCheckpointLSN();
        this.streamClient.subscribe(dbName, fromLSN);

        while (!this.stopped) {
          await sleep(250);
        }
        return;
      } catch (err) {
        const e = asLiorandbError(err, {
          code: "IO_ERROR",
          message: "Replica WAL stream failed",
          details: { db: dbName }
        });
        console.warn("[ReplicaReplicator:stream]", e.message, e.details ?? {});

        // In cluster mode, polling fallback via IPC will never work, so keep retrying the stream.
        try { await this.streamClient?.stop(); } catch {}
        this.streamClient = null;
        this.streamStarted = false;
        await sleep(Math.min(1000, Math.max(50, this.opts.pollMs)));
      }
    }
  }

  private async runLoop(dbName: string, db: LioranDB) {
    while (!this.stopped) {
      try {
        const fromLSN = db.getCheckpointLSN();
        const payload = await (this.manager as any)._ipcExec("wal:fetch", {
          db: dbName,
          fromLSN,
          limit: this.opts.batchLimit
        });

        const records = payload?.records ?? [];
        const leaderLSN = Math.max(0, Math.trunc(payload?.lastLSN ?? fromLSN));
        if (records.length === 0) {
          try {
            (this.manager as any)?.metrics?.observeReplicaProgress?.(dbName, {
              leaderLSN,
              appliedLSN: fromLSN
            });
          } catch {}
          await sleep(this.opts.pollMs);
          continue;
        }

        const appliedLSN = await db.applyReplicatedWAL(records);
        const commitTimeMs = records.reduce((m: number, r: any) => {
          if (r?.type !== "commit") return m;
          const t = r?.time;
          return typeof t === "number" && Number.isFinite(t) ? Math.max(m, Math.trunc(t)) : m;
        }, 0);

        try {
          (this.manager as any)?.metrics?.observeReplicaProgress?.(dbName, {
            leaderLSN,
            appliedLSN,
            commitTimeMs: commitTimeMs || undefined
          });
        } catch {}
      } catch (err) {
        const e = asLiorandbError(err, {
          code: "IO_ERROR",
          message: "Replica replication loop failed",
          details: { db: dbName }
        });
        console.warn("[ReplicaReplicator]", e.message, e.details ?? {});
        await sleep(Math.min(2000, Math.max(50, this.opts.pollMs)));
      }
    }
  }
}
