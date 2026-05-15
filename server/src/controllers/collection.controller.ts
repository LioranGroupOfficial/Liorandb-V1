import { Request, Response } from "express";
import { getReadManager, getWriteManager } from "../config/database";
import {
  createCollectionByName,
  deleteCollectionByName,
  listCollectionNames,
  renameCollectionByName,
} from "../utils/coreStorage";
import { requireDatabaseAccess } from "../utils/databaseAccess";
import { sendApiError } from "../utils/apiError";
import {
  readCollectionDateOption,
  reconfigureCollectionDateOption,
  type CollectionDateOption,
  openConfiguredCollection,
} from "../utils/collectionConfig";

export const listCollections = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const collections = await listCollectionNames(req.params.db);
    res.json({ collections });
  } catch (error) {
    return sendApiError(res, error, 403);
  }
};

export const createCollection = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    await createCollectionByName(req.params.db, req.body.name);
    res.json({ ok: true, collection: req.body.name });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const deleteCollection = async (req: Request, res: Response) => {
  try {
    await requireDatabaseAccess(req, req.params.db);
    const ok = await deleteCollectionByName(req.params.db, req.params.col);
    res.json({ ok });
  } catch (error) {
    return sendApiError(res, error, 403);
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
    return sendApiError(res, error, 400);
  }
};

export const collectionStats = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    await requireDatabaseAccess(req, db);
    const database = await getReadManager().db(db);
    const collection = openConfiguredCollection<any>(database, col);

    const count = await collection.countDocuments();

    res.json({
      name: col,
      documents: count,
    });
  } catch (error) {
    return sendApiError(res, error, 403);
  }
};

export const compactCollection = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    await requireDatabaseAccess(req, db);

    const database = await getWriteManager().db(db);
    await database.compactCollection(col);

    return res.json({ ok: true, db, collection: col });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const getCollectionOptions = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    await requireDatabaseAccess(req, db);
    const database = await getReadManager().db(db);

    return res.json({
      ok: true,
      collection: col,
      options: {
        date: readCollectionDateOption(database as any, col),
      },
    });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const patchCollectionOptions = async (req: Request, res: Response) => {
  try {
    const { db, col } = req.params;
    await requireDatabaseAccess(req, db);
    const database = await getWriteManager().db(db);

    const body = req.body && typeof req.body === "object" ? (req.body as any) : {};
    const nextDate: CollectionDateOption | undefined = body.date;

    if (nextDate !== undefined) {
      const d = nextDate as any;
      if (!(d === true || d === false || d === "yes" || (typeof d === "object" && d))) {
        return res.status(400).json({ error: "invalid date option" });
      }
    }

    await reconfigureCollectionDateOption(database as any, col, nextDate);

    return res.json({
      ok: true,
      collection: col,
      options: {
        date: readCollectionDateOption(database as any, col),
      },
    });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};
