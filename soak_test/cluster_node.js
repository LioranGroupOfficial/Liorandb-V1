import fs from "fs";
import path from "path";
import process from "process";
import { LioranManager } from "../dist/index.js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const nodeId = mustEnv("NODE_ID");
const host = mustEnv("HOST");
const raftPort = Number(mustEnv("RAFT_PORT"));
const walStreamPort = Number(mustEnv("WAL_STREAM_PORT"));
const clientPort = Number(mustEnv("CLIENT_PORT"));
const rootPath = mustEnv("ROOT_PATH");
const token = mustEnv("RPC_TOKEN");
const peers = JSON.parse(mustEnv("PEERS_JSON"));

const backupDir = path.join(rootPath, "__backups");
fs.mkdirSync(rootPath, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

const manager = new LioranManager({
  rootPath,
  cluster: {
    enabled: true,
    nodeId,
    host,
    raftPort,
    walStreamPort,
    clientPort,
    peers,
    waitForMajority: true,
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

let replicationPaused = false;

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

process.on("message", async msg => {
  try {
    if (msg?.type === "shutdown") {
      await manager.closeAll();
      process.exit(0);
    }
    if (msg?.type === "pause_replication") {
      await pauseReplication();
      process.send?.({ ok: true, type: "paused" });
    }
    if (msg?.type === "resume_replication") {
      await resumeReplication();
      process.send?.({ ok: true, type: "resumed" });
    }
  } catch (err) {
    process.send?.({ ok: false, error: String(err) });
  }
});

process.on("SIGINT", async () => {
  await manager.closeAll();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await manager.closeAll();
  process.exit(0);
});

// Keep alive
setInterval(() => {}, 60_000).unref?.();

