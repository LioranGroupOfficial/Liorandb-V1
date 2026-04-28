import { NextFunction, Request, Response } from "express";
import { isSnapshotRunning } from "../utils/snapshots";
import { getPaused } from "../utils/pause";

export function maintenanceMiddleware(req: Request, res: Response, next: NextFunction) {
  if (getPaused()) {
    // Allow health and maintenance endpoints while paused.
    if (req.path === "/health" || req.path.startsWith("/maintenance")) {
      return next();
    }

    res.setHeader("Retry-After", "5");
    return res.status(503).json({ error: "server maintenance in progress" });
  }

  if (!isSnapshotRunning()) return next();

  // Allow health and maintenance endpoints during snapshot.
  if (req.path === "/health" || req.path.startsWith("/maintenance")) {
    return next();
  }

  res.setHeader("Retry-After", "30");
  return res.status(503).json({ error: "server maintenance in progress" });
}

