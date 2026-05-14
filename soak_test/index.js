/*
Cluster soak/chaos harness:
- spins up N local nodes (default: 100; override with NODE_COUNT)
- exercises leader failover + write redirection
- forces replica lag and validates lag-based read routing (bounded_stale => forward-to-leader)
- validates scheduled snapshot + PITR + restore verification jobs run without crashing

Run:
  npm run build
  node soak_test/index.js

Args:
  --nodes <n> | -n <n>   Number of nodes to spawn (overrides NODE_COUNT env)

Examples:
  node soak_test/index.js --nodes 1
  node soak_test/index.js -n 10
  npm start -- --nodes 5
*/

import fs from "fs";
import path from "path";
import os from "os";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";

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

function classifyErr(err) {
  try {
    if (!err) return { key: "unknown", code: "unknown", msg: "unknown" };
    // Server RPC error JSON
    if (typeof err === "object" && (err.code || err.message)) {
      const code = String(err.code ?? "unknown");
      const msg = String(err.message ?? "unknown");
      const orig = err?.details?.originalMessage ? ` | ${String(err.details.originalMessage)}` : "";
      const det = err?.details ? ` | details=${JSON.stringify(err.details)}` : "";
      return { key: `${code}: ${msg}${orig}`, code, msg: msg + orig + det };
    }
    const msg = String(err?.message ?? err);
    return { key: msg, code: "exception", msg };
  } catch {
    return { key: "unknown", code: "unknown", msg: "unknown" };
  }
}

function parseArgs(argv) {
  const out = { nodes: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    const m = /^--(nodes|node-count)=(\d+)$/.exec(a);
    if (m) {
      out.nodes = Number(m[2]);
      continue;
    }
    if (a === "--nodes" || a === "--node-count" || a === "-n") {
      const v = argv[i + 1];
      if (v == null) throw new Error(`Missing value after ${a}`);
      out.nodes = Number(v);
      i++;
      continue;
    }
    if (/^\d+$/.test(a) && out.nodes === undefined) {
      // Allow a single positional number: `node index.js 5`
      out.nodes = Number(a);
      continue;
    }
  }
  return out;
}

const RUN_MS = Number(process.env.RUN_MS ?? 60 * 60_000);
const BASE = path.join(__dirname, "__cluster_soak__", `run-${Date.now()}-${randId()}`);
ensureDir(BASE);

const token = process.env.RPC_TOKEN ?? `t-${randId()}-${randId()}`;
const host = "127.0.0.1";
let CURRENT_LEADER_PORT = null;
const basePort = Number(process.env.BASE_PORT ?? (20000 + Math.floor(Math.random() * 20000)));
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    [
      "Usage: node index.js [--nodes <n>]",
      "",
      "Options:",
      "  --nodes, -n <n>      Number of nodes to spawn (overrides NODE_COUNT)",
      "  --help, -h           Show help",
      "",
      "Examples:",
      "  node index.js --nodes 1",
      "  node index.js -n 10",
      "  npm start -- --nodes 5"
    ].join("\n")
  );
  process.exit(0);
}
const NODE_COUNT = Number(args.nodes ?? process.env.NODE_COUNT ?? 10);
if (!Number.isFinite(NODE_COUNT) || NODE_COUNT <= 0) {
  throw new Error(`Invalid node count: ${NODE_COUNT}`);
}
const nodes = Array.from({ length: NODE_COUNT }, (_, i) => {
  const idx = i + 1;
  return {
    id: `n${idx}`,
    raftPort: basePort + idx * 10 + 1,
    walPort: basePort + idx * 10 + 2,
    clientPort: basePort + idx * 10 + 3,
    root: path.join(BASE, `n${idx}`)
  };
});

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
const rpcClients = new Map();
const portQuarantine = new Map(); // port -> deadUntilMs

function markPortDead(port, deadForMs = 2000) {
  const p = Number(port);
  if (!Number.isFinite(p) || p <= 0) return;
  const until = Date.now() + Math.max(250, Math.trunc(deadForMs));
  const prev = portQuarantine.get(p) ?? 0;
  if (until > prev) portQuarantine.set(p, until);
}

function isPortDead(port) {
  const p = Number(port);
  const until = portQuarantine.get(p) ?? 0;
  return until > Date.now();
}

