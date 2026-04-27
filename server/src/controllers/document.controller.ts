import { Request, Response } from "express";
import { manager } from "../config/database";
import { requireDatabaseAccess } from "../utils/databaseAccess";
import { sendApiError } from "../utils/apiError";

function getBodyObject(req: Request) {
  return req.body && typeof req.body === "object" ? (req.body as any) : {};
}

export const insertDocument = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

    const doc = await collection.insertOne(req.body);
    res.json({ ok: true, doc });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const insertMany = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

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
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

    const body = getBodyObject(req);
    const query = body.query || {};
    const options = body.options || undefined;

    const results = await collection.find(query, options);
    res.json({ results });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const findOneDocument = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

    const body = getBodyObject(req);
    const query = body.query || {};
    const options = body.options || undefined;

    const doc = await collection.findOne(query, options);
    res.json({ doc });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const updateOne = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

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
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

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
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

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
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

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
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

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
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

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
    const collection = (await manager.db(req.params.db)).collection<any>(req.params.col);

    const body = getBodyObject(req);
    const query = body.query || {};
    const options = body.options || undefined;

    const result = await (collection as any).explain(query, options);
    res.json({ explain: result });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};
