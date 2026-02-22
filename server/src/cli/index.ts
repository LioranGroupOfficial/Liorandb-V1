#!/usr/bin/env node

import readline from "readline";
import util from "util";
import bcrypt from "bcryptjs";

import { manager, getAuthCollection } from "../config/database";
import { AuthUser } from "../types/auth-user";

/* -------------------------------- INIT -------------------------------- */

console.clear();
console.log("🚀 LioranDB Interactive Shell");
console.log("Type: help   to see commands\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  historySize: 1000,
});

let currentDB = "default";
let currentCollection: string | null = null;

/* -------------------------------- PROMPT -------------------------------- */

function updatePrompt() {
  let p = `liorandb:${currentDB}`;
  if (currentCollection) p += `.${currentCollection}`;
  rl.setPrompt(`${p}> `);
}

/* -------------------------------- HELP -------------------------------- */

async function printHelp() {
  console.log(`
📦 Database:   ( current: ${currentDB} )
  show dbs
  use <dbname>
  show collections

📁 Collection:   ( current: ${currentCollection ?? "none"} )
  use collection <name>
  db.createCollection("<name>")
  db.dropCollection("<name>")
  db.renameCollection("<old>", "<new>")

🧠 CRUD:
  db.<collection>.find({...})
  db.<collection>.insert({...})

  When collection selected:
    find({...})
    findOne({...})
    insert({...})
    insertMany([...])
    update({...filter},{...update})
    updateMany({...filter},{...update})
    delete({...})
    deleteMany({...})
    count({...})

👤 User:
  user.create("username","password")
  user.delete("username")
  user.list()

⚙ System:
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

/* -------------------------------- USER COMMANDS -------------------------------- */

async function handleUserCommand(cmd: string) {
  const users = await getAuthCollection();

  if (cmd.startsWith("user.create")) {
    const args = cmd.match(/\(\s*"(.+?)"\s*,\s*"(.+?)"\s*\)/);
    if (!args) return console.error("❌ Invalid syntax");

    const [, username, password] = args;

    const existing = await users.findOne({ username });
    if (existing) return console.error("❌ User already exists");

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
    if (!args) return console.error("❌ Invalid syntax");

    const [, username] = args;
    const r = await users.deleteOne({ username });

    return console.log(`✔ Deleted: ${r}`);
  }

  if (cmd === "user.list()") {
    const list = await users.find({});
    return console.table(list.map((u: any) => ({
      username: u.username,
      createdAt: u.createdAt
    })));
  }
}

/* -------------------------------- CRUD EXEC -------------------------------- */

async function runCollectionCommand(colName: string, action: string) {
  const db = await manager.db(currentDB);
  const col = db.collection<any>(colName);

  if (action.startsWith("insertMany")) {
    const data = JSON.parse(action.match(/^insertMany\((.*)\)$/)![1]);
    return console.log(util.inspect(await col.insertMany(data), false, 10, true));
  }

  if (action.startsWith("insert")) {
    const data = JSON.parse(action.match(/^insert\((.*)\)$/)![1]);
    return console.log(util.inspect(await col.insertOne(data), false, 10, true));
  }

  if (action.startsWith("findOne")) {
    const q = safeParse(action.slice(8));
    return console.log(util.inspect(await col.findOne(q || {}), false, 10, true));
  }

  if (action.startsWith("find")) {
    const q = safeParse(action.slice(4));
    return console.log(util.inspect(await col.find(q || {}), false, 10, true));
  }

  if (action.startsWith("updateMany")) {
    const args = safeParse(`[${action.match(/^updateMany\((.*)\)$/)![1]}]`);
    return console.log(util.inspect(await col.updateMany(args[0], args[1]), false, 10, true));
  }

  if (action.startsWith("update")) {
    const args = safeParse(`[${action.slice(6)}]`);
    return console.log(util.inspect(await col.updateOne(args[0], args[1]), false, 10, true));
  }

  if (action.startsWith("deleteMany")) {
    const q = safeParse(action.slice(10));
    return console.log(`✔ Deleted: ${await col.deleteMany(q)}`);
  }

  if (action.startsWith("delete")) {
    const q = safeParse(action.slice(6));
    return console.log(`✔ Deleted: ${await col.deleteOne(q)}`);
  }

  if (action.startsWith("count")) {
    const q = safeParse(action.slice(5));
    return console.log(`✔ Count: ${await col.countDocuments(q)}`);
  }
}

/* -------------------------------- MAIN HANDLER -------------------------------- */

async function handleCommand(input: string) {
  const cmd = input.trim();
  if (!cmd) return;

  if (cmd === "exit") process.exit(0);
  if (cmd === "clear") return console.clear();
  if (cmd === "help") return printHelp();

  if (cmd === "show dbs") {
    return console.table(await manager.listDatabases());
  }

  if (cmd.startsWith("use collection ")) {
    currentCollection = cmd.split(" ")[2];
    return updatePrompt();
  }

  if (cmd.startsWith("use ")) {
    currentDB = cmd.split(" ")[1];
    currentCollection = null;
    await manager.db(currentDB);
    return updatePrompt();
  }

  if (cmd === "show collections") {
    const db = await manager.db(currentDB);
    return console.table(await db.listCollections());
  }

  if (cmd.startsWith("db.createCollection")) {
    const name = cmd.match(/\("(.+)"\)/)?.[1];
    if (!name) return console.error("❌ Invalid syntax");
    const db = await manager.db(currentDB);
    await db.createCollection(name);
    return console.log("✔ Collection created");
  }

  if (cmd.startsWith("db.dropCollection")) {
    const name = cmd.match(/\("(.+)"\)/)?.[1];
    if (!name) return console.error("❌ Invalid syntax");
    const db = await manager.db(currentDB);
    await db.deleteCollection(name);
    return console.log("✔ Collection deleted");
  }

  if (cmd.startsWith("db.renameCollection")) {
    const args = cmd.match(/\("(.+)",\s*"(.+)"\)/);
    if (!args) return console.error("❌ Invalid syntax");
    const db = await manager.db(currentDB);
    await db.renameCollection(args[1], args[2]);
    return console.log("✔ Collection renamed");
  }

  if (cmd.startsWith("user.")) return handleUserCommand(cmd);

  if (cmd.startsWith("db.")) {
    const match = cmd.match(/^db\.([^.]+)\.(.+)$/);
    if (!match) return console.error("❌ Invalid syntax");
    return runCollectionCommand(match[1], match[2]);
  }

  if (currentCollection) {
    return runCollectionCommand(currentCollection, cmd);
  }

  console.log("❓ Unknown command. Type: help");
}

/* -------------------------------- START -------------------------------- */

updatePrompt();
rl.prompt();

rl.on("line", async (line) => {
  try {
    await handleCommand(line);
  } catch (err) {
    console.error("❌ Error:", err);
  }
  rl.prompt();
});

rl.on("close", () => process.exit(0));
