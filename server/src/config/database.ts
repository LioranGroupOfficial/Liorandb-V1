// src/config/database.ts
import { LioranManager, getBaseDBFolder } from "@liorandb/core";
import { AuthUser, ManagedDatabaseRecord } from "../types/auth-user";
import { parseCLIArgs } from "../utils/cli";

const cli = parseCLIArgs();

export const manager = new LioranManager({
  rootPath: cli.rootPath || getBaseDBFolder(),
  encryptionKey: cli.encryptionKey || "default-encryption-key",
  ipc: cli.ipc,
  writeQueue: cli.writeQueue,
  batch: cli.batch,
});

export async function getAuthCollection() {
  const db = await manager.db("_auth");
  return db.collection<AuthUser>("users");
}

export async function getDatabaseMetadataCollection() {
  const db = await manager.db("_auth");
  return db.collection<ManagedDatabaseRecord>("databases");
}
