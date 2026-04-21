import fs from "fs";
import path from "path";
import { LioranManager } from "@liorandb/core";

type SnapshotConfig = {
  enabled: boolean;
  intervalMs: number;
  dir: string;
  retentionHours: number;
};

function toBool(input: string | undefined, defaultValue: boolean) {
  if (input === undefined) return defaultValue;
  return input === "1" || input.toLowerCase() === "true";
}

function safeNowStamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function getSnapshotConfig(): SnapshotConfig {
  return {
    enabled: toBool(process.env.LIORANDB_SNAPSHOT_ENABLED, true),
    intervalMs: Number(process.env.LIORANDB_SNAPSHOT_INTERVAL_MS || 60 * 60_000),
    dir: process.env.LIORANDB_SNAPSHOT_DIR
      ? path.resolve(process.env.LIORANDB_SNAPSHOT_DIR)
      : path.resolve(process.cwd(), "snapshots"),
    retentionHours: Number(process.env.LIORANDB_SNAPSHOT_RETENTION_HOURS || 48),
  };
}

let snapshotRunning = false;

export function isSnapshotRunning() {
  return snapshotRunning;
}

async function cleanupOldSnapshots(config: SnapshotConfig) {
  if (!fs.existsSync(config.dir)) return;
  const maxAgeMs = config.retentionHours * 60 * 60_000;
  const now = Date.now();

  const entries = await fs.promises.readdir(config.dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".tar.gz")) continue;
    const fullPath = path.join(config.dir, entry.name);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        await fs.promises.rm(fullPath, { force: true });
      }
    } catch {}
  }
}

export async function runSnapshot(manager: LioranManager, reason: string) {
  const config = getSnapshotConfig();
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "disabled" as const };
  }

  if (snapshotRunning) {
    return { ok: false, skipped: true, reason: "already_running" as const };
  }

  snapshotRunning = true;
  try {
    await fs.promises.mkdir(config.dir, { recursive: true });

    const fileName = `liorandb-snapshot-${safeNowStamp()}.tar.gz`;
    const outPath = path.join(config.dir, fileName);

    await manager.snapshot(outPath);
    // manager.snapshot closes DB instances but leaves them in the map
    manager.openDBs.clear();

    await cleanupOldSnapshots(config);

    return { ok: true, path: outPath, reason };
  } finally {
    snapshotRunning = false;
  }
}

export async function listSnapshots() {
  const config = getSnapshotConfig();
  if (!fs.existsSync(config.dir)) return [];

  const entries = await fs.promises.readdir(config.dir, { withFileTypes: true });
  const files: Array<{ name: string; path: string; mtimeMs: number; size: number }> = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".tar.gz")) continue;
    const fullPath = path.join(config.dir, entry.name);
    try {
      const stat = await fs.promises.stat(fullPath);
      files.push({ name: entry.name, path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {}
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

export function startSnapshotScheduler(manager: LioranManager) {
  const config = getSnapshotConfig();
  if (!config.enabled) return null;

  const timer = setInterval(() => {
    runSnapshot(manager, "scheduled").catch((err) => {
      console.error("[snapshot] failed:", err);
    });
  }, config.intervalMs);

  (timer as any).unref?.();
  return timer;
}

