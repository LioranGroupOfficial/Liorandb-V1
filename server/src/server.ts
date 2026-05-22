#!/usr/bin/env node

import os from "os";
import app from "./app";
import { awaitClusterReady, closeManager, clusterNodeCount, manager } from "./config/database";
import { parseCLIArgs } from "./utils/cli";
import { ensureAdminUser } from "./utils/startup";
import { startSnapshotScheduler } from "./utils/snapshots";
import { logDiskIntegrityWarnings } from "./utils/integrity";
import { registerShutdownHandler, requestShutdown } from "./utils/shutdown";
import { readServerConfig, writeServerConfig } from "./utils/serverConfig";

const cli = parseCLIArgs();
const PORT = 4000;

// Multi-node mode spins up internal networking; prevent transient connect errors from crashing the host process.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

// Some low-level socket errors can bubble up as uncaught exceptions if a library forgets to attach
// an 'error' handler on a Socket/stream. For embedded clusters this can happen during peer restarts
// or leader re-elections. Avoid crashing the whole HTTP server on transient connection resets.
process.on("uncaughtException", async (err: any) => {
  const code = typeof err?.code === "string" ? err.code : "";
  const msg = typeof err?.message === "string" ? err.message : "";

  if (code === "ECONNRESET" || /ECONNRESET/i.test(msg)) {
    console.warn("[uncaughtException] ECONNRESET (ignored):", msg || err);
    return;
  }

  console.error("[uncaughtException] Fatal error:", err);
  try {
    await closeManager();
  } finally {
    process.exit(1);
  }
});

console.log("Runtime Config:");
console.log(`DB Root Path : ${cli.rootPath || "Default"}`);
console.log(`Encryption   : ${cli.encryptionKey ? "Enabled" : "Disabled"}`);
console.log(`IPC Mode     : ${cli.ipc || "auto"}`);
console.log(`Cluster Nodes: ${clusterNodeCount}${process.env.LIORANDB_SINGLE_NODE ? " (single-node)" : ""}`);
if (cli.writeQueue) {
  console.log(
    `Write Queue  : max=${cli.writeQueue.maxSize ?? "default"} mode=${cli.writeQueue.mode ?? "default"} timeoutMs=${
      cli.writeQueue.timeoutMs ?? "default"
    }`
  );
}
if (cli.batch) {
  console.log(`Batch        : chunkSize=${cli.batch.chunkSize ?? "default"}`);
}

function printHostAddresses(port: number) {
  const urls = new Set<string>();

  urls.add(`http://localhost:${port}`);
  urls.add(`http://127.0.0.1:${port}`);

  const nets = os.networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.add(`http://${net.address}:${port}`);
      }
    }
  }

  console.log("Available Host URLs:");
  for (const url of urls) {
    console.log(`  -> ${url}`);
  }
}

function toBool(raw: unknown, defaultValue = false) {
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === "") return defaultValue;
  if (v === "1" || v === "true" || v === "yes" || v === "y" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "n" || v === "off") return false;
  return defaultValue;
}

type MajorityAckTimeoutLike = {
  code?: unknown;
  message?: unknown;
  details?: { originalMessage?: unknown } | undefined;
  cause?: { message?: unknown } | undefined;
};

function isMajorityAckTimeout(error: unknown) {
  const err = error as MajorityAckTimeoutLike | null | undefined;
  const msg = typeof err?.message === "string" ? err.message : "";
  const detailsMsg =
    typeof err?.details?.originalMessage === "string" ? err.details.originalMessage : "";
  const causeMsg = typeof err?.cause?.message === "string" ? err.cause.message : "";

  return (
    /majority ack timeout/i.test(msg) ||
    /majority ack timeout/i.test(detailsMsg) ||
    /majority ack timeout/i.test(causeMsg)
  );
}

