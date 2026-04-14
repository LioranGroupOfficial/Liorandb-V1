import crypto from "crypto";
import { JWT_SECRET } from "./token";

const ALGORITHM = "aes-256-gcm";

function getCipherKey() {
  return crypto.createHash("sha256").update(JWT_SECRET).digest();
}

export function encryptValue(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getCipherKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return {
    cipherText: encrypted.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
  };
}

export function decryptValue(payload: { cipherText: string; iv: string; tag: string }) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getCipherKey(),
    Buffer.from(payload.iv, "base64url")
  );

  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.cipherText, "base64url")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}
