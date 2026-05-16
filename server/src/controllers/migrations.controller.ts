import { Request, Response } from "express";
import { getReadManager, getWriteManager } from "../config/database";
import { requireDatabaseAccess } from "../utils/databaseAccess";
import { sendApiError } from "../utils/apiError";
import { getCollectionDocMigrations, migrateDocIfNeeded, setCollectionDocMigrations, type CollectionDocMigrationsConfig } from "../utils/docMigrations";

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export const getDbSchemaVersion = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    await requireDatabaseAccess(req, db);
    const database = await getReadManager().db(db);
    await (database as any).ready;
    const schemaVersion =
      typeof (database as any).getSchemaVersion === "function"
        ? (database as any).getSchemaVersion()
        : null;
    return res.json({ ok: true, db, schemaVersion });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const setDbSchemaVersion = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    await requireDatabaseAccess(req, db);
    const body = isPlainObject(req.body) ? (req.body as any) : {};
    const schemaVersion = body.schemaVersion;
    if (typeof schemaVersion !== "string" || !schemaVersion.trim()) {
      return res.status(400).json({ error: "schemaVersion (string) required" });
    }

    const database = await getWriteManager().db(db);
    await (database as any).ready;
    if (typeof (database as any).setSchemaVersion !== "function") {
      return res.status(400).json({ error: "db does not support setSchemaVersion()" });
    }
    (database as any).setSchemaVersion(schemaVersion);
    return res.json({ ok: true, db, schemaVersion });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

type MigrationAction =
  | { type: "createIndex"; collection: string; field: string; options?: { unique?: boolean } }
  | { type: "createTextIndex"; collection: string; field: string; options?: any }
  | { type: "compactCollection"; collection: string }
  | { type: "compactAll" }
  | { type: "renameCollection"; from: string; to: string };

type HttpMigrationStep = { from: string; to: string; actions: MigrationAction[] };

export const applyDbMigrations = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    await requireDatabaseAccess(req, db);

    const body = isPlainObject(req.body) ? (req.body as any) : {};
    const targetVersion = body.targetVersion;
    const migrations: HttpMigrationStep[] = Array.isArray(body.migrations) ? body.migrations : [];

    if (typeof targetVersion !== "string" || !targetVersion.trim()) {
      return res.status(400).json({ error: "targetVersion (string) required" });
    }

    const database = await getWriteManager().db(db);
    await (database as any).ready;

    if (typeof (database as any).migrate !== "function" || typeof (database as any).applyMigrations !== "function") {
      return res.status(400).json({ error: "db does not support migrations API" });
    }

    for (const step of migrations) {
      if (!step || typeof step !== "object") continue;
      if (typeof step.from !== "string" || typeof step.to !== "string") continue;
      const actions = Array.isArray(step.actions) ? step.actions : [];

      (database as any).migrate(step.from, step.to, async (ldb: any) => {
        for (const action of actions) {
          if (!action || typeof action !== "object") continue;

          if (action.type === "createIndex") {
            if (!action.collection || !action.field) throw new Error("createIndex requires collection and field");
            await ldb.createIndex(action.collection, action.field, { unique: !!action.options?.unique });
            continue;
          }

          if (action.type === "createTextIndex") {
            if (!action.collection || !action.field) throw new Error("createTextIndex requires collection and field");
            await ldb.createTextIndex(action.collection, action.field, action.options ?? {});
            continue;
          }

          if (action.type === "compactCollection") {
            if (!action.collection) throw new Error("compactCollection requires collection");
            await ldb.compactCollection(action.collection);
            continue;
          }

          if (action.type === "compactAll") {
            await ldb.compactAll();
            continue;
          }

          if (action.type === "renameCollection") {
            if (!action.from || !action.to) throw new Error("renameCollection requires from/to");
            await ldb.renameCollection(action.from, action.to);
            continue;
          }

          throw new Error(`unsupported migration action: ${(action as any).type}`);
        }
      });
    }

    await (database as any).applyMigrations(targetVersion);
    const schemaVersion = typeof (database as any).getSchemaVersion === "function" ? (database as any).getSchemaVersion() : null;
    return res.json({ ok: true, db, schemaVersion });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const getCollectionMigrations = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    await requireDatabaseAccess(req, db);
    const database = await getReadManager().db(db);
    await (database as any).ready;
    const config = getCollectionDocMigrations(database as any, col);
    return res.json({ ok: true, db, collection: col, config });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const putCollectionMigrations = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    await requireDatabaseAccess(req, db);
    const body = isPlainObject(req.body) ? (req.body as any) : {};
    const config = body.config;

    if (config === null) {
      const database = await getWriteManager().db(db);
      await (database as any).ready;
      setCollectionDocMigrations(database as any, col, null);
      return res.json({ ok: true, db, collection: col, config: null });
    }

    if (!isPlainObject(config)) {
      return res.status(400).json({ error: "config object (or null) required" });
    }

    const next: CollectionDocMigrationsConfig = {
      enabled: config.enabled !== false,
      currentVersion: Number(config.currentVersion ?? 0),
      writeBackOnRead: !!config.writeBackOnRead,
      migrations: Array.isArray(config.migrations) ? config.migrations : [],
    };

    if (!Number.isFinite(next.currentVersion) || next.currentVersion <= 0) {
      return res.status(400).json({ error: "config.currentVersion must be a positive number" });
    }

    const database = await getWriteManager().db(db);
    await (database as any).ready;
    setCollectionDocMigrations(database as any, col, next);
    return res.json({ ok: true, db, collection: col, config: next });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const testCollectionMigration = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    await requireDatabaseAccess(req, db);
    const body = isPlainObject(req.body) ? (req.body as any) : {};
    const doc = body.doc;
    if (!doc || typeof doc !== "object") {
      return res.status(400).json({ error: "doc object required" });
    }

    const database = await getReadManager().db(db);
    await (database as any).ready;
    const config = getCollectionDocMigrations(database as any, col);
    const migrated = migrateDocIfNeeded(doc, config);
    return res.json({ ok: true, db, collection: col, ...migrated });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};
