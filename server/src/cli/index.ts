#!/usr/bin/env node

import readline from "readline";
import util from "util";
import bcrypt from "bcryptjs";

import { manager, getAuthCollection } from "../config/database";
import { AuthUser } from "../types/auth-user";
import {
  createCollectionByName,
  createDatabaseByName,
  deleteCollectionByName,
  deleteDatabaseByName,
  listCollectionNames,
  listDatabaseNames,
  renameCollectionByName,
  renameDatabaseByName
} from "../utils/coreStorage";

console.clear();
console.log("LioranDB Interactive Shell");
console.log('Type: help   to see commands\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  historySize: 1000
});

let currentDB = "default";
let currentCollection: string | null = null;

function getInlineCommand() {
  const args = process.argv.slice(2);
  const commandParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--root" || arg === "-ed" || arg === "-ef") {
      i += 1;
      continue;
    }

    commandParts.push(arg);
  }

  return commandParts.join(" ").trim();
}

function updatePrompt() {
  let prompt = `liorandb:${currentDB}`;
  if (currentCollection) {
    prompt += `.${currentCollection}`;
  }
  rl.setPrompt(`${prompt}> `);
}

async function printHelp() {
  console.log(`
Database:   ( current: ${currentDB} )
  show dbs
  use <dbname>
  db.create("<name>")
  db.delete("<name>")
  db.rename("<old>", "<new>")
  show collections

Collection:   ( current: ${currentCollection ?? "none"} )
  use collection <name>
  db.createCollection("<name>")
  db.dropCollection("<name>")
  db.renameCollection("<old>", "<new>")

CRUD:
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

User:
  admin.create("username","password")
  user.create("username","password")
  user.delete("username")
  user.list()

System:
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

async function handleUserCommand(cmd: string) {
  const users = await getAuthCollection();

  if (cmd.startsWith("admin.create") || cmd.startsWith("user.create")) {
    const tupleArgs = cmd.match(/\(\s*"?([^",()]+)"?\s*,\s*"?([^",()]+)"?\s*\)/);
    const spacedArgs = cmd.match(/^(?:admin|user)\.create\s+(\S+)\s+(\S+)$/);

    if (!tupleArgs && !spacedArgs) {
      return console.error("Invalid syntax");
    }

    const username = tupleArgs?.[1] ?? spacedArgs?.[1];
    const password = tupleArgs?.[2] ?? spacedArgs?.[2];

    if (!username || !password) {
      return console.error("Invalid syntax");
    }

    const existing = await users.findOne({ username }) as AuthUser | null;

    if (existing) {
      return console.error("User already exists");
    }

    const hashed = await bcrypt.hash(password, 10);

    await users.insertOne({
      username,
      password: hashed,
      createdAt: new Date().toISOString(),
    } as AuthUser);

    return console.log(`User '${username}' created`);
  }

  if (cmd.startsWith("user.delete")) {
    const args = cmd.match(/\("(.+?)"\)/);
    if (!args) {
      return console.error("Invalid syntax");
    }

    const [, username] = args;
    const deleted = await users.deleteOne({ username });
    return console.log(`Deleted: ${deleted}`);
  }

  if (cmd === "user.list()") {
    const list = await users.find({}) as AuthUser[];
    return console.table(list.map((user: AuthUser) => ({
      username: user.username,
      createdAt: user.createdAt
    })));
  }
}

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
    const query = safeParse(action.slice(8));
    return console.log(util.inspect(await col.findOne(query || {}), false, 10, true));
  }

  if (action.startsWith("find")) {
    const query = safeParse(action.slice(4));
    return console.log(util.inspect(await col.find(query || {}), false, 10, true));
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
    const query = safeParse(action.slice(10));
    return console.log(`Deleted: ${await col.deleteMany(query || {})}`);
  }

  if (action.startsWith("delete")) {
    const query = safeParse(action.slice(6));
    return console.log(`Deleted: ${await col.deleteOne(query || {})}`);
  }

  if (action.startsWith("count")) {
    const query = safeParse(action.slice(5));
    return console.log(`Count: ${await col.countDocuments(query || {})}`);
  }
}

async function handleCommand(input: string) {
  const cmd = input.trim();
  if (!cmd) {
    return;
  }

  if (cmd === "exit") {
    process.exit(0);
  }

  if (cmd === "clear") {
    return console.clear();
  }

  if (cmd === "help") {
    return printHelp();
  }

  if (cmd === "show dbs") {
    return console.table(await listDatabaseNames());
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
    return console.table(await listCollectionNames(currentDB));
  }

  if (cmd.startsWith('db.create("')) {
    const name = cmd.match(/\("(.+)"\)/)?.[1];
    if (!name) {
      return console.error("Invalid syntax");
    }

    await createDatabaseByName(name);
    return console.log("Database created");
  }

  if (cmd.startsWith('db.delete("')) {
    const name = cmd.match(/\("(.+)"\)/)?.[1];
    if (!name) {
      return console.error("Invalid syntax");
    }

    await deleteDatabaseByName(name);

    if (currentDB === name) {
      currentDB = "default";
      currentCollection = null;
      updatePrompt();
    }

    return console.log("Database deleted");
  }

  if (cmd.startsWith("db.rename")) {
    const args = cmd.match(/\("(.+)",\s*"(.+)"\)/);
    if (!args) {
      return console.error("Invalid syntax");
    }

    await renameDatabaseByName(args[1], args[2]);

    if (currentDB === args[1]) {
      currentDB = args[2];
      currentCollection = null;
      updatePrompt();
    }

    return console.log("Database renamed");
  }

  if (cmd.startsWith("db.createCollection")) {
    const name = cmd.match(/\("(.+)"\)/)?.[1];
    if (!name) {
      return console.error("Invalid syntax");
    }

    await createCollectionByName(currentDB, name);
    return console.log("Collection created");
  }

  if (cmd.startsWith("db.dropCollection")) {
    const name = cmd.match(/\("(.+)"\)/)?.[1];
    if (!name) {
      return console.error("Invalid syntax");
    }

    await deleteCollectionByName(currentDB, name);

    if (currentCollection === name) {
      currentCollection = null;
      updatePrompt();
    }

    return console.log("Collection deleted");
  }

  if (cmd.startsWith("db.renameCollection")) {
    const args = cmd.match(/\("(.+)",\s*"(.+)"\)/);
    if (!args) {
      return console.error("Invalid syntax");
    }

    await renameCollectionByName(currentDB, args[1], args[2]);

    if (currentCollection === args[1]) {
      currentCollection = args[2];
      updatePrompt();
    }

    return console.log("Collection renamed");
  }

  if (cmd.startsWith("user.") || cmd.startsWith("admin.")) {
    return handleUserCommand(cmd);
  }

  if (cmd.startsWith("db.")) {
    const match = cmd.match(/^db\.([^.]+)\.(.+)$/);
    if (!match) {
      return console.error("Invalid syntax");
    }

    return runCollectionCommand(match[1], match[2]);
  }

  if (currentCollection) {
    return runCollectionCommand(currentCollection, cmd);
  }

  console.log("Unknown command. Type: help");
}

const inlineCommand = getInlineCommand();

if (inlineCommand) {
  handleCommand(inlineCommand)
    .then(async () => {
      await manager.closeAll();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Error:", err);
      await manager.closeAll();
      process.exit(1);
    });
} else {
  updatePrompt();
  rl.prompt();

  rl.on("line", async (line) => {
    try {
      await handleCommand(line);
    } catch (err) {
      console.error("Error:", err);
    }
    rl.prompt();
  });

  rl.on("close", () => process.exit(0));
}
