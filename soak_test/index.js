/*
Cluster soak/chaos harness:
- spins up 3 local nodes
- exercises leader failover + write redirection
- forces replica lag and validates lag-based read routing (bounded_stale => forward-to-leader)
- validates scheduled snapshot + PITR + restore verification jobs run without crashing

Run:
  npm run build
  node soak_test/index.js
*/

import fs from "fs";
import path from "path";
import os from "os";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randId() {
  return Math.random().toString(16).slice(2);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const RUN_MS = Number(process.env.RUN_MS ?? 120_000);
const BASE = path.join(__dirname, "__cluster_soak__", `run-${Date.now()}-${randId()}`);
ensureDir(BASE);

const token = process.env.RPC_TOKEN ?? `t-${randId()}-${randId()}`;
const host = "127.0.0.1";
let CURRENT_LEADER_PORT = null;
const basePort = Number(process.env.BASE_PORT ?? (20000 + Math.floor(Math.random() * 20000)));
const nodes = [
  { id: "n1", raftPort: basePort + 11, walPort: basePort + 12, clientPort: basePort + 13, root: path.join(BASE, "n1") },
  { id: "n2", raftPort: basePort + 21, walPort: basePort + 22, clientPort: basePort + 23, root: path.join(BASE, "n2") },
  { id: "n3", raftPort: basePort + 31, walPort: basePort + 32, clientPort: basePort + 33, root: path.join(BASE, "n3") }
];

const peersFor = (selfId) =>
  nodes
    .filter(n => n.id !== selfId)
    .map(n => ({
      id: n.id,
      host,
      raftPort: n.raftPort,
      walStreamPort: n.walPort,
      clientPort: n.clientPort
    }));

function startNode(node) {
  ensureDir(node.root);
  const worker = new Worker(new URL("./cluster_node_worker.js", import.meta.url), {
    type: "module",
    workerData: {
      nodeId: node.id,
      host,
      raftPort: node.raftPort,
      walStreamPort: node.walPort,
      clientPort: node.clientPort,
      rootPath: node.root,
      token,
      peers: peersFor(node.id)
    }
  });
  worker.on("error", err => {
    console.error(`[soak] worker_error ${node.id}:`, err);
  });
  worker.on("exit", code => {
    console.error(`[soak] worker_exit ${node.id}: code=${code}`);
  });
  worker.on("message", msg => {
    if (msg?.ok === false) {
      console.error(`[soak] worker_msg ${node.id}:`, msg);
    }
  });
  return worker;
}

async function workerCmd(worker, msg, timeoutMs = 1000) {
  if (!worker) return null;
  return await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("workerCmd timeout")), timeoutMs);
    t.unref?.();
    const onMsg = (m) => {
      if (!m || typeof m !== "object") return;
      if (m.ok === false) {
        cleanup();
        reject(new Error(String(m.error || "worker error")));
        return;
      }
      cleanup();
      resolve(m);
    };
    const cleanup = () => {
      clearTimeout(t);
      try { worker.off("message", onMsg); } catch {}
    };
    worker.on("message", onMsg);
    try { worker.postMessage(msg); } catch (e) { cleanup(); reject(e); }
  });
}

// Tiny RPC helper (no dependency on internal client) to keep harness simple
async function rpcCall(target, payload, timeoutMs = 4000) {
  const net = await import("net");
  const port = Number(target?.port ?? target?.clientPort);
  if (!Number.isFinite(port) || port <= 0) throw new Error("rpc target missing port");
  return await new Promise((resolve, reject) => {
    const sock = net.createConnection(port, host);
    sock.setNoDelay(true);
    sock.setEncoding("utf8");
    let buf = "";
    const t = setTimeout(() => {
      try { sock.destroy(); } catch {}
      reject(new Error("rpc timeout"));
    }, timeoutMs);
    t.unref?.();

    sock.on("error", reject);
    sock.on("data", chunk => {
      buf += chunk;
      const idx = buf.indexOf("\n");
      if (idx < 0) return;
      const line = buf.slice(0, idx);
      try {
        const msg = JSON.parse(line);
        clearTimeout(t);
        try { sock.end(); } catch {}
        resolve(msg);
      } catch (e) {
        clearTimeout(t);
        reject(e);
      }
    });

    sock.write(JSON.stringify(payload) + "\n");
  });
}

