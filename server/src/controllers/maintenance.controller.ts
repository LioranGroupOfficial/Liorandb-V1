import { Request, Response } from "express";
import { getRequestAuth, isAdminRole } from "../utils/auth";
import {
  isSnapshotRunning,
  listSnapshots,
  runSnapshot,
  getSnapshotConfig,
} from "../utils/snapshots";
import { manager } from "../config/database";
import { listDatabaseNames } from "../utils/coreStorage";
import { sendApiError } from "../utils/apiError";

function requireAdmin(req: Request, res: Response) {
  const auth = getRequestAuth(req);
  if (!auth || auth.authType !== "jwt" || !isAdminRole(auth.role)) {
    res.status(403).json({ error: "admin access required" });
    return null;
  }
  return auth;
}

export const maintenanceStatus = async (req: Request, res: Response) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const config = getSnapshotConfig();
  return res.json({
    ok: true,
    snapshots: {
      enabled: config.enabled,
      intervalMs: config.intervalMs,
      dir: config.dir,
      retentionHours: config.retentionHours,
      running: isSnapshotRunning(),
    },
  });
};

export const listSnapshotFiles = async (req: Request, res: Response) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const files = await listSnapshots();
  return res.json({ ok: true, snapshots: files });
};

export const createSnapshotNow = async (req: Request, res: Response) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  try {
    const result = await runSnapshot(manager, "manual");
    if (result.skipped) {
      return res.status(409).json({ ok: false, skipped: true, reason: result.reason });
    }
    return res.json({ ok: true, snapshot: result });
  } catch (error) {
    return sendApiError(res, error, 500);
  }
};

export const compactAllDatabases = async (req: Request, res: Response) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;

  try {
    const names = await listDatabaseNames();

    for (const name of names) {
      const db = await manager.db(name);
      await db.compactAll();
    }

    return res.json({ ok: true, databases: names.length });
  } catch (error) {
    return sendApiError(res, error, 500);
  }
};
