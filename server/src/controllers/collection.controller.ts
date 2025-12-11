import { Request, Response } from "express";
import { manager } from "../config/database";

export const listCollections = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    const database = await manager.db(db);
    const collections = await database.listCollections();
    res.json({ collections });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};

export const createCollection = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    const { name } = req.body;

    const database = await manager.db(db);
    await database.createCollection(name);

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};
