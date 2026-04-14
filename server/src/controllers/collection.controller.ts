import { Request, Response } from "express";
import { manager } from "../config/database";
import {
  createCollectionByName,
  deleteCollectionByName,
  listCollectionNames,
  renameCollectionByName
} from "../utils/coreStorage";
import { requireDatabaseAccess } from "../utils/databaseAccess";

export const listCollections = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const collections = await listCollectionNames(req.params.db);
    res.json({ collections });
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "server error" });
  }
};

export const createCollection = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    await createCollectionByName(req.params.db, req.body.name);
    res.json({ ok: true, collection: req.body.name });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "server error" });
  }
};

export const deleteCollection = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const ok = await deleteCollectionByName(req.params.db, req.params.col);
    res.json({ ok });
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "server error" });
  }
};

export const renameCollection = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    const { newName } = req.body;

    await requireDatabaseAccess(req, db);
    await renameCollectionByName(db, col, newName);

    res.json({ ok: true, old: col, new: newName });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "server error" });
  }
};

export const collectionStats = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    await requireDatabaseAccess(req, db);
    const database = await manager.db(db);
    const collection = database.collection<any>(col);

    const count = await collection.countDocuments();

    res.json({
      name: col,
      documents: count,
    });
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "server error" });
  }
};
