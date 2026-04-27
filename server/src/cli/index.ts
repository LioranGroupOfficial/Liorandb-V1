#!/usr/bin/env node

import readline from "readline";
import util from "util";
import * as vm from "node:vm";

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
  liorandb://<dbUsername>:<dbPassword>@<host>:<port>/<databaseName>
  liorandbs://<dbUsername>:<dbPassword>@<host>:<port>/<databaseName>

Examples:
  ldb-cli lioran://admin:password123@localhost:4000
  ldb-cli liorandb://analytics_user:analytics_pass_123@localhost:4000/user_123-analytics
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
    return vm.runInNewContext(`(${value})`, {}, { timeout: 200 });
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

function parseAnyTuple(rawArgs: string) {
  const parsed = parseTupleArgs(rawArgs);
  if (parsed) {
    return parsed;
  }

  return parseNameTuple(rawArgs);
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
  me()
  login("username","password")
  register("username","password")
  setToken("<jwt>")
  setConnectionString("liorandb://<dbUsername>:<dbPassword>@<host>:<port>/<databaseName>")
  getToken()
  getConnectionString()
  getUser()
  logout()

User / Admin:
  listUsers()
  issueUserToken("<userId>")
  updateMyCors(["https://example.com"])
  updateUserCors("<userId>", ["https://example.com"])

Docs:
  listDocs()
  getDoc("<id>")

Maintenance:
  maintenanceStatus()
  listSnapshots()
  createSnapshotNow()
  compactAllDatabases()

Database:   ( current: ${currentDB} )
  show dbs
  use <dbname>
  db.create("<name>")
  db.delete("<name>")
  db.stats("<name>")
  show collections

Collection:   ( current: ${currentCollection ?? "none"} )
  use collection <name>
  db.createCollection("<name>")
  db.dropCollection("<name>")
  db.renameCollection("<old>", "<new>")
  db.collectionStats("<name>")

CRUD:
  db.<collection>.find({...}, {...options})
  db.<collection>.insert({...})
  db.<collection>.aggregate([...pipeline])

  When collection selected:
    find({...}, {...options})
    findOne({...}, {...options})
    insert({...})
    insertMany([...])
    update({...filter},{...update})       // alias: updateMany(filter, update)
    updateOne({...filter},{...update}, {...options})
    updateMany({...filter},{...update})
    delete({...})                        // alias: deleteMany(filter)
    deleteOne({...})
    deleteMany({...})
    count({...})
    stats()
    aggregate([...pipeline])

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

  if (name === "me") {
    logValue(await client.me());
    updatePrompt();
    return true;
  }

  if (name === "login" || name === "register") {
    const args = parseAnyTuple(rawArgs);
    if (args.length < 2 || typeof args[0] !== "string" || typeof args[1] !== "string") {
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
    const args = parseAnyTuple(rawArgs);
    if (args.length < 1 || typeof args[0] !== "string") {
      console.error("setToken expects a JWT");
      return true;
    }

    client.setToken(args[0]);
    console.log("Token set");
    updatePrompt();
    return true;
  }

  if (name === "setConnectionString") {
    const args = parseAnyTuple(rawArgs);
    if (args.length < 1 || typeof args[0] !== "string") {
      console.error("setConnectionString expects a connection string");
      return true;
    }

    client.setConnectionString(args[0]);
    console.log("Connection string set");
    updatePrompt();
    return true;
  }

  if (name === "getToken") {
    logValue(client.getToken());
    return true;
  }

  if (name === "getConnectionString") {
    logValue(client.getConnectionString());
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

  if (name === "listUsers") {
    logValue(await client.listUsers());
    return true;
  }

  if (name === "issueUserToken") {
    const args = parseAnyTuple(rawArgs);
    if (args.length < 1 || typeof args[0] !== "string") {
      console.error('issueUserToken expects a userId: issueUserToken("userId")');
      return true;
    }

    logValue(await client.issueUserToken(args[0]));
    return true;
  }

  if (name === "updateMyCors") {
    const origins = parseSingleArg(rawArgs);
    if (!Array.isArray(origins) || origins.some((origin) => typeof origin !== "string")) {
      console.error('updateMyCors expects an array of strings: updateMyCors(["https://..."])');
      return true;
    }

    logValue(await client.updateMyCors(origins));
    return true;
  }

  if (name === "updateUserCors") {
    const args = parseTupleArgs(rawArgs);
    if (
      !args ||
      args.length < 2 ||
      typeof args[0] !== "string" ||
      !Array.isArray(args[1]) ||
      args[1].some((origin) => typeof origin !== "string")
    ) {
      console.error('updateUserCors expects (userId, origins): updateUserCors("userId", ["https://..."])');
      return true;
    }

    logValue(await client.updateUserCors(args[0], args[1]));
    return true;
  }

  if (name === "listDocs") {
    logValue(await client.listDocs());
    return true;
  }

  if (name === "getDoc") {
    const args = parseAnyTuple(rawArgs);
    if (args.length < 1 || typeof args[0] !== "string") {
      console.error('getDoc expects an id: getDoc("id")');
      return true;
    }

    logValue(await client.getDoc(args[0]));
    return true;
  }

  if (name === "maintenanceStatus") {
    logValue(await client.maintenanceStatus());
    return true;
  }

  if (name === "listSnapshots") {
    logValue(await client.listSnapshots());
    return true;
  }

  if (name === "createSnapshotNow") {
    logValue(await client.createSnapshotNow());
    return true;
  }

  if (name === "compactAllDatabases") {
    logValue(await client.compactAllDatabases());
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
    const args = parseTupleArgs(rawArgs);
    if (!args) {
      return console.error("Invalid syntax");
    }

    const filter = args[0] ?? {};
    const options = args[1];

    return logValue(await col.find(filter, options));
  }

  if (name === "findOne") {
    const args = parseTupleArgs(rawArgs);
    if (!args) {
      return console.error("Invalid syntax");
    }

    const filter = args[0] ?? {};
    const options = args[1];

    return logValue(await col.findOne(filter, options));
  }

  if (name === "update" || name === "updateOne" || name === "updateMany") {
    const args = parseTupleArgs(rawArgs);
    if (!args || args.length < 2) {
      return console.error(`${name} expects filter and update`);
    }

    if (name === "updateMany" || (name === "update" && args.length < 3)) {
      return logValue(await col.updateMany(args[0], args[1]));
    }

    return logValue(await col.updateOne(args[0], args[1], args[2]));
  }

  if (name === "delete" || name === "deleteOne" || name === "deleteMany") {
    const args = parseTupleArgs(rawArgs);
    if (!args) {
      return console.error("Invalid syntax");
    }

    const filter = args[0] ?? {};

    if (name === "deleteOne") {
      return logValue(await col.deleteOne(filter));
    }

    return logValue(await col.deleteMany(filter));
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

  if (name === "aggregate") {
    const pipeline = rawArgs ? parseSingleArg(rawArgs) : [];
    if (!Array.isArray(pipeline)) {
      return console.error("aggregate expects an array pipeline: aggregate([{...}])");
    }

    return logValue(await col.aggregate(pipeline));
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
    return console.error(
      "Database rename is not supported by the current driver/server API."
    );
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
  if (
    connectionUri.startsWith("lioran://") ||
    connectionUri.startsWith("liorandb://") ||
    connectionUri.startsWith("liorandbs://")
  ) {
    await client.connect();
  }

  if (connectionUri.startsWith("liorandb://") || connectionUri.startsWith("liorandbs://")) {
    try {
      const parsed = new URL(connectionUri);
      const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
      if (dbName) {
        currentDB = dbName;
      }
    } catch {
      // ignore; connect() will surface invalid connection strings
    }
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
