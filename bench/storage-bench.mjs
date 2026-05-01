import fs from "node:fs";
import path from "node:path";

import { LioranManager } from "../dist/index.js";

function envInt(name, def) {
  const v = process.env[name];
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function envStr(name, def) {
  const v = process.env[name];
  return v === undefined ? def : String(v);
}

function formatMB(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function dirSizeBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {}
      }
    }
  }
  return total;
}

const DOCS = envInt("LIORAN_BENCH_DOCS", 200_000);
const BATCH = envInt("LIORAN_BENCH_BATCH", 500);
const DOC_BYTES = envInt("LIORAN_BENCH_DOC_BYTES", 512);
const COMPACT = envStr("LIORAN_BENCH_COMPACT", "0") === "1";

const tieredFields = envStr("LIORAN_BENCH_TIERED_FIELDS", "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
const tieredThreshold = envInt("LIORAN_BENCH_TIERED_THRESHOLD", 8 * 1024);

const rootPath = path.join(process.cwd(), "bench", ".tmp", `storage-${Date.now()}-${Math.random().toString(16).slice(2)}`);
fs.mkdirSync(rootPath, { recursive: true });

const manager = new LioranManager({ rootPath, ipc: "primary" });

const payload = "x".repeat(Math.max(0, DOC_BYTES));

const startedAt = Date.now();
let inserted = 0;

try {
  const db = await manager.db("db1");

  const col = db.collection("posts", undefined, undefined, tieredFields.length
    ? { tieredStorage: { fields: tieredFields, thresholdBytes: tieredThreshold } }
    : undefined
  );

  for (let i = 0; i < DOCS; i += BATCH) {
    const chunk = [];
    const end = Math.min(DOCS, i + BATCH);
    for (let j = i; j < end; j++) {
      chunk.push({ _id: `p-${j}`, username: `user-${j % 1000}`, title: `hello ${j}`, body: payload });
    }
    await col.insertMany(chunk, { chunkSize: BATCH });
    inserted += chunk.length;
  }

  const writeMs = Date.now() - startedAt;
  const beforeSize = dirSizeBytes(path.join(rootPath, "db1"));

  let compactMs = null;
  let afterSize = null;

  if (COMPACT) {
    const compactStart = Date.now();
    await db.compactAll();
    compactMs = Date.now() - compactStart;
    afterSize = dirSizeBytes(path.join(rootPath, "db1"));
  }

  const summary = {
    docs: inserted,
    batch: BATCH,
    approxDocBytes: DOC_BYTES,
    tiered: tieredFields.length ? { fields: tieredFields, thresholdBytes: tieredThreshold } : null,
    write: {
      ms: writeMs,
      docsPerSec: Math.round((inserted / (writeMs / 1000)) * 10) / 10
    },
    disk: {
      beforeMB: formatMB(beforeSize),
      afterMB: afterSize === null ? null : formatMB(afterSize)
    },
    compaction: compactMs === null ? null : { ms: compactMs }
  };

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await manager.closeAll().catch(() => {});
}

