import { Request, Response } from "express";
import { openReadDatabase, openWriteDatabase } from "../config/database";
import { requireDatabaseAccess } from "../utils/databaseAccess";
import { sendApiError } from "../utils/apiError";
import { openConfiguredCollection } from "../utils/collectionConfig";
import { getCollectionDocMigrations, migrateDocIfNeeded } from "../utils/docMigrations";

function getBodyObject(req: Request) {
  return req.body && typeof req.body === "object" ? (req.body as any) : {};
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseSortDir(value: unknown): 1 | -1 | undefined {
  if (value === 1 || value === "1" || value === "asc" || value === "ASC") return 1;
  if (value === -1 || value === "-1" || value === "desc" || value === "DESC") return -1;
  return undefined;
}

function normalizeFindPayload(body: any): { query: any; options?: any } {
  const rawQuery = isPlainObject(body?.query) ? body.query : {};

  const options: any = isPlainObject(body?.options) ? { ...body.options } : {};

  const mergeMissing = (key: string, value: any) => {
    if (options[key] === undefined && value !== undefined) options[key] = value;
  };

  // Allow passing options at the top-level body (backward/alternate client payloads).
  mergeMissing("limit", body?.limit);
  mergeMissing("offset", body?.offset);
  mergeMissing("skip", body?.skip);
  mergeMissing("cursor", body?.cursor);
  mergeMissing("projection", body?.projection);
  mergeMissing("sort", body?.sort);

  // Convenience sort format: { sortBy: "field", sortDir: "asc" | "desc" | 1 | -1 }
  if (options.sort === undefined) {
    const sortBy = body?.sortBy;
    const sortDir = parseSortDir(body?.sortDir ?? body?.sortOrder ?? body?.order ?? body?.dir);
    if (typeof sortBy === "string" && sortBy.length > 0 && sortDir !== undefined) {
      options.sort = { [sortBy]: sortDir };
    }
  }

  // Allow embedding options inside query via reserved keys.
  // Preferred: { query: { ...filter, __options: { offset, limit, sort, ... } } }
  // Back-compat: { query: { ...filter, offset, limit, sort, ... } } when body.options is absent.
  let query = rawQuery;
  const embedded = isPlainObject(rawQuery.__options) ? rawQuery.__options : undefined;
  if (embedded) {
    mergeMissing("limit", embedded.limit);
    mergeMissing("offset", embedded.offset);
    mergeMissing("skip", embedded.skip);
    mergeMissing("cursor", embedded.cursor);
    mergeMissing("projection", embedded.projection);
    mergeMissing("sort", embedded.sort);

    const embeddedSortBy = embedded.sortBy;
    const embeddedSortDir = parseSortDir(embedded.sortDir ?? embedded.sortOrder ?? embedded.order ?? embedded.dir);
    if (options.sort === undefined && typeof embeddedSortBy === "string" && embeddedSortBy.length > 0 && embeddedSortDir !== undefined) {
      options.sort = { [embeddedSortBy]: embeddedSortDir };
    }

    query = { ...rawQuery };
    delete (query as any).__options;
  } else if (!isPlainObject(body?.options)) {
    // Only apply this "query carries options" mode when there wasn't an explicit body.options object.
    const q: any = { ...rawQuery };
    const extracted: any = {};

    for (const key of ["limit", "offset", "skip", "cursor", "projection", "sort", "sortBy", "sortDir", "sortOrder", "order", "dir"]) {
      if (q[key] !== undefined) {
        extracted[key] = q[key];
        delete q[key];
      }
    }

    mergeMissing("limit", extracted.limit);
    mergeMissing("offset", extracted.offset);
    mergeMissing("skip", extracted.skip);
    mergeMissing("cursor", extracted.cursor);
    mergeMissing("projection", extracted.projection);
    mergeMissing("sort", extracted.sort);

    if (options.sort === undefined) {
      const sortBy = extracted.sortBy;
      const sortDir = parseSortDir(extracted.sortDir ?? extracted.sortOrder ?? extracted.order ?? extracted.dir);
      if (typeof sortBy === "string" && sortBy.length > 0 && sortDir !== undefined) {
        options.sort = { [sortBy]: sortDir };
      }
    }

    query = q;
  }

  const hasOptions = Object.keys(options).length > 0;
  return { query, options: hasOptions ? options : undefined };
}

export const insertDocument = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openWriteDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const doc = await collection.insertOne(req.body);
    res.json({ ok: true, doc });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const insertMany = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openWriteDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const body = getBodyObject(req);
    const docs = await collection.insertMany(body.docs || []);
    res.json({ ok: true, docs });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const findDocuments = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openReadDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const body = getBodyObject(req);
    const { query, options } = normalizeFindPayload(body);

    const results = await collection.find(query, options);

    const mig = getCollectionDocMigrations(db as any, req.params.col);
    if (mig && mig.enabled !== false && Array.isArray(results) && results.length) {
      const migratedDocs: any[] = [];

      for (const doc of results) {
        const migrated = migrateDocIfNeeded(doc, mig);
        migratedDocs.push(migrated.doc);

        if (mig.writeBackOnRead && migrated.changed && migrated.doc && (migrated.doc as any)._id) {
          try {
            const wdb = await openWriteDatabase(req.params.db);
            const wcol = openConfiguredCollection<any>(wdb, req.params.col);
            await (wcol as any).updateOne(
              { _id: (migrated.doc as any)._id },
              { $set: migrated.doc },
              { upsert: false }
            );
          } catch {
            // best-effort; ignore write-back failures
          }
        }
      }

      return res.json({ results: migratedDocs });
    }

    res.json({ results });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const findOneDocument = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openReadDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const body = getBodyObject(req);
    const { query, options } = normalizeFindPayload(body);

    const doc = await collection.findOne(query, options);

    const mig = getCollectionDocMigrations(db as any, req.params.col);
    if (mig && mig.enabled !== false && doc) {
      const migrated = migrateDocIfNeeded(doc, mig);
      if (mig.writeBackOnRead && migrated.changed && migrated.doc && (migrated.doc as any)._id) {
        try {
          const wdb = await openWriteDatabase(req.params.db);
          const wcol = openConfiguredCollection<any>(wdb, req.params.col);
          await (wcol as any).updateOne(
            { _id: (migrated.doc as any)._id },
            { $set: migrated.doc },
            { upsert: false }
          );
        } catch {
          // ignore
        }
      }
      return res.json({ doc: migrated.doc });
    }

    res.json({ doc });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

async function *parseNdjson(stream: NodeJS.ReadableStream) {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk.toString("utf8");
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      yield JSON.parse(line);
    }
  }
  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail);
}

