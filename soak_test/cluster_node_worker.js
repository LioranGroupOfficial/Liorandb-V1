import fs from "fs";
import path from "path";
import { parentPort, workerData } from "worker_threads";
import { LioranManager } from "../dist/index.js";

if (!parentPort) {
  throw new Error("cluster_node_worker must run as a worker thread");
}

console.log(`[cluster_node_worker] boot nodeId=${workerData?.nodeId}`);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const {
  nodeId,
  host,
  raftPort,
  walStreamPort,
  clientPort,
  rootPath,
  token,
  peers
} = workerData;

const backupDir = path.join(rootPath, "__backups");
fs.mkdirSync(rootPath, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

let manager;
try {
  manager = new LioranManager({
    rootPath,
    cores: Math.max(1, Math.trunc(Number(process.env.LIORAN_CORES ?? 4))),
    cache: {
      enabled: true,
      // Total across 4 nodes ~= 10 GiB
      maxRAMMB: Math.max(64, Math.trunc((Number(process.env.LIORAN_CACHE_MB ?? 2560)))),
      partitions: { query: 0.2, docs: 0.6, index: 0.2 },
      decay: { intervalMs: 60_000, multiplier: 0.95 }
    },
    storage: {
      adaptiveCompaction: { enabled: false },
      leveldb: {
        // Reduce disk reads for hot point-lookups.
        cacheSize: Math.max(64 * 1024 * 1024, Math.trunc(Number(process.env.LIORAN_LEVEL_CACHE_BYTES ?? (512 * 1024 * 1024)))),
        maxOpenFiles: Math.max(256, Math.trunc(Number(process.env.LIORAN_LEVEL_MAX_OPEN_FILES ?? 2048))),
        compression: process.env.LIORAN_LEVEL_COMPRESSION ? process.env.LIORAN_LEVEL_COMPRESSION !== "0" : true
      }
    },
    cluster: {
      enabled: true,
      nodeId,
      host,
      raftPort,
      walStreamPort,
      clientPort,
      peers,
      heartbeatMs: 500,
      electionTimeoutMs: { min: 1500, max: 3000 },
      waitForMajority: false,
      waitTimeoutMs: 1500,
      client: {
        port: clientPort,
        maxMessageBytes: 256 * 1024,
        auth: { token, required: true }
      }
    },
    slo: {
      // Soak harness runs many parallel client loops; use bounded waiting instead of immediate reject.
      read: { enabled: true, mode: "wait", maxInFlight: Math.max(256, Math.trunc(Number(process.env.LIORAN_READ_MAX_INFLIGHT ?? 2048))), maxQueue: Math.max(0, Math.trunc(Number(process.env.LIORAN_READ_MAX_QUEUE ?? 4096))), timeoutMs: Math.max(0, Math.trunc(Number(process.env.LIORAN_READ_TIMEOUT_MS ?? 250))) },
      write: { enabled: true, mode: "wait", maxInFlight: Math.max(64, Math.trunc(Number(process.env.LIORAN_WRITE_MAX_INFLIGHT ?? 512))), maxQueue: Math.max(0, Math.trunc(Number(process.env.LIORAN_WRITE_MAX_QUEUE ?? 10000))), timeoutMs: Math.max(0, Math.trunc(Number(process.env.LIORAN_WRITE_TIMEOUT_MS ?? 30000))) }
    },
    consistency: {
      reads: {
        mode: "bounded_stale",
        maxLagMs: 250,
        maxLagLSN: 5000,
        autoDegradeToStaleOk: false
      }
    },
    // Relax read-after-write coupling inside a node; soak focuses on latency under load.
    writeQueue: {
      // Prevent reads from being blocked behind very deep writer backlog due to forced ordering.
      maxSize: Math.max(10_000, Math.trunc(Number(process.env.LIORAN_WRITEQUEUE_MAX ?? 50_000))),
      mode: "wait",
      timeoutMs: Math.max(1, Math.trunc(Number(process.env.LIORAN_WRITEQUEUE_TIMEOUT_MS ?? 200)))
    },
    background: {
      enabled: true,
      intervalMs: 2000,
      dbTicksEnabled: false,
      backup: {
        enabled: process.env.SOAK_BACKUPS ? process.env.SOAK_BACKUPS !== "0" : true,
        outDir: backupDir,
        snapshotEveryMs: Math.max(60_000, Math.trunc(Number(process.env.SOAK_SNAPSHOT_MS ?? 5 * 60_000))),
        incrementalEveryMs: Math.max(5_000, Math.trunc(Number(process.env.SOAK_PITR_MS ?? 30_000))),
        retention: { snapshots: 5, incrementals: 50 },
        verifyRestoreEveryMs: Math.max(60_000, Math.trunc(Number(process.env.SOAK_VERIFY_MS ?? 10 * 60_000))),
        verifyPitrDelayMs: 2000
      }
    },
    compute: { enabled: true },
    latency: { enabled: true, onViolation: "none" }
  });
  parentPort.postMessage({ ok: true, type: "ready", nodeId, ports: { raftPort, walStreamPort, clientPort } });
} catch (err) {
  parentPort.postMessage({ ok: false, type: "boot_error", nodeId, error: String(err?.stack || err) });
  throw err;
}

let replicationPaused = false;
let replicationDelayMs = 0;

// Throttle replica apply without fully stopping the stream (lets leaderLSN advance so lag grows).
// Best-effort: only used by soak harness.
const origDb = manager.db.bind(manager);
const patched = new WeakSet();
manager.db = async (name) => {
  const db = await origDb(name);
  try {
    if (!patched.has(db) && typeof db.applyReplicatedWAL === "function") {
      patched.add(db);
      const origApply = db.applyReplicatedWAL.bind(db);
      db.applyReplicatedWAL = async (records) => {
        const d = Math.max(0, Math.trunc(replicationDelayMs));
        if (d > 0) await sleep(d);
        return await origApply(records);
      };
    }
  } catch {}
  return db;
};

async function pauseReplication() {
  if (replicationPaused) return;
  replicationPaused = true;
  try {
    (manager).replicaReplicator?.stop?.();
  } catch {}
  try {
    (manager).replicaReplicator = undefined;
  } catch {}
}

async function resumeReplication() {
  if (!replicationPaused) return;
  replicationPaused = false;
  try {
    await (manager)._ensureReplicaReplicator?.();
    for (const [name, db] of manager.openDBs.entries()) {
      manager.replicaReplicator?.ensure?.(name, db);
    }
  } catch {}
}

parentPort.on("message", async msg => {
  try {
    if (msg?.type === "shutdown") {
      await manager.closeAll();
      parentPort.postMessage({ ok: true, type: "shutdown" });
      process.exit(0);
    }
    if (msg?.type === "pause_replication") {
      await pauseReplication();
      parentPort.postMessage({ ok: true, type: "paused" });
    }
    if (msg?.type === "resume_replication") {
      await resumeReplication();
      parentPort.postMessage({ ok: true, type: "resumed" });
    }
    if (msg?.type === "set_replication_delay") {
      replicationDelayMs = Math.max(0, Math.trunc(msg?.ms ?? 0));
      parentPort.postMessage({ ok: true, type: "replication_delay_set", ms: replicationDelayMs });
    }
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err) });
  }
});

process.on("uncaughtException", err => {
  const msg = String((err && err.stack) || err);
  // Expected during chaos (leader kill / restarts).
  if (msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET") || msg.includes("EPIPE")) return;
  parentPort.postMessage({ ok: false, type: "uncaught", nodeId, error: msg });
});
process.on("unhandledRejection", err => {
  const msg = String((err && err.stack) || err);
  // Expected during chaos (leader kill / restarts).
  if (msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET") || msg.includes("EPIPE") || msg.includes("EADDRINUSE")) return;
  parentPort.postMessage({ ok: false, type: "unhandled", nodeId, error: msg });
});

// Keep alive (do NOT unref; worker must stay running)
setInterval(() => {}, 60_000);
