// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../utils/token";
import { getDatabaseRecord, parseConnectionString, verifyDatabaseCredential } from "../utils/databaseAccess";

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const auth = req.headers.authorization;
  const connectionStringHeader = req.get("x-liorandb-connection-string");

  if (!auth && !connectionStringHeader) {
    return res.status(401).json({ error: "Missing token or connection string" });
  }

  try {
    if (auth?.startsWith("Bearer ")) {
      const token = auth.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);

      req.user = decoded as Request["user"];
      return next();
    }

    if (!connectionStringHeader) {
      return res.status(401).json({ error: "Missing connection string" });
    }

    const parsed = parseConnectionString(connectionStringHeader);
    const record = await getDatabaseRecord(parsed.databaseName);

    if (!record) {
      return res.status(401).json({ error: "Unknown database in connection string" });
    }

    const ok = await verifyDatabaseCredential(record, parsed.username, parsed.password);
    if (!ok) {
      return res.status(401).json({ error: "Invalid database credentials" });
    }

    req.user = {
      authType: "connection",
      userId: record.ownerUserId,
      username: record.dbUsername || parsed.username,
      role: "user",
      databaseName: record.databaseName,
    };

    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token or connection string" });
  }
}