export const insertManyStream = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openWriteDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const fn = (collection as any).insertManyStream;
    if (typeof fn === "function") {
      const docs = parseNdjson(req);
      const result = await fn.call(collection, docs, undefined);
      return res.json({ ok: true, result });
    }

    // Fallback: buffer up to a safe limit and call insertMany.
    const limit = Number(process.env.LIORANDB_STREAM_FALLBACK_MAX_DOCS || 10_000);
    const docs: any[] = [];
    for await (const doc of parseNdjson(req)) {
      docs.push(doc);
      if (docs.length > limit) {
        return res.status(413).json({ error: `too many docs for fallback mode (max ${limit})` });
      }
    }

    const inserted = await collection.insertMany(docs);
    return res.json({ ok: true, docs: inserted });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const updateOne = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openWriteDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const body = getBodyObject(req);
    const doc = await (collection as any).updateOne(body.filter, body.update, body.options);
    res.json({ ok: true, doc });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const updateMany = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openWriteDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const body = getBodyObject(req);
    const docs = await collection.updateMany(body.filter, body.update);
    res.json({ updated: Array.isArray(docs) ? docs.length : 0, docs });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const deleteOne = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openWriteDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const body = getBodyObject(req);
    const doc = await (collection as any).deleteOne(body.filter || {});
    res.json({ ok: true, doc });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const deleteMany = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openWriteDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const body = getBodyObject(req);
    const count = await collection.deleteMany(body.filter || {});
    res.json({ deleted: count });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const countDocuments = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openReadDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const body = getBodyObject(req);
    const count = await collection.countDocuments(body.filter || {});
    res.json({ count });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const aggregateDocuments = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openReadDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const pipeline = Array.isArray((req.body as any)?.pipeline) ? (req.body as any).pipeline : [];
    const results = await collection.aggregate(pipeline);
    res.json({ results });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const explainQuery = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const db = await openReadDatabase(req.params.db);
    const collection = openConfiguredCollection<any>(db, req.params.col);

    const body = getBodyObject(req);
    const { query, options } = normalizeFindPayload(body);

    const result = await (collection as any).explain(query, options);
    res.json({ explain: result });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};
