import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { LioranManager } from "../dist/index.js";
import { WALManager } from "../dist/core/wal.js";

test("WAL recovery replays committed-but-not-applied tx", async () => {
  const rootPath = path.join(
    process.cwd(),
    "__tests__",
    ".tmp",
    `wal-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  fs.mkdirSync(rootPath, { recursive: true });

  try {
    // Create base folder structure
    const manager1 = new LioranManager({ rootPath, ipc: "primary" });
    await manager1.db("db1");
    await manager1.closeAll();

    // Write a committed tx to WAL without an "applied" marker
    const baseDir = path.join(rootPath, "db1");
    const wal = new WALManager(baseDir);
    const tx = 1;

    await wal.append({
      tx,
      type: "op",
      payload: { tx, col: "users", op: "insertOne", args: [{ _id: "a", name: "alice" }] }
    });
    await wal.append({ tx, type: "commit" });
    await wal.close();

    // Re-open and verify recovery applied it
    const manager2 = new LioranManager({ rootPath, ipc: "primary" });
    const db = await manager2.db("db1");
    const col = db.collection("users");

    const doc = await col.findOne({ _id: "a" });
    assert.equal(doc?.name, "alice");

    await manager2.closeAll();
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

