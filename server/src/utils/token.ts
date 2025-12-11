// src/utils/token.ts
import jwt, { SignOptions } from "jsonwebtoken";

// Fail fast if missing
if (!process.env.JWT_SECRET) {
  throw new Error("Missing JWT_SECRET environment variable");
}

export const JWT_SECRET: string = process.env.JWT_SECRET;

// EXPLICITLY cast expiresIn to the exact JWT type
export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || "7d") as SignOptions["expiresIn"];

export function signToken(payload: object) {
  return jwt.sign(
    payload,
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
    } as SignOptions
  );
}
