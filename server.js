#!/usr/bin/env node
// server.js
import express from "express";
import crypto from "crypto";
import open from "open";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import readline from "readline";
// silent-socket.js
import { connectSilentSocketIO } from "./silent-socketio.js";
import { LioranManager, getBaseDBFolder } from "./src/index.js";

const app = express();
const PORT = 2008;

app.use(express.json());

/* ============================================================
   GLOBAL JSON HEADER
============================================================ */
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json");
  next();
});

/* ============================================================
   REQUEST LOGGER (method, url, time, body, query, status, etc.)
============================================================ */
app.use(async (req, res, next) => {
  const start = Date.now();

  // Capture original send()
  const originalJson = res.json;

  res.json = function (data) {
    const duration = Date.now() - start;

    console.log(`\n===== LIORANDB REQUEST LOG =====`);
    console.log(`Time       : ${new Date().toISOString()}`);
    console.log(`Method     : ${req.method}`);
    console.log(`URL        : ${req.originalUrl}`);
    console.log(`Query      : ${JSON.stringify(req.query)}`);
    console.log(`Body       : ${JSON.stringify(req.body)}`);
    console.log(`IP         : ${req.ip}`);
    console.log(`Duration   : ${duration} ms`);
    console.log(`Status     : ${res.statusCode}`);
    if (req.user) {
      console.log(`User       : ${req.user.username}`);
    }
    console.log(`=================================\n`);

    return originalJson.call(this, data);
  };

  next();
});

/* ============================================================
   INITIALIZATION
============================================================ */
const manager = new LioranManager();

await manager.createDatabase("admin");
const adminDB = await manager.openDatabase("admin");

const usersColl = adminDB.collection("users");
const corsColl = adminDB.collection("cors");

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function saveUserData(data) {
  const baseFolder = getBaseDBFolder();
  const filePath = path.join(baseFolder, "user.json");
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  // console.log("✔ Saved user.json:", filePath);
}

function loadUserData() {
  const baseFolder = getBaseDBFolder();
  const filePath = path.join(baseFolder, "user.json");

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    // console.error("⚠ Error reading/parsing user.json → Treating as null:", err);
    return null;
  }
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve =>
    rl.question(question, ans => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    })
  );
}

/* ============================================================
   AUTH MIDDLEWARE
============================================================ */
async function auth(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "Missing API key" });

  const user = await usersColl.findOne({ apiKey });
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // if (user.expires < new Date()) {
  //   return res.status(403).json({ error: "API key expired" });
  // }

  const cors = await corsColl.findOne({ username: user.username });
  const origin = req.headers.origin;

  if (
    cors?.allowedCors?.length &&
    !cors.allowedCors.includes("*") &&
    !cors.allowedCors.includes(origin)
  ) {
    return res.status(403).json({ error: "CORS not allowed" });
  }

  req.user = user;
  next();
}

/* ============================================================
   INTERACTIVE CONSOLE COMMANDS (h, q, l, o)
============================================================ */

let GLOBAL_MODE = false;

function printHelpMenu() {
  console.log(`
============================================================
                 📘 LIORANDB ADMIN HELP
============================================================
  h  → Show this help menu  
  q  → Quit the server safely  
  l  → Logout (clear user.json + restart login flow)
  o  → Toggle Global Mode (currently: ${GLOBAL_MODE ? "ON" : "OFF"})
============================================================
`);
}

function deleteUserJson() {
  const baseFolder = getBaseDBFolder();
  const filePath = path.join(baseFolder, "user.json");

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log("✔ user.json deleted (logged out).");
  } else {
    console.log("ℹ No user.json found.");
  }
}

function setupConsoleCommands() {
  // Enable raw input mode
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
  } else {
    console.log("⚠ Interactive console commands disabled (stdin is not a TTY).");
    console.log("Run with: node serve.js  (NOT nodemon)");
    return;
  }

  // Print help menu on start
  printHelpMenu();

  process.stdin.on("data", async (key) => {
    if (key === "h") {
      console.log("\n📘 HELP MENU REQUESTED\n");
      printHelpMenu();
    }

    // Quit server
    if (key === "q") {
      console.log("\n🛑 Shutting down LioranDB Admin Server...");
      process.exit(0);
    }

    // Logout
    if (key === "l") {
      console.log("\n🔐 Logging out...");
      deleteUserJson();
      console.log("Restart the server to login again.");
    }

    // Toggle Global Mode
    if (key === "o") {
      GLOBAL_MODE = !GLOBAL_MODE;
      console.log(`
🌐 Global Mode toggled → ${GLOBAL_MODE ? "ENABLED" : "DISABLED"}
============================================================
`);
    }

    // Ctrl+C (safety)
    if (key === "\u0003") {
      console.log("\n🛑 Force exit (Ctrl+C)");
      process.exit(0);
    }
  });
}

app.get("/callback", async (req, res) => {
  const token = req.query.token;
  if (!token) {
    res.send("No token received");
    return;
  }

  // console.log("Received Google OAuth token:", token);

  try {
    const response = await fetch("http://localhost:5000/user/getUser", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    const result = await response.json();

    if (!result.userId || !result.accessKey) {
      // console.log("❌ Backend did not return userId or accessKey:", result);
      return res.send("Failed to get user details from auth server.");
    }

    // Save user.json inside BaseDBFolder
    saveUserData({
      userId: result.userId,
      accessKey: result.accessKey
    });

    // console.log("✔ User details saved:", result);

    res.send("Login successful! User data stored locally.");
  } catch (err) {
    console.error("Error fetching user details:", err);
    res.send("Error fetching user details.");
  }
});

/* ============================================================
   LOGIN
============================================================ */
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await usersColl.findOne({ username });
  if (!user || user.password !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const apiKey = crypto.randomBytes(16).toString("hex");
  // const expires = new Date(Date.now() + 86400000);

  await usersColl.updateOne(
    { username },
    // { $set: { apiKey, expires } }
    { $set: { apiKey } }
  );

  // res.json({ apiKey, expires });
  res.json({ apiKey });
});