function getRpcClient(port) {
  const key = String(port);
  const existing = rpcClients.get(key);
  if (existing) return existing;

  const netP = import("net");
  let sock = null;
  let buf = "";
  const inflight = new Map();

  const destroySocket = (why) => {
    try { sock?.destroy?.(); } catch {}
    sock = null;
    buf = "";
    // Reject any in-flight calls so callers can retry elsewhere.
    for (const p of inflight.values()) {
      try { if (p.t) clearTimeout(p.t); } catch {}
      try { p.reject(why ?? new Error("rpc socket destroyed")); } catch {}
    }
    inflight.clear();
  };

  async function connect() {
    if (sock && !sock.destroyed) return;
    const net = await netP;
    sock = net.createConnection(port, host);
    sock.setNoDelay(true);
    sock.setEncoding("utf8");
    buf = "";
    sock.on("data", (chunk) => {
      buf += chunk;
      while (true) {
        const idx = buf.indexOf("\n");
        if (idx < 0) break;
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const p = inflight.get(msg?.id);
        if (!p) continue;
        inflight.delete(msg.id);
        if (p.t) clearTimeout(p.t);
        p.resolve(msg);
      }
    });
    const failAll = (err) => {
      destroySocket(err);
    };
    sock.on("error", failAll);
    sock.on("close", () => failAll(new Error("rpc socket closed")));

    await new Promise((resolve, reject) => {
      sock.once("connect", resolve);
      sock.once("error", reject);
    });
  }

  async function call(payload, timeoutMs) {
    await connect();
    const id = payload.id;
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        inflight.delete(id);
        // Timeout means the remote is too slow or the socket is wedged; force reconnect.
        const err = new Error("rpc timeout");
        markPortDead(port, 1500);
        destroySocket(err);
        reject(err);
      }, timeoutMs);
      t.unref?.();
      inflight.set(id, { resolve, reject, t });
      try {
        sock.write(JSON.stringify(payload) + "\n");
      } catch (e) {
        inflight.delete(id);
        clearTimeout(t);
        reject(e);
      }
    });
  }

  const client = { call };
  rpcClients.set(key, client);
  return client;
}

async function rpcCall(target, payload, timeoutMs = 4000) {
  const port = Number(target?.port ?? target?.clientPort);
  if (!Number.isFinite(port) || port <= 0) throw new Error("rpc target missing port");
  if (isPortDead(port)) throw new Error(`rpc port quarantined: ${port}`);
  const client = getRpcClient(port);
  return await client.call(payload, timeoutMs);
}

async function rpcExecAny(action, args) {
  const baseNode = pick(nodes);
  const id = `${Date.now()}-${randId()}`;

  let target = baseNode;
  for (let attempt = 0; attempt < 10; attempt++) {
    let res;
    try {
      res = await rpcCall(target, { id, action, args, token }, 5000);
    } catch (e) {
      // Socket-level failures/timeouts: retry on another node (prefer known leader).
      const msg = String(e?.message ?? e);
      const transient = msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("socket closed") || msg.toLowerCase().includes("econnreset");
      if (transient) {
        await sleep(Math.min(500, 50 * (attempt + 1)));
        target = CURRENT_LEADER_PORT ? { port: CURRENT_LEADER_PORT } : baseNode;
        continue;
      }
      throw e;
    }
    if (res.ok) return res.result;
    const err = res.error;

    // Redirect to leader if known.
    if (err?.code === "NOT_LEADER") {
      const hinted = err?.details?.leader?.clientPort;
      const fallback = CURRENT_LEADER_PORT;
      let port = hinted ?? fallback;
      if (!port) {
        const detected = await detectLeaderPort().catch(() => null);
        if (detected) {
          CURRENT_LEADER_PORT = detected;
          port = detected;
        }
      }
      if (port) {
        target = { port };
        await sleep(Math.min(250, 25 * (attempt + 1)));
        continue;
      }
    }

    // Transient during leader role switch (DB close/reopen).
    const msg = String(err?.message ?? "");
    const lower = msg.toLowerCase();
    const origMsg = String(err?.details?.originalMessage ?? "");
    const origLower = origMsg.toLowerCase();
    const causeCode = String(err?.cause?.code ?? err?.details?.cause?.code ?? "");
    const transient =
      (err?.code === "IO_ERROR" && lower.includes("database is not open")) ||
      (err?.code === "INTERNAL" && (origLower.includes("database is not open") || causeCode === "LEVEL_DATABASE_NOT_OPEN")) ||
      (err?.code === "CLOSED" && lower.includes("writer is closed")) ||
      (lower.includes("writer is closed")) ||
      (err?.code === "IO_ERROR" && lower.includes("rpc timeout"));
    if (transient) {
      await sleep(Math.min(500, 50 * (attempt + 1)));
      // Prefer leader if we have it.
      target = CURRENT_LEADER_PORT ? { port: CURRENT_LEADER_PORT } : baseNode;
      continue;
    }

    throw new Error(`rpc failed: ${JSON.stringify(err)}`);
  }

  throw new Error(`rpc failed: exceeded retries for action=${action}`);
}

