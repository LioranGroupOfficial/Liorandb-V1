#!/usr/bin/env node

import os from "os";
import app from "./app";
import { manager } from "./config/database";
import { parseCLIArgs } from "./utils/cli";
import { ensureAdminUser } from "./utils/startup";
import { startSnapshotScheduler } from "./utils/snapshots";
import { logDiskIntegrityWarnings } from "./utils/integrity";
import { registerShutdownHandler, requestShutdown } from "./utils/shutdown";
import { readServerConfig, writeServerConfig } from "./utils/serverConfig";

const cli = parseCLIArgs();
const PORT = 4000;

console.log("Runtime Config:");
console.log(`DB Root Path : ${cli.rootPath || "Default"}`);
console.log(`Encryption   : ${cli.encryptionKey ? "Enabled" : "Disabled"}`);
console.log(`IPC Mode     : ${cli.ipc || "auto"}`);
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

async function start() {
  const adminState = await ensureAdminUser();

  if ((adminState as any).skipped) {
    console.log('Readonly mode: skipping default "admin" bootstrap.');
  } else if ((adminState as any).created) {
    console.log(
      'No "admin" user found. Created default admin account with username "admin" and password "admin".'
    );
  }

  if (!manager.isReadOnly() && manager.isPrimary()) {
    startSnapshotScheduler(manager);
  }

  await logDiskIntegrityWarnings();

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log("======================================");
    console.log("LioranDB Host is LIVE");
    console.log(`Listening on port: ${PORT}`);
    console.log(
      `DB Access Mode: ${manager.isPrimary() ? "primary" : manager.isReadOnly() ? "readonly" : "client"}`
    );
    printHostAddresses(PORT);
    console.log("======================================");
  });

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

    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      console.error("Error while closing HTTP server:", err);
    }

    try {
      await manager.closeAll();
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
  await manager.closeAll();
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
      await manager.closeAll();
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
