import fs from "fs";
import path from "path";
import os from "os";

import { WALManager, type WALRecord } from "../core/wal.js";
import { asLiorandbError, LiorandbError } from "../utils/errors.js";

const DB_META_FILE = "__db_meta.json";

export type IncrementalBackupManifest = {
  formatVersion: 1;
  createdAt: number;
  dbs: Record<
    string,
    {
      fromLSN: number;
      lastLSN: number;
      recordCount: number;
    }
  >;
};

export type CreateIncrementalBackupOptions = {
  fromLSNByDb?: Record<string, number>;
  limitPerDb?: number;
};

export async function createIncrementalBackupArchive(
  rootPath: string,
  outPath: string,
  options: CreateIncrementalBackupOptions = {}
): Promise<IncrementalBackupManifest> {
  try {
    const limitPerDb = options.limitPerDb ?? 1_000_000;
    const fromLSNByDb = options.fromLSNByDb ?? {};

    const dbNames = fs
      .readdirSync(rootPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(name => fs.existsSync(path.join(rootPath, name, DB_META_FILE)));

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "liorandb-inc-"));
    const dbRoot = path.join(tmpDir, "db");
    await fs.promises.mkdir(dbRoot, { recursive: true });

    const manifest: IncrementalBackupManifest = {
      formatVersion: 1,
      createdAt: Date.now(),
      dbs: {}
    };

    for (const dbName of dbNames) {
      const dbPath = path.join(rootPath, dbName);
      const fromLSN = Math.max(0, Math.trunc(fromLSNByDb[dbName] ?? 0));

      const wal = new WALManager(dbPath, { readonly: true });
      const { records, lastLSN } = await wal.read(fromLSN, limitPerDb);

      const outDir = path.join(dbRoot, dbName);
      await fs.promises.mkdir(outDir, { recursive: true });

      const walFile = path.join(outDir, "wal.jsonl");
      const lines = records.map(r => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
      await fs.promises.writeFile(walFile, lines, "utf8");

      manifest.dbs[dbName] = {
        fromLSN,
        lastLSN,
        recordCount: records.length
      };
    }

    await fs.promises.writeFile(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    const tar = await import("tar");
    await tar.c(
      {
        gzip: true,
        file: outPath,
        cwd: tmpDir,
        portable: true
      },
      ["./"]
    );

    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    return manifest;
  } catch (err) {
    throw asLiorandbError(err, {
      code: "IO_ERROR",
      message: "Failed to create incremental backup archive",
      details: { rootPath, outPath }
    });
  }
}

export type ApplyIncrementalBackupOptions = {
  untilTimeMs?: number;
};

export async function readIncrementalBackupArchive(
  archivePath: string
): Promise<{ manifest: IncrementalBackupManifest; recordsByDb: Record<string, WALRecord[]> }> {
  try {
    if (!fs.existsSync(archivePath)) {
      throw new LiorandbError("IO_ERROR", "Incremental backup archive not found", {
        details: { archivePath }
      });
    }

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "liorandb-inc-read-"));
    const tar = await import("tar");
    await tar.x({ file: archivePath, cwd: tmpDir });

    const manifestPath = path.join(tmpDir, "manifest.json");
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as IncrementalBackupManifest;
    if (!manifest || manifest.formatVersion !== 1) {
      throw new LiorandbError("CORRUPTION", "Unsupported incremental backup format", {
        details: { archivePath }
      });
    }

    const recordsByDb: Record<string, WALRecord[]> = {};
    const dbDir = path.join(tmpDir, "db");
    if (fs.existsSync(dbDir)) {
      const dbNames = fs.readdirSync(dbDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
      for (const dbName of dbNames) {
        const walPath = path.join(dbDir, dbName, "wal.jsonl");
        if (!fs.existsSync(walPath)) continue;
        const raw = await fs.promises.readFile(walPath, "utf8");
        const records = raw
          .split("\n")
          .map(l => l.trim())
          .filter(Boolean)
          .map(l => JSON.parse(l) as WALRecord);
        recordsByDb[dbName] = records;
      }
    }

    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    return { manifest, recordsByDb };
  } catch (err) {
    throw asLiorandbError(err, {
      code: "IO_ERROR",
      message: "Failed to read incremental backup archive",
      details: { archivePath }
    });
  }
}

export function filterWALForPITR(records: WALRecord[], untilTimeMs?: number): WALRecord[] {
  if (untilTimeMs == null) return records;
  const t = Math.trunc(untilTimeMs);
  return records.filter(r => typeof (r as any).time === "number" ? ((r as any).time as number) <= t : true);
}
