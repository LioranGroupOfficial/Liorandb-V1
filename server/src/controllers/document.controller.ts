import { Request, Response } from "express";
import { manager } from "../config/database";
import { requireDatabaseAccess } from "../utils/databaseAccess";

export const insertDocument = async (req: Request, res: Response) => {
  await requireDatabaseAccess(req, req.params.db);
  const collection = (await manager.db(req.params.db))
    .collection<any>(req.params.col);

  const doc = await collection.insertOne(req.body);
  res.json({ ok: true, doc });
};

export const insertMany = async (req: Request, res: Response) => {
  await requireDatabaseAccess(req, req.params.db);
  const collection = (await manager.db(req.params.db))
    .collection<any>(req.params.col);

  const docs = await collection.insertMany(req.body.docs || []);
  res.json({ ok: true, docs });
};

export const findDocuments = async (req: Request, res: Response) => {
  await requireDatabaseAccess(req, req.params.db);
  const collection = (await manager.db(req.params.db))
    .collection<any>(req.params.col);

  const query = (req.body && typeof req.body === "object" ? req.body.query : undefined) || {};
  const options = (req.body && typeof req.body === "object" ? req.body.options : undefined) || undefined;

  const results = await collection.find(query, options);
  res.json({ results });
};

export const updateMany = async (req: Request, res: Response) => {
  await requireDatabaseAccess(req, req.params.db);
  const collection = (await manager.db(req.params.db))
    .collection<any>(req.params.col);

  const docs = await collection.updateMany(req.body.filter, req.body.update);
  res.json({ updated: Array.isArray(docs) ? docs.length : 0, docs });
};

export const deleteMany = async (req: Request, res: Response) => {
  await requireDatabaseAccess(req, req.params.db);
  const collection = (await manager.db(req.params.db))
    .collection<any>(req.params.col);

  const count = await collection.deleteMany(req.body.filter || {});
  res.json({ deleted: count });
};

export const countDocuments = async (req: Request, res: Response) => {
  await requireDatabaseAccess(req, req.params.db);
  const collection = (await manager.db(req.params.db))
    .collection<any>(req.params.col);

  const count = await collection.countDocuments(req.body.filter || {});
  res.json({ count });
};

export const aggregateDocuments = async (req: Request, res: Response) => {
  await requireDatabaseAccess(req, req.params.db);
  const collection = (await manager.db(req.params.db))
    .collection<any>(req.params.col);

  const pipeline = Array.isArray(req.body?.pipeline) ? req.body.pipeline : [];
  const results = await collection.aggregate(pipeline);
  res.json({ results });
};

export const explainQuery = async (req: Request, res: Response) => {
  await requireDatabaseAccess(req, req.params.db);
  const collection = (await manager.db(req.params.db))
    .collection<any>(req.params.col);

  const query = (req.body && typeof req.body === "object" ? req.body.query : undefined) || {};
  const options = (req.body && typeof req.body === "object" ? req.body.options : undefined) || undefined;

  const result = await (collection as any).explain(query, options);
  res.json({ explain: result });
};
