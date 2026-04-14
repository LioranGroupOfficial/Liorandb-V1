import bcrypt from "bcryptjs";
import { Request } from "express";
import fs from "fs";
import path from "path";
import { getDatabaseMetadataCollection, manager } from "../config/database";
import { AuthRole, ManagedDatabaseRecord, RequestAuthContext } from "../types/auth-user";
import { decryptValue, encryptValue } from "./crypto";
import { getRequestAuth, isAdminRole } from "./auth";
import { listDatabaseNames } from "./coreStorage";

function sanitizeSegment(value: string, kind: string) {
  if (!value || typeof value !== "string") {
    throw new Error(`${kind} is required`);
  }

  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(`invalid ${kind}`);
  }

  return trimmed;
}

function buildOwnedDatabaseName(ownerUserId: string, databaseName: string, ownerRole: AuthRole) {
  const cleanDb = sanitizeSegment(databaseName, "database name");
  return ownerRole === "user" ? `${ownerUserId}-${cleanDb}` : cleanDb;
}

function toConnectionString(host: string, record: ManagedDatabaseRecord, password: string) {
  return `liorandb://${encodeURIComponent(record.dbUsername!)}:${encodeURIComponent(password)}@${host}/${record.databaseName}`;
}

export async function getDatabaseRecord(databaseName: string) {
  const metadata = await getDatabaseMetadataCollection();
  return await metadata.findOne({ databaseName }) as ManagedDatabaseRecord | null;
}

export async function listManagedDatabases(ownerUserId?: string) {
  const metadata = await getDatabaseMetadataCollection();
  const records = await metadata.find(ownerUserId ? { ownerUserId } : {}) as ManagedDatabaseRecord[];
  return records.sort((a, b) => a.databaseName.localeCompare(b.databaseName));
}

export async function createManagedDatabase(input: {
  actor: RequestAuthContext;
  ownerUserId: string;
  ownerRole: AuthRole;
  requestedName: string;
}) {
  const metadata = await getDatabaseMetadataCollection();
  const requestedName = sanitizeSegment(input.requestedName, "database name");
  const databaseName = buildOwnedDatabaseName(input.ownerUserId, requestedName, input.ownerRole);

  const existing = await metadata.findOne({ databaseName });
  if (existing) {
    throw new Error("database already exists");
  }

  await manager.db(databaseName);

  const now = new Date().toISOString();
  const created = await metadata.insertOne({
    databaseName,
    requestedName,
    ownerUserId: input.ownerUserId,
    ownerRole: input.ownerRole,
    createdAt: now,
    updatedAt: now,
    createdBy: input.actor.userId,
  } as ManagedDatabaseRecord) as ManagedDatabaseRecord;

  return created;
}

export async function deleteManagedDatabase(record: ManagedDatabaseRecord) {
  const metadata = await getDatabaseMetadataCollection();
  const db = manager.openDBs.get(record.databaseName);
  if (db) {
    await db.close();
    manager.openDBs.delete(record.databaseName);
  }

  const dbPath = path.join(manager.rootPath, record.databaseName);
  if (fs.existsSync(dbPath)) {
    await fs.promises.rm(dbPath, { recursive: true, force: true });
  }

  await metadata.deleteMany({ databaseName: record.databaseName });
}

export async function setDatabaseCredentials(record: ManagedDatabaseRecord, username: string, password: string) {
  const metadata = await getDatabaseMetadataCollection();
  const cleanUsername = sanitizeSegment(username, "username");

  if (password.length < 8) {
    throw new Error("password must be at least 8 characters");
  }

  const encrypted = encryptValue(password);
  const passwordHash = await bcrypt.hash(password, 10);
  const updatedAt = new Date().toISOString();

  const updated: ManagedDatabaseRecord = {
    ...record,
    dbUsername: cleanUsername,
    dbPasswordHash: passwordHash,
    dbPasswordCipherText: encrypted.cipherText,
    dbPasswordIv: encrypted.iv,
    dbPasswordTag: encrypted.tag,
    credentialsUpdatedAt: updatedAt,
    updatedAt,
  };

  await metadata.deleteMany({ databaseName: record.databaseName });
  await metadata.insertOne(updated as ManagedDatabaseRecord);

  return updated;
}

export function getDatabasePassword(record: ManagedDatabaseRecord) {
  if (!record.dbPasswordCipherText || !record.dbPasswordIv || !record.dbPasswordTag) {
    throw new Error("database credentials are not configured");
  }

  return decryptValue({
    cipherText: record.dbPasswordCipherText,
    iv: record.dbPasswordIv,
    tag: record.dbPasswordTag,
  });
}

export async function verifyDatabaseCredential(record: ManagedDatabaseRecord, username: string, password: string) {
  if (!record.dbUsername || !record.dbPasswordHash) {
    return false;
  }

  if (record.dbUsername !== username) {
    return false;
  }

  return await bcrypt.compare(password, record.dbPasswordHash);
}

export function canAccessDatabase(auth: RequestAuthContext | undefined, record: ManagedDatabaseRecord | null) {
  if (!auth) {
    return false;
  }

  if (auth.authType === "connection") {
    return !!record && auth.databaseName === record.databaseName;
  }

  if (!record) {
    return auth.role !== "user";
  }

  return isAdminRole(auth.role) || auth.userId === record.ownerUserId;
}

export async function requireDatabaseAccess(req: Request, databaseName: string) {
  const auth = getRequestAuth(req);
  const record = await getDatabaseRecord(databaseName);

  if (!canAccessDatabase(auth, record)) {
    throw new Error("database access denied");
  }

  return { auth, record };
}

export function buildDatabaseResponse(record: ManagedDatabaseRecord, host: string) {
  const base = {
    ownerUserId: record.ownerUserId,
    ownerRole: record.ownerRole,
    requestedName: record.requestedName,
    databaseName: record.databaseName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    credentialsConfigured: !!(record.dbUsername && record.dbPasswordHash),
    dbUsername: record.dbUsername || null,
  };

  if (!record.dbUsername || !record.dbPasswordHash) {
    return {
      ...base,
      connectionString: null,
    };
  }

  return {
    ...base,
    connectionString: toConnectionString(host, record, getDatabasePassword(record)),
  };
}

export function getRequestHost(req: Request) {
  return req.get("host") || "localhost:4000";
}

export function parseConnectionString(connectionString: string) {
  const parsed = new URL(connectionString);

  if (parsed.protocol !== "liorandb:") {
    throw new Error("invalid connection string protocol");
  }

  return {
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    databaseName: parsed.pathname.replace(/^\//, ""),
  };
}

export async function resolveDatabaseListForAuth(auth: RequestAuthContext) {
  if (auth.role === "user") {
    return await listManagedDatabases(auth.userId);
  }

  const managed = await listManagedDatabases();
  const managedNames = new Set(managed.map((record) => record.databaseName));
  const diskNames = await listDatabaseNames();

  for (const diskName of diskNames) {
    if (!managedNames.has(diskName)) {
      managed.push({
        databaseName: diskName,
        requestedName: diskName,
        ownerUserId: "system",
        ownerRole: "admin",
        createdAt: "",
        updatedAt: "",
        createdBy: "system",
      });
    }
  }

  return managed.sort((a, b) => a.databaseName.localeCompare(b.databaseName));
}
