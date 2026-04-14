// src/utils/token.ts
import jwt, { SignOptions } from "jsonwebtoken";
import { ensurePersistentSecret } from "./secret";

export const JWT_SECRET = ensurePersistentSecret();

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
