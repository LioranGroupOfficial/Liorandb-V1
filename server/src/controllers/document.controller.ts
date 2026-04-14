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

  const results = await collection.find(req.body.query || {});
  res.json({ results });
};

export const updateMany = async (req: Request, res: Response) => {
  await requireDatabaseAccess(req, req.params.db);
  const collection = (await manager.db(req.params.db))
    .collection<any>(req.params.col);

  const docs = await collection.updateMany(req.body.filter, req.body.update);
  res.json({ updated: docs });
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
