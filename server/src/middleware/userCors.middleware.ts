import { NextFunction, Request, Response } from "express";
import { findUserById, getRequestAuth, isAdminRole } from "../utils/auth";

type CacheEntry = { origins: string[] | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

function normalizeOrigins(origins: unknown): string[] | null {
  if (!Array.isArray(origins)) return null;
  const out: string[] = [];
  for (const item of origins) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed);
  }
  return out;
}

async function getCachedUserOrigins(userId: string): Promise<string[] | null> {
  const now = Date.now();
  const existing = cache.get(userId);
  if (existing && existing.expiresAt > now) return existing.origins;

  const user = await findUserById(userId);
  const origins = normalizeOrigins(user?.corsOrigins) ?? null;
  cache.set(userId, { origins, expiresAt: now + TTL_MS });
  return origins;
}

export async function userCorsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.get("origin");
  if (!origin) return next();

  const auth = getRequestAuth(req);
  if (!auth) return next();

  if (auth.authType !== "jwt") return next();
  if (isAdminRole(auth.role)) return next();

  // Super-admin is not stored as a managed user
  if (auth.userId === "super-admin") return next();

  const allowed = await getCachedUserOrigins(auth.userId);
  if (!allowed || allowed.length === 0) return next();
  if (allowed.includes("*")) return next();

  if (!allowed.includes(origin)) {
    return res.status(403).json({ error: "origin not allowed for this user" });
  }

  return next();
}

