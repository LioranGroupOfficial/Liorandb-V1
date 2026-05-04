/*
LioranDB 24-Hour Clean Soak Test (Optimized + Quiet)
*/

import fs from "fs";
import path from "os";
import os from "os";
import { performance } from "perf_hooks";
import { LioranManager } from "@liorandb/core";

/* ================= CONFIG ================= */

const ROOT = "./__soak_test__";
const RUN_TIME_MS = 24 * 60 * 60 * 1000;

const TOTAL_CORES = os.cpus().length;
const CPU_CORES = Math.max(4, Math.floor(TOTAL_CORES * 0.70));

const TOTAL_RAM_MB = Math.floor(os.totalmem() / (1024 * 1024));
const CACHE_RAM_MB = Math.min(18000, Math.floor(TOTAL_RAM_MB * 0.70));

const WRITE_WORKERS = Math.floor(CPU_CORES * 0.65);
const READ_WORKERS = Math.floor(CPU_CORES * 0.35);

const BATCH_MIN = 150;
const BATCH_MAX = 500;

const WRITE_SLEEP_MIN = 1;
const WRITE_SLEEP_MAX = 7;

const READ_SLEEP_MIN = 4;
const READ_SLEEP_MAX = 18;

const KEY_POOL_SIZE = 650_000;

const METRIC_INTERVAL_MS = 10000;

/* ================= INIT ================= */

fs.mkdirSync(ROOT, { recursive: true });

let manager, db, col;
let inserts = 0, reads = 0, errors = 0;
let running = true;
const startTime = performance.now();

const writeLat = [], readLat = [];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function uptime() { return Math.floor((performance.now() - startTime) / 1000); }

/* ================= KEY POOL ================= */

const keyPool = new Map();
const keyQueue = [];

function remember(doc) {
  keyPool.set(doc.id, doc.value);
  keyQueue.push(doc.id);
  if (keyQueue.length > KEY_POOL_SIZE) {
    keyPool.delete(keyQueue.shift());
  }
}

/* ================= LATENCY HELPERS ================= */

function record(arr, ms) {
  arr.push(ms);
  if (arr.length > 12000) arr.shift();
}

function p99(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a,b)=>a-b);
  return sorted[Math.floor(sorted.length * 0.99)];
}

/* ================= DISK ================= */

let diskMB = 0;
function updateDisk() {
  try {
    let total = 0;
    const scan = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const s = fs.statSync(p);
        total += s.isDirectory() ? scan(p) : s.size;
      }
    };
    scan(ROOT);
    diskMB = total / (1024*1024);
  } catch {}
}
setInterval(updateDisk, 30000);

/* ================= MAIN INIT ================= */

async function init() {
  console.log(`🚀 LioranDB Soak Test | Cores: ${CPU_CORES}/${TOTAL_CORES} | Cache: ${CACHE_RAM_MB}MB`);

  manager = new LioranManager({
    rootPath: ROOT,
    cores: CPU_CORES,

    cache: {
      enabled: true,
      maxRAMMB: CACHE_RAM_MB,
      decay: { intervalMs: 30000, multiplier: 0.90 },
      partitions: { query: 0.60, docs: 0.30, index: 0.10 }
    },

    writeQueue: {
      maxSize: 30000,
      mode: "wait",
      timeoutMs: 15000,
      memoryPressure: {
        enabled: true,
        mode: "heap_ratio",
        highWaterMark: 0.82,
        lowWaterMark: 0.68,
        pollMs: 600
      }
    },

    batch: { chunkSize: 1200 },
    durability: "balanced",

    // === IMPORTANT: Disable latency spam for soak test ===
    latency: {
      enabled: true,
      readBudgetMs: 250,      // Much higher for stress test
      onViolation: "none"     // "none" | "warn" | "throw"  ← This silences warnings
    }
  });

  db = await manager.db("soak_test");
  col = db.collection("items");

  console.log("Creating indexes...");
  await col.createIndex({ field: "id", unique: true });
  await col.createIndex({ field: "value" });
  await col.createIndex({ field: "ts" });

  console.log("✅ Ready");
}

/* ================= WORKERS ================= */

function writer(id) {
  let counter = id * 20_000_000;
  (async () => {
    while (running) {
      const size = rand(BATCH_MIN, BATCH_MAX);
      const batch = [];
      for (let i = 0; i < size; i++) {
        const doc = { id: counter++, value: Math.random(), ts: Date.now(), worker: id };
        batch.push(doc);
        remember(doc);
      }

      const s = performance.now();
      try {
        await col.insertMany(batch);
        inserts += batch.length;
      } catch (e) { errors++; }
      record(writeLat, performance.now() - s);

      await sleep(rand(WRITE_SLEEP_MIN, WRITE_SLEEP_MAX));
    }
  })();
}

function reader() {
  (async () => {
    while (running) {
      if (!keyPool.size) { await sleep(50); continue; }
      const id = [...keyPool.keys()][rand(0, keyPool.size-1)];

      const s = performance.now();
      try {
        await col.findOne({ id });
        reads++;
      } catch { errors++; }
      record(readLat, performance.now() - s);

      await sleep(rand(READ_SLEEP_MIN, READ_SLEEP_MAX));
    }
  })();
}

/* ================= METRICS ================= */

setInterval(() => {
  const sec = uptime();
  console.log(
    `Uptime: ${sec}s | ` +
    `Ins: ${inserts.toLocaleString()} (${sec ? Math.round(inserts/sec) : 0}/s) | ` +
    `Rd: ${reads.toLocaleString()} (${sec ? Math.round(reads/sec) : 0}/s) | ` +
    `Err: ${errors} | Disk: ${diskMB.toFixed(1)}MB | ` +
    `W-p99: ${p99(writeLat).toFixed(1)}ms | R-p99: ${p99(readLat).toFixed(1)}ms`
  );
}, METRIC_INTERVAL_MS);

/* ================= SHUTDOWN ================= */

async function shutdown() {
  running = false;
  console.log("\nShutting down...");
  await sleep(2000);
  await manager?.close();
  console.log("\n=== FINAL ===");
  console.log("Inserts:", inserts);
  console.log("Reads:", reads);
  console.log("Errors:", errors);
  console.log("Disk:", diskMB.toFixed(1), "MB");
  process.exit(0);
}

async function main() {
  await init();

  for (let i = 0; i < WRITE_WORKERS; i++) writer(i);
  for (let i = 0; i < READ_WORKERS; i++) reader();

  setTimeout(shutdown, RUN_TIME_MS);
}

main().catch(console.error);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);