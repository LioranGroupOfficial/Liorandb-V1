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
    try {
      if (!this.streamClient) {
        this.streamClient = new WALStreamClient({
          host: this.opts.walStream!.host,
          port: this.opts.walStream!.port
        });
      }

      if (!this.streamStarted) {
        this.streamStarted = true;
        await this.streamClient.start();
        this.streamClient.bindReplica(async name => {
          // Ensure DB is open and passed instance is the same if already opened.
          return (await this.manager.db(name)) as any;
        });
      }

      // Subscribe from current checkpoint and rely on push replication.
      const fromLSN = db.getCheckpointLSN();
      this.streamClient.subscribe(dbName, fromLSN);

      while (!this.stopped) {
        await sleep(250);
      }
    } catch (err) {
      const e = asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Replica WAL stream failed",
        details: { db: dbName }
      });
      console.warn("[ReplicaReplicator:stream]", e.message, e.details ?? {});
      // Fallback to polling loop if stream fails.
      if (!this.stopped) {
        await this.runLoop(dbName, db);
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
        if (records.length === 0) {
          await sleep(this.opts.pollMs);
          continue;
        }

        await db.applyReplicatedWAL(records);
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
