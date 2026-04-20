import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { LioranManager } from "../dist/index.js";

test("bounded write queue applies backpressure (reject mode)", async () => {
  const rootPath = path.join(
    process.cwd(),
    "__tests__",
    ".tmp",
    `bp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  fs.mkdirSync(rootPath, { recursive: true });

  const manager = new LioranManager({
    rootPath,
    ipc: "primary",
    writeQueue: {
      maxSize: 1,
      mode: "reject",
      memoryPressure: { enabled: false }
    }
  });

  try {
    const db = await manager.db("db1");
    const col = db.collection("users");

    const attempts = Array.from({ length: 25 }, (_, i) =>
      col.insertOne({ _id: `id-${i}`, n: i })
    );

    const settled = await Promise.allSettled(attempts);
    const fulfilled = settled.filter(r => r.status === "fulfilled").length;
    const rejected = settled.filter(r => r.status === "rejected").length;

    assert(fulfilled > 0);
    assert(rejected > 0);

    const count = await col.count();
    assert.equal(count, fulfilled);
  } finally {
    await manager.closeAll();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

