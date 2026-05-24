import { Request, Response } from "express";
import { getBaseDBFolder } from "@liorandb/core";
import type { LioranManager } from "@liorandb/core";
import {
  allManagers,
  baseRootPath,
  clusterNodeCount,
  manager,
  openReadDatabase,
  openWriteDatabase,
} from "../config/database.js";
import { listDatabaseNames } from "../utils/coreStorage.js";
import { getPaused } from "../utils/pause.js";
import { getRequestAuth, isAdminRole } from "../utils/auth.js";

function anyOf<T>(v: T): any {
  return v as any;
}

function readSchemaVersionFromBody(body: unknown) {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const v = (body as any).schemaVersion ?? (body as any).version ?? (body as any).schema_version;
  return typeof v === "string" ? v : undefined;
}

function requireAdmin(req: Request, res: Response) {
  const auth = getRequestAuth(req);
  if (!auth || auth.authType !== "jwt" || !isAdminRole(auth.role)) {
    res.status(403).json({ error: "admin access required" });
    return null;
  }
  return auth;
}

export const coreStatus = async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const m = manager;

  const clusterLeader = anyOf(m).clusterLeader ?? null;
  const cluster = anyOf(m).options?.cluster ?? anyOf(m).cluster ?? null;
  const replication = anyOf(m).options?.replication ?? anyOf(m).replication ?? null;
  const consistency = anyOf(m).options?.consistency ?? anyOf(m).consistency ?? null;
  const tenancy = anyOf(m).options?.tenancy ?? anyOf(m).tenancy ?? null;
  const security = anyOf(m).options?.security ?? anyOf(m).security ?? null;

  return res.json({
    ok: true,
    paused: getPaused(),
    paths: {
      baseFolder: getBaseDBFolder(),
      rootPath: baseRootPath,
    },
    ipc: {
      primary: typeof m.isPrimary === "function" ? m.isPrimary() : null,
      client: typeof m.isClient === "function" ? m.isClient() : null,
      readonly: typeof m.isReadOnly === "function" ? m.isReadOnly() : null,
    },
    cluster: {
      nodeCount: clusterNodeCount,
      managers: allManagers.length,
      enabled: !!cluster?.enabled,
      leader: clusterLeader ? { host: clusterLeader.host, clientPort: clusterLeader.clientPort } : null,
    },
    advanced: {
      replicationEnabled: !!replication,
      consistency: consistency ?? null,
      tenancy: tenancy ?? null,
      security: security ?? null,
    },
  });
};

export const listEngineDatabases = async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const names = await listDatabaseNames();
  return res.json({ ok: true, databases: names.sort() });
};

export const coreIpcMode = async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const m = manager;
  return res.json({
    ok: true,
    mode: {
      primary: typeof m.isPrimary === "function" ? m.isPrimary() : null,
      client: typeof m.isClient === "function" ? m.isClient() : null,
      readonly: typeof m.isReadOnly === "function" ? m.isReadOnly() : null,
    },
  });
};

export const coreManagers = async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const entries = allManagers.map((m: LioranManager, idx: number) => ({
    index: idx,
    primary: typeof m.isPrimary === "function" ? m.isPrimary() : null,
    client: typeof m.isClient === "function" ? m.isClient() : null,
    readonly: typeof m.isReadOnly === "function" ? m.isReadOnly() : null,
  }));
  return res.json({ ok: true, managers: entries });
};

export const coreDbStatus = async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const dbName = String(req.params.db || "").trim();
  if (!dbName) return res.status(400).json({ error: "db required" });
  const db = await openReadDatabase(dbName);
  await (db as any).ready;
  return res.json({
    ok: true,
    db: dbName,
    schemaVersion: typeof (db as any).getSchemaVersion === "function" ? (db as any).getSchemaVersion() : null,
    meta: (db as any).meta ?? null,
  });
};

export const coreDbSchemaVersion = async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const dbName = String(req.params.db || "").trim();
  if (!dbName) return res.status(400).json({ error: "db required" });
  const db = await openReadDatabase(dbName);
  await (db as any).ready;
  const schemaVersion = typeof (db as any).getSchemaVersion === "function" ? (db as any).getSchemaVersion() : null;
  return res.json({ ok: true, db: dbName, schemaVersion });
};

export const setCoreDbSchemaVersion = async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const dbName = String(req.params.db || "").trim();
  if (!dbName) return res.status(400).json({ error: "db required" });
  const schemaVersion = readSchemaVersionFromBody(req.body);
  if (typeof schemaVersion !== "string" || !schemaVersion.trim()) {
    return res.status(400).json({ error: "schemaVersion (string) required" });
  }

  const db = await openWriteDatabase(dbName);
  await (db as any).ready;
  if (typeof (db as any).setSchemaVersion !== "function") {
    return res.status(400).json({ error: "db does not support setSchemaVersion()" });
  }

  (db as any).setSchemaVersion(schemaVersion);
  return res.json({ ok: true, db: dbName, schemaVersion });
};

