// src/config/database.ts
import { LioranManager, getBaseDBFolder } from "@liorandb/core";
import { AuthUser, ManagedDatabaseRecord } from "../types/auth-user";
import { parseCLIArgs } from "../utils/cli";

const cli = parseCLIArgs();

const managerOptions = {
  rootPath: cli.rootPath || getBaseDBFolder(),
  encryptionKey: cli.encryptionKey || "default-encryption-key",
  ipc: cli.ipc,
  writeQueue: cli.writeQueue,
  batch: cli.batch,
} as const;

export let manager = new LioranManager(managerOptions);

export async function closeManager() {
  await manager.closeAll();
}

export async function recreateManager() {
  manager = new LioranManager(managerOptions);
  return manager;
}

export async function getAuthCollection() {
  const db = await manager.db("_auth");
  return db.collection<AuthUser>("users");
}

export async function getDatabaseMetadataCollection() {
  const db = await manager.db("_auth");
  return db.collection<ManagedDatabaseRecord>("databases");
}
