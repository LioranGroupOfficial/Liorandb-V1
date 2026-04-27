import { Request, Response } from "express";
import { manager } from "../config/database";
import { listCollectionNames } from "../utils/coreStorage";
import {
  buildDatabaseResponse,
  createManagedDatabase,
  deleteManagedDatabase,
  getDatabasePassword,
  getDatabaseRecord,
  getRequestHost,
  listManagedDatabases,
  requireDatabaseAccess,
  resolveDatabaseListForAuth,
  setDatabaseCredentials,
} from "../utils/databaseAccess";
import { findUserById, getRequestAuth, isAdminRole } from "../utils/auth";
import { sendApiError } from "../utils/apiError";

export const listDatabases = async (req: Request, res: Response) => {
  try {
    const auth = getRequestAuth(req);
    if (!auth) {
      return res.status(401).json({ error: "authentication required" });
    }

    const databases = await resolveDatabaseListForAuth(auth);
    const host = getRequestHost(req);

    res.json({
      databases: databases.map((record) => buildDatabaseResponse(record, host)),
    });
  } catch {
    res.status(500).json({ error: "server error" });
  }
};

export const createDatabase = async (req: Request, res: Response) => {
  try {
    const auth = getRequestAuth(req);
    if (!auth || auth.authType !== "jwt") {
      return res.status(401).json({ error: "jwt auth required" });
    }

    const { name, ownerUserId } = req.body;
    if (!name) return res.status(400).json({ error: "database name required" });

    let targetOwnerId = auth.userId;
    let targetOwnerRole = auth.role;

    if (ownerUserId && ownerUserId !== auth.userId) {
      if (!isAdminRole(auth.role)) {
        return res
          .status(403)
          .json({ error: "cannot create database for another user" });
      }

      const owner = await findUserById(ownerUserId);
      if (!owner) {
        return res.status(404).json({ error: "target user not found" });
      }

      targetOwnerId = owner.userId;
      targetOwnerRole = owner.role;
    }

    const record = await createManagedDatabase({
      actor: auth,
      ownerUserId: targetOwnerId,
      ownerRole: targetOwnerRole,
      requestedName: name,
    });

    res.json({
      ok: true,
      database: buildDatabaseResponse(record, getRequestHost(req)),
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "server error" });
  }
};

export const deleteDatabase = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    const { record } = await requireDatabaseAccess(req, db);

    if (!record) {
      return res.status(404).json({ error: "managed database not found" });
    }

    await deleteManagedDatabase(record);
    const ok = true;
    res.json({ ok: !!ok });
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "server error" });
  }
};

export const renameDatabase = async (_req: Request, res: Response) => {
  return res
    .status(405)
    .json({ error: "database rename is not supported for managed databases" });
};

export const databaseStats = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    await requireDatabaseAccess(req, db);
    const database = await manager.db(db);
    const cols = await listCollectionNames(db);

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
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "server error" });
  }
};

export const listDatabasesByUser = async (req: Request, res: Response) => {
  const auth = getRequestAuth(req);
  if (!auth || !isAdminRole(auth.role)) {
    return res.status(403).json({ error: "admin access required" });
  }

  const user = await findUserById(req.params.userId);
  if (!user) {
    return res.status(404).json({ error: "user not found" });
  }

  const records = await listManagedDatabases(user.userId);
  const host = getRequestHost(req);

  return res.json({
    userId: user.userId,
    count: records.length,
    databases: records.map((record) => buildDatabaseResponse(record, host)),
  });
};

export const countDatabases = async (req: Request, res: Response) => {
  const auth = getRequestAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "authentication required" });
  }

  const targetUserId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  if (targetUserId && targetUserId !== auth.userId && !isAdminRole(auth.role)) {
    return res.status(403).json({ error: "admin access required for other users" });
  }

  const records = await listManagedDatabases(
    targetUserId || (auth.role === "user" ? auth.userId : undefined)
  );

  return res.json({
    userId: targetUserId || (auth.role === "user" ? auth.userId : "all"),
    count: records.length,
  });
};

