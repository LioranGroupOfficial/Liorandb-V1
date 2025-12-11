import { Request, Response } from "express";
import { manager } from "../config/database";

export const listDatabases = async (req: Request, res: Response) => {
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