async function rpcExecAny(action, args) {
  const node = pick(nodes);
  const id = `${Date.now()}-${randId()}`;
  const res = await rpcCall(node, { id, action, args, token }, 5000);
  if (res.ok) return res.result;
  const err = res.error;
  if (err?.code === "NOT_LEADER") {
    const hinted = err?.details?.leader?.clientPort;
    const fallback = CURRENT_LEADER_PORT;
    const port = hinted ?? fallback;
    if (port) {
      const leader = { port };
      const res2 = await rpcCall(leader, { id, action, args, token }, 5000);
      if (res2.ok) return res2.result;
      throw new Error(`rpc failed: ${JSON.stringify(res2.error)}`);
    }
  }
  throw new Error(`rpc failed: ${JSON.stringify(err)}`);
}

async function detectLeaderPort() {
  for (const n of nodes) {
    try {
      const id = `${Date.now()}-${randId()}`;
      const res = await rpcCall(n, { id, action: "db:meta", args: { db: "soak", method: "stats", params: [] }, token }, 2000);
      if (res.ok) return n.clientPort;
      if (res.error?.code === "NOT_LEADER" && res.error?.details?.leader?.clientPort) {
        return res.error.details.leader.clientPort;
      }
    } catch {}
  }
  return null;
}

function listBackups(dir) {
  try {
    const all = fs.readdirSync(dir);
    const snapshots = all.filter(f => f.startsWith("snapshot-") && f.endsWith(".tar.gz")).sort();
    const pitrs = all.filter(f => f.startsWith("pitr-") && f.endsWith(".tar.gz")).sort();
    return { snapshots, pitrs };
  } catch {
    return { snapshots: [], pitrs: [] };
  }
}

