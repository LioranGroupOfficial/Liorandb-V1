// src/config/database.ts
import { LioranManager } from "@liorandb/core";
import { AuthUser } from "../types/auth-user";

export const manager = new LioranManager();

export async function getAuthCollection() {
  const db = await manager.db("_auth");
  await db.createCollection("users").catch(() => {});
  // explicitly type this collection as AuthUser so TS knows the fields
  return db.collection<AuthUser>("users");
}
