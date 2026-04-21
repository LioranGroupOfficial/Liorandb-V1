import cors from "cors";
import type { CorsOptions } from "cors";
import type { Request } from "express";

function parseAllowedOrigins(input: string | undefined) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLocalhostOrigin(origin: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

export function buildCorsMiddleware() {
  const configured = parseAllowedOrigins(process.env.LIORANDB_CORS_ORIGINS);
  const strict = process.env.LIORANDB_CORS_STRICT === "1";
  const allowLocalhost = process.env.LIORANDB_CORS_ALLOW_LOCALHOST !== "0";

  const base: CorsOptions = {
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-liorandb-connection-string"],
    exposedHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
    maxAge: 600
  };

  return cors((req: Request, cb) => {
    const origin = req.header("Origin");

    if (!origin) {
      return cb(null, { ...base, origin: false });
    }

    if (!configured && !strict) {
      return cb(null, { ...base, origin: true });
    }

    if (allowLocalhost && isLocalhostOrigin(origin)) {
      return cb(null, { ...base, origin: true });
    }

    if (configured && configured.includes(origin)) {
      return cb(null, { ...base, origin: true });
    }

    return cb(null, { ...base, origin: false });
  });
}
