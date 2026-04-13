#!/usr/bin/env node

import readline from "readline";
import util from "util";

import { HttpError, LioranClient } from "@liorandb/driver";

console.clear();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  historySize: 1000,
});

let currentDB = "default";
let currentCollection: string | null = null;

function printUsage() {
  console.log(`Usage:
  ldb-cli <connection-uri>
  ldb-cli <connection-uri> '<command>'

Connection URI formats:
  http://<host>:<port>
  https://<host>:<port>
  lioran://<username>:<password>@<host>:<port>

Examples:
  ldb-cli lioran://admin:password123@localhost:4000
  ldb-cli http://localhost:4000 'login("admin","password123")'
`);
}

function parseStartupArgs() {
  const args = process.argv.slice(2);
  const commandParts: string[] = [];
  let connectionUri: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--root" || arg === "-ed" || arg === "-ef") {
      i += 1;
      continue;
    }

    if (!connectionUri) {
      connectionUri = arg;
      continue;
    }

    commandParts.push(arg);
  }

  return {
    connectionUri,
    inlineCommand: commandParts.join(" ").trim(),
  };
}

function updatePrompt() {
  let prompt = `liorandb:${currentDB}`;
  if (currentCollection) {
    prompt += `.${currentCollection}`;
  }

  if (!client.isAuthenticated()) {
    prompt += " (guest)";
  }

  rl.setPrompt(`${prompt}> `);
}

function printBanner(uri: string) {
  console.log("LioranDB Interactive Shell");
  console.log(`Connected to: ${uri}`);
  console.log('Type: help   to see commands\n');
}

function safeParse(value: string) {
  try {
    return eval(`(${value})`);
  } catch {
    return null;
  }
}

function parseCall(action: string) {
  const match = action.trim().match(/^([a-zA-Z][\w.]*)\(([\s\S]*)\)$/);
  if (!match) {
    return null;
  }

  return {
    name: match[1],
    rawArgs: match[2].trim(),
  };
}

function parseSingleArg(rawArgs: string) {
  if (!rawArgs) {
    return {};
  }

  return safeParse(rawArgs);
}

function parseTupleArgs(rawArgs: string) {
  if (!rawArgs) {
    return [];
  }

  const parsed = safeParse(`[${rawArgs}]`);
  return Array.isArray(parsed) ? parsed : null;
}

