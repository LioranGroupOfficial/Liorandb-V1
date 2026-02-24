import fs from "fs";
import path from "path";
import { ClassicLevel } from "classic-level";
import { Collection } from "./collection.js";
import { Index } from "./index.js";
import { decryptData } from "../utils/encryption.js";

const TMP_SUFFIX = "__compact_tmp";
const OLD_SUFFIX = "__old";

/**
 * Entry point: safe compaction wrapper
 */
export async function compactCollectionEngine(col: Collection) {
  await crashRecovery(col.dir);

  const baseDir = col.dir;
  const tmpDir = baseDir + TMP_SUFFIX;
  const oldDir = baseDir + OLD_SUFFIX;

  // Cleanup stale dirs
  safeRemove(tmpDir);
  safeRemove(oldDir);

  // Snapshot rebuild
  await snapshotRebuild(col, tmpDir);

  // Atomic swap
  atomicSwap(baseDir, tmpDir, oldDir);

  // Cleanup old data
  safeRemove(oldDir);
}

/**
 * Copies only live keys into fresh DB
 */
async function snapshotRebuild(col: Collection, tmpDir: string) {
  fs.mkdirSync(tmpDir, { recursive: true });

  const tmpDB = new ClassicLevel(tmpDir, { valueEncoding: "utf8" });

  for await (const [key, val] of col.db.iterator()) {
    await tmpDB.put(key, val);
  }

  await tmpDB.close();
  await col.db.close();
}

/**
 * Atomic directory replace
 */
function atomicSwap(base: string, tmp: string, old: string) {
  fs.renameSync(base, old);
  fs.renameSync(tmp, base);
}

/**
 * Crash recovery handler
 */
export async function crashRecovery(baseDir: string) {
  const tmp = baseDir + TMP_SUFFIX;
  const old = baseDir + OLD_SUFFIX;

  // If both exist → compaction mid-swap
  if (fs.existsSync(tmp) && fs.existsSync(old)) {
    safeRemove(baseDir);
    fs.renameSync(tmp, baseDir);
    safeRemove(old);
  }

  // If only old exists → swap incomplete
  if (fs.existsSync(old) && !fs.existsSync(baseDir)) {
    fs.renameSync(old, baseDir);
  }

  // If only tmp exists → rebuild incomplete
  if (fs.existsSync(tmp) && !fs.existsSync(old)) {
    safeRemove(tmp);
  }
}

/**
 * Index rebuild engine
 */
export async function rebuildIndexes(col: Collection) {
  const indexRoot = path.join(col.dir, "__indexes");

  // Destroy existing indexes
  safeRemove(indexRoot);
  fs.mkdirSync(indexRoot, { recursive: true });

  for (const idx of col["indexes"].values()) {
    try { await idx.close(); } catch {}
  }

  const newIndexes = new Map<string, Index>();

  for (const idx of col["indexes"].values()) {
    const fresh = new Index(col.dir, idx.field, {
      unique: idx.unique
    });

    for await (const [, enc] of col.db.iterator()) {
      const doc = decryptData(enc);
      await fresh.insert(doc);
    }

    newIndexes.set(idx.field, fresh);
  }

  col["indexes"] = newIndexes;
}

/**
 * Safe recursive remove
 */
function safeRemove(p: string) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}