#!/usr/bin/env node

// src/server.ts
import os from "os";
import app from "./app";
import { parseCLIArgs } from "./utils/cli";

const cli = parseCLIArgs();

console.log("⚙ Runtime Config:");
console.log(`📁 DB Root Path : ${cli.rootPath || "Default"}`);
console.log(`🔐 Encryption   : ${cli.encryptionKey ? "Enabled" : "Disabled"}`);

const PORT = 4000;

function printHostAddresses(port: number) {
  const urls = new Set<string>();

  // Localhost
  urls.add(`http://localhost:${port}`);
  urls.add(`http://127.0.0.1:${port}`);

  // Network interfaces
  const nets = os.networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.add(`http://${net.address}:${port}`);
      }
    }
  }

  console.log("🌐 Available Host URLs:");
  for (const url of urls) {
    console.log(`   → ${url}`);
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log("🚀 LioranDB Host is LIVE");
  console.log(`📡 Listening on port: ${PORT}`);

  printHostAddresses(PORT);

  console.log("======================================");
});