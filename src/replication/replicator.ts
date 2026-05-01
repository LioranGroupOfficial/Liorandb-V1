import { asLiorandbError } from "../utils/errors.js";
import type { LioranManager } from "../LioranManager.js";
import type { LioranDB } from "../core/database.js";

export type ReplicationOptions = {
  leaderRootPath: string;
  pollMs: number;
  batchLimit: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ReplicaReplicator {
  private stopped = false;
  private running = new Map<string, Promise<void>>();

  constructor(
    private manager: LioranManager,
    private opts: ReplicationOptions
  ) {}

  stop() {
    this.stopped = true;
  }

  ensure(dbName: string, db: LioranDB) {
    if (this.running.has(dbName)) return;
    const p = this.runLoop(dbName, db);
    this.running.set(dbName, p);
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
