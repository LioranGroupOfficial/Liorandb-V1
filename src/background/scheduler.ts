import { asLiorandbError } from "../utils/errors.js";
import type { LioranManager } from "../LioranManager.js";
import fs from "fs";
import path from "path";
import os from "os";

export type BackgroundSchedulerOptions = {
  enabled?: boolean;
  /**
   * How often to run background maintenance ticks.
   */
  intervalMs?: number;
  /**
   * If false, disables calling `db.backgroundTick()` (maintenance/compaction/index rebuild).
   * Backup scheduling still runs (if enabled).
   */
  dbTicksEnabled?: boolean;
  backup?: {
    enabled?: boolean;
    outDir?: string;
    snapshotEveryMs?: number;
    incrementalEveryMs?: number;
    retention?: {
      snapshots?: number;
      incrementals?: number;
    };
    verifyRestoreEveryMs?: number;
    /**
     * bounded staleness for restore verification (PITR).
     * If set, verification applies incrementals only up to `Date.now() - verifyPitrDelayMs`.
     */
    verifyPitrDelayMs?: number;
  };
};

export class BackgroundScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private closed = false;
  private lastSnapshotAt = 0;
  private lastIncrementalAt = 0;
  private lastVerifyAt = 0;
  private lastIncLSNByDb: Record<string, number> = {};

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
      if (this.opts.dbTicksEnabled !== false) {
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
      }

      await this.backupTick();
    } finally {
      this.running = false;
    }
  }

  private backupEnabled() {
    return this.opts.backup?.enabled === true;
  }

  private backupDir() {
    const dir = this.opts.backup?.outDir ?? path.join((this.manager as any).rootPath ?? process.cwd(), "__backups");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private statePath() {
    return path.join(this.backupDir(), "state.json");
  }

  private loadStateOnce() {
    if (Object.keys(this.lastIncLSNByDb).length > 0) return;
    try {
      const raw = fs.readFileSync(this.statePath(), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.lastIncLSNByDb && typeof parsed.lastIncLSNByDb === "object") {
        this.lastIncLSNByDb = parsed.lastIncLSNByDb;
      }
    } catch {}
  }

  private persistState() {
    try {
      fs.writeFileSync(this.statePath(), JSON.stringify({ lastIncLSNByDb: this.lastIncLSNByDb }, null, 2), "utf8");
    } catch {}
  }

  private async backupTick() {
    if (!this.backupEnabled()) return;

    this.loadStateOnce();

    const now = Date.now();
    const snapshotEveryMs = Math.max(10_000, Math.trunc(this.opts.backup?.snapshotEveryMs ?? 6 * 60 * 60_000));
    const incrementalEveryMs = Math.max(5_000, Math.trunc(this.opts.backup?.incrementalEveryMs ?? 60_000));
    const verifyEveryMs = Math.max(60_000, Math.trunc(this.opts.backup?.verifyRestoreEveryMs ?? 6 * 60 * 60_000));

    if (now - this.lastIncrementalAt >= incrementalEveryMs) {
      await this.runIncrementalBackup(now).catch(() => {});
    }

    if (now - this.lastSnapshotAt >= snapshotEveryMs) {
      await this.runSnapshot(now).catch(() => {});
    }

    if (now - this.lastVerifyAt >= verifyEveryMs) {
      await this.runRestoreVerification(now).catch(() => {});
    }
  }

  private async runSnapshot(nowMs: number) {
    const dir = this.backupDir();
    const out = path.join(dir, `snapshot-${nowMs}.tar.gz`);
    const tmp = out + ".tmp";
    try { await fs.promises.rm(tmp, { force: true }); } catch {}
    await (this.manager as any).snapshot(tmp);
    await fs.promises.rename(tmp, out);
    this.lastSnapshotAt = nowMs;
    await this.pruneRetention(dir);
  }

  private async runIncrementalBackup(nowMs: number) {
    const dir = this.backupDir();
    const out = path.join(dir, `pitr-${nowMs}.tar.gz`);
    const tmp = out + ".tmp";
    try { await fs.promises.rm(tmp, { force: true }); } catch {}
    const manifest = await (this.manager as any).incrementalBackup(tmp, { fromLSNByDb: this.lastIncLSNByDb });
    await fs.promises.rename(tmp, out);
    try {
      for (const [dbName, info] of Object.entries((manifest as any).dbs ?? {})) {
        const last = Math.max(0, Math.trunc((info as any).lastLSN ?? 0));
        this.lastIncLSNByDb[dbName] = last;
      }
      this.persistState();
    } catch {}
    this.lastIncrementalAt = nowMs;
    await this.pruneRetention(dir);
  }

  private async runRestoreVerification(nowMs: number) {
    const dir = this.backupDir();
    const latestSnapshot = this.findLatest(dir, "snapshot-");
    if (!latestSnapshot) return;

    const pitrDelay = Math.max(0, Math.trunc(this.opts.backup?.verifyPitrDelayMs ?? 0));
    const untilTimeMs = pitrDelay > 0 ? (nowMs - pitrDelay) : undefined;

    const incrementals = this.listSorted(dir, "pitr-");
    const toApply = untilTimeMs
      ? incrementals.filter(p => this.parseTimestampMs(path.basename(p)) <= untilTimeMs)
      : incrementals;

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "liorandb-verify-"));
    try {
      const tar = await import("tar");
      await tar.x({ file: latestSnapshot, cwd: tmpDir });

      // Apply PITR logs (incrementals) in order into the extracted snapshot.
      if (toApply.length > 0) {
        const { readIncrementalBackupArchive, filterWALForPITR } = await import("../backup/incremental.js");
        const { LioranManager } = await import("../LioranManager.js");
        const verifyMgr = new LioranManager({
          rootPath: tmpDir,
          ipc: "primary",
          background: { enabled: false },
          compute: { enabled: false }
        });

        for (const inc of toApply) {
          const { recordsByDb } = await readIncrementalBackupArchive(inc);
          for (const [dbName, records] of Object.entries(recordsByDb)) {
            const db = await verifyMgr.db(dbName);
            const filtered = filterWALForPITR(records, untilTimeMs);
            await (db as any).applyReplicatedWAL(filtered);
          }
        }

        // Smoke-check open all DBs found on disk.
        const dbNames = fs.readdirSync(tmpDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
        for (const name of dbNames) {
          try { await verifyMgr.db(name); } catch {}
        }
        await verifyMgr.closeAll();
      }

      this.lastVerifyAt = nowMs;
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private listSorted(dir: string, prefix: string): string[] {
    try {
      return fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix) && f.endsWith(".tar.gz"))
        .map(f => path.join(dir, f))
        .sort((a, b) => this.parseTimestampMs(path.basename(a)) - this.parseTimestampMs(path.basename(b)));
    } catch {
      return [];
    }
  }

  private findLatest(dir: string, prefix: string): string | null {
    const all = this.listSorted(dir, prefix);
    return all.length ? all[all.length - 1] : null;
  }

  private parseTimestampMs(fileName: string): number {
    // fileName: snapshot-<ms>.tar.gz or pitr-<ms>.tar.gz
    const m = fileName.match(/^[a-z]+-(\d+)\.tar\.gz$/i);
    if (!m) return 0;
    const t = Number(m[1]);
    return Number.isFinite(t) ? Math.max(0, Math.trunc(t)) : 0;
  }

  private async pruneRetention(dir: string) {
    const keepSnapshots = Math.max(1, Math.trunc(this.opts.backup?.retention?.snapshots ?? 24));
    const keepIncrementals = Math.max(1, Math.trunc(this.opts.backup?.retention?.incrementals ?? 240));

    const snapshots = this.listSorted(dir, "snapshot-");
    const incs = this.listSorted(dir, "pitr-");

    const toDelete = [
      ...snapshots.slice(0, Math.max(0, snapshots.length - keepSnapshots)),
      ...incs.slice(0, Math.max(0, incs.length - keepIncrementals))
    ];

    for (const p of toDelete) {
      try { await fs.promises.rm(p, { force: true }); } catch {}
    }
  }
}
