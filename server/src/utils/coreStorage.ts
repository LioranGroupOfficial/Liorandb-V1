import fs from "fs";
import path from "path";
import { manager, openWriteDatabase, withCoreRecovery } from "../config/database.js";

export const AUTH_DB_NAME = "_auth";
const WAL_DIR_NAME = "__wal";
const INTERNAL_DB_NAMES = new Set(["__cluster_nodes"]);

function toBool(raw: unknown, defaultValue = false) {
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === "") return defaultValue;
  if (v === "1" || v === "true" || v === "yes" || v === "y" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "n" || v === "off") return false;
  return defaultValue;
}

function isSingleNodeMode() {
  return toBool(process.env.LIORANDB_SINGLE_NODE, false);
}

function assertAllowedDatabaseName(name: string) {
  if (!isSingleNodeMode()) return;
  if (INTERNAL_DB_NAMES.has(name)) {
    throw new Error(`database "${name}" is not available in single-node mode`);
  }
}

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
  assertAllowedDatabaseName(name);
  return path.join(manager.rootPath, name);
}

export async function listDatabaseNames() {
  // Prefer engine APIs when available (cluster-safe). Fall back to disk scan.
  const anyM: any = manager as any;
  if (typeof anyM.listDatabases === "function") {
    const names = await anyM.listDatabases();
    return (Array.isArray(names) ? names : [])
      .filter((name) => typeof name === "string")
      .filter((name) => name !== AUTH_DB_NAME && !name.startsWith("."))
      .filter((name) => (isSingleNodeMode() ? !INTERNAL_DB_NAMES.has(name) : true))
      .sort((a, b) => a.localeCompare(b));
  }

  return listSubdirectories(manager.rootPath)
    .filter((name) => name !== AUTH_DB_NAME && !name.startsWith("."))
    .filter((name) => (isSingleNodeMode() ? !INTERNAL_DB_NAMES.has(name) : true))
    .sort((a, b) => a.localeCompare(b));
}

export async function createDatabaseByName(name: string) {
  assertSafeName(name, "database");
  assertAllowedDatabaseName(name);
  const anyM: any = manager as any;
  if (typeof anyM.createDatabase === "function") {
    await withCoreRecovery(`createDatabaseByName(${name})`, async () => {
      await anyM.createDatabase(name);
    });
  }
  await openWriteDatabase(name);
  return name;
}

export async function deleteDatabaseByName(name: string) {
  assertSafeName(name, "database");
  assertAllowedDatabaseName(name);

  const anyM: any = manager as any;
  if (typeof anyM.dropDatabase === "function") {
    return await withCoreRecovery(`deleteDatabaseByName(${name})`, async () => {
      return await anyM.dropDatabase(name);
    });
  }

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
  assertAllowedDatabaseName(currentName);
  assertAllowedDatabaseName(nextName);

  const anyM: any = manager as any;
  if (typeof anyM.renameDatabase === "function") {
    await withCoreRecovery(`renameDatabaseByName(${currentName}->${nextName})`, async () => {
      await anyM.renameDatabase(currentName, nextName);
    });
    return nextName;
  }

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
  assertAllowedDatabaseName(dbName);
  return withCoreRecovery(`listCollectionNames(${dbName})`, async () => {
    const db = await openWriteDatabase(dbName);
    const anyDb: any = db as any;
    if (typeof anyDb.listCollections === "function") {
      const cols = await anyDb.listCollections();
      return (Array.isArray(cols) ? cols : [])
        .filter((c) => typeof c === "string" && c.trim())
        .sort((a, b) => a.localeCompare(b));
    }

    return listSubdirectories(db.basePath).sort((a, b) => a.localeCompare(b));
  });
}

export async function createCollectionByName(dbName: string, collectionName: string) {
  assertSafeName(collectionName, "collection");
  assertAllowedDatabaseName(dbName);
  return withCoreRecovery(`createCollectionByName(${dbName}/${collectionName})`, async () => {
    const db = await openWriteDatabase(dbName);
    const anyDb: any = db as any;
    if (typeof anyDb.createCollection === "function") {
      await anyDb.createCollection(collectionName);
      return collectionName;
    }

    // Fallback: opening the handle may be lazy and not create on disk until first write.
    db.collection(collectionName);
    const basePath = (db as any).basePath;
    if (typeof basePath === "string" && basePath) {
      await fs.promises.mkdir(path.join(basePath, collectionName), { recursive: true });
    }
    return collectionName;
  });
}

export async function deleteCollectionByName(dbName: string, collectionName: string) {
  assertSafeName(collectionName, "collection");
  assertAllowedDatabaseName(dbName);
  return withCoreRecovery(`deleteCollectionByName(${dbName}/${collectionName})`, async () => {
    const db = await openWriteDatabase(dbName);
    const anyDb: any = db as any;
    if (typeof anyDb.dropCollection === "function") {
      const res = await anyDb.dropCollection(collectionName);
      return !!(res?.ok ?? res);
    }
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
  });
}

export async function renameCollectionByName(
  dbName: string,
  currentName: string,
  nextName: string
) {
  assertSafeName(currentName, "collection");
  assertSafeName(nextName, "collection");
  assertAllowedDatabaseName(dbName);

  return withCoreRecovery(`renameCollectionByName(${dbName}/${currentName}->${nextName})`, async () => {
    const db = await openWriteDatabase(dbName);
    const anyDb: any = db as any;
    if (typeof anyDb.renameCollection === "function") {
      await anyDb.renameCollection(currentName, nextName);
      return nextName;
    }
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
  });
}

