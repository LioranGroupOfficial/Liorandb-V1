import { Request, Response } from "express";
import { getRequestAuth, isAdminRole } from "../utils/auth";
import {
  isSnapshotRunning,
  listSnapshots,
  runSnapshot,
  getSnapshotConfig,
} from "../utils/snapshots";
import { closeManager, manager, openWriteDatabase, recreateManager } from "../config/database";
import { listDatabaseNames } from "../utils/coreStorage";
import { sendApiError } from "../utils/apiError";
import { JWT_SECRET } from "../utils/token";
import { requestShutdown } from "../utils/shutdown";
import { getPaused, setPaused } from "../utils/pause";
import { runExclusiveMaintenance } from "../utils/exclusiveMaintenance";
import path from "path";

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
    if (isSnapshotRunning()) {
      return res.status(409).json({ ok: false, error: "snapshot already running" });
    }

    return res.json(
      await runExclusiveMaintenance("compactAllDatabases", async () => {
        const wasPaused = getPaused();
        if (!wasPaused) setPaused(true);

        try {
          // Ensure all database handles are closed before compaction starts,
          // otherwise LevelDB locks may be held by this same process.
          await recreateManager();

          const names = await listDatabaseNames();
          for (const name of names) {
            const db = await openWriteDatabase(name);
            await db.compactAll();
          }

          return { ok: true, databases: names.length };
        } finally {
          if (!wasPaused) {
            // Recreate again to ensure post-compaction reads/writes start from fresh handles.
            await recreateManager();
            setPaused(false);
          }
        }
      })
    );
  } catch (error) {
    if ((error as any)?.code === "MAINTENANCE_RUNNING") {
      return res.status(409).json({ ok: false, error: (error as Error).message });
    }
    return sendApiError(res, error, 500);
  }
};

export const stopServer = async (req: Request, res: Response) => {
  const { secret } = (req.body || {}) as { secret?: string };

  if (!secret) {
    return res.status(400).json({ ok: false, error: "secret required" });
  }

  if (secret !== JWT_SECRET) {
    return res.status(401).json({ ok: false, error: "invalid secret" });
  }

  res.json({ ok: true, shuttingDown: true });

  const timer = setTimeout(() => {
    requestShutdown("maintenance/stop").catch((err) => {
      console.error("Failed to shutdown via stop endpoint:", err);
    });
  }, 50);

  // best-effort: don't keep process alive for this timer
  (timer as any).unref?.();
};

function requireSecret(req: Request, res: Response) {
  const { secret } = (req.body || {}) as { secret?: string };

  if (!secret) {
    res.status(400).json({ ok: false, error: "secret required" });
    return null;
  }

  if (secret !== JWT_SECRET) {
    res.status(401).json({ ok: false, error: "invalid secret" });
    return null;
  }

  return secret;
}

export const pauseServer = async (req: Request, res: Response) => {
  const secret = requireSecret(req, res);
  if (!secret) return;

  if (getPaused()) {
    return res.json({ ok: true, paused: true, already: true });
  }

  setPaused(true);

  try {
    await closeManager();
    return res.json({ ok: true, paused: true });
  } catch (error) {
    setPaused(false);
    return sendApiError(res, error, 500);
  }
};

export const resumeServer = async (req: Request, res: Response) => {
  const secret = requireSecret(req, res);
  if (!secret) return;

  if (!getPaused()) {
    return res.json({ ok: true, paused: false, already: true });
  }

  try {
    await recreateManager();
    setPaused(false);
    return res.json({ ok: true, paused: false });
  } catch (error) {
    return sendApiError(res, error, 500);
  }
};

export const restoreSnapshot = async (req: Request, res: Response) => {
  const secret = requireSecret(req, res);
  if (!secret) return;

  const { snapshotPath } = (req.body || {}) as { snapshotPath?: string };
  if (!snapshotPath || typeof snapshotPath !== "string") {
    return res.status(400).json({ ok: false, error: "snapshotPath required" });
  }

  const fullPath = path.resolve(snapshotPath);

  // Respond before restore, because core restore may exit the process.
  res.json({ ok: true, restoring: true, snapshotPath: fullPath });

  const timer = setTimeout(() => {
    (async () => {
      try {
        await manager.restore(fullPath);
      } catch (err) {
        console.error("Restore failed:", err);
      }
    })();
  }, 50);

  (timer as any).unref?.();
};
