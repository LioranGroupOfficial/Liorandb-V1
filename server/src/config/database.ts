// src/config/database.ts
import path from "path";
import { LioranManager, getBaseDBFolder } from "@liorandb/core";
import type { AuthUser, ManagedDatabaseRecord } from "../types/auth-user";
import { parseCLIArgs } from "../utils/cli";
import { loadEnvFile } from "../utils/envFile";

loadEnvFile();

const cli = parseCLIArgs();
const singleNodeMode = toBool(process.env.LIORANDB_SINGLE_NODE, false);

function toBool(raw: unknown, defaultValue = false) {
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === "") return defaultValue;
  if (v === "1" || v === "true" || v === "yes" || v === "y" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "n" || v === "off") return false;
  return defaultValue;
}

function isServerEntry() {
  const entry = String(process.argv[1] || "");
  return /(^|[\\/])server\.(ts|js)$/i.test(entry);
}

function readEnvInt(name: string) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.trunc(v) : undefined;
}

function readEnvJson(name: string) {
  const raw = process.env[name];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function makeNodeOptions(
  rootPath: string,
  nodeId: string,
  peers: Array<{ id: string; host: string; raftPort: number; walStreamPort: number; clientPort?: number }>,
  cluster?: {
    host: string;
    raftPort: number;
    walStreamPort: number;
    clientPort: number;
    token: string;
  }
) {
  const maxRAMMB =
    readEnvInt("LIORANDB_MAX_RAM_MB") ??
    readEnvInt("LIORAN_CACHE_MB") ??
    readEnvInt("LIORANDB_CACHE_MB");

  const extra = readEnvJson("LIORANDB_ENGINE_OPTIONS_JSON");

  const base: any = {
    rootPath,
    encryptionKey:
      cli.encryptionKey || process.env.LIORANDB_ENCRYPTION_KEY || "default-encryption-key",
    writeQueue: cli.writeQueue,
    batch: cli.batch,
    cache: maxRAMMB ? { enabled: true, maxRAMMB } : undefined,
  };

  if (singleNodeMode) {
    // Ensure we never fall back to CLIENT mode (which requires an external IPC primary).
    // We immediately close/disable the IPC listener in `disableIPCForSingleNode()`.
    base.ipc = "primary";
  } else {
    // For the `ldb-serve`/server entrypoint, default to an embedded primary (no external IPC dependency).
    // Other entrypoints may prefer `auto`/client behavior.
    const requested =
      cli.ipc || (process.env.LIORANDB_IPC_MODE as any) || (isServerEntry() ? "primary" : "auto");
    // In embedded multi-node mode, only node-0 should host IPC. Having every node try to be an IPC
    // primary can cause startup races and port/file contention (especially on Windows).
    base.ipc = cluster && nodeId !== "node-0" ? "disabled" : requested;
  }

  if (cluster) {
    const waitTimeoutMs =
      readEnvInt("LIORANDB_CLUSTER_WAIT_TIMEOUT_MS") ??
      readEnvInt("LIORANDB_REPLICATION_WAIT_TIMEOUT_MS") ??
      15_000;
    const waitForMajority = toBool(process.env.LIORANDB_CLUSTER_WAIT_FOR_MAJORITY, true);

    base.cluster = {
      enabled: true,
      nodeId,
      host: cluster.host,
      raftPort: cluster.raftPort,
      walStreamPort: cluster.walStreamPort,
      clientPort: cluster.clientPort,
      peers,
      waitForMajority,
      waitTimeoutMs,
      client: {
        port: cluster.clientPort,
        maxMessageBytes: 256 * 1024,
        auth: { token: cluster.token, required: true },
      },
    };

    base.consistency = {
      reads: {
        mode: "bounded_stale",
        maxLagMs: 250,
        maxLagLSN: 5000,
        autoDegradeToStaleOk: false,
      },
    };

    base.background = { enabled: true, intervalMs: 2000 };
    base.compute = { enabled: true };
    base.latency = { enabled: true, onViolation: "none" };
  }

  if (extra && typeof extra === "object") {
    return { ...base, ...extra };
  }

  return base;
}

function makeClusterManagers(baseRootPath: string) {
  const nodeCountFromEnv = readEnvInt("LIORANDB_CLUSTER_NODES");
  // Default to single-node unless the user explicitly opts into a multi-node cluster.
  // Multi-node mode requires multiple internal ports and majority replication acks; it's not a safe default
  // for local dev where ports may be unavailable.
  const nodeCount = singleNodeMode ? 1 : Math.max(1, Math.trunc(nodeCountFromEnv ?? 1));

  if (nodeCount === 1) {
    return {
      managers: [new LioranManager(makeNodeOptions(baseRootPath, "node-0", []))],
      nodeCount,
    };
  }

  const host = process.env.LIORANDB_CLUSTER_HOST || "127.0.0.1";
  const raftBase = readEnvInt("LIORANDB_CLUSTER_RAFT_BASE_PORT") ?? 7100;
  const walBase = readEnvInt("LIORANDB_CLUSTER_WAL_BASE_PORT") ?? 8100;
  const clientBase = readEnvInt("LIORANDB_CLUSTER_CLIENT_BASE_PORT") ?? 9100;
  const token =
    process.env.LIORANDB_RPC_TOKEN ||
    process.env.RPC_TOKEN ||
    `t-${Math.random().toString(16).slice(2)}-${Date.now()}`;

  const peerDefs = Array.from({ length: nodeCount }, (_, i) => {
    const id = `node-${i}`;
    return {
      id,
      host,
      raftPort: raftBase + i,
      walStreamPort: walBase + i,
      clientPort: clientBase + i,
    };
  });

  const managers: LioranManager[] = [];
  for (const [i, self] of peerDefs.entries()) {
    const rootPath = i === 0 ? baseRootPath : path.join(baseRootPath, "__cluster_nodes", self.id);
    const peers = peerDefs
      .filter((p) => p.id !== self.id)
      .map((p) => ({
        id: p.id,
        host: p.host,
        raftPort: p.raftPort,
        walStreamPort: p.walStreamPort,
        clientPort: p.clientPort,
      }));

    managers.push(
      new LioranManager(
      makeNodeOptions(rootPath, self.id, peers, {
        host,
        raftPort: self.raftPort,
        walStreamPort: self.walStreamPort,
        clientPort: self.clientPort,
        token,
      })
    )
    );
  }

  return { managers, nodeCount };
}

async function disableIPCForSingleNode(m: LioranManager) {
  if (!singleNodeMode) return;

  const anyM: any = m as any;

  // The core manager starts IPC server asynchronously in primary mode.
  // In single-node server mode we want zero IPC usage and no IPC listener.
  for (let i = 0; i < 40; i++) {
    const ipcServer = anyM.ipcServer;
    if (ipcServer?.close) {
      try {
        await ipcServer.close();
      } catch {
        // ignore
      }
      anyM.ipcServer = undefined;
      break;
    }
    await new Promise((r) => setTimeout(r, 25));
  }

  const ipcClient = anyM.ipcClient;
  if (ipcClient?.close) {
    try {
      await ipcClient.close();
    } catch {
      // ignore
    }
    anyM.ipcClient = undefined;
  }
}

async function waitForClusterLeader(m: LioranManager, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const leader = (m as any).clusterLeader ?? null;
    if (leader && leader.host && leader.clientPort) return leader;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function waitForClusterPrimary(timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const primary = allManagers.find((m) => typeof (m as any).isPrimary === "function" && m.isPrimary());
    if (primary) return primary;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

const baseRootPath = cli.rootPath || process.env.LIORANDB_ROOT_PATH || getBaseDBFolder();
const cluster = makeClusterManagers(baseRootPath);

export const allManagers = cluster.managers;
export const clusterNodeCount = cluster.nodeCount;
export { baseRootPath };

export let manager = allManagers[0];
let readIndex = 0;

if (singleNodeMode) {
  for (const m of allManagers) {
    void disableIPCForSingleNode(m);
  }
}

if (clusterNodeCount > 1) {
  // Each node registers shutdown hooks; avoid noisy MaxListeners warnings in multi-node mode.
  const current = process.getMaxListeners();
  if (current !== 0 && current < 50) {
    process.setMaxListeners(50);
  }
}

export async function awaitClusterReady() {
  if (allManagers.length <= 1) return;

  // Warm up all nodes so they bind their internal cluster ports before we attempt any writes.
  // Without this, node-0 may elect itself and then fail writes due to missing majority acks.
  await Promise.allSettled(allManagers.map((m) => m.db("_auth")));

  const primary = await waitForClusterPrimary();
  if (primary) {
    manager = primary;
    return;
  }

  const leader = await waitForClusterLeader(manager, 30_000);
  if (!leader) {
    throw new Error(
      "Cluster leader not discovered (timeout). Check port availability and LIORANDB_CLUSTER_* settings."
    );
  }
}

export function getWriteManager() {
  return manager;
}

export function getReadManager() {
  if (allManagers.length <= 1) return manager;
  const readers = allManagers.filter((m) => m !== manager);
  return readers[readIndex++ % readers.length];
}

type RecoverableCoreError = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
};

function isRecoverableCoreError(error: unknown) {
  const err = error as RecoverableCoreError | null | undefined;
  const code = typeof err?.code === "string" ? err.code : undefined;
  const message = typeof err?.message === "string" ? err.message : "";
  const name = typeof err?.name === "string" ? err.name : "";

  if (code === "LEVEL_ITERATOR_NOT_OPEN") return true;
  if (code === "LEVEL_DATABASE_NOT_OPEN") return true;

  // Some abstract-level errors surface as ModuleError with only message.
  if (name === "ModuleError" && /iterator is not open/i.test(message)) return true;
  if (/cannot call next\(\) after close\(\)/i.test(message)) return true;

  return false;
}

async function openDatabaseWithRecovery(
  getManager: () => LioranManager,
  dbName: string,
  attempt = 1
) {
  try {
    return await getManager().db(dbName);
  } catch (error) {
    if (!isRecoverableCoreError(error) || attempt >= 2) throw error;

    console.error(
      `[core-recovery] ${String((error as any)?.code || (error as any)?.name || "error")} while opening "${dbName}". Recreating manager...`
    );

    await recreateManager();
    return openDatabaseWithRecovery(getManager, dbName, attempt + 1);
  }
}

export async function openWriteDatabase(dbName: string) {
  return openDatabaseWithRecovery(() => getWriteManager(), dbName);
}

export async function openReadDatabase(dbName: string) {
  return openDatabaseWithRecovery(() => getReadManager(), dbName);
}

export async function closeManager() {
  await Promise.allSettled(allManagers.map((m) => m.closeAll()));
}

export async function recreateManager() {
  await closeManager();
  const next = makeClusterManagers(baseRootPath);
  (allManagers as any).length = 0;
  for (const m of next.managers) (allManagers as any).push(m);
  manager = (allManagers as any)[0];
  readIndex = 0;
  if (singleNodeMode) {
    for (const m of allManagers) {
      void disableIPCForSingleNode(m);
    }
  }
  return manager;
}

export async function getAuthCollection() {
  const db = await openWriteDatabase("_auth");
  return db.collection<AuthUser>("users");
}

export async function getDatabaseMetadataCollection() {
  const db = await openWriteDatabase("_auth");
  return db.collection<ManagedDatabaseRecord>("databases");
}
