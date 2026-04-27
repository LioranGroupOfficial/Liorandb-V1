import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import { manager } from "../config/database";
import { requireDatabaseAccess } from "../utils/databaseAccess";
import { sendApiError } from "../utils/apiError";

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

function getDbMeta(db: any) {
  return (db as any).meta as { indexes?: Record<string, Array<{ field: string; options?: any }>> };
}

async function resetCollectionHandle(db: any, colName: string) {
  const existing = db.collections?.get?.(colName);
  if (existing) {
    try {
      await existing.close?.();
    } catch {}
    db.collections.delete(colName);
  }
}

export const createIndex = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);

    const body = req.body && typeof req.body === "object" ? (req.body as any) : {};
    const field = sanitizeSegment(body.field, "field");
    const unique = !!body.unique;

    const db = await manager.db(req.params.db);
    await db.createIndex(req.params.col, field, { unique });

    return res.json({ ok: true, collection: req.params.col, field, unique });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const listIndexes = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);

    const db = await manager.db(req.params.db);
    await db.ready;

    const meta = getDbMeta(db);
    const fromMeta = meta?.indexes?.[req.params.col] || [];

    const merged = new Map<string, { field: string; unique: boolean; persisted: boolean }>();

    for (const entry of fromMeta) {
      merged.set(entry.field, {
        field: entry.field,
        unique: !!entry.options?.unique,
        persisted: true,
      });
    }

    if (!merged.has("_id")) {
      merged.set("_id", { field: "_id", unique: true, persisted: false });
    }

    return res.json({
      ok: true,
      collection: req.params.col,
      indexes: Array.from(merged.values()).sort((a, b) => a.field.localeCompare(b.field)),
    });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const dropIndex = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);

    const field = sanitizeSegment(req.params.field, "field");
    if (field === "_id") {
      return res.status(400).json({ error: "cannot drop _id index" });
    }

    const db = await manager.db(req.params.db);
    await db.ready;

    const meta = getDbMeta(db);
    const existing = meta?.indexes?.[req.params.col] || [];
    const next = existing.filter((idx) => idx.field !== field);

    if (meta?.indexes) {
      meta.indexes[req.params.col] = next;
      if (next.length === 0) {
        delete meta.indexes[req.params.col];
      }
      (db as any).saveMeta?.();
    }

    await resetCollectionHandle(db as any, req.params.col);

    const indexDir = path.join(db.basePath, req.params.col, "__indexes", `${field}.idx`);
    if (fs.existsSync(indexDir)) {
      await fs.promises.rm(indexDir, { recursive: true, force: true });
    }

    return res.json({ ok: true, collection: req.params.col, field });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const rebuildIndex = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);

    const field = sanitizeSegment(req.params.field, "field");
    if (field === "_id") {
      return res.status(400).json({ error: "cannot rebuild _id index" });
    }

    const db = await manager.db(req.params.db);
    await db.ready;

    const meta = getDbMeta(db);
    const existing = meta?.indexes?.[req.params.col] || [];
    const found = existing.find((idx) => idx.field === field);
    const unique = !!found?.options?.unique;

    await resetCollectionHandle(db as any, req.params.col);

    const indexDir = path.join(db.basePath, req.params.col, "__indexes", `${field}.idx`);
    if (fs.existsSync(indexDir)) {
      await fs.promises.rm(indexDir, { recursive: true, force: true });
    }

    await db.createIndex(req.params.col, field, { unique });

    return res.json({ ok: true, collection: req.params.col, field, unique });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const rebuildAllIndexes = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);

    const db = await manager.db(req.params.db);
    await db.ready;

    const meta = getDbMeta(db);
    const indexes = meta?.indexes?.[req.params.col] || [];

    await resetCollectionHandle(db as any, req.params.col);

    for (const idx of indexes) {
      const field = idx.field;
      if (!field || field === "_id") continue;

      const indexDir = path.join(db.basePath, req.params.col, "__indexes", `${field}.idx`);
      if (fs.existsSync(indexDir)) {
        await fs.promises.rm(indexDir, { recursive: true, force: true });
      }

      await db.createIndex(req.params.col, field, { unique: !!idx.options?.unique });
    }

    return res.json({ ok: true, collection: req.params.col, rebuilt: indexes.length });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};
