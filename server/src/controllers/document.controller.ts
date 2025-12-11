// src/controllers/document.controller.ts
import { Request, Response } from "express";
import { manager } from "../config/database";

export const insertDocument = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    const doc = req.body;

    const database = await manager.db(db);
    // make this a generic any collection to avoid type issues for arbitrary collections
    const collection = database.collection<any>(col);
    const created = await collection.insertOne(doc);

    res.json({ ok: true, doc: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
};

export const findDocuments = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    const { query } = req.body;

    const database = await manager.db(db);
    const collection = database.collection<any>(col);
    const results = await collection.find(query || {});

    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
};

export const getDocument = async (req: Request, res: Response) => {
  try {
    const { db, col, id } = req.params;

    const database = await manager.db(db);
    const collection = database.collection<any>(col);
    const doc = await collection.findOne({ _id: id });

    res.json({ doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
};

export const updateDocument = async (req: Request, res: Response) => {
  try {
    const { db, col, id } = req.params;

    const database = await manager.db(db);
    const collection = database.collection<any>(col);
    const updated = await collection.updateOne({ _id: id }, req.body);

    res.json({ updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
};

export const deleteDocument = async (req: Request, res: Response) => {
  try {
    const { db, col, id } = req.params;

    const database = await manager.db(db);
    const collection = database.collection<any>(col);
    const ok = await collection.deleteOne({ _id: id });

    res.json({ ok });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
};