function parseNameTuple(rawArgs: string) {
  const values = rawArgs
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^["']|["']$/g, ""));

  return values;
}

function logValue(value: unknown) {
  console.log(util.inspect(value, false, 10, true));
}

function normalizeCommandError(error: unknown) {
  if (error instanceof HttpError) {
    return error.data ?? { status: error.status, message: error.message };
  }

  return error;
}

async function printHelp() {
  console.log(`
Connection:
  health()
  info()
  login("username","password")
  register("username","password")
  setToken("<jwt>")
  getToken()
  getUser()
  logout()

Database:   ( current: ${currentDB} )
  show dbs
  use <dbname>
  db.create("<name>")
  db.delete("<name>")
  db.rename("<old>", "<new>")
  db.stats("<name>")
  show collections

Collection:   ( current: ${currentCollection ?? "none"} )
  use collection <name>
  db.createCollection("<name>")
  db.dropCollection("<name>")
  db.renameCollection("<old>", "<new>")
  db.collectionStats("<name>")

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
    stats()

System:
  clear
  exit
`);
}

async function runAuthCommand(cmd: string) {
  const parsedCall = parseCall(cmd);
  if (!parsedCall) {
    return false;
  }

  const { name, rawArgs } = parsedCall;

  if (name === "health") {
    logValue(await client.health());
    return true;
  }

  if (name === "info") {
    logValue(await client.info());
    return true;
  }

  if (name === "login" || name === "register") {
    const args = parseNameTuple(rawArgs);
    if (args.length < 2) {
      console.error(`${name} expects username and password`);
      return true;
    }

    const auth =
      name === "login"
        ? await client.login(args[0], args[1])
        : await client.register(args[0], args[1]);

    logValue(auth);
    updatePrompt();
    return true;
  }

  if (name === "setToken") {
    const args = parseNameTuple(rawArgs);
    if (args.length < 1) {
      console.error("setToken expects a JWT");
      return true;
    }

    client.setToken(args[0]);
    console.log("Token set");
    updatePrompt();
    return true;
  }

  if (name === "getToken") {
    logValue(client.getToken());
    return true;
  }

  if (name === "getUser") {
    logValue(client.getUser());
    return true;
  }

  if (name === "logout") {
    client.logout();
    console.log("Logged out");
    updatePrompt();
    return true;
  }

  return false;
}

async function runCollectionCommand(colName: string, action: string) {
  const db = client.db(currentDB);
  const col = db.collection<Record<string, unknown>>(colName);
  const parsedCall = parseCall(action);
  if (!parsedCall) {
    return console.error("Invalid syntax");
  }

  const { name, rawArgs } = parsedCall;

  if (name === "insert" || name === "insertOne") {
    const data = parseSingleArg(rawArgs);
    if (data == null || Array.isArray(data)) {
      return console.error("Invalid syntax");
    }

    return logValue(await col.insertOne(data));
  }

  if (name === "insertMany") {
    const data = parseSingleArg(rawArgs);
    if (!Array.isArray(data)) {
      return console.error("insertMany expects an array");
    }

    return logValue(await col.insertMany(data));
  }

  if (name === "find") {
    const query = parseSingleArg(rawArgs);
    if (query == null) {
      return console.error("Invalid syntax");
    }

    return logValue(await col.find(query));
  }

  if (name === "findOne") {
    const query = parseSingleArg(rawArgs);
    if (query == null) {
      return console.error("Invalid syntax");
    }

    return logValue(await col.findOne(query));
  }

  if (name === "update" || name === "updateOne" || name === "updateMany") {
    const args = parseTupleArgs(rawArgs);
    if (!args || args.length < 2) {
      return console.error(`${name} expects filter and update`);
    }

    return logValue(await col.updateMany(args[0], args[1]));
  }

  if (name === "delete" || name === "deleteOne" || name === "deleteMany") {
    const query = parseSingleArg(rawArgs);
    if (query == null) {
      return console.error("Invalid syntax");
    }

    return logValue(await col.deleteMany(query));
  }

  if (name === "count" || name === "countDocuments") {
    const query = parseSingleArg(rawArgs);
    if (query == null) {
      return console.error("Invalid syntax");
    }

    return console.log(`Count: ${await col.count(query)}`);
  }

  if (name === "stats") {
    return logValue(await col.stats());
  }

  return console.log("Unknown collection command. Type: help");
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
    console.clear();
    printBanner(connectionUri);
    updatePrompt();
    return;
  }

  if (cmd === "help") {
    return printHelp();
  }

  if (await runAuthCommand(cmd)) {
    return;
  }

  if (cmd === "show dbs") {
    return console.table(await client.listDatabases());
  }

  if (cmd.startsWith("use collection ")) {
    currentCollection = cmd.split(" ")[2];
    updatePrompt();
    return;
  }

  if (cmd.startsWith("use ")) {
    currentDB = cmd.split(" ")[1];
    currentCollection = null;
    updatePrompt();
    return;
  }

  if (cmd === "show collections") {
    return console.table(await client.db(currentDB).listCollections());
  }

  if (cmd.startsWith("db.create(")) {
    const parsedCall = parseCall(cmd);
    const name =
      parsedCall?.name === "db.create"
        ? parseNameTuple(parsedCall.rawArgs)[0]
        : undefined;

    if (!name) {
      return console.error("Invalid syntax");
    }

    await client.createDatabase(name);
    return console.log("Database created");
  }

  if (cmd.startsWith("db.delete(")) {
    const parsedCall = parseCall(cmd);
    const name =
      parsedCall?.name === "db.delete"
        ? parseNameTuple(parsedCall.rawArgs)[0]
        : undefined;

    if (!name) {
      return console.error("Invalid syntax");
    }

    await client.dropDatabase(name);

    if (currentDB === name) {
      currentDB = "default";
      currentCollection = null;
      updatePrompt();
    }

    return console.log("Database deleted");
  }

  if (cmd.startsWith("db.rename(")) {
    const parsedCall = parseCall(cmd);
    const args =
      parsedCall?.name === "db.rename" ? parseNameTuple(parsedCall.rawArgs) : [];

    if (args.length < 2) {
      return console.error("Invalid syntax");
    }

    await client.renameDatabase(args[0], args[1]);

    if (currentDB === args[0]) {
      currentDB = args[1];
      currentCollection = null;
      updatePrompt();
    }

    return console.log("Database renamed");
  }

  if (cmd.startsWith("db.stats(")) {
    const parsedCall = parseCall(cmd);
    const name =
      parsedCall?.name === "db.stats"
        ? parseNameTuple(parsedCall.rawArgs)[0]
        : undefined;

    if (!name) {
      return console.error("Invalid syntax");
    }

    return logValue(await client.databaseStats(name));
  }

  if (cmd.startsWith("db.createCollection(")) {
    const parsedCall = parseCall(cmd);
    const name =
      parsedCall?.name === "db.createCollection"
        ? parseNameTuple(parsedCall.rawArgs)[0]
        : undefined;

    if (!name) {
      return console.error("Invalid syntax");
    }

    await client.db(currentDB).createCollection(name);
    return console.log("Collection created");
  }

  if (cmd.startsWith("db.dropCollection(")) {
    const parsedCall = parseCall(cmd);
    const name =
      parsedCall?.name === "db.dropCollection"
        ? parseNameTuple(parsedCall.rawArgs)[0]
        : undefined;

    if (!name) {
      return console.error("Invalid syntax");
    }

    await client.db(currentDB).dropCollection(name);

    if (currentCollection === name) {
      currentCollection = null;
      updatePrompt();
    }

    return console.log("Collection deleted");
  }

  if (cmd.startsWith("db.renameCollection(")) {
    const parsedCall = parseCall(cmd);
    const args =
      parsedCall?.name === "db.renameCollection"
        ? parseNameTuple(parsedCall.rawArgs)
        : [];

    if (args.length < 2) {
      return console.error("Invalid syntax");
    }

    await client.db(currentDB).renameCollection(args[0], args[1]);

    if (currentCollection === args[0]) {
      currentCollection = args[1];
      updatePrompt();
    }

    return console.log("Collection renamed");
  }

  if (cmd.startsWith("db.collectionStats(")) {
    const parsedCall = parseCall(cmd);
    const name =
      parsedCall?.name === "db.collectionStats"
        ? parseNameTuple(parsedCall.rawArgs)[0]
        : undefined;

    if (!name) {
      return console.error("Invalid syntax");
    }

    return logValue(await client.db(currentDB).collection(name).stats());
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

const startupArgs = parseStartupArgs();

if (!startupArgs.connectionUri) {
  printUsage();
  process.exit(1);
}

const connectionUri = startupArgs.connectionUri;
const inlineCommand = startupArgs.inlineCommand;

let client: LioranClient;

try {
  client = new LioranClient(connectionUri);
} catch (error) {
  console.error("Invalid connection URI:", error);
  printUsage();
  process.exit(1);
}

async function initializeClient() {
  if (connectionUri.startsWith("lioran://")) {
    await client.connect();
  }
}

async function main() {
  await initializeClient();
  printBanner(connectionUri);

  if (inlineCommand) {
    await handleCommand(inlineCommand);
    process.exit(0);
  }

  updatePrompt();
  rl.prompt();

  rl.on("line", async (line) => {
    try {
      await handleCommand(line);
    } catch (error) {
      console.error("Error:", normalizeCommandError(error));
    }

    rl.prompt();
  });

  rl.on("close", () => process.exit(0));
}

main().catch((error) => {
  console.error("Error:", normalizeCommandError(error));
  process.exit(1);
});
