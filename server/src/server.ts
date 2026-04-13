#!/usr/bin/env node

import os from "os";
import app from "./app";
import { manager } from "./config/database";
import { parseCLIArgs } from "./utils/cli";
import { hasAdminUser } from "./utils/startup";

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
  const adminExists = await hasAdminUser();

  if (!adminExists) {
    console.error("No admin user found. Create an admin user first with `ldb-cli admin.create(\"admin\",\"password\")`.");
    await manager.closeAll();
    process.exit(1);
  }

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
