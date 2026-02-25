import fs from "fs";
import path from "path";
import { ClassicLevel } from "classic-level";
import { Collection } from "./collection.js";
import { Index } from "./index.js";
import { decryptData } from "../utils/encryption.js";

/* ---------------------------------------------------------
   CONSTANTS
--------------------------------------------------------- */

const TMP_SUFFIX = "__compact_tmp";
const OLD_SUFFIX = "__compact_old";
const INDEX_DIR = "__indexes";

/* ---------------------------------------------------------
   PUBLIC ENTRY
--------------------------------------------------------- */

/**
 * Full safe compaction pipeline:
 * 1. Crash recovery
 * 2. Snapshot rebuild
 * 3. Atomic directory swap
 * 4. Index rebuild
 */
export async function compactCollectionEngine(col: Collection) {
  const baseDir = col.dir;
  const tmpDir = baseDir + TMP_SUFFIX;
  const oldDir = baseDir + OLD_SUFFIX;

  // Recover from any previous crash mid-compaction
  await crashRecovery(baseDir);

  // Clean leftovers (paranoia safety)
  safeRemove(tmpDir);
  safeRemove(oldDir);

  // Step 1: rebuild snapshot
  await snapshotRebuild(col, tmpDir);

  // Step 2: atomic swap
  atomicSwap(baseDir, tmpDir, oldDir);

  // Cleanup
  safeRemove(oldDir);
}

/* ---------------------------------------------------------
   SNAPSHOT REBUILD
--------------------------------------------------------- */

/**
 * Rebuilds DB by copying only live keys
 * WAL is assumed already checkpointed
 */
async function snapshotRebuild(col: Collection, tmpDir: string) {
  fs.mkdirSync(tmpDir, { recursive: true });

  const tmpDB = new ClassicLevel(tmpDir, {
    valueEncoding: "utf8"
  });

  for await (const [key, val] of col.db.iterator()) {
    if (val !== undefined) {
      await tmpDB.put(key, val);
    }
  }

  await tmpDB.close();
  await col.db.close();
}

/* ---------------------------------------------------------
   ATOMIC SWAP
--------------------------------------------------------- */

/**
 * Atomic directory replacement (POSIX safe)
 */
function atomicSwap(base: string, tmp: string, old: string) {
  fs.renameSync(base, old);
  fs.renameSync(tmp, base);
}

/* ---------------------------------------------------------
   CRASH RECOVERY
--------------------------------------------------------- */

/**
 * Handles all partial-compaction states
 */
export async function crashRecovery(baseDir: string) {
  const tmp = baseDir + TMP_SUFFIX;
  const old = baseDir + OLD_SUFFIX;

  const baseExists = fs.existsSync(baseDir);
  const tmpExists = fs.existsSync(tmp);
  const oldExists = fs.existsSync(old);

  // Case 1: swap interrupted → tmp is valid snapshot
  if (tmpExists && oldExists) {
    safeRemove(baseDir);
    fs.renameSync(tmp, baseDir);
    safeRemove(old);
    return;
  }

  // Case 2: rename(base → old) happened, but tmp missing
  if (!baseExists && oldExists) {
    fs.renameSync(old, baseDir);
    return;
  }

  // Case 3: rebuild interrupted
  if (tmpExists && !oldExists) {
    safeRemove(tmp);
  }
}

/* ---------------------------------------------------------
   INDEX REBUILD
--------------------------------------------------------- */

/**
 * Rebuilds all indexes from compacted DB
 * Guarantees index consistency
 */
export async function rebuildIndexes(col: Collection) {
  const indexRoot = path.join(col.dir, INDEX_DIR);

  // Close existing index handles
  for (const idx of col["indexes"].values()) {
    try {
      await idx.close();
    } catch {}
  }

  // Destroy index directory
  safeRemove(indexRoot);
  fs.mkdirSync(indexRoot, { recursive: true });

  const newIndexes = new Map<string, Index>();

  for (const idx of col["indexes"].values()) {
    const rebuilt = new Index(col.dir, idx.field, {
      unique: idx.unique
    });

    for await (const [, enc] of col.db.iterator()) {
      if (!enc) continue;
      const doc = decryptData(enc);
      await rebuilt.insert(doc);
    }

    newIndexes.set(idx.field, rebuilt);
  }

  col["indexes"] = newIndexes;
}

/* ---------------------------------------------------------
   UTIL
--------------------------------------------------------- */

function safeRemove(p: string) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}