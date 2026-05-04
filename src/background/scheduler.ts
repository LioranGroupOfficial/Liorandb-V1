import { asLiorandbError } from "../utils/errors.js";
import type { LioranManager } from "../LioranManager.js";

export type BackgroundSchedulerOptions = {
  enabled?: boolean;
  /**
   * How often to run background maintenance ticks.
   */
  intervalMs?: number;
};

export class BackgroundScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private closed = false;

  constructor(
    private manager: LioranManager,
    private opts: BackgroundSchedulerOptions
  ) {}

  start() {
    if (this.timer) return;
    if (this.closed) return;
    if (this.opts.enabled === false) return;

    const intervalMs = Math.max(250, Math.trunc(this.opts.intervalMs ?? 10_000));
    this.timer = setInterval(() => void this.tick().catch(() => {}), intervalMs);
    this.timer.unref?.();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      try { clearInterval(this.timer); } catch {}
      this.timer = null;
    }
    // no need to wait for an in-flight tick
  }

  private async tick() {
    if (this.closed) return;
    if (this.running) return;
    if ((this.manager as any).isPrimary?.() !== true) return;

    this.running = true;
    try {
      for (const db of (this.manager as any).openDBs?.values?.() ?? []) {
        try {
          await (db as any).backgroundTick?.();
        } catch (err) {
          const e = asLiorandbError(err, {
            code: "INTERNAL",
            message: "Background tick failed",
            details: { db: (db as any)?.dbName }
          });
          // eslint-disable-next-line no-console
          console.warn("[BackgroundScheduler]", e.message, e.details ?? {});
        }
      }
    } finally {
      this.running = false;
    }
  }
}
