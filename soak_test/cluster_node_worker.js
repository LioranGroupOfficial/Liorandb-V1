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
    cluster: {
      enabled: true,
      nodeId,
      host,
      raftPort,
      walStreamPort,
      clientPort,
      peers,
      waitForMajority: false,
      waitTimeoutMs: 1500,
      client: {
        port: clientPort,
        maxMessageBytes: 256 * 1024,
        auth: { token, required: true }
      }
    },
    consistency: {
      reads: {
        mode: "bounded_stale",
        maxLagMs: 250,
        maxLagLSN: 5000,
        autoDegradeToStaleOk: false
      }
    },
    background: {
      enabled: true,
      intervalMs: 2000,
      backup: {
        enabled: true,
        outDir: backupDir,
        snapshotEveryMs: 30_000,
        incrementalEveryMs: 5000,
        retention: { snapshots: 5, incrementals: 50 },
        verifyRestoreEveryMs: 45_000,
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
  parentPort.postMessage({ ok: false, type: "uncaught", nodeId, error: String(err?.stack || err) });
});
process.on("unhandledRejection", err => {
  parentPort.postMessage({ ok: false, type: "unhandled", nodeId, error: String(err?.stack || err) });
});

// Keep alive (do NOT unref; worker must stay running)
setInterval(() => {}, 60_000);