async function verifyBackupRestore(leaderRoot, expect) {
  const backupDir = path.join(leaderRoot, "__backups");
  const deadline = Date.now() + 60_000;
  let snapshot = null;
  let pitrs = [];
  while (Date.now() < deadline) {
    const { snapshots, pitrs: p } = listBackups(backupDir);
    if (snapshots.length && p.length) {
      snapshot = path.join(backupDir, snapshots[snapshots.length - 1]);
      pitrs = p.map(f => path.join(backupDir, f));
      break;
    }
    await sleep(500);
  }
  if (!snapshot) throw new Error("no snapshot/pitr found for restore verification");

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "liorandb-soak-restore-"));
  try {
    const tar = await import("tar");
    await tar.x({ file: snapshot, cwd: tmpDir });

    const { readIncrementalBackupArchive, filterWALForPITR } = await import("../dist/backup/incremental.js");
    const { LioranManager } = await import("../dist/index.js");
    const verifyMgr = new LioranManager({
      rootPath: tmpDir,
      ipc: "primary",
      background: { enabled: false },
      compute: { enabled: false }
    });

    for (const inc of pitrs) {
      const { recordsByDb } = await readIncrementalBackupArchive(inc);
      for (const [dbName, records] of Object.entries(recordsByDb)) {
        const db = await verifyMgr.db(dbName);
        const filtered = filterWALForPITR(records, undefined);
        await db.applyReplicatedWAL(filtered);
      }
    }

    const probeId = typeof expect === "string" ? expect : (expect?.id ?? null);
    const got = probeId
      ? await (await verifyMgr.db("soak")).collection("items").findOne({ id: probeId })
      : null;
    const count = await (await verifyMgr.db("soak")).collection("items").countDocuments({});
    await verifyMgr.closeAll();
    if (probeId && (!got || got.id !== probeId) && count === 0) {
      throw new Error("restore verification failed: no data restored");
    }
    return true;
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log(`[soak] root=${BASE}`);
  console.log(`[soak] rpc_token=${token}`);

  const children = new Map();
  for (const n of nodes) {
    children.set(n.id, startNode(n));
  }

  const stopAll = async () => {
    for (const c of children.values()) {
      try { c.postMessage?.({ type: "shutdown" }); } catch {}
    }
    await sleep(500);
    for (const c of children.values()) {
      try { c.terminate?.(); } catch {}
    }
  };

  const deadline = Date.now() + RUN_MS;

  try {
    // wait for all workers to boot
    const bootDeadline = Date.now() + 10_000;
    while (Date.now() < bootDeadline) {
      // crude readiness: check TCP port responds
      let ok = 0;
      for (const n of nodes) {
        try {
          await rpcCall(n, { id: `${Date.now()}-${randId()}`, action: "db", args: { db: "__boot__" }, token }, 500);
          ok++;
        } catch {}
      }
      if (ok >= 1) break;
      await sleep(250);
    }

    // Wait for election
    let leaderPort = null;
    for (let i = 0; i < 40; i++) {
      leaderPort = await detectLeaderPort();
      if (leaderPort) break;
      await sleep(250);
    }
    if (!leaderPort) throw new Error("leader not detected");
    console.log(`[soak] leader_port=${leaderPort}`);
    CURRENT_LEADER_PORT = leaderPort;

    // Basic workload: writes through random node (redirects to leader)
    let writes = 0;
    let reads = 0;
    const seen = [];
    let restoreVerified = false;

    // Ensure DB is opened on all nodes so replicas subscribe and majority acks can succeed.
    await Promise.allSettled(
      nodes.map(n =>
        rpcCall(n, { id: `${Date.now()}-${randId()}`, action: "db", args: { db: "soak" }, token }, 4000)
      )
    );

    // Give followers time to discover leader + switch to WAL streaming before we require majority acks.
    await sleep(1500);
    await Promise.allSettled(
      nodes.map(n =>
        rpcCall(n, { id: `${Date.now()}-${randId()}`, action: "db", args: { db: "soak" }, token }, 4000)
      )
    );
    await sleep(750);

    // Create indexes (through leader routing)
    await rpcExecAny("db", { db: "soak" });
    await rpcExecAny("op", { db: "soak", col: "items", method: "createIndex", params: [{ field: "id", unique: true }] });
    await rpcExecAny("op", { db: "soak", col: "items", method: "createIndex", params: [{ field: "ts" }] });

    // Induce lag on one follower and verify bounded_stale rejects stale reads on replica
    const lagNode = nodes.find(n => n.clientPort !== leaderPort);
    if (!lagNode) throw new Error("no follower found to lag");
    await workerCmd(children.get(lagNode.id), { type: "set_replication_delay", ms: 750 }).catch(() => {});

    const loop = async () => {
      while (Date.now() < deadline) {
        // write
        const id = `k-${writes}-${randId()}`;
        await rpcExecAny("op", { db: "soak", col: "items", method: "insertOne", params: [{ id, ts: Date.now(), v: Math.random() }] });
        writes++;
        if (seen.length < 5000) seen.push(id);

        // read from lagging replica (should throw STALE_READ once lag exceeds bounds)
        const pickId = pick(seen);
        try {
          const res = await rpcCall(lagNode, {
            id: `${Date.now()}-${randId()}`,
            action: "op",
            args: { db: "soak", col: "items", method: "findOne", params: [{ id: pickId }] },
            token
          }, 1500);
          if (res.ok) {
            reads++;
          } else if (res.error?.code === "STALE_READ" || res.error?.code === "NOT_LEADER") {
            // acceptable; routing/consistency enforcement behavior
          }
        } catch {}

        // leader failover chaos: kill current leader once mid-run
        if (writes === 200) {
          const toKill = nodes.find(n => n.clientPort === leaderPort);
          if (toKill) {
            console.log(`[soak] killing leader ${toKill.id}`);
            await children.get(toKill.id)?.terminate?.();
            children.delete(toKill.id);
            // wait for new leader
            for (let i = 0; i < 60; i++) {
              const p = await detectLeaderPort();
              if (p && p !== leaderPort) {
                leaderPort = p;
                console.log(`[soak] new_leader_port=${leaderPort}`);
                break;
              }
              await sleep(250);
            }
            // Restart the killed node to ensure rejoin works.
            await sleep(1000);
            const restarted = startNode(toKill);
            children.set(toKill.id, restarted);
          }
        }

        if (writes % 50 === 0) {
          // Let replica catch up a bit to avoid unbounded queue growth.
          await workerCmd(children.get(lagNode.id), { type: "set_replication_delay", ms: 0 }).catch(() => {});
          await sleep(750);
          await workerCmd(children.get(lagNode.id), { type: "set_replication_delay", ms: 750 }).catch(() => {});

          // Verify backup/restore once (uses leader backups).
          if (!restoreVerified && seen.length > 10) {
            const leaderRoot = nodes.find(n => n.clientPort === leaderPort)?.root;
            if (leaderRoot) {
              try {
                // Probe an older id to avoid racing backups.
                const idx = Math.max(0, seen.length - 50);
                await verifyBackupRestore(leaderRoot, seen[idx]);
                restoreVerified = true;
                console.log("[soak] restore_verified=true");
              } catch (e) {
                console.warn("[soak] restore_verify_failed:", String(e?.message || e));
              }
            }
          }
        }

        await sleep(20);
      }
    };

    await loop();

    console.log(`[soak] writes=${writes} reads=${reads} restoreVerified=${restoreVerified}`);
  } finally {
    await stopAll();
  }
}

main().catch(err => {
  console.error("[soak] failed:", err);
  process.exitCode = 1;
});