export const getDatabaseCredentials = async (req: Request, res: Response) => {
  try {
    const { record } = await requireDatabaseAccess(req, req.params.db);

    if (!record) {
      return res.status(404).json({ error: "managed database not found" });
    }

    const password = record.dbPasswordHash ? getDatabasePassword(record) : null;
    return res.json({
      databaseName: record.databaseName,
      ownerUserId: record.ownerUserId,
      username: record.dbUsername || null,
      password,
      connectionString:
        record.dbUsername && password
          ? buildDatabaseResponse(record, getRequestHost(req)).connectionString
          : null,
    });
  } catch (error) {
    return res.status(403).json({ error: error instanceof Error ? error.message : "server error" });
  }
};

export const upsertDatabaseCredentials = async (req: Request, res: Response) => {
  try {
    const { record } = await requireDatabaseAccess(req, req.params.db);

    if (!record) {
      return res.status(404).json({ error: "managed database not found" });
    }

    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      return res.status(400).json({ error: "username and password required" });
    }

    const updated = await setDatabaseCredentials(record, username, password);
    return res.json({
      ok: true,
      credentials: {
        databaseName: updated.databaseName,
        username: updated.dbUsername,
        password,
        connectionString: buildDatabaseResponse(updated, getRequestHost(req)).connectionString,
      },
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "server error" });
  }
};

export const generateDatabaseConnectionString = async (req: Request, res: Response) => {
  try {
    const record = await getDatabaseRecord(req.params.db);
    const auth = getRequestAuth(req);

    if (!record) {
      return res.status(404).json({ error: "managed database not found" });
    }

    if (!auth || (!isAdminRole(auth.role) && auth.userId !== record.ownerUserId)) {
      return res.status(403).json({ error: "database access denied" });
    }

    if (!record.dbUsername || !record.dbPasswordHash) {
      return res.status(400).json({ error: "database credentials are not configured" });
    }

    return res.json({
      databaseName: record.databaseName,
      connectionString: buildDatabaseResponse(record, getRequestHost(req)).connectionString,
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "server error" });
  }
};

export const compactDatabase = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    await requireDatabaseAccess(req, db);

    const database = await manager.db(db);
    await database.compactAll();

    return res.json({ ok: true, db });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

export const explainDatabase = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    await requireDatabaseAccess(req, db);

    const body = req.body && typeof req.body === "object" ? (req.body as any) : {};
    const collection = body.collection;
    if (!collection || typeof collection !== "string") {
      return res.status(400).json({ error: "collection is required" });
    }

    const database = await manager.db(db);
    const explain = await database.explain(collection, body.query || {}, body.options || undefined);

    return res.json({ explain });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};

type TxOp = { col: string; op: string; args: any[] };

const ALLOWED_TX_OPS = new Set([
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
]);

export const runTransaction = async (req: Request, res: Response) => {
  try {
    const { db } = req.params;
    await requireDatabaseAccess(req, db);

    const body = req.body && typeof req.body === "object" ? (req.body as any) : {};
    const ops: TxOp[] = Array.isArray(body.ops) ? body.ops : [];

    if (!Array.isArray(body.ops)) {
      return res.status(400).json({ error: "ops must be an array" });
    }

    for (const [idx, op] of ops.entries()) {
      if (!op || typeof op !== "object") {
        return res.status(400).json({ error: `invalid op at index ${idx}` });
      }
      if (typeof op.col !== "string" || !op.col.trim()) {
        return res.status(400).json({ error: `invalid col at index ${idx}` });
      }
      if (typeof op.op !== "string" || !ALLOWED_TX_OPS.has(op.op)) {
        return res.status(400).json({ error: `unsupported op at index ${idx}` });
      }
      if (!Array.isArray(op.args)) {
        return res.status(400).json({ error: `args must be an array at index ${idx}` });
      }
    }

    const database = await manager.db(db);

    const result = await database.transaction(async (tx: any) => {
      for (const op of ops) {
        const col = tx.collection(op.col);
        const fn = (col as any)[op.op];
        if (typeof fn !== "function") {
          throw new Error(`unsupported operation: ${op.op}`);
        }
        fn(...op.args);
      }
      return { applied: ops.length };
    });

    return res.json({ ok: true, result });
  } catch (error) {
    return sendApiError(res, error, 400);
  }
};
