import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { manager } from "../config/database";

export const listDatabases = async (_: Request, res: Response) => {
  try {
    const list = await manager.listDatabases();
    res.json({ databases: list });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};

export const createDatabase = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "database name required" });

    await manager.createDatabase(name);
    res.json({ ok: true, db: name });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};

export const deleteDatabase = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    const ok = await manager.deleteDatabase(db);
    res.json({ ok: !!ok });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};

export const renameDatabase = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    const { newName } = req.body;

    if (!newName) return res.status(400).json({ error: "newName required" });

    await manager.renameDatabase(db, newName);
    res.json({ ok: true, old: db, new: newName });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};

export const databaseStats = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    const database = await manager.db(db);
    const cols = await database.listCollections();

    let totalDocs = 0;

    for (const colName of cols) {
      const col = database.collection<any>(colName);
      totalDocs += await col.countDocuments();
    }

    res.json({
      name: db,
      collections: cols.length,
      documents: totalDocs,
    });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};
