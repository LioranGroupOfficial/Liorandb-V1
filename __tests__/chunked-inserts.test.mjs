import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { LioranManager } from "../dist/index.js";

test("insertMany chunks large batches", async () => {
  const rootPath = path.join(
    process.cwd(),
    "__tests__",
    ".tmp",
    `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  fs.mkdirSync(rootPath, { recursive: true });

  const manager = new LioranManager({
    rootPath,
    ipc: "primary",
    batch: { chunkSize: 500 }
  });

  try {
    const db = await manager.db("db1");
    const col = db.collection("users");

    const docs = Array.from({ length: 1200 }, (_, i) => ({ _id: `u-${i}`, n: i }));
    const inserted = await col.insertMany(docs);
    assert.equal(inserted.length, docs.length);

    const count = await col.count();
    assert.equal(count, docs.length);
  } finally {
    await manager.closeAll();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test("insertManyStream supports streaming inserts", async () => {
  const rootPath = path.join(
    process.cwd(),
    "__tests__",
    ".tmp",
    `stream-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  fs.mkdirSync(rootPath, { recursive: true });

  const manager = new LioranManager({
    rootPath,
    ipc: "primary",
    batch: { chunkSize: 200 }
  });

  async function* gen(n) {
    for (let i = 0; i < n; i++) yield { _id: `s-${i}`, n: i };
  }

  try {
    const db = await manager.db("db1");
    const col = db.collection("users");

    const insertedCount = await col.insertManyStream(gen(1000));
    assert.equal(insertedCount, 1000);

    const count = await col.count();
    assert.equal(count, 1000);
  } finally {
    await manager.closeAll();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

