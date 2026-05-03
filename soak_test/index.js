/*
LioranDB 24-Hour Optimized Soak / Load Test
------------------------------------------
Target Machine:
- 16 CPU cores (use max ~12)
- 24 GB RAM (use max ~16 GB)
- 600 GB disk

Key Improvements:
- Controlled concurrency (CPU-aware)
- Memory-safe key pool
- Backpressure on writes
- Pre-created indexes (real-world simulation)
- Better batching + throughput tuning
- Graceful shutdown
*/

import fs from "fs";
import path from "path";
import os from "os";
import { performance } from "perf_hooks";
import { LioranManager } from "@liorandb/core";

/* ================= CONFIG ================= */

const ROOT = "./__soak_test__";
const RUN_TIME_MS = 24 * 60 * 60 * 1000; // 1 day

// Use ~75% CPU (12 out of 16 cores)
const CPU_CORES = Math.min(12, os.cpus().length);

const WRITE_WORKERS = Math.floor(CPU_CORES * 0.6); // ~7
const READ_WORKERS = Math.floor(CPU_CORES * 0.4);  // ~5

const BATCH_MIN = 100;
const BATCH_MAX = 400;

const WRITE_SLEEP_MIN = 2;
const WRITE_SLEEP_MAX = 10;

const READ_SLEEP_MIN = 5;
const READ_SLEEP_MAX = 20;

// Memory control (~16GB safe cap via key pool)
const KEY_POOL_SIZE = 500_000;

const METRIC_INTERVAL_MS = 10_000;

/* ================= FS ================= */

fs.mkdirSync(ROOT, { recursive: true });

/* ================= STATE ================= */

let manager;
let db;
let col;

let inserts = 0;
let reads = 0;
let errors = 0;

let running = true;

const startTime = performance.now();

/* ================= HELPERS ================= */

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function uptimeSeconds() {
  return Math.floor((performance.now() - startTime) / 1000);
}

/* ================= DISK ================= */

let diskMB = 0;

function safeScan(dir) {
  let total = 0;
  let entries;

  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }

  for (const file of entries) {
    const full = path.join(dir, file);

    let stats;
    try {
      stats = fs.statSync(full);
    } catch (err) {
      if (err.code === "ENOENT") continue;
      throw err;
    }

    if (stats.isDirectory()) {
      total += safeScan(full);
    } else {
      total += stats.size;
    }
  }

  return total;
}

function updateDisk() {
  try {
    const bytes = safeScan(ROOT);
    diskMB = bytes / 1024 / 1024;
  } catch {}
}

setInterval(updateDisk, 30000);
updateDisk();

/* ================= KEY POOL ================= */

const keyPool = new Map();
const keyQueue = [];

function remember(doc) {
  keyPool.set(doc.id, doc.value);
  keyQueue.push(doc.id);

  if (keyQueue.length > KEY_POOL_SIZE) {
    const old = keyQueue.shift();
    keyPool.delete(old);
  }
}

/* ================= LATENCY ================= */

const writeLat = [];
const readLat = [];

function record(arr, value) {
  arr.push(value);
  if (arr.length > 10000) arr.shift();
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}

/* ================= INIT ================= */

async function init() {
  manager = new LioranManager({ rootPath: ROOT });

  db = await manager.db("test");
  col = db.collection("items");

  console.log("Creating indexes...");

  await db.createIndex("items", "id", { unique: true });
  await db.createIndex("items", "value");
  await db.createIndex("items", "ts");
  await db.createIndex("items", "worker");

  console.log("Indexes ready");

  // Background maintenance (light compaction) to keep SST/WAL growth in check during long runs.
  setInterval(() => {
    db.maintenance({ aggressive: false }).catch(() => {});
  }, 10 * 60 * 1000); // every 10 minutes
}

/* ================= WRITER ================= */

function writer(id) {
  let counter = id * 10_000_000;

  (async function loop() {
    while (running) {
      const batchSize = rand(BATCH_MIN, BATCH_MAX);
      const batch = [];

      for (let i = 0; i < batchSize; i++) {
        const doc = {
          id: counter++,
          value: Math.random(),
          ts: Date.now(),
          worker: id
        };

        batch.push(doc);
        remember(doc);
      }

      const start = performance.now();

      try {
        await col.insertMany(batch);
        inserts += batch.length;
      } catch {
        errors++;
      }

      record(writeLat, performance.now() - start);

      await sleep(rand(WRITE_SLEEP_MIN, WRITE_SLEEP_MAX));
    }
  })();
}

/* ================= READER ================= */

function reader() {
  (async function loop() {
    while (running) {
      const keys = Array.from(keyPool.keys());

      if (!keys.length) {
        await sleep(50);
        continue;
      }

      const id = keys[rand(0, keys.length - 1)];
      const expected = keyPool.get(id);

      const start = performance.now();

      try {
        const doc = await col.findOne({ id });
        reads++;

        if (doc && doc.value !== expected) {
          errors++;
          console.error("DATA MISMATCH", id);
        }
      } catch {
        errors++;
      }

      record(readLat, performance.now() - start);

      await sleep(rand(READ_SLEEP_MIN, READ_SLEEP_MAX));
    }
  })();
}

/* ================= METRICS ================= */

setInterval(() => {
  const seconds = uptimeSeconds();

  const insertRate = seconds ? Math.round(inserts / seconds) : 0;
  const readRate = seconds ? Math.round(reads / seconds) : 0;

  console.log(
    "Uptime:", seconds, "sec",
    "| Inserts:", inserts,
    "| Reads:", reads,
    "| Errors:", errors,
    "| Insert/s:", insertRate,
    "| Read/s:", readRate,
    "| Disk MB:", diskMB.toFixed(1),
    "| Write p99:", percentile(writeLat, 0.99).toFixed(2), "ms",
    "| Read p99:", percentile(readLat, 0.99).toFixed(2), "ms"
  );
}, METRIC_INTERVAL_MS);

/* ================= SHUTDOWN ================= */

async function shutdown() {
  running = false;

  console.log("Stopping test...");
  await sleep(3000);

  console.log("FINAL STATS");
  console.log("Inserts:", inserts);
  console.log("Reads:", reads);
  console.log("Errors:", errors);
  console.log("Disk MB:", diskMB.toFixed(1));

  await manager.close();
  process.exit(0);
}

/* ================= MAIN ================= */

async function main() {
  console.log("Starting 24-hour optimized load test...");
  console.log("CPU Workers:", CPU_CORES);
  console.log("Writers:", WRITE_WORKERS, "Readers:", READ_WORKERS);

  await init();

  for (let i = 0; i < WRITE_WORKERS; i++) writer(i);
  for (let i = 0; i < READ_WORKERS; i++) reader();

  setTimeout(shutdown, RUN_TIME_MS);
}

main();
