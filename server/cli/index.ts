#!/usr/bin/env node

import readline from "readline";
import util from "util";
import bcrypt from "bcryptjs";

import { manager, getAuthCollection } from "../src/config/database";
import { AuthUser } from "../src/types/auth-user";

/* -------------------------------- INTERACTIVE MODE -------------------------------- */

console.log("🚀 LioranDB Interactive Shell");
console.log("Type: help   to see commands\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "liorandb> ",
  historySize: 1000,
});

let currentDB = "default";

/* -------------------------------- HELP -------------------------------- */

async function printHelp() {
  console.log(`
Database:
  show dbs
  use <dbname>
  show collections
  db.createCollection("<name>")
  db.dropCollection("<name>")
  db.renameCollection("<old>", "<new>")

CRUD:
  db.<collection>.insert({...})
  db.<collection>.insertMany([...])
  db.<collection>.find({...})
  db.<collection>.findOne({...})
  db.<collection>.update({...filter}, {...update})
  db.<collection>.updateMany({...filter}, {...update})
  db.<collection>.delete({...filter})
  db.<collection>.deleteMany({...filter})
  db.<collection>.count({...})

User Management:
  user.create("username","password")
  user.delete("username")
  user.list()

System:
  clear
  exit
`);
}

/* -------------------------------- HELPERS -------------------------------- */

function safeParse(obj: string) {
  try {
    return eval(`(${obj})`);
  } catch {
    return null;
  }
}

/* -------------------------------- USER COMMAND HANDLER -------------------------------- */

async function handleUserCommand(cmd: string) {
  const users = await getAuthCollection();

  if (cmd.startsWith("user.create")) {
    const args = cmd.match(/\("(.+?)","(.+?)"\)/);
    if (!args) return console.error("Invalid syntax");

    const [, username, password] = args;

    const existing = await users.findOne({ username });
    if (existing) return console.error("User already exists");

    const hashed = await bcrypt.hash(password, 10);

    await users.insertOne({
      username,
      password: hashed,
      createdAt: new Date().toISOString(),
    } as AuthUser);

    return console.log(`✔ User '${username}' created`);
  }

  if (cmd.startsWith("user.delete")) {
    const args = cmd.match(/\("(.+?)"\)/);
    if (!args) return console.error("Invalid syntax");

    const [, username] = args;
    const r = await users.deleteOne({ username });

    return console.log(`Deleted: ${r}`);
  }

  if (cmd === "user.list()") {
    const list = await users.find({});
    return console.table(list.map((u: any) => ({
      username: u.username,
      createdAt: u.createdAt
    })));
  }
}

/* -------------------------------- MAIN COMMAND HANDLER -------------------------------- */

async function handleCommand(input: string) {
  const cmd = input.trim();
  if (!cmd) return;

  if (cmd === "exit") process.exit(0);
  if (cmd === "clear") return console.clear();
  if (cmd === "help") return printHelp();

  if (cmd === "show dbs") {
    const list = await manager.listDatabases();
    return console.table(list);
  }

  if (cmd.startsWith("use ")) {
    currentDB = cmd.split(" ")[1];
    await manager.db(currentDB);
    return console.log(`✔ Switched to database: ${currentDB}`);
  }

  if (cmd === "show collections") {
    const db = await manager.db(currentDB);
    const cols = await db.listCollections();
    return console.table(cols);
  }

  if (cmd.startsWith("db.createCollection")) {
    const name = cmd.match(/\("(.+)"\)/)?.[1];
    if (!name) return console.error("Invalid syntax");
    const db = await manager.db(currentDB);
    await db.createCollection(name);
    return console.log("✔ Collection created");
  }

  if (cmd.startsWith("db.dropCollection")) {
    const name = cmd.match(/\("(.+)"\)/)?.[1];
    if (!name) return console.error("Invalid syntax");
    const db = await manager.db(currentDB);
    await db.deleteCollection(name);
    return console.log("✔ Collection deleted");
  }

  if (cmd.startsWith("db.renameCollection")) {
    const args = cmd.match(/\("(.+)",\s*"(.+)"\)/);
    if (!args) return console.error("Invalid syntax");
    const db = await manager.db(currentDB);
    await db.renameCollection(args[1], args[2]);
    return console.log("✔ Collection renamed");
  }

  /* -------- USER COMMANDS -------- */

  if (cmd.startsWith("user.")) {
    return handleUserCommand(cmd);
  }

  /* -------- DATABASE CRUD -------- */

  if (cmd.startsWith("db.")) {
    const match = cmd.match(/^db\.([^.]+)\.(.+)$/);
    if (!match) return console.error("Invalid syntax");

    const [, colName, action] = match;
    const db = await manager.db(currentDB);
    const col = db.collection<any>(colName);

    if (action.startsWith("insertMany")) {
      const match = action.match(/^insertMany\((.*)\)$/);
      const data = JSON.parse(match![1]);
      const r = await col.insertMany(data);
      return console.log(util.inspect(r, false, 10, true));
    }

    if (action.startsWith("insert")) {
      const match = action.match(/^insert\((.*)\)$/);
      const data = JSON.parse(match![1]);
      const r = await col.insertOne(data);
      return console.log(util.inspect(r, false, 10, true));
    }

    if (action.startsWith("findOne")) {
      const q = safeParse(action.slice(8));
      const r = await col.findOne(q || {});
      return console.log(util.inspect(r, false, 10, true));
    }

    if (action.startsWith("find")) {
      const q = safeParse(action.slice(4));
      const r = await col.find(q || {});
      return console.log(util.inspect(r, false, 10, true));
    }

    if (action.startsWith("updateMany")) {
      const match = action.match(/^updateMany\((.*)\)$/);
      const args = safeParse(`[${match![1]}]`);
      const r = await col.updateMany(args[0], args[1]);
      return console.log(util.inspect(r, false, 10, true));
    }

    if (action.startsWith("update")) {
      const args = safeParse(`[${action.slice(6)}]`);
      const r = await col.updateOne(args[0], args[1]);
      return console.log(util.inspect(r, false, 10, true));
    }

    if (action.startsWith("deleteMany")) {
      const q = safeParse(action.slice(10));
      const r = await col.deleteMany(q);
      return console.log(`Deleted: ${r}`);
    }

    if (action.startsWith("delete")) {
      const q = safeParse(action.slice(6));
      const r = await col.deleteOne(q);
      return console.log(`Deleted: ${r}`);
    }

    if (action.startsWith("count")) {
      const q = safeParse(action.slice(5));
      const r = await col.countDocuments(q);
      return console.log(`Count: ${r}`);
    }
  }

  console.log("Unknown command. Type: help");
}

/* -------------------------------- START REPL -------------------------------- */

rl.prompt();

rl.on("line", async (line) => {
  try {
    await handleCommand(line);
  } catch (err) {
    console.error("Error:", err);
  }
  rl.prompt();
});

rl.on("close", () => {
  process.exit(0);
});
