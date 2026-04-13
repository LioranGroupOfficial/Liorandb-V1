import fs from "fs";
import path from "path";
import { manager } from "../config/database";

export const AUTH_DB_NAME = "_auth";
const WAL_DIR_NAME = "__wal";

function assertSafeName(name: string, kind: "database" | "collection") {
  if (!name || typeof name !== "string") {
    throw new Error(`${kind} name required`);
  }

  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error(`invalid ${kind} name`);
  }
}

function listSubdirectories(targetPath: string) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  return fs.readdirSync(targetPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== WAL_DIR_NAME)
    .map((entry) => entry.name);
}

async function closeOpenDatabase(name: string) {
  const openDb = manager.openDBs.get(name);
  if (!openDb) {
    return;
  }

  await openDb.close();
  manager.openDBs.delete(name);
}

export function getDatabasePath(name: string) {
  assertSafeName(name, "database");
  return path.join(manager.rootPath, name);
}

export async function listDatabaseNames() {
  return listSubdirectories(manager.rootPath)
    .filter((name) => name !== AUTH_DB_NAME && !name.startsWith("."))
    .sort((a, b) => a.localeCompare(b));
}

export async function createDatabaseByName(name: string) {
  assertSafeName(name, "database");
  await manager.db(name);
  return name;
}

export async function deleteDatabaseByName(name: string) {
  assertSafeName(name, "database");

  const dbPath = getDatabasePath(name);
  if (!fs.existsSync(dbPath)) {
    return false;
  }

  await closeOpenDatabase(name);
  await fs.promises.rm(dbPath, { recursive: true, force: true });
  return true;
}

export async function renameDatabaseByName(currentName: string, nextName: string) {
  assertSafeName(currentName, "database");
  assertSafeName(nextName, "database");

  const currentPath = getDatabasePath(currentName);
  const nextPath = getDatabasePath(nextName);

  if (!fs.existsSync(currentPath)) {
    throw new Error("database not found");
  }

  if (fs.existsSync(nextPath)) {
    throw new Error("target database already exists");
  }

  await closeOpenDatabase(currentName);
  await fs.promises.rename(currentPath, nextPath);
  return nextName;
}

export async function listCollectionNames(dbName: string) {
  const db = await manager.db(dbName);
  return listSubdirectories(db.basePath).sort((a, b) => a.localeCompare(b));
}

export async function createCollectionByName(dbName: string, collectionName: string) {
  assertSafeName(collectionName, "collection");
  const db = await manager.db(dbName);
  db.collection(collectionName);
  return collectionName;
}

export async function deleteCollectionByName(dbName: string, collectionName: string) {
  assertSafeName(collectionName, "collection");
  const db = await manager.db(dbName);
  const collectionPath = path.join(db.basePath, collectionName);

  const openCollection = db.collections.get(collectionName);
  if (openCollection) {
    await openCollection.close();
    db.collections.delete(collectionName);
  }

  if (!fs.existsSync(collectionPath)) {
    return false;
  }

  await fs.promises.rm(collectionPath, { recursive: true, force: true });
  return true;
}

export async function renameCollectionByName(
  dbName: string,
  currentName: string,
  nextName: string
) {
  assertSafeName(currentName, "collection");
  assertSafeName(nextName, "collection");

  const db = await manager.db(dbName);
  const currentPath = path.join(db.basePath, currentName);
  const nextPath = path.join(db.basePath, nextName);

  if (!fs.existsSync(currentPath)) {
    throw new Error("collection not found");
  }

  if (fs.existsSync(nextPath)) {
    throw new Error("target collection already exists");
  }

  const openCollection = db.collections.get(currentName);
  if (openCollection) {
    await openCollection.close();
    db.collections.delete(currentName);
  }

  await fs.promises.rename(currentPath, nextPath);
  return nextName;
}
