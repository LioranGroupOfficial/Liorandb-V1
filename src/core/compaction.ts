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
 * Full production-safe compaction:
 * 1. Crash recovery
 * 2. Snapshot rebuild
 * 3. Atomic swap
 * 4. Reopen DB
 * 5. Rebuild indexes
 */
export async function compactCollectionEngine(col: Collection) {
  const baseDir = col.dir;
  const tmpDir = baseDir + TMP_SUFFIX;
  const oldDir = baseDir + OLD_SUFFIX;

  await crashRecovery(baseDir);

  safeRemove(tmpDir);
  safeRemove(oldDir);

  await snapshotRebuild(col, tmpDir);

  await atomicSwap(baseDir, tmpDir, oldDir);

  safeRemove(oldDir);

  // Reopen DB after swap
  await reopenCollectionDB(col);

  // Rebuild indexes after compaction
  await rebuildIndexes(col);
}

/* ---------------------------------------------------------
   SNAPSHOT REBUILD
--------------------------------------------------------- */

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
  await col.db.close(); // important: close before swap
}

/* ---------------------------------------------------------
   ATOMIC SWAP (HARDENED)
--------------------------------------------------------- */

async function atomicSwap(base: string, tmp: string, old: string) {
  // Phase 1: rename base → old
  fs.renameSync(base, old);

  try {
    // Phase 2: rename tmp → base
    fs.renameSync(tmp, base);
  } catch (err) {
    // Rollback if tmp rename fails
    if (fs.existsSync(old)) {
      fs.renameSync(old, base);
    }
    throw err;
  }
}

/* ---------------------------------------------------------
   CRASH RECOVERY
--------------------------------------------------------- */

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

  // Case 2: base→old happened but tmp missing
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
   REOPEN DB
--------------------------------------------------------- */

async function reopenCollectionDB(col: Collection) {
  col.db = new ClassicLevel(col.dir, {
    valueEncoding: "utf8"
  });
}

/* ---------------------------------------------------------
   INDEX REBUILD (SAFE)
--------------------------------------------------------- */

export async function rebuildIndexes(col: Collection) {
  const indexRoot = path.join(col.dir, INDEX_DIR);

  const oldIndexes = new Map(col["indexes"]);

  // Close old index handles
  for (const idx of oldIndexes.values()) {
    try {
      await idx.close();
    } catch {}
  }

  safeRemove(indexRoot);
  fs.mkdirSync(indexRoot, { recursive: true });

  const rebuiltIndexes = new Map<string, Index>();

  for (const idx of oldIndexes.values()) {
    const rebuilt = new Index(col.dir, idx.field, {
      unique: idx.unique
    });

    for await (const [, enc] of col.db.iterator()) {
      if (!enc) continue;

      try {
        const doc = decryptData(enc);
        await rebuilt.insert(doc);
      } catch {
        // Skip corrupted doc safely
      }
    }

    rebuiltIndexes.set(idx.field, rebuilt);
  }

  col["indexes"] = rebuiltIndexes;
}

/* ---------------------------------------------------------
   UTIL
--------------------------------------------------------- */

function safeRemove(p: string) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}