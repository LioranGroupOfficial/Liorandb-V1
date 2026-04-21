import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { LioranDB } from "./database.js";
import { LiorandbError, asLiorandbError, withLiorandbErrorSync } from "../utils/errors.js";

export type MigrationFn = (db: LioranDB) => Promise<void>;

type MigrationRecord = {
  from: string;
  to: string;
  checksum: string;
  appliedAt: number;
};

const LOCK_FILE = "__migration.lock";
const HISTORY_FILE = "__migration_history.json";

export class MigrationEngine {
  private migrations = new Map<string, MigrationFn>();

  constructor(private db: LioranDB) {}

  /* ------------------------------------------------------------ */
  /* Public API */
  /* ------------------------------------------------------------ */

  register(from: string, to: string, fn: MigrationFn) {
    const key = `${from}→${to}`;

    if (this.migrations.has(key)) {
      throw new LiorandbError("DUPLICATE_KEY", `Duplicate migration: ${key}`, {
        details: { from, to }
      });
    }

    this.migrations.set(key, fn);
  }

  async migrate(from: string, to: string, fn: MigrationFn) {
    this.register(from, to, fn);
    await this.execute();
  }

  async upgradeToLatest() {
    await this.execute();
  }

  /* ------------------------------------------------------------ */
  /* Core Execution Logic */
  /* ------------------------------------------------------------ */

  private async execute() {
    let current = this.db.getSchemaVersion();

    while (true) {
      const next = this.findNext(current);
      if (!next) break;

      const fn = this.migrations.get(`${current}→${next}`)!;
      await this.runMigration(current, next, fn);
      current = next;
    }
  }

  private findNext(current: string): string | null {
    for (const key of this.migrations.keys()) {
      const [from, to] = key.split("→");
      if (from === current) return to;
    }
    return null;
  }

  /* ------------------------------------------------------------ */
  /* Atomic Migration Execution */
  /* ------------------------------------------------------------ */

  private async runMigration(from: string, to: string, fn: MigrationFn) {
    const current = this.db.getSchemaVersion();
    if (current !== from) {
      throw new LiorandbError("CORRUPTION", `Schema mismatch: DB=${current}, expected=${from}`, {
        details: { db: current, expected: from }
      });
    }

    const lockPath = path.join(this.db.basePath, LOCK_FILE);

    if (fs.existsSync(lockPath)) {
      throw new LiorandbError(
        "IO_ERROR",
        "Previous migration interrupted. Resolve manually before continuing.",
        { details: { lockPath } }
      );
    }

    this.acquireLock(lockPath);

    try {
      await this.db.transaction(async () => {
        await fn(this.db);
        this.writeHistory(from, to, fn);
        this.db.setSchemaVersion(to);
      });
    } finally {
      this.releaseLock(lockPath);
    }
  }

  /* ------------------------------------------------------------ */
  /* Locking */
  /* ------------------------------------------------------------ */

  private acquireLock(file: string) {
    const token = crypto.randomBytes(16).toString("hex");

    try {
      fs.writeFileSync(
        file,
        JSON.stringify({
          pid: process.pid,
          token,
          time: Date.now(),
        })
      );
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to acquire migration lock",
        details: { lockPath: file }
      });
    }
  }

  private releaseLock(file: string) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  }

  /* ------------------------------------------------------------ */
  /* Migration History */
  /* ------------------------------------------------------------ */

  private historyPath() {
    return path.join(this.db.basePath, HISTORY_FILE);
  }

  private readHistory(): MigrationRecord[] {
    const historyPath = this.historyPath();
    return withLiorandbErrorSync(
      {
        code: "IO_ERROR",
        message: "Failed to read migration history",
        details: { historyPath }
      },
      () => {
        if (!fs.existsSync(historyPath)) return [];
        return JSON.parse(fs.readFileSync(historyPath, "utf8")) as MigrationRecord[];
      }
    );
  }

  private writeHistory(from: string, to: string, fn: MigrationFn) {
    const history = this.readHistory();

    history.push({
      from,
      to,
      checksum: this.hash(fn.toString()),
      appliedAt: Date.now(),
    });

    const historyPath = this.historyPath();
    try {
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to write migration history",
        details: { historyPath, from, to }
      });
    }
  }

  private hash(data: string) {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /* ------------------------------------------------------------ */
  /* Diagnostics */
  /* ------------------------------------------------------------ */

  getHistory(): MigrationRecord[] {
    return this.readHistory();
  }
}
