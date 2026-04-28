#!/usr/bin/env node

import { execFileSync } from "child_process";
import { spawn } from "child_process";
import fs from "fs";
import bcrypt from "bcryptjs";
import { getAuthCollection, manager } from "../config/database";
import { AuthUser } from "../types/auth-user";
import { getSecretFilePath } from "../utils/secret";
import { readServerConfig, ServerRestartCommand } from "../utils/serverConfig";

function printUsage() {
  console.log(`Usage:
  ldb-users [--root <path>] [-ed <key> | -ef <file>] <command> [args]

Commands:
  list
  create <username> <password>
  delete <username>
  set-password <username> <password>

Examples:
  ldb-users list
  ldb-users create editor secret123
  ldb-users delete editor
  ldb-users set-password admin admin123
`);
}

function getCommandArgs() {
  const args = process.argv.slice(2);
  const commandArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--root" || arg === "-ed" || arg === "-ef") {
      i += 1;
      continue;
    }

    commandArgs.push(arg);
  }

  return commandArgs;
}

function isWindowsElevated() {
  try {
    const output = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      ],
      { encoding: "utf8" }
    );

    return output.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

function isRootUser() {
  if (process.platform === "win32") {
    return isWindowsElevated();
  }

  return typeof process.getuid === "function" && process.getuid() === 0;
}

function requireRootUser() {
  if (isRootUser()) {
    return;
  }

  console.error("This CLI can only be used by an elevated OS account (Administrator on Windows or root on Unix).");
  process.exit(1);
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = (baseUrl || "").trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function loadSecretFromDisk() {
  try {
    const secretFilePath = getSecretFilePath();
    if (!fs.existsSync(secretFilePath)) return null;
    const secret = fs.readFileSync(secretFilePath, "utf8").trim();
    return secret || null;
  } catch {
    return null;
  }
}

async function postJson(url: string, body: any, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });

    const text = await res.text().catch(() => "");
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealthDown(baseUrl: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (!res.ok) return;
    } catch {
      return;
    }

    await new Promise((r) => setTimeout(r, 150));
  }
}

async function waitForHealthUp(baseUrl: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (res.ok) return true;
    } catch {
      // ignore
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  return false;
}

function startServerInBackground(restart: ServerRestartCommand) {
  const child = spawn(restart.command, restart.args, {
    cwd: restart.cwd || process.cwd(),
    env: { ...process.env, ...(restart.env || {}) },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

async function withServerStopped<T>(fn: () => Promise<T>) {
  const cfg = readServerConfig();
  const baseUrl = normalizeBaseUrl(cfg?.baseUrl || "http://localhost:4000");
  const stopEndpoint = cfg?.stopEndpoint || "/maintenance/stop";
  const restart = cfg?.restart;

  const secret = loadSecretFromDisk();
  let didStop = false;

  if (secret) {
    try {
      const stopUrl = `${baseUrl}${stopEndpoint.startsWith("/") ? stopEndpoint : `/${stopEndpoint}`}`;
      const res = await postJson(stopUrl, { secret }, 1500);
      if (res.ok) {
        didStop = true;
        await waitForHealthDown(baseUrl, 8000);
      }
    } catch {
      // ignore (server likely not running)
    }
  }

  try {
    return await fn();
  } finally {
    if (didStop && restart) {
      try {
        startServerInBackground(restart);
        await waitForHealthUp(baseUrl, 12_000);
      } catch {
        // ignore
      }
    }
  }
}

async function listUsers() {
  const users = await getAuthCollection();
  const rows = await users.find({});
  const authUsers = Array.isArray(rows) ? (rows as AuthUser[]) : [];

  if (authUsers.length === 0) {
    console.log("No users found.");
    return;
  }

  console.table(
    authUsers.map((user) => ({
      userId: user.userId,
      id: user._id ?? "",
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
    }))
  );
}

async function createUser(username: string, password: string) {
  if (!username || !password) {
    console.error("create expects username and password");
    process.exit(1);
  }

  if (password.length < 6) {
    console.error("password must be at least 6 characters");
    process.exit(1);
  }

  const users = await getAuthCollection();
  const existing = await users.findOne({ username });

  if (existing) {
    console.error(`User "${username}" already exists.`);
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const createdAt = new Date().toISOString();
  const created = await users.insertOne({
    userId: username,
    username,
    role: "user",
    passwordHash: hashedPassword,
    createdAt,
    updatedAt: createdAt,
    createdBy: "cli",
  } as AuthUser) as AuthUser;

  console.log(`Created user "${created.username}" (${created._id ?? "no id"}).`);
}

async function deleteUser(username: string) {
  if (!username) {
    console.error("delete expects username");
    process.exit(1);
  }

  const users = await getAuthCollection();
  const existing = await users.findOne({ username }) as AuthUser | null;

  if (!existing) {
    console.error(`User "${username}" not found.`);
    process.exit(1);
  }

  await users.deleteMany({ username });
  console.log(`Deleted user "${username}".`);
}

async function setPassword(username: string, password: string) {
  if (!username || !password) {
    console.error("set-password expects username and password");
    process.exit(1);
  }

  if (password.length < 6) {
    console.error("password must be at least 6 characters");
    process.exit(1);
  }

  const users = await getAuthCollection();
  const existing = await users.findOne({ username }) as AuthUser | null;

  if (!existing) {
    console.error(`User "${username}" not found.`);
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await users.updateMany({ username }, { $set: { passwordHash: hashedPassword } });
  console.log(`Updated password for "${username}".`);
}

async function main() {
  requireRootUser();

  await withServerStopped(async () => {
    const [command, ...args] = getCommandArgs();

    if (!command || command === "help" || command === "--help" || command === "-h") {
      printUsage();
      return;
    }

    switch (command) {
      case "list":
        await listUsers();
        break;
      case "create":
        await createUser(args[0], args[1]);
        break;
      case "delete":
        await deleteUser(args[0]);
        break;
      case "set-password":
        await setPassword(args[0], args[1]);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  });
}

main()
  .catch((error) => {
    console.error("User CLI failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await manager.closeAll();
  });