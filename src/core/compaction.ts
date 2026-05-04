import fs from "fs";
import path from "path";
import { ClassicLevel } from "classic-level";
import { Collection } from "./collection.js";
import { Index, TextIndex } from "./index.js";
import { decryptData } from "../utils/encryption.js";
import { asLiorandbError } from "../utils/errors.js";

/* ---------------------------------------------------------
   CONSTANTS
--------------------------------------------------------- */

const TMP_SUFFIX = "__compact_tmp";
const OLD_SUFFIX = "__compact_old";
const INDEX_DIR = "__indexes";
const COLLECTION_META_KEY_PREFIX = "\u0000__meta__:";

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
export async function compactCollectionEngine(col: Collection, aggressive = true) {
  // Lightweight in-place compaction: lets LevelDB compact SSTs without rebuilding/swap.
  if (!aggressive) {
    try {
      await col.db.open();
    } catch {}
    // Full keyspace compaction.
    await col.db.compactRange("\x00", "\uffff");
    return;
  }

  const baseDir = col.dir;
  const tmpDir = baseDir + TMP_SUFFIX;
  const oldDir = baseDir + OLD_SUFFIX;

  // On Windows, open LevelDB handles prevent directory renames.
  // Always close index handles before attempting atomic swaps.
  for (const idx of new Map(col["indexes"]).values()) {
    try { await idx.close(); } catch {}
  }
  for (const idx of new Map(col["textIndexes"] ?? []).values()) {
    try { await idx.close(); } catch {}
  }

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

  // Iterators require an open handle; compaction may be called before any other op.
  await tmpDB.open();
  await col.db.open();

  for await (const [key, val] of col.db.iterator()) {
    if (key.startsWith(COLLECTION_META_KEY_PREFIX)) continue;
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
    throw asLiorandbError(err, {
      code: "IO_ERROR",
      message: "Compaction atomic swap failed",
      details: { base, tmp, old }
    });
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
  const leveldb = (col as any)._leveldbOptions as any;
  col.db = new ClassicLevel(col.dir, {
    valueEncoding: "utf8",
    ...(leveldb ?? {})
  } as any);
  await col.db.open();
}

/* ---------------------------------------------------------
   INDEX REBUILD (SAFE)
--------------------------------------------------------- */

export async function rebuildIndexes(col: Collection) {
  // Rebuild may run right after a reopen; ensure the handle is open for iterators.
  await col.db.open();
  const indexRoot = path.join(col.dir, INDEX_DIR);

  const oldIndexes = new Map(col["indexes"]);
  const oldTextIndexes = new Map(col["textIndexes"] ?? []);

  // Close old index handles
  for (const idx of oldIndexes.values()) {
    try {
      await idx.close();
    } catch {}
  }
  for (const idx of oldTextIndexes.values()) {
    try { await idx.close(); } catch {}
  }

  safeRemove(indexRoot);
  fs.mkdirSync(indexRoot, { recursive: true });

  const rebuiltIndexes = new Map<string, Index>();
  const rebuiltTextIndexes = new Map<string, TextIndex>();

  for (const idx of oldIndexes.values()) {
    const rebuilt = new Index(col.dir, idx.field, {
      unique: idx.unique
    }, (col as any)._leveldbOptions);
    const docs: any[] = [];
    const flush = async () => {
      if (docs.length === 0) return;
      await rebuilt.bulkInsert(docs);
      docs.length = 0;
    };

    for await (const [key, enc] of col.db.iterator()) {
      if (key.startsWith(COLLECTION_META_KEY_PREFIX) || !enc) continue;

      try {
        const doc = decryptData(enc);
        docs.push(doc);
        if (docs.length >= 5000) {
          await flush();
        }
      } catch {
        // Skip corrupted doc safely
      }
    }

    await flush();

    rebuiltIndexes.set(idx.field, rebuilt);
  }

  col["indexes"] = rebuiltIndexes;

  for (const idx of oldTextIndexes.values()) {
    const rebuilt = new TextIndex(col.dir, idx.field, (idx as any).options ?? {}, (col as any)._leveldbOptions);
    const docs: any[] = [];
    const flush = async () => {
      if (docs.length === 0) return;
      await rebuilt.bulkInsert(docs);
      docs.length = 0;
    };

    for await (const [key, enc] of col.db.iterator()) {
      if (key.startsWith(COLLECTION_META_KEY_PREFIX) || !enc) continue;
      try {
        docs.push(decryptData(enc));
        if (docs.length >= 5000) await flush();
      } catch {}
    }

    await flush();
    rebuiltTextIndexes.set(idx.field, rebuilt);
  }

  col["textIndexes"] = rebuiltTextIndexes;
}

/* ---------------------------------------------------------
   UTIL
--------------------------------------------------------- */

function safeRemove(p: string) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}
