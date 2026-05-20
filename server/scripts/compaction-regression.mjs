import fs from "node:fs";
import path from "node:path";
import { LioranManager } from "../node_modules/@liorandb/core/dist/index.js";

const rootPath = path.join(
  process.cwd(),
  "tmp-test",
  `compaction-regression-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

fs.mkdirSync(rootPath, { recursive: true });

const manager = new LioranManager({ rootPath, ipc: "primary" });

try {
  const db = await manager.db("_auth");
  const col = db.collection("users");

  await col.insertOne({ name: "alice" });
  await col.compact();

  const found = await col.findOne({ name: "alice" });
  if (found?.name !== "alice") {
    throw new Error("Compaction regression: inserted doc not found after compact()");
  }

  console.log("OK: compaction succeeded and data remained readable.");
} finally {
  await manager.closeAll();
  fs.rmSync(rootPath, { recursive: true, force: true });
}

