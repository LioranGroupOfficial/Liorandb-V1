// src/config/database.ts
import { LioranManager, getBaseDBFolder } from "@liorandb/core";
import { AuthUser } from "../types/auth-user";

import { parseCLIArgs } from "../utils/cli";

const cli = parseCLIArgs();

export const manager = new LioranManager({
  rootPath: cli.rootPath || getBaseDBFolder(),
  encryptionKey: cli.encryptionKey || "default-encryption-key",
  ipc: true
});

export async function getAuthCollection() {
  const db = await manager.db("_auth");
  await db.createCollection("users").catch(() => {});
  // explicitly type this collection as AuthUser so TS knows the fields
  return db.collection<AuthUser>("users");
}
