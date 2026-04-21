import { NextFunction, Request, Response } from "express";
import { isSnapshotRunning } from "../utils/snapshots";

export function maintenanceMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isSnapshotRunning()) return next();

  // Allow health and maintenance endpoints during snapshot.
  if (req.path === "/health" || req.path.startsWith("/maintenance")) {
    return next();
  }

  res.setHeader("Retry-After", "30");
  return res.status(503).json({ error: "server maintenance in progress" });
}

