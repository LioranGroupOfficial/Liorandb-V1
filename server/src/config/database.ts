// src/config/database.ts
import { LioranManager } from "@liorandb/core";
import { AuthUser } from "../types/auth-user";

import { parseCLIArgs } from "../utils/cli";

const cli = parseCLIArgs();

export const manager = new LioranManager({
  rootPath: cli.rootPath || "./lioran-data",
  encryptionKey: cli.encryptionKey || "default-encryption-key",
});

export async function getAuthCollection() {
  const db = await manager.db("_auth");
  await db.createCollection("users").catch(() => {});
  // explicitly type this collection as AuthUser so TS knows the fields
  return db.collection<AuthUser>("users");
}
