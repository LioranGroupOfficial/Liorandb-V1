#!/usr/bin/env node
import { Command } from "commander";
import readline from "readline";
import util from "util";
import bcrypt from "bcryptjs";

import { manager } from "../src/config/database";
import { getAuthCollection } from "../src/config/database";
import { AuthUser } from "../src/types/auth-user";

const program = new Command();

/* -------------------------------- CLI COMMAND MODE -------------------------------- */

program
  .name("liorandb")
  .description("LioranDB CLI - Interactive Database Shell")
  .version("1.0.0");

program
  .command("user")
  .description("Manage users")
  .command("create <username> <password>")
  .description("Create a new user")
  .action(async (username, password) => {
    try {
      const users = await getAuthCollection();
      const existing = await users.findOne({ username });
      if (existing) {
        console.error("Error: Username already exists.");
        process.exit(1);
      }

      const hashed = await bcrypt.hash(password, 10);
      await users.insertOne({
        username,
        password: hashed,
        createdAt: new Date().toISOString(),
      } as AuthUser);

      console.log(`✔ User '${username}' created successfully`);
      process.exit(0);
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  });

/* -------------------------------- INTERACTIVE MODE -------------------------------- */

if (process.argv.length > 2) {
  program.parse(process.argv);
  process.exit(0);
}

/* -------------------------------- REPL MODE -------------------------------- */

console.log("🚀 LioranDB Interactive Shell");
console.log("Type: help   to see commands\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "liorandb> ",
  historySize: 1000,
});

let currentDB = "default";

async function printHelp() {
  console.log(`
Commands:
  show dbs
  use <dbname>
  show collections
  db.createCollection("<name>")
  db.dropCollection("<name>")
  db.renameCollection("<old>", "<new>")

  db.<collection>.insert({...})
  db.<collection>.insertMany([...])
  db.<collection>.find({...})
  db.<collection>.findOne({...})
  db.<collection>.update({...filter}, {...update})
  db.<collection>.updateMany({...filter}, {...update})
  db.<collection>.delete({...filter})
  db.<collection>.deleteMany({...filter})
  db.<collection>.count({...})

  clear
  exit
`);
}

function safeParse(obj: string) {
  try {
    return eval(`(${obj})`);
  } catch {
    return null;
  }
}

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

  if (cmd.startsWith("db.")) {
    const match = cmd.match(/^db\.([^.]+)\.(.+)$/);
    if (!match) return console.error("Invalid syntax");

    const [, colName, action] = match;
    const db = await manager.db(currentDB);
    const col = db.collection<any>(colName);

    if (action.startsWith("insertMany")) {
      const match = action.match(/^insertMany\((.*)\)$/);

      if (!match) throw new Error("Invalid insertMany format");
      const data = JSON.parse(match[1]);
      const r = await col.insertMany(data);
      return console.log(util.inspect(r, false, 10, true));
    }

    if (action.startsWith("insert")) {
      const match = action.match(/^insert\((.*)\)$/);

      if (!match) throw new Error("Invalid insert format");

      const data = JSON.parse(match[1]);
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
      if (!match) throw new Error("Invalid updateMany format");

      const args = safeParse(`[${match[1]}]`);
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
