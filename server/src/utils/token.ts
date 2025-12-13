// src/utils/token.ts
import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import os from "os";

/**
 * Derive a stable, machine-bound secret
 */
function getHardwareSecret(): string {
  const fingerprint = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()?.[0]?.model || "unknown-cpu",
    os.cpus()?.length.toString() || "0",
    os.totalmem().toString()
  ].join("|");

  return crypto
    .createHash("sha256")
    .update(fingerprint)
    .digest("hex"); // JWT expects string | Buffer
}

export const JWT_SECRET = getHardwareSecret();

// Safe default, still configurable if needed
export const JWT_EXPIRES_IN: SignOptions["expiresIn"] = "7d";

export function signToken(payload: object) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function verifyToken<T = any>(token: string): T {
  return jwt.verify(token, JWT_SECRET) as T;
}
