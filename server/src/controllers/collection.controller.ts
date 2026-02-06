import { Request, Response } from "express";
import { manager } from "../config/database";

export const listCollections = async (req: Request, res: Response) => {
  try {
    const database = await manager.db(req.params.db);
    const collections = await database.listCollections();
    res.json({ collections });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};

export const createCollection = async (req: Request, res: Response) => {
  try {
    const database = await manager.db(req.params.db);
    await database.createCollection(req.body.name);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};

export const deleteCollection = async (req: Request, res: Response) => {
  try {
    const database = await manager.db(req.params.db);
    await database.deleteCollection(req.params.col);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};

export const renameCollection = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    const { newName } = req.body;

    const database = await manager.db(db);
    await database.renameCollection(col, newName);

    res.json({ ok: true, old: col, new: newName });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};

export const collectionStats = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    const database = await manager.db(db);
    const collection = database.collection<any>(col);

    const count = await collection.countDocuments();

    res.json({
      name: col,
      documents: count,
    });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};
