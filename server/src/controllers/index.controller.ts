import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import { getReadManager, getWriteManager } from "../config/database";
import { requireDatabaseAccess } from "../utils/databaseAccess";
import { sendApiError } from "../utils/apiError";
import type { TextIndexOptions } from "../utils/collectionConfig";

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
  return (db as any).meta as {
    indexes?: Record<
      string,
      Array<{
        field: string;
        options?: any;
        type?: "btree" | "text";
        textOptions?: TextIndexOptions;
      }>
    >;
  };
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
    const type = typeof body.type === "string" ? String(body.type).trim().toLowerCase() : "btree";

    if (type === "text") {
      const textOptions: TextIndexOptions =
        body.textOptions && typeof body.textOptions === "object" ? body.textOptions : body.options || {};

      const db = await getWriteManager().db(req.params.db);
      await (db as any).createTextIndex(req.params.col, field, textOptions);

      return res.json({ ok: true, collection: req.params.col, field, type: "text", options: textOptions });
    }

    const unique = !!body.unique;

    const db = await getWriteManager().db(req.params.db);
    await db.createIndex(req.params.col, field, { unique });

    return res.json({ ok: true, collection: req.params.col, field, type: "btree", unique });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const createTextIndex = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);

    const body = req.body && typeof req.body === "object" ? (req.body as any) : {};
    const field = sanitizeSegment(body.field, "field");
    const textOptions: TextIndexOptions = body.options && typeof body.options === "object" ? body.options : {};

    const db = await getWriteManager().db(req.params.db);
    await (db as any).createTextIndex(req.params.col, field, textOptions);

    return res.json({ ok: true, collection: req.params.col, field, type: "text", options: textOptions });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const listIndexes = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);

    const db = await getReadManager().db(req.params.db);
    await db.ready;

    const meta = getDbMeta(db);
    const fromMeta = meta?.indexes?.[req.params.col] || [];

    const merged = new Map<
      string,
      { field: string; type: "btree" | "text"; unique: boolean; persisted: boolean; textOptions?: TextIndexOptions }
    >();

    for (const entry of fromMeta) {
      const type = (entry.type ?? "btree") as "btree" | "text";
      const key = `${type}:${entry.field}`;
      merged.set(key, {
        field: entry.field,
        type,
        unique: type === "btree" ? !!entry.options?.unique : false,
        persisted: true,
        textOptions: type === "text" ? (entry.textOptions ?? {}) : undefined,
      });
    }

    if (!merged.has("btree:_id")) {
      merged.set("btree:_id", { field: "_id", type: "btree", unique: true, persisted: false });
    }

    return res.json({
      ok: true,
      collection: req.params.col,
      indexes: Array.from(merged.values()).sort((a, b) => {
        const tf = a.type.localeCompare(b.type);
        return tf !== 0 ? tf : a.field.localeCompare(b.field);
      }),
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

    const db = await getWriteManager().db(req.params.db);
    await db.ready;

    const meta = getDbMeta(db);
    const existing = meta?.indexes?.[req.params.col] || [];
    const next = existing.filter((idx) => !(idx.field === field && (idx.type ?? "btree") === "btree"));

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

    return res.json({ ok: true, collection: req.params.col, field, type: "btree" });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const dropTextIndex = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);

    const field = sanitizeSegment(req.params.field, "field");

    const db = await getWriteManager().db(req.params.db);
    await db.ready;

    const meta = getDbMeta(db);
    const existing = meta?.indexes?.[req.params.col] || [];
    const next = existing.filter((idx) => !(idx.field === field && (idx.type ?? "btree") === "text"));

    if (meta?.indexes) {
      meta.indexes[req.params.col] = next;
      if (next.length === 0) {
        delete meta.indexes[req.params.col];
      }
      (db as any).saveMeta?.();
    }

    await resetCollectionHandle(db as any, req.params.col);

    const indexDir = path.join(db.basePath, req.params.col, "__indexes", `${field}.textidx`);
    if (fs.existsSync(indexDir)) {
      await fs.promises.rm(indexDir, { recursive: true, force: true });
    }

    return res.json({ ok: true, collection: req.params.col, field, type: "text" });
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

    const db = await getWriteManager().db(req.params.db);
    await db.ready;

    const meta = getDbMeta(db);
    const existing = meta?.indexes?.[req.params.col] || [];
    const found = existing.find((idx) => idx.field === field && (idx.type ?? "btree") === "btree");
    const unique = !!found?.options?.unique;

    await resetCollectionHandle(db as any, req.params.col);

    const indexDir = path.join(db.basePath, req.params.col, "__indexes", `${field}.idx`);
    if (fs.existsSync(indexDir)) {
      await fs.promises.rm(indexDir, { recursive: true, force: true });
    }

    await db.createIndex(req.params.col, field, { unique });

    return res.json({ ok: true, collection: req.params.col, field, type: "btree", unique });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const rebuildTextIndex = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);

    const field = sanitizeSegment(req.params.field, "field");

    const db = await getWriteManager().db(req.params.db);
    await db.ready;

    const meta = getDbMeta(db);
    const existing = meta?.indexes?.[req.params.col] || [];
    const found = existing.find((idx) => idx.field === field && (idx.type ?? "btree") === "text");
    const textOptions: TextIndexOptions = found?.textOptions ?? {};

    // Core createTextIndex is meta-gated; for rebuild we must remove meta, delete index dir, then recreate.
    if (meta?.indexes) {
      const next = existing.filter((idx) => !(idx.field === field && (idx.type ?? "btree") === "text"));
      meta.indexes[req.params.col] = next;
      if (next.length === 0) delete meta.indexes[req.params.col];
      (db as any).saveMeta?.();
    }

    await resetCollectionHandle(db as any, req.params.col);

    const indexDir = path.join(db.basePath, req.params.col, "__indexes", `${field}.textidx`);
    if (fs.existsSync(indexDir)) {
      await fs.promises.rm(indexDir, { recursive: true, force: true });
    }

    await (db as any).createTextIndex(req.params.col, field, textOptions);

    return res.json({ ok: true, collection: req.params.col, field, type: "text", options: textOptions });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const rebuildAllIndexes = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);

    const db = await getWriteManager().db(req.params.db);
    await db.ready;

    const meta = getDbMeta(db);
    const indexes = meta?.indexes?.[req.params.col] || [];

    await resetCollectionHandle(db as any, req.params.col);

    for (const idx of indexes) {
      const field = idx.field;
      if (!field || field === "_id") continue;
      const type = (idx.type ?? "btree") as "btree" | "text";

      const suffix = type === "text" ? ".textidx" : ".idx";
      const indexDir = path.join(db.basePath, req.params.col, "__indexes", `${field}${suffix}`);
      if (fs.existsSync(indexDir)) {
        await fs.promises.rm(indexDir, { recursive: true, force: true });
      }

      if (type === "text") {
        // Rebuild: remove meta gate first.
        const existing = meta?.indexes?.[req.params.col] || [];
        const next = existing.filter((m) => !(m.field === field && (m.type ?? "btree") === "text"));
        if (meta?.indexes) {
          meta.indexes[req.params.col] = next;
          if (next.length === 0) delete meta.indexes[req.params.col];
          (db as any).saveMeta?.();
        }
        await (db as any).createTextIndex(req.params.col, field, idx.textOptions ?? {});
      } else {
        await db.createIndex(req.params.col, field, { unique: !!idx.options?.unique });
      }
    }

    return res.json({ ok: true, collection: req.params.col, rebuilt: indexes.length });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};
