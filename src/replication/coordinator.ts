import type net from "net";

type Waiter = {
  lsn: number;
  resolve: () => void;
  reject: (err: any) => void;
  timer?: NodeJS.Timeout;
};

export class ReplicationCoordinator {
  private ackByDb = new Map<string, Map<net.Socket, number>>();
  private waitersByDb = new Map<string, Set<Waiter>>();

  constructor(
    private opts: {
      /**
       * Total nodes in the replication group including leader.
       */
      groupSize: number;
      /**
       * If true, leader waits for majority acks before acknowledging commits.
       */
      waitForMajority: boolean;
      waitTimeoutMs: number;
    }
  ) {}

  recordAck(db: string, socket: net.Socket, lsn: number) {
    const map = this.ackByDb.get(db) ?? new Map<net.Socket, number>();
    map.set(socket, Math.max(map.get(socket) ?? 0, lsn));
    this.ackByDb.set(db, map);
    this.maybeResolve(db);
  }

  async awaitMajority(db: string, lsn: number): Promise<void> {
    if (!this.opts.waitForMajority) return;
    if (lsn <= 0) return;

    if (this.countAcksAtLeast(db, lsn) >= this.majority()) return;

    return await new Promise<void>((resolve, reject) => {
      const w: Waiter = { lsn, resolve, reject };
      const set = this.waitersByDb.get(db) ?? new Set<Waiter>();
      set.add(w);
      this.waitersByDb.set(db, set);

      w.timer = setTimeout(() => {
        try { set.delete(w); } catch {}
        reject(new Error(`Replication majority ack timeout for db=${db} lsn=${lsn}`));
      }, Math.max(1, Math.trunc(this.opts.waitTimeoutMs)));
    });
  }

  private majority() {
    return Math.floor(this.opts.groupSize / 2) + 1;
  }

  private countAcksAtLeast(db: string, lsn: number): number {
    // Leader counts as 1 (local apply is already done before awaiting).
    let count = 1;
    const map = this.ackByDb.get(db);
    if (!map) return count;
    for (const v of map.values()) {
      if (v >= lsn) count++;
    }
    return count;
  }

  private maybeResolve(db: string) {
    const set = this.waitersByDb.get(db);
    if (!set || set.size === 0) return;
    for (const w of Array.from(set)) {
      if (this.countAcksAtLeast(db, w.lsn) >= this.majority()) {
        set.delete(w);
        if (w.timer) {
          try { clearTimeout(w.timer); } catch {}
        }
        w.resolve();
      }
    }
    if (set.size === 0) this.waitersByDb.delete(db);
  }
}

