#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";

function printHelp() {
  console.log(`Usage:
  ldb cli <...args>      Run interactive shell (same as ldb-cli)
  ldb users <...args>    Run users CLI (same as ldb-users)
  ldb serve <...args>    Run server (same as ldb-serve)

Shortcut:
  ldb <connection-uri> [<command>]
    (same as: ldb cli <connection-uri> [<command>])
`);
}

function runNodeScript(scriptPath: string, args: string[]) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
  });

  child.on("error", (err) => {
    console.error(err);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

const argv = process.argv.slice(2);
const first = argv[0];

if (!first || first === "--help" || first === "-h" || first === "help") {
  printHelp();
  process.exit(0);
}

const targets = {
  cli: path.join(__dirname, "index.js"),
  users: path.join(__dirname, "users.js"),
  serve: path.join(__dirname, "..", "server.js"),
} as const;

if (first === "cli" || first === "users" || first === "serve") {
  runNodeScript(targets[first], argv.slice(1));
} else {
  // default: behave like `ldb-cli`
  runNodeScript(targets.cli, argv);
}