/* ============================================================
   DATABASE CRUD
============================================================ */
app.post("/db", auth, async (req, res) => {
  if (!req.user.permissions.includes("createDB"))
    return res.status(403).json({ error: "Permission denied" });

  try {
    await manager.createDatabase(req.body.name);
    res.json({ message: "Database created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/db", auth, async (req, res) => {
  try {
    res.json({ databases: await manager.listDatabases() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/db/:name", auth, async (req, res) => {
  if (!req.user.permissions.includes("deleteDB"))
    return res.status(403).json({ error: "Permission denied" });

  try {
    await manager.deleteDatabase(req.params.name);
    res.json({ message: "Database deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   COLLECTION / DOCUMENT CRUD (Connector Compatible)
============================================================ */

// Insert One
app.post("/db/:db/collection/:col/doc", auth, async (req, res) => {
  if (!req.user.permissions.includes("writeDB"))
    return res.status(403).json({ error: "Permission denied" });

  try {
    const db = await manager.openDatabase(req.params.db);
    const coll = db.collection(req.params.col);
    const result = await coll.insertOne(req.body.document);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Find
app.get("/db/:db/collection/:col/doc", auth, async (req, res) => {
  if (!req.user.permissions.includes("readDB"))
    return res.status(403).json({ error: "Permission denied" });

  try {
    const q = req.query.q ? JSON.parse(req.query.q) : {};

    const db = await manager.openDatabase(req.params.db);
    const coll = db.collection(req.params.col);

    const docs = await coll.find(q);
    res.json({ documents: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update
app.put("/db/:db/collection/:col/doc", auth, async (req, res) => {
  if (!req.user.permissions.includes("writeDB"))
    return res.status(403).json({ error: "Permission denied" });

  try {
    const db = await manager.openDatabase(req.params.db);
    const coll = db.collection(req.params.col);

    const result = await coll.updateMany(req.body.filter, req.body.update);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete
app.delete("/db/:db/collection/:col/doc", auth, async (req, res) => {
  if (!req.user.permissions.includes("deleteDB"))
    return res.status(403).json({ error: "Permission denied" });

  try {
    const db = await manager.openDatabase(req.params.db);
    const coll = db.collection(req.params.col);

    const result = await coll.deleteMany(req.body.filter);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   LIST COLLECTIONS
======================= */
app.get("/db/:db/collection", auth, async (req, res) => {
  if (!req.user.permissions.includes("readDB"))
    return res.status(403).json({ error: "Permission denied" });

  try {
    const db = await manager.openDatabase(req.params.db);

    const collections = await db.listCollections();
    res.json({ collections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   CREATE COLLECTION
======================= */
app.post("/db/:db/collection", auth, async (req, res) => {
  if (!req.user.permissions.includes("writeDB"))
    return res.status(403).json({ error: "Permission denied" });

  try {
    const { name } = req.body;
    const db = await manager.openDatabase(req.params.db);

    await db.createCollection(name);

    res.json({ message: "Collection created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   FALLBACK (NO HTML EVER)
============================================================ */
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    route: req.originalUrl,
  });
});

/* ============================================================
   START SERVER
============================================================ */
app.listen(PORT, async () => {
  console.log(`LioranDB admin server running on port ${PORT}`);
  // WAIT 500ms before login check (to avoid TTY conflicts)
  await new Promise(r => setTimeout(r, 500));

  const socket = connectSilentSocketIO(); // Runs hidden

  (async () => {
    const userData = loadUserData();

    // CASE 1: user.json does NOT exist → ask user
    if (!userData) {
      const ans = await ask("Do you want to login? (y/n): ");

      if (ans === "y") {
        console.log("Opening Google login...");
        await open("http://localhost:5000/auth/google");
      } else {
        console.log("Skipping login. Continuing without global access.");
      }
      return;
    }

    // CASE 2: user.json exists → verify accessKey
    console.log("Found user.json → Verifying accessKey...");
    const verifyUrl = `http://localhost:5000/user/verifyKey/${userData.accessKey}`;

    try {
      const response = await fetch(verifyUrl);
      const result = await response.json();
      // console.log("Verify Key Response:", result);

      if (response.ok && result.valid === true) {
        console.log("✔ Access key valid → No need to login.");
        return;
      }

      // invalid key → ask user
      console.log("❌ Invalid access key.");

      const ans = await ask("Your key is invalid. Login again? (y/n): ");
      if (ans === "y") {
        console.log("Opening Google login...");
        await open("http://localhost:5000/auth/google");
      } else {
        console.log("Skipping login with invalid key.");
      }
    } catch (err) {
      console.log("⚠ Error verifying key:", err);

      const ans = await ask("Login failed. Do you want to login again? (y/n): ");
      if (ans === "y") {
        console.log("Opening Google login...");
        await open("http://localhost:5000/auth/google");
      } else {
        console.log("Skipping login after verification error.");
      }
    }
  })();
});