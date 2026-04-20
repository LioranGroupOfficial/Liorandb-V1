import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { LioranManager } from "../dist/index.js";

test("collection.compact() keeps DB open for snapshot rebuild", async () => {
  const rootPath = path.join(
    process.cwd(),
    "__tests__",
    ".tmp",
    `compact-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  fs.mkdirSync(rootPath, { recursive: true });

  const manager = new LioranManager({ rootPath, ipc: "primary" });

  try {
    const db = await manager.db("db1");
    const col = db.collection("users");

    await col.insertOne({ name: "alice" });
    await col.compact();

    const found = await col.findOne({ name: "alice" });
    assert.equal(found?.name, "alice");
  } finally {
    await manager.closeAll();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

