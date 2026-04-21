#!/usr/bin/env node

import os from "os";
import app from "./app";
import { manager } from "./config/database";
import { parseCLIArgs } from "./utils/cli";
import { ensureAdminUser } from "./utils/startup";
import { startSnapshotScheduler } from "./utils/snapshots";
import { logDiskIntegrityWarnings } from "./utils/integrity";

const cli = parseCLIArgs();
const PORT = 4000;

console.log("Runtime Config:");
console.log(`DB Root Path : ${cli.rootPath || "Default"}`);
console.log(`Encryption   : ${cli.encryptionKey ? "Enabled" : "Disabled"}`);

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

  if (adminState.created) {
    console.log('No "admin" user found. Created default admin account with username "admin" and password "admin".');
  }

  startSnapshotScheduler(manager);
  await logDiskIntegrityWarnings();

  app.listen(PORT, "0.0.0.0", () => {
    console.log("======================================");
    console.log("LioranDB Host is LIVE");
    console.log(`Listening on port: ${PORT}`);
    printHostAddresses(PORT);
    console.log("======================================");
  });
}

start().catch(async (error) => {
  console.error("Failed to start server:", error);
  await manager.closeAll();
  process.exit(1);
});
