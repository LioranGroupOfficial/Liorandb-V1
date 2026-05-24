import { Request, Response, NextFunction } from "express";
import { hostLog } from "../utils/hostLogger.js";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    // Keep logs compact: timestamp is added by hostLog().
    // Format: "200 12ms POST /path"
    hostLog(`${res.statusCode} ${duration}ms ${req.method} ${req.originalUrl}`);
  });

  next();
}


