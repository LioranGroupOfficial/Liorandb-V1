// server.js
import express from "express";
import crypto from "crypto";
import { LioranManager } from "./src/index.js";

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

/* ============================================================
   AUTH MIDDLEWARE
============================================================ */
async function auth(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "Missing API key" });

  const user = await usersColl.findOne({ apiKey });
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  if (user.expires < new Date()) {
    return res.status(403).json({ error: "API key expired" });
  }

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
   LOGIN
============================================================ */
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await usersColl.findOne({ username });
  if (!user || user.password !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const apiKey = crypto.randomBytes(16).toString("hex");
  const expires = new Date(Date.now() + 86400000);

  await usersColl.updateOne(
    { username },
    { $set: { apiKey, expires } }
  );

  res.json({ apiKey, expires });
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
app.listen(PORT, () => {
  console.log(`LioranDB admin server running on port ${PORT}`);
});