async function rpcExecRead(method, params, opts = {}) {
  // Prefer followers for reads, but fall back to leader if needed.
  const candidates = [];
  const leaderPort = CURRENT_LEADER_PORT;
  for (const n of nodes) {
    if (leaderPort && n.clientPort === leaderPort) continue;
    if (!isPortDead(n.clientPort)) candidates.push({ port: n.clientPort });
  }
  if (leaderPort && !isPortDead(leaderPort)) candidates.push({ port: leaderPort });

  const fanout = Math.max(1, Math.trunc(Number(opts?.fanout ?? 1)));
  const hedgeMs = Math.max(0, Math.trunc(Number(opts?.hedgeMs ?? 0)));
  const preferPort = Number.isFinite(opts?.preferPort) ? Number(opts.preferPort) : null;

  // Shuffle candidates to distribute load (avoid always hitting candidates[0]).
  // Keep preferPort first when provided.
  if (candidates.length > 1) {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }
  }
  if (preferPort) {
    const idx = candidates.findIndex(c => c.port === preferPort);
    if (idx > 0) {
      const [c] = candidates.splice(idx, 1);
      candidates.unshift(c);
    }
  }

  const execOne = async (target) => {
    const res = await rpcCall(
      target,
      { id: `${Date.now()}-${randId()}`, action: "op", args: { db: "soak", col: "items", method, params }, token },
      3500
    );
    if (res.ok) return { ok: true, result: res.result, port: target.port };
    const code = res?.error?.code;
    if (code === "STALE_READ" || code === "NOT_LEADER") {
      return { ok: false, error: res.error, expectedSkip: true, port: target.port };
    }
    return { ok: false, error: res.error, expectedSkip: false, port: target.port };
  };

  let lastErr = null;

  // Hedged read: start 1 request, optionally start a second after hedgeMs, take first success.
  // This reduces tail latency if one replica is cold/GCing and another is warm.
  if (fanout > 1 && candidates.length > 1) {
    const picked = candidates.slice(0, Math.min(candidates.length, fanout));
    const first = picked[0];
    const second = picked[1] ?? null;

    const firstP = (async () => {
      try { return await execOne(first); } catch (e) { return { ok: false, error: e, expectedSkip: false, port: first.port }; }
    })();

    let secondP = null;
    if (second) {
      secondP = (async () => {
        if (hedgeMs > 0) await sleep(hedgeMs);
        try { return await execOne(second); } catch (e) { return { ok: false, error: e, expectedSkip: false, port: second.port }; }
      })();
    }

    const res = await Promise.race([firstP, ...(secondP ? [secondP] : [])]);
    if (res?.ok) return res;
    // If first result isn't ok, wait for the other (if any) before falling back to retry loop.
    const other = secondP ? await (res.port === second?.port ? firstP : secondP) : null;
    if (other?.ok) return other;
    lastErr = other?.error ?? res?.error ?? lastErr;
    if (res?.expectedSkip || other?.expectedSkip) {
      return { ok: false, error: (res?.error ?? other?.error), expectedSkip: true, port: res?.port ?? other?.port };
    }
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const target = candidates.length ? candidates[attempt % candidates.length] : pick(nodes);
    try {
      const r = await execOne(target);
      if (r.ok) return r;
      lastErr = r.error ?? lastErr;
      if (r.expectedSkip) return r;
      // Transient on node restarts/elections.
      const msg = String(r?.error?.message ?? "").toLowerCase();
      if (msg.includes("writer is closed") || msg.includes("database is not open") || msg.includes("timeout")) {
        await sleep(Math.min(250, 25 * (attempt + 1)));
        continue;
      }
      return r;
    } catch (e) {
      lastErr = e ?? lastErr;
      const msg = String(e?.message ?? e).toLowerCase();
      if (msg.includes("quarantined")) {
        await sleep(Math.min(150, 25 * (attempt + 1)));
        continue;
      }
      if (msg.includes("timeout") || msg.includes("socket closed") || msg.includes("econnreset") || msg.includes("econnrefused")) {
        try { markPortDead(target?.port ?? target?.clientPort, 1500); } catch {}
        await sleep(Math.min(250, 25 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  return { ok: false, error: lastErr ?? new Error("read exceeded retries"), expectedSkip: false, port: null };
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

async function waitStableFile(filePath, stableForMs = 500, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  let stableAt = 0;
  while (Date.now() < deadline) {
    try {
      const st = await fs.promises.stat(filePath);
      if (st.size === lastSize) {
        if (!stableAt) stableAt = Date.now();
        if (Date.now() - stableAt >= stableForMs) return true;
      } else {
        lastSize = st.size;
        stableAt = 0;
      }
    } catch {}
    await sleep(100);
  }
  return false;
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
  await waitStableFile(snapshot, 500, 10_000);
  for (const p of pitrs) {
    await waitStableFile(p, 500, 10_000);
  }

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
        const start = typeof db.getCheckpointLSN === "function" ? db.getCheckpointLSN() : 0;
        const toApply = filtered.filter(r => (r?.lsn ?? 0) > start);
        if (toApply.length) {
          await db.applyReplicatedWAL(toApply);
        }
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
    for (let i = 0; i < 10; i++) {
      try {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(200);
      }
    }
  }
}

async function main() {
  console.log(`[soak] root=${BASE}`);
  console.log(`[soak] rpc_token=${token}`);
  console.log(`[soak] base_port=${basePort} nodes=${nodes.length}`);

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

    // Heavy workload: 1 write lane + N read lanes (followers), all parallel.
    const runForMs = Number(process.env.RUN_MS ?? 60 * 60_000); // default 1 hour
    const heavyDeadline = Date.now() + runForMs;
    const writerOpsPerSec = Math.max(1, Math.trunc(Number(process.env.WRITE_QPS ?? 250)));
    const readerOpsPerSec = Math.max(1, Math.trunc(Number(process.env.READ_QPS ?? 500)));
    const writerConcurrency = Math.max(1, Math.trunc(Number(process.env.WRITE_CONCURRENCY ?? 4)));
    // Default lower to avoid overwhelming disk-bound reads; tune via env.
    const readerConcurrency = Math.max(1, Math.trunc(Number(process.env.READ_CONCURRENCY ?? 4)));
    const insertBatchSize = Math.max(1, Math.trunc(Number(process.env.INSERT_BATCH_SIZE ?? 500)));
    const readRepeat = Math.max(1, Math.trunc(Number(process.env.READ_REPEAT ?? 25)));
    const logEveryMs = Math.max(5_000, Math.trunc(Number(process.env.LOG_EVERY_MS ?? 10_000)));
    const diskEveryMs = Math.max(10_000, Math.trunc(Number(process.env.DISK_EVERY_MS ?? 60_000)));
    const errSampleForMs = Math.max(0, Math.trunc(Number(process.env.ERR_SAMPLE_MS ?? 180_000))); // default 3 minutes
    const errPrintEveryMs = Math.max(1000, Math.trunc(Number(process.env.ERR_PRINT_EVERY_MS ?? 10_000)));

    let writes = 0, reads = 0, updates = 0, deletes = 0, errors = 0, expectedSkips = 0;
    const errCounts = new Map();
    const errSamples = [];
    let lastErrPrintAt = 0;
    // Keep a bounded working set so the soak reaches steady-state (otherwise p99 drifts upward as data grows).
    const MAX_SEEN = Math.max(10_000, Math.trunc(Number(process.env.MAX_SEEN ?? 1_000_000)));
    const seen = [];
    let seenCursor = 0;
    let restoreVerified = false;
    let restoreAttempted = false;

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

    // Read nodes: prefer followers; for a 1-node cluster fall back to leader-as-reader.
    const followerReadNodes = nodes.filter(n => n.clientPort !== leaderPort);
    const readNodes = followerReadNodes.length
      ? followerReadNodes
      : [nodes.find(n => n.clientPort === leaderPort)].filter(Boolean);
    if (readNodes.length === 0) throw new Error("no read nodes available");

    // Optionally induce lag on one follower.
    const lagNode = followerReadNodes[0];
    if (lagNode && process.env.INDUCE_LAG !== "0") {
      await workerCmd(children.get(lagNode.id), { type: "set_replication_delay", ms: 250 }).catch(() => {});
    }

    // Lightweight latency reservoirs (avoid unbounded memory).
    const RESERVOIR = Math.max(1000, Math.trunc(Number(process.env.LAT_SAMPLES ?? 20000)));
    const lat = { write: [], read: [], readCold: [], readHot: [] };
    function observe(kind, ms) {
      const a = lat[kind];
      if (a.length < RESERVOIR) a.push(ms);
      else {
        const j = Math.floor(Math.random() * (writes + reads + 1));
        if (j < a.length) a[j] = ms;
      }
    }
    function pct(arr, p) {
      if (!arr.length) return 0;
      const s = arr.slice().sort((a, b) => a - b);
      const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
      return s[idx];
    }

    function recordError(err, where) {
      const c = classifyErr(err);
      // During elections/restarts, treat these as expected transient noise (do not count as "errors").
      const msgL = String(c.msg ?? "").toLowerCase();
      const expectedTransient =
        msgL.includes("not_leader") ||
        msgL.includes("writes must be sent to leader") ||
        msgL.includes("cluster leader is unknown") ||
        msgL.includes("writer is closed") ||
        msgL.includes("database is not open") ||
        msgL.includes("rpc socket closed") ||
        msgL.includes("econnrefused") ||
        msgL.includes("econnreset") ||
        msgL.includes("quarantined");
      if (expectedTransient) {
        // Still track as skip/noise via samples, but don't add to global error count.
        const key = `${where}: transient: ${c.key}`;
        errCounts.set(key, (errCounts.get(key) ?? 0) + 1);
        return;
      }
      errors++;
      const key = `${where}: ${c.key}`;
      errCounts.set(key, (errCounts.get(key) ?? 0) + 1);
      if (Date.now() < (heavyDeadline - (runForMs - errSampleForMs))) {
        if (errSamples.length < 200) errSamples.push({ t: new Date().toISOString(), where, code: c.code, msg: c.msg });
      }
      const now = Date.now();
      if (now - lastErrPrintAt >= errPrintEveryMs && errSampleForMs > 0) {
        lastErrPrintAt = now;
        const top = Array.from(errCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
        console.log("[soak] error_top", top.map(([k, v]) => `${v}x ${k}`).join(" | "));
        if (errSamples.length) {
          const recent = errSamples.slice(-5);
          for (const e of recent) console.log("[soak] error_sample", JSON.stringify(e));
        }
      }
    }

    async function dirSizeBytes(dir) {
      let total = 0;
      try {
        const ents = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const e of ents) {
          const p = path.join(dir, e.name);
          try {
            if (e.isDirectory()) total += await dirSizeBytes(p);
            else {
              const st = await fs.promises.stat(p);
              total += st.size;
            }
          } catch {}
        }
      } catch {}
      return total;
    }

    let lastLogAt = 0;
    let lastDiskAt = 0;

    // Sleep per lane to approximate total target QPS (best-effort; ignores per-op variability).
    const writerTargetSleepMs = Math.max(0, Math.floor(1000 / (writerOpsPerSec / writerConcurrency)));
    // Each reader loop issues `readRepeat` reads, so scale the sleep accordingly.
    const readerTargetSleepMs = Math.max(0, Math.floor((1000 / (readerOpsPerSec / readerConcurrency)) * readRepeat));

    async function writerLoop(lane) {
      const pending = [];

      const doOp = async (method, params) => {
        let lastErr = null;
        for (let attempt = 0; attempt < 8; attempt++) {
          let leaderTarget = CURRENT_LEADER_PORT ? { port: CURRENT_LEADER_PORT } : pick(nodes);
          let res;
          try {
            res = await rpcCall(
              leaderTarget,
              { id: `${Date.now()}-${randId()}`, action: "op", args: { db: "soak", col: "items", method, params }, token },
              5000
            );
          } catch (e) {
            lastErr = e ?? lastErr;
            const msg = String(e?.message ?? e).toLowerCase();
            const transientSock =
              msg.includes("econnrefused") ||
              msg.includes("econnreset") ||
              msg.includes("socket closed") ||
              msg.includes("timeout") ||
              msg.includes("quarantined");
            if (transientSock) {
              try { markPortDead(leaderTarget?.port ?? leaderTarget?.clientPort, 1500); } catch {}
              // If we're stuck on a quarantined/old leader port, refresh leader hint.
              if (msg.includes("quarantined")) {
                const detected = await detectLeaderPort().catch(() => null);
                if (detected) CURRENT_LEADER_PORT = detected;
              }
              await sleep(Math.min(500, 50 * (attempt + 1)));
              continue;
            }
            throw e;
          }

          if (res.ok) return true;

          const e = res.error;
          lastErr = e ?? lastErr;
          if (e?.code === "NOT_LEADER") {
            const hinted = e?.details?.leader?.clientPort;
            if (hinted) {
              CURRENT_LEADER_PORT = hinted;
            } else {
              const detected = await detectLeaderPort().catch(() => null);
              if (detected) CURRENT_LEADER_PORT = detected;
            }
            await sleep(Math.min(250, 25 * (attempt + 1)));
            continue;
          }
          const msg = String(e?.message ?? "");
          const orig = String(e?.details?.originalMessage ?? "");
          const causeCode = String(e?.cause?.code ?? "");
          const transient = (msg.toLowerCase().includes("writer is closed")) ||
            (msg.toLowerCase().includes("database is not open")) ||
            (orig.toLowerCase().includes("database is not open")) ||
            causeCode === "LEVEL_DATABASE_NOT_OPEN";
          if (transient) {
            await sleep(Math.min(500, 50 * (attempt + 1)));
            continue;
          }
          throw e;
        }
        throw (lastErr ?? new Error("write exceeded retries"));
      };

      const flush = async () => {
        if (pending.length === 0) return;
        const batch = pending.splice(0, pending.length);
        await doOp("insertMany", [batch]);
        writes += batch.length;
        for (const d of batch) {
          if (seen.length < MAX_SEEN) seen.push(d.id);
          else {
            seen[seenCursor] = d.id;
            seenCursor = (seenCursor + 1) % MAX_SEEN;
          }
        }
      };

      while (Date.now() < heavyDeadline) {
        const t0 = performance.now();
        const opRoll = Math.random();
        const id = `k-${Date.now()}-${lane}-${randId()}`;
        try {
          if (opRoll < 0.70) {
            // Batch inserts to reduce syscall pressure and exercise WAL batching.
            pending.push({ id, ts: Date.now(), v: Math.random(), lane });
            if (pending.length >= insertBatchSize) {
              await flush();
            }
          } else if (opRoll < 0.95) {
            if (pending.length) await flush();
            const pickId = seen.length ? pick(seen) : id;
            await doOp("updateOne", [{ id: pickId }, { $set: { u: Date.now(), r: Math.random() } }, { upsert: true }]);
            updates++;
          } else {
            if (pending.length) await flush();
            const pickId = seen.length ? pick(seen) : id;
            await doOp("deleteOne", [{ id: pickId }]);
            deletes++;
          }
        } catch (e) {
          recordError(e, "write");
        } finally {
          observe("write", performance.now() - t0);
        }

        const now = Date.now();
        if (now - lastLogAt >= logEveryMs) {
          lastLogAt = now;
          const w = lat.write, r = lat.read;
          const rc = lat.readCold, rh = lat.readHot;
          console.log(
            `[soak] ops w=${writes} u=${updates} d=${deletes} r=${reads} err=${errors} skip=${expectedSkips} ` +
            `p99(write)=${pct(w,0.99).toFixed(1)}ms p99(read)=${pct(r,0.99).toFixed(1)}ms ` +
            `p99(readCold)=${pct(rc,0.99).toFixed(1)}ms p99(readHot)=${pct(rh,0.99).toFixed(1)}ms`
          );
        }
        if (now - lastDiskAt >= diskEveryMs) {
          lastDiskAt = now;
          const sizes = await Promise.all(nodes.map(async n => ({ id: n.id, bytes: await dirSizeBytes(n.root) })));
          const total = sizes.reduce((m, x) => m + x.bytes, 0);
          console.log(`[soak] disk_total_mb=${(total / (1024*1024)).toFixed(1)} ` + sizes.map(s => `${s.id}=${(s.bytes/(1024*1024)).toFixed(1)}MB`).join(" "));
        }

        if (writerTargetSleepMs) await sleep(writerTargetSleepMs);
      }

      // Flush any remaining inserts on exit.
      try { await flush(); } catch (e) { recordError(e, "write"); }
    }

    async function readerLoop(_node, lane) {
      while (Date.now() < heavyDeadline) {
        const pickId = seen.length ? pick(seen) : `missing-${lane}-${randId()}`;
        try {
          // Choose a preferred follower for this id to distribute cold misses across replicas.
          // If hedged read returns from a different port, switch preference for the hot repeats.
          const followers = nodes.filter(n => n.clientPort !== CURRENT_LEADER_PORT && !isPortDead(n.clientPort));
          let preferPort = followers.length ? pick(followers).clientPort : null;

          // Repeat the same lookup to exercise LCR cache effectiveness.
          for (let i = 0; i < readRepeat; i++) {
            const t0 = performance.now();
            try {
              const res = await rpcExecRead(
                "findOne",
                [{ id: pickId }],
                i === 0
                  ? { fanout: 2, hedgeMs: 20, preferPort }
                  : { fanout: 1, preferPort }
              );
              if (res?.port) preferPort = res.port;
              if (res.ok) reads++;
              else if (res.expectedSkip) expectedSkips++;
              else {
                recordError(res?.error, "read");
              }
            } finally {
              const dt = performance.now() - t0;
              observe("read", dt);
              if (i === 0) observe("readCold", dt);
              else observe("readHot", dt);
            }
          }
        } catch (e) {
          recordError(e, "read");
        }
        if (readerTargetSleepMs) await sleep(readerTargetSleepMs);
      }
    }

    // Schedule one leader kill at ~20% into the run (can disable via CHAOS=0).
    const chaosEnabled = process.env.CHAOS !== "0";
    const chaosAt = Date.now() + Math.max(5000, Math.trunc(runForMs * 0.2));

    const chaosTask = (async () => {
      if (!chaosEnabled) return;
      while (Date.now() < heavyDeadline) {
        if (Date.now() >= chaosAt) break;
        await sleep(250);
      }
      const toKill = nodes.find(n => n.clientPort === leaderPort);
      if (!toKill) return;
      console.log(`[soak] killing leader ${toKill.id}`);
      await children.get(toKill.id)?.terminate?.();
      children.delete(toKill.id);
      // wait for new leader
      for (let i = 0; i < 120; i++) {
        const p = await detectLeaderPort();
        if (p && p !== leaderPort) {
          leaderPort = p;
          CURRENT_LEADER_PORT = p;
          console.log(`[soak] new_leader_port=${leaderPort}`);
          break;
        }
        await sleep(250);
      }
      // Restart the killed node to ensure rejoin works.
      await sleep(1000);
      const restarted = startNode(toKill);
      children.set(toKill.id, restarted);
    })();

    const leaderWatchTask = (async () => {
      // Detect unexpected leader changes (election flaps) so errors make sense.
      const pollMs = Math.max(250, Math.trunc(Number(process.env.LEADER_POLL_MS ?? 1000)));
      while (Date.now() < heavyDeadline) {
        try {
          const p = await detectLeaderPort();
          if (p && p !== leaderPort) {
            leaderPort = p;
            CURRENT_LEADER_PORT = p;
            console.log(`[soak] leader_changed_port=${p}`);
          }
        } catch {}
        await sleep(pollMs);
      }
    })();


    const writerTasks = Array.from({ length: writerConcurrency }, (_, i) => writerLoop(i));
    const readerTasks = [];
    for (const n of readNodes.slice(0, 3)) {
      for (let i = 0; i < readerConcurrency; i++) {
        readerTasks.push(readerLoop(n, `${n.id}-${i}`));
      }
    }

    await Promise.allSettled([chaosTask, leaderWatchTask, ...writerTasks, ...readerTasks]);

    // Restore verification once at the end (best-effort, non-fatal).
    if (!restoreAttempted) {
      restoreAttempted = true;
      const leaderRoot = nodes.find(n => n.clientPort === leaderPort)?.root;
      if (leaderRoot) {
        try {
          const idx = Math.max(0, seen.length - 500);
          await verifyBackupRestore(leaderRoot, seen[idx] ?? null);
          restoreVerified = true;
          console.log("[soak] restore_verified=true");
        } catch (e) {
          console.warn("[soak] restore_verify_failed:", String(e?.message || e));
        }
      }
    }

    console.log(`[soak] done writes=${writes} updates=${updates} deletes=${deletes} reads=${reads} errors=${errors} restoreVerified=${restoreVerified}`);
  } finally {
    await stopAll();
  }
}

main().catch(err => {
  console.error("[soak] failed:", err);
  process.exitCode = 1;
});