async function start() {
  await awaitClusterReady();
  let adminState: any = null;
  // In large embedded clusters (e.g. 10 nodes) the Raft leader election + WAL streaming setup
  // can lag behind initial boot, causing the very first write (_auth bootstrap) to time out on
  // majority replication acks. Retry briefly instead of aborting the entire server startup.
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      adminState = await ensureAdminUser();
      break;
    } catch (error) {
      if (!isMajorityAckTimeout(error) || attempt >= 12) {
        throw error;
      }
      const delayMs = Math.min(15_000, 1000 * attempt);
      console.warn(
        `[cluster-startup] majority ack timeout during admin bootstrap (attempt ${attempt}/12). Retrying in ${delayMs}ms...`
      );
      await new Promise((r) => setTimeout(r, delayMs));
      await awaitClusterReady();
    }
  }

  if ((adminState as any).skipped) {
    console.log('Readonly mode: skipping default "admin" bootstrap.');
  } else if ((adminState as any).created) {
    console.log(
      'No "admin" user found. Created default admin account with username "admin" and password "admin".'
    );
  }

  if (!manager.isReadOnly()) {
    // In cluster mode the node starts as follower; start scheduler once a leader is elected.
    const tryStart = () => {
      if (manager.isPrimary()) {
        startSnapshotScheduler(manager);
        return true;
      }
      return false;
    };

    if (!tryStart()) {
      const timer = setInterval(() => {
        if (tryStart()) {
          clearInterval(timer);
        }
      }, 500);
      (timer as any).unref?.();
    }
  }

  await logDiskIntegrityWarnings();

  const singleNodeMode = toBool(process.env.LIORANDB_SINGLE_NODE, false);
  // In single-node mode we still want the HTTP API/dashboard by default.
  // Allow explicitly disabling via LIORANDB_HTTP_ENABLED=0/false/off.
  const httpEnabled = singleNodeMode ? toBool(process.env.LIORANDB_HTTP_ENABLED, true) : true;

  // Default behavior:
  // - single-node: bind to 127.0.0.1 (safer for local dev)
  // - cluster: bind to 0.0.0.0 (intended for container/network access)
  // Override for Docker/production with LIORANDB_HTTP_HOST=0.0.0.0.
  const host = (process.env.LIORANDB_HTTP_HOST || "").trim() || (singleNodeMode ? "127.0.0.1" : "0.0.0.0");

  const httpServer = httpEnabled
    ? app.listen(PORT, host, () => {
        console.log("======================================");
        console.log("LioranDB Host is LIVE");
        console.log(`Listening on port: ${PORT}`);
        console.log(
          `DB Access Mode: ${manager.isPrimary() ? "primary" : manager.isReadOnly() ? "readonly" : "client"}`
        );
        printHostAddresses(PORT);
        console.log("======================================");
      })
    : null;

  if (!httpEnabled) {
    console.log("======================================");
    console.log("LioranDB Host is LIVE (HTTP disabled)");
    console.log(
      `DB Access Mode: ${manager.isPrimary() ? "primary" : manager.isReadOnly() ? "readonly" : "client"}`
    );
    console.log("======================================");
  }

  const baseUrl = process.env.LIORANDB_BASE_URL || `http://localhost:${PORT}`;

  writeServerConfig({
    version: 1,
    baseUrl,
    stopEndpoint: "/maintenance/stop",
    pauseEndpoint: "/maintenance/pause",
    resumeEndpoint: "/maintenance/resume",
    restart: {
      command: process.execPath,
      args: process.argv.slice(1),
      cwd: process.cwd(),
      env: Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => typeof v === "string") as Array<[string, string]>
      ),
    },
    lastStartedAt: new Date().toISOString(),
  });

  registerShutdownHandler(async (reason: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\nShutdown requested (${reason}). Shutting down gracefully...`);

    if (httpServer) {
      try {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      } catch (err) {
        console.error("Error while closing HTTP server:", err);
      }
    }

    try {
      await closeManager();
      console.log("All connections closed.");
    } catch (err) {
      console.error("Error during shutdown:", err);
    } finally {
      const previous = readServerConfig();
      if (previous) {
        writeServerConfig({
          ...previous,
          lastStoppedAt: new Date().toISOString(),
        });
      }
      process.exit(0);
    }
  });
}

start().catch(async (error) => {
  console.error("Failed to start server:", error);
  await closeManager();
  process.exit(1);
});

let isShuttingDown = false;

async function shutdown(signal: string) {
  try {
    await requestShutdown(signal);
  } catch (err) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\nReceived ${signal}. Shutting down...`);
    try {
      await closeManager();
    } finally {
      process.exit(0);
    }
    console.error("Shutdown handler failed:", err);
  }
}

// Handle Ctrl+C
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle kill command (e.g. systemd, docker)
process.on("SIGTERM", () => shutdown("SIGTERM"));
